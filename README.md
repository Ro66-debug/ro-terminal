# Ro Terminal

A static terminal-style board of **Bybit USDT perpetual futures**, published on GitHub Pages.

**Live:** https://ro66-debug.github.io/ro-terminal/

A GitHub Actions cron pulls Bybit's public v5 ticker endpoint every 5 minutes into
`data.json`; the page reads that snapshot first, falling back to `raw.githubusercontent.com`
and then to the Bybit API directly. No build step, no dependencies at runtime.

```bash
npm install
npm start        # http://localhost:8080
npm run fetch    # refresh data.json from Bybit
npm test         # Playwright UI suite (network stubbed)
```

See [HANDOFF.md](HANDOFF.md) for the data schema, the workflow wiring, and the notes you
need before changing the cron or replacing the front end.

Informational only — not trading advice.
