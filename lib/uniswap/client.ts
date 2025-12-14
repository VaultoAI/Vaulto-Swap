/**
 * GraphQL Client for Uniswap v3 Subgraphs
 * 
 * Provides a generic function to query Uniswap v3 subgraphs via The Graph Network.
 */

import { getUniswapV3SubgraphEndpoint } from './subgraphs';

/**
 * GraphQL response structure from The Graph Network
 */
interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
  }>;
}

/**
 * Query a Uniswap v3 subgraph with a GraphQL query and variables.
 * 
 * @param chainId - The chain ID to query
 * @param query - The GraphQL query string
 * @param variables - Optional variables for the query
 * @returns The data from the GraphQL response
 * @throws Error if the query fails or returns errors
 */
export async function queryUniswapV3Subgraph<T = any>(
  chainId: number,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const endpoint = getUniswapV3SubgraphEndpoint(chainId);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: variables || {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: GraphQLResponse<T> = await response.json();

    // Check for GraphQL errors
    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map((e) => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    if (!result.data) {
      throw new Error('GraphQL response contains no data');
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after 10 seconds for chain ${chainId}`);
      }
      throw new Error(`Failed to query subgraph for chain ${chainId}: ${error.message}`);
    }
    throw new Error(`Failed to query subgraph for chain ${chainId}: Unknown error`);
  }
}

















