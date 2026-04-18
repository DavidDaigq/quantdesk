module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  const iv  = req.query.interval || '1d';
  const rng = req.query.range    || '6mo';
  if (!sym) return res.status(400).json({ error: 'symbol required' });
  const KEY = 'd7hs24pr01qu8vfmdv3gd7hs24pr01qu8vfmdv40';
  try {
    const now = Math.floor(Date.now() / 1000);
    const rangeMap = {'1d':1,'5d':5,'1mo':30,'3mo':90,'6mo':180,'1y':365,'2y':730,'3y':1095,'5y':1825,'10y':3650};
    const days = rangeMap[rng] || 180;
    const from = now - days * 86400;
    const ivMap = {'1m':'1','5m':'5','15m':'15','30m':'30','60m':'60','1d':'D','1wk':'W','1mo':'M'};
    const resolution = ivMap[iv] || 'D';
    const url = 'https://finnhub.io/api/v1/stock/candle?symbol='+sym+'&resolution='+resolution+'&from='+from+'&to='+now+'&token='+KEY;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: 'finnhub_'+r.status });
    const data = await r.json();
    if (data.s === 'no_data') return res.status(404).json({ error: 'no_data' });
    if (data.s !== 'ok') return res.status(500).json({ error: data.s });
    const last = data.c.length - 1;
    const result = {
      chart: { result: [{ meta: {
        symbol: sym,
        regularMarketPrice: data.c[last],
        chartPreviousClose: data.c[last-1] || data.c[0],
        regularMarketOpen: data.o[last],
        regularMarketDayHigh: data.h[last],
        regularMarketDayLow: data.l[last],
        regularMarketVolume: data.v[last],
        fiftyTwoWeekHigh: Math.max(...data.h),
        fiftyTwoWeekLow: Math.min(...data.l),
      }, timestamp: data.t, indicators: { quote: [{ open:data.o, high:data.h, low:data.l, close:data.c, volume:data.v }] } }], error: null }
    };
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(result);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
