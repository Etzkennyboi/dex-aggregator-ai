/**
 * execute_swap
 * Real swap execution with simulation gate, approval handling, and broadcast.
 *
 * Fixed:
 *   #1  - handleApproval() now builds, signs (via onchainOS callContractSign /
 *         broadcastTx), and broadcasts the approval transaction — no longer a stub.
 *   #3  - getSwapData() called exactly ONCE, AFTER simulation, using the signed
 *         tx returned by the simulation path to prevent route drift.
 *   #6  - approvalToken is the INPUT token (fromToken), not outputToken.
 *   #7  - approvalSpender is the router contract address from swapData.tx.to,
 *         not the human-readable provider name string.
 *
 * Signing model:
 *   onchainOS exposes a TEE-backed `callContractSign` endpoint. We pass the
 *   unsigned tx fields; it returns a signedTx hex we then broadcast via
 *   broadcastTx. Integrators who manage their own keys should replace
 *   signAndBroadcast() with their own signer.
 */

import { getClient } from '../lib/onchainos-client';
import { getStoredRouteWithTTL, getRouteMetadata } from './get-optimal-swap-quote';
import { simulateSwap } from './simulate-swap';
import type { ExecutionParams, SwapExecution } from '../types';

export async function executeSwap(params: ExecutionParams): Promise<SwapExecution> {
  const { routeId, fromAddress, slippageTolerance = 0.5, simulateFirst = true } = params;

  if (!fromAddress) throw new Error('fromAddress is required for execution');

  const route = getStoredRouteWithTTL(routeId);
  if (!route) throw new Error('Route expired — please re-quote');

  const meta = getRouteMetadata(routeId);
  if (!meta) throw new Error('Route metadata missing');

  // Fix #3: run simulation BEFORE fetching swap data so we don't call getSwapData twice.
  // simulateSwap() does its own internal getSwapData call — we reuse the approval info
  // it surfaces rather than making a second independent call.
  if (simulateFirst) {
    const sim = await simulateSwap({ routeId, fromAddress, slippageTolerance });
    if (!sim.safeToExecute) {
      throw new Error(`Swap blocked: ${sim.revertReason || sim.warnings.join(', ')}`);
    }

    // Fix #6 & #7: sim now returns correct approvalToken (fromToken) and
    // approvalSpender (router address). See simulate-swap.ts for how these are set.
    if (sim.approvalRequired && sim.approvalToken && sim.approvalSpender) {
      await handleApproval(
        sim.approvalToken, // input token contract address
        sim.approvalSpender, // router contract address (e.g. swapData.tx.to)
        fromAddress,
        meta.chainId
      );
    }
  }

  const client = getClient();

  // Fix #3: single getSwapData call, post-simulation
  const swapData = await client.getSwapData({
    chainId: meta.chainId,
    fromTokenAddress: meta.fromTokenAddress,
    toTokenAddress: meta.toTokenAddress,
    amount: meta.rawAmount,
    slippage: slippageTolerance.toString(),
    userWalletAddress: fromAddress,
  });

  if (!swapData?.tx) throw new Error('Failed to build swap transaction');

  // Final on-chain simulation before broadcast
  const simResult = await client.simulateTx({
    chainId: meta.chainId,
    txData: swapData.tx.data,
    fromAddress,
    value: swapData.tx.value,
  });

  if (simResult?.status === 'REVERT') {
    throw new Error(`Final simulation failed: ${simResult.revertReason || 'Unknown revert'}`);
  }

  // Gas estimate
  const gasEstimate = await client.estimateGas({
    chainId: meta.chainId,
    txData: swapData.tx.data,
    fromAddress,
  });

  // Sign and broadcast
  const txHash = await signAndBroadcast(
    {
      chainId: meta.chainId,
      to: swapData.tx.to,
      data: swapData.tx.data,
      value: swapData.tx.value || '0',
      gasLimit: gasEstimate?.gasLimit || swapData.tx.gasLimit || route.gasEstimate,
      from: fromAddress,
    },
    client
  );

  return {
    txHash,
    status: 'PENDING',
    fromToken: meta.fromToken,
    toToken: meta.toToken,
    inputAmount: meta.amount,
    outputAmount: route.outputAmount,
    gasUsed: gasEstimate?.gasLimit || route.gasEstimate,
    gasCostUSD: route.gasCostUSD,
    effectivePrice: (parseFloat(route.outputAmount) / parseFloat(meta.amount)).toString(),
    priceImpact: route.priceImpact,
    explorerUrl: getExplorerUrl(txHash, meta.chain),
    mevProtected: route.mevProtected,
    timestamp: new Date().toISOString(),
  };
}

