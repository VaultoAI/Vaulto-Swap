/**
 * Uniswap v3 Subgraph Configuration
 * 
 * Maps chain IDs to Uniswap v3 subgraph IDs from The Graph Network.
 * Subgraph IDs are used to query liquidity, pools, and token data.
 */

// Chain IDs from wagmi - using number type to match wagmi Chain.id
export type VaultoChainId = 
  | 1      // Ethereum Mainnet
  | 10     // Optimism
  | 56     // BSC (Binance Smart Chain)
  | 137    // Polygon
  | 42161  // Arbitrum
  | 43114  // Avalanche
  | 8453   // Base
  | 42220  // Celo
  | 81457  // Blast
  | 11155111   // Sepolia (testnet - no subgraph)
  | 421614;    // Arbitrum Sepolia (testnet - no subgraph)

/**
 * Map of chain IDs to Uniswap v3 subgraph IDs from The Graph Network.
 * Subgraph IDs are used to construct the endpoint URL.
 * 
 * Get your API key from: https://thegraph.com/studio/apikeys/
 */
const UNISWAP_V3_SUBGRAPH_IDS: Record<VaultoChainId, string> = {
  [1]: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",      // Ethereum
  [10]: "Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj",    // Optimism
  [56]: "F85MNzUGYqgSHSHRGgeVMNsdnW1KtZSVgFULumXRZTw2",    // BSC
  [137]: "3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm",   // Polygon
  [42161]: "3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3", // Arbitrum
  [43114]: "GVH9h9KZ9CqheUEL93qMbq7QwgoBu32QXQDPR6bev4Eo", // Avalanche
  [8453]: "43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG",  // Base
  [42220]: "ESdrTJ3twMwWVoQ1hUE2u7PugEHX3QkenudD6aXCkDQ4", // Celo
  [81457]: "2LHovKznvo8YmKC9ZprPjsYAZDCc4K5q4AYz8s3cnQn1", // Blast
  [11155111]: "",  // Sepolia - no subgraph
  [421614]: "",    // Arbitrum Sepolia - no subgraph
};

/**
 * Check if a chain ID has Uniswap v3 subgraph support.
 * 
 * @param chainId - The chain ID to check
 * @returns True if the chain has a subgraph, false otherwise
 */
export function isChainSupported(chainId: number): chainId is VaultoChainId {
  if (!chainId || typeof chainId !== 'number') {
    return false;
  }
  
  const subgraphId = UNISWAP_V3_SUBGRAPH_IDS[chainId as VaultoChainId];
  return subgraphId !== undefined && subgraphId !== '';
}

/**
 * Get the Uniswap v3 subgraph endpoint URL for a given chain ID.
 * 
 * @param chainId - The chain ID to get the endpoint for
 * @returns The subgraph endpoint URL
 * @throws Error if chain is not supported or API key is missing
 */
export function getUniswapV3SubgraphEndpoint(chainId: number): string {
  if (!isChainSupported(chainId)) {
    throw new Error(`Chain ${chainId} is not supported or does not have a Uniswap v3 subgraph`);
  }

  const apiKey = process.env.THE_GRAPH_API_KEY;
  if (!apiKey) {
    throw new Error('THE_GRAPH_API_KEY environment variable is not set. Get your API key from: https://thegraph.com/studio/apikeys/');
  }

  const subgraphId = UNISWAP_V3_SUBGRAPH_IDS[chainId];
  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

















