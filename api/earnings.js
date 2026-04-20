const NINJAS_KEY = 'B8xYKluZsfD4kTprOJEJzyOXFuFCJ95D67FA36sV';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 50);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    let earningsDate = null;
    let earningsEst = null;
    try {
      const r = await fetch(
        `https://api.api-ninjas.com/v1/earningscalendar?ticker=${sym}`,
        { headers: { 'X-Api-Key': NINJAS_KEY } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows.length) {
          // Sort by date descending, get most recent
          rows.sort((a,b) => new Date(b.date) - new Date(a.date));
          const lastDate = new Date(rows[0].date);
          const now = new Date();

          // If last earnings was recent (within 120 days), estimate next = last + 91 days
          const daysSinceLast = (now - lastDate) / 86400000;
          if (daysSinceLast >= 0 && daysSinceLast <= 120) {
            const nextEst = new Date(lastDate.getTime() + 91*86400000);
            earningsDate = nextEst.toISOString().slice(0,10);
            earningsEst = true; // mark as estimated
          } else if (daysSinceLast < 0) {
            // Last date is in future = that IS the next earnings
            earningsDate = rows[0].date;
            earningsEst = false;
          }
          // If > 120 days ago, try to find pattern from multiple quarters
          if (!earningsDate && rows.length >= 2) {
            rows.sort((a,b) => new Date(b.date) - new Date(a.date));
            const d1 = new Date(rows[0].date);
            const d2 = new Date(rows[1].date);
            const avgDays = (d1 - d2) / 86400000; // avg days between reports
            const gap = avgDays > 60 && avgDays < 120 ? avgDays : 91;
            const nextEst = new Date(d1.getTime() + gap*86400000);
            if (nextEst > now) {
              earningsDate = nextEst.toISOString().slice(0,10);
              earningsEst = true;
            }
          }
        }
      }
    } catch(e) {}
    results[sym] = { earningsDate, estimated: earningsEst };
  }));

  return res.status(200).json(results);
};
