/**
 * token-decimals.ts
 * Authoritative decimal registry + raw amount converter.
 *
 * Fix #4: replaces the "6 for USDC/USDT, 18 for everything else" assumption
 * that was silently wrong for WBTC (8), and any bridged token with non-standard decimals.
 *
 * Strategy:
 *   1. Check static registry first (fast, zero API calls).
 *   2. Fall back to on-chain metadata via OKX token endpoint.
 *   3. Default to 18 only if both fail.
 */

import { getClient } from './onchainos-client';

// symbol (uppercase) or checksummed address → decimals
const STATIC_DECIMALS: Record<string, number> = {
  // 6-decimal stablecoins
  USDC: 6,
  'USDC.E': 6,
  USDT: 6,
  // 8-decimal
  WBTC: 8,
  BTCB: 8,
  // 18-decimal (explicit for clarity)
  ETH: 18,
  WETH: 18,
  DAI: 18,
  LINK: 18,
  UNI: 18,
  AAVE: 18,
  CRV: 18,
  MKR: 18,
  // BSC
  BNB: 18,
  BUSD: 18,
  // Polygon
  MATIC: 18,
  // Avalanche
  AVAX: 18,
  // Solana (lamports)
  SOL: 9,
  // OKX chain
  OKB: 18,
};

// Per-chain overrides for tokens that differ by chain (key: `SYMBOL:chainId`)
const CHAIN_OVERRIDES: Record<string, number> = {
  // Polygon bridged USDC is 6 but the native PoS USDC.e also 6 — no conflict
  // BSC USDC is 18 (not the standard 6)
  'USDC:56': 18,
};

const runtimeCache: Map<string, number> = new Map();

/**
 * Returns the decimal count for a token.
 * @param token   Symbol (e.g. "WBTC") or address (0x…)
 * @param chainId Numeric chain ID string
 */
export async function getTokenDecimals(token: string, chainId: string): Promise<number> {
  const upper = token.toUpperCase();
  const chainKey = `${upper}:${chainId}`;

  if (runtimeCache.has(chainKey)) return runtimeCache.get(chainKey)!;

  // 1. Chain-specific override
  if (CHAIN_OVERRIDES[chainKey] !== undefined) {
    runtimeCache.set(chainKey, CHAIN_OVERRIDES[chainKey]);
    return CHAIN_OVERRIDES[chainKey];
  }

  // 2. Static registry (symbol match)
  if (STATIC_DECIMALS[upper] !== undefined) {
    runtimeCache.set(chainKey, STATIC_DECIMALS[upper]);
    return STATIC_DECIMALS[upper];
  }

  // 3. On-chain metadata (address passed, or unknown symbol)
  try {
    const client = getClient();
    const meta = await client.getTokenMetadata(chainId, token);
    const decimals = typeof meta === 'object' && meta !== null && 'decimals' in meta && typeof meta.decimals === 'number'
      ? meta.decimals
      : 18;
    runtimeCache.set(chainKey, decimals);
    return decimals;
  } catch {
    // 4. Safe default
    console.warn(`[token-decimals] Could not resolve decimals for ${token} on chain ${chainId}, defaulting to 18`);
    runtimeCache.set(chainKey, 18);
    return 18;
  }
}

/**
 * Convert a human-readable amount string to its raw integer representation.
 * e.g. "1.5" WBTC (8 decimals) → "150000000"
 */
export function toRawAmount(humanAmount: string, decimals: number): string {
  const [whole, fraction = ''] = humanAmount.split('.');
  const cleanWhole = whole.replace(/^0+/, '') || '0';
  const cleanFrac = fraction.padEnd(decimals, '0').slice(0, decimals);
  return (cleanWhole + cleanFrac).replace(/^0+/, '') || '0';
}

/**
 * Convenience: resolve decimals then convert. Always await this.
 */
export async function toRawAmountForToken(
  humanAmount: string,
  token: string,
  chainId: string
): Promise<string> {
  const decimals = await getTokenDecimals(token, chainId);
  return toRawAmount(humanAmount, decimals);
}
