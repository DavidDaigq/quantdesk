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

function extractEPS(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  const diluted = inc.diluted_earnings_per_share?.value;
  const basic   = inc.basic_earnings_per_share?.value;
  if (diluted != null) return diluted;
  if (basic   != null) return basic;
  return null;
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

    const sharesOut  = d.weighted_shares_outstanding || d.share_class_shares_outstanding || null;
    const floatShares= d.share_class_shares_outstanding || null;
    const price = snap.lastTrade?.p || day.c || prev.c || null;

    // PE & PEG
    let peRatio  = null;
    let pegRatio = null;

    try {
      // 同时拉季度(8个) 和 年度(3个) 财务数据
      const [qRes, aRes] = await Promise.all([
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=3&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
      ]);
      const qData = await qRes.json();
      const aData = await aRes.json();
      const quarters = qData.results || [];
      const annuals  = aData.results || [];

      // Trailing PE: TTM EPS = 最近4个季度之和
      const qEps = quarters.map(q => extractEPS(q));
      const validQ4 = qEps.slice(0, 4).filter(v => v !== null);

      let ttmEps = null;
      if (validQ4.length === 4) {
        ttmEps = qEps.slice(0, 4).reduce((a, b) => a + b, 0);
      } else if (validQ4.length >= 2) {
        // 部分季度有数据，年化估算
        ttmEps = (validQ4.reduce((a, b) => a + b, 0) / validQ4.length) * 4;
      } else if (annuals.length > 0) {
        // Fallback：用最新年报EPS
        ttmEps = extractEPS(annuals[0]);
      }

      if (ttmEps && ttmEps > 0 && price) {
        peRatio = parseFloat((price / ttmEps).toFixed(2));
      }

      // EPS增长率 — 优先年度同比，fallback季度同比，fallback TTM同比
      let epsGrowthPct = null;

      // 方法1: 年度同比（最稳定）
      if (annuals.length >= 2) {
        const eps0 = extractEPS(annuals[0]);
        const eps1 = extractEPS(annuals[1]);
        if (eps0 !== null && eps1 !== null && eps1 > 0 && eps0 > 0) {
          epsGrowthPct = ((eps0 - eps1) / Math.abs(eps1)) * 100;
        }
      }

      // 方法2: 季度同比（最新季度 vs 去年同季）
      if (epsGrowthPct === null && quarters.length >= 5) {
        const epsNow = extractEPS(quarters[0]);
        const epsYoY = extractEPS(quarters[4]);
        if (epsNow !== null && epsYoY !== null && epsYoY > 0 && epsNow > 0) {
          epsGrowthPct = ((epsNow - epsYoY) / Math.abs(epsYoY)) * 100;
        }
      }

      // 方法3: TTM同比（需要8个季度）
      if (epsGrowthPct === null && qEps.length >= 8) {
        const recentTTM = qEps.slice(0, 4).filter(v=>v!==null).length === 4
          ? qEps.slice(0, 4).reduce((a,b)=>a+b, 0) : null;
        const priorTTM  = qEps.slice(4, 8).filter(v=>v!==null).length === 4
          ? qEps.slice(4, 8).reduce((a,b)=>a+b, 0) : null;
        if (recentTTM && priorTTM && priorTTM > 0 && recentTTM > 0) {
          epsGrowthPct = ((recentTTM - priorTTM) / Math.abs(priorTTM)) * 100;
        }
      }

      // PEG = PE / EPS增长率（增长率需>0且<500%才有意义）
      if (peRatio && epsGrowthPct !== null && epsGrowthPct > 0 && epsGrowthPct < 500) {
        pegRatio = parseFloat((peRatio / epsGrowthPct).toFixed(2));
      }

    } catch(e) {}

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({
      symbol:      sym,
      name:        d.name || sym,
      prevClose:   prev.c || null,
      open:        day.o  || null,
      marketCap:   d.market_cap || null,
      sharesOutstanding: sharesOut,
      floatShares,
      week52High,
      week52Low,
      allTimeHigh,
      allTimeLow,
      peRatio,
      pegRatio,
      forwardPE:   null,
      beta,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
