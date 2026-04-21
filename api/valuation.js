// /api/valuation.js
// 完全使用 Polygon.io 计算 PE / PEG
// PE = 市值 / TTM净利润（三层fallback）
// PEG = PE / 净利润同比增长率

const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

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
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      // 并行拉取市值 + 季度财务(8个) + 年度财务(3个)
      const [detailRes, qRes, aRes] = await Promise.all([
        fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`),
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
        fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=3&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
      ]);

      const detailData = await detailRes.json();
      const qData = await qRes.json();
      const aData = await aRes.json();

      const d        = detailData.results || {};
      const quarters = qData.results || [];
      const annuals  = aData.results || [];
      const marketCap = d.market_cap || null;

      // 也拿一下快照里的价格
      const snapRes2 = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`);
      const snapData = await snapRes2.json();
      const price = snapData.ticker?.lastTrade?.p || snapData.ticker?.day?.c || null;

      let peRatio  = null;
      let pegRatio = null;

      // ── PE ────────────────────────────────────────────────────────────────
      // 方法1: 市值 / TTM净利润（最准）
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

      // 方法2: 价格 / TTM EPS fallback
      if (!peRatio && price) {
        const qEps = quarters.map(q => extractEPS(q));
        const validEps = qEps.slice(0, 4).filter(v => v !== null);
        let ttmEps = null;
        if (validEps.length === 4) ttmEps = qEps.slice(0, 4).reduce((a,b)=>a+b,0);
        else if (validEps.length >= 2) ttmEps = (validEps.reduce((a,b)=>a+b,0)/validEps.length)*4;
        else if (annuals.length > 0) ttmEps = extractEPS(annuals[0]);
        if (ttmEps && ttmEps > 0) peRatio = parseFloat((price / ttmEps).toFixed(2));
      }

      // 过滤异常值
      if (peRatio && (peRatio <= 0 || peRatio > 10000)) peRatio = null;

      // ── PEG ───────────────────────────────────────────────────────────────
      let growthPct = null;

      // 年度净利润同比
      if (annuals.length >= 2) {
        const ni0 = extractNetIncome(annuals[0]);
        const ni1 = extractNetIncome(annuals[1]);
        if (ni0 && ni1 && ni1 > 0 && ni0 > 0) {
          growthPct = ((ni0 - ni1) / Math.abs(ni1)) * 100;
        }
      }
      // 季度同比 fallback
      if (growthPct === null && quarters.length >= 5) {
        const niNow = extractNetIncome(quarters[0]);
        const niYoY = extractNetIncome(quarters[4]);
        if (niNow && niYoY && niYoY > 0 && niNow > 0) {
          growthPct = ((niNow - niYoY) / Math.abs(niYoY)) * 100;
        }
      }
      if (peRatio && growthPct !== null && growthPct > 0 && growthPct < 500) {
        pegRatio = parseFloat((peRatio / growthPct).toFixed(2));
      }

      results[sym] = { pe: peRatio, peg: pegRatio, marketCap };

    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null };
    }
  }));

  return res.status(200).json(results);
};
