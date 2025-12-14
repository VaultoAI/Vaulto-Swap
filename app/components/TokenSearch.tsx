"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getTokenLogoUrl } from '@/query-token-logo';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { formatTVL, formatFeeTier, truncateAddress } from '@/lib/utils/formatters';
import { isChainSupported } from '@/lib/uniswap/subgraphs';
import { chainConfig } from '@/config/chains';
import type { LiquidityApiResponse, LiquidityTokenResult } from '@/app/components/search/types';
import toast from 'react-hot-toast';

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
  tvlUSD?: number; // Optional TVL from Uniswap or liquidity pools
  volumeUSD?: number; // Optional 24hr volume from Uniswap or trading data
  marketCap?: number; // Optional market capitalization
  marketCapFormatted?: string; // Formatted market cap from Jupiter (e.g., "$472B")
  pools?: Array<{
    poolAddress: string;
    feeTierBps: number;
    tvlUSD: number;
    volumeUSD: number;
    token0: { symbol: string };
    token1: { symbol: string };
  }>; // Optional pool data from Uniswap
}

interface TokenSearchProps {
  chainId: number;
  activeTab?: 'public' | 'private';
  onDropdownToggle?: (isOpen: boolean) => void;
}

// Map wagmi chain IDs to CoW Swap supported chains
const getCowChainId = (wagmiChainId: number): number => {
  switch (wagmiChainId) {
    case 1: return 1;
    case 100: return 100;
    case 11155111: return 11155111;
    case 42161: return 42161;
    case 10: return 10;
    case 8453: return 8453;
    case 137: return 137;
    case 421614: return 421614;
    default: return 1;
  }
};

// Map chain IDs to Uniswap GraphQL chain names
const getGraphQLChainName = (chainId: number): string => {
  switch (chainId) {
    case 1: return 'ETHEREUM';
    case 137: return 'POLYGON';
    case 42161: return 'ARBITRUM';
    case 10: return 'OPTIMISM';
    case 8453: return 'BASE';
    case 56: return 'BNB';
    case 43114: return 'AVALANCHE';
    case 11155111: return 'ETHEREUM'; // Sepolia testnet - use ETHEREUM as fallback
    case 421614: return 'ARBITRUM'; // Arbitrum Sepolia - use ARBITRUM as fallback
    case 100: return 'ETHEREUM'; // Gnosis - use ETHEREUM as fallback
    default: return 'ETHEREUM';
  }
};

// Generate a consistent color from a string (token symbol or address)
const generateColorFromSeed = (seed: string): string => {
  if (!seed) return '#6B7280'; // Default gray
  
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash) % 360;
  // Use a more vibrant color palette
  const saturation = 65 + (Math.abs(hash) % 20); // 65-85%
  const lightness = 45 + (Math.abs(hash) % 15); // 45-60%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Get contrasting text color (white or black) for a background color
const getContrastColor = (bgColor: string): string => {
  // Extract HSL values
  const match = bgColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return '#FFFFFF';
  
  const lightness = parseInt(match[3], 10);
  // Use white text for darker backgrounds, black for lighter
  return lightness < 50 ? '#FFFFFF' : '#000000';
};

// Map chain IDs to Uniswap assets repository network names
const getUniswapNetworkName = (chainId: number): string => {
  switch (chainId) {
    case 1: return 'ethereum';
    case 137: return 'polygon';
    case 42161: return 'arbitrum';
    case 10: return 'optimism';
    case 8453: return 'base';
    case 56: return 'bsc';
    case 43114: return 'avalanche';
    default: return 'ethereum';
  }
};

// Construct fallback URL from Uniswap assets repository
const getUniswapAssetsUrl = (chainId: number, address: string): string => {
  const networkName = getUniswapNetworkName(chainId);
  // Use checksummed address
  const checksummedAddress = address; // In a real implementation, you'd checksum this
  return `https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/${networkName}/assets/${checksummedAddress}/logo.png`;
};

// LocalStorage key for logo cache
const LOGO_CACHE_KEY = 'vaulto_token_logo_cache';

// Helper functions for localStorage caching
const loadLogoCache = (): Map<string, string | null> => {
  if (typeof window === 'undefined') return new Map();
  
  try {
    const cached = localStorage.getItem(LOGO_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return new Map(Object.entries(parsed));
    }
  } catch (error) {
    console.debug('Failed to load logo cache from localStorage:', error);
  }
  return new Map();
};

const saveLogoToCache = (key: string, logoUrl: string | null): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const cached = loadLogoCache();
    cached.set(key, logoUrl);
    const serialized = Object.fromEntries(cached);
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(serialized));
  } catch (error) {
    console.debug('Failed to save logo to localStorage cache:', error);
  }
};

// Check if a string is a valid Ethereum address
const isEthereumAddress = (text: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(text);
};

// Fetch Uniswap liquidity data for a search query
const fetchUniswapLiquidity = async (
  chainId: number,
  query: string
): Promise<LiquidityApiResponse> => {
  try {
    const response = await fetch('/api/uniswap/liquidity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chainId, query }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data: LiquidityApiResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Uniswap liquidity:', error);
    return {
      chainId,
      tokens: [],
      error: error instanceof Error ? error.message : 'Failed to fetch liquidity data',
    };
  }
};

