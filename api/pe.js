// /api/pe.js
// 按需获取PE/PEG：先查Redis缓存(24小时有效)，没有才实时从Finnhub获取
// 每次最多处理5只股票，避免超时

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

// 从Redis读单个股票的PE缓存
async function getCached(sym) {
  try {
    const key = `pe_${sym}`;
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const d = await r.json();
    if (!d.result) return null;
    return JSON.parse(d.result);
  } catch(e) { return null; }
}

// 写入Redis，24小时过期
async function setCached(sym, data) {
  try {
    const key = `pe_${sym}`;
    const val = encodeURIComponent(JSON.stringify(data));
    // EX 86400 = 24小时过期
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch(e) {}
}

// 从Finnhub实时获取
async function fetchFromFinnhub(sym) {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
    );
    if (!r.ok) return { pe: null, peg: null };
    const data = await r.json();
    const m = data?.metric || {};

    // PE：优先用TTM，fallback用年化
    const pe = m['peTTM'] ?? m['peNormalizedAnnual'] ?? null;

    // PEG：Finnhub没有直接字段，自行计算
    // PEG = PE / EPS增长率
    // 优先用3年EPS增长率（更稳定），fallback用5年
    // Finnhub的epsGrowth字段已经是百分比（如6.89表示6.89%）
    let peg = null;
    const peValid = pe && pe > 0 && pe < 10000;
    if (peValid) {
      const g3 = m['epsGrowth3Y'] ?? null;
      const g5 = m['epsGrowth5Y'] ?? null;
      const g  = (g3 != null && g3 > 0) ? g3
               : (g5 != null && g5 > 0) ? g5
               : null;
      if (g && g > 0) {
        peg = parseFloat((pe / g).toFixed(2));
        // 过滤异常值
        if (peg <= 0 || peg > 100) peg = null;
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
  res.setHeader('Cache-Control', 'no-store'); // 不缓存响应，每次都查Redis

  const symbols = (req.query.symbols || '').toUpperCase().split(',')
    .filter(Boolean).slice(0, 8); // 每次最多8只，避免超时
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    // 1. 先查Redis缓存
    const cached = await getCached(sym);
    if (cached) {
      results[sym] = cached;
      return;
    }
    // 2. 缓存没有，实时从Finnhub获取
    const fresh = await fetchFromFinnhub(sym);
    results[sym] = fresh;
    // 3. 写入Redis缓存（24小时）
    await setCached(sym, fresh);
  }));

  return res.status(200).json({ data: results });
};
