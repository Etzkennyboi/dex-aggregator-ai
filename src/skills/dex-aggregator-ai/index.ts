/**
 * DEX Aggregator AI Skill — Public API surface
 */

export { getOptimalSwapQuote } from './tools/get-optimal-swap-quote';
export { simulateSwap }        from './tools/simulate-swap';
export { executeSwap }         from './tools/execute-swap';
export { compareDexQuotes }    from './tools/compare-dex-quotes';
export { trackSwapOrder }      from './tools/track-swap-order';

export { SplitRouteCalculator } from './engine/split-route-calculator';
export { NetOutputOptimizer }   from './engine/net-output-optimizer';
export { MEVProtectionRouter }  from './engine/mev-protection-router';
export { HoneypotDetector }     from './engine/honeypot-detector';

export { initClient, getClient } from './lib/onchainos-client';
export { toRawAmountForToken, getTokenDecimals, toRawAmount } from './lib/token-decimals';
export { generateRouteId, storeRoute, getRoute, getRouteMeta } from './lib/route-store';

export type { SwapQuote, SwapExecution, Chain } from './types';
export type { RouteMetadata } from './lib/route-store';
