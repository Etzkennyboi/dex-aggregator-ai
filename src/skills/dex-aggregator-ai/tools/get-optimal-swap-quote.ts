/**
 * get_optimal_swap_quote
 * Main quote engine with cache warming, route metadata tracking, and split routing.
 *
 * Fixed:
 *   #2  - Route store moved to lib/route-store (UUID IDs, periodic sweeper)
 *   #4  - Raw amount conversion uses lib/token-decimals (WBTC=8, SOL=9, etc.)
 *   #8  - warmCache() awaited BEFORE rankByNetOutput() so prices are never stale
 *   #10 - Gas price oracle queries OKX on-chain endpoint; static map is fallback only
 */

import { getClient, CHAIN_IDS, NATIVE_ADDRESSES } from '../lib/onchainos-client';
import { toRawAmountForToken } from '../lib/token-decimals';
import { generateRouteId, storeRoute, getRoute, getRouteMeta } from '../lib/route-store';
import { SplitRouteCalculator } from '../engine/split-route-calculator';
import { NetOutputOptimizer } from '../engine/net-output-optimizer';
import { MEVProtectionRouter } from '../engine/mev-protection-router';
import type { SwapQuoteParams, SwapQuote, SwapRoute, RouteSplit } from '../types';
import type { RouteMetadata } from '../lib/route-store';

