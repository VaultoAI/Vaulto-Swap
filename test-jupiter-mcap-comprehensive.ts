/**
 * Comprehensive test suite for Jupiter market cap fetching
 * Tests multiple tokens, edge cases, and API integration
 */

import * as cheerio from 'cheerio';

// Test token addresses
const TEST_TOKENS = [
  { address: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', name: 'SPACEX' },
  // Add more test tokens if available
];

/**
 * Format market cap number to Jupiter's format (e.g., $472B)
 */
function formatMarketCap(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(0)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(0)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(0)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Fetch market cap from Jupiter token page HTML (same logic as API)
 */
async function fetchJupiterMarketCap(tokenAddress: string): Promise<string | null> {
  try {
    const url = `https://www.jup.ag/tokens/${tokenAddress}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract from __NEXT_DATA__ script tag
    const nextDataScript = $('script#__NEXT_DATA__');
    if (nextDataScript.length > 0) {
      try {
        const nextDataText = nextDataScript.html();
        if (nextDataText) {
          const nextData = JSON.parse(nextDataText);
          const pageProps = nextData?.props?.pageProps;
          if (pageProps) {
            const dehydratedState = pageProps?.dehydratedState;
            if (dehydratedState) {
              const queries = dehydratedState?.queries || [];
              for (const query of queries) {
                const data = query?.state?.data;
                if (data?.stockData?.mcap) {
                  const mcap = data.stockData.mcap;
                  if (typeof mcap === 'number' && mcap > 0) {
                    return formatMarketCap(mcap);
                  }
                }
              }
            }
          }
        }
      } catch (parseError) {
        // Continue to fallback
      }
    }

    // Fallback: Find button with "Stock MC"
    const stockMCButton = $('button').filter((_, el) => {
      const buttonText = $(el).text();
      return buttonText.includes('Stock MC');
    }).first();

    if (stockMCButton.length > 0) {
      const marketCapSpan = stockMCButton.find('span[translate="no"]').first();
      if (marketCapSpan.length > 0) {
        const marketCapValue = marketCapSpan.text().trim();
        if (marketCapValue && marketCapValue !== '$0') {
          return marketCapValue;
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Test API endpoint
 */
async function testAPIEndpoint(addresses: string[]) {
  try {
    const response = await fetch('http://localhost:3000/api/solana/token-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Run comprehensive tests
 */
async function runComprehensiveTests() {
  console.log('=== Comprehensive Jupiter Market Cap Tests ===\n');

  let passed = 0;
  let failed = 0;
  const results: Array<{ token: string; name: string; result: string; success: boolean }> = [];

  // Test 1: Direct HTML parsing for each token
  console.log('Test 1: Direct HTML Parsing\n');
  for (const token of TEST_TOKENS) {
    console.log(`Testing ${token.name} (${token.address.substring(0, 20)}...)`);
    const value = await fetchJupiterMarketCap(token.address);
    
    if (value) {
      console.log(`  ✅ SUCCESS: Found ${value}\n`);
      passed++;
      results.push({ token: token.address, name: token.name, result: value, success: true });
    } else {
      console.log(`  ❌ FAILED: Could not extract market cap\n`);
      failed++;
      results.push({ token: token.address, name: token.name, result: 'NOT FOUND', success: false });
    }
  }

  // Test 2: API endpoint (if server is running)
  console.log('\nTest 2: API Endpoint Integration\n');
  console.log('Note: Make sure dev server is running (npm run dev)\n');
  
  const apiTest = await testAPIEndpoint(TEST_TOKENS.map(t => t.address));
  if (apiTest.success) {
    console.log('✅ API Endpoint: SUCCESS');
    console.log('Response:', JSON.stringify(apiTest.data, null, 2));
    
    // Verify each token has marketCapFormatted
    if (apiTest.data?.tokens) {
      apiTest.data.tokens.forEach((token: any, idx: number) => {
        if (token.marketCapFormatted) {
          console.log(`  ✅ Token ${idx + 1}: ${token.marketCapFormatted}`);
          passed++;
        } else {
          console.log(`  ❌ Token ${idx + 1}: marketCapFormatted missing`);
          failed++;
        }
      });
    }
  } else {
    console.log(`❌ API Endpoint: FAILED - ${apiTest.error}`);
    console.log('   (This is expected if the dev server is not running)');
  }

  // Test 3: Format validation
  console.log('\nTest 3: Format Validation\n');
  const formatTests = [
    { input: 471743665768, expected: '$472B' },
    { input: 1500000000, expected: '$2B' },
    { input: 50000000, expected: '$50M' },
    { input: 5000000, expected: '$5M' },
    { input: 50000, expected: '$50K' },
    { input: 5000, expected: '$5K' },
    { input: 500, expected: '$500' },
  ];

  formatTests.forEach(({ input, expected }) => {
    const result = formatMarketCap(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected ${expected})`);
      failed++;
    }
  });

  // Test 4: Edge cases
  console.log('\nTest 4: Edge Cases\n');
  
  // Test with invalid address
  const invalidResult = await fetchJupiterMarketCap('invalid-address-12345');
  if (invalidResult === null) {
    console.log('  ✅ Invalid address returns null');
    passed++;
  } else {
    console.log(`  ❌ Invalid address returned: ${invalidResult}`);
    failed++;
  }

  // Test with zero value
  const zeroFormatted = formatMarketCap(0);
  if (zeroFormatted === '$0') {
    console.log('  ✅ Zero value formats correctly');
    passed++;
  } else {
    console.log(`  ❌ Zero value formatted incorrectly: ${zeroFormatted}`);
    failed++;
  }

  // Summary
  console.log('\n=== Test Summary ===\n');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Review the output above.');
  }

  return { passed, failed, results };
}

// Run tests
runComprehensiveTests().catch(console.error);







