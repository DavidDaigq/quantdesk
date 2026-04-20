const NINJAS_KEY = 'B8xYKluZsfD4kTprOJEJzyOXFuFCJ95D67FA36sV';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 50);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};

  await Promise.all(symbols.map(async sym => {
    let earningsDate = null;
    try {
      const r = await fetch(
        `https://api.api-ninjas.com/v1/earningscalendar?ticker=${sym}`,
        { headers: { 'X-Api-Key': NINJAS_KEY } }
      );
      if (r.ok) {
        const rows = await r.json();
        const today = new Date();
        today.setHours(0,0,0,0);
        // Find the most recent upcoming or very recent date
        const upcoming = rows
          .filter(r => r.date && new Date(r.date) >= new Date(Date.now() - 5*86400000))
          .sort((a,b) => new Date(a.date) - new Date(b.date));
        if (upcoming.length) earningsDate = upcoming[0].date;
      }
    } catch(e) {}
    results[sym] = { earningsDate };
  }));

  return res.status(200).json(results);
};
