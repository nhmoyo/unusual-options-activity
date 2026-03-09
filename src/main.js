/**
 * main.js
 *
 * Entry point for the Options Flow Scraper Apify Actor.
 *
 * Flow:
 * 1. Read user input
 * 2. Bootstrap Barchart session (XSRF token)
 * 3. Route to the correct scraper based on `mode`
 * 4. Transform & filter results
 * 5. Push to Apify dataset (this is what users download)
 * 6. Charge via Pay-Per-Event pricing
 */

import { Actor } from 'apify';
import { getBarchartSession } from './barchart-session.js';
import {
    fetchUnusualActivity,
    fetchOptionsChain,
    fetchTickerFlow,
} from './barchart-api.js';
import { fetchTickerFlowWithBrowser } from './barchart-playwright.js';
import {
    transformUnusualActivity,
    transformOptionsChain,
    transformTickerFlow,
    applyFilters,
} from './transform.js';

// ─── MAIN ────────────────────────────────────────────────────────────────────

await Actor.init();

try {
    // ── 1. Read input ──────────────────────────────────────────────────────
    const input = await Actor.getInput() ?? {};

    const {
        mode = 'unusual-activity',
        tickers = [],
        underlyingType = 'all',
        optionType = 'all',
        minVolumeOIRatio = 1.5,
        minPremium = 10000,
        expirationDate = null,
        maxResults = 500,
    } = input;

    console.log(`\n🚀 Options Flow Scraper starting`);
    console.log(`   Mode: ${mode}`);
    if (tickers.length > 0) console.log(`   Tickers: ${tickers.join(', ')}`);
    console.log(`   Option type filter: ${optionType}`);
    console.log(`   Min Volume/OI ratio: ${minVolumeOIRatio}`);
    console.log(`   Min Premium: $${minPremium.toLocaleString()}`);
    console.log(`   Max results: ${maxResults}\n`);

    // Validate mode
    if (!['unusual-activity', 'options-chain', 'ticker-flow'].includes(mode)) {
        throw new Error(`Invalid mode: "${mode}". Must be unusual-activity, options-chain, or ticker-flow.`);
    }

    // Validate tickers for modes that need them
    if (['options-chain', 'ticker-flow'].includes(mode) && tickers.length === 0) {
        throw new Error(`Mode "${mode}" requires at least one ticker in the tickers input.`);
    }

    // ── 2. Bootstrap Barchart session ──────────────────────────────────────
    const session = await getBarchartSession();

    // Filters object passed to applyFilters()
    const filters = { optionType, minVolumeOIRatio, minPremium };

    // ── 3. Route to correct scraper ────────────────────────────────────────
    let allResults = [];

    // ── MODE: UNUSUAL ACTIVITY ─────────────────────────────────────────────
    if (mode === 'unusual-activity') {

        // Confirmed Barchart values from HAR: 'stock' | 'etf' | 'index'
        // (NOT 'stocks'/'etfs' — those are URL path segments, not API params)
        const typeMap = {
            stocks: 'stock',
            etfs: 'etf',
            indices: 'index',
            all: null, // signals fetch all three
        };

        const typesToFetch =
            underlyingType === 'all'
                ? ['stock', 'etf', 'index']
                : [typeMap[underlyingType] || 'stock'];

        for (const assetType of typesToFetch) {
            console.log(`📡 Fetching unusual activity for: ${assetType}s...`);

            const raw = await fetchUnusualActivity(session, assetType, maxResults - allResults.length);
            console.log(`   → Got ${raw.length} raw records`);

            const transformed = raw.map(transformUnusualActivity);
            const filtered = transformed.filter((r) => applyFilters(r, filters));

            console.log(`   → ${filtered.length} records passed filters`);
            allResults.push(...filtered);

            if (allResults.length >= maxResults) break;
        }
    }

    // ── MODE: OPTIONS CHAIN ────────────────────────────────────────────────
    else if (mode === 'options-chain') {

        for (const ticker of tickers) {
            console.log(`📡 Fetching options chain for: ${ticker}...`);

            const raw = await fetchOptionsChain(session, ticker, expirationDate);
            console.log(`   → Got ${raw.length} raw contracts`);

            const transformed = raw.map((r) => transformOptionsChain(r, ticker));
            const filtered = transformed.filter((r) => applyFilters(r, filters));

            console.log(`   → ${filtered.length} contracts passed filters`);
            allResults.push(...filtered);

            // Small delay between tickers to be polite to Barchart's servers
            if (tickers.indexOf(ticker) < tickers.length - 1) {
                await new Promise((r) => setTimeout(r, 800));
            }
        }
    }

    // ── MODE: TICKER FLOW ──────────────────────────────────────────────────
    else if (mode === 'ticker-flow') {

        for (const ticker of tickers) {
            console.log(`📡 Fetching flow for: ${ticker}...`);

            // Try fast HTTP approach first
            let raw = await fetchTickerFlow(session, ticker);

            // If HTTP failed, fallback to Playwright browser
            if (raw === null) {
                console.log(`   → HTTP failed, switching to browser scraping...`);
                raw = await fetchTickerFlowWithBrowser(ticker);
            }

            if (raw && raw.length > 0) {
                console.log(`   → Got ${raw.length} raw flow records`);

                const transformed = raw.map((r) => transformTickerFlow(r, ticker));
                const filtered = transformed.filter((r) => applyFilters(r, filters));

                console.log(`   → ${filtered.length} records passed filters`);
                allResults.push(...filtered);
            } else {
                console.log(`   ⚠️  No flow data found for ${ticker}`);
            }

            if (tickers.indexOf(ticker) < tickers.length - 1) {
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
    }

    // ── 4. Apply maxResults cap ────────────────────────────────────────────
    if (allResults.length > maxResults) {
        console.log(`\n✂️  Capping results at ${maxResults} (got ${allResults.length})`);
        allResults = allResults.slice(0, maxResults);
    }

    console.log(`\n✅ Total results to save: ${allResults.length}`);

    // ── 5. Push results to dataset ─────────────────────────────────────────
    // This is what users see when they download data from Apify
    if (allResults.length > 0) {
        await Actor.pushData(allResults);
        console.log(`💾 Saved ${allResults.length} records to dataset.`);
    } else {
        console.log(`ℹ️  No results matched your filters. Try lowering minVolumeOIRatio or minPremium.`);
    }

    // ── 6. Pay-Per-Event charges ───────────────────────────────────────────
    // Charge: $0.05 flat startup fee + $0.002 per result
    // Users only pay for what they actually get back.
    await Actor.charge({ eventName: 'actor-start', count: 1 });

    if (allResults.length > 0) {
        await Actor.charge({ eventName: 'result', count: allResults.length });
    }

    console.log(`\n🎉 Actor finished successfully.`);

} catch (err) {
    console.error(`\n❌ Actor failed: ${err.message}`);
    // Re-throw so Apify marks the run as failed
    throw err;

} finally {
    await Actor.exit();
}
