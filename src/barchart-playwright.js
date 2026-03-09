/**
 * barchart-playwright.js
 *
 * Fallback scraper using a real browser (Playwright) for the ticker-flow
 * mode. Only used when the direct HTTP API approach fails.
 *
 * Strategy: launch browser, intercept the XHR calls the page makes
 * to core-api.barchart.com, and capture the JSON responses directly.
 * This is cleaner than scraping the DOM table.
 */

import { chromium } from 'playwright';

/**
 * Uses a real browser to load the options flow page for a ticker,
 * intercepts the underlying API calls, and returns the raw data.
 *
 * @param {string} ticker - e.g. 'NVDA'
 * @returns {Array} flow trade records
 */
export async function fetchTickerFlowWithBrowser(ticker) {
    console.log(`🌐 Using browser fallback for ${ticker} flow data...`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Array to collect intercepted flow data
    const capturedData = [];

    // Intercept all responses from core-api.barchart.com
    page.on('response', async (response) => {
        const url = response.url();

        // Only capture options flow calls
        if (url.includes('core-api.barchart.com') && url.includes('flow')) {
            try {
                const json = await response.json();
                if (json.data && Array.isArray(json.data)) {
                    capturedData.push(...json.data);
                }
            } catch {
                // Some responses may not be JSON — silently skip
            }
        }
    });

    // Navigate to the flow page
    const flowUrl = `https://www.barchart.com/stocks/quotes/${ticker.toUpperCase()}/options-flow`;
    await page.goto(flowUrl, {
        waitUntil: 'networkidle',
        timeout: 45000,
    });

    // Wait for the flow table to appear
    try {
        await page.waitForSelector('table', { timeout: 15000 });
    } catch {
        console.log(`⚠️  Flow table did not appear for ${ticker} — page may be empty.`);
    }

    // Give intercepted requests a moment to finish
    await page.waitForTimeout(2000);

    await browser.close();

    if (capturedData.length === 0) {
        console.log(`⚠️  No flow data captured for ${ticker} via browser.`);
    } else {
        console.log(`✅ Captured ${capturedData.length} flow records for ${ticker} via browser.`);
    }

    return capturedData;
}
