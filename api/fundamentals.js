const POLYGON_KEY  = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';
const FINNHUB_KEY  = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';

async function getDailyReturns(sym, fromStr, toStr) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=365&apiKey=${POLYGON_KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  const bars = d.results || [];
  const returns = [];
  for (let i = 1; i < bars.length; i++) {
    returns.push((bars[i].c - bars[i-1].c) / bars[i-1].c);
  }
  return { returns, bars };
}

function calcBeta(stockReturns, marketReturns) {
  const n = Math.min(stockReturns.length, marketReturns.length);
  if (n < 20) return null;
  const sr = stockReturns.slice(-n);
  const mr = marketReturns.slice(-n);
  const avgS = sr.reduce((a,b)=>a+b,0)/n;
  const avgM = mr.reduce((a,b)=>a+b,0)/n;
  let cov = 0, varM = 0;
  for (let i = 0; i < n; i++) {
    cov  += (sr[i]-avgS)*(mr[i]-avgM);
    varM += (mr[i]-avgM)*(mr[i]-avgM);
  }
  if (varM === 0) return null;
  return parseFloat((cov/varM).toFixed(3));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  try {
    const now    = new Date();
    const toStr  = now.toISOString().slice(0,10);
    const from1y = new Date(now - 370*86400000).toISOString().slice(0,10);
    const from10y= new Date(now - 10*365*86400000).toISOString().slice(0,10);

    // 并行拉取 Polygon 基础数据 + Finnhub 估值数据
    const [detailRes, prevRes, snapRes, histRes, stockRetData, spyRetData, finnhubRes] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from10y}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`),
      getDailyReturns(sym,   from1y, toStr),
      getDailyReturns('SPY', from1y, toStr),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`),
    ]);

    const detailData  = await detailRes.json();
    const prevData    = await prevRes.json();
    const snapData    = await snapRes.json();
    const histData    = await histRes.json();
    const finnhubData = await finnhubRes.json();

    const d    = detailData.results || {};
    const prev = prevData.results?.[0] || {};
    const snap = snapData.ticker || {};
    const day  = snap.day || {};
    const bars = histData.results || [];

    // 52周 & 历史最高最低
    const now365  = Date.now() - 365*86400000;
    const bars365 = bars.filter(b => b.t >= now365);
    const week52High  = bars365.length ? Math.max(...bars365.map(b=>b.h)) : null;
    const week52Low   = bars365.length ? Math.min(...bars365.map(b=>b.l)) : null;
    const allTimeHigh = bars.length ? Math.max(...bars.map(b=>b.h)) : null;
    const allTimeLow  = bars.length ? Math.min(...bars.map(b=>b.l)) : null;

    const beta      = calcBeta(stockRetData.returns, spyRetData.returns);
    const sharesOut = d.weighted_shares_outstanding || d.share_class_shares_outstanding || null;
    const floatShares = d.share_class_shares_outstanding || null;
    const marketCap   = d.market_cap || null;

    // PE / PEG from Finnhub
    let peRatio   = null;
    let pegRatio  = null;
    let forwardPE = null;

    try {
      const m = finnhubData?.metric || {};
      const pe  = m['peNormalizedAnnual'] ?? m['peTTM'] ?? null;
      const peg = m['pegRatio'] ?? null;
      const fpe = m['forwardPE'] ?? null;
      peRatio   = (pe  && pe  > 0 && pe  < 10000) ? parseFloat(pe.toFixed(2))  : null;
      pegRatio  = (peg && peg > 0 && peg < 100)   ? parseFloat(peg.toFixed(2)) : null;
      forwardPE = (fpe && fpe > 0 && fpe < 10000) ? parseFloat(fpe.toFixed(2)) : null;
    } catch(e) {}

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({
      symbol:    sym,
      name:      d.name || sym,
      prevClose: prev.c || null,
      open:      day.o  || null,
      marketCap,
      sharesOutstanding: sharesOut,
      floatShares,
      week52High,
      week52Low,
      allTimeHigh,
      allTimeLow,
      peRatio,
      pegRatio,
      forwardPE,
      beta,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
