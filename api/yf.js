module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = (req.query.symbol || '').toUpperCase().trim();
  const iv  = req.query.interval || '1d';
  const rng = req.query.range    || '1y';
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const KEY = '5680395d04634b108543371adcc0d1f5';

  try {
    // Map interval
    const ivMap = {
      '1m':'1min','5m':'5min','15m':'15min','30m':'30min',
      '60m':'1h','1d':'1day','1wk':'1week','1mo':'1month'
    };
    const tdInterval = ivMap[iv] || '1day';

    // Map range to outputsize
    const rangeMap = {
      '1d':1,'5d':5,'1mo':30,'3mo':90,'6mo':180,
      '1y':365,'2y':730,'3y':1095,'5y':1825,'10y':3650
    };
    const days = rangeMap[rng] || 365;

    // For intraday use more bars
    let outputsize;
    if (tdInterval.includes('min') || tdInterval === '1h') {
      outputsize = Math.min(days * 8, 5000);
    } else {
      outputsize = Math.min(days, 5000);
    }

    const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=${tdInterval}&outputsize=${outputsize}&apikey=${KEY}&format=JSON&order=ASC`;

    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: 'twelvedata_' + r.status });

    const data = await r.json();
    if (data.status === 'error') return res.status(400).json({ error: data.message || 'twelvedata_error' });
    if (!data.values || !data.values.length) return res.status(404).json({ error: 'no_data' });

    const values = data.values;
    const last = values[values.length - 1];
    const prev = values[values.length - 2] || values[0];

    // Convert to Yahoo Finance compatible format
    const out = {
      chart: {
        result: [{
          meta: {
            symbol: sym,
            regularMarketPrice:   parseFloat(parseFloat(last.close).toFixed(2)),
            chartPreviousClose:   parseFloat(parseFloat(prev.close).toFixed(2)),
            regularMarketOpen:    parseFloat(parseFloat(last.open).toFixed(2)),
            regularMarketDayHigh: parseFloat(parseFloat(last.high).toFixed(2)),
            regularMarketDayLow:  parseFloat(parseFloat(last.low).toFixed(2)),
            regularMarketVolume:  parseInt(last.volume || 0),
            fiftyTwoWeekHigh: Math.max(...values.map(v => parseFloat(v.high))),
            fiftyTwoWeekLow:  Math.min(...values.map(v => parseFloat(v.low))),
          },
          timestamp: values.map(v => Math.floor(new Date(v.datetime).getTime() / 1000)),
          indicators: {
            quote: [{
              open:   values.map(v => parseFloat(v.open)),
              high:   values.map(v => parseFloat(v.high)),
              low:    values.map(v => parseFloat(v.low)),
              close:  values.map(v => parseFloat(v.close)),
              volume: values.map(v => parseInt(v.volume || 0)),
            }]
          }
        }],
        error: null
      }
    };

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(out);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
