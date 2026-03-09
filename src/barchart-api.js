/**
 * barchart-api.js
 *
 * Makes direct HTTP requests to Barchart's proxy API.
 *
 * CONFIRMED via HAR analysis on 2026-03-09:
 * - Endpoint: https://www.barchart.com/proxies/core-api/v1/options/get
 * - Same-origin request (Host: www.barchart.com, not core-api.barchart.com)
 * - Auth: X-XSRF-TOKEN header + laravel session cookies
 * - Filtering: uses a special "between(field,min,max)" query param syntax
 * - Response: json.data[] — each record has both formatted strings AND
 *   a nested `raw` object with clean numbers. Always use record.raw.*
 * - Pagination: total results in json.total, use &page= or &offset= param
 * - Rate limit: x-ratelimit-limit: 60 (per minute)
 */

// Confirmed fields from HAR response
const UNUSUAL_ACTIVITY_FIELDS = [
    'symbol', 'baseSymbol', 'baseLastPrice', 'baseSymbolType',
    'expirationDate', 'daysToExpiration', 'symbolType', 'strikePrice',
    'moneyness', 'bidPrice', 'lastPrice', 'askPrice',
    'volume', 'openInterest', 'volumeOpenInterestRatio',
    'weightedImpliedVolatility', 'volatility', 'delta',
    'tradeTime', 'symbolCode'
].join(',');

const BASE_URL = 'https://www.barchart.com/proxies/core-api/v1/options/get';

/**
 * Builds the standard headers for every Barchart API call.
 * Confirmed required headers from HAR file.
 */
function buildHeaders(session) {
    return {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.barchart.com/options/unusual-activity/stocks',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) ' +
            'Gecko/20100101 Firefox/148.0',
        'X-XSRF-TOKEN': session.xsrfToken,
        'Cookie': session.cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };
}

/**
 * Fetches one page of unusual options activity results.
 * Barchart uses "between(field,min,max)=" syntax for range filters.
 *
 * Confirmed from HAR:
 *   baseSymbolTypes=stock (not 'stocks')
 *   between(volumeOpenInterestRatio,1.24,)= — open-ended upper bound
 *   between(volume,500,)=
 *   between(openInterest,100,)=
 *   in(exchange,(AMEX,NYSE,NASDAQ,INDEX-CBOE))=
 *
 * @param {object} session
 * @param {string} baseSymbolTypes - 'stock' | 'etf' | 'index'
 * @param {number} page - 1-based page number
 * @param {number} limit - results per page (max ~200 before rate limits)
 * @returns {{ data: Array, total: number }}
 */
export async function fetchUnusualActivityPage(session, baseSymbolTypes = 'stock', page = 1, limit = 200) {
    // Build today's date range for tradeTime filter
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);
    const fromDate = threeDaysAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];

    const params = new URLSearchParams({
        fields: UNUSUAL_ACTIVITY_FIELDS,
        orderBy: 'volumeOpenInterestRatio',
        orderDir: 'desc',
        baseSymbolTypes,
        'between(volumeOpenInterestRatio,1.24,)': '',
        'between(lastPrice,.10,)': '',
        [`between(tradeTime,${fromDate},${toDate})`]: '',
        'between(volume,500,)': '',
        'between(openInterest,100,)': '',
        'in(exchange,(AMEX,NYSE,NASDAQ,INDEX-CBOE))': '',
        limit: String(limit),
        page: String(page),
        'meta': 'field.shortName,field.type,field.description',
        raw: '1',
    });

    const url = `${BASE_URL}?${params.toString()}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(session),
    });

    if (!response.ok) {
        throw new Error(
            `❌ Barchart unusual activity request failed (page ${page}): ` +
            `${response.status} ${response.statusText}`
        );
    }

    const json = await response.json();
    return {
        data: json.data || [],
        total: json.total || 0,
    };
}

/**
 * Fetches ALL pages of unusual activity for a given asset type.
 * Handles pagination automatically. Stops at maxResults.
 *
 * @param {object} session
 * @param {string} baseSymbolTypes - 'stock' | 'etf' | 'index'
 * @param {number} maxResults - cap on total records to fetch
 */
export async function fetchUnusualActivity(session, baseSymbolTypes = 'stock', maxResults = 500) {
    const LIMIT = 200; // results per page
    const allData = [];
    let page = 1;
    let total = Infinity;

    while (allData.length < maxResults && allData.length < total) {
        console.log(`   Fetching page ${page} for ${baseSymbolTypes}...`);

        const { data, total: pageTotal } = await fetchUnusualActivityPage(
            session, baseSymbolTypes, page, LIMIT
        );

        total = pageTotal;
        allData.push(...data);

        if (data.length < LIMIT) break; // last page
        page++;

        // Respect rate limit (60 req/min = 1 req/sec minimum)
        await new Promise(r => setTimeout(r, 1100));
    }

    return allData.slice(0, maxResults);
}

/**
 * Fetches the full options chain for a single ticker.
 * Uses the same /options/get endpoint with a baseSymbol filter.
 *
 * @param {object} session
 * @param {string} ticker - e.g. 'AAPL'
 * @param {string|null} expirationDate - 'YYYY-MM-DD' filter, or null for all
 * @param {number} maxResults
 */
export async function fetchOptionsChain(session, ticker, expirationDate = null, maxResults = 500) {
    const allData = [];
    let page = 1;
    const LIMIT = 200;

    while (allData.length < maxResults) {
        const params = new URLSearchParams({
            fields: UNUSUAL_ACTIVITY_FIELDS,
            orderBy: 'strikePrice',
            orderDir: 'asc',
            'in(baseSymbol,(' + ticker.toUpperCase() + '))': '',
            limit: String(LIMIT),
            page: String(page),
            raw: '1',
        });

        if (expirationDate) {
            params.set(`between(expirationDate,${expirationDate},${expirationDate})`, '');
        }

        const url = `${BASE_URL}?${params.toString()}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...buildHeaders(session),
                'Referer': `https://www.barchart.com/stocks/quotes/${ticker}/options`,
            },
        });

        if (!response.ok) {
            throw new Error(
                `❌ Options chain request failed for ${ticker}: ` +
                `${response.status} ${response.statusText}`
            );
        }

        const json = await response.json();
        const data = json.data || [];
        allData.push(...data);

        if (data.length < LIMIT || allData.length >= (json.total || 0)) break;
        page++;
        await new Promise(r => setTimeout(r, 1100));
    }

    return allData.slice(0, maxResults);
}

/**
 * Fetches intraday options flow for a ticker.
 * Note: This uses a different endpoint path — returns null if unavailable
 * so caller can fall back to Playwright.
 *
 * @param {object} session
 * @param {string} ticker
 */
export async function fetchTickerFlow(session, ticker) {
    // Flow data uses a different sub-path — attempt it and return null on failure
    const url =
        `https://www.barchart.com/proxies/core-api/v1/options/flow` +
        `?symbol=${ticker.toUpperCase()}` +
        `&fields=symbol,symbolType,strikePrice,expirationDate,lastPrice,` +
        `bidPrice,askPrice,volume,openInterest,volatility,` +
        `tradeCondition,tradeTime` +
        `&raw=1&limit=200`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            ...buildHeaders(session),
            'Referer': `https://www.barchart.com/stocks/quotes/${ticker}/options-flow`,
        },
    });

    if (!response.ok) {
        console.log(`⚠️  Flow endpoint returned ${response.status} for ${ticker} — will try browser fallback.`);
        return null;
    }

    const json = await response.json();
    return json.data || null;
}
