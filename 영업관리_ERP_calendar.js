// =====================================================
//  CALENDAR HEATMAP — 출고 캘린더 (Sprint 5 · #2)
//
//  기능
//   1) 월간 캘린더 — 일별 출고요청건수·총수량 표시
//   2) GitHub-style heatmap — 색상 강도로 출고량 시각화
//   3) 일자 클릭 → 해당일 수주·출고지시서·배차 상세 표시
//   4) 월 이동, 오늘 보기, 통계 요약
//   5) 출고지시서·배차 데이터 통합 조회
//   6) viewer 권한 — 금액 마스킹 자동 적용
//
//  add-only — 기존 코드 0줄 수정
//  공개 API: window.erpCalendar
// =====================================================
(function() {
  'use strict';

  // ── 상태 ────────────────────────────────────────
  let _curYear, _curMonth;     // 0-indexed month
  function _initDate() {
    const now = new Date();
    _curYear = now.getFullYear();
    _curMonth = now.getMonth();
  }
  _initDate();

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _dateStr(y, m, d) {
    return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  // ── 데이터 집계 ──────────────────────────────────
  // 일별 통계: { 'YYYY-MM-DD': { orders:[], dos:[], dispatches:[], qtySum, kwSum, revSum } }
  function _aggregateByDate(year, month) {
    const map = {};
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month+1, 0).getDate();
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    function _ensure(d) {
      if (!map[d]) map[d] = {
        orders: [], dos: [], dispatches: [],
        qtySum: 0, kwSum: 0, revSum: 0,
        statusCounts: { 수주:0, 납품완료:0, 수금완료:0, 취소:0 }
      };
      return map[d];
    }

    // 1) 수주 (출고요청일 기준)
    if (typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          const d = o.출고요청일;
          if (!d || d < monthStart || d > monthEnd) return;
          const cell = _ensure(d);
          cell.orders.push(o);
          cell.qtySum += Number(o.수량) || 0;
          cell.kwSum += Number(String(o.수주용량kW||'').replace(/[^\d.]/g,'')) || 0;
          cell.revSum += Number(o.수주총액) || 0;
          if (cell.statusCounts[o.status] !== undefined) cell.statusCounts[o.status]++;
        });
      } catch (e) { console.warn('[calendar] order aggregate', e); }
    }

    // 2) 출고지시서 (출고일자 기준)
    if (typeof deliveryOrders !== 'undefined') {
      deliveryOrders.forEach(d => {
        if (!d.date || d.date < monthStart || d.date > monthEnd) return;
        const cell = _ensure(d.date);
        cell.dos.push(d);
      });
    }

    // 3) 배차 (배차일자 기준)
    if (typeof dispatch !== 'undefined' && dispatch.list) {
      try {
        dispatch.list().forEach(d => {
          if (!d.date || d.date < monthStart || d.date > monthEnd) return;
          const cell = _ensure(d.date);
          cell.dispatches.push(d);
        });
      } catch (e) {}
    }

    return map;
  }

  // 색상 강도 (heatmap) — 일별 수량 기준 5단계
  function _heatLevel(qty, maxQty) {
    if (qty === 0) return 0;
    if (maxQty === 0) return 0;
    const ratio = qty / maxQty;
    if (ratio < 0.2) return 1;
    if (ratio < 0.4) return 2;
    if (ratio < 0.7) return 3;
    return 4;
  }
  const HEAT_COLORS = [
    'transparent',                                                  // 0 — 없음
    'rgba(21,101,192,0.15)',                                        // 1 — 매우 적음
    'rgba(21,101,192,0.35)',                                        // 2 — 적음
    'rgba(21,101,192,0.65)',                                        // 3 — 많음
    'rgba(21,101,192,0.95)'                                         // 4 — 매우 많음
  ];

  // ── UI ──────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-cal-modal')) return;
    const css = `
      #erp-cal-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-cal-modal.open{display:flex;}
      .cal-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1200px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .cal-hd{padding:14px 18px;background:#1565c0;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .cal-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .cal-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;background:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .cal-nav h2{margin:0;font-size:1.3em;color:#1a1a2e;}
      .cal-nav button{padding:6px 14px;border:1.5px solid #1565c0;background:#fff;color:#1565c0;border-radius:6px;cursor:pointer;font-weight:700;font-size:0.86em;}
      .cal-nav button:hover{background:#e3f2fd;}
      .cal-nav button.today{background:#1565c0;color:#fff;}

      .cal-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;}
      .cal-stat{background:#fff;border-radius:8px;padding:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .cal-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .cal-stat-v{font-size:1.3em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}

      /* ★ 2026-05-12 모든 캘린더 CSS를 #erp-cal-modal 내부로 한정 — 수주현황 달력의 클래스명과 충돌 방지 */
      #erp-cal-modal .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;background:#fff;padding:10px;border-radius:10px;}
      #erp-cal-modal .cal-dow{text-align:center;padding:6px 0;font-size:0.78em;font-weight:800;color:#666;}
      #erp-cal-modal .cal-dow.sun{color:#c62828;}
      #erp-cal-modal .cal-dow.sat{color:#1565c0;}
      #erp-cal-modal .cal-cell{background:#f9f9f9;border:1px solid #f0f0f0;border-radius:6px;min-height:80px;padding:4px;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;position:relative;overflow:hidden;}
      #erp-cal-modal .cal-cell:hover{border-color:#1565c0;box-shadow:0 2px 6px rgba(21,101,192,0.18);transform:translateY(-1px);}
      #erp-cal-modal .cal-cell.empty{background:#fafafa;border-color:#f5f5f5;cursor:default;opacity:0.4;}
      #erp-cal-modal .cal-cell.today{border-color:#1565c0;border-width:2px;background:#fffde7;}
      #erp-cal-modal .cal-cell.weekend .cal-day{color:#c62828;}
      #erp-cal-modal .cal-cell.saturday .cal-day{color:#1565c0;}
      #erp-cal-modal .cal-day{font-size:0.86em;font-weight:700;color:#333;}
      #erp-cal-modal .cal-cell-info{flex:1;font-size:0.74em;line-height:1.3;color:#555;margin-top:2px;}
      #erp-cal-modal .cal-cell-qty{font-size:0.92em;font-weight:800;color:#1565c0;}
      #erp-cal-modal .cal-cell-orders{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px;}
      #erp-cal-modal .cal-pill{font-size:0.66em;padding:1px 5px;border-radius:3px;font-weight:700;}
      #erp-cal-modal .cal-pill-do{background:#e3f2fd;color:#1565c0;}
      #erp-cal-modal .cal-pill-dsp{background:#fff3e0;color:#e65100;}
      #erp-cal-modal .cal-heat-badge{position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;}

      #erp-cal-modal .cal-detail{background:#fff;padding:14px;border-radius:10px;margin-top:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      #erp-cal-modal .cal-detail h3{margin:0 0 10px;color:#1a1a2e;font-size:1em;}
      #erp-cal-modal .cal-detail-section{margin:10px 0;}
      #erp-cal-modal .cal-detail-section-h{font-weight:700;color:#1565c0;font-size:0.86em;margin-bottom:6px;}
      #erp-cal-modal .cal-row{padding:6px 10px;background:#f9f9f9;border-radius:5px;font-size:0.84em;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;}
      #erp-cal-modal .cal-row:hover{background:#e3f2fd;cursor:pointer;}

      /* 모바일 */
      @media (max-width:700px){
        #erp-cal-modal .cal-cell{min-height:55px;padding:2px;}
        #erp-cal-modal .cal-day{font-size:0.74em;}
        #erp-cal-modal .cal-cell-info{font-size:0.66em;}
        #erp-cal-modal .cal-grid{padding:4px;}
        #erp-cal-modal .cal-dow{padding:3px 0;font-size:0.72em;}
        #erp-cal-modal .cal-stats{grid-template-columns:repeat(2,1fr);}
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-cal-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-cal-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="cal-box">
        <div class="cal-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">📅 출고 캘린더 + Heatmap</h4>
          <button onclick="document.getElementById('erp-cal-modal').classList.remove('open')" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="cal-bd" id="cal-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);
  }

  function _renderCalendar() {
    const data = _aggregateByDate(_curYear, _curMonth);
    const today = _today();
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : (v >= 100000000 ? (v/100000000).toFixed(1)+'억' : (v/10000).toFixed(0)+'만');

    // 월간 통계
    let monthQty = 0, monthKw = 0, monthRev = 0, monthOrders = 0, monthDos = 0, monthDispatches = 0;
    let maxDayQty = 0;
    Object.values(data).forEach(c => {
      monthQty += c.qtySum; monthKw += c.kwSum; monthRev += c.revSum;
      monthOrders += c.orders.length; monthDos += c.dos.length; monthDispatches += c.dispatches.length;
      if (c.qtySum > maxDayQty) maxDayQty = c.qtySum;
    });

    const monthName = `${_curYear}년 ${_curMonth+1}월`;
    const firstDow = new Date(_curYear, _curMonth, 1).getDay();
    const lastDay = new Date(_curYear, _curMonth+1, 0).getDate();

    // DOW 헤더
    const dowLabels = ['일','월','화','수','목','금','토'];
    let cellsHtml = dowLabels.map((dl, i) =>
      `<div class="cal-dow ${i===0?'sun':i===6?'sat':''}">${dl}</div>`
    ).join('');

    // 빈 시작 셀
    for (let i = 0; i < firstDow; i++) cellsHtml += '<div class="cal-cell empty"></div>';

    // 날짜 셀
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = _dateStr(_curYear, _curMonth, d);
      const cell = data[dateStr];
      const dow = (firstDow + d - 1) % 7;
      const dowClass = dow === 0 ? 'weekend' : dow === 6 ? 'saturday' : '';
      const isToday = dateStr === today ? 'today' : '';
      const heatLevel = cell ? _heatLevel(cell.qtySum, maxDayQty) : 0;
      const heatBg = HEAT_COLORS[heatLevel];

      const orderCount = cell ? cell.orders.length : 0;
      const doCount = cell ? cell.dos.length : 0;
      const dspCount = cell ? cell.dispatches.length : 0;

      let body = '';
      if (cell && cell.qtySum > 0) {
        body = `<div class="cal-cell-qty">${_fmt(cell.qtySum)}매</div>`;
      }
      let pills = '';
      if (orderCount > 0) pills += `<span class="cal-pill cal-pill-do">📋${orderCount}</span>`;
      if (doCount > 0) pills += `<span class="cal-pill cal-pill-do">📄${doCount}</span>`;
      if (dspCount > 0) pills += `<span class="cal-pill cal-pill-dsp">🚛${dspCount}</span>`;

      cellsHtml += `<div class="cal-cell ${dowClass} ${isToday}" data-date="${_ea(dateStr)}" style="background:${heatBg};">
        <div class="cal-day">${d}</div>
        <div class="cal-cell-info">${body}<div class="cal-cell-orders">${pills}</div></div>
      </div>`;
    }

    const html = `
      <div class="cal-nav">
        <div>
          <button data-act="prev">← 이전</button>
          <button data-act="today" class="today">오늘</button>
          <button data-act="next">다음 →</button>
        </div>
        <h2>${monthName}</h2>
        <div style="display:flex;align-items:center;gap:8px;font-size:0.78em;color:#666;">
          <span>활동량:</span>
          ${HEAT_COLORS.slice(1).map((c,i) =>
            `<span style="display:inline-block;width:14px;height:14px;background:${c};border-radius:3px;"></span>`
          ).join('')}
          <span style="font-size:0.86em;">→</span>
        </div>
      </div>

      <div class="cal-stats">
        <div class="cal-stat"><div class="cal-stat-l">월간 출고</div><div class="cal-stat-v">${_fmt(monthQty)}매</div></div>
        <div class="cal-stat"><div class="cal-stat-l">월간 용량</div><div class="cal-stat-v">${_fmt(Math.round(monthKw))}kW</div></div>
        <div class="cal-stat"><div class="cal-stat-l">월간 매출</div><div class="cal-stat-v">${fmtMoney(monthRev)}원</div></div>
        <div class="cal-stat"><div class="cal-stat-l">수주</div><div class="cal-stat-v">${monthOrders}건</div></div>
        <div class="cal-stat"><div class="cal-stat-l">출고지시서</div><div class="cal-stat-v" style="color:#1565c0;">${monthDos}</div></div>
        <div class="cal-stat"><div class="cal-stat-l">배차</div><div class="cal-stat-v" style="color:#e65100;">${monthDispatches}</div></div>
      </div>

      <div class="cal-grid">${cellsHtml}</div>

      <div id="cal-detail-area"></div>
    `;
    document.getElementById('cal-bd').innerHTML = html;
    _renderDetail(today, data);   // 오늘 자동 선택
  }

  function _renderDetail(dateStr, dataMap) {
    const cell = dataMap ? dataMap[dateStr] : null;
    const area = document.getElementById('cal-detail-area');
    if (!area) return;
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : _fmt(v);

    if (!cell || (cell.orders.length === 0 && cell.dos.length === 0 && cell.dispatches.length === 0)) {
      area.innerHTML = `<div class="cal-detail" style="text-align:center;color:#bbb;">📅 ${_e(dateStr)} — 활동 없음</div>`;
      return;
    }

    let html = `<div class="cal-detail">
      <h3>📅 ${_e(dateStr)} — 상세
        <span style="font-weight:400;color:#666;font-size:0.86em;">
          · 출고 ${_fmt(cell.qtySum)}매 / ${_fmt(Math.round(cell.kwSum))}kW${cell.revSum > 0 ? ' / ' + fmtMoney(cell.revSum) + '원' : ''}
        </span>
      </h3>`;

    // 수주
    if (cell.orders.length) {
      html += `<div class="cal-detail-section"><div class="cal-detail-section-h">📋 수주 (${cell.orders.length}건)</div>`;
      cell.orders.forEach(o => {
        html += `<div class="cal-row" data-act="open-order" data-id="${_ea(o._id)}">
          <span><strong>${_e(o.pjNo)}</strong> · ${_e(o.고객사||'-')} · ${_e(o.모델명||'-')}</span>
          <span style="color:#666;">${_fmt(o.수량)}매 · ${fmtMoney(o.수주총액)}원${o.status?' · '+_e(o.status):''}</span>
        </div>`;
      });
      html += '</div>';
    }
    // 출고지시서
    if (cell.dos.length) {
      html += `<div class="cal-detail-section"><div class="cal-detail-section-h">📄 출고지시서 (${cell.dos.length}건)</div>`;
      cell.dos.forEach(d => {
        html += `<div class="cal-row">
          <span><strong>${_e(d.id)}</strong> · ${_e(d.pjNo||'-')} · ${_e(d.model||'-')}</span>
          <span style="color:#666;">${_fmt(d.totalQty||0)}매${d.processed?' ✅ 처리됨':' 미처리'}</span>
        </div>`;
      });
      html += '</div>';
    }
    // 배차
    if (cell.dispatches.length) {
      html += `<div class="cal-detail-section"><div class="cal-detail-section-h">🚛 배차 (${cell.dispatches.length}건)</div>`;
      cell.dispatches.forEach(dsp => {
        const items = (dsp.items||[]).length;
        html += `<div class="cal-row">
          <span><strong>${_e(dsp.vehicleNo||'-')}</strong>${dsp.driver?' · '+_e(dsp.driver):''} · ${_e(dsp.status||'-')}</span>
          <span style="color:#666;">${items}건 묶음</span>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    area.innerHTML = html;
  }

  function _onModalClick(e) {
    const cell = e.target.closest('.cal-cell[data-date]');
    if (cell) {
      const dateStr = cell.getAttribute('data-date');
      const data = _aggregateByDate(_curYear, _curMonth);
      _renderDetail(dateStr, data);
      // 시각 표시
      document.querySelectorAll('.cal-cell').forEach(c => c.style.outline = '');
      cell.style.outline = '2px solid #1565c0';
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'prev') {
      _curMonth--;
      if (_curMonth < 0) { _curMonth = 11; _curYear--; }
      _renderCalendar();
    }
    else if (act === 'next') {
      _curMonth++;
      if (_curMonth > 11) { _curMonth = 0; _curYear++; }
      _renderCalendar();
    }
    else if (act === 'today') {
      _initDate();
      _renderCalendar();
    }
    else if (act === 'open-order') {
      const id = btn.getAttribute('data-id');
      if (typeof openOrderDetail === 'function') {
        try { openOrderDetail(id); } catch (e) {}
      }
    }
  }

  function open(year, month) {
    // ★ 2026-05-13 통합 캘린더(unifiedCalendar)로 리다이렉트 — 6가지 이벤트 통합 보기
    if (typeof window.unifiedCalendar !== 'undefined' && window.unifiedCalendar.open) {
      window.unifiedCalendar.open();
      return;
    }
    _injectUI();
    if (year != null && month != null) {
      _curYear = year;
      _curMonth = month;
    }
    document.getElementById('erp-cal-modal').classList.add('open');
    setTimeout(_renderCalendar, 30);
  }
  function close() { document.getElementById('erp-cal-modal')?.classList.remove('open'); }

  // ── 공개 API ────────────────────────────────────
  window.erpCalendar = {
    open, close,
    aggregate: _aggregateByDate,
    setMonth: (y, m) => { _curYear = y; _curMonth = m; }
  };

  // ── 부팅 ───────────────────────────────────────
  function boot() { setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-CAL] 출고 캘린더 활성 — erpCalendar.open()');
})();
