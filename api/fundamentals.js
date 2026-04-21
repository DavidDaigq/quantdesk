const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

async function getDailyReturns(sym, fromStr, toStr) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=365&apiKey=${KEY}`;
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

function extractNetIncome(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  return inc.net_income_loss_available_to_common_stockholders?.value
      ?? inc.net_income_loss?.value
      ?? inc.net_income_loss_attributable_to_parent?.value
      ?? null;
}

function extractEPS(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  return inc.diluted_earnings_per_share?.value
      ?? inc.basic_earnings_per_share?.value
      ?? null;
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

    const [detailRes, prevRes, snapRes, histRes, stockRetData, spyRetData] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from10y}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${KEY}`),
      getDailyReturns(sym,  from1y, toStr),
      getDailyReturns('SPY', from1y, toStr),
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

    const now365  = Date.now() - 365*86400000;
    const bars365 = bars.filter(b => b.t >= now365);
    const week52High  = bars365.length ? Math.max(...bars365.map(b=>b.h)) : null;
    const week52Low   = bars365.length ? Math.min(...bars365.map(b=>b.l)) : null;
    const allTimeHigh = bars.length ? Math.max(...bars.map(b=>b.h)) : null;
    const allTimeLow  = bars.length ? Math.min(...bars.map(b=>b.l)) : null;

    const beta = calcBeta(stockRetData.returns, spyRetData.returns);
    const sharesOut   = d.weighted_shares_outstanding || d.share_class_shares_outstanding || null;
    const floatShares = d.share_class_shares_outstanding || null;
    const price       = snap.lastTrade?.p || day.c || prev.c || null;
    const marketCap   = d.market_cap || null;

    // PE & PEG via Polygon financials
    let peRatio  = null;
    let pegRatio = null;
    let forwardPE = null;

    try {
      const [qRes, aRes] = await Promise.all([
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=3&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
      ]);
      const qData = await qRes.json();
      const aData = await aRes.json();
      const quarters = qData.results || [];
      const annuals  = aData.results || [];

      // TTM净利润 → PE
      const qNI = quarters.map(q => extractNetIncome(q));
      const validQNI = qNI.slice(0, 4).filter(v => v !== null);
      let ttmNI = null;
      if (validQNI.length === 4) {
        ttmNI = qNI.slice(0, 4).reduce((a, b) => a + b, 0);
      } else if (validQNI.length >= 2) {
        ttmNI = (validQNI.reduce((a, b) => a + b, 0) / validQNI.length) * 4;
      } else if (annuals.length > 0) {
        ttmNI = extractNetIncome(annuals[0]);
      }
      if (ttmNI && ttmNI > 0 && marketCap) {
        peRatio = parseFloat((marketCap / ttmNI).toFixed(2));
      }

      // EPS fallback
      if (!peRatio && price) {
        const qEps = quarters.map(q => extractEPS(q));
        const validEps = qEps.slice(0, 4).filter(v => v !== null);
        let ttmEps = null;
        if (validEps.length === 4) ttmEps = qEps.slice(0, 4).reduce((a,b)=>a+b, 0);
        else if (validEps.length >= 2) ttmEps = (validEps.reduce((a,b)=>a+b,0)/validEps.length)*4;
        else if (annuals.length > 0) ttmEps = extractEPS(annuals[0]);
        if (ttmEps && ttmEps > 0) peRatio = parseFloat((price / ttmEps).toFixed(2));
      }

      // 净利润增长率 → PEG
      let growthPct = null;
      if (annuals.length >= 2) {
        const ni0 = extractNetIncome(annuals[0]);
        const ni1 = extractNetIncome(annuals[1]);
        if (ni0 && ni1 && ni1 > 0 && ni0 > 0) growthPct = ((ni0-ni1)/Math.abs(ni1))*100;
      }
      if (growthPct === null && quarters.length >= 5) {
        const niNow = extractNetIncome(quarters[0]);
        const niYoY = extractNetIncome(quarters[4]);
        if (niNow && niYoY && niYoY > 0 && niNow > 0) growthPct = ((niNow-niYoY)/Math.abs(niYoY))*100;
      }
      if (peRatio && growthPct !== null && growthPct > 0 && growthPct < 500) {
        pegRatio = parseFloat((peRatio / growthPct).toFixed(2));
      }
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
