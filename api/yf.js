module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sym = (req.query.symbol || '').toUpperCase().trim();
  const iv  = req.query.interval || '1d';
  const rng = req.query.range    || '6mo';
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
  };

  try {
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: HEADERS });
    const rawCookies = cookieRes.headers.get('set-cookie') || '';
    const cookieStr = rawCookies.split(',')
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...HEADERS, 'Cookie': cookieStr }
    });
    const crumb = (await crumbRes.text()).trim();

    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + encodeURIComponent(sym)
      + '?interval=' + iv
      + '&range=' + rng
      + '&crumb=' + encodeURIComponent(crumb)
      + '&includePrePost=false';

    const dataRes = await fetch(url, {
      headers: { ...HEADERS, 'Cookie': cookieStr }
    });

    if (!dataRes.ok) {
      return res.status(dataRes.status).json({ error: 'yahoo_' + dataRes.status });
    }

    const data = await dataRes.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
