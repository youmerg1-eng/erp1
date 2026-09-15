// =====================================================
//  UNIFIED CALENDAR — 통합 캘린더 뷰 (Phase 2 · #2)
//
//  한 화면에서 6가지 일정을 색상별로:
//   📋 수주 납기 (출고요청일)         — 파랑
//   📦 입고 예정 (incoming.eta)        — 보라
//   🚛 출고 (출고지시서)              — 주황
//   🔍 사용전검사 입회                — 빨강
//   💰 임대료 청구 / 결제             — 녹색
//   ↩️ 반품 처리 예정                 — 갈색
//
//  진입: 대시보드 → "통합 캘린더" 버튼 / autoCalendar.open()
//  공개 API: window.unifiedCalendar
// =====================================================
(function() {
  'use strict';

  let _ym = null;     // { year, month } — 표시 중인 월
  let _selectedDate = null;
  let _filters = { 수주:true, 입고:true, 출고:true, 검사:true, 임대:true, 반품:true };

  const EVENT_TYPES = {
    // ★ 2026-05-13 사용자 요청 — 수주 납기 → 발전소명 표기
    수주:  { color:'#1565c0', bg:'#e3f2fd', label:'발전소' },
    입고:  { color:'#7b1fa2', bg:'#f3e5f5', label:'입고 예정' },
    출고:  { color:'#e65100', bg:'#fff3e0', label:'출고' },
    검사:  { color:'#c62828', bg:'#ffebee', label:'사용전검사' },
    임대:  { color:'#27ae60', bg:'#e8f5e9', label:'임대료' },
    반품:  { color:'#5d4037', bg:'#efebe9', label:'반품' }
  };

  // ── 이벤트 수집 ─────────────────────────────────────
  function _collectEvents(year, month) {
    const events = []; // { date, type, title, detail, id, _src }
    const startStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const endStr = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

    // 1) 발전소 (출고요청일 기준)
    //   ★ 2026-05-13 사용자 요청 — title: PJ NO → 발전소명
    //     발전소명 없으면 고객사로, 그래도 없으면 PJ NO 로 fallback
    if (_filters.수주 && typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          if (o.출고요청일 && o.출고요청일 >= startStr && o.출고요청일 <= endStr) {
            const plant = (o.발전소명 || '').trim();
            const title = plant || (o.고객사||'').trim() || o.pjNo;
            events.push({
              date: o.출고요청일,
              type: '수주',
              title: title,
              detail: `${o.pjNo||'-'} · ${o.고객사||''} · ${o.모델명||''} · ${(o.수량||0).toLocaleString()}매`,
              id: o._id,
              _src: 'orders'
            });
          }
        });
      } catch(e) {}
    }

    // 2) 입고 예정 (incoming.eta)
    if (_filters.입고 && typeof window.incoming !== 'undefined' && window.incoming.list) {
      try {
        window.incoming.list().forEach(i => {
          const d = i.eta || '';
          if (d && d >= startStr && d <= endStr && i.status !== 'completed' && i.status !== 'cancelled') {
            events.push({
              date: d,
              type: '입고',
              title: i.model,
              detail: `${(i.qty||0).toLocaleString()}매 · ${i.mfr||'-'} · ${i.status||'-'}`,
              id: i.id,
              _src: 'incoming'
            });
          }
        });
      } catch(e) {}
    }

    // 3) 출고 (출고지시서)
    if (_filters.출고 && typeof deliveryOrders !== 'undefined') {
      try {
        deliveryOrders.forEach(d => {
          const dt = d.date || d.출고일 || d.출고요청일 || '';
          if (dt && dt >= startStr && dt <= endStr) {
            events.push({
              date: dt,
              type: '출고',
              title: d.id || d.pjNo || '-',
              detail: `${d.pjNo||''} · ${d.model||''} · ${(d.qty||d.totalQty||0).toLocaleString()}매`,
              id: d.id,
              _src: 'delivery'
            });
          }
        });
      } catch(e) {}
    }

    // 4) 사용전검사 입회 (rawData.사용전검사 + localMeta._insp.date)
    if (_filters.검사 && typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          const insp = (typeof localMeta !== 'undefined' && localMeta[o._id] && localMeta[o._id]._insp) || {};
          const d = o.사용전검사 || insp.date || '';
          if (d && d >= startStr && d <= endStr) {
            const status = insp.status || 'planned';
            events.push({
              date: d,
              type: '검사',
              title: o.pjNo,
              detail: `${o.고객사||''} · ${o.발전소명||''} · 입회자: ${insp.attendee||'미지정'} · ${status}`,
              id: o._id,
              _src: 'inspection'
            });
          }
        });
      } catch(e) {}
    }

    // 5) 임대료 청구 / 결제 (warehouseRental — 월별 청구일)
    if (_filters.임대 && typeof window.warehouseRental !== 'undefined' && window.warehouseRental.list) {
      try {
        const rentals = window.warehouseRental.list();
        rentals.forEach(r => {
          // 활성 계약의 청구일 (매월 N일)
          if (r.status !== 'active' && r.status !== '활성') return;
          const billDay = r.billDay || r.청구일 || 1;
          const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(billDay).padStart(2,'0')}`;
          // 계약 기간 내에 있을 때만
          if ((r.startDate || '0000-01-01') <= dStr && (r.endDate || '9999-12-31') >= dStr) {
            events.push({
              date: dStr,
              type: '임대',
              title: r.tenant || r.임차인 || '-',
              detail: `${r.warehouseName || '-'} · 월 ${(r.monthlyRent || r.월임대료 || 0).toLocaleString()}원`,
              id: r.id,
              _src: 'rental'
            });
          }
        });
      } catch(e) {}
    }

    // 6) 반품 예상 처리 (status != 완료/폐기/재판매, date 가 이번 달이거나 D-7 내)
    if (_filters.반품 && typeof window.returns !== 'undefined' && window.returns.list) {
      try {
        window.returns.list().forEach(r => {
          if (['완료','폐기','재판매'].includes(r.status)) return;
          const d = r.date || '';
          if (d && d >= startStr && d <= endStr) {
            events.push({
              date: d,
              type: '반품',
              title: r.no || r.id,
              detail: `${r.pjNo||'-'} · ${r.model||'-'} · ${(r.qty||0).toLocaleString()}매 · ${r.status||''}`,
              id: r.id,
              _src: 'returns'
            });
          }
        });
      } catch(e) {}
    }

    return events;
  }

  // ── 모달 렌더 ───────────────────────────────────────
  function _ensureModal() {
    if (document.getElementById('uc-modal')) return;
    const css = `
      #uc-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9600;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #uc-modal.open{display:flex;}
      .uc-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1280px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .uc-hd{padding:14px 18px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .uc-bd{flex:1;overflow-y:auto;padding:14px 18px;background:#fafafa;}
      .uc-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
      .uc-filter{padding:6px 12px;border:2px solid #e0e0e0;border-radius:20px;cursor:pointer;font-size:0.84em;font-weight:700;transition:all .15s;display:inline-flex;align-items:center;gap:6px;background:#fff;}
      .uc-filter.active{border-color:currentColor;}
      .uc-filter input{display:none;}
      .uc-grid{display:grid;grid-template-columns:1fr 360px;gap:14px;}
      .uc-cal{background:#fff;border-radius:10px;padding:14px;}
      .uc-cal-head{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;background:linear-gradient(180deg,#eef2ff,#f5f7ff);border-radius:8px 8px 0 0;padding:10px 0;text-align:center;font-weight:800;font-size:0.84em;border-bottom:1px solid #e0e4f5;margin-bottom:6px;}
      .uc-cal-head .sun{color:#e53935;}
      .uc-cal-head .sat{color:#1976d2;}
      .uc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
      .uc-cell{min-height:90px;border:1px solid #f0f0f0;border-radius:8px;padding:6px;cursor:pointer;background:#fff;transition:all .12s;display:flex;flex-direction:column;gap:2px;}
      .uc-cell:hover{background:#f5f9ff;border-color:#c5cae9;}
      .uc-cell.today{border-color:#1a1a2e;border-width:2px;}
      .uc-cell.selected{background:#eef0ff;border-color:#7986cb;border-width:2px;}
      .uc-cell.other{background:#fafafa;color:#ccc;cursor:default;}
      .uc-cell-num{font-weight:800;font-size:0.84em;line-height:1;margin-bottom:2px;}
      .uc-cell-num.sun{color:#e53935;}
      .uc-cell-num.sat{color:#1976d2;}
      .uc-evt{font-size:0.7em;padding:1px 4px;border-radius:3px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;}
      .uc-side{background:#fff;border-radius:10px;padding:14px;max-height:600px;overflow-y:auto;}
      .uc-side-title{font-weight:800;color:#1a1a2e;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #eee;}
      .uc-side-item{padding:8px 10px;background:#f8f9fa;border-radius:6px;margin-bottom:6px;cursor:pointer;transition:all .12s;border-left:3px solid transparent;}
      .uc-side-item:hover{background:#e8f5e9;}
      .uc-nav-btn{padding:5px 12px;border:1.5px solid #1a1a2e;background:#fff;color:#1a1a2e;border-radius:6px;cursor:pointer;font-weight:700;font-size:0.86em;}
      .uc-nav-btn:hover{background:#1a1a2e;color:#fff;}
    `;
    if (!document.getElementById('uc-style')) {
      const s = document.createElement('style'); s.id = 'uc-style'; s.textContent = css; document.head.appendChild(s);
    }
    const modal = document.createElement('div');
    modal.id = 'uc-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="uc-box">
        <div class="uc-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">통합 캘린더 — 모든 일정 한눈에</h4>
          <button onclick="unifiedCalendar.close()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="uc-bd" id="uc-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function _render() {
    const body = document.getElementById('uc-body');
    if (!body) return;
    if (!_ym) {
      const now = new Date();
      _ym = { year: now.getFullYear(), month: now.getMonth() };
    }
    const { year, month } = _ym;
    const today = new Date().toISOString().slice(0,10);
    const events = _collectEvents(year, month);
    const eventsByDate = {};
    events.forEach(e => {
      if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
      eventsByDate[e.date].push(e);
    });

    const monthLabel = `${year}년 ${month+1}월`;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const cells = [];
    // 이전 달 빈칸
    for (let i = 0; i < firstDay; i++) cells.push({ day: prevDays - firstDay + i + 1, other: true });
    // 이번 달
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false });
    // 다음 달 (42칸 채우기)
    while (cells.length < 42) cells.push({ day: cells.length - daysInMonth - firstDay + 1, other: true });

    // 필터 버튼
    const filterHtml = Object.entries(EVENT_TYPES).map(([k, v]) => `
      <label class="uc-filter ${_filters[k]?'active':''}" style="color:${v.color};background:${_filters[k]?v.bg:'#fff'};">
        <input type="checkbox" ${_filters[k]?'checked':''} onchange="unifiedCalendar._toggleFilter('${k}',this.checked)">
        ${v.label}
        <span style="font-size:0.78em;color:#666;">${events.filter(e=>e.type===k).length}</span>
      </label>
    `).join('');

    // 캘린더 셀
    const cellsHtml = cells.map((c, i) => {
      const colIdx = i % 7;
      const numCls = c.other ? '' : (colIdx === 0 ? 'sun' : colIdx === 6 ? 'sat' : '');
      const dateStr = c.other ? '' : `${year}-${String(month+1).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
      const isToday = dateStr === today;
      const isSelected = dateStr === _selectedDate;
      const dayEvents = dateStr ? (eventsByDate[dateStr] || []) : [];
      const classes = ['uc-cell',
        c.other ? 'other' : '',
        isToday ? 'today' : '',
        isSelected ? 'selected' : ''
      ].filter(Boolean).join(' ');
      const onclick = c.other ? '' : `onclick="unifiedCalendar._selectDate('${dateStr}')"`;
      const eventsHtml = dayEvents.slice(0,3).map(e => {
        const t = EVENT_TYPES[e.type];
        return `<div class="uc-evt" style="background:${t.bg};color:${t.color};" title="${e.title} — ${e.detail}">${e.title}</div>`;
      }).join('');
      const moreCount = dayEvents.length > 3 ? `<div class="uc-evt" style="background:#eee;color:#666;">+${dayEvents.length-3}</div>` : '';
      return `<div class="${classes}" ${onclick}>
        <div class="uc-cell-num ${numCls}">${c.other ? '' : c.day}</div>
        ${eventsHtml}${moreCount}
      </div>`;
    }).join('');

    // 사이드 (선택된 날짜 또는 오늘의 이벤트)
    const sideDate = _selectedDate || today;
    const sideEvents = eventsByDate[sideDate] || [];
    const sideLabel = sideDate === today ? `오늘 (${sideDate})` : sideDate;
    const sideHtml = sideEvents.length === 0
      ? `<div style="padding:30px;text-align:center;color:#bbb;font-size:0.86em;">이 날짜에 일정이 없습니다.</div>`
      : sideEvents.map(e => {
          const t = EVENT_TYPES[e.type];
          return `<div class="uc-side-item" style="border-left-color:${t.color};" onclick="unifiedCalendar._navigateTo('${e._src}','${e.id}')">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <strong style="color:${t.color};">${t.label}</strong>
              <span style="font-size:0.76em;color:#888;">${e.title}</span>
            </div>
            <div style="font-size:0.82em;color:#555;">${e.detail}</div>
          </div>`;
        }).join('');

    body.innerHTML = `
      <div class="uc-toolbar">
        <button class="uc-nav-btn" onclick="unifiedCalendar._navMonth(-12)">◀◀</button>
        <button class="uc-nav-btn" onclick="unifiedCalendar._navMonth(-1)">◀</button>
        <strong style="font-size:1.15em;color:#1a1a2e;min-width:130px;text-align:center;">${monthLabel}</strong>
        <button class="uc-nav-btn" onclick="unifiedCalendar._navMonth(1)">▶</button>
        <button class="uc-nav-btn" onclick="unifiedCalendar._navMonth(12)">▶▶</button>
        <button class="uc-nav-btn" style="background:#1565c0;color:#fff;border-color:#1565c0;" onclick="unifiedCalendar._today()">오늘</button>
        <span style="flex:1;"></span>
        <strong style="font-size:0.86em;color:#666;">총 ${events.length}건</strong>
      </div>
      <div class="uc-toolbar" style="margin-bottom:10px;">${filterHtml}</div>

      <div class="uc-grid">
        <div class="uc-cal">
          <div class="uc-cal-head">
            <div class="sun">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div class="sat">토</div>
          </div>
          <div class="uc-cal-grid">${cellsHtml}</div>
        </div>
        <div class="uc-side">
          <div class="uc-side-title">${sideLabel} — ${sideEvents.length}건</div>
          ${sideHtml}
        </div>
      </div>
    `;
  }

  // ── 액션 ────────────────────────────────────────────
  function _navMonth(delta) {
    if (!_ym) { const n = new Date(); _ym = { year:n.getFullYear(), month:n.getMonth() }; }
    let m = _ym.month + delta;
    let y = _ym.year;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    _ym = { year: y, month: m };
    _render();
  }
  function _today() {
    const n = new Date();
    _ym = { year: n.getFullYear(), month: n.getMonth() };
    _selectedDate = n.toISOString().slice(0,10);
    _render();
  }
  function _selectDate(d) {
    _selectedDate = d;
    _render();
  }
  function _toggleFilter(type, on) {
    _filters[type] = on;
    _render();
  }
  function _navigateTo(src, id) {
    close();
    setTimeout(() => {
      if (src === 'orders' && typeof openOrderDetail === 'function') openOrderDetail(id);
      else if (src === 'delivery' && typeof showTab === 'function') showTab('delivery');
      else if (src === 'incoming' && typeof window.incoming !== 'undefined' && window.incoming.open) window.incoming.open();
      else if (src === 'inspection' && typeof setSalesOpsSubtab === 'function') { showTab('salesops'); setTimeout(()=>setSalesOpsSubtab('inspection'),100); }
      else if (src === 'rental' && typeof showTab === 'function') showTab('warehouse_rental');
      else if (src === 'returns' && typeof showTab === 'function') showTab('returns');
    }, 200);
  }

  function open() {
    _ensureModal();
    document.getElementById('uc-modal').classList.add('open');
    if (!_ym) { const n = new Date(); _ym = { year:n.getFullYear(), month:n.getMonth() }; }
    setTimeout(_render, 30);
  }
  function close() {
    const m = document.getElementById('uc-modal');
    if (m) m.classList.remove('open');
  }

  // ── 대시보드에 진입 버튼 ────────────────────────────
  function _injectDashboardButton() {
    if (document.getElementById('uc-launch-btn')) return;
    const tab = document.getElementById('tab-dashboard');
    if (!tab) return;
    const btn = document.createElement('button');
    btn.id = 'uc-launch-btn';
    btn.style.cssText = 'position:fixed;top:8px;right:280px;z-index:9100;padding:7px 14px;border-radius:18px;background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;border:none;font-weight:700;cursor:pointer;font-size:0.84em;box-shadow:0 2px 6px rgba(0,0,0,0.2);';
    btn.textContent = '📅 통합 캘린더';
    btn.title = '모든 일정을 한 화면에';
    btn.onclick = open;
    document.body.appendChild(btn);
  }

  // ── 공개 API ────────────────────────────────────────
  window.unifiedCalendar = {
    open, close,
    collectEvents: _collectEvents,
    _navMonth, _today, _selectDate, _toggleFilter, _navigateTo
  };

  function boot() {
    setTimeout(_injectDashboardButton, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-UCAL] 통합 캘린더 활성 — unifiedCalendar.open()');
})();
