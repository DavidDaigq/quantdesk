const KV_URL   = 'https://gorgeous-sunbird-101826.upstash.io';
const KV_TOKEN = 'gQAAAAAAAAY3CAAIocDEyNzE5NDUyNzk3MjE0YWE3YWYyMmRiODkxZDAxMTllYnAxMTAxODI2';
const KEY = 'quantdesk_watchlist';

async function kvGet() {
  const r = await fetch(`${KV_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : [];
}

async function kvSet(list) {
  await fetch(`${KV_URL}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(list))
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const list = await kvGet();
      return res.status(200).json({ list });
    }
    if (req.method === 'POST') {
      const { list } = req.body;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'invalid' });
      await kvSet(list);
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
