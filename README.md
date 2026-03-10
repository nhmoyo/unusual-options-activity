# Unusual Options Activity Scraper — Barchart

Scrape real-time unusual options activity, full options chains, and intraday flow data from Barchart. Identify smart money moves, sweep orders, and high-conviction signals by filtering contracts where today's volume dramatically exceeds open interest.

---

## What This Actor Does

This actor connects to Barchart's internal data API to extract structured options data across three modes:

- **Unusual Activity** — market-wide scan returning contracts where volume/OI ratio signals unusual positioning. Covers stocks, ETFs, and indices.
- **Options Chain** — full contract-level chain for one or more specific tickers, with optional expiry filtering.
- **Ticker Flow** — intraday order flow for specific tickers, including sweep and block trade classification.

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
| `minVolumeOIRatio` | number | `1.5` | Minimum Vol/OI ratio. Higher = stronger unusual signal. |
| `minPremium` | number | `10000` | Minimum total premium in USD. Filters out low-dollar noise. |
| `expirationDate` | string | `null` | For `options-chain` mode only. Format: `YYYY-MM-DD`. |
| `maxResults` | integer | `1000` | Advanced. Maximum records returned. Results ordered by Vol/OI ratio desc — lower values return only the strongest signals. Max: 5,000. |

---

## Output Schema

Every record includes a `recordId` — a deterministic hash of `contractName + tradeTime`. Use this to deduplicate records when running the actor multiple times per day, since each run returns a full snapshot rather than incremental data.

The first record in every dataset is always a `run-summary` object:

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

Contract records follow this schema:

```json
{
  "recordId": "3f8a1b",
  "ticker": "TSLA",
  "contractName": "TSLA|20260320|490.00P",
  "type": "put",
  "strike": 490,
  "expiration": "2026-03-20",
  "daysToExpiry": 10,
  "lastPrice": 97.80,
  "bid": 90.05,
  "ask": 90.95,
  "volume": 17200,
  "openInterest": 158,
  "volumeOIRatio": 108.86,
  "impliedVolatility": 0.5494,
  "weightedIV": 0.4395,
  "delta": -0.9889,
  "moneyness": 0.2404,
  "premium": 168216000,
  "underlyingPrice": 398.68,
  "sentiment": "bearish",
  "tradeTime": "2026-03-09T18:35:05.000Z",
  "retrievedAt": "2026-03-10T09:15:00.000Z",
  "source": "barchart-unusual-activity"
}
```

To filter out the summary record in your downstream processing:

```python
# Python
records = [r for r in dataset if r.get('type') != 'run-summary']
```

```javascript
// JavaScript
const records = dataset.filter(r => r.type !== 'run-summary');
```

---

## Modes In Detail

### `unusual-activity` (default)

Scans the full market for contracts where today's volume is unusually high relative to existing open interest. This is the primary signal used by options flow traders to identify institutional positioning, sweep orders, and potential directional bets.

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

Returns the full options chain for one or more tickers. Useful for building a complete picture of positioning across all strikes and expiries for a specific stock.

```json
{
  "mode": "options-chain",
  "tickers": ["AAPL", "NVDA"],
  "expirationDate": "2026-04-17"
}
```

---

### `ticker-flow`

Returns intraday order flow for specific tickers, including trade condition flags (sweep, block, split, floor). This is the most granular data — individual trades rather than aggregated contract snapshots.

```json
{
  "mode": "ticker-flow",
  "tickers": ["SPY", "QQQ"]
}
```

---

## Deduplication Across Runs

Each run returns a **full snapshot** of current market data — not incremental updates. If you run the actor multiple times per day, records for the same contract at the same `tradeTime` will have identical `recordId` values.

**To merge two runs and remove duplicates:**

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
