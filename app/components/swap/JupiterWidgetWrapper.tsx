"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { useWallet } from "@solana/wallet-adapter-react";

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
}

export default function JupiterWidgetWrapper() {
  const [isMounted, setIsMounted] = useState(false);
  const [isJupiterLoaded, setIsJupiterLoaded] = useState(false);
  const [fixedMint, setFixedMint] = useState<string>('PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'); // SpaceX address - default for private market
  const containerRef = useRef<HTMLDivElement>(null);
  const jupiterInitializedRef = useRef(false);
  
  // Get Solana wallet context for passthrough
  const passthroughWalletContextState = useWallet();

  // Mount check
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Wait for Jupiter plugin to load
  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;

    // Check if Jupiter is already loaded
    if (window.Jupiter) {
      setIsJupiterLoaded(true);
      return;
    }

    // Poll for Jupiter plugin to be available (since it loads with defer)
    const checkJupiter = setInterval(() => {
      if (window.Jupiter) {
        setIsJupiterLoaded(true);
        clearInterval(checkJupiter);
      }
    }, 100);

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkJupiter);
      if (!window.Jupiter) {
        console.error('Jupiter Plugin failed to load');
      }
    }, 10000);

    return () => {
      clearInterval(checkJupiter);
      clearTimeout(timeout);
    };
  }, [isMounted]);

  // Initialize or reload Jupiter widget when fixedMint changes
  useEffect(() => {
    if (!isMounted || !isJupiterLoaded || !containerRef.current) return;
    if (!window.Jupiter) return;

    // Destroy existing widget if it's already initialized
    if (jupiterInitializedRef.current) {
      try {
        const container = document.getElementById('jupiter-widget-container');
        if (container) {
          // Clear the container to remove existing widget
          container.innerHTML = '';
          console.log('Jupiter widget container cleared for reload');
        }
        // Try to call close if it exists (may not be in type definitions)
        const jupiter = window.Jupiter as any;
        if (jupiter.close && typeof jupiter.close === 'function') {
          jupiter.close();
          console.log('Jupiter widget destroyed for reload');
        }
      } catch (error) {
        console.warn('Error destroying Jupiter widget:', error);
      }
      jupiterInitializedRef.current = false;
    }

    // Small delay to ensure cleanup completes
    const initTimer = setTimeout(() => {
      try {
        // Initialize Jupiter widget in integrated mode
        // Using exact configuration format from Jupiter documentation
        window.Jupiter.init({
          displayMode: 'integrated',
          integratedTargetId: 'jupiter-widget-container',
          containerStyles: {
            width: '100%', // 100% of the container (full width on mobile, 392px on desktop - matches CowSwap)
            height: '500px', // Match CowSwap height
            borderRadius: '0px', // Match CowSwap (no border radius in container)
          },
          containerClassName: 'jupiter-widget-container',
          theme: 'dark',
          
          // Form Properties - Exact format from Jupiter documentation
          // fixedMint must match either initialInputMint or initialOutputMint
          // We set initialOutputMint to match fixedMint so users swap TO the selected token
          formProps: {
            initialAmount: '100000000',
            initialOutputMint: fixedMint, // Match fixedMint to avoid validation error
            initialInputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC on Solana
            fixedMint: fixedMint,
          },
          
          // Custom Token List - ONLY these 5 tokens will be shown (replaces Jupiter's default tokens)
          tokens: [
            {
              address: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
              symbol: 'TOKEN1',
              name: 'Token 1',
              decimals: 9,
            },
            {
              address: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
              symbol: 'TOKEN2',
              name: 'Token 2',
              decimals: 9,
            },
            {
              address: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
              symbol: 'TOKEN3',
              name: 'Token 3',
              decimals: 9,
            },
            {
              address: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh',
              symbol: 'SpaceX',
              name: 'SpaceX',
              decimals: 9,
            },
            {
              address: 'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
              symbol: 'TOKEN5',
              name: 'Token 5',
              decimals: 9,
            },
          ],
          
          // Wallet Passthrough - Enable using existing Solana wallet connection
          enableWalletPassthrough: true,
          passthroughWalletContextState: passthroughWalletContextState,
        });

        jupiterInitializedRef.current = true;
        console.log('Jupiter widget initialized successfully with fixedMint:', fixedMint);
      } catch (error) {
        console.error('Error initializing Jupiter widget:', error);
      }
    }, 100);

    return () => {
      clearTimeout(initTimer);
    };
  }, [isMounted, isJupiterLoaded, passthroughWalletContextState, fixedMint]);

  // Sync wallet state with Jupiter widget when wallet connection changes
  useEffect(() => {
    if (!isMounted || !isJupiterLoaded || !window.Jupiter || !jupiterInitializedRef.current) return;
    
    try {
      const jupiter = window.Jupiter as any;
      if (jupiter.syncProps && typeof jupiter.syncProps === 'function') {
        jupiter.syncProps({ passthroughWalletContextState });
        console.log('Jupiter wallet passthrough synced', {
          connected: passthroughWalletContextState.connected,
          publicKey: passthroughWalletContextState.publicKey?.toBase58(),
        });
      }
    } catch (error) {
      console.error('Error syncing Jupiter wallet passthrough:', error);
    }
  }, [isMounted, isJupiterLoaded, passthroughWalletContextState]);

  // Handle token selection from header search
  const handleTokenSelect = useCallback((token: Token, type: 'sell' | 'buy') => {
    console.log('Jupiter: Token selected:', { token: token.symbol, type, address: token.address });
    
    // Update fixedMint to the selected token's address
    if (token.address) {
      setFixedMint(token.address);
      console.log('Jupiter: fixedMint updated to:', token.address);
    }
  }, []);

  // Expose handler via ref for parent access
  const tokenSelectHandlerRef = useRef(handleTokenSelect);
  useEffect(() => {
    tokenSelectHandlerRef.current = handleTokenSelect;
  }, [handleTokenSelect]);

  // Expose handler to window for TokenSearch component
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__handleTokenSelect = (token: Token, type: 'sell' | 'buy') => {
        console.log('Jupiter: Token selection handler called:', { symbol: token.symbol, type });
        tokenSelectHandlerRef.current(token, type);
      };
      console.log('Jupiter: Token selection handler registered on window');
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__handleTokenSelect;
        console.log('Jupiter: Token selection handler removed from window');
      }
    };
  }, []);

  // Cleanup: Destroy widget on unmount
  useEffect(() => {
    return () => {
      if (jupiterInitializedRef.current && typeof window !== 'undefined' && window.Jupiter) {
        try {
          const container = document.getElementById('jupiter-widget-container');
          if (container) {
            container.innerHTML = '';
          }
          const jupiter = window.Jupiter as any;
          if (jupiter.close && typeof jupiter.close === 'function') {
            jupiter.close();
            console.log('Jupiter widget destroyed on unmount');
          }
        } catch (error) {
          console.warn('Error destroying Jupiter widget on unmount:', error);
        }
        jupiterInitializedRef.current = false;
      }
    };
  }, []);


  if (!isMounted) {
    return null;
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4" ref={containerRef}>
      <div className="w-full flex items-center justify-center min-h-[500px] relative">
        {/* Container for both background shape and widget - ensures they're perfectly aligned */}
        {/* Mobile: full width with padding, Desktop: matches CowSwap layout */}
        <div className="relative w-full md:w-[392px] min-h-[500px]">
          {/* Background element behind widget with rounded corners - matches CowSwap exactly */}
          <div 
            className="absolute rounded-2xl left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0"
            style={{
              width: 'calc(100vw - 2rem)', // Fixed width on mobile (full viewport minus padding)
              maxWidth: '392px', // Fixed max width on desktop
              height: '500px', // Reduced height on mobile
              top: '0',
              backgroundColor: 'rgb(31, 41, 55)', // Dark theme background color (matches CowSwap)
              zIndex: 0,
            }}
          />
          
          {!isJupiterLoaded && (
            <div className="flex items-center justify-center min-h-[500px] relative z-10">
              <div className="text-gray-400 text-sm">Loading Jupiter widget...</div>
            </div>
          )}
          <div
            id="jupiter-widget-container"
            className={`w-full md:w-full min-h-[500px] relative z-10 ${!isJupiterLoaded ? 'hidden' : ''}`}
            style={{
              borderRadius: '0px', // Match CowSwap widget (no border radius)
              overflow: 'hidden',
            }}
          />
        </div>
      </div>
    </div>
  );
}

