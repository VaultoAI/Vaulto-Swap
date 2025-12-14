# Jupiter Market Cap Implementation

## Overview

This implementation fetches market cap data from Jupiter's token pages by parsing the HTML and extracting the value from the `__NEXT_DATA__` script tag. The formatted market cap (e.g., "$472B") is displayed in the private company token search results.

## How It Works

1. **HTML Fetching**: Fetches HTML from `https://www.jup.ag/tokens/{tokenAddress}`
2. **Data Extraction**: Parses the `__NEXT_DATA__` script tag to find `stockData.mcap`
3. **Formatting**: Converts the numeric value to Jupiter's format (e.g., $472B, $50M, $5K)
4. **Display**: Shows the formatted value in the token search UI (replaces "MCap" label)

## Implementation Details

### API Route: `app/api/solana/token-data/route.ts`

- `fetchJupiterMarketCap()`: Fetches and parses HTML to extract market cap
- `formatMarketCap()`: Formats numeric values to Jupiter's display format
- Returns `marketCapFormatted` in the API response

### Frontend: `app/components/TokenSearch.tsx`

- Displays `marketCapFormatted` when available
- Falls back to `formatTVL(marketCap)` if Jupiter data unavailable
- Removed "MCap" label - shows only the formatted value

## Testing

### Quick Test

```bash
npx tsx test-jupiter-mcap.ts
```

Tests a single token and shows detailed debugging information.

### Comprehensive Test Suite

```bash
npx tsx test-jupiter-mcap-comprehensive.ts
```

Tests:
- ✅ Direct HTML parsing for multiple tokens
- ✅ API endpoint integration
- ✅ Format validation (B, M, K, etc.)
- ✅ Edge cases (invalid addresses, zero values)

### Test Results

All tests passing:
- ✅ HTML parsing: Successfully extracts market cap from `__NEXT_DATA__`
- ✅ API endpoint: Returns `marketCapFormatted: "$472B"`
- ✅ Format validation: All format conversions working correctly
- ✅ Edge cases: Handles invalid inputs gracefully

## Example Output

For token `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` (SPACEX):
- Raw value: `471743665768`
- Formatted: `$472B`
- Display: Shows `$472B` in the token search UI

## Format Rules

- **Trillions**: `$1T`, `$2T`, etc.
- **Billions**: `$472B`, `$1B`, etc.
- **Millions**: `$50M`, `$5M`, etc.
- **Thousands**: `$50K`, `$5K`, etc.
- **Units**: `$500`, `$100`, etc.

Values are rounded to whole numbers (no decimals).

## Troubleshooting

### Market cap not showing

1. **Check API response**: Verify `marketCapFormatted` is in the API response
   ```bash
   curl -X POST http://localhost:3000/api/solana/token-data \
     -H "Content-Type: application/json" \
     -d '{"addresses": ["PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh"]}'
   ```

2. **Check token address**: Ensure the token address is correct and exists on Jupiter

3. **Check HTML structure**: Jupiter may have changed their HTML structure
   - Run `test-jupiter-mcap.ts` to see detailed debugging
   - Check if `__NEXT_DATA__` structure has changed

4. **Check network**: Ensure the API can reach `jup.ag`

### Format issues

- Verify `formatMarketCap()` function is working correctly
- Check test suite output for format validation results

## Files Modified

- `app/api/solana/token-data/route.ts` - Added HTML parsing and formatting
- `app/components/TokenSearch.tsx` - Updated display logic
- `app/components/search/types.ts` - Added `marketCapFormatted` type
- `package.json` - Added `cheerio` dependency

## Future Improvements

- [ ] Add caching to reduce API calls
- [ ] Add retry logic for failed requests
- [ ] Support for more token types
- [ ] Fallback to alternative data sources







