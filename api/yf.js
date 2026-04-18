module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sym = req.query.symbol;
  const iv  = req.query.interval || '1d';
  const rng = req.query.range    || '6mo';

  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + encodeURIComponent(sym)
    + '?interval=' + iv
    + '&range='    + rng
    + '&includePrePost=false';

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
      }
    });
    if (!r.ok) return res.status(r.status).json({ error: 'yahoo_' + r.status });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};    
