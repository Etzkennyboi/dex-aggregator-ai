/**
 * simulate_swap
 * Pre-flight simulation with real onchainOS simulateTx + honeypot detection.
 *
 * Fixed:
 *   #6 - approvalToken is now the FROM token (what the router needs to spend),
 *        not the output token.
 *   #7 - approvalSpender is now swapData.tx.to (the actual router contract address),
 *        not route.provider (the human-readable DEX name).
 *   #9 - minOutput circuit breaker: if simulated output is below
 *        expectedOutput * (1 - slippage/100), execution is blocked.
 */

import { getClient } from '../lib/onchainos-client';
import { getStoredRouteWithTTL, getRouteMetadata } from './get-optimal-swap-quote';
import { HoneypotDetector } from '../engine/honeypot-detector';
import type { SimulationParams, SimulationResult } from '../types';

export async function simulateSwap(params: SimulationParams): Promise<SimulationResult> {
  const { routeId, fromAddress, slippageTolerance = 0.5 } = params;
  const warnings: string[] = [];

  const route = getStoredRouteWithTTL(routeId);
  if (!route) {
    return {
      simulationStatus: 'REVERT',
      revertReason:     'Route expired or not found — please re-quote',
      tokenTaxDetected: false,
      honeypotRisk:     false,
      approvalRequired: false,
      estimatedGas:     '0',
      gasCostUSD:       '0',
      safeToExecute:    false,
      warnings:         ['ROUTE_EXPIRED'],
    };
  }

  const meta    = getRouteMetadata(routeId);
  const chain   = meta?.chain   || 'ethereum';
  const chainId = meta?.chainId || '1';

  // Scan the OUTPUT token (what we're receiving) for honeypot risk
  const safetyReport = await HoneypotDetector.scanToken(route.outputToken, chain);

  if (safetyReport.isHoneypot) {
    return {
      simulationStatus: 'REVERT',
      revertReason:     'Honeypot token detected — swap blocked',
      tokenTaxDetected: safetyReport.buyTax > 0,
      honeypotRisk:     true,
      approvalRequired: false,
      estimatedGas:     '0',
      gasCostUSD:       '0',
      safeToExecute:    false,
      warnings:         ['HONEYPOT_DETECTED', ...safetyReport.warnings],
    };
  }

  if (safetyReport.buyTax > slippageTolerance) {
    warnings.push(
      `High buy tax: ${safetyReport.buyTax}% > slippage tolerance ${slippageTolerance}%`
    );
  }

  // Fetch swap data once — Fix #3 (called here, not again in executeSwap)
  interface SimResult {
    toTokenAmount?: string;
    gasEstimate?: string;
    status?: string;
    revertReason?: string;
  }
  let onchainSimResult: SimResult | null = null;
  let routerAddress: string | undefined;

  try {
    const client   = getClient();
    const swapData = await client.getSwapData({
      chainId,
      fromTokenAddress:  meta?.fromTokenAddress || '',
      toTokenAddress:    meta?.toTokenAddress   || '',
      amount:            meta?.rawAmount        || '0',
      slippage:          slippageTolerance.toString(),
      userWalletAddress: fromAddress || '',
    });

    if (swapData?.tx?.data) {
      // Fix #7: capture the actual router address for the caller
      routerAddress = swapData.tx.to;

      const simResult = await client.simulateTx({
        chainId,
        txData:      swapData.tx.data,
        fromAddress: fromAddress || '',
        value:       swapData.tx.value,
      });
      onchainSimResult = simResult as SimResult;

      // Fix #9: min-output circuit breaker
      if (onchainSimResult?.toTokenAmount && meta?.rawAmount) {
        const expectedOut   = parseFloat(route.outputAmount);
        const simulatedOut  = parseFloat(onchainSimResult.toTokenAmount);
        const minAcceptable = expectedOut * (1 - slippageTolerance / 100);
        if (simulatedOut < minAcceptable) {
          warnings.push(
            `Output below min threshold: simulated ${simulatedOut.toFixed(6)} < ` +
            `minimum acceptable ${minAcceptable.toFixed(6)} (${slippageTolerance}% slippage)`
          );
          onchainSimResult.status = 'REVERT';
          onchainSimResult.revertReason = 'MIN_OUTPUT_NOT_MET';
        }
      }
    }
  } catch (simError) {
    warnings.push(
      `Onchain simulation unavailable: ${simError instanceof Error ? simError.message : 'Unknown'}`
    );
  }

  const estimatedGas    = onchainSimResult?.gasEstimate || route.gasEstimate;
  const onchainReverted = onchainSimResult?.status === 'REVERT';

  if (onchainReverted) {
    warnings.push(
      `Onchain simulation reverted: ${onchainSimResult?.revertReason || 'Unknown'}`
    );
  }

  // Approvals: needed for all ERC-20 input tokens (not native ETH/BNB/etc.)
  const isNativeInput =
    (meta?.fromTokenAddress || '').toLowerCase() ===
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const approvalRequired = !isNativeInput;

  const safeToExecute =
    !safetyReport.isHoneypot &&
    safetyReport.riskScore < 50 &&
    safetyReport.canSell &&
    !onchainReverted;

  if (!safeToExecute && safetyReport.riskScore >= 50) {
    warnings.push('Token risk score elevated — proceed with caution');
  }

  return {
    simulationStatus: onchainReverted ? 'REVERT' : safeToExecute ? 'SUCCESS' : 'WARNING',
    revertReason:     onchainReverted ? onchainSimResult?.revertReason : undefined,
    tokenTaxDetected: safetyReport.buyTax > 0,
    honeypotRisk:     safetyReport.riskScore > 50,
    approvalRequired,
    // Fix #6: FROM token address (what the router needs allowance for)
    approvalToken:    approvalRequired ? (meta?.fromTokenAddress ?? route.fromToken) : undefined,
    // Fix #7: router contract address, not DEX name string
    approvalSpender:  approvalRequired ? routerAddress : undefined,
    estimatedGas,
    gasCostUSD:       route.gasCostUSD,
    safeToExecute,
    warnings,
  };
}
