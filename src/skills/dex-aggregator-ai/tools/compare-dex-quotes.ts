/**
 * compare_dex_quotes
 * Side-by-side DEX comparison with real token prices.
 *
 * Fixed:
 *   #4  - Raw amount conversion uses lib/token-decimals
 *   #8  - warmCache awaited before ranking
 *   #10 - Gas oracle via live fetch with static fallback (shared logic)
 */

import { getClient, CHAIN_IDS, NATIVE_ADDRESSES } from '../lib/onchainos-client';
import { toRawAmountForToken } from '../lib/token-decimals';
import { NetOutputOptimizer } from '../engine/net-output-optimizer';
import type { CompareParams, CompareResult, SwapRoute } from '../types';

const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  '1': {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI:  '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  '42161': {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI:  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  },
  '8453': {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    DAI:  '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
  '56': {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    DAI:  '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  },
  '137': {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI:  '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  },
  '196': {
    USDC: '0x74b7F16337b8972027F6196A17a631aC6dE26d22',
    USDT: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
  },
};

export async function compareDexQuotes(params: CompareParams): Promise<CompareResult> {
  const { fromToken, toToken, amount, chain = 'ethereum' } = params;

  const chainId     = CHAIN_IDS[chain.toLowerCase()] || '1';
  const fromAddress = resolveTokenAddress(fromToken, chainId);
  const toAddress   = resolveTokenAddress(toToken, chainId);

  // Fix #4
  const rawAmount = await toRawAmountForToken(amount, fromToken, chainId);

  const client = getClient();

  // Fix #10: live gas price
  const gasPrice = await fetchLiveGasPrice(chain, chainId, client);

  const quotes = await client.getQuotes({
    chainId,
    fromTokenAddress: fromAddress,
    toTokenAddress:   toAddress,
    amount:           rawAmount,
    slippage:         '0.5',
  });

  // Fix #8: warm before ranking
  await NetOutputOptimizer.warmCache([toToken]);

  const routes: SwapRoute[] = await Promise.all(
    quotes.map(async (q) => {
      const gasCostUSD  = calculateGasCost(q.gasEstimate || '150000', gasPrice);
      const timeSeconds = parseTimeString(q.estimatedTime || '< 30s');
      const tokenPrice  = await NetOutputOptimizer.getTokenPrice(toToken);

      return {
        provider:     q.dexName || 'Unknown',
        routeId:      `compare_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        fromToken,
        outputAmount: q.toTokenAmount,
        outputToken:  toToken,
        priceImpact:  parseFloat(q.priceImpact) * 100,
        gasEstimate:  q.gasEstimate || '150000',
        gasCostUSD:   gasCostUSD.toString(),
        netOutputUSD: (parseFloat(q.toTokenAmount) * tokenPrice - gasCostUSD).toString(),
        routeType:    q.routerType || 'SINGLE',
        estimatedTime: timeSeconds.toString(),
        mevProtected: false,
      } as SwapRoute;
    })
  );

  const ranked = NetOutputOptimizer.rankByNetOutput(routes);

  const bestBy = {
    netOutput:
      ranked[0]?.provider || 'N/A',
    lowestGas:
      [...routes].sort((a, b) => parseFloat(a.gasCostUSD) - parseFloat(b.gasCostUSD))[0]?.provider || 'N/A',
    fastest:
      [...routes].sort((a, b) => parseFloat(a.estimatedTime) - parseFloat(b.estimatedTime))[0]?.provider || 'N/A',
    lowestSlippage:
      [...routes].sort((a, b) => a.priceImpact - b.priceImpact)[0]?.provider || 'N/A',
  };

  return { quotes: ranked, bestBy };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function parseTimeString(timeStr: string): number {
  const lower = timeStr.toLowerCase().trim();
  const secondsMatch = lower.match(/<?\s*(\d+)\s*s/);
  if (secondsMatch) return parseInt(secondsMatch[1]);
  const minMatch = lower.match(/(\d+)(?:-\d+)?\s*min/);
  if (minMatch) return parseInt(minMatch[1]) * 60;
  if (lower.includes('instant') || lower.includes('fast')) return 5;
  return 30;
}

const FALLBACK_GAS_GWEI: Record<string, number> = {
  ethereum: 20, arbitrum: 0.1, base: 0.1, bsc: 3,
  polygon: 50, optimism: 0.1, avalanche: 25, solana: 0.0005, xlayer: 0.05,
};
const NATIVE_TOKEN_USD: Record<string, number> = {
  ethereum: 3000, arbitrum: 3000, base: 3000, bsc: 600,
  polygon: 1, optimism: 3000, avalanche: 35, solana: 150, xlayer: 3000,
};

async function fetchLiveGasPrice(
  chain: string,
  chainId: string,
  client: ReturnType<typeof getClient>
): Promise<{ gwei: number; nativeUSD: number }> {
  try {
    const gasData   = await client.estimateGas({ chainId, txData: '0x' });
    const gwei      = gasData?.gasPrice ? parseInt(gasData.gasPrice) / 1e9 : (FALLBACK_GAS_GWEI[chain] ?? 20);
    const nativeUSD = NATIVE_TOKEN_USD[chain.toLowerCase()] ?? 3000;
    return { gwei, nativeUSD };
  } catch {
    return {
      gwei:      FALLBACK_GAS_GWEI[chain.toLowerCase()] ?? 20,
      nativeUSD: NATIVE_TOKEN_USD[chain.toLowerCase()] ?? 3000,
    };
  }
}

function calculateGasCost(
  gasEstimate: string,
  gasPrice: { gwei: number; nativeUSD: number }
): number {
  const units      = parseInt(gasEstimate) || 150000;
  const costNative = (units * gasPrice.gwei) / 1e9;
  return costNative * gasPrice.nativeUSD;
}
