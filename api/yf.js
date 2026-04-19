module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  const iv  = req.query.interval || '1d';
  let rng   = req.query.range    || '1y';
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const KEY = 'ZxWffBFSyK9tS1iLeReFAyetjiV9x3nj';

  try {
    const now = new Date();
    const rangeMap = {
      '1d':5,'5d':7,'1mo':35,'3mo':95,'6mo':185,
      '1y':370,'2y':735,'3y':1100,'5y':1830,'10y':3660
    };
    const days = rangeMap[rng] || 370;
    const from = new Date(now - days*86400000);
    const toStr   = now.toISOString().slice(0,10);
    const fromStr = from.toISOString().slice(0,10);

    const ivMap = {
      '1m':  {mult:1,  span:'minute'},
      '5m':  {mult:5,  span:'minute'},
      '15m': {mult:15, span:'minute'},
      '30m': {mult:30, span:'minute'},
      '60m': {mult:1,  span:'hour'},
      '1d':  {mult:1,  span:'day'},
      '1wk': {mult:1,  span:'week'},
      '1mo': {mult:1,  span:'month'},
    };
    const {mult, span} = ivMap[iv] || {mult:1, span:'day'};
    const limit = (span === 'minute' || span === 'hour') ? 5000 : 2000;

    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/${mult}/${span}/${fromStr}/${toStr}`
      + `?adjusted=true&sort=asc&limit=${limit}&apiKey=${KEY}`;

    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: 'polygon_' + r.status });
    const data = await r.json();
    if (data.status === 'ERROR') return res.status(400).json({ error: data.error || 'polygon_error' });
    if (!data.results || !data.results.length) return res.status(404).json({ error: 'no_data' });

    const results = data.results;
    const last = results[results.length - 1];
    const prev = results[results.length - 2] || results[0];

    const out = {
      chart: {
        result: [{
          meta: {
            symbol: sym,
            regularMarketPrice:   parseFloat(last.c.toFixed(2)),
            chartPreviousClose:   parseFloat(prev.c.toFixed(2)),
            regularMarketOpen:    parseFloat(last.o.toFixed(2)),
            regularMarketDayHigh: parseFloat(last.h.toFixed(2)),
            regularMarketDayLow:  parseFloat(last.l.toFixed(2)),
            regularMarketVolume:  last.v,
            fiftyTwoWeekHigh: Math.max(...results.map(r=>r.h)),
            fiftyTwoWeekLow:  Math.min(...results.map(r=>r.l)),
          },
          timestamp: results.map(r => Math.floor(r.t / 1000)),
          indicators: {
            quote: [{
              open:   results.map(r => r.o),
              high:   results.map(r => r.h),
              low:    results.map(r => r.l),
              close:  results.map(r => r.c),
              volume: results.map(r => r.v),
            }]
          }
        }],
        error: null
      }
    };

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(out);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
