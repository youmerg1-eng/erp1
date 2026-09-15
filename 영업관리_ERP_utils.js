// =====================================================
//  PERMISSION FLAGS — 수정 권한 (canEdit)
//  ★ 2026-05-13 erpAuth 의 역할(role) 기반 시스템과 통합
//   - 현재 역할의 effective.edit 플래그를 우선 사용
//   - erpAuth 미로드 시 fallback: localStorage 'erp_perm_canEdit' (기본 true)
//   - 토글 위치: 설정 → 사용자 권한 (5단계) → 시스템 관리자 영역 → 추가 권한 플래그 → 수정 권한 컬럼
// =====================================================
const _PERM_KEY = 'erp_perm_canEdit';
function canEdit() {
  // 1순위: erpAuth 의 역할 기반 권한
  try {
    if (typeof erpAuth !== 'undefined' && typeof erpAuth.effective === 'function' && typeof erpAuth.getRole === 'function') {
      const eff = erpAuth.effective(erpAuth.getRole());
      if (eff && typeof eff.edit === 'boolean') return eff.edit;
    }
  } catch(e) {}
  // 2순위: 구 localStorage 플래그 (호환성 유지)
  try {
    const v = localStorage.getItem(_PERM_KEY);
    return v === null ? true : v === 'true';
  } catch(e) { return true; }
}
function savePermEdit(checked) {
  try { localStorage.setItem(_PERM_KEY, checked ? 'true' : 'false'); } catch(e) {}
  if (typeof setBanner === 'function') {
    setBanner('ok', checked ? '✅ 수정 권한 활성 — 모든 데이터 수정 가능' : '🔒 수정 권한 비활성 — 읽기 전용 모드');
  }
  // 권한 변경 시 현재 보이는 화면 갱신 (수정 버튼 표시/숨김 반영)
  if (typeof renderOrders === 'function') try { renderOrders(); } catch(e) {}
  if (typeof renderDashboard === 'function') try { renderDashboard(); } catch(e) {}
  if (typeof renderInventory === 'function') try { renderInventory(); } catch(e) {}
}
// 수정 작업 차단 가드 — 수정 시도 시 호출 → 차단됐으면 true 반환
function blockIfReadOnly(actionName) {
  if (canEdit()) return false;
  let curRole = '';
  try {
    if (typeof erpAuth !== 'undefined') {
      const r = erpAuth.getRole();
      const meta = erpAuth.list()[r] || {};
      curRole = `${meta.icon||''} ${meta.lbl||r}`;
    }
  } catch(e) {}
  const where = curRole ? `현재 역할: ${curRole}\n\n[설정 → 사용자 권한 → 시스템 관리자 → 추가 권한 플래그] 에서 "수정 권한" 을 부여하거나, 역할을 변경하세요.` : `[설정 → 사용자 권한 → 시스템 관리자] 에서 권한을 부여하세요.`;
  const msg = `🔒 수정 권한이 없습니다.\n${actionName || '이 작업'}을(를) 수행할 수 없습니다.\n\n${where}`;
  if (typeof setBanner === 'function') setBanner('warn', `🔒 수정 권한 필요 — ${curRole || '권한 부여 필요'}`);
  else alert(msg);
  return true;
}
window.canEdit = canEdit;
window.savePermEdit = savePermEdit;
window.blockIfReadOnly = blockIfReadOnly;

// =====================================================
//  DATA HELPERS
// =====================================================
//  ★ 2026-05 추가: getEnriched 결과 메모이제이션
//   - 한 화면 렌더에 여러 모듈이 getEnriched()를 ~12회 호출 → 매번 전체 배열 재구축
//   - 1000+ 행에서 체감 가능한 lag 발생
//   - 캐시 키 = (rawData.length, _enrichedTs) — 데이터 변경 시 _enrichedTs 갱신으로 무효화
//   - 변경 감지: saveLocal 호출 시 _enrichedTs를 새로 찍음
let _enrichedCache = null;
let _enrichedCacheKey = '';
let _enrichedTs = 0;
function _bumpEnrichedTs() { _enrichedTs = Date.now(); _enrichedCache = null; _enrichedCacheKey = ''; }
window._bumpEnrichedTs = _bumpEnrichedTs;

