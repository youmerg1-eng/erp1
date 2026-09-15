// =====================================================
//  AUTO BACKUP — 자동 일일 백업 (Phase 1 · #1)
//
//  3중 백업 체계
//   Tier 1: localStorage 일일 스냅샷 (safety.js, 7일치)
//   Tier 2: IndexedDB 일일 백업 (이 모듈, 30일치 · 용량 무제한급)
//   Tier 3: 파일 자동 다운로드 (사용자 옵션, 매일/매주)
//
//  실행 트리거
//   - 페이지 로드 후 5초: 마지막 백업 시각 확인 → 24h 경과 시 자동 실행
//   - 설정 가능한 주기 (매일/매주/비활성)
//   - 콘솔: autoBackup.runNow() 즉시 실행
//   - 설정 탭: 백업 상태 카드 + 즉시 실행 버튼
//
//  설정 키 (localStorage)
//   erp_autobackup_config = { enabled, interval, lastBackup, lastBackupSize, autoDownload }
//   erp_autobackup_log    = [{ at, success, size, source, error }]  (최근 20건)
// =====================================================
(function() {
  'use strict';

  const CFG_KEY = 'erp_autobackup_config';
  const LOG_KEY = 'erp_autobackup_log';
  const IDB_NAME = 'erp_backups';
  const IDB_STORE = 'snapshots';
  const IDB_VERSION = 1;
  const MAX_IDB_KEEP_DAYS = 30;
  const MAX_LOG_KEEP = 20;

  // 모든 백업 대상 키 (backup_tools.js 와 동기화)
  const PROTECTED_KEYS = [
    'erp_raw','erp_local','erp_inventory','erp_delivery','erp_settings','erp_product_master',
    'erp_customer_master','erp_notify_config','erp_notify_history',
    'erp_vendor_master','erp_claims','erp_sn_records','erp_mobile_sigs',
    'erp_incoming','erp_calc_settings','erp_dispatch','erp_auth','erp_auth_custom_perms',
    'erp_ai_history','erp_audit_log','erp_gs_url','erp_sync_queue','erp_weekly_tests',
    'erp_files','erp_cost_invoices','erp_cost_schedule','erp_dispatch_carriers',
    'erp_warehouse_master','erp_3rdparty_owners','erp_3rdparty_inventory','erp_3rdparty_billing',
    'erp_rentals','erp_returns','erp_quotations','erp_vendor_quotes',
    'erp_market_rate','erp_logistics_invoices'
  ];

  // ── 설정 로드/저장 ──────────────────────────────────
  function getConfig() {
    const defaults = {
      enabled: true,            // 자동 백업 활성
      interval: 'daily',        // 'daily' | 'weekly' | 'off'
      lastBackup: null,         // ISO timestamp
      lastBackupSize: 0,
      lastBackupSource: '',     // 'idb' | 'file' | 'both'
      autoDownload: false,      // 매일 파일 자동 다운로드
      downloadDay: 5            // 주간 모드일 때 요일 (0=일~6=토, 기본 금요일)
    };
    try {
      const v = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      return Object.assign(defaults, v);
    } catch(e) { return defaults; }
  }
  function saveConfig(patch) {
    const next = Object.assign(getConfig(), patch);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch(e) {}
    return next;
  }

  // ── 로그 ────────────────────────────────────────────
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function appendLog(entry) {
    const log = getLog();
    log.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (log.length > MAX_LOG_KEEP) log.length = MAX_LOG_KEEP;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch(e) {}
  }

  // ── IndexedDB 초기화 ────────────────────────────────
  function _openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'date' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error || new Error('IndexedDB open failed'));
    });
  }

  async function saveToIDB(bundle) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const rec = {
        date: bundle.exportedAt.slice(0,10),    // YYYY-MM-DD (하루 1건)
        timestamp: bundle.exportedAt,
        size: JSON.stringify(bundle).length,
        bundle: bundle
      };
      const putReq = store.put(rec);
      putReq.onsuccess = () => resolve(rec);
      putReq.onerror = e => reject(e.target.error);
    });
  }

  async function listIDBBackups() {
    try {
      const db = await _openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const arr = req.result || [];
          arr.sort((a,b) => (b.date||'').localeCompare(a.date||''));
          resolve(arr.map(r => ({ date:r.date, timestamp:r.timestamp, size:r.size })));
        };
        req.onerror = () => resolve([]);
      });
    } catch(e) { return []; }
  }

  async function loadIDBBackup(date) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(date);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function deleteIDBBackup(date) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(date);
      req.onsuccess = () => resolve(true);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function _cleanupOldIDB() {
    const cutoff = new Date(Date.now() - MAX_IDB_KEEP_DAYS * 86400000)
      .toISOString().slice(0,10);
    const all = await listIDBBackups();
    const old = all.filter(r => r.date < cutoff);
    for (const r of old) {
      try { await deleteIDBBackup(r.date); } catch(e) {}
    }
    return old.length;
  }

  // ── 백업 번들 생성 ──────────────────────────────────
  function _buildBundle() {
    const bundle = {
      type: 'ERP_AUTO_BACKUP',
      version: 1,
      exportedAt: new Date().toISOString(),
      device: localStorage.getItem('erp_device_id') || '-',
      data: {},
      meta: {}
    };
    PROTECTED_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v != null) bundle.data[k] = v;
    });
    bundle.meta.totalSize = JSON.stringify(bundle).length;
    bundle.meta.dataKeys = Object.keys(bundle.data).length;
    return bundle;
  }

  // ── 파일 다운로드 ───────────────────────────────────
  function _downloadBundle(bundle) {
    const blob = new Blob([JSON.stringify(bundle)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ERP_AUTO_${bundle.exportedAt.slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch(e){} }, 1000);
    return blob.size;
  }

  // ── 핵심: 백업 실행 ─────────────────────────────────
  async function runNow(opts) {
    opts = opts || {};
    const cfg = getConfig();
    const bundle = _buildBundle();
    const sources = [];
    let success = false;
    let lastError = '';

    // 1) IndexedDB 저장
    try {
      await saveToIDB(bundle);
      await _cleanupOldIDB();
      sources.push('idb');
      success = true;
    } catch(e) {
      lastError = 'IDB: ' + e.message;
      console.warn('[autoBackup] IDB 저장 실패:', e);
    }

    // 2) 파일 자동 다운로드 (설정 활성 또는 강제)
    if (cfg.autoDownload || opts.forceDownload) {
      try {
        _downloadBundle(bundle);
        sources.push('file');
        success = true;
      } catch(e) {
        lastError = (lastError ? lastError + ' / ' : '') + 'FILE: ' + e.message;
        console.warn('[autoBackup] 파일 다운로드 실패:', e);
      }
    }

    // 3) 결과 기록
    const size = bundle.meta.totalSize;
    saveConfig({
      lastBackup: bundle.exportedAt,
      lastBackupSize: size,
      lastBackupSource: sources.join(',')
    });
    appendLog({
      success,
      size,
      source: sources.join(',') || 'none',
      keys: bundle.meta.dataKeys,
      error: success ? null : lastError
    });

    if (typeof setBanner === 'function') {
      if (success) {
        const sourceLabel = sources.includes('file') ? '파일 + IDB' : 'IndexedDB';
        setBanner('ok', `✅ 자동 백업 완료 (${(size/1024).toFixed(1)} KB · ${sourceLabel})`);
      } else {
        setBanner('warn', '⚠️ 자동 백업 실패 — 설정에서 확인하세요');
      }
    }
    return { success, size, sources, bundle };
  }

  // ── 스케줄러: 페이지 로드 시 백업 필요 여부 판단 ──
  function _shouldRunBackup() {
    const cfg = getConfig();
    if (!cfg.enabled || cfg.interval === 'off') return { run:false, reason:'disabled' };
    if (!cfg.lastBackup) return { run:true, reason:'first-run' };
    const last = new Date(cfg.lastBackup);
    const now = new Date();
    const hoursElapsed = (now - last) / 3600000;
    if (cfg.interval === 'daily' && hoursElapsed >= 24) {
      return { run:true, reason:`24h 경과 (${hoursElapsed.toFixed(1)}h)` };
    }
    if (cfg.interval === 'weekly' && hoursElapsed >= 168) {
      return { run:true, reason:`주 1회 (${hoursElapsed.toFixed(0)}h 경과)` };
    }
    return { run:false, reason:`다음 백업까지 ${cfg.interval==='daily'?(24-hoursElapsed).toFixed(1):(168-hoursElapsed).toFixed(0)}h 남음` };
  }

  async function _autoRunIfNeeded() {
    const check = _shouldRunBackup();
    console.log('[autoBackup] check:', check);
    if (!check.run) return;
    console.log('[autoBackup] running backup:', check.reason);
    try { await runNow(); }
    catch(e) { console.error('[autoBackup] runNow 실패:', e); }
  }

  // ── 복원 ────────────────────────────────────────────
  async function restoreFromIDB(date) {
    const rec = await loadIDBBackup(date);
    if (!rec || !rec.bundle) throw new Error('해당 날짜 백업을 찾을 수 없습니다.');
    const bundle = rec.bundle;
    if (!confirm(`⚠️ ${date} 시점의 백업으로 복원합니다.\n\n현재 데이터는 모두 덮어쓰여집니다.\n계속하시겠습니까?\n\n(데이터 키: ${bundle.meta.dataKeys}개, ${(bundle.meta.totalSize/1024).toFixed(1)} KB)`)) {
      return { canceled:true };
    }
    Object.entries(bundle.data).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch(e) { console.warn('[restore]', k, e); }
    });
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${date} 시점으로 복원됨 — 페이지 새로고침 후 적용`);
    setTimeout(() => location.reload(), 1500);
    return { success:true };
  }

  // ── 상태 카드 (설정 탭에 주입) ─────────────────────
  function _renderStatusCard(hostEl) {
    if (!hostEl) return;
    const cfg = getConfig();
    const log = getLog();
    const lastOk = log.find(l => l.success);
    const lastFail = log.find(l => !l.success);
    const next = _shouldRunBackup();

    const _fmt = (n) => Number(n||0).toLocaleString();
    const _fmtTime = (s) => {
      if (!s) return '없음';
      try {
        const d = new Date(s);
        return d.toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'short' });
      } catch(e) { return s; }
    };

    const intervalLabel = { 'daily':'매일', 'weekly':'매주', 'off':'비활성' }[cfg.interval] || cfg.interval;

    hostEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div style="background:${cfg.enabled?'#e8f5e9':'#ffebee'};padding:12px;border-radius:8px;border-left:4px solid ${cfg.enabled?'#27ae60':'#c62828'};">
          <div style="font-size:0.78em;color:#666;font-weight:700;">자동 백업 상태</div>
          <div style="font-size:1.1em;font-weight:800;color:${cfg.enabled?'#1b5e20':'#b71c1c'};margin-top:2px;">
            ${cfg.enabled ? '✓ 활성' : '✗ 비활성'} (${intervalLabel})
          </div>
          <div style="font-size:0.78em;color:#888;margin-top:4px;">${next.reason}</div>
        </div>
        <div style="background:#f8f9fa;padding:12px;border-radius:8px;border-left:4px solid #0d47a1;">
          <div style="font-size:0.78em;color:#666;font-weight:700;">마지막 백업</div>
          <div style="font-size:1em;font-weight:800;color:#1a1a2e;margin-top:2px;">${_fmtTime(cfg.lastBackup)}</div>
          <div style="font-size:0.78em;color:#888;margin-top:4px;">
            ${cfg.lastBackup ? `${(cfg.lastBackupSize/1024).toFixed(1)} KB · ${cfg.lastBackupSource || '-'}` : '아직 실행되지 않음'}
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fafbfc;border-radius:8px;border:1px solid #e0e0e0;cursor:pointer;">
          <input id="ab-enabled" type="checkbox" ${cfg.enabled?'checked':''} style="width:18px;height:18px;cursor:pointer;">
          <strong style="flex:1;">자동 백업 활성화</strong>
          <select id="ab-interval" style="padding:5px 8px;border-radius:5px;border:1px solid #ccc;">
            <option value="daily" ${cfg.interval==='daily'?'selected':''}>매일</option>
            <option value="weekly" ${cfg.interval==='weekly'?'selected':''}>매주</option>
            <option value="off" ${cfg.interval==='off'?'selected':''}>비활성</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fafbfc;border-radius:8px;border:1px solid #e0e0e0;cursor:pointer;">
          <input id="ab-download" type="checkbox" ${cfg.autoDownload?'checked':''} style="width:18px;height:18px;cursor:pointer;">
          <span style="flex:1;">
            <strong>자동 파일 다운로드</strong>
            <div style="font-size:0.78em;color:#888;margin-top:2px;">매 백업 시 ERP_AUTO_YYYY-MM-DD.json 파일을 다운로드 폴더에 저장</div>
          </span>
        </label>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="autoBackup._runFromUI()">지금 백업 실행</button>
        <button class="btn btn-success btn-sm" onclick="autoBackup._runFromUI({forceDownload:true})">백업 + 파일 다운로드</button>
        <button class="btn btn-outline btn-sm" onclick="autoBackup._openRestoreDialog()">IDB 백업 복원</button>
        <button class="btn btn-outline btn-sm" onclick="autoBackup._showLog()">로그 보기</button>
      </div>

      <details style="background:#fffde7;border-left:3px solid #f9a825;border-radius:6px;padding:8px 12px;">
        <summary style="cursor:pointer;font-weight:700;color:#5d4037;">💡 백업 정책 (3중 보호)</summary>
        <div style="margin-top:8px;font-size:0.84em;color:#555;line-height:1.6;">
          <strong>Tier 1</strong> — localStorage 일일 스냅샷 (safety.js, 7일 보관)<br>
          <strong>Tier 2</strong> — IndexedDB 일일 백업 (이 모듈, 30일 보관, 용량 ~1GB)<br>
          <strong>Tier 3</strong> — 파일 자동 다운로드 (선택, 매 백업 시)<br>
          <span style="color:#c62828;">⚠️ IndexedDB 도 같은 브라우저에 있으므로 브라우저 데이터 삭제 시 함께 사라집니다. 파일 다운로드 + 외부(NAS/이메일) 보관 권장.</span>
        </div>
      </details>
    `;

    // 이벤트 바인딩
    document.getElementById('ab-enabled')?.addEventListener('change', e => {
      saveConfig({ enabled: e.target.checked });
      _renderStatusCard(hostEl);
    });
    document.getElementById('ab-interval')?.addEventListener('change', e => {
      saveConfig({ interval: e.target.value });
      _renderStatusCard(hostEl);
    });
    document.getElementById('ab-download')?.addEventListener('change', e => {
      saveConfig({ autoDownload: e.target.checked });
      _renderStatusCard(hostEl);
    });
  }

  async function _runFromUI(opts) {
    const r = await runNow(opts);
    const host = document.getElementById('autobackup-status-card');
    if (host) _renderStatusCard(host);
    return r;
  }

  async function _openRestoreDialog() {
    const list = await listIDBBackups();
    if (list.length === 0) { alert('복원 가능한 IndexedDB 백업이 없습니다.\n먼저 "지금 백업 실행" 으로 백업을 생성하세요.'); return; }
    const opts = list.map((b, i) => `${i+1}. ${b.date} (${(b.size/1024).toFixed(1)} KB)`).join('\n');
    const sel = prompt(`복원할 백업 날짜를 선택하세요:\n\n${opts}\n\n번호 입력 (1~${list.length}, 취소: 빈칸):`);
    if (!sel) return;
    const idx = parseInt(sel) - 1;
    if (isNaN(idx) || idx < 0 || idx >= list.length) { alert('잘못된 선택'); return; }
    await restoreFromIDB(list[idx].date);
  }

  function _showLog() {
    const log = getLog();
    if (log.length === 0) { alert('백업 로그가 없습니다.'); return; }
    const lines = log.map(l => {
      const t = new Date(l.at).toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'short' });
      const mark = l.success ? '✅' : '❌';
      const detail = l.success
        ? `${(l.size/1024).toFixed(1)} KB · ${l.source || '-'} · ${l.keys}키`
        : l.error || '실패';
      return `${mark} ${t} — ${detail}`;
    }).join('\n');
    alert(`📋 백업 로그 (최근 ${log.length}건)\n\n${lines}`);
  }

  // ── 설정 탭 자동 주입 ───────────────────────────────
  function _injectIntoSettings() {
    if (document.getElementById('autobackup-status-card')) return;
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div class="card-head">
        <h3>자동 백업 (Phase 1)</h3>
        <span class="tag green">3중 보호</span>
      </div>
      <div class="card-body" id="autobackup-status-card"></div>
    `;
    // 권한 플래그 아래에 삽입
    const target = tab.querySelector('.card:nth-of-type(4)') || tab.querySelector('.card:last-child');
    if (target) target.parentNode.insertBefore(card, target.nextSibling);
    else tab.appendChild(card);
    _renderStatusCard(document.getElementById('autobackup-status-card'));
  }

  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__autoBackupHooked) return;
    const orig = window.showTab;
    window.showTab = function(id) {
      const r = orig.apply(this, arguments);
      if (id === 'settings') setTimeout(_injectIntoSettings, 100);
      return r;
    };
    window.showTab.__autoBackupHooked = true;
  }

  // ── 공개 API ────────────────────────────────────────
  window.autoBackup = {
    runNow,
    getConfig, saveConfig,
    getLog,
    listIDBBackups, loadIDBBackup, deleteIDBBackup, restoreFromIDB,
    // UI helpers
    _runFromUI, _openRestoreDialog, _showLog, _renderStatusCard
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _hookShowTab();
    // 페이지 로드 후 5초 뒤에 자동 백업 필요 여부 확인
    setTimeout(_autoRunIfNeeded, 5000);
    // 1시간마다 재확인 (장시간 켜둔 경우)
    setInterval(_autoRunIfNeeded, 3600000);
    // 첫 진입이 설정 탭이면 주입
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-settings') _injectIntoSettings();
    }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-AUTOBACKUP] 자동 일일 백업 활성 — autoBackup.runNow()');
})();
