"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import TradingViewChart from '@/app/components/charts/TradingViewChart';
import { fetchTokenPriceBySymbol, fetchTokenPriceByAddress, type CoinGeckoPriceData } from '@/lib/api/coingecko';
import { getTokenMetadata, isTokenizedStock, getStockTicker } from '@/lib/utils/token';
import { formatTVL } from '@/lib/utils/formatters';
import { chainConfig } from '@/config/chains';
import { getPoolsForToken } from '@/lib/uniswap/pools';
import toast from 'react-hot-toast';

interface TokenDetailsClientProps {
  address: string;
  chainId?: number;
}

interface StockData {
  ticker: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  marketCap?: number;
  high52w?: number;
  low52w?: number;
  open: number;
  previousClose: number;
}

export default function TokenDetailsClient({ address, chainId }: TokenDetailsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [coingeckoData, setCoingeckoData] = useState<CoinGeckoPriceData | null>(null);
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [tvlUSD, setTvlUSD] = useState<number | null>(null);
  const [volumeUSD, setVolumeUSD] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get all token information from URL query parameters if available (from search results)
  // Read synchronously to use in fetch logic - must be before tokenChainId usage
  const tvlParam = searchParams?.get('tvl');
  const volumeParam = searchParams?.get('volume');
  const symbolParam = searchParams?.get('symbol');
  const nameParam = searchParams?.get('name');
  const chainIdParam = searchParams?.get('chainId');
  const priceChange24hParam = searchParams?.get('priceChange24h');
  
  // Use data from URL params if available (from search results), otherwise use token config or placeholder
  const searchResultSymbol = symbolParam || null;
  const searchResultName = nameParam || null;
  const searchResultChainId = chainIdParam ? parseInt(chainIdParam, 10) : null;
  const searchResultPriceChange24h = priceChange24hParam ? parseFloat(priceChange24hParam) : null;

  // Get token metadata - may be null if token not in config
  const tokenInfo = getTokenMetadata(address);
  const token = tokenInfo?.token;
  // Use chainId from URL params (search results) if available, then prop, then config, then default to 1
  const tokenChainId = searchResultChainId || chainId || tokenInfo?.chainId || 1;
  const isStock = token ? isTokenizedStock(token) : false;
  const ticker = token ? getStockTicker(token) : null;
  
  const initialTvl = tvlParam ? (() => {
    const val = parseFloat(tvlParam);
    return !isNaN(val) && val > 0 ? val : null;
  })() : null;
  const initialVolume = volumeParam ? (() => {
    const val = parseFloat(volumeParam);
    return !isNaN(val) && val > 0 ? val : null;
  })() : null;

  // Use token symbol/name from search results (most accurate), then metadata, then placeholder values
  const tokenSymbol = searchResultSymbol || token?.symbol || 'TOKEN';
  const tokenName = searchResultName || token?.name || 'Token';
  const tokenDecimals = token?.decimals || 18;

  // Disable all scrolling when component mounts
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    
    // Store original values
    const originalHtmlOverflow = html.style.overflow;
    const originalBodyOverflow = body.style.overflow;
    const originalBodyHeight = body.style.height;
    
    // Disable scrolling
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.height = '100vh';
    
    return () => {
      // Restore original values
      html.style.overflow = originalHtmlOverflow;
      body.style.overflow = originalBodyOverflow;
      body.style.height = originalBodyHeight;
    };
  }, []);

  // Set initial values from URL params
  useEffect(() => {
    if (initialTvl !== null) {
      setTvlUSD(initialTvl);
    }
    if (initialVolume !== null) {
      setVolumeUSD(initialVolume);
    }
  }, [initialTvl, initialVolume]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch CoinGecko data for all tokens
        let priceData: CoinGeckoPriceData | null = null;
        
        // Try by address first (works for any token with contract address)
        if (address) {
          priceData = await fetchTokenPriceByAddress(tokenChainId, address);
        }
        
        // If not found by address, try by symbol if we have token info
        if (!priceData && token?.symbol) {
          priceData = await fetchTokenPriceBySymbol(token.symbol);
        }
        
        // Try alternative chain IDs if mainnet doesn't work
        if (!priceData && address) {
          const alternativeChains = [1, 42161, 10, 8453, 137];
          for (const altChainId of alternativeChains) {
            if (altChainId !== tokenChainId) {
              priceData = await fetchTokenPriceByAddress(altChainId, address);
              if (priceData) break;
            }
          }
        }

        setCoingeckoData(priceData);

        // Determine if this is a tokenized stock (from config or Ondo token from search)
        const effectiveSymbol = searchResultSymbol || coingeckoData?.symbol || tokenSymbol;
        const isOndoToken = effectiveSymbol.toUpperCase().endsWith('ON') && effectiveSymbol.length > 2;
        const ondoTicker = isOndoToken ? effectiveSymbol.slice(0, -2).toUpperCase() : null;
        const stockTicker = ticker || ondoTicker;

        // Fetch stock data for tokenized stocks (from config or Ondo tokens)
        if ((isStock && ticker) || (isOndoToken && ondoTicker)) {
          try {
            const stockResponse = await fetch(`/api/token/${address}/stock-data`);
            if (stockResponse.ok) {
              const stock = await stockResponse.json();
              setStockData(stock);
            } else {
              console.warn('Failed to fetch stock data:', await stockResponse.text());
            }
          } catch (stockError) {
            console.error('Error fetching stock data:', stockError);
            // Don't set error state, just log - stock data is optional
          }
        }

        // Fetch TVL and volume data only if not already set from URL params
        const needsTvl = initialTvl === null;
        const needsVolume = initialVolume === null;
        
        if (needsTvl || needsVolume) {
          try {
            if (tokenChainId === 101) {
              // Solana token - use Solana token data API
              const solanaResponse = await fetch(`/api/solana/token-data?t=${Date.now()}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ addresses: [address] }),
                cache: 'no-store',
              });

              if (solanaResponse.ok) {
                const solanaData = await solanaResponse.json();
                const tokenData = solanaData.tokens?.[0];
                if (tokenData) {
                  if (needsTvl && tokenData.tvlUSD !== undefined && tokenData.tvlUSD > 0) {
                    setTvlUSD(tokenData.tvlUSD);
                  }
                  if (needsVolume && tokenData.volumeUSD !== undefined && tokenData.volumeUSD > 0) {
                    setVolumeUSD(tokenData.volumeUSD);
                  }
                }
              }
            } else {
              // Uniswap/EVM chains - fetch pools and calculate TVL/volume
              const poolsResult = await getPoolsForToken(tokenChainId, address, 100);
              if (poolsResult.pools && poolsResult.pools.length > 0) {
                // Calculate total TVL from all pools
                const totalTVL = poolsResult.pools.reduce((sum, pool) => sum + (pool.tvlUSD || 0), 0);
                // Calculate total 24hr volume from all pools
                const totalVolume = poolsResult.pools.reduce((sum, pool) => sum + (pool.volumeUSD || 0), 0);
                
                if (needsTvl && totalTVL > 0) {
                  setTvlUSD(totalTVL);
                }
                if (needsVolume && totalVolume > 0) {
                  setVolumeUSD(totalVolume);
                }
              }
            }
          } catch (tvlVolumeError) {
            console.error('Error fetching TVL/volume data:', tvlVolumeError);
            // Don't set error state, just log - TVL/volume data is optional
          }
        }
      } catch (err: any) {
        console.error('Error fetching token data:', err);
        setError(err.message || 'Failed to load token data');
        toast.error('Failed to load token data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [address, tokenChainId, token, isStock, ticker, tokenSymbol]);

  if (isLoading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
        {/* Loading skeleton */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gray-800 animate-pulse"></div>
          <div className="space-y-2">
            <div className="h-8 w-48 bg-gray-800 rounded animate-pulse"></div>
            <div className="h-4 w-24 bg-gray-800 rounded animate-pulse"></div>
          </div>
        </div>
        
        {/* Loading stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 w-full">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-16 bg-gray-800 rounded animate-pulse"></div>
              <div className="h-8 w-24 bg-gray-800 rounded animate-pulse"></div>
            </div>
          ))}
        </div>
        
        {/* Loading chart */}
        <div className="w-full h-[600px] bg-gray-800 rounded-lg animate-pulse flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-yellow-400 text-sm">Loading chart...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    console.error('Token details error:', error);
  }

  // Determine which price data to display
  // Prioritize search result data, then stock data, then CoinGecko data
  const displayPrice = stockData?.currentPrice || coingeckoData?.current_price || 0;
  const priceChange = searchResultPriceChange24h !== null 
    ? searchResultPriceChange24h 
    : (stockData?.priceChangePercent || coingeckoData?.price_change_percentage_24h || 0);
  const volume = stockData?.volume || coingeckoData?.total_volume || 0;
  const marketCap = stockData?.marketCap || coingeckoData?.market_cap || 0;

  // Determine chart symbol
  // Prioritize symbol from search results (more accurate for tokenized stocks), then CoinGecko, then token config
  // This ensures we can detect tokenized stocks from public search even if not in config
  const effectiveSymbol = searchResultSymbol || coingeckoData?.symbol || tokenSymbol;
  
  // Check if this is an Ondo tokenized stock (symbol ends with "on")
  // This works for tokens from public search that aren't in config
  const isOndoToken = effectiveSymbol.toUpperCase().endsWith('ON') && effectiveSymbol.length > 2;
  const ondoTicker = isOndoToken ? effectiveSymbol.slice(0, -2).toUpperCase() : null;
  
  // Special mappings for Ondo tokens that need different TradingView symbols
  // Note: TradingView widget may need just the ticker without exchange prefix
  const ondoTickerMappings: Record<string, string> = {
    'SPYON': 'SPY', // Use SPY ETF - TradingViewChart will add exchange prefix if needed
  };
  
  // For Ondo tokenized stocks (symbol ends with "on"), use the extracted ticker
  // For regular tokenized stocks from config, use the ticker field
  // Otherwise use CoinGecko symbol or token symbol
  let chartSymbol: string;
  let chartType: 'stock' | 'crypto';
  
  if (isOndoToken && ondoTicker) {
    // Ondo tokenized stock - use the base ticker (e.g., "SPY" from "SPYon", "NVDA" from "NVDAon")
    // Check for special mappings first (full symbol), then fall back to extracted ticker
    const upperSymbol = effectiveSymbol.toUpperCase();
    chartSymbol = ondoTickerMappings[upperSymbol] || ondoTicker;
    chartType = 'stock';
  } else if (isStock && ticker) {
    // Regular tokenized stock from config - format as NASDAQ:<ticker>
    chartSymbol = `NASDAQ:${ticker}`;
    chartType = 'stock';
  } else {
    // Regular crypto token
    chartSymbol = effectiveSymbol;
    chartType = 'crypto';
  }

  // Get explorer URL
  const getExplorerUrl = (chainId: number, address: string): string | null => {
    const config = chainConfig[chainId as keyof typeof chainConfig];
    if (!config || !config.explorer) {
      return null;
    }
    return `${config.explorer}/token/${address}`;
  };

  const explorerUrl = getExplorerUrl(tokenChainId, address);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6 animate-fade-in overflow-hidden h-full">
      {/* Token Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 pb-6">
        <div className="flex items-center gap-4">
          {/* Back Button - Yellow element with white arrow */}
          <button
            onClick={() => router.push('/')}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-400 hover:bg-yellow-500 transition-colors"
            aria-label="Back to home"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="white"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          {(token?.logoURI || coingeckoData?.image) && (
            <div className="relative w-16 h-16 rounded-full overflow-hidden bg-gray-800">
              <Image
                src={token?.logoURI || coingeckoData?.image || ''}
                alt={tokenName}
                fill
                className="object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold text-white">
              {coingeckoData?.name || tokenName}
            </h1>
            <div className="flex flex-wrap items-center gap-4 md:gap-6">
              <p className="text-gray-400">
                {coingeckoData?.symbol?.toUpperCase() || tokenSymbol.toUpperCase()}
              </p>
              <div>
                <span className="text-gray-400 text-xs mr-2">Price:</span>
                <span className="text-sm font-semibold text-white">
                  ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-xs mr-2">24h Change:</span>
                <span className={`text-sm font-semibold ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              </div>
              {marketCap > 0 && (
                <div>
                  <span className="text-gray-400 text-xs mr-2">Market Cap:</span>
                  <span className="text-sm font-semibold text-white">
                    {formatTVL(marketCap)}
                  </span>
                </div>
              )}
              {volumeUSD !== null && volumeUSD > 0 && (
                <div>
                  <span className="text-gray-400 text-xs mr-2">24h Vol:</span>
                  <span className="text-sm font-semibold text-white">
                    {formatTVL(volumeUSD)}
                  </span>
                </div>
              )}
              {tvlUSD !== null && tvlUSD > 0 && (
                <div>
                  <span className="text-gray-400 text-xs mr-2">TVL:</span>
                  <span className="text-sm font-semibold text-white">
                    {formatTVL(tvlUSD)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs font-medium text-yellow-400 hover:text-yellow-300 border border-yellow-400/40 hover:border-yellow-400/60 rounded-full transition-colors"
            >
              Etherscan
            </a>
          )}
          {(isStock || isOndoToken) && (
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium">
              Tokenized Stock
            </span>
          )}
        </div>
      </div>

      {/* TradingView Chart */}
      <div className="w-full">
        <TradingViewChart
          symbol={chartSymbol}
          type={chartType}
          height={600}
          theme="dark"
          interval="D"
        />
      </div>

    </div>
  );
}
