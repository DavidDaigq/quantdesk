const NINJAS_KEY = 'B8xYKluZsfD4kTprOJEJzyOXFuFCJ95D67FA36sV';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=0');

  const symbols = (req.query.symbols || '').toUpperCase().split(',').filter(Boolean).slice(0, 50);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  // Debug mode: return raw API response for first symbol
  if (req.query.debug) {
    try {
      const sym = symbols[0];
      const r = await fetch(
        `https://api.api-ninjas.com/v1/earningscalendar?ticker=${sym}`,
        { headers: { 'X-Api-Key': NINJAS_KEY } }
      );
      const raw = await r.json();
      return res.status(200).json({ debug: true, sym, status: r.status, raw });
    } catch(e) {
      return res.status(200).json({ error: e.message });
    }
  }

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
        // Find upcoming date (today or future)
        const cutoff = new Date(Date.now() - 5*86400000);
        const upcoming = rows
          .filter(r => r.date && new Date(r.date) >= cutoff)
          .sort((a,b) => new Date(a.date) - new Date(b.date));
        if (upcoming.length) earningsDate = upcoming[0].date;
      }
    } catch(e) {}
    results[sym] = { earningsDate };
  }));

  return res.status(200).json(results);
};
