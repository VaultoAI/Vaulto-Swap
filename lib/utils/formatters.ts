/**
 * Format a number to a specific decimal place
 */
export function formatNumber(value: string | number, decimals: number = 6): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format large numbers with K, M, B suffixes
 */
export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

/**
 * Truncate wallet address for display
 */
export function truncateAddress(address: string, startChars: number = 6, endChars: number = 4): string {
  if (!address) return "";
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Calculate percentage change
 */
export function calculatePercentageChange(oldValue: number, newValue: number): string {
  const change = ((newValue - oldValue) / oldValue) * 100;
  return change.toFixed(2);
}

/**
 * Format token amount with symbol
 */
export function formatTokenAmount(amount: string | number, symbol: string, decimals: number = 6): string {
  return `${formatNumber(amount, decimals)} ${symbol}`;
}

/**
 * Format TVL (Total Value Locked) with $ prefix and compact notation
 * Example: formatTVL(1500000) returns "$1.50M"
 */
export function formatTVL(value: number): string {
  if (isNaN(value) || value < 0) {
    return "$0.00";
  }
  return `$${formatCompactNumber(value)}`;
}

/**
 * Format fee tier from basis points to percentage
 * Example: formatFeeTier(500) returns "0.05%"
 * Example: formatFeeTier(10000) returns "1.00%"
 */
export function formatFeeTier(feeTierBps: number): string {
  if (isNaN(feeTierBps) || feeTierBps < 0) {
    return "0.00%";
  }
  // Convert basis points to percentage (divide by 10000)
  const percentage = feeTierBps / 10000;
  return `${percentage.toFixed(2)}%`;
}