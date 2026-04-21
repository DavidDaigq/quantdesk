// /api/valuation.js
// 用 Yahoo Finance quoteSummary 获取 PE / PEG / 市值等估值数据
// 覆盖率远高于 Polygon financials 接口

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1小时缓存

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      // Yahoo Finance v10 quoteSummary — modules: defaultKeyStatistics + summaryDetail
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}`
        + `?modules=defaultKeyStatistics,summaryDetail,financialData`;

      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });

      if (!r.ok) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        return;
      }

      const data = await r.json();
      const qs   = data?.quoteSummary?.result?.[0];
      if (!qs) {
        results[sym] = { pe: null, peg: null, marketCap: null };
        return;
      }

      const ks  = qs.defaultKeyStatistics || {};
      const sd  = qs.summaryDetail        || {};
      const fd  = qs.financialData        || {};

      // Trailing PE (最准确，用TTM实际盈利)
      const trailingPE = sd.trailingPE?.raw ?? ks.trailingPE?.raw ?? null;

      // Forward PE (用未来12个月预期盈利)
      const forwardPE  = sd.forwardPE?.raw ?? ks.forwardPE?.raw ?? null;

      // PEG ratio (Yahoo直接提供，非常准确)
      const pegRatio   = ks.pegRatio?.raw ?? null;

      // 市值
      const marketCap  = sd.marketCap?.raw ?? ks.enterpriseValue?.raw ?? null;

      // EPS (TTM)
      const epsTTM     = ks.trailingEps?.raw ?? null;

      // 52周高低（Yahoo也有，更准）
      const week52High = sd.fiftyTwoWeekHigh?.raw ?? null;
      const week52Low  = sd.fiftyTwoWeekLow?.raw  ?? null;

      // Beta
      const beta       = sd.beta?.raw ?? ks.beta?.raw ?? null;

      // 股本
      const sharesOut  = ks.sharesOutstanding?.raw ?? null;
      const floatShares= ks.floatShares?.raw ?? null;

      results[sym] = {
        pe:         trailingPE ? parseFloat(trailingPE.toFixed(2))  : null,
        forwardPE:  forwardPE  ? parseFloat(forwardPE.toFixed(2))   : null,
        peg:        pegRatio   ? parseFloat(pegRatio.toFixed(2))    : null,
        marketCap,
        epsTTM,
        week52High,
        week52Low,
        beta:       beta       ? parseFloat(beta.toFixed(3))        : null,
        sharesOut,
        floatShares,
      };

    } catch(e) {
      results[sym] = { pe: null, peg: null, marketCap: null };
    }
  }));

  return res.status(200).json(results);
};
