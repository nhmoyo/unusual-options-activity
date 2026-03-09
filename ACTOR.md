# Options Flow & Unusual Activity Scraper

Scrapes real-time **unusual options activity**, full **options chains**, and **ticker-level flow data** from Barchart. Identify institutional moves, sweep orders, and abnormal volume signals — all in clean JSON, ready for trading bots, dashboards, and research pipelines.

---

## What You Get

Each result includes:

| Field | Description |
|---|---|
| `ticker` | Underlying stock symbol (e.g. NVDA) |
| `contractName` | Full OCC contract identifier |
| `type` | `call` or `put` |
| `strike` | Strike price |
| `expiration` | Expiration date (YYYY-MM-DD) |
| `daysToExpiry` | Calendar days until expiration |
| `lastPrice` | Last traded price of the option |
| `bid` / `ask` | Current bid and ask prices |
| `volume` | Today's volume |
| `openInterest` | Open interest (existing contracts) |
| `volumeOIRatio` | Volume ÷ Open Interest — key unusual activity signal |
| `impliedVolatility` | Implied volatility (decimal, e.g. 0.68 = 68%) |
| `premium` | Total dollar value (price × volume × 100) |
| `sentiment` | `bullish`, `bearish`, or `neutral` based on bid/ask side |
| `tradeCondition` | `sweep`, `block`, `split`, `floor` (flow mode only) |
| `tradeTime` | Timestamp of the trade |

---

## Modes

### 1. Unusual Activity (default)
Market-wide scan. Returns all contracts where volume significantly exceeds open interest — a classic signal that large traders are opening new positions.

**Best for:** Daily market scanning, building watchlists, trading bot triggers.

### 2. Options Chain
Full options chain for one or more tickers. All strikes and expirations with volume, OI, IV, and bid/ask data.

**Best for:** Building options analytics tools, volatility analysis, hedging research.

### 3. Ticker Flow
Intraday trade-by-trade activity for specific tickers. Shows individual sweep and block orders with sentiment direction.

**Best for:** Following institutional positioning on specific stocks you're watching.

---

## Example Output (Unusual Activity)

```json
{
  "ticker": "NVDA",
  "contractName": "NVDA250321C00950000",
  "type": "call",
  "strike": 950,
  "expiration": "2025-03-21",
  "daysToExpiry": 12,
  "lastPrice": 4.20,
  "bid": 4.10,
  "ask": 4.30,
  "volume": 18500,
  "openInterest": 1200,
  "volumeOIRatio": 15.4,
  "impliedVolatility": 0.68,
  "premium": 776700,
  "underlyingPrice": 942.50,
  "sentiment": "bullish",
  "tradeTime": "2025-03-09T14:32:00Z",
  "retrievedAt": "2025-03-09T14:35:00Z",
  "source": "barchart-unusual-activity"
}
```

---

## Pricing

- **$0.05** flat fee per run (covers compute startup)
- **$0.002** per result returned (~$2 per 1,000 results)

A typical unusual activity scan returning 300 results costs approximately **$0.65**.

---

## Tips

- Set **Min Volume/OI Ratio** to `5.0` or higher for the strongest unusual activity signals
- Set **Min Premium** to `100000` ($100k) to filter for institutional-size trades only
- Schedule this actor to run every 30 minutes during market hours for a continuous signal feed
- Use **Calls only** + high premium filter to find bullish institutional bets specifically

---

## Data Source

Data is sourced from Barchart's publicly accessible options pages. Options data is delayed approximately 15–25 minutes. This actor is for informational and research purposes only — not financial advice.
