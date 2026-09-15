// =====================================================
//  SALES PERFORMANCE
// =====================================================
// ── 영업실적 서브탭 전환 (실적 분석 / 매출 예측 / 신용분석) ─────────
function setSalesSubtab(key) {
  const perf     = document.getElementById('sales-perf-pane');
  const forecast = document.getElementById('sales-forecast-pane');
  const credit   = document.getElementById('sales-credit-pane');
  const btnP = document.getElementById('sales-subtab-perf');
  const btnF = document.getElementById('sales-subtab-forecast');
  const btnC = document.getElementById('sales-subtab-credit');
  const exportBtn = document.getElementById('sales-export-btn');
  if (!perf) return;
  [perf, forecast, credit].forEach(el => { if (el) el.style.display = 'none'; });
  [btnP, btnF, btnC].forEach(b => { if (b) b.classList.remove('active'); });
  if (key === 'forecast') {
    if (forecast) forecast.style.display = 'block';
    if (btnF) btnF.classList.add('active');
    if (exportBtn) exportBtn.style.display = 'none';
    if (window.erpForecast && typeof window.erpForecast._mountToTab === 'function') {
      try { window.erpForecast._mountToTab(); } catch(e) { console.error('[sales] forecast mount 실패:', e); }
    }
  } else if (key === 'credit') {
    if (credit) credit.style.display = 'block';
    if (btnC) btnC.classList.add('active');
    if (exportBtn) exportBtn.style.display = 'none';
    if (window.erpCredit && typeof window.erpCredit._mountToTab === 'function') {
      try { window.erpCredit._mountToTab(); } catch(e) { console.error('[sales] credit mount 실패:', e); }
    }
  } else {
    perf.style.display = '';
    if (btnP) btnP.classList.add('active');
    if (exportBtn) exportBtn.style.display = '';
    if (typeof renderSalesPerf === 'function') try { renderSalesPerf(); } catch(e) {}
  }
}
window.setSalesSubtab = setSalesSubtab;

// ── 영업 탭 서브탭 전환 (견적서/견적비교/가용재고/발주서/서류/사용전검사) ─
function setSalesOpsSubtab(key) {
  const quote   = document.getElementById('sops-quote-pane');
  const compare = document.getElementById('sops-compare-pane');
  const atpPane = document.getElementById('sops-atp-pane');
  const poPane  = document.getElementById('sops-po-pane');
  const docs    = document.getElementById('sops-docs-pane');
  const insp    = document.getElementById('sops-inspection-pane');
  const btnQ = document.getElementById('sops-subtab-quote');
  const btnC = document.getElementById('sops-subtab-compare');
  const btnA = document.getElementById('sops-subtab-atp');
  const btnP = document.getElementById('sops-subtab-po');
  const btnD = document.getElementById('sops-subtab-docs');
  const btnI = document.getElementById('sops-subtab-inspection');
  if (!quote) return;
  [quote, compare, atpPane, poPane, docs, insp].forEach(el => { if (el) el.style.display = 'none'; });
  [btnQ, btnC, btnA, btnP, btnD, btnI].forEach(b => { if (b) b.classList.remove('active'); });
  if (key === 'compare') {
    if (compare) compare.style.display = 'block';
    if (btnC) btnC.classList.add('active');
    if (window.vendorQuotes && typeof window.vendorQuotes._mountToTab === 'function') {
      try { window.vendorQuotes._mountToTab(); } catch(e) { console.error('[salesops] vendorQuotes mount 실패:', e); }
    }
  } else if (key === 'atp') {
    if (atpPane) atpPane.style.display = 'block';
    if (btnA) btnA.classList.add('active');
    if (window.atp && typeof window.atp._mountToTab === 'function') {
      try { window.atp._mountToTab(); } catch(e) { console.error('[salesops] atp mount 실패:', e); }
    }
  } else if (key === 'po') {
    if (poPane) poPane.style.display = 'block';
    if (btnP) btnP.classList.add('active');
    if (typeof renderPoList === 'function') try { renderPoList(); } catch(e) {}
  } else if (key === 'docs') {
    if (docs) docs.style.display = 'block';
    if (btnD) btnD.classList.add('active');
    if (typeof renderDocsTab === 'function') try { renderDocsTab(); } catch(e) { console.error('[salesops] docs render 실패:', e); }
  } else if (key === 'inspection') {
    if (insp) insp.style.display = 'block';
    if (btnI) btnI.classList.add('active');
    if (typeof renderInspectionTab === 'function') try { renderInspectionTab(); } catch(e) { console.error('[salesops] inspection render 실패:', e); }
  } else {
    quote.style.display = '';
    if (btnQ) btnQ.classList.add('active');
    if (window.quotation && typeof window.quotation._mountToTab === 'function') {
      try { window.quotation._mountToTab(); } catch(e) { console.error('[salesops] quotation mount 실패:', e); }
    }
  }
}
window.setSalesOpsSubtab = setSalesOpsSubtab;

// =====================================================
//  발주서 PDF 드래그&드롭 → 수주 자동 등록
//  - PDF.js 로 텍스트 추출
//  - 정규식으로 PJ NO·고객사·모델·수량·단가·발전소·납품주소 인식
//  - 미리보기 → 사용자 확인 → rawData 등록
// =====================================================
const PO_PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PO_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let _poPdfReady = false;
let _poParsedQueue = [];   // 파싱된 발주서 대기열

function _ensurePoPdfJs() {
  if (_poPdfReady && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (window.pdfjsLib) { _poPdfReady = true; return Promise.resolve(window.pdfjsLib); }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PO_PDFJS_URL;
    s.onload = () => {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PO_PDFJS_WORKER; } catch(e){}
      _poPdfReady = true;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('PDF.js 로드 실패'));
    document.head.appendChild(s);
  });
}

async function _readPoPdfText(file) {
  const pdfjs = await _ensurePoPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(it => it.str).join('\n'));
  }
  return pages.join('\n\n');
}

