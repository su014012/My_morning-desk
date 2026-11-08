// 나의 아침 데스크 — 실시간 데이터 (Vercel 서버 함수)
// GET /api/live → { at, coin: { BTC, ETH, BTC_USD }, weather }
// 코인: 업비트 공개 시세 API / 날씨: Open-Meteo (서울, API 키 불필요)

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

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

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

module.exports = async (req, res) => {
  const [c, w] = await Promise.allSettled([coin(), weather()]);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 30초 동안은 캐시된 값을 재사용 (새로고침 연타 대비)
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.status(200).send(JSON.stringify({
    at: new Date().toISOString(),
    coin: c.status === 'fulfilled' ? c.value : null,
    weather: w.status === 'fulfilled' ? w.value : null
  }));
};
