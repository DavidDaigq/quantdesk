// /api/pe.js
// 按需获取PE/PEG：先查Redis缓存(24小时)，没有才用Polygon实时计算

const KEY    = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';
const KV_URL = 'https://devoted-eft-101724.upstash.io';
const KV_TOK = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

async function getCached(sym) {
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent('pe_'+sym)}`, {
      headers: { Authorization: `Bearer ${KV_TOK}` },
    });
    const d = await r.json();
    if (!d.result) return null;
    return JSON.parse(d.result);
  } catch(e) { return null; }
}

async function setCached(sym, data) {
  try {
    const val = encodeURIComponent(JSON.stringify(data));
    await fetch(`${KV_URL}/set/${encodeURIComponent('pe_'+sym)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOK}` },
    });
  } catch(e) {}
}

function extractNI(fin) {
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

async function calcFromPolygon(sym) {
  try {
    const [snapRes, qRes, aRes, detailRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${KEY}`),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=8&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=4&sort=period_of_report_date&order=desc&timeframe=annual&apiKey=${KEY}`),
      fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${KEY}`),
    ]);

    const snap     = (await snapRes.json()).ticker || {};
    const quarters = (await qRes.json()).results || [];
    const annuals  = (await aRes.json()).results || [];
    const detail   = (await detailRes.json()).results || {};

    const price     = snap.lastTrade?.p || snap.day?.c || snap.prevDay?.c || null;
    const marketCap = detail.market_cap || null;

    // PE
    let peRatio = null;
    const qNI = quarters.map(q => extractNI(q));
    const validQNI = qNI.slice(0, 4).filter(v => v !== null);
    let ttmNI = null;
    if (validQNI.length === 4) ttmNI = qNI.slice(0, 4).reduce((a, b) => a + b, 0);
    else if (validQNI.length >= 2) ttmNI = (validQNI.reduce((a, b) => a + b, 0) / validQNI.length) * 4;
    else if (annuals.length > 0) ttmNI = extractNI(annuals[0]);

    if (ttmNI && ttmNI > 0 && marketCap) peRatio = parseFloat((marketCap / ttmNI).toFixed(2));

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

    // PEG
    let pegRatio = null, growthPct = null;
    if (annuals.length >= 2) {
      const ni0 = extractNI(annuals[0]), ni1 = extractNI(annuals[1]);
      if (ni0 && ni1 && ni1 > 0 && ni0 > 0) growthPct = ((ni0 - ni1) / Math.abs(ni1)) * 100;
    }
    if (growthPct === null && quarters.length >= 5) {
      const niNow = extractNI(quarters[0]), niYoY = extractNI(quarters[4]);
      if (niNow && niYoY && niYoY > 0 && niNow > 0) growthPct = ((niNow - niYoY) / Math.abs(niYoY)) * 100;
    }
    if (growthPct === null && annuals.length >= 2) {
      const eps0 = extractEPS(annuals[0]), eps1 = extractEPS(annuals[1]);
      if (eps0 && eps1 && eps1 > 0 && eps0 > 0) growthPct = ((eps0 - eps1) / Math.abs(eps1)) * 100;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const symbols = (req.query.symbols || '').toUpperCase().split(',')
    .filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    // 先查缓存
    const cached = await getCached(sym);
    if (cached) { results[sym] = cached; return; }
    // 没有缓存，实时计算
    const fresh = await calcFromPolygon(sym);
    results[sym] = fresh;
    await setCached(sym, fresh);
  }));

  return res.status(200).json({ data: results });
};
