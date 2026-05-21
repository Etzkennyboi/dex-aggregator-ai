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
        error: status.error || 'Transaction failed',
      };
    }

    if (status.status === 'PENDING') {
      return {
        status: 'PENDING',
        confirmations: status.confirmations || 0,
        mevAttacked: false,
      };
    }

    const mevAttacked = await MEVProtectionRouter.detectMEVAttack(txHash, chain);

    return {
      status: 'CONFIRMED',
      confirmations: status.confirmations || 1,
      blockNumber: status.blockNumber,
      effectiveOutput: status.toTokenAmount,
      refundAmount: status.positiveSlippageRefund,
      mevAttacked,
      settlementTime: status.confirmTime,
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
