/**
 * main.js
 *
 * Entry point for the Options Flow Scraper Apify Actor.
 *
 * Flow:
 * 1. Read user input
 * 2. Bootstrap Barchart session (XSRF token)
 * 3. Route to correct scraper based on `mode`
 * 4. Transform & filter results
 * 5. Push run-summary record + all results to dataset
 * 6. Charge flat $1.50 actor-start fee (Pay-Per-Event) after successful delivery
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
// Keys match Barchart's API values: 'stock' | 'etf' | 'index' (singular, confirmed from HAR).
// These are not user-configurable; maxResults is a softer cap applied after fetching.
const INTERNAL_CAP_PER_TYPE = {
    stock: 1000,
    etf: 500,
    index: 500,
};

// Maps user-facing input values to Barchart API values (singular)
const ASSET_TYPE_MAP = {
    stocks: 'stock',
    etfs: 'etf',
    indices: 'index',
    stock: 'stock',
    etf: 'etf',
    index: 'index',
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
        minVolume = 0,       // options-chain mode: filter illiquid contracts by raw volume
        expirationDate = null,
        maxResults = 1000,   // Advanced input — default covers all meaningful unusual activity
    } = input;

    console.log(`\n🚀 Options Flow Scraper starting`);
    console.log(`   Mode:              ${mode}`);
    console.log(`   Underlying type:   ${underlyingType}`);
    if (tickers.length > 0) console.log(`   Tickers:           ${tickers.join(', ')}`);
    console.log(`   Option type:       ${optionType}`);
    if (mode === 'options-chain') {
        console.log(`   Min Volume:        ${minVolume}`);
    } else {
        console.log(`   Min Vol/OI ratio:  ${minVolumeOIRatio}`);
        console.log(`   Min Premium:       $${minPremium.toLocaleString()}`);
    }
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

    // options-chain uses a volume floor instead of vol/OI ratio — the ratio is
    // meaningless for full-chain views where most strikes have low/zero volume.
    // ticker-flow has no vol/OI ratio either, so same treatment applies.
    const filters =
        mode === 'options-chain'
            ? { optionType, minVolumeOIRatio: 0, minPremium: 0, minVolume }
            : { optionType, minVolumeOIRatio, minPremium, minVolume: 0 };

    // ── 3. Route to correct scraper ────────────────────────────────────────────
    let allResults = [];

    // ── MODE: UNUSUAL ACTIVITY ─────────────────────────────────────────────────
    if (mode === 'unusual-activity') {

        // Barchart API requires singular: 'stock' | 'etf' | 'index' (NOT 'stocks' etc.)
        const typesToFetch =
            underlyingType === 'all'
                ? ['stock', 'etf', 'index']
                : [ASSET_TYPE_MAP[underlyingType] || 'stock'];

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

    // ── 4. Apply maxResults cap ────────────────────────────────────────────────
    // Results are already ordered by vol/OI ratio desc — so slicing keeps the
    // strongest signals. Users who lower maxResults get the top N signals only.
    const totalAvailable = allResults.length;
    const truncated = totalAvailable > maxResults;

    if (truncated) {
        console.log(`\n✂️  Capping at maxResults=${maxResults} (${totalAvailable} available)`);
        allResults = allResults.slice(0, maxResults);
    }

    console.log(`\n✅ Total records to save: ${allResults.length}`);

    // ── 5. Push run summary + results to dataset ───────────────────────────────
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
            ...(mode === 'options-chain'
                ? { minVolume }
                : { minVolumeOIRatio, minPremium }
            ),
        },
        note: truncated
            ? `Only top ${maxResults} results returned. Raise maxResults to get more.` +
              (mode === 'unusual-activity' ? ' Results ordered by Vol/OI ratio desc — strongest signals first.' :
               mode === 'options-chain'    ? ' Results ordered by strike price asc.' : '')
            : `All available results returned. Each run is a full snapshot — use recordId to deduplicate across runs.`,
        fetchedAt: new Date().toISOString(),
    };

    await Actor.pushData([runSummary, ...allResults]);
    console.log(`💾 Saved run-summary + ${allResults.length} records to dataset.`);

    // ── 6. Charge after successful delivery ────────────────────────────────────
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