function _computeEnriched() {
  return rawData.map(row => {
    const pj = String(row['PJ NO'] || row[1] || '').trim();
    const id = row._id || '';
    const meta = localMeta[id] || {};
    const 출고요청일str = normalizeDate(row['출고요청일'] || row['요청납기'] || row[C.출고요청일] || '');
    const autoSt = '수주';
    return {
      _id: id,
      담당자: s(row,'담당자'), pjNo: pj, 수주일: normalizeDate(s(row,'수주일')),
      고객사: s(row,'고객사'), 제품군: s(row,'제품군'), 제조사: s(row,'제조사'),
      매입No: s(row,'매입NO'), 모델명: s(row,'모델명'), 제품용량: s(row,'제품용량(W)'),
      수량: n(row,'수량'), 수주용량kW: s(row,'수주용량(kW)'),
      제품단가: n(row,'제품단가(원)'), 수주총액: n(row,'수주총액(원)'),
      총금액VAT: n(row,'총금액(VAT포함)'), 매입사: s(row,'매입사'),
      매입단가: n(row,'매입단가'), 매입총액: n(row,'매입총액(원)'),
      영업이익: n(row,'영업이익(원)'), 영업이익률: n(row,'영업이익률(%)'),
      출고요청일: 출고요청일str,
      발주서: Object.prototype.hasOwnProperty.call(meta, '발주서') ? meta.발주서 : s(row,'발주서'),
      허가증: s(row,'허가증'), FD성적서: s(row,'FD성적서'),
      인증서: s(row,'인증서'), 사용전검사: s(row,'사용전검사일정'),
      발전소명: s(row,'발전소명'), 납품주소: s(row,'납품주소'),
      // AB(27)=인수담당자, AC(28)=비고/요청사항, AD(29)=수금조건
      // 기존 호환: raw '추가정보' 필드도 인수담당자로 fallback (구 버전 데이터)
      인수담당자: s(row,'인수담당자') || meta.인수담당자 || s(row,'추가정보') || '',
      요청사항: s(row,'비고') || meta.요청사항 || '',
      수금조건: s(row,'수금조건') || meta.수금조건 || '',
      // 배차정보(추가정보) — meta에만 저장됨 (과거 호환용 raw 값은 인수담당자로 이동)
      추가정보: meta.배차정보 || '',
      납품일: normalizeDate(s(row,'납품일')),
      계약금: meta.계약금 || 0,
      계약금입금: meta.계약금입금 || false,
      중도금1: meta.중도금1 || 0,
      중도금1입금: meta.중도금1입금 || false,
      중도금2: meta.중도금2 || 0,
      중도금2입금: meta.중도금2입금 || false,
      중도금3: meta.중도금3 || 0,
      중도금3입금: meta.중도금3입금 || false,
      잔금: meta.잔금 || 0,
      잔금입금: meta.잔금입금 || false,
      출고가능: !!(meta.계약금입금),
      status: meta.status || autoSt,
      notes: meta.notes || '',
      deliveryOrderId: meta.deliveryOrderId || null,
      _raw: row
    };
  }).filter(o => o.pjNo);
}

function getEnriched() {
  // 캐시 키 = rawData.length + _enrichedTs + localMeta 크기 변화 감지
  // (메타 키 추가/삭제도 캐시 무효화 트리거)
  const key = `${rawData.length}|${_enrichedTs}|${Object.keys(localMeta).length}`;
  if (_enrichedCache && _enrichedCacheKey === key) {
    return _enrichedCache;
  }
  _enrichedCache = _computeEnriched();
  _enrichedCacheKey = key;
  return _enrichedCache;
}

function s(row, key) {
  const v = row[key];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}
function n(row, key) {
  const v = row[key];
  if (v === undefined || v === null || v === '') return 0;
  return parseFloat(String(v).replace(/,/g,'')) || 0;
}

