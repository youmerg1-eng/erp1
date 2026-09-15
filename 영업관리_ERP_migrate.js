// =====================================================
//  MIGRATION — 데이터 schema 자동 마이그레이션 (Sprint 6 · #5)
//
//  기능
//   1) 데이터 schema 버전 추적 (erp_schema_version)
//   2) 정의된 마이그레이션 단계를 순차 실행
//   3) 각 단계 실행 전 자동 백업 (audit.snapshot 활용 가능)
//   4) Dry-run 모드 — 변경 없이 미리보기
//   5) 실패 시 자동 롤백 (snapshot 복원)
//   6) 마이그레이션 이력 기록
//
//  현재 버전: 1.5.0
//  과거 마이그레이션 정의는 코드 내 MIGRATIONS 배열 참고.
//
//  공개 API: window.erpMigrate
// =====================================================
(function() {
  'use strict';

  const VERSION_KEY = 'erp_schema_version';
  const HISTORY_KEY = 'erp_migration_history';
  const CURRENT_VERSION = '1.6.0';

  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => {
      window.erpSafety.protect(VERSION_KEY);
      window.erpSafety.protect(HISTORY_KEY);
    }, 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }

  function _versionToNum(v) {
    const parts = String(v).split('.').map(x => parseInt(x) || 0);
    return parts[0]*10000 + parts[1]*100 + parts[2];
  }

  function _curVersion() {
    return localStorage.getItem(VERSION_KEY) || '1.0.0';
  }
  function _setVersion(v) {
    try { localStorage.setItem(VERSION_KEY, v); } catch (e) {}
  }

  // ── 마이그레이션 정의 ────────────────────────────
  // 각 정의:
  //   from / to: 버전
  //   label: 사용자에게 표시할 설명
  //   detect: () => boolean  (이 마이그레이션이 필요한지 판단)
  //   migrate: (dryRun) => { changes: [...], stats: {} }
  const MIGRATIONS = [
    {
      from: '1.0.0', to: '1.1.0',
      label: '구 chief 권한을 sales (영업팀)로 변경',
      detect: () => localStorage.getItem('erp_auth') === 'chief',
      migrate: (dryRun) => {
        const changes = [];
        const cur = localStorage.getItem('erp_auth');
        if (cur === 'chief') {
          changes.push({ key: 'erp_auth', before: 'chief', after: 'sales' });
          if (!dryRun) localStorage.setItem('erp_auth', 'sales');
        }
        return { changes, stats: { keysAffected: changes.length } };
      }
    },
    {
      from: '1.1.0', to: '1.2.0',
      label: 'rawData에 _id 필드 자동 부여',
      detect: () => {
        try {
          const raw = JSON.parse(localStorage.getItem('erp_raw') || '[]');
          return Array.isArray(raw) && raw.some(r => !r._id);
        } catch (e) { return false; }
      },
      migrate: (dryRun) => {
        const changes = [];
        let raw;
        try { raw = JSON.parse(localStorage.getItem('erp_raw') || '[]'); }
        catch (e) { return { changes: [], stats: { error: e.message } }; }
        if (!Array.isArray(raw)) return { changes: [], stats: { skipped: '배열 아님' } };
        let added = 0;
        const newRaw = raw.map(r => {
          if (!r._id) {
            const id = 'R-' + Date.now() + '-' + Math.random().toString(36).slice(2,7) + '-' + added;
            added++;
            return { ...r, _id: id };
          }
          return r;
        });
        if (added > 0) {
          changes.push({ key: 'erp_raw', summary: `${added}개 row에 _id 부여` });
          if (!dryRun) localStorage.setItem('erp_raw', JSON.stringify(newRaw));
        }
        return { changes, stats: { rowsAffected: added } };
      }
    },
    {
      from: '1.2.0', to: '1.3.0',
      label: '날짜 필드 표준화 (M/D 형식 → YYYY-MM-DD)',
      detect: () => {
        try {
          const raw = JSON.parse(localStorage.getItem('erp_raw') || '[]');
          return Array.isArray(raw) && raw.some(r => {
            const d = r['출고요청일'] || r['요청납기'] || '';
            return /^\d{1,2}[/.\-]\d{1,2}$/.test(String(d).trim());
          });
        } catch (e) { return false; }
      },
      migrate: (dryRun) => {
        const changes = [];
        let raw;
        try { raw = JSON.parse(localStorage.getItem('erp_raw') || '[]'); }
        catch (e) { return { changes: [], stats: { error: e.message } }; }
        if (!Array.isArray(raw)) return { changes: [], stats: { skipped: '배열 아님' } };
        let fixed = 0;
        const dateFields = ['수주일', '출고요청일', '요청납기', '납품일'];
        const newRaw = raw.map(r => {
          const newR = { ...r };
          dateFields.forEach(f => {
            const v = String(newR[f] || '').trim();
            // M/D 또는 M.D 형식 감지
            const m = v.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
            if (m) {
              const month = parseInt(m[1]), day = parseInt(m[2]);
              if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                const year = new Date().getFullYear();
                newR[f] = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                fixed++;
              }
            }
          });
          return newR;
        });
        if (fixed > 0) {
          changes.push({ key: 'erp_raw', summary: `${fixed}개 날짜 필드 표준화` });
          if (!dryRun) localStorage.setItem('erp_raw', JSON.stringify(newRaw));
        }
        return { changes, stats: { datesFixed: fixed } };
      }
    },
    {
      from: '1.3.0', to: '1.4.0',
      label: 'localMeta 가비지 정리 (rawData에 없는 _id 메타 제거)',
      detect: () => {
        try {
          const raw = JSON.parse(localStorage.getItem('erp_raw') || '[]');
          const meta = JSON.parse(localStorage.getItem('erp_local') || '{}');
          if (!Array.isArray(raw) || typeof meta !== 'object') return false;
          const rawIds = new Set(raw.map(r => r._id).filter(Boolean));
          return Object.keys(meta).some(k => k.startsWith('R-') && !rawIds.has(k));
        } catch (e) { return false; }
      },
      migrate: (dryRun) => {
        const changes = [];
        let raw, meta;
        try {
          raw = JSON.parse(localStorage.getItem('erp_raw') || '[]');
          meta = JSON.parse(localStorage.getItem('erp_local') || '{}');
        } catch (e) { return { changes: [], stats: { error: e.message } }; }
        const rawIds = new Set(raw.map(r => r._id).filter(Boolean));
        const orphans = [];
        const newMeta = {};
        Object.keys(meta).forEach(k => {
          if (k.startsWith('R-') && !rawIds.has(k)) {
            orphans.push(k);
          } else {
            newMeta[k] = meta[k];
          }
        });
        if (orphans.length) {
          changes.push({ key: 'erp_local', summary: `${orphans.length}개 고아 메타 제거` });
          if (!dryRun) localStorage.setItem('erp_local', JSON.stringify(newMeta));
        }
        return { changes, stats: { orphansRemoved: orphans.length } };
      }
    },
    {
      from: '1.4.0', to: '1.5.0',
      label: '디바이스 ID 자동 발급 + Audit 활성화',
      detect: () => !localStorage.getItem('erp_device_id'),
      migrate: (dryRun) => {
        const changes = [];
        if (!localStorage.getItem('erp_device_id')) {
          const id = 'D-' + Math.random().toString(36).slice(2,12) + '-' + Date.now().toString(36);
          changes.push({ key: 'erp_device_id', after: id });
          if (!dryRun) localStorage.setItem('erp_device_id', id);
        }
        return { changes, stats: { newDevice: changes.length > 0 } };
      }
    },
    {
      // ★ Phase 5: 타사 화주 할증 정책 — 배수(surchargeRate) → 절대값(surchargeAddPerWp)
      //   변환 규칙: 배수 R 이면 (R-1) × ratePerWp 만큼 추가 단가로 환산
      //   예: ratePerWp=5, surchargeRate=1.5 → 추가 단가 = 5 × 0.5 = 2.5원/Wp
      from: '1.5.0', to: '1.6.0',
      label: '타사 화주 할증 정책 절대값 변환 (계약서 표준 호환)',
      detect: () => {
        try {
          const owners = JSON.parse(localStorage.getItem('erp_tp_owners') || '[]');
          return Array.isArray(owners) && owners.some(o =>
            o.surchargeRate > 1 && (!o.surchargeAddPerWp || o.surchargeAddPerWp === 0)
          );
        } catch (e) { return false; }
      },
      migrate: (dryRun) => {
        const changes = [];
        let owners;
        try { owners = JSON.parse(localStorage.getItem('erp_tp_owners') || '[]'); }
        catch (e) { return { changes: [], stats: { error: e.message } }; }
        if (!Array.isArray(owners)) return { changes: [], stats: { skipped: '배열 아님' } };
        let converted = 0;
        const newOwners = owners.map(o => {
          // 절대값이 이미 있거나 배수가 1 이하면 변환 불필요
          if (o.surchargeAddPerWp > 0) return o;
          if (!o.surchargeRate || o.surchargeRate <= 1) return o;
          const add = Number((o.ratePerWp * (o.surchargeRate - 1)).toFixed(2));
          changes.push({
            ownerId: o.id, ownerName: o.name,
            ratePerWp: o.ratePerWp,
            beforeRate: o.surchargeRate,
            afterAdd: add,
            summary: `${o.name}: 배수 ${o.surchargeRate} → 추가 단가 ${add}원/Wp`
          });
          converted++;
          return { ...o, surchargeAddPerWp: add };
        });
        if (converted > 0 && !dryRun) {
          localStorage.setItem('erp_tp_owners', JSON.stringify(newOwners));
        }
        return { changes, stats: { ownersConverted: converted, totalOwners: owners.length } };
      }
    }
  ];

  // ── 마이그레이션 필요 여부 검사 ───────────────────
  function pending() {
    const cur = _curVersion();
    return MIGRATIONS.filter(m => {
      if (_versionToNum(cur) >= _versionToNum(m.to)) return false;
      // 안전을 위해 detect도 호출 (실제 변경할 데이터가 있는지)
      try { return m.detect(); } catch (e) { return false; }
    });
  }

  // ── snapshot (audit 모듈 활용) ────────────────────
  function _snapshot() {
    if (typeof window.audit !== 'undefined' && window.audit.snapshot) {
      try { window.audit.snapshot('migration-pre'); }
      catch (e) { console.warn('[migrate] snapshot 실패', e); }
    }
    // safety.js 자동 _backup 가 setItem 인터셉트로 보호하지만,
    // 명시적으로 키 통째로 보존
    const keys = ['erp_raw', 'erp_local', 'erp_inventory', 'erp_delivery', 'erp_settings', 'erp_files'];
    const snap = { ts: Date.now(), keys: {} };
    keys.forEach(k => snap.keys[k] = localStorage.getItem(k));
    try {
      localStorage.setItem('erp_migration_pre_snapshot', JSON.stringify(snap));
    } catch (e) { console.warn('[migrate] pre-snapshot 저장 실패', e); }
    return snap;
  }

  function _rollback() {
    try {
      const snap = JSON.parse(localStorage.getItem('erp_migration_pre_snapshot') || 'null');
      if (!snap) return false;
      Object.entries(snap.keys).forEach(([k, v]) => {
        if (v != null) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
      });
      console.warn('[migrate] 롤백 완료');
      return true;
    } catch (e) {
      console.error('[migrate] 롤백 실패', e);
      return false;
    }
  }

  // ── 실행 ────────────────────────────────────────
  function run(opts) {
    opts = opts || {};
    const dryRun = !!opts.dryRun;
    const list = pending();
    if (list.length === 0) {
      return { ok: true, applied: [], message: '이미 최신 버전 (' + _curVersion() + ')' };
    }
    const result = {
      ok: true, applied: [], dryRun,
      from: _curVersion(), to: CURRENT_VERSION,
      stats: { total: list.length, success: 0, failed: 0 }
    };
    if (!dryRun) _snapshot();

    for (const m of list) {
      try {
        const r = m.migrate(dryRun);
        result.applied.push({
          from: m.from, to: m.to, label: m.label,
          changes: r.changes, stats: r.stats, success: true
        });
        if (!dryRun) {
          _setVersion(m.to);
          _recordHistory({
            from: m.from, to: m.to, label: m.label,
            stats: r.stats, ts: Date.now(), success: true
          });
        }
        result.stats.success++;
      } catch (err) {
        console.error('[migrate] 실패', m.label, err);
        result.applied.push({
          from: m.from, to: m.to, label: m.label,
          error: err.message, success: false
        });
        result.stats.failed++;
        result.ok = false;
        // 실패 시 롤백
        if (!dryRun) {
          _rollback();
          _recordHistory({
            from: m.from, to: m.to, label: m.label,
            error: err.message, ts: Date.now(), success: false
          });
        }
        break;
      }
    }
    return result;
  }

  // 마이그레이션 이력
  function _recordHistory(entry) {
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) {}
    hist.push(entry);
    if (hist.length > 100) hist = hist.slice(-100);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch (e) {}
  }

  function history() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }

  // ── UI ──────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-mg-modal')) return;
    const css = `
      #erp-mg-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9700;display:none;align-items:center;justify-content:center;}
      #erp-mg-modal.open{display:flex;}
      .mg-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:96%;max-width:780px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .mg-hd{padding:14px 20px;background:linear-gradient(135deg,#5d4037,#8d6e63);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .mg-bd{flex:1;overflow-y:auto;padding:18px;}
      .mg-version{display:flex;justify-content:space-between;align-items:center;background:#fffde7;padding:14px;border-radius:8px;margin-bottom:14px;border-left:4px solid #f9a825;}
      .mg-list{margin:14px 0;}
      .mg-item{background:#fff;border:1.5px solid #e0e0e0;border-radius:8px;padding:12px 14px;margin-bottom:8px;}
      .mg-item-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}
      .mg-item-arrow{font-family:monospace;background:#e3f2fd;padding:2px 8px;border-radius:4px;font-size:0.78em;color:#1565c0;font-weight:700;}
      .mg-changes{background:#f9f9f9;padding:8px 10px;border-radius:5px;margin-top:6px;font-size:0.84em;color:#444;}
      .mg-btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:0.88em;font-weight:700;}
      .mg-btn-primary{background:#5d4037;color:#fff;}
      .mg-btn-warn{background:#e65100;color:#fff;}
      .mg-btn-ghost{background:#fff;border:1.5px solid #ccc;color:#444;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-mg-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-mg-modal';
    modal.innerHTML = `
      <div class="mg-box">
        <div class="mg-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🔄 데이터 마이그레이션</h4>
          <button class="mg-btn mg-btn-ghost" onclick="window.erpMigrate.close()">✕</button>
        </div>
        <div class="mg-bd" id="mg-bd"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  function _render() {
    const cur = _curVersion();
    const list = pending();
    const hist = history();

    let html = `
      <div class="mg-version">
        <div>
          <div style="font-size:0.78em;color:#666;font-weight:700;">현재 데이터 버전</div>
          <div style="font-size:1.4em;font-weight:900;color:#1a1a2e;font-family:monospace;">${_e(cur)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.78em;color:#666;font-weight:700;">최신 버전</div>
          <div style="font-size:1.4em;font-weight:900;color:#27ae60;font-family:monospace;">${_e(CURRENT_VERSION)}</div>
        </div>
      </div>
    `;

    if (list.length === 0) {
      html += `<div style="background:#e8f5e9;padding:20px;border-radius:8px;text-align:center;color:#27ae60;font-weight:700;">
        ✅ 이미 최신 버전입니다. 마이그레이션 불필요.
      </div>`;
    } else {
      html += `<div style="background:#fff3e0;padding:12px;border-radius:6px;margin-bottom:14px;color:#e65100;font-size:0.86em;line-height:1.5;">
        ⚠️ <strong>${list.length}개의 마이그레이션이 필요합니다.</strong><br>
        실행 전에 자동 백업이 생성되며, 실패 시 자동 롤백됩니다.
      </div>`;
      html += '<div class="mg-list">';
      list.forEach(m => {
        html += `<div class="mg-item">
          <div class="mg-item-h">
            <strong>${_e(m.label)}</strong>
            <span class="mg-item-arrow">${_e(m.from)} → ${_e(m.to)}</span>
          </div>
        </div>`;
      });
      html += '</div>';
      html += `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="mg-btn mg-btn-ghost" onclick="window.erpMigrate._previewUI()">🔍 변경 미리보기 (Dry-run)</button>
        <button class="mg-btn mg-btn-primary" onclick="window.erpMigrate._runUI()">▶ 마이그레이션 실행</button>
      </div>`;
    }

    if (hist.length > 0) {
      html += `<div style="margin-top:24px;">
        <h3 style="font-size:1em;color:#1a1a2e;margin:0 0 10px;">📋 마이그레이션 이력</h3>
        <div style="max-height:240px;overflow-y:auto;background:#fafafa;padding:10px;border-radius:6px;font-size:0.84em;">
          ${hist.slice().reverse().slice(0, 20).map(h => {
            const dt = new Date(h.ts).toLocaleString('ko-KR');
            const icon = h.success ? '✅' : '❌';
            return `<div style="padding:6px 8px;border-bottom:1px solid #eee;">
              ${icon} <span style="color:#666;">${_e(dt)}</span> · <strong>${_e(h.from)} → ${_e(h.to)}</strong> · ${_e(h.label)}
              ${h.error ? '<br><span style="color:#c62828;font-size:0.86em;">오류: ' + _e(h.error) + '</span>' : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    document.getElementById('mg-bd').innerHTML = html;
  }

  function _previewUI() {
    const r = run({ dryRun: true });
    let msg = `🔍 마이그레이션 미리보기 (Dry-run)\n\n`;
    msg += `${r.from} → ${r.to}\n총 ${r.stats.total}개 단계\n\n`;
    r.applied.forEach(a => {
      msg += `${a.success ? '✅' : '❌'} [${a.from} → ${a.to}] ${a.label}\n`;
      (a.changes || []).forEach(c => {
        if (c.summary) msg += `   • ${c.summary}\n`;
        else if (c.key) msg += `   • ${c.key}: ${JSON.stringify(c.before||'')} → ${JSON.stringify(c.after||'').slice(0,40)}\n`;
      });
    });
    msg += `\n실제로 적용하려면 [실행] 버튼을 클릭하세요.`;
    alert(msg);
  }

  function _runUI() {
    const list = pending();
    if (!confirm(`${list.length}개의 마이그레이션을 실제로 적용하시겠습니까?\n\n자동 백업이 생성되며 실패 시 롤백됩니다.`)) return;
    const r = run({ dryRun: false });
    if (r.ok) {
      alert(`✅ 마이그레이션 완료\n\n${r.from} → ${r.to}\n성공: ${r.stats.success}건`);
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${r.stats.success}개 마이그레이션 적용됨 — 페이지를 새로고침하세요.`);
      _render();
      // 5초 후 자동 새로고침 제안
      if (confirm('변경사항을 적용하려면 페이지 새로고침이 필요합니다. 지금 새로고침할까요?')) {
        location.reload();
      }
    } else {
      alert(`❌ 마이그레이션 실패 — 자동 롤백됨\n\n실패 단계: ${r.applied[r.applied.length-1].label}\n오류: ${r.applied[r.applied.length-1].error}`);
      _render();
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-mg-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() { document.getElementById('erp-mg-modal')?.classList.remove('open'); }

  // ── 자동 마이그레이션 (부팅 시) ────────────────────
  function autoCheck() {
    const list = pending();
    if (list.length === 0) return;
    console.warn('[migrate] ' + list.length + '개 마이그레이션 필요 — 현재 ' + _curVersion() + ', 최신 ' + CURRENT_VERSION);
    if (typeof setBanner === 'function') {
      setBanner('warn',
        `⚠️ 데이터 마이그레이션 ${list.length}개 필요 (${_curVersion()} → ${CURRENT_VERSION}) · 실행: erpMigrate.open()`);
    }
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    setTimeout(_injectUI, 800);
    setTimeout(autoCheck, 4000);   // 다른 모듈 로드 후
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.erpMigrate = {
    version: _curVersion,
    target: () => CURRENT_VERSION,
    pending,
    run,
    history,
    rollback: _rollback,
    open, close,
    _previewUI, _runUI
  };

  console.log('[ERP-MIGRATE] schema 마이그레이션 활성 — 현재 ' + _curVersion() + ' / 최신 ' + CURRENT_VERSION);
})();
