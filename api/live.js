// 나의 아침 데스크 — 실시간 데이터 (Vercel 서버 함수)
// GET /api/live → { at, coin: { BTC, ETH, BTC_USD }, weather, market: { KOSPI, KOSDAQ, USDKRW, GOLD, GOLD_DON }, claude: { status, code } }
// 코인: 업비트 공개 시세 API / 날씨: Open-Meteo (서울)
// 지수: 네이버 증권(실패 시 야후 파이낸스) / 환율·국제 금: 야후 파이낸스 — 모두 API 키 불필요
// Claude: 공식 상태 페이지(status.claude.com) 요약 / Claude Code 최신 버전(npm 레지스트리)
// 각 항목은 따로 가져오고, 하나가 실패해도 나머지는 그대로 보냅니다.

const WMO = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림',
  45: '안개', 48: '안개',
  51: '이슬비', 53: '이슬비', 55: '이슬비', 56: '어는 이슬비', 57: '어는 이슬비',
  61: '비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비',
  71: '눈', 73: '눈', 75: '강한 눈', 77: '싸락눈',
  80: '소나기', 81: '소나기', 82: '강한 소나기',
  85: '눈 소나기', 86: '눈 소나기',
  95: '뇌우', 96: '뇌우(우박)', 99: '뇌우(우박)'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getJson(url, timeoutMs = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: ctl.signal });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const num = v => {
  if (v == null) return NaN;
  return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
};

async function coin() {
  const rows = await getJson('https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,USDT-BTC');
  const out = {};
  for (const t of rows) {
    // USDT-BTC(업비트 USDT 마켓)는 달러 시세로 사용
    const key = t.market === 'USDT-BTC' ? 'BTC_USD' : t.market.replace('KRW-', '');
    out[key] = { price: t.trade_price, rate: t.signed_change_rate };
  }
  return out;
}

async function weather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978'
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=Asia%2FSeoul&forecast_days=1';
  const d = await getJson(url);
  return {
    temp: d.current.temperature_2m,
    desc: WMO[d.current.weather_code] || '날씨 정보',
    min: d.daily.temperature_2m_min[0],
    max: d.daily.temperature_2m_max[0],
    pop: d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[0] : null
  };
}

// 야후 파이낸스 차트 API: 현재가와 전일 종가로 등락 계산
async function yahoo(symbol) {
  const d = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=5m');
  const m = d.chart.result[0].meta;
  const price = num(m.regularMarketPrice);
  const prev = num(m.chartPreviousClose ?? m.previousClose);
  if (!isFinite(price)) throw new Error(symbol + ' no price');
  return {
    price,
    change: isFinite(prev) ? price - prev : null,
    rate: isFinite(prev) && prev ? (price - prev) / prev : null,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    src: 'yahoo'
  };
}

// 네이버 증권 지수 (사용자가 비교하는 기준과 같음)
async function naverIndex(code) {
  const d = await getJson('https://m.stock.naver.com/api/index/' + code + '/basic');
  const price = num(d.closePrice);
  const change = num(d.compareToPreviousClosePrice);
  const ratio = num(d.fluctuationsRatio);
  if (!isFinite(price)) throw new Error(code + ' no price');
  return {
    price,
    change: isFinite(change) ? change : null,
    rate: isFinite(ratio) ? ratio / 100 : null,
    open: d.marketStatus ? d.marketStatus === 'OPEN' : null,
    time: d.localTradedAt || null,
    src: 'naver'
  };
}

const firstOk = async (...fns) => {
  let err;
  for (const f of fns) { try { return await f(); } catch (e) { err = e; } }
  throw err;
};

async function market() {
  const [kospi, kosdaq, fx, gold] = await Promise.allSettled([
    firstOk(() => naverIndex('KOSPI'), () => yahoo('^KS11')),
    firstOk(() => naverIndex('KOSDAQ'), () => yahoo('^KQ11')),
    yahoo('KRW=X'),
    yahoo('GC=F')
  ]);
  const v = r => (r.status === 'fulfilled' ? r.value : null);
  const out = { KOSPI: v(kospi), KOSDAQ: v(kosdaq), USDKRW: v(fx), GOLD: v(gold), GOLD_DON: null };
  // 국제 금값을 원화 1돈(3.75g)으로 환산 — 부가세·공임 제외, 국내 판매가와 다름
  if (out.GOLD && out.USDKRW) {
    const perGramUsd = out.GOLD.price / 31.1034768;
    out.GOLD_DON = { price: Math.round(perGramUsd * 3.75 * out.USDKRW.price), rate: out.GOLD.rate };
  }
  return out;
}

// Claude 서비스 상태와 Claude Code 최신 버전
async function claudeInfo() {
  const [st, cc] = await Promise.allSettled([
    getJson('https://status.claude.com/api/v2/summary.json'),
    getJson('https://registry.npmjs.org/@anthropic-ai/claude-code/latest')
  ]);
  const out = { status: null, code: null };
  if (st.status === 'fulfilled' && st.value && st.value.status) {
    const s = st.value;
    out.status = {
      indicator: s.status.indicator || null,
      description: s.status.description || null,
      incidents: (s.incidents || []).slice(0, 3).map(i => ({ name: i.name, status: i.status })),
      degraded: (s.components || []).filter(c => !c.group && c.status && c.status !== 'operational').map(c => c.name).slice(0, 4)
    };
  }
  if (cc.status === 'fulfilled' && cc.value && cc.value.version) out.code = { version: cc.value.version };
  if (!out.status && !out.code) throw new Error('claude info unavailable');
  return out;
}

module.exports = async (req, res) => {
  const [c, w, m, cl] = await Promise.allSettled([coin(), weather(), market(), claudeInfo()]);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 30초 동안은 캐시된 값을 재사용 (새로고침 연타 대비)
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.status(200).send(JSON.stringify({
    at: new Date().toISOString(),
    coin: c.status === 'fulfilled' ? c.value : null,
    weather: w.status === 'fulfilled' ? w.value : null,
    market: m.status === 'fulfilled' ? m.value : null,
    claude: cl.status === 'fulfilled' ? cl.value : null
  }));
};
