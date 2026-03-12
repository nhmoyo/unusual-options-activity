# Unusual Options Activity Scraper — Barchart

Scrape real-time unusual options activity, full options chains, and intraday flow data from Barchart. Identify smart money moves, sweep orders, and high-conviction signals by filtering contracts where today's volume dramatically exceeds open interest.

---

## What This Actor Does

This actor connects to Barchart's internal data API to extract structured options data across three modes:

- **Unusual Activity** — market-wide scan returning contracts where volume/OI ratio signals unusual positioning. Covers stocks, ETFs, and indices.
- **Options Chain** — full contract-level chain for one or more specific tickers, with optional expiry filtering.
- **Ticker Flow** — intraday order flow for specific tickers, including trade condition classification (ISO, electronic, floor, etc.).

Results are returned as clean, structured JSON — ready for downstream use in spreadsheets, Python, trading dashboards, or automated alert systems.

---

## Pricing

**$1.50 flat per run.** No per-record charges.

- You are only charged if the actor successfully delivers results.
- If the run fails or your filters return zero records, no charge is made.
- A single run in `unusual-activity` mode typically returns 800–1,200 records covering all meaningful signals across stocks, ETFs, and indices.

---

## Input Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `unusual-activity` | What data to fetch. See modes below. |
| `underlyingType` | string | `all` | Asset class filter: `all`, `stocks`, `etfs`, or `indices`. |
| `tickers` | array | `[]` | Required for `options-chain` and `ticker-flow` modes. E.g. `["AAPL", "NVDA", "SPY"]`. |
| `optionType` | string | `all` | Filter to `call`, `put`, or `all`. |
| `minVolumeOIRatio` | number | `1.5` | Minimum Vol/OI ratio. Higher = stronger unusual signal. Not applied to `ticker-flow`. |
| `minVolume` | number | `1` | Minimum contract volume. Filters out zero-volume noise. |
| `minPremium` | number | `10000` | Minimum total premium in USD. Applied to `unusual-activity` and `options-chain`. Not applied to `ticker-flow`. |
| `expirationDate` | string | `null` | For `options-chain` mode only. Format: `YYYY-MM-DD`. |
| `maxResults` | integer | `1000` | Maximum records returned. Results are ordered by Vol/OI ratio desc — lower values return only the strongest signals. Max: 5,000. |

---

## Output Schema

Every run begins with a `run-summary` record, followed by contract records.

### Run Summary

```json
{
  "type": "run-summary",
  "mode": "unusual-activity",
  "underlyingType": "all",
  "totalAvailable": 1143,
  "totalReturned": 1000,
  "truncated": true,
  "maxResults": 1000,
  "filtersApplied": {
    "optionType": "all",
    "minVolumeOIRatio": 1.5,
    "minPremium": 10000
  },
  "note": "Only top 1000 signals returned (ordered by Vol/OI ratio desc). Raise maxResults to get more.",
  "fetchedAt": "2026-03-10T09:15:00.000Z"
}
```

To filter out the summary record in downstream processing:

```python
# Python
records = [r for r in dataset if r.get('type') != 'run-summary']
```

```javascript
// JavaScript
const records = dataset.filter(r => r.type !== 'run-summary');
```

### Contract Records — `unusual-activity` and `options-chain`

```json
{
  "recordId": "b0534h",
  "ticker": "TSLA",
  "contractName": null,
  "type": "put",
  "strike": 490,
  "expiration": "2026-03-20",
  "daysToExpiry": 9,
  "lastPrice": 82.51,
  "bid": 81.70,
  "ask": 82.75,
  "volume": 21710,
  "openInterest": 157,
  "volumeOIRatio": 138.2803,
  "impliedVolatility": 0.6318,
  "weightedIV": 0.43278096333567,
  "delta": -0.967937,
  "moneyness": 0.20151047,
  "premium": 179129210,
  "underlyingPrice": 407.82,
  "sentiment": "bullish",
  "tradeTime": "2026-03-11T19:42:45.000Z",
  "retrievedAt": "2026-03-12T02:23:06.436Z",
  "source": "barchart-unusual-activity"
}
```

**Field notes:**
- `contractName` — the full Barchart symbol (e.g. `TSLA|20260320|490.00P`). This is `null` for `unusual-activity` records because Barchart does not return it on the unusual activity endpoint. It is present on `options-chain` and `ticker-flow` records.
- `volumeOIRatio` — rounded to 4 decimal places. Values below `0.01` would have shown as `0.00` at 2dp, which is why 4dp precision is used.
- `sentiment` — derived from where `lastPrice` falls relative to the bid/ask spread: above ask = `"bullish"` (aggressive buyer), below bid = `"bearish"` (aggressive seller), between = `"neutral"` or `"bullish"`/`"bearish"` based on which side of mid. Returns `"neutral"` when volume is zero.
- `premium` — total dollar value of the trade: `lastPrice × volume × 100`.
- `impliedVolatility` — expressed as a decimal (e.g. `0.63` = 63% IV). Note: the flow endpoint occasionally returns `0` for illiquid or end-of-day prints; treat `impliedVolatility: 0` as effectively null.

### Contract Records — `ticker-flow`

The flow endpoint returns a different field set. Key differences from the above:

```json
{
  "recordId": "u18m8z",
  "ticker": "AAPL",
  "contractName": "AAPL|20260320|290.00P",
  "type": "put",
  "strike": 290,
  "expiration": "2026-03-20",
  "daysToExpiry": null,
  "optionPrice": 29.95,
  "bid": 28.65,
  "ask": 31.25,
  "underlyingPrice": 259.9983,
  "volume": 1025,
  "openInterest": 135,
  "impliedVolatility": 34.064816047188,
  "premium": 3069875,
  "tradeCondition": "electronic",
  "sentiment": null,
  "tradeTime": "2026-03-11T18:24:33.000Z",
  "retrievedAt": "2026-03-12T02:11:12.715Z",
  "source": "barchart-ticker-flow"
}
```

