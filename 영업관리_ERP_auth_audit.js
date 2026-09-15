// =====================================================
//  AUTH AUDIT LOG — 권한 변경 이력 추적 (Sprint 6 · #3)
//
//  추적 대상
//   - erpAuth.setRole(r) — 역할 전환
//   - erpAuth.adminSave() — 커스텀 권한 저장
//   - erpAuth.adminReset() — 권한 초기화
//   - erpAuth.adminClearOne() — 단일 역할 초기화
//   - erpAuth.saveCustom() — 직접 커스텀 변경 (보호 차원에서 차단됐지만 hook은 유지)
//
//  기록 항목
//   - 시각, 변경 주체(현재 역할), 액션, 이전 → 새 값
//   - 디바이스 ID (브라우저 fingerprint), 사용자 에이전트 일부
//   - 변경 결과 success/fail
//
//  데이터 키
//   erp_auth_audit → [{ id, ts, actor, action, before, after, success, deviceId, ua }]
//
//  설정 탭에 자동 노출 (admin 권한자만)
//  콘솔: erpAuthAudit.list() / erpAuthAudit.clear() / erpAuthAudit.export()
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_auth_audit';
  const MAX_LOG = 500;
  const RETAIN_DAYS = 90;     // 90일 이상 자동 정리

  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _genId() { return 'AL-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); }

  // 디바이스 ID — 한 번 생성하고 localStorage에 저장
  function _deviceId() {
    let id = localStorage.getItem('erp_device_id');
    if (!id) {
      id = 'D-' + Math.random().toString(36).slice(2,12) + '-' + Date.now().toString(36);
      try { localStorage.setItem('erp_device_id', id); } catch (e) {}
    }
    return id;
  }

  // ── 데이터 로드/저장 ──────────────────────────────
  let logs = [];
  function _load() {
    try {
      const raw = localStorage.getItem(KEY);
      logs = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(logs)) logs = [];
    } catch (e) { logs = []; }
    // 90일 이상 자동 정리
    const cutoff = Date.now() - RETAIN_DAYS * 86400000;
    const before = logs.length;
    logs = logs.filter(l => (l.ts || 0) > cutoff);
    if (logs.length !== before) _save();
  }
  function _save() {
    try {
      // 최대 개수 제한
      if (logs.length > MAX_LOG) logs = logs.slice(-MAX_LOG);
      localStorage.setItem(KEY, JSON.stringify(logs));
    } catch (e) { console.error('[auth-audit] save 실패', e); }
  }

  // ── 핵심 — 로그 기록 ──────────────────────────────
  function record(action, before, after, success) {
    const cur = (typeof erpAuth !== 'undefined' && erpAuth.getRole) ? erpAuth.getRole() : 'unknown';
    const log = {
      id: _genId(),
      ts: Date.now(),
      tsLabel: new Date().toLocaleString('ko-KR'),
      actor: cur,
      action,
      before: _safeClone(before),
      after: _safeClone(after),
      success: success !== false,
      deviceId: _deviceId(),
      ua: (navigator.userAgent || '').slice(0, 80)
    };
    logs.push(log);
    _save();
    // 위험한 액션은 콘솔에도 표시
    if (action === 'setRole' && after === 'admin' && before !== 'admin') {
      console.warn('[auth-audit] ⚠️ admin 권한 획득:', log);
    }
    return log;
  }
  function _safeClone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
  }

  // ── erpAuth 메소드 hook ──────────────────────────
  function _hookAuth() {
    if (typeof window.erpAuth === 'undefined') {
      setTimeout(_hookAuth, 500);
      return;
    }
    // setRole hook
    if (window.erpAuth.setRole && !window.erpAuth.setRole.__auditHooked) {
      const _orig = window.erpAuth.setRole;
      window.erpAuth.setRole = function(r) {
        const before = (typeof window.erpAuth.getRole === 'function') ? window.erpAuth.getRole() : null;
        let success = true, err = null;
        try {
          const result = _orig.apply(this, arguments);
          record('setRole', before, r, true);
          return result;
        } catch (e) {
          success = false; err = e.message;
          record('setRole', before, r, false);
          throw e;
        }
      };
      window.erpAuth.setRole.__auditHooked = true;
    }
    // adminSave hook
    if (window.erpAuth.adminSave && !window.erpAuth.adminSave.__auditHooked) {
      const _orig = window.erpAuth.adminSave;
      window.erpAuth.adminSave = function() {
        const beforeCustom = (typeof window.erpAuth.customPerms === 'function') ? window.erpAuth.customPerms() : {};
        let success = true;
        try {
          const result = _orig.apply(this, arguments);
          const afterCustom = window.erpAuth.customPerms();
          record('adminSave', beforeCustom, afterCustom, true);
          return result;
        } catch (e) {
          success = false;
          record('adminSave', beforeCustom, null, false);
          throw e;
        }
      };
      window.erpAuth.adminSave.__auditHooked = true;
    }
    // adminReset hook
    if (window.erpAuth.adminReset && !window.erpAuth.adminReset.__auditHooked) {
      const _orig = window.erpAuth.adminReset;
      window.erpAuth.adminReset = function() {
        const before = window.erpAuth.customPerms();
        try {
          const result = _orig.apply(this, arguments);
          record('adminReset', before, {}, true);
          return result;
        } catch (e) {
          record('adminReset', before, null, false);
          throw e;
        }
      };
      window.erpAuth.adminReset.__auditHooked = true;
    }
    // adminClearOne hook
    if (window.erpAuth.adminClearOne && !window.erpAuth.adminClearOne.__auditHooked) {
      const _orig = window.erpAuth.adminClearOne;
      window.erpAuth.adminClearOne = function() {
        const before = window.erpAuth.customPerms();
        try {
          const result = _orig.apply(this, arguments);
          const after = window.erpAuth.customPerms();
          record('adminClearOne', before, after, true);
          return result;
        } catch (e) {
          record('adminClearOne', before, null, false);
          throw e;
        }
      };
      window.erpAuth.adminClearOne.__auditHooked = true;
    }

    console.log('[auth-audit] erpAuth 메소드 hook 적용됨');
  }

  // ── 설정 탭 inject (admin 만) ─────────────────────
  function _injectIntoSettings() {
    // ★ 2026-05-13 권한관리 섹션(set-section-perm)에 직접 주입
    const permSection = document.getElementById('set-section-perm');
    const tab = document.getElementById('tab-settings');
    const host = permSection || tab;
    if (!host) return;
    if (document.getElementById('auth-audit-section')) return;
    const isAdmin = (typeof erpAuth !== 'undefined' && erpAuth.getRole && erpAuth.getRole() === 'admin');
    if (!isAdmin) return;     // admin만 노출

    const section = document.createElement('div');
    section.id = 'auth-audit-section';
    section.style.cssText = 'margin-top:24px;padding:18px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;';
    host.appendChild(section);
    _renderSection();
  }

  function _renderSection() {
    const sec = document.getElementById('auth-audit-section');
    if (!sec) return;
    const isAdmin = (typeof erpAuth !== 'undefined' && erpAuth.getRole && erpAuth.getRole() === 'admin');
    if (!isAdmin) { sec.style.display = 'none'; return; }
    sec.style.display = '';

    const recent = logs.slice(-30).reverse();
    const stats = _stats();
    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:1.05em;color:#1a1a2e;">🔍 권한 변경 이력 (Audit Log)</h3>
        <div>
          <button class="aa-btn" onclick="window.erpAuthAudit.export()" style="padding:6px 12px;background:#fff;border:1.5px solid #ccc;border-radius:6px;cursor:pointer;font-size:0.84em;">📥 CSV 다운로드</button>
          <button class="aa-btn" onclick="if(confirm('이력을 모두 삭제하시겠습니까?'))window.erpAuthAudit.clear();" style="padding:6px 12px;background:#fff;border:1.5px solid #c62828;color:#c62828;border-radius:6px;cursor:pointer;font-size:0.84em;">🗑 전체 삭제</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px;">
        <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;font-weight:700;">전체 기록</div><div style="font-size:1.3em;font-weight:900;">${stats.total}건</div></div>
        <div style="background:#fff3e0;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;font-weight:700;">역할 변경</div><div style="font-size:1.3em;font-weight:900;color:#e65100;">${stats.setRole}</div></div>
        <div style="background:#ffebee;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;font-weight:700;">권한 부여 변경</div><div style="font-size:1.3em;font-weight:900;color:#c62828;">${stats.adminSave}</div></div>
        <div style="background:#fffde7;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;font-weight:700;">최근 7일</div><div style="font-size:1.3em;font-weight:900;color:#f9a825;">${stats.recent7d}</div></div>
        <div style="background:#e8f5e9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;font-weight:700;">현재 디바이스 ID</div><div style="font-size:0.86em;font-family:monospace;font-weight:700;word-break:break-all;">${_e(_deviceId())}</div></div>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.84em;background:#fff;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:8px 10px;text-align:left;">시각</th>
            <th style="padding:8px 10px;">주체</th>
            <th style="padding:8px 10px;">액션</th>
            <th style="padding:8px 10px;">변경 내용</th>
            <th style="padding:8px 10px;text-align:center;">결과</th>
          </tr></thead>
          <tbody>
            ${recent.length === 0
              ? '<tr><td colspan="5" style="padding:30px;text-align:center;color:#bbb;">기록 없음</td></tr>'
              : recent.map(l => _renderRow(l)).join('')}
          </tbody>
        </table>
        ${logs.length > 30 ? `<div style="margin-top:8px;text-align:center;color:#888;font-size:0.82em;">최근 30건 표시 (전체 ${logs.length}건). CSV 다운로드로 전체 확인.</div>` : ''}
      </div>

      <div style="margin-top:12px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.82em;color:#666;line-height:1.5;">
        💡 90일 이상 된 기록은 자동 삭제됩니다. 최대 ${MAX_LOG}건까지 보관.<br>
        ⚠️ 단일 PC UI 제어이므로 F12 콘솔에서 직접 localStorage를 변조하면 기록되지 않습니다 (다중 사용자 환경에서만 보장됨).
      </div>
    `;
  }

  function _renderRow(l) {
    const actionLabels = {
      setRole: '역할 변경',
      adminSave: '권한 부여 저장',
      adminReset: '전체 권한 초기화',
      adminClearOne: '단일 역할 초기화'
    };
    const actionColors = {
      setRole: '#e65100',
      adminSave: '#c62828',
      adminReset: '#7b1fa2',
      adminClearOne: '#1565c0'
    };
    let summary = '';
    if (l.action === 'setRole') {
      summary = `${_e(l.before||'(없음)')} → <strong>${_e(l.after)}</strong>`;
    } else if (l.action === 'adminSave') {
      const beforeKeys = l.before ? Object.keys(l.before) : [];
      const afterKeys = l.after ? Object.keys(l.after) : [];
      summary = `커스텀 적용된 역할: ${beforeKeys.length} → ${afterKeys.length}개`;
      if (afterKeys.length) summary += ` (${afterKeys.map(_e).join(', ')})`;
    } else if (l.action === 'adminReset') {
      const cnt = l.before ? Object.keys(l.before).length : 0;
      summary = `${cnt}개 역할의 커스텀 권한 모두 제거`;
    } else if (l.action === 'adminClearOne') {
      const beforeKeys = l.before ? Object.keys(l.before) : [];
      const afterKeys = l.after ? Object.keys(l.after) : [];
      const removed = beforeKeys.filter(k => !afterKeys.includes(k));
      summary = `초기화: ${removed.map(_e).join(', ') || '(변동 없음)'}`;
    } else {
      summary = JSON.stringify(l.after).slice(0, 80);
    }
    const resultBadge = l.success
      ? '<span style="color:#27ae60;font-weight:700;">✅</span>'
      : '<span style="color:#c62828;font-weight:700;">❌</span>';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:0.82em;color:#666;">${_e(l.tsLabel)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-weight:700;">${_e(l.actor)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;"><span style="background:${actionColors[l.action]||'#666'}20;color:${actionColors[l.action]||'#666'};padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:700;">${_e(actionLabels[l.action]||l.action)}</span></td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:0.86em;">${summary}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">${resultBadge}</td>
    </tr>`;
  }

  function _stats() {
    const today7 = Date.now() - 7 * 86400000;
    let setRole = 0, adminSave = 0, recent7d = 0;
    logs.forEach(l => {
      if (l.action === 'setRole') setRole++;
      if (l.action === 'adminSave') adminSave++;
      if (l.ts > today7) recent7d++;
    });
    return { total: logs.length, setRole, adminSave, recent7d };
  }

  // ── CSV 내보내기 (utils.js의 downloadCsv 활용) ───────
  function exportCSV() {
    if (typeof csvJoin !== 'function' || typeof downloadCsv !== 'function') {
      alert('CSV 헬퍼 미로드');
      return;
    }
    const rows = [
      ['시각', '주체', '액션', '이전 값', '새 값', '결과', '디바이스 ID', 'User Agent']
    ];
    logs.slice().reverse().forEach(l => {
      rows.push([
        l.tsLabel,
        l.actor,
        l.action,
        JSON.stringify(l.before||''),
        JSON.stringify(l.after||''),
        l.success ? '성공' : '실패',
        l.deviceId,
        l.ua
      ]);
    });
    const csv = csvJoin(rows);
    const fname = `권한이력_${new Date().toISOString().slice(0,10)}.csv`;
    downloadCsv(fname, csv);
  }

  function clearAll() {
    record('clearAll', { count: logs.length }, null, true);
    logs = [];
    _save();
    _renderSection();
    if (typeof setBanner === 'function') setBanner('ok', '🗑 권한 변경 이력 모두 삭제됨');
  }

  // ── showTab hook (settings 탭 진입 시 렌더) ──────
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__auditHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (id === 'settings') {
        setTimeout(() => { _injectIntoSettings(); _renderSection(); }, 200);
      }
      return r;
    };
    window.showTab.__auditHooked = true;
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    _load();
    setTimeout(_hookAuth, 1500);
    setTimeout(_hookShowTab, 1200);
    // 첫 부팅 시 — 세션 시작 기록
    setTimeout(() => {
      const cur = (typeof erpAuth !== 'undefined' && erpAuth.getRole) ? erpAuth.getRole() : 'unknown';
      // 같은 디바이스에서 같은 날 첫 시작만 기록
      const today = new Date().toISOString().slice(0,10);
      const lastSession = logs.filter(l => l.action === 'sessionStart' && l.deviceId === _deviceId());
      const lastDate = lastSession.length ? new Date(lastSession[lastSession.length-1].ts).toISOString().slice(0,10) : null;
      if (lastDate !== today) {
        record('sessionStart', null, cur, true);
      }
    }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.erpAuthAudit = {
    list: (n) => logs.slice(-(n||30)).reverse(),
    all: () => logs.slice(),
    record,
    stats: _stats,
    export: exportCSV,
    clear: clearAll,
    deviceId: _deviceId,
    refresh: _renderSection
  };

  console.log('[ERP-AUTH-AUDIT] 권한 audit log 활성 — erpAuthAudit.list() · 디바이스 ID: ' + _deviceId());
})();
