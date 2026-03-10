/**
 * main.js
 *
 * Entry point for the Options Flow Scraper Apify Actor.
 *
 * Flow:
 * 1. Read user input
 * 2. Charge flat $1.50 actor-start fee (Pay-Per-Event)
 * 3. Bootstrap Barchart session (XSRF token)
 * 4. Route to correct scraper based on `mode`
 * 5. Transform & filter results
 * 6. Push run-summary record + all results to dataset
 *
 * Pricing: $1.50 flat per run — no per-record charge.
 * Each run returns a full snapshot. Use recordId to deduplicate across runs.
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

// Internal hard caps per asset type — prevents runaway runs and Barchart rate limits.
// These are not user-configurable; maxResults is a softer cap applied after fetching.
const INTERNAL_CAP_PER_TYPE = {
    stocks: 1000,
    etfs: 500,
    indices: 500,
};

// ─── MAIN ────────────────────────────────────────────────────────────────────

await Actor.init();

try {
    // ── 1. Read input ──────────────────────────────────────────────────────────
    const input = await Actor.getInput() ?? {};

    const {
        mode = 'unusual-activity',
        tickers = [],
        underlyingType = 'all',
        optionType = 'all',
        minVolumeOIRatio = 1.5,
        minPremium = 10000,
        expirationDate = null,
        maxResults = 1000,   // Advanced input — default covers all meaningful unusual activity
    } = input;

    console.log(`\n🚀 Options Flow Scraper starting`);
    console.log(`   Mode:              ${mode}`);
    console.log(`   Underlying type:   ${underlyingType}`);
    if (tickers.length > 0) console.log(`   Tickers:           ${tickers.join(', ')}`);
    console.log(`   Option type:       ${optionType}`);
    console.log(`   Min Vol/OI ratio:  ${minVolumeOIRatio}`);
    console.log(`   Min Premium:       $${minPremium.toLocaleString()}`);
    console.log(`   Max results cap:   ${maxResults}\n`);

    // Validate mode
    if (!['unusual-activity', 'options-chain', 'ticker-flow'].includes(mode)) {
        throw new Error(`Invalid mode: "${mode}". Must be unusual-activity, options-chain, or ticker-flow.`);
    }

    // Validate tickers for modes that need them
    if (['options-chain', 'ticker-flow'].includes(mode) && tickers.length === 0) {
        throw new Error(`Mode "${mode}" requires at least one ticker in the tickers input.`);
    }

    // ── 2. Bootstrap Barchart session ──────────────────────────────────────────
    // NOTE: We charge AFTER data is successfully delivered (step 6).
    // If the actor fails at any point before pushData completes, no charge is made.
    const session = await getBarchartSession();
    const filters = { optionType, minVolumeOIRatio, minPremium };

    // ── 4. Route to correct scraper ────────────────────────────────────────────
    let allResults = [];

    // ── MODE: UNUSUAL ACTIVITY ─────────────────────────────────────────────────
    if (mode === 'unusual-activity') {

        const typesToFetch =
            underlyingType === 'all'
                ? ['stocks', 'etfs', 'indices']
                : [underlyingType];

        for (const assetType of typesToFetch) {
            const cap = INTERNAL_CAP_PER_TYPE[assetType] ?? 1000;
            const effectiveCap = Math.min(cap, maxResults);

            console.log(`📡 Fetching unusual activity: ${assetType} (cap: ${effectiveCap})...`);

            const raw = await fetchUnusualActivity(session, assetType, effectiveCap);
            console.log(`   → ${raw.length} raw records fetched`);

            const transformed = raw.map(transformUnusualActivity);
            const filtered = transformed.filter((r) => applyFilters(r, filters));

            console.log(`   → ${filtered.length} records passed filters`);
            allResults.push(...filtered);
        }
    }

    // ── MODE: OPTIONS CHAIN ────────────────────────────────────────────────────
    else if (mode === 'options-chain') {

        for (const ticker of tickers) {
            console.log(`📡 Fetching options chain: ${ticker}...`);

            const raw = await fetchOptionsChain(session, ticker, expirationDate);
            console.log(`   → ${raw.length} raw contracts`);

            const transformed = raw.map((r) => transformOptionsChain(r, ticker));
            const filtered = transformed.filter((r) => applyFilters(r, filters));

            console.log(`   → ${filtered.length} contracts passed filters`);
            allResults.push(...filtered);

            if (tickers.indexOf(ticker) < tickers.length - 1) {
                await new Promise((r) => setTimeout(r, 800));
            }
        }
    }

    // ── MODE: TICKER FLOW ──────────────────────────────────────────────────────
    else if (mode === 'ticker-flow') {

        for (const ticker of tickers) {
            console.log(`📡 Fetching flow: ${ticker}...`);

            let raw = await fetchTickerFlow(session, ticker);

            if (raw === null) {
                console.log(`   → HTTP failed, switching to browser scraping...`);
                raw = await fetchTickerFlowWithBrowser(ticker);
            }

            if (raw && raw.length > 0) {
                console.log(`   → ${raw.length} raw flow records`);

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

    // ── 5. Apply maxResults cap ────────────────────────────────────────────────
    // Results are already ordered by vol/OI ratio desc — so slicing keeps the
    // strongest signals. Users who lower maxResults get the top N signals only.
    const totalAvailable = allResults.length;
    const truncated = totalAvailable > maxResults;

    if (truncated) {
        console.log(`\n✂️  Capping at maxResults=${maxResults} (${totalAvailable} available)`);
        allResults = allResults.slice(0, maxResults);
    }

    console.log(`\n✅ Total records to save: ${allResults.length}`);

    // ── 6. Push run summary + results to dataset ───────────────────────────────
    // First record is always a run-summary so users can see totals at a glance.
    // Filter it out downstream if you only want contract records:
    //   results.filter(r => r.type !== 'run-summary')
    const runSummary = {
        type: 'run-summary',
        mode,
        underlyingType,
        totalAvailable,
        totalReturned: allResults.length,
        truncated,
        maxResults,
        filtersApplied: {
            optionType,
            minVolumeOIRatio,
            minPremium,
        },
        note: truncated
            ? `Only top ${maxResults} signals returned (ordered by Vol/OI ratio desc). Raise maxResults to get more.`
            : `All available signals returned. Each run is a full snapshot — use recordId to deduplicate across runs.`,
        fetchedAt: new Date().toISOString(),
    };

    await Actor.pushData([runSummary, ...allResults]);
    console.log(`💾 Saved run-summary + ${allResults.length} records to dataset.`);

    // ── 7. Charge after successful delivery ────────────────────────────────────
    // Charge only if results were actually delivered. This protects users from
    // paying for failed or empty runs. If the actor crashes before reaching this
    // line, no charge is made.
    if (allResults.length > 0) {
        await Actor.charge({ eventName: 'actor-start', count: 1 });
        console.log(`💳 Run fee charged — ${allResults.length} records delivered.`);
    } else {
        console.log(`ℹ️  No results matched your filters — run fee not charged.`);
        console.log(`   Try lowering minVolumeOIRatio or minPremium to broaden your results.`);
    }

    console.log(`\n🎉 Actor finished successfully.`);

} catch (err) {
    console.error(`\n❌ Actor failed: ${err.message}`);
    throw err;

} finally {
    await Actor.exit();
}
