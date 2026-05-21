export type Chain =
  | 'ethereum'
  | 'solana'
  | 'arbitrum'
  | 'base'
  | 'bsc'
  | 'polygon'
  | 'avalanche'
  | 'optimism'
  | 'xlayer'
  | 'all';

export interface SwapQuoteParams {
  fromToken: string;
  toToken: string;
  amount: string;
  chain?: Chain;
  slippageTolerance?: number;
  preferMEVProtection?: boolean;
  allowSplitRoute?: boolean;
  deadlineMinutes?: number;
}

export interface RouteSplit {
  provider: string;
  percentage: number;
  outputAmount: string;
  gasEstimate: string;
}

export interface SwapRoute {
  provider: string;
  routeId: string;
  fromToken: string;
  outputAmount: string;
  outputToken: string;
  priceImpact: number;
  gasEstimate: string;
  gasCostUSD: string;
  netOutputUSD: string;
  routeType: 'SINGLE' | 'SPLIT' | 'BRIDGE';
  estimatedTime: string;
  mevProtected: boolean;
}

export interface SwapQuote {
  recommendedRoute: SwapRoute;
  alternativeRoutes: SwapRoute[];
  splitRoute: {
    enabled: boolean;
    splits: RouteSplit[];
    improvementVsSingle: string;
    netImprovementAfterGas: string;
  };
  mevProtected: boolean;
  simulationRecommended: boolean;
  expiresAt: string;
}

export interface SimulationParams {
  routeId: string;
  fromAddress?: string;
  slippageTolerance?: number;
}

export interface SimulationResult {
  simulationStatus: 'SUCCESS' | 'REVERT' | 'WARNING';
  revertReason?: string;
  tokenTaxDetected: boolean;
  honeypotRisk: boolean;
  approvalRequired: boolean;
  approvalToken?: string;
  approvalSpender?: string;
  estimatedGas: string;
  gasCostUSD: string;
  safeToExecute: boolean;
  warnings: string[];
}

export interface ExecutionParams {
  routeId: string;
  fromAddress?: string;
  slippageTolerance?: number;
  simulateFirst?: boolean;
}

export interface SwapExecution {
  txHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  fromToken: string;
  toToken: string;
  inputAmount: string;
  outputAmount: string;
  gasUsed: string;
  gasCostUSD: string;
  effectivePrice: string;
  priceImpact: number;
  blockNumber?: number;
  explorerUrl: string;
  mevProtected: boolean;
  timestamp: string;
}

export interface TrackParams {
  txHash: string;
  chain: Chain;
}

export interface TrackResult {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  confirmations: number;
  blockNumber?: number;
  effectiveOutput?: string;
  refundAmount?: string;
  mevAttacked: boolean;
  settlementTime?: string;
  error?: string;
}

export interface CompareParams {
  fromToken: string;
  toToken: string;
  amount: string;
  chain?: Chain;
}

export interface CompareResult {
  quotes: SwapRoute[];
  bestBy: {
    netOutput: string;
    lowestGas: string;
    fastest: string;
    lowestSlippage: string;
  };
}
