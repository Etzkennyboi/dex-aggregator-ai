/**
 * onchainOS SDK Client
 * Uses direct REST API calls with HMAC-SHA256 signing.
 *
 * Fixed:
 *   #1  - Added signTransaction() for TEE-backed tx signing via onchainOS gateway.
 *   #11 - X Layer (196) USDC address corrected to real deployed contract.
 *   #16 - All fetch() calls have a 15s AbortController timeout.
 */

import CryptoJS from 'crypto-js';

const OKX_BASE_URL = 'https://www.okx.com';
const REQUEST_TIMEOUT = 15_000; // ms — Fix #16

export const CHAIN_IDS: Record<string, string> = {
  ethereum: '1',
  arbitrum: '42161',
  base: '8453',
  bsc: '56',
  polygon: '137',
  optimism: '10',
  avalanche: '43114',
  solana: '501',
  xlayer: '196',
};

export const NATIVE_ADDRESSES: Record<string, string> = {
  ethereum: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  arbitrum: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  base: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  bsc: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  polygon: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  optimism: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  avalanche: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  solana: '11111111111111111111111111111111',
  xlayer: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
};

export function getChainId(chain: string): string {
  return CHAIN_IDS[chain.toLowerCase()] || '1';
}

interface OKXCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  projectId: string;
}

class OKXAPIClient {
  private credentials: OKXCredentials;

  constructor(credentials: OKXCredentials) {
    this.credentials = credentials;
  }

  private getHeaders(
    method: string,
    requestPath: string,
    queryString = '',
    body = ''
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const stringToSign = timestamp + method + requestPath + queryString + body;
    return {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': this.credentials.apiKey,
      'OK-ACCESS-SIGN': CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(stringToSign, this.credentials.secretKey)
      ),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.credentials.passphrase,
      'OK-ACCESS-PROJECT': this.credentials.projectId,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string>,
    body?: Record<string, unknown>
  ): Promise<T> {
    const queryString = params ? '?' + new URLSearchParams(params).toString() : '';
    const bodyString = body ? JSON.stringify(body) : '';
    const headers = this.getHeaders(method, path, queryString, bodyString);

    // Fix #16: timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const fetchOptions: RequestInit = { method, headers, signal: controller.signal };
    if (bodyString && method === 'POST') fetchOptions.body = bodyString;

    let response: Response;
    try {
      response = await fetch(`${OKX_BASE_URL}${path}${queryString}`, fetchOptions);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        throw new Error(`OKX API timeout after ${REQUEST_TIMEOUT}ms: ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OKX API ${response.status}: ${error}`);
    }

    const data = (await response.json()) as unknown;
    if (typeof data !== 'object' || data === null) {
      throw new Error('OKX API returned invalid response');
    }
    const typedData = data as Record<string, unknown>;
    if (typedData.code !== '0') {
      throw new Error(`OKX API error: ${typedData.msg} (code: ${typedData.code})`);
    }

    return typedData.data as T;
  }

  // ── DEX Aggregator ──────────────────────────────────────────────────────

  async getQuotes(params: {
    chainId: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
    slippage: string;
  }): Promise<unknown[]> {
    return this.request('GET', '/api/v5/dex/aggregator/quote', params);
  }

  async getSwapData(params: {
    chainId: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
    slippage: string;
    userWalletAddress: string;
  }): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v5/dex/aggregator/swap', params);
  }

  async getTokens(chainId: string): Promise<unknown[]> {
    return this.request('GET', '/api/v5/dex/aggregator/supported-tokens', { chainId });
  }

  async getLiquiditySources(chainId: string): Promise<unknown[]> {
    return this.request('GET', '/api/v5/dex/aggregator/liquidity-sources', { chainId });
  }

  // ── Onchain Gateway ─────────────────────────────────────────────────────

  async estimateGas(params: {
    chainId: string;
    txData: string;
    fromAddress?: string;
  }): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v5/onchain/gas-estimate', undefined, params);
  }

  async simulateTx(params: {
    chainId: string;
    txData: string;
    fromAddress: string;
    value?: string;
  }): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v5/onchain/simulate', undefined, params);
  }

  /**
   * Fix #1: TEE-backed transaction signing.
   * onchainOS `callContractSign` endpoint returns { signedTx: string }.
   */
  async signTransaction(params: {
    chainId: string;
    from: string;
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  }): Promise<{ signedTx: string }> {
    return this.request('POST', '/api/v5/onchain/sign-transaction', undefined, params);
  }

  async broadcastTx(params: { chainId: string; signedTx: string }): Promise<{ txHash: string }> {
    return this.request('POST', '/api/v5/onchain/broadcast', undefined, params);
  }

  async getTxStatus(params: { chainId: string; txHash: string }): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v5/onchain/tx-status', params);
  }

  // ── Token ────────────────────────────────────────────────────────────────

  /**
   * Fix #12: use a meaningful amount for price lookup.
   * We request USDC output for 1 full native unit of the token (1e18 base units
   * for 18-decimal; caller should pass pre-scaled amount for non-18-decimal tokens).
   */
  async getTokenPrice(chainId: string, tokenAddress: string): Promise<string> {
    // Fix #11: use per-chain USDC address for the price lookup denominator
    const USDC_BY_CHAIN: Record<string, string> = {
      '1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      '8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '56': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      '137': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      '10': '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      '43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      '196': '0x74b7F16337b8972027F6196A17a631aC6dE26d22', // Fix #11: real X Layer USDC
    };
    const quoteToken = USDC_BY_CHAIN[chainId] || USDC_BY_CHAIN['1'];

    const data = await this.request<Record<string, unknown>[]>(
      'GET',
      '/api/v5/dex/aggregator/quote',
      {
        chainId,
        fromTokenAddress: tokenAddress,
        toTokenAddress: quoteToken,
        amount: '1000000000000000000', // 1e18 — caller normalises for non-18 tokens
        slippage: '1',
      }
    );
    const amount =
      data[0] && typeof data[0] === 'object' && 'toTokenAmount' in data[0]
        ? String(data[0].toTokenAmount)
        : '0';
    return amount;
  }

  async getTokenMetadata(chainId: string, tokenAddress: string): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v5/dex/token/metadata', { chainId, tokenAddress });
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

let client: OKXAPIClient | null = null;

export function initClient(credentials: OKXCredentials): void {
  client = new OKXAPIClient(credentials);
}

export function getClient(): OKXAPIClient {
  if (!client) {
    const apiKey = process.env.OKX_API_KEY || '';
    const secretKey = process.env.OKX_SECRET_KEY || '';
    const passphrase = process.env.OKX_PASSPHRASE || '';
    const projectId = process.env.OKX_PROJECT_ID || '';

    if (!apiKey || !secretKey) {
      throw new Error('OKX API credentials not configured. Call initClient() or set env vars.');
    }

    client = new OKXAPIClient({ apiKey, secretKey, passphrase, projectId });
  }
  return client;
}
