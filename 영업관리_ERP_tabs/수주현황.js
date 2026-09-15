// =====================================================
//  출고지시서 생성 가능 매입사 (2026-08 추가)
//   자사 광주창고에 보관 중인 재고(위탁 포함)와 탑솔라 물량만
//   우리가 직접 출고지시서를 발행할 수 있다.
//   그 외 매입사(직송 등)는 출고지시서 생성 버튼이 비활성화된다.
//
//   ★ 목록 수정은 아래 DO_ALLOWED_VENDORS 배열만 고치면 됩니다.
//     "광주창고" 가 포함된 매입사는 아래 목록에 없어도 자동 허용됩니다
//     (광주창고(신규업체) 가 추가돼도 코드 수정 불필요).
// =====================================================
const DO_ALLOWED_VENDORS = [
  '탑솔라',
  '광주창고',
  '광주창고(탑솔라)',
  '광주창고(에스케이쉴더스)',
  '광주창고(한국화웨이기술)',
  '광주창고(남도에코에너지)',
  '광주창고(프라임에너지)',
  '광주창고(에스씨지솔루션즈)',
  '광주창고(한결에너지)',
  '광주창고(지우테크)',
  '광주창고(현대에너지솔루션)',
  '한국화웨이기술광주창고(한국화웨이기술)'
];
window.DO_ALLOWED_VENDORS = DO_ALLOWED_VENDORS;

// 비교용 정규화 — 공백 제거 + 소문자 (엑셀 붙여넣기 시 공백 혼입 대비)
function _normVendor(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase(); }

const _DO_ALLOWED_SET = new Set(DO_ALLOWED_VENDORS.map(_normVendor));

// 이 수주로 출고지시서를 발행할 수 있는가
//   ★ 2026-08 변경: 매입사 제한 해제 — 모든 건에서 출고지시서를 생성할 수 있다.
//   (직전까지는 광주창고 계열·탑솔라 물량만 허용했으나 사용자 요청으로 제한 제거)
//   허용 목록(DO_ALLOWED_VENDORS)은 참고용으로 남겨두며, 다시 제한하려면
//   아래 return true 를 지우고 그 아래 매입사 판정 블록의 주석을 해제하면 된다.
function canCreateDO(o) {
  return true;
  /* --- 매입사 제한 (사용 안 함) ---
  const v = _normVendor(o && o.매입사);
  if (!v) return false;
  if (_DO_ALLOWED_SET.has(v)) return true;
  return v.indexOf(_normVendor('광주창고')) >= 0;
  --- */
}
window.canCreateDO = canCreateDO;

// 비활성 사유 문구
function doBlockReason(o) {
  const v = String((o && o.매입사) || '').trim();
  return v
    ? `매입사 "${v}" 는 직접 출고 대상이 아닙니다.\n광주창고 보관분 · 탑솔라 물량만 출고지시서를 발행할 수 있습니다.`
    : '매입사가 입력되지 않았습니다. 수주현황에서 매입사를 먼저 입력하세요.';
}
window.doBlockReason = doBlockReason;

// =====================================================
//  DASHBOARD
// =====================================================
function renderDashboard() {
  const orders = getEnriched();
  const today = todayStr();
  const thisMonth = getThisMonth();

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((s,o) => s + o.수주총액, 0);
  const totalProfit = orders.reduce((s,o) => s + o.영업이익, 0);
  const avgRate = totalRevenue > 0 ? (totalProfit/totalRevenue*100).toFixed(1) : 0;

  const thisMonthOrders = orders.filter(o => o.수주일 && o.수주일.startsWith(thisMonth));
  const thisMonthRev = thisMonthOrders.reduce((s,o) => s + o.수주총액, 0);
  const thisMonthProfit = thisMonthOrders.reduce((s,o) => s + o.영업이익, 0);

  const upcoming7 = orders.filter(o => { const d = daysUntil(o.출고요청일); return d !== null && d >= 0 && d <= 7; }).length;
  const overdue = orders.filter(o => o.출고요청일 && o.출고요청일 < today && o.status === '수주').length;

  // 0.0억원 단위 포매터 (1억=100,000,000원)
  const fmt억 = v => (Number(v||0)/100000000).toFixed(1) + '억원';

  document.getElementById('dashStats').innerHTML = `
    <div class="stat s-blue"><div class="stat-lbl">전체 수주 건수</div><div class="stat-val">${totalOrders}</div><div class="stat-sub">이번달 ${thisMonthOrders.length}건</div></div>
    <div class="stat s-green"><div class="stat-lbl">전체 수주 총액</div><div class="stat-val">${fmt억(totalRevenue)}</div><div class="stat-sub">이번달 ${fmt억(thisMonthRev)}</div></div>
    <div class="stat s-purple"><div class="stat-lbl">누적 영업이익</div><div class="stat-val">${fmt억(totalProfit)}</div><div class="stat-sub">이번달 ${fmt억(thisMonthProfit)}</div></div>
    <div class="stat"><div class="stat-lbl">평균 이익률</div><div class="stat-val">${avgRate}%</div><div class="stat-sub">전체 기간</div></div>
    <div class="stat s-orange"><div class="stat-lbl">납기 임박 (7일)</div><div class="stat-val">${upcoming7}</div><div class="stat-sub">건</div></div>
  `;

  // Alerts
  let alerts = '';
  if (overdue > 0) alerts += `<div class="alert alert-danger">⚠️ 출고요청일이 지난 미납 수주가 <strong>${overdue}건</strong> 있습니다!</div>`;
  if (upcoming7 > 0) alerts += `<div class="alert alert-warn">📅 7일 이내 납기 예정 수주 <strong>${upcoming7}건</strong></div>`;
  const noDeposit = orders.filter(o => !o.계약금입금 && o.status==='수주' && o.출고요청일 && daysUntil(o.출고요청일)!==null && daysUntil(o.출고요청일)<=14).length;
  if (noDeposit > 0) alerts += `<div class="alert alert-warn">💰 14일 이내 납기 예정 수주 중 계약금 미입금 건 <strong>${noDeposit}건</strong> — 수금 확인이 필요합니다.</div>`;
  if (orders.length === 0) alerts += `<div class="alert alert-info">📋 구글 시트 연동 후 동기화하면 데이터가 표시됩니다. 우측 상단 "🔄 시트 동기화"를 클릭하거나 설정에서 URL을 입력하세요.</div>`;
  document.getElementById('dashAlerts').innerHTML = alerts;

  // Manager table (this month)
  const managerMap = {};
  thisMonthOrders.forEach(o => {
    if (!managerMap[o.담당자]) managerMap[o.담당자] = { cnt:0, rev:0, profit:0 };
    managerMap[o.담당자].cnt++;
    managerMap[o.담당자].rev += o.수주총액;
    managerMap[o.담당자].profit += o.영업이익;
  });
  const mRows = Object.entries(managerMap).sort((a,b) => b[1].rev - a[1].rev);
  document.getElementById('dashManagerTable').innerHTML = mRows.length ? `
    <table><thead><tr><th>담당자</th><th>건수</th><th>수주총액</th><th>영업이익</th><th>이익률</th></tr></thead>
    <tbody>${mRows.map(([m,d]) => `<tr><td><strong>${m}</strong></td><td>${d.cnt}</td><td>${fmt(d.rev)}원</td><td>${fmt(d.profit)}원</td><td>${d.rev>0?(d.profit/d.rev*100).toFixed(1):0}%</td></tr>`).join('')}</tbody>
    </table>` : '<div class="empty">이번달 데이터 없음</div>';

  // Urgent
  // ★ 2026-05-13 사용자 요청 — 기간 내 데이터 전부 반영
  //   ① 7일 이내 (기존)
  //   ② 출고요청일이 지났는데 출고 미완료 (모든 미완료 상태 포함, status='수주' 제한 제거)
  //   ③ .slice(0,8) 제한 제거 → 카드의 max-height + scroll 로 처리
  const COMPLETED_STATUSES = ['완료', '출고완료', '취소', '반품완료'];
  const urgentList = orders.filter(o => {
    if (!o.출고요청일) return false;
    const d = daysUntil(o.출고요청일);
    const isUpcoming = (d !== null && d >= 0 && d <= 7);
    const isOverdue = (o.출고요청일 < today && !COMPLETED_STATUSES.includes(o.status||''));
    return isUpcoming || isOverdue;
  }).sort((a, b) => (a.출고요청일||'').localeCompare(b.출고요청일||''));
  document.getElementById('dashUrgent').innerHTML = urgentList.length ? `
    <div class="tbl-wrap"><table><thead><tr><th>PJ NO</th><th>고객사</th><th>모델</th><th>출고요청일</th><th>D-Day</th><th>상태</th><th>계약금</th><th>출고지시서</th></tr></thead>
    <tbody>${urgentList.map(o => {
      // D-day 표시: 출고요청일 전날을 D-0으로 (준비 완료 기준)
      const dd = dDayLabel(o.출고요청일);
      const cls = dd.cls; const label = dd.label; const d = dd.diff;
      const depositBadge = o.계약금입금
        ? `<span class="tag green" style="font-size:0.75em;cursor:pointer;" onclick="quickSetDeposit('${o._id}',false)" title="클릭→입금 취소">✅ 입금</span>`
        : `<span class="tag red" style="font-size:0.75em;cursor:pointer;" onclick="quickSetDeposit('${o._id}',true)" title="클릭→입금처리">💰 미입금</span>`;
      // 출고지시서: 이미 생성된 건 → 탭 이동 / 매입사가 광주창고·탑솔라 계열이면 생성 버튼 / 아니면 대상 아님
      let doCell = '';
      if (o.deliveryOrderId && typeof deliveryOrders !== 'undefined' && deliveryOrders.some(d => d.id === o.deliveryOrderId)) {
        doCell = `<span class="tag green" style="font-size:0.72em;cursor:pointer;" onclick="showTab('delivery')" title="${o.deliveryOrderId} — 출고지시서 탭으로 이동">출고지시서</span>`;
      } else if (typeof canCreateDO === 'function' && !canCreateDO(o)) {
        doCell = `<span class="tag" style="font-size:0.72em;background:#eceff1;color:#90a4ae;cursor:help;" title="${escapeAttr(doBlockReason(o))}">출고 대상 아님</span>`;
      } else {
        doCell = `<button class="btn btn-xs btn-primary" style="font-size:0.72em;padding:2px 7px;" onclick="openDeliveryOrderModal('${o.pjNo}','${o._id}')" title="출고지시서 생성">생성</button>`;
      }
      return `<tr><td><a href="#" onclick="openOrderDetail('${o._id}');return false;" style="color:#1a1a2e;font-weight:700;">${o.pjNo}</a></td><td>${o.고객사}</td><td style="font-size:0.8em;">${o.모델명}</td><td>${dateKo(o.출고요청일)}</td><td><span class="badge ${cls}">${label}</span></td><td>${statusBadge(o.status)}</td><td>${depositBadge}</td><td style="text-align:center;">${doCell}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">납기 임박 건 없음 ✅</div>';

  // Recent — 전체 수주를 최신순으로, 카드 내 스크롤로 표시 (2026-05-13)
  const recent = [...orders].sort((a,b) => (b.수주일||'').localeCompare(a.수주일||'')).slice(0,50);
  document.getElementById('dashRecent').innerHTML = recent.length ? `
    <div class="tbl-wrap"><table><thead><tr><th>PJ NO</th><th>담당자</th><th>수주일</th><th>고객사</th><th>모델명</th><th>수량</th><th>수주총액</th><th>출고요청일</th><th>상태</th></tr></thead>
    <tbody>${recent.map(o => `<tr>
      <td><a href="#" onclick="openOrderDetail('${o._id}');return false;" style="color:#1a1a2e;font-weight:700;">${o.pjNo}</a></td>
      <td>${o.담당자}</td><td>${dateKo(o.수주일)}</td><td>${o.고객사}</td>
      <td style="font-size:0.8em;">${o.모델명}</td><td>${fmt(o.수량)}</td>
      <td>${fmt(o.수주총액)}원</td><td>${dateKo(o.출고요청일)||'-'}</td>
      <td>${statusBadge(o.status)}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="empty">수주 데이터 없음</div>';
}

// =====================================================
//  ORDERS TAB
// =====================================================
function populateOrderFilters() {
  const orders = getEnriched();
  populateSelect('f-manager', [...new Set(orders.map(o=>o.담당자).filter(Boolean))].sort());
  populateSelect('f-product', [...new Set(orders.map(o=>o.제품군).filter(Boolean))].sort());
  populateSelect('f-mfr', [...new Set(orders.map(o=>o.제조사).filter(Boolean))].sort());
}

function populateSelect(id, opts) {
  const el = document.getElementById(id);
  const cur = el.value;
  el.innerHTML = '<option value="">전체</option>' + opts.map(v=>`<option>${v}</option>`).join('');
  el.value = cur;
}

function getOrderFilters() {
  return {
    manager: document.getElementById('f-manager').value,
    product: document.getElementById('f-product').value,
    mfr: document.getElementById('f-mfr').value,
    status: document.getElementById('f-status').value,
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
    search: document.getElementById('f-search').value.toLowerCase()
  };
}

function resetOrderFilters() {
  ['f-manager','f-product','f-mfr','f-status'].forEach(id => document.getElementById(id).value = '');
  ['f-from','f-to','f-search'].forEach(id => document.getElementById(id).value = '');
  _clearColFilters();   // 컬럼 필터(담당자·고객사·제품군·모델·출고요청일)도 함께 해제
  renderOrders();
}

// =====================================================
//  CALENDAR VIEW
// =====================================================
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDate = null;
let calViewActive = false;

function setOrderView(mode) {
  calViewActive = (mode === 'cal');
  document.getElementById('ordersCalendarView').style.display = calViewActive ? 'block' : 'none';
  document.getElementById('ordersTblWrap').style.display = calViewActive ? 'none' : 'block';
  document.getElementById('ordersCountInfo').style.display = calViewActive ? 'none' : 'block';
  document.getElementById('btnListView').className = 'btn btn-sm ' + (calViewActive ? 'btn-outline' : 'btn-dark');
  document.getElementById('btnCalView').className  = 'btn btn-sm ' + (calViewActive ? 'btn-dark' : 'btn-outline');
  if (calViewActive) renderOrderCalendar();
}

function renderOrderCalendar() {
  document.getElementById('calMonthLabel').textContent = `${calYear}년 ${calMonth+1}월`;
  const dows = ['일','월','화','수','목','금','토'];
  document.getElementById('calDowRow').innerHTML = dows.map((d,i) => {
    const cls = i===0?'dow-sun':i===6?'dow-sat':'';
    return `<div class="cal-dow ${cls}">${d}</div>`;
  }).join('');

  const orders = getEnriched();
  const dateMap = {};
  orders.forEach(o => {
    const key = o.출고요청일;
    if (key) { if (!dateMap[key]) dateMap[key] = []; dateMap[key].push(o); }
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const today = todayStr();
  let html = '';

  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDay + 1;
    const isThis = dayNum >= 1 && dayNum <= daysInMonth;
    const dateStr = isThis ? `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}` : null;
    const dayOrders = dateStr ? (dateMap[dateStr] || []) : [];
    const isToday = dateStr === today;
    const isSelected = dateStr === calSelectedDate;

    let dotsHtml = dayOrders.slice(0,3).map(o => {
      const cls = (o.status === '수주' && o.출고요청일 < today) ? 'c-red'
                : (o.status === '납품완료' || o.status === '수금완료') ? 'c-green' : 'c-blue';
      return `<div class="cal-dot ${cls}" title="${o.pjNo} ${o.고객사}">${o.고객사||o.pjNo}</div>`;
    }).join('');
    if (dayOrders.length > 3) dotsHtml += `<div class="cal-dot c-blue">+${dayOrders.length-3}건</div>`;

    const dowOfDay = isThis ? new Date(calYear, calMonth, dayNum).getDay() : -1;
    const numCls = dowOfDay === 0 ? 'sun' : dowOfDay === 6 ? 'sat' : '';
    const classes = ['cal-day',
      !isThis ? 'cal-other' : '',
      isToday ? 'cal-today' : '',
      isSelected ? 'cal-selected' : ''
    ].filter(Boolean).join(' ');
    const onclick = dateStr ? `onclick="selectCalendarDate('${dateStr}')"` : '';
    html += `<div class="${classes}" ${onclick}><div class="cal-day-num ${numCls}">${isThis ? dayNum : ''}</div>${dotsHtml}</div>`;
  }
  document.getElementById('calDayGrid').innerHTML = html;
  if (calSelectedDate) showCalendarDayOrders(calSelectedDate);
}

function selectCalendarDate(dateStr) {
  calSelectedDate = dateStr;
  renderOrderCalendar();
  showCalendarDayOrders(dateStr);
}

function showCalendarDayOrders(dateStr) {
  const orders = getEnriched().filter(o => o.출고요청일 === dateStr);
  const parts = dateStr.split('-');
  const label = `${parseInt(parts[1])}월 ${parseInt(parts[2])}일`;
  const today = todayStr();
  document.getElementById('calSideTitle').textContent = label + (orders.length ? ` — ${orders.length}건` : ' — 없음');

  const labelRow = (key, val) => val
    ? `<div style="display:flex;gap:8px;font-size:0.8em;">
        <span style="min-width:62px;color:#888;font-weight:700;">${key}</span>
        <span style="color:#333;flex:1;">${val}</span>
       </div>`
    : '';

  document.getElementById('calSideList').innerHTML = orders.length
    ? orders.map(o => {
        const itemCls = (o.status==='수주' && o.출고요청일 < today) ? 'st-overdue'
                      : (o.status==='납품완료'||o.status==='수금완료') ? 'st-done' : '';
        const modelQty = [o.모델명, o.수량 ? `${fmt(o.수량)}매` : ''].filter(Boolean).join(' · ');
        return `<div class="cal-order-item ${itemCls}" onclick="openOrderDetail('${o._id}')" style="cursor:pointer;padding:10px 12px;border:1px solid #eef0f4;border-radius:8px;margin-bottom:8px;background:white;">
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${labelRow('발전소명', o.발전소명 || '-')}
            ${labelRow('납품주소', o.납품주소 || '-')}
            ${labelRow('모듈명',   modelQty || '-')}
            ${labelRow('인수담당자', o.인수담당자 || '-')}
            ${o.요청사항 ? labelRow('요청사항', o.요청사항) : ''}
          </div>
        </div>`;
      }).join('')
    : '<div style="padding:30px 0;text-align:center;color:#bbb;font-size:0.85em;">이 날 납기 예정 없음</div>';
}

function changeCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  calSelectedDate = null;
  renderOrderCalendar();
}

function goToCalendarToday() {
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  calSelectedDate = todayStr();
  renderOrderCalendar();
  showCalendarDayOrders(calSelectedDate);
}

// ★ 2026-05 변경: 수주 뷰 모드 4개 (진행 중 / 완료 / 취소 / 전체)
//   - 진행 중 (active)    : status === '수주' (입금 진행 중인 활성 건)
//   - 완료 (completed)    : 납품완료, 수금완료
//   - 취소 (cancelled)    : 취소, 출고취소
//   - 전체 (all)          : 모든 상태
let _orderViewMode = (function() {
  try {
    const v = localStorage.getItem('erp_order_view_mode') || 'active';
    // 구버전 'archive' 자동 마이그레이션 → 'completed'
    if (v === 'archive') {
      try { localStorage.setItem('erp_order_view_mode', 'completed'); } catch (e) {}
      return 'completed';
    }
    return v;
  } catch (e) { return 'active'; }
})();
const COMPLETED_STATUSES = new Set(['납품완료', '수금완료']);
const CANCELLED_STATUSES = new Set(['취소', '출고취소']);
// 구버전 호환 — 다른 모듈이 ARCHIVE_STATUSES 참조 시 (완료+취소 합쳐서)
const ARCHIVE_STATUSES = new Set([...COMPLETED_STATUSES, ...CANCELLED_STATUSES]);

function _syncViewModeTabs() {
  ['active','completed','cancelled','all'].forEach(m => {
    const btn = document.getElementById('ovt-' + m);
    if (btn) {
      const isActive = m === _orderViewMode;
      btn.style.borderBottom = isActive ? '3px solid #1a1a2e' : '3px solid transparent';
      btn.style.fontWeight = isActive ? '700' : '500';
      btn.style.color = isActive ? '#1a1a2e' : '#888';
    }
  });
}

function setOrderViewMode(mode) {
  if (!['active','completed','cancelled','all'].includes(mode)) return;
  if (mode === _orderViewMode) { _syncViewModeTabs(); return; }
  _orderViewMode = mode;
  try { localStorage.setItem('erp_order_view_mode', mode); } catch (e) {}
  _syncViewModeTabs();
  renderOrders();
}
window.setOrderViewMode = setOrderViewMode;
window._getOrderViewMode = () => _orderViewMode;

