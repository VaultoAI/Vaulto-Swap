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
  // Token list URLs - use defaults immediately, update in background if validation succeeds
  // Start with defaults to render widget immediately (non-blocking)
  const [tokenLists, setTokenLists] = useState<string[]>([
    'https://vaulto.dev/api/token-list/',
    'https://ipfs.io/ipns/tokens.uniswap.org',
  ]);
  // Track if token list validation has been attempted (to prevent multiple attempts)
  const tokenListValidationAttemptedRef = useRef(false);

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

  // Validate token lists in background (non-blocking) - only once
  useEffect(() => {
    if (!isMounted || typeof window === 'undefined' || tokenListValidationAttemptedRef.current) return;

    // Mark as attempted immediately to prevent multiple runs
    tokenListValidationAttemptedRef.current = true;

    // Run validation in background - don't block widget render
    const validateTokenLists = async () => {
      try {
        const validatedUrls = await getCowSwapTokenLists();

        if (validatedUrls.length > 0) {
          // Only update if URLs are different (prevent unnecessary re-renders)
          const defaultUrls = [
            'https://vaulto.dev/api/token-list/',
            'https://ipfs.io/ipns/tokens.uniswap.org',
          ];
          const urlsChanged = 
            validatedUrls.length !== defaultUrls.length ||
            validatedUrls.some((url, idx) => url !== defaultUrls[idx]);
          
          if (urlsChanged) {
            // Update token lists in background if validation succeeds and URLs changed
            setTokenLists(validatedUrls);
            console.log('CowSwap Widget - Token lists validated and updated:', {
              count: validatedUrls.length,
              urls: validatedUrls,
            });
          } else {
            console.log('CowSwap Widget - Token lists validated (no changes needed)');
          }
        } else {
          console.warn(
            'CowSwap Widget - Token list validation failed, keeping default URLs'
          );
        }
      } catch (error) {
        console.error('CowSwap Widget - Error validating token lists (using defaults):', error);
        // Keep default URLs on error - widget already rendered with them
      }
    };

    // Delay validation slightly to let widget render first
    setTimeout(validateTokenLists, 100);
  }, [isMounted]);

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

  // Create params object with current token state
  // Note: params should be stable and not recalculate when isConnected changes
  // to prevent widget from reloading token lists
  // Token lists are stable - updates happen in background without remounting widget
  const params: CowSwapWidgetParams = useMemo(() => {
    // Construct absolute URL for images (computed inside useMemo to keep it stable)
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const mobileLogoUrl = `${baseUrl}/mobilelogo.png`;
    
    return {
      "appCode": "Vaulto Swap", // Name of your app (max 50 characters)
      "width": "392px", // Responsive width
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
  }, [sellToken, buyToken, cowChainId, tokenLists]);

  // Create a stable widget key that only changes when chainId, sellToken, or buyToken changes
  // This prevents the widget from remounting when wallet connects/disconnects
  // The key includes isConnected to ensure proper initialization, but we use a ref to track
  // if the widget has been initialized for this chainId to prevent token list reloading
  // NOTE: This hook must be called before any conditional returns to follow React hooks rules
  const widgetKey = useMemo(() => {
    const key = `widget-${cowChainId}-${sellToken}-${buyToken}`;
    // Mark this chainId as initialized to prevent token list reloading
    if (!widgetInitializedRef.current.has(cowChainId)) {
      widgetInitializedRef.current.add(cowChainId);
    }
    return key;
  }, [cowChainId, sellToken, buyToken]);

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
          {/* Background element behind widget with rounded corners - fixed size on mobile, responsive on desktop */}
          <div 
            className="absolute rounded-2xl left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0"
            style={{
              width: 'calc(100vw - 2rem)', // Fixed width on mobile (full viewport minus padding)
              maxWidth: '392px', // Increased width on desktop to fully cover widget
              height: '500px', // Reduced height on mobile
              top: '0',
              backgroundColor: 'rgb(31, 41, 55)', // Dark theme background color (matches Jupiter)
              zIndex: 0,
            }}
          />
          
          {/* Widget container - centered within the background shape */}
          <div className="relative z-10 w-full flex justify-center">
            <div className="w-full max-w-[392px]">
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
