/**
 * CoinGecko API utilities for fetching token price data
 */

export interface CoinGeckoPriceData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
  image?: string;
  last_updated: string;
}

export interface CoinGeckoSimplePrice {
  [coinId: string]: {
    usd: number;
    usd_24h_change: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
    last_updated_at?: number;
  };
}

// Map common token symbols to CoinGecko IDs
const COINGECKO_ID_MAP: Record<string, string> = {
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'WETH': 'weth',
  'WBTC': 'wrapped-bitcoin',
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'bAAPL': 'apple-inc', // Tokenized stocks - using underlying stock
  'bTSLA': 'tesla-motors',
  'bGOOGL': 'google',
  'bAMZN': 'amazon',
  'bMSFT': 'microsoft',
  'AAPL': 'apple-inc',
  'TSLA': 'tesla-motors',
  'GOOGL': 'google',
  'AMZN': 'amazon',
  'MSFT': 'microsoft',
};

/**
 * Get CoinGecko ID for a token symbol
 */
export function getCoinGeckoId(symbol: string): string | null {
  const normalizedSymbol = symbol.toUpperCase();
  return COINGECKO_ID_MAP[normalizedSymbol] || null;
}

/**
 * Fetch token price data from CoinGecko by symbol
 */
export async function fetchTokenPriceBySymbol(
  symbol: string
): Promise<CoinGeckoPriceData | null> {
  try {
    const coinId = getCoinGeckoId(symbol);
    if (!coinId) {
      console.warn(`No CoinGecko ID found for symbol: ${symbol}`);
      return null;
    }

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      {
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Token not found on CoinGecko: ${coinId}`);
        return null;
      }
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      id: data.id,
      symbol: data.symbol.toUpperCase(),
      name: data.name,
      current_price: data.market_data?.current_price?.usd || 0,
      price_change_percentage_24h: data.market_data?.price_change_percentage_24h ?? undefined,
      market_cap: data.market_data?.market_cap?.usd || 0,
      total_volume: data.market_data?.total_volume?.usd || 0,
      high_24h: data.market_data?.high_24h?.usd || 0,
      low_24h: data.market_data?.low_24h?.usd || 0,
      circulating_supply: data.market_data?.circulating_supply || 0,
      image: data.image?.large || data.image?.small,
      last_updated: data.last_updated || new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching CoinGecko price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch simple price data from CoinGecko (lighter API call)
 */
export async function fetchSimplePrice(
  symbols: string[]
): Promise<CoinGeckoSimplePrice | null> {
  try {
    const coinIds = symbols
      .map((symbol) => getCoinGeckoId(symbol))
      .filter((id): id is string => id !== null);

    if (coinIds.length === 0) {
      return null;
    }

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
      {
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching simple price from CoinGecko:', error);
    return null;
  }
}

/**
 * Fetch token price data by contract address
 * Note: This requires knowing the chain and may not work for all tokens
 */
export async function fetchTokenPriceByAddress(
  chainId: number,
  address: string
): Promise<CoinGeckoPriceData | null> {
  try {
    // Map chain IDs to CoinGecko platform IDs
    const platformMap: Record<number, string> = {
      1: 'ethereum',
      42161: 'arbitrum-one',
      10: 'optimistic-ethereum',
      8453: 'base',
      137: 'polygon-pos',
      101: 'solana', // Solana mainnet
    };

    const platform = platformMap[chainId];
    if (!platform) {
      console.warn(`Chain ${chainId} not supported for CoinGecko address lookup`);
      return null;
    }

    // Solana addresses use base58 encoding and are case-sensitive, don't lowercase them
    // For other chains (Ethereum-based), addresses should be lowercase
    const normalizedAddress = chainId === 101 ? address : address.toLowerCase();

    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${normalizedAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      {
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Token not found on CoinGecko
      }
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      id: data.id,
      symbol: data.symbol.toUpperCase(),
      name: data.name,
      current_price: data.market_data?.current_price?.usd || 0,
      price_change_percentage_24h: data.market_data?.price_change_percentage_24h ?? undefined,
      market_cap: data.market_data?.market_cap?.usd || 0,
      total_volume: data.market_data?.total_volume?.usd || 0,
      high_24h: data.market_data?.high_24h?.usd || 0,
      low_24h: data.market_data?.low_24h?.usd || 0,
      circulating_supply: data.market_data?.circulating_supply || 0,
      image: data.image?.large || data.image?.small,
      last_updated: data.last_updated || new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching CoinGecko price for address ${address}:`, error);
    return null;
  }
}
