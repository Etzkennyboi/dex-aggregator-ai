"use strict";
/**
 * DEX Aggregator AI Demo
 * Live execution with credential validation
 */
Object.defineProperty(exports, "__esModule", { value: true });
const dex_aggregator_ai_1 = require("../src/skills/dex-aggregator-ai");
function validateCredentials() {
    const required = ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE', 'OKX_PROJECT_ID'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        console.error('Missing required environment variables:');
        missing.forEach((key) => console.error(`   - ${key}`));
        console.error('\nSet them in your .env file or environment before running the demo.');
        console.error('Get credentials at: https://www.okx.com/web3/build/docs/waas/dex-get-started');
        return false;
    }
    return true;
}
async function runDemo() {
    if (!validateCredentials()) {
        process.exit(1);
    }
    (0, dex_aggregator_ai_1.initClient)({
        apiKey: process.env.OKX_API_KEY,
        secretKey: process.env.OKX_SECRET_KEY,
        passphrase: process.env.OKX_PASSPHRASE,
        projectId: process.env.OKX_PROJECT_ID,
    });
    console.log('============================================================');
    console.log('  DEX AGGREGATOR AI -- LIVE DEMO');
    console.log('============================================================\n');
    try {
        console.log('1. SWAP QUOTE: 1 WETH -> USDC on Arbitrum');
        console.log('------------------------------------------------------------');
        const quote = await (0, dex_aggregator_ai_1.getOptimalSwapQuote)({
            fromToken: 'WETH',
            toToken: 'USDC',
            amount: '1',
            chain: 'arbitrum',
            slippageTolerance: 0.5,
            preferMEVProtection: true,
            allowSplitRoute: true,
        });
        console.log(`Recommended: ${quote.recommendedRoute.provider}`);
        console.log(`Output: ${quote.recommendedRoute.outputAmount} USDC`);
        console.log(`Price Impact: ${quote.recommendedRoute.priceImpact}%`);
        console.log(`Gas: $${quote.recommendedRoute.gasCostUSD}`);
        console.log(`Net Output: $${quote.recommendedRoute.netOutputUSD}`);
        console.log(`MEV Protected: ${quote.mevProtected}`);
        if (quote.splitRoute.enabled) {
            console.log(`\nSplit route available:`);
            quote.splitRoute.splits.forEach((s) => {
                console.log(`  ${s.percentage}% via ${s.provider} -> ${s.outputAmount}`);
            });
            console.log(`Improvement: ${quote.splitRoute.improvementVsSingle}`);
        }
        console.log(`\nAlternatives:`);
        quote.alternativeRoutes.forEach((r) => {
            console.log(`  ${r.provider}: ${r.outputAmount} USDC (net: $${r.netOutputUSD})`);
        });
        console.log('\n\n2. FULL DEX COMPARISON: 10 ETH -> USDC');
        console.log('------------------------------------------------------------');
        const comparison = await (0, dex_aggregator_ai_1.compareDexQuotes)({
            fromToken: 'ETH',
            toToken: 'USDC',
            amount: '10',
            chain: 'arbitrum',
        });
        console.log('Provider          | Output      | Gas    | Net Output | Slippage');
        console.log('------------------+-------------+--------+------------+----------');
        comparison.quotes.forEach((q) => {
            const name = q.provider.padEnd(17);
            const out = q.outputAmount.padStart(11);
            const gas = `$${q.gasCostUSD}`.padStart(6);
            const net = `$${q.netOutputUSD}`.padStart(10);
            const slip = `${q.priceImpact}%`.padStart(8);
            console.log(`${name}| ${out} | ${gas} | ${net} | ${slip}`);
        });
        console.log(`\nBest by net output: ${comparison.bestBy.netOutput}`);
        console.log(`Best by lowest gas: ${comparison.bestBy.lowestGas}`);
        console.log('\n\n3. SIMULATION & EXECUTION');
        console.log('------------------------------------------------------------');
        const sim = await (0, dex_aggregator_ai_1.simulateSwap)({
            routeId: quote.recommendedRoute.routeId,
            slippageTolerance: 0.5,
        });
        console.log(`Simulation: ${sim.simulationStatus}`);
        console.log(`Safe to execute: ${sim.safeToExecute}`);
        console.log(`Approval needed: ${sim.approvalRequired}`);
        if (sim.warnings.length > 0) {
            console.log(`Warnings: ${sim.warnings.join(', ')}`);
        }
        if (sim.safeToExecute) {
            console.log('\nReady for execution. Run executeSwap() to broadcast.');
        }
    }
    catch (error) {
        console.error('\nDemo failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
    console.log('\n============================================================');
    console.log('  DEMO COMPLETE');
    console.log('============================================================');
}
runDemo().catch(console.error);
//# sourceMappingURL=demo.js.map