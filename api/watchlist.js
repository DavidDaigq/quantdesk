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
  const encoded = encodeURIComponent(JSON.stringify(list));
  const r = await fetch(`${KV_URL}/set/${KEY}/${encoded}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  return r.json();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) { resolve(req.body); return; }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const list = await kvGet();
      return res.status(200).json({ list });
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const list = body.list;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'invalid list' });
      const result = await kvSet(list);
      return res.status(200).json({ ok: true, result });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
