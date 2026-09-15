// =====================================================
//  SYNC STABILITY — Google Sheets 동기화 안정화 (Phase 1 · #2)
//
//  기존 sync.js 의 push/pull 위에 안정화 레이어 추가:
//   1. 상태 가시성 — 사이드바 배지 + 설정 탭 카드
//   2. 시각화된 에러 로그 (최근 50건, localStorage)
//   3. 연결 테스트 + GS URL 설정 마법사
//   4. 재시도 정책 (지수 백오프, 최대 3회)
//   5. 오프라인 자동 감지 + 복귀 시 재동기화
//   6. 동기화 진행 표시 (상단 작은 인디케이터)
//
//  공개 API: window.syncStability
// =====================================================
(function() {
  'use strict';

  const LOG_KEY = 'erp_sync_errors';
  const STATS_KEY = 'erp_sync_stats';
  const MAX_LOG = 50;
  const RETRY_DELAYS = [2000, 8000, 30000]; // 지수 백오프 (2초, 8초, 30초)

  // ── 통계/로그 ───────────────────────────────────────
  function _getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function _appendLog(entry) {
    const log = _getLog();
    log.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch(e) {}
  }
  function _getStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); }
    catch(e) { return {}; }
  }
  function _updateStats(patch) {
    const next = Object.assign(_getStats(), patch);
    try { localStorage.setItem(STATS_KEY, JSON.stringify(next)); } catch(e) {}
  }

  // ── 연결 테스트 ─────────────────────────────────────
  async function testConnection(url) {
    const testUrl = url || (typeof gsUrl !== 'undefined' ? gsUrl : '');
    if (!testUrl) return { ok:false, error:'GS URL 미설정' };
    try {
      const res = await fetch(testUrl + '?action=ping', { redirect:'follow' });
      if (!res.ok) return { ok:false, error:`HTTP ${res.status}` };
      const json = await res.json();
      if (json.success) return { ok:true, rows:json.rows, message:json.message };
      return { ok:false, error: json.error || '응답 형식 오류' };
    } catch(e) {
      return { ok:false, error: e.message };
    }
  }

  // ── push/pull 래퍼 — 재시도 + 에러 로깅 ──────────────
  async function _runWithRetry(fn, label) {
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const r = await fn();
        if (r && r.ok !== false && !r.error) {
          if (attempt > 0) {
            _appendLog({ type:label, level:'info', message:`재시도 ${attempt}회 후 성공`, attempt });
          }
          return r;
        }
        lastErr = r && r.error ? r.error : 'unknown';
      } catch(e) {
        lastErr = e.message;
      }
      // 마지막 시도가 아니면 백오프 후 재시도
      if (attempt < RETRY_DELAYS.length) {
        await new Promise(res => setTimeout(res, RETRY_DELAYS[attempt]));
      }
    }
    _appendLog({ type:label, level:'error', message:lastErr || '재시도 모두 실패' });
    _updateStats({ lastError: lastErr, lastErrorAt: new Date().toISOString() });
    return { ok:false, error: lastErr };
  }

  // ── 동기화 wrapper — sync.js 위 안정화 레이어 ───────
  async function syncNow() {
    if (typeof erpSync === 'undefined') return { ok:false, error:'sync 모듈 미로드' };
    if (!erpSync.isEnabled()) return { ok:false, error:'동기화 비활성 상태' };

    _updateStats({ syncing:true, syncStartedAt:new Date().toISOString() });
    _updateBadge('syncing');

    const push = await _runWithRetry(() => erpSync.push(), 'push');
    const pull = await _runWithRetry(() => erpSync.pull(), 'pull');

    const success = push.ok !== false && pull.ok !== false;
    _updateStats({
      syncing:false,
      lastSyncAt: new Date().toISOString(),
      lastSyncSuccess: success,
      totalSyncs: (_getStats().totalSyncs || 0) + 1,
      successfulSyncs: success ? (_getStats().successfulSyncs || 0) + 1 : (_getStats().successfulSyncs || 0)
    });
    _updateBadge(success ? 'ok' : 'error');

    return { ok:success, push, pull };
  }

  // ── 사이드바 상단 동기화 배지 ───────────────────────
  function _ensureBadge() {
    if (document.getElementById('erp-sync-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'erp-sync-badge';
    badge.style.cssText = 'position:fixed;top:8px;right:14px;z-index:9100;padding:5px 10px;border-radius:12px;font-size:0.74em;font-weight:700;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);transition:all .2s;background:#888;color:#fff;display:none;';
    badge.title = '클릭하여 즉시 동기화';
    badge.onclick = () => {
      syncNow().then(r => {
        const msg = r.ok ? '✅ 동기화 완료' : `⚠️ 동기화 실패: ${r.error}`;
        if (typeof setBanner === 'function') setBanner(r.ok?'ok':'warn', msg);
      });
    };
    document.body.appendChild(badge);
  }

  function _updateBadge(state) {
    _ensureBadge();
    const badge = document.getElementById('erp-sync-badge');
    if (!badge) return;
    const enabled = typeof erpSync !== 'undefined' && erpSync.isEnabled();
    if (!enabled) { badge.style.display = 'none'; return; }
    badge.style.display = 'block';
    const stats = _getStats();
    const statusMap = {
      'syncing': { bg:'#1565c0', text:'☁️ 동기화 중…' },
      'ok':      { bg:'#27ae60', text:'☁️ 동기화 OK' },
      'error':   { bg:'#c62828', text:'⚠️ 동기화 오류' },
      'idle':    { bg:'#5d6d7e', text:'☁️ 대기' }
    };
    const cur = statusMap[state || (stats.lastSyncSuccess ? 'ok' : 'idle')];
    badge.style.background = cur.bg;
    badge.textContent = cur.text;
  }

  // ── 오프라인 감지 ───────────────────────────────────
  function _hookOnline() {
    window.addEventListener('online', () => {
      _appendLog({ type:'network', level:'info', message:'온라인 복귀 — 자동 동기화 실행' });
      if (typeof setBanner === 'function') setBanner('info', '🌐 온라인 복귀 — 동기화 중');
      setTimeout(syncNow, 1500);
    });
    window.addEventListener('offline', () => {
      _appendLog({ type:'network', level:'warn', message:'오프라인 전환' });
      if (typeof setBanner === 'function') setBanner('warn', '⚠️ 오프라인 — 변경사항은 큐에 저장됨');
      _updateBadge('error');
    });
  }

  // ── GS URL 설정 마법사 ──────────────────────────────
  function openSetupWizard() {
    const cur = typeof gsUrl !== 'undefined' ? gsUrl : '';
    const html = `
      <div style="max-width:700px;margin:0 auto;">
        <h3 style="margin:0 0 14px;color:#1a1a2e;">Google Sheets 동기화 설정</h3>
        <ol style="line-height:1.8;color:#333;padding-left:20px;">
          <li>구글 시트(스프레드시트)를 새로 만들거나 기존 시트를 엽니다</li>
          <li><strong>확장 프로그램 → Apps Script</strong> 메뉴 선택</li>
          <li>제공된 <code>apps_script_template.gs</code> 코드를 복사하여 붙여넣기</li>
          <li><strong>배포 → 새 배포</strong> 클릭 → 유형: <strong>웹 앱</strong></li>
          <li>액세스 권한: <strong>모든 사용자</strong> 또는 <strong>나만</strong> 선택</li>
          <li>배포 후 발급된 <strong>웹 앱 URL</strong> 을 아래에 붙여넣기</li>
        </ol>
        <label style="display:block;margin-top:14px;color:#666;font-weight:700;font-size:0.86em;">Apps Script Web App URL</label>
        <input id="syncwiz-url" type="url" value="${cur||''}" placeholder="https://script.google.com/macros/s/AKfycb.../exec"
               style="width:100%;padding:10px;border:1.5px solid #ccc;border-radius:6px;font-family:Consolas,monospace;font-size:0.84em;margin-top:6px;">
        <div id="syncwiz-test-result" style="margin-top:10px;font-size:0.86em;"></div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" onclick="syncStability._closeWizard()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="syncStability._testWizard()">연결 테스트</button>
          <button class="btn btn-success btn-sm" onclick="syncStability._saveWizard()">저장 + 동기화 활성</button>
        </div>
      </div>
    `;
    const modal = document.createElement('div');
    modal.id = 'syncwiz-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:6vh;';
    modal.onclick = e => { if (e.target === modal) _closeWizard(); };
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:760px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 16px 60px rgba(0,0,0,0.3);';
    box.innerHTML = html;
    modal.appendChild(box);
    document.body.appendChild(modal);
  }
  function _closeWizard() {
    const m = document.getElementById('syncwiz-modal');
    if (m) m.remove();
  }
  async function _testWizard() {
    const url = (document.getElementById('syncwiz-url')?.value || '').trim();
    const out = document.getElementById('syncwiz-test-result');
    if (!url) { out.innerHTML = '<span style="color:#c62828;">⚠️ URL 입력 필요</span>'; return; }
    out.innerHTML = '<span style="color:#666;">🔄 연결 테스트 중...</span>';
    const r = await testConnection(url);
    if (r.ok) {
      out.innerHTML = `<span style="color:#27ae60;font-weight:700;">✅ 연결 성공! 시트 행 ${r.rows}건${r.message ? ' · ' + r.message : ''}</span>`;
    } else {
      out.innerHTML = `<span style="color:#c62828;font-weight:700;">❌ 실패: ${r.error}</span>`;
    }
  }
  function _saveWizard() {
    const url = (document.getElementById('syncwiz-url')?.value || '').trim();
    if (!url) { alert('URL을 입력해주세요.'); return; }
    if (!/^https:\/\/script\.google\.com\//.test(url)) {
      if (!confirm('Apps Script URL 형식이 아닌 것 같습니다. 그래도 저장하시겠습니까?')) return;
    }
    try {
      localStorage.setItem('erp_gs_url', url);
      if (typeof gsUrl !== 'undefined') window.gsUrl = url;
    } catch(e) { alert('저장 실패: ' + e.message); return; }
    // 동기화 활성화
    if (typeof erpSync !== 'undefined' && erpSync.enable) {
      erpSync.enable(true);
    }
    _closeWizard();
    if (typeof setBanner === 'function') setBanner('ok', '✅ Google Sheets URL 저장 + 자동 동기화 활성');
    _renderStatusCard(document.getElementById('syncstab-status-card'));
  }
  window.syncStability_closeWizard = _closeWizard;
  window.syncStability_testWizard = _testWizard;
  window.syncStability_saveWizard = _saveWizard;

  // ── 설정 탭 상태 카드 ──────────────────────────────
  function _renderStatusCard(hostEl) {
    if (!hostEl) return;
    const enabled = typeof erpSync !== 'undefined' && erpSync.isEnabled();
    const status = typeof erpSync !== 'undefined' ? erpSync.status() : {};
    const stats = _getStats();
    const log = _getLog();
    const recentErrors = log.filter(l => l.level === 'error').slice(0, 5);

    const _fmtTime = (s) => {
      if (!s) return '없음';
      try { return new Date(s).toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'short' }); }
      catch(e) { return s; }
    };
    const successRate = stats.totalSyncs > 0
      ? Math.round((stats.successfulSyncs || 0) / stats.totalSyncs * 100)
      : 0;

    hostEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
        <div style="background:${enabled?'#e8f5e9':'#ffebee'};padding:10px;border-radius:8px;border-left:4px solid ${enabled?'#27ae60':'#c62828'};">
          <div style="font-size:0.72em;color:#666;font-weight:700;">상태</div>
          <div style="font-size:1em;font-weight:800;color:${enabled?'#1b5e20':'#b71c1c'};margin-top:2px;">${enabled?'✓ 활성':'✗ 비활성'}</div>
          <div style="font-size:0.72em;color:#888;">${status.gsUrl?'URL 설정됨':'URL 필요'}</div>
        </div>
        <div style="background:#f8f9fa;padding:10px;border-radius:8px;border-left:4px solid #0d47a1;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">마지막 동기화</div>
          <div style="font-size:0.84em;font-weight:700;color:#1a1a2e;margin-top:2px;">${_fmtTime(stats.lastSyncAt)}</div>
          <div style="font-size:0.72em;color:${stats.lastSyncSuccess?'#27ae60':'#c62828'};">${stats.lastSyncSuccess?'✓ 성공':stats.lastSyncAt?'✗ 실패':'-'}</div>
        </div>
        <div style="background:#f8f9fa;padding:10px;border-radius:8px;border-left:4px solid #7b1fa2;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">대기 큐</div>
          <div style="font-size:1.1em;font-weight:800;color:${(status.queueLength||0)>0?'#e65100':'#1a1a2e'};margin-top:2px;">${status.queueLength||0}건</div>
          <div style="font-size:0.72em;color:#888;">디바이스: ${(status.deviceId||'-').slice(0,10)}</div>
        </div>
        <div style="background:#f8f9fa;padding:10px;border-radius:8px;border-left:4px solid #27ae60;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">성공률</div>
          <div style="font-size:1.1em;font-weight:800;color:${successRate>=90?'#27ae60':successRate>=70?'#e65100':'#c62828'};margin-top:2px;">${successRate}%</div>
          <div style="font-size:0.72em;color:#888;">${stats.totalSyncs||0}회 시도</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        ${enabled
          ? `<button class="btn btn-primary btn-sm" onclick="syncStability.syncNow()">지금 동기화</button>
             <button class="btn btn-outline btn-sm" onclick="syncStability._toggleEnabled()">동기화 일시정지</button>`
          : `<button class="btn btn-success btn-sm" onclick="syncStability._toggleEnabled()">동기화 활성화</button>`}
        <button class="btn btn-outline btn-sm" onclick="syncStability.openSetupWizard()">⚙ URL 설정 마법사</button>
        <button class="btn btn-outline btn-sm" onclick="syncStability._testConnUI()">연결 테스트</button>
        <button class="btn btn-outline btn-sm" onclick="syncStability._showErrorLog()">에러 로그</button>
      </div>

      ${recentErrors.length > 0 ? `
      <details style="background:#ffebee;border-left:3px solid #c62828;border-radius:6px;padding:8px 12px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;color:#c62828;">⚠️ 최근 에러 ${recentErrors.length}건</summary>
        <div style="margin-top:8px;font-size:0.82em;color:#555;max-height:150px;overflow-y:auto;">
          ${recentErrors.map(e => `
            <div style="padding:4px 0;border-bottom:1px solid #ffcdd2;">
              <strong>${_fmtTime(e.at)}</strong> · ${e.type}: ${e.message||'-'}
            </div>
          `).join('')}
        </div>
      </details>` : ''}

      <details style="background:#fffde7;border-left:3px solid #f9a825;border-radius:6px;padding:8px 12px;">
        <summary style="cursor:pointer;font-weight:700;color:#5d4037;">💡 동기화 작동 방식</summary>
        <div style="margin-top:8px;font-size:0.84em;color:#555;line-height:1.6;">
          <strong>Push</strong> — 로컬 변경 → Google Sheets 업로드 (30초 주기)<br>
          <strong>Pull</strong> — Google Sheets 의 다른 사용자 변경 → 로컬 적용<br>
          <strong>재시도</strong> — 실패 시 2초 → 8초 → 30초 간격 지수 백오프 (최대 3회)<br>
          <strong>오프라인</strong> — 자동 감지, 큐에 저장 후 온라인 복귀 시 자동 발송<br>
          <strong>충돌</strong> — 마지막 변경 timestamp 비교 후 최신 우선<br>
          <span style="color:#c62828;">⚠️ Apps Script 사용량 일일 한도 (무료 계정 ~3,000회 호출/일) 주의</span>
        </div>
      </details>
    `;
  }

  function _toggleEnabled() {
    if (typeof erpSync === 'undefined') { alert('sync 모듈 미로드'); return; }
    const next = !erpSync.isEnabled();
    if (next && (typeof gsUrl === 'undefined' || !gsUrl)) {
      alert('먼저 Google Sheets URL 을 설정해주세요.\n[⚙ URL 설정 마법사] 버튼을 클릭하세요.');
      return;
    }
    erpSync.enable(next);
    _updateBadge(next ? 'idle' : 'idle');
    _renderStatusCard(document.getElementById('syncstab-status-card'));
  }

  async function _testConnUI() {
    const r = await testConnection();
    if (r.ok) alert(`✅ 연결 성공!\n\n시트 행: ${r.rows}건${r.message ? '\n메시지: ' + r.message : ''}`);
    else alert(`❌ 연결 실패\n\n원인: ${r.error}\n\n[⚙ URL 설정 마법사] 에서 URL 을 확인하세요.`);
  }

  function _showErrorLog() {
    const log = _getLog();
    if (log.length === 0) { alert('로그가 없습니다.'); return; }
    const lines = log.slice(0, 20).map(l => {
      const t = new Date(l.at).toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'medium' });
      const mark = l.level === 'error' ? '❌' : l.level === 'warn' ? '⚠️' : 'ℹ️';
      return `${mark} ${t} [${l.type}] ${l.message || '-'}`;
    }).join('\n');
    alert(`📋 동기화 로그 (최근 ${Math.min(20, log.length)}/${log.length}건)\n\n${lines}`);
  }

  // ── 설정 탭 자동 주입 ──────────────────────────────
  function _injectIntoSettings() {
    if (document.getElementById('syncstab-status-card')) return;
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div class="card-head">
        <h3>Google Sheets 동기화</h3>
        <span class="tag blue">실시간 다중 사용자</span>
      </div>
      <div class="card-body" id="syncstab-status-card"></div>
    `;
    // 자동 백업 카드 다음에 삽입
    const autoBackupCard = tab.querySelector('#autobackup-status-card')?.closest('.card');
    if (autoBackupCard) autoBackupCard.parentNode.insertBefore(card, autoBackupCard.nextSibling);
    else tab.appendChild(card);
    _renderStatusCard(document.getElementById('syncstab-status-card'));
  }

  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__syncStabHooked) return;
    const orig = window.showTab;
    window.showTab = function(id) {
      const r = orig.apply(this, arguments);
      if (id === 'settings') setTimeout(_injectIntoSettings, 200);
      return r;
    };
    window.showTab.__syncStabHooked = true;
  }

  // ── 공개 API ────────────────────────────────────────
  window.syncStability = {
    syncNow,
    testConnection,
    getLog: _getLog,
    getStats: _getStats,
    openSetupWizard,
    // UI helpers
    _toggleEnabled, _testConnUI, _showErrorLog, _renderStatusCard,
    _closeWizard, _testWizard, _saveWizard
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _hookShowTab();
    _hookOnline();
    _ensureBadge();
    _updateBadge(_getStats().lastSyncSuccess ? 'ok' : 'idle');
    // 첫 화면이 설정 탭이면 즉시 주입
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-settings') _injectIntoSettings();
    }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SYNC-STAB] 동기화 안정화 레이어 활성 — syncStability.syncNow()');
})();