function filterOrders(orders, f) {
  return orders.filter(o => {
    // ★ 뷰 모드 필터 (가장 먼저)
    if (_orderViewMode === 'active'    && ARCHIVE_STATUSES.has(o.status))   return false;
    if (_orderViewMode === 'completed' && !COMPLETED_STATUSES.has(o.status)) return false;
    if (_orderViewMode === 'cancelled' && !CANCELLED_STATUSES.has(o.status)) return false;
    // 'all' 은 모두 통과

    if (f.manager && o.담당자 !== f.manager) return false;
    if (f.product && o.제품군 !== f.product) return false;
    if (f.mfr && o.제조사 !== f.mfr) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.from && o.수주일 < f.from) return false;
    if (f.to && o.수주일 > f.to) return false;
    if (!_passColFilters(o)) return false;      // 컬럼 필터 (담당자·고객사·제품군·모델·출고요청일)
    if (f.search) {
      const hay = [o.pjNo,o.고객사,o.발전소명,o.모델명,o.담당자,o.납품주소].join(' ').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

// 진행 중 / 완료 / 취소 / 전체 카운트 — 탭 라벨 옆 표시
function _updateViewModeCounts() {
  if (typeof getEnriched !== 'function') return;
  const all = getEnriched();
  let active = 0, completed = 0, cancelled = 0;
  all.forEach(o => {
    if (COMPLETED_STATUSES.has(o.status))      completed++;
    else if (CANCELLED_STATUSES.has(o.status)) cancelled++;
    else                                       active++;
  });
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `(${val})`;
  };
  setText('ovt-active-cnt', active);
  setText('ovt-completed-cnt', completed);
  setText('ovt-cancelled-cnt', cancelled);
  setText('ovt-all-cnt', all.length);
}

let _orderSortCol = null;
let _orderSortDir = 1;

function toggleOrderSort(col) {
  if (_orderSortCol === col) _orderSortDir *= -1;
  else { _orderSortCol = col; _orderSortDir = 1; }
  renderOrders();
}

function applyOrderSort(arr) {
  if (!_orderSortCol) return arr;
  return [...arr].sort((a, b) => {
    let va = a[_orderSortCol], vb = b[_orderSortCol];
    if (va == null) va = ''; if (vb == null) vb = '';
    // 빈 값(예: 출고요청일 미입력)은 정렬 방향과 무관하게 항상 뒤로
    if (va === '' && vb !== '') return 1;
    if (vb === '' && va !== '') return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * _orderSortDir;
    return String(va).localeCompare(String(vb), 'ko') * _orderSortDir;
  });
}

// =====================================================
//  컬럼 필터 (엑셀 스타일) — 2026-08 추가
//   대상 컬럼: 담당자 · 고객사 · 제품군 · 모델 · 출고요청일
//   · 오름차순 / 내림차순 정렬 (_orderSortCol 재사용)
//   · 값 체크박스 목록 (검색 + 모두 선택), 값이 없는 건은 "(미입력)"
//   · 날짜 컬럼은 기간(from ~ to) 범위 지정 추가
//   목록에 나오는 후보 값은 나머지 필터를 통과한 건들 기준 (엑셀과 동일)
//   상태는 세션 메모리에만 유지 — 새로고침 시 초기화
// =====================================================
const ORDER_COLS = {
  '담당자':     { th: 'th-manager',  label: '담당자' },
  '고객사':     { th: 'th-customer', label: '고객사' },
  '제품군':     { th: 'th-product',  label: '제품군' },
  '모델명':     { th: 'th-model',    label: '모델' },
  '출고요청일': { th: 'th-reqdate',  label: '출고요청일', date: true }
};

// field → { from, to, values:Set|null }
let _colFilter = {};
function _cf(field) {
  if (!_colFilter[field]) _colFilter[field] = { from: '', to: '', values: null };
  return _colFilter[field];
}
function _colFilterActive(field) {
  const f = _colFilter[field];
  return !!(f && (f.from || f.to || f.values));
}
function _anyColFilterActive() {
  return Object.keys(ORDER_COLS).some(_colFilterActive);
}
function _colFilterSig() {
  return Object.keys(ORDER_COLS).map(k => {
    const f = _colFilter[k];
    if (!f) return '*';
    return [f.from, f.to, f.values ? [...f.values].sort().join('|') : '*'].join('~');
  }).join('#');
}
function _passColFilters(o) {
  for (const field in ORDER_COLS) {
    const f = _colFilter[field];
    if (!f) continue;
    const v = o[field] || '';
    if (f.values && !f.values.has(v)) return false;
    if (f.from && (!v || v < f.from)) return false;
    if (f.to   && (!v || v > f.to))   return false;
  }
  return true;
}
function _clearColFilters() { _colFilter = {}; }

// 헤더 셀 렌더 — 정렬 화살표 + 필터 버튼 (필터 활성 시 파란 배지)
function _renderColHeaders() {
  for (const field in ORDER_COLS) {
    const meta = ORDER_COLS[field];
    const th = document.getElementById(meta.th);
    if (!th) continue;
    const on = _colFilterActive(field);
    const sorted = (_orderSortCol === field);
    const arrow = sorted ? (_orderSortDir === 1 ? '↑' : '↓') : '↕';
    th.innerHTML =
      `<span style="cursor:pointer;" onclick="toggleOrderSort('${field}')" title="클릭 = 오름차순/내림차순 전환">${meta.label}</span>`
      + `<span style="color:${sorted ? '#1a1a2e' : '#c3c7ce'};font-size:0.85em;margin-left:3px;">${arrow}</span>`
      + `<button type="button" onclick="openColFilter(event,'${field}')" title="필터 / 정렬"`
      + ` style="border:none;background:${on ? '#3498db' : 'transparent'};color:${on ? '#fff' : '#98a0ab'};`
      + `border-radius:4px;padding:0 5px;margin-left:4px;cursor:pointer;font-size:0.78em;line-height:1.6;">▼</button>`;
  }
}
// 하위 호환 (기존 호출부)
function _renderReqDateHeader() { _renderColHeaders(); }

function _rdfPanel() { return document.getElementById('colFilterPanel'); }

function closeColFilter() {
  const p = _rdfPanel();
  if (p) p.remove();
  document.removeEventListener('mousedown', _rdfOutsideClick);
}
function _rdfOutsideClick(e) {
  const p = _rdfPanel();
  if (p && !p.contains(e.target)) closeColFilter();
}

function openColFilter(ev, field) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const meta = ORDER_COLS[field];
  if (!meta) return;
  const prev = _rdfPanel();
  const sameCol = prev && prev.getAttribute('data-field') === field;
  closeColFilter();
  if (sameCol) return;                                   // 같은 컬럼 재클릭 = 토글
  const btn = (ev && ev.currentTarget) || document.querySelector('#' + meta.th + ' button');
  const cur = _cf(field);

  // 후보 값 = 이 컬럼의 필터를 뺀 나머지 필터를 통과한 건들
  const saved = _colFilter[field];
  delete _colFilter[field];
  let pool = [];
  try { pool = filterOrders(getEnriched(), getOrderFilters()); } catch (e) { pool = []; }
  if (saved) _colFilter[field] = saved;

  const counts = {};
  pool.forEach(o => { const v = o[field] || ''; counts[v] = (counts[v] || 0) + 1; });
  const vals = Object.keys(counts).filter(v => v).sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  const hasBlank = Object.prototype.hasOwnProperty.call(counts, '');
  const isOn = (v) => !cur.values || cur.values.has(v);
  const disp = (v) => meta.date && typeof dateKo === 'function' ? dateKo(v) : v;

  const item = (v, label, cnt) =>
    `<label class="rdf-item" data-key="${escapeAttr((label || '') + ' ' + v)}"
       style="display:flex;align-items:center;gap:7px;padding:4px 12px;cursor:pointer;white-space:nowrap;">
      <input type="checkbox" class="rdf-chk" data-v="${escapeAttr(v)}" ${isOn(v) ? 'checked' : ''} onchange="_rdfSyncAllBox()">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(label)}</span>
      <span style="color:#aaa;font-size:0.88em;">${cnt}</span>
    </label>`;

  const rowBtn = 'display:block;width:100%;text-align:left;border:none;background:none;padding:8px 12px;cursor:pointer;font-size:1em;color:#1a1a2e;';
  const sortAsc = meta.date ? '↑&nbsp; 오름차순 정렬 (빠른 날짜순)' : '↑&nbsp; 오름차순 정렬 (가나다순)';
  const sortDesc = meta.date ? '↓&nbsp; 내림차순 정렬 (늦은 날짜순)' : '↓&nbsp; 내림차순 정렬 (역순)';

  const panel = document.createElement('div');
  panel.id = 'colFilterPanel';
  panel.setAttribute('data-field', field);
  panel.style.cssText = 'position:fixed;z-index:1200;background:#fff;border:1px solid #d6dae2;border-radius:10px;'
    + 'box-shadow:0 12px 36px rgba(0,0,0,0.22);width:296px;font-size:0.85em;overflow:hidden;color:#1a1a2e;';
  panel.innerHTML = `
    <div style="padding:9px 12px;background:#f6f8fb;border-bottom:1px solid #eceff3;font-weight:800;display:flex;justify-content:space-between;align-items:center;">
      <span>${escapeHtml(meta.label)} 필터</span>
      <button type="button" onclick="closeColFilter()" style="border:none;background:none;cursor:pointer;color:#aaa;font-size:1.1em;line-height:1;">✕</button>
    </div>
    <button type="button" style="${rowBtn}" onclick="sortOrderCol('${field}',1)">${sortAsc}</button>
    <button type="button" style="${rowBtn}" onclick="sortOrderCol('${field}',-1)">${sortDesc}</button>
    ${meta.date ? `
    <div style="border-top:1px solid #eceff3;padding:9px 12px;">
      <div style="color:#8b93a0;font-weight:700;font-size:0.9em;margin-bottom:5px;">기간 지정</div>
      <div style="display:flex;align-items:center;gap:5px;">
        <input id="rdf-from" type="date" value="${escapeAttr(cur.from)}" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #dfe3e9;border-radius:6px;font-size:0.95em;">
        <span style="color:#bbb;">~</span>
        <input id="rdf-to" type="date" value="${escapeAttr(cur.to)}" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #dfe3e9;border-radius:6px;font-size:0.95em;">
      </div>
    </div>` : ''}
    <div style="border-top:1px solid #eceff3;padding:9px 12px 6px;">
      <input id="rdf-search" type="search" placeholder="${meta.date ? '날짜 검색 (예: 2026-09)' : escapeAttr(meta.label) + ' 검색'}" oninput="_rdfSearch(this.value)"
             style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #dfe3e9;border-radius:6px;font-size:0.95em;">
    </div>
    <label style="display:flex;align-items:center;gap:7px;padding:4px 12px 7px;cursor:pointer;font-weight:700;border-bottom:1px solid #eceff3;">
      <input type="checkbox" id="rdf-all" onchange="_rdfToggleAll(this.checked)"> <span>(모두 선택)</span>
    </label>
    <div id="rdf-list" style="max-height:210px;overflow-y:auto;padding:5px 0;">
      ${hasBlank ? item('', '(미입력)', counts['']) : ''}
      ${vals.map(v => item(v, disp(v), counts[v])).join('')}
      ${(!vals.length && !hasBlank) ? '<div style="padding:14px;text-align:center;color:#aaa;">표시할 값이 없습니다.</div>' : ''}
    </div>
    <div style="display:flex;gap:6px;padding:9px 12px;border-top:1px solid #eceff3;background:#fafbfc;">
      <button type="button" class="btn btn-primary btn-sm" style="flex:1;justify-content:center;" onclick="applyColFilter()">적용</button>
      <button type="button" class="btn btn-outline btn-sm" style="flex:1;justify-content:center;" onclick="clearColFilter()">필터 해제</button>
    </div>`;
  document.body.appendChild(panel);
  _rdfSyncAllBox();

  // 위치 — 버튼 아래, 화면 밖으로 나가지 않게 보정
  const r = btn ? btn.getBoundingClientRect() : { left: 40, bottom: 120 };
  const w = panel.offsetWidth, h = panel.offsetHeight;
  panel.style.left = Math.max(8, Math.min(r.left - 8, window.innerWidth - w - 8)) + 'px';
  panel.style.top = ((r.bottom + h + 8 > window.innerHeight)
    ? Math.max(8, window.innerHeight - h - 8)
    : r.bottom + 4) + 'px';

  setTimeout(() => document.addEventListener('mousedown', _rdfOutsideClick), 0);
}

// (모두 선택) 체크박스 상태 동기화 — 전체/부분/없음
function _rdfSyncAllBox() {
  const p = _rdfPanel(); if (!p) return;
  const all = p.querySelector('#rdf-all');
  const boxes = [...p.querySelectorAll('.rdf-chk')];
  const on = boxes.filter(b => b.checked).length;
  if (!all) return;
  all.checked = on > 0 && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}
function _rdfToggleAll(checked) {
  const p = _rdfPanel(); if (!p) return;
  // 검색으로 걸러진 항목만 토글 (엑셀 동작)
  [...p.querySelectorAll('.rdf-item')].forEach(li => {
    if (li.style.display === 'none') return;
    const cb = li.querySelector('.rdf-chk');
    if (cb) cb.checked = checked;
  });
  _rdfSyncAllBox();
}
function _rdfSearch(q) {
  const p = _rdfPanel(); if (!p) return;
  const key = String(q || '').toLowerCase().trim();
  [...p.querySelectorAll('.rdf-item')].forEach(li => {
    const hay = (li.getAttribute('data-key') || '').toLowerCase();
    li.style.display = (!key || hay.includes(key)) ? '' : 'none';
  });
  _rdfSyncAllBox();
}

function sortOrderCol(field, dir) {
  _orderSortCol = field;
  _orderSortDir = dir;
  closeColFilter();
  renderOrders();
}

function applyColFilter() {
  const p = _rdfPanel(); if (!p) return;
  const field = p.getAttribute('data-field');
  const fromEl = p.querySelector('#rdf-from');
  const toEl = p.querySelector('#rdf-to');
  const from = fromEl ? (fromEl.value || '') : '';
  const to   = toEl ? (toEl.value || '') : '';
  if (from && to && from > to) { alert('기간의 시작일이 종료일보다 늦습니다.'); return; }
  const boxes = [...p.querySelectorAll('.rdf-chk')];
  const checked = boxes.filter(b => b.checked).map(b => b.getAttribute('data-v'));
  if (boxes.length && !checked.length) { alert('최소 한 개 이상 선택하세요.'); return; }
  const values = (!boxes.length || checked.length === boxes.length) ? null : new Set(checked);
  if (!from && !to && !values) delete _colFilter[field];
  else _colFilter[field] = { from, to, values };
  closeColFilter();
  renderOrders();
}

function clearColFilter() {
  const p = _rdfPanel();
  const field = p ? p.getAttribute('data-field') : '';
  if (field) delete _colFilter[field];
  closeColFilter();
  renderOrders();
  if (typeof setBanner === 'function' && field)
    setBanner('ok', `✅ ${(ORDER_COLS[field] || {}).label || field} 필터 해제`);
}

// 활성 컬럼 필터 전체 해제 (목록 상단 배지에서 호출)
function clearAllColFilters() {
  _clearColFilters();
  renderOrders();
  if (typeof setBanner === 'function') setBanner('ok', '✅ 컬럼 필터 전체 해제');
}

// 현재 걸린 컬럼 필터 요약 배지 — 카운트 정보 옆에 표시
function _colFilterBadges() {
  const parts = [];
  for (const field in ORDER_COLS) {
    if (!_colFilterActive(field)) continue;
    const f = _colFilter[field];
    const meta = ORDER_COLS[field];
    let desc = '';
    if (f.values) {
      const arr = [...f.values].map(v => v === '' ? '(미입력)' : v);
      desc = arr.length <= 2 ? arr.join(', ') : `${arr.length}개 선택`;
    }
    if (f.from || f.to) desc = (desc ? desc + ' · ' : '') + `${f.from || '…'}~${f.to || '…'}`;
    parts.push(`<span style="background:#e3f2fd;color:#1565c0;border-radius:5px;padding:2px 7px;font-size:0.92em;font-weight:700;margin-right:4px;">
      ${escapeHtml(meta.label)}: ${escapeHtml(desc)}</span>`);
  }
  if (!parts.length) return '';
  return `<span style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px;margin-left:8px;">${parts.join('')}
    <button type="button" class="btn btn-xs btn-outline" onclick="clearAllColFilters()" style="margin-left:2px;">필터 전체 해제</button></span>`;
}

window.openColFilter       = openColFilter;
window.closeColFilter      = closeColFilter;
window.applyColFilter      = applyColFilter;
window.clearColFilter      = clearColFilter;
window.clearAllColFilters  = clearAllColFilters;
window.sortOrderCol        = sortOrderCol;
window.toggleOrderSort     = toggleOrderSort;
window._rdfToggleAll       = _rdfToggleAll;
window._rdfSearch          = _rdfSearch;
window._rdfSyncAllBox      = _rdfSyncAllBox;
// 하위 호환 별칭 (출고요청일 전용 API)
window.openReqDateFilter   = (ev) => openColFilter(ev, '출고요청일');
window.closeReqDateFilter  = closeColFilter;
window.applyReqDateFilter  = applyColFilter;
window.clearReqDateFilter  = clearColFilter;
window.sortReqDate         = (dir) => sortOrderCol('출고요청일', dir);

function renderOrders() {
  // ★ 2026-05 추가: 뷰 모드 탭 라벨 카운트 갱신 + 시각 동기화 (페이지 첫 진입 시)
  _updateViewModeCounts();
  _syncViewModeTabs();    // 탭 active 시각 적용 (renderOrders 재호출 없이)
  _renderColHeaders();   // 컬럼 헤더(정렬 화살표 + 필터 버튼) 갱신

  const f = getOrderFilters();
  const all = getEnriched();
  const filtered = filterOrders(all, f);
  // 카운트 정보 — 뷰 모드 명시
  const modeLabel = _orderViewMode === 'active'    ? '진행 중'
                  : _orderViewMode === 'completed' ? '완료'
                  : _orderViewMode === 'cancelled' ? '취소'
                  : '전체';
  document.getElementById('ordersCountInfo').innerHTML =
    `[${modeLabel}] 전체 ${all.length}건 중 <strong>${filtered.length}</strong>건 표시` + _colFilterBadges();
  const sumRev = filtered.reduce((s,o)=>s+o.수주총액,0);
  const sumProfit = filtered.reduce((s,o)=>s+o.영업이익,0);
  const sumRate = sumRev>0?(sumProfit/sumRev*100).toFixed(1):0;
  const sumQty = filtered.reduce((s,o)=>s+o.수량,0);
  const sb = document.getElementById('ordersSummaryBar');
  if (sb) {
    sb.style.display = 'flex';
    document.getElementById('osum-cnt').textContent = `${filtered.length}건`;
    document.getElementById('osum-rev').textContent = fmt(sumRev) + '원';
    document.getElementById('osum-profit').textContent = fmt(sumProfit) + '원';
    document.getElementById('osum-rate').textContent = sumRate + '%';
    document.getElementById('osum-qty').textContent = fmt(sumQty) + '매';
  }

  const tbody = document.getElementById('ordersTbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="21" class="empty">조건에 맞는 수주가 없습니다.</td></tr>`;
    _renderOrderPagination(0, 0, 0);
    return;
  }

  const sortedAll = applyOrderSort(filtered);
  // ★ 2026-05-13 페이지네이션 (Phase 2 · #1)
  //   페이지 크기 50/100/200/전체 — 사용자 설정 저장 (erp_orders_pagesize)
  //   필터·정렬 변경 시 1페이지로 리셋 (state.signature 변경 감지)
  const state = _getOrderPageState();
  const total = sortedAll.length;
  // 필터/정렬 시그니처가 바뀌면 1페이지로 리셋
  const sig = JSON.stringify({ f, sort: _orderSortCol+_orderSortDir, mode: _orderViewMode, rdf: _colFilterSig(), total });
  if (state.lastSig !== sig) { state.page = 1; state.lastSig = sig; _saveOrderPageState(state); }
  const pageSize = state.pageSize === 0 ? total : state.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  // 현재 페이지가 범위를 벗어나면 보정
  if (state.page > totalPages) { state.page = totalPages; _saveOrderPageState(state); }
  const startIdx = (state.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const sorted = sortedAll.slice(startIdx, endIdx);
  _renderOrderPagination(total, startIdx, endIdx);
  tbody.innerHTML = sorted.map((o,i) => {
    const _i = startIdx + i;     // 전체 인덱스 (페이지 가로질러 번호 연속)
    // 출고요청일 전날 = D-0 기준
    const dd = dDayLabel(o.출고요청일);
    const urgentBadge = dd.diff !== null && dd.diff >= 0 && dd.diff <= 7 ? `<span class="tag orange">${dd.label}</span>` : (dd.diff !== null && dd.diff < 0 ? `<span class="tag red">${dd.label}</span>` : '');
    const overdueTag = o.출고요청일 && o.출고요청일 < todayStr() && o.status==='수주' ? `<span class="tag red">납기초과</span>` : '';
    const cancelStyle = o.status === '취소' ? 'opacity:0.45;text-decoration:line-through;' : '';
    return `<tr style="${cancelStyle}">
      <td class="center"><input type="checkbox" class="order-row-cb" data-id="${o._id}" data-pjno="${o.pjNo}"></td>
      <td style="color:#aaa">${_i+1}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${o.담당자||'-'}</td>
      <td><a href="#" onclick="openOrderDetail('${o._id}');return false;" style="color:#1565c0;font-weight:700;">${o.pjNo}</a></td>
      <td style="white-space:nowrap;">${dateKo(o.수주일)}</td>
      <td class="ellip" title="${(o.고객사||'').replace(/"/g,'&quot;')}">${o.고객사||'-'}</td>
      <td><span class="tag" style="font-size:0.7em;">${o.제품군||'-'}</span></td>
      <td class="ellip-sm" title="${(o.제조사||'').replace(/"/g,'&quot;')}">${o.제조사||'-'}</td>
      <td class="ellip" title="${(o.모델명||'').replace(/"/g,'&quot;')}">${o.모델명||'-'}</td>
      <td style="text-align:right;">${fmt(o.수량)}</td>
      <td style="white-space:nowrap;">${dateKo(o.출고요청일)}${urgentBadge}${overdueTag}</td>
      <td class="center" style="font-size:0.82em;white-space:nowrap;">${o.계약금>0?(o.계약금입금?`<span class="tag green" style="cursor:pointer;font-size:0.82em;padding:2px 8px;" onclick="quickSetDeposit('${o._id}',false)" title="${fmt(o.계약금)}원 — 입금 취소">입금</span>`:`<span class="tag red" style="cursor:pointer;font-size:0.82em;padding:2px 8px;" onclick="quickSetDeposit('${o._id}',true)" title="${fmt(o.계약금)}원 — 입금처리">미입금</span>`):'<span style="color:#bbb;">-</span>'}</td>
      <td class="center" style="font-size:0.82em;white-space:nowrap;">${o.잔금>0?(o.잔금입금?`<span class="tag green" style="cursor:pointer;font-size:0.82em;padding:2px 8px;" onclick="quickSetBalance('${o._id}',false)" title="${fmt(o.잔금)}원 — 입금 취소">입금</span>`:`<span class="tag red" style="cursor:pointer;font-size:0.82em;padding:2px 8px;" onclick="quickSetBalance('${o._id}',true)" title="${fmt(o.잔금)}원 — 입금처리">미입금</span>`):'<span style="color:#bbb;">-</span>'}</td>
      <td class="center">${(o.deliveryOrderId && deliveryOrders.some(d => d.id === o.deliveryOrderId))
        ? `<span class="tag green" style="cursor:pointer;font-size:0.82em;" onclick="showTab('delivery')" title="${o.deliveryOrderId} — 클릭=출고지시서 탭">출고지시서</span>`
        : (typeof canCreateDO === 'function' && !canCreateDO(o))
          ? `<span class="tag" style="font-size:0.8em;background:#eceff1;color:#90a4ae;cursor:help;" title="${escapeAttr(doBlockReason(o))}">출고 대상 아님</span>`
          : `<button class="btn btn-xs btn-primary" style="font-size:0.78em;padding:2px 7px;" onclick="openDeliveryOrderModal('${o.pjNo}','${o._id}')" title="출고지시서 생성">생성</button>`}</td>
      <td class="ellip" title="${(o.발전소명||'').replace(/"/g,'&quot;')}">${o.발전소명||'-'}</td>
      <td class="ellip" title="${(o.납품주소||'').replace(/"/g,'&quot;')}">${o.납품주소||'-'}</td>
      <td>${fileCell(o._id, '발주서', o.발주서)}</td>
      <td>${fileCell(o._id, '허가증', o.허가증)}</td>
      <td>${fileCell(o._id, 'FD성적서', o.FD성적서)}</td>
      <td>${fileCell(o._id, '인증서', o.인증서)}</td>
    </tr>`;
  }).join('');

  // Update sortable column headers
  const thMap = {수주일:'수주일', 수주총액:'수주총액', 영업이익:'영업이익', 수량:'수량', 출고요청일:'출고요청일'};
  document.querySelectorAll('#ordersTable thead th[data-scol]').forEach(th => {
    const col = th.getAttribute('data-scol');
    const arrow = _orderSortCol===col ? (_orderSortDir===1?'↑':'↓') : '↕';
    th.innerHTML = (th.getAttribute('data-label')||col) + ` <span style="color:#aaa;font-size:0.8em;">${arrow}</span>`;
  });
}

// ── 수주현황 페이지네이션 (Phase 2 · #1) ────────────
const _ORDER_PAGE_KEY = 'erp_orders_pagesize';
function _getOrderPageState() {
  if (!window._orderPageState) {
    let pageSize = 50;
    try { pageSize = parseInt(localStorage.getItem(_ORDER_PAGE_KEY) || '50') || 50; } catch(e) {}
    window._orderPageState = { page: 1, pageSize, lastSig: '' };
  }
  return window._orderPageState;
}
function _saveOrderPageState(state) {
  window._orderPageState = state;
  try { localStorage.setItem(_ORDER_PAGE_KEY, String(state.pageSize)); } catch(e) {}
}

function setOrderPage(p) {
  const state = _getOrderPageState();
  state.page = Math.max(1, parseInt(p)||1);
  _saveOrderPageState(state);
  renderOrders();
  // 테이블 상단으로 스크롤
  const wrap = document.getElementById('ordersTblWrap');
  if (wrap) wrap.scrollTop = 0;
}
window.setOrderPage = setOrderPage;

function setOrderPageSize(size) {
  const state = _getOrderPageState();
  state.pageSize = parseInt(size)||50;
  state.page = 1;
  _saveOrderPageState(state);
  renderOrders();
}
window.setOrderPageSize = setOrderPageSize;

function _renderOrderPagination(total, startIdx, endIdx) {
  // 페이지네이션 UI 컨테이너 — 없으면 자동 생성 (ordersTblWrap 아래)
  let pg = document.getElementById('ordersPagination');
  if (!pg) {
    pg = document.createElement('div');
    pg.id = 'ordersPagination';
    pg.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 4px;padding:8px 12px;background:#fafbfc;border-radius:8px;flex-wrap:wrap;';
    const wrap = document.getElementById('ordersTblWrap');
    if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(pg, wrap.nextSibling);
  }
  if (total === 0) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';

  const state = _getOrderPageState();
  const pageSize = state.pageSize === 0 ? total : state.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const cur = state.page;

  // 페이지 번호 생성 (현재 ±3, 처음/끝 포함, 생략 ...)
  const pageButtons = [];
  const _add = (label, p, active, disabled) => {
    if (label === '...') { pageButtons.push(`<span style="color:#aaa;padding:0 6px;">…</span>`); return; }
    pageButtons.push(`<button class="btn btn-xs ${active?'btn-primary':'btn-outline'}" ${disabled?'disabled':''} onclick="setOrderPage(${p})" style="min-width:32px;padding:4px 8px;">${label}</button>`);
  };
  _add('◀', cur-1, false, cur <= 1);
  const showAround = 2;
  const pageSet = new Set([1, totalPages]);
  for (let p = Math.max(1, cur-showAround); p <= Math.min(totalPages, cur+showAround); p++) pageSet.add(p);
  const pagesArr = [...pageSet].sort((a,b) => a-b);
  let prev = 0;
  pagesArr.forEach(p => {
    if (p - prev > 1) _add('...', 0, false, true);
    _add(String(p), p, p === cur);
    prev = p;
  });
  _add('▶', cur+1, false, cur >= totalPages);

  pg.innerHTML = `
    <div style="font-size:0.86em;color:#555;">
      <strong>${startIdx + 1}–${endIdx}</strong> / 전체 ${total}건
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      ${pageButtons.join('')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:0.84em;color:#555;">
      <span>페이지 크기:</span>
      <select onchange="setOrderPageSize(this.value)" style="padding:4px 6px;border:1px solid #ccc;border-radius:5px;">
        <option value="50"  ${state.pageSize===50 ?'selected':''}>50</option>
        <option value="100" ${state.pageSize===100?'selected':''}>100</option>
        <option value="200" ${state.pageSize===200?'selected':''}>200</option>
        <option value="500" ${state.pageSize===500?'selected':''}>500</option>
        <option value="0"   ${state.pageSize===0  ?'selected':''}>전체</option>
      </select>
    </div>
  `;
}

function changeOrderStatus(id, status) {
  if (!localMeta[id]) localMeta[id] = {};
  const before = localMeta[id].status || '수주';
  localMeta[id].status = status;

  // ★ 2026-05 추가: 수주 상태가 '취소' 또는 '출고취소'로 변경되면
  //   연결된 출고지시서의 inventory 출고 레코드를 자동 정리 (재고 수량 복구).
  //   납품완료 → 수주 로 되돌릴 때도 재고 복구는 하지 않음 (DO가 살아있으면 OB 도 유지).
  if ((status === '취소' || status === '출고취소') && before !== status) {
    if (typeof deliveryOrders !== 'undefined' && typeof window._cleanupInventoryForDO === 'function') {
      const enriched = getEnriched().find(x => x._id === id);
      if (enriched && enriched.deliveryOrderId) {
        const d = deliveryOrders.find(x => x.id === enriched.deliveryOrderId);
        if (d) {
          const removed = window._cleanupInventoryForDO(d.id, d);
          if (removed > 0) {
            console.log('[changeOrderStatus] ' + status + ' — inventory 출고 ' + removed + '건 정리');
            if (typeof setBanner === 'function')
              setBanner('info', `🔄 ${status} → 재고 출고 레코드 ${removed}건 정리, 수량 복구됨`);
          }
        }
      }
    }
  }

  // ★ 2026-08: 납품완료 ↔ 출고관리(재고 출고이력) 동기화
  //   납품완료로 바뀌면 미출고 잔량만큼 '출고' 기록 생성,
  //   완료 상태에서 빠져나가면(수주로 되돌림·취소 등) 그 기록을 회수한다.
  const _COMPLETED = ['납품완료', '수금완료'];
  if (before !== status) {
    const _o = getEnriched().find(x => x._id === id);
    if (_o) {
      if (_COMPLETED.includes(status)) {
        // 납품일 자동 기록 (출고지시서 처리 경로와 동일하게)
        if (!localMeta[id].납품일) localMeta[id].납품일 = todayStr();
        const row = rawData.find(r => r._id === id);
        if (row && !row['납품일']) {
          row['납품일'] = localMeta[id].납품일;
          try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch (e) {}
        }
        const q = _syncOutboundForCompletedOrder(_o, localMeta[id].납품일);
        if (q > 0 && typeof setBanner === 'function')
          setBanner('ok', `📤 ${_o.pjNo} 납품완료 → 출고관리 ${fmt(q)}매 반영`);
      } else if (_COMPLETED.includes(before)) {
        const n = _removeOutboundForOrder(id);
        // 자동 완료된 건을 사람이 되돌린 경우 → 다시 자동 완료되지 않도록 제외 표시
        if (localMeta[id].autoCompleted) {
          delete localMeta[id].autoCompleted;
          delete localMeta[id].autoCompletedAt;
          localMeta[id].autoSkip = true;
        }
        if (n > 0 && typeof setBanner === 'function')
          setBanner('info', `🔄 납품완료 해제 → 자동 반영된 출고 기록 ${n}건 회수`);
      }
    }
  }

  saveLocal();
  renderOrders();
  renderDashboard();
  _refreshOutboundViews();     // ★ 출고관리·재고 화면 동기 갱신
}

// =====================================================
//  ORDER DETAIL MODAL
// =====================================================
let currentDetailId = null;

function openOrderDetail(id) {
  const o = getEnriched().find(x => x._id === id);
  if (!o) return;
  currentDetailPjNo = o.pjNo;
  currentDetailId = id;
  document.getElementById('orderDetailTitle').textContent = `📋 수주 상세 — ${o.pjNo}`;
  document.getElementById('orderDetailBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
      <div>
        <div class="sec-title">📋 기본 정보 <span style="font-size:0.72em;color:#aaa;font-weight:400;">(✏️ 각 항목 인라인 수정)</span></div>
        ${detailRow('담당자',o.담당자,{rawKey:'담당자',type:'text'})}${detailRow('PJ NO',o.pjNo,{rawKey:'PJ NO',type:'text'})}${detailRow('수주일',o.수주일,{rawKey:'수주일',type:'date'})}
        ${detailRow('고객사',o.고객사,{rawKey:'고객사',type:'text'})}${detailRow('발전소명',o.발전소명,{rawKey:'발전소명',type:'text'})}${detailRow('납품주소',o.납품주소,{rawKey:'납품주소',type:'text'})}
        ${detailRow('인수담당자',o.인수담당자||'-',{rawKey:'인수담당자',metaKey:'인수담당자',type:'text'})}${detailRow('배차정보',o.추가정보,{rawKey:'추가정보',metaKey:'배차정보',type:'text'})}
        ${detailRow('비고/요청사항', o.요청사항 ? `<span style="color:#c62828;">${escapeHtml(o.요청사항)}</span>` : '-', {rawKey:'비고',metaKey:'요청사항',type:'text'})}
        ${detailRow('수금 조건',
          (o.수금조건 ? `<span style="color:#1565c0;font-weight:600;">${escapeHtml(o.수금조건)}</span>` : '-')
          + ` <button class="btn btn-xs btn-success" style="margin-left:6px;padding:2px 8px;font-size:0.74em;" onclick="applyPayTermsAndReload('${id}')" title="수금조건의 % 비율을 수주총액(${fmt(o.수주총액||0)}원)에 곱해 각 결제 금액(계약금·중도금·잔금)으로 자동 반영">비율반영</button>`,
          {rawKey:'수금조건',metaKey:'수금조건',type:'text'})}
        <div class="sec-title" style="margin-top:16px;">🔖 상태 변경</div>
        <select onchange="changeOrderStatus('${id}',this.value)" style="padding:8px 12px;border-radius:7px;border:1.5px solid #ddd;">
          ${['수주','납품완료','수금완료','취소','출고취소'].map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div>
        <div class="sec-title">📦 제품 정보 <span style="font-size:0.72em;color:#aaa;font-weight:400;">(✏️ 각 항목 인라인 수정)</span></div>
        ${detailRow('제품군',o.제품군,{rawKey:'제품군',type:'text'})}${detailRow('제조사',o.제조사,{rawKey:'제조사',type:'text'})}${detailRow('매입NO',o.매입No,{rawKey:'매입NO',type:'text'})}
        ${detailRow('모델명',`<strong>${escapeHtml(o.모델명||'')}</strong>`,{rawKey:'모델명',type:'text'})}${detailRow('제품용량',o.제품용량,{rawKey:'제품용량(W)',type:'text'})}${detailRow('수량',fmt(o.수량)+'개',{rawKey:'수량',type:'number'})}
        ${detailRow('수주용량',o.수주용량kW+'kW',{rawKey:'수주용량(kW)',type:'text'})}
        <div class="sec-title" style="margin-top:16px;">💰 금액</div>
        ${detailRow('제품단가',fmt(o.제품단가)+'원',{rawKey:'제품단가(원)',type:'number'})}${detailRow('수주총액',fmt(o.수주총액)+'원',{rawKey:'수주총액(원)',type:'number'})}
        ${detailRow('총금액(VAT)',fmt(o.총금액VAT)+'원',{rawKey:'총금액(VAT포함)',type:'number'})}${detailRow('매입사',o.매입사,{rawKey:'매입사',type:'text'})}
        ${detailRow('매입단가',fmt(o.매입단가)+'원',{rawKey:'매입단가',type:'number'})}${detailRow('매입총액',fmt(o.매입총액)+'원',{rawKey:'매입총액(원)',type:'number'})}
        ${detailRow('영업이익','<strong style="color:#2ecc71;">'+fmt(o.영업이익)+'원</strong>',{rawKey:'영업이익(원)',type:'number'})}
        ${detailRow('이익률','<strong>'+o.영업이익률+'%</strong>',{rawKey:'영업이익률(%)',type:'number'})}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:10px;">
      <div>
        <div class="sec-title">📅 납기</div>
        ${detailRow('출고요청일',o.출고요청일||'-',{rawKey:'출고요청일',type:'date'})}
        <div class="sec-title" style="margin-top:16px;">💰 결제 정보</div>
        ${detailRow('계약금', o.계약금>0 ? fmt(o.계약금)+'원 &nbsp;' + (o.계약금입금
          ? `<span class="tag green">✅ 입금</span> <button class="btn btn-xs btn-gray" onclick="quickSetDeposit('${id}',false);openOrderDetail('${id}')">취소</button>`
          : `<span class="tag red">💰 미입금</span> <button class="btn btn-xs btn-green" onclick="quickSetDeposit('${id}',true);openOrderDetail('${id}')">입금처리</button>`) : '-')}
        ${o.중도금1>0 ? detailRow('중도금1', fmt(o.중도금1)+'원 &nbsp;'+(o.중도금1입금
          ? `<span class="tag green">✅ 입금</span> <button class="btn btn-xs btn-gray" onclick="quickSetMid('${id}',1,false);openOrderDetail('${id}')">취소</button>`
          : `<span class="tag red">미입금</span> <button class="btn btn-xs btn-green" onclick="quickSetMid('${id}',1,true);openOrderDetail('${id}')">입금처리</button>`)) : ''}
        ${o.중도금2>0 ? detailRow('중도금2', fmt(o.중도금2)+'원 &nbsp;'+(o.중도금2입금
          ? `<span class="tag green">✅ 입금</span> <button class="btn btn-xs btn-gray" onclick="quickSetMid('${id}',2,false);openOrderDetail('${id}')">취소</button>`
          : `<span class="tag red">미입금</span> <button class="btn btn-xs btn-green" onclick="quickSetMid('${id}',2,true);openOrderDetail('${id}')">입금처리</button>`)) : ''}
        ${o.중도금3>0 ? detailRow('중도금3', fmt(o.중도금3)+'원 &nbsp;'+(o.중도금3입금
          ? `<span class="tag green">✅ 입금</span> <button class="btn btn-xs btn-gray" onclick="quickSetMid('${id}',3,false);openOrderDetail('${id}')">취소</button>`
          : `<span class="tag red">미입금</span> <button class="btn btn-xs btn-green" onclick="quickSetMid('${id}',3,true);openOrderDetail('${id}')">입금처리</button>`)) : ''}
        ${detailRow('잔금', o.잔금>0 ? fmt(o.잔금)+'원 &nbsp;' + (o.잔금입금
          ? `<span class="tag green">✅ 입금</span> <button class="btn btn-xs btn-gray" onclick="quickSetBalance('${id}',false);openOrderDetail('${id}')">취소</button>`
          : `<span class="tag red">미입금</span> <button class="btn btn-xs btn-green" onclick="quickSetBalance('${id}',true);openOrderDetail('${id}')">입금처리</button>`) : '-')}
      </div>
      <div>
        <div class="sec-title">📁 서류</div>
        ${detailRow('발주서', docTagWithFile(o._id,'발주서',o.발주서))}
        ${detailRow('허가증', docTagWithFile(o._id,'허가증',o.허가증))}
        ${detailRow('FD 성적서', docTagWithFile(o._id,'FD성적서',o.FD성적서))}
        ${detailRow('인증서', docTagWithFile(o._id,'인증서',o.인증서))}
        ${detailRow('사용전검사', (o.사용전검사 ? `<span class="tag green">✓ ${escapeHtml(o.사용전검사)}</span>` : `<span class="tag">미등록</span>`) + ` <button class="btn btn-xs btn-dark" onclick="promptDocText('${id}','사용전검사일정')" title="등록">✏️</button>`)}
        ${(() => {
          // 사용전검사 입회자 — localMeta[id]._insp.attendee 와 연동
          const _insp = (typeof localMeta !== 'undefined' && localMeta[id] && localMeta[id]._insp) || {};
          const att = _insp.attendee || '';
          return `<div style="display:flex;gap:6px;margin-bottom:7px;font-size:0.87em;align-items:center;">
            <span style="color:#999;min-width:80px;font-weight:600;">입회자</span>
            <span style="display:flex;gap:6px;align-items:center;">
              <input type="text" id="insp-attendee-input" value="${escapeHtml(att)}" placeholder="이름" maxlength="5"
                     style="width:6em;padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:0.9em;"
                     onchange="if(typeof setInspectionAttendee==='function')setInspectionAttendee('${id}',this.value)">
              <button class="btn btn-xs btn-dark" onclick="if(typeof setInspectionAttendee==='function')setInspectionAttendee('${id}',document.getElementById('insp-attendee-input').value)" title="저장">저장</button>
            </span>
          </div>`;
        })()}
      </div>
    </div>
  `;
  // ★ 2026-08: 출고지시서 생성은 매입사가 광주창고 계열 · 탑솔라 인 건만 허용
  const btn = document.getElementById('orderDetailDeliveryBtn');
  if (btn) {
    const ok = (typeof canCreateDO === 'function') ? canCreateDO(o) : true;
    btn.disabled = !ok;
    btn.style.opacity = ok ? '' : '0.4';
    btn.style.cursor = ok ? '' : 'not-allowed';
    btn.title = ok ? '' : (typeof doBlockReason === 'function' ? doBlockReason(o) : '');
  }
  openModal('orderDetailModal');
}

// ★ 2026-05 확장: editConfig 인자 추가 — 각 필드 인라인 수정 지원
//   editConfig = { rawKey:'담당자', type:'text'|'number'|'date', metaKey:'요청사항' (선택) }
//   metaKey 가 있으면 localMeta 에 저장, 없으면 rawData 에 저장
//   글로벌 캐시(_editCfgs)에 설정 저장 → onclick 핸들러에선 id 만 참조하여 escape 부담 제거
window._editCfgs = window._editCfgs || {};
function detailRow(label, val, editConfig) {
  let editBtn = '';
  if (editConfig && currentDetailId) {
    const cfgKey = currentDetailId + '|' + (editConfig.rawKey || editConfig.metaKey || label);
    window._editCfgs[cfgKey] = { id: currentDetailId, label, cfg: editConfig };
    editBtn = `<button class="btn btn-xs btn-dark" style="margin-left:6px;padding:1px 7px;font-size:0.7em;line-height:1.2;" onclick="editOrderFieldByKey('${cfgKey.replace(/'/g,"&apos;")}')" title="${label} 수정">✏️</button>`;
  }
  return `<div style="display:flex;gap:6px;margin-bottom:7px;font-size:0.87em;align-items:center;"><span style="color:#999;min-width:80px;font-weight:600;">${label}</span><span style="flex:1;">${val||'-'}${editBtn}</span></div>`;
}

// 캐시된 설정으로 편집 진입
function editOrderFieldByKey(cfgKey) {
  cfgKey = cfgKey.replace(/&apos;/g,"'");
  const entry = window._editCfgs && window._editCfgs[cfgKey];
  if (!entry) { alert('수정 설정을 찾을 수 없습니다.'); return; }
  editOrderField(entry.id, entry.label, entry.cfg);
}
window.editOrderFieldByKey = editOrderFieldByKey;

// ── 각 필드 인라인 수정 (수주상세 ✏️ 버튼) ──────────────
//   raw 필드와 meta 필드 모두 지원 — rawKey OR metaKey
function editOrderField(id, label, cfg) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly(`'${label}' 수정`)) return;
  if (!cfg) return;
  const row = (typeof rawData !== 'undefined') ? rawData.find(r => r._id === id) : null;
  if (!row) { alert('수주를 찾을 수 없습니다.'); return; }
  const useMeta = !!cfg.metaKey;
  let curVal = '';
  if (useMeta) {
    curVal = (localMeta[id] && localMeta[id][cfg.metaKey]) || row[cfg.rawKey] || '';
  } else {
    curVal = row[cfg.rawKey] || '';
  }
  const promptMsg = `${label} 수정 (${cfg.type === 'number' ? '숫자' : cfg.type === 'date' ? 'YYYY-MM-DD' : '텍스트'}):`;
  const v = prompt(promptMsg, String(curVal));
  if (v === null) return;
  let newVal = v.trim();
  if (cfg.type === 'number') {
    const num = Number(String(newVal).replace(/,/g,''));
    if (newVal !== '' && isNaN(num)) { alert('숫자만 입력하세요.'); return; }
    newVal = newVal === '' ? '' : num;
  } else if (cfg.type === 'date') {
    if (newVal && !/^\d{4}-\d{2}-\d{2}$/.test(newVal)) {
      if (!confirm(`'${newVal}' 형식이 YYYY-MM-DD가 아닙니다. 그래도 저장할까요?`)) return;
    }
  }
  // ★ rawKey 가 있으면 rawData 도 함께 업데이트 (getEnriched 가 rawData 우선이므로 필수)
  //   metaKey 만 단독 사용하는 경우(meta-only field)는 localMeta 만 업데이트
  if (cfg.rawKey) {
    row[cfg.rawKey] = newVal;
  }
  if (cfg.metaKey) {
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id][cfg.metaKey] = newVal;
  }
  try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e) {}
  if (typeof saveLocal === 'function') saveLocal();
  // 캐시 무효화 (enriched 캐시)
  if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  // ★ 수금조건 수정 시 자동으로 비율 → 금액 반영
  let autoApplyMsg = '';
  if ((cfg.rawKey === '수금조건' || cfg.metaKey === '수금조건') && newVal) {
    const applied = applyPayTermsToOrder(id, /*silent=*/true);
    if (applied > 0) autoApplyMsg = ` · ${applied}개 항목 비율 자동 반영`;
  }
  if (typeof setBanner === 'function') setBanner('ok', `✅ ${label} 수정: ${newVal === '' ? '(빈 값)' : newVal}${autoApplyMsg}`);
  if (typeof renderOrders === 'function') try { renderOrders(); } catch(e) {}
  if (typeof renderDashboard === 'function') try { renderDashboard(); } catch(e) {}
  // 상세 모달 재렌더
  openOrderDetail(id);
}
window.editOrderField = editOrderField;

// ── 수금조건 → 결제 금액 자동 반영 (수주상세 비율반영 버튼) ──────
//   수금조건 텍스트(예: "계약금 20% 중도금 30% 잔금 50%")를 파싱하여
//   수주총액 × 비율 = 각 결제 금액으로 계산해 localMeta 에 저장
function applyPayTermsToOrder(id, silent) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('수금조건 비율 반영')) return 0;
  const enriched = (typeof getEnriched === 'function') ? getEnriched() : [];
  const o = enriched.find(x => x._id === id);
  if (!o) { if (!silent) alert('수주를 찾을 수 없습니다.'); return 0; }
  const terms = (localMeta[id] && localMeta[id].수금조건) || (o._raw && o._raw['수금조건']) || o.수금조건 || '';
  if (!terms || !terms.trim()) {
    if (!silent) setBanner('warn', '⚠️ 수금조건이 비어있습니다. 먼저 수금조건을 입력하세요.');
    return 0;
  }
  const parsed = parsePayTerms(terms);
  const total = Number(o.수주총액 || o.총금액VAT || 0);
  if (total <= 0) {
    if (!silent) setBanner('warn', '⚠️ 수주총액이 0입니다. 비율 적용 불가.');
    return 0;
  }
  if (!localMeta[id]) localMeta[id] = {};
  const FIELD_MAP = { deposit:'계약금', mid1:'중도금1', mid2:'중도금2', mid3:'중도금3', balance:'잔금' };
  let applied = 0;
  Object.entries(FIELD_MAP).forEach(([key, fieldName]) => {
    if (parsed[key] != null) {
      const amt = Math.round(total * parsed[key] / 100);
      localMeta[id][fieldName] = amt;
      applied++;
    }
  });
  if (applied > 0) {
    if (typeof saveLocal === 'function') saveLocal();
    if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  }
  if (!silent) {
    if (applied === 0) setBanner('warn', '⚠️ 수금조건에서 인식된 비율이 없습니다. 예: "계약금 20% 잔금 80%"');
    else setBanner('ok', `✅ 비율 → 금액 자동 반영 완료 (${applied}개 항목 · 수주총액 ${fmt(total)}원 기준)`);
  }
  return applied;
}
window.applyPayTermsToOrder = applyPayTermsToOrder;

// 수주상세에서 호출: 비율반영 버튼 클릭 → 적용 후 상세 재렌더
function applyPayTermsAndReload(id) {
  const n = applyPayTermsToOrder(id, false);
  if (n > 0) openOrderDetail(id);
}
window.applyPayTermsAndReload = applyPayTermsAndReload;

// ── 사용전검사 입회자 저장 — 수주상세에서 입력 → 영업탭 사용전검사에 반영 ──
function setInspectionAttendee(id, name) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('입회자 정보 수정')) return;
  const trimmed = (name || '').trim();
  if (typeof localMeta === 'undefined') window.localMeta = {};
  if (!localMeta[id]) localMeta[id] = {};
  if (!localMeta[id]._insp) localMeta[id]._insp = {};
  const prev = localMeta[id]._insp.attendee || '';
  localMeta[id]._insp.attendee = trimmed;
  // 입회자가 새로 지정되면 상태가 'unscheduled' 일 때 → 'planned' 로 자동 승격
  if (trimmed && !localMeta[id]._insp.status) {
    localMeta[id]._insp.status = 'planned';
  }
  if (typeof saveLocal === 'function') saveLocal();
  if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  if (typeof setBanner === 'function') {
    if (trimmed !== prev) setBanner('ok', `✅ 입회자 ${trimmed ? '저장: ' + trimmed : '제거'} — 영업 탭 사용전검사 반영됨`);
  }
  // 영업 탭 사용전검사 탭이 열려있으면 즉시 갱신
  if (typeof renderInspectionTab === 'function' && document.getElementById('sops-inspection-pane')?.style.display === 'block') {
    try { renderInspectionTab(); } catch(e) {}
  }
}
window.setInspectionAttendee = setInspectionAttendee;

function docTag(v) {
  if (!v) return '<span class="tag">미등록</span>';
  return `<span class="tag green">✓ ${v}</span>`;
}

function docTagWithFile(id, type, val) {
  // ★ 2026-05-12 nested(filesData[id][type]) + flat(filesData[id+'|'+type]) 통합 검색
  const fileEntry = (typeof getFileEntry === 'function') ? getFileEntry(id, type) : (filesData[id] && filesData[id][type]);
  const dlBtn = fileEntry
    ? `<button class="btn btn-xs btn-blue" onclick="downloadFile('${id}','${type}')" style="margin-left:4px;" title="${escapeHtml(fileEntry.name||type)} 다운로드">⬇️</button>`
    : '';
  const uploadBtn = `<button class="btn btn-xs btn-outline" onclick="triggerFileAttachOnCell('${id}','${type}');" style="margin-left:4px;" title="파일 업로드">📎</button>`;
  const editBtn = `<button class="btn btn-xs btn-dark" onclick="promptDocText('${id}','${type}')" style="margin-left:4px;" title="텍스트로 등록 (예: 발급일·번호·메모)">✏️</button>`;
  const valHtml = val
    ? `<span class="tag green">✓ ${escapeHtml(val)}</span>`
    : `<span class="tag">미등록</span>`;
  return `${valHtml}${dlBtn}${uploadBtn}${editBtn}`;
}

// 서류 항목 (발주서/허가증/FD성적서/인증서/사용전검사) 텍스트 데이터 등록
//   ★ 2026-05-13 이름을 빈 값으로 저장하면 첨부된 파일도 함께 삭제
function promptDocText(id, type) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly(`'${type}' 정보 수정`)) return;
  const row = (typeof rawData !== 'undefined') ? rawData.find(r => r._id === id) : null;
  const curVal = row ? (row[type] || '') : '';
  const hasFile = (typeof getFileEntry === 'function') ? !!getFileEntry(id, type) : !!(typeof filesData !== 'undefined' && filesData[id] && filesData[id][type]);
  const promptHint = hasFile
    ? `${type} 정보 (발급일·번호·메모 등)\n\n💡 비워두고 확인하면 첨부된 파일도 함께 삭제됩니다.`
    : `${type} 정보를 입력하세요 (발급일·번호·메모 등):`;
  const v = prompt(promptHint, curVal);
  if (v === null) return;  // 취소
  const newVal = v.trim();
  if (!row) { alert('수주를 찾을 수 없습니다.'); return; }

  // ★ 빈 값으로 저장 + 파일이 있으면 → 파일 삭제 확인
  let fileDeleted = false;
  if (!newVal && hasFile) {
    if (!confirm(`${type} 의 첨부 파일을 함께 삭제하시겠습니까?\n(취소 시 텍스트만 비우고 파일은 유지됩니다)`)) {
      // 파일 유지 — 텍스트만 비우기
    } else {
      // 파일 삭제 (양쪽 구조 모두)
      if (typeof filesData !== 'undefined') {
        if (filesData[id] && filesData[id][type]) {
          delete filesData[id][type];
          if (Object.keys(filesData[id]).length === 0) delete filesData[id];
        }
        const flatKey = id + '|' + type;
        if (filesData[flatKey]) delete filesData[flatKey];
        try { localStorage.setItem(KEYS.FILES || 'erp_files', JSON.stringify(filesData)); } catch(e) {}
      }
      fileDeleted = true;
    }
  }

  row[type] = newVal;
  if (typeof localMeta !== 'undefined') {
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id][type] = newVal;
  }
  try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e) {}
  if (typeof saveLocal === 'function') saveLocal();
  if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e) {} }
  if (typeof setBanner === 'function') {
    const msg = fileDeleted
      ? `🗑 ${type} 텍스트 + 파일 삭제 완료`
      : `✅ ${type} ${newVal?'등록':'삭제'} 완료${newVal?': '+newVal:''}`;
    setBanner('ok', msg);
  }
  if (typeof renderOrders === 'function') renderOrders();
  // 서류관리 탭 열린 경우 갱신
  if (typeof renderDocsTab === 'function' && document.getElementById('sops-docs-pane')?.style.display === 'block') {
    try { renderDocsTab(); } catch(e) {}
  }
  // 상세 모달 새로고침
  openOrderDetail(id);
}
window.promptDocText = promptDocText;

function fileCell(id, type, val) {
  const hasFile = filesData[id] && filesData[id][type];
  const label = val ? (val.length > 10 ? val.slice(0,10) + '…' : val) : '';
  const dndAttrs = `ondragover="onCellFileDragOver(event,this)" ondragleave="onCellFileDragLeave(event,this)" ondrop="onCellFileDrop(event,'${id}','${type}',this)" style="display:inline-block;padding:3px 6px;border-radius:6px;border:1px dashed transparent;cursor:pointer;transition:all .15s;min-height:18px;min-width:30px;"`;
  if (hasFile) {
    return `<span ${dndAttrs} title="${val||''}\n📎 첨부됨 — 클릭=다운로드 / 파일 드래그=교체" onclick="downloadFile('${id}','${type}')"><span class="tag green">📎 ${label}</span></span>`;
  }
  if (val) {
    return `<span ${dndAttrs} title="${val}\n파일 드래그=업로드" onclick="triggerFileAttachOnCell('${id}','${type}')"><span class="tag green">✓ ${label}</span></span>`;
  }
  // 빈 셀은 placeholder 없이 작은 점선 영역만 (드래그&클릭은 여전히 가능, 화면에는 안 보임)
  return `<span ${dndAttrs} title="파일을 드래그하거나 클릭하여 업로드" onclick="triggerFileAttachOnCell('${id}','${type}')"><span style="color:#d0d0d0;font-size:0.78em;">-</span></span>`;
}

// ── 셀 단위 파일 드래그업로드 핸들러 ──
function onCellFileDragOver(e, el) {
  e.preventDefault(); e.stopPropagation();
  if (el) { el.style.borderColor='#1565c0'; el.style.background='#eef5ff'; }
}
function onCellFileDragLeave(e, el) {
  if (el) { el.style.borderColor='transparent'; el.style.background=''; }
}
function onCellFileDrop(e, id, type, el) {
  e.preventDefault(); e.stopPropagation();
  if (el) { el.style.borderColor='transparent'; el.style.background=''; }
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('파일 크기가 5MB를 초과합니다.'); return; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    if (!filesData[id]) filesData[id] = {};
    filesData[id][type] = { name: file.name, data: ev.target.result, mimeType: file.type };
    // raw / meta 의 텍스트 필드도 업데이트 (파일명으로)
    const row = rawData.find(r => r._id === id);
    if (row) row[type] = file.name;
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id][type] = file.name;
    try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e2) {}
    try { localStorage.setItem(KEYS.FILES, JSON.stringify(filesData)); } catch(e2) {}
    saveLocal();
    if (typeof setBanner==='function') setBanner('ok', `📎 ${type} 첨부 완료: ${file.name}`);
    renderOrders();
  };
  reader.readAsDataURL(file);
}

// 셀 클릭 시 파일 선택 다이얼로그
function triggerFileAttachOnCell(id, type) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly(`'${type}' 파일 첨부`)) return;
  let inp = document.getElementById('cellFileInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.id = 'cellFileInput'; inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  inp.onchange = function(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('파일 크기가 5MB를 초과합니다.'); return; }
    const reader = new FileReader();
    reader.onload = function(e2) {
      if (!filesData[id]) filesData[id] = {};
      filesData[id][type] = { name: file.name, data: e2.target.result, mimeType: file.type };
      const row = rawData.find(r => r._id === id);
      if (row) row[type] = file.name;
      if (!localMeta[id]) localMeta[id] = {};
      localMeta[id][type] = file.name;
      try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e3) {}
      try { localStorage.setItem(KEYS.FILES, JSON.stringify(filesData)); } catch(e3) {}
      saveLocal();
      if (typeof _bumpEnrichedTs === 'function') { try { _bumpEnrichedTs(); } catch(e3) {} }
      if (typeof setBanner==='function') setBanner('ok', `📎 ${type} 첨부 완료: ${file.name}`);
      renderOrders();
      // ★ 2026-05-12 상세 모달 열린 상태에서 즉시 반영 (이전: 모달 닫고 다시 열어야 했음)
      if (currentDetailId === id && document.getElementById('orderDetailModal')?.classList.contains('open')) {
        try { openOrderDetail(id); } catch(e4) {}
      }
      // 서류관리 탭 열린 경우 갱신
      if (typeof renderDocsTab === 'function' && document.getElementById('sops-docs-pane')?.style.display === 'block') {
        try { renderDocsTab(); } catch(e4) {}
      }
    };
    reader.readAsDataURL(file);
    ev.target.value = '';
  };
  inp.click();
}

// =====================================================
//  FILE ATTACHMENT
// =====================================================
let _pendingFiles = {};
let _clearSavedFile = {}; // tracks fields where user manually edited text (intent to remove file link)

function onFileTextInput(type, value) {
  // User manually typed in the field → mark for file removal
  _clearSavedFile[type] = true;
  // If a pending file was attached this session, clear it too (user overrode it with text)
  delete _pendingFiles[type];
}

function triggerFileAttach(type) {
  document.getElementById('fileAttachType').value = type;
  document.getElementById('fileAttachInput').click();
}

function handleFileAttach(event) {
  const file = event.target.files[0];
  if (!file) return;
  const type = document.getElementById('fileAttachType').value;
  if (file.size > 5 * 1024 * 1024) {
    alert('파일 크기가 5MB를 초과합니다. 더 작은 파일을 선택해주세요.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    _pendingFiles[type] = { name: file.name, data: e.target.result, mimeType: file.type };
    // File explicitly attached → clear manual-edit flag for this type
    delete _clearSavedFile[type];
    const fieldMap = { '발주서': 'em-order-doc', '허가증': 'em-permit', 'FD성적서': 'em-fd', '인증서': 'em-cert' };
    const fieldId = fieldMap[type];
    if (fieldId) document.getElementById(fieldId).value = file.name;
    setBanner('ok', `📎 ${type} 파일 첨부: ${file.name}`);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function saveFilePending(id) {
  if (!Object.keys(_pendingFiles).length) return;
  if (!filesData[id]) filesData[id] = {};
  Object.assign(filesData[id], _pendingFiles);
  _pendingFiles = {};
}

function downloadFile(id, type) {
  const entry = filesData[id] && filesData[id][type];
  if (!entry) { alert('저장된 파일이 없습니다.'); return; }
  const a = document.createElement('a');
  a.href = entry.data;
  a.download = entry.name || `${id}_${type}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openDeliveryFromDetail() {
  closeModal('orderDetailModal');
  openDeliveryOrderModal(currentDetailPjNo, currentDetailId);
}

// 수주 상세 모달에서 ✏️ 수주 수정 클릭 → 상세 닫고 수정 모달 열기
function openEditFromDetail() {
  if (!currentDetailId) { alert('수정할 수주를 찾을 수 없습니다.'); return; }
  const id = currentDetailId;
  closeModal('orderDetailModal');
  setTimeout(() => {
    if (typeof openEditOrderModal === 'function') openEditOrderModal(id);
    else alert('수주 수정 모달 함수를 찾을 수 없습니다.');
  }, 80);
}
window.openEditFromDetail = openEditFromDetail;

// =====================================================
//  ORDER EDIT
// =====================================================
// 재고 모델 datalist 채우기 + 기존 수주 모델 포함
function populateModelDatalist() {
  const fromInv  = inventoryData.map(r => r.model).filter(Boolean);
  const fromDO   = deliveryOrders.map(d => d.model).filter(Boolean);
  const fromOrds = getEnriched().map(o => o.모델명).filter(Boolean);
  const fromPM   = Object.keys(productMaster || {}).filter(Boolean);
  const models = [...new Set([...fromPM, ...fromInv, ...fromDO, ...fromOrds])].sort();
  const dl = document.getElementById('em-model-list');
  if (dl) dl.innerHTML = models.map(m => `<option value="${encodeURIComponent(m)}" label="${m}">`).join('');
  // datalist value는 그대로 표시되어야 하므로 label 방식 대신 value로 직접
  if (dl) dl.innerHTML = models.map(m => `<option value="${m}">`).join('');
}

// 모델명 입력 시 제품용량(W) 자동 반영
function onEmModelInput() {
  const model  = (document.getElementById('em-model')?.value || '').trim();
  const wattEl = document.getElementById('em-watt');
  const mfrEl  = document.getElementById('em-mfr');
  if (!model) return;

  // ★ 1순위: 제품 마스터 (설정에서 직접 등록한 기준값 — 최우선)
  const pm = productMaster[model];
  if (pm) {
    if (wattEl) { wattEl.value = pm.watt; calcOrderTotals(); }
    if (mfrEl && !mfrEl.value && pm.mfr) mfrEl.value = pm.mfr;
    return;
  }

  // 2순위: 출고지시서 (watt 필드 보유)
  const doRec = [...deliveryOrders].reverse().find(d => (d.model||'').trim() === model && d.watt);
  if (doRec) {
    if (wattEl && !wattEl.value) { wattEl.value = doRec.watt; calcOrderTotals(); }
    if (mfrEl  && !mfrEl.value && doRec.mfr)  mfrEl.value = doRec.mfr;
    return;
  }

  // 3순위: 기존 수주 현황 (Google Sheets 값 — 오류 가능성 있음)
  const oRec = getEnriched().find(o => (o.모델명||'').trim() === model && o.제품용량);
  if (oRec) {
    if (wattEl && !wattEl.value) { wattEl.value = oRec.제품용량; calcOrderTotals(); }
    if (mfrEl  && !mfrEl.value && oRec.제조사) mfrEl.value = oRec.제조사;
  }
}

function openNewOrderModal() {
  _pendingFiles = {};
  _clearSavedFile = {};
  document.getElementById('em-row-id').value = '';
  document.getElementById('orderEditTitle').textContent = '➕ 수주 등록';
  populateModelDatalist();
  ['em-manager','em-pjno','em-customer','em-mfr','em-purno','em-model','em-watt',
   'em-kw','em-supplier','em-plant','em-address','em-receiver-contact','em-addinfo',
   'em-order-doc','em-permit','em-fd','em-cert','em-inspect','em-request'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  ['em-qty','em-unitprice','em-costprice','em-total','em-totalvat','em-costtotal','em-profit'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('em-profitrate').value = '';
  const today = todayStr();
  document.getElementById('em-date').value = today;
  document.getElementById('em-duedate').value = '';
  document.getElementById('em-original-pjno').value = '';
  document.getElementById('em-deposit').value = '';
  document.getElementById('em-deposit-paid').checked = false;
  ['em-mid1','em-mid2','em-mid3'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  ['em-mid1-paid','em-mid2-paid','em-mid3-paid'].forEach(id => { const el=document.getElementById(id); if(el) el.checked=false; });
  ['em-deposit-rate','em-mid1-rate','em-mid2-rate','em-mid3-rate','em-balance-rate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('em-balance').value = '';
  document.getElementById('em-balance-paid').checked = false;
  document.getElementById('em-product').value = '모듈';
  openModal('orderEditModal');
}

// =====================================================
//  결제 정보 비율 ↔ 금액 자동 변환
// =====================================================
function onPaymentRateInput(field) {
  const total = parseFloat(document.getElementById('em-total').value) || 0;
  const rate  = parseFloat(document.getElementById('em-' + field + '-rate').value);
  if (isNaN(rate) || !total) return;
  const amount = Math.round(total * rate / 100);
  const el = document.getElementById('em-' + field);
  if (el) el.value = amount > 0 ? amount : '';
}

function onPaymentAmtInput(field) {
  const total  = parseFloat(document.getElementById('em-total').value) || 0;
  const amount = parseFloat(document.getElementById('em-' + field).value);
  if (isNaN(amount) || !total) return;
  const rate = Math.round(amount / total * 1000) / 10;
  const el = document.getElementById('em-' + field + '-rate');
  if (el) el.value = rate > 0 ? rate : '';
}

// 수주총액 재계산 후 입력된 % 기준으로 금액도 업데이트
function syncPaymentRates() {
  ['deposit','mid1','mid2','mid3','balance'].forEach(f => {
    const rateEl = document.getElementById('em-' + f + '-rate');
    if (rateEl && rateEl.value) onPaymentRateInput(f);
  });
}

// "계약금 20% 중도금1 30% 중도금2 20% 잔금 30%" / "계약금 20% 납품3일전 80%" 등을 파싱
function parsePayTerms(str) {
  const result = { deposit:null, mid1:null, mid2:null, mid3:null, balance:null };
  if (!str) return result;
  const text = String(str).replace(/\s+/g, ' ').trim();
  // 순서대로 등장하는 "키워드 숫자%"를 찾음
  const patterns = [
    { re: /(계약금|선금)\s*(\d+(?:\.\d+)?)\s*%/g,  field: 'deposit' },
    { re: /중도금\s*1\s*(\d+(?:\.\d+)?)\s*%/g,      field: 'mid1' },
    { re: /중도금\s*2\s*(\d+(?:\.\d+)?)\s*%/g,      field: 'mid2' },
    { re: /중도금\s*3\s*(\d+(?:\.\d+)?)\s*%/g,      field: 'mid3' },
    // 숫자 없는 "중도금 30%" 는 mid1로
    { re: /중도금(?!\s*[123])\s*(\d+(?:\.\d+)?)\s*%/g, field: 'mid1' },
    // 잔금 / 납품N일전 / 납품후 / 검수후 → balance 로 간주
    { re: /(잔금|납품[^%\s]*|검수[^%\s]*|준공[^%\s]*)\s*(\d+(?:\.\d+)?)\s*%/g, field: 'balance' },
  ];
  patterns.forEach(({re, field}) => {
    let m;
    while ((m = re.exec(text)) !== null) {
      // 마지막 캡처 그룹이 숫자
      const num = parseFloat(m[m.length === 3 ? 2 : 1]);
      if (!isNaN(num) && result[field] == null) result[field] = num;
    }
  });
  return result;
}

function applyPayTermsToRates() {
  const termsEl = document.getElementById('em-payterms');
  const txt = termsEl ? termsEl.value : '';
  const parsed = parsePayTerms(txt);
  let applied = 0;
  ['deposit','mid1','mid2','mid3','balance'].forEach(f => {
    if (parsed[f] != null) {
      const rEl = document.getElementById('em-' + f + '-rate');
      if (rEl) { rEl.value = parsed[f]; onPaymentRateInput(f); applied++; }
    }
  });
  if (applied === 0) setBanner('warn', '⚠️ 인식된 비율이 없습니다. 예: "계약금 20% 잔금 80%"');
  else setBanner('ok', `✅ ${applied}개 항목의 비율이 자동 반영되었습니다.`);
}

function calcOrderTotals() {
  const qty   = parseFloat(document.getElementById('em-qty').value) || 0;
  const watt  = parseFloat(document.getElementById('em-watt').value) || 0;
  const unit  = parseFloat(document.getElementById('em-unitprice').value) || 0;
  const cost  = parseFloat(document.getElementById('em-costprice').value) || 0;

  const kw        = watt > 0 ? Math.round(qty * watt / 1000 * 100) / 100 : 0;
  const total     = qty * watt * unit;
  const totalVAT  = Math.round(total * 1.1);
  const costTotal = cost * watt * qty;
  const profit    = total - costTotal;
  const rate      = total > 0 ? (profit / total * 100).toFixed(1) : 0;

  if (kw > 0) document.getElementById('em-kw').value = kw;
  document.getElementById('em-total').value     = total;
  document.getElementById('em-totalvat').value  = totalVAT;
  document.getElementById('em-costtotal').value = costTotal;
  document.getElementById('em-profit').value    = profit;
  document.getElementById('em-profitrate').value = rate + '%';
  // 결제 비율이 입력된 경우 수주총액 변경에 따라 금액 자동 재계산
  syncPaymentRates();
}

function saveOrderEdit() {
  const rowId = document.getElementById('em-row-id').value.trim();
  const pjNo = document.getElementById('em-pjno').value.trim();
  const manager = document.getElementById('em-manager').value.trim();
  const customer = document.getElementById('em-customer').value.trim();
  if (!pjNo) { alert('PJ NO는 필수입니다.'); return; }
  // Build row object
  const newRow = {};
  HEADER_NAMES.forEach(h => newRow[h] = '');
  newRow['담당자'] = manager;
  newRow['PJ NO'] = pjNo;
  newRow['수주일'] = document.getElementById('em-date').value;
  newRow['고객사'] = customer;
  newRow['제품군'] = document.getElementById('em-product').value;
  newRow['제조사'] = document.getElementById('em-mfr').value;
  newRow['매입NO'] = document.getElementById('em-purno').value;
  newRow['모델명'] = document.getElementById('em-model').value;
  newRow['제품용량(W)'] = document.getElementById('em-watt').value;
  newRow['수량'] = document.getElementById('em-qty').value;
  newRow['수주용량(kW)'] = document.getElementById('em-kw').value;
  newRow['제품단가(원)'] = document.getElementById('em-unitprice').value;
  newRow['수주총액(원)'] = document.getElementById('em-total').value;
  newRow['총금액(VAT포함)'] = document.getElementById('em-totalvat').value;
  newRow['매입사'] = document.getElementById('em-supplier').value;
  newRow['매입단가'] = document.getElementById('em-costprice').value;
  newRow['매입총액(원)'] = document.getElementById('em-costtotal').value;
  newRow['영업이익(원)'] = document.getElementById('em-profit').value;
  newRow['영업이익률(%)'] = parseFloat(document.getElementById('em-profitrate').value)||0;
  newRow['출고요청일'] = document.getElementById('em-duedate').value;
  newRow['허가증'] = document.getElementById('em-permit').value;
  newRow['FD성적서'] = document.getElementById('em-fd').value;
  newRow['인증서'] = document.getElementById('em-cert').value;
  newRow['사용전검사일정'] = document.getElementById('em-inspect').value;
  newRow['발전소명'] = document.getElementById('em-plant').value;
  newRow['납품주소'] = document.getElementById('em-address').value;
  newRow['인수담당자'] = (document.getElementById('em-receiver-contact')?.value || '').trim();
  newRow['비고']       = (document.getElementById('em-request')?.value || '').trim();
  newRow['수금조건']   = (document.getElementById('em-payterms')?.value || '').trim();

  // ★ 신규 등록 시 PJ NO 중복 허용 — rowId 가 있을 때(=수정)만 동일 행에 덮어쓰기.
  //   동일 PJ NO 로 별도 수주 행을 자유롭게 추가할 수 있도록 신규 등록은 무조건 push.
  let idx = -1;
  if (rowId) {
    idx = rawData.findIndex(r => r._id === rowId);
  }
  const newId = rowId || (idx >= 0 ? rawData[idx]._id : genId());
  newRow._id = newId;

  if (idx >= 0) {
    rawData[idx] = newRow;
  } else {
    // 동일 PJ NO 가 이미 있어도 알림 후 별도 행으로 추가
    const dupCount = rawData.filter(r => String(r['PJ NO']||'').trim() === pjNo).length;
    if (dupCount > 0 && typeof setBanner === 'function') {
      setBanner('info', `ℹ️ "${pjNo}" 는 이미 ${dupCount}건 등록되어 있습니다. 별도 행으로 추가 등록됩니다.`);
    }
    rawData.push(newRow);
  }
  localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));

  // If GS URL set, try to push
  if (gsUrl) {
    fetch(gsUrl, { method:'POST', redirect:'follow', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action: idx>=0?'updateStatus':'appendOrder', pjNo, row: newRow }) })
    .catch(()=>{});
  }

  // Save payment info, extra fields to localMeta keyed by _id
  if (!localMeta[newId]) localMeta[newId] = {};
  localMeta[newId].인수담당자 = (document.getElementById('em-receiver-contact')?.value || '').trim();
  localMeta[newId].요청사항   = (document.getElementById('em-request')?.value || '').trim();
  localMeta[newId].배차정보   = (document.getElementById('em-addinfo')?.value || '').trim();
  localMeta[newId].수금조건   = (document.getElementById('em-payterms')?.value || '').trim();
  localMeta[newId].계약금 = parseFloat(document.getElementById('em-deposit').value) || 0;
  localMeta[newId].계약금입금 = document.getElementById('em-deposit-paid').checked;
  localMeta[newId].중도금1 = parseFloat(document.getElementById('em-mid1')?.value) || 0;
  localMeta[newId].중도금1입금 = !!(document.getElementById('em-mid1-paid')?.checked);
  localMeta[newId].중도금2 = parseFloat(document.getElementById('em-mid2')?.value) || 0;
  localMeta[newId].중도금2입금 = !!(document.getElementById('em-mid2-paid')?.checked);
  localMeta[newId].중도금3 = parseFloat(document.getElementById('em-mid3')?.value) || 0;
  localMeta[newId].중도금3입금 = !!(document.getElementById('em-mid3-paid')?.checked);
  localMeta[newId].잔금 = parseFloat(document.getElementById('em-balance').value) || 0;
  localMeta[newId].잔금입금 = document.getElementById('em-balance-paid').checked;
  localMeta[newId].발주서 = document.getElementById('em-order-doc').value.trim();
  saveLocal();
  // 파일 동기화: oninput 핸들러(_clearSavedFile)로 추적한 명시적 사용자 의도 기반
  const _fileFields = [
    { key: '발주서', id: 'em-order-doc' },
    { key: '허가증', id: 'em-permit' },
    { key: 'FD성적서', id: 'em-fd' },
    { key: '인증서', id: 'em-cert' },
  ];
  _fileFields.forEach(({ key, id: fid }) => {
    const textVal = document.getElementById(fid).value.trim();
    const hasSaved = filesData[newId] && filesData[newId][key];
    if (!textVal || _clearSavedFile[key]) {
      delete _pendingFiles[key];
      if (hasSaved) delete filesData[newId][key];
    }
  });
  saveFilePending(newId);
  if (filesData[newId] && !Object.keys(filesData[newId]).length) delete filesData[newId];
  saveFilesLocal();
  _clearSavedFile = {};
  closeModal('orderEditModal');
  renderOrders();
  renderDashboard();
  setBanner('ok', `✅ PJ NO ${pjNo} 저장 완료`);
}

function openEditOrderModal(id) {
  _pendingFiles = {};
  _clearSavedFile = {};
  populateModelDatalist();
  const o = getEnriched().find(x => x._id === id);
  if (!o) return;
  document.getElementById('em-row-id').value = id;
  document.getElementById('orderEditTitle').textContent = '✏️ 수주 수정';
  document.getElementById('em-original-pjno').value = o.pjNo;
  document.getElementById('em-manager').value = o.담당자 || '';
  document.getElementById('em-pjno').value = o.pjNo || '';
  document.getElementById('em-date').value = o.수주일 || '';
  document.getElementById('em-customer').value = o.고객사 || '';
  document.getElementById('em-product').value = o.제품군 || '모듈';
  document.getElementById('em-mfr').value = o.제조사 || '';
  document.getElementById('em-purno').value = o.매입No || '';
  document.getElementById('em-model').value = o.모델명 || '';
  document.getElementById('em-watt').value = o.제품용량 || '';
  document.getElementById('em-qty').value = o.수량 || '';
  document.getElementById('em-kw').value = o.수주용량kW || '';
  document.getElementById('em-unitprice').value = o.제품단가 || '';
  document.getElementById('em-total').value = o.수주총액 || '';
  document.getElementById('em-totalvat').value = o.총금액VAT || '';
  document.getElementById('em-supplier').value = o.매입사 || '';
  document.getElementById('em-costprice').value = o.매입단가 || '';
  document.getElementById('em-costtotal').value = o.매입총액 || '';
  document.getElementById('em-profit').value = o.영업이익 || '';
  document.getElementById('em-profitrate').value = o.영업이익률 != null ? String(o.영업이익률) : '';
  document.getElementById('em-duedate').value = o.출고요청일 || '';
  document.getElementById('em-plant').value = o.발전소명 || '';
  document.getElementById('em-address').value = o.납품주소 || '';
  const rcEl = document.getElementById('em-receiver-contact'); if(rcEl) rcEl.value = o.인수담당자 || '';
  document.getElementById('em-addinfo').value = o.추가정보 || '';
  const reqEl = document.getElementById('em-request'); if(reqEl) reqEl.value = o.요청사항 || '';
  const payEl = document.getElementById('em-payterms'); if(payEl) payEl.value = o.수금조건 || '';
  document.getElementById('em-order-doc').value = o.발주서 || '';
  document.getElementById('em-permit').value = o.허가증 || '';
  document.getElementById('em-fd').value = o.FD성적서 || '';
  document.getElementById('em-cert').value = o.인증서 || '';
  // 사용전검사 — 날짜 input 호환을 위해 YYYY-MM-DD 형식으로 정규화
  (function(){
    const el = document.getElementById('em-inspect');
    if (!el) return;
    let v = String(o.사용전검사 || '').trim();
    if (!v) { el.value = ''; return; }
    // 다양한 입력 포맷 → YYYY-MM-DD
    if (typeof normalizeDate === 'function') v = normalizeDate(v);
    // YYYY-MM-DD 패턴이면 그대로, 아니면 비움
    el.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  })();
  document.getElementById('em-deposit').value = o.계약금 || '';
  document.getElementById('em-deposit-paid').checked = !!o.계약금입금;
  const m1El=document.getElementById('em-mid1'); if(m1El) m1El.value=o.중도금1||'';
  const m1pEl=document.getElementById('em-mid1-paid'); if(m1pEl) m1pEl.checked=!!o.중도금1입금;
  const m2El=document.getElementById('em-mid2'); if(m2El) m2El.value=o.중도금2||'';
  const m2pEl=document.getElementById('em-mid2-paid'); if(m2pEl) m2pEl.checked=!!o.중도금2입금;
  const m3El=document.getElementById('em-mid3'); if(m3El) m3El.value=o.중도금3||'';
  const m3pEl=document.getElementById('em-mid3-paid'); if(m3pEl) m3pEl.checked=!!o.중도금3입금;
  document.getElementById('em-balance').value = o.잔금 || '';
  document.getElementById('em-balance-paid').checked = !!o.잔금입금;
  // 저장된 금액으로 비율 역산 표시
  const _tot = o.수주총액 || 0;
  const _pairs = [['deposit',o.계약금],['mid1',o.중도금1],['mid2',o.중도금2],['mid3',o.중도금3],['balance',o.잔금]];
  _pairs.forEach(([f, amt]) => {
    const el = document.getElementById('em-' + f + '-rate');
    if (el && amt > 0 && _tot > 0) el.value = Math.round(amt / _tot * 1000) / 10;
    else if (el) el.value = '';
  });
  openModal('orderEditModal');
}

// 수주 삭제 시 다른 모듈에 남은 잔존 데이터를 정리
//   - 출고지시서(deliveryOrders): pjNo 또는 rowId 매칭
//   - 배차(dispatch): items 배열에서 출고지시서 ID 제거
//   - 입고예정(incoming): pjNo 매칭 (있을 경우)
//   - 채권(aging): pjNo 매칭 (있을 경우)
function _cascadeCleanupOrder(id, pjNo) {
  // 1) 출고지시서 정리 + 그 지시서가 만든 재고 출고 레코드까지 함께 정리
  //    ★ 2026-08 수정: 기존에는 deliveryOrders 배열에서만 지워 inventoryData 의
  //      'OB-DO-...' 출고 레코드가 남아, 수주를 지워도 출고관리 목록에 계속 보였다.
  const removedDoIds = [];
  let removedInv = 0;
  if (typeof deliveryOrders !== 'undefined' && Array.isArray(deliveryOrders)) {
    const before = deliveryOrders.length;
    for (let i = deliveryOrders.length - 1; i >= 0; i--) {
      const d = deliveryOrders[i];
      if (d.rowId === id || (pjNo && d.pjNo === pjNo)) {
        removedDoIds.push(d.id);
        // splice 전에 재고 레코드 정리 (매칭에 d 의 pjNo·model·date 사용)
        if (typeof window._cleanupInventoryForDO === 'function') {
          try { removedInv += window._cleanupInventoryForDO(d.id, d) || 0; } catch (e) {}
        }
        deliveryOrders.splice(i, 1);
      }
    }
    if (deliveryOrders.length !== before) {
      // ★ 2026-08 수정: 저장 키 오타 정정 ('erp_delivery_orders' → KEYS.DELIVERY)
      try { localStorage.setItem((typeof KEYS !== 'undefined' && KEYS.DELIVERY) || 'erp_delivery', JSON.stringify(deliveryOrders)); } catch(e) {}
    }
  }
  // 1-b) 납품완료 자동반영으로 생성된 출고 레코드(OB-ORD-...) 정리
  if (typeof _removeOutboundForOrder === 'function') {
    try { removedInv += _removeOutboundForOrder(id) || 0; } catch (e) {}
  }
  if (removedInv > 0) console.log('[cascadeCleanup] ' + (pjNo || id) + ' — 재고 출고 레코드 ' + removedInv + '건 정리');
  // 2) 배차 items에서 출고지시서 제거
  if (removedDoIds.length && typeof dispatch !== 'undefined' && dispatch.removeFrom) {
    try {
      dispatch.list().forEach(d => {
        (d.items || []).forEach(doId => {
          if (removedDoIds.includes(doId)) {
            try { dispatch.removeFrom(d.id, doId); } catch(e) {}
          }
        });
      });
    } catch(e) {}
  }
  // 3) 입고예정 정리 (pjNo 매칭)
  if (pjNo && typeof incoming !== 'undefined' && incoming.list && incoming.remove) {
    try {
      incoming.list().filter(x => x.pjNo === pjNo).forEach(x => {
        try { incoming.remove(x.id); } catch(e) {}
      });
    } catch(e) {}
  }
  // 4) 채권 정리 (pjNo 매칭)
  if (pjNo && typeof aging !== 'undefined' && aging.list && aging.remove) {
    try {
      aging.list().filter(x => x.pjNo === pjNo).forEach(x => {
        try { aging.remove(x.id); } catch(e) {}
      });
    } catch(e) {}
  }
}

function deleteOrder(id) {
  const o = getEnriched().find(x => x._id === id);
  if (!o) return;
  const pjNo = o.pjNo;
  if (!confirm(`PJ NO "${pjNo}" 수주를 삭제합니까?\n이 작업은 되돌릴 수 없습니다.\n(연결된 출고지시서·배차·입고예정·채권도 함께 정리됩니다)`)) return;
  rawData = rawData.filter(r => r._id !== id);
  localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));
  delete localMeta[id];
  delete filesData[id];
  _cascadeCleanupOrder(id, pjNo);
  saveLocal();
  saveFilesLocal();
  renderOrders();
  renderDashboard();
  if (typeof renderDeliveryList === 'function') try { renderDeliveryList(); } catch(e) {}
  if (typeof showDeliveryList === 'function' && document.getElementById('deliveryListArea')?.querySelector('table')) {
    try { showDeliveryList(); } catch(e) {}
  }
  setBanner('ok', `✅ PJ NO ${pjNo} 삭제 완료`);
}

// 체크박스로 선택된 수주 일괄 삭제
function deleteSelectedOrders() {
  const cbs = document.querySelectorAll('.order-row-cb:checked');
  if (!cbs.length) { alert('삭제할 항목을 선택하세요.'); return; }
  const ids = [...cbs].map(cb => cb.getAttribute('data-id')).filter(Boolean);
  if (!ids.length) return;
  if (!confirm(`선택한 수주 ${ids.length}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.\n(연결된 출고지시서·배차·입고예정·채권도 함께 정리됩니다)`)) return;

  const enriched = getEnriched();
  const pjList = ids.map(id => (enriched.find(x => x._id === id) || {}).pjNo).filter(Boolean);

  rawData = rawData.filter(r => !ids.includes(r._id));
  localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));
  ids.forEach(id => { delete localMeta[id]; delete filesData[id]; });
  ids.forEach((id, i) => _cascadeCleanupOrder(id, pjList[i]));
  saveLocal();
  saveFilesLocal();
  renderOrders();
  renderDashboard();
  if (typeof showDeliveryList === 'function' && document.getElementById('deliveryListArea')?.querySelector('table')) {
    try { showDeliveryList(); } catch(e) {}
  }
  if (typeof _refreshOutboundViews === 'function') _refreshOutboundViews();   // ★ 출고관리·재고 목록 동기 갱신
  // 전체선택 체크 해제
  const sa = document.getElementById('orderSelectAll'); if (sa) sa.checked = false;
  setBanner('ok', `✅ 수주 ${ids.length}건 삭제 완료${pjList.length ? ' (' + pjList.slice(0,3).join(', ') + (pjList.length>3?' 외 '+(pjList.length-3)+'건':'') + ')' : ''}`);
}
window.deleteSelectedOrders = deleteSelectedOrders;

// =====================================================
//  납품완료 → 출고관리(재고 출고이력) 자동 반영 (2026-08 추가)
//
//  출고지시서를 거치지 않고 수주현황에서 바로 "납품완료" 처리한 건은
//  inventoryData 에 출고 기록이 남지 않아 출고관리·재고관리에서 누락됐다.
//  이제 납품완료 시 미출고 잔량만큼 '출고' 레코드를 자동 생성한다.
//
//   · 레코드 ID = OB-ORD-<수주 _id>  → 여러 번 실행해도 1건만 유지 (멱등)
//   · 잔량 = 수주수량 − 출고지시서 발행수량
//     (출고지시서 발행분은 생성 시점에 이미 재고 반영됨 → 이중 차감 방지)
//   · 납품완료 해제·취소 시 _removeOutboundForOrder() 로 회수
// =====================================================
function _doQtyOfOrder(o) {
  if (typeof deliveryOrders === 'undefined' || !Array.isArray(deliveryOrders)) return 0;
  return deliveryOrders
    .filter(d => (o._id && d.rowId === o._id) || (o.pjNo && d.pjNo === o.pjNo))
    .reduce((a, d) => a + (Number(d.qty) || 0) + (Number(d.foc) || 0), 0);
}

function _syncOutboundForCompletedOrder(o, day) {
  if (typeof inventoryData === 'undefined' || !o || !o._id) return 0;
  const model = String(o.모델명 || '').trim();
  if (!model) return 0;
  const recId = 'OB-ORD-' + o._id;
  if (inventoryData.some(r => r.id === recId)) return 0;      // 이미 반영됨
  const remain = (Number(o.수량) || 0) - _doQtyOfOrder(o);
  if (remain <= 0) return 0;                                   // 출고지시서로 전량 반영 완료
  inventoryData.push({
    id: recId,
    type: '출고',
    date: day || o.납품일 || (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10)),
    model,
    qty: remain,
    mfr: o.제조사 || '',
    pjNo: o.pjNo || '',
    warehouse: (typeof suggestWarehouseForModel === 'function') ? suggestWarehouseForModel(model) : '',
    bl: '',
    remarks: `납품완료 자동반영 (${o.pjNo || ''}${o.고객사 ? ' · ' + o.고객사 : ''})`
  });
  return remain;
}

