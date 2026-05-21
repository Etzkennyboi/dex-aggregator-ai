---
name: dex-aggregator-ai
display_name: DEX Aggregator AI
description: AI-powered DEX aggregator that finds optimal swap routes across 500+ liquidity sources via onchainOS. Features split-route optimization, MEV protection, slippage defense, and gas-aware execution. Delivers best net-output swaps with pre-flight simulation.
version: 1.1.0
author: "YourHandleHere"
tags:
  - dex
  - aggregator
  - swap
  - routing
  - mev-protection
  - slippage
  - cross-chain
  - onchainos
when_to_use:
  - "best swap rate for [token] to [token]"
  - "where should I swap [token]"
  - "compare dex prices for [amount] [token] to [token]"
  - "lowest slippage swap [token]"
  - "split route swap [amount] [token]"
  - "dex aggregator [token]"
  - "swap optimization [token]"
  - "get quote across dexes [token]"
  - "best price for [token]"
  - "route my swap [amount] [token] to [token]"
  - "find cheapest way to buy [token]"
  - "MEV protected swap [token]"
  - "simulate swap before executing [token]"
  - "compare uniswap vs pancakeswap for [token]"
do_not_trigger:
  - "user asks about CEX trading"
  - "user wants off-chain wallet advice"
  - "question about fiat deposits"
  - "queries about centralized exchange fees"
chains:
  - ethereum
  - solana
  - arbitrum
  - base
  - bsc
  - polygon
  - avalanche
  - optimism
  - xlayer
---

# DEX Aggregator AI

## What This Does

Intelligent routing engine that quotes across 500+ DEX liquidity sources via onchainOS,
compares net output (price - gas - slippage), recommends split routes, simulates
before execution, and protects against MEV via private mempool routing.

## Why This Is Different

- `okx-dex-swap` is basic swap endpoint. This adds intelligence layer.
- Existing swap plugins are single-DEX. This is multi-DEX aggregator.
- No plugin does split-route optimization or MEV protection.
- No plugin does pre-flight simulation as user-facing feature.

## Tools

### `get_optimal_swap_quote`

Get best swap route with full cost breakdown.

**Parameters:**
```json
{
  "fromToken": "string (symbol or address)",
  "toToken": "string (symbol or address)",
  "amount": "string (human-readable)",
  "chain": "string (default: ethereum)",
  "slippageTolerance": "number (default: 0.5, max: 5.0)",
  "preferMEVProtection": "boolean (default: true)",
  "allowSplitRoute": "boolean (default: true)",
  "deadlineMinutes": "number (default: 10)"
}
```

**Returns:** recommendedRoute, alternativeRoutes, splitRoute, mevProtected, expiresAt

### `simulate_swap`

Pre-flight simulation: reverts, token tax, approval, honeypot, min-output check.

**Parameters:** `{"routeId": "string", "fromAddress": "string", "slippageTolerance": "number"}`

**Returns:** simulationStatus, safeToExecute, approvalRequired, approvalToken (input token address), approvalSpender (router contract address), warnings

### `execute_swap`

Execute swap with simulation gate, ERC-20 approval, TEE signing, and broadcast.

**Parameters:** `{"routeId": "string", "fromAddress": "string", "simulateFirst": "boolean"}`

**Returns:** txHash, status, gasUsed, explorerUrl, mevProtected

> **Signing model:** Uses onchainOS `sign-transaction` (TEE-backed). To use your own
> key management, replace `signAndBroadcast()` in `execute-swap.ts` with your signer.

### `compare_dex_quotes`

Side-by-side comparison (read-only).

**Parameters:** `{"fromToken": "string", "toToken": "string", "amount": "string", "chain": "string"}`

**Returns:** quotes[], bestBy {netOutput, lowestGas, fastest, lowestSlippage}

### `track_swap_order`

Track swap from broadcast to settlement.

**Parameters:** `{"txHash": "string", "chain": "string"}`

**Returns:** status, confirmations, mevAttacked, effectiveOutput, settlementTime

## Triggers

- "best swap rate for [token] to [token]"
- "where should I swap [token]"
- "compare dex prices for [amount] [token] to [token]"
- "lowest slippage swap [token]"
- "split route swap [amount] [token]"
- "dex aggregator [token]"
- "swap optimization [token]"
- "get quote across dexes [token]"
- "best price for [token]"
- "route my swap [amount] [token] to [token]"
- "find cheapest way to buy [token]"
- "MEV protected swap [token]"
- "simulate swap before executing [token]"
- "compare uniswap vs pancakeswap for [token]"

