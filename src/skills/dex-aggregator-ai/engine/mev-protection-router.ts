/**
 * MEV Protection Router
 * Chain-aware MEV protection and post-execution detection
 */

import { getClient, getChainId } from '../lib/onchainos-client';
import type { SwapRoute } from '../types';

interface MEVProtectionConfig {
  enabled: boolean;
  provider: 'flashbots' | 'jito' | 'mevblocker' | 'none';
  extraGasPremium: number;
}

export class MEVProtectionRouter {
  private static readonly PROVIDERS: Record<string, MEVProtectionConfig> = {
    ethereum: { enabled: true, provider: 'flashbots', extraGasPremium: 15 },
    arbitrum: { enabled: false, provider: 'none', extraGasPremium: 0 },
    base: { enabled: true, provider: 'mevblocker', extraGasPremium: 10 },
    bsc: { enabled: false, provider: 'none', extraGasPremium: 0 },
    solana: { enabled: true, provider: 'jito', extraGasPremium: 20 },
    polygon: { enabled: false, provider: 'none', extraGasPremium: 0 },
    optimism: { enabled: false, provider: 'none', extraGasPremium: 0 },
    avalanche: { enabled: false, provider: 'none', extraGasPremium: 0 },
    xlayer: { enabled: false, provider: 'none', extraGasPremium: 0 },
  };

  static getProtectionForChain(chain: string): MEVProtectionConfig {
    return (
      this.PROVIDERS[chain.toLowerCase()] || {
        enabled: false,
        provider: 'none',
        extraGasPremium: 0,
      }
    );
  }

  static applyProtection(route: SwapRoute, chain: string): SwapRoute {
    const protection = this.getProtectionForChain(chain);
    if (!protection.enabled) return { ...route, mevProtected: false };

    const extraGas = parseFloat(route.gasCostUSD) * (protection.extraGasPremium / 100);
    const protectedGasCost = (parseFloat(route.gasCostUSD) + extraGas).toString();

    return {
      ...route,
      mevProtected: true,
      gasEstimate: (parseFloat(route.gasEstimate) * 1.15).toString(),
      gasCostUSD: protectedGasCost,
      netOutputUSD: (parseFloat(route.netOutputUSD) - extraGas).toString(),
    };
  }

  static async detectMEVAttack(txHash: string, chain: string): Promise<boolean> {
    try {
      const client = getClient();
      const chainId = getChainId(chain);
      const txStatus = await client.getTxStatus({ chainId, txHash });

      if (!txStatus) return false;

      if (txStatus.effectiveOutput && txStatus.quotedOutput) {
        const slippage =
          (parseFloat(txStatus.quotedOutput) - parseFloat(txStatus.effectiveOutput)) /
          parseFloat(txStatus.quotedOutput);
        if (slippage > 0.02) return true;
      }

      if (txStatus.blockNumber) {
        const priceImpact = parseFloat(txStatus.priceImpact || '0');
        if (priceImpact > parseFloat(txStatus.quotedPriceImpact || '0') * 2) return true;
      }

      return false;
    } catch (error) {
      console.warn(`MEV detection failed for ${txHash}:`, error);
      return false;
    }
  }
}
