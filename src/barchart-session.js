/**
 * barchart-session.js
 *
 * Barchart requires an XSRF token to be sent with every API request.
 * This module boots a lightweight browser session to grab that token
 * from Barchart's cookies, then returns it for use in plain HTTP requests.
 *
 * We only need a real browser ONCE per actor run — all subsequent
 * data calls are fast plain HTTP (no browser overhead).
 */

import { chromium } from 'playwright';

/**
 * Visits Barchart and extracts the XSRF token + cookies.
 * Returns an object with:
 *   - xsrfToken: string
 *   - cookieHeader: string (full cookie string for HTTP headers)
 */
export async function getBarchartSession() {
    console.log('🔑 Bootstrapping Barchart session to get XSRF token...');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate to the options page — this sets the XSRF cookie
    await page.goto('https://www.barchart.com/options/unusual-activity/stocks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });

    // Wait a moment for all cookies to be set
    await page.waitForTimeout(2000);

    // Extract all cookies
    const cookies = await context.cookies();

    // Find the XSRF token specifically
    const xsrfCookie = cookies.find(
        (c) => c.name === 'XSRF-TOKEN' || c.name === 'xsrf-token'
    );

    if (!xsrfCookie) {
        throw new Error(
            '❌ Could not find XSRF token in Barchart cookies. ' +
            'Barchart may have changed their auth flow.'
        );
    }

    // Build a cookie header string from all cookies
    const cookieHeader = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

    await browser.close();

    // XSRF token values are URL-encoded — decode before using
    const xsrfToken = decodeURIComponent(xsrfCookie.value);

    console.log('✅ Barchart session bootstrapped successfully.');

    return { xsrfToken, cookieHeader };
}
