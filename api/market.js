const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800');

  try {
    // ── CNN Fear & Greed ──────────────────────────────────────────────────────
    let fng = null;
    try {
      const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.cnn.com/markets/fear-and-greed',
          'Origin': 'https://www.cnn.com'
        }
      });
      if (r.ok) {
        const d = await r.json();
        const fg = d.fear_and_greed;
        if (fg) {
          fng = {
            score: Math.round(fg.score || 0),
            rating: fg.rating || '',
            prev_close: Math.round(fg.previous_close || 0),
            prev_week: Math.round(fg.previous_1_week || 0),
            prev_month: Math.round(fg.previous_1_month || 0),
            prev_year: Math.round(fg.previous_1_year || 0),
          };
        }
      }
    } catch(e) {}

    // ── Shiller CAPE from FRED API (no key needed for public data) ────────────
    let cape = [];
    try {
      // FRED public API for Shiller PE10/CAPE
      const fredUrl = 'https://api.stlouisfed.org/fred/series/observations?series_id=CAPE&observation_start=' +
        new Date(Date.now() - 10*365*86400000).toISOString().slice(0,10) +
        '&api_key=anonymouskey&file_type=json&sort_order=asc';
      const r2 = await fetch(fredUrl);
      if (r2.ok) {
        const d2 = await r2.json();
        cape = (d2.observations || [])
          .filter(o => o.value !== '.')
          .map(o => ({ date: o.date, value: parseFloat(o.value) }));
      }
    } catch(e) {}

    // Fallback: use multpl.com style data via alternative
    if (!cape.length) {
      try {
        // Use FRED with correct anonymous endpoint
        const r3 = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CAPE&vintage_date=' + new Date().toISOString().slice(0,10));
        if (r3.ok) {
          const csv = await r3.text();
          const rows = csv.trim().split('\n').slice(1);
          const cutoff = new Date(Date.now() - 10*365*86400000);
          cape = rows
            .map(row => { const parts = row.split(','); return { date: parts[0], value: parseFloat(parts[1]) }; })
            .filter(r => r.value && !isNaN(r.value) && new Date(r.date) >= cutoff);
        }
      } catch(e) {}
    }

    // ── SPY PE from Polygon ───────────────────────────────────────────────────
    let spyPE = null;
    try {
      const r4 = await fetch(`https://api.polygon.io/v3/reference/tickers/SPY?apiKey=${KEY}`);
      if (r4.ok) {
        const d4 = await r4.json();
        spyPE = d4.results?.pe_ratio || null;
      }
    } catch(e) {}

    // ── SPY price history as PE proxy (if no CAPE data) ───────────────────────
    // Use SPY/earnings ratio approximation from price data
    if (!cape.length) {
      try {
        const now = new Date();
        const from10y = new Date(now - 10*365*86400000).toISOString().slice(0,10);
        const toStr = now.toISOString().slice(0,10);
        const r5 = await fetch(`https://api.polygon.io/v2/aggs/ticker/SPY/range/1/month/${from10y}/${toStr}?adjusted=true&sort=asc&limit=200&apiKey=${KEY}`);
        if (r5.ok) {
          const d5 = await r5.json();
          if (d5.results?.length) {
            // Approximate PE using SPY price (rough proxy, not real PE)
            // SPY tracks S&P500, historical PE avg ~15-25
            // We'll label this as "SPY价格走势" instead
            cape = d5.results.map(r => ({
              date: new Date(r.t).toISOString().slice(0,10),
              value: parseFloat(r.c.toFixed(2)),
              isSPY: true
            }));
          }
        }
      } catch(e) {}
    }

    return res.status(200).json({ fng, cape, spyPE });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
