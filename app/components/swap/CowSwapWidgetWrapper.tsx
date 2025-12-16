"use client";

import { CowSwapWidget } from '@cowprotocol/widget-react';
import type { CowSwapWidgetParams } from '@cowprotocol/widget-lib';
import { TradeType } from '@cowprotocol/widget-lib';
import { useChainId, useAccount, useConnectorClient } from 'wagmi';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  trackSwapWidgetLoaded,
  trackTokenSelected,
  trackSwapAmountChanged,
  trackSwapInitiated,
  trackSwapCompleted,
  trackSwapFailed,
  trackChainChanged,
} from '@/lib/utils/analytics';
import { getCowSwapTokenLists } from '@/lib/utils/tokenListValidation';

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
}

interface CowSwapWidgetWrapperProps {
  onTokenSelect?: (token: Token, type: 'sell' | 'buy') => void;
}

export default function CowSwapWidgetWrapper({ onTokenSelect }: CowSwapWidgetWrapperProps = {}) {
  const chainId = useChainId();
  const { isConnected, address, connector } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const [isMounted, setIsMounted] = useState(false);
  const prevChainIdRef = useRef<number | null>(null);
  const widgetLoadedRef = useRef(false);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const [sellToken, setSellToken] = useState<string>('USDC');
  const [buyToken, setBuyToken] = useState<string>('NVDAon');
  // Track widget initialization per chainId to prevent token list reloading
  const widgetInitializedRef = useRef<Set<number>>(new Set());
  // Token list URLs - start with validated fallback to ensure Vaulto list is always available
  // Start with fallback URL to ensure widget has tokens available immediately
  const [tokenLists, setTokenLists] = useState<string[]>([
    '/token-list.json', // Start with validated fallback Vaulto token list
  ]);
  // Track if token list validation has been completed
  const [tokenListsValidated, setTokenListsValidated] = useState(false);

  // Map wagmi chain IDs to CoW Swap supported chains
  const getCowChainId = useCallback((wagmiChainId: number): number => {
    switch (wagmiChainId) {
      case 1: // Ethereum Mainnet
        return 1;
      case 100: // Gnosis Chain
        return 100;
      case 11155111: // Sepolia
        return 11155111;
      case 42161: // Arbitrum One
        return 42161;
      case 10: // Optimism
        return 10;
      case 8453: // Base
        return 8453;
      case 137: // Polygon
        return 137;
      case 421614: // Arbitrum Sepolia
        return 421614;
      default:
        return 1; // Default to Ethereum Mainnet
    }
  }, []);

  // Get the provider - CowSwap widget needs EIP-1193 provider
  // Use connector provider first (works with RainbowKit/wagmi), fallback to window.ethereum
  const provider = useMemo(() => {
    if (!isMounted || !isConnected) {
      return null;
    }

    // Try to get provider from connector (works with RainbowKit/wagmi connectors)
    if (connector) {
      try {
        // For injected connectors, try to get provider from connector
        // Different connector types expose provider differently
        const connectorProvider = 
          (connector as any)?.provider || 
          (connector as any)?._provider || 
          (connectorClient as any)?.provider ||
          (connectorClient as any)?.connector?.provider;
        
        if (connectorProvider) {
          console.log('CowSwap Widget - Using provider from connector:', {
            connectorType: connector.name || 'unknown',
            connectorId: connector.id,
            hasProvider: !!connectorProvider,
          });
          return connectorProvider;
        }
      } catch (error) {
        console.warn('CowSwap Widget - Error accessing connector provider:', error);
      }
    }

    // Fallback to window.ethereum for injected wallets (MetaMask, Coinbase Wallet, etc.)
    if (typeof window !== 'undefined' && window.ethereum) {
      console.log('CowSwap Widget - Using window.ethereum as fallback');
      return window.ethereum;
    }

    console.warn('CowSwap Widget - No provider available', {
      isConnected,
      hasConnector: !!connector,
      connectorName: connector?.name,
      hasConnectorClient: !!connectorClient,
      hasWindowEthereum: typeof window !== 'undefined' ? !!window.ethereum : false,
    });
    return null;
  }, [isMounted, isConnected, connector, connectorClient]);

  // All hooks must be called before any conditional returns
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track widget load
  useEffect(() => {
    if (isMounted && !widgetLoadedRef.current) {
      const cowChainId = getCowChainId(chainId);
      trackSwapWidgetLoaded(cowChainId);
      widgetLoadedRef.current = true;
    }
  }, [isMounted, chainId, getCowChainId]);

  // Track chain changes
  useEffect(() => {
    if (prevChainIdRef.current !== null && prevChainIdRef.current !== chainId) {
      trackChainChanged(prevChainIdRef.current, chainId);
    }
    prevChainIdRef.current = chainId;
  }, [chainId]);

  // Monitor widget DOM for token selections and amount changes
  // Note: The CoW widget manages its own state, so we track via DOM observation
  useEffect(() => {
    if (!isMounted || !widgetContainerRef.current) return;

    let lastSellToken = '';
    let lastBuyToken = '';
    let lastSellAmount = '';
    let lastBuyAmount = '';

    const checkForChanges = () => {
      if (!widgetContainerRef.current) return;

      try {
        // Try to find token selectors and amount inputs in the widget
        // The CoW widget uses specific class names and structure
        const widget = widgetContainerRef.current.querySelector('[class*="widget"]') || widgetContainerRef.current;
        
        // Look for input fields that might contain token symbols or amounts
        const inputs = widget.querySelectorAll('input[type="text"], input[type="number"]');
        
        inputs.forEach((input) => {
          const value = (input as HTMLInputElement).value;
          const placeholder = (input as HTMLInputElement).placeholder?.toLowerCase() || '';
          const ariaLabel = (input as HTMLInputElement).getAttribute('aria-label')?.toLowerCase() || '';
          
          // Try to detect if this is a token selector or amount input
          if ((placeholder.includes('token') || placeholder.includes('select') || ariaLabel.includes('token')) && value) {
            // This might be a token selector
            if (value !== lastSellToken && value !== lastBuyToken) {
              // Determine if it's sell or buy based on position or context
              // For now, we'll track generically
              const tokenType = value === lastSellToken ? 'sell' : 'buy';
              trackTokenSelected(tokenType, value, undefined, getCowChainId(chainId));
              if (tokenType === 'sell') lastSellToken = value;
              else lastBuyToken = value;
            }
          } else if ((placeholder.includes('amount') || ariaLabel.includes('amount')) && value) {
            // This might be an amount input
            const amount = value;
            // Try to determine if it's sell or buy amount
            if (amount !== lastSellAmount && amount !== lastBuyAmount) {
              // We'll track as sell amount by default (can be enhanced)
              trackSwapAmountChanged('sell', amount, lastSellToken || 'unknown');
              lastSellAmount = amount;
            }
          }
        });
      } catch (error) {
        // Silently fail if we can't access widget internals
      }
    };

    // Use MutationObserver to watch for changes in the widget
    const observer = new MutationObserver(() => {
      checkForChanges();
    });

    if (widgetContainerRef.current) {
      observer.observe(widgetContainerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['value', 'data-token', 'data-amount', 'placeholder', 'aria-label'],
      });
    }

    return () => {
      observer.disconnect();
    };
  }, [isMounted, chainId, getCowChainId]);

  // Listen for transaction events from the wallet provider
  useEffect(() => {
    if (!isConnected || !address || typeof window === 'undefined' || !window.ethereum) return;

    // Intercept transaction requests to track swaps
    const originalRequest = window.ethereum.request;
    let pendingSwap: { sellToken: string; buyToken: string; sellAmount: string; buyAmount: string; txHash?: string } | null = null;

    // Override request to catch transaction sends
    if (originalRequest) {
      (window.ethereum as any).request = async (...args: any[]) => {
        const [request] = args;
        
        // Check if this is a transaction request (eth_sendTransaction)
        if (request && request.method === 'eth_sendTransaction') {
          const cowChainId = getCowChainId(chainId);
          
          // Try to extract token info from transaction data if available
          // For now, we'll track with generic values since widget state isn't accessible
          const sellToken = 'unknown'; // Would need widget API to get actual value
          const buyToken = 'unknown';
          const sellAmount = request.params?.[0]?.value || '0';
          const buyAmount = '0';
          
          // Track swap initiation
          trackSwapInitiated(
            sellToken,
            buyToken,
            sellAmount,
            buyAmount,
            cowChainId,
            address
          );

          // Store pending swap info
          pendingSwap = { sellToken, buyToken, sellAmount, buyAmount };

          // Try to get transaction hash from response
          try {
            const result = await originalRequest.apply(window.ethereum, args);
            
            if (result && typeof result === 'string') {
              // Transaction hash received
              pendingSwap.txHash = result;
              
              // Wait for transaction confirmation
              setTimeout(async () => {
                try {
                  // In production, you'd want to use a proper transaction watcher
                  // For now, we'll assume success after a delay
                  const cowChainId = getCowChainId(chainId);
                  
                  if (pendingSwap && pendingSwap.txHash) {
                    trackSwapCompleted(
                      pendingSwap.sellToken,
                      pendingSwap.buyToken,
                      pendingSwap.sellAmount,
                      pendingSwap.buyAmount,
                      cowChainId,
                      pendingSwap.txHash,
                      address
                    );
                    pendingSwap = null;
                  }
                } catch (error) {
                  // Transaction might have failed
                  if (pendingSwap) {
                    trackSwapFailed(
                      pendingSwap.sellToken,
                      pendingSwap.buyToken,
                      pendingSwap.sellAmount,
                      getCowChainId(chainId),
                      error instanceof Error ? error.message : 'Transaction failed',
                      address
                    );
                    pendingSwap = null;
                  }
                }
              }, 5000); // Wait 5 seconds for confirmation
            }
          } catch (error) {
            // Transaction failed
            if (pendingSwap) {
              trackSwapFailed(
                pendingSwap.sellToken,
                pendingSwap.buyToken,
                pendingSwap.sellAmount,
                getCowChainId(chainId),
                error instanceof Error ? error.message : 'Transaction failed',
                address
              );
              pendingSwap = null;
            }
          }
          
          return originalRequest.apply(window.ethereum, args);
        }
        
        return originalRequest.apply(window.ethereum, args);
      };
    }

    // Listen for transaction events
    const handleAccountsChanged = (accounts: string[]) => {
      // Wallet account changed
    };

    const handleChainChanged = (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      if (prevChainIdRef.current !== null) {
        trackChainChanged(prevChainIdRef.current, newChainId);
      }
    };

    // Set up event listeners
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    }

    return () => {
      // Restore original request method
      if (originalRequest && window.ethereum) {
        (window.ethereum as any).request = originalRequest;
      }
      
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [isConnected, address, chainId, getCowChainId]);

  // Debug logging for wallet connection and provider detection
  useEffect(() => {
    if (isConnected && address) {
      console.log('CowSwap Widget - Wallet Connected:', {
        address,
        chainId,
        cowChainId: getCowChainId(chainId),
        provider: !!provider,
        providerType: provider?.constructor?.name,
        connector: connector?.name || 'unknown',
        connectorId: connector?.id,
        connectorClient: !!connectorClient,
        isMounted,
        windowEthereum: typeof window !== 'undefined' ? !!window.ethereum : false,
      });
    } else if (!isConnected) {
      console.log('CowSwap Widget - Wallet Not Connected:', {
        isMounted,
        windowEthereum: typeof window !== 'undefined' ? !!window.ethereum : false,
      });
    }
  }, [isConnected, address, chainId, provider, connector, connectorClient, isMounted, getCowChainId]);

  // Validate token lists before widget renders to ensure Vaulto list is always available
  useEffect(() => {
    if (!isMounted || typeof window === 'undefined' || tokenListsValidated) return;

    // Validate token lists immediately (no delay) to ensure widget has correct lists from start
    const validateTokenLists = async () => {
      try {
        const validatedUrls = await getCowSwapTokenLists();

        // getCowSwapTokenLists guarantees at least Vaulto fallback is returned
        if (validatedUrls.length > 0) {
          // Always update with validated URLs (they may differ from initial fallback)
          // This ensures we use the primary URL if available, or validated fallback
          setTokenLists(validatedUrls);
          console.log('CowSwap Widget - Token lists validated and updated:', {
            count: validatedUrls.length,
            urls: validatedUrls,
          });
        }
        
        // Mark as validated (even if validation had issues, fallback is used)
        setTokenListsValidated(true);
      } catch (error) {
        console.error('CowSwap Widget - Error validating token lists (using fallback):', error);
        // Fallback is already set in initial state, mark as validated
        setTokenListsValidated(true);
      }
    };

    // Validate immediately - no delay
    validateTokenLists();
  }, [isMounted, tokenListsValidated]);

  // Handle token selection from header search
  const handleTokenSelect = useCallback((token: Token, type: 'sell' | 'buy') => {
    console.log('Token selected:', { token: token.symbol, type, address: token.address });
    const cowChainId = getCowChainId(chainId);
    
    if (type === 'sell') {
      setSellToken(token.symbol);
      // If buy token is same as sell token, reset buy token to default
      if (buyToken === token.symbol) {
        setBuyToken('NVDAon');
      }
      trackTokenSelected('sell', token.symbol, token.address, cowChainId);
    } else {
      setBuyToken(token.symbol);
      // Ensure sell token is set (default to USDC if not set or if same as buy token)
      if (!sellToken || sellToken === token.symbol) {
        setSellToken('USDC');
      }
      trackTokenSelected('buy', token.symbol, token.address, cowChainId);
    }
  }, [chainId, getCowChainId, buyToken, sellToken]);

  // Expose handler via ref for parent access
  const tokenSelectHandlerRef = useRef(handleTokenSelect);
  useEffect(() => {
    tokenSelectHandlerRef.current = handleTokenSelect;
  }, [handleTokenSelect]);

  // Expose handler to window for TokenSearch component
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__handleTokenSelect = (token: Token, type: 'sell' | 'buy') => {
        console.log('Token selection handler called:', { symbol: token.symbol, type });
        tokenSelectHandlerRef.current(token, type);
      };
      console.log('Token selection handler registered on window');
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__handleTokenSelect;
        console.log('Token selection handler removed from window');
      }
    };
  }, []);

  // Get stable chainId - use current chainId, default to 1 if not connected
  const cowChainId = useMemo(() => getCowChainId(chainId), [chainId, getCowChainId]);

  // Track window width for responsive widget sizing
  const [windowWidth, setWindowWidth] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const updateWidth = () => {
      setWindowWidth(window.innerWidth);
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Create params object with current token state
  // Note: params should be stable and not recalculate when isConnected changes
  // to prevent widget from reloading token lists
  // Token lists are stable - updates happen in background without remounting widget
  const params: CowSwapWidgetParams = useMemo(() => {
    // Construct absolute URL for images (computed inside useMemo to keep it stable)
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const mobileLogoUrl = `${baseUrl}/mobilelogo.png`;
    
    // Calculate responsive width - match container width exactly
    // Mobile: container uses 100% width, which equals viewport width minus 32px (2rem from px-4 padding)
    // Desktop: 392px (fixed width)
    let widgetWidth = '392px'; // Default desktop width
    if (typeof window !== 'undefined' && windowWidth !== null && windowWidth < 768) {
      // Calculate exact pixel width for mobile: viewport width - 32px (accounts for parent px-4 padding)
      // This matches the actual container width when using width: 100%
      const mobileWidth = windowWidth - 32;
      widgetWidth = `${mobileWidth}px`;
    }
    
    return {
      "appCode": "Vaulto Swap", // Name of your app (max 50 characters)
      "width": widgetWidth, // Responsive width - matches background shape exactly
      "height": "500px", // Optimized height for better mobile compatibility
      "chainId": cowChainId, // Dynamic chain based on user's connected chain
      "tokenLists": tokenLists, // Token lists (defaults first, updated in background)
      "tradeType": TradeType.SWAP, // Default to SWAP
      "sell": { // Sell token from search selection
        "asset": sellToken,  
        "amount": "100"
      },
      "buy": { // Buy token from search selection
        "asset": buyToken,
        "amount": "1"
      },
    "enabledTradeTypes": [ // Enable all trade types
      TradeType.SWAP,
      TradeType.LIMIT,
      TradeType.YIELD,
   
    ],
    "standaloneMode": false,
    "disableToastMessages": true,
    "disableProgressBar": false,
    "hideBridgeInfo": false,
    "hideOrdersTable": false,
    "hideLogo": false,
    "images": {
      // Only available image parameter: displays when orders table is empty
      "emptyOrders": mobileLogoUrl
    },
    "sounds": {
      "postOrder": null, // Disable moo sound when order is executed
      "orderExecuted": null, // Disable happy moo sound when order executes successfully
      "orderError": null, // Disable unhappy moo sound when order has an error
    },
      "partnerFee": { // 0.5% partner fee for all transactions
        "bps": 50, // 0.5%
        "recipient": "0x88902e56e83331379506A4313595f5B9075Ad3e0", // Fee destination address
      },
      "customTokens": [
        // Add some major tokens as custom tokens to ensure they're available
        {
          "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "symbol": "USDC",
          "name": "USD Coin",
          "decimals": 6,
          "chainId": 1
        },
        // Add common stablecoins for better token support
        {
          "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          "symbol": "USDT",
          "name": "Tether USD",
          "decimals": 6,
          "chainId": 1
        },
        {
          "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
          "symbol": "DAI",
          "name": "Dai Stablecoin",
          "decimals": 18,
          "chainId": 1
        },
  
    {
      "name": "SPDR S&P 500 ETF Trust",
      "symbol": "SPYon",
      "address": "0xfedc5f4a6c38211c1338aa411018dfaf26612c08",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68655/large/spyon_160x160.png?1756156354",
      "decimals": 18
    },
    {
      "name": "SPDR S&P 500 ETF Trust",
      "symbol": "SPYon",
      "address": "0x6a708ead771238919d85930b5a0f10454e1c331a",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Core S&P 500 ETF",
      "symbol": "IVVon",
      "address": "0x62ca254a363dc3c748e7e955c20447ab5bf06ff7",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68650/large/ivvon_160x160.png?1756156270",
      "decimals": 18
    },
    {
      "name": "iShares Core S&P 500 ETF",
      "symbol": "IVVon",
      "address": "0x1104eb7e85e25eb45f88e638b0c27a06c1a91cb2",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares 20+ Year Treasury Bond ETF",
      "symbol": "TLTon",
      "address": "0x992651bfeb9a0dcc4457610e284ba66d86489d4d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68647/large/tlton_160x160.png?1756156198",
      "decimals": 18
    },
    {
      "name": "iShares 20+ Year Treasury Bond ETF",
      "symbol": "TLTon",
      "address": "0xf69e40069ac227c11459e3f4e8a446b3401616b6",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "Invesco QQQ Trust",
      "symbol": "QQQon",
      "address": "0x0e397938c1aa0680954093495b70a9f5e2249aba",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68654/large/qqqon_160x160.png?1756156339",
      "decimals": 18
    },
    {
      "name": "Invesco QQQ Trust",
      "symbol": "QQQon",
      "address": "0x0cde6936d305d5b34667fc46425e852efd73559a",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "WisdomTree 500 Digital Fund",
      "symbol": "SPXUX",
      "address": "0x873d589f38abbcdd1fca27261aba2f1aa0661d44",
      "chainId": 1,
      "decimals": 18
    },
    {
      "name": "WisdomTree 500 Digital Fund",
      "symbol": "SPXUX",
      "address": "0x1a149e21bd3e74b7018db79c988b4ba3bbc1873d",
      "chainId": 10,
      "decimals": 18
    },
    {
      "name": "WisdomTree 500 Digital Fund",
      "symbol": "SPXUX",
      "address": "0x4122047076a1106618e984a8776a3f7bbcb1d429",
      "chainId": 42161,
      "decimals": 18
    },
    {
      "name": "WisdomTree 500 Digital Fund",
      "symbol": "SPXUX",
      "address": "0xfec440fdf48860ff6e2265bd1ef9cae8bb2cce8a",
      "chainId": 8453,
      "decimals": 18
    },
    {
      "name": "WisdomTree 500 Digital Fund",
      "symbol": "SPXUX",
      "address": "0x1a149e21bd3e74b7018db79c988b4ba3bbc1873d",
      "chainId": 43114,
      "decimals": 18
    },
    {
      "name": "iShares Core MSCI EAFE ETF",
      "symbol": "IEFAon",
      "address": "0xfeff7a377a86462f5a2a872009722c154707f09e",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68558/large/iefaon_160x160.png?1756105856",
      "decimals": 18
    },
    {
      "name": "iShares Core MSCI EAFE ETF",
      "symbol": "IEFAon",
      "address": "0x918008c3d29496c37b478b611967beaca365af36",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Core US Aggregate Bond ETF",
      "symbol": "AGGon",
      "address": "0xff7cf16aa2ffc463b996db2f7b7cf0130336899d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68561/large/aggon_160x160.png?1756105956",
      "decimals": 18
    },
    {
      "name": "iShares Core S&P Total US Stock Market ETF",
      "symbol": "ITOTon",
      "address": "0x0692481c369e2bdc728a69ae31b848343a4567be",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68543/large/itoton_160x160.png?1756105177",
      "decimals": 18
    },
    {
      "name": "iShares Core S&P Total US Stock Market ETF",
      "symbol": "ITOTon",
      "address": "0xcf9caf83053213c44dd7027db3e1e4ac98e55f8f",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares MSCI EAFE ETF",
      "symbol": "EFAon",
      "address": "0x4111b60bc87f2bd1e81e783e271d7f0ec6ee088b",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68555/large/efaon_160x160.png?1756105748",
      "decimals": 18
    },
    {
      "name": "iShares MSCI EAFE ETF",
      "symbol": "EFAon",
      "address": "0x38b9a53bfdc5dba58a29bd6992341927c2fca637",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Gold Trust",
      "symbol": "IAUon",
      "address": "0x4f0ca3df1c2e6b943cf82e649d576ffe7b2fabcf",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68653/large/iauon_160x160.png?1756156321",
      "decimals": 18
    },
    {
      "name": "iShares Gold Trust",
      "symbol": "IAUon",
      "address": "0xcb2a0f46f67dc4c58a316f1c008edef5c2311795",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Russell 1000 Growth ETF",
      "symbol": "IWFon",
      "address": "0x8d05432c2786e3f93f1a9a62b9572dbf54f3ea06",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68570/large/iwfon_160x160.png?1756106267",
      "decimals": 18
    },
    {
      "name": "iShares Russell 1000 Growth ETF",
      "symbol": "IWFon",
      "address": "0x40755f06ab7f8de1ab3a9413b1ef562d63de19b1",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Core MSCI Emerging Markets ETF",
      "symbol": "IEMGon",
      "address": "0xcdd60d15125bf3362b6838d2506b0fa33bc1a515",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68658/large/iemgon_160x160.png?1756156411",
      "decimals": 18
    },
    {
      "name": "iShares Core MSCI Emerging Markets ETF",
      "symbol": "IEMGon",
      "address": "0x22092c94a91d019ad15536725598b0a6be0a73c0",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares Silver Trust",
      "symbol": "SLVon",
      "address": "0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68651/large/slvon_160x160.png?1756156286",
      "decimals": 18
    },
    {
      "name": "iShares Silver Trust",
      "symbol": "SLVon",
      "address": "0x8b872732b07be325a8803cdb480d9d20b6f8d11b",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "iShares MSCI Emerging Markets ETF",
      "symbol": "EEMon",
      "address": "0x77a1a02e4a888ada8620b93c30de8a41e621126c",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68550/large/eemon_160x160.png?1756105571",
      "decimals": 18
    },
    {
      "name": "iShares MSCI Emerging Markets ETF",
      "symbol": "EEMon",
      "address": "0x00c81d35eddf44c75d4db9e07bdcdc236eb0ebcf",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "Tesla Inc. DL - 001",
      "symbol": "TSLAon",
      "address": "0xf6b1117ec07684d3958cad8beb1b302bfd21103f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68628/large/tslaon_160x160.png?1756130306",
      "decimals": 18
    },
    {
      "name": "iShares Russell 2000 Value ETF",
      "symbol": "IWNon",
      "address": "0x9dcf7f739b8c0270e2fc0cc8d0dabe355a150dba",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68540/large/iwnon_160x160.png?1756105013",
      "decimals": 18
    },
    {
      "name": "iShares Russell 2000 Value ETF",
      "symbol": "IWNon",
      "address": "0xf54b94ea21e1da5d51ef00fd4502225e5394f874",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "Lockheed Martin Corp.",
      "symbol": "LMTon",
      "address": "0x691b126cf619707ed5d16cab1b27c000aa8de300",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68618/large/lmton_160x160.png?1756130231",
      "decimals": 18
    },
    {
      "name": "Lockheed Martin Corp.",
      "symbol": "LMTon",
      "address": "0xd09f7b75b9659b864c6f82bb00ff096f9d277998",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "NVIDIA Corp",
      "symbol": "NVDAon",
      "address": "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68623/large/nvdaon_160x160.png?1756130268",
      "decimals": 18
    },
    {
      "name": "NVIDIA Corp",
      "symbol": "NVDAon",
      "address": "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "Eli Lilly and Company",
      "symbol": "LLYon",
      "address": "0xf192957ae52db3eb088654403cc2eded014ae556",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68643/large/llyon_160x160.png?1756156107",
      "decimals": 18
    },
    {
      "name": "Eli Lilly and Company",
      "symbol": "LLYon",
      "address": "0x341d31b2be1fee9c00e395a62ba41837f4322eed",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "The Coca-Cola Company",
      "symbol": "KOon",
      "address": "0x74a03d741226f738098c35da8188e57aca50d146",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68569/large/koon_160x160.png?1756106230",
      "decimals": 18
    },
    {
      "name": "The Coca-Cola Company",
      "symbol": "KOon",
      "address": "0x405f38b90bebf1259062cf29da299f3398662bcb",
      "chainId": 56,
      "decimals": 18
    },
    {
      "name": "Apple Inc.",
      "symbol": "AAPLon",
      "address": "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68616/large/aaplon_160x160.png?1756130122",
      "decimals": 18
    },
    {
      "name": "Pfizer Inc.",
      "symbol": "PFEon",
      "address": "0x06954faa913fa14c28eb1b2e459594f22f33f3de",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68549/large/pfeon_160x160.png?1756105512",
      "decimals": 18
    },
    {
      "name": "The Procter & Gamble Company",
      "symbol": "PGon",
      "address": "0x339ce23a355ed6d513dd3e1462975c4ecd86823a",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68593/large/pgon_160x160.png?1756129875",
      "decimals": 18
    },
    {
      "name": "McDonald's Corporation",
      "symbol": "MCDon",
      "address": "0x4c82c8cd9a218612dce60b156b73a36705645e3b",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68620/large/mcdon_160x160.png?1756130244",
      "decimals": 18
    },
    {
      "name": "iShares Core S&P MidCap ETF",
      "symbol": "IJHon",
      "address": "0xfd50fc4e3686a8da814c5c3d6121d8ab98a537f0",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68611/large/ijhon_160x160.png?1756130078",
      "decimals": 18
    },
    {
      "name": "iShares Russell 2000 ETF",
      "symbol": "IWMon",
      "address": "0x070d79021dd7e841123cb0cf554993bf683c511d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68646/large/iwmon_160x160.png?1756156170",
      "decimals": 18
    },
    {
      "name": "Microsoft Corporation",
      "symbol": "MSFTon",
      "address": "0xb812837b81a3a6b81d7cd74cfb19a7f2784555e5",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68625/large/msfton_160x160.png?1756130286",
      "decimals": 18
    },
    {
      "name": "International Business Machines Corporation",
      "symbol": "IBMon",
      "address": "0x25d3f236b2d61656eebdea86ac6d42168e340011",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68608/large/ibmon_160x160.png?1756130056",
      "decimals": 18
    },
    {
      "name": "JPMorgan Chase & Co.",
      "symbol": "JPMon",
      "address": "0x03c1ec4ca9dbb168e6db0def827c085999cbffaf",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68602/large/jpmon_160x160.png?1756129944",
      "decimals": 18
    },
    {
      "name": "PepsiCo, Inc.",
      "symbol": "PEPon",
      "address": "0x3ce219d498d807317f840f4cb0f03fa27dd65046",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68588/large/pepon_160x160.png?1756129807",
      "decimals": 18
    },
    {
      "name": "Novo Nordisk A/S",
      "symbol": "NVOon",
      "address": "0x28151f5888833d3d767c4d6945a0ee50d1b193e3",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68554/large/nvoon_160x160.png?1756105715",
      "decimals": 18
    },
    {
      "name": "Advanced Micro Devices, Inc. Common Stock",
      "symbol": "AMDon",
      "address": "0x0c1f3412a44ff99e40bf14e06e5ea321ae7b3938",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68589/large/amdon_160x160.png?1756129814",
      "decimals": 18
    },
    {
      "name": "Alphabet Inc. Class A",
      "symbol": "GOOGLon",
      "address": "0xba47214edd2bb43099611b208f75e4b42fdcfedc",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68606/large/googlon_160x160.png?1756130033",
      "decimals": 18
    },
    {
      "name": "Toyota",
      "symbol": "TMon",
      "address": "0xab02fc332e9278ebcbbc6b4a8038050c01d15f69",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68583/large/tmon_160x160.png?1756129775",
      "decimals": 18
    },
    {
      "name": "Intel Corp",
      "symbol": "INTCon",
      "address": "0xfda09936dbd717368de0835ba441d9e62069d36f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68557/large/intcon_160x160.png?1756105832",
      "decimals": 18
    },
    {
      "name": "Walmart Inc.",
      "symbol": "WMTon",
      "address": "0x82106347ddbb23ce44cf4ce4053ef1adf8b9323b",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68582/large/wmton_160x160.png?1756129770",
      "decimals": 18
    },
    {
      "name": "Blackrock, Inc.",
      "symbol": "BLKon",
      "address": "0x7a0f89c1606f71499950aa2590d547c3975b728e",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68629/large/blkon_160x160.png?1756130314",
      "decimals": 18
    },
    {
      "name": "Meta Platforms, Inc.",
      "symbol": "METAon",
      "address": "0x59644165402b611b350645555b50afb581c71eb2",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68645/large/metaon_160x160.png?1756156152",
      "decimals": 18
    },
    {
      "name": "Chevron Corporation",
      "symbol": "CVXon",
      "address": "0x8f3e41b378ae010c46d255f36bfc1d303b52dceb",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68597/large/cvxon_160x160.png?1756129908",
      "decimals": 18
    },
    {
      "name": "Circle Internet Group",
      "symbol": "CRCLon",
      "address": "0x3632dea96a953c11dac2f00b4a05a32cd1063fae",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68595/large/crclon_160x160.png?1756129889",
      "decimals": 18
    },
    {
      "name": "Cisco Systems, Inc.",
      "symbol": "CSCOon",
      "address": "0x980a1001ee94e54142b231f44c7ca7c9df71fbe1",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68566/large/cscoon_160x160.png?1756106113",
      "decimals": 18
    },
    {
      "name": "Visa Inc. Class A",
      "symbol": "Von",
      "address": "0xac37c20c1d0e5285035e056101a64e263ff94a41",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68626/large/von_160x160.png?1756130294",
      "decimals": 18
    },
    {
      "name": "Abbott Laboratories",
      "symbol": "ABTon",
      "address": "0x3859385363f7bb4dfe42811ccf3f294fcd41dd1d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68552/large/abton_160x160.png?1756105660",
      "decimals": 18
    },
    {
      "name": "Starbucks Corporation Common Stock",
      "symbol": "SBUXon",
      "address": "0xf15fbc1349ab99abad63db3f9a510bf413be3bef",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68564/large/sbuxon_160x160.png?1756106053",
      "decimals": 18
    },
    {
      "name": "Micron Technology",
      "symbol": "MUon",
      "address": "0x050362ab1072cb2ce74d74770e22a3203ad04ee5",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68574/large/muon_160x160.png?1756106401",
      "decimals": 18
    },
    {
      "name": "Amazon.com, Inc.",
      "symbol": "AMZNon",
      "address": "0xbb8774fb97436d23d74c1b882e8e9a69322cfd31",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68604/large/amznon_160x160.png?1756129958",
      "decimals": 18
    },
    {
      "name": "ASML Holding NV",
      "symbol": "ASMLon",
      "address": "0xe51ba774ebf6392c45bf1d9e6b334d07992460d3",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68642/large/asmlon_160x160.png?1756156077",
      "decimals": 18
    },
    {
      "name": "Palo Alto Networks",
      "symbol": "PANWon",
      "address": "0x34bfdff25f0fda6d3ad0c33f1e06c0d40bd68885",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68599/large/panwon_160x160.png?1756129923",
      "decimals": 18
    },
    {
      "name": "Linde plc",
      "symbol": "LINon",
      "address": "0x01b19c68f8a9ee3a480da788ba401cfabdf19b93",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68571/large/linon_160x160.png?1756106308",
      "decimals": 18
    },
    {
      "name": "Intuit",
      "symbol": "INTUon",
      "address": "0x6cc0afd51ce4cb6920b775f3d6376ab82b9a93bb",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68619/large/intuon_160x160.png?1756130237",
      "decimals": 18
    },
    {
      "name": "ServiceNow",
      "symbol": "NOWon",
      "address": "0x8bcf9012f4b0c1c3d359edb7133c294f82f80790",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68644/large/nowon_160x160.png?1756156127",
      "decimals": 18
    },
    {
      "name": "PayPal Holdings, Inc. Common Stock",
      "symbol": "PYPLon",
      "address": "0x4efd92f372898b57f292de69fce377dd7d912bdd",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68551/large/pyplon_160x160.png?1756105622",
      "decimals": 18
    },
    {
      "name": "General Electric",
      "symbol": "GEon",
      "address": "0xd904bcf89b7cedf5c89f9df7e829191d695f847e",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68614/large/geon_160x160.png?1756130103",
      "decimals": 18
    },
    {
      "name": "Super Micro Computer",
      "symbol": "SMCIon",
      "address": "0x2ca12a3f9635fd69c21580def14f25c210ca9612",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68559/large/smcion_160x160.png?1756105887",
      "decimals": 18
    },
    {
      "name": "Alibaba",
      "symbol": "BABAon",
      "address": "0x41765f0fcddc276309195166c7a62ae522fa09ef",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68600/large/babaon_160x160.png?1756129931",
      "decimals": 18
    },
    {
      "name": "Accenture plc Class A",
      "symbol": "ACNon",
      "address": "0xaba9ae731aad63335c604e5f6e6a5db2e05f549d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68610/large/acnon_160x160.png?1756130072",
      "decimals": 18
    },
    {
      "name": "Marvell Technology, Inc.",
      "symbol": "MRVLon",
      "address": "0xf404e5f887dbd5508e16a1198fcdd5de1a4296b8",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68560/large/mrvlon_160x160.png?1756105919",
      "decimals": 18
    },
    {
      "name": "Nike",
      "symbol": "NKEon",
      "address": "0xd8e26fcc879b30cb0a0b543925a2b3500f074d81",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68556/large/nkeon_160x160.png?1756105802",
      "decimals": 18
    },
    {
      "name": "Petrobras",
      "symbol": "PBRon",
      "address": "0xd08ddb436e731f32455fe302723ee0fd2e9e8706",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68545/large/pbron_160x160.png?1756105320",
      "decimals": 18
    },
    {
      "name": "Equinix",
      "symbol": "EQIXon",
      "address": "0x73d2ccee12c120e7da265a2de9d9f952a0101b4f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68546/large/eqixon_160x160.png?1756105357",
      "decimals": 18
    },
    {
      "name": "Baidu",
      "symbol": "BIDUon",
      "address": "0x9d4c6ad12b55e4645b585209f90cc26614061e91",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68591/large/biduon_160x160.png?1756129824",
      "decimals": 18
    },
    {
      "name": "Wells Fargo",
      "symbol": "WFCon",
      "address": "0x4ad2118da8a65eaa81402a3d583fef6ee76bdf3f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68590/large/wfcon_160x160.png?1756129819",
      "decimals": 18
    },
    {
      "name": "Boeing Company",
      "symbol": "BAon",
      "address": "0x57270d35a840bc5c094da6fbeca033fb71ea6ab0",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68613/large/baon_160x160.png?1756130096",
      "decimals": 18
    },
    {
      "name": "Futu Holdings",
      "symbol": "FUTUon",
      "address": "0x5ce215d9c37a195df88e294a06b8396c296b4e15",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68568/large/futuon_160x160.png?1756106205",
      "decimals": 18
    },
    {
      "name": "DoorDash",
      "symbol": "DASHon",
      "address": "0x241958c86c7744d15d5f6314ba1ea4c81dda2896",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68609/large/dashon_160x160.png?1756130064",
      "decimals": 18
    },
    {
      "name": "Chipotle",
      "symbol": "CMGon",
      "address": "0x25018520138bbab60684ad7983d4432e8b8e926b",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68567/large/cmgon_160x160.png?1756106157",
      "decimals": 18
    },
    {
      "name": "Taiwan Semiconductor Manufacturing",
      "symbol": "TSMon",
      "address": "0x3cafdbfe682aec17d5ace2f97a2f3ab3dcf6a4a9",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68598/large/tsmon_160x160.png?1756129915",
      "decimals": 18
    },
    {
      "name": "Broadcom Inc.",
      "symbol": "AVGOon",
      "address": "0x0d54d4279b9e8c54cd8547c2c75a8ee81a0bcae8",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68601/large/avgoon_160x160.png?1756129937",
      "decimals": 18
    },
    {
      "name": "Airbnb",
      "symbol": "ABNBon",
      "address": "0xb035c3d5083bdc80074f380aebc9fcb68aba0a28",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68565/large/abnbon_160x160.png?1756106088",
      "decimals": 18
    },
    {
      "name": "Mastercard Incorporated Class A",
      "symbol": "MAon",
      "address": "0xa29dc2102dfc2a0a4a5dcb84af984315567c9858",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68617/large/maon_160x160.png?1756130130",
      "decimals": 18
    },
    {
      "name": "UnitedHealth Group",
      "symbol": "UNHon",
      "address": "0x075756f3b6381a79633438faa8964946bf40163d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68624/large/unhon_160x160.png?1756130276",
      "decimals": 18
    },
    {
      "name": "Costco",
      "symbol": "COSTon",
      "address": "0x0c8276e4fec072cf7854be69c70f7773d1610857",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68648/large/coston_160x160.png?1756156219",
      "decimals": 18
    },
    {
      "name": "JD.com",
      "symbol": "JDon",
      "address": "0xdeb6b89088ca9b7d7756087c8a0f7c6df46f319c",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68573/large/jdon_160x160.png?1756106373",
      "decimals": 18
    },
    {
      "name": "Netflix",
      "symbol": "NFLXon",
      "address": "0x032dec3372f25c41ea8054b4987a7c4832cdb338",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68649/large/nflxon_160x160.png?1756156245",
      "decimals": 18
    },
    {
      "name": "D-Wave Quantum",
      "symbol": "QBTSon",
      "address": "0x3807562a482b824c08a564dfefcc471806d3e00a",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68541/large/qbtson_160x160.png?1756105094",
      "decimals": 18
    },
    {
      "name": "American Express",
      "symbol": "AXPon",
      "address": "0x2bc7ff0c5da9f1a4a51f96e77c5b0f7165dc06d2",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68607/large/axpon_160x160.png?1756130045",
      "decimals": 18
    },
    {
      "name": "Disney",
      "symbol": "DISon",
      "address": "0xc3d93b45249e8e06cfeb01d25a96337e8893265d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68587/large/dison_160x160.png?1756129802",
      "decimals": 18
    },
    {
      "name": "Uber",
      "symbol": "UBERon",
      "address": "0x5bcd8195e3ef58f677aef9ebc276b5087c027050",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68562/large/uberon_160x160.png?1756105997",
      "decimals": 18
    },
    {
      "name": "Arm Holdings plc",
      "symbol": "ARMon",
      "address": "0x5bf1b2a808598c0ef4af1673a5457d86fe6d7b3d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68572/large/armon_160x160.png?1756106342",
      "decimals": 18
    },
    {
      "name": "Adobe",
      "symbol": "ADBEon",
      "address": "0x7042a8ffc7c7049684bfbc2fcb41b72380755a43",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68622/large/adbeon_160x160.png?1756130258",
      "decimals": 18
    },
    {
      "name": "Goldman Sachs",
      "symbol": "GSon",
      "address": "0xdb57d9c14e357fc01e49035a808779df41e9b4e2",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68621/large/gson_160x160.png?1756130252",
      "decimals": 18
    },
    {
      "name": "S&P Global",
      "symbol": "SPGIon",
      "address": "0xbc843b147db4c7e00721d76037b8b92e13afe13f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68596/large/spgion_160x160.png?1756129901",
      "decimals": 18
    },
    {
      "name": "Salesforce",
      "symbol": "CRMon",
      "address": "0x55720ef5b023fd043ae5f8d2e526030207978950",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68603/large/crmon_160x160.png?1756129951",
      "decimals": 18
    },
    {
      "name": "iBoxx $ High Yield Corporate Bond ETF",
      "symbol": "HYGon",
      "address": "0xed3618bb8778f8ebbe2f241da532227591771d04",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68544/large/hygon_160x160.png?1756105272",
      "decimals": 18
    },
    {
      "name": "Snowflake",
      "symbol": "SNOWon",
      "address": "0x5d1a9a9b118ff19721e0111f094f2360b6ef7a2f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68605/large/snowon_160x160.png?1756130024",
      "decimals": 18
    },
    {
      "name": "Qualcomm",
      "symbol": "QCOMon",
      "address": "0xe3419710c1f77d44b4dab02316d3f048818c4e59",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68563/large/qcomon_160x160.png?1756106020",
      "decimals": 18
    },
    {
      "name": "MercadoLibre",
      "symbol": "MELIon",
      "address": "0x2816169a49953c548bfeb3948dcf05c4a0e4657d",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68652/large/melion_160x160.png?1756156305",
      "decimals": 18
    },
    {
      "name": "Apollo Global Management",
      "symbol": "APOon",
      "address": "0x4d21affd27183b07335935f81a5c26b6a5a15355",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68586/large/apoon_160x160.png?1756129798",
      "decimals": 18
    },
    {
      "name": "Oracle",
      "symbol": "ORCLon",
      "address": "0x8a23c6baadb88512b30475c83df6a63881e33e1e",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68592/large/orclon_160x160.png?1756129828",
      "decimals": 18
    },
    {
      "name": "Spotify",
      "symbol": "SPOTon",
      "address": "0x590f21186489ca1612f49a4b1ff5c66acd6796a9",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68627/large/spoton_160x160.png?1756130300",
      "decimals": 18
    },
    {
      "name": "Palantir Technologies",
      "symbol": "PLTRon",
      "address": "0x0c666485b02f7a87d21add7aeb9f5e64975aa490",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68594/large/pltron_160x160.png?1756129883",
      "decimals": 18
    },
    {
      "name": "Shopify",
      "symbol": "SHOPon",
      "address": "0x908266c1192628371cff7ad2f5eba4de061a0ac5",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68584/large/shopon_160x160.png?1756129783",
      "decimals": 18
    },
    {
      "name": "Reddit",
      "symbol": "RDDTon",
      "address": "0xa9431d354cfad3c6b76e50f0e73b43d48be80cd0",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68585/large/rddton_160x160.png?1756129789",
      "decimals": 18
    },
    {
      "name": "Coinbase",
      "symbol": "COINon",
      "address": "0xf042cfa86cf1d598a75bdb55c3507a1f39f9493b",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68612/large/coinon_160x160.png?1756130090",
      "decimals": 18
    },
    {
      "name": "Robinhood Markets",
      "symbol": "HOODon",
      "address": "0x998f02a9e343ef6e3e6f28700d5a20f839fd74e6",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68581/large/hoodon_160x160.png?1756129765",
      "decimals": 18
    },
    {
      "name": "MicroStrategy",
      "symbol": "MSTRon",
      "address": "0xcabd955322dfbf94c084929ac5e9eca3feb5556f",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68530/large/mstron_160x160.png?1756100941",
      "decimals": 18
    },
    {
      "name": "Riot Platforms",
      "symbol": "RIOTon",
      "address": "0x21deafd91116fce9fe87c8f15bde03f99a309b72",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68547/large/rioton_160x160.png?1756105446",
      "decimals": 18
    },
    {
      "name": "Figma",
      "symbol": "FIGon",
      "address": "0x073e7a0669833d356fa88ca65cc6d454efaaa3c5",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68656/large/figon_160x160.png?1756156375",
      "decimals": 18
    },
    {
      "name": "Marathon Digital Holdings",
      "symbol": "MARAon",
      "address": "0x4604b0b581269843ac7a6b70a5fc019e7762e511",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68548/large/maraon_160x160.png?1756105480",
      "decimals": 18
    },
    {
      "name": "Hims & Hers Health",
      "symbol": "HIMSon",
      "address": "0xca468554e5c0423ee858fe3942c9568c51fcaa79",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68553/large/himson_160x160.png?1756105686",
      "decimals": 18
    },
    {
      "name": "AppLovin",
      "symbol": "APPon",
      "address": "0xd5c5b2883735fa9b658dd52e2fcc8d7c0f1a42ce",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68615/large/appon_160x160.png?1756130115",
      "decimals": 18
    },
    {
      "name": "GameStop",
      "symbol": "GMEon",
      "address": "0x71d24baeb0a033ec5f90ff65c4210545af378d97",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68575/large/gmeon_160x160.png?1756864181",
      "decimals": 18
    },
    {
      "name": "SharpLink Gaming",
      "symbol": "SBETon",
      "address": "0xfdb46864a7c476f0914c5e82cded3364a9f56f8a",
      "chainId": 1,
      "logoURI": "https://coin-images.coingecko.com/coins/images/68657/large/sbeton_160x160.png?1756156393",
      "decimals": 18
    },
    {
      "name": "Grindr",
      "symbol": "GRNDon",
      "address": "0xe5b26ba77e6a4d79a7c54a5296d81254269d9700",
      "chainId": 1,
      "decimals": 18
    },
    {
      "name": "Morgan Stanley",
      "symbol": "MSon",
      "address": "0xb7cba7593baafffc96f9bbc86e578026369dec55",
      "chainId": 1,
      "decimals": 18
    },
    {
      "name": "Unilever",
      "symbol": "ULon",
      "address": "0x1598f7d25d0b0e1261eab9bd2ad7924291eb26bb",
      "chainId": 1,
      "decimals": 18
    },
    {
      "name": "Comcast",
      "symbol": "CMCSAon",
      "address": "0x85fd8dfd987988ede1777935d9d09c7ac7f09f0b",
      "chainId": 1,
      "decimals": 18
    },
    {
      "name": "Sony",
      "symbol": "SONYon",
      "address": "0xaf1382692f9927fd6a6c25add60285628a1879e5",
      "chainId": 1,
      "decimals": 18
    }
  ],

    // Custom theme colors to match Vaulto's gold palette
    "theme": {
      "baseTheme": "dark",
      "primary": "#facc15", // yellow-400 (Vaulto gold)
      "background": "#000000", // black
      "paper": "#1f2937", // gray-800
      "text": "#ffffff", // white
      "danger": "#ef4444", // red-500
      "warning": "#facc15", // yellow-400 (Vaulto gold)
      "alert": "#fbbf24", // yellow-400
      "info": "#3b82f6", // blue-500
      "success": "#10b981", // emerald-500
    }
    };
  }, [sellToken, buyToken, cowChainId, tokenLists, windowWidth]);

  // Create a stable widget key that changes when chainId, sellToken, buyToken, or tokenLists change
  // Including tokenLists in the key ensures the widget properly remounts when token lists are updated
  // This is critical to ensure the widget loads the correct token lists, especially the Vaulto list
  // NOTE: This hook must be called before any conditional returns to follow React hooks rules
  const widgetKey = useMemo(() => {
    // Create a hash of tokenLists for the key to ensure widget remounts when lists change
    const tokenListsHash = tokenLists.join(',');
    const key = `widget-${cowChainId}-${sellToken}-${buyToken}-${tokenListsHash}`;
    // Mark this chainId as initialized to prevent unnecessary reloading
    if (!widgetInitializedRef.current.has(cowChainId)) {
      widgetInitializedRef.current.add(cowChainId);
    }
    return key;
  }, [cowChainId, sellToken, buyToken, tokenLists]);

  if (!isMounted) {
    return null;
  }

  // Show swap interface even when wallet is not connected
  // The CoW widget will handle wallet connection internally

  return (
    <div className="w-full max-w-6xl mx-auto px-4" ref={widgetContainerRef}>
      <div className="w-full flex items-center justify-center min-h-[500px] relative">
        {/* Container for both background shape and widget - ensures they're perfectly aligned */}
        {/* Mobile: full width with padding, Desktop: fixed 392px width */}
        <div className="relative w-full md:w-[392px] min-h-[500px]">
          {/* Background element behind widget with rounded corners - spans edge-to-edge */}
          <div 
            className="absolute rounded-2xl left-0 right-0"
            style={{
              width: '100%', // Use 100% to fill parent container edge-to-edge
              height: '500px',
              top: '0',
              backgroundColor: 'rgb(31, 41, 55)', // Dark theme background color (matches Jupiter)
              zIndex: 0,
            }}
          />
          
          {/* Widget container - matches background shape width exactly, centered */}
          <div 
            className="relative z-10 w-full overflow-hidden"
            style={{
              width: '100%', // Use 100% to fill background element edge-to-edge
            }}
          >
            <div 
              className="w-full overflow-hidden" 
              style={{ 
                width: '100%',
                maxWidth: '100%',
              }}
            >
              <CowSwapWidget 
                key={widgetKey}
                params={params} 
                provider={provider} 
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
