// /api/cron-pe.js
// 定时任务：每天美东时间下午4:30（收盘后30分钟）
// 从 Finnhub 拉取所有自选股的 PE/PEG，存入 Upstash Redis
// 触发方式：Vercel Cron Job（见 vercel.json）

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';

// Upstash Redis REST 操作
async function redisSet(key, value) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function redisGet(key) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}

const delay = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  // 安全验证：只允许 Vercel Cron 调用（或手动带 secret 调用）
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 从 Redis 读取自选股列表
    const watchlist = await redisGet('ql_watchlist') || ['AAPL','NVDA','MSFT','TSLA'];
    const symbols = Array.isArray(watchlist) ? watchlist : [];

    if (!symbols.length) {
      return res.status(200).json({ message: 'No symbols to update', updated: 0 });
    }

    const results = {};
    let successCount = 0;
    let failCount = 0;

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
            updatedAt: new Date().toISOString(),
          };
          successCount++;
        } else {
          results[sym] = { pe: null, peg: null, marketCap: null };
          failCount++;
        }
      } catch(e) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        failCount++;
      }
      // 间隔1.1秒，避免触发限速
      await delay(1100);
    }

    // 存入 Redis，key: pe_cache，有效期24小时
    await redisSet('pe_cache', {
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
