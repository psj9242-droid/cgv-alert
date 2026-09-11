/**
 * 24시간 클라우드 전용 모니터링 엔진
 * - 환경변수 기반 텔레그램 연동
 * - 클라우드 헬스체크용 경량 HTTP 서버 내장
 * - 365일 무중단 동작
 */

const http = require('http');
const { getOpenDates, getSchedules, filterSchedules } = require('./cgv_api');

// 설정값 (기본값으로 형준님의 봇 토큰 및 Chat ID 등록)
const CONFIG = {
  port: process.env.PORT || 3000,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '8393220813:AAG8jvm-SRxu5c6PG_RkmaGLVtKRr0SCrUY',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '8661092536',
  targetMovie: process.env.TARGET_MOVIE || '오디세이',
  targetScreen: process.env.TARGET_SCREEN || 'IMAX',
  siteNo: process.env.SITE_NO || '0013', // 용산아이파크몰
  intervalSeconds: parseInt(process.env.CHECK_INTERVAL || '20', 10), // 20초 주기
};

const knownDates = new Set();
const knownScreenings = new Map();

async function sendTelegram(text) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    console.log('[Telegram Not Configured] ' + text);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}

async function checkCGV() {
  const timeStr = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`[${timeStr}] CGV 용산아이맥스 확인 중...`);

  try {
    const openDates = await getOpenDates(CONFIG.siteNo);

    // 1. 신규 날짜 오픈 확인
    if (knownDates.size > 0) {
      const newDates = openDates.filter(d => !knownDates.has(d));
      if (newDates.length > 0) {
        const msg = `🎉 *[CGV 용산] 신규 예매 일자 오픈!*\n\n새로운 상영 날짜가 열렸습니다:\n👉 ${newDates.join(', ')}\n\n🔗 [CGV 바로가기](https://cgv.co.kr/theaters?theaterCode=${CONFIG.siteNo})`;
        await sendTelegram(msg);
      }
    }
    openDates.forEach(d => knownDates.add(d));

    // 2. 상영시간표 조회 (최근 4개 일자)
    const datesToCheck = openDates.slice(0, 4);
    for (const date of datesToCheck) {
      const schedules = await getSchedules(date, CONFIG.siteNo);
      const filtered = filterSchedules(schedules, {
        movieKeyword: CONFIG.targetMovie,
        screenKeyword: CONFIG.targetScreen
      });

      for (const s of filtered) {
        const key = `${s.date}_${s.movieNo}_${s.screenName}_${s.rawTime}`;
        const prevSeats = knownScreenings.get(key);

        if (prevSeats === undefined) {
          if (knownScreenings.size > 0) {
            // 신규 티켓 오픈!
            const msg = `🔥 *[티켓 오픈 감지!]*\n\n🎬 *영화*: ${s.movieTitle}\n📅 *날짜*: ${s.date}\n⏰ *시간*: ${s.startTime} ~ ${s.endTime}\n🏛️ *상영관*: ${s.screenName}\n🎟️ *잔여좌석*: ${s.remainingSeats}석\n\n👉 [CGV 예매 바로가기](https://cgv.co.kr/theaters?theaterCode=${CONFIG.siteNo})`;
            await sendTelegram(msg);
          }
        } else if (prevSeats <= 0 && s.remainingSeats > 0) {
          // 취소표 발생!
          const msg = `✨ *[취소표 발생 알림!]*\n\n🎬 *영화*: ${s.movieTitle}\n📅 *날짜*: ${s.date}\n⏰ *시간*: ${s.startTime} ~ ${s.endTime}\n🏛️ *상영관*: ${s.screenName}\n🎟️ *현재 잔여*: ${s.remainingSeats}석\n\n👉 [CGV 예매 바로가기](https://cgv.co.kr/theaters?theaterCode=${CONFIG.siteNo})`;
          await sendTelegram(msg);
        }

        knownScreenings.set(key, s.remainingSeats);
      }
    }
  } catch (err) {
    console.error(`Check error: ${err.message}`);
  }
}

// 헬스체크 웹 서버 (클라우드 인스턴스 유지용)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    service: 'CGV Yongsan IMAX 24/7 Cloud Monitor',
    targetMovie: CONFIG.targetMovie,
    targetScreen: CONFIG.targetScreen,
    openDatesCount: knownDates.size,
    screeningsMonitored: knownScreenings.size,
    currentTime: new Date().toISOString()
  }));
});

server.listen(CONFIG.port, async () => {
  console.log(`Cloud Monitor running on port ${CONFIG.port}`);
  await sendTelegram(`🚀 *[CGV 용산아이맥스 알리미 시작]*\n\n클라우드 서버에서 24시간 감시가 시작되었습니다!\n🎯 대상: ${CONFIG.targetMovie} (${CONFIG.targetScreen})\n⏱️ 확인 주기: ${CONFIG.intervalSeconds}초\n\n컴퓨터가 꺼져 있어도 티켓이 열리면 이곳으로 즉시 알려드립니다.`);
  
  // 최초 체크 및 주기적 실행
  checkCGV();
  setInterval(checkCGV, CONFIG.intervalSeconds * 1000);
});