// Static token addresses per chain — same as before
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  '1': {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  '42161': {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  },
  '8453': {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
  '56': {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  },
  '137': {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  },
  '196': {
    USDC: '0x74b7F16337b8972027F6196A17a631aC6dE26d22',
    USDT: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
  },
};

export async function getOptimalSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  const {
    fromToken,
    toToken,
    amount,
    chain = 'ethereum',
    slippageTolerance = 0.5,
    preferMEVProtection = true,
    allowSplitRoute = true,
    deadlineMinutes = 10,
  } = params;

  const chainId = CHAIN_IDS[chain.toLowerCase()] || '1';
  const fromAddress = resolveTokenAddress(fromToken, chainId);
  const toAddress = resolveTokenAddress(toToken, chainId);

  // Fix #4: use real decimal registry
  const rawAmount = await toRawAmountForToken(amount, fromToken, chainId);

  const client = getClient();
  const rawQuotes = await client.getQuotes({
    chainId,
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    amount: rawAmount,
    slippage: slippageTolerance.toString(),
  });

  // Fix #8: warm cache BEFORE ranking so getTokenPriceSync() returns real values
  await NetOutputOptimizer.warmCache([toToken]);

  // Fix #10: fetch live gas price; fall back to static map on error
  const gasPrice = await fetchLiveGasPrice(chain, chainId);

  const expiresAt = Date.now() + deadlineMinutes * 60 * 1000;

  const enrichedRoutes: SwapRoute[] = await Promise.all(
    rawQuotes.map(async (quote: unknown) => {
      const quoteData = (quote as Record<string, unknown>) || {};
      const quoteAmount =
        typeof quoteData.toTokenAmount === 'string' ? quoteData.toTokenAmount : '0';
      const quotePriceImpact =
        typeof quoteData.priceImpact === 'string' ? quoteData.priceImpact : '0';
      const quoteGasEstimate =
        typeof quoteData.gasEstimate === 'string' ? quoteData.gasEstimate : '150000';
      const quoteRouterType =
        typeof quoteData.routerType === 'string' ? quoteData.routerType : 'SINGLE';
      const quoteEstimatedTime =
        typeof quoteData.estimatedTime === 'string' ? quoteData.estimatedTime : '< 30s';
      const quoteProvider =
        typeof quoteData.dexName === 'string'
          ? quoteData.dexName
          : typeof quoteData.provider === 'string'
            ? quoteData.provider
            : 'Unknown';

      const gasCostUSD = calculateGasCost(quoteGasEstimate, gasPrice);
      const tokenPrice = await NetOutputOptimizer.getTokenPrice(toToken);

      const route: SwapRoute = {
        provider: quoteProvider,
        routeId: generateRouteId(), // Fix #2: UUID
        fromToken,
        outputAmount: quoteAmount,
        outputToken: toToken,
        priceImpact: parseFloat(quotePriceImpact) * 100,
        gasEstimate: quoteGasEstimate,
        gasCostUSD: gasCostUSD.toString(),
        netOutputUSD: (parseFloat(quoteAmount) * tokenPrice - gasCostUSD).toString(),
        routeType: quoteRouterType,
        estimatedTime: quoteEstimatedTime,
        mevProtected: false,
      };

      const meta: RouteMetadata = {
        fromToken,
        toToken,
        fromTokenAddress: fromAddress,
        toTokenAddress: toAddress,
        amount,
        rawAmount,
        chain,
        chainId,
        expiresAt,
      };

      storeRoute(route, meta); // Fix #2: centralised store

      if (preferMEVProtection) {
        const protectedRoute = MEVProtectionRouter.applyProtection(route, chain);
        protectedRoute.routeId = generateRouteId();
        storeRoute(protectedRoute, { ...meta });
        return protectedRoute;
      }

      return route;
    })
  );

  const rankedRoutes = NetOutputOptimizer.rankByNetOutput(enrichedRoutes);
  const recommendedRoute = rankedRoutes[0];
  const alternativeRoutes = rankedRoutes.slice(1, 4);

  let splitRoute = {
    enabled: false,
    splits: [] as RouteSplit[],
    improvementVsSingle: '0%',
    netImprovementAfterGas: '$0',
  };

  if (allowSplitRoute && alternativeRoutes.length > 0) {
    const splitResult = SplitRouteCalculator.calculateOptimalSplit(
      recommendedRoute,
      alternativeRoutes[0],
      amount,
      amount
    );
    if (splitResult) {
      splitRoute = {
        enabled: true,
        splits: splitResult.splits,
        improvementVsSingle: splitResult.improvement,
        netImprovementAfterGas: splitResult.netImprovement,
      };
    }
  }

  return {
    recommendedRoute,
    alternativeRoutes,
    splitRoute,
    mevProtected: recommendedRoute.mevProtected,
    simulationRecommended: recommendedRoute.priceImpact > 0.3 || !recommendedRoute.mevProtected,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveTokenAddress(token: string, chainId: string): string {
  const upper = token.toUpperCase();
  if (['ETH', 'WETH', 'BNB', 'MATIC', 'AVAX', 'SOL', 'OP', 'ARB'].includes(upper)) {
    return (
      NATIVE_ADDRESSES[
        Object.keys(CHAIN_IDS).find((k) => CHAIN_IDS[k] === chainId) || 'ethereum'
      ] || NATIVE_ADDRESSES.ethereum
    );
  }
  const chainTokens = TOKEN_ADDRESSES[chainId] || TOKEN_ADDRESSES['1'];
  return chainTokens[upper] || token;
}

// Fix #10: static fallback gas prices (gwei). Used only when on-chain fetch fails.
const FALLBACK_GAS_GWEI: Record<string, number> = {
  ethereum: 20,
  arbitrum: 0.1,
  base: 0.1,
  bsc: 3,
  polygon: 50,
  optimism: 0.1,
  avalanche: 25,
  solana: 0.0005,
  xlayer: 0.05,
};

// ETH-equivalent prices (USD) per chain's native gas token — fallback only
const NATIVE_TOKEN_USD: Record<string, number> = {
  ethereum: 3000,
  arbitrum: 3000,
  base: 3000,
  bsc: 600,
  polygon: 1,
  optimism: 3000,
  avalanche: 35,
  solana: 150,
  xlayer: 3000,
};

async function fetchLiveGasPrice(
  chain: string,
  chainId: string
): Promise<{ gwei: number; nativeUSD: number }> {
  try {
    const client = getClient();
    const gasData = await client.estimateGas({ chainId, txData: '0x' });
    const gasPriceValue =
      gasData && typeof gasData.gasPrice === 'string'
        ? gasData.gasPrice
        : typeof gasData?.gasPrice === 'number'
          ? gasData.gasPrice.toString()
          : undefined;
    const gwei = gasPriceValue
      ? parseInt(gasPriceValue, 10) / 1e9
      : (FALLBACK_GAS_GWEI[chain] ?? 20);
    const nativeUSD = NATIVE_TOKEN_USD[chain.toLowerCase()] ?? 3000;
    return { gwei, nativeUSD };
  } catch {
    const gwei = FALLBACK_GAS_GWEI[chain.toLowerCase()] ?? 20;
    const nativeUSD = NATIVE_TOKEN_USD[chain.toLowerCase()] ?? 3000;
    return { gwei, nativeUSD };
  }
}

function calculateGasCost(
  gasEstimate: string | undefined,
  gasPrice: { gwei: number; nativeUSD: number }
): number {
  const units = parseInt(gasEstimate ?? '150000') || 150000;
  const costNative = (units * gasPrice.gwei) / 1e9;
  return costNative * gasPrice.nativeUSD;
}

// ─── Re-exported accessors (backward compat for simulate/execute) ───────────
export {
  getRoute as getStoredRoute,
  getRoute as getStoredRouteWithTTL,
  getRouteMeta as getRouteMetadata,
};
