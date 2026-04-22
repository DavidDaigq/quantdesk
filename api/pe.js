// /api/pe.js
// 按需获取PE/PEG：先查Redis缓存(24小时)，没有才从Finnhub获取
// 并行请求，速度极快

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

async function getCached(sym) {
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent('pe_'+sym)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const d = await r.json();
    if (!d.result) return null;
    const parsed = JSON.parse(d.result);
    // 只有pe不为null才算有效缓存，避免返回旧的null值
    return (parsed && parsed.pe !== undefined) ? parsed : null;
  } catch(e) { return null; }
}

async function setCached(sym, data) {
  try {
    const val = encodeURIComponent(JSON.stringify(data));
    await fetch(`${KV_URL}/set/${encodeURIComponent('pe_'+sym)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch(e) {}
}

async function fetchFromFinnhub(sym) {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
    );
    if (!r.ok) return { pe: null, peg: null };
    const data = await r.json();
    const m = data?.metric || {};

    const pe = m['peTTM'] ?? m['peNormalizedAnnual'] ?? null;
    const peValid = pe && pe > 0 && pe < 10000;

    // PEG = PE / EPS增长率（用3年，fallback 5年）
    let peg = null;
    if (peValid) {
      const g = (m['epsGrowth3Y'] > 0 ? m['epsGrowth3Y'] : null)
             ?? (m['epsGrowth5Y'] > 0 ? m['epsGrowth5Y'] : null);
      if (g && g > 0) {
        const raw = pe / g;
        peg = (raw > 0 && raw < 100) ? parseFloat(raw.toFixed(2)) : null;
      }
    }

    return {
      pe:  peValid ? parseFloat(pe.toFixed(2)) : null,
      peg: peg,
    };
  } catch(e) { return { pe: null, peg: null }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const symbols = (req.query.symbols || '').toUpperCase().split(',')
    .filter(Boolean).slice(0, 30); // 最多30个并行，避免触发Finnhub限速
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  // 并行处理所有股票
  await Promise.all(symbols.map(async sym => {
    // 先查缓存
    const cached = await getCached(sym);
    if (cached && cached.pe !== null) {
      results[sym] = cached;
      return;
    }
    // 实时获取
    const fresh = await fetchFromFinnhub(sym);
    results[sym] = fresh;
    // 写缓存（只缓存有效数据）
    if (fresh.pe !== null) await setCached(sym, fresh);
  }));

  return res.status(200).json({ data: results });
};
