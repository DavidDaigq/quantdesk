const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

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
            score:      Math.round(fg.score || 0),
            rating:     fg.rating || '',
            prev_close: Math.round(fg.previous_close || 0),
            prev_week:  Math.round(fg.previous_1_week || 0),
            prev_month: Math.round(fg.previous_1_month || 0),
            prev_year:  Math.round(fg.previous_1_year || 0),
          };
        }
      }
    } catch(e) {}

    // ── SPY monthly price - last 10 years, paginate to get all data ───────────
    let cape = [];
    try {
      const now = new Date();
      const from10y = new Date(now - 10*365*86400000).toISOString().slice(0,10);
      const toStr   = now.toISOString().slice(0,10);

      // Fetch all pages
      let url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/month/${from10y}/${toStr}?adjusted=true&sort=asc&limit=200&apiKey=${KEY}`;
      let allResults = [];

      while (url) {
        const r = await fetch(url);
        if (!r.ok) break;
        const d = await r.json();
        if (d.results?.length) allResults = allResults.concat(d.results);
        // Check for next page
        url = d.next_url ? d.next_url + `&apiKey=${KEY}` : null;
        if (!d.next_url) break;
      }

      cape = allResults.map(r => ({
        date: new Date(r.t).toISOString().slice(0,10),
        value: parseFloat(r.c.toFixed(2)),
        isSPY: true
      }));
    } catch(e) {}

    return res.status(200).json({ fng, cape, spyPE: null });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
