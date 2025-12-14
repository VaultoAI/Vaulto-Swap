/**
 * Token List Validation Utility
 * Provides functions to validate, fetch, and manage token lists with retry logic and fallbacks
 */

export interface TokenList {
  name: string;
  timestamp?: string;
  version?: {
    major: number;
    minor: number;
    patch: number;
  };
  tokens: Array<{
    chainId: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
  }>;
  logoURI?: string;
}

export interface TokenListValidationResult {
  url: string;
  isValid: boolean;
  error?: string;
  tokenCount?: number;
}

/**
 * Validates token list format
 */
function validateTokenList(data: any): data is TokenList {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Check required fields
  if (typeof data.name !== 'string' || !data.name.trim()) {
    return false;
  }

  if (!Array.isArray(data.tokens)) {
    return false;
  }

  // Validate token structure
  for (const token of data.tokens) {
    if (
      typeof token.chainId !== 'number' ||
      typeof token.address !== 'string' ||
      typeof token.symbol !== 'string' ||
      typeof token.name !== 'string' ||
      typeof token.decimals !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Fetches token list with timeout
 */
async function fetchTokenListWithTimeout(
  url: string,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Fetches and validates a token list with retry logic
 */
async function fetchTokenListWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<TokenListValidationResult> {
  const delays = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchTokenListWithTimeout(url, 10000);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!validateTokenList(data)) {
        throw new Error('Invalid token list format');
      }

      return {
        url,
        isValid: true,
        tokenCount: data.tokens.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // If this is the last attempt, return error
      if (attempt === maxRetries) {
        return {
          url,
          isValid: false,
          error: errorMessage,
        };
      }

      // Wait before retrying (exponential backoff)
      const delay = delays[attempt] || delays[delays.length - 1];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    url,
    isValid: false,
    error: 'Max retries exceeded',
  };
}

/**
 * Validates a token list URL and returns the result
 */
export async function validateTokenListUrl(
  url: string
): Promise<TokenListValidationResult> {
  return fetchTokenListWithRetry(url, 3);
}

/**
 * Gets validated token list URLs with fallback
 * 
 * @param primaryUrl - Primary API URL to try first
 * @param fallbackUrl - Fallback URL (local static file) if primary fails
 * @returns Array of validated token list URLs
 */
export async function getValidatedTokenListUrls(
  primaryUrl: string,
  fallbackUrl: string
): Promise<string[]> {
  // Try primary URL first
  const primaryResult = await validateTokenListUrl(primaryUrl);

  if (primaryResult.isValid) {
    console.log(`✅ Token list validated: ${primaryUrl} (${primaryResult.tokenCount} tokens)`);
    return [primaryUrl];
  }

  console.warn(
    `⚠️ Primary token list failed: ${primaryUrl}`,
    primaryResult.error
  );
  console.log(`🔄 Falling back to: ${fallbackUrl}`);

  // Try fallback URL
  const fallbackResult = await validateTokenListUrl(fallbackUrl);

  if (fallbackResult.isValid) {
    console.log(
      `✅ Fallback token list validated: ${fallbackUrl} (${fallbackResult.tokenCount} tokens)`
    );
    return [fallbackUrl];
  }

  console.error(
    `❌ Both primary and fallback token lists failed. Primary: ${primaryResult.error}, Fallback: ${fallbackResult.error}`
  );
  
  // Return empty array if both fail (widget will handle gracefully)
  return [];
}

/**
 * Validates multiple token list URLs in parallel
 * 
 * @param urls - Array of token list URLs to validate
 * @returns Array of validated URLs
 */
export async function validateMultipleTokenLists(
  urls: string[]
): Promise<string[]> {
  const validationPromises = urls.map((url) => validateTokenListUrl(url));
  const results = await Promise.all(validationPromises);

  const validUrls: string[] = [];

  results.forEach((result, index) => {
    if (result.isValid) {
      console.log(
        `✅ Token list ${index + 1} validated: ${result.url} (${result.tokenCount} tokens)`
      );
      validUrls.push(result.url);
    } else {
      console.error(
        `❌ Token list ${index + 1} failed: ${result.url}`,
        result.error
      );
    }
  });

  return validUrls;
}

/**
 * Gets all validated token lists for CowSwap widget
 * Validates both Vaulto and Uniswap lists with fallback support
 * 
 * @returns Array of validated token list URLs to pass to widget
 */
export async function getCowSwapTokenLists(): Promise<string[]> {
  const vaultoPrimary = 'https://vaulto.dev/api/token-list/';
  const vaultoFallback = '/token-list.json';
  const uniswapList = 'https://ipfs.io/ipns/tokens.uniswap.org';

  // Validate Vaulto list (with fallback) and Uniswap list in parallel
  const [vaultoUrls, uniswapResult] = await Promise.all([
    getValidatedTokenListUrls(vaultoPrimary, vaultoFallback),
    validateTokenListUrl(uniswapList),
  ]);

  const validatedUrls: string[] = [...vaultoUrls];

  if (uniswapResult.isValid) {
    validatedUrls.push(uniswapList);
  } else {
    console.warn(
      `⚠️ Uniswap token list failed: ${uniswapList}`,
      uniswapResult.error
    );
  }

  if (validatedUrls.length === 0) {
    console.error('❌ No token lists validated successfully. Widget may not have tokens available.');
  } else {
    console.log(`✅ Validated ${validatedUrls.length} token list(s) for CowSwap widget`);
  }

  return validatedUrls;
}












