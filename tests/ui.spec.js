const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures/data.json');

// These specs stub the network so they behave identically on a laptop, in CI,
// and against the deployed site. Live-data assertions live in live.spec.js.

const BYBIT_GLOB = '**/api.bybit.com/**';
const RAW_GLOB = '**/raw.githubusercontent.com/**';

function snapshot({ ageMs = 30_000, tickers = fixture.tickers } = {}) {
  return {
    ...fixture,
    generatedAt: new Date(Date.now() - ageMs).toISOString(),
    count: tickers.length,
    tickers,
  };
}

/** Serve a data.json body and block every fallback so the chain is unambiguous. */
async function stub(page, { dataJson, rawJson, bybitJson } = {}) {
  await page.route('**/data.json*', async (route) => {
    if (dataJson === 'abort') return route.abort();
    if (dataJson === 404) return route.fulfill({ status: 404, body: 'not found' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(dataJson ?? snapshot()) });
  });

  await page.route(RAW_GLOB, async (route) => {
    if (!rawJson) return route.abort();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rawJson) });
  });

  await page.route(BYBIT_GLOB, async (route) => {
    if (!bybitJson) return route.abort();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(bybitJson) });
  });
}

const rows = (page) => page.locator('[data-testid="row"]');

test.describe('Ro Terminal UI', () => {
  test('renders the board from data.json and reports it as the source', async ({ page }) => {
    await stub(page);
    await page.goto('/');

    await expect(page.getByTestId('status-source')).toHaveText('data.json');
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByTestId('row-count')).toHaveText('4');
    await expect(page.getByTestId('total-count')).toHaveText('4');
    await expect(page.getByTestId('error')).toBeHidden();
    await expect(page.getByTestId('status-dot')).toHaveClass(/ok/);
  });

  test('sorts by 24h turnover descending by default', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    const symbols = await rows(page).evaluateAll((els) => els.map((el) => el.dataset.symbol));
    expect(symbols).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT']);
  });

  test('clicking a column header re-sorts the board', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    await page.locator('th[data-key="change24hPct"]').click();
    let symbols = await rows(page).evaluateAll((els) => els.map((el) => el.dataset.symbol));
    expect(symbols[0]).toBe('BTCUSDT'); // +3.63 is the largest gain
    expect(symbols[symbols.length - 1]).toBe('DOGEUSDT'); // -5.25 is the largest loss

    await page.locator('th[data-key="change24hPct"]').click(); // toggle to ascending
    symbols = await rows(page).evaluateAll((els) => els.map((el) => el.dataset.symbol));
    expect(symbols[0]).toBe('DOGEUSDT');
  });

  test('filters symbols and shows the empty state for no matches', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    await page.getByTestId('search').fill('eth');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-symbol', 'ETHUSDT');
    await expect(page.getByTestId('row-count')).toHaveText('1');

    await page.getByTestId('search').fill('zzzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('empty')).toBeVisible();
  });

  test('colours gains green and losses red', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await expect(rows(page)).toHaveCount(4);

    const btc = page.locator('[data-symbol="BTCUSDT"]');
    await expect(btc.getByTestId('cell-change')).toHaveText('+3.63%');
    await expect(btc.getByTestId('cell-change')).toHaveClass('up');

    const doge = page.locator('[data-symbol="DOGEUSDT"]');
    await expect(doge.getByTestId('cell-change')).toHaveText('-5.25%');
    await expect(doge.getByTestId('cell-change')).toHaveClass('down');
  });

  test('falls back to raw.githubusercontent when data.json is a placeholder', async ({ page }) => {
    await stub(page, {
      dataJson: { schemaVersion: 1, placeholder: true, count: 0, tickers: [] },
      rawJson: snapshot(),
    });
    await page.goto('/');

    await expect(page.getByTestId('status-source')).toHaveText('raw:data.json');
    await expect(rows(page)).toHaveCount(4);
  });

  test('falls back to the live Bybit API when both snapshots fail', async ({ page }) => {
    await stub(page, {
      dataJson: 404,
      bybitJson: {
        retCode: 0,
        retMsg: 'OK',
        time: Date.now(),
        result: {
          category: 'linear',
          list: [
            {
              symbol: 'BTCUSDT', lastPrice: '64250.5', markPrice: '64251.2', indexPrice: '64249.8',
              price24hPcnt: '0.0363', highPrice24h: '64890', lowPrice24h: '61870.5',
              volume24h: '51234.87', turnover24h: '3284500000', openInterest: '61234.5',
              openInterestValue: '3934000000', fundingRate: '0.0001', nextFundingTime: '1755460800000',
              bid1Price: '64250.4', ask1Price: '64250.6',
            },
            // Not a USDT perp — must be filtered out client-side.
            { symbol: 'BTCPERP', lastPrice: '64250.5', price24hPcnt: '0.0363' },
            { symbol: 'BTC-28MAR25', lastPrice: '65000', price24hPcnt: '0.01' },
          ],
        },
      },
    });
    await page.goto('/');

    await expect(page.getByTestId('status-source')).toHaveText('bybit-live');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-symbol', 'BTCUSDT');
    // price24hPcnt is a ratio upstream; the UI must show it as a percentage.
    await expect(rows(page).first().getByTestId('cell-change')).toHaveText('+3.63%');
  });

  test('surfaces an error banner when every source is unavailable', async ({ page }) => {
    await stub(page, { dataJson: 'abort' });
    await page.goto('/');

    await expect(page.getByTestId('error')).toBeVisible();
    await expect(page.getByTestId('status-source')).toHaveText('offline');
    await expect(page.getByTestId('status-dot')).toHaveClass(/err/);
    await expect(rows(page)).toHaveCount(0);
  });

  test('warns when the snapshot is older than the update interval allows', async ({ page }) => {
    await stub(page, { dataJson: snapshot({ ageMs: 40 * 60 * 1000 }) });
    await page.goto('/');

    await expect(page.getByTestId('warning')).toBeVisible();
    await expect(page.getByTestId('warning')).toContainText('5-minute updater');
    await expect(page.getByTestId('status-dot')).toHaveClass(/stale/);
    await expect(rows(page)).toHaveCount(4); // still renders the stale data
  });

  test('honours the row limit selector', async ({ page }) => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      ...fixture.tickers[0],
      symbol: `SYM${String(i).padStart(3, '0')}USDT`,
      turnover24h: 1_000_000 - i,
    }));
    await stub(page, { dataJson: snapshot({ tickers: many }) });
    await page.goto('/');

    await expect(rows(page)).toHaveCount(50); // default Top 50
    await page.getByTestId('limit').selectOption('25');
    await expect(rows(page)).toHaveCount(25);
    await page.getByTestId('limit').selectOption('0');
    await expect(rows(page)).toHaveCount(80);
    await expect(page.getByTestId('total-count')).toHaveText('80');
  });

  test('is usable on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stub(page);
    await page.goto('/');

    await expect(rows(page)).toHaveCount(4);
    // The page itself must not scroll sideways; the table scrolls in its wrapper.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