function _removeOutboundForOrder(orderId) {
  if (typeof inventoryData === 'undefined' || !orderId) return 0;
  const before = inventoryData.length;
  inventoryData = inventoryData.filter(r => !(r.type === '출고' && r.id === 'OB-ORD-' + orderId));
  return before - inventoryData.length;
}

// 출고관리·재고 화면 갱신 (열려 있을 때만 의미 있음 — 모두 guard 호출)
function _refreshOutboundViews() {
  ['renderOutboundHistory', 'renderShipModelTbody', 'renderStockTab', 'renderInventory', 'renderInventoryHistory']
    .forEach(fn => { if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} } });
}

window._syncOutboundForCompletedOrder = _syncOutboundForCompletedOrder;
window._removeOutboundForOrder = _removeOutboundForOrder;
window._refreshOutboundViews = _refreshOutboundViews;

// =====================================================
//  선택 수주 일괄 납품완료 처리 (2026-08 추가)
//   - 체크된 수주의 상태를 '납품완료'로 변경 + 납품일 기록 (meta / rawData 동기화)
//   - 연결된 출고지시서가 '대기' 상태면 함께 출고완료 처리 (양쪽 화면 상태 일치)
//   - 재고는 건드리지 않음 — 출고지시서 생성 시점에 이미 '출고' 레코드가 반영되므로
//     여기서 다시 차감하면 이중 차감이 됨
// =====================================================
function completeSelectedOrders() {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('납품완료 처리')) return;
  const cbs = document.querySelectorAll('.order-row-cb:checked');
  if (!cbs.length) { alert('납품완료 처리할 항목을 선택하세요.'); return; }
  const ids = [...cbs].map(cb => cb.getAttribute('data-id')).filter(Boolean);
  if (!ids.length) return;

  const enriched = getEnriched();
  const targets = ids.map(id => enriched.find(x => x._id === id)).filter(Boolean);
  const DONE = ['납품완료', '수금완료'];
  const already = targets.filter(o => DONE.includes(o.status || ''));
  const todo    = targets.filter(o => !DONE.includes(o.status || ''));
  if (!todo.length) { alert('선택한 건은 이미 납품완료(또는 수금완료) 상태입니다.'); return; }

  const day = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
  const doPending = todo.filter(o => o.deliveryOrderId && typeof deliveryOrders !== 'undefined'
    && deliveryOrders.some(d => d.id === o.deliveryOrderId && !d.processed)).length;
  const preview = todo.slice(0, 3).map(o => o.pjNo).join(', ') + (todo.length > 3 ? ` 외 ${todo.length - 3}건` : '');

  if (!confirm(
    `선택한 수주 ${todo.length}건을 납품완료 처리하시겠습니까?\n\n` +
    `· 상태 → 납품완료 / 납품일 → ${day}\n` +
    (doPending ? `· 대기중인 출고지시서 ${doPending}건도 함께 출고완료 처리됩니다.\n` : '') +
    (already.length ? `· 이미 완료된 ${already.length}건은 제외됩니다.\n` : '') +
    `\n(${preview})`
  )) return;

  let doDone = 0, obQty = 0;
  todo.forEach(o => {
    const id = o._id;
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id].status = '납품완료';
    if (!localMeta[id].납품일) localMeta[id].납품일 = day;
    // rawData 납품일 컬럼 동기화 (getEnriched 는 납품일을 raw 에서 읽음)
    const row = rawData.find(r => r._id === id);
    if (row && !row['납품일']) row['납품일'] = localMeta[id].납품일;
    // 연결된 출고지시서가 대기 상태면 함께 출고완료
    if (o.deliveryOrderId && typeof deliveryOrders !== 'undefined') {
      const d = deliveryOrders.find(x => x.id === o.deliveryOrderId);
      if (d && !d.processed) { d.processed = true; doDone++; }
    }
    // ★ 2026-08: 출고관리(재고 출고이력) 자동 반영 — 미출고 잔량만큼 '출고' 기록
    obQty += _syncOutboundForCompletedOrder(o, day);
  });

  try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch (e) {}
  saveLocal();

  // 선택 해제
  document.querySelectorAll('.order-row-cb:checked').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('orderSelectAll'); if (sa) sa.checked = false;

  renderOrders();
  renderDashboard();
  if (typeof showDeliveryList === 'function' && document.getElementById('deliveryListArea')?.querySelector('table')) {
    try { showDeliveryList(); } catch (e) {}
  }
  if (typeof renderSplitTab === 'function') { try { renderSplitTab(); } catch (e) {} }
  _refreshOutboundViews();     // ★ 출고관리·재고 화면 동기 갱신
  setBanner('ok', `✅ 수주 ${todo.length}건 납품완료 처리`
    + (doDone ? ` · 출고지시서 ${doDone}건 출고완료` : '')
    + (obQty ? ` · 출고관리 반영 ${fmt(obQty)}매` : '')
    + (already.length ? ` (이미 완료 ${already.length}건 제외)` : ''));
}
window.completeSelectedOrders = completeSelectedOrders;

