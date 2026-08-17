#!/usr/bin/env node
/**
 * Fetches Bybit USDT perpetual tickers and writes them to data.json.
 *
 * Run by .github/workflows/update-data.yml every 5 minutes, and usable
 * locally with `npm run fetch`.
 *
 * Bybit v5 public endpoint, no auth required:
 *   GET /v5/market/tickers?category=linear
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const TICKERS_URL = 'https://api.bybit.com/v5/market/tickers?category=linear';
const OUT_FILE = path.join(__dirname, '..', 'data.json');
const SCHEMA_VERSION = 1;

// Bybit's `linear` category mixes USDT perps, USDC perps and dated futures.
// USDT perps are exactly the symbols ending in USDT with no dated suffix.
function isUsdtPerp(symbol) {
  return symbol.endsWith('USDT') && !symbol.includes('-');
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json', 'user-agent': 'ro-terminal/0.2' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const body = await res.json();
        if (body.retCode !== 0) {
          throw new Error(`Bybit retCode ${body.retCode}: ${body.retMsg}`);
        }
        return body;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
      console.error(`attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt < attempts) {
        const backoff = 2000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

function toRow(t) {
  const last = num(t.lastPrice);
  const prev = num(t.prevPrice24h);
  return {
    symbol: t.symbol,
    last,
    mark: num(t.markPrice),
    index: num(t.indexPrice),
    prev24h: prev,
    // Bybit ships this as a ratio (0.0123); the UI wants percent.
    change24hPct: num(t.price24hPcnt) === null ? null : num(t.price24hPcnt) * 100,
    high24h: num(t.highPrice24h),
    low24h: num(t.lowPrice24h),
    volume24h: num(t.volume24h),
    turnover24h: num(t.turnover24h),
    openInterest: num(t.openInterest),
    openInterestValue: num(t.openInterestValue),
    fundingRate: num(t.fundingRate),
    nextFundingTime: num(t.nextFundingTime),
    bid: num(t.bid1Price),
    ask: num(t.ask1Price),
  };
}

async function main() {
  const body = await fetchWithRetry(TICKERS_URL);
  const list = Array.isArray(body?.result?.list) ? body.result.list : [];

  const tickers = list
    .filter((t) => t?.symbol && isUsdtPerp(t.symbol))
    .map(toRow)
    // Deepest markets first — the terminal shows the top of this list.
    .sort((a, b) => (b.turnover24h ?? 0) - (a.turnover24h ?? 0));

  if (tickers.length === 0) {
    throw new Error('Bybit returned 0 USDT perpetuals — refusing to write an empty data.json');
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(Number(body.time) || Date.now()).toISOString(),
    source: 'bybit',
    category: 'linear',
    quote: 'USDT',
    count: tickers.length,
    tickers,
  };

  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${OUT_FILE} — ${tickers.length} USDT perps at ${payload.generatedAt}`);
}

main().catch((err) => {
  console.error(`fetch-bybit failed: ${err.message}`);
  process.exit(1);
});
