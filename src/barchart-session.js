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
        baseSymbolTypes,
        limit: String(limit),
        page: String(page),
        meta: 'field.shortName,field.type,field.description',
        raw: '1',
    });

    params.set('between(volumeOpenInterestRatio,1.24,)', '');
    params.set('between(lastPrice,.10,)', '');
    params.set(`between(tradeTime,${fromDate},${toDate})`, '');
    params.set('between(volume,500,)', '');
    params.set('between(openInterest,100,)', '');
    params.set('in(exchange,(AMEX,NYSE,NASDAQ,INDEX-CBOE))', '');

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`   Request URL: ${url.substring(0, 200)}`);
    console.log(`   XSRF token length: ${session.xsrfToken.length}`);
    console.log(`   Cookie header length: ${session.cookieHeader.length}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(session),
    });

    console.log(`   API response status: ${response.status}`);
    const responseText = await response.text();
    console.log(`   API response preview: ${responseText.substring(0, 500)}`);

    const json = JSON.parse(responseText);
    return {
        data: json.data || [],
        total: json.total || 0,
    };
}