function normalizeDate(v) {
  if (!v) return '';
  const sv = String(v).trim();
  if (!sv || sv === '0' || sv === '-') return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(sv)) return sv;
  // YY-MM-DD or YY.MM.DD → 2026-MM-DD
  const m1 = sv.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{2})$/);
  if (m1) return `20${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')}`;
  // YY-M-D
  const m2 = sv.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m2) return `20${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
  // YYYY.MM.DD
  const m3 = sv.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m3) return `${m3[1]}-${m3[2].padStart(2,'0')}-${m3[3].padStart(2,'0')}`;
  // ★ 2026-05 추가: M/D 또는 M.D (단축 형식, "1/29", "12.5") → 현재 연도 가정
  //   엑셀 "요청 납기" 컬럼이 종종 M/D로 표기되어 월별 필터에서 누락되는 문제 해결.
  const m4 = sv.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (m4) {
    const month = parseInt(m4[1]);
    const day = parseInt(m4[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  // ★ 2026-05 추가: YYYY-M-D (한 자리 월/일) → 패딩 보정
  const m5 = sv.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m5) return `${m5[1]}-${m5[2].padStart(2,'0')}-${m5[3].padStart(2,'0')}`;
  // ★ 2026-05 추가: 한국식 "26년 4월 24일" / "2026년 4월 24일" → ISO
  const m6 = sv.match(/^(\d{2,4})년\s*(\d{1,2})월\s*(\d{1,2})일?$/);
  if (m6) {
    const yr = m6[1].length === 4 ? m6[1] : '20' + m6[1];
    return `${yr}-${m6[2].padStart(2,'0')}-${m6[3].padStart(2,'0')}`;
  }
  // 미인식 — console.warn 로 디버깅 정보 (silent fail 방지)
  if (typeof console !== 'undefined') {
    console.warn('[normalizeDate] 미인식 날짜 형식:', JSON.stringify(sv));
  }
  return sv;
}

function todayStr() { return new Date().toISOString().slice(0,10); }
function fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }

// =====================================================
//  HTML escape — XSS 차단 (innerHTML 보간 시 필수)
//  사용자 입력(고객사·발전소명·메모 등)을 innerHTML 에 포함할 때 호출.
//  변환: < > & " ' / `  → 엔티티
// =====================================================
const _ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '/':'&#x2F;', '`':'&#x60;' };
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"'`\/]/g, ch => _ESC_MAP[ch]);
}
// 속성 보간 전용 — 따옴표·앰퍼샌드 escape (속성 안에서는 < > 는 위험도 낮음)
function escapeAttr(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&"']/g, ch => _ESC_MAP[ch]);
}
// 전역 노출
window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
// fmtM: <1억=만원, ≥1억=억원 으로 자동 단위 전환
function fmtM(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 100000000) {     // 1억 이상 — 억원 단위 (소수 1자리)
    const eok = v / 100000000;
    return (Math.round(eok * 10) / 10).toLocaleString() + '억원';
  }
  // 1억 미만 — 만원 단위 (정수)
  return Math.round(v / 10000).toLocaleString() + '만원';
}

// ★ 2026-05 추가: 한국식 큰 금액 포매터 — 천만 이상이면 "X.X억원"
//   < 1,000만 (10,000,000)  : "1,234,567원"
//   1천만 ~ 1억              : "0.10억원" ~ "0.99억원" (소수 2자리)
//   1억 ~ 100억              : "1.5억원"  ~ "99.9억원"  (소수 1자리)
//   100억 이상               : "1,234억원" (정수)
function fmtKrAmt(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs < 10000000) return v.toLocaleString('ko-KR') + '원';
  const eok = v / 100000000;
  if (Math.abs(eok) >= 100) return Math.round(eok).toLocaleString() + '억원';
  if (Math.abs(eok) >= 1)   return eok.toFixed(1) + '억원';
  return eok.toFixed(2) + '억원';
}
window.fmtKrAmt = fmtKrAmt;

function dateKo(s) { if (!s) return '-'; const p = s.split('-'); return p.length===3 ? p[0].slice(2)+'.'+p[1]+'.'+p[2] : s; }

// =====================================================
//  CSV / 엑셀 다운로드 헬퍼 (한글 깨짐 방지)
//  문제: Excel(Windows)은 UTF-8 자동감지 안 함 → BOM 없는 UTF-8 CSV
//        를 시스템 코드페이지(CP949)로 해석해 한글이 깨짐.
//  해결: 다운로드 직전에 UTF-8 BOM(﻿) 을 본문 앞에 prepend.
//  부가: CRLF 강제 (Excel 호환), Blob.type 명시.
// =====================================================
const CSV_BOM = '﻿';   // UTF-8 BOM

