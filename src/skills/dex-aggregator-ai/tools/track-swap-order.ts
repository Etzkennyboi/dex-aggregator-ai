/**
 * track_swap_order
 * Post-execution tracking with MEV detection
 */

import { getClient, getChainId } from '../lib/onchainos-client';
import { MEVProtectionRouter } from '../engine/mev-protection-router';
import type { TrackParams, TrackResult } from '../types';

export async function trackSwapOrder(params: TrackParams): Promise<TrackResult> {
  const { txHash, chain } = params;

  try {
    const client = getClient();
    const chainId = getChainId(chain);
    const status = await client.getTxStatus({ chainId, txHash });

    if (!status) {
      return { status: 'PENDING', confirmations: 0, mevAttacked: false };
    }

    if (status.status === 'FAILED') {
      return {
        status: 'FAILED',
        confirmations: 0,
        mevAttacked: false,
        error: (status as any).error || 'Transaction failed',
      };
    }

    if (status.status === 'PENDING') {
      return {
        status: 'PENDING',
        confirmations: (status as any).confirmations || 0,
        mevAttacked: false,
      };
    }

    const mevAttacked = await MEVProtectionRouter.detectMEVAttack(txHash, chain);

    return {
      status: 'CONFIRMED',
      confirmations: (status as any).confirmations || 1,
      blockNumber: (status as any).blockNumber as number,
      effectiveOutput: (status as any).toTokenAmount as string,
      refundAmount: (status as any).positiveSlippageRefund as string,
      mevAttacked,
      settlementTime: (status as any).confirmTime as string,
    };
  } catch (error) {
    return {
      status: 'PENDING',
      confirmations: 0,
      mevAttacked: false,
      error: `Tracking error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}
