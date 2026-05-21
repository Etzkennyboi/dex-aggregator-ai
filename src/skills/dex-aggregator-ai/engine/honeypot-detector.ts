/**
 * Honeypot Detector
 * Token safety scanning using liquidity checks and metadata verification.
 *
 * Fixed:
 *   #5  - Clarified detection scope in comments: this is a DEX-liquidity-based
 *         heuristic, not a bytecode analyser. buyTax/sellTax fields now accurately
 *         reflect what we can measure (round-trip price spread) rather than always
 *         returning 0 as false assurance. Added spread-based tax estimation.
 *   #11 - X Layer USDC address corrected to 0x74b7F16337b8972027F6196A17a631aC6dE26d22
 */

import { getClient, getChainId } from '../lib/onchainos-client';
import { getTokenDecimals } from '../lib/token-decimals';

export interface TokenSafetyReport {
  isHoneypot: boolean;
  riskScore: number;
  /** Estimated via round-trip quote spread. 0 if insufficient data. */
  buyTax: number;
  /** Estimated via round-trip quote spread. 0 if insufficient data. */
  sellTax: number;
  canSell: boolean;
  contractVerified: boolean;
  liquidityLocked: boolean;
  warnings: string[];
}

// Fix #11: correct per-chain USDC addresses
const USDC_ADDRESSES: Record<string, string> = {
  '1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  '42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  '8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  '56': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  '137': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  '10': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  '43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  '196': '0x74b7F16337b8972027F6196A17a631aC6dE26d22', // Fix #11
};

// A 1 USDC probe (6 decimals) for reverse-quote direction
const PROBE_USDC_AMOUNT = '1000000'; // 1 USDC

export class HoneypotDetector {
  /**
   * Heuristic safety scan via OKX DEX quote API.
   *
   * NOTE (Fix #5): This is a liquidity and routing heuristic, NOT a bytecode
   * analyser. It cannot detect all honeypot patterns — specifically it cannot
   * detect contracts with:
   *   - Whitelist-based sell restrictions
   *   - Time-locked sell functions
   *   - Owner-only transfer bypasses
   * Use in conjunction with an on-chain bytecode analyser (e.g. GoPlus) for
   * higher-confidence scanning. See SKILL.md for planned GoPlus integration.
   *
   * buyTax / sellTax are estimated from round-trip quote spread and may not
   * match the contract's actual fee function.
   */
  static async scanToken(tokenAddress: string, chain: string): Promise<TokenSafetyReport> {
    const report: TokenSafetyReport = {
      isHoneypot: false,
      riskScore: 0,
      buyTax: 0,
      sellTax: 0,
      canSell: true,
      contractVerified: false,
      liquidityLocked: false,
      warnings: [],
    };

    try {
      const client = getClient();
      const chainId = getChainId(chain);
      const usdcAddr = USDC_ADDRESSES[chainId] || USDC_ADDRESSES['1'];

      // Metadata check
      try {
        const metadata = await client.getTokenMetadata(chainId, tokenAddress);
        report.contractVerified =
          typeof metadata === 'object' && metadata !== null && 'isVerified' in metadata
            ? Boolean(metadata.isVerified)
            : false;
        if (!report.contractVerified) {
          report.warnings.push('Contract not verified on explorer');
          report.riskScore += 10;
        }
      } catch {
        report.warnings.push('Token metadata unavailable');
        report.riskScore += 5;
      }

      // Forward quote: token → USDC (sell path)
      let sellQuoteOut: number | null = null;
      try {
        const decimals = await getTokenDecimals(tokenAddress, chainId);
        const probeTokenAmount = (10n ** BigInt(decimals)).toString();

        const sellQuote = await client.getQuotes({
          chainId,
          fromTokenAddress: tokenAddress,
          toTokenAddress: usdcAddr,
          amount: probeTokenAmount,
          slippage: '5',
        });

        if (!sellQuote || sellQuote.length === 0) {
          report.warnings.push('No sell-side liquidity found — potential honeypot');
          report.canSell = false;
          report.riskScore += 40;
        } else {
          const best = sellQuote[0] as any;
          sellQuoteOut = parseFloat(best.toTokenAmount);
          if (parseFloat(best.priceImpact) > 10) {
            report.warnings.push('Extreme sell-side price impact (>10%)');
            report.riskScore += 20;
          }
        }
      } catch {
        report.canSell = false;
        report.warnings.push('Sell quote failed — contract may block sells');
        report.riskScore += 35;
      }

      // Reverse quote: USDC → token (buy path)
      let buyQuoteOut: number | null = null;
      try {
        const buyQuote = await client.getQuotes({
          chainId,
          fromTokenAddress: usdcAddr,
          toTokenAddress: tokenAddress,
          amount: PROBE_USDC_AMOUNT,
          slippage: '5',
        });

        if (!buyQuote || buyQuote.length === 0) {
          report.warnings.push('No buy-side liquidity found');
          report.riskScore += 20;
        } else {
          buyQuoteOut = parseFloat((buyQuote[0] as any).toTokenAmount);
        }
      } catch {
        report.warnings.push('Buy quote failed');
        report.riskScore += 15;
      }

      // Fix #5: estimate round-trip spread as a proxy for buy/sell tax
      if (sellQuoteOut !== null && buyQuoteOut !== null && buyQuoteOut > 0) {
        // Round-trip: sell 1 token → USDC → buy back token
        // Expected back ≈ sellQuoteOut / (1 USDC per buyQuoteOut token)
        // Spread captures pool fees + any hidden sell tax
        const roundTripRatio = sellQuoteOut / 1e6 / (1 / (buyQuoteOut / 1e18));
        const totalSpreadPct = Math.max(0, (1 - roundTripRatio) * 100);
        // Approximate half to each side (rough heuristic)
        report.sellTax = parseFloat((totalSpreadPct / 2).toFixed(2));
        report.buyTax = parseFloat((totalSpreadPct / 2).toFixed(2));

        if (totalSpreadPct > 15) {
          report.warnings.push(
            `High round-trip spread: ${totalSpreadPct.toFixed(1)}% — possible tax token`
          );
          report.riskScore += 15;
        }
      }

      report.isHoneypot = report.riskScore > 60 || !report.canSell;
    } catch (error) {
      report.warnings.push(
        `Security scan error: ${error instanceof Error ? error.message : 'Unknown'}`
      );
      report.riskScore += 15;
    }

    return report;
  }

  static isSafeToSwap(report: TokenSafetyReport, maxSlippage: number): boolean {
    if (
      report.isHoneypot ||
      !report.canSell ||
      report.riskScore > 70 ||
      report.buyTax > maxSlippage
    )
      return false;
    return true;
  }
}
