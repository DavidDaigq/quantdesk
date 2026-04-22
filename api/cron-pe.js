// /api/cron-pe.js
// 完全用 Polygon.io 数据计算 PE / PEG
// 并行处理所有股票，无限速问题

const KEY    = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';
const KV_URL = 'https://devoted-eft-101724.upstash.io';
const KV_TOK = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

async function setCached(sym, data) {
  try {
    const val = encodeURIComponent(JSON.stringify(data));
    await fetch(`${KV_URL}/set/${encodeURIComponent('pe_'+sym)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOK}` },
    });
  } catch(e) {}
}

// 从财务数据提取净利润
function extractNI(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  return inc.net_income_loss_available_to_common_stockholders?.value
      ?? inc.net_income_loss?.value
      ?? inc.net_income_loss_attributable_to_parent?.value
      ?? null;
}

// 从财务数据提取EPS
function extractEPS(fin) {
  const inc = fin?.financials?.income_statement;
  if (!inc) return null;
  return inc.diluted_earnings_per_share?.value
      ?? inc.basic_earnings_per_share?.value
      ?? null;
}

async function calcPE_PEG(sym) {
  try {
    // 并行拉取：价格快照 + 季度财务(8个) + 年度财务(3个)
    const [snapRes, qRes, aRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=4&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
    ]);

    const snapData = await snapRes.json();
    const qData    = await qRes.json();
    const aData    = await aRes.json();

    const snap     = snapData.ticker || {};
    const price    = snap.lastTrade?.p || snap.day?.c || snap.prevDay?.c || null;
    const quarters = qData.results || [];
    const annuals  = aData.results || [];

    // ── PE ────────────────────────────────────────────────────────────────────
    let peRatio = null;

    // 方法1: TTM净利润 + 市值
    // 先拿市值
    const detailRes = await fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`);
    const detailData = await detailRes.json();
    const marketCap = detailData.results?.market_cap || null;

    const qNI = quarters.map(q => extractNI(q));
    const validQNI = qNI.slice(0, 4).filter(v => v !== null);
    let ttmNI = null;
    if (validQNI.length === 4) {
      ttmNI = qNI.slice(0, 4).reduce((a, b) => a + b, 0);
    } else if (validQNI.length >= 2) {
      ttmNI = (validQNI.reduce((a, b) => a + b, 0) / validQNI.length) * 4;
    } else if (annuals.length > 0) {
      ttmNI = extractNI(annuals[0]);
    }

    if (ttmNI && ttmNI > 0 && marketCap) {
      peRatio = parseFloat((marketCap / ttmNI).toFixed(2));
    }

    // 方法2: EPS fallback
    if (!peRatio && price) {
      const qEps = quarters.map(q => extractEPS(q));
      const validEps = qEps.slice(0, 4).filter(v => v !== null);
      let ttmEps = null;
      if (validEps.length === 4) ttmEps = qEps.slice(0, 4).reduce((a, b) => a + b, 0);
      else if (validEps.length >= 2) ttmEps = (validEps.reduce((a, b) => a + b, 0) / validEps.length) * 4;
      else if (annuals.length > 0) ttmEps = extractEPS(annuals[0]);
      if (ttmEps && ttmEps > 0) peRatio = parseFloat((price / ttmEps).toFixed(2));
    }

    if (peRatio && (peRatio <= 0 || peRatio > 10000)) peRatio = null;

    // ── PEG ───────────────────────────────────────────────────────────────────
    let pegRatio = null;
    let growthPct = null;

    // 年度净利润同比增长率（最稳定）
    if (annuals.length >= 2) {
      const ni0 = extractNI(annuals[0]);
      const ni1 = extractNI(annuals[1]);
      if (ni0 && ni1 && ni1 > 0 && ni0 > 0) {
        growthPct = ((ni0 - ni1) / Math.abs(ni1)) * 100;
      }
    }

    // 季度同比fallback
    if (growthPct === null && quarters.length >= 5) {
      const niNow = extractNI(quarters[0]);
      const niYoY = extractNI(quarters[4]);
      if (niNow && niYoY && niYoY > 0 && niNow > 0) {
        growthPct = ((niNow - niYoY) / Math.abs(niYoY)) * 100;
      }
    }

    // 年度EPS增长率fallback
    if (growthPct === null && annuals.length >= 2) {
      const eps0 = extractEPS(annuals[0]);
      const eps1 = extractEPS(annuals[1]);
      if (eps0 && eps1 && eps1 > 0 && eps0 > 0) {
        growthPct = ((eps0 - eps1) / Math.abs(eps1)) * 100;
      }
    }

    if (peRatio && growthPct !== null && growthPct > 0 && growthPct < 500) {
      pegRatio = parseFloat((peRatio / growthPct).toFixed(2));
      if (pegRatio <= 0 || pegRatio > 100) pegRatio = null;
    }

    return { pe: peRatio, peg: pegRatio, marketCap };

  } catch(e) {
    return { pe: null, peg: null, marketCap: null };
  }
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const host = req.headers.host || 'quantdesk-drab.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const wlRes = await fetch(`${protocol}://${host}/api/watchlist`);
    const wlData = await wlRes.json();
    const symbols = wlData.list || [];

    if (!symbols.length) return res.status(200).json({ message: 'No symbols', updated: 0 });

    // Polygon没有限速问题，可以并行处理
    // 但每只股票要发4个请求，为避免Polygon限制分批处理
    const BATCH = 10;
    let success = 0, failed = 0;
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < symbols.length; i += BATCH) {
      const chunk = symbols.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(async sym => {
        const data = await calcPE_PEG(sym);
        await setCached(sym, data);
        return data.pe !== null;
      }));
      success += results.filter(Boolean).length;
      failed  += results.filter(v => !v).length;
      if (i + BATCH < symbols.length) await delay(500);
    }

    return res.status(200).json({
      message: 'PE/PEG updated (Polygon)',
      total: symbols.length,
      success,
      failed,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
