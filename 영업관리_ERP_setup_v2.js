// =====================================================
//  SETUP WIZARD V2 — 5-step 신규 사용자 가이드 (Sprint 6 · #2)
//
//  단계 (각 단계는 검증 통과해야 다음으로)
//   1) 회사 정보 (이름·로고·연락처)
//   2) Apps Script URL 등록 + ping 검증
//   3) SECRET_TOKEN 자동 생성 + Apps Script 코드 복사
//   4) Gmail 발송 권한 부여 + 테스트 메일
//   5) Gemini API 키 발급 가이드 + 검증
//
//  부팅 시 미완료 사용자 자동 표시 (1회)
//  공개 API: window.erpSetupV2
// =====================================================
(function() {
  'use strict';

  const STATE_KEY = 'erp_setup_v2_state';   // { currentStep, completed[], startedAt, completedAt }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }

  function _loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{"currentStep":1,"completed":[]}'); }
    catch (e) { return { currentStep: 1, completed: [] }; }
  }
  function _saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function _markCompleted(stepNum) {
    const s = _loadState();
    if (!s.completed.includes(stepNum)) s.completed.push(stepNum);
    s.currentStep = Math.max(s.currentStep, stepNum + 1);
    if (s.completed.length === 5) s.completedAt = new Date().toISOString();
    _saveState(s);
  }

  function isComplete() {
    return _loadState().completed.length === 5;
  }

  // safety.js 보호
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(STATE_KEY), 800);
  }

  // ── 5개 단계 정의 ────────────────────────────────
  const STEPS = [
    {
      num: 1,
      title: '회사 정보',
      icon: '🏢',
      desc: '회사명·로고·기본 정보를 입력합니다.',
      render: _renderStep1,
      validate: _validateStep1
    },
    {
      num: 2,
      title: 'Apps Script 연결',
      icon: '🔗',
      desc: 'Google Apps Script URL을 등록하고 연결을 확인합니다.',
      render: _renderStep2,
      validate: _validateStep2
    },
    {
      num: 3,
      title: '보안 토큰 생성',
      icon: '🔐',
      desc: '랜덤 SECRET_TOKEN을 생성하고 Apps Script에 붙여넣을 코드를 표시합니다.',
      render: _renderStep3,
      validate: _validateStep3
    },
    {
      num: 4,
      title: '이메일 발송 테스트',
      icon: '📧',
      desc: 'Gmail 권한을 부여하고 테스트 메일을 발송합니다.',
      render: _renderStep4,
      validate: _validateStep4
    },
    {
      num: 5,
      title: 'AI (선택)',
      icon: '🤖',
      desc: 'Gemini API 키를 등록해 AI 어시스턴트와 OCR을 활성화합니다. 건너뛸 수도 있습니다.',
      render: _renderStep5,
      validate: _validateStep5,
      optional: true
    }
  ];

  // ============================================================
  //  Step 1 — 회사 정보
  // ============================================================
  function _renderStep1() {
    const settings = (typeof appSettings !== 'undefined') ? appSettings : {};
    return `
      <div style="margin-bottom:14px;color:#666;line-height:1.6;">
        ERP 시스템에서 표시할 회사명·연락처를 등록합니다. 이 정보는 인쇄 양식·인수증·세금계산서 등에 사용됩니다.
      </div>
      <div class="sw-form">
        <label>회사명 *</label>
        <input id="sw-company" type="text" placeholder="(주)바로" value="${_e(settings.companyName||'')}">

        <label>회사 대표 전화 (선택)</label>
        <input id="sw-phone" type="text" placeholder="02-1234-5678" value="${_e(settings.companyPhone||'')}">

        <label>회사 주소 (선택)</label>
        <input id="sw-address" type="text" placeholder="서울특별시..." value="${_e(settings.companyAddress||'')}">

        <label>대표자 (선택)</label>
        <input id="sw-ceo" type="text" placeholder="홍길동" value="${_e(settings.ceoName||'')}">
      </div>
    `;
  }

  function _validateStep1() {
    const company = document.getElementById('sw-company').value.trim();
    if (!company) {
      return { ok: false, msg: '회사명은 필수입니다.' };
    }
    // appSettings 저장
    if (typeof appSettings === 'undefined') {
      window.appSettings = {};
    }
    appSettings.companyName = company;
    appSettings.companyPhone = document.getElementById('sw-phone').value.trim();
    appSettings.companyAddress = document.getElementById('sw-address').value.trim();
    appSettings.ceoName = document.getElementById('sw-ceo').value.trim();
    if (typeof saveSettings === 'function') saveSettings();
    else localStorage.setItem('erp_settings', JSON.stringify(appSettings));
    return { ok: true, msg: `✅ ${company} 정보 저장됨` };
  }

  // ============================================================
  //  Step 2 — Apps Script URL
  // ============================================================
  function _renderStep2() {
    const cur = (typeof gsUrl !== 'undefined') ? gsUrl : (localStorage.getItem('erp_gs_url')||'');
    return `
      <div style="margin-bottom:14px;color:#666;line-height:1.6;">
        Google Apps Script는 알림 발송·AI·시세 조회 등 백엔드 기능을 처리합니다.<br>
        <strong>Google Apps Script 사이트(<code>script.google.com</code>)에서 새 프로젝트를 만들고 배포하세요.</strong>
      </div>
      <div class="sw-info-box">
        <div class="sw-info-h">📝 Apps Script 만들기 (3분)</div>
        <ol style="margin:6px 0 0 18px;line-height:1.8;">
          <li><a href="https://script.google.com/home/projects/create" target="_blank">script.google.com</a>에서 [<strong>새 프로젝트</strong>]</li>
          <li>코드 영역에 다음 단계(③)에서 표시될 코드를 붙여넣기</li>
          <li>오른쪽 상단 [<strong>배포</strong>] → [<strong>새 배포</strong>]</li>
          <li>유형: <code>웹 앱</code> · 액세스: <code>모든 사용자</code> · 다음 사용자: <code>나</code></li>
          <li>[배포] → 권한 허용 → 발급된 <strong>웹 앱 URL</strong> 복사</li>
        </ol>
      </div>
      <div class="sw-form" style="margin-top:14px;">
        <label>Apps Script 웹앱 URL *</label>
        <input id="sw-gs-url" type="text" placeholder="https://script.google.com/macros/s/AKfycb.../exec" value="${_e(cur)}">
        <div style="font-size:0.78em;color:#888;margin-top:4px;">예시: https://script.google.com/macros/s/AKfycbx.../exec</div>
      </div>
      <div id="sw-step2-test" style="margin-top:12px;"></div>
    `;
  }

  async function _validateStep2() {
    const url = document.getElementById('sw-gs-url').value.trim();
    if (!url) return { ok: false, msg: 'URL을 입력하세요.' };
    if (!/^https:\/\/script\.google\.com\//.test(url)) {
      return { ok: false, msg: 'Apps Script URL 형식이 아닙니다. https://script.google.com/macros/... 형식이어야 합니다.' };
    }
    // 실제 ping은 CORS 때문에 단순 체크만 (보장은 step 3 이후 토큰 검증에서)
    if (typeof gsUrl !== 'undefined') {
      window.gsUrl = url;
    }
    try { localStorage.setItem('erp_gs_url', url); } catch (e) {}
    return { ok: true, msg: '✅ URL 형식 확인 — 다음 단계에서 토큰과 함께 실제 검증됩니다.' };
  }

  // ============================================================
  //  Step 3 — SECRET_TOKEN
  // ============================================================
  function _renderStep3() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    const token = cfg.gsToken || _genToken();
    const company = (typeof appSettings !== 'undefined' && appSettings.companyName) || '회사명';

    return `
      <div style="margin-bottom:14px;color:#666;line-height:1.6;">
        SECRET_TOKEN으로 Apps Script를 외부 침입자로부터 보호합니다.<br>
        토큰이 일치하지 않으면 Apps Script는 모든 요청을 거부합니다.
      </div>
      <div class="sw-form">
        <label>생성된 SECRET_TOKEN</label>
        <div style="display:flex;gap:6px;">
          <input id="sw-token" type="text" value="${_e(token)}" style="flex:1;font-family:monospace;font-size:0.86em;">
          <button class="sw-btn sw-btn-ghost" onclick="document.getElementById('sw-token').value = window.erpSetupV2._genToken();">🔄 재생성</button>
          <button class="sw-btn sw-btn-ghost" onclick="navigator.clipboard.writeText(document.getElementById('sw-token').value);this.textContent='✓복사됨';setTimeout(()=>this.textContent='📋 복사',1500);">📋 복사</button>
        </div>
      </div>
      <div class="sw-info-box" style="margin-top:14px;">
        <div class="sw-info-h">📝 Apps Script 코드에 붙여넣기</div>
        <div style="margin:6px 0;">아래 코드 전체를 복사해서 Apps Script 편집기에 붙여넣으세요. 토큰이 자동 포함됩니다.</div>
        <button class="sw-btn sw-btn-primary" onclick="window.erpSetupV2._copyAppsScriptCode(document.getElementById('sw-token').value);" style="margin-bottom:8px;">📋 Apps Script 코드 복사</button>
        <pre id="sw-gs-code" style="background:#272822;color:#a6e22e;padding:10px 12px;border-radius:6px;overflow-x:auto;font-size:0.78em;max-height:200px;line-height:1.5;">${_e(_appsScriptCode(token, company))}</pre>
      </div>
      <div class="sw-info-box" style="margin-top:14px;background:#fffde7;border-left-color:#f9a825;">
        <div class="sw-info-h">⚠️ 코드 붙여넣기 후</div>
        <ol style="margin:6px 0 0 18px;line-height:1.8;">
          <li>Apps Script 편집기에서 [<strong>저장</strong>] (Ctrl+S)</li>
          <li>[<strong>배포 관리</strong>] → 기존 배포의 [✏️ 수정] 클릭</li>
          <li>버전: [<strong>새 버전</strong>] 선택 → [<strong>배포</strong>]</li>
          <li>아래 [확인 및 다음 단계] 클릭</li>
        </ol>
      </div>
    `;
  }

  // 32자 랜덤 토큰
  function _genToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let t = '';
    for (let i = 0; i < 32; i++) t += chars[Math.floor(Math.random()*chars.length)];
    return t;
  }

  // Apps Script 코드 템플릿 — 토큰 자동 삽입
  function _appsScriptCode(token, company) {
    return `// =====================================================
// 영업관리 ERP — Apps Script 백엔드
// 생성: ${new Date().toISOString().slice(0,10)} · 회사: ${company}
// 절대로 SECRET_TOKEN 을 외부에 공개하지 마세요.
// =====================================================
const SECRET_TOKEN = '${token}';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== SECRET_TOKEN) {
      return _resp({ success: false, error: '토큰 불일치' });
    }
    if (data.action === 'sendEmail')   return _resp(_sendEmail(data));
    if (data.action === 'aiChat')      return _resp(_aiChat(data));
    if (data.action === 'getMarketRate') return _resp(_marketRate(data));
    return _resp({ success: false, error: '알 수 없는 action' });
  } catch (err) {
    return _resp({ success: false, error: err.toString() });
  }
}

function _sendEmail(data) {
  if (!data.to || !data.subject || !data.body) return { success: false, error: '필수 필드 누락' };
  GmailApp.sendEmail(data.to, data.subject, data.body, { name: '${company} ERP' });
  return { success: true };
}

function _aiChat(data) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY 미설정' };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  const parts = [{ text: data.text }];
  if (data.image) parts.push({ inlineData: { mimeType: data.mimeType, data: data.image } });
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ role: 'user', parts }] }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { success: true, text };
}

function _marketRate(data) {
  const url = 'https://api.exchangerate.host/latest?base=USD&symbols=KRW,CNY,EUR,JPY';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return { success: true, rates: JSON.parse(res.getContentText()).rates };
  } catch (e) { return { success: false, error: e.toString() }; }
}

function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
  }

  function _copyAppsScriptCode(token) {
    const company = (typeof appSettings !== 'undefined' && appSettings.companyName) || '회사명';
    const code = _appsScriptCode(token, company);
    navigator.clipboard.writeText(code).then(() => {
      if (typeof setBanner === 'function') setBanner('ok', '📋 Apps Script 코드가 클립보드에 복사되었습니다.');
    }).catch(() => alert('복사 실패. 코드 영역을 수동 복사하세요.'));
  }

  async function _validateStep3() {
    const token = document.getElementById('sw-token').value.trim();
    if (!token || token.length < 16) {
      return { ok: false, msg: '토큰이 너무 짧습니다. 재생성하세요.' };
    }
    // erp_notify_config에 저장
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    cfg.gsToken = token;
    try { localStorage.setItem('erp_notify_config', JSON.stringify(cfg)); }
    catch (e) { return { ok: false, msg: '저장 실패: ' + e.message }; }
    // 실제 ping 검증 — Apps Script 호출
    if (typeof gsUrl === 'undefined' || !gsUrl) {
      return { ok: true, msg: '⚠️ URL이 비어있어 ping 생략. 토큰만 저장됨.' };
    }
    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: '_ping', token })
      });
      const json = await res.json();
      // _ping은 미정의 action → "알 수 없는 action" 응답이 정상
      if (json.success === false && /알 수 없는 action/.test(json.error || '')) {
        return { ok: true, msg: '✅ Apps Script 연결 + 토큰 일치 확인됨!' };
      }
      if (/토큰 불일치/.test(json.error || '')) {
        return { ok: false, msg: '❌ 토큰 불일치 — Apps Script Code.gs 1행 SECRET_TOKEN을 확인하세요.' };
      }
      return { ok: true, msg: '✅ 응답 받음. 토큰 저장 완료.' };
    } catch (err) {
      return { ok: false, msg: `❌ Apps Script 연결 실패: ${err.message} — URL 또는 배포 상태를 확인하세요.` };
    }
  }

  // ============================================================
  //  Step 4 — 이메일 발송 테스트
  // ============================================================
  function _renderStep4() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    return `
      <div style="margin-bottom:14px;color:#666;line-height:1.6;">
        Apps Script가 회사 Gmail에서 메일을 발송할 수 있도록 권한을 부여하고 테스트 메일을 받습니다.
      </div>
      <div class="sw-form">
        <label>알림 받을 이메일 *</label>
        <input id="sw-email" type="email" placeholder="manager@company.com" value="${_e(cfg.email||'')}">
        <div style="font-size:0.78em;color:#888;margin-top:4px;">납기 임박·재고 부족·신용 위험 등 알림이 이 주소로 발송됩니다.</div>
      </div>
      <div style="margin-top:14px;">
        <button class="sw-btn sw-btn-primary" onclick="window.erpSetupV2._sendTestEmail();">📧 테스트 메일 발송</button>
        <span id="sw-email-result" style="margin-left:10px;font-size:0.86em;"></span>
      </div>
      <div class="sw-info-box" style="margin-top:14px;background:#fffde7;border-left-color:#f9a825;">
        💡 <strong>Tip</strong>: 처음 발송 시 Apps Script가 권한을 요청합니다.<br>
        <ol style="margin:6px 0 0 18px;line-height:1.8;">
          <li>Apps Script 편집기에서 [<strong>실행</strong>] → [<strong>_sendEmail</strong>] 함수 1회 실행</li>
          <li>구글 권한 동의 화면에서 [<strong>고급</strong>] → [<strong>안전하지 않음 (안전합니다)</strong>] → [<strong>허용</strong>]</li>
          <li>이후 자동 발송 가능</li>
        </ol>
      </div>
    `;
  }

  async function _sendTestEmail() {
    const email = document.getElementById('sw-email').value.trim();
    const resultEl = document.getElementById('sw-email-result');
    if (!email) { resultEl.innerHTML = '<span style="color:#c62828;">이메일 입력 필요</span>'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      resultEl.innerHTML = '<span style="color:#c62828;">이메일 형식 확인</span>'; return;
    }
    resultEl.innerHTML = '<span style="color:#666;">⏳ 발송 중...</span>';
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    if (!cfg.gsToken || typeof gsUrl === 'undefined' || !gsUrl) {
      resultEl.innerHTML = '<span style="color:#c62828;">❌ 이전 단계 미완료</span>'; return;
    }
    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendEmail', token: cfg.gsToken,
          to: email,
          subject: '[ERP 셋업] 테스트 메일 — 정상 작동 확인',
          body: `${(appSettings?.companyName || '회사')} ERP 시스템에서 발송한 테스트 메일입니다.\n\n이 메일을 받으셨다면 알림 설정이 완료된 것입니다.\n\n발송 시각: ${new Date().toLocaleString('ko-KR')}`
        })
      });
      const json = await res.json();
      if (json.success) {
        resultEl.innerHTML = '<span style="color:#27ae60;font-weight:700;">✅ 발송 성공! 메일함을 확인하세요.</span>';
        cfg.email = email;
        cfg.browser = true;
        try { localStorage.setItem('erp_notify_config', JSON.stringify(cfg)); } catch (e) {}
      } else {
        resultEl.innerHTML = `<span style="color:#c62828;">❌ ${_e(json.error||'알 수 없는 오류')}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#c62828;">❌ ${_e(err.message)}</span>`;
    }
  }

  function _validateStep4() {
    const email = document.getElementById('sw-email').value.trim();
    if (!email) return { ok: false, msg: '이메일을 입력하세요.' };
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    cfg.email = email;
    if (!cfg.browser) cfg.browser = true;
    try { localStorage.setItem('erp_notify_config', JSON.stringify(cfg)); }
    catch (e) { return { ok: false, msg: '저장 실패' }; }
    return { ok: true, msg: `✅ ${email} 등록 완료` };
  }

  // ============================================================
  //  Step 5 — Gemini API (선택)
  // ============================================================
  function _renderStep5() {
    return `
      <div style="margin-bottom:14px;color:#666;line-height:1.6;">
        Gemini API 키를 등록하면 AI 어시스턴트와 PDF/이미지 OCR 기능을 사용할 수 있습니다.<br>
        <strong>이 단계는 선택사항입니다.</strong> AI 기능이 필요 없으면 건너뛰셔도 됩니다.
      </div>
      <div class="sw-info-box">
        <div class="sw-info-h">🔑 Gemini API 키 발급 (무료, 2분)</div>
        <ol style="margin:6px 0 0 18px;line-height:1.8;">
          <li><a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com/app/apikey</a> 접속</li>
          <li>[<strong>Create API key</strong>] 클릭</li>
          <li>발급된 키 복사 (<code>AIzaSyXX...</code> 형식)</li>
          <li>Apps Script 편집기 → [<strong>프로젝트 설정</strong>] (왼쪽 ⚙️) → [<strong>스크립트 속성</strong>]</li>
          <li>[<strong>속성 추가</strong>] → 이름: <code>GEMINI_API_KEY</code> · 값: 발급받은 키 → [<strong>저장</strong>]</li>
        </ol>
      </div>
      <div style="margin-top:14px;">
        <button class="sw-btn sw-btn-primary" onclick="window.erpSetupV2._testAI();">🤖 AI 테스트</button>
        <span id="sw-ai-result" style="margin-left:10px;font-size:0.86em;"></span>
      </div>
      <div style="margin-top:14px;text-align:center;color:#888;font-size:0.86em;">
        AI를 사용하지 않으시면 [건너뛰고 완료] 버튼을 클릭하세요.
      </div>
    `;
  }

  async function _testAI() {
    const resultEl = document.getElementById('sw-ai-result');
    resultEl.innerHTML = '<span style="color:#666;">⏳ 테스트 중...</span>';
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    if (typeof gsUrl === 'undefined' || !gsUrl || !cfg.gsToken) {
      resultEl.innerHTML = '<span style="color:#c62828;">❌ 이전 단계 미완료</span>'; return;
    }
    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'aiChat', token: cfg.gsToken, text: '한 단어로 답: 안녕' })
      });
      const json = await res.json();
      if (json.success && json.text) {
        resultEl.innerHTML = `<span style="color:#27ae60;font-weight:700;">✅ AI 응답 수신: "${_e(json.text.slice(0,30))}"</span>`;
      } else {
        resultEl.innerHTML = `<span style="color:#c62828;">❌ ${_e(json.error||'응답 없음')}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#c62828;">❌ ${_e(err.message)}</span>`;
    }
  }

  function _validateStep5() {
    // 선택사항이므로 항상 통과 (테스트 결과 무관)
    return { ok: true, msg: '✅ 셋업 완료!' };
  }

  // ============================================================
  //  UI — 전체 wizard 모달
  // ============================================================
  function _injectUI() {
    if (document.getElementById('erp-sw-modal')) return;
    const css = `
      #erp-sw-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9700;display:none;align-items:center;justify-content:center;}
      #erp-sw-modal.open{display:flex;}
      .sw-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:96%;max-width:780px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .sw-hd{padding:14px 20px;background:linear-gradient(135deg,#1a1a2e,#3949ab);color:#fff;}
      .sw-hd-row{display:flex;justify-content:space-between;align-items:center;}
      .sw-hd h3{margin:0;font-size:1.1em;font-weight:800;}
      .sw-progress{margin-top:12px;display:flex;gap:6px;}
      .sw-step-pill{flex:1;height:6px;background:rgba(255,255,255,0.2);border-radius:3px;transition:background .25s;}
      .sw-step-pill.active{background:#fff;}
      .sw-step-pill.done{background:#27ae60;}
      .sw-step-info{margin-top:8px;font-size:0.86em;opacity:0.92;}
      .sw-bd{flex:1;overflow-y:auto;padding:20px 24px;}
      .sw-step-h{display:flex;gap:14px;align-items:center;margin-bottom:14px;}
      .sw-step-icon{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#3949ab,#5e35b1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.4em;flex-shrink:0;}
      .sw-step-title{font-size:1.2em;font-weight:800;color:#1a1a2e;}
      .sw-step-desc{font-size:0.86em;color:#666;margin-top:2px;}
      .sw-form label{display:block;font-size:0.84em;color:#444;font-weight:700;margin:8px 0 4px;}
      .sw-form input{width:100%;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:0.92em;box-sizing:border-box;}
      .sw-form input:focus{border-color:#3949ab;outline:none;}
      .sw-info-box{background:#e3f2fd;border-left:4px solid #1565c0;padding:12px 14px;border-radius:6px;font-size:0.86em;line-height:1.6;}
      .sw-info-h{font-weight:800;color:#1565c0;margin-bottom:4px;}
      .sw-result{padding:8px 12px;border-radius:6px;margin-top:10px;font-size:0.86em;}
      .sw-result.ok{background:#e8f5e9;color:#27ae60;border-left:4px solid #27ae60;}
      .sw-result.err{background:#ffebee;color:#c62828;border-left:4px solid #c62828;}
      .sw-ft{padding:14px 20px;background:#fafafa;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;}
      .sw-btn{padding:8px 18px;border:none;border-radius:7px;cursor:pointer;font-size:0.9em;font-weight:700;transition:all .15s;}
      .sw-btn-primary{background:#3949ab;color:#fff;}
      .sw-btn-primary:hover{background:#283593;}
      .sw-btn-success{background:#27ae60;color:#fff;}
      .sw-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
      .sw-btn-ghost:hover{background:#f5f5f5;}
      @media(max-width:700px){
        .sw-bd{padding:14px;}
        .sw-step-icon{width:36px;height:36px;font-size:1.1em;}
        .sw-step-title{font-size:1em;}
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-sw-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-sw-modal';
    modal.innerHTML = `
      <div class="sw-box">
        <div class="sw-hd">
          <div class="sw-hd-row">
            <h3>🚀 ERP 셋업 마법사 (5단계)</h3>
            <button class="sw-btn sw-btn-ghost" onclick="window.erpSetupV2.close()">✕</button>
          </div>
          <div class="sw-progress" id="sw-progress"></div>
          <div class="sw-step-info" id="sw-step-info"></div>
        </div>
        <div class="sw-bd" id="sw-bd"></div>
        <div class="sw-ft" id="sw-ft"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  let _curStep = 1;

  function _renderProgress() {
    const state = _loadState();
    const pills = STEPS.map(s => {
      const done = state.completed.includes(s.num);
      const active = s.num === _curStep;
      return `<div class="sw-step-pill ${done?'done':active?'active':''}" title="Step ${s.num}: ${s.title}"></div>`;
    }).join('');
    document.getElementById('sw-progress').innerHTML = pills;
    const cur = STEPS[_curStep - 1];
    document.getElementById('sw-step-info').textContent =
      `Step ${_curStep} / 5 · ${cur.title}${cur.optional?' (선택)':''}  —  ${state.completed.length}/5 완료`;
  }

  function _renderStep() {
    const cur = STEPS[_curStep - 1];
    const bd = document.getElementById('sw-bd');
    bd.innerHTML = `
      <div class="sw-step-h">
        <div class="sw-step-icon">${cur.icon}</div>
        <div>
          <div class="sw-step-title">${cur.title}${cur.optional?' <span style="font-size:0.78em;color:#888;font-weight:400;">(선택)</span>':''}</div>
          <div class="sw-step-desc">${cur.desc}</div>
        </div>
      </div>
      <div id="sw-step-body">${cur.render()}</div>
      <div id="sw-validate-result"></div>
    `;
    const ft = document.getElementById('sw-ft');
    const isLast = _curStep === STEPS.length;
    const prevBtn = _curStep > 1 ? `<button class="sw-btn sw-btn-ghost" onclick="window.erpSetupV2._prev()">← 이전</button>` : '<div></div>';
    const nextBtn = isLast
      ? `<button class="sw-btn sw-btn-success" onclick="window.erpSetupV2._next()">${cur.optional?'건너뛰고 ':''}🎉 완료</button>`
      : `<button class="sw-btn sw-btn-primary" onclick="window.erpSetupV2._next()">확인 및 다음 단계 →</button>`;
    ft.innerHTML = `${prevBtn}${nextBtn}`;
    _renderProgress();
  }

  async function _next() {
    const cur = STEPS[_curStep - 1];
    const result = await Promise.resolve(cur.validate());
    const resultEl = document.getElementById('sw-validate-result');
    if (!result.ok) {
      resultEl.innerHTML = `<div class="sw-result err">${_e(result.msg)}</div>`;
      return;
    }
    resultEl.innerHTML = `<div class="sw-result ok">${_e(result.msg)}</div>`;
    _markCompleted(_curStep);
    if (_curStep < STEPS.length) {
      setTimeout(() => { _curStep++; _renderStep(); }, 800);
    } else {
      // 완료
      setTimeout(() => {
        document.getElementById('sw-bd').innerHTML = `
          <div style="text-align:center;padding:30px 20px;">
            <div style="font-size:4em;margin-bottom:10px;">🎉</div>
            <h2 style="color:#27ae60;margin:0 0 10px;">셋업 완료!</h2>
            <p style="color:#666;line-height:1.6;">
              모든 단계가 완료되었습니다. ERP의 모든 기능을 사용할 수 있습니다.<br>
              나중에 설정을 변경하려면 콘솔에서 <code>erpSetupV2.open()</code>을 입력하세요.
            </p>
            <button class="sw-btn sw-btn-primary" onclick="window.erpSetupV2.close()" style="margin-top:14px;">시작하기</button>
          </div>`;
        document.getElementById('sw-ft').innerHTML = '';
        _renderProgress();
      }, 600);
    }
  }

  function _prev() {
    if (_curStep > 1) { _curStep--; _renderStep(); }
  }

  function open() {
    _injectUI();
    const state = _loadState();
    _curStep = state.completedAt ? 1 : (state.currentStep || 1);
    if (_curStep > STEPS.length) _curStep = STEPS.length;
    document.getElementById('erp-sw-modal').classList.add('open');
    setTimeout(_renderStep, 30);
  }
  function close() {
    document.getElementById('erp-sw-modal')?.classList.remove('open');
  }

  // ── 공개 API ────────────────────────────────────
  window.erpSetupV2 = {
    open, close,
    _next, _prev, _genToken, _copyAppsScriptCode, _sendTestEmail, _testAI,
    isComplete,
    state: _loadState,
    reset: () => { _saveState({ currentStep: 1, completed: [] }); }
  };

  // ── 부팅 — 미완료 시 1회 자동 표시 ───────────────
  function boot() {
    setTimeout(_injectUI, 800);
    setTimeout(() => {
      const state = _loadState();
      // 처음 사용자만 자동 표시 (auto-shown 플래그 사용)
      if (!isComplete() && !localStorage.getItem('erp_setup_v2_shown')) {
        try { localStorage.setItem('erp_setup_v2_shown', '1'); } catch (e) {}
        // 1.5초 후 자동 표시 (다른 모듈 로드 대기)
        setTimeout(() => {
          if (typeof setBanner === 'function') {
            setBanner('info', '🚀 처음이세요? 5분 셋업 마법사를 시작하려면 erpSetupV2.open()');
          }
        }, 3000);
      }
    }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SETUP-V2] 셋업 마법사 v2 활성 — erpSetupV2.open() ' + (isComplete() ? '(완료됨)' : '(미완료)'));
})();
