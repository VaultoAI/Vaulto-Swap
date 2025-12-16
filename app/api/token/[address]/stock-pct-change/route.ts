import { NextRequest, NextResponse } from 'next/server';
import { getTokenMetadata, getStockTicker, isTokenizedStock } from '@/lib/utils/token';

export interface StockPctChangeResponse {
  priceChangePercent: number;
  ticker: string;
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  try {
    const { address } = params;

    if (!address) {
      return NextResponse.json(
        { error: 'Token address is required' },
        { status: 400 }
      );
    }

    // Get token metadata
    const tokenInfo = getTokenMetadata(address);
    if (!tokenInfo) {
      return NextResponse.json(
        { error: 'Token not found' },
        { status: 404 }
      );
    }

    const { token } = tokenInfo;

    // Check if token is a tokenized stock
    if (!isTokenizedStock(token)) {
      return NextResponse.json(
        { error: 'Token is not a tokenized stock' },
        { status: 400 }
      );
    }

    // Get stock ticker
    const ticker = getStockTicker(token);
    if (!ticker) {
      return NextResponse.json(
        { error: 'Stock ticker not found for tokenized stock' },
        { status: 400 }
      );
    }

    // Fetch stock data using yahoo-finance2
    let yahooFinance: any;
    try {
      yahooFinance = await import('yahoo-finance2');
    } catch (importError) {
      console.error('Failed to import yahoo-finance2:', importError);
      return NextResponse.json(
        { error: 'Stock data service unavailable' },
        { status: 503 }
      );
    }
    
    try {
      // Fetch quote data - yahoo-finance2 uses default export
      const yf = yahooFinance.default || yahooFinance;
      const quote = await yf.quote(ticker);
      
      if (!quote) {
        return NextResponse.json(
          { error: `Stock data not found for ticker: ${ticker}` },
          { status: 404 }
        );
      }

      // Extract 24hr percentage change
      const priceChangePercent = quote.regularMarketChangePercent || quote.changePercent || 0;

      const response: StockPctChangeResponse = {
        ticker: ticker,
        priceChangePercent: priceChangePercent,
      };

      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      });
    } catch (yahooError: any) {
      console.error(`Error fetching stock percentage change for ${ticker}:`, yahooError);
      return NextResponse.json(
        { error: `Failed to fetch stock data: ${yahooError.message || 'Unknown error'}` },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in stock-pct-change API route:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

