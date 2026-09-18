/**
 * 24시간 클라우드 전용 모니터링 & 스마트 취소표 감지 엔진 (V4)
 * - 신규 티켓 오픈 100% 실시간 감지
 * - [신규] 매진/인기 회차에서 "명당 취소표(+1~2석)" 발생 시 스마트 필터링 알림
 * - 스마트폰 좌석 화면 1초 직행 딥링크 탑재
 * - 미래 모든 오픈 날짜 전수 감시
 * - 매일 아침 9시 생존 신고
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getOpenDates, getSchedules, filterSchedules } = require('./cgv_api');

const CONFIG = {
  port: process.env.PORT || 3000,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '8393220813:AAG8jvm-SRxu5c6PG_RkmaGLVtKRr0SCrUY',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '8661092536',
  targetMovie: process.env.TARGET_MOVIE || '오디세이',
  targetScreen: process.env.TARGET_SCREEN || 'IMAX',
  siteNo: process.env.SITE_NO || '0013', // 용산아이파크몰
  intervalSeconds: parseInt(process.env.CHECK_INTERVAL || '20', 10), // 20초 주기
};

const CACHE_FILE = path.join(__dirname, 'known_cache.json');

let cacheData = { knownDates: [], knownScreenings: {} };
try {
  if (fs.existsSync(CACHE_FILE)) {
    cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  }
} catch (e) {}

const knownDates = new Set(cacheData.knownDates || []);
const knownScreenings = new Map(Object.entries(cacheData.knownScreenings || {}));
let isFirstRun = knownDates.size === 0;
let lastHeartbeatDate = '';

function saveCache() {
  try {
    const obj = {
      knownDates: Array.from(knownDates),
      knownScreenings: Object.fromEntries(knownScreenings),
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf-8');
  } catch (e) {}
}

async function sendTelegram(text) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  try {
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}

async function checkDailyHeartbeat() {
  const nowKst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const todayStr = `${nowKst.getFullYear()}-${String(nowKst.getMonth() + 1).padStart(2, '0')}-${String(nowKst.getDate()).padStart(2, '0')}`;
  const currentHour = nowKst.getHours();

  if (currentHour === 9 && lastHeartbeatDate !== todayStr) {
    lastHeartbeatDate = todayStr;
    const msg = `💚 *[CGV 용산아이맥스] 모니터링 정상 작동 중*\n\n클라우드 서버가 365일 24시간 감시하고 있습니다.\n\n🎯 *감시 대상*: ${CONFIG.targetMovie} (${CONFIG.targetScreen})\n📅 *현재 오픈된 날짜*: ${knownDates.size}개 일자\n⏱️ *확인 주기*: ${CONFIG.intervalSeconds}초마다 확인 중\n\n신규 오픈 및 명당 취소표 감시가 활성화되어 있습니다! 🚀`;
    await sendTelegram(msg);
  }
}

async function checkCGV() {
  await checkDailyHeartbeat();

  try {
    const openDates = await getOpenDates(CONFIG.siteNo);

    // 1. 신규 날짜 예매 오픈 감지
    if (!isFirstRun && knownDates.size > 0) {
      const newDates = openDates.filter(d => !knownDates.has(d));
      if (newDates.length > 0) {
        console.log(`[ALERT] New dates opened: ${newDates.join(', ')}`);
        const msg = `🎉 *[CGV 용산] 신규 예매 일자 오픈!*\n\n새로운 상영 날짜가 열렸습니다:\n👉 ${newDates.join(', ')}\n\n🔗 [CGV 용산 예매 바로가기](https://cgv.co.kr/theaters?theaterCode=${CONFIG.siteNo})`;
        await sendTelegram(msg);
      }
    }
    openDates.forEach(d => knownDates.add(d));

    // 2. 상영시간표 전수 검사 (오늘 이후 모든 미래 오픈 날짜)
    const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replace(/\. /g, '').replace('.', '').padStart(8, '0');
    const futureDates = openDates.filter(d => d >= todayStr);

    for (const date of futureDates) {
      try {
        const schedules = await getSchedules(date, CONFIG.siteNo);
        const filtered = filterSchedules(schedules, {
          movieKeyword: CONFIG.targetMovie,
          screenKeyword: CONFIG.targetScreen
        });

        for (const s of filtered) {
          const key = `${s.date}_${s.movieNo}_${s.screenName}_${s.rawTime}`;
          const prevSeats = knownScreenings.get(key);

          const sseq = s.scnSseq || '1';
          const mobileSeatUrl = `http://m.cgv.co.kr/Schedule/Seat.aspx?tc=${s.siteNo}&vd=${s.date}&sc=${s.screenNo}&s=${sseq}`;
          const webBookingUrl = `https://cgv.co.kr/theaters?theaterCode=${s.siteNo}&date=${s.date}`;

          // [A] 신규 회차 오픈 감지
          if (!isFirstRun && prevSeats === undefined) {
            console.log(`[ALERT] New screening: ${s.date} ${s.movieTitle} ${s.startTime}`);
            const msg = `🔥 *[용산 IMAX 신규 티켓 오픈!]*\n\n🎬 *영화*: ${s.movieTitle}\n📅 *날짜*: ${s.date}\n⏰ *시간*: ${s.startTime} ~ ${s.endTime}\n🏛️ *상영관*: ${s.screenName}\n🎟️ *잔여좌석*: ${s.remainingSeats}석\n\n🎯 *추천 명당*: 2인 연석 (H/I/G열 18~22번)\n\n👇 *1초 좌석창 직행 링크:*\n👉 [📱 스마트폰 좌석 선택창 바로가기](${mobileSeatUrl})\n👉 [💻 PC 웹 예매창 바로가기](${webBookingUrl})`;
            await sendTelegram(msg);
          }
          // [B] 스마트 명당 취소표 감지 (매진 또는 4석 이하 꽉 찬 인기 회차에서 취소표 발생 시)
          else if (!isFirstRun && prevSeats !== undefined && s.remainingSeats > prevSeats && prevSeats <= 4) {
            const addedSeats = s.remainingSeats - prevSeats;
            console.log(`[ALERT] Cancelled seats: ${s.date} ${s.startTime} (+${addedSeats} seats)`);
            const msg = `✨ *[용산 IMAX 꿀자리 취소표 발생!]*\n\n🎬 *영화*: ${s.movieTitle}\n📅 *날짜*: ${s.date}\n⏰ *시간*: ${s.startTime} ~ ${s.endTime}\n🏛️ *상영관*: ${s.screenName}\n🎟️ *취소표*: *+${addedSeats}석* 발생! (현재 총 ${s.remainingSeats}석)\n\n💡 *매진되었던 인기 회차에서 풀린 취소표입니다. 명당자리일 확률이 매우 높습니다!*\n\n👇 *남들보다 먼저 낚아채는 좌석창 직행:*\n👉 [📱 스마트폰 좌석 선택창 바로가기](${mobileSeatUrl})\n👉 [💻 PC 웹 예매창 바로가기](${webBookingUrl})`;
            await sendTelegram(msg);
          }

          knownScreenings.set(key, s.remainingSeats);
        }
      } catch (err) {}
    }

    if (isFirstRun) {
      isFirstRun = false;
      console.log(`[Init] Baseline set with ${knownDates.size} dates and ${knownScreenings.size} screenings.`);
    }

    saveCache();
  } catch (err) {
    console.error(`Check error: ${err.message}`);
  }
}

// 헬스체크 및 테스트 서버
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);

  if (url.pathname === '/test') {
    const timeStr = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
    const sampleMobileSeatUrl = `http://m.cgv.co.kr/Schedule/Seat.aspx?tc=0013&vd=20260918&sc=018&s=2`;

    await sendTelegram(`🔔 *[생존 및 좌석 딥링크 테스트]*\n\n현재 시각: ${timeStr}\n클라우드 서버가 100% 정상 작동 중입니다! 👍\n🎯 감시 대상: ${CONFIG.targetMovie} (${CONFIG.targetScreen})\n✨ 스마트 꿀자리 취소표 감지 활성화 완료\n\n👇 아래 링크를 눌러 좌석 화면이 바로 뜨는지 확인해 보세요:\n👉 [스마트폰 좌석창 직행 테스트 링크](${sampleMobileSeatUrl})`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ success: true, message: '텔레그램으로 테스트 알림 및 좌석 직행 링크를 발송했습니다!' }));
  }

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    service: 'CGV Yongsan IMAX 24/7 Smart Cancel & Fast Booking Monitor V4',
    targetMovie: CONFIG.targetMovie,
    targetScreen: CONFIG.targetScreen,
    openDatesCount: knownDates.size,
    screeningsMonitored: knownScreenings.size,
    currentTime: new Date().toISOString()
  }, null, 2));
});

server.listen(CONFIG.port, async () => {
  console.log(`Cloud Monitor running on port ${CONFIG.port}`);
  await sendTelegram(`🚀 *[CGV 용산아이맥스 알리미 V4 가동]*\n\n신규 티켓 오픈 + 꿀자리 취소표 스마트 감지가 시작되었습니다!\n🎯 대상: ${CONFIG.targetMovie} (${CONFIG.targetScreen})\n✨ 매진 회차에서 취소표 발생 시 즉시 좌석창 직행 링크 발송`);
  
  checkCGV();
  setInterval(checkCGV, CONFIG.intervalSeconds * 1000);
});
