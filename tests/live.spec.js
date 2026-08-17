const { test, expect } = require('@playwright/test');

// Real assertions against the deployed site — no stubbing. These prove that
// Pages actually serves index.html + data.json and that the 5-minute updater
// is putting genuine Bybit data in front of users.
//
// Skipped unless BASE_URL points at a deployed origin.
const LIVE = !!process.env.BASE_URL;

test.describe('Ro Terminal @ live URL', () => {
  test.skip(!LIVE, 'set BASE_URL to the deployed site to run the live suite');

  test('serves data.json with a fresh, non-placeholder Bybit snapshot', async ({ request }) => {
    const res = await request.get('data.json');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.placeholder ?? false).toBe(false);
    // 'bybit' when the runner can reach Bybit directly, 'bybit-via-coingecko'
    // when it falls back to the relay (Bybit geo-blocks US datacenter IPs).
    expect(body.source).toMatch(/^bybit/);
    expect(body.quote).toBe('USDT');
    expect(Array.isArray(body.tickers)).toBe(true);
    expect(body.tickers.length).toBeGreaterThan(50);
    expect(body.count).toBe(body.tickers.length);

    // Every symbol must be a USDT perp.
    for (const t of body.tickers) {
      expect(t.symbol.endsWith('USDT')).toBe(true);
      expect(t.symbol).not.toContain('-');
    }

    const ageMinutes = (Date.now() - Date.parse(body.generatedAt)) / 60000;
    expect(Number.isFinite(ageMinutes)).toBe(true);
    // Generous: GitHub's scheduler routinely runs late under load.
    expect(ageMinutes).toBeLessThan(90);
  });

  test('data.json carries sane prices for the majors', async ({ request }) => {
    const body = await (await request.get('data.json')).json();
    const bySymbol = Object.fromEntries(body.tickers.map((t) => [t.symbol, t]));

    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      const t = bySymbol[symbol];
      expect(t, `${symbol} present in data.json`).toBeTruthy();
      expect(t.last).toBeGreaterThan(0);
      expect(t.turnover24h).toBeGreaterThan(0);
      // high/low ship only when Bybit was reachable directly; the CoinGecko
      // relay does not carry them.
      if (t.high24h !== null) {
        expect(t.high24h).toBeGreaterThanOrEqual(t.last * 0.5);
        expect(t.low24h).toBeGreaterThan(0);
        expect(t.low24h).toBeLessThanOrEqual(t.high24h);
      }
    }
  });

  test('the page loads and renders live rows from data.json', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('app')).toBeVisible();
    // data.json must win the source chain on the deployed site.
    await expect(page.getByTestId('status-source')).toHaveText('data.json');
    await expect(page.getByTestId('status-dot')).toHaveClass(/ok/);
    await expect(page.getByTestId('error')).toBeHidden();

    const rows = page.locator('[data-testid="row"]');
    await expect(rows).toHaveCount(50); // default Top 50

    const total = Number(await page.getByTestId('total-count').textContent());
    expect(total).toBeGreaterThan(50);
  });

  test('BTCUSDT is on the board with a plausible price', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('search').fill('BTCUSDT');

    const row = page.locator('[data-symbol="BTCUSDT"]');
    await expect(row).toHaveCount(1);

    const last = Number((await row.getByTestId('cell-last').textContent()).replace(/,/g, ''));
    expect(Number.isFinite(last)).toBe(true);
    expect(last).toBeGreaterThan(1000); // sanity band, not a price prediction
    await expect(row.getByTestId('cell-change')).toHaveText(/^[+-]\d+\.\d{2}%$/);
  });

  test('loads without console errors or failed requests', async ({ page }) => {
    const problems = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('requestfailed', (req) => {
      problems.push(`requestfailed: ${req.url()} — ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`);
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="row"]').first()).toBeVisible();

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
