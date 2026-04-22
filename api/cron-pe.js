// /api/cron-pe.js
// 每日定时更新PE/PEG缓存
// 改为完全并行请求，10秒内处理完所有股票

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

async function setCached(sym, data) {
  try {
    const val = encodeURIComponent(JSON.stringify(data));
    await fetch(`${KV_URL}/set/${encodeURIComponent('pe_'+sym)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch(e) {}
}

async function fetchAndCache(sym) {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
    );
    if (!r.ok) return false;
    const data = await r.json();
    const m = data?.metric || {};
    const pe = m['peTTM'] ?? m['peNormalizedAnnual'] ?? null;
    const peValid = pe && pe > 0 && pe < 10000;
    let peg = null;
    if (peValid) {
      const g = (m['epsGrowth3Y'] > 0 ? m['epsGrowth3Y'] : null)
             ?? (m['epsGrowth5Y'] > 0 ? m['epsGrowth5Y'] : null);
      if (g && g > 0) {
        const raw = pe / g;
        peg = (raw > 0 && raw < 100) ? parseFloat(raw.toFixed(2)) : null;
      }
    }
    const result = { pe: peValid ? parseFloat(pe.toFixed(2)) : null, peg };
    if (result.pe !== null) await setCached(sym, result);
    return result.pe !== null;
  } catch(e) { return false; }
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 从 /api/watchlist 获取完整自选股列表
    const host = req.headers.host || 'quantdesk-drab.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const wlRes = await fetch(`${protocol}://${host}/api/watchlist`);
    const wlData = await wlRes.json();
    const symbols = wlData.list || [];

    if (!symbols.length) {
      return res.status(200).json({ message: 'No symbols', updated: 0 });
    }

    // 完全并行处理所有股票（Finnhub免费版60次/分钟，并行不超时）
    const results = await Promise.allSettled(
      symbols.map(sym => fetchAndCache(sym))
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed  = symbols.length - success;

    return res.status(200).json({
      message: 'PE/PEG cache updated',
      total: symbols.length,
      success,
      failed,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
