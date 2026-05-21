/**
 * Net Output Optimizer
 * Calculates true net output after all costs (gas + slippage + MEV)
 */

import { getClient } from '../lib/onchainos-client';
import type { SwapRoute } from '../types';

interface CostBreakdown {
  outputValue: number;
  gasCost: number;
  slippageCost: number;
  mevRiskCost: number;
  netOutput: number;
}

export class NetOutputOptimizer {
  private static readonly MEV_RISK_COST_BPS = 10;
  private static readonly SLIPPAGE_BUFFER = 1.5;
  private static tokenPriceCache: Map<string, number> = new Map();

  static rankByNetOutput(routes: SwapRoute[]): SwapRoute[] {
    const scored = routes.map((route) => ({
      route,
      score: this.calculateNetOutput(route),
    }));
    return scored.sort((a, b) => b.score.netOutput - a.score.netOutput).map((s) => s.route);
  }

  static calculateNetOutput(route: SwapRoute): CostBreakdown {
    const outputValue = parseFloat(route.outputAmount) * this.getTokenPriceSync(route.outputToken);
    const gasCost = parseFloat(route.gasCostUSD);
    const slippageCost = outputValue * ((route.priceImpact * this.SLIPPAGE_BUFFER) / 100);
    const mevRiskCost = route.mevProtected
      ? 0
      : outputValue * (this.MEV_RISK_COST_BPS / 10000);
    const netOutput = outputValue - gasCost - slippageCost - mevRiskCost;

    return { outputValue, gasCost, slippageCost, mevRiskCost, netOutput };
  }

  static async getTokenPrice(token: string): Promise<number> {
    const cacheKey = token.toLowerCase();
    const cached = this.tokenPriceCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const client = getClient();
      const priceData = await client.getTokenPrice('1', token);
      const price = parseFloat(priceData) || 1.0;
      this.tokenPriceCache.set(cacheKey, price);
      return price;
    } catch (error) {
      const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD'];
      if (stablecoins.some((s) => token.toUpperCase().includes(s))) return 1.0;
      console.warn(`Price fetch failed for ${token}, using fallback 1.0`);
      return 1.0;
    }
  }

  static getTokenPriceSync(token: string): number {
    return this.tokenPriceCache.get(token.toLowerCase()) || 1.0;
  }

  static shouldUseMEVProtection(route: SwapRoute, amountUSD: number): boolean {
    const mevCost = amountUSD * (this.MEV_RISK_COST_BPS / 10000);
    const mevProtectionGasPremium = parseFloat(route.gasCostUSD) * 0.3;
    return mevCost > mevProtectionGasPremium;
  }

  static async warmCache(tokens: string[]): Promise<void> {
    await Promise.all(tokens.map((t) => this.getTokenPrice(t)));
  }
}