// =====================================================
//  직송 건 자동 출고완료 (2026-08 추가)
//
//  매입사가 광주창고·탑솔라 계열이 아니어서 출고지시서를 발행하지 않는 건
//  (= 목록에 "출고 대상 아님" 으로 표시되는 직송 물량) 은 우리가 출고 처리를
//  할 일이 없어 계속 "수주" 상태로 남는다.
//  → 출고요청일이 지나면 자동으로 납품완료 처리하고 출고관리(재고 출고이력)에 반영한다.
//
//   대상 : canCreateDO(o) === false  AND  출고요청일 < 오늘  AND  진행중(수주) 상태
//   처리 : status='납품완료' · 납품일=출고요청일 · OB-ORD 출고 레코드 생성
//   표시 : localMeta[id].autoCompleted = true  (자동 처리분 추적·되돌리기용)
//   해제 : localStorage 'erp_auto_direct_complete' = 'off'  → 자동 실행 중지
//          (수동 실행은 콘솔에서 autoCompleteDirectShipments({verbose:true}))
// =====================================================
const AUTO_DIRECT_KEY = 'erp_auto_direct_complete';

function isAutoDirectCompleteOn() {
  try { return localStorage.getItem(AUTO_DIRECT_KEY) !== 'off'; } catch (e) { return true; }
}
function setAutoDirectComplete(on) {
  try { localStorage.setItem(AUTO_DIRECT_KEY, on ? 'on' : 'off'); } catch (e) {}
  if (typeof setBanner === 'function')
    setBanner('ok', on ? '⚡ 직송 자동 출고완료 켜짐' : '⏸ 직송 자동 출고완료 꺼짐');
}
window.isAutoDirectCompleteOn = isAutoDirectCompleteOn;
window.setAutoDirectComplete = setAutoDirectComplete;

