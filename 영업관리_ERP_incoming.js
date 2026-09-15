// =====================================================
//  INCOMING — Phase D · Day 4~6
//  입고예정 (ETA) + 운송 중 선적 추적
//
//  데이터 키: erp_incoming
//   { id, model, mfr, qty, watt, etd, eta, bl, dest, status, notes, createdAt }
//   status: 'order' | 'shipping' | 'arrived' | 'cleared' | 'completed' | 'cancelled'
//
//  영업이 "언제 들어와요?" 즉답을 위한 핵심 모듈
//
//  콘솔
//    incoming.list()   incoming.add({...})  incoming.open()  incoming.shipping()
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_incoming';
  let data = [];
  try { data = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e) { data = []; }

  function _save() {
    try { localStorage.setItem(KEY, JSON.stringify(data.slice(-2000))); }
    catch(e) {
      if (typeof logError === 'function') logError('incoming.save', e);
    }
  }

  // BACKUP_KEYS에 동적 추가 (safety.js 활성 시)
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.__incomingProtected)) { /* skip */ }
    // safety.js의 BACKUP_KEYS는 IIFE 내부 — 외부에서 수정 불가. 대신 _backup 수동 처리
    function _saveWithBackup() {
      try {
        const prev = localStorage.getItem(KEY);
        if (prev != null) localStorage.setItem(KEY + '_backup', prev);
      } catch(e) {}
      _save();
    }
    var saveFn = _saveWithBackup;
    // expose
    var _save_ = saveFn;
  } catch(e) {}

  function _genId() { return 'IN-' + Date.now() + '-' + Math.random().toString(36).slice(2,5); }

  function _daysUntil(d) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const today = new Date(new Date().toISOString().slice(0,10));
    return Math.ceil((new Date(d) - today) / 86400000);
  }

  function _statusLabel(s) {
    return ({
      order:    { lbl:'발주', color:'#666',    bg:'#f5f5f5' },
      shipping: { lbl:'선적중', color:'#fff',  bg:'#1565c0' },
      arrived:  { lbl:'입항',  color:'#fff',   bg:'#e65100' },
      cleared:  { lbl:'통관완료', color:'#fff', bg:'#7b1fa2' },
      completed:{ lbl:'입고완료', color:'#fff', bg:'#27ae60' },
      cancelled:{ lbl:'취소',  color:'#fff',   bg:'#999'    }
    })[s] || { lbl:s, color:'#666', bg:'#eee' };
  }

  // ── API ─────────────────────────────────────────────
  function add(rec) {
    if (!rec || !rec.model) throw new Error('model 필수');
    const entry = {
      id: rec.id || _genId(),
      createdAt: new Date().toISOString(),
      model: String(rec.model).trim(),
      mfr: rec.mfr || '',
      qty: Number(rec.qty) || 0,
      watt: Number(rec.watt) || 0,
      etd: rec.etd || '',         // 출항예정일
      eta: rec.eta || '',         // 도착예정일
      bl: rec.bl || '',
      dest: rec.dest || '',
      status: rec.status || 'order',
      poNo: rec.poNo || '',
      notes: rec.notes || ''
    };
    data.push(entry);
    if (typeof _save_ === 'function') _save_(); else _save();
    _refreshUI();
    return entry;
  }

  function update(id, patch) {
    const i = data.findIndex(x => x.id === id);
    if (i < 0) return null;
    data[i] = { ...data[i], ...patch, updatedAt: new Date().toISOString() };
    if (typeof _save_ === 'function') _save_(); else _save();
    _refreshUI();
    return data[i];
  }

  function remove(id) {
    if (!confirm('이 입고예정 항목을 삭제합니까?')) return false;
    data = data.filter(x => x.id !== id);
    if (typeof _save_ === 'function') _save_(); else _save();
    _refreshUI();
    return true;
  }

  function summary() {
    const today = new Date().toISOString().slice(0,10);
    const inProgress = data.filter(x => !['completed','cancelled'].includes(x.status));
    const within7 = inProgress.filter(x => {
      const d = _daysUntil(x.eta);
      return d != null && d >= 0 && d <= 7;
    });
    const arrivedClearing = inProgress.filter(x => ['arrived','cleared'].includes(x.status));
    const totalKw = inProgress.reduce((s,x) => s + (x.qty * x.watt) / 1000, 0);
    const shipping = inProgress.filter(x => x.status === 'shipping');
    return {
      total: inProgress.length,
      itemCount: new Set(inProgress.map(x => x.model)).size,
      within7: within7.length,
      arrivedClearing: arrivedClearing.length,
      shipping: shipping.length,
      shippingKw: shipping.reduce((s,x) => s + (x.qty*x.watt)/1000, 0),
      totalKw,
      data: inProgress
    };
  }

  // 운송 중 = status='shipping' 또는 ETD 지났는데 미도착
  function shippingList() {
    const today = new Date().toISOString().slice(0,10);
    return data.filter(x => {
      if (x.status === 'completed' || x.status === 'cancelled') return false;
      if (x.status === 'shipping') return true;
      if (x.etd && x.etd <= today && !['arrived','cleared'].includes(x.status)) return true;
      return false;
    });
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-in-fab')) return;
    const css = `
      #erp-in-fab{position:fixed;bottom:18px;right:344px;width:44px;height:44px;border-radius:50%;
        background:#1976d2;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;}
      #erp-in-fab:hover{background:#0d47a1;transform:scale(1.07);}
      #erp-in-fab .badge{position:absolute;top:-4px;right:-4px;background:#e65100;color:#fff;
        border-radius:10px;padding:0 5px;font-size:0.7em;font-weight:700;min-width:16px;height:16px;
        display:flex;align-items:center;justify-content:center;}
      #erp-in-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:5vh;}
      #erp-in-modal.open{display:flex;}
      .in-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:92%;max-width:1080px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}
      .in-hd{padding:14px 18px;background:#1976d2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .in-hd h4{margin:0;font-size:1em;font-weight:700;}
      .in-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 18px;background:#fafafa;border-bottom:1px solid #eee;}
      .in-stat{padding:10px;border-radius:8px;background:#fff;border:1px solid #e0e0e0;}
      .in-stat-l{font-size:0.74em;color:#888;font-weight:600;margin-bottom:4px;}
      .in-stat-v{font-size:1.3em;font-weight:800;color:#1a1a2e;}
      .in-stat-s{font-size:0.74em;color:#666;margin-top:2px;}
      .in-toolbar{padding:10px 18px;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center;background:#fff;}
      .in-toolbar input,.in-toolbar select{padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.86em;}
      .in-toolbar input.search{flex:1;}
      .in-bd{flex:1;overflow-y:auto;padding:0;}
      .in-tbl{width:100%;border-collapse:collapse;font-size:0.85em;}
      .in-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;position:sticky;top:0;font-size:0.82em;}
      .in-tbl td{padding:8px 10px;border-bottom:1px solid #eee;}
      .in-tbl tr:hover{background:#f5f9ff;}
      .in-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;}
      .in-form{padding:14px 18px;background:#fffde7;border-bottom:1px solid #eee;display:none;}
      .in-form.open{display:block;}
      .in-form-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
      .in-form input,.in-form select{padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.86em;}
      .in-form-actions{margin-top:10px;display:flex;gap:8px;}
      .in-shipping-banner{background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;padding:10px 14px;margin:10px 18px;border-radius:8px;font-size:0.84em;display:flex;justify-content:space-between;align-items:center;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-in-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-in-fab';
    fab.title = '입고예정 (ETA·운송중)';
    fab.innerHTML = '🚢';
    fab.onclick = open;
    document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-in-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="in-box">
        <div class="in-hd">
          <h4>입고예정 (ETA / 운송중)</h4>
          <button onclick="document.getElementById('erp-in-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div id="in-stats" class="in-stats"></div>
        <div id="in-shipping-area"></div>
        <div class="in-toolbar">
          <input class="search" id="in-search" placeholder="🔍 모델 / 매입사 / B/L / 도착지">
          <select id="in-status-filter">
            <option value="">전체 상태</option>
            <option value="order">발주</option>
            <option value="shipping">선적중</option>
            <option value="arrived">입항</option>
            <option value="cleared">통관완료</option>
            <option value="completed">입고완료</option>
            <option value="cancelled">취소</option>
          </select>
          <button class="btn btn-sm btn-blue" onclick="incoming._toggleForm()">➕ 추가</button>
          <button class="btn btn-sm btn-dark" onclick="incoming._refresh()">🔄</button>
        </div>
        <div id="in-form" class="in-form">
          <div class="in-form-grid">
            <input id="in-f-model" placeholder="모델명*">
            <input id="in-f-mfr" placeholder="매입사">
            <input id="in-f-qty" type="number" placeholder="수량(매)">
            <input id="in-f-watt" type="number" placeholder="모듈출력(Wp)">
            <input id="in-f-etd" type="date" placeholder="ETD">
            <input id="in-f-eta" type="date" placeholder="ETA">
            <input id="in-f-bl" placeholder="B/L 번호">
            <input id="in-f-dest" placeholder="도착지">
          </div>
          <input id="in-f-notes" placeholder="비고" style="width:100%;margin-top:8px;padding:7px 10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;">
          <div class="in-form-actions">
            <select id="in-f-status">
              <option value="order">발주</option>
              <option value="shipping">선적중</option>
              <option value="arrived">입항</option>
              <option value="cleared">통관완료</option>
            </select>
            <button class="btn btn-sm btn-green" onclick="incoming._submitForm()">💾 저장</button>
            <button class="btn btn-sm btn-gray" onclick="incoming._toggleForm()">취소</button>
          </div>
        </div>
        <div class="in-bd">
          <table class="in-tbl">
            <thead><tr>
              <th>예상일/ETA</th><th>품목</th><th>매입사</th>
              <th style="text-align:right;">수량</th><th style="text-align:right;">용량</th>
              <th>상태</th><th>선적/도착 일정</th><th>도착지/B/L</th><th>작업</th>
            </tr></thead>
            <tbody id="in-tbody"></tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('in-search').addEventListener('input', _render);
    document.getElementById('in-status-filter').addEventListener('change', _render);
  }

  function _toggleForm() {
    const f = document.getElementById('in-form');
    f.classList.toggle('open');
    if (f.classList.contains('open')) {
      ['in-f-model','in-f-mfr','in-f-qty','in-f-watt','in-f-etd','in-f-eta','in-f-bl','in-f-dest','in-f-notes']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('in-f-status').value = 'order';
      setTimeout(() => document.getElementById('in-f-model')?.focus(), 30);
    }
  }

  function _submitForm() {
    const model = document.getElementById('in-f-model').value.trim();
    if (!model) { alert('모델명 필수'); return; }
    // productMaster 자동 보강
    let watt = parseFloat(document.getElementById('in-f-watt').value) || 0;
    if (!watt && typeof productMaster !== 'undefined' && productMaster[model]) {
      watt = Number(productMaster[model].watt) || 0;
    }
    add({
      model,
      mfr: document.getElementById('in-f-mfr').value.trim(),
      qty: parseInt(document.getElementById('in-f-qty').value) || 0,
      watt,
      etd: document.getElementById('in-f-etd').value,
      eta: document.getElementById('in-f-eta').value,
      bl:  document.getElementById('in-f-bl').value.trim(),
      dest:document.getElementById('in-f-dest').value.trim(),
      notes:document.getElementById('in-f-notes').value.trim(),
      status: document.getElementById('in-f-status').value
    });
    _toggleForm();
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${model} 입고예정 등록`);
  }

  function _refreshUI() {
    if (!document.getElementById('erp-in-modal')?.classList.contains('open')) {
      _updateFabBadge();
      return;
    }
    _render();
  }

  function _updateFabBadge() {
    const fab = document.getElementById('erp-in-fab');
    if (!fab) return;
    const s = summary();
    let badge = fab.querySelector('.badge');
    const within7 = s.within7;
    if (within7 > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        fab.appendChild(badge);
      }
      badge.textContent = within7;
      fab.title = `🚢 입고예정 — 7일내 ${within7}건 ETA`;
    } else {
      if (badge) badge.remove();
      fab.title = `🚢 입고예정 (총 ${s.total}건)`;
    }
  }

  function _render() {
    const s = summary();
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';
    document.getElementById('in-stats').innerHTML = `
      <div class="in-stat" style="background:#e3f2fd;">
        <div class="in-stat-l">입고예정 용량</div>
        <div class="in-stat-v" style="color:#1565c0;">${fmtCap(s.totalKw)}</div>
        <div class="in-stat-s">${s.itemCount}개 품목</div>
      </div>
      <div class="in-stat">
        <div class="in-stat-l">진행 품목</div>
        <div class="in-stat-v">${s.total}</div>
        <div class="in-stat-s">건</div>
      </div>
      <div class="in-stat" style="background:#fff3e0;">
        <div class="in-stat-l">7일 내 ETA</div>
        <div class="in-stat-v" style="color:#e65100;">${s.within7}</div>
        <div class="in-stat-s">건</div>
      </div>
      <div class="in-stat" style="background:#f3e5f5;">
        <div class="in-stat-l">입항·통관중</div>
        <div class="in-stat-v" style="color:#7b1fa2;">${s.arrivedClearing}</div>
        <div class="in-stat-s">건</div>
      </div>`;

    // 운송중 배너
    const shipArea = document.getElementById('in-shipping-area');
    const ship = shippingList();
    if (ship.length) {
      const totalShipKw = ship.reduce((sum,x) => sum + (x.qty*x.watt)/1000, 0);
      shipArea.innerHTML = `<div class="in-shipping-banner">
        <div>🚢 <strong>운송 중 선적: ${ship.length}건 · ${fmtCap(totalShipKw)}</strong></div>
        <div style="font-size:0.86em;opacity:0.9;">${ship.slice(0,3).map(s => s.bl||s.model).join(' · ')}${ship.length>3?` 외 ${ship.length-3}건`:''}</div>
      </div>`;
    } else {
      shipArea.innerHTML = '';
    }

    const search = (document.getElementById('in-search').value || '').toLowerCase();
    const statusF = document.getElementById('in-status-filter').value;
    let rows = [...data].sort((a,b) => (a.eta||'9999') > (b.eta||'9999') ? 1 : -1);
    if (search) rows = rows.filter(r => [r.model,r.mfr,r.bl,r.dest,r.notes].join(' ').toLowerCase().includes(search));
    if (statusF) rows = rows.filter(r => r.status === statusF);

    const tbody = document.getElementById('in-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="padding:30px;text-align:center;color:#bbb;">데이터 없음</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const tag = _statusLabel(r.status);
      const d = _daysUntil(r.eta);
      const eta_disp = r.eta ? (d != null ? (d < 0 ? `${r.eta} <span style="color:#c62828;font-weight:700;">(D+${-d})</span>` : d === 0 ? `${r.eta} <span style="color:#e65100;font-weight:700;">(오늘)</span>` : `${r.eta} <span style="color:#666;">(D-${d})</span>`) : r.eta) : '-';
      const kw = (r.qty * r.watt) / 1000;
      return `<tr>
        <td>${eta_disp}</td>
        <td><strong>${r.model}</strong>${r.poNo?`<div style="font-size:0.75em;color:#888;">PO: ${r.poNo}</div>`:''}</td>
        <td>${r.mfr || '-'}</td>
        <td style="text-align:right;font-weight:700;">${(r.qty||0).toLocaleString()}매</td>
        <td style="text-align:right;color:#1565c0;font-weight:700;">${kw>0?fmtCap(kw):'-'}</td>
        <td><span class="in-tag" style="background:${tag.bg};color:${tag.color};">${tag.lbl}</span></td>
        <td style="font-size:0.82em;">
          ${r.etd?`ETD ${r.etd}<br>`:''}
          ${r.eta?`ETA ${r.eta}`:''}
        </td>
        <td style="font-size:0.82em;">
          ${r.dest||'-'}${r.bl?`<br><span style="color:#888;">${r.bl}</span>`:''}
        </td>
        <td style="white-space:nowrap;">
          <select onchange="incoming.update('${r.id}',{status:this.value})" style="font-size:0.78em;padding:3px 4px;">
            ${['order','shipping','arrived','cleared','completed','cancelled'].map(s => `<option value="${s}" ${s===r.status?'selected':''}>${_statusLabel(s).lbl}</option>`).join('')}
          </select>
          <button class="btn btn-xs btn-red" onclick="incoming.remove('${r.id}')">🗑️</button>
        </td>
      </tr>`;
    }).join('');

    _updateFabBadge();
  }

  function open() {
    _injectUI();
    // 입고관리 탭이 활성이면 → 서브탭으로 전환 (모달 대신 인라인 패널 사용)
    if (typeof window.setInventorySubtab === 'function'
        && document.getElementById('incomingTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('inventory'); } catch(e) {}
      }
      setTimeout(() => window.setInventorySubtab('incoming'), 30);
      return;
    }
    document.getElementById('erp-in-modal').classList.add('open');
    _render();
  }
  function close() {
    document.getElementById('erp-in-modal')?.classList.remove('open');
  }

  // ── 탭 마운트 (입고관리 탭의 incomingTabHost 로 box 이동) ──
  function _mountToTab() {
    const host = document.getElementById('incomingTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-in-modal');
    if (!modal) { try { _injectUI(); } catch(e){ console.error('[incoming] _injectUI 실패:', e); return; } modal = document.getElementById('erp-in-modal'); if (!modal) return; }
    const box = modal.querySelector('.in-box');
    if (!box) return;
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (!host.contains(box)) {
      host.appendChild(box);
      // 탭 환경에 맞게 모달 스타일 조정
      box.style.maxHeight = 'none';
      box.style.width = '100%';
      box.style.maxWidth = '100%';
      box.style.boxShadow = 'none';
      box.style.borderRadius = '12px';
    }
    setTimeout(_render, 30);
  }

  // ── 공개 API ────────────────────────────────────────
  window.incoming = {
    add, update, remove,
    list: () => data.slice(),
    summary,
    shipping: shippingList,
    open, close,
    _toggleForm, _submitForm, _refresh: _render,
    _mountToTab,
    raw: () => data.slice()
  };

  function boot() {
    _injectUI();
    setTimeout(_updateFabBadge, 1500);
    setInterval(_updateFabBadge, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-INCOMING] 입고예정 모듈 활성 — 우측 하단 🚢 또는 incoming.open() 또는 입고관리 탭 → 🚢 입고예정 서브탭');
})();
