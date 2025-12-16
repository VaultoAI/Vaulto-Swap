/**
 * Type definitions for Uniswap liquidity search results
 */

/**
 * Pool information for a liquidity token
 */
export interface LiquidityPoolResult {
  poolAddress: string;
  feeTierBps: number; // Fee tier in basis points (e.g., 500 = 0.05%)
  tvlUSD: number;
  volumeUSD: number;
  token0: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
}

/**
 * Token information with TVL and pool data
 */
export interface LiquidityTokenResult {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  tvlUSD: number; // Token-level TVL
  volumeUSD: number; // Token-level volume
  pools: LiquidityPoolResult[];
}

/**
 * Solana token data response
 */
export interface SolanaTokenData {
  address: string;
  tvlUSD?: number;
  volumeUSD: number; // 24h volume
  marketCap?: number;
  marketCapFormatted?: string; // Formatted market cap from Jupiter (e.g., "$472B")
  priceChange24h?: number; // 24h price change percentage
}

/**
 * API response format for liquidity search
 */
export interface LiquidityApiResponse {
  chainId: number;
  tokens: LiquidityTokenResult[];
  error?: string;
}










