// =====================================================
//  SETUP HELPER — 권장 액션 1~4 자동화
//
//  1) erpSetup.generateGsToken()       — 무작위 SECRET_TOKEN 생성·자동 등록 + GS 붙여넣기 모달
//  2) erpSetup.selfTestNotify()        — 모든 알림 채널 1-Click 테스트 + 결과 모달
//  3) erpSetup.openGuide()             — 운영 가이드 화면 모달 (가독성 보정)
//  4) 매주 금요일 17:00 회귀 테스트 자동 실행 + 결과 audit + 실패 시 알림
//
//  콘솔: erpSetup.go()  — 4개 통합 마법사 (순차 진행)
// =====================================================
(function() {
  'use strict';

  // ─────────────────────────────────────────────────────
  //  공통 모달 헬퍼
  // ─────────────────────────────────────────────────────
  function _injectStyle() {
    if (document.getElementById('erp-setup-style')) return;
    const css = `
      .es-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);
        z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:5vh;}
      .es-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:780px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}
      .es-hd{padding:14px 18px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .es-hd h4{margin:0;font-size:1em;font-weight:700;}
      .es-bd{flex:1;overflow-y:auto;padding:18px;font-size:0.9em;line-height:1.6;color:#222;}
      .es-bd h1{font-size:1.4em;margin:1em 0 0.4em;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;}
      .es-bd h2{font-size:1.2em;margin:1em 0 0.4em;color:#1565c0;}
      .es-bd h3{font-size:1.05em;margin:0.8em 0 0.3em;color:#444;}
      .es-bd code{background:#f4f4f4;padding:1px 6px;border-radius:3px;font-size:0.9em;color:#c62828;}
      .es-bd pre{background:#272822;color:#f8f8f2;padding:12px 16px;border-radius:8px;overflow-x:auto;margin:8px 0;font-size:0.86em;line-height:1.5;}
      .es-bd pre code{background:transparent;color:inherit;padding:0;}
      .es-bd table{width:100%;border-collapse:collapse;margin:0.5em 0;}
      .es-bd table th{background:#1a1a2e;color:#fff;padding:6px 10px;text-align:left;font-size:0.86em;}
      .es-bd table td{border-bottom:1px solid #eee;padding:6px 10px;font-size:0.86em;}
      .es-bd ul,.es-bd ol{padding-left:1.5em;}
      .es-bd blockquote{border-left:3px solid #ccc;padding:4px 12px;color:#777;background:#fafafa;margin:6px 0;}
      .es-ft{padding:10px 18px;background:#fafafa;border-top:1px solid #eee;display:flex;gap:8px;justify-content:flex-end;}
      .es-copy{background:#1565c0;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:0.82em;cursor:pointer;}
      .es-copy:hover{background:#0d47a1;}
      .es-copy.ok{background:#27ae60;}
      .es-result{padding:10px 14px;border-radius:8px;margin-bottom:10px;}
      .es-result.ok{background:#e8f5e9;border-left:4px solid #2e7d32;}
      .es-result.warn{background:#fff3e0;border-left:4px solid #e65100;}
      .es-result.err{background:#ffebee;border-left:4px solid #c62828;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-setup-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function _modal(title, htmlBody, footerButtons) {
    _injectStyle();
    const old = document.getElementById('erp-setup-modal');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'erp-setup-modal';
    overlay.className = 'es-overlay';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    const ftHtml = (footerButtons || []).map((b, i) =>
      `<button class="btn btn-sm ${b.cls||'btn-dark'}" data-i="${i}">${b.label}</button>`
    ).join('');
    overlay.innerHTML = `
      <div class="es-box">
        <div class="es-hd">
          <h4>${title}</h4>
          <button onclick="this.closest('.es-overlay').remove()"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="es-bd">${htmlBody}</div>
        ${ftHtml ? `<div class="es-ft">${ftHtml}</div>` : ''}
      </div>`;
    document.body.appendChild(overlay);
    if (footerButtons && footerButtons.length) {
      overlay.querySelectorAll('.es-ft button').forEach(btn => {
        btn.onclick = () => {
          const i = parseInt(btn.dataset.i);
          const r = footerButtons[i].fn?.();
          if (footerButtons[i].close !== false) overlay.remove();
          return r;
        };
      });
    }
    return overlay;
  }

  function _copy(text, btn) {
    if (!navigator.clipboard) {
      // file:// 환경 fallback
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    } else {
      navigator.clipboard.writeText(text);
    }
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅ 복사됨';
      btn.classList.add('ok');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1500);
    }
  }
  window._esCopy = _copy;

  // ─────────────────────────────────────────────────────
  //  1) SECRET_TOKEN 생성 + 등록 + Apps Script 코드 모달
  // ─────────────────────────────────────────────────────
  function _randomToken() {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let t = 'erp-' + new Date().getFullYear() + '-';
    // crypto.getRandomValues가 있으면 사용 (보안)
    const len = 24;
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint8Array(len);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < len; i++) t += chars[arr[i] % chars.length];
    } else {
      for (let i = 0; i < len; i++) t += chars[Math.floor(Math.random() * chars.length)];
    }
    return t;
  }

  function generateGsToken(opts) {
    opts = opts || {};
    const token = _randomToken();

    // 1. 클라이언트 자동 등록
    let clientOk = false;
    if (typeof erpNotify !== 'undefined' && erpNotify.config) {
      try { erpNotify.config({ gsToken: token }); clientOk = true; }
      catch(e) {}
    }

    // 2. 모달로 Apps Script 붙여넣기 코드 표시
    const gsLine = `const SECRET_TOKEN = '${token}';`;
    const html = `
      <div class="es-result ok">
        <strong>✅ SECRET_TOKEN 생성 완료</strong>
        ${clientOk
          ? '<div style="font-size:0.86em;color:#2e7d32;margin-top:4px;">→ 클라이언트(<code>erpNotify.config.gsToken</code>)에 자동 등록됨</div>'
          : '<div style="font-size:0.86em;color:#e65100;margin-top:4px;">⚠️ 클라이언트 등록 실패 (notify 모듈 확인) — 직접 <code>erpNotify.config({gsToken:"..."})</code></div>'
        }
      </div>
      <h2>1단계: Apps Script에 토큰 등록</h2>
      <p>아래 코드 한 줄을 복사해서 Apps Script <code>코드.gs</code>의 <strong>SECRET_TOKEN 줄과 교체</strong>하세요.</p>
      <pre><code id="es-token-code">${gsLine}</code></pre>
      <button class="es-copy" onclick="_esCopy(document.getElementById('es-token-code').textContent, this)">📋 코드 복사</button>
      <h2>2단계: 배포 갱신</h2>
      <ol>
        <li>Apps Script 메뉴 → <strong>배포</strong> → <strong>배포 관리</strong></li>
        <li>현재 배포 옆 ✏️ 클릭</li>
        <li>버전: <strong>새 버전</strong> 선택 → 배포</li>
        <li>웹 앱 URL은 그대로 유지됨</li>
      </ol>
      <h2>3단계: 검증</h2>
      <pre><code>erpSetup.selfTestNotify()  // 메일 발송 테스트</code></pre>
      <p style="margin-top:14px;font-size:0.84em;color:#666;">
        💾 토큰은 안전한 위치에 백업해두세요 — 분실 시 재생성 후 GS·클라이언트 동시 갱신 필요.<br>
        🔒 이 토큰은 우리 회사 전용 — 절대 공개 저장소에 올리지 마세요.
      </p>`;
    _modal('🔒 1단계: SECRET_TOKEN 생성', html, [
      { label: '닫기', cls: 'btn-gray' }
    ]);
    return { token, clientRegistered: clientOk };
  }

  // ─────────────────────────────────────────────────────
  //  2) 알림 셀프 테스트 (3채널 일괄)
  // ─────────────────────────────────────────────────────
  async function selfTestNotify() {
    if (typeof erpNotify === 'undefined') {
      alert('notify 모듈 미로드 — 페이지 새로고침 후 재시도');
      return;
    }
    const cfg = erpNotify.config();
    const tasks = [];

    if (cfg.browser) tasks.push(['browser', '브라우저 푸시']);
    if (cfg.email)   tasks.push(['email',   'Gmail (Apps Script)']);
    if (cfg.kakaoToken) tasks.push(['kakao', '카카오톡 "나에게"']);

    if (!tasks.length) {
      _modal('🔔 2단계: 알림 셀프 테스트', `
        <div class="es-result warn">
          <strong>⚠️ 활성 채널 없음</strong>
          <div style="font-size:0.86em;margin-top:6px;">최소 1개 채널 활성화 필요. 콘솔에서 다음 중 하나 실행:</div>
        </div>
        <pre><code>erpNotify.config({ browser: true })
erpNotify.config({ email: 'me@company.com', gsToken: '토큰' })
erpNotify.config({ kakaoToken: '...' })</code></pre>
        <p>설정 후 다시 <code>erpSetup.selfTestNotify()</code> 실행</p>`,
        [{ label: '닫기', cls: 'btn-gray' }]
      );
      return;
    }

    // 진행 모달
    const progress = _modal('🔔 2단계: 알림 셀프 테스트', `
      <div class="es-result ok">테스트 중... (${tasks.length}개 채널)</div>
      <div id="es-test-result"></div>`,
      [{ label: '닫기', cls: 'btn-gray' }]
    );
    const resultEl = document.getElementById('es-test-result');

    const results = {};
    for (const [ch, label] of tasks) {
      resultEl.innerHTML += `<div class="es-result" id="es-r-${ch}">⏳ ${label} 발송 중...</div>`;
      try {
        const r = await erpNotify.test(ch, '셋업 헬퍼 셀프테스트 — ' + new Date().toLocaleTimeString('ko-KR'));
        results[ch] = r;
        const itemEl = document.getElementById('es-r-' + ch);
        if (r && r.ok) {
          itemEl.className = 'es-result ok';
          itemEl.innerHTML = `✅ <strong>${label}</strong> — 발송 성공`;
        } else if (r && r.skipped) {
          itemEl.className = 'es-result warn';
          itemEl.innerHTML = `⏭ <strong>${label}</strong> — 스킵 (${r.reason || '알 수 없음'})`;
        } else {
          itemEl.className = 'es-result err';
          itemEl.innerHTML = `❌ <strong>${label}</strong> — 실패: ${r?.error || '알 수 없음'}`;
        }
      } catch(e) {
        results[ch] = { error: e.message };
        const itemEl = document.getElementById('es-r-' + ch);
        itemEl.className = 'es-result err';
        itemEl.innerHTML = `❌ <strong>${label}</strong> — 예외: ${e.message}`;
      }
    }

    // 종합
    const ok = Object.values(results).filter(r => r && r.ok).length;
    const fail = Object.values(results).filter(r => r && r.error).length;
    const skip = Object.values(results).filter(r => r && r.skipped).length;
    resultEl.innerHTML += `<hr style="margin:14px 0;border:none;border-top:1px solid #eee;">
      <div class="es-result ${fail===0?'ok':'warn'}">
        <strong>📊 결과:</strong> ✅ ${ok}건 / ❌ ${fail}건 / ⏭ ${skip}건
      </div>`;
    return results;
  }

  // ─────────────────────────────────────────────────────
  //  3) 운영 가이드 모달 (마크다운 → HTML 간이 렌더)
  // ─────────────────────────────────────────────────────
  function _renderMd(md) {
    if (!md) return '<p>가이드 파일을 불러올 수 없습니다.</p>';
    let html = String(md);
    // 코드 블록 (fence)
    html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, (m, lang, code) =>
      '<pre><code>' + code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>'
    );
    // 헤더
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
    // 인용
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // 인라인 코드
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // 굵게
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 표
    html = html.replace(/((?:^\|.*\|\s*\n)+)/gm, table => {
      const rows = table.trim().split('\n');
      if (rows.length < 2) return table;
      const head = rows[0].split('|').slice(1, -1).map(c => `<th>${c.trim()}</th>`).join('');
      const body = rows.slice(2).map(r =>
        '<tr>' + r.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
      ).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    });
    // 리스트
    html = html.replace(/((?:^[-*] .+\n?)+)/gm, m => {
      const items = m.trim().split('\n').map(l => '<li>' + l.replace(/^[-*]\s+/,'') + '</li>').join('');
      return '<ul>' + items + '</ul>';
    });
    html = html.replace(/((?:^\d+\. .+\n?)+)/gm, m => {
      const items = m.trim().split('\n').map(l => '<li>' + l.replace(/^\d+\.\s+/,'') + '</li>').join('');
      return '<ol>' + items + '</ol>';
    });
    // 단락
    html = html.split(/\n\n+/).map(p => {
      if (/^<(h\d|ul|ol|pre|blockquote|table)/.test(p.trim())) return p;
      if (!p.trim()) return '';
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return html;
  }

  async function openGuide() {
    let md = '';
    try {
      const res = await fetch('영업관리_ERP_GUIDE.md');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      md = await res.text();
    } catch(e) {
      // file:// 환경 fetch 실패
      md = `# 가이드 파일을 fetch할 수 없습니다\n\n` +
           `브라우저 보안 정책(file://)으로 인해 .md 파일을 직접 읽을 수 없습니다.\n\n` +
           `## 해결책\n\n` +
           `**옵션 A**: 파일 직접 열기\n` +
           `\`영업관리_ERP_GUIDE.md\` 파일을 메모장/VSCode/Typora 등으로 직접 열기\n\n` +
           `**옵션 B**: 로컬 서버로 실행\n` +
           `\`\`\`\n` +
           `cd C:\\Users\\my\\Desktop\\HTML\n` +
           `python -m http.server 8080\n` +
           `\`\`\`\n` +
           `브라우저에서 http://localhost:8080/영업관리_ERP.html 열기\n\n` +
           `## 빠른 참조\n\n` +
           `### 5개 fab\n` +
           `- 🩺 시스템 상태 / 🔍 검색 (Ctrl+K) / 📦 ATP / 💰 채권 / 📱 모바일\n\n` +
           `### 핵심 명령\n` +
           `\`\`\`\n` +
           `erpSetup.go()                4단계 마법사\n` +
           `erpSetup.generateGsToken()   토큰 생성\n` +
           `erpSetup.selfTestNotify()    알림 테스트\n` +
           `erpSetup.runWeeklyTest()     회귀 테스트 즉시 실행\n` +
           `\`\`\``;
    }
    const html = _renderMd(md);
    _modal('📖 3단계: 운영 가이드', html, [
      { label: '닫기', cls: 'btn-gray' }
    ]);
  }

  // ─────────────────────────────────────────────────────
  //  4) 회귀 테스트 주간 자동 실행
  // ─────────────────────────────────────────────────────
  async function runWeeklyTest() {
    if (typeof window.runErpTests !== 'function') {
      console.warn('runErpTests 미정의');
      return null;
    }
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = window.runErpTests();
    } catch(e) {
      if (typeof logError === 'function') logError('weeklyTest', e);
      result = { error: e.message };
    }

    // 결과 저장 (audit 로그용)
    const summary = {
      when: startedAt,
      pass: result?.pass || 0,
      fail: result?.fail || 0,
      total: result?.total || 0,
      error: result?.error || null
    };
    const histKey = 'erp_weekly_tests';
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(histKey) || '[]'); } catch(e) {}
    hist.push(summary);
    if (hist.length > 26) hist = hist.slice(-26);   // 6개월
    try { localStorage.setItem(histKey, JSON.stringify(hist)); } catch(e) {}

    // 토스트
    if (typeof setBanner === 'function') {
      const failed = summary.fail > 0 || summary.error;
      setBanner(failed ? 'warn' : 'ok',
        `🧪 주간 회귀 테스트: ${summary.pass}/${summary.total} 통과` +
        (failed ? ` · 실패 ${summary.fail}건` : ''));
    }

    // 실패 시 — 메일 발송 시도
    if ((summary.fail > 0 || summary.error) &&
        typeof erpNotify !== 'undefined') {
      const cfg = erpNotify.config();
      if (cfg.email && cfg.gsToken && typeof gsUrl !== 'undefined' && gsUrl) {
        try {
          await fetch(gsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              action: 'sendEmail',
              token: cfg.gsToken,
              to: cfg.email,
              subject: `[ERP주간테스트] ❌ 실패 ${summary.fail}건 (${startedAt.slice(0,10)})`,
              body: `주간 회귀 테스트 결과:\n\n` +
                    `통과: ${summary.pass}/${summary.total}\n` +
                    `실패: ${summary.fail}건\n` +
                    (summary.error ? `에러: ${summary.error}\n` : '') +
                    `\n— 영업관리 ERP 자동 보고`
            }),
            redirect: 'follow'
          });
        } catch(e) {}
      }
    }
    return summary;
  }

  // 매주 금요일 17시 자동 실행 + 매월 1일 자동 백업 안내
  function _scheduleWeekly() {
    setInterval(() => {
      const now = new Date();
      // 금요일 17시 회귀 테스트
      if (now.getDay() === 5 && now.getHours() === 17) {
        const lastKey = 'erp_weekly_last_run';
        const today = now.toISOString().slice(0,10);
        if (localStorage.getItem(lastKey) !== today) {
          try { localStorage.setItem(lastKey, today); } catch(e) {}
          console.log('[ERP-SETUP] 주간 회귀 테스트 자동 실행');
          runWeeklyTest();
        }
      }
      // 매월 1일 09시 — 백업 알림 (자동 다운로드는 사용자 동의 없이 불가, 알림만)
      if (now.getDate() === 1 && now.getHours() === 9) {
        const lastKey = 'erp_monthly_backup_alert';
        const ym = now.toISOString().slice(0,7);
        if (localStorage.getItem(lastKey) !== ym) {
          try { localStorage.setItem(lastKey, ym); } catch(e) {}
          if (typeof setBanner === 'function')
            setBanner('warn', `📦 월간 백업 권장 — 콘솔에서 backup.exportAll() 실행 후 NAS/메일 보관`);
        }
      }
    }, 5 * 60 * 1000);
  }

  function weeklyTestHistory() {
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('erp_weekly_tests') || '[]'); } catch(e) {}
    if (!hist.length) {
      console.log('주간 테스트 이력 없음');
      return [];
    }
    console.table(hist.map(h => ({
      when: h.when.replace('T',' ').slice(0,16),
      pass: h.pass, fail: h.fail, total: h.total, error: h.error || ''
    })));
    return hist;
  }

  // ─────────────────────────────────────────────────────
  //  통합 마법사 erpSetup.go() — 4단계 순차 진행
  // ─────────────────────────────────────────────────────
  function _wizard() {
    const html = `
      <p style="font-size:0.96em;line-height:1.7;">
        4단계 셋업 마법사입니다. 순서대로 진행해주세요.<br>
        각 단계는 독립적으로 실행 가능 — 이미 완료된 단계는 건너뛰셔도 됩니다.
      </p>

      <h2>1️⃣ SECRET_TOKEN 생성</h2>
      <p>Gmail 알림·일일 리포트의 보안 토큰을 생성합니다.</p>
      <button class="btn btn-sm btn-blue" onclick="erpSetup.generateGsToken()">🔒 토큰 생성하기</button>

      <h2>2️⃣ 알림 셀프 테스트</h2>
      <p>설정된 모든 채널(브라우저·Gmail·카카오)에 테스트 메시지 발송.</p>
      <button class="btn btn-sm btn-blue" onclick="erpSetup.selfTestNotify()">🔔 테스트 발송</button>

      <h2>3️⃣ 운영 가이드 보기</h2>
      <p>12개 모듈 + 패치 A~L 통합 매뉴얼.</p>
      <button class="btn btn-sm btn-blue" onclick="erpSetup.openGuide()">📖 가이드 열기</button>

      <h2>4️⃣ 주간 회귀 테스트</h2>
      <p>매주 금요일 17:00 자동 실행 (이미 활성화됨). 즉시 실행도 가능.</p>
      <button class="btn btn-sm btn-blue" onclick="erpSetup.runWeeklyTest()">🧪 지금 실행</button>
      <button class="btn btn-sm btn-dark" onclick="erpSetup.weeklyTestHistory()">📊 이력 (콘솔)</button>

      <h2>5️⃣ 운영 안정화</h2>
      <p>시스템 건강 + 사용 통계 + 백업 + 피드백.</p>
      <button class="btn btn-sm btn-dark" onclick="ops && ops.open()">🎯 운영 대시보드</button>
      <button class="btn btn-sm btn-blue" onclick="backup && backup.open()">💾 백업/복구 도구</button>
      <button class="btn btn-sm btn-orange" onclick="erpFeedback && erpFeedback.open()">💬 피드백 보내기</button>

      <hr style="margin:18px 0;border:none;border-top:1px solid #eee;">
      <h3>📋 콘솔 명령 정리</h3>
      <pre><code>erpSetup.generateGsToken()    토큰 생성
erpSetup.selfTestNotify()     알림 테스트
erpSetup.openGuide()          가이드
erpSetup.runWeeklyTest()      회귀 테스트 즉시 실행
erpSetup.weeklyTestHistory()  주간 테스트 이력
ops.score()                   시스템 건강 점수
ops.open()                    운영 대시보드
backup.exportAll()            전체 백업 다운로드
backup.open()                 백업/복구 도구 패널
erpFeedback.send("내용")     피드백 발송</code></pre>`;
    _modal('🚀 ERP 셋업 마법사', html, [
      { label: '닫기', cls: 'btn-gray' }
    ]);
  }

  // ─────────────────────────────────────────────────────
  //  공개 API
  // ─────────────────────────────────────────────────────
  window.erpSetup = {
    go: _wizard,
    generateGsToken,
    selfTestNotify,
    openGuide,
    runWeeklyTest,
    weeklyTestHistory
  };

  function boot() {
    _scheduleWeekly();
    // 첫 부팅 시 한 번 안내 (이미 본 적 있으면 스킵)
    setTimeout(() => {
      if (localStorage.getItem('erp_setup_seen')) return;
      try { localStorage.setItem('erp_setup_seen', '1'); } catch(e) {}
      if (typeof setBanner === 'function')
        setBanner('info', '🚀 셋업 마법사: 콘솔에서 erpSetup.go() 실행');
    }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SETUP] 셋업 헬퍼 로드 — erpSetup.go() 또는 generateGsToken/selfTestNotify/openGuide/runWeeklyTest');
})();
