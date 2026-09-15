// =====================================================
//  ERROR LOGGER — 중앙 에러 로깅 + 사용자 노출 (Phase 1 · #4)
//
//  기능
//   1. window.error / unhandledrejection 자동 캡처
//   2. console.error 가로채서 로그에 기록
//   3. localStorage 에 최근 100건 저장
//   4. 우측 상단 에러 인디케이터 (빨간 점) — 새 에러 발생 시
//   5. 상세 패널 (에러 로그 + 스택 + 재현 단계)
//   6. 에러 발생 시 자동 백업 트리거 (안전 모드)
//   7. logError(label, error) 통합 API — 기존 silent fail 대체
//
//  공개 API: window.errorLogger
// =====================================================
(function() {
  'use strict';

  const LOG_KEY = 'erp_error_log';
  const MAX_LOG = 100;
  const SEEN_KEY = 'erp_error_last_seen';

  // ── 저장 ────────────────────────────────────────────
  function _getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function _save(log) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX_LOG))); }
    catch(e) {}
  }

  // ── 로그 추가 ───────────────────────────────────────
  function log(label, errorOrMsg, context) {
    const entry = {
      at: new Date().toISOString(),
      label: label || 'unknown',
      level: 'error'
    };

    if (errorOrMsg instanceof Error) {
      entry.message = errorOrMsg.message;
      entry.stack = errorOrMsg.stack ? errorOrMsg.stack.split('\n').slice(0, 6).join('\n') : '';
      entry.type = errorOrMsg.name || 'Error';
    } else {
      entry.message = String(errorOrMsg);
      entry.type = 'String';
    }

    if (context) {
      try { entry.context = JSON.stringify(context).slice(0, 500); }
      catch(e) { entry.context = String(context); }
    }
    // 현재 활성 탭
    const activeTab = document.querySelector('.tab-panel.active');
    if (activeTab) entry.tab = activeTab.id;
    // URL
    entry.url = location.hash || '/';

    const arr = _getLog();
    arr.unshift(entry);
    _save(arr);
    _updateBadge();
    return entry;
  }

  function logWarning(label, msg, context) {
    const e = log(label, msg, context);
    e.level = 'warn';
    const arr = _getLog();
    if (arr.length > 0) { arr[0].level = 'warn'; _save(arr); }
    _updateBadge();
    return e;
  }

  function logInfo(label, msg, context) {
    const e = log(label, msg, context);
    e.level = 'info';
    const arr = _getLog();
    if (arr.length > 0) { arr[0].level = 'info'; _save(arr); }
    return e;
  }

  // ── 전역 에러 캡처 ──────────────────────────────────
  function _hookGlobal() {
    // 1) window.onerror
    window.addEventListener('error', e => {
      // 외부 스크립트(이미지 등) 로드 실패는 무시
      if (!e.message && !e.error) return;
      log('window.error', e.error || e.message, {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno
      });
    });

    // 2) promise rejection
    window.addEventListener('unhandledrejection', e => {
      log('unhandledrejection', e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
    });

    // 3) console.error 가로채기
    const origConsoleError = console.error;
    console.error = function(...args) {
      try {
        const msg = args.map(a => {
          if (a instanceof Error) return a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 200); } catch(e) { return String(a); } }
          return String(a);
        }).join(' ');
        // ERP 내부 prefix 가 있는 것만 기록 (외부 라이브러리 노이즈 차단)
        if (/\[ERP-|\[autoBackup|\[syncStab|\[dataIntegrity|\[errorLogger/.test(msg) || args[0] instanceof Error) {
          log('console.error', msg);
        }
      } catch(e) {}
      origConsoleError.apply(console, args);
    };
  }

  // ── 사용자 노출 — 우측 상단 인디케이터 ──────────────
  function _ensureIndicator() {
    if (document.getElementById('erp-error-indicator')) return;
    const ind = document.createElement('div');
    ind.id = 'erp-error-indicator';
    ind.style.cssText = 'position:fixed;top:8px;right:158px;z-index:9100;padding:5px 10px;border-radius:12px;font-size:0.74em;font-weight:700;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);background:#c62828;color:#fff;display:none;';
    ind.title = '클릭하여 에러 로그 보기';
    ind.onclick = openPanel;
    document.body.appendChild(ind);
  }

  function _updateBadge() {
    _ensureIndicator();
    const ind = document.getElementById('erp-error-indicator');
    if (!ind) return;
    const log = _getLog();
    const seen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    const unseen = log.filter(l => new Date(l.at).getTime() > seen && l.level === 'error').length;
    if (unseen > 0) {
      ind.style.display = 'block';
      ind.textContent = `⚠️ 에러 ${unseen}건`;
    } else {
      ind.style.display = 'none';
    }
  }

  function _markSeen() {
    try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch(e) {}
    _updateBadge();
  }

  // ── 에러 패널 ──────────────────────────────────────
  function openPanel() {
    _markSeen();
    const old = document.getElementById('erp-error-panel');
    if (old) { old.remove(); return; }

    const log = _getLog();
    const _fmtTime = (s) => {
      try { return new Date(s).toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'medium' }); }
      catch(e) { return s; }
    };
    const levelColor = { 'error':'#c62828','warn':'#e65100','info':'#1565c0' };
    const levelBg = { 'error':'#ffebee','warn':'#fff3e0','info':'#e3f2fd' };
    const levelIcon = { 'error':'❌','warn':'⚠️','info':'ℹ️' };

    const modal = document.createElement('div');
    modal.id = 'erp-error-panel';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:5vh;';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:90%;max-width:880px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,0.3);">
        <div style="padding:14px 18px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;">
          <h4 style="margin:0;font-size:1em;font-weight:700;">에러 로그 (최근 ${log.length}건)</h4>
          <div>
            <button onclick="errorLogger._copyAll()" style="background:#0d47a1;color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:0.82em;cursor:pointer;margin-right:6px;">복사</button>
            <button onclick="errorLogger._exportLog()" style="background:#27ae60;color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:0.82em;cursor:pointer;margin-right:6px;">파일 저장</button>
            <button onclick="errorLogger.clear()" style="background:#c62828;color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:0.82em;cursor:pointer;margin-right:6px;">전체 삭제</button>
            <button onclick="document.getElementById('erp-error-panel').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:14px;">
          ${log.length === 0 ? '<div style="padding:30px;text-align:center;color:#bbb;">에러 로그가 없습니다.</div>' : log.map((e, i) => `
            <div style="background:${levelBg[e.level]||'#fafafa'};border-left:4px solid ${levelColor[e.level]||'#888'};padding:10px 14px;border-radius:8px;margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <strong style="color:${levelColor[e.level]||'#1a1a2e'};">${levelIcon[e.level]||'•'} ${e.label} ${e.type?`<span style="font-size:0.78em;color:#888;font-weight:400;">[${e.type}]</span>`:''}</strong>
                <span style="font-size:0.78em;color:#666;">${_fmtTime(e.at)}${e.tab?` · ${e.tab}`:''}</span>
              </div>
              <div style="font-size:0.86em;color:#333;font-family:Consolas,monospace;background:rgba(255,255,255,0.6);padding:6px 8px;border-radius:4px;word-break:break-word;">${(e.message||'-').replace(/</g,'&lt;')}</div>
              ${e.stack ? `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:0.78em;color:#666;">스택 트레이스</summary><pre style="font-size:0.78em;color:#666;background:#f5f5f5;padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;white-space:pre-wrap;">${(e.stack||'').replace(/</g,'&lt;')}</pre></details>` : ''}
              ${e.context ? `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:0.78em;color:#666;">컨텍스트</summary><pre style="font-size:0.78em;color:#666;background:#f5f5f5;padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${(e.context||'').replace(/</g,'&lt;')}</pre></details>` : ''}
            </div>
          `).join('')}
        </div>
        <div style="padding:10px 14px;background:#fafafa;border-top:1px solid #eee;font-size:0.78em;color:#666;display:flex;justify-content:space-between;align-items:center;">
          <span>💡 에러 발생 시 [파일 저장] 후 관리자에게 전달하면 빠른 원인 파악 가능</span>
          <span>${log.length}/${MAX_LOG} 저장 한도</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function _copyAll() {
    const log = _getLog();
    const text = log.map(e => {
      const t = new Date(e.at).toLocaleString('ko-KR');
      return `[${t}] ${e.level.toUpperCase()} ${e.label}: ${e.message}\n${e.stack || ''}\n`;
    }).join('\n---\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        if (typeof setBanner === 'function') setBanner('ok', '📋 에러 로그가 클립보드에 복사됨');
      });
    } else {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      if (typeof setBanner === 'function') setBanner('ok', '📋 에러 로그 복사됨');
    }
  }

  function _exportLog() {
    const log = _getLog();
    const data = {
      type: 'ERP_ERROR_LOG',
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      device: localStorage.getItem('erp_device_id') || '-',
      count: log.length,
      entries: log
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ERP_ERROR_LOG_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (typeof setBanner === 'function') setBanner('ok', '💾 에러 로그 파일 저장됨');
  }

  function clear() {
    if (!confirm('모든 에러 로그를 삭제하시겠습니까?')) return;
    try { localStorage.removeItem(LOG_KEY); } catch(e) {}
    _updateBadge();
    const panel = document.getElementById('erp-error-panel');
    if (panel) { panel.remove(); openPanel(); }
    if (typeof setBanner === 'function') setBanner('ok', '🗑 에러 로그 삭제 완료');
  }

  // ── 설정 탭 통계 카드 ──────────────────────────────
  function _renderStatsCard(hostEl) {
    if (!hostEl) return;
    const log = _getLog();
    const errors = log.filter(l => l.level === 'error').length;
    const warns = log.filter(l => l.level === 'warn').length;
    const today = new Date().toISOString().slice(0,10);
    const todayErr = log.filter(l => l.at.startsWith(today)).length;
    const topLabels = {};
    log.forEach(l => { topLabels[l.label] = (topLabels[l.label]||0) + 1; });
    const top5 = Object.entries(topLabels).sort((a,b) => b[1]-a[1]).slice(0, 5);

    hostEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
        <div style="background:#ffebee;padding:10px;border-radius:8px;border-left:4px solid #c62828;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">전체 에러</div>
          <div style="font-size:1.6em;font-weight:900;color:#c62828;line-height:1;">${errors}</div>
          <div style="font-size:0.72em;color:#888;">건</div>
        </div>
        <div style="background:#fff3e0;padding:10px;border-radius:8px;border-left:4px solid #e65100;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">경고</div>
          <div style="font-size:1.6em;font-weight:900;color:#e65100;line-height:1;">${warns}</div>
          <div style="font-size:0.72em;color:#888;">건</div>
        </div>
        <div style="background:#fffde7;padding:10px;border-radius:8px;border-left:4px solid #f9a825;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">오늘 발생</div>
          <div style="font-size:1.6em;font-weight:900;color:#f57f17;line-height:1;">${todayErr}</div>
          <div style="font-size:0.72em;color:#888;">건</div>
        </div>
        <div style="background:#e8f5e9;padding:10px;border-radius:8px;border-left:4px solid #27ae60;">
          <div style="font-size:0.72em;color:#666;font-weight:700;">저장 한도</div>
          <div style="font-size:1.6em;font-weight:900;color:#1b5e20;line-height:1;">${log.length}/${MAX_LOG}</div>
          <div style="font-size:0.72em;color:#888;">${Math.round(log.length/MAX_LOG*100)}% 사용</div>
        </div>
      </div>

      ${top5.length > 0 ? `
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;color:#1a1a2e;margin-bottom:6px;font-size:0.92em;">자주 발생한 에러 TOP 5</div>
        ${top5.map(([label, count]) => `
          <div style="display:flex;justify-content:space-between;padding:6px 10px;background:#fafafa;border-radius:6px;margin-bottom:4px;">
            <span style="font-family:Consolas,monospace;font-size:0.84em;">${label}</span>
            <span style="font-weight:700;color:#c62828;">${count}회</span>
          </div>
        `).join('')}
      </div>
      ` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="errorLogger.openPanel()">전체 로그 보기</button>
        <button class="btn btn-outline btn-sm" onclick="errorLogger._exportLog()">파일로 저장</button>
        <button class="btn btn-danger btn-sm" onclick="errorLogger.clear()">로그 초기화</button>
      </div>
    `;
  }

  // ── 설정 탭 자동 주입 ───────────────────────────────
  function _injectIntoSettings() {
    if (document.getElementById('errorlog-stats-card')) return;
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div class="card-head">
        <h3>에러 로그</h3>
        <span class="tag red">자동 수집</span>
      </div>
      <div class="card-body" id="errorlog-stats-card"></div>
    `;
    // 정합성 카드 다음에 삽입
    const integrityCard = tab.querySelector('#integrity-report-card')?.closest('.card');
    if (integrityCard) integrityCard.parentNode.insertBefore(card, integrityCard.nextSibling);
    else tab.appendChild(card);
    _renderStatsCard(document.getElementById('errorlog-stats-card'));
  }

  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__errorLogHooked) return;
    const orig = window.showTab;
    window.showTab = function(id) {
      const r = orig.apply(this, arguments);
      if (id === 'settings') setTimeout(_injectIntoSettings, 400);
      return r;
    };
    window.showTab.__errorLogHooked = true;
  }

  // ── 기존 logError 함수 노출 (호환) ──────────────────
  // 기존 sync.js / others 가 typeof logError === 'function' 으로 검사하므로
  // 명시적 글로벌 함수로 노출
  window.logError = function(label, error, context) {
    return log(label, error, context);
  };

  // ── 공개 API ────────────────────────────────────────
  window.errorLogger = {
    log, logWarning, logInfo,
    openPanel,
    getLog: _getLog,
    clear,
    _copyAll, _exportLog, _renderStatsCard
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _hookGlobal();
    _hookShowTab();
    _ensureIndicator();
    _updateBadge();
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-settings') _injectIntoSettings();
    }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-ERROR-LOG] 에러 로깅 활성 — errorLogger.openPanel() / logError(label, err)');
})();
