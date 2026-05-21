/**
 * Split Route Calculator
 * Binary-search optimized split routing across two DEXs
 */

import type { SwapRoute, RouteSplit } from '../types';

const MIN_SPLIT_IMPROVEMENT_BPS = 5;
const SPLIT_GAS_OVERHEAD_PCT = 40;

export class SplitRouteCalculator {
  static calculateOptimalSplit(
    routeA: SwapRoute,
    routeB: SwapRoute,
    totalInput: string,
    originalInputAmount: string
  ): { splits: RouteSplit[]; improvement: string; netImprovement: string } | null {
    const totalInputNum = parseFloat(totalInput);
    const originalAmount = parseFloat(originalInputAmount);

    if (originalAmount <= 0 || totalInputNum <= 0 || !isFinite(totalInputNum)) return null;

    let bestSplit = 50;
    let bestNetOutput = -Infinity;

    let low = 20,
      high = 80;
    while (high - low >= 3) {
      const third = Math.floor((high - low) / 3);
      const mid1 = low + third;
      const mid2 = high - third;

      if (mid1 >= mid2) break;

      const net1 = this.evaluateSplit(routeA, routeB, totalInputNum, originalAmount, mid1);
      const net2 = this.evaluateSplit(routeA, routeB, totalInputNum, originalAmount, mid2);

      if (net1 > net2) {
        high = mid2 - 1;
        if (net1 > bestNetOutput) {
          bestNetOutput = net1;
          bestSplit = mid1;
        }
      } else {
        low = mid1 + 1;
        if (net2 > bestNetOutput) {
          bestNetOutput = net2;
          bestSplit = mid2;
        }
      }
    }

    // Linear scan remaining range
    for (let pct = low; pct <= high; pct++) {
      const net = this.evaluateSplit(routeA, routeB, totalInputNum, originalAmount, pct);
      if (net > bestNetOutput) {
        bestNetOutput = net;
        bestSplit = pct;
      }
    }

    const singleRouteNet = Math.max(parseFloat(routeA.netOutputUSD), parseFloat(routeB.netOutputUSD));
    const improvementBps = ((bestNetOutput - singleRouteNet) / Math.max(singleRouteNet, 1)) * 10000;

    if (improvementBps < MIN_SPLIT_IMPROVEMENT_BPS) return null;

    const splitA = bestSplit;
    const splitB = 100 - bestSplit;

    const outputA = this.estimateOutput(routeA, (totalInputNum * splitA / 100).toString(), originalAmount);
    const outputB = this.estimateOutput(routeB, (totalInputNum * splitB / 100).toString(), originalAmount);

    return {
      splits: [
        {
          provider: routeA.provider,
          percentage: splitA,
          outputAmount: outputA.toFixed(6),
          gasEstimate: routeA.gasEstimate,
        },
        {
          provider: routeB.provider,
          percentage: splitB,
          outputAmount: outputB.toFixed(6),
          gasEstimate: routeB.gasEstimate,
        },
      ],
      improvement: `+${(improvementBps / 100).toFixed(2)}%`,
      netImprovement: `+$${(bestNetOutput - singleRouteNet).toFixed(2)}`,
    };
  }

  private static evaluateSplit(
    routeA: SwapRoute,
    routeB: SwapRoute,
    totalInput: number,
    originalAmount: number,
    pctA: number
  ): number {
    const inputA = (totalInput * pctA) / 100;
    const inputB = (totalInput * (100 - pctA)) / 100;

    const outputA = this.estimateOutputWithImpact(routeA, inputA.toString(), originalAmount);
    const outputB = this.estimateOutputWithImpact(routeB, inputB.toString(), originalAmount);

    const gasA = parseFloat(routeA.gasCostUSD) * (1 + SPLIT_GAS_OVERHEAD_PCT / 100);
    const gasB = parseFloat(routeB.gasCostUSD) * (1 + SPLIT_GAS_OVERHEAD_PCT / 100);

    return outputA + outputB - gasA - gasB;
  }

  private static estimateOutput(route: SwapRoute, inputAmount: string, originalAmount: number): number {
    const baseOutput = parseFloat(route.outputAmount);
    const ratio = parseFloat(inputAmount) / originalAmount;
    const effectiveImpact = route.priceImpact * ratio;
    return baseOutput * ratio * (1 - effectiveImpact / 100);
  }

  private static estimateOutputWithImpact(
    route: SwapRoute,
    inputAmount: string,
    originalAmount: number
  ): number {
    return this.estimateOutput(route, inputAmount, originalAmount);
  }
}
