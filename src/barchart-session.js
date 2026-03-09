export async function getBarchartSession() {
    console.log('🔑 Bootstrapping Barchart session...');

    const response = await fetch('https://www.barchart.com/options/unusual-activity/stocks', {
        method: 'GET',
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) ' +
                'Gecko/20100101 Firefox/148.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
    });

    console.log(`   Status: ${response.status}`);

    // Log all response headers for debugging
    for (const [key, value] of response.headers.entries()) {
        console.log(`   Header: ${key} = ${value}`);
    }

    const rawCookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : [];

    console.log(`   Raw cookies count: ${rawCookies.length}`);
    rawCookies.forEach((c, i) => console.log(`   Cookie ${i}: ${c.substring(0, 80)}...`));

    const cookieMap = {};
    for (const cookie of rawCookies) {
        const [pair] = cookie.split(';');
        const [name, ...rest] = pair.split('=');
        cookieMap[name.trim()] = rest.join('=').trim();
    }

    const xsrfRaw = cookieMap['XSRF-TOKEN'];
    console.log(`   XSRF-TOKEN found: ${!!xsrfRaw}`);

    if (!xsrfRaw) {
        // Don't throw — try continuing with empty token to see what Barchart returns
        console.log('⚠️  No XSRF token found — proceeding without it to debug response');
        return { xsrfToken: '', cookieHeader: '' };
    }

    const xsrfToken = decodeURIComponent(xsrfRaw);
    const cookieHeader = Object.entries(cookieMap)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    console.log('✅ Barchart session bootstrapped successfully.');
    return { xsrfToken, cookieHeader };
}
