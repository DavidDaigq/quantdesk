// /api/valuation.js
// 使用 Financial Modeling Prep (FMP) 获取 PE / PEG
// FMP 财务数据覆盖率极高，90%+ 美股都有数据

const FMP_KEY = 'lZVPQHSnmBVVrnt3Bmj1bPaKE9Uf15uO';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      // FMP /v3/key-metrics — 直接提供 PE, PEG, 市值等
      const r = await fetch(
        `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${sym}?apikey=${FMP_KEY}`
      );

      if (!r.ok) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        return;
      }

      const data = await r.json();
      const m = Array.isArray(data) ? data[0] : data;

      if (!m) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        return;
      }

      // FMP key-metrics-ttm 字段名
      const pe  = m.peRatioTTM        ?? m.peRatio        ?? null;
      const peg = m.pegRatioTTM       ?? m.pegRatio       ?? null;
      const mktCap = m.marketCapTTM   ?? m.marketCap      ?? null;

      results[sym] = {
        pe:        pe  ? parseFloat(pe.toFixed(2))     : null,
        peg:       peg ? parseFloat(peg.toFixed(2))    : null,
        marketCap: mktCap || null,
      };

    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null };
    }
  }));

  return res.status(200).json(results);
};