## Workflows

### Research -> Quote -> Simulate -> Execute

```
User: "Best rate for 1 ETH to USDC"

1. get_optimal_swap_quote(ETH, USDC, "1")
2. compare_dex_quotes (optional transparency)
3. simulate_swap(routeId)
4. execute_swap(routeId, simulateFirst=true)
5. track_swap_order(txHash)
```

### Quick Swap

```
User: "Swap 500 USDC to SOL now, MEV protected"

1. get_optimal_swap_quote(USDC, SOL, "500", preferMEVProtection=true)
2. simulate_swap
3. execute_swap
```

## Error Handling

| Error | Handling |
|-------|----------|
| `INSUFFICIENT_LIQUIDITY` | Suggest smaller amount or different pair |
| `HIGH_SLIPPAGE` | Warn, suggest higher tolerance or smaller amount |
| `REVERT_ON_SIMULATION` | Show reason, suggest approval or different route |
| `HONEYPOT_DETECTED` | Block execution, warn user |
| `MEV_PROTECTION_UNAVAILABLE` | Fall back to standard routing |
| `ROUTE_EXPIRED` | Auto-refresh quote |
| `GAS_SPIKE` | Recalculate, may change recommendation |
| `MIN_OUTPUT_NOT_MET` | Block execution, suggest re-quote or higher slippage |

## Architecture

```
Quote Engine -> Split Calculator -> Net Optimizer -> MEV Router -> Simulator -> Executor -> Tracker
     ^              ^                  ^              ^           ^          ^          ^
  okx-dex-swap   (new)            (new)          (new)    okx-security  okx-onchain-gateway
```

## Dependencies

- `okx-dex-swap` — Quote and swap data
- `okx-dex-token` — Token metadata, decimals, prices
- `okx-onchain-gateway` — Gas oracle, simulation, sign-transaction, broadcast, tracking
- `okx-security` — Token risk scanning

## New in v1.1.0

| Fix | Description |
|-----|-------------|
| #1 | `execute_swap` now signs and broadcasts via `onchainOS sign-transaction`. Approvals are real on-chain transactions, not stubs. |
| #2 | Route store extracted to `lib/route-store.ts`. UUIDs replace integer counter. Periodic TTL sweeper prevents memory growth. |
| #3 | `getSwapData` called once per execution (post-simulation only). Eliminates route-drift race between simulate and execute calls. |
| #4 | Token decimal registry (`lib/token-decimals.ts`) replaces hardcoded 6/18 assumption. WBTC=8, SOL=9, BSC USDC=18, on-chain fallback for unknowns. |
| #5 | Honeypot detector documents heuristic scope. buyTax/sellTax estimated from round-trip quote spread instead of returning constant 0. |
| #6 | `approvalToken` corrected to `fromTokenAddress` (input token), not output token. |
| #7 | `approvalSpender` is now `swapData.tx.to` (router contract address). Added address format guard — throws on human-readable strings. |
| #8 | `warmCache()` awaited before `rankByNetOutput()`. Price cache always hot when ranking runs. |
| #9 | Min-output circuit breaker in simulation: blocks if simulated output < `expected * (1 - slippage%)`. |
| #10 | Gas price fetched live from OKX `gas-estimate` endpoint; static gwei map is fallback only. |
| #11 | X Layer USDC corrected to `0x74b7F16337b8972027F6196A17a631aC6dE26d22` in all files. |
| #12 | `getTokenPrice` probe uses 1e18 base units; caller responsible for decimal normalisation. |
| #16 | All `fetch()` calls have 15s `AbortController` timeout. No indefinite hangs. |

## Known Limitations (not yet fixed)

- **Honeypot detection** is heuristic-only (liquidity-based). Bytecode-level analysis
  (e.g. GoPlus Security API) is planned for v1.2.0.
- **Split routing** uses a simplified linear price-impact model. True AMM curve
  optimisation (Uniswap v3 tick math) is planned for v1.2.0.
- **Signing model** delegates to onchainOS TEE. External key management
  (hardware wallet, MPC) requires replacing `signAndBroadcast()` in `execute-swap.ts`.