// 자동 완료 대상 목록 (실행 없이 확인만)
function autoCompleteCandidates() {
  if (typeof getEnriched !== 'function') return [];
  const today = todayStr();
  let list;
  try { list = getEnriched(); } catch (e) { return []; }
  return list.filter(o => {
    if (ARCHIVE_STATUSES.has(o.status || '')) return false;          // 이미 완료·취소
    if (!o.출고요청일 || o.출고요청일 >= today) return false;         // 출고요청일 미도래
    if (typeof canCreateDO === 'function' && canCreateDO(o)) return false;  // 출고지시서 발행 대상 → 수동 처리
    if (localMeta[o._id] && localMeta[o._id].autoSkip) return false;  // 사람이 되돌린 건 → 자동 처리 제외
    if ((Number(o.수량) || 0) <= 0) return false;
    return true;
  });
}
window.autoCompleteCandidates = autoCompleteCandidates;

//  실행 — opts.verbose: 대상이 없을 때도 안내, opts.confirm: 확인창 표시
function autoCompleteDirectShipments(opts) {
  opts = opts || {};
  if (typeof blockIfReadOnly === 'function' && !opts.force && blockIfReadOnly('직송 자동 출고완료')) return 0;
  const list = autoCompleteCandidates();
  if (!list.length) {
    if (opts.verbose && typeof setBanner === 'function') setBanner('info', '자동 출고완료 대상이 없습니다.');
    return 0;
  }
  if (opts.confirm) {
    const preview = list.slice(0, 5).map(o => `· ${o.pjNo} ${o.모델명} ${fmt(o.수량)}매 (요청일 ${o.출고요청일})`).join('\n');
    if (!confirm(`출고요청일이 지난 직송 건 ${list.length}건을 출고완료 처리할까요?\n\n`
      + `${preview}${list.length > 5 ? `\n· 외 ${list.length - 5}건` : ''}\n\n`
      + `상태 → 납품완료 / 납품일 → 각 건의 출고요청일\n출고관리(재고 출고이력)에도 함께 반영됩니다.`)) return 0;
  }

  const day = todayStr();
  let obQty = 0;
  const done = [];
  list.forEach(o => {
    const id = o._id;
    if (!localMeta[id]) localMeta[id] = {};
    localMeta[id].status = '납품완료';
    // 납품일은 실제로 나갔어야 할 날짜(출고요청일)로 기록
    if (!localMeta[id].납품일) localMeta[id].납품일 = o.출고요청일 || day;
    localMeta[id].autoCompleted = true;
    localMeta[id].autoCompletedAt = day;
    const row = rawData.find(r => r._id === id);
    if (row && !row['납품일']) row['납품일'] = localMeta[id].납품일;
    obQty += _syncOutboundForCompletedOrder(o, localMeta[id].납품일);
    done.push(o.pjNo);
  });

  try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch (e) {}
  saveLocal();

  if (typeof renderOrders === 'function') { try { renderOrders(); } catch (e) {} }
  if (typeof renderDashboard === 'function') { try { renderDashboard(); } catch (e) {} }
  _refreshOutboundViews();

  console.log('[AUTO-DIRECT] 출고요청일 경과 직송 자동 출고완료 ' + list.length + '건:', done.join(', '));
  if (typeof setBanner === 'function')
    setBanner('ok', `⚡ 출고요청일 경과 직송 ${list.length}건 자동 출고완료`
      + (obQty ? ` · 출고관리 ${fmt(obQty)}매 반영` : ''));
  return list.length;
}
window.autoCompleteDirectShipments = autoCompleteDirectShipments;

