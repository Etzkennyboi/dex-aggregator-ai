/**
 * route-store.ts
 * Centralised, TTL-aware route store.
 *
 * Fix #2:
 *   - Extracted from get-optimal-swap-quote.ts so execute-swap and simulate-swap
 *     share a single source of truth.
 *   - Periodic sweeper clears expired entries proactively (not just on read),
 *     preventing unbounded memory growth in long-running agents.
 *   - Route IDs use crypto.randomUUID() — globally unique across restarts and
 *     multiple instances, replacing the old module-level integer counter.
 */

import { randomUUID } from 'crypto';
import type { SwapRoute } from '../types';

export interface RouteMetadata {
  fromToken: string;
  toToken: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  rawAmount: string;
  chain: string;
  chainId: string;
  expiresAt: number;
}

const routeStore = new Map<string, SwapRoute>();
const metaStore = new Map<string, RouteMetadata>();

// Sweep expired entries every 2 minutes (Fix #2 — proactive cleanup)
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweeper(): void {
  if (sweepTimer !== null) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, meta] of metaStore) {
      if (now > meta.expiresAt) {
        routeStore.delete(id);
        metaStore.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  // Don't block process exit
  if (sweepTimer.unref) sweepTimer.unref();
}

startSweeper();

export function generateRouteId(): string {
  return randomUUID();
}

export function storeRoute(route: SwapRoute, meta: RouteMetadata): void {
  routeStore.set(route.routeId, route);
  metaStore.set(route.routeId, meta);
}

export function getRoute(routeId: string): SwapRoute | undefined {
  const meta = metaStore.get(routeId);
  if (meta && Date.now() > meta.expiresAt) {
    routeStore.delete(routeId);
    metaStore.delete(routeId);
    return undefined;
  }
  return routeStore.get(routeId);
}

export function getRouteMeta(routeId: string): RouteMetadata | undefined {
  const meta = metaStore.get(routeId);
  if (meta && Date.now() > meta.expiresAt) {
    metaStore.delete(routeId);
    routeStore.delete(routeId);
    return undefined;
  }
  return meta;
}

export function deleteRoute(routeId: string): void {
  routeStore.delete(routeId);
  metaStore.delete(routeId);
}
