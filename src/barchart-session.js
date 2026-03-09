/**
 * barchart-session.js
 *
 * Gets the XSRF token needed for Barchart API calls.
 * Uses a plain HTTP request instead of a full browser —
 * faster and more reliable on Apify's infrastructure.
 */

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

    // Extract cookies from response headers
    const rawCookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : [];

    // Build cookie header string
    const cookieMap = {};
    for (const cookie of rawCookies) {
        const [pair] = cookie.split(';');
        const [name, ...rest] = pair.split('=');
        cookieMap[name.trim()] = rest.join('=').trim();
    }

    const xsrfRaw = cookieMap['XSRF-TOKEN'];

    if (!xsrfRaw) {
        throw new Error(
            '❌ Could not find XSRF-TOKEN in Barchart response cookies. ' +
            'Barchart may have changed their auth flow.'
        );
    }

    const xsrfToken = decodeURIComponent(xsrfRaw);

    // Build full cookie header
    const cookieHeader = Object.entries(cookieMap)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    console.log('✅ Barchart session bootstrapped successfully.');
    return { xsrfToken, cookieHeader };
}
