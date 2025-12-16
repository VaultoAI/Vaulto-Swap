"use client";

import { useMemo } from 'react';

interface TradingViewChartProps {
  symbol: string;
  type?: 'stock' | 'crypto';
  width?: string | number;
  height?: string | number;
  theme?: 'light' | 'dark';
  interval?: '1' | '5' | '15' | '30' | '60' | '240' | 'D' | 'W' | 'M';
  hide_top_toolbar?: boolean;
  hide_legend?: boolean;
  hide_volume?: boolean;
  locale?: string;
  allow_symbol_change?: boolean;
  save_image?: boolean;
}

/**
 * TradingView Embedded Widget Component
 * Displays a professional TradingView chart using iframe embedding
 */
export default function TradingViewChart({
  symbol,
  type = 'crypto',
  width = '100%',
  height = 600,
  theme = 'dark',
  interval = 'D',
  hide_top_toolbar = false,
  hide_legend = false,
  hide_volume = false,
  locale = 'en',
  allow_symbol_change = false,
  save_image = false,
}: TradingViewChartProps) {
  // Format symbol for TradingView
  const formattedSymbol = useMemo(() => {
    if (type === 'stock') {
      // For stocks, TradingView expects format like "NASDAQ:AAPL" or "NYSE:TSLA"
      if (symbol.includes(':')) {
        return symbol;
      }
      // Default to NASDAQ for common stocks
      // Common stocks on NASDAQ: AAPL, GOOGL, MSFT, AMZN, TSLA, PLTR
      const nasdaqStocks = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'PLTR'];
      if (nasdaqStocks.includes(symbol.toUpperCase())) {
        return `NASDAQ:${symbol}`;
      }
      // SPY and other ETFs - try without exchange prefix first as TradingView widget may prefer just the ticker
      // If that doesn't work, we can try ARCA: prefix
      const etfStocks = ['SPY', 'QQQ', 'IVV', 'TLT', 'IEFA', 'AGG', 'ITOT', 'EFA', 'IAU', 'IWF', 'IEMG', 'SLV', 'EEM', 'IWN', 'IJH', 'IWM', 'SPXUX'];
      if (etfStocks.includes(symbol.toUpperCase())) {
        // Return just the symbol - TradingView widget should auto-detect the exchange
        return symbol.toUpperCase();
      }
      // Default to NYSE for others
      return `NYSE:${symbol}`;
    }
    // For crypto, format as CRYPTO:<ticker>USD
    // Extract ticker if symbol already has exchange prefix
    let ticker: string;
    if (symbol.includes(':')) {
      ticker = symbol.split(':')[1];
    } else {
      ticker = symbol;
    }
    // Append USD if ticker doesn't already end with USD or USDT
    const upperTicker = ticker.toUpperCase();
    if (!upperTicker.endsWith('USD') && !upperTicker.endsWith('USDT')) {
      ticker = `${ticker}USD`;
    }
    return `CRYPTO:${ticker}`;
  }, [symbol, type]);

  // Build TradingView Advanced Charts widget URL
  const widgetUrl = useMemo(() => {
    const params = new URLSearchParams({
      symbol: formattedSymbol,
      interval: interval,
      theme: theme,
      style: '1',
      locale: locale,
      toolbar_bg: theme === 'dark' ? '#1a1a1a' : '#ffffff',
      enable_publishing: 'false',
      allow_symbol_change: allow_symbol_change ? 'true' : 'false',
      save_image: save_image ? 'true' : 'false',
      calendar: 'false',
      support_host: 'https://www.tradingview.com',
      autosize: 'true',
    });

    if (hide_top_toolbar) params.append('hide_top_toolbar', '1');
    if (hide_legend) params.append('hide_legend', '1');
    if (hide_volume) params.append('hide_volume', '1');

    return `https://www.tradingview.com/widgetembed/?${params.toString()}`;
  }, [formattedSymbol, theme, interval, locale, hide_top_toolbar, hide_legend, hide_volume, allow_symbol_change, save_image]);

  const heightValue = typeof height === 'number' ? `${height}px` : height;

  return (
    <div className="relative w-full overflow-hidden rounded-lg">
      <iframe
        src={widgetUrl}
        className="w-full"
        style={{
          height: heightValue,
          minHeight: '400px',
        }}
        frameBorder="0"
        allow="clipboard-write"
        title={`TradingView chart for ${symbol}`}
        loading="lazy"
      />
    </div>
  );
}