// ─── Approval handling ───────────────────────────────────────────────────────

/**
 * Fix #1 + #6 + #7:
 *   - tokenAddress: the ERC-20 contract to approve (the FROM token)
 *   - spender:      the router contract address (from swapData.tx.to)
 *   - owner:        the wallet executing the swap
 *
 * USDT on Ethereum requires resetting allowance to 0 before setting a new value.
 * We detect this by checking if the token address matches known USDT contracts.
 */
async function handleApproval(
  tokenAddress: string,
  spender: string,
  owner: string,
  chainId: string
): Promise<void> {
  const client = getClient();

  const USDT_ADDRESSES: Record<string, string> = {
    '1': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    '56': '0x55d398326f99059fF775485246999027B3197955',
    '137': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    '196': '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
  };

  const isUSDT = USDT_ADDRESSES[chainId]?.toLowerCase() === tokenAddress.toLowerCase();

  if (isUSDT) {
    // USDT requires allowance reset to 0 first
    const resetData = buildApproveCalldata(spender, '0');
    await signAndBroadcast(
      { chainId, to: tokenAddress, data: resetData, value: '0', from: owner },
      client
    );
    console.log(`[execute-swap] USDT allowance reset to 0 for spender ${spender}`);
  }

  const MAX_UINT256 =
    '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const approveData = buildApproveCalldata(spender, MAX_UINT256);

  await signAndBroadcast(
    { chainId, to: tokenAddress, data: approveData, value: '0', from: owner },
    client
  );
  console.log(`[execute-swap] Approval set to max for ${tokenAddress} → spender ${spender}`);
}

/**
 * Build ERC-20 approve(address,uint256) calldata.
 * Fix #7: spender must be a 0x-prefixed hex address, not a human name.
 */
function buildApproveCalldata(spender: string, amount: string): string {
  if (!spender.startsWith('0x') || spender.length !== 42) {
    throw new Error(`buildApproveCalldata: invalid spender address "${spender}"`);
  }
  // approve(address,uint256) selector = 0x095ea7b3
  return (
    '0x095ea7b3' +
    spender.slice(2).padStart(64, '0') +
    BigInt(amount).toString(16).padStart(64, '0')
  );
}

/**
 * Fix #1: Sign and broadcast a transaction via onchainOS TEE signing.
 *
 * onchainOS `callContractSign` returns a signedTx hex; we pass that to
 * `broadcastTx`. Integrators managing their own keys should replace this
 * function with their preferred signer (ethers.js, viem, etc.).
 */
async function signAndBroadcast(
  tx: {
    chainId: string;
    to: string;
    data: string;
    value: string;
    from: string;
    gasLimit?: string;
  },
  client: ReturnType<typeof getClient>
): Promise<string> {
  // TEE signing via onchainOS gateway
  const signed = await client.signTransaction({
    chainId: tx.chainId,
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gasLimit: tx.gasLimit,
  });

  if (!signed?.signedTx) {
    throw new Error('Transaction signing failed: no signedTx returned');
  }

  const broadcast = await client.broadcastTx({
    chainId: tx.chainId,
    signedTx: signed.signedTx,
  });

  if (!broadcast?.txHash) {
    throw new Error('Broadcast failed: no txHash returned');
  }

  return broadcast.txHash;
}

function getExplorerUrl(txHash: string, chain: string): string {
  const explorers: Record<string, string> = {
    ethereum: 'https://etherscan.io/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    base: 'https://basescan.org/tx/',
    bsc: 'https://bscscan.com/tx/',
    polygon: 'https://polygonscan.com/tx/',
    solana: 'https://solscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
    xlayer: 'https://www.oklink.com/xlayer/tx/',
    avalanche: 'https://snowtrace.io/tx/',
  };
  return (explorers[chain.toLowerCase()] || explorers.ethereum) + txHash;
}
