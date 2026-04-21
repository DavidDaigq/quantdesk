// /api/valuation.js
// 完全使用 Polygon.io 专业数据计算 PE / PEG
// PE  = 市值 / TTM净利润
// PEG = PE / 净利润同比增长率

const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

// 从财务数据里提取净利润
function extractNetIncome(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  // 优先用归属于普通股东的净利润
  const ni = inc.net_income_loss_available_to_common_stockholders?.value
          ?? inc.net_income_loss?.value
          ?? inc.net_income_loss_attributable_to_parent?.value
          ?? null;
  return ni;
}

// 从财务数据里提取EPS（多路fallback）
function extractEPS(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  return inc.diluted_earnings_per_share?.value
      ?? inc.basic_earnings_per_share?.value
      ?? null;
}

async function calcPE_PEG(sym, marketCap, price) {
  let peRatio  = null;
  let pegRatio = null;

  try {
    // 同时拉季度(8个) + 年度(3个) 财务数据
    const [qRes, aRes] = await Promise.all([
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=3&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
    ]);

    const qData = await qRes.json();
    const aData = await aRes.json();
    const quarters = qData.results || [];
    const annuals  = aData.results || [];

    // ── PE计算 ────────────────────────────────────────────────────────────────
    // 方法1: TTM净利润法（最准）
    // TTM净利润 = 最近4个季度净利润之和
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

    // 方法2: EPS法 fallback（如果净利润拿不到）
    if (!peRatio && price) {
      const qEps = quarters.map(q => extractEPS(q));
      const validEps = qEps.slice(0, 4).filter(v => v !== null);
      let ttmEps = null;
      if (validEps.length === 4) {
        ttmEps = qEps.slice(0, 4).reduce((a, b) => a + b, 0);
      } else if (validEps.length >= 2) {
        ttmEps = (validEps.reduce((a, b) => a + b, 0) / validEps.length) * 4;
      } else if (annuals.length > 0) {
        ttmEps = extractEPS(annuals[0]);
      }
      if (ttmEps && ttmEps > 0) {
        peRatio = parseFloat((price / ttmEps).toFixed(2));
      }
    }

    // ── PEG计算 ───────────────────────────────────────────────────────────────
    // 净利润同比增长率
    let growthPct = null;

    // 方法1: 年度净利润同比（最稳定）
    if (annuals.length >= 2) {
      const ni0 = extractNetIncome(annuals[0]);
      const ni1 = extractNetIncome(annuals[1]);
      if (ni0 !== null && ni1 !== null && ni1 > 0 && ni0 > 0) {
        growthPct = ((ni0 - ni1) / Math.abs(ni1)) * 100;
      }
    }

    // 方法2: 季度净利润同比（最新季度 vs 去年同季）
    if (growthPct === null && quarters.length >= 5) {
      const niNow = extractNetIncome(quarters[0]);
      const niYoY = extractNetIncome(quarters[4]);
      if (niNow !== null && niYoY !== null && niYoY > 0 && niNow > 0) {
        growthPct = ((niNow - niYoY) / Math.abs(niYoY)) * 100;
      }
    }

    // 方法3: TTM同比
    if (growthPct === null && qNI.length >= 8) {
      const recentTTM = qNI.slice(0, 4).filter(v=>v!==null).length === 4
        ? qNI.slice(0, 4).reduce((a,b)=>a+b, 0) : null;
      const priorTTM  = qNI.slice(4, 8).filter(v=>v!==null).length === 4
        ? qNI.slice(4, 8).reduce((a,b)=>a+b, 0) : null;
      if (recentTTM && priorTTM && priorTTM > 0 && recentTTM > 0) {
        growthPct = ((recentTTM - priorTTM) / Math.abs(priorTTM)) * 100;
      }
    }

    if (peRatio && growthPct !== null && growthPct > 0 && growthPct < 500) {
      pegRatio = parseFloat((peRatio / growthPct).toFixed(2));
    }

  } catch(e) {}

  return { peRatio, pegRatio };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      // 先拿市值和最新价格
      const [detailRes, snapRes] = await Promise.all([
        fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`),
        fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`),
      ]);
      const detailData = await detailRes.json();
      const snapData   = await snapRes.json();

      const d     = detailData.results || {};
      const snap  = snapData.ticker   || {};
      const price = snap.lastTrade?.p || snap.day?.c || null;
      const marketCap = d.market_cap  || null;

      const { peRatio, pegRatio } = await calcPE_PEG(sym, marketCap, price);

      results[sym] = {
        pe:        peRatio,
        peg:       pegRatio,
        marketCap: marketCap,
      };
    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null };
    }
  }));

  return res.status(200).json(results);
};
