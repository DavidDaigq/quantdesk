// /api/pe.js
// 从 Redis 缓存读取 PE/PEG，供前端调用，速度极快

const KV_URL   = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';
const PE_KEY   = 'quantdesk_pe_cache';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(PE_KEY)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const d = await r.json();

    if (!d.result) {
      return res.status(200).json({ data: {}, updatedAt: null });
    }

    const cache = JSON.parse(d.result);

    // 如果请求了特定股票，只返回那些
    const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean);
    if (symbols.length) {
      const filtered = {};
      symbols.forEach(sym => {
        filtered[sym] = cache.data?.[sym] || { pe: null, peg: null, marketCap: null };
      });
      return res.status(200).json({ data: filtered, updatedAt: cache.updatedAt });
    }

    return res.status(200).json(cache);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