// ★ 2026-05-13 발주서 텍스트 파싱 — 실제 다양한 양식(친환경에너지센터·글로우에너지·세이브·대양이엔지) 분석 후 강화
//
// 주요 개선:
//   1. PDF 추출 시 자주 발생하는 "발 주 일 자" (글자 사이 공백) 정규화
//   2. "바로" (우리 회사) 는 고객사 후보에서 제외
//   3. 다중 패턴 시도 + 우선순위 fallback
//   4. 표 형태 항목(품명/규격/수량/단가/공급가액/부가세) 추출
//   5. "부가세포함" / "부가세별도" 자동 감지하여 총액 계산
//   6. 한글 날짜(2026년 5월 12일) / ISO 날짜 / .구분 모두 지원
function parsePoPdfText(text) {
  const result = {
    pjNo: '', 고객사: '', 모델명: '', 제조사: '',
    수량: 0, 단가: 0, 총액: 0, vat: 0, 부가세포함: false,
    수주용량kW: '', 제품용량W: '',
    발전소명: '', 납품주소: '', 인수담당자: '', 인수담당자전화: '',
    수주일: '', 출고요청일: '',
    수금조건: '', 매입사: '', 비고: '',
    _raw: text ? text.slice(0, 800) : ''
  };
  if (!text) return result;

  // ── 0) 사전 처리: 한글 라벨의 글자 사이 공백 정규화 ──
  //   PDF.js 가 "발 주 일 자" 처럼 글자 단위로 분리해 추출하는 경우가 흔함
  //   알려진 라벨에 한해 정규화하여 안전하게 처리
  const KOREAN_LABELS = [
    '발주서','발주일자','발주번호','발주자','발주일','작성일','수주일',
    '업체명','담당자','대표자','대표이사','성명','업태','종목','거래처',
    '품명','품목명','품목','규격','수량','단위','단가','공급가액','부가세','세액','합계','합계금액','총액','금액','비고','BIGO',
    '납기일자','납기예정일','입고요구일','납품예정일','납기일','납기','유효일자',
    '납품장소','인도장소','입고장소','납품주소','인도조건','납품지','납품',
    '현장명','현장담당자','인수담당자','인수자','현장','발전소명','발전소','프로젝트',
    '결제조건','수금조건','지불조건','결제방식',
    '주소','전화','전화번호','팩스','팩스번호','이메일',
    '사업자번호','사업자등록번호','등록번호',
    '상호','회사명','특기사항','특이사항','메모','MEMO','REMARKS','참조','참고'
  ];
  let t = text.replace(/\r/g, '');
  for (const label of KOREAN_LABELS) {
    // "발 주 일 자" → "발주일자" 정규화
    const spaced = label.split('').join('\\s*');
    try {
      const rx = new RegExp(spaced, 'g');
      t = t.replace(rx, label);
    } catch(e) {}
  }
  // 콜론 주변 공백 정리
  t = t.replace(/\s*:\s*/g, ': ').replace(/[ \t]+/g, ' ');

  let m;

  // ── 1) PJ NO / 발주번호 ──
  //   "발주번호 : 20260512-26" / "NO : 20260511-B001" / "발주번호 20260511-EC001"
  const pjPatterns = [
    /(?:발주번호|문서번호)\s*:?\s*([A-Z0-9][-A-Z0-9]{4,25})/i,
    /\bNO\s*:?\s*([A-Z0-9][-A-Z0-9]{6,25})/i,
    /\b([A-Z]{2,3}-\d{5,10})\b/,
    /\b(\d{8}-[A-Z0-9]{2,6})\b/      // 20260511-B001
  ];
  for (const p of pjPatterns) {
    if (m = t.match(p)) { result.pjNo = m[1].replace(/\s/g,'').toUpperCase(); break; }
  }

  // ── 2) 날짜 매칭 — 출고요청일을 먼저 매칭한 후 수주일 fallback 에서 제외 ──
  const _dateFromMatch = (mm) => `${mm[1]}-${mm[2].padStart(2,'0')}-${mm[3].padStart(2,'0')}`;

  // ── 2a) 납기 / 출고요청일 (먼저 매칭) ──
  let dueMatched = false;
  if (m = t.match(/(?:납기예정일|납기일자|입고요구일|납품예정일|납기일|납기)[\s\S]{0,80}?(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})/)) {
    result.출고요청일 = _dateFromMatch(m); dueMatched = true;
  }
  if (!dueMatched && (m = t.match(/(?:납기예정일|납기일자|입고요구일|납품예정일|납기일|납기)\s*:?\s*(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/))) {
    result.출고요청일 = _dateFromMatch(m);
  }

  // ── 2b) 발주일자 (수주일) ──
  //   라벨 매치는 좁은 윈도우(50자) 안에서만 — 너무 멀면 다른 날짜를 잘못 잡음
  let dateMatched = false;
  if (m = t.match(/(?:발주일자|작성일자|작성일|발주일|수주일)\s*:?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})/)) {
    result.수주일 = _dateFromMatch(m); dateMatched = true;
  }
  if (!dateMatched && (m = t.match(/(?:발주일자|작성일자|작성일|발주일|수주일)\s*:?\s*(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/))) {
    result.수주일 = _dateFromMatch(m); dateMatched = true;
  }
  // 라벨 직후 매칭 실패 시: 출고요청일과 다른 첫 날짜 사용
  if (!dateMatched) {
    const dates = [];
    const rxAll = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g;
    let mm;
    while ((mm = rxAll.exec(t)) !== null) {
      const d = `${mm[1]}-${mm[2].padStart(2,'0')}-${mm[3].padStart(2,'0')}`;
      if (!dates.includes(d)) dates.push(d);
    }
    const candidate = dates.find(d => d !== result.출고요청일);
    if (candidate) result.수주일 = candidate;
    else if (dates.length > 0) result.수주일 = dates[0];
  }
  // 수주일이 출고요청일과 같으면 → 잘못 매칭된 것 → 다른 날짜로 교체
  if (result.수주일 && result.수주일 === result.출고요청일) {
    const dates = [];
    const rxAll = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g;
    let mm;
    while ((mm = rxAll.exec(t)) !== null) {
      const d = `${mm[1]}-${mm[2].padStart(2,'0')}-${mm[3].padStart(2,'0')}`;
      if (!dates.includes(d)) dates.push(d);
    }
    const candidate = dates.find(d => d !== result.출고요청일);
    if (candidate) result.수주일 = candidate;
  }

  // ── 4) 고객사 (발주자) ──
  //   "바로" 는 우리 회사 → 제외
  const _isUs = s => /바로/.test(s);
  // 일반 라벨 단어들 (이름이나 회사명으로 잘못 매칭되면 안 됨)
  const COMMON_LABELS = new Set(['발주자','발주서','발주처','담당자','상호','회사명','업체명','대표자','대표이사','주식회사','업태','종목','전화','팩스','주소','이메일','품명','규격','수량','단가','공급가액','부가세','합계','합계금액','비고','특이사항','추후공지','국내','현장','없음','연락처','참조','참고','메모','MEMO','REMARKS']);
  const _isLabel = s => COMMON_LABELS.has((s||'').replace(/[\s()㈜]/g,''));
  const _cleanCustomer = s => {
    let v = String(s||'').trim();
    v = v.replace(/\(주\)/g,'㈜').replace(/주\s*식\s*회\s*사/g,'주식회사');
    // 후속 라벨/구분자 제거
    v = v.replace(/\s*(?:성\s*명|등록번호|사업자|업태|종목|전화|팩스|주소|대표).*$/, '').trim();
    v = v.split(/\n/)[0].trim();
    // 너무 긴 문자열은 첫 회사명만
    if (v.length > 30) v = v.slice(0, 30);
    return v;
  };
  // 후보 수집
  const customerCands = [];
  // 패턴 1: "상호 ㈜A" / "상호: A" — 라인 끝까지 (성명/등록번호 등 후속 라벨에서 cut)
  let rx = /상호\s*:?\s*([(㈜]?[가-힣A-Za-z][가-힣A-Za-z()㈜0-9_\-\s]{1,40})/g;
  while ((m = rx.exec(t)) !== null) {
    const v = _cleanCustomer(m[1]);
    if (v && !_isUs(v) && !_isLabel(v)) customerCands.push(v);
  }
  // 패턴 2: "A 귀하" / "A 귀중" / "A貴中"
  rx = /([(㈜]?[가-힣A-Za-z㈜][가-힣A-Za-z()㈜0-9_\-\s]{1,28})\s*(?:귀하|귀중|貴中|貴下)/g;
  while ((m = rx.exec(t)) !== null) {
    const v = _cleanCustomer(m[1]);
    if (v && !_isUs(v) && !_isLabel(v)) customerCands.push(v);
  }
  // 패턴 3: "㈜A" / "(주)A" / "주식회사 A" 단독 (특이한 회사명 패턴)
  rx = /(?:^|\s|\n)((?:㈜|\(주\)|주식회사)\s*([가-힣A-Za-z][가-힣A-Za-z0-9]{1,20}))/g;
  while ((m = rx.exec(t)) !== null) {
    const v = _cleanCustomer(m[1]);
    if (v && !_isUs(v) && !_isLabel(v)) customerCands.push(v);
  }
  // 패턴 4: "X(주)" / "X㈜" 형식 (회사명이 앞에 오는 경우)
  rx = /(?:^|\s|\n)([가-힣A-Za-z][가-힣A-Za-z0-9]{1,20})(?:㈜|\(주\))/g;
  while ((m = rx.exec(t)) !== null) {
    const v = m[1].trim();
    if (v && !_isUs(v) && !_isLabel(v) && v.length >= 2) customerCands.push(v);
  }
  // 빈도가 높은 후보 우선 (같은 회사가 여러 번 등장하면 그것일 가능성 높음)
  if (customerCands.length > 0) {
    const counts = {};
    customerCands.forEach(c => { counts[c] = (counts[c]||0) + 1; });
    const best = Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
    result.고객사 = best.slice(0, 30);
  }

  // ── 5) 발전소명 / 현장명 / 프로젝트 ──
  //   "현장명 : 세이브 ..." / "프로젝트/현장 : 동호리1호 태양광" / "발전소명: A"
  //   비고에 "크로바3호" 같은 식으로 들어가는 경우도 있음
  const plantPatterns = [
    /(?:프로젝트\s*\/?\s*현장)\s*:?\s*([^\n\r]{2,50})/,
    /현장명\s*:?\s*([^\n\r]{2,50})/,
    /발전소명?\s*:?\s*([^\n\r]{2,50})/,
    /제\s*목\s*:?\s*([^\n\r]{2,80})/    // "제 목 : 인버터 발주서(동호리1호 태양광)"
  ];
  for (const p of plantPatterns) {
    if (m = t.match(p)) {
      let v = m[1].trim();
      // 괄호 안의 현장명만 추출 시도 (예: "인버터 발주서(동호리1호 태양광)" → "동호리1호 태양광")
      const inner = v.match(/\(([^)]+)\)/);
      if (inner) v = inner[1].trim();
      result.발전소명 = v.replace(/[,].*$/, '').slice(0, 50);
      break;
    }
  }
  // fallback: "비고" 컬럼에서 "XX호" 패턴 (예: "크로바3호", "동호리1호")
  if (!result.발전소명) {
    if (m = t.match(/([가-힣]{2,8}\d+호(?:\s*태양광)?)/)) {
      result.발전소명 = m[1].trim();
    }
  }

  // ── 6) 납품주소 / 인도장소 / 입고장소 ──
  const addrPatterns = [
    /납품장소\s*:?\s*([^\n\r]{4,100})/,
    /인도장소\s*:?\s*([^\n\r]{4,100})/,
    /입고장소\s*:?\s*([^\n\r]{4,100})/,
    /납품지\s*:?\s*([^\n\r]{4,100})/,
    /현장주소\s*:?\s*([^\n\r]{4,100})/
  ];
  for (const p of addrPatterns) {
    if (m = t.match(p)) {
      let v = m[1].trim();
      // "/ 인수자" 같은 후속 정보 제거
      v = v.replace(/\s*\/.*$/, '').trim();
      v = v.replace(/\s*(?:인수자|인수담당|결제조건|결제방식|발주일|TEL|전화).*$/, '').trim();
      result.납품주소 = v.slice(0, 100);
      break;
    }
  }

  // ── 7) 결제조건 / 수금조건 ──
  if (m = t.match(/(?:결제조건|수금조건|지불조건|결제방식)\s*:?\s*([^\n\r]{2,150})/)) {
    let v = m[1].trim();
    // 단위 변경 후속 부분 제거
    v = v.replace(/\s*(?:인도조건|납기일자|납품장소|REMARKS|비고).*$/, '').trim();
    result.수금조건 = v.slice(0, 150);
  }

  // ── 8) 모델명 — 다양한 패턴 ──
  const modelPatterns = [
    /\b((?:TSM|JKM|TWN|JAM|JKS|JKB|SPM|YS|HD[_-]HiC|HiC|MG|MEG|NEG|SUN2000)[-_A-Z0-9.]{3,40})/i,
    /\b(SUN2000-\d+[A-Z]{2,4}-?[A-Z0-9.]*)/i,
    /\b(SUN\d{3,5}[A-Z\-_0-9.]*)/i,
    /\b(T\d[A-Z]\d[A-Z])\b/,                                     // T3R7K
    /\b(BR-\d{5,8})\b/
  ];
  for (const p of modelPatterns) {
    if (m = t.match(p)) {
      result.모델명 = m[1].toUpperCase().replace(/[.,]$/, '');
      break;
    }
  }
  // fallback: 한글 제조사 + 모델명 (예: "트리나 715W", "화웨이 SUN2000-110KTL-M2", "HUAWEI 인버터 110KW")
  if (!result.모델명) {
    // 1차: 영문 모델 코드 (대문자+숫자+하이픈)
    if (m = t.match(/(?:^|\n|\s)((?:트리나|진코|JA솔라|한화|화웨이|HUAWEI|솔라엣지)\s+[A-Z][A-Z0-9\-_().]{2,30})/i)) {
      result.모델명 = m[1].trim().replace(/\s+/g,' ').slice(0, 40);
    }
    // 2차: 제조사 + 한글 카테고리 + 용량 (예: "HUAWEI 인버터 110KW")
    else if (m = t.match(/(?:^|\n|\s)((?:트리나|진코|JA솔라|한화|화웨이|HUAWEI|솔라엣지)\s+[가-힣]{2,6}\s+\d+\s*[KkMm]?[WwHh])/)) {
      result.모델명 = m[1].trim().replace(/\s+/g,' ').slice(0, 40);
    }
  }
  // fallback: "품명" 라벨 뒤 첫 단어
  if (!result.모델명 && (m = t.match(/(?:품명|품목명?|제품명)\s*:?\s*([A-Z가-힣][A-Za-z가-힣0-9\-_().]{2,40})/))) {
    result.모델명 = m[1].trim();
  }

  // ── 9) 제품 용량 (W) ──
  if (m = t.match(/(\d{3,4}(?:\.\d+)?)\s*W(?![a-zA-Z])/)) {
    result.제품용량W = m[1];
  }

  // ── 10) 수주용량 (kW) ──
  if (m = t.match(/(\d{2,4}(?:\.\d+)?)\s*kW\b/i)) {
    result.수주용량kW = m[1];
  }

  // ── 11) 수량 ──
  const qtyPatterns = [
    /수량\s*:?\s*(\d{1,5}(?:,\d{3})*)/,
    /(\d{1,5}(?:,\d{3})*)\s*EA\b/,
    /(\d{1,5}(?:,\d{3})*)\s*ea\b/,
    /(\d{1,5}(?:,\d{3})*)\s*개/,
    /합계\s*[:\s]*(\d{1,5})EA/i
  ];
  for (const p of qtyPatterns) {
    if (m = t.match(p)) {
      const v = parseInt(m[1].replace(/,/g,''));
      if (v > 0 && v < 100000) { result.수량 = v; break; }
    }
  }

  // ── 12) VAT 포함 여부 ──
  result.부가세포함 = /부가세\s*포함|VAT\s*포함/i.test(t);
  const vatExcluded = /부가세\s*별도|VAT\s*별도/i.test(t);

  // ── 13) 총액 (합계금액 / 견적금액 / 발주금액) ──
  let totalCand = 0;
  // 패턴 1: 원화기호 + 금액 → 가장 큰 값
  rx = /[₩￦]\s*([\d,]{4,20})/g;
  while ((m = rx.exec(t)) !== null) {
    const v = parseInt(m[1].replace(/,/g,''));
    if (v > totalCand && v < 100000000000) totalCand = v;
  }
  // 패턴 2: "합계금액" 또는 "견적금액" 또는 "발주금액" 라벨 뒤 (가장 큰)
  if (totalCand === 0) {
    rx = /(?:합계금액|견적금액|발주금액|총금액|총\s*액)\s*:?\s*(?:일금[^\d]*)?([\d,]{4,20})/g;
    while ((m = rx.exec(t)) !== null) {
      const v = parseInt(m[1].replace(/,/g,''));
      if (v > totalCand && v < 100000000000) totalCand = v;
    }
  }
  // 패턴 3: "합계" 라벨 뒤
  if (totalCand === 0) {
    rx = /합\s*계\s*:?\s*([\d,]{4,20})/g;
    while ((m = rx.exec(t)) !== null) {
      const v = parseInt(m[1].replace(/,/g,''));
      if (v > totalCand && v < 100000000000) totalCand = v;
    }
  }
  result.총액 = totalCand;

  // ── 14) VAT 추출 ──
  if (m = t.match(/(?:부가세|VAT|세액)\s*(?:\(10%\))?\s*:?\s*([\d,]{3,15})/i)) {
    result.vat = parseInt(m[1].replace(/,/g,'')) || 0;
  }
  // VAT 추정
  if (result.vat === 0 && result.총액 > 0) {
    if (result.부가세포함) {
      // 총액에 VAT 포함 → 공급가액 = 총액 × 10/11, VAT = 총액 × 1/11
      result.vat = Math.round(result.총액 / 11);
    } else if (vatExcluded) {
      result.vat = Math.round(result.총액 * 0.1);
    }
  }
  // 부가세포함이고 vat 가 있으면 → 총액은 그대로
  // 부가세별도이고 총액이 공급가액이면 → 총액 = 공급가액 + VAT 로 보정
  if (vatExcluded && result.vat > 0 && result.총액 > 0) {
    // 별도면 총액 그대로 두고 VAT 추가 — UI 에서 총금액(VAT포함) 따로 계산
  }

  // ── 15) 단가 ──
  if (m = t.match(/단가\s*:?\s*([\d,]{3,15})/)) {
    const v = parseInt(m[1].replace(/,/g,''));
    if (v > 0 && v < 100000000) result.단가 = v;
  }
  // 단가 추정 (총액·수량 있을 때)
  if (result.단가 === 0 && result.총액 > 0 && result.수량 > 0) {
    const supplyAmt = result.부가세포함 ? Math.round(result.총액 * 10/11) : result.총액;
    result.단가 = Math.round(supplyAmt / result.수량);
  }

  // ── 16) 인수담당자 + 전화 ──
  //   "현장 담당자 이건훈 상무 010-3610-7650"
  //   "참조 : 김빛날희호 대표님"
  //   "인수자 전기효 소장 : 010-9236-3611"
  //   "현장 인수담당자 :추후공지"
  //   "현 장 담당자 주식회사 대양이엔지 김종일이사(010-9479-4347)" — "주식회사" 건너뛰고 "김종일" 추출
  const SKIP_NAMES = new Set(['추후공지','상호','담당','발주자','주식회사','발주서','발주','대표이사','대표','결제조건','납품장소','인도조건','납기일자','참조','참고','없음','대양이엔지','글로우에너지','친환경','세이브','한화','진코','트리나','대표님','납품','전','후','이내','출고','출고전','VAT','부가세','보내','받습','드립']);
  // 전화번호 단독 매칭 시도 (인수담당자 라벨 부근)
  const _contactRegion = (() => {
    const labelMatch = t.match(/(?:현장담당자|인수담당자|인수자|현장인수담당자|참조|현장담당)[\s\S]{0,150}/);
    return labelMatch ? labelMatch[0] : '';
  })();
  if (_contactRegion) {
    // 전화번호 추출 (앞에 다른 숫자 없도록 lookbehind)
    const phMatch = _contactRegion.match(/(?<!\d)(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})(?!\d)/);
    if (phMatch) result.인수담당자전화 = `${phMatch[1]}-${phMatch[2]}-${phMatch[3]}`;
    // 이름 추출 — 라벨 이후의 한글 단어 중 SKIP_NAMES 제외 첫 번째
    const namePart = _contactRegion.replace(/^(?:현장담당자|인수담당자|인수자|현장인수담당자|참조|현장담당)\s*:?\s*/, '');
    // 값이 "추후공지" 로 시작하면 즉시 종료 (지정 안 된 상태)
    if (/^\s*추후공지/.test(namePart)) {
      // 인수담당자 비워둠
    } else {
    // 직급 단어 제외
    const TITLES = new Set(['대표','소장','이사','부장','과장','상무','전무','사장','부사장','팀장','실장','수석','책임','선임','대리','주임','사원','반장','차장','회장','대표님','과장님','부장님','이사님','상무님','전무님','대리님','주임님','팀장님','담당']);
    const TITLE_SUFFIX = /(?:이사|부장|과장|상무|전무|대표|소장|사장|팀장|실장|수석|책임|선임|대리|주임|사원|반장|차장|회장)$/;
    const nameTokens = namePart.match(/[가-힣]{2,8}/g) || [];
    for (const tok of nameTokens) {
      if (SKIP_NAMES.has(tok)) continue;
      if (TITLES.has(tok)) continue;
      // 매우 일반적인 회사 접미어
      if (/(?:에너지|코퍼|전기|건설|이엔지|솔라|파워|일렉|테크)$/.test(tok)) continue;
      // 직급 접미사 제거 (예: "김종일이사" → "김종일")
      let name = tok.replace(TITLE_SUFFIX, '').trim();
      if (name.length < 2) name = tok;   // 2자 미만이면 원래 토큰 사용
      // 정리 후에도 너무 짧거나 한자가 섞이면 skip
      if (name.length < 2 || SKIP_NAMES.has(name)) continue;
      result.인수담당자 = name;
      break;
    }
    }   // /추후공지 else
  }
  // 담당자 라벨 fallback
  if (!result.인수담당자 && (m = t.match(/담당자\s*:?\s*([가-힣]{2,5})/))) {
    const nm = m[1];
    if (!SKIP_NAMES.has(nm)) result.인수담당자 = nm;
  }

  // ── 17) 제조사 (모델명에서 추정) ──
  const mfrHints = {
    'TSM': '트리나', 'JKM': '진코솔라', 'JAM': 'JA솔라', 'HiC': '한화큐셀',
    'HD_HiC': '한화큐셀', 'HD-HiC': '한화큐셀', 'SUN2000': '화웨이', 'SUN': '화웨이'
  };
  for (const [pref, mfr] of Object.entries(mfrHints)) {
    if (result.모델명 && result.모델명.toUpperCase().includes(pref.toUpperCase())) {
      result.제조사 = mfr; break;
    }
  }
  // 한글 제조사 직접 매칭
  if (!result.제조사) {
    const koreanMfrs = ['트리나','진코','JA솔라','한화','화웨이','HUAWEI','솔라엣지'];
    for (const k of koreanMfrs) {
      if (t.includes(k)) { result.제조사 = k.toUpperCase()==='HUAWEI' ? '화웨이' : k; break; }
    }
  }

  // ── 18) 총액 fallback (단가·수량 있고 총액 없을 때) ──
  if (result.총액 === 0 && result.단가 > 0 && result.수량 > 0) {
    result.총액 = result.단가 * result.수량;
  }

  return result;
}