// Fetch Solana token data (liquidity, marketcap, volume) for token addresses
const fetchSolanaTokenData = async (
  addresses: string[]
): Promise<Array<{ address: string; tvlUSD?: number; volumeUSD: number; marketCap?: number; marketCapFormatted?: string }>> => {
  if (addresses.length === 0) {
    return [];
  }

  try {
    const response = await fetch(`/api/solana/token-data?t=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ addresses }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.tokens || [];
  } catch (error) {
    console.error('Error fetching Solana token data:', error);
    return addresses.map((address) => ({
      address,
      volumeUSD: 0,
    }));
  }
};

// Convert liquidity token result to search token format
const liquidityTokenToSearchResult = (
  liquidityToken: LiquidityTokenResult,
  chainId: number
): Token => {
  return {
    address: liquidityToken.address,
    symbol: liquidityToken.symbol,
    name: liquidityToken.name,
    decimals: liquidityToken.decimals,
    chainId,
    tvlUSD: liquidityToken.tvlUSD,
    volumeUSD: liquidityToken.volumeUSD,
    pools: liquidityToken.pools.map((pool) => ({
      poolAddress: pool.poolAddress,
      feeTierBps: pool.feeTierBps,
      tvlUSD: pool.tvlUSD,
      volumeUSD: pool.volumeUSD,
      token0: { symbol: pool.token0.symbol },
      token1: { symbol: pool.token1.symbol },
    })),
  };
};

// Get top pool trading pair (just the symbols)
const getTopPoolPair = (token: Token): string | null => {
  if (!token.pools || token.pools.length === 0) {
    return null;
  }

  const topPool = token.pools[0]; // Pools are already sorted by TVL
  if (!topPool) return null;
  
  return `${topPool.token0.symbol}/${topPool.token1.symbol}`;
};

// Get TVL to display (prefer pool TVL, fallback to token TVL)
const getDisplayTVL = (token: Token): number | null => {
  // If token has pools, use the top pool's TVL (as shown before)
  if (token.pools && token.pools.length > 0 && token.pools[0].tvlUSD) {
    return token.pools[0].tvlUSD;
  }
  // Fallback to token-level TVL
  if (token.tvlUSD !== undefined && token.tvlUSD > 0) {
    return token.tvlUSD;
  }
  return null;
};

// Get 24hr volume to display (prefer pool volume sum, fallback to token volume)
const getDisplayVolume = (token: Token): number | null => {
  // If token has pools, sum up all pool volumes
  if (token.pools && token.pools.length > 0) {
    const totalPoolVolume = token.pools.reduce((sum, pool) => sum + (pool.volumeUSD || 0), 0);
    if (totalPoolVolume > 0) {
      return totalPoolVolume;
    }
  }
  // Fallback to token-level volume
  if (token.volumeUSD !== undefined && token.volumeUSD > 0) {
    return token.volumeUSD;
  }
  return null;
};

// Get sort TVL value for comprehensive sorting (pool TVL preferred, then token TVL)
const getSortTVL = (token: Token): number => {
  // Prioritize pool TVL (top pool's TVL) for sorting
  if (token.pools && token.pools.length > 0 && token.pools[0].tvlUSD) {
    return token.pools[0].tvlUSD;
  }
  // Fallback to token-level TVL
  if (token.tvlUSD !== undefined && token.tvlUSD > 0) {
    return token.tvlUSD;
  }
  // Return 0 for tokens with no TVL (they will sort to the bottom)
  return 0;
};

// Get top pool display text (without fee percentage) - for backward compatibility
const getTopPoolText = (token: Token): string | null => {
  if (!token.pools || token.pools.length === 0) {
    return null;
  }

  const topPool = token.pools[0]; // Pools are already sorted by TVL
  if (!topPool) return null;

  const poolTVL = formatTVL(topPool.tvlUSD);
  
  return `${topPool.token0.symbol}/${topPool.token1.symbol} • ${poolTVL} TVL`;
};

// Get explorer URL for a token address
const getExplorerUrl = (chainId: number, address: string): string | null => {
  const config = chainConfig[chainId as keyof typeof chainConfig];
  if (!config || !config.explorer) {
    return null;
  }
  return `${config.explorer}/token/${address}`;
};

export default function TokenSearch({ chainId, activeTab = 'public', onDropdownToggle }: TokenSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [filteredTokens, setFilteredTokens] = useState<Token[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [logoUrls, setLogoUrls] = useState<Map<string, string | null>>(new Map());
  const [fetchingLogos, setFetchingLogos] = useState<Set<string>>(new Set());
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [isLoadingUniswap, setIsLoadingUniswap] = useState(false);
  const logoUrlsRef = useRef<Map<string, string | null>>(new Map());
  const fetchingLogosRef = useRef<Set<string>>(new Set());
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();
  
  // Load cached logos from localStorage on mount
  useEffect(() => {
    const cached = loadLogoCache();
    if (cached.size > 0) {
      setLogoUrls(cached);
      logoUrlsRef.current = cached;
    }
  }, []);
  
  // Keep refs in sync with state
  useEffect(() => {
    logoUrlsRef.current = logoUrls;
  }, [logoUrls]);
  
  useEffect(() => {
    fetchingLogosRef.current = fetchingLogos;
  }, [fetchingLogos]);

  // Private tokens list (Solana addresses)
  const privateTokens: Token[] = useMemo(() => [
    {
      address: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
      symbol: "Anduril",
      name: "Anduril",
      decimals: 9,
      chainId: 101, // Solana mainnet
      logoURI: "/Private Companies/anduril.webp",
    },
    {
      address: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
      symbol: "Anthropic",
      name: "Anthropic",
      decimals: 9,
      chainId: 101,
      logoURI: "/Private Companies/anthropic.webp",
    },
    {
      address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
      symbol: "OpenAI",
      name: "OpenAI",
      decimals: 9,
      chainId: 101,
      logoURI: "/Private Companies/openai.webp",
    },
    {
      address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
      symbol: "SpaceX",
      name: "SpaceX",
      decimals: 9,
      chainId: 101,
      logoURI: "/Private Companies/spacex.webp",
    },
    {
      address: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx",
      symbol: "xAI",
      name: "xAI",
      decimals: 9,
      chainId: 101,
      logoURI: "/Private Companies/xai.webp",
    },
  ], []);

  // Vaulto tokens list
  const vaultoTokens: Token[] = useMemo(() => [
    {"name":"SPDR S&P 500 ETF Trust","symbol":"SPYon","address":"0xfedc5f4a6c38211c1338aa411018dfaf26612c08","chainId":1,"decimals":18},
    {"name":"SPDR S&P 500 ETF Trust","symbol":"SPYon","address":"0x6a708ead771238919d85930b5a0f10454e1c331a","chainId":56,"decimals":18},
    {"name":"iShares Core S&P 500 ETF","symbol":"IVVon","address":"0x62ca254a363dc3c748e7e955c20447ab5bf06ff7","chainId":1,"decimals":18},
    {"name":"iShares Core S&P 500 ETF","symbol":"IVVon","address":"0x1104eb7e85e25eb45f88e638b0c27a06c1a91cb2","chainId":56,"decimals":18},
    {"name":"iShares 20+ Year Treasury Bond ETF","symbol":"TLTon","address":"0x992651bfeb9a0dcc4457610e284ba66d86489d4d","chainId":1,"decimals":18},
    {"name":"iShares 20+ Year Treasury Bond ETF","symbol":"TLTon","address":"0xf69e40069ac227c11459e3f4e8a446b3401616b6","chainId":56,"decimals":18},
    {"name":"Invesco QQQ Trust","symbol":"QQQon","address":"0x0e397938c1aa0680954093495b70a9f5e2249aba","chainId":1,"decimals":18},
    {"name":"Invesco QQQ Trust","symbol":"QQQon","address":"0x0cde6936d305d5b34667fc46425e852efd73559a","chainId":56,"decimals":18},
    {"name":"WisdomTree 500 Digital Fund","symbol":"SPXUX","address":"0x873d589f38abbcdd1fca27261aba2f1aa0661d44","chainId":1,"decimals":18},
    {"name":"WisdomTree 500 Digital Fund","symbol":"SPXUX","address":"0x1a149e21bd3e74b7018db79c988b4ba3bbc1873d","chainId":10,"decimals":18},
    {"name":"WisdomTree 500 Digital Fund","symbol":"SPXUX","address":"0x4122047076a1106618e984a8776a3f7bbcb1d429","chainId":42161,"decimals":18},
    {"name":"WisdomTree 500 Digital Fund","symbol":"SPXUX","address":"0xfec440fdf48860ff6e2265bd1ef9cae8bb2cce8a","chainId":8453,"decimals":18},
    {"name":"WisdomTree 500 Digital Fund","symbol":"SPXUX","address":"0x1a149e21bd3e74b7018db79c988b4ba3bbc1873d","chainId":43114,"decimals":18},
    {"name":"iShares Core MSCI EAFE ETF","symbol":"IEFAon","address":"0xfeff7a377a86462f5a2a872009722c154707f09e","chainId":1,"decimals":18},
    {"name":"iShares Core MSCI EAFE ETF","symbol":"IEFAon","address":"0x918008c3d29496c37b478b611967beaca365af36","chainId":56,"decimals":18},
    {"name":"iShares Core US Aggregate Bond ETF","symbol":"AGGon","address":"0xff7cf16aa2ffc463b996db2f7b7cf0130336899d","chainId":1,"decimals":18},
    {"name":"iShares Core S&P Total US Stock Market ETF","symbol":"ITOTon","address":"0x0692481c369e2bdc728a69ae31b848343a4567be","chainId":1,"decimals":18},
    {"name":"iShares Core S&P Total US Stock Market ETF","symbol":"ITOTon","address":"0xcf9caf83053213c44dd7027db3e1e4ac98e55f8f","chainId":56,"decimals":18},
    {"name":"iShares MSCI EAFE ETF","symbol":"EFAon","address":"0x4111b60bc87f2bd1e81e783e271d7f0ec6ee088b","chainId":1,"decimals":18},
    {"name":"iShares MSCI EAFE ETF","symbol":"EFAon","address":"0x38b9a53bfdc5dba58a29bd6992341927c2fca637","chainId":56,"decimals":18},
    {"name":"iShares Gold Trust","symbol":"IAUon","address":"0x4f0ca3df1c2e6b943cf82e649d576ffe7b2fabcf","chainId":1,"decimals":18},
    {"name":"iShares Gold Trust","symbol":"IAUon","address":"0xcb2a0f46f67dc4c58a316f1c008edef5c2311795","chainId":56,"decimals":18},
    {"name":"iShares Russell 1000 Growth ETF","symbol":"IWFon","address":"0x8d05432c2786e3f93f1a9a62b9572dbf54f3ea06","chainId":1,"decimals":18},
    {"name":"iShares Russell 1000 Growth ETF","symbol":"IWFon","address":"0x40755f06ab7f8de1ab3a9413b1ef562d63de19b1","chainId":56,"decimals":18},
    {"name":"iShares Core MSCI Emerging Markets ETF","symbol":"IEMGon","address":"0xcdd60d15125bf3362b6838d2506b0fa33bc1a515","chainId":1,"decimals":18},
    {"name":"iShares Core MSCI Emerging Markets ETF","symbol":"IEMGon","address":"0x22092c94a91d019ad15536725598b0a6be0a73c0","chainId":56,"decimals":18},
    {"name":"iShares Silver Trust","symbol":"SLVon","address":"0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4","chainId":1,"decimals":18},
    {"name":"iShares Silver Trust","symbol":"SLVon","address":"0x8b872732b07be325a8803cdb480d9d20b6f8d11b","chainId":56,"decimals":18},
    {"name":"iShares MSCI Emerging Markets ETF","symbol":"EEMon","address":"0x77a1a02e4a888ada8620b93c30de8a41e621126c","chainId":1,"decimals":18},
    {"name":"iShares MSCI Emerging Markets ETF","symbol":"EEMon","address":"0x00c81d35eddf44c75d4db9e07bdcdc236eb0ebcf","chainId":56,"decimals":18},
    {"name":"Tesla Inc. DL - 001","symbol":"TSLAon","address":"0xf6b1117ec07684d3958cad8beb1b302bfd21103f","chainId":1,"decimals":18},
    {"name":"iShares Russell 2000 Value ETF","symbol":"IWNon","address":"0x9dcf7f739b8c0270e2fc0cc8d0dabe355a150dba","chainId":1,"decimals":18},
    {"name":"iShares Russell 2000 Value ETF","symbol":"IWNon","address":"0xf54b94ea21e1da5d51ef00fd4502225e5394f874","chainId":56,"decimals":18},
    {"name":"Lockheed Martin Corp.","symbol":"LMTon","address":"0x691b126cf619707ed5d16cab1b27c000aa8de300","chainId":1,"decimals":18},
    {"name":"Lockheed Martin Corp.","symbol":"LMTon","address":"0xd09f7b75b9659b864c6f82bb00ff096f9d277998","chainId":56,"decimals":18},
    {"name":"NVIDIA Corp","symbol":"NVDAon","address":"0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee","chainId":1,"decimals":18},
    {"name":"NVIDIA Corp","symbol":"NVDAon","address":"0xa9ee28c80f960b889dfbd1902055218cba016f75","chainId":56,"decimals":18},
    {"name":"Eli Lilly and Company","symbol":"LLYon","address":"0xf192957ae52db3eb088654403cc2eded014ae556","chainId":1,"decimals":18},
    {"name":"Eli Lilly and Company","symbol":"LLYon","address":"0x341d31b2be1fee9c00e395a62ba41837f4322eed","chainId":56,"decimals":18},
    {"name":"The Coca-Cola Company","symbol":"KOon","address":"0x74a03d741226f738098c35da8188e57aca50d146","chainId":1,"decimals":18},
    {"name":"The Coca-Cola Company","symbol":"KOon","address":"0x405f38b90bebf1259062cf29da299f3398662bcb","chainId":56,"decimals":18},
    {"name":"Apple Inc.","symbol":"AAPLon","address":"0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c","chainId":1,"decimals":18},
    {"name":"Pfizer Inc.","symbol":"PFEon","address":"0x06954faa913fa14c28eb1b2e459594f22f33f3de","chainId":1,"decimals":18},
    {"name":"The Procter & Gamble Company","symbol":"PGon","address":"0x339ce23a355ed6d513dd3e1462975c4ecd86823a","chainId":1,"decimals":18},
    {"name":"McDonald's Corporation","symbol":"MCDon","address":"0x4c82c8cd9a218612dce60b156b73a36705645e3b","chainId":1,"decimals":18},
    {"name":"iShares Core S&P MidCap ETF","symbol":"IJHon","address":"0xfd50fc4e3686a8da814c5c3d6121d8ab98a537f0","chainId":1,"decimals":18},
    {"name":"iShares Russell 2000 ETF","symbol":"IWMon","address":"0x070d79021dd7e841123cb0cf554993bf683c511d","chainId":1,"decimals":18},
    {"name":"Microsoft Corporation","symbol":"MSFTon","address":"0xb812837b81a3a6b81d7cd74cfb19a7f2784555e5","chainId":1,"decimals":18},
    {"name":"International Business Machines Corporation","symbol":"IBMon","address":"0x25d3f236b2d61656eebdea86ac6d454efaaa3c5","chainId":1,"decimals":18},
    {"name":"JPMorgan Chase & Co.","symbol":"JPMon","address":"0x03c1ec4ca9dbb168e6db0def827c085999cbffaf","chainId":1,"decimals":18},
    {"name":"PepsiCo, Inc.","symbol":"PEPon","address":"0x3ce219d498d807317f840f4cb0f03fa27dd65046","chainId":1,"decimals":18},
    {"name":"Novo Nordisk A/S","symbol":"NVOon","address":"0x28151f5888833d3d767c4d6945a0ee50d1b193e3","chainId":1,"decimals":18},
    {"name":"Advanced Micro Devices, Inc. Common Stock","symbol":"AMDon","address":"0x0c1f3412a44ff99e40bf14e06e5ea321ae7b3938","chainId":1,"decimals":18},
    {"name":"Alphabet Inc. Class A","symbol":"GOOGLon","address":"0xba47214edd2bb43099611b208f75e4b42fdcfedc","chainId":1,"decimals":18},
    {"name":"Toyota","symbol":"TMon","address":"0xab02fc332e9278ebcbbc6b4a8038050c01d15f69","chainId":1,"decimals":18},
    {"name":"Intel Corp","symbol":"INTCon","address":"0xfda09936dbd717368de0835ba441d9e62069d36f","chainId":1,"decimals":18},
    {"name":"Walmart Inc.","symbol":"WMTon","address":"0x82106347ddbb23ce44cf4ce4053ef1adf8b9323b","chainId":1,"decimals":18},
    {"name":"Blackrock, Inc.","symbol":"BLKon","address":"0x7a0f89c1606f71499950aa2590d547c3975b728e","chainId":1,"decimals":18},
    {"name":"Meta Platforms, Inc.","symbol":"METAon","address":"0x59644165402b611b350645555b50afb581c71eb2","chainId":1,"decimals":18},
    {"name":"Chevron Corporation","symbol":"CVXon","address":"0x8f3e41b378ae010c46d255f36bfc1d303b52dceb","chainId":1,"decimals":18},
    {"name":"Circle Internet Group","symbol":"CRCLon","address":"0x3632dea96a953c11dac2f00b4a05a32cd1063fae","chainId":1,"decimals":18},
    {"name":"Cisco Systems, Inc.","symbol":"CSCOon","address":"0x980a1001ee94e54142b231f44c7ca7c9df71fbe1","chainId":1,"decimals":18},
    {"name":"Visa Inc. Class A","symbol":"Von","address":"0xac37c20c1d0e5285035e056101a64e263ff94a41","chainId":1,"decimals":18},
    {"name":"Abbott Laboratories","symbol":"ABTon","address":"0x3859385363f7bb4dfe42811ccf3f294fcd41dd1d","chainId":1,"decimals":18},
    {"name":"Starbucks Corporation Common Stock","symbol":"SBUXon","address":"0xf15fbc1349ab99abad63db3f9a510bf413be3bef","chainId":1,"decimals":18},
    {"name":"Micron Technology","symbol":"MUon","address":"0x050362ab1072cb2ce74d74770e22a3203ad04ee5","chainId":1,"decimals":18},
    {"name":"Amazon.com, Inc.","symbol":"AMZNon","address":"0xbb8774fb97436d23d74c1b882e8e9a69322cfd31","chainId":1,"decimals":18},
    {"name":"ASML Holding NV","symbol":"ASMLon","address":"0xe51ba774ebf6392c45bf1d9e6b334d07992460d3","chainId":1,"decimals":18},
    {"name":"Palo Alto Networks","symbol":"PANWon","address":"0x34bfdff25f0fda6d3ad0c33f1e06c0d40bd68885","chainId":1,"decimals":18},
    {"name":"Linde plc","symbol":"LINon","address":"0x01b19c68f8a9ee3a480da788ba401cfabdf19b93","chainId":1,"decimals":18},
    {"name":"Intuit","symbol":"INTUon","address":"0x6cc0afd51ce4cb6920b775f3d6376ab82b9a93bb","chainId":1,"decimals":18},
    {"name":"ServiceNow","symbol":"NOWon","address":"0x8bcf9012f4b0c1c3d359edb7133c294f82f80790","chainId":1,"decimals":18},
    {"name":"PayPal Holdings, Inc. Common Stock","symbol":"PYPLon","address":"0x4efd92f372898b57f292de69fce377dd7d912bdd","chainId":1,"decimals":18},
    {"name":"General Electric","symbol":"GEon","address":"0xd904bcf89b7cedf5c89f9df7e829191d695f847e","chainId":1,"decimals":18},
    {"name":"Super Micro Computer","symbol":"SMCIon","address":"0x2ca12a3f9635fd69c21580def14f25c210ca9612","chainId":1,"decimals":18},
    {"name":"Alibaba","symbol":"BABAon","address":"0x41765f0fcddc276309195166c7a62ae522fa09ef","chainId":1,"decimals":18},
    {"name":"Accenture plc Class A","symbol":"ACNon","address":"0xaba9ae731aad63335c604e5f6e6a5db2e05f549d","chainId":1,"decimals":18},
    {"name":"Marvell Technology, Inc.","symbol":"MRVLon","address":"0xf404e5f887dbd5508e16a1198fcdd5de1a4296b8","chainId":1,"decimals":18},
    {"name":"Nike","symbol":"NKEon","address":"0xd8e26fcc879b30cb0a0b543925a2b3500f074d81","chainId":1,"decimals":18},
    {"name":"Petrobras","symbol":"PBRon","address":"0xd08ddb436e731f32455fe302723ee0fd2e9e8706","chainId":1,"decimals":18},
    {"name":"Equinix","symbol":"EQIXon","address":"0x73d2ccee12c120e7da265a2de9d9f952a0101b4f","chainId":1,"decimals":18},
    {"name":"Baidu","symbol":"BIDUon","address":"0x9d4c6ad12b55e4645b585209f90cc26614061e91","chainId":1,"decimals":18},
    {"name":"Wells Fargo","symbol":"WFCon","address":"0x4ad2118da8a65eaa81402a3d583fef6ee76bdf3f","chainId":1,"decimals":18},
    {"name":"Boeing Company","symbol":"BAon","address":"0x57270d35a840bc5c094da6fbeca033fb71ea6ab0","chainId":1,"decimals":18},
    {"name":"Futu Holdings","symbol":"FUTUon","address":"0x5ce215d9c37a195df88e294a06b8396c296b4e15","chainId":1,"decimals":18},
    {"name":"DoorDash","symbol":"DASHon","address":"0x241958c86c7744d15d5f6314ba1ea4c81dda2896","chainId":1,"decimals":18},
    {"name":"Chipotle","symbol":"CMGon","address":"0x25018520138bbab60684ad7983d4432e8b8e926b","chainId":1,"decimals":18},
    {"name":"Taiwan Semiconductor Manufacturing","symbol":"TSMon","address":"0x3cafdbfe682aec17d5ace2f97a2f3ab3dcf6a4a9","chainId":1,"decimals":18},
    {"name":"Broadcom Inc.","symbol":"AVGOon","address":"0x0d54d4279b9e8c54cd8547c2c75a8ee81a0bcae8","chainId":1,"decimals":18},
    {"name":"Airbnb","symbol":"ABNBon","address":"0xb035c3d5083bdc80074f380aebc9fcb68aba0a28","chainId":1,"decimals":18},
    {"name":"Mastercard Incorporated Class A","symbol":"MAon","address":"0xa29dc2102dfc2a0a4a5dcb84af984315567c9858","chainId":1,"decimals":18},
    {"name":"UnitedHealth Group","symbol":"UNHon","address":"0x075756f3b6381a79633438faa8964946bf40163d","chainId":1,"decimals":18},
    {"name":"Costco","symbol":"COSTon","address":"0x0c8276e4fec072cf7854be69c70f7773d1610857","chainId":1,"decimals":18},
    {"name":"JD.com","symbol":"JDon","address":"0xdeb6b89088ca9b7d7756087c8a0f7c6df46f319c","chainId":1,"decimals":18},
    {"name":"Netflix","symbol":"NFLXon","address":"0x032dec3372f25c41ea8054b4987a7c4832cdb338","chainId":1,"decimals":18},
    {"name":"D-Wave Quantum","symbol":"QBTSon","address":"0x3807562a482b824c08a564dfefcc471806d3e00a","chainId":1,"decimals":18},
    {"name":"American Express","symbol":"AXPon","address":"0x2bc7ff0c5da9f1a4a51f96e77c5b0f7165dc06d2","chainId":1,"decimals":18},
    {"name":"Disney","symbol":"DISon","address":"0xc3d93b45249e8e06cfeb01d25a96337e8893265d","chainId":1,"decimals":18},
    {"name":"Uber","symbol":"UBERon","address":"0x5bcd8195e3ef58f677aef9ebc276b5087c027050","chainId":1,"decimals":18},
    {"name":"Arm Holdings plc","symbol":"ARMon","address":"0x5bf1b2a808598c0ef4af1673a5457d86fe6d7b3d","chainId":1,"decimals":18},
    {"name":"Adobe","symbol":"ADBEon","address":"0x7042a8ffc7c7049684bfbc2fcb41b72380755a43","chainId":1,"decimals":18},
    {"name":"Goldman Sachs","symbol":"GSon","address":"0xdb57d9c14e357fc01e49035a808779df41e9b4e2","chainId":1,"decimals":18},
    {"name":"S&P Global","symbol":"SPGIon","address":"0xbc843b147db4c7e00721d76037b8b92e13afe13f","chainId":1,"decimals":18},
    {"name":"Salesforce","symbol":"CRMon","address":"0x55720ef5b023fd043ae5f8d2e526030207978950","chainId":1,"decimals":18},
    {"name":"iBoxx $ High Yield Corporate Bond ETF","symbol":"HYGon","address":"0xed3618bb8778f8ebbe2f241da532227591771d04","chainId":1,"decimals":18},
    {"name":"Snowflake","symbol":"SNOWon","address":"0x5d1a9a9b118ff19721e0111f094f2360b6ef7a2f","chainId":1,"decimals":18},
    {"name":"Qualcomm","symbol":"QCOMon","address":"0xe3419710c1f77d44b4dab02316d3f048818c4e59","chainId":1,"decimals":18},
    {"name":"MercadoLibre","symbol":"MELIon","address":"0x2816169a49953c548bfeb3948dcf05c4a0e4657d","chainId":1,"decimals":18},
    {"name":"Apollo Global Management","symbol":"APOon","address":"0x4d21affd27183b07335935f81a5c26b6a5a15355","chainId":1,"decimals":18},
    {"name":"Oracle","symbol":"ORCLon","address":"0x8a23c6baadb88512b30475c83df6a63881e33e1e","chainId":1,"decimals":18},
    {"name":"Spotify","symbol":"SPOTon","address":"0x590f21186489ca1612f49a4b1ff5c66acd6796a9","chainId":1,"decimals":18},
    {"name":"Palantir Technologies","symbol":"PLTRon","address":"0x0c666485b02f7a87d21add7aeb9f5e64975aa490","chainId":1,"decimals":18},
    {"name":"Shopify","symbol":"SHOPon","address":"0x908266c1192628371cff7ad2f5eba4de061a0ac5","chainId":1,"decimals":18},
    {"name":"Reddit","symbol":"RDDTon","address":"0xa9431d354cfad3c6b76e50f0e73b43d48be80cd0","chainId":1,"decimals":18},
    {"name":"Coinbase","symbol":"COINon","address":"0xf042cfa86cf1d598a75bdb55c3507a1f39f9493b","chainId":1,"decimals":18},
    {"name":"Robinhood Markets","symbol":"HOODon","address":"0x998f02a9e343ef6e3e6f28700d5a20f839fd74e6","chainId":1,"decimals":18},
    {"name":"MicroStrategy","symbol":"MSTRon","address":"0xcabd955322dfbf94c084929ac5e9eca3feb5556f","chainId":1,"decimals":18},
    {"name":"Riot Platforms","symbol":"RIOTon","address":"0x21deafd91116fce9fe87c8f15bde03f99a309b72","chainId":1,"decimals":18},
    {"name":"Figma","symbol":"FIGon","address":"0x073e7a0669833d356fa88ca65cc6d454efaaa3c5","chainId":1,"decimals":18},
    {"name":"Marathon Digital Holdings","symbol":"MARAon","address":"0x4604b0b581269843ac7a6b70a5fc019e7762e511","chainId":1,"decimals":18},
    {"name":"Hims & Hers Health","symbol":"HIMSon","address":"0xca468554e5c0423ee858fe3942c9568c51fcaa79","chainId":1,"decimals":18},
    {"name":"AppLovin","symbol":"APPon","address":"0xd5c5b2883735fa9b658dd52e2fcc8d7c0f1a42ce","chainId":1,"decimals":18},
    {"name":"GameStop","symbol":"GMEon","address":"0x71d24baeb0a033ec5f90ff65c4210545af378d97","chainId":1,"decimals":18},
    {"name":"SharpLink Gaming","symbol":"SBETon","address":"0xfdb46864a7c476f0914c5e82cded3364a9f56f8a","chainId":1,"decimals":18},
    {"name":"Grindr","symbol":"GRNDon","address":"0xe5b26ba77e6a4d79a7c54a5296d81254269d9700","chainId":1,"decimals":18},
    {"name":"Morgan Stanley","symbol":"MSon","address":"0xb7cba7593baafffc96f9bbc86e578026369dec55","chainId":1,"decimals":18},
    {"name":"Unilever","symbol":"ULon","address":"0x1598f7d25d0b0e1261eab9bd2ad7924291eb26bb","chainId":1,"decimals":18},
    {"name":"Comcast","symbol":"CMCSAon","address":"0x85fd8dfd987988ede1777935d9d09c7ac7f09f0b","chainId":1,"decimals":18},
    {"name":"Sony","symbol":"SONYon","address":"0xaf1382692f9927fd6a6c25add60285628a1879e5","chainId":1,"decimals":18}
  ], []);

  // Helper function to normalize logoURI (handle relative URLs and IPFS URLs)
  const normalizeLogoURI = useCallback((logoURI: string | undefined): string | undefined => {
    if (!logoURI) return undefined;
    
    // Convert IPFS URLs to HTTPS gateway URLs
    // Format: ipfs://QmXttGpZrECX5qCyXbBQiqgQNytVGeZW5Anewvh2jc4psg
    // Convert to: https://ipfs.io/ipfs/QmXttGpZrECX5qCyXbBQiqgQNytVGeZW5Anewvh2jc4psg
    if (logoURI.startsWith('ipfs://')) {
      const ipfsHash = logoURI.replace('ipfs://', '');
      // Use ipfs.io gateway (already configured in next.config.mjs)
      return `https://ipfs.io/ipfs/${ipfsHash}`;
    }
    
    // If it's already an absolute URL (starts with http:// or https://), return as-is
    // This handles URLs from coin-images.coingecko.com and other external sources
    if (logoURI.startsWith('http://') || logoURI.startsWith('https://')) {
      return logoURI;
    }
    
    // If it's a relative URL starting with /, resolve it relative to the current origin
    if (logoURI.startsWith('/')) {
      return typeof window !== 'undefined' ? `${window.location.origin}${logoURI}` : logoURI;
    }
    
    // For other relative URLs, return as-is (they might be handled elsewhere)
    return logoURI;
  }, []);

  // Fetch logo URLs for tokens that don't have logoURI
  const fetchTokenLogos = useCallback(async (tokensToFetch: Token[]) => {
    const tokensNeedingLogos = tokensToFetch.filter(
      token => !token.logoURI && token.address
    );

    if (tokensNeedingLogos.length === 0) return;

    // Process tokens in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < tokensNeedingLogos.length; i += batchSize) {
      const batch = tokensNeedingLogos.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (token) => {
          const key = `${token.chainId}-${token.address.toLowerCase()}`;
          
          // Check localStorage cache first
          const cachedLogo = loadLogoCache().get(key);
          if (cachedLogo !== undefined) {
            // Normalize cached logo URL (convert IPFS URLs to HTTPS gateway URLs)
            const normalizedCachedLogo = normalizeLogoURI(cachedLogo || undefined) || cachedLogo;
            // Found in cache, use it
            setLogoUrls(prev => {
              const newMap = new Map(prev);
              newMap.set(key, normalizedCachedLogo);
              logoUrlsRef.current = newMap;
              return newMap;
            });
            return; // Skip API call
          }
          
          // Check if already fetched or currently fetching using refs
          if (logoUrlsRef.current.has(key) || fetchingLogosRef.current.has(key)) {
            return; // Skip if already fetched or currently fetching
          }

          // Mark as fetching
          setFetchingLogos(prev => {
            const newSet = new Set(prev);
            newSet.add(key);
            fetchingLogosRef.current = newSet;
            return newSet;
          });

          try {
            const graphQLChain = getGraphQLChainName(token.chainId);
            const result = await getTokenLogoUrl(token.address, graphQLChain);
            
            // Normalize the logo URL (convert IPFS URLs to HTTPS gateway URLs)
            const normalizedLogoUrl = normalizeLogoURI(result.logoUrl || undefined) || null;
            
            // Save to localStorage cache
            saveLogoToCache(key, normalizedLogoUrl);
            
            // Update logo URLs map
            setLogoUrls(prev => {
              const newMap = new Map(prev);
              newMap.set(key, normalizedLogoUrl);
              logoUrlsRef.current = newMap;
              return newMap;
            });
          } catch (error) {
            // Silently fail - token will just not have a logo
            console.debug(`Failed to fetch logo for ${token.symbol}:`, error);
            
            // Cache null value to avoid retrying failed lookups
            saveLogoToCache(key, null);
            
            setLogoUrls(prev => {
              const newMap = new Map(prev);
              newMap.set(key, null);
              logoUrlsRef.current = newMap;
              return newMap;
            });
          } finally {
            // Remove from fetching set
            setFetchingLogos(prev => {
              const newSet = new Set(prev);
              newSet.delete(key);
              fetchingLogosRef.current = newSet;
              return newSet;
            });
          }
        })
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < tokensNeedingLogos.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }, [normalizeLogoURI]);

  // Standard tokens (USDC, USDT, DAI, etc.)
  const standardTokens: Token[] = useMemo(() => [
    {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      chainId: 1,
      logoURI: "/usdc.png",
    },
    {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      chainId: 1,
      logoURI: "/usdt.png",
    },
    {
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      symbol: "DAI",
      name: "Dai Stablecoin",
      decimals: 18,
      chainId: 1,
      logoURI: "/dai.png",
    },
  ], []);

  // Helper function to process and set tokens
  const processAndSetTokens = useCallback((apiTokens: Token[]) => {
    const cowChainId = getCowChainId(chainId);
    const chainTokens = apiTokens.filter(token => token.chainId === cowChainId);
    
    // Filter Vaulto tokens by current chain ID
    const vaultoChainTokens = vaultoTokens.filter(token => token.chainId === cowChainId);
    
    // Filter standard tokens by current chain ID (or use mainnet as fallback)
    const standardChainTokens = standardTokens.filter(token => 
      token.chainId === cowChainId || (cowChainId !== 1 && token.chainId === 1)
    );
    
    // Combine all tokens and remove duplicates
    // Priority: API tokens (chainTokens) first, then standard tokens, then Vaulto tokens
    // This ensures tokens with logoURI from API are preserved
    const allTokens = [...chainTokens, ...standardChainTokens, ...vaultoChainTokens];
    const uniqueTokens = allTokens.reduce((acc, token) => {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      const existing = acc.get(key);
      
      // If token doesn't exist yet, add it
      if (!existing) {
        const normalizedToken = {
          ...token,
          logoURI: normalizeLogoURI(token.logoURI)
        };
        acc.set(key, normalizedToken);
      } else {
        // If token exists but new one has logoURI and existing doesn't, prefer the one with logoURI
        const normalizedLogoURI = normalizeLogoURI(token.logoURI);
        if (normalizedLogoURI && !existing.logoURI) {
          acc.set(key, {
            ...existing,
            logoURI: normalizedLogoURI
          });
        }
      }
      return acc;
    }, new Map<string, Token>());
    
    const finalTokens = Array.from(uniqueTokens.values());
    
    // Log tokens with logoURI for debugging
    const tokensWithLogos = finalTokens.filter(t => t.logoURI);
    console.log('TokenSearch: Processed tokens', {
      chainId,
      cowChainId,
      apiTokensCount: apiTokens.length,
      chainTokensCount: chainTokens.length,
      vaultoChainTokensCount: vaultoChainTokens.length,
      standardChainTokensCount: standardChainTokens.length,
      finalTokensCount: finalTokens.length,
      tokensWithLogoURICount: tokensWithLogos.length,
      sampleTokens: finalTokens.slice(0, 5).map(t => ({ 
        symbol: t.symbol, 
        name: t.name, 
        hasLogoURI: !!t.logoURI,
        logoURI: t.logoURI 
      })),
      sampleTokensWithLogos: tokensWithLogos.slice(0, 3).map(t => ({
        symbol: t.symbol,
        logoURI: t.logoURI
      }))
    });
    setTokens(finalTokens);
    
    // Fetch logos for tokens that don't have logoURI
    fetchTokenLogos(finalTokens);
  }, [chainId, fetchTokenLogos, standardTokens, vaultoTokens, normalizeLogoURI]);

  // Fetch tokens from API
  useEffect(() => {
    // For private tab, use private tokens only
    if (activeTab === 'private') {
      const fetchPrivateTokensWithData = async () => {
        setIsLoading(true);
        // Set tokens first to show them immediately
        setTokens(privateTokens);
        fetchTokenLogos(privateTokens);
        
        // Fetch liquidity/marketcap data for private tokens
        try {
          const addresses = privateTokens.map((token) => token.address);
          const tokenData = await fetchSolanaTokenData(addresses);
          
          // Create a map for quick lookup
          const dataMap = new Map(
            tokenData.map((data) => [data.address, data])
          );
          
          // Enrich private tokens with fetched data
          const enrichedTokens = privateTokens.map((token) => {
            const data = dataMap.get(token.address);
            if (data) {
              return {
                ...token,
                tvlUSD: data.tvlUSD,
                volumeUSD: data.volumeUSD,
                marketCap: data.marketCap,
                marketCapFormatted: data.marketCapFormatted,
              };
            }
            return token;
          });
          
          setTokens(enrichedTokens);
        } catch (error) {
          console.error('Error enriching private tokens with data:', error);
          // Continue with unenriched tokens on error
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchPrivateTokensWithData();
      return;
    }

    const fetchTokens = async () => {
      setIsLoading(true);
      const allTokens: Token[] = [];
      
      try {
        // Fetch all token sources in parallel
        const fetchPromises = [
          // Try Uniswap token list first (primary source)
          fetch('https://ipfs.io/ipns/tokens.uniswap.org')
            .then(async (response) => {
              if (response.ok) {
                const data = await response.json();
                const uniswapTokens: Token[] = data.tokens || [];
                if (uniswapTokens.length > 0) {
                  const tokensWithLogos = uniswapTokens.filter(t => t.logoURI);
                  console.log('TokenSearch: Loaded tokens from Uniswap list (primary source)', {
                    chainId,
                    uniswapTokensCount: uniswapTokens.length,
                    tokensWithLogoURICount: tokensWithLogos.length,
                    sampleTokens: uniswapTokens.slice(0, 3).map(t => ({ 
                      symbol: t.symbol, 
                      chainId: t.chainId,
                      hasLogoURI: !!t.logoURI,
                      logoURI: t.logoURI 
                    }))
                  });
                  return uniswapTokens;
                }
              } else {
                console.warn('TokenSearch: Uniswap list response not OK', { status: response.status, statusText: response.statusText });
              }
              return [];
            })
            .catch((error) => {
              console.warn('TokenSearch: Error fetching Uniswap token list:', error);
              return [];
            }),
          
          // Try static token-list.json file
          fetch('/token-list.json')
            .then(async (response) => {
              if (response.ok) {
                const data = await response.json();
                // Handle both API format { tokens: [...] } and file format { name, version, tokens: [...] }
                const staticTokens: Token[] = data.tokens || [];
                if (staticTokens.length > 0) {
                  console.log('TokenSearch: Loaded tokens from static file', {
                    chainId,
                    staticTokensCount: staticTokens.length,
                    sampleTokens: staticTokens.slice(0, 3).map(t => ({ symbol: t.symbol, chainId: t.chainId }))
                  });
                  return staticTokens;
                }
              } else {
                console.warn('TokenSearch: Static file response not OK', { status: response.status, statusText: response.statusText });
              }
              return [];
            })
            .catch((error) => {
              console.warn('TokenSearch: Error fetching token list from static file:', error);
              return [];
            })
        ];

        // Wait for all fetches to complete
        const tokenArrays = await Promise.all(fetchPromises);
        
        // Combine all tokens from different sources
        tokenArrays.forEach(tokens => {
          if (tokens && tokens.length > 0) {
            allTokens.push(...tokens);
          }
        });

        // Process and set tokens if we got any from external sources
        if (allTokens.length > 0) {
          console.log('TokenSearch: Combined tokens from all sources', {
            chainId,
            totalTokensCount: allTokens.length,
            sources: ['Uniswap List', 'Static File'].filter((_, i) => tokenArrays[i]?.length > 0)
          });
          processAndSetTokens(allTokens);
        } else {
          // Final fallback to hardcoded tokens only
          console.warn('TokenSearch: Using hardcoded token fallback - all external sources unavailable');
          const cowChainId = getCowChainId(chainId);
          const fallbackTokens = [
            ...standardTokens.filter(t => t.chainId === cowChainId || (cowChainId !== 1 && t.chainId === 1)),
            ...vaultoTokens.filter(t => t.chainId === cowChainId)
          ];
          console.log('TokenSearch: Using fallback tokens', {
            chainId,
            cowChainId,
            fallbackTokensCount: fallbackTokens.length,
            sampleTokens: fallbackTokens.slice(0, 3).map(t => ({ symbol: t.symbol, chainId: t.chainId }))
          });
          setTokens(fallbackTokens);
          fetchTokenLogos(fallbackTokens);
        }
      } catch (error) {
        console.error('TokenSearch: Unexpected error fetching tokens:', error);
        // Fallback to hardcoded tokens on unexpected error
        const cowChainId = getCowChainId(chainId);
        const fallbackTokens = [
          ...standardTokens.filter(t => t.chainId === cowChainId || (cowChainId !== 1 && t.chainId === 1)),
          ...vaultoTokens.filter(t => t.chainId === cowChainId)
        ];
        setTokens(fallbackTokens);
        fetchTokenLogos(fallbackTokens);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTokens();
  }, [chainId, processAndSetTokens, fetchTokenLogos, standardTokens, vaultoTokens, activeTab, privateTokens]);

  // Periodic refresh for private token market cap data
  useEffect(() => {
    // Only set up periodic refresh when private tab is active
    if (activeTab !== 'private') {
      return;
    }

    const refreshPrivateTokensData = async () => {
      try {
        const addresses = privateTokens.map((token) => token.address);
        const tokenData = await fetchSolanaTokenData(addresses);
        
        // Create a map for quick lookup
        const dataMap = new Map(
          tokenData.map((data) => [data.address, data])
        );
        
        // Enrich private tokens with fetched data
        setTokens((currentTokens) => {
          return currentTokens.map((token) => {
            const data = dataMap.get(token.address);
            if (data) {
              return {
                ...token,
                tvlUSD: data.tvlUSD,
                volumeUSD: data.volumeUSD,
                marketCap: data.marketCap,
                marketCapFormatted: data.marketCapFormatted,
              };
            }
            return token;
          });
        });
      } catch (error) {
        console.error('Error refreshing private tokens data:', error);
        // Silently fail - don't disrupt the UI
      }
    };

    // Refresh immediately on mount, then every 30 seconds
    refreshPrivateTokensData();
    const intervalId = setInterval(refreshPrivateTokensData, 30000);

    // Cleanup interval on unmount or tab switch
    return () => {
      clearInterval(intervalId);
    };
  }, [activeTab, privateTokens]);

  // Default tokens to show when search is first opened
  const getDefaultTokens = useCallback((): Token[] => {
    const cowChainId = getCowChainId(chainId);
    const defaultSymbols = ['NVDAon', 'PLTRon', 'AAPLon', 'SPYon'];
    
    // Find default tokens from the loaded tokens list, matching current chain
    const defaultTokens = defaultSymbols
      .map(symbol => tokens.find(token => 
        token.symbol === symbol && token.chainId === cowChainId
      ))
      .filter((token): token is Token => token !== undefined);
    
    // Limit to 4 on mobile
    return isMobile ? defaultTokens.slice(0, 4) : defaultTokens;
  }, [tokens, chainId, isMobile]);

  // Enrich default tokens with Uniswap liquidity data
  const enrichDefaultTokensWithUniswapData = useCallback(async (
    defaultTokens: Token[]
  ): Promise<Token[]> => {
    if (defaultTokens.length === 0 || !isChainSupported(chainId)) {
      return defaultTokens;
    }

    try {
      // Create a map to deduplicate tokens by address
      const tokenMap = new Map<string, Token>();
      
      // Add default tokens first
      defaultTokens.forEach((token) => {
        const key = `${token.chainId}-${token.address.toLowerCase()}`;
        tokenMap.set(key, token);
      });

      // Fetch Uniswap liquidity data for each default token
      // We'll search by each token's symbol
      const enrichmentPromises = defaultTokens.map(async (token) => {
        try {
          const liquidityData = await fetchUniswapLiquidity(chainId, token.symbol);
          
          if (liquidityData.tokens && liquidityData.tokens.length > 0) {
            // Find the matching token in the Uniswap results by address
            const matchingLiquidityToken = liquidityData.tokens.find(
              (lt) => lt.address.toLowerCase() === token.address.toLowerCase()
            );
            
            if (matchingLiquidityToken) {
              const uniswapToken = liquidityTokenToSearchResult(matchingLiquidityToken, chainId);
              const key = `${uniswapToken.chainId}-${uniswapToken.address.toLowerCase()}`;
              const existing = tokenMap.get(key);
              
              if (existing) {
                // Merge: keep local token data but add Uniswap TVL/volume/pools
                tokenMap.set(key, {
                  ...existing,
                  tvlUSD: uniswapToken.tvlUSD,
                  volumeUSD: uniswapToken.volumeUSD,
                  pools: uniswapToken.pools,
                });
              }
            }
          }
        } catch (error) {
          // Silently fail for individual tokens, continue with others
          console.debug(`Failed to enrich ${token.symbol} with Uniswap data:`, error);
        }
      });

      await Promise.all(enrichmentPromises);

      // Convert map back to array and maintain original order
      const enrichedTokens = defaultTokens.map((token) => {
        const key = `${token.chainId}-${token.address.toLowerCase()}`;
        return tokenMap.get(key) || token;
      });

      return enrichedTokens;
    } catch (error) {
      console.error('Error enriching default tokens with Uniswap data:', error);
      // Return original tokens on error
      return defaultTokens;
    }
  }, [chainId]);

  // Filter tokens based on search query with Uniswap integration
  useEffect(() => {
    // For private tab, use simplified filtering
    if (activeTab === 'private') {
      if (!searchQuery.trim()) {
        // Show all private tokens when search is open but no query
        if (isOpen) {
          // Use tokens state which has enriched data, but filter to only private tokens
          const privateTokenAddresses = new Set(privateTokens.map(t => t.address));
          const enrichedPrivateTokens = tokens.filter(t => privateTokenAddresses.has(t.address));
          setFilteredTokens(enrichedPrivateTokens);
        } else {
          setFilteredTokens([]);
        }
      } else {
        // Filter private tokens by name/symbol from enriched tokens
        const query = searchQuery.trim().toLowerCase();
        const privateTokenAddresses = new Set(privateTokens.map(t => t.address));
        const enrichedPrivateTokens = tokens.filter(t => privateTokenAddresses.has(t.address));
        const filtered = enrichedPrivateTokens.filter(token => 
          token.name.toLowerCase().includes(query) || 
          token.symbol.toLowerCase().includes(query)
        );
        setFilteredTokens(filtered);
      }
      setIsLoadingUniswap(false);
      return;
    }

    if (!searchQuery.trim()) {
      // Show default tokens when search is open but no query
      if (isOpen) {
        const defaultTokens = getDefaultTokens();
        
        // Enrich default tokens with Uniswap liquidity data
        if (defaultTokens.length > 0 && isChainSupported(chainId)) {
          setIsLoadingUniswap(true);
          enrichDefaultTokensWithUniswapData(defaultTokens)
            .then((enrichedTokens) => {
              // Sort enriched tokens by TVL (highest to lowest)
              const sortedTokens = enrichedTokens.sort((a, b) => {
                const aTVL = getSortTVL(a);
                const bTVL = getSortTVL(b);
                
                // Sort by TVL descending (highest to lowest)
                if (bTVL !== aTVL) {
                  return bTVL - aTVL;
                }
                
                // If TVL is equal (including both 0), fallback to alphabetical by symbol
                return a.symbol.localeCompare(b.symbol);
              });
              
              setFilteredTokens(sortedTokens);
              setIsLoadingUniswap(false);
            })
            .catch((error) => {
              console.error('Error enriching default tokens:', error);
              // Fallback to unenriched tokens
              setFilteredTokens(defaultTokens);
              setIsLoadingUniswap(false);
            });
        } else {
          // No enrichment needed or not supported
          setFilteredTokens(defaultTokens);
          setIsLoadingUniswap(false);
        }
      } else {
        setFilteredTokens([]);
        setIsLoadingUniswap(false);
      }
      return;
    }

    const query = searchQuery.trim();
    const queryLower = query.toLowerCase();

    // Cancel previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Check if query is an Ethereum address
    if (isEthereumAddress(query)) {
      // Show address result (existing logic - can be enhanced later)
      const addressToken = tokens.find(
        (token) => token.address.toLowerCase() === queryLower
      );
      setFilteredTokens(addressToken ? [addressToken] : []);
      setIsLoadingUniswap(false);
      return;
    }

    // Debounce search with 400ms delay
    const debounceTimer = setTimeout(async () => {
      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();
      const currentAbortController = abortControllerRef.current;

      // Filter local tokens
      const filteredLocal = tokens.filter((token) => {
        const symbolMatch = token.symbol.toLowerCase().includes(queryLower);
        const nameMatch = token.name.toLowerCase().includes(queryLower);
        return symbolMatch || nameMatch;
      });

      // Create a map to deduplicate tokens by address
      const tokenMap = new Map<string, Token>();
      
      // Add local tokens first
      filteredLocal.forEach((token) => {
        const key = `${token.chainId}-${token.address.toLowerCase()}`;
        if (!tokenMap.has(key)) {
          tokenMap.set(key, token);
        }
      });

      // Fetch Uniswap liquidity if chain is supported
      let uniswapTokens: Token[] = [];
      if (isChainSupported(chainId)) {
        setIsLoadingUniswap(true);
        try {
          // Check if request was aborted before making the fetch
          if (currentAbortController.signal.aborted) {
            return;
          }

          const liquidityData = await fetchUniswapLiquidity(chainId, query);
          
          // Check again after fetch completes
          if (currentAbortController.signal.aborted) {
            return;
          }
          
          if (liquidityData.tokens && liquidityData.tokens.length > 0) {
            uniswapTokens = liquidityData.tokens.map((liquidityToken) =>
              liquidityTokenToSearchResult(liquidityToken, chainId)
            );
            
            // Merge Uniswap tokens into map (they take precedence for TVL/pool data)
            uniswapTokens.forEach((token) => {
              const key = `${token.chainId}-${token.address.toLowerCase()}`;
              const existing = tokenMap.get(key);
              
              if (existing) {
                // Merge: keep local token data but add Uniswap TVL/volume/pools
                tokenMap.set(key, {
                  ...existing,
                  tvlUSD: token.tvlUSD,
                  volumeUSD: token.volumeUSD,
                  pools: token.pools,
                });
              } else {
                // New token from Uniswap
                tokenMap.set(key, token);
              }
            });
          }
        } catch (error) {
          // Ignore abort errors
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
          console.error('Error fetching Uniswap liquidity:', error);
          // Continue with local tokens only
        } finally {
          // Only update loading state if this is still the current request
          if (!currentAbortController.signal.aborted) {
            setIsLoadingUniswap(false);
          }
        }
      }

      // Check if request was aborted before updating state
      if (currentAbortController.signal.aborted) {
        return;
      }

      // Convert map to array and sort by pool TVL (highest to lowest)
      const allTokens = Array.from(tokenMap.values()).sort((a, b) => {
        const aTVL = getSortTVL(a);
        const bTVL = getSortTVL(b);
        
        // Sort by TVL descending (highest to lowest)
        if (bTVL !== aTVL) {
          return bTVL - aTVL;
        }
        
        // If TVL is equal (including both 0), fallback to alphabetical by symbol
        return a.symbol.localeCompare(b.symbol);
      });

      // Limit to 4 results on mobile, 10 on desktop for performance
      const maxResults = isMobile ? 4 : 10;
      setFilteredTokens(allTokens.slice(0, maxResults));
    }, 400); // 400ms debounce

    return () => {
      clearTimeout(debounceTimer);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [searchQuery, tokens, isOpen, getDefaultTokens, isMobile, chainId, enrichDefaultTokensWithUniswapData, activeTab, privateTokens]);

  // Keyboard shortcuts: "/" to open search, "Escape" to close
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Escape key to close search dropdown
      if (event.key === 'Escape') {
        if (isOpen) {
          event.preventDefault();
          setIsOpen(false);
          setSearchQuery('');
          inputRef.current?.blur();
        }
        return;
      }

      // Handle "/" key to open search
      if (event.key !== '/') return;

      // Check if user is typing in another input/textarea/contenteditable
      const target = event.target as HTMLElement;
      const isInputElement = 
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable;

      // Don't trigger if user is typing in another input
      if (isInputElement && target !== inputRef.current) {
        return;
      }

      // Don't trigger if search is already focused
      if (document.activeElement === inputRef.current) {
        return;
      }

      // Prevent default behavior
      event.preventDefault();

      // Focus the search input and open it
      inputRef.current?.focus();
      setIsOpen(true);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Close dropdown when user scrolls
  useEffect(() => {
    const handleScroll = () => {
      if (isOpen) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        window.removeEventListener('scroll', handleScroll);
      };
    }
  }, [isOpen]);

  // Handle token selection - set up trading pair
  const handleTokenClick = (token: Token) => {
    const handler = (window as any).__handleTokenSelect;
    
    // Prepare token object with all necessary information
    const tokenForSwap: Token = {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      logoURI: token.logoURI,
      chainId: token.chainId,
    };
    
    if (handler && typeof handler === 'function') {
      console.log('Calling token selection handler:', { 
        symbol: tokenForSwap.symbol, 
        address: tokenForSwap.address,
        chainId: tokenForSwap.chainId,
        type: 'buy' 
      });
      handler(tokenForSwap, 'buy');
    } else {
      console.warn('Token selection handler not available. Widget may not be loaded yet.');
      // Retry after a short delay in case widget is still loading
      setTimeout(() => {
        const retryHandler = (window as any).__handleTokenSelect;
        if (retryHandler && typeof retryHandler === 'function') {
          console.log('Retrying token selection handler:', { 
            symbol: tokenForSwap.symbol,
            address: tokenForSwap.address,
            type: 'buy' 
          });
          retryHandler(tokenForSwap, 'buy');
        } else {
          console.error('Token selection handler still not available after retry');
        }
      }, 500);
    }
    setIsOpen(false);
    setSearchQuery('');
  };

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      setIsOpen(true);
    }
  }, []);

  // Notify parent when dropdown state changes
  useEffect(() => {
    onDropdownToggle?.(isOpen);
  }, [isOpen, onDropdownToggle]);

  const showResults = isOpen;

  return (
    <>
      <div ref={searchRef} className="relative w-full max-w-full md:max-w-sm mx-auto">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              setIsOpen(true);
            }}
            onBlur={() => {
              setIsFocused(false);
            }}
            className="w-full px-3 py-2.5 md:px-4 md:py-3 pl-10 md:pl-10 pr-10 md:pr-10 bg-gray-800/50 border border-gray-600/50 md:border-gray-600/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-yellow-400/50 md:focus:border-gray-500 focus:ring-1 focus:ring-yellow-400/30 md:focus:ring-gray-500 text-sm md:text-base transition-all duration-200 min-h-[44px]"
          />
          <svg
            className="absolute left-3 md:left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-4 md:h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {/* Keyboard shortcut hint - hidden on mobile */}
          {!isFocused && !searchQuery && (
            <div className="absolute right-3 md:right-3 top-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
              <kbd className="px-1.5 py-0.5 text-xs font-medium text-gray-400 bg-gray-700/50 border border-gray-600/50 rounded shadow-sm">
                /
              </kbd>
            </div>
          )}
        </div>

        {/* Dropdown Results */}
        {showResults && (
          <div className="absolute top-full left-0 right-0 mt-1 border border-gray-600/50 rounded-lg shadow-lg z-[60] max-h-[50vh] md:max-h-64 overflow-y-auto token-dropdown-scrollbar" style={{ backgroundColor: '#1f2937' }}>
            {isLoading || isLoadingUniswap ? (
              <div className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="relative w-6 h-6">
                  <div className="absolute inset-0 border-2 border-yellow-400/20 rounded-full"></div>
                  <div className="absolute inset-0 border-2 border-transparent border-t-yellow-400 rounded-full animate-spin"></div>
                </div>
                <span className="text-gray-400 text-sm">Loading tokens...</span>
              </div>
            ) : filteredTokens.length > 0 ? (
              <ul className="py-1.5 px-1.5 md:py-2 md:px-2">
                {filteredTokens.map((token) => {
                  const logoKey = `${token.chainId}-${token.address.toLowerCase()}`;
                  const fetchedLogoUrl = logoUrls.get(logoKey);
                  
                  // Prioritize logoURI from API/token data first, then fetched logo, then fallback
                  // logoURI should be used immediately if present - it's the highest priority source
                  const primaryLogoUrl = token.logoURI || fetchedLogoUrl || null;
                  const primaryFailed = primaryLogoUrl && failedImages.has(`${logoKey}-primary`);
                  
                  // Only use Uniswap fallback if:
                  // 1. We don't have a primary logo AND
                  // 2. We haven't already tried fetching (fetchedLogoUrl is not explicitly null) AND
                  // 3. We're not currently fetching (to avoid race conditions)
                  // If fetchedLogoUrl === null, it means we already tried Uniswap GraphQL and it failed,
                  // so we shouldn't try the Uniswap assets URL either (likely a custom token)
                  const isCurrentlyFetching = fetchingLogos.has(logoKey);
                  const shouldTryUniswapFallback = (!primaryLogoUrl || primaryFailed) && fetchedLogoUrl !== null && !isCurrentlyFetching;
                  const uniswapFallbackUrl = shouldTryUniswapFallback ? getUniswapAssetsUrl(token.chainId, token.address) : null;
                  const uniswapFailed = uniswapFallbackUrl && failedImages.has(`${logoKey}-uniswap`);
                  const displayLogoUrl = (!primaryFailed && primaryLogoUrl) || (!uniswapFailed && uniswapFallbackUrl) || null;
                  const showFallback = !displayLogoUrl;
                  
                  // Debug logging for logo display (only log first few to avoid spam)
                  if (filteredTokens.indexOf(token) < 3) {
                    console.debug('TokenSearch: Logo display', {
                      symbol: token.symbol,
                      hasLogoURI: !!token.logoURI,
                      logoURI: token.logoURI,
                      fetchedLogoUrl,
                      primaryLogoUrl,
                      displayLogoUrl,
                      showFallback
                    });
                  }
                  
                  // Generate fallback color from token symbol or address
                  const fallbackColor = generateColorFromSeed(token.symbol || token.address);
                  const fallbackTextColor = getContrastColor(fallbackColor);
                  const fallbackText = token.symbol?.slice(0, 3).toUpperCase() || token.name?.slice(0, 3).toUpperCase() || '?';
                  
                  return (
                    <li
                      key={`${token.chainId}-${token.address}`}
                      onClick={() => handleTokenClick(token)}
                      className="px-2 py-2 md:px-3 md:py-2.5 hover:bg-gray-600/50 rounded-lg cursor-pointer transition-colors duration-200 flex items-center gap-2 md:gap-3"
                    >
                      <div className="relative w-6 h-6 md:w-8 md:h-8 flex-shrink-0">
                        {!showFallback && displayLogoUrl ? (
                          <Image
                            src={displayLogoUrl}
                            alt={token.symbol}
                            width={24}
                            height={24}
                            className="w-6 h-6 md:w-8 md:h-8 rounded-full"
                            onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                              console.warn('TokenSearch: Failed to load logo', {
                                symbol: token.symbol,
                                logoUrl: displayLogoUrl,
                                logoURI: token.logoURI,
                                error: e
                              });
                              const failedKey = primaryLogoUrl && !primaryFailed 
                                ? `${logoKey}-primary` 
                                : `${logoKey}-uniswap`;
                              setFailedImages(prev => new Set(prev).add(failedKey));
                            }}
                            onLoad={() => {
                              if (filteredTokens.indexOf(token) < 2) {
                                console.debug('TokenSearch: Logo loaded successfully', {
                                  symbol: token.symbol,
                                  logoUrl: displayLogoUrl,
                                  logoURI: token.logoURI
                                });
                              }
                            }}
                          />
                        ) : null}
                        {/* Fallback circle - shown when no logo or all image sources fail */}
                        {showFallback && (
                          <div
                            className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] md:text-xs font-semibold"
                            style={{
                              backgroundColor: fallbackColor,
                              color: fallbackTextColor,
                            }}
                          >
                            {fallbackText}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {activeTab === 'private' ? (
                          // Display for private tokens - matches public token styling
                          <>
                            <div className="flex items-center justify-between gap-1 md:gap-2 mb-1 md:mb-1">
                              <div className="text-white text-sm md:text-sm font-medium">
                                {token.symbol}
                              </div>
                              <div className="flex items-center gap-1">
                                {(() => {
                                  // Show TVL from Jupiter if available
                                  const tvlValue = token.tvlUSD;
                                  const hasTVL = tvlValue !== undefined && tvlValue > 0;
                                  
                                  if (hasTVL) {
                                    return (
                                      <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                        {formatTVL(tvlValue)} <span className="text-[8px] md:text-[9px] text-white">TVL</span>
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                {(() => {
                                  // Show market cap - prioritize Jupiter formatted value, fall back to CoinGecko
                                  const marketCapFormatted = token.marketCapFormatted;
                                  const marketCapValue = token.marketCap;
                                  
                                  if (marketCapFormatted) {
                                    // Display Jupiter's formatted value with MCap label (e.g., "$472B MCap")
                                    return (
                                      <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                        {marketCapFormatted} <span className="text-[8px] md:text-[9px] text-white">MCap</span>
                                      </span>
                                    );
                                  } else if (marketCapValue !== undefined && marketCapValue > 0) {
                                    // Fall back to formatted CoinGecko value with MCap label
                                    return (
                                      <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                        {formatTVL(marketCapValue)} <span className="text-[8px] md:text-[9px] text-white">MCap</span>
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-1 md:gap-2 mb-1 md:mb-1">
                              <div className="text-gray-400 text-xs md:text-sm truncate">
                                <span className="block md:hidden">Prestock {token.name}</span>
                                <a
                                  href={`https://prestocks.com/${token.name.toLowerCase()}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="hidden md:inline text-gray-400 hover:text-yellow-400 transition-colors"
                                >
                                  Prestock {token.name}
                                </a>
                              </div>
                              {(() => {
                                const displayVolume = token.volumeUSD;
                                const hasVolume = displayVolume !== undefined && displayVolume > 0;
                                
                                if (hasVolume) {
                                  return (
                                    <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                      {formatTVL(displayVolume)} <span className="text-[8px] md:text-[9px] text-white">24h</span>
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div className="flex items-center justify-between gap-1 md:gap-2">
                              <div className="flex items-center gap-1 md:gap-2">
                                <span className="text-gray-600 text-[10px] md:text-xs font-mono">{truncateAddress(token.address, 6, 4)}</span>
                                <div className="hidden md:flex items-center gap-0.5 md:gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(token.address);
                                      toast.success('Address copied!', {
                                        duration: 2000,
                                        style: {
                                          background: 'rgba(15, 23, 42, 0.95)',
                                          color: '#fff',
                                          border: '1px solid rgba(250, 204, 21, 0.3)',
                                        },
                                      });
                                    }}
                                    className="inline-flex items-center justify-center w-5 h-5 md:w-4 md:h-4 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 rounded transition-colors"
                                    title="Copy address"
                                    aria-label="Copy address"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth={2}
                                      stroke="currentColor"
                                      className="w-4 h-4 md:w-3 md:h-3"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                      />
                                    </svg>
                                  </button>
                                  <a
                                    href={`https://solscan.io/token/${token.address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center justify-center w-5 h-5 md:w-4 md:h-4 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 rounded transition-colors"
                                    title="View on Solscan"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth={2}
                                      stroke="currentColor"
                                      className="w-4 h-4 md:w-3 md:h-3"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                      />
                                    </svg>
                                  </a>
                                </div>
                              </div>
                              {(() => {
                                const displayVolume = token.volumeUSD;
                                const hasVolume = displayVolume !== undefined && displayVolume > 0;
                                
                                if (hasVolume) {
                                  return (
                                    <a
                                      href={`https://www.jup.ag/tokens/${token.address}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                      }}
                                      className="hidden md:inline-flex items-center justify-center min-h-[32px] md:min-h-[24px] px-2 text-[10px] font-semibold bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-300 hover:to-yellow-400 text-gray-800 rounded transition-all duration-200 shadow-sm shadow-yellow-500/25"
                                      title="View Jupiter price chart"
                                    >
                                      <span>More Info</span>
                                    </a>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </>
                        ) : (
                          // Full display for public tokens
                          <>
                            <div className="flex items-center justify-between gap-1 md:gap-2 mb-1 md:mb-1">
                              <div className="text-white text-sm md:text-sm font-medium">
                                {token.symbol}
                                {(() => {
                                  const poolPair = getTopPoolPair(token);
                                  if (poolPair) {
                                    return <span className="text-gray-400 font-normal text-[10px] md:text-xs"> ({poolPair})</span>;
                                  }
                                  return null;
                                })()}
                              </div>
                              {(() => {
                                const displayTVL = getDisplayTVL(token);
                                const hasTVL = displayTVL !== null && displayTVL > 0;
                                
                                if (hasTVL) {
                                  return (
                                    <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                      {formatTVL(displayTVL)} <span className="text-[8px] md:text-[9px] text-white">TVL</span>
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div className="flex items-center justify-between gap-1 md:gap-2 mb-1 md:mb-1">
                              <div className="text-gray-400 text-xs md:text-sm truncate">{token.name}</div>
                              {(() => {
                                const displayVolume = getDisplayVolume(token);
                                const hasVolume = displayVolume !== null && displayVolume > 0;
                                
                                if (hasVolume) {
                                  return (
                                    <span className="px-1.5 py-0.5 md:px-1 md:py-0.25 text-[9px] md:text-[10px] font-medium bg-yellow-400/20 text-yellow-400 rounded flex-shrink-0">
                                      {formatTVL(displayVolume)} <span className="text-[8px] md:text-[9px] text-white">24h</span>
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div className="flex items-center justify-between gap-1 md:gap-2">
                              <div className="flex items-center gap-1 md:gap-2">
                                <span className="text-gray-600 text-[10px] md:text-xs font-mono">{truncateAddress(token.address, 6, 4)}</span>
                                <div className="hidden md:flex items-center gap-0.5 md:gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(token.address);
                                      toast.success('Address copied!', {
                                        duration: 2000,
                                        style: {
                                          background: 'rgba(15, 23, 42, 0.95)',
                                          color: '#fff',
                                          border: '1px solid rgba(250, 204, 21, 0.3)',
                                        },
                                      });
                                    }}
                                    className="inline-flex items-center justify-center w-5 h-5 md:w-4 md:h-4 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 rounded transition-colors"
                                    title="Copy address"
                                    aria-label="Copy address"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth={2}
                                      stroke="currentColor"
                                      className="w-4 h-4 md:w-3 md:h-3"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                      />
                                    </svg>
                                  </button>
                                  {(() => {
                                    const explorerUrl = getExplorerUrl(token.chainId, token.address);
                                    if (!explorerUrl) return null;
                                    return (
                                      <a
                                        href={explorerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center justify-center w-5 h-5 md:w-4 md:h-4 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 rounded transition-colors"
                                        title="View on Explorer"
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                          strokeWidth={2}
                                          stroke="currentColor"
                                          className="w-4 h-4 md:w-3 md:h-3"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                      </a>
                                    );
                                  })()}
                                </div>
                              </div>
                              {(() => {
                                const displayVolume = getDisplayVolume(token);
                                const hasVolume = displayVolume !== null && displayVolume > 0;
                                
                                if (hasVolume) {
                                  return (
                                    <Link
                                      href={`/token/${token.address}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                      }}
                                      prefetch={true}
                                      className="hidden md:inline-flex items-center justify-center min-h-[32px] md:min-h-[24px] px-2 text-[10px] font-semibold bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-300 hover:to-yellow-400 text-gray-800 rounded transition-all duration-200 shadow-sm shadow-yellow-500/25"
                                      title="View token details"
                                    >
                                      <span>More Info</span>
                                    </Link>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-center text-gray-400 text-sm">No tokens found</div>
            )}
          </div>
        )}
      </div>

    </>
  );
}

