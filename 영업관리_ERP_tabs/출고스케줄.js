// =====================================================
//  출고스케줄 (Shipping Schedule) — 수주 기반 소요/부족 산출
//
//  목적
//   수주현황에 입력된 "출고요청일(출고예정)" 건을 기준일(오늘) 기준으로
//   1주 / 1개월 / 3개월 / 6개월 / 1년 구간으로 묶어
//     ① 모델명별 필요수량 (출고해야 할 수량)
//     ② 현재고 대비 부족수량 (예정 물량을 출고하려면 추가로 확보해야 할 수량)
//   을 산출한다.
//
//  ── 계산 규칙 ─────────────────────────────────────────
//  대상 수주  : status 가 완료/취소 계열이 아닌 건 (기본 '수주')
//               + 출고요청일이 있는 건 (없으면 '미정' 구간)
//  잔여수량   = 수주수량 − 이미 발행된 출고지시서 수량(qty+foc)
//               ※ 출고지시서 생성 시 inventoryData 에 '출고' 레코드가 자동 반영되어
//                 현재고에서 이미 차감되므로, 잔여분만 "추가 필요수량"으로 잡는다.
//                 (이중 차감 방지 — 출고지시서.js saveDeliveryOrder 참고)
//  현재고     = Σ(입고 qty) − Σ(출고 qty)   [inventoryData]
//  누적필요   = 지연분(옵션) + 기준일 ~ 해당 구간 종료일 까지의 잔여수량 합
//  부족수량   = max(0, 누적필요 − 현재고 − 입고예정(옵션, ETA ≤ 구간 종료일))
//
//  공개 API : window.shipSched
//    shipSched.open()            탭 열기
//    shipSched.summary()         계산 결과(raw) 반환 — 콘솔 확인용
// =====================================================
(function() {
  'use strict';

  const TAB_ID  = 'shipsched';
  const HOST_ID = 'shipSchedTabHost';
  const OPT_KEY = 'erp_shipsched_opt';

  // 출고가 이미 끝났거나 무효인 상태 — 소요 산출 대상에서 제외
  const DONE_STATUS = ['납품완료', '수금완료', '취소', '출고취소', '완료', '출고완료', '반품완료'];

  // ── 헬퍼 ──────────────────────────────────────────────
  function _e(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v)
      : String(v == null ? '' : v).replace(/[<>&"]/g, ch => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[ch]));
  }
  function _fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10); }
  function _iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function _addDays(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    return _iso(new Date(y, m - 1, d + n));
  }
  function _addMonths(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    const t = new Date(y, m - 1 + n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(d, last));
    return _iso(t);
  }
  function _md(ds) {
    if (!ds) return '-';
    const p = ds.split('-');
    return `${Number(p[1])}/${Number(p[2])}`;
  }
  //  기준일과 연도가 다르면 'YY.M/D' 로 표기 (해 넘어가는 구간 구분)
  function _mdy(ds, base) {
    if (!ds) return '-';
    const y = ds.slice(0, 4);
    return (y === String(base).slice(0, 4)) ? _md(ds) : `${y.slice(2)}.${_md(ds)}`;
  }
  function _dday(ds, base) {
    if (!ds) return null;
    return Math.round((new Date(ds + 'T00:00:00') - new Date(base + 'T00:00:00')) / 86400000);
  }

  // ── 옵션(상태) ────────────────────────────────────────
  let _opt = {
    base: '',              // 기준일 (빈값 → 오늘)
    sub: 'summary',        // summary | timeline | detail | ports
    view: 'both',          // need(필요) | short(부족) | both
    unit: 'month',         // timeline 구간 단위: week|month|quarter|half|year
    manager: '',
    mfr: '',
    search: '',
    incOverdue: true,      // 지연(미납)분을 누적 필요수량에 포함
    useIncoming: false,    // 입고예정(ETA) 반영
    onlyShort: false,      // 부족 모델만 표시
    detailModel: '',       // 상세내역 모델 필터
    portHz: 'm3',          // 항만 배정 대상 기간 (all|w1|m1|m3|m6|y1)
    portRegion: ''         // 항만 배정 — 드릴다운으로 열어 둔 지역 키
  };
  function _loadOpt() {
    try { Object.assign(_opt, JSON.parse(localStorage.getItem(OPT_KEY) || '{}') || {}); } catch (e) {}
    _opt.detailModel = _opt.detailModel || '';
  }
  function _saveOpt() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(_opt)); } catch (e) {}
  }
  function _base() { return _opt.base || _today(); }

  // ── 데이터 수집 ───────────────────────────────────────
  //  현재고 맵 : inventoryData 입고 − 출고
  function _stockMap() {
    const m = {};
    if (typeof inventoryData === 'undefined' || !Array.isArray(inventoryData)) return m;
    inventoryData.forEach(r => {
      const k = String(r.model || '').trim();
      if (!k) return;
      if (!m[k]) m[k] = 0;
      m[k] += (r.type === '입고' ? 1 : -1) * (Number(r.qty) || 0);
    });
    return m;
  }

  //  모델별 출고지시서 발행 수량 (PJ NO / rowId 기준)
  function _doQtyOf(o) {
    if (typeof deliveryOrders === 'undefined' || !Array.isArray(deliveryOrders)) return 0;
    return deliveryOrders
      .filter(d => (o._id && d.rowId === o._id) || (o.pjNo && d.pjNo === o.pjNo))
      .reduce((a, d) => a + (Number(d.qty) || 0) + (Number(d.foc) || 0), 0);
  }

  //  입고예정 (incoming 모듈) — 진행중 건만
  function _incomingList() {
    try {
      if (!window.incoming || typeof window.incoming.list !== 'function') return [];
      return window.incoming.list().filter(x => !['completed', 'cancelled'].includes(x.status));
    } catch (e) { return []; }
  }

  //  출고 대기 수주 목록 (필터 적용)
  function _pendingItems() {
    if (typeof getEnriched !== 'function') return [];
    let list;
    try { list = getEnriched(); } catch (e) { return []; }
    const search = (_opt.search || '').toLowerCase().trim();
    const out = [];
    list.forEach(o => {
      if (DONE_STATUS.includes(o.status || '')) return;
      const model = String(o.모델명 || '').trim();
      if (!model) return;
      if (_opt.manager && o.담당자 !== _opt.manager) return;
      if (_opt.mfr && o.제조사 !== _opt.mfr) return;
      if (search && ![o.pjNo, o.고객사, o.모델명, o.담당자, o.발전소명].join(' ').toLowerCase().includes(search)) return;
      const qty = Number(o.수량) || 0;
      if (qty <= 0) return;
      const shipped = _doQtyOf(o);
      const remain = qty - shipped;
      if (remain <= 0) return;              // 전량 출고지시 완료 → 재고에서 이미 차감됨
      out.push({
        _id: o._id, pjNo: o.pjNo, 고객사: o.고객사, 담당자: o.담당자,
        제조사: o.제조사, 모델명: model, 발전소명: o.발전소명, 납품주소: o.납품주소 || '',
        수량: qty, 발행: shipped, 잔량: remain,
        요청일: o.출고요청일 || '', status: o.status || '수주',
        계약금입금: !!o.계약금입금, doId: o.deliveryOrderId || ''
      });
    });
    return out;
  }

  // ── 구간(누적 호라이즌) 정의 ──────────────────────────
  function _horizons(base) {
    return [
      { key: 'w1', label: '1주',   end: _addDays(base, 7) },
      { key: 'm1', label: '1개월', end: _addMonths(base, 1) },
      { key: 'm3', label: '3개월', end: _addMonths(base, 3) },
      { key: 'm6', label: '6개월', end: _addMonths(base, 6) },
      { key: 'y1', label: '1년',   end: _addMonths(base, 12) }
    ];
  }

  // ── 핵심 집계 ─────────────────────────────────────────
  //  반환: { base, hz, rows, tot, itemCount }
  //   rows[i] = { model, mfr, onHand, overdue, none, beyond, total,
  //               need:{w1,m1,m3,m6,y1}, short:{...}, inc:{...} }
  function _summary() {
    const base = _base();
    const hz = _horizons(base);
    const items = _pendingItems();
    const stock = _stockMap();
    const incoming = _opt.useIncoming ? _incomingList() : [];

    const map = {};
    const _row = (model, mfr) => {
      if (!map[model]) {
        map[model] = {
          model, mfr: mfr || '', onHand: Number(stock[model] || 0),
          overdue: 0, none: 0, beyond: 0, total: 0,
          seg: { w1: 0, m1: 0, m3: 0, m6: 0, y1: 0 },
          need: {}, short: {}, inc: {}, cnt: 0
        };
      }
      if (!map[model].mfr && mfr) map[model].mfr = mfr;
      return map[model];
    };

    items.forEach(it => {
      const r = _row(it.모델명, it.제조사);
      r.cnt++;
      r.total += it.잔량;
      const d = it.요청일;
      if (!d) { r.none += it.잔량; return; }
      if (d < base) { r.overdue += it.잔량; return; }
      // 누적 구간 중 최초로 포함되는 곳에 적립 (비누적 세그먼트)
      const seg = hz.find(h => d <= h.end);
      if (seg) r.seg[seg.key] += it.잔량;
      else r.beyond += it.잔량;             // 1년 초과
    });

    // 재고만 있고 수주가 없는 모델도 표시 대상에 포함 (현재고 파악용)
    Object.keys(stock).forEach(m => {
      if (stock[m] !== 0 && !map[m] && !_opt.search && !_opt.manager && !_opt.mfr) _row(m, '');
    });

    // 입고예정 누적 (ETA ≤ 구간 종료일)
    const incUpto = {};
    hz.forEach(h => { incUpto[h.key] = {}; });
    incoming.forEach(x => {
      const m = String(x.model || '').trim();
      if (!m || !x.eta) return;
      hz.forEach(h => {
        if (x.eta <= h.end) incUpto[h.key][m] = (incUpto[h.key][m] || 0) + (Number(x.qty) || 0);
      });
    });

    const rows = Object.values(map).map(r => {
      let acc = _opt.incOverdue ? r.overdue : 0;
      hz.forEach(h => {
        acc += r.seg[h.key];
        r.need[h.key] = acc;
        r.inc[h.key] = _opt.useIncoming ? (incUpto[h.key][r.model] || 0) : 0;
        r.short[h.key] = Math.max(0, acc - r.onHand - r.inc[h.key]);
      });
      r.needAll = r.overdue + hz.reduce((a, h) => a + r.seg[h.key], 0) + r.beyond + r.none;
      r.shortAll = Math.max(0, r.needAll - r.onHand);
      return r;
    })
    .filter(r => (r.needAll > 0 || r.onHand !== 0))
    .filter(r => !_opt.onlyShort || r.short.m1 > 0 || r.short.y1 > 0)
    .sort((a, b) => (b.short.y1 - a.short.y1) || (b.needAll - a.needAll) || a.model.localeCompare(b.model));

    // 합계
    const tot = { onHand: 0, overdue: 0, none: 0, beyond: 0, needAll: 0, shortAll: 0, need: {}, short: {} };
    hz.forEach(h => { tot.need[h.key] = 0; tot.short[h.key] = 0; });
    rows.forEach(r => {
      tot.onHand += r.onHand; tot.overdue += r.overdue; tot.none += r.none;
      tot.beyond += r.beyond; tot.needAll += r.needAll; tot.shortAll += r.shortAll;
      hz.forEach(h => { tot.need[h.key] += r.need[h.key]; tot.short[h.key] += r.short[h.key]; });
    });

    return { base, hz, rows, tot, items, itemCount: items.length };
  }

  // ── 렌더: 공통 프레임 ─────────────────────────────────
  function _mount() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const S = _summary();
    host.innerHTML = `
      ${_kpi(S)}
      ${_filterBar(S)}
      <div class="card" style="margin-bottom:14px;">
        <div class="card-tabs">
          ${_subTab('summary',  '📊 기간별 소요/부족')}
          ${_subTab('timeline', '📅 스케줄 타임라인')}
          ${_subTab('detail',   '📋 출고예정 상세')}
          ${_subTab('ports',    '🚢 항만 배정')}
        </div>
      </div>
      <div id="ss-sub-body"></div>
    `;
    _renderSub(S);
  }

  function _subTab(key, label) {
    return `<button class="card-tab ${key === _opt.sub ? 'active' : ''}" onclick="shipSched.sub('${key}')">${label}</button>`;
  }

  function _renderSub(S) {
    const body = document.getElementById('ss-sub-body');
    if (!body) return;
    S = S || _summary();
    if (_opt.sub === 'timeline')      body.innerHTML = _viewTimeline(S);
    else if (_opt.sub === 'detail')   body.innerHTML = _viewDetail(S);
    else if (_opt.sub === 'ports')    body.innerHTML = _viewPorts(S);
    else                              body.innerHTML = _viewSummary(S);
  }

  function _kpi(S) {
    const shortModels = S.rows.filter(r => r.short.m1 > 0).length;
    return `
      <div class="kpi-grid">
        <div class="kpi kpi-dark">
          <div class="kpi-icon">📦</div>
          <div class="kpi-label">출고예정 건수</div>
          <div class="kpi-value">${_fmt(S.itemCount)}</div>
          <div class="kpi-sub">기준일 ${S.base} · 미출고 잔량 기준</div>
        </div>
        <div class="kpi">
          <div class="kpi-icon">🧮</div>
          <div class="kpi-label">총 필요수량</div>
          <div class="kpi-value">${_fmt(S.tot.needAll)}</div>
          <div class="kpi-sub">지연 ${_fmt(S.tot.overdue)} · 미정 ${_fmt(S.tot.none)}</div>
        </div>
        <div class="kpi kpi-success">
          <div class="kpi-icon">🏭</div>
          <div class="kpi-label">현재고 합계</div>
          <div class="kpi-value">${_fmt(S.tot.onHand)}</div>
          <div class="kpi-sub">입고 − 출고 (출고지시 반영분 포함)</div>
        </div>
        <div class="kpi kpi-warning">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-label">1개월내 부족</div>
          <div class="kpi-value">${_fmt(S.tot.short.m1)}</div>
          <div class="kpi-sub">부족 모델 ${shortModels}개</div>
        </div>
        <div class="kpi kpi-danger">
          <div class="kpi-icon">🚨</div>
          <div class="kpi-label">1년내 부족</div>
          <div class="kpi-value">${_fmt(S.tot.short.y1)}</div>
          <div class="kpi-sub">추가 확보 필요수량</div>
        </div>
      </div>`;
  }

  function _filterBar(S) {
    const orders = (typeof getEnriched === 'function') ? (function(){ try { return getEnriched(); } catch(e){ return []; } })() : [];
    const managers = [...new Set(orders.map(o => o.담당자).filter(Boolean))].sort();
    const mfrs     = [...new Set(orders.map(o => o.제조사).filter(Boolean))].sort();
    return `
      <div class="filter-bar">
        <div class="fg">
          <label>기준일</label>
          <input type="date" value="${_e(S.base)}" onchange="shipSched.set('base', this.value)">
        </div>
        <div class="fg">
          <label>담당자</label>
          <select onchange="shipSched.set('manager', this.value)">
            <option value="">전체</option>
            ${managers.map(m => `<option ${m === _opt.manager ? 'selected' : ''}>${_e(m)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>제조사</label>
          <select onchange="shipSched.set('mfr', this.value)">
            <option value="">전체</option>
            ${mfrs.map(m => `<option ${m === _opt.mfr ? 'selected' : ''}>${_e(m)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>검색 (모델/PJ/고객사)</label>
          <input type="search" value="${_e(_opt.search)}" placeholder="모델명 · PJ NO · 고객사"
                 onchange="shipSched.set('search', this.value)">
        </div>
        <div class="fg">
          <label>표시</label>
          <select onchange="shipSched.set('view', this.value)">
            <option value="both"  ${_opt.view === 'both'  ? 'selected' : ''}>필요 + 부족</option>
            <option value="need"  ${_opt.view === 'need'  ? 'selected' : ''}>필요수량만</option>
            <option value="short" ${_opt.view === 'short' ? 'selected' : ''}>부족수량만</option>
          </select>
        </div>
        <div class="fg" style="justify-content:flex-end;gap:6px;">
          <label style="display:flex;align-items:center;gap:5px;text-transform:none;font-size:0.78em;cursor:pointer;">
            <input type="checkbox" ${_opt.incOverdue ? 'checked' : ''} onchange="shipSched.set('incOverdue', this.checked)">
            지연분 누적 포함
          </label>
          <label style="display:flex;align-items:center;gap:5px;text-transform:none;font-size:0.78em;cursor:pointer;">
            <input type="checkbox" ${_opt.useIncoming ? 'checked' : ''} onchange="shipSched.set('useIncoming', this.checked)">
            입고예정(ETA) 반영
          </label>
          <label style="display:flex;align-items:center;gap:5px;text-transform:none;font-size:0.78em;cursor:pointer;">
            <input type="checkbox" ${_opt.onlyShort ? 'checked' : ''} onchange="shipSched.set('onlyShort', this.checked)">
            부족 모델만
          </label>
        </div>
      </div>`;
  }

  // ── 뷰 1: 기간별 소요/부족 ────────────────────────────
  function _cell(need, short) {
    const nd = `<div style="font-weight:700;">${need ? _fmt(need) : '<span style="color:#ccc;">-</span>'}</div>`;
    const sh = short > 0
      ? `<div style="font-size:0.76em;color:#c62828;font-weight:800;">부족 ${_fmt(short)}</div>`
      : (need ? `<div style="font-size:0.76em;color:#27ae60;font-weight:700;">충족</div>` : '');
    if (_opt.view === 'need')  return nd;
    if (_opt.view === 'short') return short > 0
      ? `<div style="font-weight:800;color:#c62828;">${_fmt(short)}</div>`
      : `<div style="color:#27ae60;font-weight:700;">0</div>`;
    return nd + sh;
  }

  function _viewSummary(S) {
    if (!S.rows.length) {
      return `<div class="card"><div class="card-body"><div class="empty">출고예정(출고요청일) 데이터가 없습니다. 수주현황에서 출고요청일을 입력하세요.</div></div></div>`;
    }
    const hzHead = S.hz.map(h => `<th class="num" title="${S.base} ~ ${h.end}">${h.label} 이내<div style="font-size:0.72em;font-weight:600;color:#aaa;">~${_mdy(h.end, S.base)}</div></th>`).join('');
    const rows = S.rows.map(r => {
      const stockCls = r.onHand <= 0 ? 'color:#c62828;' : 'color:#1a1a2e;';
      return `<tr>
        <td style="position:sticky;left:0;background:#fff;font-weight:700;">
          <span style="cursor:pointer;color:#1a1a2e;" onclick="shipSched.detail('${_e(r.model).replace(/'/g, "\\'")}')" title="상세 내역 보기">${_e(r.model)}</span>
          <div style="font-size:0.74em;color:#999;">${_e(r.mfr) || '-'} · ${r.cnt}건</div>
        </td>
        <td class="num" style="font-weight:800;${stockCls}">${_fmt(r.onHand)}${r.inc && r.inc.y1 ? `<div style="font-size:0.74em;color:#1565c0;">입고예정 +${_fmt(r.inc.y1)}</div>` : ''}</td>
        <td class="num" style="color:${r.overdue > 0 ? '#c62828' : '#ccc'};font-weight:700;">${r.overdue ? _fmt(r.overdue) : '-'}</td>
        ${S.hz.map(h => `<td class="num">${_cell(r.need[h.key], r.short[h.key])}</td>`).join('')}
        <td class="num" style="color:${r.beyond ? '#666' : '#ccc'};">${r.beyond ? _fmt(r.beyond) : '-'}</td>
        <td class="num" style="color:${r.none ? '#e65100' : '#ccc'};">${r.none ? _fmt(r.none) : '-'}</td>
        <td class="num" style="font-weight:800;">${_fmt(r.needAll)}
          ${r.shortAll > 0 ? `<div style="font-size:0.76em;color:#c62828;font-weight:800;">부족 ${_fmt(r.shortAll)}</div>` : ''}</td>
      </tr>`;
    }).join('');

    const totRow = `<tr style="background:#f8f9fa;font-weight:800;">
      <td style="position:sticky;left:0;background:#f8f9fa;">합계 (${S.rows.length}개 모델)</td>
      <td class="num">${_fmt(S.tot.onHand)}</td>
      <td class="num" style="color:#c62828;">${_fmt(S.tot.overdue)}</td>
      ${S.hz.map(h => `<td class="num">${_fmt(S.tot.need[h.key])}${S.tot.short[h.key] > 0 ? `<div style="font-size:0.76em;color:#c62828;">부족 ${_fmt(S.tot.short[h.key])}</div>` : ''}</td>`).join('')}
      <td class="num">${_fmt(S.tot.beyond)}</td>
      <td class="num">${_fmt(S.tot.none)}</td>
      <td class="num">${_fmt(S.tot.needAll)}</td>
    </tr>`;

    return `
      <div class="card">
        <div class="card-head">
          <h3>모델별 기간 소요량 / 부족수량</h3>
          <span class="tag blue">기준일 ${_e(S.base)} 누적</span>
        </div>
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:600px;">
          <table>
            <thead><tr>
              <th style="position:sticky;left:0;background:#fff;z-index:2;">모델</th>
              <th class="num">현재고</th>
              <th class="num" title="기준일 이전 출고요청일 · 미출고">지연(미납)</th>
              ${hzHead}
              <th class="num">1년 초과</th>
              <th class="num" title="출고요청일 미입력">미정</th>
              <th class="num">전체 필요</th>
            </tr></thead>
            <tbody>${rows}${totRow}</tbody>
          </table>
        </div>
        <div class="card-body" style="padding:12px 20px;font-size:0.8em;color:#888;line-height:1.7;">
          · <strong>필요수량</strong> = 해당 구간까지의 미출고 수주 잔량 누적${_opt.incOverdue ? ' (지연분 포함)' : ' (지연분 제외)'}<br>
          · <strong>부족수량</strong> = 필요수량 − 현재고${_opt.useIncoming ? ' − 입고예정(ETA 이내)' : ''} (0 미만은 0)<br>
          · 잔량 = 수주수량 − 출고지시서 발행수량 (발행분은 재고에서 이미 차감되어 이중계산되지 않습니다)
        </div>
      </div>`;
  }

  // ── 뷰 2: 스케줄 타임라인 ─────────────────────────────
  const UNITS = {
    week:    { label: '1주 단위',   count: 12, next: (d) => _addDays(d, 7) },
    month:   { label: '1개월 단위', count: 12, next: (d) => _addMonths(d, 1) },
    quarter: { label: '3개월 단위', count: 8,  next: (d) => _addMonths(d, 3) },
    half:    { label: '6개월 단위', count: 6,  next: (d) => _addMonths(d, 6) },
    year:    { label: '1년 단위',   count: 3,  next: (d) => _addMonths(d, 12) }
  };

  function _buckets(base, unitKey) {
    const u = UNITS[unitKey] || UNITS.month;
    const out = [];
    let start = base;
    for (let i = 0; i < u.count; i++) {
      const next = u.next(start);
      out.push({ start, end: _addDays(next, -1), label: `${_mdy(start, base)}~${_mdy(_addDays(next, -1), base)}` });
      start = next;
    }
    return out;
  }

  function _viewTimeline(S) {
    const bks = _buckets(S.base, _opt.unit);
    const items = S.items;
    const last = bks.length ? bks[bks.length - 1].end : S.base;
    const incoming = _opt.useIncoming ? _incomingList() : [];

    // 모델 × 버킷 필요량
    const grid = {};
    S.rows.forEach(r => { grid[r.model] = { r, cells: bks.map(() => 0), overdue: 0, beyond: 0, inc: bks.map(() => 0) }; });
    items.forEach(it => {
      const g = grid[it.모델명];
      if (!g) return;
      if (!it.요청일) return;
      if (it.요청일 < S.base) { g.overdue += it.잔량; return; }
      const idx = bks.findIndex(b => it.요청일 <= b.end);
      if (idx < 0) { g.beyond += it.잔량; return; }
      g.cells[idx] += it.잔량;
    });
    incoming.forEach(x => {
      const g = grid[String(x.model || '').trim()];
      if (!g || !x.eta) return;
      const idx = bks.findIndex(b => x.eta <= b.end);
      if (idx >= 0 && x.eta >= S.base) g.inc[idx] += Number(x.qty) || 0;
      else if (x.eta < S.base) g.inc[0] += Number(x.qty) || 0;   // ETA 경과 미도착분 → 첫 구간
    });

    const list = Object.values(grid)
      .filter(g => g.overdue > 0 || g.beyond > 0 || g.cells.some(v => v > 0))
      .sort((a, b) => (b.r.needAll - a.r.needAll));

    if (!list.length) {
      return `<div class="card"><div class="card-body"><div class="empty">해당 조건의 출고예정 물량이 없습니다.</div></div></div>`;
    }

    const rows = list.map(g => {
      // 러닝 재고 시뮬레이션 — 시작 재고에서 구간별 필요량 차감(+입고예정 가산)
      let bal = g.r.onHand - (_opt.incOverdue ? g.overdue : 0);
      let outAt = '';
      const cells = bks.map((b, i) => {
        bal += g.inc[i];
        bal -= g.cells[i];
        if (bal < 0 && !outAt) outAt = b.label;
        const need = g.cells[i];
        const color = bal < 0 ? '#c62828' : '#27ae60';
        return `<td class="num" style="${need ? '' : 'color:#ddd;'}">
          ${need ? `<div style="font-weight:700;">${_fmt(need)}</div>` : '-'}
          ${(need || g.inc[i]) ? `<div style="font-size:0.72em;color:${color};font-weight:700;">잔여 ${_fmt(bal)}</div>` : ''}
          ${g.inc[i] ? `<div style="font-size:0.72em;color:#1565c0;">입고 +${_fmt(g.inc[i])}</div>` : ''}
        </td>`;
      }).join('');
      return `<tr>
        <td style="position:sticky;left:0;background:#fff;font-weight:700;">
          <span style="cursor:pointer;" onclick="shipSched.detail('${_e(g.r.model).replace(/'/g, "\\'")}')">${_e(g.r.model)}</span>
          <div style="font-size:0.74em;color:#999;">현재고 ${_fmt(g.r.onHand)}</div>
        </td>
        <td class="num" style="color:${g.overdue ? '#c62828' : '#ccc'};font-weight:700;">${g.overdue ? _fmt(g.overdue) : '-'}</td>
        ${cells}
        <td class="num" style="color:${g.beyond ? '#666' : '#ccc'};">${g.beyond ? _fmt(g.beyond) : '-'}</td>
        <td class="center">${outAt
          ? `<span class="badge b-취소">${_e(outAt)} 소진</span>`
          : '<span class="badge b-ok">여유</span>'}</td>
      </tr>`;
    }).join('');

    const totCells = bks.map((b, i) =>
      `<td class="num" style="font-weight:800;">${_fmt(list.reduce((a, g) => a + g.cells[i], 0))}</td>`).join('');

    return `
      <div class="card">
        <div class="card-head">
          <h3>출고 스케줄 타임라인</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <select onchange="shipSched.set('unit', this.value)" style="padding:6px 9px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.82em;">
              ${Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${k === _opt.unit ? 'selected' : ''}>${u.label}</option>`).join('')}
            </select>
            <span class="tag gray">${_e(S.base)} ~ ${_e(last)}</span>
          </div>
        </div>
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:600px;">
          <table>
            <thead><tr>
              <th style="position:sticky;left:0;background:#fff;z-index:2;">모델</th>
              <th class="num">지연</th>
              ${bks.map(b => `<th class="num" title="${b.start} ~ ${b.end}">${b.label}</th>`).join('')}
              <th class="num">이후</th>
              <th class="center">재고 소진</th>
            </tr></thead>
            <tbody>
              ${rows}
              <tr style="background:#f8f9fa;font-weight:800;">
                <td style="position:sticky;left:0;background:#f8f9fa;">구간 합계</td>
                <td class="num">${_fmt(list.reduce((a, g) => a + g.overdue, 0))}</td>
                ${totCells}
                <td class="num">${_fmt(list.reduce((a, g) => a + g.beyond, 0))}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body" style="padding:12px 20px;font-size:0.8em;color:#888;line-height:1.7;">
          · 각 셀의 <strong>잔여</strong> = 현재고에서 해당 구간까지의 출고예정 물량을 순차 차감한 재고 시뮬레이션 값입니다.<br>
          · 잔여가 음수가 되는 최초 구간이 <strong>재고 소진</strong> 시점 — 그 이전에 발주/입고가 필요합니다.
        </div>
      </div>`;
  }

  // ── 뷰 3: 출고예정 상세 ───────────────────────────────
  function _viewDetail(S) {
    let items = S.items.slice();
    if (_opt.detailModel) items = items.filter(i => i.모델명 === _opt.detailModel);
    items.sort((a, b) => (a.요청일 || '9999-99-99').localeCompare(b.요청일 || '9999-99-99'));

    const models = [...new Set(S.items.map(i => i.모델명))].sort();
    const head = `
      <div class="card-head">
        <h3>출고예정 상세 내역 (${_fmt(items.length)}건)</h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <select onchange="shipSched.set('detailModel', this.value)" style="padding:6px 9px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.82em;">
            <option value="">전체 모델</option>
            ${models.map(m => `<option ${m === _opt.detailModel ? 'selected' : ''}>${_e(m)}</option>`).join('')}
          </select>
          <span class="tag blue">잔량 합계 ${_fmt(items.reduce((a, i) => a + i.잔량, 0))}</span>
        </div>
      </div>`;

    if (!items.length) {
      return `<div class="card">${head}<div class="card-body"><div class="empty">해당 조건의 출고예정 건이 없습니다.</div></div></div>`;
    }

    const hz = S.hz;
    const bucketLabel = (d) => {
      if (!d) return '<span class="badge b-warn">미정</span>';
      if (d < S.base) return '<span class="badge b-취소">지연</span>';
      const h = hz.find(x => d <= x.end);
      return h ? `<span class="badge b-info">${h.label} 이내</span>` : '<span class="badge">1년 초과</span>';
    };

    const rows = items.map(it => {
      const dd = _dday(it.요청일, S.base);
      const ddText = it.요청일 === '' ? '-' : (dd < 0 ? `<span style="color:#c62828;font-weight:700;">D+${-dd}</span>`
        : dd === 0 ? '<span style="color:#e65100;font-weight:800;">D-DAY</span>' : `D-${dd}`);
      return `<tr>
        <td>${_e(it.요청일) || '<span style="color:#e65100;">미정</span>'}</td>
        <td class="center">${ddText}</td>
        <td class="center">${bucketLabel(it.요청일)}</td>
        <td><strong>${_e(it.pjNo)}</strong></td>
        <td>${_e(it.고객사)}</td>
        <td style="font-size:0.84em;">${_e(it.모델명)}</td>
        <td class="num">${_fmt(it.수량)}</td>
        <td class="num" style="color:#1565c0;">${it.발행 ? _fmt(it.발행) : '-'}</td>
        <td class="num" style="font-weight:800;">${_fmt(it.잔량)}</td>
        <td>${_e(it.담당자)}</td>
        <td class="center">${it.계약금입금 ? '<span class="tag green" style="font-size:0.74em;">입금</span>' : '<span class="tag red" style="font-size:0.74em;">미입금</span>'}</td>
        <td class="center">${typeof statusBadge === 'function' ? statusBadge(it.status) : _e(it.status)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="card">
        ${head}
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:620px;">
          <table>
            <thead><tr>
              <th>출고요청일</th><th class="center">D-Day</th><th class="center">구간</th>
              <th>PJ NO</th><th>고객사</th><th>모델명</th>
              <th class="num">수주수량</th><th class="num">지시서발행</th><th class="num">잔량</th>
              <th>담당자</th><th class="center">계약금</th><th class="center">상태</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }


  // =====================================================
  //  지역별 출고예정 물량 → 근거리 항만 배정 (2026-08 추가)
  //   납품주소의 시/도 · 시군구를 읽어 광양항 / 평택항 / 부산항 중
  //   가장 가까운 항만으로 물량을 묶는다. 수입 물량을 근거리 항으로
  //   받으면 항만 → 현장 내륙운송 거리가 줄어 물류비가 절감된다.
  //   · 기본 배정은 시/도 기준 (서부 경남은 광양항 예외)
  //   · 지역별 배정 항만은 사용자가 직접 변경 가능 (localStorage 저장)
  // =====================================================
  const PORTS = ['광양항', '평택항', '부산항'];
  const PORT_META = {
    '광양항': { loc: '전남 광양', color: '#2e7d32', bg: '#e8f5e9' },
    '평택항': { loc: '경기 평택', color: '#1565c0', bg: '#e3f2fd' },
    '부산항': { loc: '부산 신항', color: '#e65100', bg: '#fff3e0' }
  };
  const PORT_KEY = 'erp_shipsched_ports';

  // 시/도 표기 정규화 (구글시트·수기 입력 표기 흡수)
  const _SIDO_ALIAS = (function () {
    const m = {};
    const add = (canon, list) => list.forEach(v => { m[v] = canon; });
    add('서울', ['서울', '서울시', '서울특별시']);
    add('부산', ['부산', '부산시', '부산광역시']);
    add('대구', ['대구', '대구시', '대구광역시']);
    add('인천', ['인천', '인천시', '인천광역시']);
    add('광주', ['광주', '광주시', '광주광역시']);
    add('대전', ['대전', '대전시', '대전광역시']);
    add('울산', ['울산', '울산시', '울산광역시']);
    add('세종', ['세종', '세종시', '세종특별자치시']);
    add('경기', ['경기', '경기도']);
    add('강원', ['강원', '강원도', '강원특별자치도']);
    add('충북', ['충북', '충청북도']);
    add('충남', ['충남', '충청남도']);
    add('전북', ['전북', '전라북도', '전북특별자치도']);
    add('전남', ['전남', '전라남도']);
    add('경북', ['경북', '경상북도']);
    add('경남', ['경남', '경상남도']);
    add('제주', ['제주', '제주도', '제주특별자치도']);
    return m;
  })();

  // 시/도 → 기본 항만
  const _SIDO_PORT = {
    '서울': '평택항', '인천': '평택항', '경기': '평택항', '강원': '평택항',
    '충북': '평택항', '충남': '평택항', '대전': '평택항', '세종': '평택항',
    '전북': '광양항', '전남': '광양항', '광주': '광양항', '제주': '광양항',
    '부산': '부산항', '울산': '부산항', '대구': '부산항', '경남': '부산항', '경북': '부산항'
  };
  // 서부 경남 — 부산보다 광양이 가까움
  const _WEST_GYEONGNAM = ['진주', '사천', '하동', '남해', '산청', '함양', '거창', '합천', '의령', '고성'];

  let _portOverride = {};
  function _loadPorts() {
    try { _portOverride = JSON.parse(localStorage.getItem(PORT_KEY) || '{}') || {}; } catch (e) { _portOverride = {}; }
  }
  function _savePorts() {
    try { localStorage.setItem(PORT_KEY, JSON.stringify(_portOverride)); } catch (e) {}
  }

  // 시·군 → 시·도 역인덱스 (주소가 시·도 없이 "완주군 화산면 …" 처럼 시작하는 경우 보정)
  //   ★ 고성(강원·경남 중복)은 판정 불가로 제외 — 사용자가 직접 지정
  const _SIGUN_SIDO = (function () {
    const src = {
      '경기': '수원 성남 의정부 안양 부천 광명 평택 동두천 안산 고양 과천 구리 남양주 오산 시흥 군포 의왕 하남 용인 파주 이천 안성 김포 화성 광주 양주 포천 여주 연천 가평 양평',
      '강원': '춘천 원주 강릉 동해 태백 속초 삼척 홍천 횡성 영월 평창 정선 철원 화천 양구 인제 양양',
      '충북': '청주 충주 제천 보은 옥천 영동 증평 진천 괴산 음성 단양',
      '충남': '천안 공주 보령 아산 서산 논산 계룡 당진 금산 부여 서천 청양 홍성 예산 태안',
      '전북': '전주 군산 익산 정읍 남원 김제 완주 진안 무주 장수 임실 순창 고창 부안',
      '전남': '목포 여수 순천 나주 광양 담양 곡성 구례 고흥 보성 화순 장흥 강진 해남 영암 무안 함평 영광 장성 완도 진도 신안',
      '경북': '포항 경주 김천 안동 구미 영주 영천 상주 문경 경산 군위 의성 청송 영양 영덕 청도 고령 성주 칠곡 예천 봉화 울진 울릉',
      '경남': '창원 진주 통영 사천 김해 밀양 거제 양산 의령 함안 창녕 남해 하동 산청 함양 거창 합천',
      '제주': '제주 서귀포'
    };
    const m = {};
    Object.keys(src).forEach(sido => src[sido].split(' ').forEach(n => { m[n] = sido; }));
    return m;
  })();

  //  납품주소 → { sido, sigun, key }
  //   ★ 2026-08 보강: 우편번호·"대한민국"·괄호 접두사 제거, 시·도가 앞머리에 없어도
  //     문자열 어디서든 찾고, 그래도 없으면 시·군 이름으로 시·도를 역추적한다.
  function _parseRegion(addr) {
    let s = String(addr || '').trim();
    if (!s) return { sido: '', sigun: '', key: '(주소 미입력)', raw: '' };
    // 접두 노이즈 제거: "(우) 55365", "[12345]", "대한민국"
    s = s.replace(/^\(?\s*우\s*\)?\s*/, '')
         .replace(/^[\[(]?\d{5,6}[\])]?\s*/, '')
         .replace(/^(대한민국|한국|KOREA)\s+/i, '')
         .trim();
    const tokens = s.split(/\s+/);

    // 1) 앞쪽 토큰에서 시·도 찾기 (보통 0번, 우편번호 등이 남아있으면 1~2번)
    let sido = '', sidoIdx = -1;
    for (let i = 0; i < Math.min(3, tokens.length); i++) {
      const hit = _SIDO_ALIAS[tokens[i]];
      if (hit) { sido = hit; sidoIdx = i; break; }
    }
    // 2) 시·도가 없으면 시·군 이름으로 역추적 ("완주군 화산면 …")
    let sigun = '';
    if (!sido) {
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const m = t.match(/^(.+?)(시|군)$/);
        if (m && _SIGUN_SIDO[m[1]]) { sido = _SIGUN_SIDO[m[1]]; sigun = t; break; }
      }
      if (!sido) return { sido: '', sigun: '', key: '(지역 미확인)', raw: s };
    }
    // 3) 시·군·구 토큰 찾기
    if (!sigun) {
      for (let i = sidoIdx + 1; i < tokens.length; i++) {
        if (/(시|군|구)$/.test(tokens[i])) { sigun = tokens[i]; break; }
      }
    }
    return { sido, sigun, key: sigun ? `${sido} ${sigun}` : sido, raw: s };
  }

  function _defaultPort(r) {
    if (!r.sido) return '';
    if (r.sido === '경남' && _WEST_GYEONGNAM.some(n => (r.sigun || '').startsWith(n))) return '광양항';
    return _SIDO_PORT[r.sido] || '';
  }
  function _portOf(r) {
    return _portOverride[r.key] || _defaultPort(r) || '';
  }

  //  항만 배정 대상 물량 — 선택한 기간까지의 출고예정 건
  function _portItems(S) {
    const key = _opt.portHz || 'm3';
    if (key === 'all') return S.items;
    const h = S.hz.find(x => x.key === key);
    if (!h) return S.items;
    return S.items.filter(it => {
      if (!it.요청일) return false;                       // 출고요청일 미정은 기간 산정 불가
      if (it.요청일 < S.base) return _opt.incOverdue;      // 지연분은 옵션에 따름
      return it.요청일 <= h.end;
    });
  }

  //  지역별 · 항만별 집계
  function _portAgg(S) {
    const items = _portItems(S);
    const regions = {};
    const byPort = {};
    PORTS.forEach(p => { byPort[p] = { qty: 0, cnt: 0, models: {}, regions: new Set() }; });
    const unassigned = { qty: 0, cnt: 0, models: {}, regions: new Set(), samples: [] };

    items.forEach(it => {
      const r = _parseRegion(it.납품주소);
      const port = _portOf(r);
      if (!regions[r.key]) {
        regions[r.key] = {
          key: r.key, sido: r.sido, sigun: r.sigun, port,
          isDefault: !_portOverride[r.key], qty: 0, cnt: 0, models: {}, samples: []
        };
      }
      const R = regions[r.key];
      R.qty += it.잔량; R.cnt++;
      R.models[it.모델명] = (R.models[it.모델명] || 0) + it.잔량;
      if (R.samples.length < 3 && it.발전소명) R.samples.push(it.발전소명);
      const bucket = port ? byPort[port] : unassigned;
      bucket.qty += it.잔량; bucket.cnt++;
      bucket.models[it.모델명] = (bucket.models[it.모델명] || 0) + it.잔량;
      bucket.regions.add(r.key);
      if (!port && unassigned.samples.length < 5 && r.raw) unassigned.samples.push(r.raw);
    });

    const rows = Object.values(regions).sort((a, b) => b.qty - a.qty);
    const total = rows.reduce((a, r) => a + r.qty, 0);
    const models = [...new Set(rows.flatMap(r => Object.keys(r.models)))].sort();
    return { rows, byPort, unassigned, total, models, itemCount: items.length };
  }


  // ── 지역별 출고 리스트 (드릴다운) + 납품주소 수정 ────────
  //   지역 행을 클릭하면 그 지역에 묶인 출고예정 건을 그대로 보여준다.
  //   주소가 잘못됐거나 비어 있어 지역이 안 잡힌 건은 여기서 바로 고치면
  //   수주현황(rawData)에 저장되고 배정이 즉시 다시 계산된다.
  function _regionDetail(S, key) {
    const items = _portItems(S).filter(it => _parseRegion(it.납품주소).key === key);
    const r0 = items.length ? _parseRegion(items[0].납품주소) : { key };
    const port = _portOf(r0);
    const meta = port ? PORT_META[port] : null;
    const totQty = items.reduce((a, it) => a + it.잔량, 0);
    const needFix = (key === '(주소 미입력)' || key === '(지역 미확인)');

    const rows = items
      .slice()
      .sort((a, b) => (a.요청일 || '9999-99-99').localeCompare(b.요청일 || '9999-99-99'))
      .map(it => {
        const dd = _dday(it.요청일, S.base);
        const ddText = !it.요청일 ? '-'
          : dd < 0 ? `<span style="color:#c62828;font-weight:700;">D+${-dd}</span>`
          : dd === 0 ? '<span style="color:#e65100;font-weight:800;">D-DAY</span>' : `D-${dd}`;
        return `<tr>
          <td style="white-space:nowrap;">${_e(it.요청일) || '<span style="color:#e65100;">미정</span>'}</td>
          <td class="center">${ddText}</td>
          <td><strong>${_e(it.pjNo)}</strong></td>
          <td>${_e(it.고객사) || '-'}</td>
          <td style="font-size:0.84em;color:#1565c0;">${_e(it.발전소명) || '-'}</td>
          <td style="font-size:0.84em;">${_e(it.모델명)}</td>
          <td class="num" style="font-weight:800;">${_fmt(it.잔량)}</td>
          <td>${_e(it.담당자) || '-'}</td>
          <td style="min-width:260px;">
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="text" class="ss-addr-input" data-id="${_e(it._id)}" value="${(typeof escapeAttr === 'function' ? escapeAttr(it.납품주소) : _e(it.납품주소))}"
                     placeholder="예) 전북 완주군 화산면 화월리 1225-2"
                     style="flex:1;min-width:0;padding:4px 7px;border:1.5px solid ${needFix ? '#e57373' : '#e0e0e0'};border-radius:6px;font-size:0.86em;"
                     onkeydown="if(event.key==='Enter'){shipSched.setAddress(this.getAttribute('data-id'), this.value);}">
              <button class="btn btn-xs btn-primary" data-id="${_e(it._id)}"
                      onclick="shipSched.setAddress(this.getAttribute('data-id'), this.parentNode.querySelector('.ss-addr-input').value)"
                      title="납품주소를 수주현황에 저장하고 항만 배정을 다시 계산합니다">저장</button>
            </div>
          </td>
        </tr>`;
      }).join('');

    return `
      <div class="card" style="border-left:4px solid ${meta ? meta.color : '#c62828'};">
        <div class="card-head">
          <h3>${_e(key)} — 출고 리스트 <span style="color:#888;font-weight:600;">${items.length}건 · ${_fmt(totQty)}매</span></h3>
          <div style="display:flex;gap:8px;align-items:center;">
            ${meta ? `<span class="tag" style="background:${meta.bg};color:${meta.color};font-weight:700;">${port}</span>`
                   : '<span class="tag red">미배정</span>'}
            <button class="btn btn-xs btn-outline" onclick="shipSched.region('')">닫기 ✕</button>
          </div>
        </div>
        ${needFix ? `<div class="card-body" style="padding:10px 20px;background:#fff8e1;border-bottom:1px solid #ffe0b2;font-size:0.84em;color:#8d6e00;line-height:1.6;">
          ⚠️ 납품주소가 비어 있거나 시·도/시·군을 인식하지 못한 건입니다. 주소를 고쳐 <strong>저장</strong>하면
          수주현황에 반영되고 해당 지역·항만으로 자동 재배정됩니다.
        </div>` : ''}
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:420px;">
          <table>
            <thead><tr>
              <th>출고요청일</th><th class="center">D-Day</th><th>PJ NO</th><th>고객사</th>
              <th>발전소명</th><th>모델명</th><th class="num">잔량</th><th>담당자</th>
              <th>납품주소 <span style="font-weight:400;text-transform:none;">(수정 가능)</span></th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="9" class="empty">해당 지역의 출고예정 건이 없습니다.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  //  납품주소 저장 — rawData 반영 + 캐시 무효화 + 화면 갱신
  function _setAddress(orderId, addr) {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('납품주소 수정')) return;
    if (!orderId || typeof rawData === 'undefined') return;
    const row = rawData.find(r => r._id === orderId);
    if (!row) {
      if (typeof setBanner === 'function') setBanner('err', '❌ 해당 수주를 찾을 수 없습니다.');
      return;
    }
    const next = String(addr || '').trim();
    const prev = String(row['납품주소'] || '').trim();
    if (next === prev) {
      if (typeof setBanner === 'function') setBanner('info', '변경된 내용이 없습니다.');
      return;
    }
    row['납품주소'] = next;
    try {
      const k = (typeof KEYS !== 'undefined' && KEYS.RAW) ? KEYS.RAW : 'erp_raw';
      localStorage.setItem(k, JSON.stringify(rawData));
    } catch (e) {
      if (typeof setBanner === 'function') setBanner('err', '❌ 저장 실패 — 저장 공간을 확인하세요.');
      return;
    }
    if (typeof _bumpEnrichedTs === 'function') _bumpEnrichedTs();

    const r = _parseRegion(next);
    const port = _portOf(r);
    // 수정한 건이 다른 지역으로 옮겨가면 그 지역 리스트를 이어서 보여준다
    _opt.portRegion = r.key;
    _saveOpt();
    _mount();
    if (typeof renderOrders === 'function') { try { renderOrders(); } catch (e) {} }
    if (typeof setBanner === 'function') {
      setBanner('ok', next
        ? `✅ 납품주소 저장 — ${r.key}${port ? ' → ' + port : ' (항만 미배정)'}`
        : '✅ 납품주소 삭제됨');
    }
  }
  // ── 뷰 4: 항만 배정 ───────────────────────────────────
  function _viewPorts(S) {
    const A = _portAgg(S);
    const hzOpts = [{ key: 'all', label: '전체 기간' }].concat(S.hz.map(h => ({ key: h.key, label: `${h.label} 이내` })));
    const curHz = _opt.portHz || 'm3';
    const hzLabel = (hzOpts.find(o => o.key === curHz) || {}).label || '';

    const head = `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-head">
          <h3>근거리 항만 배정 — 지역별 출고예정 물량</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <select onchange="shipSched.set('portHz', this.value)" style="padding:6px 9px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.82em;">
              ${hzOpts.map(o => `<option value="${o.key}" ${o.key === curHz ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
            <span class="tag blue">${_fmt(A.itemCount)}건 · ${_fmt(A.total)}매</span>
            <button class="btn btn-xs btn-outline" onclick="shipSched.resetPorts()" title="지역별 수동 배정을 모두 지우고 기본값(시·도 기준)으로 되돌립니다">↺ 기본 배정</button>
          </div>
        </div>
        <div class="card-body" style="padding:14px 20px;">
          <div class="kpi-grid" style="margin-bottom:0;">
            ${PORTS.map(p => {
              const b = A.byPort[p], m = PORT_META[p];
              const pct = A.total > 0 ? Math.round(b.qty / A.total * 100) : 0;
              const topModels = Object.entries(b.models).sort((x, y) => y[1] - x[1]).slice(0, 2)
                .map(([mo, q]) => `${_e(mo)} ${_fmt(q)}`).join(' · ');
              return `<div class="kpi" style="border-top:4px solid ${m.color};">
                <div class="kpi-icon">🚢</div>
                <div class="kpi-label">${p} <span style="color:#bbb;font-weight:600;">${m.loc}</span></div>
                <div class="kpi-value" style="color:${m.color};">${_fmt(b.qty)}</div>
                <div class="kpi-sub">${b.cnt}건 · ${b.regions.size}개 지역 · 비중 ${pct}%</div>
                <div class="kpi-sub" style="color:#aaa;">${topModels || '-'}</div>
              </div>`;
            }).join('')}
            ${A.unassigned.qty > 0 ? `<div class="kpi" style="border-top:4px solid #c62828;">
                <div class="kpi-icon">❓</div>
                <div class="kpi-label">미배정</div>
                <div class="kpi-value" style="color:#c62828;">${_fmt(A.unassigned.qty)}</div>
                <div class="kpi-sub">${A.unassigned.cnt}건 · 납품주소 확인 필요</div>
              </div>` : ''}
          </div>
        </div>
      </div>`;

    if (!A.rows.length) {
      return head + `<div class="card"><div class="card-body"><div class="empty">${_e(hzLabel)}에 해당하는 출고예정 물량이 없습니다.</div></div></div>`;
    }

    // 표 1 — 지역별 물량 + 배정 항만
    const regionRows = A.rows.map(r => {
      const port = r.port;
      const m = port ? PORT_META[port] : null;
      const pct = A.total > 0 ? Math.round(r.qty / A.total * 100) : 0;
      const models = Object.entries(r.models).sort((a, b) => b[1] - a[1])
        .map(([mo, q]) => `${_e(mo)} <strong>${_fmt(q)}</strong>`).join(' · ');
      return `<tr>
        <td style="font-weight:700;white-space:nowrap;">
          <span style="cursor:pointer;color:#1565c0;text-decoration:underline dotted;" data-key="${_e(r.key)}"
                onclick="shipSched.region(this.getAttribute('data-key'))" title="이 지역의 출고 리스트 보기 · 주소 수정">${_e(r.key)}</span>
          ${r.samples.length ? `<div style="font-size:0.74em;color:#999;font-weight:400;">${_e(r.samples.join(', '))}${r.cnt > r.samples.length ? ' 외' : ''}</div>` : ''}
        </td>
        <td class="num">${r.cnt}</td>
        <td class="num" style="font-weight:800;">${_fmt(r.qty)}</td>
        <td class="num" style="color:#888;">${pct}%</td>
        <td style="font-size:0.82em;color:#555;">${models}</td>
        <td class="center">
          <select data-key="${_e(r.key)}" onchange="shipSched.setPort(this.getAttribute('data-key'), this.value)"
                  style="padding:4px 7px;border-radius:6px;font-size:0.86em;font-weight:700;border:1.5px solid ${m ? m.color : '#c62828'};color:${m ? m.color : '#c62828'};background:${m ? m.bg : '#ffebee'};">
            <option value="" ${!port ? 'selected' : ''}>미배정</option>
            ${PORTS.map(p => `<option value="${p}" ${p === port ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          ${!r.isDefault ? '<div style="font-size:0.7em;color:#e65100;font-weight:700;margin-top:2px;">수동 지정</div>' : ''}
        </td>
      </tr>`;
    }).join('');

    const table1 = `
      <div class="card">
        <div class="card-head">
          <h3>지역별 물량 · 배정 항만</h3>
          <span class="tag gray">${A.rows.length}개 지역 · ${_e(hzLabel)}</span>
        </div>
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:460px;">
          <table>
            <thead><tr>
              <th>지역 (시·도 / 시·군·구)</th>
              <th class="num">건수</th><th class="num">물량</th><th class="num">비중</th>
              <th>모델별 내역</th>
              <th class="center">배정 항만</th>
            </tr></thead>
            <tbody>
              ${regionRows}
              <tr style="background:#f8f9fa;font-weight:800;">
                <td>합계</td>
                <td class="num">${A.rows.reduce((a, r) => a + r.cnt, 0)}</td>
                <td class="num">${_fmt(A.total)}</td>
                <td class="num">100%</td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;

    // 표 2 — 항만 × 모델 배분표 (발주·입고 배분용)
    const table2 = `
      <div class="card">
        <div class="card-head">
          <h3>항만별 · 모델별 반입 배분표</h3>
          <span class="tag green">이 수량대로 각 항으로 나눠 받으면 됩니다</span>
        </div>
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;max-height:420px;">
          <table>
            <thead><tr>
              <th>모델</th>
              ${PORTS.map(p => `<th class="num" style="color:${PORT_META[p].color};">${p}</th>`).join('')}
              ${A.unassigned.qty > 0 ? '<th class="num" style="color:#c62828;">미배정</th>' : ''}
              <th class="num">합계</th>
            </tr></thead>
            <tbody>
              ${A.models.map(mo => {
                const vals = PORTS.map(p => A.byPort[p].models[mo] || 0);
                const un = A.unassigned.models[mo] || 0;
                const sum = vals.reduce((a, b) => a + b, 0) + un;
                return `<tr>
                  <td style="font-weight:700;">${_e(mo)}</td>
                  ${vals.map((v, i) => `<td class="num" style="${v ? `color:${PORT_META[PORTS[i]].color};font-weight:700;` : 'color:#ddd;'}">${v ? _fmt(v) : '-'}</td>`).join('')}
                  ${A.unassigned.qty > 0 ? `<td class="num" style="${un ? 'color:#c62828;font-weight:700;' : 'color:#ddd;'}">${un ? _fmt(un) : '-'}</td>` : ''}
                  <td class="num" style="font-weight:800;">${_fmt(sum)}</td>
                </tr>`;
              }).join('')}
              <tr style="background:#f8f9fa;font-weight:800;">
                <td>합계</td>
                ${PORTS.map(p => `<td class="num" style="color:${PORT_META[p].color};">${_fmt(A.byPort[p].qty)}</td>`).join('')}
                ${A.unassigned.qty > 0 ? `<td class="num" style="color:#c62828;">${_fmt(A.unassigned.qty)}</td>` : ''}
                <td class="num">${_fmt(A.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body" style="padding:12px 20px;font-size:0.8em;color:#888;line-height:1.7;">
          · 기본 배정 — <strong style="color:#1565c0;">평택항</strong>: 수도권·강원·충청 / <strong style="color:#2e7d32;">광양항</strong>: 전라·광주·제주·서부경남(진주·사천·하동 등) / <strong style="color:#e65100;">부산항</strong>: 부산·울산·대구·경남·경북<br>
          · 지역별 <strong>배정 항만</strong>을 바꾸면 즉시 반영되고 다음에도 유지됩니다 (실제 운임·선사 스케줄에 맞춰 조정하세요).<br>
          · 물량은 <strong>미출고 잔량</strong> 기준입니다 — 이미 출고지시서가 발행된 분은 제외됩니다.
        </div>
      </div>`;

    const warn = A.unassigned.qty > 0 ? `
      <div class="card" style="border-left:4px solid #c62828;">
        <div class="card-head"><h3 style="color:#c62828;">⚠️ 지역을 확인할 수 없는 건 (${A.unassigned.cnt}건 · ${_fmt(A.unassigned.qty)}매)</h3></div>
        <div class="card-body" style="font-size:0.86em;color:#555;line-height:1.7;">
          수주현황의 <strong>납품주소</strong>가 비어 있거나 시·도로 시작하지 않아 항만을 배정하지 못했습니다.
          아래 표에서 지역을 직접 선택하거나 납품주소를 보완하세요.
          ${A.unassigned.samples.length ? `<div style="margin-top:6px;color:#999;">예시: ${_e(A.unassigned.samples.join(' / '))}</div>` : ''}
        </div>
      </div>` : '';

    // 선택한 지역의 출고 리스트 (드릴다운) — 지역 표 바로 아래
    const detail = _opt.portRegion ? _regionDetail(S, _opt.portRegion) : '';
    return head + table1 + detail + table2 + warn;
  }
  // ── 엑셀 내보내기 ─────────────────────────────────────
  function _exportXlsx() {
    if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리(XLSX)가 로드되지 않았습니다.'); return; }
    const S = _summary();
    const wb = XLSX.utils.book_new();

    // 시트1 — 기간별 소요/부족
    const head = ['모델', '제조사', '수주건수', '현재고', '지연(미납)'];
    S.hz.forEach(h => head.push(`${h.label} 필요(~${h.end})`));
    S.hz.forEach(h => head.push(`${h.label} 부족`));
    head.push('1년초과', '미정', '전체필요', '전체부족');
    const aoa = [head];
    S.rows.forEach(r => {
      const line = [r.model, r.mfr, r.cnt, r.onHand, r.overdue];
      S.hz.forEach(h => line.push(r.need[h.key]));
      S.hz.forEach(h => line.push(r.short[h.key]));
      line.push(r.beyond, r.none, r.needAll, r.shortAll);
      aoa.push(line);
    });
    const totLine = ['합계', '', '', S.tot.onHand, S.tot.overdue];
    S.hz.forEach(h => totLine.push(S.tot.need[h.key]));
    S.hz.forEach(h => totLine.push(S.tot.short[h.key]));
    totLine.push(S.tot.beyond, S.tot.none, S.tot.needAll, S.tot.shortAll);
    aoa.push(totLine);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '기간별소요');

    // 시트2 — 타임라인
    const bks = _buckets(S.base, _opt.unit);
    const tHead = ['모델', '현재고', '지연', ...bks.map(b => b.label), '이후'];
    const tAoa = [tHead];
    S.rows.forEach(r => {
      const cells = bks.map(() => 0);
      let overdue = 0, beyond = 0;
      S.items.filter(i => i.모델명 === r.model).forEach(it => {
        if (!it.요청일) return;
        if (it.요청일 < S.base) { overdue += it.잔량; return; }
        const idx = bks.findIndex(b => it.요청일 <= b.end);
        if (idx < 0) beyond += it.잔량; else cells[idx] += it.잔량;
      });
      tAoa.push([r.model, r.onHand, overdue, ...cells, beyond]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tAoa), '타임라인');

    // 시트3 — 상세
    const dAoa = [['출고요청일', 'PJ NO', '고객사', '모델명', '수주수량', '지시서발행', '잔량', '담당자', '제조사', '상태', '계약금입금']];
    S.items.slice().sort((a, b) => (a.요청일 || '9999').localeCompare(b.요청일 || '9999')).forEach(it => {
      dAoa.push([it.요청일 || '미정', it.pjNo, it.고객사, it.모델명, it.수량, it.발행, it.잔량, it.담당자, it.제조사, it.status, it.계약금입금 ? 'Y' : 'N']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dAoa), '출고예정상세');

    // 시트4 — 항만 배정 (지역별)
    const A = _portAgg(S);
    const pAoa = [['지역', '건수', '물량', '비중(%)', '배정 항만', '배정 방식']];
    A.rows.forEach(r => pAoa.push([
      r.key, r.cnt, r.qty, A.total ? Math.round(r.qty / A.total * 100) : 0,
      r.port || '미배정', r.isDefault ? '기본(시·도)' : '수동 지정'
    ]));
    pAoa.push(['합계', A.rows.reduce((a, r) => a + r.cnt, 0), A.total, 100, '', '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pAoa), '항만배정');

    // 시트5 — 항만별 · 모델별 반입 배분표
    const mAoa = [['모델', ...PORTS, '미배정', '합계']];
    A.models.forEach(mo => {
      const vals = PORTS.map(p => A.byPort[p].models[mo] || 0);
      const un = A.unassigned.models[mo] || 0;
      mAoa.push([mo, ...vals, un, vals.reduce((a, b) => a + b, 0) + un]);
    });
    mAoa.push(['합계', ...PORTS.map(p => A.byPort[p].qty), A.unassigned.qty, A.total]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mAoa), '항만별모델배분');

    XLSX.writeFile(wb, `출고스케줄_${S.base}.xlsx`);
    if (typeof setBanner === 'function') setBanner('ok', '✅ 출고스케줄 엑셀 저장 완료');
  }

  // ── 인쇄 ──────────────────────────────────────────────
  function _print() {
    const S = _summary();
    const body = document.getElementById('ss-sub-body');
    if (!body) return;
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) { alert('팝업 차단을 해제해주세요.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>출고스케줄 ${S.base}</title>
      <style>
        body{font-family:'Malgun Gothic',sans-serif;padding:20px;font-size:12px;}
        h2{margin-bottom:4px;} .sub{color:#666;font-size:11px;margin-bottom:14px;}
        table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ccc;padding:5px 7px;font-size:11px;}
        th{background:#f0f0f0;} .num{text-align:right;} .center{text-align:center;}
        .card-head,.card-body{display:none;} .empty{padding:20px;text-align:center;color:#999;}
      </style></head><body>
      <h2>출고스케줄 — 모델별 소요/부족</h2>
      <div class="sub">기준일 ${S.base} · 출고예정 ${S.itemCount}건 · 총 필요 ${_fmt(S.tot.needAll)} · 1년내 부족 ${_fmt(S.tot.short.y1)}</div>
      ${body.innerHTML}
      </body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  }

  // ── 공개 API ──────────────────────────────────────────
  window.shipSched = {
    open: () => { if (typeof showTab === 'function') showTab(TAB_ID); else _mount(); },
    refresh: _mount,
    sub: (k) => { _opt.sub = k; _saveOpt(); _mount(); },
    set: (k, v) => {
      _opt[k] = v;
      if (k === 'detailModel' && v) _opt.sub = 'detail';
      _saveOpt();
      _mount();
    },
    detail: (model) => { _opt.detailModel = model; _opt.sub = 'detail'; _saveOpt(); _mount(); },
    reset: () => { _opt.base = ''; _opt.manager = ''; _opt.mfr = ''; _opt.search = ''; _opt.detailModel = ''; _opt.onlyShort = false; _saveOpt(); _mount(); },
    // 지역 → 항만 수동 배정
    setPort: (regionKey, port) => {
      if (!regionKey) return;
      if (port) _portOverride[regionKey] = port;
      else delete _portOverride[regionKey];
      _savePorts();
      _mount();
      if (typeof setBanner === 'function')
        setBanner('ok', port ? `🚢 ${regionKey} → ${port} 배정` : `🚢 ${regionKey} 배정 해제`);
    },
    resetPorts: () => {
      if (!Object.keys(_portOverride).length) {
        if (typeof setBanner === 'function') setBanner('info', '수동 배정된 지역이 없습니다 — 이미 기본값입니다.');
        return;
      }
      if (!confirm('지역별 수동 배정을 모두 지우고 기본값(시·도 기준)으로 되돌릴까요?')) return;
      _portOverride = {};
      _savePorts();
      _mount();
      if (typeof setBanner === 'function') setBanner('ok', '↺ 항만 배정을 기본값으로 되돌렸습니다.');
    },
    ports: () => _portAgg(_summary()),
    // 지역 드릴다운 — 해당 지역의 출고 리스트 열기 / '' 이면 닫기
    region: (key) => {
      _opt.portRegion = (_opt.portRegion === key) ? '' : (key || '');
      _opt.sub = 'ports';
      _saveOpt();
      _mount();
    },
    // 납품주소 수정 → 수주현황 반영 + 항만 재배정
    setAddress: _setAddress,
    exportXlsx: _exportXlsx,
    print: _print,
    summary: _summary,
    _mountToTab: _mount
  };

  // ── showTab 후크 ──────────────────────────────────────
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__shipSchedHooked) return;
    const orig = window.showTab;
    window.showTab = function (id) {
      const r = orig.apply(this, arguments);
      if (id === TAB_ID) setTimeout(_mount, 30);
      return r;
    };
    window.showTab.__shipSchedHooked = true;
  }

  // boot
  _loadOpt();
  _loadPorts();
  _hookShowTab();
  setTimeout(() => {
    const panel = document.getElementById('tab-' + TAB_ID);
    if (panel && panel.classList.contains('active')) _mount();
  }, 800);

  console.log('[ERP-SHIPSCHED] 출고스케줄 모듈 활성 — showTab("shipsched") 또는 shipSched.open()');
})();