// 자동 실행 — 부팅 후 1회 + 수주현황 탭 진입 시 (중복 실행돼도 대상이 없으면 no-op)
let _autoDirectRunning = false;
function runAutoDirectComplete() {
  if (_autoDirectRunning || !isAutoDirectCompleteOn()) return;
  if (typeof rawData === 'undefined' || !rawData.length) return;
  _autoDirectRunning = true;
  try { autoCompleteDirectShipments({ force: true }); } catch (e) { console.warn('[AUTO-DIRECT] 실패:', e); }
  _autoDirectRunning = false;
}
window.runAutoDirectComplete = runAutoDirectComplete;

if (typeof document !== 'undefined') {
  const _boot = () => setTimeout(runAutoDirectComplete, 1800);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();
}

// =====================================================
//  BULK ORDER REGISTRATION (다량발주등록)
// =====================================================
let _bulkParsed = [];

function toggleBulkSection() {
  const body = document.getElementById('bulkOrderBody');
  const btn = document.querySelector('#bulkOrderCard .btn-xs');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.textContent = isOpen ? '▼' : '▲';
}

// ── 날짜 정규화: 다양한 포맷을 YYYY-MM-DD로 변환 ──
//   "4/1" / "4-1"           → 현재연도 기준 YYYY-MM-DD
//   "26-04-01" / "26.4.29"  → 20YY-MM-DD
//   "2026-04-01" / "2026/4/29" → YYYY-MM-DD
//   반환: 인식 실패 시 원본 문자열 그대로 반환
function _normalizeDate(s) {
  const str = String(s || '').trim().replace(/\.$/, '');
  if (!str) return '';
  const pad = n => String(n).padStart(2, '0');
  const thisYear = new Date().getFullYear();

  // M/D or M-D or M.D  (연도 없음 → 현재 연도)
  let m = str.match(/^(\d{1,2})\s*[.\-\/]\s*(\d{1,2})$/);
  if (m) {
    const mo = parseInt(m[1], 10), dy = parseInt(m[2], 10);
    if (mo>=1 && mo<=12 && dy>=1 && dy<=31) return `${thisYear}-${pad(mo)}-${pad(dy)}`;
  }
  // YY-MM-DD or YY.MM.DD or YY/MM/DD  (2자리 연도)
  m = str.match(/^(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})$/);
  if (m) {
    const yy = parseInt(m[1], 10), mo = parseInt(m[2], 10), dy = parseInt(m[3], 10);
    if (mo>=1 && mo<=12 && dy>=1 && dy<=31) return `20${pad(yy)}-${pad(mo)}-${pad(dy)}`;
  }
  // YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
  m = str.match(/^(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})$/);
  if (m) {
    const yy = parseInt(m[1], 10), mo = parseInt(m[2], 10), dy = parseInt(m[3], 10);
    if (mo>=1 && mo<=12 && dy>=1 && dy<=31) return `${yy}-${pad(mo)}-${pad(dy)}`;
  }
  return str;  // 인식 실패 → 원본 유지
}

// ── 셀 값 타입 분류 (v2: 회사명/발전소명 패턴 강화) ──
function _bulkClassifyCell(v) {
  const s = String(v || '').trim();
  if (!s) return null;

  // [v2] 카테고리/구분 셀 — "외판 / 탑", "자체 / 화신이엔지" 등
  if (/^[가-힣A-Za-z0-9]{1,12}\s*\/\s*[가-힣A-Za-z0-9 ]{1,15}$/.test(s) && s.length < 30) return 'category';

  // 날짜: 2026. 4. 29 / 2026-04-29 / 26.4.29 / 2026/4/29
  if (/^(20)?\d{2}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}\.?$/.test(s)) return 'date';
  // 날짜(연도 생략): 4/1 · 4-1 · 12.25
  if (/^\d{1,2}\s*[.\-\/]\s*\d{1,2}$/.test(s)) {
    const [a, b] = s.split(/[.\-\/]/).map(x => parseInt(x.trim(), 10));
    if (a>=1 && a<=12 && b>=1 && b<=31) return 'date';
  }
  // 전화번호
  if (/^0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}$/.test(s)) return 'phone';
  // PJ NO: 대문자2~5 + 하이픈 + 숫자
  if (/^[A-Z]{2,5}-\d+(-\d+)?$/.test(s)) return 'pjno';
  // 모델명: 대문자+숫자 + 하이픈 포함 긴 식별자
  if (/^[A-Z][A-Z0-9]{1,}-[A-Z0-9-]{3,}/.test(s) && s.length >= 8 && !/^[A-Z]{2,5}-\d+$/.test(s)) return 'model';

  // [v2] 고객사 분류 강화
  // (1) 법인명 표기
  if (/\(주\)|\(유\)|주식회사|유한회사|㈜|㈐|㈑/.test(s) && s.length < 30) return 'customer';
  // (2) 회사 접미사 (한글) — 공백 제거 후 매칭
  const sNoSpace = s.replace(/\s+/g, '');
  if (sNoSpace.length >= 3 && sNoSpace.length < 25 &&
      /(에너지|솔라|솔루션|이엔지|이엔씨|엔지니어링|테크|테크놀로지|시스템|시스템즈|코퍼레이션|상사|상회|개발|건설|전기|기술|산업|글로벌|일렉트릭|일렉|EC|E&C|파워|에코|그린|컴퍼니)$/i.test(sNoSpace) &&
      !/(발전소|태양광|호$|자가용)/.test(s)) return 'customer';

  // 주소: 도/시/군/구 + 숫자 번지
  const isAddrLike = /([가-힣]+(도|광역시|특별시|특별자치도|특별자치시)\s+)?[가-힣]+(시|군|구)\s.*\d/.test(s) &&
                     /(길|로|동|리|번지|읍|면|가)/.test(s);

  // [v2] 발전소+주소 복합 셀 분리 — 발전소|태양광|자가용 또는 "○○호" 접두 + 주소
  //  단, 첫 단어가 도/광역시 약자(전남·경기·강원 등)면 일반 주소
  const PROVINCES_SHORT = /^(전남|전북|경기|충남|충북|강원|경남|경북|제주|광주|부산|대구|대전|울산|인천|서울|세종)$/;
  if (isAddrLike) {
    if (/발전소|태양광|자가용/.test(s)) return 'plant_address';
    if (/^\S+(?:\d+호|\d+~\d+호)\s+[가-힣]+(시|도|광역시|군|구)/.test(s)) return 'plant_address';
    const firstWordMatch = s.match(/^([가-힣]{2,8})\s/);
    if (firstWordMatch && !PROVINCES_SHORT.test(firstWordMatch[1])) return 'plant_address';
    return 'address';
  }

  // [v2] 발전소명 강화
  if (/(발전소|태양광)/.test(s) && s.length < 50) return 'plant';
  if (/(\d+호|\d+~\d+호|\d+호기)(?!\s*\d)/.test(s) && s.length < 40) return 'plant';   // "황우1~3호 (추가)" 등
  if (/^(자가용|일반용|상업용|산업용|학교|마을|복지센터|공장)/.test(s) && s.length < 40) return 'plant';

  // 인수담당자: 이름+직함 (전화 포함 가능)
  if (/(이사|부장|차장|과장|대리|사원|팀장|본부장|소장|대표|실장|주임|사장|회장|상무|전무|이사장|센터장|점장|지점장)/.test(s) && s.length < 60) return 'contact';
  // 배차/물류 메모
  if (/(톤|카고|윙바디|배차|트럭|간격|분|시간|적재|지게차|오전|오후|운송비|착불|선불|후불)/.test(s)) return 'memo';
  // 순수 정수
  if (/^\d{1,6}$/.test(s)) {
    const n = parseInt(s);
    if (n >= 1 && n <= 999999) return 'integer';
  }
  // 실수 (용량 kW)
  if (/^\d+\.\d+$/.test(s)) return 'decimal';
  // 콤마 포함 숫자
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return 'integer';
  // 짧은 영숫자 코드 (FOC 등)
  if (/^[A-Z][A-Z0-9]{1,8}$/.test(s)) return 'code';
  // 담당자 짧은 한글 이름
  if (/^[가-힣]{2,4}$/.test(s)) return 'koreanName';

  return 'unknown';
}

// ── 분류 결과를 HEADER_NAMES 필드에 매핑 ────────────
function _bulkMapSmart(cols) {
  const row = {};
  HEADER_NAMES.forEach(h => row[h] = '');
  const used = new Array(cols.length).fill(false);
  const cls  = cols.map(_bulkClassifyCell);
  const find = (type) => cls.findIndex((c,i) => !used[i] && c === type);
  const findAll = (type) => cls.map((c,i) => !used[i] && c === type ? i : -1).filter(i => i >= 0);
  const take = (i, field, val) => { if (i < 0) return; row[field] = (val != null ? val : cols[i].trim()); used[i] = true; };

  // 1. 날짜 (첫 번째 → 출고요청일, 두 번째 → 수주일) — YYYY-MM-DD로 정규화
  const dates = findAll('date');
  if (dates[0] != null) take(dates[0], '출고요청일', _normalizeDate(cols[dates[0]]));
  if (dates[1] != null) take(dates[1], '수주일',    _normalizeDate(cols[dates[1]]));

  // 2. PJ NO
  take(find('pjno'), 'PJ NO');
  // 3. 모델명
  take(find('model'), '모델명');
  // 4. 고객사
  take(find('customer'), '고객사');
  // 5. [v2] 발전소+주소 복합 셀 분리 (3가지 패턴)
  const paIdx = find('plant_address');
  if (paIdx >= 0) {
    const v = cols[paIdx];
    let plantName = '', addr = '';
    // 패턴 A: "○○발전소|태양광..." + 주소
    let m = v.match(/^(.+?(?:발전소|태양광\S*))\s+(.+)$/);
    if (m) { plantName = m[1].trim(); addr = m[2].trim(); }
    else {
      // 패턴 B: "황우1~3호 (추가) 전남 화순군..." — 호+선택괄호 + 주소
      m = v.match(/^(\S*?(?:\d+호|\d+~\d+호|\d+호기)(?:\s*\([^)]*\))?)\s+([가-힣].*)$/);
      if (m) { plantName = m[1].trim(); addr = m[2].trim(); }
    }
    if (!plantName) {
      // 패턴 C: "자가용 전북 남원시 산정로..." — 짧은 한글 식별자 + 주소(도 약자 포함 가능)
      // 첫 단어가 식별자, 나머지가 도/시/군/구 키워드를 어디든 포함
      m = v.match(/^([가-힣]{2,8})\s+(.+)$/);
      if (m && /(시|군|구|도|광역시|특별시|특별자치도|특별자치시)/.test(m[2])) {
        plantName = m[1].trim();
        addr = m[2].trim();
      }
    }
    if (!plantName) {
      plantName = v; addr = '';
    }
    // 주소 끝의 "(○○○)" 보조정보가 발전소명일 수도 — 비고에 추가
    const tailParen = (addr || plantName).match(/\(([^)]+)\)\s*$/);
    if (tailParen && /[가-힣]/.test(tailParen[1])) {
      // 괄호 텍스트는 비고에 둠 (필요 시)
    }
    row['발전소명'] = plantName;
    if (addr) row['납품주소'] = addr;
    used[paIdx] = true;
  } else {
    take(find('plant'),   '발전소명');
    take(find('address'), '납품주소');
  }
  // 6. 인수담당자: 직함 있는 셀 우선, 없으면 전화
  const ctIdx = find('contact');
  if (ctIdx >= 0) take(ctIdx, '인수담당자');
  else take(find('phone'), '인수담당자');

  // 7. 수량 (정수) — 가장 작은 정수가 수량일 확률이 높지만, 큰 수(매 단위)일 수도 있음.
  //    여러 정수가 있으면 첫 번째가 보통 수량, 두 번째가 가격일 수 있음 → 용량(kW)은 decimal이므로 정수는 수량에만 할당.
  const ints = findAll('integer');
  if (ints[0] != null) take(ints[0], '수량');

  // 8. 용량 (decimal) — 단위(kW 등) 제거
  const decs = findAll('decimal');
  if (decs[0] != null) take(decs[0], '수주용량(kW)', _stripUnit(cols[decs[0]]));

  // 9. 메모/비고 + 카테고리(외판/탑 등)
  const memoIdxs = findAll('memo');
  const catIdxs  = findAll('category');
  const memoBin = [];
  memoIdxs.forEach(i => { memoBin.push(cols[i].trim()); used[i] = true; });
  catIdxs.forEach(i  => { memoBin.push(cols[i].trim()); used[i] = true; });

  // [v2] 위치 기반 보정 — 분류 못 잡은 한글 셀을 위치로 추정
  // 규칙: 날짜 직후 미할당 한글 셀 → 고객사(없을 때)
  //       고객사 다음 미할당 한글 셀 → 발전소명(없을 때)
  if (dates.length) {
    const dateIdx = dates[0];
    // 고객사 없을 때 — 날짜 직후 짧은 한글 셀
    if (!row['고객사']) {
      for (let i = dateIdx + 1; i < Math.min(dateIdx + 4, cols.length); i++) {
        if (used[i]) continue;
        const v = (cols[i] || '').trim();
        if (!v) continue;
        // 한글 포함 + 길이 25 이하 + 주소/발전소 키워드 없음
        if (/[가-힣]/.test(v) && v.length < 25 &&
            !/(시|군|구|로|길|동|리|읍|면|발전소|태양광)/.test(v) &&
            !/^\d/.test(v)) {
          row['고객사'] = v; used[i] = true; break;
        }
      }
    }
    // 발전소명 없을 때 — 고객사 셀 직후 미할당 셀
    if (!row['발전소명']) {
      // 고객사가 위치한 인덱스 찾기
      let custIdx = -1;
      for (let i = 0; i < cols.length; i++) {
        if (cols[i].trim() === row['고객사']) { custIdx = i; break; }
      }
      const startFrom = custIdx >= 0 ? custIdx + 1 : dateIdx + 1;
      for (let i = startFrom; i < Math.min(startFrom + 3, cols.length); i++) {
        if (used[i]) continue;
        const v = (cols[i] || '').trim();
        if (!v) continue;
        // 한글/숫자 혼합 + 주소 키워드 없음 + 길이 40 이하
        if (/[가-힣]/.test(v) && v.length < 40 &&
            !/(광역시|특별시|특별자치도|특별자치시|^\d)/.test(v)) {
          row['발전소명'] = v; used[i] = true; break;
        }
      }
    }
  }

  if (memoBin.length) row['비고'] = memoBin.join(' / ');

  // 10. 남은 미사용 셀은 비고에 붙임
  const leftovers = [];
  for (let i = 0; i < cols.length; i++) {
    if (used[i]) continue;
    const v = (cols[i] || '').trim();
    if (!v) continue;
    leftovers.push(v);
    used[i] = true;
  }
  if (leftovers.length) {
    row['비고'] = [row['비고'], leftovers.join(' / ')].filter(Boolean).join(' / ');
  }
  return row;
}

// ── 다량 붙여넣기 전용 컬럼 순서 ──────────────────────
//   ★ 2026-05 수정: 실제 엑셀 양식(바로(주) 영업매출 현황) 30열에 맞춤
//   누락됐던 '사용전검사일정' 컬럼 추가 (col 24) — 이전에는 off-by-one로
//   발전소명~수금조건이 한 칸씩 밀려 데이터 오인식 발생.
//   42열 시트(매출/수금 컬럼 포함)는 col 30 이후를 무시하도록 처리.
//   A=담당자 … S=영업이익률 · T=출고요청일 · U=납품일
//   V=허가증 · W=FD성적서 · X=인증서 · Y=사용전검사일정(24)
//   Z=발전소명(25) · AA=납품주소(26) · AB=인수담당자(27) · AC=비고(28) · AD=수금조건(29)
const BULK_PASTE_COLUMNS = [
  '담당자','PJ NO','수주일','고객사','제품군','제조사','매입NO','모델명',
  '제품용량(W)','수량','수주용량(kW)','제품단가(원)','수주총액(원)','총금액(VAT포함)',
  '매입사','매입단가','매입총액(원)','영업이익(원)','영업이익률(%)',
  '출고요청일',      // T (19)
  '납품일',          // U (20)
  '허가증','FD성적서','인증서','사용전검사일정',  // V~Y (21~24) ★ 사용전검사일정 추가
  '발전소명','납품주소','인수담당자','비고','수금조건'  // Z~AD (25~29)
];

// ★ 2026-05-08 추가: 구글시트 변형 양식 (담당자/PJ/수주일/고객사/제품군/제조사/매입NO/모델명/용량/수량/수주용량/
//   매입단가/매입원가/수주총액/출고요청일/상태/발전소명/납품주소/인수담당자/비고/수금조건)
//   표준 BULK_PASTE_COLUMNS 와 col 11 이후가 다름 — 매입단가가 col 11 로 앞당겨진 layout
const BULK_PASTE_COLUMNS_ALT = [
  '담당자',          // 0
  'PJ NO',           // 1
  '수주일',          // 2
  '고객사',          // 3
  '제품군',          // 4
  '제조사',          // 5
  '매입NO',          // 6
  '모델명',          // 7
  '제품용량(W)',     // 8
  '수량',            // 9
  '수주용량(kW)',    // 10
  '매입단가',        // 11 ← 표준은 제품단가
  '매입총액(원)',    // 12 ← 표준은 수주총액
  '수주총액(원)',    // 13 ← 표준은 총금액VAT
  '출고요청일',      // 14 ← 표준은 매입사
  '_status_ignored', // 15 — 사용자 상태(확정/취소 등) — 무시
  '발전소명',        // 16 ← 표준은 매입총액
  '납품주소',        // 17 ← 표준은 영업이익
  '인수담당자',      // 18 ← 표준은 영업이익률
  '비고',            // 19 ← 표준은 출고요청일
  '수금조건'         // 20 ← 표준은 납품일
];

// 사용자의 구글시트 양식인지 자동 감지
//   - col 14 가 날짜 패턴 (M/D, YY-M-D 등)
//   - col 15 가 한글 상태어 (확정/취소/대기 등)
//   → 두 조건 모두 만족하면 alt layout 으로 판단
function _bulkLooksAltLayout(cols) {
  if (cols.length < 16) return false;
  const c14 = (cols[14] || '').trim();
  if (!c14) return false;
  const isDate = /^\d{1,2}\/\d{1,2}$/.test(c14)
              || /^\d{2,4}[-./]\d{1,2}[-./]\d{1,2}$/.test(c14)
              || /^\d{4}\d{2}\d{2}$/.test(c14);
  if (!isDate) return false;
  const c15 = (cols[15] || '').trim();
  const isStatus = /^(확정|미확정|취소|대기|보류|완료|발주|진행|중지)$/.test(c15) || c15 === '';
  return isStatus;
}

// ALT layout 으로 직접 매핑
function _bulkMapByHeaderAlt(cols) {
  const rowObj = {};
  HEADER_NAMES.forEach(h => { rowObj[h] = ''; });
  const DATE_FIELDS = new Set(['수주일','출고요청일','납품일']);
  const NUMERIC_FIELDS = new Set([
    '제품용량(W)','수량','수주용량(kW)',
    '제품단가(원)','수주총액(원)','총금액(VAT포함)',
    '매입단가','매입총액(원)','영업이익(원)','영업이익률(%)'
  ]);
  const limit = Math.min(BULK_PASTE_COLUMNS_ALT.length, cols.length);
  for (let i = 0; i < limit; i++) {
    const h = BULK_PASTE_COLUMNS_ALT[i];
    if (h === '_status_ignored') continue;          // 상태 컬럼은 무시
    const raw = (cols[i] || '').trim();
    rowObj[h] = DATE_FIELDS.has(h)    ? _normalizeDate(raw)
              : NUMERIC_FIELDS.has(h) ? _stripUnit(raw)
              : raw;
  }
  return rowObj;
}

// ── 헤더가 있는 경우 (담당자 시작) 인덱스 기반 매핑 ─
// 숫자 필드에서 단위 꼬리(kW/W/원/개/% 등)를 제거하고 숫자만 남김
function _stripUnit(s) {
  const str = String(s || '').trim();
  if (!str) return '';
  // 숫자·콤마·소수점·부호만 남김
  const cleaned = str.replace(/[^\d.\-]/g, '').replace(/^-+/, '-').replace(/\.{2,}/g, '.');
  // ★ 2026-08: 숫자가 하나도 없으면 빈 값 (엑셀의 "-" 공란 표기 · "무상스페어" 같은 메모 방지)
  if (!/\d/.test(cleaned)) return '';
  return cleaned;
}

