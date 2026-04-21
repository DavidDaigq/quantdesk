// /api/valuation.js
// 通过伪装浏览器Headers绕过API限制

const FMP_KEY = 'lZVPQHSnmBVVrnt3Bmj1bPaKE9Uf15uO';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      const r = await fetch(
        `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${sym}?apikey=${FMP_KEY}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://financialmodelingprep.com/',
            'Origin': 'https://financialmodelingprep.com',
          }
        }
      );

      if (!r.ok) {
        results[sym] = { pe: null, peg: null, marketCap: null, _status: r.status };
        return;
      }

      const data = await r.json();
      const m = Array.isArray(data) ? data[0] : data;

      if (!m || m.error) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        return;
      }

      const pe  = m.peRatioTTM  != null ? parseFloat(m.peRatioTTM.toFixed(2))  : null;
      const peg = m.pegRatioTTM != null ? parseFloat(m.pegRatioTTM.toFixed(2)) : null;

      results[sym] = {
        pe:        (pe  && pe  > 0 && pe  < 10000) ? pe  : null,
        peg:       (peg && peg > 0 && peg < 100)   ? peg : null,
        marketCap: null,
      };

    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null, _err: e.message };
    }
  }));

  return res.status(200).json(results);
};
