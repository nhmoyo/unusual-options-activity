const UNUSUAL_ACTIVITY_FIELDS = [
    'symbol', 'baseSymbol', 'baseLastPrice', 'baseSymbolType',
    'expirationDate', 'daysToExpiration', 'symbolType', 'strikePrice',
    'moneyness', 'bidPrice', 'lastPrice', 'askPrice',
    'volume', 'openInterest', 'volumeOpenInterestRatio',
    'weightedImpliedVolatility', 'volatility', 'delta',
    'tradeTime', 'symbolCode'
].join(',');

const BASE_URL = 'https://www.barchart.com/proxies/core-api/v1/options/get';

function buildHeaders(session) {
    return {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.barchart.com/options/unusual-activity/stocks',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
        'X-XSRF-TOKEN': session.xsrfToken,
        'Cookie': session.cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };
}

export async function fetchUnusualActivityPage(session, baseSymbolTypes = 'stock', page = 1, limit = 200) {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);
    const fromDate = threeDaysAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];

    const params = new URLSearchParams({
        fields: UNUSUAL_ACTIVITY_FIELDS,
        orderBy: 'volumeOpenInterestRatio',
        orderDir: 'desc',
        baseSymbolTypes: baseSymbolTypes,
        limit: String(limit),
        page: String(page),
        raw: '1',
    });

    params.set('between(volumeOpenInterestRatio,1.24,)', '');
    params.set('between(lastPrice,.10,)', '');
    params.set('between(tradeTime,' + fromDate + ',' + toDate + ')', '');
    params.set('between(volume,500,)', '');
    params.set('between(openInterest,100,)', '');
    params.set('in(exchange,(AMEX,NYSE,NASDAQ,INDEX-CBOE))', '');

    const url = BASE_URL + '?' + params.toString();

    console.log('   DEBUG URL: ' + url.substring(0, 300));
    console.log('   DEBUG XSRF length: ' + session.xsrfToken.length);

    const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(session),
    });

    console.log('   DEBUG status: ' + response.status);
    const text = await response.text();
    console.log('   DEBUG response: ' + text.substring(0, 400));

    const json = JSON.parse(text);
    return {
        data: json.data || [],
        total: json.total || 0,
    };
}

export async function fetchUnusualActivity(session, baseSymbolTypes = 'stock', maxResults = 500) {
    const LIMIT = 200;
    const allData = [];
    let page = 1;
    let total = Infinity;

    while (allData.length < maxResults && allData.length < total) {
        console.log('   Fetching page ' + page + ' for ' + baseSymbolTypes + '...');
        const { data, total: pageTotal } = await fetchUnusualActivityPage(session, baseSymbolTypes, page, LIMIT);
        total = pageTotal;
        allData.push(...data);
        if (data.length < LIMIT) break;
        page++;
        await new Promise(r => setTimeout(r, 1100));
    }

    return allData.slice(0, maxResults);
}

export async function fetchOptionsChain(session, ticker, expirationDate = null, maxResults = 500) {
    const allData = [];
    let page = 1;
    const LIMIT = 200;
    const tickerUpper = ticker.toUpperCase();

    while (allData.length < maxResults) {
        const params = new URLSearchParams({
            fields: UNUSUAL_ACTIVITY_FIELDS,
            orderBy: 'strikePrice',
            orderDir: 'asc',
            limit: String(LIMIT),
            page: String(page),
            raw: '1',
        });

        params.set('in(baseSymbol,(' + tickerUpper + '))', '');

        if (expirationDate) {
            params.set('between(expirationDate,' + expirationDate + ',' + expirationDate + ')', '');
        }

        const url = BASE_URL + '?' + params.toString();
        const response = await fetch(url, {
            method: 'GET',
            headers: Object.assign({}, buildHeaders(session), {
                'Referer': 'https://www.barchart.com/stocks/quotes/' + tickerUpper + '/options',
            }),
        });

        if (!response.ok) {
            throw new Error('Options chain request failed for ' + ticker + ': ' + response.status);
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

export async function fetchTickerFlow(session, ticker) {
    const tickerUpper = ticker.toUpperCase();
    const url = 'https://www.barchart.com/proxies/core-api/v1/options/flow' +
        '?symbol=' + tickerUpper +
        '&fields=symbol,symbolType,strikePrice,expirationDate,lastPrice,' +
        'bidPrice,askPrice,volume,openInterest,volatility,tradeCondition,tradeTime' +
        '&raw=1&limit=200';

    const response = await fetch(url, {
        method: 'GET',
        headers: Object.assign({}, buildHeaders(session), {
            'Referer': 'https://www.barchart.com/stocks/quotes/' + tickerUpper + '/options-flow',
        }),
    });

    if (!response.ok) {
        console.log('Flow endpoint returned ' + response.status + ' for ' + ticker + ' — trying browser fallback.');
        return null;
    }

    const json = await response.json();
    return json.data || null;
}