function _bulkMapByHeader(cols) {
  const rowObj = {};
  HEADER_NAMES.forEach(h => { rowObj[h] = ''; });
  const DATE_FIELDS = new Set(['수주일','출고요청일','납품일']);
  const NUMERIC_FIELDS = new Set([
    '제품용량(W)','수량','수주용량(kW)',
    '제품단가(원)','수주총액(원)','총금액(VAT포함)',
    '매입단가','매입총액(원)','영업이익(원)','영업이익률(%)'
  ]);

  // ★ 2026-05 변경: 직접 위치 매핑 방식 (tail-anchoring 제거)
  //   - 실제 엑셀(영업매출 현황 관리)은 30열 표준 양식이며,
  //     사용 환경에 따라 30+α(매출/계산서/수금 등)까지 확장된 행이 옵.
  //   - 이전 tail-anchor 로직은 30+ 컬럼 입력 시 cols[L-5..L-1]
  //     (수금완료금액·미수금·실제수금일 등)을 발전소명~수금조건에 잘못 채워
  //     데이터 오인식을 유발했음.
  //   - 새 로직은 0..29 까지 직접 위치 매핑하고 그 이후 컬럼은 무시.
  //     컬럼이 부족하면 가능한 만큼만 매핑.
  const limit = Math.min(BULK_PASTE_COLUMNS.length, cols.length);
  for (let i = 0; i < limit; i++) {
    const h = BULK_PASTE_COLUMNS[i];
    const raw = (cols[i] || '').trim();
    rowObj[h] = DATE_FIELDS.has(h)    ? _normalizeDate(raw)
              : NUMERIC_FIELDS.has(h) ? _stripUnit(raw)
              : raw;
  }
  // 30+ 컬럼은 매출/수금 영역 — 의도적으로 무시 (필요 시 향후 별도 모듈로 처리)
  return rowObj;
}

// =====================================================
//  [BULK v2] 헤더 자동 인식 + ALIAS 매핑
//  다양한 양식의 출고/매출 시트(영업매출/탑솔라/바로납품 등)
//  헤더만 함께 붙여넣으면 자동으로 표준 필드에 매핑.
// =====================================================
//
//  헤더 alias 사전 — 다양한 표기를 표준 필드명으로 정규화
const BULK_HEADER_ALIASES = (function() {
  // 정규화: 공백·줄바꿈·괄호 제거, 소문자
  const out = {};
  const add = (canonical, list) => list.forEach(k => out[_normHeaderKey(k)] = canonical);

  add('담당자',          ['담당자']);
  add('PJ NO',           ['pj no','pjno','pj번호','pj','발주번호','발주no','po','po번호','발주번호no']);
  add('수주일',          ['수주일','계약일']);
  add('고객사',          ['고객사','업체명','거래처','회사명','거래처명']);
  add('제품군',          ['제품군','품목군','구분']);
  // 제조사 — 일부 시트는 헤더 셀에 브랜드명("JA솔라","트리나","화웨이"…)을 그대로 둠
  add('제조사',          ['제조사','메이커','maker','브랜드','제조','ja솔라','jasolar','트리나','trina','론지','longi','진코','jinko','한화','hanwha','현대','hyundai','화웨이','huawei','q셀','qcells','qcell','효성','선그로우','sungrow']);
  add('매입NO',          ['매입no','매입 no','입고no','매입번호','입고번호']);
  add('모델명',          ['모델명','모듈명','model','품명','모델','모듈']);
  add('제품용량(W)',     ['제품용량','제품용량(w)','용량(w)','단품용량','셀용량','와트','watt']);
  add('수량',            ['수량','수량(ea)','매수','ea','수량ea','수량매']);
  add('수주용량(kW)',    ['수주용량','수주용량(kw)','용량','용량(kw)','입고용량','출고용량','전체용량','kw','전체kw']);
  add('제품단가(원)',    ['제품단가','제품단가(원)','단가','단가(원)','판매단가']);
  add('수주총액(원)',    ['수주총액','수주총액(원)','수주총액vat별도','수주_vat별도','공급가액','매출_vat별도','금액']);
  add('총금액(VAT포함)', ['총금액','총금액(vat포함)','vat포함','합계','총액','합계금액','총합계']);
  add('매입사',          ['매입사','매입처','구매처','매입처명']);
  add('매입단가',        ['매입단가','매입단가(원)','구매단가']);
  add('매입총액(원)',    ['매입총액','매입총액(원)','매입금액']);
  add('영업이익(원)',    ['영업이익','영업이익(원)','이익','이익(원)']);
  add('영업이익률(%)',   ['영업이익률','영업이익률(%)','이익률','이익률(%)','이익률%','영업이익률%']);
  add('출고요청일',      ['출고요청일','요청납기','납기','납기일','입고일자','출고일자','출고예정일','요청일','출고일','입고일']);
  add('납품일',          ['납품일','납품일자','매출일','출하일']);
  add('허가증',          ['허가증','발전사업허가증','허가증여부','발전사업허가']);
  add('FD성적서',        ['fd성적서','fd 성적서','fd','fd여부','성적서']);
  add('인증서',          ['인증서','ks인증서','ks','ks인증서여부']);
  add('사용전검사일정',  ['사용전검사','사용전검사일정','사용전검사일']);
  add('발전소명',        ['발전소명','현장명','현장','발전소','현장이름','대상지']);
  add('납품주소',        ['납품주소','주소','현장주소','배송지','배송주소','설치주소']);
  // 인수담당자 — '추가정보(현장담당,요청사항)' 같은 복합 헤더도 매핑 (실제 양식)
  add('인수담당자',      ['인수담당자','현장담당자','담당자현장','수령인','현장연락처','받는사람','현장담당',
                       '추가정보현장담당요청사항','추가정보현장담당','추가정보현장','현장담당요청사항']);
  // 비고 — 추가정보 alias 제거 (인수담당자 컬럼과 충돌 방지)
  add('비고',            ['비고','요청사항','메모','기타사항','잔량','잔량스페어','잔량/스페어','특이사항','납기변경히스토리','특이']);
  add('수금조건',        ['수금조건','결제조건','지불조건','결제방식']);
  return out;
})();

function _normHeaderKey(s) {
  return String(s||'').toLowerCase()
    .replace(/[\r\n\s]+/g,'')        // 공백·줄바꿈 제거
    .replace(/[\(\)（）\[\]［］{}<>「」『』]/g,'')   // 괄호 제거
    .replace(/[\.,\-_·•/\\:;]+/g,'')  // 구두점 제거
    .replace(/[?!*'"]/g,'')
    .trim();
}

// 헤더 행 여부 판단 — 셀 값 중 ALIAS 매칭률 ≥ 35% 이고 숫자 비율 낮으면 헤더
function _bulkIsHeaderRow(cols) {
  if (!cols || cols.length < 3) return false;
  const filled = cols.filter(c => String(c||'').trim() !== '');
  if (filled.length < 3) return false;
  let aliased = 0, numeric = 0;
  filled.forEach(c => {
    const k = _normHeaderKey(c);
    if (BULK_HEADER_ALIASES[k]) aliased++;
    if (/^[\d,.\-\s]+$/.test(String(c).trim())) numeric++;
  });
  // 매칭 35% 이상 + 숫자 셀 25% 이하 → 헤더
  return (aliased / filled.length) >= 0.35 && (numeric / filled.length) <= 0.25;
}

// 헤더 행에서 (정규화 → 표준필드) 매핑 인덱스 생성
//   1차: 완전 일치 매칭
//   2차: 부분 문자열(substring) 매칭 — 복합 헤더("추가 정보(현장담당, 요청사항)") 대응
function _bulkBuildHeaderMap(headerCols) {
  const map = {};   // colIdx → canonical field
  const taken = new Set();
  // 1차: exact match
  headerCols.forEach((h, i) => {
    const k = _normHeaderKey(h);
    if (BULK_HEADER_ALIASES[k]) {
      const canonical = BULK_HEADER_ALIASES[k];
      if (!taken.has(canonical)) { map[i] = canonical; taken.add(canonical); }
    }
  });
  // 2차: substring match — exact 미매칭 컬럼만 대상
  //   alias 키 길이 우선 (긴 키 먼저) — '추가정보현장담당요청사항' > '추가정보'
  const aliasKeysSorted = Object.keys(BULK_HEADER_ALIASES).sort((a,b) => b.length - a.length);
  headerCols.forEach((h, i) => {
    if (map[i] !== undefined) return;
    const k = _normHeaderKey(h);
    if (!k || k.length < 2) return;
    for (const ak of aliasKeysSorted) {
      if (ak.length < 3) continue;        // 너무 짧은 alias는 substring fallback 대상 외
      if (k.includes(ak) || ak.includes(k)) {
        const canonical = BULK_HEADER_ALIASES[ak];
        if (!taken.has(canonical)) { map[i] = canonical; taken.add(canonical); }
        break;
      }
    }
  });
  return map;
}

// 데이터 행을 헤더 맵으로 변환
function _bulkMapByAlias(cols, headerMap) {
  const rowObj = {};
  HEADER_NAMES.forEach(h => { rowObj[h] = ''; });
  const DATE_FIELDS    = new Set(['수주일','출고요청일','납품일']);
  const NUMERIC_FIELDS = new Set([
    '제품용량(W)','수량','수주용량(kW)',
    '제품단가(원)','수주총액(원)','총금액(VAT포함)',
    '매입단가','매입총액(원)','영업이익(원)','영업이익률(%)'
  ]);
  Object.entries(headerMap).forEach(([idx, field]) => {
    const i = parseInt(idx);
    const raw = String(cols[i] || '').trim();
    if (!raw) return;
    rowObj[field] = DATE_FIELDS.has(field)    ? _normalizeDate(raw)
                  : NUMERIC_FIELDS.has(field) ? _stripUnit(raw)
                  : raw;
  });
  // 비고 필드는 아직 매핑되지 않은 잔량/스페어 등을 추가
  return rowObj;
}

// 자기 회사명("바로(주)" 등) 자동 필터 — 고객사 셀이 자기회사면 발전소명을 고객사로 승격
function _bulkPostProcessRow(rowObj) {
  const company = (typeof appSettings !== 'undefined' && appSettings.companyName) ? appSettings.companyName.trim() : '';
  const norm = s => String(s||'').replace(/\(주\)|㈜|주식회사|\(유\)|\s+/g,'').toLowerCase();
  if (company && rowObj['고객사'] && norm(rowObj['고객사']) === norm(company)) {
    // 고객사 = 자기회사 → 잘못된 매핑. 발전소명을 고객사로 옮기지 말고 비워두기 (수동 보정 유도)
    rowObj['_고객사_warning'] = '자기회사명 감지 — 수정 권장';
    rowObj['고객사'] = '';
  }
  return rowObj;
}

// 포지셔널(표준 HEADER_NAMES 순서) 입력인지 감지
//   ★ 2026-05 수정: 담당자명 길이 제한 완화 (2~4 → 2~10).
//   "김빛날희호" 같은 5자 이상 합성 한글 이름이 _bulkMapSmart 폴백으로 빠져
//   30개 컬럼이 모두 비고에 슬래시 합쳐지는 버그 수정.
//   ★ 2026-08 수정: 담당자 셀에 2명 이상이 병기된 양식 ("김빛날희호 / 권오주",
//   "홍길동·이순신", "A, B") 이 _bulkClassifyCell 에서 'category' 로 분류되어
//   positional 감지에 실패 → 전체 컬럼이 비고로 합쳐지던 문제 수정.
//   담당자 셀이 이례적이어도 모델명(col 7)·수량(col 9) 자리가 표준과 맞으면
//   표준 양식으로 인정한다.

// 담당자 셀 형태 판별 — "홍길동" / "김빛날희호 / 권오주" / "홍길동·이순신" / "Hong" / "-" / ""
function _bulkLooksManagerName(s) {
  const v = String(s || '').trim();
  if (!v || v === '-') return true;          // 비어있거나 '-' 도 허용
  if (v.length > 40) return false;
  // 구분자(/ · , & | 외)로 여러 명이 병기될 수 있음
  const parts = v.split(/\s*[\/·,&|]\s*|\s+외\s+/).map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return false;
  return parts.every(p =>
       /^[가-힣]{2,10}$/.test(p)                    // 한글 이름 (합성 이름 포함)
    || /^[가-힣]{1,5}\s[가-힣]{1,5}$/.test(p)       // 공백 포함 한글 이름
    || /^[A-Za-z][A-Za-z0-9_.]{1,15}$/.test(p)      // 영문 ID
    || /^[A-Za-z]+\s[A-Za-z]+$/.test(p)             // 영문 이름
  );
}

function _bulkLooksPositional(cols) {
  if (cols.length < 15) return false;                       // 열 수가 충분히 많음
  const at = i => (cols[i] || '').trim();
  const c1 = at(1);
  // PJ NO 형식 (BR-260041 / Q26050700 / TI-... 등) — 표준 양식의 가장 강한 신호
  const pjNoOk = /^[A-Z]{1,4}[-]?\d{4,}$/i.test(c1) || /^[A-Z0-9]{2,}-?\d/i.test(c1);
  if (!pjNoOk) return false;
  if (_bulkLooksManagerName(at(0))) return true;
  // 담당자 셀이 이례적이어도 모델명(7)·수량(9) 자리가 표준과 맞으면 표준 양식으로 인정
  const model = at(7);
  const modelOk = model.length >= 6 && /[A-Za-z]/.test(model) && /\d/.test(model);
  const qtyOk = /^[\d,]+$/.test(at(9));
  return modelOk && qtyOk;
}

function parseBulkErpOrders() {
  const raw = document.getElementById('bulk-paste-area').value.trim();
  if (!raw) { document.getElementById('bulkPreviewArea').style.display = 'none'; return; }

  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (!lines.length) return;

  // [BULK v2] 헤더 자동 감지 + ALIAS 매핑
  // 첫 행이 헤더로 인식되면 그 매핑을 모든 행에 적용
  let headerMap = null;
  let dataStartIdx = 0;
  let modeUsed = '';
  // 행별 실제 사용된 매핑 방식 집계 (안내 문구용) — 2026-08 추가
  const _modeCount = { alias: 0, positional: 0, alt: 0, smart: 0 };

  // 위에서부터 최대 5행까지 헤더 후보 검색 (제목·월구분·소계 행 스킵)
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cells = lines[i].split('\t').map(c => c.trim());
    if (_bulkIsHeaderRow(cells)) {
      headerMap = _bulkBuildHeaderMap(cells);
      dataStartIdx = i + 1;
      modeUsed = 'alias';
      break;
    }
  }

  // 기존 호환: "담당자" 시작 양식
  if (!headerMap && lines[0].split('\t')[0].trim() === '담당자') {
    dataStartIdx = 1;
    modeUsed = 'positional';
  }

  _bulkParsed = [];
  const dataLines = lines.slice(dataStartIdx);

  dataLines.forEach(line => {
    const cols = line.split('\t').map(c => c.trim());
    if (cols.length < 2) return;

    // 빈 행 / 합계 행 / 월구분 행 자동 스킵
    const filled = cols.filter(c => c !== '').length;
    if (filled < 2) return;
    if (cols.length <= 3 && /^(1|2|3|4|5|6|7|8|9|10|11|12)월$|^(1|2|3|4)분기$|^[ㄱ-힣]+계$|^합계$|^소계$|^total$/i.test(cols[0])) return;

    let rowObj;

    if (headerMap) {
      // [BULK v2] 헤더 인식 성공 → ALIAS 매핑
      rowObj = _bulkMapByAlias(cols, headerMap);
      _modeCount.alias++;
    } else if (modeUsed === 'positional' || _bulkLooksPositional(cols)) {
      // ★ 구글시트 변형 양식 (col 14=출고요청일, col 15=상태) 우선 감지
      if (_bulkLooksAltLayout(cols)) {
        rowObj = _bulkMapByHeaderAlt(cols);
        _modeCount.alt++;
      } else {
        // 표준 열 순서 (담당자/PJ NO/...) → 인덱스 고정 매핑
        rowObj = _bulkMapByHeader(cols);
        _modeCount.positional++;
      }
    } else {
      // 자동 분류 (패턴 기반)
      rowObj = _bulkMapSmart(cols);
      if (!rowObj['PJ NO'] && !rowObj['모델명']) {
        rowObj = _bulkMapByHeader(cols);
      }
      _modeCount.smart++;
    }

    rowObj = _bulkPostProcessRow(rowObj);

    // PJ NO 자동 생성 (없을 때만)
    if (!rowObj['PJ NO']) {
      const dt = (rowObj['수주일'] || rowObj['출고요청일'] || '').replace(/\D/g,'').slice(2,8);
      const modTag = (rowObj['모델명'] || '').replace(/[^A-Za-z0-9]/g,'').slice(0,6);
      if (dt || modTag) rowObj['PJ NO'] = `AUTO-${dt}${modTag ? '-'+modTag : ''}`;
    }
    if (!rowObj['PJ NO']) return;

    // 모델명 없는 행도 스킵 (제목/메타 행 가능성)
    if (!rowObj['모델명'] && !rowObj['수량']) return;

    _bulkParsed.push(rowObj);
  });

  const tbody = document.getElementById('bulkPreviewTbody');
  const truncate = (s, n) => { s = String(s||''); return s.length > n ? s.slice(0,n)+'…' : s; };
  tbody.innerHTML = _bulkParsed.map(r => `<tr>
      <td style="font-size:0.82em;">${r['출고요청일']||r['수주일']||''}</td>
      <td><strong>${r['PJ NO']||'-'}</strong></td>
      <td>${r['고객사']||'-'}</td>
      <td style="font-size:0.82em;color:#1565c0;">${r['발전소명']||'-'}</td>
      <td style="font-size:0.78em;color:#555;" title="${r['납품주소']||''}">${truncate(r['납품주소'],24)}</td>
      <td style="font-size:0.8em;">${r['모델명']||'-'}</td>
      <td style="text-align:right;">${r['수량']||''}</td>
      <td style="text-align:right;">${r['수주용량(kW)']||''}</td>
      <td style="font-size:0.82em;">${r['인수담당자']||''}</td>
      <td style="font-size:0.78em;color:#888;" title="${r['비고']||''}">${truncate(r['비고'],28)}</td>
      <td style="font-size:0.78em;color:#1565c0;" title="${r['수금조건']||''}">${truncate(r['수금조건'],22)}</td>
    </tr>`).join('');

  const payCount = _bulkParsed.filter(r => r['수금조건']).length;
  // [BULK v2] 인식 모드별 안내
  let modeMsg = '';
  // ★ 2026-08: 헤더 없이 행 단위로 판정된 경우에도 실제 사용된 방식을 표시
  let _effMode = modeUsed;
  if (!_effMode) {
    const top = Object.entries(_modeCount).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) _effMode = top[0];
  }
  if (_effMode === 'alias' && headerMap) {
    const mappedFields = [...new Set(Object.values(headerMap))];
    modeMsg = `<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:4px;font-size:0.82em;font-weight:700;">📋 헤더 자동 인식</span> ${mappedFields.length}개 필드 매핑: <span style="font-size:0.84em;color:#666;">${mappedFields.slice(0,8).join(', ')}${mappedFields.length>8?` 외 ${mappedFields.length-8}`:''}</span><br>`;
  } else if (_effMode === 'positional') {
    modeMsg = `<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:4px;font-size:0.82em;font-weight:700;">📊 표준 양식 (담당자 · PJ NO 순)</span><br>`;
  } else if (_effMode === 'alt') {
    modeMsg = `<span style="background:#ede7f6;color:#5e35b1;padding:2px 8px;border-radius:4px;font-size:0.82em;font-weight:700;">📊 구글시트 변형 양식</span><br>`;
  } else {
    modeMsg = `<span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:4px;font-size:0.82em;font-weight:700;">🔍 자동 분류 (패턴 기반)</span> <span style="font-size:0.8em;color:#888;">— 열 순서가 표준과 다르면 값이 밀릴 수 있으니 미리보기를 확인하세요</span><br>`;
  }
  // 자기회사명 경고
  const warned = _bulkParsed.filter(r => r._고객사_warning).length;
  const warnMsg = warned > 0 ? `<div style="margin-top:6px;color:#e65100;font-size:0.84em;">⚠️ ${warned}건의 "고객사"가 자기회사명으로 감지됨 — 등록 전 확인 권장</div>` : '';

  document.getElementById('bulkParseInfo').innerHTML =
    modeMsg +
    `<strong>${_bulkParsed.length}건</strong> 인식됨 · 수금조건 <strong style="color:#1565c0;">${payCount}건</strong> 자동반영 예정 — 전체 신규 추가됩니다` +
    warnMsg;
  document.getElementById('bulkPreviewArea').style.display = _bulkParsed.length ? 'block' : 'none';
}

function registerBulkErpOrders() {
  if (!_bulkParsed.length) { alert('먼저 데이터를 붙여넣으세요.'); return; }
  if (!confirm(`${_bulkParsed.length}건을 등록합니까?`)) return;

  let autoPayCount = 0;
  _bulkParsed.forEach(rowObj => {
    const newId = genId();
    rawData.push({ ...rowObj, _id: newId });

    // 수금조건 자동 파싱 → 금액으로 변환해 localMeta 저장
    const terms = rowObj['수금조건'] || '';
    const total = parseFloat(String(rowObj['수주총액(원)']||'').replace(/,/g,'')) || 0;
    if (terms && total > 0) {
      const parsed = parsePayTerms(terms);
      if (!localMeta[newId]) localMeta[newId] = {};
      localMeta[newId].수금조건 = terms;
      const map = { deposit:'계약금', mid1:'중도금1', mid2:'중도금2', mid3:'중도금3', balance:'잔금' };
      let hadAny = false;
      Object.entries(map).forEach(([k, key]) => {
        if (parsed[k] != null) {
          localMeta[newId][key] = Math.round(total * parsed[k] / 100);
          hadAny = true;
        }
      });
      if (hadAny) autoPayCount++;
    } else if (terms) {
      if (!localMeta[newId]) localMeta[newId] = {};
      localMeta[newId].수금조건 = terms;
    }
  });

  localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));
  saveLocal();
  document.getElementById('bulk-paste-area').value = '';
  document.getElementById('bulkPreviewArea').style.display = 'none';
  _bulkParsed = [];
  renderOrders();
  renderDashboard();
  const extra = autoPayCount ? ` · 수금조건 자동 반영 ${autoPayCount}건` : '';
  setBanner('ok', `✅ 다량 등록 완료 — ${rawData.length}건${extra}`);
}

