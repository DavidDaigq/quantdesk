// /api/valuation.js
// 使用 Finnhub 获取 PE / PEG
// 每批最多5个并行，Finnhub 免费版限制60次/分钟

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 5);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
      );
      if (!r.ok) {
        results[sym] = { pe: null, peg: null, marketCap: null, _status: r.status };
        return;
      }
      const data = await r.json();
      const m = data?.metric || {};
      const pe     = m['peNormalizedAnnual'] ?? m['peTTM'] ?? null;
      const peg    = m['pegRatio']           ?? null;
      const mktCap = m['marketCapitalization'] ?? null;
      results[sym] = {
        pe:        (pe  && pe  > 0 && pe  < 10000) ? parseFloat(pe.toFixed(2))  : null,
        peg:       (peg && peg > 0 && peg < 100)   ? parseFloat(peg.toFixed(2)) : null,
        marketCap: mktCap ? mktCap * 1e6 : null,
      };
    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null };
    }
  }));

  return res.status(200).json(results);
};
