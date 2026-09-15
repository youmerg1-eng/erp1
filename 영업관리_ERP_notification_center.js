// =====================================================
//  NOTIFICATION CENTER — 알림 센터 (Phase 2 · #3)
//
//  자동 감지 알림 (10가지)
//   1. 출고 D-7 이내 (납기 임박)
//   2. 출고 D-Day / D+ 지연
//   3. 채권 30일 초과
//   4. 채권 60일 초과 (심각)
//   5. 재고 부족 / 음수 재고
//   6. 임대 계약 만료 D-30
//   7. 사용전검사 D-7
//   8. 입고 ETA D-3
//   9. 정합성 검사 이슈 발견
//  10. 자동 백업 실패 / 누락
//
//  진입: 우측 상단 🔔 배지 클릭
//  공개 API: window.notifCenter
// =====================================================
(function() {
  'use strict';

  const SEEN_KEY = 'erp_notif_seen';
  const SETTINGS_KEY = 'erp_notif_settings';

  // ── 설정 ────────────────────────────────────────────
  function getSettings() {
    const defaults = {
      enabled: true,
      categories: {
        '납기': true, '채권': true, '재고': true,
        '임대': true, '검사': true, '입고': true,
        '시스템': true
      },
      thresholds: {
        deliveryDday: 7,   // D-7 이내 알림
        agingDays: 30,     // 채권 30일
        rentalDday: 30,    // 임대 만료 D-30
        inspectionDday: 7, // 사용전검사 D-7
        incomingDday: 3    // 입고 ETA D-3
      }
    };
    try {
      const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return Object.assign(defaults, v, { categories: Object.assign(defaults.categories, v.categories||{}) });
    } catch(e) { return defaults; }
  }
  function saveSettings(patch) {
    const next = Object.assign(getSettings(), patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch(e) {}
    return next;
  }

  function _seen() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch(e) { return new Set(); }
  }
  function _markSeen(ids) {
    const s = _seen();
    ids.forEach(id => s.add(id));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500))); } catch(e) {}
  }

  // ── 알림 수집 ───────────────────────────────────────
  function collect() {
    const settings = getSettings();
    if (!settings.enabled) return [];
    const c = settings.categories;
    const th = settings.thresholds;
    const today = new Date().toISOString().slice(0,10);
    const now = Date.now();
    const list = [];

    // 1·2) 출고 D-7 / D-Day / D+ (수주)
    if (c.납기 && typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          if (o.status !== '수주' || !o.출고요청일) return;
          const dDiff = Math.round((new Date(o.출고요청일) - new Date(today)) / 86400000);
          if (dDiff < 0) {
            list.push({
              id: 'ovr-' + o._id, category: '납기', severity: 'critical',
              icon: '🚨', title: `납기 초과 D+${Math.abs(dDiff)}`,
              body: `${o.pjNo} · ${o.고객사||''} · ${o.모델명||''}`,
              actionLabel: '수주 상세', actionFn: `openOrderDetail('${o._id}')`,
              when: o.출고요청일
            });
          } else if (dDiff === 0) {
            list.push({
              id: 'd0-' + o._id, category: '납기', severity: 'critical',
              icon: '⏰', title: 'D-DAY (오늘 출고)',
              body: `${o.pjNo} · ${o.고객사||''}`,
              actionLabel: '수주 상세', actionFn: `openOrderDetail('${o._id}')`,
              when: o.출고요청일
            });
          } else if (dDiff <= th.deliveryDday) {
            list.push({
              id: 'd' + dDiff + '-' + o._id, category: '납기', severity: dDiff <= 3 ? 'high' : 'medium',
              icon: dDiff <= 3 ? '⚠️' : '📅', title: `납기 D-${dDiff}`,
              body: `${o.pjNo} · ${o.고객사||''}`,
              actionLabel: '수주 상세', actionFn: `openOrderDetail('${o._id}')`,
              when: o.출고요청일
            });
          }
        });
      } catch(e) {}
    }

    // 3·4) 채권 30일·60일 초과
    if (c.채권 && typeof getEnriched === 'function') {
      try {
        const todayD = new Date(today);
        getEnriched().forEach(o => {
          if (o.status !== '수주') return;
          if (!o.납품일) return;   // 납품 안 됐으면 패스
          const days = Math.round((todayD - new Date(o.납품일)) / 86400000);
          const unpaid = (o.수주총액||0) - (
            (o.계약금입금 ? (o.계약금||0) : 0) +
            (o.중도금1입금 ? (o.중도금1||0) : 0) +
            (o.중도금2입금 ? (o.중도금2||0) : 0) +
            (o.중도금3입금 ? (o.중도금3||0) : 0) +
            (o.잔금입금 ? (o.잔금||0) : 0)
          );
          if (unpaid <= 0) return;   // 완납
          if (days >= 60) {
            list.push({
              id: 'aging60-' + o._id, category: '채권', severity: 'critical',
              icon: '💸', title: `미수금 ${days}일 (심각)`,
              body: `${o.pjNo} · ${o.고객사||''} · 미수 ${unpaid.toLocaleString()}원`,
              actionLabel: '상세', actionFn: `openOrderDetail('${o._id}')`,
              when: o.납품일
            });
          } else if (days >= th.agingDays) {
            list.push({
              id: 'aging30-' + o._id, category: '채권', severity: 'high',
              icon: '💰', title: `미수금 ${days}일 초과`,
              body: `${o.pjNo} · ${o.고객사||''} · 미수 ${unpaid.toLocaleString()}원`,
              actionLabel: '상세', actionFn: `openOrderDetail('${o._id}')`,
              when: o.납품일
            });
          }
        });
      } catch(e) {}
    }

    // 5) 재고 부족·음수
    if (c.재고 && typeof inventoryData !== 'undefined') {
      try {
        const stock = {};
        inventoryData.forEach(r => {
          const k = (r.mfr||'') + '|' + (r.model||r.moduleModel||'');
          if (!stock[k]) stock[k] = { mfr:r.mfr||'', model:r.model||r.moduleModel||'', q:0 };
          const qty = Number(r.qty)||0;
          if (r.type === '입고') stock[k].q += qty;
          else if (r.type === '출고') stock[k].q -= qty;
        });
        Object.values(stock).filter(s => s.q < 0).forEach(s => {
          list.push({
            id: 'negstk-' + s.model, category: '재고', severity: 'critical',
            icon: '📦', title: `음수 재고: ${s.q.toLocaleString()}매`,
            body: `${s.mfr||'-'} · ${s.model||'-'}`,
            actionLabel: '재고관리', actionFn: `showTab('stock')`,
            when: today
          });
        });
      } catch(e) {}
    }

    // 6) 임대 만료 D-30
    if (c.임대 && typeof window.warehouseRental !== 'undefined' && window.warehouseRental.list) {
      try {
        window.warehouseRental.list().forEach(r => {
          if (r.status === 'cancelled' || r.status === '종료') return;
          const end = r.endDate || r.종료일;
          if (!end) return;
          const days = Math.round((new Date(end) - new Date(today)) / 86400000);
          if (days >= 0 && days <= th.rentalDday) {
            list.push({
              id: 'rental-' + r.id, category: '임대',
              severity: days <= 7 ? 'high' : 'medium',
              icon: '🏘️', title: `임대 만료 D-${days}`,
              body: `${r.tenant || r.임차인 || '-'} · ${r.warehouseName||'-'} · ${end}`,
              actionLabel: '임대사업', actionFn: `showTab('warehouse_rental')`,
              when: end
            });
          }
        });
      } catch(e) {}
    }

    // 7) 사용전검사 D-7
    if (c.검사 && typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          const insp = (typeof localMeta !== 'undefined' && localMeta[o._id] && localMeta[o._id]._insp) || {};
          const d = o.사용전검사 || insp.date || '';
          if (!d) return;
          if (insp.status === 'passed' || insp.status === 'attended') return;
          const days = Math.round((new Date(d) - new Date(today)) / 86400000);
          if (days >= 0 && days <= th.inspectionDday) {
            list.push({
              id: 'insp-' + o._id, category: '검사',
              severity: days <= 1 ? 'high' : 'medium',
              icon: '🔍', title: `사용전검사 D-${days}`,
              body: `${o.pjNo} · ${o.고객사||''} · ${o.발전소명||''} · 입회자: ${insp.attendee||'미지정'}`,
              actionLabel: '사용전검사', actionFn: `showTab('salesops');setTimeout(()=>setSalesOpsSubtab('inspection'),100)`,
              when: d
            });
          }
        });
      } catch(e) {}
    }

    // 8) 입고 ETA D-3
    if (c.입고 && typeof window.incoming !== 'undefined' && window.incoming.list) {
      try {
        window.incoming.list().forEach(i => {
          if (i.status === 'completed' || i.status === 'cancelled') return;
          if (!i.eta) return;
          const days = Math.round((new Date(i.eta) - new Date(today)) / 86400000);
          if (days >= 0 && days <= th.incomingDday) {
            list.push({
              id: 'incmg-' + i.id, category: '입고', severity: 'medium',
              icon: '🚢', title: `입고 ETA D-${days}`,
              body: `${i.model||''} · ${(i.qty||0).toLocaleString()}매 · ${i.mfr||'-'}`,
              actionLabel: '입고예정', actionFn: `showTab('inventory');setTimeout(()=>setInventorySubtab('incoming'),100)`,
              when: i.eta
            });
          }
        });
      } catch(e) {}
    }

    // 9) 정합성 이슈
    if (c.시스템 && typeof window.dataIntegrity !== 'undefined') {
      try {
        const report = window.dataIntegrity.getLastReport();
        if (report && report.totalIssues > 0) {
          list.push({
            id: 'integrity-' + (report.at||''), category: '시스템', severity: 'medium',
            icon: '🔧', title: `정합성 이슈 ${report.totalIssues}건`,
            body: `마지막 검사: ${(report.at||'').slice(0,10)}`,
            actionLabel: '확인', actionFn: `showTab('settings')`,
            when: report.at
          });
        }
      } catch(e) {}
    }

    // 10) 자동 백업 누락
    if (c.시스템 && typeof window.autoBackup !== 'undefined') {
      try {
        const cfg = window.autoBackup.getConfig();
        if (cfg.enabled && cfg.lastBackup) {
          const hours = (now - new Date(cfg.lastBackup).getTime()) / 3600000;
          if (hours > 48) {  // 2일 이상 백업 없음
            list.push({
              id: 'backup-stale', category: '시스템', severity: 'high',
              icon: '💾', title: `백업 ${Math.floor(hours/24)}일 누락`,
              body: `마지막 백업: ${cfg.lastBackup.slice(0,10)}`,
              actionLabel: '설정', actionFn: `showTab('settings')`,
              when: cfg.lastBackup
            });
          }
        }
      } catch(e) {}
    }

    // 정렬: severity (critical → high → medium) + 날짜
    const sevOrder = { 'critical':3, 'high':2, 'medium':1 };
    list.sort((a, b) => (sevOrder[b.severity]||0) - (sevOrder[a.severity]||0) || (a.when||'').localeCompare(b.when||''));

    return list;
  }

  function unreadCount() {
    const all = collect();
    const seen = _seen();
    return all.filter(n => !seen.has(n.id)).length;
  }

  // ── UI ──────────────────────────────────────────────
  function _ensureButton() {
    if (document.getElementById('notif-bell')) return;
    const btn = document.createElement('button');
    btn.id = 'notif-bell';
    btn.style.cssText = 'position:fixed;top:8px;right:228px;z-index:9100;padding:5px 10px;border-radius:18px;background:#fff;border:1.5px solid #1a1a2e;cursor:pointer;font-size:0.84em;font-weight:700;color:#1a1a2e;box-shadow:0 1px 4px rgba(0,0,0,0.1);transition:all .2s;';
    btn.onclick = openPanel;
    btn.title = '알림 센터';
    document.body.appendChild(btn);
    _updateButton();
  }
  function _updateButton() {
    _ensureButton();
    const btn = document.getElementById('notif-bell');
    if (!btn) return;
    const cnt = unreadCount();
    if (cnt > 0) {
      btn.innerHTML = `🔔 <span style="background:#c62828;color:#fff;padding:1px 6px;border-radius:10px;font-size:0.78em;margin-left:2px;">${cnt}</span>`;
      btn.style.borderColor = '#c62828';
    } else {
      btn.innerHTML = '🔔';
      btn.style.borderColor = '#bbb';
    }
  }

  function openPanel() {
    const old = document.getElementById('notif-panel');
    if (old) { old.remove(); return; }

    const all = collect();
    const seen = _seen();

    // 카테고리별 그룹화
    const byCat = {};
    all.forEach(n => {
      if (!byCat[n.category]) byCat[n.category] = [];
      byCat[n.category].push(n);
    });
    const catColors = {
      '납기': '#0d47a1', '채권': '#c62828', '재고': '#e65100',
      '임대': '#27ae60', '검사': '#7b1fa2', '입고': '#5d4037',
      '시스템': '#455a64'
    };

    const modal = document.createElement('div');
    modal.id = 'notif-panel';
    modal.style.cssText = 'position:fixed;top:50px;right:14px;z-index:9700;width:420px;max-height:75vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);display:flex;flex-direction:column;overflow:hidden;border:1px solid #e0e0e0;';
    modal.innerHTML = `
      <div style="padding:12px 16px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;">
        <h4 style="margin:0;font-size:0.95em;font-weight:700;">🔔 알림 센터 (${all.length}건)</h4>
        <div>
          <button onclick="notifCenter._markAllSeen()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fff;padding:3px 10px;border-radius:5px;font-size:0.78em;cursor:pointer;margin-right:4px;">모두 읽음</button>
          <button onclick="notifCenter._openSettings()" style="background:transparent;border:none;color:#fff;font-size:14px;cursor:pointer;margin-right:4px;">⚙</button>
          <button onclick="document.getElementById('notif-panel').remove()" style="background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:8px;">
        ${all.length === 0
          ? '<div style="padding:40px 20px;text-align:center;color:#bbb;"><div style="font-size:2em;margin-bottom:8px;">🎉</div>새로운 알림이 없습니다.</div>'
          : Object.entries(byCat).map(([cat, items]) => `
            <div style="margin-bottom:10px;">
              <div style="font-weight:700;color:${catColors[cat]||'#1a1a2e'};font-size:0.84em;padding:4px 8px;margin-bottom:4px;">
                ${cat} (${items.length})
              </div>
              ${items.map(n => {
                const isNew = !seen.has(n.id);
                const sevColor = { 'critical':'#c62828','high':'#e65100','medium':'#1565c0' }[n.severity] || '#888';
                return `<div onclick="notifCenter._handleClick('${n.id}','${n.actionFn.replace(/'/g,'\\\'')}')" style="padding:8px 10px;background:${isNew?'#fff8e1':'#f8f9fa'};border-left:3px solid ${sevColor};border-radius:5px;margin-bottom:4px;cursor:pointer;transition:all .15s;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;">
                    <strong style="font-size:0.86em;color:${sevColor};">${n.icon} ${n.title}</strong>
                    ${isNew ? '<span style="font-size:0.7em;background:#c62828;color:#fff;padding:1px 5px;border-radius:8px;">NEW</span>' : ''}
                  </div>
                  <div style="font-size:0.78em;color:#555;margin-bottom:2px;">${n.body}</div>
                  <div style="font-size:0.74em;color:#888;">${n.when||''} · ${n.actionLabel}</div>
                </div>`;
              }).join('')}
            </div>
          `).join('')
        }
      </div>
    `;
    document.body.appendChild(modal);

    // ESC 닫기
    const escHandler = (e) => {
      if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  function _handleClick(id, actionFn) {
    _markSeen([id]);
    _updateButton();
    document.getElementById('notif-panel')?.remove();
    try { eval(actionFn); } catch(e) { console.warn('[notif] action failed', e); }
  }
  function _markAllSeen() {
    const all = collect();
    _markSeen(all.map(n => n.id));
    _updateButton();
    document.getElementById('notif-panel')?.remove();
    if (typeof setBanner === 'function') setBanner('ok', '✓ 모든 알림을 읽음 처리');
  }
  function _openSettings() {
    const s = getSettings();
    document.getElementById('notif-panel')?.remove();
    const html = Object.entries(s.categories).map(([k,v]) => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fafbfc;border-radius:6px;margin-bottom:4px;cursor:pointer;">
        <input type="checkbox" ${v?'checked':''} onchange="notifCenter._toggleCat('${k}',this.checked)" style="width:16px;height:16px;cursor:pointer;">
        <strong style="flex:1;">${k}</strong>
      </label>
    `).join('');
    const modal = document.createElement('div');
    modal.id = 'notif-settings';
    modal.style.cssText = 'position:fixed;top:50px;right:14px;z-index:9700;width:380px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;border:1px solid #e0e0e0;';
    modal.innerHTML = `
      <div style="padding:12px 16px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;">
        <h4 style="margin:0;font-size:0.95em;">⚙ 알림 설정</h4>
        <button onclick="document.getElementById('notif-settings').remove()" style="background:transparent;border:none;color:#fff;cursor:pointer;">✕</button>
      </div>
      <div style="padding:14px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px;background:${s.enabled?'#e8f5e9':'#ffebee'};border-radius:8px;margin-bottom:10px;cursor:pointer;">
          <input type="checkbox" ${s.enabled?'checked':''} onchange="notifCenter._toggleEnabled(this.checked)" style="width:18px;height:18px;cursor:pointer;">
          <strong>알림 활성화</strong>
        </label>
        <div style="font-weight:700;margin:10px 0 6px;color:#555;font-size:0.86em;">카테고리</div>
        ${html}
      </div>
    `;
    document.body.appendChild(modal);
  }
  function _toggleEnabled(on) {
    saveSettings({ enabled: !!on });
    _updateButton();
  }
  function _toggleCat(k, on) {
    const s = getSettings();
    s.categories[k] = !!on;
    saveSettings({ categories: s.categories });
  }

  // ── 공개 API ────────────────────────────────────────
  window.notifCenter = {
    open: openPanel, openPanel,
    collect, unreadCount,
    getSettings, saveSettings,
    _markAllSeen, _handleClick, _openSettings, _toggleEnabled, _toggleCat,
    _updateButton
  };

  function boot() {
    setTimeout(_ensureButton, 1200);
    // 매 분 알림 카운트 업데이트
    setInterval(_updateButton, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-NOTIF] 알림 센터 활성 — notifCenter.openPanel()');
})();
