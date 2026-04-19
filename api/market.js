module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800');

  try {
    // ── CNN Fear & Greed Index ────────────────────────────────────────────────
    let fng = null;
    try {
      const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.cnn.com/' }
      });
      if (r.ok) {
        const d = await r.json();
        fng = {
          score: Math.round(d.fear_and_greed?.score || 0),
          rating: d.fear_and_greed?.rating || '',
          prev_close: Math.round(d.fear_and_greed?.previous_close || 0),
          prev_week: Math.round(d.fear_and_greed?.previous_1_week || 0),
          prev_month: Math.round(d.fear_and_greed?.previous_1_month || 0),
          prev_year: Math.round(d.fear_and_greed?.previous_1_year || 0),
        };
      }
    } catch(e) {}

    // ── S&P500 PE Ratio from FRED (Shiller CAPE) ──────────────────────────────
    let cape = [];
    try {
      const fredUrl = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CAPE';
      const r2 = await fetch(fredUrl);
      if (r2.ok) {
        const csv = await r2.text();
        const rows = csv.trim().split('\n').slice(1);
        // Get last 10 years
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 10);
        cape = rows
          .map(row => { const [date, val] = row.split(','); return { date, value: parseFloat(val) }; })
          .filter(r => r.value && !isNaN(r.value) && new Date(r.date) >= cutoff);
      }
    } catch(e) {}

    // ── Fallback: SPY PE from Polygon snapshot ────────────────────────────────
    let spyPE = null;
    try {
      const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';
      const r3 = await fetch(`https://api.polygon.io/v3/reference/tickers/SPY?apiKey=${KEY}`);
      if (r3.ok) {
        const d3 = await r3.json();
        spyPE = d3.results?.pe_ratio || null;
      }
    } catch(e) {}

    return res.status(200).json({ fng, cape, spyPE });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
