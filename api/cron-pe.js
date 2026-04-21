const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
const KV_URL      = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN    = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';
const WL_KEY      = 'quantdesk_watchlist';
const PE_KEY      = 'quantdesk_pe_cache';

const delay = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET || 'quantdesk-cron-2025';
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 先看Redis原始返回
    const raw = await fetch(`${KV_URL}/get/${encodeURIComponent(WL_KEY)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const rawData = await raw.json();

    // debug模式：直接返回原始数据
    if (req.query.debug === '1') {
      return res.status(200).json({
        raw_result_type: typeof rawData.result,
        raw_result_length: rawData.result?.length,
        raw_result_preview: rawData.result?.slice(0, 200),
      });
    }

    // 尝试多种解析方式
    let symbols = [];
    const raw_result = rawData.result;

    if (Array.isArray(raw_result)) {
      // 直接就是数组
      symbols = raw_result;
    } else if (typeof raw_result === 'string') {
      // 尝试各种解析方式
      const attempts = [
        () => JSON.parse(raw_result),
        () => JSON.parse(decodeURIComponent(raw_result)),
        () => JSON.parse(decodeURIComponent(decodeURIComponent(raw_result))),
      ];
      for (const attempt of attempts) {
        try {
          const parsed = attempt();
          if (Array.isArray(parsed) && parsed.length > 4) {
            symbols = parsed;
            break;
          } else if (Array.isArray(parsed)) {
            symbols = parsed; // 即使只有4个也用
          }
        } catch(e) {}
      }
    }

    if (!symbols.length) {
      return res.status(200).json({
        message: 'Could not parse watchlist',
        raw_type: typeof raw_result,
        raw_preview: String(raw_result).slice(0, 100),
      });
    }

    // 读取现有缓存
    const existingRaw = await fetch(`${KV_URL}/get/${encodeURIComponent(PE_KEY)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const existingData = await existingRaw.json();
    let results = {};
    try {
      const existing = JSON.parse(decodeURIComponent(existingData.result || '{}'));
      results = existing.data || {};
    } catch(e) {
      try { results = JSON.parse(existingData.result || '{}').data || {}; } catch(e2) {}
    }

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

    // 存入 Redis
    const savePayload = encodeURIComponent(JSON.stringify({ data: results, updatedAt: new Date().toISOString() }));
    await fetch(`${KV_URL}/set/${encodeURIComponent(PE_KEY)}/${savePayload}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });

    return res.status(200).json({
      message: 'PE/PEG cache updated',
      total: symbols.length,
      success: successCount,
      failed: failCount,
      symbols_preview: symbols.slice(0, 5).join(','),
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0,200) });
  }
};
