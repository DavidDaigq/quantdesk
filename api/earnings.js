// Vercel serverless function: /api/earnings
// Returns next earnings date for a list of tickers via Yahoo Finance

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // Cache 1 hour

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 50);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    try {
      // Yahoo Finance quoteSummary with calendarEvents module
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=calendarEvents,defaultKeyStatistics`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      if (!r.ok) return;
      const d = await r.json();
      const cal = d?.quoteSummary?.result?.[0]?.calendarEvents;
      const earnings = cal?.earnings;

      let earningsDate = null;

      // earningsDate is an array of timestamps
      if (earnings?.earningsDate?.length) {
        const ts = earnings.earningsDate[0]?.raw;
        if (ts) {
          const ed = new Date(ts * 1000);
          // Only use future dates or very recent (within 3 days past)
          if (ed >= new Date(Date.now() - 3 * 86400000)) {
            earningsDate = ed.toISOString().slice(0, 10);
          }
        }
      }

      results[sym] = { earningsDate };
    } catch(e) {
      results[sym] = { earningsDate: null };
    }
  }));

  return res.status(200).json(results);
};
