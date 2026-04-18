const KV_URL   = 'https://devoted-eft-101724.upstash.io';
const KV_TOKEN = 'gQAAAAAAAY1cAAIocDI2OGIwYzMwZjlhMzk0OWU0YWUwOWFlYzAzMTAyZjI4OXAyMTAxNzI0';
const KEY = 'quantdesk_watchlist';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, list } = req.query;

  try {
    if (action === 'save' && list) {
      const arr = list.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const encoded = encodeURIComponent(JSON.stringify(arr));
      const r = await fetch(`${KV_URL}/set/${KEY}/${encoded}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return res.status(200).json({ ok: true, saved: arr, result: d });
    } else {
      const r = await fetch(`${KV_URL}/get/${KEY}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      const arr = d.result ? JSON.parse(d.result) : [];
      return res.status(200).json({ list: arr });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