// 드래그&드롭 핸들러
function onPoDragOver(e, el) {
  e.preventDefault(); e.stopPropagation();
  if (el) { el.style.background = '#e3f2fd'; el.style.borderColor = '#0d47a1'; }
}
function onPoDragLeave(e, el) {
  if (el) { el.style.background = '#fafbff'; el.style.borderColor = '#1565c0'; }
}
function onPoDrop(e) {
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget;
  if (el) { el.style.background = '#fafbff'; el.style.borderColor = '#1565c0'; }
  const files = [...(e.dataTransfer?.files || [])].filter(f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf');
  if (!files.length) { alert('PDF 파일만 업로드 가능합니다.'); return; }
  _handlePoFiles(files);
}
function onPoFilesSelected(e) {
  const files = [...(e.target.files || [])].filter(f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf');
  e.target.value = '';
  if (!files.length) return;
  _handlePoFiles(files);
}
window.onPoDragOver = onPoDragOver;
window.onPoDragLeave = onPoDragLeave;
window.onPoDrop = onPoDrop;
window.onPoFilesSelected = onPoFilesSelected;

async function _handlePoFiles(files) {
  const preview = document.getElementById('po-preview-area');
  if (preview) {
    preview.style.display = 'block';
    preview.innerHTML = `<div style="background:#fff;padding:14px;border-radius:8px;text-align:center;color:#666;">📄 ${files.length}개 PDF 파싱 중...</div>`;
  }
  const results = [];
  for (const file of files) {
    try {
      const text = await _readPoPdfText(file);
      const parsed = parsePoPdfText(text);
      // 파일 자체도 base64 로 보관 → 등록 시 첨부
      const fileData = await _fileToDataURL(file);
      results.push({ file, fileName: file.name, fileData, parsed, fileSize: file.size });
    } catch (err) {
      console.error('[PO]', file.name, err);
      results.push({ file, fileName: file.name, error: err.message });
    }
  }
  _poParsedQueue = results;
  _renderPoPreview();
}

function _fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function _renderPoPreview() {
  const preview = document.getElementById('po-preview-area');
  if (!preview) return;
  if (_poParsedQueue.length === 0) { preview.style.display = 'none'; preview.innerHTML = ''; return; }
  const _esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-head">
        <h3>발주서 파싱 결과 (${_poParsedQueue.length}건)</h3>
        <div>
          <button class="btn btn-success btn-sm" onclick="if(typeof registerAllPo==='function')registerAllPo()">전체 등록</button>
          <button class="btn btn-outline btn-sm" onclick="if(typeof clearPoQueue==='function')clearPoQueue()">취소</button>
        </div>
      </div>
      <div class="card-body" style="padding:10px;">
        ${_poParsedQueue.map((item, i) => {
          if (item.error) {
            return `<div style="background:#ffebee;padding:10px;border-radius:6px;margin-bottom:8px;">
              <strong>❌ ${_esc(item.fileName)}</strong> — ${_esc(item.error)}
            </div>`;
          }
          const p = item.parsed;
          return `<div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:10px;border-left:4px solid ${p.pjNo?'#27ae60':'#f9a825'};">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong style="color:#0d47a1;">📄 ${_esc(item.fileName)}</strong>
              <span style="font-size:0.78em;color:${p.pjNo?'#27ae60':'#e65100'};font-weight:700;">${p.pjNo?'✓ 인식 OK':'⚠️ PJ NO 미인식 — 수정 필요'}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:0.84em;">
              <div><label style="color:#666;font-size:0.78em;">PJ NO</label><input data-po-i="${i}" data-po-k="pjNo" value="${_esc(p.pjNo)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">고객사</label><input data-po-i="${i}" data-po-k="고객사" value="${_esc(p.고객사)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">발전소명</label><input data-po-i="${i}" data-po-k="발전소명" value="${_esc(p.발전소명)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">모델명</label><input data-po-i="${i}" data-po-k="모델명" value="${_esc(p.모델명)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">수량</label><input type="number" data-po-i="${i}" data-po-k="수량" value="${p.수량||''}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">단가</label><input type="number" data-po-i="${i}" data-po-k="단가" value="${p.단가||''}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">총액</label><input type="number" data-po-i="${i}" data-po-k="총액" value="${p.총액||''}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">수주일</label><input type="date" data-po-i="${i}" data-po-k="수주일" value="${_esc(p.수주일)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div><label style="color:#666;font-size:0.78em;">출고요청일</label><input type="date" data-po-i="${i}" data-po-k="출고요청일" value="${_esc(p.출고요청일)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div style="grid-column:span 3;"><label style="color:#666;font-size:0.78em;">납품주소</label><input data-po-i="${i}" data-po-k="납품주소" value="${_esc(p.납품주소)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
              <div style="grid-column:span 3;"><label style="color:#666;font-size:0.78em;">수금조건</label><input data-po-i="${i}" data-po-k="수금조건" value="${_esc(p.수금조건)}" style="width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"></div>
            </div>
            <div style="margin-top:8px;text-align:right;">
              <button class="btn btn-xs btn-success" onclick="if(typeof registerOnePo==='function')registerOnePo(${i})">이 건 등록</button>
              <button class="btn btn-xs btn-danger" onclick="if(typeof removePoFromQueue==='function')removePoFromQueue(${i})">제외</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  // 입력 동기화
  preview.querySelectorAll('[data-po-i]').forEach(el => {
    el.addEventListener('input', () => {
      const i = parseInt(el.getAttribute('data-po-i'));
      const k = el.getAttribute('data-po-k');
      if (_poParsedQueue[i] && _poParsedQueue[i].parsed) {
        const v = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
        _poParsedQueue[i].parsed[k] = v;
      }
    });
  });
}
window._renderPoPreview = _renderPoPreview;

function clearPoQueue() {
  _poParsedQueue = [];
  _renderPoPreview();
}
window.clearPoQueue = clearPoQueue;

function removePoFromQueue(idx) {
  _poParsedQueue.splice(idx, 1);
  _renderPoPreview();
}
window.removePoFromQueue = removePoFromQueue;

// 한 건 등록
function registerOnePo(idx) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('발주서 → 수주 등록')) return;
  const item = _poParsedQueue[idx];
  if (!item || item.error) { alert('등록할 수 없는 항목입니다.'); return; }
  const p = item.parsed;
  if (!p.pjNo) {
    if (!confirm('PJ NO 가 비어있습니다. 그래도 등록하시겠습니까?')) return;
  }
  const result = _registerPoToRawData(item);
  if (result) {
    _poParsedQueue.splice(idx, 1);
    _renderPoPreview();
    if (typeof setBanner === 'function') setBanner('ok', `✅ 발주서 등록 완료 — PJ NO ${result.pjNo || '(없음)'}`);
    if (typeof renderOrders === 'function') renderOrders();
  }
}
window.registerOnePo = registerOnePo;

// 전체 등록
function registerAllPo() {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('발주서 → 수주 등록')) return;
  const valid = _poParsedQueue.filter(i => !i.error);
  if (valid.length === 0) { alert('등록 가능한 발주서가 없습니다.'); return; }
  if (!confirm(`${valid.length}건의 발주서를 수주현황에 등록하시겠습니까?`)) return;
  let n = 0;
  valid.forEach(item => { if (_registerPoToRawData(item)) n++; });
  _poParsedQueue = [];
  _renderPoPreview();
  if (typeof setBanner === 'function') setBanner('ok', `✅ 발주서 ${n}건 등록 완료`);
  if (typeof renderOrders === 'function') renderOrders();
  if (typeof renderDashboard === 'function') renderDashboard();
  renderPoList();
}
window.registerAllPo = registerAllPo;

// rawData 에 등록
function _registerPoToRawData(item) {
  if (typeof rawData === 'undefined') { alert('rawData 가 로드되지 않았습니다.'); return null; }
  const p = item.parsed;
  const newId = (typeof genId === 'function') ? genId() : ('R-' + Date.now() + '-' + Math.random().toString(36).slice(2,5));
  const newRow = {
    _id: newId,
    '담당자': '',
    'PJ NO': p.pjNo || ('PO-' + Date.now().toString().slice(-6)),
    '수주일': p.수주일 || (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10)),
    '고객사': p.고객사 || '',
    '제품군': '',
    '제조사': p.제조사 || '',
    '매입NO': '',
    '모델명': p.모델명 || '',
    '제품용량(W)': p.제품용량W || '',
    '수량': p.수량 || 0,
    '수주용량(kW)': p.수주용량kW || '',
    '제품단가(원)': p.단가 || 0,
    '수주총액(원)': p.총액 || 0,
    '총금액(VAT포함)': p.총액 ? (p.총액 + (p.vat || Math.round(p.총액 * 0.1))) : 0,
    '매입사': p.매입사 || '',
    '매입단가': 0,
    '매입총액(원)': 0,
    '영업이익(원)': 0,
    '영업이익률(%)': 0,
    '출고요청일': p.출고요청일 || '',
    '발주서': item.fileName || '',
    '허가증': '', 'FD성적서': '', '인증서': '', '사용전검사일정': '',
    '발전소명': p.발전소명 || '',
    '납품주소': p.납품주소 || '',
    '인수담당자': p.인수담당자 || '',
    '비고': '발주서 PDF 자동 등록' + (p.인수담당자전화 ? ' · 담당전화 ' + p.인수담당자전화 : ''),
    '수금조건': p.수금조건 || ''
  };
  rawData.push(newRow);
  // 발주서 파일 첨부 (filesData) — nested 구조
  if (item.fileData) {
    if (typeof filesData === 'undefined') window.filesData = {};
    if (!filesData[newId]) filesData[newId] = {};
    filesData[newId]['발주서'] = { name: item.fileName, data: item.fileData, mimeType: 'application/pdf' };
    try { localStorage.setItem('erp_files', JSON.stringify(filesData)); } catch(e) {}
  }
  // 수금조건 자동 비율 반영
  if (p.수금조건 && p.총액 > 0 && typeof parsePayTerms === 'function') {
    const parsed = parsePayTerms(p.수금조건);
    if (typeof localMeta !== 'undefined') {
      if (!localMeta[newId]) localMeta[newId] = {};
      localMeta[newId].수금조건 = p.수금조건;
      const map = { deposit:'계약금', mid1:'중도금1', mid2:'중도금2', mid3:'중도금3', balance:'잔금' };
      Object.entries(map).forEach(([k, key]) => {
        if (parsed[k] != null) localMeta[newId][key] = Math.round(p.총액 * parsed[k] / 100);
      });
    }
  }
  // PO 메타 저장 (po 탭 목록용)
  if (typeof localMeta !== 'undefined') {
    if (!localMeta[newId]) localMeta[newId] = {};
    localMeta[newId]._poImported = {
      at: new Date().toISOString(),
      fileName: item.fileName,
      fileSize: item.fileSize || 0
    };
  }
  try { localStorage.setItem('erp_raw', JSON.stringify(rawData)); } catch(e) {}
  if (typeof saveLocal === 'function') saveLocal();
  if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  return { id: newId, pjNo: newRow['PJ NO'] };
}

// 등록된 발주서 목록 (rawData 중 _poImported 메타가 있는 건)
function renderPoList() {
  const area = document.getElementById('po-list-area');
  const cnt = document.getElementById('po-list-count');
  if (!area) return;
  const orders = (typeof getEnriched === 'function') ? getEnriched() : [];
  const poList = orders.filter(o => {
    const meta = (typeof localMeta !== 'undefined') ? (localMeta[o._id] || {}) : {};
    return meta._poImported;
  }).sort((a,b) => {
    const ma = (localMeta[a._id]?._poImported?.at) || '';
    const mb = (localMeta[b._id]?._poImported?.at) || '';
    return mb.localeCompare(ma);
  });
  if (cnt) cnt.textContent = `${poList.length}건`;
  if (poList.length === 0) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-title">등록된 발주서가 없습니다</div><div class="empty-state-desc">위 영역에 PDF 를 드래그하여 자동 등록하세요.</div></div>';
    return;
  }
  const _esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));
  const _fmt = (typeof fmt === 'function') ? fmt : (n => Number(n||0).toLocaleString());
  area.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>등록일시</th><th>PJ NO</th><th>고객사</th><th>발전소명</th><th>모델</th>
          <th class="num">수량</th><th class="num">총액</th>
          <th>발주서 PDF</th>
        </tr></thead>
        <tbody>${poList.map(o => {
          const meta = localMeta[o._id]?._poImported || {};
          const at = (meta.at || '').slice(0,16).replace('T',' ');
          const fileEntry = (typeof getFileEntry === 'function') ? getFileEntry(o._id, '발주서') : null;
          return `<tr>
            <td style="font-size:0.82em;color:#888;">${_esc(at)}</td>
            <td><a href="#" onclick="if(typeof openOrderDetail==='function')openOrderDetail('${o._id}');return false;" style="color:#1565c0;font-weight:700;">${_esc(o.pjNo)}</a></td>
            <td>${_esc(o.고객사||'-')}</td>
            <td style="font-size:0.82em;color:#666;">${_esc(o.발전소명||'-')}</td>
            <td style="font-size:0.82em;">${_esc(o.모델명||'-')}</td>
            <td class="num">${_fmt(o.수량||0)}매</td>
            <td class="num" style="font-weight:700;color:#e65100;">${_fmt(o.수주총액||0)}원</td>
            <td>${fileEntry ? `<span style="background:#e8f5e9;color:#2e7d32;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:0.82em;font-weight:600;" onclick="if(typeof downloadFile==='function')downloadFile('${o._id}','발주서')" title="${_esc(fileEntry.name)}">📎 ${_esc(meta.fileName||'PDF')}</span>` : '<span style="color:#bbb;">-</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}
window.renderPoList = renderPoList;

// =====================================================
//  사용전검사 (영업 → 사용전검사 서브탭)
//  - 일자(사용전검사일정)에 맞춰 입회 일정 관리
//  - 각 수주에 입회 상태(planned/attended/passed/failed) + 입회자·메모 기록
//  - 상태/메모는 localMeta 에 저장 (rawData 의 사용전검사일정 보존)
// =====================================================
function renderInspectionTab() {
  const tableEl = document.getElementById('inspectionTableArea');
  const statsEl = document.getElementById('inspectionStats');
  if (!tableEl) return;
  const search   = (document.getElementById('insp-search')?.value || '').toLowerCase().trim();
  const periodF  = document.getElementById('insp-period')?.value || 'upcoming';
  const statusF  = document.getElementById('insp-status-f')?.value || '';

  const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
  const orders = (typeof getEnriched === 'function') ? getEnriched() : (typeof rawData !== 'undefined' ? rawData : []);

  // localMeta 에서 입회 상태 / 입회자 / 메모 / 결과 조회
  const _meta = (id) => (typeof localMeta !== 'undefined' && localMeta[id]) ? (localMeta[id]._insp || {}) : {};
  const _setMeta = (id, patch) => {
    if (typeof localMeta === 'undefined') return;
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id]._insp = { ...(localMeta[id]._insp || {}), ...patch };
    if (typeof saveLocal === 'function') saveLocal();
  };

  // 모든 수주를 사용전검사 데이터로 매핑
  const all = orders.map(o => {
    const insp = _meta(o._id);
    return {
      _id: o._id, pjNo: o.pjNo, 고객사: o.고객사, 모델명: o.모델명, 발전소명: o.발전소명, 납품주소: o.납품주소,
      담당자: o.담당자, 수량: o.수량,
      date: o.사용전검사 || insp.date || '',   // 사용전검사일정
      status: insp.status || (o.사용전검사 ? 'planned' : 'unscheduled'),
      attendee: insp.attendee || '',
      memo: insp.memo || '',
      result: insp.result || ''
    };
  });

  // D-Day 계산
  const _dday = (d) => {
    if (!d) return null;
    try {
      const diff = Math.round((new Date(d) - new Date(today)) / 86400000);
      return diff;
    } catch (e) { return null; }
  };

  // 검색 + 기간 + 상태 필터
  let rows = all.filter(r => {
    if (search) {
      const hay = [r.pjNo, r.고객사, r.발전소명, r.납품주소].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (statusF && r.status !== statusF) return false;
    const d = r.date;
    if (periodF === 'upcoming') return d && d >= today;
    if (periodF === 'today')    return d === today;
    if (periodF === 'past')     return d && d < today;
    if (periodF === 'unscheduled') return !d;
    if (periodF === 'this-week') {
      if (!d) return false;
      const now = new Date(today);
      const day = now.getDay();
      const start = new Date(now); start.setDate(now.getDate() - day);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const sStr = start.toISOString().slice(0,10);
      const eStr = end.toISOString().slice(0,10);
      return d >= sStr && d <= eStr;
    }
    if (periodF === 'this-month') {
      if (!d) return false;
      return d.slice(0,7) === today.slice(0,7);
    }
    return true; // all
  });

  // 통계
  const total = all.length;
  const planned   = all.filter(r => r.status === 'planned').length;
  const attended  = all.filter(r => r.status === 'attended' || r.status === 'passed' || r.status === 'failed').length;
  const passed    = all.filter(r => r.status === 'passed').length;
  const unscheduled = all.filter(r => !r.date).length;
  const upcoming7 = all.filter(r => r.date && r.date >= today && _dday(r.date) <= 7).length;
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat s-blue"><div class="stat-lbl">총 수주</div><div class="stat-val">${total}</div></div>
      <div class="stat s-orange"><div class="stat-lbl">7일 내 입회</div><div class="stat-val" style="color:#e65100;">${upcoming7}</div></div>
      <div class="stat"><div class="stat-lbl">예정</div><div class="stat-val">${planned}</div></div>
      <div class="stat s-green"><div class="stat-lbl">합격</div><div class="stat-val" style="color:#27ae60;">${passed}</div></div>
      <div class="stat"><div class="stat-lbl">입회 완료</div><div class="stat-val">${attended}</div></div>
      <div class="stat"><div class="stat-lbl">미정</div><div class="stat-val" style="color:#aaa;">${unscheduled}</div></div>
    `;
  }

  if (rows.length === 0) {
    tableEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">조건에 맞는 사용전검사 없음</div></div>`;
    return;
  }

  // 일자 오름차순 (미정은 맨 아래)
  rows.sort((a,b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // 일자별 그룹핑
  const groupMap = {};
  rows.forEach(r => {
    const key = r.date || '_unscheduled';
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(r);
  });
  const groupKeys = Object.keys(groupMap).sort((a,b) => {
    if (a === '_unscheduled') return 1;
    if (b === '_unscheduled') return -1;
    return a.localeCompare(b);
  });

  // 상태 → 한글 라벨
  const STATUS_LABEL = { planned:'예정', attended:'입회 완료', passed:'합격', failed:'불합격', unscheduled:'미정' };
  const STATUS_COLOR = { planned:'#1565c0', attended:'#7b1fa2', passed:'#27ae60', failed:'#c62828', unscheduled:'#aaa' };
  const _ddayLabel = (d) => {
    if (!d) return '';
    const v = _dday(d);
    if (v === null) return '';
    if (v === 0) return `<span style="background:#c62828;color:#fff;padding:2px 8px;border-radius:10px;font-weight:800;font-size:0.78em;">D-DAY</span>`;
    if (v < 0)   return `<span style="background:#5d4037;color:#fff;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.78em;">D+${-v}</span>`;
    if (v <= 3)  return `<span style="background:#e65100;color:#fff;padding:2px 8px;border-radius:10px;font-weight:800;font-size:0.78em;">D-${v}</span>`;
    if (v <= 7)  return `<span style="background:#f9a825;color:#fff;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.78em;">D-${v}</span>`;
    return `<span style="background:#1565c0;color:#fff;padding:2px 8px;border-radius:10px;font-weight:600;font-size:0.78em;">D-${v}</span>`;
  };

  tableEl.innerHTML = `
    <div style="font-size:0.82em;color:#888;margin:8px 0;">총 ${rows.length}건 — 일자별 그룹</div>
    ${groupKeys.map(key => {
      const items = groupMap[key];
      const dateLabel = key === '_unscheduled' ? '일정 미정' : key;
      const dday = key === '_unscheduled' ? '' : _ddayLabel(key);
      return `
        <div style="background:#f8f9fa;border-left:4px solid ${key==='_unscheduled'?'#aaa':'#1565c0'};border-radius:8px;padding:10px 14px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <strong style="font-size:1.05em;color:#1a1a2e;">${dateLabel}</strong>
            ${dday}
            <span style="color:#888;font-size:0.82em;">${items.length}건 입회 예정</span>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;font-size:0.84em;">
            <thead><tr style="background:#1a1a2e;color:#fff;">
              <th style="padding:6px 8px;text-align:left;">PJ NO</th>
              <th style="padding:6px 8px;text-align:left;">고객사</th>
              <th style="padding:6px 8px;text-align:left;">발전소명</th>
              <th style="padding:6px 8px;text-align:left;">모델</th>
              <th style="padding:6px 8px;text-align:left;">입회자</th>
              <th style="padding:6px 8px;text-align:center;">상태</th>
              <th style="padding:6px 8px;text-align:center;">작업</th>
            </tr></thead>
            <tbody>${items.map(r => `<tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:5px 8px;"><a href="#" onclick="if(typeof openOrderDetail==='function')openOrderDetail('${r._id}');return false;" style="color:#1565c0;font-weight:700;">${r.pjNo||'-'}</a></td>
              <td style="padding:5px 8px;">${r.고객사||'-'}</td>
              <td style="padding:5px 8px;color:#666;">${r.발전소명||'-'}</td>
              <td style="padding:5px 8px;font-size:0.82em;">${r.모델명||'-'}</td>
              <td style="padding:5px 8px;">${r.attendee || '<span style="color:#bbb;">미지정</span>'}</td>
              <td style="padding:5px 8px;text-align:center;"><span style="background:${STATUS_COLOR[r.status]||'#aaa'};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.78em;font-weight:700;">${STATUS_LABEL[r.status]||r.status}</span></td>
              <td style="padding:5px 8px;text-align:center;white-space:nowrap;">
                <button class="btn btn-xs btn-dark" onclick="openInspectionEdit('${r._id}')" title="입회 정보 수정">수정</button>
              </td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `;
    }).join('')}
  `;
}
window.renderInspectionTab = renderInspectionTab;

// 사용전검사 입회 정보 편집 — prompt 시리즈
function openInspectionEdit(id) {
  const row = (typeof rawData !== 'undefined') ? rawData.find(r => r._id === id) : null;
  if (!row) { alert('수주를 찾을 수 없습니다.'); return; }
  const meta = (typeof localMeta !== 'undefined' && localMeta[id]) ? (localMeta[id]._insp || {}) : {};
  // 1) 일자
  const curDate = row['사용전검사일정'] || meta.date || '';
  const newDate = prompt('사용전검사 일자 (YYYY-MM-DD, 빈 값 = 미정):', curDate);
  if (newDate === null) return;
  // 2) 입회자
  const newAttendee = prompt('입회자 이름:', meta.attendee || '');
  if (newAttendee === null) return;
  // 3) 상태
  const statusOpts = '1. 예정 (planned)\n2. 입회 완료 (attended)\n3. 합격 (passed)\n4. 불합격 (failed)';
  const curStatusNum = ({ planned:'1', attended:'2', passed:'3', failed:'4' })[meta.status || 'planned'] || '1';
  const stSel = prompt(`상태 선택:\n${statusOpts}\n\n번호 입력 (1~4):`, curStatusNum);
  if (stSel === null) return;
  const STATUS_MAP = { '1':'planned','2':'attended','3':'passed','4':'failed' };
  const newStatus = STATUS_MAP[stSel.trim()] || meta.status || 'planned';
  // 4) 메모 (선택)
  const newMemo = prompt('메모 (선택):', meta.memo || '');
  // 저장
  if (newDate.trim()) {
    row['사용전검사일정'] = newDate.trim();
    try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e) {}
  }
  if (typeof localMeta === 'undefined') window.localMeta = {};
  if (!localMeta[id]) localMeta[id] = {};
  localMeta[id]._insp = {
    date: newDate.trim(),
    attendee: newAttendee.trim(),
    status: newStatus,
    memo: newMemo === null ? (meta.memo || '') : newMemo.trim()
  };
  if (typeof saveLocal === 'function') saveLocal();
  if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  if (typeof setBanner === 'function') setBanner('ok', `✅ ${row['PJ NO']||id} 사용전검사 정보 업데이트`);
  renderInspectionTab();
}
window.openInspectionEdit = openInspectionEdit;

// =====================================================
//  서류 관리 (영업 → 서류 관리 서브탭)
//  rawData(수주) 의 발주서·허가증·FD성적서·인증서·사용전검사 첨부 현황
// =====================================================
function renderDocsTab() {
  const tableEl = document.getElementById('docsTableArea');
  const statsEl = document.getElementById('docsStats');
  if (!tableEl) return;
  const search = (document.getElementById('docs-search')?.value || '').toLowerCase().trim();
  const typeF  = document.getElementById('docs-type-f')?.value || '';
  const hasF   = document.getElementById('docs-has-f')?.value || '';

  const orders = (typeof getEnriched === 'function') ? getEnriched() : (typeof rawData !== 'undefined' ? rawData : []);
  // ★ 사용전검사는 별도 탭(setSalesOpsSubtab('inspection')) 으로 분리됨 (2026-05-12)
  const DOC_TYPES = ['발주서','허가증','FD성적서','인증서'];

  // 검색 필터
  let rows = orders.filter(o => {
    if (!search) return true;
    const hay = [o.pjNo, o.고객사, o.모델명, o.발전소명].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(search);
  });
  // 서류 유형 필터 — 표시 컬럼 제한 + 파일 유무 필터 매칭
  const showTypes = typeF ? [typeF] : DOC_TYPES;

  // ★ 파일 유무 검사 — nested(filesData[id][type]) + flat(filesData[id+'|'+type]) 둘 다 지원
  const _getFile = (rowId, type) => {
    if (typeof getFileEntry === 'function') return getFileEntry(rowId, type);
    if (typeof filesData === 'undefined') return null;
    const n = filesData[rowId] && filesData[rowId][type];
    if (n && n.data) return n;
    const f = filesData[rowId + '|' + type];
    if (f && f.data) return f;
    return null;
  };
  const _hasFile = (rowId, type) => !!_getFile(rowId, type);
  const _hasText = (o, type) => !!(o[type] && String(o[type]).trim());

  if (hasF === 'yes') {
    rows = rows.filter(o => showTypes.some(t => _hasFile(o._id, t)));
  } else if (hasF === 'no') {
    rows = rows.filter(o => showTypes.every(t => !_hasFile(o._id, t)));
  }

  // 통계 (전체 수주 기준, 검색 무시 — 매트릭스 전체 보기용)
  const totalOrders = orders.length;
  const counts = {};
  DOC_TYPES.forEach(t => {
    counts[t] = orders.reduce((s,o) => s + (_hasFile(o._id, t) ? 1 : 0), 0);
  });
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat s-blue"><div class="stat-lbl">총 수주</div><div class="stat-val">${totalOrders}</div><div class="stat-sub">건</div></div>
      ${DOC_TYPES.map((t,i) => {
        const pct = totalOrders > 0 ? Math.round(counts[t]/totalOrders*100) : 0;
        const cls = pct>=80?'s-green':pct>=50?'s-orange':'s-blue';
        return `<div class="stat ${cls}"><div class="stat-lbl">${t}</div><div class="stat-val">${counts[t]}</div><div class="stat-sub">${pct}% (${totalOrders}건 중)</div></div>`;
      }).join('')}
    `;
  }

  if (rows.length === 0) {
    tableEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">조건에 맞는 수주가 없습니다</div></div>`;
    return;
  }

  // 셀 렌더링 — ★ 2026-05-13 파일 첨부 시 텍스트 중복 표시 제거 (파일명만 표시)
  const _esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s||''));
  const _trunc = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
  const _cell = (o, type) => {
    const fileEntry = _getFile(o._id, type);
    const has = !!fileEntry;
    const txt = _hasText(o, type) ? String(o[type]).trim() : '';
    const fname = (fileEntry && fileEntry.name) ? fileEntry.name : '';

    if (!has && !txt) {
      return `<span style="color:#bbb;font-size:0.78em;">미등록</span>`;
    }

    // 파일이 있으면 → 파일명 태그만 (자료 본문 중복 표시 제거)
    if (has) {
      const displayName = fname || type;
      return `<span style="display:inline-block;padding:3px 8px;background:#e8f5e9;color:#2e7d32;border-radius:5px;cursor:pointer;font-size:0.82em;font-weight:600;" onclick="if(typeof downloadFile==='function')downloadFile('${o._id}','${type}')" title="${_esc(displayName)} — 클릭=다운로드">📎 ${_esc(_trunc(displayName, 22))}</span>`;
    }
    // 파일이 없고 텍스트만 있으면 → 텍스트 표시 (발급일·번호·메모)
    return `<div style="font-size:0.84em;color:#1565c0;font-weight:600;text-align:left;" title="${_esc(txt)}">${_esc(_trunc(txt, 40))}</div>`;
  };

  tableEl.innerHTML = `
    <div style="font-size:0.82em;color:#888;margin:8px 0;">총 ${rows.length}건 표시</div>
    <div class="tbl-wrap" style="max-height:560px;overflow:auto;">
      <table>
        <thead><tr style="position:sticky;top:0;background:#1a1a2e;color:#fff;z-index:1;">
          <th>PJ NO</th>
          <th>고객사</th>
          <th>모델</th>
          <th>발전소명</th>
          <th class="num">수량</th>
          ${showTypes.map(t => `<th>${t}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map(o => `<tr>
          <td><a href="#" onclick="if(typeof openOrderDetail==='function')openOrderDetail('${o._id}');return false;" style="color:#1565c0;font-weight:700;">${o.pjNo||'-'}</a></td>
          <td style="font-size:0.86em;">${o.고객사||'-'}</td>
          <td style="font-size:0.82em;">${o.모델명||'-'}</td>
          <td style="font-size:0.82em;color:#666;">${o.발전소명||'-'}</td>
          <td class="num" style="font-weight:700;">${(typeof fmt==='function'?fmt(o.수량||0):(o.수량||0))}매</td>
          ${showTypes.map(t => `<td style="vertical-align:top;padding:6px 8px;min-width:150px;">${_cell(o,t)}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}
window.renderDocsTab = renderDocsTab;

function populateSalesFilters() {
  const orders = getEnriched();
  const el = document.getElementById('sp-manager');
  const cur = el.value;
  el.innerHTML = '<option value="">전체</option>' + [...new Set(orders.map(o=>o.담당자).filter(Boolean))].sort().map(m=>`<option>${m}</option>`).join('');
  el.value = cur;
}

function renderSalesPerf() {
  const periodEl = document.getElementById('sp-period');
  const period = periodEl ? periodEl.value : 'all';
  const spFrom = document.getElementById('sp-from');
  const spTo = document.getElementById('sp-to');
  // Show/hide custom date inputs (toolbar-section)
  const showCustom = period === 'custom';
  if (spFrom && spFrom.parentElement) spFrom.parentElement.style.display = showCustom ? 'flex' : 'none';

  const manager = (document.getElementById('sp-manager')?.value) || '';
  let orders = getEnriched();
  if (manager) orders = orders.filter(o => o.담당자 === manager);

  // Filter by period — 'all' (기본) 이면 필터 안 함
  const thisYear = String((typeof getThisYear === 'function') ? getThisYear() : new Date().getFullYear());
  const thisM = (typeof getThisMonth === 'function') ? getThisMonth() : new Date().toISOString().slice(0,7);
  const qMonths = (typeof getThisQuarterMonths === 'function') ? getThisQuarterMonths() : [];

  if (period==='month') orders = orders.filter(o => o.수주일 && o.수주일.startsWith(thisM));
  else if (period==='quarter') orders = orders.filter(o => o.수주일 && qMonths.some(m => o.수주일.startsWith(m)));
  else if (period==='year') orders = orders.filter(o => o.수주일 && o.수주일.startsWith(thisYear));
  else if (period==='custom') {
    const f = (spFrom && spFrom.value) || '', t = (spTo && spTo.value) || '';
    if (f) orders = orders.filter(o => o.수주일 >= f);
    if (t) orders = orders.filter(o => o.수주일 <= t);
  }
  // 'all' — 필터 적용 안 함 (전체 수주 표시)

  const totalRev = orders.reduce((s,o)=>s+o.수주총액,0);
  const totalProfit = orders.reduce((s,o)=>s+o.영업이익,0);
  const avgRate = totalRev>0?(totalProfit/totalRev*100).toFixed(1):0;
  const totalQty = orders.reduce((s,o)=>s+o.수량,0);

  document.getElementById('salesStats').innerHTML = `
    <div class="stat s-blue"><div class="stat-lbl">수주 건수</div><div class="stat-val">${orders.length}</div></div>
    <div class="stat s-green"><div class="stat-lbl">수주 총액</div><div class="stat-val">${fmtM(totalRev)}</div></div>
    <div class="stat s-purple"><div class="stat-lbl">영업이익</div><div class="stat-val">${fmtM(totalProfit)}</div></div>
    <div class="stat"><div class="stat-lbl">평균 이익률</div><div class="stat-val">${avgRate}%</div></div>
    <div class="stat s-orange"><div class="stat-lbl">총 수량(매)</div><div class="stat-val">${fmt(totalQty)}</div></div>
  `;

  // By manager (채권 회수/미수 포함)
  const mMap = {};
  orders.forEach(o => {
    if (!mMap[o.담당자]) mMap[o.담당자]={cnt:0,rev:0,profit:0,collected:0};
    const bucket = mMap[o.담당자];
    bucket.cnt++; bucket.rev+=o.수주총액; bucket.profit+=o.영업이익;
    // 수금액 = 입금된 계약금 + 중도금 + 잔금
    const c = (o.계약금입금?(o.계약금||0):0)
            + (o.중도금1입금?(o.중도금1||0):0)
            + (o.중도금2입금?(o.중도금2||0):0)
            + (o.중도금3입금?(o.중도금3||0):0)
            + (o.잔금입금?(o.잔금||0):0);
    bucket.collected += c;
  });
  const mRows = Object.entries(mMap).sort((a,b)=>b[1].rev-a[1].rev);
  document.getElementById('salesByManager').innerHTML = mRows.length ?
    `<div class="tbl-wrap"><table><thead><tr><th>담당자</th><th>건수</th><th>수주총액</th><th>영업이익</th><th>이익률</th><th>채권회수</th><th>채권미수</th></tr></thead>
    <tbody>${mRows.map(([m,d],i)=>{
      const outstand = Math.max(0, d.rev - d.collected);
      const pct = d.rev>0 ? (d.collected/d.rev*100).toFixed(1) : 0;
      return `<tr>
      <td><span style="background:#1a1a2e;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:0.7em;margin-right:6px;">${i+1}</span><strong>${m}</strong></td>
      <td>${d.cnt}</td><td style="text-align:right;">${fmt(d.rev)}</td>
      <td style="text-align:right;color:#27ae60;font-weight:700;">${fmt(d.profit)}</td>
      <td style="text-align:right;">${d.rev>0?(d.profit/d.rev*100).toFixed(1):0}%</td>
      <td style="text-align:right;color:#2e7d32;font-weight:700;">${fmt(d.collected)}<br><span style="font-size:0.72em;font-weight:400;color:#888;">${pct}%</span></td>
      <td style="text-align:right;color:${outstand>0?'#e65100':'#388e3c'};font-weight:700;">${fmt(outstand)}</td>
    </tr>`;}).join('')}</tbody></table></div>` : '<div class="empty">데이터 없음</div>';

  // By product with detail
  const pMap = {};
  const pDetailMap = {};
  orders.forEach(o => {
    const pg = o.제품군 || '미분류';
    if (!pMap[pg]) pMap[pg]={cnt:0,rev:0,profit:0};
    pMap[pg].cnt++; pMap[pg].rev+=o.수주총액; pMap[pg].profit+=o.영업이익;
    if (!pDetailMap[pg]) pDetailMap[pg]=[];
    pDetailMap[pg].push(o);
  });
  const pRows = Object.entries(pMap).sort((a,b)=>b[1].rev-a[1].rev);
  document.getElementById('salesByProduct').innerHTML = pRows.length ?
    `<div class="tbl-wrap"><table>
      <thead><tr><th>제품군</th><th>건수</th><th>수주총액</th><th>영업이익</th><th>이익률</th><th>비중</th><th style="width:36px;"></th></tr></thead>
      <tbody>
      ${pRows.map(([p,d],i)=>`
        <tr style="cursor:pointer;" onclick="toggleProdDetail(${i})">
          <td><span class="tag">${p}</span></td>
          <td>${d.cnt}</td>
          <td style="text-align:right;">${fmt(d.rev)}</td>
          <td style="text-align:right;color:#27ae60;font-weight:700;">${fmt(d.profit)}</td>
          <td style="text-align:right;">${d.rev>0?(d.profit/d.rev*100).toFixed(1):0}%</td>
          <td><div style="background:#f0f0f0;border-radius:4px;overflow:hidden;margin-bottom:2px;"><div style="background:#1a1a2e;height:12px;width:${totalRev>0?(d.rev/totalRev*100).toFixed(0):0}%;"></div></div>
            <span style="font-size:0.75em;">${totalRev>0?(d.rev/totalRev*100).toFixed(1):0}%</span></td>
          <td><button class="btn btn-xs btn-outline" id="pdbtn-${i}" style="padding:2px 6px;">▼</button></td>
        </tr>
        <tr id="pdrow-${i}" style="display:none;background:#fafbff;">
          <td colspan="7" style="padding:0;">
            <div style="padding:10px 14px;">
              <table style="width:100%;font-size:0.8em;border-collapse:collapse;">
                <thead><tr style="border-bottom:2px solid #eee;">
                  <th style="padding:5px 8px;text-align:left;font-weight:700;color:#555;">PJ NO</th>
                  <th style="padding:5px 8px;text-align:left;font-weight:700;color:#555;">고객사</th>
                  <th style="padding:5px 8px;text-align:left;font-weight:700;color:#555;">모델명</th>
                  <th style="padding:5px 8px;text-align:right;font-weight:700;color:#555;">수량</th>
                  <th style="padding:5px 8px;text-align:right;font-weight:700;color:#555;">수주총액</th>
                  <th style="padding:5px 8px;text-align:right;font-weight:700;color:#555;">영업이익</th>
                  <th style="padding:5px 8px;text-align:right;font-weight:700;color:#555;">이익률</th>
                  <th style="padding:5px 8px;font-weight:700;color:#555;">상태</th>
                </tr></thead>
                <tbody>
                  ${(pDetailMap[p]||[]).sort((a,b)=>b.수주총액-a.수주총액).map(o=>`
                    <tr style="border-bottom:1px solid #f0f0f0;" onclick="openOrderDetail('${o._id}');event.stopPropagation();" >
                      <td style="padding:5px 8px;font-weight:700;color:#1a1a2e;cursor:pointer;" title="클릭 → 수주상세">${o.pjNo}</td>
                      <td style="padding:5px 8px;">${o.고객사||'-'}</td>
                      <td style="padding:5px 8px;color:#555;">${o.모델명||'-'}</td>
                      <td style="padding:5px 8px;text-align:right;">${fmt(o.수량)}</td>
                      <td style="padding:5px 8px;text-align:right;">${fmt(o.수주총액)}</td>
                      <td style="padding:5px 8px;text-align:right;color:#27ae60;">${fmt(o.영업이익)}</td>
                      <td style="padding:5px 8px;text-align:right;">${o.수주총액>0?(o.영업이익/o.수주총액*100).toFixed(1):0}%</td>
                      <td style="padding:5px 8px;">${statusBadge(o.status)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      `).join('')}
      </tbody>
    </table></div>` : '<div class="empty">데이터 없음</div>';

  // ───────────────────────────────────────────────────
  // 기간별 비교 그래프 — 월별 매출·이익 막대 비교 (vertical bar chart)
  // ───────────────────────────────────────────────────
  (function renderPeriodCompareChart(){
    const host = document.getElementById('salesMonthly');
    if (!host) return;
    // 월별 집계
    const monthMap = {};
    orders.forEach(o => {
      const m = (o.수주일 || '').slice(0,7);
      if (!m) return;
      if (!monthMap[m]) monthMap[m] = { m, rev:0, profit:0, cnt:0, qty:0 };
      monthMap[m].rev    += Number(o.수주총액||0);
      monthMap[m].profit += Number(o.영업이익||0);
      monthMap[m].qty    += Number(o.수량||0);
      monthMap[m].cnt    += 1;
    });
    const monthList = Object.values(monthMap).sort((a,b)=>a.m.localeCompare(b.m)).slice(-12);   // 최근 12개월

    if (!monthList.length) {
      host.innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:#aaa;">📅 분석할 데이터가 없습니다</div>';
      return;
    }

    const maxRev = Math.max(...monthList.map(d=>d.rev), 1);
    const chartH = 220;  // 차트 영역 높이 (px)

    let html = `<div style="padding:10px 4px;">
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-end;height:${chartH+50}px;">
        ${monthList.map(d => {
          const revH = Math.round((d.rev / maxRev) * chartH);
          const profH = d.rev > 0 ? Math.round((d.profit / maxRev) * chartH) : 0;
          const profRate = d.rev > 0 ? (d.profit/d.rev*100) : 0;
          return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" title="${d.m} · ${d.cnt}건 · 매출 ${fmtM(d.rev)} · 이익 ${fmtM(d.profit)} (${profRate.toFixed(1)}%)">
            <!-- 금액 라벨 (바 위) -->
            <div style="font-size:0.72em;color:#1565c0;font-weight:700;line-height:1.1;text-align:center;">${fmtM(d.rev)}</div>
            <!-- 두 막대 (매출 + 이익) -->
            <div style="display:flex;gap:3px;align-items:flex-end;height:${chartH}px;">
              <div style="width:18px;height:${revH}px;background:linear-gradient(180deg,#3498db,#1565c0);border-radius:4px 4px 0 0;box-shadow:0 -2px 6px rgba(21,101,192,0.18);transition:height 0.5s;" title="매출 ${fmtM(d.rev)}"></div>
              <div style="width:18px;height:${profH}px;background:linear-gradient(180deg,#2ecc71,#27ae60);border-radius:4px 4px 0 0;box-shadow:0 -2px 6px rgba(39,174,96,0.18);transition:height 0.5s;" title="이익 ${fmtM(d.profit)}"></div>
            </div>
            <!-- X축 라벨 -->
            <div style="font-size:0.74em;color:#555;font-weight:700;line-height:1.2;text-align:center;white-space:nowrap;">${d.m.slice(2)}<br><span style="color:#999;font-weight:400;font-size:0.92em;">${d.cnt}건</span></div>
          </div>`;
        }).join('')}
      </div>
      <!-- 범례 -->
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #eef0f4;display:flex;gap:18px;justify-content:center;font-size:0.8em;color:#555;flex-wrap:wrap;">
        <span><span style="display:inline-block;width:14px;height:12px;background:linear-gradient(180deg,#3498db,#1565c0);border-radius:3px;vertical-align:middle;margin-right:5px;"></span>📊 매출</span>
        <span><span style="display:inline-block;width:14px;height:12px;background:linear-gradient(180deg,#2ecc71,#27ae60);border-radius:3px;vertical-align:middle;margin-right:5px;"></span>📈 이익</span>
      </div>
      <!-- 요약 통계 -->
      <div style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font-size:0.82em;">
        <div style="background:#f8fafd;padding:8px 12px;border-radius:8px;border-left:3px solid #1565c0;">
          <div style="color:#888;font-size:0.85em;">월평균 매출</div>
          <div style="font-weight:800;color:#1565c0;">${fmtM(monthList.reduce((s,d)=>s+d.rev,0)/monthList.length)}</div>
        </div>
        <div style="background:#f8fdfa;padding:8px 12px;border-radius:8px;border-left:3px solid #27ae60;">
          <div style="color:#888;font-size:0.85em;">월평균 이익</div>
          <div style="font-weight:800;color:#27ae60;">${fmtM(monthList.reduce((s,d)=>s+d.profit,0)/monthList.length)}</div>
        </div>
        <div style="background:#fffaf0;padding:8px 12px;border-radius:8px;border-left:3px solid #e67e22;">
          <div style="color:#888;font-size:0.85em;">최고 매출 월</div>
          <div style="font-weight:800;color:#e67e22;">${monthList.reduce((b,d)=>d.rev>b.rev?d:b,monthList[0]).m}</div>
        </div>
        <div style="background:#fbf8ff;padding:8px 12px;border-radius:8px;border-left:3px solid #8e44ad;">
          <div style="color:#888;font-size:0.85em;">집계 기간</div>
          <div style="font-weight:800;color:#8e44ad;">${monthList.length}개월</div>
        </div>
      </div>
    </div>`;
    host.innerHTML = html;
  })();

  // ───────────────────────────────────────────────────
  // 기존 담당자별 막대차트 — salesMonthly에서 별도 영역으로 이동
  // ───────────────────────────────────────────────────
  // (담당자별 차트는 salesByManager 카드 또는 별도 영역에 표시되어야 함, 여기선 비활성)
  // 호환성: 기존 코드는 그대로 두고 출력만 무시되도록 unused var 처리
  const _legacyManagerChart = `<!-- legacy unused -->`;
  if (false) {
  const barColors = ['#2c6fad','#27ae60','#e67e22','#8e44ad','#c0392b','#16a085','#d35400','#455a64'];
  const totalMProfit = mRows.reduce((s,[,d])=>s + Math.max(0,d.profit), 0) || 1;
  const _legacy = mRows.length ?
    `<div style="padding:8px 4px;">
      <div style="display:grid;grid-template-columns:120px 1fr auto;gap:6px;align-items:center;font-size:0.72em;font-weight:800;color:#666;text-transform:uppercase;padding:0 4px;margin-bottom:10px;">
        <span>담당자</span><span>이익 기여도 · 이익률 · 채권 회수율</span><span>건수·수주</span>
      </div>
      ${mRows.map(([m,d],i)=>{
        const contribPct = Math.max(0, d.profit) / totalMProfit * 100;
        const profitRate = d.rev>0 ? (d.profit/d.rev*100) : 0;
        const collectedPct = d.rev>0 ? (d.collected/d.rev*100) : 0;
        const barColor = barColors[i%barColors.length];
        const labelText = `${fmtM(d.profit)} · 이익률 ${profitRate.toFixed(1)}%`;
        // 바 길이가 30% 미만이면 라벨을 바 오른쪽 바깥에 어두운 색으로 배치
        const labelInside = contribPct >= 30;
        const labelHtml = labelInside
          ? `<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:0.76em;font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.35);">${labelText}</span>`
          : `<span style="position:absolute;left:calc(${contribPct.toFixed(2)}% + 8px);top:50%;transform:translateY(-50%);font-size:0.76em;font-weight:800;color:#1a1a2e;white-space:nowrap;">${labelText}</span>`;
        // 이익률/채권률 작은 바는 0%일 때도 최소 1px 표시
        const prW = profitRate   > 0 ? Math.max(1, Math.min(profitRate,   100)).toFixed(1) : 0;
        const cpW = collectedPct > 0 ? Math.max(1, Math.min(collectedPct, 100)).toFixed(1) : 0;
        return `
        <div style="display:grid;grid-template-columns:120px 1fr auto;gap:8px;align-items:center;margin-bottom:18px;">
          <div style="font-weight:800;font-size:0.9em;color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m||'미지정'}</div>
          <div>
            <!-- 이익 기여도 바 -->
            <div style="position:relative;background:#eef2f7;border:1px solid #dfe6ee;border-radius:6px;height:24px;">
              <div style="background:${barColor};height:100%;width:${contribPct.toFixed(2)}%;border-radius:5px;transition:width 0.5s;box-shadow:inset 0 -1px 0 rgba(0,0,0,0.08);"></div>
              ${labelHtml}
            </div>
            <!-- 이익률 바 (테두리 추가 → 0%여도 위치 확인 가능) -->
            <div style="position:relative;background:#f1faf3;border:1px solid #cfe9d6;border-radius:4px;height:8px;margin-top:4px;overflow:hidden;" title="이익률 ${profitRate.toFixed(1)}%">
              <div style="background:#27ae60;height:100%;width:${prW}%;"></div>
            </div>
            <!-- 채권 회수율 바 -->
            <div style="position:relative;background:#fff8e1;border:1px solid #ffe0a3;border-radius:4px;height:8px;margin-top:4px;overflow:hidden;" title="채권 회수율 ${collectedPct.toFixed(1)}%">
              <div style="background:${collectedPct>=100?'#2e7d32':'#ef6c00'};height:100%;width:${cpW}%;"></div>
            </div>
          </div>
          <div style="font-size:0.78em;color:#555;white-space:nowrap;text-align:right;line-height:1.5;">
            <span style="color:#333;font-weight:700;">${d.cnt}건</span><br>
            <span style="color:#1565c0;font-weight:800;">${fmtM(d.rev)}</span><br>
            <span style="color:${collectedPct>=100?'#2e7d32':'#ef6c00'};font-weight:800;">채권 ${collectedPct.toFixed(0)}%</span>
          </div>
        </div>`;
      }).join('')}
      <div style="margin-top:12px;padding-top:10px;border-top:2px solid #eee;display:flex;gap:20px;font-size:0.78em;color:#555;flex-wrap:wrap;">
        <span><span style="display:inline-block;width:14px;height:10px;background:#2c6fad;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>이익 기여도 (전체이익 대비 %)</span>
        <span><span style="display:inline-block;width:14px;height:10px;background:#27ae60;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>이익률</span>
        <span><span style="display:inline-block;width:14px;height:10px;background:#ef6c00;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>채권 회수율</span>
      </div>
    </div>` : '<div class="empty">데이터 없음</div>';
  }
  // end legacy block

  // Detail table
  const tbody = document.getElementById('salesDetailTbody');
  tbody.innerHTML = orders.length ? orders.sort((a,b)=>(b.수주일||'').localeCompare(a.수주일||'')).map(o=>`<tr>
    <td><a href="#" onclick="openOrderDetail('${o._id}');return false;" style="color:#1a1a2e;font-weight:700;" title="클릭 → 수주상세">${o.pjNo}</a></td>
    <td>${o.담당자}</td><td>${dateKo(o.수주일)}</td><td>${o.고객사}</td>
    <td style="font-size:0.82em;">${o.모델명}</td><td style="text-align:right;">${fmt(o.수량)}</td>
    <td style="text-align:right;">${fmt(o.수주총액)}</td>
    <td style="text-align:right;color:#27ae60;font-weight:700;">${fmt(o.영업이익)}</td>
    <td style="text-align:right;">${o.영업이익률}%</td>
    <td>${dateKo(o.출고요청일)||'-'}</td>
    <td>${statusBadge(o.status)}</td>
  </tr>`).join('') : `<tr><td colspan="11" class="empty">데이터 없음</td></tr>`;

  // 채권 관리
  renderSalesReceivables(orders);
}

// =====================================================
//  채권 관리 (영업담당자별 미수금 현황)
// =====================================================
function renderSalesReceivables(orders) {
  const el = document.getElementById('salesReceivables');
  if (!el) return;

  // 수금완료 제외 — 미수금이 있을 수 있는 건만
  const target = orders.filter(o => o.status !== '취소' && o.status !== '출고취소');

  if (!target.length) {
    el.innerHTML = '<div class="empty">해당 기간 데이터 없음</div>';
    return;
  }

  // 담당자별 집계
  const mMap = {};
  target.forEach(o => {
    const m = o.담당자 || '미지정';
    if (!mMap[m]) mMap[m] = { orders:[], totalRev:0, collected:0 };
    mMap[m].orders.push(o);
    mMap[m].totalRev += o.수주총액;
    // 수금액 = 입금된 계약금 + 중도금1~3 + 잔금
    const c = (o.계약금입금 ? (o.계약금||0) : 0)
            + (o.중도금1입금 ? (o.중도금1||0) : 0)
            + (o.중도금2입금 ? (o.중도금2||0) : 0)
            + (o.중도금3입금 ? (o.중도금3||0) : 0)
            + (o.잔금입금 ? (o.잔금||0) : 0);
    mMap[m].collected += c;
  });

  const grandRev       = Object.values(mMap).reduce((s,v)=>s+v.totalRev,0);
  const grandCollected = Object.values(mMap).reduce((s,v)=>s+v.collected,0);
  const grandOutstand  = grandRev - grandCollected;

  // 전체 요약 통계
  let html = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px;">
      <div style="background:#e3f2fd;border-radius:10px;padding:14px 16px;">
        <div style="font-size:0.75em;color:#888;margin-bottom:4px;">총 매출채권</div>
        <div style="font-size:1.3em;font-weight:900;color:#1565c0;">${fmtM(grandRev)}</div>
      </div>
      <div style="background:#e8f5e9;border-radius:10px;padding:14px 16px;">
        <div style="font-size:0.75em;color:#888;margin-bottom:4px;">수금 완료</div>
        <div style="font-size:1.3em;font-weight:900;color:#2e7d32;">${fmtM(grandCollected)}</div>
      </div>
      <div style="background:${grandOutstand>0?'#fff3e0':'#f1f8e9'};border-radius:10px;padding:14px 16px;">
        <div style="font-size:0.75em;color:#888;margin-bottom:4px;">미수금</div>
        <div style="font-size:1.3em;font-weight:900;color:${grandOutstand>0?'#e65100':'#388e3c'};">${fmtM(grandOutstand)}</div>
      </div>
    </div>`;

  // 담당자별 상세
  const managers = Object.entries(mMap).sort((a,b)=>b[1].totalRev-a[1].totalRev);
  managers.forEach(([mgr, data], idx) => {
    const outstanding = data.totalRev - data.collected;
    const pct = data.totalRev > 0 ? Math.min(100, Math.round(data.collected / data.totalRev * 100)) : 0;
    const unpaidOrders = data.orders.filter(o =>
      o.status !== '수금완료' && !(o.계약금입금 && o.잔금입금)
    );

    html += `
      <div style="border:1px solid #e8ecf0;border-radius:10px;margin-bottom:14px;overflow:hidden;">
        <!-- 담당자 헤더 -->
        <div style="background:#f8f9fa;padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;"
             onclick="toggleRcvDetail(${idx})">
          <div style="flex:1;">
            <span style="font-weight:800;font-size:0.95em;">${mgr}</span>
            <span style="font-size:0.78em;color:#888;margin-left:8px;">${data.orders.length}건 / 수주총액 ${fmtM(data.totalRev)}</span>
          </div>
          <div style="display:flex;gap:16px;align-items:center;">
            <div style="text-align:right;">
              <div style="font-size:0.7em;color:#888;">수금</div>
              <div style="font-weight:800;color:#2e7d32;">${fmtM(data.collected)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.7em;color:#888;">미수금</div>
              <div style="font-weight:800;color:${outstanding>0?'#e65100':'#388e3c'};">${fmtM(outstanding)}</div>
            </div>
            <div style="width:80px;">
              <div style="background:#e0e0e0;border-radius:4px;height:8px;overflow:hidden;">
                <div style="background:${pct>=100?'#43a047':'#1565c0'};height:8px;width:${pct}%;border-radius:4px;"></div>
              </div>
              <div style="font-size:0.7em;color:#888;text-align:right;margin-top:2px;">${pct}% 수금</div>
            </div>
            <button class="btn btn-xs btn-outline" id="rcvbtn-${idx}">▼</button>
          </div>
        </div>
        <!-- 수주별 상세 (접기/펼치기) -->
        <div id="rcvrow-${idx}" style="display:none;">
          <div style="padding:0 0 8px;">
            <table style="width:100%;border-collapse:collapse;font-size:0.82em;">
              <thead>
                <tr style="background:#f0f4ff;">
                  <th style="padding:7px 10px;text-align:left;">PJ NO</th>
                  <th style="padding:7px 10px;text-align:left;">고객사</th>
                  <th style="padding:7px 10px;text-align:left;">수주일</th>
                  <th style="padding:7px 10px;text-align:right;">수주총액</th>
                  <th style="padding:7px 10px;text-align:center;">결제 현황</th>
                  <th style="padding:7px 10px;text-align:center;">수금상태</th>
                  <th style="padding:7px 10px;text-align:center;">수주상태</th>
                </tr>
              </thead>
              <tbody>
              ${data.orders.sort((a,b)=>(b.수주일||'').localeCompare(a.수주일||'')).map(o => {
                const payItems = [
                  { label:'계약금', amt:o.계약금, paid:o.계약금입금 },
                  { label:'중도금1', amt:o.중도금1, paid:o.중도금1입금 },
                  { label:'중도금2', amt:o.중도금2, paid:o.중도금2입금 },
                  { label:'중도금3', amt:o.중도금3, paid:o.중도금3입금 },
                  { label:'잔금', amt:o.잔금, paid:o.잔금입금 },
                ].filter(p => p.amt > 0);
                const payHtml = payItems.length
                  ? payItems.map(p => p.paid
                      ? `<span class="tag green" style="font-size:0.72em;margin:1px;">✅${p.label} ${fmtM(p.amt)}</span>`
                      : `<span class="tag red" style="font-size:0.72em;margin:1px;">❌${p.label} ${fmtM(p.amt)}</span>`
                    ).join('')
                  : '<span style="color:#bbb;font-size:0.75em;">미설정</span>';
                const collectedAmt = (o.계약금입금?(o.계약금||0):0)
                  + (o.중도금1입금?(o.중도금1||0):0)
                  + (o.중도금2입금?(o.중도금2||0):0)
                  + (o.중도금3입금?(o.중도금3||0):0)
                  + (o.잔금입금?(o.잔금||0):0);
                const outstandAmt  = o.수주총액 - collectedAmt;
                const rcvTag = o.status==='수금완료'
                  ? '<span class="tag green" style="font-size:0.75em;">수금완료</span>'
                  : outstandAmt <= 0
                    ? '<span class="tag green" style="font-size:0.75em;">수금완료</span>'
                    : collectedAmt > 0
                      ? `<span class="tag" style="font-size:0.75em;background:#fff8e1;color:#f57f17;">부분수금 (미수 ${fmtM(outstandAmt)})</span>`
                      : `<span class="tag red" style="font-size:0.75em;">미수 ${fmtM(outstandAmt)}</span>`;
                return `<tr style="border-bottom:1px solid #f0f0f0;cursor:pointer;" onclick="openOrderDetail('${o._id}')">
                  <td style="padding:7px 10px;font-weight:700;color:#1a1a2e;">${o.pjNo}</td>
                  <td style="padding:7px 10px;">${o.고객사||'-'}</td>
                  <td style="padding:7px 10px;color:#888;">${dateKo(o.수주일)||'-'}</td>
                  <td style="padding:7px 10px;text-align:right;font-weight:700;">${fmt(o.수주총액)}</td>
                  <td style="padding:7px 10px;">${payHtml}</td>
                  <td style="padding:7px 10px;text-align:center;">${rcvTag}</td>
                  <td style="padding:7px 10px;text-align:center;">${statusBadge(o.status)}</td>
                </tr>`;
              }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  });

  el.innerHTML = html;
}

function toggleRcvDetail(i) {
  const row = document.getElementById('rcvrow-' + i);
  const btn = document.getElementById('rcvbtn-' + i);
  if (!row) return;
  const open = row.style.display === 'none';
  row.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? '▲' : '▼';
}

function toggleProdDetail(i) {
  const row = document.getElementById('pdrow-' + i);
  const btn = document.getElementById('pdbtn-' + i);
  if (!row) return;
  const open = row.style.display === 'none';
  row.style.display = open ? 'table-row' : 'none';
  if (btn) btn.textContent = open ? '▲' : '▼';
}
