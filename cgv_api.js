/**
 * CGV API 클라이언트 모듈
 * 극장별 오픈 날짜 조회, 상영 시간표 및 잔여 좌석 실시간 조회
 */

const COMPANY_CODE = 'A420'; // CJ CGV 회사코드
const DEFAULT_SITE_NO = '0013'; // CGV 용산아이파크몰

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://cgv.co.kr/'
};

/**
 * 극장의 오픈된 상영일자 목록 조회
 * @param {string} siteNo 극장코드 (기본값: 0013 용산)
 * @returns {Promise<string[]>} 날짜 목록 (예: ['20260912', '20260913', ...])
 */
async function getOpenDates(siteNo = DEFAULT_SITE_NO) {
  const url = `https://cgv.co.kr/api/v1/booking/searchSiteScnscYmdListBySite?coCd=${COMPANY_CODE}&siteNo=${siteNo}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`상영일자 조회 실패 (HTTP ${res.status})`);
  }
  const json = await res.json();
  if (json.statusCode !== 0 || !Array.isArray(json.data)) {
    throw new Error(json.statusMessage || '오픈 날짜 데이터가 없습니다.');
  }
  return json.data.map(item => item.scnYmd);
}

/**
 * 특정 날짜의 극장 전체 상영시간표 조회
 * @param {string} scnYmd 상영일자 (YYYYMMDD)
 * @param {string} siteNo 극장코드 (기본값: 0013)
 * @returns {Promise<Array>} 상영 회차 목록
 */
async function getSchedules(scnYmd, siteNo = DEFAULT_SITE_NO) {
  const url = `https://cgv.co.kr/api/v1/booking/searchMovScnInfo?coCd=${COMPANY_CODE}&siteNo=${siteNo}&scnYmd=${scnYmd}&rtctlScopCd=01`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`상영시간표 조회 실패 (HTTP ${res.status})`);
  }
  const json = await res.json();
  if (json.statusCode !== 0) {
    throw new Error(json.statusMessage || '상영시간표 응답 에러');
  }
  const list = json.data || [];
  return list.map(item => {
    const screenName = item.scnsNm || item.expoScnsNm || '';
    const movieTitle = item.prodNm || item.expoProdNm || '';
    const isImax = screenName.includes('IMAX') || movieTitle.includes('IMAX');
    const remainingSeats = item.atktPsblQty !== undefined && item.atktPsblQty !== null ? parseInt(item.atktPsblQty, 10) : 0;
    
    // 시간 포맷 (예: 0920 -> 09:20)
    const formatTime = (t) => (t && t.length === 4) ? `${t.substring(0, 2)}:${t.substring(2, 4)}` : t;

    return {
      movieTitle,
      screenName,
      isImax,
      date: item.scnYmd,
      startTime: formatTime(item.scnsrtTm),
      endTime: formatTime(item.scnendTm),
      remainingSeats,
      rating: item.cratgClsNm || '',
      movieNo: item.prodNo,
      siteNo: item.siteNo,
      screenNo: item.scnsNo,
      rawTime: item.scnsrtTm
    };
  });
}

/**
 * 영화 목록 및 상영관 필터링
 * @param {Array} schedules 전체 스케줄 목록
 * @param {Object} options 필터 조건
 */
function filterSchedules(schedules, { movieKeyword = '', screenKeyword = '', onlyAvailable = false } = {}) {
  const mKw = movieKeyword.trim().toLowerCase();
  const sKw = screenKeyword.trim().toLowerCase();

  return schedules.filter(s => {
    if (mKw && !s.movieTitle.toLowerCase().includes(mKw)) return false;
    if (sKw && !s.screenName.toLowerCase().includes(sKw)) return false;
    if (onlyAvailable && s.remainingSeats <= 0) return false;
    return true;
  });
}

module.exports = {
  COMPANY_CODE,
  DEFAULT_SITE_NO,
  getOpenDates,
  getSchedules,
  filterSchedules
};
