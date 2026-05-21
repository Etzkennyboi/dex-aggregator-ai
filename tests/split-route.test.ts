import { SplitRouteCalculator } from '../src/skills/dex-aggregator-ai/engine/split-route-calculator';
import type { SwapRoute } from '../src/skills/dex-aggregator-ai/types';

const routeA: SwapRoute = {
  provider: 'Uniswap', routeId: 'r1', fromToken: 'ETH',
  outputAmount: '900', outputToken: 'USDC', priceImpact: 0.4,
  gasEstimate: '120000', gasCostUSD: '0.5', netOutputUSD: '895.9',
  routeType: 'SINGLE', estimatedTime: '30', mevProtected: false,
};
const routeB: SwapRoute = {
  provider: 'PancakeSwap', routeId: 'r2', fromToken: 'ETH',
  outputAmount: '900', outputToken: 'USDC', priceImpact: 0.4,
  gasEstimate: '100000', gasCostUSD: '0.75', netOutputUSD: '895.65',
  routeType: 'SINGLE', estimatedTime: '25', mevProtected: false,
};

describe('SplitRouteCalculator', () => {
  it('calculates optimal split', () => {
    const result = SplitRouteCalculator.calculateOptimalSplit(routeA, routeB, '10', '10');
    expect(result).not.toBeNull();
    expect(result!.splits.length).toBe(2);
    expect(result!.splits[0].percentage + result!.splits[1].percentage).toBe(100);
  });

  it('returns null when split not beneficial', () => {
    const weakRoute = {
      ...routeB,
      outputAmount: '100',
      priceImpact: 20,
      gasCostUSD: '1',
      netOutputUSD: '79',
    };
    const result = SplitRouteCalculator.calculateOptimalSplit(routeA, weakRoute, '10', '10');
    expect(result).toBeNull();
  });

  it('split percentages are within 20–80 bounds', () => {
    const result = SplitRouteCalculator.calculateOptimalSplit(routeA, routeB, '10', '10');
    if (result) {
      result.splits.forEach((s) => {
        expect(s.percentage).toBeGreaterThanOrEqual(20);
        expect(s.percentage).toBeLessThanOrEqual(80);
      });
    }
  });
});
