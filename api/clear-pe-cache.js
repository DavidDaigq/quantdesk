// /api/clear-pe-cache.js
// 清除所有股票的PE/PEG Redis缓存，强制下次刷新时重新获取

const KV_URL   = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query.secret;
  if (secret !== 'quantdesk-cron-2025') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 用 SCAN 找出所有 pe_* 开头的key
    let cursor = 0;
    let deleted = 0;
    let keys = [];

    do {
      const r = await fetch(`${KV_URL}/scan/${cursor}/match/pe_*/count/100`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      const d = await r.json();
      cursor = parseInt(d.result[0]);
      const batch = d.result[1] || [];
      keys = keys.concat(batch);
    } while (cursor !== 0);

    // 删除所有找到的key
    if (keys.length > 0) {
      await Promise.all(keys.map(async key => {
        await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` },
        });
        deleted++;
      }));
    }

    return res.status(200).json({
      message: 'PE cache cleared',
      deleted,
      keys: keys.slice(0, 10), // 显示前10个已删除的key
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
