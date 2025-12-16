import { NextRequest, NextResponse } from 'next/server';
import { fetchTokenPriceByAddress } from '@/lib/api/coingecko';
import * as cheerio from 'cheerio';

export interface SolanaTokenDataResponse {
  chainId: number;
  tokens: Array<{
    address: string;
    tvlUSD?: number;
    volumeUSD: number; // 24h volume
    marketCap?: number;
    marketCapFormatted?: string; // Formatted market cap from Jupiter (e.g., "$472B")
    priceChange24h?: number; // 24h price change percentage
  }>;
  error?: string;
}

/**
 * Format market cap number to Jupiter's format (e.g., $472B)
 */
function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(0)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(0)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(0)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Fetch market cap from Jupiter token page HTML
 * Parses the HTML to extract the market cap value from __NEXT_DATA__ script tag
 * Falls back to searching for "Stock MC" button element if needed
 */
async function fetchJupiterMarketCap(tokenAddress: string): Promise<string | null> {
  try {
    const url = `https://www.jup.ag/tokens/${tokenAddress}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(`Failed to fetch Jupiter page for ${tokenAddress}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Strategy 1: Extract from __NEXT_DATA__ script tag (most reliable for SSR pages)
    const nextDataScript = $('script#__NEXT_DATA__');
    if (nextDataScript.length > 0) {
      try {
        const nextDataText = nextDataScript.html();
        if (nextDataText) {
          const nextData = JSON.parse(nextDataText);
          
          // Navigate through the data structure to find stockData.mcap
          const pageProps = nextData?.props?.pageProps;
          if (pageProps) {
            const dehydratedState = pageProps?.dehydratedState;
            if (dehydratedState) {
              const queries = dehydratedState?.queries || [];
              
              // Search through all queries for stockData.mcap
              for (const query of queries) {
                const data = query?.state?.data;
                if (data?.stockData?.mcap) {
                  const mcap = data.stockData.mcap;
                  if (typeof mcap === 'number' && mcap > 0) {
                    const formatted = formatMarketCap(mcap);
                    return formatted;
                  }
                }
              }
            }
          }
        }
      } catch (parseError) {
        console.warn(`Error parsing __NEXT_DATA__ for ${tokenAddress}:`, parseError);
        // Continue to fallback strategies
      }
    }

    // Strategy 2: Find the button element containing "Stock MC" text (for client-rendered content)
    const stockMCButton = $('button').filter((_, el) => {
      const buttonText = $(el).text();
      return buttonText.includes('Stock MC');
    }).first();

    if (stockMCButton.length > 0) {
      // Find the span with translate="no" attribute within the button
      const marketCapSpan = stockMCButton.find('span[translate="no"]').first();

      if (marketCapSpan.length > 0) {
        const marketCapValue = marketCapSpan.text().trim();
        
        if (marketCapValue && marketCapValue !== '$0') {
          return marketCapValue;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching Jupiter market cap for ${tokenAddress}:`, error);
    return null;
  }
}

/**
 * Fetch liquidity data from Jupiter API
 * Uses Jupiter's quote API to estimate available liquidity
 */
async function fetchJupiterLiquidity(tokenAddress: string): Promise<number | null> {
  try {
    // USDC on Solana (most common quote token)
    const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    // Try to get a quote for a large swap to estimate liquidity
    // Using 100K USDC as input to see available liquidity depth
    const quoteAmount = 100000 * 1e6; // 100K USDC (6 decimals)
    
    // Try swapping USDC -> Token first
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_SOLANA}&outputMint=${tokenAddress}&amount=${quoteAmount}&slippageBps=50`,
      {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (quoteResponse.ok) {
      const quoteData = await quoteResponse.json();
      
      if (quoteData.outAmount && quoteData.priceImpact !== undefined) {
        const priceImpact = parseFloat(quoteData.priceImpact);
        // If price impact is low (< 1%), there's good liquidity
        // Estimate liquidity based on the quote amount and price impact
        if (priceImpact < 0.01) {
          // Good liquidity - estimate at least the quote amount
          return 100000; // At least 100K liquidity
        } else if (priceImpact < 0.05) {
          // Moderate liquidity
          return 50000; // Estimate 50K liquidity
        } else if (priceImpact < 0.10) {
          // Lower liquidity
          return 10000; // Estimate 10K liquidity
        }
      }
    }

    // Try reverse direction (Token -> USDC)
    const reverseAmount = 1000000 * 1e9; // 1M tokens (assuming 9 decimals, common for Solana)
    const reverseQuoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${USDC_SOLANA}&amount=${reverseAmount}&slippageBps=50`,
      {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (reverseQuoteResponse.ok) {
      const reverseQuoteData = await reverseQuoteResponse.json();
      
      if (reverseQuoteData.outAmount && reverseQuoteData.priceImpact !== undefined) {
        const priceImpact = parseFloat(reverseQuoteData.priceImpact);
        const outputUSD = parseFloat(reverseQuoteData.outAmount) / 1e6; // USDC has 6 decimals
        
        if (priceImpact < 0.01 && outputUSD > 0) {
          // Good liquidity - use output amount as estimate
          return outputUSD * 10; // Multiply by 10 as rough estimate
        } else if (priceImpact < 0.05 && outputUSD > 0) {
          return outputUSD * 5;
        } else if (priceImpact < 0.10 && outputUSD > 0) {
          return outputUSD * 2;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching Jupiter liquidity for ${tokenAddress}:`, error);
    return null;
  }
}

/**
 * POST /api/solana/token-data
 * 
 * Fetches liquidity and marketcap data for Solana tokens.
 * 
 * Request body:
 * {
 *   addresses: string[]  // Array of Solana token addresses
 * }
 * 
 * Response:
 * {
 *   chainId: 101,
 *   tokens: Array<{ address, tvlUSD?, volumeUSD, marketCap? }>,
 *   error?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { addresses } = body;

    // Validate request body
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json<SolanaTokenDataResponse>(
        {
          chainId: 101,
          tokens: [],
          error: 'Invalid addresses. Must be a non-empty array of token addresses.',
        },
        { status: 400 }
      );
    }

    // Validate all addresses are strings
    if (!addresses.every((addr) => typeof addr === 'string' && addr.trim().length > 0)) {
      return NextResponse.json<SolanaTokenDataResponse>(
        {
          chainId: 101,
          tokens: [],
          error: 'All addresses must be non-empty strings.',
        },
        { status: 400 }
      );
    }

    // Fetch data for all tokens in parallel
    const tokensWithData = await Promise.all(
      addresses.map(async (address: string) => {
        try {
          // Fetch liquidity from Jupiter (primary source for TVL)
          const jupiterLiquidity = await fetchJupiterLiquidity(address);
          
          // Fetch market cap from Jupiter HTML (prioritized for private tokens)
          const jupiterMarketCapFormatted = await fetchJupiterMarketCap(address);
          
          // Fetch CoinGecko data for volume (24h trading volume)
          const coingeckoData = await fetchTokenPriceByAddress(101, address);

          // Build response with liquidity from Jupiter and volume from CoinGecko
          const result: { address: string; tvlUSD?: number; volumeUSD: number; marketCap?: number; marketCapFormatted?: string; priceChange24h?: number } = {
            address,
            volumeUSD: coingeckoData?.total_volume || 0,
          };

          // Add liquidity from Jupiter if available
          if (jupiterLiquidity !== null && jupiterLiquidity > 0) {
            result.tvlUSD = jupiterLiquidity;
          }

          // Prioritize Jupiter's formatted market cap, fall back to CoinGecko
          if (jupiterMarketCapFormatted) {
            result.marketCapFormatted = jupiterMarketCapFormatted;
          } else if (coingeckoData?.market_cap) {
            result.marketCap = coingeckoData.market_cap;
          }

          // Add 24h price change from CoinGecko
          if (coingeckoData?.price_change_percentage_24h !== undefined && coingeckoData.price_change_percentage_24h !== null) {
            result.priceChange24h = coingeckoData.price_change_percentage_24h;
          }

          return result;
        } catch (error) {
          console.error(`Error fetching data for Solana token ${address}:`, error);
          // Return token with zero values on error
          return {
            address,
            volumeUSD: 0,
          };
        }
      })
    );

    return NextResponse.json<SolanaTokenDataResponse>(
      {
        chainId: 101,
        tokens: tokensWithData,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error: any) {
    console.error('Error in Solana token-data API route:', error);
    return NextResponse.json<SolanaTokenDataResponse>(
      {
        chainId: 101,
        tokens: [],
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

