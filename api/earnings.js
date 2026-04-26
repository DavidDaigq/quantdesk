// /api/earnings.js
// 先查Finnhub upcoming earnings calendar（精确日期）
// fallback到历史数据推算

const FINNHUB_KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 10);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};
  const now   = new Date();
  const from  = now.toISOString().slice(0, 10);
  const to    = new Date(now.getTime() + 120 * 86400000).toISOString().slice(0, 10);

  await Promise.all(symbols.map(async sym => {
    let earningsDate = null;
    let earningsEst  = false;

    try {
      // 方法1: 查Finnhub未来120天的财报日历（精确日期）
      const r1 = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${sym}&token=${FINNHUB_KEY}`
      );
      if (r1.ok) {
        const cal = await r1.json();
        const items = cal.earningsCalendar || [];
        if (items.length > 0) {
          // 找最近的未来财报日期
          const future = items
            .filter(i => i.date && new Date(i.date) >= now)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
          if (future.length > 0) {
            earningsDate = future[0].date;
            earningsEst  = false; // 精确日期
          }
        }
      }

      // 方法2: fallback - 用历史财报推算
      if (!earningsDate) {
        const r2 = await fetch(
          `https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        if (r2.ok) {
          const rows = await r2.json();
          if (Array.isArray(rows) && rows.length >= 2) {
            const past = rows
              .filter(r => r.actual !== null && r.period)
              .sort((a, b) => new Date(b.period) - new Date(a.period));
            if (past.length >= 2) {
              const d1 = new Date(past[0].period);
              const d2 = new Date(past[1].period);
              const gap = Math.abs((d1 - d2).valueOf() / 86400000);
              const useGap = (gap > 60 && gap < 120) ? gap : 91;
              let nextEst = new Date(d1.getTime() + (useGap + 30) * 86400000);
              if (nextEst <= now) nextEst = new Date(nextEst.getTime() + useGap * 86400000);
              if (nextEst > now) {
                earningsDate = nextEst.toISOString().slice(0, 10);
                earningsEst  = true;
              }
            }
          }
        }
      }
    } catch(e) {}

    results[sym] = { earningsDate, estimated: earningsEst };
  }));

  return res.status(200).json(results);
};
