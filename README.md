# DEX Aggregator AI

A working OKX onchainOS skill package with a production-ready ebuild-style build and test workflow.

This repository contains a complete agentic wallet skill implementation for optimal DEX swap routing, including:
- onchainOS-powered quote aggregation across many sources
- gas-aware net output ranking and split-route optimization
- MEV protection and pre-flight safety simulation
- a small build and packaging workflow for submission

## What this repo contains

- `SKILL.md` — skill definition metadata, triggers, workflows, and example prompts
- `package.json` — scripts for install, build, test, and lint
- `tsconfig.json` — strict TypeScript build settings
- `.env.example` — credential template for OKX API keys
- `scripts/demo.ts` — demo runner for live skill validation
- `src/skills/dex-aggregator-ai/` — implementation files for the skill
- `tests/` — unit tests covering split routing, approvals, token decimals, and route storage

## Build & Package

This repo is structured like an ebuild-ready package with a clean build lifecycle.

```bash
npm install
npm run build
npm test -- --runInBand
```

## Usage

1. Copy credentials from `.env.example`:

```bash
cp .env.example .env
```

2. Set `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, and `OKX_PROJECT_ID` in `.env`.

3. Run the demo script:

```bash
npm run dev
```

## Core implementation

- `src/skills/dex-aggregator-ai/index.ts`
  - skill export surface and orchestration entrypoint
- `src/skills/dex-aggregator-ai/lib/onchainos-client.ts`
  - HMAC request signing and onchainOS API access
- `src/skills/dex-aggregator-ai/engine/split-route-calculator.ts`
  - split route optimization with practical net output modeling
- `src/skills/dex-aggregator-ai/engine/net-output-optimizer.ts`
  - rank routes by true post-cost output
- `src/skills/dex-aggregator-ai/engine/mev-protection-router.ts`
  - MEV-aware routing adjustments
- `src/skills/dex-aggregator-ai/engine/honeypot-detector.ts`
  - token safety screening and scam avoidance
- `src/skills/dex-aggregator-ai/tools/get-optimal-swap-quote.ts`
  - main quote engine, route enrichment, and split-route decisioning

## Testing

Run the unit test suite to verify build quality and behavior:

```bash
npm test -- --runInBand
```

## Git & Deployment

This repo is already configured for GitHub deployment and can be pushed directly to a remote.

## License

MIT