// 셀 값 1개를 CSV 안전 문자열로 escape — 콤마·줄바꿈·따옴표 포함 시 큰따옴표로 감쌈
function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// 2D 배열을 CSV 문자열로 변환 — Excel 호환 CRLF 줄바꿈
function csvJoin(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

// 다운로드 — 한글 파일명도 안전하게 처리
function downloadCsv(filename, content) {
  const safeName = String(filename || 'export.csv').replace(/[\\/:*?"<>|]/g, '_');
  // 본문 앞에 BOM 추가 (이미 있으면 중복 방지)
  const body = content.startsWith(CSV_BOM) ? content : CSV_BOM + content;
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch(e) {} }, 200);
}

// 노출 — 콘솔/외부 모듈에서 활용
window.csvCell = csvCell;
window.csvJoin = csvJoin;
window.downloadCsv = downloadCsv;

function statusBadge(st) {
  const map = { '수주':'b-수주','납품완료':'b-납품완료','수금완료':'b-수금완료','취소':'b-취소','출고취소':'b-출고취소' };
  return `<span class="badge ${map[st]||'b-수주'}">${st||'수주'}</span>`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(todayStr())) / 86400000);
}

// D-day 표시용: 출고요청일 전날을 D-0(D-Day)로 표시 (준비 완료 기준)
//   출고요청일 5/8 → 5/7=D-Day · 5/6=D-1 · 5/8=D+1
//   { diff: 표시용 일수, label: 'D-Day'/'D-N'/'D+N', cls: 색상 클래스 }
function dDayLabel(dateStr) {
  const raw = daysUntil(dateStr);
  if (raw == null) return { diff: null, label: '', cls: '' };
  const diff = raw - 1;   // 출고 전날 = 0
  const label = diff < 0 ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`;
  const cls = diff < 0 ? 'b-취소' : diff <= 1 ? 'b-warn' : diff <= 3 ? 'b-info' : 'b-info';
  return { diff, label, cls };
}

function getThisMonth() { const d = new Date(); return d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0'); }
function getThisYear() { return new Date().getFullYear(); }
function getThisQuarterMonths() {
  const m = new Date().getMonth();
  const q = Math.floor(m/3)*3;
  return [q,q+1,q+2].map(i => new Date().getFullYear()+'-'+(i+1).toString().padStart(2,'0'));
}

// =====================================================
//  TAB MANAGEMENT
// =====================================================
function showTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('onclick') === `showTab('${id}')`) b.classList.add('active');
  });
  document.getElementById('tab-'+id).classList.add('active');
  // Refresh
  if (id==='dashboard') renderDashboard();
  if (id==='orders') { if (typeof runAutoDirectComplete === 'function') runAutoDirectComplete(); populateOrderFilters(); renderOrders(); if (calViewActive) renderOrderCalendar(); }
  if (id==='shipment') { populateShipmentFilters(); renderShipment(); if (typeof renderPendingInbound === 'function') renderPendingInbound(); else if (typeof renderInventory === 'function') renderInventory(); if (typeof renderOutboundHistory === 'function') renderOutboundHistory(); }
  if (id==='stock') renderStockTab();
  if (id==='delivery') showDeliveryList();
  if (id==='splitdelivery') renderSplitTab();
  if (id==='inventory') renderInventory();
  if (id==='sales') { populateSalesFilters(); renderSalesPerf(); }
  if (id==='salesops') {
    // 영업 탭 첫 진입 시 기본 견적서관리 서브탭 마운트
    if (typeof setSalesOpsSubtab === 'function') setSalesOpsSubtab('quote');
  }
  if (id==='fr') { if (typeof renderFrTab === 'function') renderFrTab(); }
  if (id==='settings') { renderProductMasterTable(); if (typeof renderSettingsTab === 'function') renderSettingsTab(); }
}

function refreshAllTabs() {
  renderDashboard();
}

// =====================================================
//  UI HELPERS
// =====================================================
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setBanner(type, msg) {
  const colors = { ok:'#1e4d2b', warn:'#4d3000', err:'#4d0d0d', info:'#1a1a2e' };
  const textColors = { ok:'#a8f0b8', warn:'#ffd280', err:'#ffaaaa', info:'#aabbff' };
  let toast = document.getElementById('erp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'erp-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:0.84em;font-weight:600;max-width:420px;box-shadow:0 6px 24px rgba(0,0,0,0.3);transition:opacity 0.4s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.style.background = colors[type] || colors.info;
  toast.style.color = textColors[type] || textColors.info;
  toast.style.opacity = '1';
  toast.textContent = msg;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

function showInlineMsg(id, msg, type) {
  const el = document.getElementById(id); if (!el) return;
  const cls = { ok:'alert-ok', warn:'alert-warn', danger:'alert-danger', info:'alert-info' }[type]||'alert-info';
  el.innerHTML = `<div class="alert ${cls}">${msg}</div>`;
}

// =====================================================
//  FILE UPLOAD
// =====================================================
function handleFileDrop(event, fieldName) {
  event.preventDefault();
  event.currentTarget.classList.remove('dg-over');
  const file = event.dataTransfer.files[0];
  if (file) uploadFile(file, fieldName);
}
function handleFileSelect(event, fieldName) {
  const file = event.target.files[0];
  if (file) uploadFile(file, fieldName);
}
function uploadFile(file, fieldName) {
  if (file.size > 10 * 1024 * 1024) { alert('파일 크기는 10MB 이하여야 합니다.'); return; }
  const rowId = document.getElementById('em-row-id')?.value;
  if (!rowId) { alert('먼저 수주를 저장하거나 수정 모드로 열어주세요.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    filesData[rowId + '|' + fieldName] = { name: file.name, type: file.type, data: e.target.result };
    try { localStorage.setItem('erp_files', JSON.stringify(filesData)); } catch(e) {}
    updateFileDisplay(fieldName);
  };
  reader.readAsDataURL(file);
}
function updateFileDisplay(fieldName) {
  const rowId = document.getElementById('em-row-id')?.value || '';
  const fi = filesData[rowId + '|' + fieldName];
  const el = document.getElementById('fd-' + fieldName);
  if (!el) return;
  if (fi) {
    el.classList.add('has-file');
    el.innerHTML = `<span class="fd-label">✅ ${fi.name}</span><button onclick="deleteFile('${fieldName}');event.stopPropagation();" style="background:none;border:none;cursor:pointer;color:#c62828;font-size:0.9em;margin-left:4px;">✕</button>`;
  } else {
    el.classList.remove('has-file');
    el.innerHTML = '<span class="fd-label">📎 클릭/드래그하여 파일 등록</span>';
  }
}
function updateAllFileDisplays() {
  ['발주서','허가증','FD성적서','인증서'].forEach(f => updateFileDisplay(f));
}
function deleteFile(fieldName) {
  const rowId = document.getElementById('em-row-id')?.value || '';
  delete filesData[rowId + '|' + fieldName];
  try { localStorage.setItem('erp_files', JSON.stringify(filesData)); } catch(e) {}
  updateFileDisplay(fieldName);
}
// ★ 2026-05-12 통합: 파일 저장 구조가 두 가지(nested/flat) 혼재
//   nested: filesData[id][type] = { name, data, mimeType }
//   flat:   filesData[id + '|' + type] = { name, data, mimeType }
//   양쪽 모두에서 검색
function getFileEntry(rowId, fieldName) {
  if (!rowId || !fieldName || typeof filesData !== 'object') return null;
  const nested = filesData[rowId] && filesData[rowId][fieldName];
  if (nested && nested.data) return nested;
  const flat = filesData[rowId + '|' + fieldName];
  if (flat && flat.data) return flat;
  return null;
}
window.getFileEntry = getFileEntry;

function downloadFile(rowId, fieldName) {
  const fi = getFileEntry(rowId, fieldName);
  if (!fi) { alert('첨부 파일을 찾을 수 없습니다.'); return; }
  const a = document.createElement('a');
  a.href = fi.data; a.download = fi.name; a.click();
}

// =====================================================
//  PRODUCT MASTER
// =====================================================
function saveProductMaster() {
  const model = (document.getElementById('pm-model')?.value || '').trim();
  const watt  = (document.getElementById('pm-watt')?.value  || '').trim();
  const mfr   = (document.getElementById('pm-mfr')?.value   || '').trim();
  const plt   = parseInt(document.getElementById('pm-plt')?.value) || 0;
  if (!model) { alert('모델명은 필수입니다.'); return; }   // ★ 2026-08: 구조물·자재 등 용량 없는 품목 허용
  productMaster[model] = { watt: Number(watt), mfr, plt };
  localStorage.setItem(KEYS.PRODUCT_MASTER, JSON.stringify(productMaster));
  document.getElementById('pm-model').value = '';
  document.getElementById('pm-watt').value  = '';
  document.getElementById('pm-mfr').value   = '';
  const pltEl = document.getElementById('pm-plt'); if (pltEl) pltEl.value = '';
  renderProductMasterTable();
  setBanner('ok', `✅ 제품 마스터 등록: ${model}${Number(watt) ? ' = ' + watt + 'W' : ''}${plt ? ', 1PLT '+plt+'매' : ''}`);
}

function deleteProductMaster(model) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('제품 마스터 삭제')) return;
  if (!confirm(`"${model}" 제품 마스터를 삭제합니까?`)) return;
  delete productMaster[model];
  localStorage.setItem(KEYS.PRODUCT_MASTER, JSON.stringify(productMaster));
  if (typeof _pmEditKey !== 'undefined' && _pmEditKey === model) _pmEditKey = null;
  renderProductMasterTable();
  if (typeof setBanner === 'function') setBanner('ok', `🗑 제품 마스터 삭제: ${model}`);
}

// ★ 2026-08 추가: 제품 마스터 인라인 수정
//   목록의 ✏️ 버튼 → 그 행이 입력칸으로 바뀜 → 저장/취소
//   모델명도 바꿀 수 있다 (기존 키 삭제 후 새 키로 재등록 — 중복 시 확인)
let _pmEditKey = null;
function editProductMaster(model) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('제품 마스터 수정')) return;
  _pmEditKey = model;
  renderProductMasterTable();
  setTimeout(() => {
    const el = document.getElementById('pm-edit-model');
    if (el) { el.focus(); el.select(); }
  }, 20);
}
function cancelProductMasterEdit() { _pmEditKey = null; renderProductMasterTable(); }

function saveProductMasterEdit(origModel) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('제품 마스터 수정')) return;
  const g = (id) => (document.getElementById(id)?.value || '').trim();
  const model = g('pm-edit-model');
  if (!model) { alert('모델명은 필수입니다.'); return; }
  const watt = parseFloat(g('pm-edit-watt')) || 0;
  const mfr  = g('pm-edit-mfr');
  const plt  = parseInt(g('pm-edit-plt')) || 0;

  if (model !== origModel && productMaster[model]) {
    if (!confirm(`"${model}" 은(는) 이미 등록된 모델입니다.\n기존 내용을 덮어쓸까요?`)) return;
  }
  if (model !== origModel) delete productMaster[origModel];
  productMaster[model] = { watt, mfr, plt };
  try {
    localStorage.setItem(KEYS.PRODUCT_MASTER, JSON.stringify(productMaster));
  } catch (e) { alert('저장 실패 — 저장 공간을 확인하세요.'); return; }
  _pmEditKey = null;
  renderProductMasterTable();
  setBanner('ok', `✅ 제품 마스터 수정: ${model}${watt ? ' = ' + watt + 'W' : ''}${plt ? ', 1PLT ' + plt + '매' : ''}`
    + (model !== origModel ? ` (모델명 변경: ${origModel} → ${model})` : ''));
}
window.editProductMaster       = editProductMaster;
window.cancelProductMasterEdit = cancelProductMasterEdit;
window.saveProductMasterEdit   = saveProductMasterEdit;

let _pmSearch = '';
function setProductMasterSearch(v) { _pmSearch = String(v || ''); renderProductMasterTable(true); }
window.setProductMasterSearch = setProductMasterSearch;

function renderProductMasterTable(keepFocus) {
  // 설정 탭의 'productMasterTableArea' 또는 기존 'productMasterTable' 둘 다 지원
  const el = document.getElementById('productMasterTable')
         || document.getElementById('productMasterTableArea');
  if (!el) return;
  const all = Object.entries(productMaster).sort((a,b) => a[0].localeCompare(b[0]));
  if (!all.length) {
    _pmSearch = '';
    el.innerHTML = '<div class="empty">등록된 제품 없음. 위 폼에서 직접 등록하거나 📥 엑셀 불러오기 / 📋 기본 목록 버튼을 사용하세요.</div>';
    return;
  }
  // ★ 2026-08 추가: 검색 (모델명·제조사) — 목록이 수백 종으로 늘어나 필수
  const q = _pmSearch.trim().toLowerCase();
  const entries = q ? all.filter(([m,v]) => (m + ' ' + (v.mfr||'')).toLowerCase().includes(q)) : all;
  // ★ 10개 행 표시 + 스크롤 (헤더 sticky)
  //   행 높이 ~36px + 헤더 ~38px = 약 400px 높이로 10개 정도 노출
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
      <input id="pm-search" type="search" value="${escapeAttr(_pmSearch)}" placeholder="모델명 · 제조사 검색"
             oninput="setProductMasterSearch(this.value)"
             style="flex:1;min-width:200px;max-width:320px;padding:6px 9px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.85em;">
      <span style="font-size:0.82em;color:#888;">
        ${q ? `전체 ${all.length}개 중 <strong>${entries.length}</strong>개 표시` : `총 ${all.length}개 제품`}
        ${entries.length > 10 ? ' · 스크롤' : ''}
      </span>
    </div>
    <div style="max-height:400px;overflow-y:auto;border:1px solid #eef0f4;border-radius:8px;">
      <table style="margin:0;">
        <thead><tr style="position:sticky;top:0;background:#1a1a2e;color:#fff;z-index:1;">
          <th>모델명</th><th>제품용량(W)</th><th>제조사</th>
          <th style="text-align:right;">1PLT 수량</th>
          <th style="text-align:center;">수정 · 삭제</th>
        </tr></thead>
        <tbody>${entries.length ? entries.map(([m,v]) => (m === _pmEditKey ? `<tr style="background:#fffde7;">
          <td><input id="pm-edit-model" type="text" value="${escapeAttr(m)}" style="width:100%;min-width:180px;padding:4px 7px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;font-weight:700;"></td>
          <td style="text-align:right;"><input id="pm-edit-watt" type="number" step="0.1" value="${v.watt||''}" placeholder="0" style="width:80px;padding:4px 6px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;text-align:right;"></td>
          <td><input id="pm-edit-mfr" type="text" value="${escapeAttr(v.mfr)}" placeholder="제조사" style="width:110px;padding:4px 6px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;"></td>
          <td style="text-align:right;"><input id="pm-edit-plt" type="number" value="${v.plt||''}" placeholder="0" style="width:70px;padding:4px 6px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;text-align:right;"></td>
          <td style="text-align:center;white-space:nowrap;">
            <button class="btn btn-xs btn-success" onclick="saveProductMasterEdit(this.getAttribute('data-m'))" data-m="${escapeAttr(m)}">저장</button>
            <button class="btn btn-xs btn-outline" onclick="cancelProductMasterEdit()">취소</button>
          </td>
        </tr>` : `<tr>
          <td style="font-weight:700;">${escapeHtml(m)}</td>
          <td style="text-align:right;color:${v.watt>0?'#1565c0':'#ccc'};font-weight:700;">${v.watt>0 ? v.watt+'W' : '-'}</td>
          <td style="color:#888;">${escapeHtml(v.mfr)||'-'}</td>
          <td style="text-align:right;color:#e65100;font-weight:700;">${v.plt ? v.plt+'매/PLT' : '<span style="color:#ccc;">-</span>'}</td>
          <td style="text-align:center;white-space:nowrap;">
            <button class="btn btn-xs btn-dark" onclick="editProductMaster(this.getAttribute('data-m'))" data-m="${escapeAttr(m)}" title="수정">✏️</button>
            <button class="btn btn-xs btn-red" onclick="deleteProductMaster(this.getAttribute('data-m'))" data-m="${escapeAttr(m)}">삭제</button>
          </td>
        </tr>`)).join('') : '<tr><td colspan="5" class="empty">검색 결과가 없습니다.</td></tr>'}</tbody>
      </table>
    </div>`;
  // 검색 입력 중이면 포커스·커서 위치 유지
  if (keepFocus) {
    const s = document.getElementById('pm-search');
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
}