**Differences from unusual-activity/options-chain:**
- `optionPrice` replaces `lastPrice` — the flow endpoint does not return a separate option last-trade price, so `optionPrice` is the bid/ask midpoint, which is the best available proxy.
- `underlyingPrice` — the underlying stock's last price at the time of the trade. This field is also present on `unusual-activity` and `options-chain` records.
- `lastPrice`, `volumeOIRatio`, `weightedIV`, `delta`, `moneyness` — not present on flow records.
- `daysToExpiry` — always `null` on flow records (not returned by the flow endpoint).
- `tradeCondition` — OPRA condition code for the print. Possible values: `"iso"` (intermarket sweep), `"electronic"`, `"market-maker"`, `"floor"`, `"cancel"`, `"auto-exec"`, `"spread"`, `"cross"`, `"quote"`.
- `sentiment` — always `null` on flow records. Because `optionPrice` is derived from the bid/ask mid, it is impossible to determine whether the trade was buyer- or seller-initiated.

---

## Record Identity and Deduplication

Every record has a `recordId` — a deterministic 6-character hash used to identify unique records across runs.

**How recordId is computed:**

| Mode | Key fields hashed |
|---|---|
| `unusual-activity` | `ticker \| type \| strike \| expiration \| tradeTime` |
| `ticker-flow` | `ticker \| type \| strike \| expiration \| tradeTime` |
| `options-chain` | `ticker \| type \| strike \| expiration` |

`tradeTime` is included for trade-level modes so that two separate fills on the same contract at different times produce different `recordId` values. It is omitted for `options-chain` because the chain is a snapshot — the contract itself is the stable identity regardless of when it was fetched. This means `options-chain` `recordId` values are fully stable across runs.

**Each run returns a full snapshot**, not incremental data. To merge two runs and remove duplicates:

```python
import json

run1 = [r for r in dataset1 if r.get('type') != 'run-summary']
run2 = [r for r in dataset2 if r.get('type') != 'run-summary']

seen = set()
merged = []
for record in run1 + run2:
    if record['recordId'] not in seen:
        seen.add(record['recordId'])
        merged.append(record)

print(f"{len(merged)} unique records")
```

New trades on the same contract will have a different `tradeTime` and therefore a different `recordId` — so you won't lose genuinely new activity by deduplicating.

---

## Modes In Detail

### `unusual-activity` (default)

Scans the full market for contracts where today's volume is unusually high relative to existing open interest. This is the primary signal used by options flow traders to identify institutional positioning, sweep orders, and potential directional bets.

Results are ordered by Vol/OI ratio descending — strongest signals first.

**When to use:** Daily market scans, alert systems, screening for high-conviction setups.

**Recommended schedule:** Run once or twice per trading day — pre-market and mid-afternoon EST capture the most actionable signals.

```json
{
  "mode": "unusual-activity",
  "underlyingType": "stocks",
  "optionType": "call",
  "minVolumeOIRatio": 5,
  "minPremium": 50000
}
```

---

### `options-chain`

Returns the full options chain for one or more tickers. Useful for building a complete picture of positioning across all strikes and expiries for a specific stock. Results are ordered by strike price ascending.

```json
{
  "mode": "options-chain",
  "tickers": ["AAPL", "NVDA"],
  "expirationDate": "2026-04-17"
}
```

---

### `ticker-flow`

Returns intraday order flow for specific tickers — individual trades rather than aggregated contract snapshots. Includes trade condition classification via OPRA codes.

Note: `minVolumeOIRatio` and `minPremium` filters are not applied in this mode. Use `optionType` to filter to calls or puts.

```json
{
  "mode": "ticker-flow",
  "tickers": ["SPY", "QQQ"],
  "optionType": "call"
}
```

---

## Scheduling Recommendations

| Use Case | Schedule | Mode |
|---|---|---|
| Daily morning scan | 9:45 AM EST (market open + 15 min) | `unusual-activity` |
| Intraday refresh | 2:00 PM EST | `unusual-activity` |
| EOD full capture | 4:15 PM EST | `unusual-activity` |
| Ticker monitoring | Every 30 min during market hours | `ticker-flow` |

---

## Cost Examples

| Run Type | Typical Records | Cost |
|---|---|---|
| Full market scan (all types) | ~1,000 | $1.50 |
| Stocks only | ~600 | $1.50 |
| Options chain, 5 tickers | ~500 | $1.50 |
| Twice daily, full scan | ~2,000/day | $3.00/day (~$90/month) |
| Once daily, full scan | ~1,000/day | $1.50/day (~$45/month) |

For comparison, Unusual Whales charges $50/month for dashboard access. This actor gives you raw structured data you can plug directly into your own systems, scripts, and alerts.

---

## Alternatives Compared

| Service | Price | Data Access | Automation |
|---|---|---|---|
| Unusual Whales | $50/month | Dashboard only | No |
| Market Chameleon | $40/month | Dashboard only | No |
| Cheddar Flow | $49/month | Dashboard only | No |
| **This Actor** | **$1.50/run** | **Raw JSON** | **Full API** |

---

## Legal & Data Usage

This actor accesses publicly available data from Barchart.com. Users are responsible for ensuring their use of the data complies with Barchart's terms of service and any applicable financial data regulations in their jurisdiction. This actor is not affiliated with or endorsed by Barchart.

---

## Support

If you encounter issues or have feature requests, please use the **Issues** tab on this actor's Apify Store page. Include your run ID and a description of the problem.
