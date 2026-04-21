// /api/pe.js
// 从 Redis 缓存读取 PE/PEG 数据，供前端调用
// 速度极快（Redis读取 < 10ms）

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5分钟CDN缓存

  try {
    const url   = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Redis not configured' });
    }

    // 从 Redis 读取缓存
    const r = await fetch(`${url}/get/${encodeURIComponent('pe_cache')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();

    if (!d.result) {
      return res.status(200).json({ data: {}, updatedAt: null, message: 'Cache empty — run cron first' });
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

    // 返回全部
    return res.status(200).json(cache);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
