const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  try {
    // 1. Ticker details (PE, Beta, market cap, shares, etc.)
    const detailUrl = `https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`;
    const detailRes = await fetch(detailUrl);
    const detailData = await detailRes.json();
    const d = detailData.results || {};

    // 2. Previous close
    const prevUrl = `https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${KEY}`;
    const prevRes = await fetch(prevUrl);
    const prevData = await prevRes.json();
    const prev = prevData.results?.[0] || {};

    // 3. Snapshot (current price, today's open, 52w high/low)
    const snapUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`;
    const snapRes = await fetch(snapUrl);
    const snapData = await snapRes.json();
    const snap = snapData.ticker || {};
    const day  = snap.day  || {};
    const prevDay = snap.prevDay || {};

    // 4. All-time high/low — use 10 year daily bars
    const now = new Date();
    const from10y = new Date(now - 10*365*86400000).toISOString().slice(0,10);
    const toStr   = now.toISOString().slice(0,10);
    const histUrl = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from10y}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${KEY}`;
    const histRes = await fetch(histUrl);
    const histData = await histRes.json();
    const bars = histData.results || [];
    const allTimeHigh = bars.length ? Math.max(...bars.map(b=>b.h)) : null;
    const allTimeLow  = bars.length ? Math.min(...bars.map(b=>b.l)) : null;

    // 52w high/low from last 365 days
    const now365 = now - 365*86400000;
    const bars365 = bars.filter(b => b.t >= now365);
    const week52High = bars365.length ? Math.max(...bars365.map(b=>b.h)) : null;
    const week52Low  = bars365.length ? Math.min(...bars365.map(b=>b.l)) : null;

    const result = {
      symbol:        sym,
      name:          d.name || sym,
      prevClose:     prev.c  || prevDay.c || null,
      open:          day.o   || null,
      high:          day.h   || null,
      low:           day.l   || null,
      price:         snap.lastTrade?.p || day.c || null,
      marketCap:     d.market_cap || null,
      sharesOutstanding: d.share_class_shares_outstanding || d.weighted_shares_outstanding || null,
      floatShares:   d.floating_shares || null,
      week52High,
      week52Low,
      allTimeHigh,
      allTimeLow,
      // Polygon basic plan doesn't include PE/Beta directly
      // These come from the ticker details if available
      peRatio:       d.pe_ratio || null,
      forwardPE:     d.forward_pe || null,
      beta:          d.beta || null,
      description:   d.description || null,
      listDate:      d.list_date || null,
      currency:      d.currency_name || 'USD',
    };

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json(result);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
