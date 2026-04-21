// /api/cron-pe.js
// 定时任务：每天美东时间下午4:30（收盘后30分钟）
// 从 Finnhub 拉取所有自选股的 PE/PEG，存入 Upstash Redis

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';
const WL_KEY      = 'quantdesk_watchlist';   // 自选股列表key
const PE_KEY      = 'quantdesk_pe_cache';    // PE/PEG缓存key

const delay = ms => new Promise(r => setTimeout(r, ms));

async function redisGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}

async function redisSet(key, value) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

module.exports = async function handler(req, res) {
  // 安全验证
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 从 Redis 读取完整自选股列表
    const watchlist = await redisGet(WL_KEY) || [];
    const symbols = Array.isArray(watchlist) ? watchlist : [];

    if (!symbols.length) {
      return res.status(200).json({ message: 'No symbols found', updated: 0 });
    }

    // 读取现有缓存（保留旧数据，只更新新数据）
    const existing = await redisGet(PE_KEY) || { data: {} };
    const results = existing.data || {};

    let successCount = 0, failCount = 0;

    // 逐个请求 Finnhub，每次间隔1.1秒（免费版限60次/分钟）
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

    // 存入 Redis
    await redisSet(PE_KEY, {
      data: results,
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      message: 'PE/PEG cache updated',
      total: symbols.length,
      success: successCount,
      failed: failCount,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
