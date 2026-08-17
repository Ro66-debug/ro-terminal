# Ro Terminal — Handoff

> **Note on provenance.** The v0.2 `index.html`, `server.js` and `HANDOFF.md` referenced in
> the original task live in a claude.ai *Project* ("Crypto Trading"), not in a git repo, and
> were not reachable from the session that built this. Everything here was written fresh
> against the v0.2 brief. If you still have the originals, see
> [Swapping in the original v0.2 front end](#swapping-in-the-original-v02-front-end).

## What this is

A static, dependency-free board of **Bybit USDT perpetual futures**, published on GitHub
Pages. A GitHub Actions cron pulls Bybit every 5 minutes into `data.json`; the page reads
that snapshot first and only touches the network directly if the snapshot is missing.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | The whole front end — no build step, no dependencies. |
| `data.json` | Snapshot written by the updater. Committed to the repo and published to Pages. |
| `server.js` | Static dev server that mirrors Pages' behaviour. `npm start` → `localhost:8080`. |
| `scripts/fetch-bybit.js` | The updater. `npm run fetch` writes `data.json`. |
| `tests/ui.spec.js` | Playwright UI suite, network fully stubbed — deterministic anywhere. |
| `tests/live.spec.js` | Playwright suite against the *deployed* URL. Skipped unless `BASE_URL` is set. |
| `tests/fixtures/data.json` | Synthetic fixture for the stubbed suite. Not real market data. |

## The data source chain

`index.html` tries three sources in order and reports the winner in the status bar:

1. **`./data.json`** — the snapshot published alongside the page. Normal path.
2. **`raw.githubusercontent.com/.../main/data.json`** — covers the window where a data
   commit has landed but Pages has not rebuilt yet.
3. **Bybit `/v5/market/tickers?category=linear`** — direct, live, so the board still works
   if Actions is down entirely.

A snapshot is rejected as unusable if `tickers` is empty or it is the placeholder, so a
failed updater falls through rather than rendering a blank board. If every source fails the
page shows a red banner and `status-source` reads `offline` — it never renders a silently
empty table.

### `data.json` schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-17T20:05:00.000Z",  // ISO 8601, from Bybit's server clock
  "source": "bybit",
  "category": "linear",
  "quote": "USDT",
  "count": 512,
  "tickers": [
    {
      "symbol": "BTCUSDT",
      "last": 64250.5, "mark": 64251.2, "index": 64249.8, "prev24h": 62000,
      "change24hPct": 3.63,      // PERCENT — Bybit ships a ratio, the script multiplies by 100
      "high24h": 64890, "low24h": 61870.5,
      "volume24h": 51234.87, "turnover24h": 3284500000,
      "openInterest": 61234.5, "openInterestValue": 3934000000,
      "fundingRate": 0.0001,     // still a RATIO; the UI renders it as a percentage
      "nextFundingTime": 1755460800000,
      "bid": 64250.4, "ask": 64250.6
    }
  ]
}
```

Any field Bybit omits becomes `null`, never `0` — the UI renders `—` for those, so a missing
value can't be mistaken for a real one. Rows are sorted by 24h turnover, deepest first.

**USDT perps only.** Bybit's `linear` category also contains USDC perps and dated futures.
The filter is `symbol.endsWith('USDT') && !symbol.includes('-')`, applied in both the fetch
script and the browser.

## Workflows

| Workflow | Trigger | Does |
| --- | --- | --- |
| `update-data.yml` | `*/5 * * * *`, manual, push to `main` touching the script | Fetch Bybit → commit `data.json` → call `pages.yml` |
| `pages.yml` | push to `main`, manual, `workflow_call` | Stage `index.html` + `data.json` into `_site/`, deploy to Pages |
| `e2e.yml` | every push, manual, `workflow_call` | `local` job = stubbed suite; `live` job = suite against the deployed URL |

Three things worth knowing about the cron:

- **`schedule` only fires on the default branch.** On any other branch the cron is inert.
  This is a GitHub rule, not a config choice.
- **`*/5` is a floor, not a guarantee.** GitHub queues scheduled runs under load; 5–15
  minute intervals are normal in practice. The page shows the snapshot's true age and turns
  the status dot amber past 15 minutes rather than pretending the data is fresh.
- **A `GITHUB_TOKEN` push does not trigger other workflows.** That is why `update-data.yml`
  calls `pages.yml` through `workflow_call` instead of relying on the push trigger. Without
  it, `data.json` would update in the repo and never reach the site.

### Build volume

At `*/5` with `cancel-in-progress`, the updater deploys Pages up to 12×/hour. GitHub's soft
guidance for Pages is ~10 builds/hour. If you see deploys getting throttled, change the one
cron line in `update-data.yml` to `*/15 * * * *` — nothing else needs to change, and the
UI's staleness threshold (15 min) is already tuned for that.

## Running it

```bash
npm install
npm start                     # http://localhost:8080
npm run fetch                 # refresh data.json from Bybit (needs outbound HTTPS)

npx playwright install chromium
npm test                                       # stubbed UI suite, boots server.js itself
BASE_URL=https://ro66-debug.github.io/ro-terminal/ npm run test:live
```

If your machine already ships a Chromium that Playwright didn't install, point at it:
`CHROMIUM_PATH=/path/to/chromium npm test`.

## Swapping in the original v0.2 front end

The contract between the page and the pipeline is narrow — replacing `index.html` only
requires that the new page:

1. Fetches `./data.json` (relative) **first**, and treats `tickers: []` or
   `placeholder: true` as a miss rather than as "no markets today".
2. Reads `change24hPct` as a percent and `fundingRate` as a ratio.
3. Keeps the `data-testid` hooks the suites assert on: `app`, `status-source`, `status-dot`,
   `status-age`, `row-count`, `total-count`, `search`, `limit`, `refresh`, `error`,
   `warning`, `empty`, `tbody`, `row` (with `data-symbol`), `cell-symbol`, `cell-last`,
   `cell-change`.

Nothing in `scripts/`, `.github/workflows/` or `server.js` depends on the page's markup.

## Known gaps

- No historical series — each run overwrites `data.json`. Charts would need either a
  time-series file or a real datastore.
- No orderbook/trades depth; the board is ticker-level only.
- `raw.githubusercontent.com` caches for ~5 minutes, so fallback #2 can briefly serve a
  snapshot as old as the one it was meant to replace. It is a backstop, not a fast path.
