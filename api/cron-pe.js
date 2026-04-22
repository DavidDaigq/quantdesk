// /api/cron-pe.js
// 严格限速：每批20只并行，批次间隔1.5秒
// 每分钟约40次请求，安全低于Finnhub免费版60次/分钟限制
// 192只股票约需要：10批 × 1.5秒 = 15秒

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

const delay = ms => new Promise(r => setTimeout(r, ms));

async function setCached(sym, data) {
  try {
    const val = encodeURIComponent(JSON.stringify(data));
    await fetch(`${KV_URL}/set/${encodeURIComponent('pe_'+sym)}/${val}/EX/86400`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch(e) {}
}

async function fetchOne(sym) {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
    );
    if (r.status === 429) return { sym, ok: false, reason: 'rate_limit' };
    if (!r.ok) return { sym, ok: false, reason: r.status };
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
    await setCached(sym, result);
    return { sym, ok: true, pe: result.pe };
  } catch(e) {
    return { sym, ok: false, reason: e.message };
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

    if (!symbols.length) {
      return res.status(200).json({ message: 'No symbols', updated: 0 });
    }

    // 每批20只并行，批次间隔1.5秒
    const BATCH = 20;
    let success = 0, failed = 0, rateLimited = 0;

    for (let i = 0; i < symbols.length; i += BATCH) {
      const chunk = symbols.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(sym => fetchOne(sym)));
      results.forEach(r => {
        if (r.ok) success++;
        else {
          failed++;
          if (r.reason === 'rate_limit') rateLimited++;
        }
      });
      if (i + BATCH < symbols.length) await delay(1500);
    }

    return res.status(200).json({
      message: 'PE/PEG cache updated',
      total: symbols.length,
      success,
      failed,
      rateLimited,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
