// /api/earnings.js
// 使用 Polygon.io 获取财报日期
// Polygon /vX/reference/financials 包含历史财报日期
// Polygon /v3/reference/tickers/{ticker}/events 包含即将到来的事件

const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 50);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};
  const now = new Date();

  await Promise.all(symbols.map(async sym => {
    let earningsDate = null;
    let earningsEst  = false;

    try {
      // 方法1: Polygon financials - 获取最近4个季度报告日期
      const r = await fetch(
        `https://api.polygon.io/vX/reference/financials?ticker=${sym}&limit=4&sort=period_of_report_date&order=desc&timeframe=quarterly&apiKey=${KEY}`
      );

      if (r.ok) {
        const data = await r.json();
        const reports = data.results || [];

        if (reports.length > 0) {
          // 最近一次财报日期
          const lastReportDate = new Date(reports[0].period_of_report_date);
          const daysSinceLast = (now - lastReportDate) / 86400000;

          if (daysSinceLast >= 0 && daysSinceLast <= 120) {
            // 最近一次财报在120天内，估算下次 = 上次 + 91天
            const nextEst = new Date(lastReportDate.getTime() + 91 * 86400000);
            if (nextEst > now) {
              earningsDate = nextEst.toISOString().slice(0, 10);
              earningsEst  = true;
            }
          }

          // 如果两个报告之间间隔规律，用平均间隔估算
          if (!earningsDate && reports.length >= 2) {
            const d1 = new Date(reports[0].period_of_report_date);
            const d2 = new Date(reports[1].period_of_report_date);
            const gap = Math.abs((d1 - d2) / 86400000);
            const useGap = (gap > 60 && gap < 120) ? gap : 91;
            const nextEst = new Date(d1.getTime() + useGap * 86400000);
            if (nextEst > now) {
              earningsDate = nextEst.toISOString().slice(0, 10);
              earningsEst  = true;
            }
          }
        }
      }
    } catch(e) {}

    results[sym] = { earningsDate, estimated: earningsEst };
  }));

  return res.status(200).json(results);
};
