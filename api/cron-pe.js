const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';
const PE_KEY      = 'quantdesk_pe_cache';

const delay = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── 直接调用 /api/watchlist 获取自选股列表 ──────────────────────────────
    // 不依赖Redis key解析，直接用现有的watchlist接口
    const host = req.headers.host || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const wlRes = await fetch(`${protocol}://${host}/api/watchlist`);
    const wlData = await wlRes.json();
    const symbols = wlData.list || [];

    if (!symbols.length) {
      return res.status(200).json({ message: 'No symbols found', updated: 0 });
    }

    // ── 读取现有PE缓存 ────────────────────────────────────────────────────────
    let results = {};
    try {
      const cacheRes = await fetch(`${KV_URL}/get/${encodeURIComponent(PE_KEY)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      const cacheData = await cacheRes.json();
      if (cacheData.result) {
        const parsed = JSON.parse(decodeURIComponent(cacheData.result));
        results = parsed.data || {};
      }
    } catch(e) {}

    // ── 逐个从Finnhub拉取PE/PEG ──────────────────────────────────────────────
    let successCount = 0, failCount = 0;

    for (const sym of symbols) {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
        );
        if (r.ok) {
          const data = await r.json();
          const m = data?.metric || {};
          const pe     = m['peNormalizedAnnual'] ?? m['peTTM'] ?? null;
          const peg    = m['pegRatio'] ?? null;
          const mktCap = m['marketCapitalization'] ?? null;
          results[sym] = {
            pe:        (pe  && pe  > 0 && pe  < 10000) ? parseFloat(pe.toFixed(2))  : null,
            peg:       (peg && peg > 0 && peg < 100)   ? parseFloat(peg.toFixed(2)) : null,
            marketCap: mktCap ? mktCap * 1e6 : null,
          };
          successCount++;
        } else {
          if (!results[sym]) results[sym] = { pe: null, peg: null, marketCap: null };
          failCount++;
        }
      } catch(e) {
        if (!results[sym]) results[sym] = { pe: null, peg: null, marketCap: null };
        failCount++;
      }
      await delay(1100);
    }

    // ── 存入Redis ─────────────────────────────────────────────────────────────
    const payload = encodeURIComponent(JSON.stringify({
      data: results,
      updatedAt: new Date().toISOString(),
    }));
    await fetch(`${KV_URL}/set/${encodeURIComponent(PE_KEY)}/${payload}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });

    return res.status(200).json({
      message: 'PE/PEG cache updated',
      total: symbols.length,
      success: successCount,
      failed: failCount,
      symbols_preview: symbols.slice(0, 5).join(',') + '...',
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
