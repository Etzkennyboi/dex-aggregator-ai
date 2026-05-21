/**
 * Tests for route-store (Fix #2)
 */
import { generateRouteId, storeRoute, getRoute, getRouteMeta, deleteRoute } from '../src/skills/dex-aggregator-ai/lib/route-store';
import type { SwapRoute } from '../src/skills/dex-aggregator-ai/types';

function makeRoute(id: string): SwapRoute {
  return {
    provider: 'Test', routeId: id, fromToken: 'ETH', outputAmount: '1000',
    outputToken: 'USDC', priceImpact: 0.1, gasEstimate: '150000',
    gasCostUSD: '2', netOutputUSD: '998', routeType: 'SINGLE',
    estimatedTime: '30', mevProtected: false,
  };
}

describe('route-store', () => {
  it('generateRouteId returns unique UUIDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRouteId()));
    expect(ids.size).toBe(100);
  });

  it('generateRouteId matches UUID v4 format', () => {
    const id = generateRouteId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('stores and retrieves a route', () => {
    const id    = generateRouteId();
    const route = makeRoute(id);
    storeRoute(route, {
      fromToken: 'ETH', toToken: 'USDC', fromTokenAddress: '0xEEE',
      toTokenAddress: '0xA0b', amount: '1', rawAmount: '1000000000000000000',
      chain: 'ethereum', chainId: '1', expiresAt: Date.now() + 60_000,
    });
    expect(getRoute(id)).toEqual(route);
  });

  it('returns undefined for expired routes', () => {
    const id    = generateRouteId();
    const route = makeRoute(id);
    storeRoute(route, {
      fromToken: 'ETH', toToken: 'USDC', fromTokenAddress: '0xEEE',
      toTokenAddress: '0xA0b', amount: '1', rawAmount: '1000000000000000000',
      chain: 'ethereum', chainId: '1', expiresAt: Date.now() - 1, // already expired
    });
    expect(getRoute(id)).toBeUndefined();
    expect(getRouteMeta(id)).toBeUndefined();
  });

  it('deleteRoute removes both route and meta', () => {
    const id    = generateRouteId();
    const route = makeRoute(id);
    storeRoute(route, {
      fromToken: 'ETH', toToken: 'USDC', fromTokenAddress: '0xEEE',
      toTokenAddress: '0xA0b', amount: '1', rawAmount: '1000000000000000000',
      chain: 'ethereum', chainId: '1', expiresAt: Date.now() + 60_000,
    });
    deleteRoute(id);
    expect(getRoute(id)).toBeUndefined();
    expect(getRouteMeta(id)).toBeUndefined();
  });
});
