// =====================================================
//  OPS DASHBOARD — 운영 안정화
//
//  통합 운영 관리 패널
//   1. Health Score (0~100) — 5개 지표 종합
//   2. 사용 통계 (Usage Tracker) — 어떤 기능 자주 쓰는지 자동 측정
//   3. 일일 활동 (Daily Activity) — 등록/수정/삭제 카운트
//   4. 에러 트렌드 (7일)
//   5. 백업 상태
//
//  자동 측정 대상
//   - fab 클릭 (각 fab id)
//   - 콘솔 API 호출 주요 (window.* 함수 wrap)
//   - 데이터 변경 (saveLocal hook)
//   - 에러 발생
//
//  콘솔: ops.score() / ops.usage() / ops.daily() / ops.open()
// =====================================================
(function() {
  'use strict';

  const USAGE_KEY = 'erp_usage_stats';
  const ACTIVITY_KEY = 'erp_daily_activity';

  // ── 1. 사용 통계 (Usage Tracker) ───────────────────
  let usage = {};
  try { usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch(e) { usage = {}; }

  function _bumpUsage(key) {
    const today = new Date().toISOString().slice(0,10);
    if (!usage[today]) usage[today] = {};
    usage[today][key] = (usage[today][key] || 0) + 1;
    // 30일 이상 정리
    Object.keys(usage).forEach(d => {
      if ((new Date() - new Date(d)) > 30*86400*1000) delete usage[d];
    });
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch(e) {}
  }

  function _hookFabClicks() {
    const FAB_IDS = ['erp-health-fab','erp-gs-fab','erp-atp-fab','erp-aging-fab','erp-mob-fab',
                     'erp-calc-fab','erp-in-fab','erp-pur-fab','erp-dsp-fab','erp-ai-fab','erp-dv2-fab'];
    FAB_IDS.forEach(id => {
      const fab = document.getElementById(id);
      if (!fab || fab.dataset.usageHooked) return;
      fab.addEventListener('click', () => _bumpUsage('fab:'+id), true);
      fab.dataset.usageHooked = '1';
    });
  }

  // 주요 콘솔 API 호출 wrap
  function _hookApis() {
    const targets = [
      'erpCalc.open','incoming.open','aging.open','atp.open','sn.open','erpMobile.open',
      'purchase.open','dispatch.open','ai.open','dashboardV2.open','erpExcel.showWizard'
    ];
    targets.forEach(path => {
      const [obj, fn] = path.split('.');
      if (typeof window[obj] !== 'object' || typeof window[obj][fn] !== 'function') return;
      if (window[obj][fn].__usageHooked) return;
      const _orig = window[obj][fn];
      window[obj][fn] = function() {
        _bumpUsage('api:'+path);
        return _orig.apply(this, arguments);
      };
      window[obj][fn].__usageHooked = true;
    });
  }

  // ── 2. 일일 활동 ──────────────────────────────────
  let activity = [];
  try { activity = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]'); } catch(e) { activity = []; }

  function _logActivity(type) {
    activity.push({ when: new Date().toISOString(), type });
    if (activity.length > 1000) activity = activity.slice(-1000);
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); } catch(e) {}
  }

  function _hookSavers() {
    if (typeof window.saveLocal === 'function' && !window.saveLocal.__opsHooked) {
      const _orig = window.saveLocal;
      window.saveLocal = function() {
        _logActivity('save');
        return _orig.apply(this, arguments);
      };
      window.saveLocal.__opsHooked = true;
    }
  }

  // ── 3. Health Score 계산 ───────────────────────────
  function score() {
    const result = {
      total: 0,
      breakdown: {},
      issues: []
    };

    // 무결성 (25점)
    let intScore = 25;
    if (typeof healthCheck !== 'undefined') {
      try {
        const r = healthCheck.run(false);
        intScore = Math.max(0, 25 - r.issues.length * 4);
        if (r.issues.length) result.issues.push(...r.issues.map(i => '🩺 ' + i));
      } catch(e) {}
    }
    result.breakdown.integrity = intScore;

    // 회귀 테스트 (20점) — 마지막 주간 결과
    let testScore = 20;
    try {
      const hist = JSON.parse(localStorage.getItem('erp_weekly_tests')||'[]');
      const last = hist[hist.length - 1];
      if (last) {
        const passRate = last.total > 0 ? (last.pass / last.total) : 1;
        testScore = Math.round(20 * passRate);
        if (last.fail > 0) result.issues.push(`🧪 회귀 테스트 ${last.fail}건 실패 (마지막 ${last.when.slice(0,10)})`);
        // 7일 이상 미실행 페널티
        if ((new Date() - new Date(last.when)) > 7*86400*1000) {
          testScore = Math.max(0, testScore - 5);
          result.issues.push('🧪 주간 회귀 테스트 7일 이상 미실행');
        }
      } else {
        testScore = 10;
        result.issues.push('🧪 주간 회귀 테스트 이력 없음');
      }
    } catch(e) {}
    result.breakdown.tests = testScore;

    // 에러 (20점) — 최근 7일 누적
    let errScore = 20;
    try {
      const errs = JSON.parse(localStorage.getItem('erp_errors')||'[]');
      const recentErrs = errs.filter(e => (new Date() - new Date(e.when)) < 7*86400*1000);
      errScore = Math.max(0, 20 - Math.min(20, recentErrs.length * 2));
      if (recentErrs.length > 5) result.issues.push(`❌ 최근 7일 에러 ${recentErrs.length}건`);
    } catch(e) {}
    result.breakdown.errors = errScore;

    // 백업 (15점)
    let backupScore = 0;
    try {
      const today = new Date().toISOString().slice(0,10);
      const todaySnap = localStorage.getItem('erp_snapshot_' + today);
      if (todaySnap) backupScore += 8;
      // 최근 3일 스냅샷
      let snapCount = 0;
      Object.keys(localStorage).filter(k => k.indexOf('erp_snapshot_')===0).forEach(k => {
        const d = k.replace('erp_snapshot_','');
        if ((new Date() - new Date(d)) < 7*86400*1000) snapCount++;
      });
      backupScore += Math.min(7, snapCount * 1);
      if (snapCount === 0) result.issues.push('💾 일일 스냅샷 없음');
    } catch(e) {}
    result.breakdown.backup = backupScore;

    // 활성도 (20점) — 최근 7일 활동
    let activityScore = 0;
    const recentActs = activity.filter(a => (new Date() - new Date(a.when)) < 7*86400*1000);
    activityScore = Math.min(20, Math.floor(recentActs.length / 2));
    if (recentActs.length === 0) result.issues.push('💤 7일간 활동 없음 — 사용 안 되는 시스템');
    result.breakdown.activity = activityScore;

    result.total = intScore + testScore + errScore + backupScore + activityScore;
    return result;
  }

  // ── 4. UI ──────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-ops-fab')) return;
    const css = `
      #erp-ops-fab{position:fixed;bottom:18px;right:614px;width:44px;height:44px;border-radius:50%;
        background:#37474f;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;}
      #erp-ops-fab:hover{background:#263238;transform:scale(1.07);}
      #erp-ops-fab.bad{background:#c62828;animation:opsPulse 2s infinite;}
      @keyframes opsPulse{0%,100%{box-shadow:0 4px 14px rgba(198,40,40,0.5);}50%{box-shadow:0 4px 22px rgba(198,40,40,0.95);}}
      #erp-ops-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:4vh;}
      #erp-ops-modal.open{display:flex;}
      .ops-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:94%;max-width:1080px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;}
      .ops-hd{padding:14px 18px;background:#37474f;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .ops-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .ops-score-card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;margin-bottom:14px;}
      .ops-score-num{font-size:4.5em;font-weight:900;line-height:1;}
      .ops-bd-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:14px;}
      .ops-bd-item{padding:10px;background:#f8f9fa;border-radius:8px;text-align:center;}
      .ops-bd-l{font-size:0.74em;color:#666;font-weight:700;margin-bottom:4px;}
      .ops-bd-v{font-size:1.4em;font-weight:800;}
      .ops-bar{height:6px;background:#e0e0e0;border-radius:3px;margin-top:6px;overflow:hidden;}
      .ops-bar-fill{height:100%;border-radius:3px;}
      .ops-issues{background:#fffde7;border-left:4px solid #f9a825;padding:10px 14px;border-radius:6px;margin-bottom:14px;}
      .ops-issues h5{margin:0 0 6px;color:#e65100;font-size:0.92em;}
      .ops-issues li{font-size:0.84em;color:#555;line-height:1.6;}
      .ops-tabs{display:flex;border-bottom:1px solid #eee;background:#fff;margin-top:14px;border-radius:10px 10px 0 0;}
      .ops-tabs button{flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-size:0.86em;color:#888;border-bottom:2px solid transparent;}
      .ops-tabs button.active{color:#37474f;font-weight:700;border-bottom-color:#37474f;background:#f5f5f5;}
      .ops-section{background:#fff;padding:14px 18px;border-radius:0 0 10px 10px;}
      .ops-tbl{width:100%;border-collapse:collapse;font-size:0.84em;}
      .ops-tbl th{background:#1a1a2e;color:#fff;padding:6px 10px;text-align:left;}
      .ops-tbl td{padding:6px 10px;border-bottom:1px solid #eee;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-ops-style'; style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-ops-fab'; fab.title = '운영 대시보드'; fab.textContent = '🎯';
    fab.onclick = open; document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-ops-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="ops-box">
        <div class="ops-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🎯 운영 대시보드 — 시스템 건강 + 사용 분석</h4>
          <button onclick="document.getElementById('erp-ops-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="ops-bd" id="ops-bd"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  function _renderScore() {
    const s = score();
    const color = s.total >= 80 ? '#27ae60' : s.total >= 60 ? '#f9a825' : s.total >= 40 ? '#e65100' : '#c62828';
    const grade = s.total >= 80 ? 'A' : s.total >= 60 ? 'B' : s.total >= 40 ? 'C' : 'D';
    const labels = { integrity:'무결성', tests:'회귀테스트', errors:'에러', backup:'백업', activity:'활성도' };
    const max = { integrity:25, tests:20, errors:20, backup:15, activity:20 };

    const issuesHtml = s.issues.length
      ? `<div class="ops-issues"><h5>⚠️ 개선 권장 (${s.issues.length}건)</h5><ul>${s.issues.map(i => `<li>${i}</li>`).join('')}</ul></div>`
      : '';

    return `
      <div class="ops-score-card">
        <div style="font-size:0.84em;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">시스템 건강 점수</div>
        <div class="ops-score-num" style="color:${color};">${s.total}<span style="font-size:0.4em;color:#888;">/100</span></div>
        <div style="font-size:1.4em;font-weight:700;color:${color};margin-top:4px;">등급 ${grade}</div>
        <div class="ops-bd-grid">
          ${Object.entries(s.breakdown).map(([k,v]) => `
            <div class="ops-bd-item">
              <div class="ops-bd-l">${labels[k]}</div>
              <div class="ops-bd-v" style="color:${v >= max[k]*0.8 ? '#27ae60' : v >= max[k]*0.5 ? '#f9a825' : '#c62828'};">${v}<span style="font-size:0.5em;color:#888;">/${max[k]}</span></div>
              <div class="ops-bar"><div class="ops-bar-fill" style="width:${(v/max[k]*100)}%;background:${v >= max[k]*0.8 ? '#27ae60' : v >= max[k]*0.5 ? '#f9a825' : '#c62828'};"></div></div>
            </div>`).join('')}
        </div>
      </div>
      ${issuesHtml}`;
  }

  function _renderUsage() {
    // 최근 7일 합계
    const last7 = {};
    Object.entries(usage).forEach(([d, m]) => {
      if ((new Date() - new Date(d)) > 7*86400*1000) return;
      Object.entries(m).forEach(([k,v]) => {
        last7[k] = (last7[k]||0) + v;
      });
    });
    const sorted = Object.entries(last7).sort((a,b) => b[1] - a[1]).slice(0, 20);
    if (!sorted.length) {
      return '<div style="padding:40px;text-align:center;color:#bbb;">사용 통계 없음 — 1~2일 사용 후 확인</div>';
    }
    const max = sorted[0][1];
    return `
      <div style="font-size:0.86em;color:#666;margin-bottom:10px;">최근 7일 사용 빈도 TOP 20</div>
      ${sorted.map(([k,v]) => {
        const w = (v/max) * 100;
        const lbl = k.startsWith('fab:') ? '🔘 ' + k.replace('fab:erp-','').replace('-fab','') :
                    k.startsWith('api:') ? '⚙️ ' + k.replace('api:','') : k;
        return `<div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:0.84em;margin-bottom:3px;">
            <span style="color:#444;font-weight:700;">${lbl}</span>
            <span style="color:#666;">${v}회</span>
          </div>
          <div style="background:#f0f0f0;height:6px;border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${w}%;background:#37474f;"></div>
          </div>
        </div>`;
      }).join('')}`;
  }

  function _renderActivity() {
    // 7일치 일별
    const days = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0,10)] = 0;
    }
    activity.forEach(a => {
      const d = a.when.slice(0,10);
      if (d in days) days[d]++;
    });
    const max = Math.max(1, ...Object.values(days));
    return `
      <div style="font-size:0.86em;color:#666;margin-bottom:10px;">최근 7일 일별 활동 (saveLocal 호출 횟수)</div>
      <div style="display:flex;gap:6px;align-items:flex-end;height:120px;padding:0 10px;">
        ${Object.entries(days).map(([d,n]) => {
          const h = (n/max) * 100;
          const dow = new Date(d).getDay();
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:0.78em;color:#888;margin-bottom:4px;">${n}</div>
            <div style="width:100%;height:${h}%;background:#37474f;border-radius:3px 3px 0 0;min-height:2px;"></div>
            <div style="font-size:0.74em;color:${dow===0?'#c62828':dow===6?'#1565c0':'#666'};margin-top:4px;">${d.slice(5)}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="text-align:center;margin-top:10px;font-size:0.82em;color:#888;">
        총 ${activity.length}건 누적 · 최근 7일 ${Object.values(days).reduce((s,v)=>s+v,0)}건
      </div>`;
  }

  function _renderErrors() {
    let errs = [];
    try { errs = JSON.parse(localStorage.getItem('erp_errors')||'[]'); } catch(e) {}
    if (!errs.length) return '<div style="padding:40px;text-align:center;color:#27ae60;font-size:1em;">✅ 누적 에러 없음 — 매우 양호</div>';
    return `
      <div style="font-size:0.86em;color:#666;margin-bottom:10px;">최근 에러 (최대 50건)</div>
      <table class="ops-tbl">
        <thead><tr><th>시각</th><th>레이블</th><th>메시지</th></tr></thead>
        <tbody>${errs.slice(-50).reverse().map(e => `<tr>
          <td>${e.when.replace('T',' ').slice(0,19)}</td>
          <td><strong>${e.label}</strong></td>
          <td style="color:#c62828;font-size:0.9em;">${(e.message||'').slice(0,80)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  function _renderBackup() {
    const snapKeys = Object.keys(localStorage).filter(k => k.indexOf('erp_snapshot_')===0).sort().reverse();
    const backupKeys = Object.keys(localStorage).filter(k => k.endsWith('_backup'));
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div>
          <h5 style="margin:0 0 8px;">📅 일일 스냅샷 (최근 7일)</h5>
          ${snapKeys.length ? snapKeys.slice(0,7).map(k => {
            const d = k.replace('erp_snapshot_','');
            const sz = (localStorage.getItem(k)?.length || 0);
            return `<div style="padding:6px 10px;background:#f8f9fa;border-radius:5px;margin-bottom:4px;font-size:0.84em;display:flex;justify-content:space-between;">
              <span>📆 ${d}</span>
              <span style="color:#888;">${(sz/1024).toFixed(1)} KB</span>
            </div>`;
          }).join('') : '<div style="color:#bbb;padding:14px;">스냅샷 없음</div>'}
        </div>
        <div>
          <h5 style="margin:0 0 8px;">🔒 직전값 백업 (BACKUP_KEYS)</h5>
          ${backupKeys.length ? backupKeys.slice(0,15).map(k => {
            const sz = (localStorage.getItem(k)?.length || 0);
            return `<div style="padding:6px 10px;background:#f8f9fa;border-radius:5px;margin-bottom:4px;font-size:0.84em;display:flex;justify-content:space-between;">
              <span>${k.replace('_backup','').replace('erp_','')}</span>
              <span style="color:#888;">${(sz/1024).toFixed(1)} KB</span>
            </div>`;
          }).join('') : '<div style="color:#bbb;padding:14px;">백업 없음</div>'}
        </div>
      </div>
      <div style="margin-top:14px;padding:10px;background:#e8f5e9;border-left:4px solid #27ae60;border-radius:6px;font-size:0.84em;">
        💡 모든 보호 키 변경 시 자동으로 _backup 보존 + 매일 09시 일일 스냅샷 (7일치)
      </div>`;
  }

  let _currentTab = 'usage';
  function _renderBody() {
    const html = `
      ${_renderScore()}
      <div class="ops-tabs">
        <button data-tab="usage" class="${_currentTab==='usage'?'active':''}" onclick="ops._tab('usage')">📊 사용 빈도</button>
        <button data-tab="activity" class="${_currentTab==='activity'?'active':''}" onclick="ops._tab('activity')">📅 일별 활동</button>
        <button data-tab="errors" class="${_currentTab==='errors'?'active':''}" onclick="ops._tab('errors')">❌ 에러 트렌드</button>
        <button data-tab="backup" class="${_currentTab==='backup'?'active':''}" onclick="ops._tab('backup')">💾 백업 상태</button>
      </div>
      <div class="ops-section" id="ops-section"></div>`;
    document.getElementById('ops-bd').innerHTML = html;
    _renderTab();
  }

  function _renderTab() {
    const sec = document.getElementById('ops-section');
    if (!sec) return;
    if (_currentTab === 'usage') sec.innerHTML = _renderUsage();
    if (_currentTab === 'activity') sec.innerHTML = _renderActivity();
    if (_currentTab === 'errors') sec.innerHTML = _renderErrors();
    if (_currentTab === 'backup') sec.innerHTML = _renderBackup();
  }

  function _tab(t) { _currentTab = t; _renderBody(); }

  function _updateFabState() {
    const fab = document.getElementById('erp-ops-fab');
    if (!fab) return;
    const s = score();
    if (s.total < 60) {
      fab.classList.add('bad');
      fab.title = `🎯 운영 대시보드 — Health Score ${s.total}/100 (개선 권장 ${s.issues.length}건)`;
    } else {
      fab.classList.remove('bad');
      fab.title = `🎯 운영 대시보드 — Health Score ${s.total}/100`;
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-ops-modal').classList.add('open');
    _renderBody();
  }
  function close() { document.getElementById('erp-ops-modal')?.classList.remove('open'); }

  window.ops = {
    score, open, close, _tab,
    usage: () => usage,
    activity: () => activity.slice(),
    daily: _renderActivity,
    refreshFab: _updateFabState
  };

  function boot() {
    _injectUI();
    setTimeout(() => { _hookFabClicks(); _hookApis(); _hookSavers(); }, 1200);
    setTimeout(_updateFabState, 3000);
    setInterval(_updateFabState, 30 * 60 * 1000);   // 30분마다
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-OPS] 운영 대시보드 활성 — 우측 하단 🎯 또는 ops.open()');
})();
