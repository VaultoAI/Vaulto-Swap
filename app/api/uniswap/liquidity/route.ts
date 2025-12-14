import { NextRequest, NextResponse } from 'next/server';
import { searchTokens } from '@/lib/uniswap/tokenSearch';
import { getPoolsForToken } from '@/lib/uniswap/pools';
import { isChainSupported } from '@/lib/uniswap/subgraphs';
import type { LiquidityApiResponse, LiquidityTokenResult, LiquidityPoolResult } from '@/app/components/search/types';

/**
 * POST /api/uniswap/liquidity
 * 
 * Searches for tokens with TVL and pool data from Uniswap v3 subgraphs.
 * 
 * Request body:
 * {
 *   chainId: number,
 *   query: string
 * }
 * 
 * Response:
 * {
 *   chainId: number,
 *   tokens: LiquidityTokenResult[],
 *   error?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chainId, query } = body;

    // Validate request body
    if (typeof chainId !== 'number' || isNaN(chainId)) {
      return NextResponse.json<LiquidityApiResponse>(
        {
          chainId: 0,
          tokens: [],
          error: 'Invalid chainId. Must be a number.',
        },
        { status: 400 }
      );
    }

    if (typeof query !== 'string' || !query.trim()) {
      return NextResponse.json<LiquidityApiResponse>(
        {
          chainId,
          tokens: [],
          error: 'Invalid query. Must be a non-empty string.',
        },
        { status: 400 }
      );
    }

    // Check if chain is supported
    if (!isChainSupported(chainId)) {
      return NextResponse.json<LiquidityApiResponse>(
        {
          chainId,
          tokens: [],
          error: `Chain ${chainId} is not supported or does not have a Uniswap v3 subgraph.`,
        },
        { status: 400 }
      );
    }

    // Search for tokens
    const tokenSearchResult = await searchTokens(chainId, query.trim(), 10);

    if (!tokenSearchResult.tokens || tokenSearchResult.tokens.length === 0) {
      return NextResponse.json<LiquidityApiResponse>({
        chainId,
        tokens: [],
      });
    }

    // Sort tokens by TVL descending and take top 10
    const sortedTokens = [...tokenSearchResult.tokens].sort(
      (a, b) => b.tvlUSD - a.tvlUSD
    );
    const topTokens = sortedTokens.slice(0, 10);

    // Fetch pools for each token in parallel
    const tokensWithPools: LiquidityTokenResult[] = await Promise.all(
      topTokens.map(async (token) => {
        try {
          const poolsResult = await getPoolsForToken(chainId, token.address, 10);

          // Transform pools to match API response format
          const pools: LiquidityPoolResult[] = poolsResult.pools.map((pool) => ({
            poolAddress: pool.poolAddress,
            feeTierBps: pool.feeTierBps,
            tvlUSD: pool.tvlUSD,
            volumeUSD: pool.volumeUSD,
            token0: {
              address: pool.token0.address,
              symbol: pool.token0.symbol,
              name: pool.token0.name,
              decimals: pool.token0.decimals,
            },
            token1: {
              address: pool.token1.address,
              symbol: pool.token1.symbol,
              name: pool.token1.name,
              decimals: pool.token1.decimals,
            },
          }));

          return {
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            tvlUSD: token.tvlUSD,
            volumeUSD: token.volumeUSD,
            pools,
          };
        } catch (error) {
          // If pool fetch fails, return token without pools
          console.error(`Error fetching pools for token ${token.address}:`, error);
          return {
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            tvlUSD: token.tvlUSD,
            volumeUSD: token.volumeUSD,
            pools: [], // Empty pools array on error
          };
        }
      })
    );

    return NextResponse.json<LiquidityApiResponse>({
      chainId,
      tokens: tokensWithPools,
    });
  } catch (error) {
    console.error('Error in /api/uniswap/liquidity:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json<LiquidityApiResponse>(
      {
        chainId: 0,
        tokens: [],
        error: `Failed to fetch liquidity data: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}

















