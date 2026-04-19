const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  try {
    // 1. Ticker details
    const [detailRes, prevRes, snapRes, histRes] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/2015-01-01/${new Date().toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=5000&apiKey=${KEY}`)
    ]);

    const detailData = await detailRes.json();
    const prevData   = await prevRes.json();
    const snapData   = await snapRes.json();
    const histData   = await histRes.json();

    const d    = detailData.results || {};
    const prev = prevData.results?.[0] || {};
    const snap = snapData.ticker || {};
    const day  = snap.day || {};
    const bars = histData.results || [];

    // 52w high/low
    const now365 = Date.now() - 365*86400000;
    const bars365 = bars.filter(b => b.t >= now365);
    const week52High = bars365.length ? Math.max(...bars365.map(b=>b.h)) : null;
    const week52Low  = bars365.length ? Math.min(...bars365.map(b=>b.l)) : null;
    const allTimeHigh = bars.length ? Math.max(...bars.map(b=>b.h)) : null;
    const allTimeLow  = bars.length ? Math.min(...bars.map(b=>b.l)) : null;

    // Float shares from snapshot
    const floatShares = snap.shareClassSharesOutstanding || d.share_class_shares_outstanding || null;
    const sharesOut   = d.weighted_shares_outstanding || d.share_class_shares_outstanding || null;

    // PE ratio: calculate from market cap and earnings if available
    // Try to get from snapshot fmv or details
    const price = snap.lastTrade?.p || day.c || prev.c || null;
    const mktCap = d.market_cap || null;

    // Beta from snapshot
    const beta = snap.beta || null;

    // Try financials for EPS/PE
    let peRatio = null, forwardPE = null, eps = null;
    try {
      const finRes = await fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=1&sort=period_of_report_date&order=desc&apiKey=${KEY}`);
      const finData = await finRes.json();
      const fin = finData.results?.[0];
      if (fin) {
        const epsBasic = fin.financials?.income_statement?.basic_earnings_per_share?.value;
        const epsDiluted = fin.financials?.income_statement?.diluted_earnings_per_share?.value;
        eps = epsDiluted || epsBasic || null;
        if (eps && price) peRatio = parseFloat((price / eps).toFixed(2));
      }
    } catch(e) {}

    const result = {
      symbol:      sym,
      name:        d.name || sym,
      prevClose:   prev.c || null,
      open:        day.o  || null,
      marketCap:   mktCap,
      sharesOutstanding: sharesOut,
      floatShares: floatShares,
      week52High,
      week52Low,
      allTimeHigh,
      allTimeLow,
      peRatio,
      forwardPE,
      beta,
      eps,
    };

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json(result);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