// =====================================================
//  EXCEL EXPORT
// =====================================================
function exportOrdersExcel() {
  const f = getOrderFilters();
  const data = applyOrderSort(filterOrders(getEnriched(), f));   // 화면과 동일한 정렬·필터 적용
  const rows = [HEADER_NAMES.concat(['상태'])];
  data.forEach(o => {
    rows.push([o.담당자,o.pjNo,o.수주일,o.고객사,o.제품군,o.제조사,o.매입No,o.모델명,
      o.제품용량,o.수량,o.수주용량kW,o.제품단가,o.수주총액,o.총금액VAT,
      o.매입사,o.매입단가,o.매입총액,o.영업이익,o.영업이익률,
      o.출고요청일,o.납품일||'',o.허가증,o.FD성적서,o.인증서,o.사용전검사,
      o.발전소명,o.납품주소,o.인수담당자,o.요청사항,o.수금조건,o.status]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '수주현황');
  XLSX.writeFile(wb, `수주현황_${todayStr()}.xlsx`);
}

// =====================================================
//  분할출고 관리 — 출고지시서(deliveryOrders) 기반 자동 반영
// =====================================================
function openSplitDeliveryModal(id) {
  const o = getEnriched().find(x => x._id === id);
  if (!o) return;
  document.getElementById('split-pjno').value = id;
  renderSplitDeliveryInfo(id, o);
  renderSplitDeliveryList(id, o);
  openModal('splitDeliveryModal');
}

// 상단 요약 정보: 수주수량 / 출고완료 / 잔여 — deliveryOrders 기준
function renderSplitDeliveryInfo(id, o) {
  const pjNo      = o ? o.pjNo : '';
  const doList    = deliveryOrders.filter(d => d.pjNo === pjNo || d.rowId === id);
  const totalQty  = (localMeta[id] && localMeta[id].splitTargetQty) || (o ? o.수량 : 0) || 0;
  const shippedQty = doList.reduce((a, d) => a + (d.qty || 0), 0);
  const remaining  = totalQty - shippedQty;

  document.getElementById('splitDeliveryInfo').innerHTML = `
    <div><div style="font-size:0.78em;color:#888;margin-bottom:2px;">PJ NO</div>
      <strong>${o ? o.pjNo : '-'}</strong></div>
    <div><div style="font-size:0.78em;color:#888;margin-bottom:2px;">고객사</div>
      <strong>${o ? (o.고객사||'-') : '-'}</strong></div>
    <div><div style="font-size:0.78em;color:#888;margin-bottom:2px;">수주수량</div>
      <strong style="color:#1a1a2e;">${fmt(totalQty)}매</strong></div>
    <div><div style="font-size:0.78em;color:#888;margin-bottom:2px;">출고완료 / 잔여</div>
      <strong style="color:#27ae60;">${fmt(shippedQty)}매</strong>
      <span style="color:#bbb;margin:0 4px;">/</span>
      <strong style="color:${remaining > 0 ? '#e53935' : '#aaa'};">${fmt(remaining)}매</strong>
    </div>`;
}

// 출고 이력: 같은 PJ NO의 출고지시서 목록을 차수 순으로 표시
function renderSplitDeliveryList(id, o) {
  const pjNo   = o ? o.pjNo : '';
  const doList = deliveryOrders.filter(d => d.pjNo === pjNo || d.rowId === id);
  const el     = document.getElementById('splitDeliveryList');
  if (!el) return;

  if (!doList.length) {
    el.innerHTML = `<div style="color:#aaa;font-size:0.85em;padding:12px 0;text-align:center;">
      출고 이력이 없습니다.<br>
      <span style="font-size:0.9em;">출고지시서를 생성하면 자동으로 목록에 반영됩니다.</span>
    </div>`;
    return;
  }

  // 출고일 기준 오름차순 정렬
  const sorted = [...doList].sort((a, b) => (a.date||'').localeCompare(b.date||''));

  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead>
      <tr>
        <th style="text-align:center;">차수</th>
        <th>출고일</th>
        <th style="text-align:right;">수량</th>
        <th>발전소명</th>
        <th>납품주소</th>
        <th style="text-align:center;">지시서 번호</th>
        <th style="text-align:center;">상태</th>
      </tr>
    </thead>
    <tbody>
      ${sorted.map((d, i) => `<tr>
        <td style="text-align:center;font-weight:800;color:#1a1a2e;">${i + 1}차</td>
        <td>${d.date || '-'}</td>
        <td style="text-align:right;font-weight:700;">${fmt(d.qty)}매</td>
        <td style="font-size:0.85em;">${d.plant || '-'}</td>
        <td style="font-size:0.82em;color:#666;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${d.address||''}">${d.address || '-'}</td>
        <td style="text-align:center;">
          <span style="background:#e3f2fd;color:#1565c0;padding:2px 7px;border-radius:4px;font-size:0.8em;font-weight:600;">${d.id}</span>
        </td>
        <td style="text-align:center;">
          <span class="tag green" style="font-size:0.78em;">✅ 출고완료</span>
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// =====================================================
//  QUICK PAYMENT HELPERS
// =====================================================
function quickSetDeposit(id, paid) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('계약금 입금 처리')) return;
  const o = getEnriched().find(x => x._id === id);
  const pjNo = o ? o.pjNo : id;
  const amt = o ? Number(o.계약금||0) : 0;
  const amtStr = amt > 0 ? `${fmt(amt)}원 ` : '';
  const msg = paid
    ? `PJ NO "${pjNo}"\n계약금 ${amtStr}입금 처리하시겠습니까?`
    : `PJ NO "${pjNo}"\n계약금 ${amtStr}입금을 취소하시겠습니까?`;
  if (!confirm(msg)) return;
  if (!localMeta[id]) localMeta[id] = {};
  localMeta[id].계약금입금 = paid;
  saveLocal();
  renderOrders();
  renderShipment();
  renderDashboard();
  setBanner('ok', `✅ ${pjNo} 계약금 ${amtStr}${paid ? '입금' : '취소'} 처리 완료`);
}

function quickSetBalance(id, paid) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('잔금 입금 처리')) return;
  const o = getEnriched().find(x => x._id === id);
  const pjNo = o ? o.pjNo : id;
  const amt = o ? Number(o.잔금||0) : 0;
  const amtStr = amt > 0 ? `${fmt(amt)}원 ` : '';
  const msg = paid
    ? `PJ NO "${pjNo}"\n잔금 ${amtStr}입금 처리하시겠습니까?`
    : `PJ NO "${pjNo}"\n잔금 ${amtStr}입금을 취소하시겠습니까?`;
  if (!confirm(msg)) return;
  if (!localMeta[id]) localMeta[id] = {};
  localMeta[id].잔금입금 = paid;
  saveLocal();
  renderOrders();
  renderShipment();
  setBanner('ok', `✅ ${pjNo} 잔금 ${amtStr}${paid ? '입금' : '취소'} 처리 완료`);
}

// 중도금 1/2/3 입금처리 — n: 1|2|3
function quickSetMid(id, n, paid) {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly(`중도금${n} 입금 처리`)) return;
  if (![1,2,3].includes(n)) return;
  const o = getEnriched().find(x => x._id === id);
  const pjNo = o ? o.pjNo : id;
  const label = '중도금'+n;
  const amt = o ? Number(o['중도금'+n]||0) : 0;
  const amtStr = amt > 0 ? `${fmt(amt)}원 ` : '';
  const msg = paid
    ? `PJ NO "${pjNo}"\n${label} ${amtStr}입금 처리하시겠습니까?`
    : `PJ NO "${pjNo}"\n${label} ${amtStr}입금을 취소하시겠습니까?`;
  if (!confirm(msg)) return;
  if (!localMeta[id]) localMeta[id] = {};
  localMeta[id]['중도금'+n+'입금'] = paid;
  saveLocal();
  try { renderOrders(); } catch(e) {}
  try { renderShipment(); } catch(e) {}
  try { renderDashboard(); } catch(e) {}
  if (typeof renderSalesPerf === 'function') try { renderSalesPerf(); } catch(e) {}
  setBanner('ok', `✅ ${pjNo} ${label} ${amtStr}${paid ? '입금' : '취소'} 처리 완료`);
}
window.quickSetMid = quickSetMid;

function deleteDeliveryOrderByPjNo(id) {
  const meta = localMeta[id];
  if (!meta || !meta.deliveryOrderId) { alert('연결된 출고지시서가 없습니다.'); return; }
  const o = getEnriched().find(x => x._id === id);
  const pjNo = o ? o.pjNo : id;
  if (!confirm(`PJ NO "${pjNo}"의 출고지시서 "${meta.deliveryOrderId}"를 삭제합니까?\n(연결된 재고 출고 이력도 함께 삭제됩니다)`)) return;
  // 자동 생성된 재고 출고 레코드 함께 삭제 → 재고 수량 복구
  inventoryData = inventoryData.filter(d => d.id !== 'OB-DO-' + meta.deliveryOrderId);
  deliveryOrders = deliveryOrders.filter(d => d.id !== meta.deliveryOrderId);
  delete localMeta[id].deliveryOrderId;
  saveLocal();
  renderOrders();
  if (typeof renderStockTab === 'function') renderStockTab();
  if (typeof renderInventory === 'function') renderInventory();
  setBanner('ok', `✅ 출고지시서 삭제 완료 — 재고 수량 복구됨`);
}

// =====================================================
//  RECEIPT PRINTING (선택 인수증 출력)
// =====================================================
let _receiptQtyCallback = null;
let _pendingReceiptIds = [];

function toggleAllOrderChecks(checked) {
  document.querySelectorAll('.order-row-cb').forEach(cb => cb.checked = checked);
}

function printSelectedReceipts() {
  // 수주현황 탭에서 체크된 항목이 있으면 그것을 사용, 없으면 전체 목록에서 선택 모달 표시
  const cbs = document.querySelectorAll('.order-row-cb:checked');
  if (cbs.length) {
    const ids = [...cbs].map(cb => cb.getAttribute('data-id'));
    const enriched = getEnriched();
    const orderList = ids.map(id => enriched.find(o => o._id === id)).filter(Boolean);
    if (orderList.length) { printMultiReceipt(orderList); return; }
  }
  // 체크된 항목 없음 → 수주 목록에서 직접 선택하는 모달 표시
  showReceiptSelectModal();
}

function showReceiptSelectModal() {
  const existing = document.getElementById('receiptSelectModal');
  if (existing) existing.remove();

  const orders = getEnriched().filter(o => o.pjNo && o.status !== '취소');
  if (!orders.length) { alert('등록된 수주가 없습니다.'); return; }
  _pendingReceiptIds = orders.map(o => o._id);

  const rowsHtml = orders.map((o, i) =>
    `<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:7px;cursor:pointer;border:1px solid #eee;margin-bottom:4px;background:#fafafa;transition:background 0.1s;" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background='#fafafa'">
      <input type="checkbox" class="rsm-cb" data-idx="${i}" style="width:16px;height:16px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.88em;font-weight:700;color:#1a1a2e;">${o.pjNo} &nbsp;<span style="font-weight:400;color:#666;">${o.고객사||''}</span></div>
        <div style="font-size:0.78em;color:#888;">${o.발전소명||'-'} · ${o.모델명||'-'} · ${fmt(o.수량)}매</div>
      </div>
    </label>`
  ).join('');

  const modalHtml = `<div id="receiptSelectModal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;">
    <div style="background:white;border-radius:14px;padding:24px;min-width:440px;max-width:560px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 4px;color:#1a1a2e;font-size:1.05em;">📄 인수증 대상 선택</h3>
      <p style="margin:0 0 14px;color:#666;font-size:0.83em;">인수증에 포함할 수주를 선택하세요.</p>
      <div style="overflow-y:auto;flex:1;max-height:50vh;">${rowsHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
        <button onclick="document.getElementById('receiptSelectModal').remove()"
          style="padding:9px 20px;border:1.5px solid #adb5bd;border-radius:7px;background:white;cursor:pointer;font-size:0.9em;color:#555;">취소</button>
        <button onclick="confirmReceiptSelect()"
          style="padding:9px 22px;border:none;border-radius:7px;background:#1a1a2e;color:white;cursor:pointer;font-size:0.9em;font-weight:600;">✅ 인수증 출력</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function confirmReceiptSelect() {
  const cbs = document.querySelectorAll('#receiptSelectModal .rsm-cb:checked');
  if (!cbs.length) { alert('하나 이상 선택해주세요.'); return; }
  const allIds = _pendingReceiptIds || [];
  const selectedIds = [...cbs].map(cb => allIds[parseInt(cb.getAttribute('data-idx'))]).filter(Boolean);
  document.getElementById('receiptSelectModal').remove();
  const enriched = getEnriched();
  const orderList = selectedIds.map(id => enriched.find(o => o._id === id)).filter(Boolean);
  if (orderList.length) printMultiReceipt(orderList);
}

function showQtyInputModal(orderList, callback) {
  const existing = document.getElementById('receiptQtyModal');
  if (existing) existing.remove();

  const rowsHtml = orderList.map((o, i) => {
    const defaultQty = o.수량 || 0;
    const defaultRemarks = o.요청사항 || '';
    return `<div style="background:#f8f9fa;border-radius:8px;padding:12px 14px;border-left:3px solid #1a1a2e;">
      <div style="font-weight:600;color:#333;font-size:0.9em;margin-bottom:4px;">${o.발전소명||o.고객사||'현장명 없음'} (${o.pjNo})</div>
      <div style="font-size:0.8em;color:#666;margin-bottom:8px;">${o.모델명} | 수주수량: ${fmt(defaultQty)}매</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <label style="font-size:0.82em;color:#555;white-space:nowrap;">인수증 수량</label>
        <input type="number" id="receiptQtyInput_${i}" value="${defaultQty}" min="0"
          style="flex:1;padding:6px 10px;border:1.5px solid #ced4da;border-radius:6px;font-size:0.95em;text-align:right;">
        <span style="font-size:0.82em;color:#555;">매</span>
      </div>
      <div>
        <label style="font-size:0.82em;color:#555;display:block;margin-bottom:3px;">비고 / 요청사항</label>
        <textarea id="receiptRemarksInput_${i}" rows="1" placeholder="현장 요청사항, 특이사항 등"
          style="width:100%;padding:5px 8px;border:1.5px solid #ced4da;border-radius:6px;font-size:0.88em;resize:vertical;">${defaultRemarks}</textarea>
      </div></div>`;
  }).join('');

  const modalHtml = `<div id="receiptQtyModal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;">
    <div style="background:white;border-radius:14px;padding:28px;min-width:420px;max-width:560px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 6px;color:#222;font-size:1.05em;">📄 인수증 수량 설정</h3>
      <p style="margin:0 0 18px;color:#666;font-size:0.85em;">각 건별로 인수증에 표시할 수량을 입력하세요.</p>
      <div style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;">${rowsHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
        <button onclick="document.getElementById('receiptQtyModal').remove()"
          style="padding:9px 20px;border:1.5px solid #adb5bd;border-radius:7px;background:white;cursor:pointer;font-size:0.9em;color:#555;">취소</button>
        <button onclick="receiptQtyConfirm(${orderList.length})"
          style="padding:9px 22px;border:none;border-radius:7px;background:#1a1a2e;color:white;cursor:pointer;font-size:0.9em;font-weight:600;">✅ 인수증 출력</button>
      </div>
    </div></div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  _receiptQtyCallback = callback;
}

function receiptQtyConfirm(count) {
  const qtys = [];
  const remarks = [];
  for (let i = 0; i < count; i++) {
    const qEl = document.getElementById('receiptQtyInput_' + i);
    const rEl = document.getElementById('receiptRemarksInput_' + i);
    qtys.push(qEl ? (parseInt(qEl.value) || 0) : 0);
    remarks.push(rEl ? rEl.value.trim() : '');
  }
  document.getElementById('receiptQtyModal').remove();
  if (_receiptQtyCallback) _receiptQtyCallback(qtys, remarks);
}

function printMultiReceipt(orderList) {
  if (!orderList.length) { alert('출력할 데이터가 없습니다.'); return; }

  showQtyInputModal(orderList, function(qtys, remarks) {
    const items = orderList.map((o, i) => ({
      model: o.모델명 || '',
      spec: o.제품용량 ? o.제품용량 + 'Wp' : '',
      qty: qtys[i] !== undefined ? qtys[i] : (o.수량 || 0),
      site: o.발전소명 || o.고객사 || '',
      addrHtml: [
        o.납품주소 ? `<span class="addr-line">${o.납품주소}</span>` : '',
        o.인수담당자 ? `<span class="addr-gap">담당자 ${o.인수담당자}</span>` : ''
      ].filter(Boolean).join('') || '-',
      remarks: (remarks && remarks[i]) || o.요청사항 || '',
      dispatch: o.배차정보 || o.추가정보 || '',
      pjNo: o.pjNo || '',
      date: o.출고요청일 || ''
    }));

    const dp = (items[0].date || '').split('-');
    const dateStr = dp.length === 3
      ? `${dp[0]}년&nbsp;&nbsp;&nbsp;${parseInt(dp[1])}월&nbsp;&nbsp;${parseInt(dp[2])}일 ` : '';
    const pjNoStr = items.map(it => it.pjNo).filter(Boolean).join(', ');

    const n = items.length;
    const rowPad = n <= 2 ? '14px 8px' : (n <= 4 ? '8px 6px' : '5px 4px');
    const bodyFont = n <= 3 ? '13px' : (n <= 5 ? '11px' : '10px');
    const addrFont = n <= 3 ? '12px' : '10px';

    const makeRows = () => items.map(it =>
      `<tr><td class="td-model">${it.model}</td><td>${it.spec}</td><td>EA</td>
       <td>${fmt(it.qty)}</td><td>${it.site}</td><td class="td-addr">${it.addrHtml}</td></tr>`
    ).join('')
      + (items.some(it => it.dispatch) ? `<tr><td colspan="6" style="text-align:left;padding:6px 10px;font-size:0.88em;background:#eaf3ff;border:1px solid #555;"><strong>🚚 배차정보:</strong> ${items.filter(it=>it.dispatch).map(it=>it.dispatch).join(' / ')}</td></tr>` : '')
      + (items.some(it => it.remarks) ? `<tr><td colspan="6" style="text-align:left;padding:6px 10px;font-size:0.88em;background:#fffde7;border:1px solid #555;"><strong>비고:</strong> ${items.filter(it=>it.remarks).map(it=>it.remarks).join(' / ')}</td></tr>` : '');

    const makeReceipt = () =>
      `<div class="receipt">
        <div class="receipt-header">
          <span class="receipt-no">출고NO: ${pjNoStr}</span>
          <span class="receipt-title">〈 인 수 증 〉</span>
          <span style="min-width:80px;"></span>
        </div>
        <table><thead><tr>
          <th style="width:24%">품 명</th><th style="width:8%">규격</th>
          <th style="width:6%">단위</th><th style="width:6%">수량</th>
          <th style="width:16%">현장명</th><th style="width:40%">주소 / 담당자</th>
        </tr></thead><tbody>${makeRows()}</tbody></table>
        <div class="sign-section">
          <p>상기 물품에 대하여 이상이 없음을 검수하고 인수 함.</p>
          <p>${dateStr}</p>
          <div class="sign-row"><span>인수자:</span><span class="sign-blank"></span><span>(인)</span></div>
        </div>
      </div>`;

    const css = `@page{size:A4 portrait;margin:0}*{box-sizing:border-box;margin:0;padding:0}
      html,body{width:210mm;height:297mm;font-family:"맑은 고딕","Malgun Gothic",sans-serif;color:#000;background:#fff}
      .no-print{padding:12px;text-align:center;background:#f5f5f5}
      .page{width:210mm;height:297mm;padding:6mm 10mm;display:flex;flex-direction:column;gap:4mm;margin:0 auto}
      .receipt{border:2px solid #333;flex:1;display:flex;flex-direction:column;overflow:hidden}
      .receipt-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px 6px;border-bottom:1px solid #333;flex-shrink:0}
      .receipt-no{font-size:11px;color:#333;min-width:100px}
      .receipt-title{font-size:20px;font-weight:700;letter-spacing:4px;text-align:center;flex:1}
      table{width:100%;border-collapse:collapse;font-size:${bodyFont};flex-shrink:0}
      thead th{background:#e8e8e8;border:1px solid #555;padding:6px 4px;text-align:center;font-weight:700;font-size:11px}
      tbody td{border:1px solid #555;padding:${rowPad};text-align:center;vertical-align:middle;line-height:1.5}
      .td-model{text-align:left;padding-left:10px;font-weight:600}
      .td-addr{text-align:left;padding-left:8px;font-size:${addrFont};line-height:1.6}
      .addr-line{display:block}.addr-gap{display:block;margin-top:4px}
      .sign-section{padding:14px 16px 18px;border-top:1px solid #333;font-size:13px;line-height:1.8;margin-top:auto;flex-shrink:0}
      .sign-section p{margin-bottom:2px}
      .sign-row{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:13px}
      .sign-blank{display:inline-block;width:130px;border-bottom:1px solid #555;margin:0 6px}
      @media print{.no-print{display:none!important}}
      @media screen{.page{border:1px solid #ccc;margin:10px auto}}`;

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>인수증</title>
      <style>${css}</style></head><body>
      <div class="no-print">
        <button onclick="window.print()" style="padding:10px 30px;font-size:16px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-right:10px;">🖨️ 인쇄</button>
        <button onclick="window.close()" style="padding:10px 20px;font-size:14px;background:#6c757d;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
      </div>
      <div class="page">${makeReceipt()}${makeReceipt()}</div></body></html>`;

    const w = window.open('', '_blank', 'width=850,height=1000');
    if (w) { w.document.write(html); w.document.close(); }
    else { alert('팝업 차단이 해제되어 있어야 합니다.'); }
  });
}

// =====================================================
//  빠른 출고처리 — 수주현황 🚚 버튼
//  수주현황에서 직접 출고완료를 기록 → 분할출고 자동 반영
// =====================================================
function openQuickShipModal(rowId) {
  const o = getEnriched().find(x => x._id === rowId);
  if (!o) return;

  // 분할출고 미등록 시 자동 등록
  if (!localMeta[rowId]) localMeta[rowId] = {};
  if (!localMeta[rowId].splitRegistered) {
    localMeta[rowId].splitRegistered = true;
    saveLocal();
  }

  const splits     = (localMeta[rowId] && localMeta[rowId].splits) || [];
  const shippedQty = splits.filter(s => s.processed).reduce((a, s) => a + s.qty, 0);
  const remaining  = (o.수량 || 0) - shippedQty;
  const round      = splits.length + 1;

  const ri = document.getElementById('qship-rowid');
  const qd = document.getElementById('qship-date');
  const qq = document.getElementById('qship-qty');
  const qn = document.getElementById('qship-note');
  const qi = document.getElementById('qship-info');

  if (ri) ri.value = rowId;
  if (qd) qd.value = todayStr();
  if (qq) qq.value = remaining > 0 ? remaining : '';
  if (qn) qn.value = `${round}차 출고`;
  if (qi) qi.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">PJ NO</div><strong>${o.pjNo}</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">고객사</div><strong>${o.고객사||'-'}</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">수주수량</div><strong>${fmt(o.수량||0)}매</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">잔여수량</div>
        <strong style="color:${remaining>0?'#e53935':'#27ae60'};">${fmt(remaining)}매</strong>
      </div>
    </div>`;

  openModal('quickShipModal');
}

function confirmQuickShip() {
  const rowId = (document.getElementById('qship-rowid') || {}).value || '';
  const date  = (document.getElementById('qship-date') || {}).value || '';
  const qty   = parseInt((document.getElementById('qship-qty') || {}).value) || 0;
  const note  = ((document.getElementById('qship-note') || {}).value || '').trim();

  if (!rowId) { alert('오류: PJ NO를 찾을 수 없습니다.'); return; }
  if (!qty || qty <= 0) { alert('출고수량을 입력하세요.'); return; }
  if (!date) { alert('출고일을 입력하세요.'); return; }

  if (!localMeta[rowId]) localMeta[rowId] = {};
  if (!localMeta[rowId].splits) localMeta[rowId].splits = [];

  const round   = localMeta[rowId].splits.length + 1;
  const splitId = 'SL-' + rowId + '-' + Date.now();

  localMeta[rowId].splits.push({
    id: splitId,
    date,
    qty,
    note: note || `${round}차 출고`,
    processed: true,   // 즉시 출고완료
    round
  });

  // 전량 출고 완료 시 → 상태 자동 납품완료 변경
  const o        = getEnriched().find(x => x._id === rowId);
  const totalQty = o ? (o.수량 || 0) : 0;
  const shipped  = localMeta[rowId].splits.filter(s => s.processed).reduce((a, s) => a + s.qty, 0);

  if (totalQty > 0 && shipped >= totalQty) {
    localMeta[rowId].status = '납품완료';
    setBanner('ok', `✅ ${o ? o.pjNo : rowId} 전량 출고 완료 → 납품완료로 상태 변경`);
  } else {
    const rem = totalQty - shipped;
    setBanner('ok', `🚚 ${o ? o.pjNo : rowId} ${round}차 출고 ${fmt(qty)}매 완료 (잔여 ${fmt(rem)}매)`);
  }

  saveLocal();
  closeModal('quickShipModal');
  renderOrders();
  if (typeof renderSplitTab === 'function') renderSplitTab();
  renderDashboard();
}
