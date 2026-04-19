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
        if (fg) fng = {
          score:      Math.round(fg.score || 0),
          rating:     fg.rating || '',
          prev_close: Math.round(fg.previous_close || 0),
          prev_week:  Math.round(fg.previous_1_week || 0),
          prev_month: Math.round(fg.previous_1_month || 0),
          prev_year:  Math.round(fg.previous_1_year || 0),
        };
      }
    } catch(e) {}

    // ── Shiller CAPE — free API, no key needed ────────────────────────────────
    let cape = [];
    try {
      const r2 = await fetch('https://posix4e.github.io/shiller_wrapper_data/data/stock_market_data.json');
      if (r2.ok) {
        const d2 = await r2.json();
        const cutoff = new Date(Date.now() - 10*365*86400000);
        cape = (d2.data || [])
          .filter(row => row.cape && !isNaN(row.cape) && new Date(row.date) >= cutoff)
          .map(row => ({ date: row.date.slice(0,7), value: parseFloat(parseFloat(row.cape).toFixed(2)) }));
      }
    } catch(e) {}

    // Fallback: SPY monthly if CAPE fails
    if (!cape.length) {
      try {
        const now = new Date();
        const from = new Date(now - 10*365*86400000).toISOString().slice(0,10);
        const to   = now.toISOString().slice(0,10);
        let url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/month/${from}/${to}?adjusted=true&sort=asc&limit=200&apiKey=${KEY}`;
        let all = [];
        while (url) {
          const r3 = await fetch(url);
          if (!r3.ok) break;
          const d3 = await r3.json();
          if (d3.results?.length) all = all.concat(d3.results);
          url = d3.next_url ? d3.next_url + `&apiKey=${KEY}` : null;
        }
        cape = all.map(r => ({ date: new Date(r.t).toISOString().slice(0,7), value: parseFloat(r.c.toFixed(2)), isSPY: true }));
      } catch(e) {}
    }

    return res.status(200).json({ fng, cape });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
