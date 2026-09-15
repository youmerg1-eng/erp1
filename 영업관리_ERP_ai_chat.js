// =====================================================
//  AI CHAT + OCR — Phase F · Day 1~3
//  Gemini API 무료 티어 (1.5 Flash) — Apps Script 경유
//
//  사전 준비
//   1) Google AI Studio에서 무료 API key 발급 (https://aistudio.google.com)
//   2) Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성 → GEMINI_API_KEY 등록
//   3) apps_script_template.gs 의 aiChat action 사용 (이번 패치에 추가)
//
//  기능
//   - 자연어 질의 응답 (ERP 데이터 컨텍스트 자동 첨부)
//   - PDF/이미지 OCR (Gemini Vision)
//   - 빠른 질문 칩 (5건)
//   - 세션 + 메시지 이력
//
//  콘솔: ai.ask("이번달 채권") / ai.ocr(file) / ai.open()
// =====================================================
(function() {
  'use strict';

  const HISTORY_KEY = 'erp_ai_history';
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(e) { history = []; }

  const QUICK_QUESTIONS = [
    { icon:'🔍', text:'거래처 환화 검색', q:'고객사 중에 "환화"로 시작하는 거래처를 모두 알려줘' },
    { icon:'📋', text:'최근 PO 5건', q:'최근 등록된 수주 5건을 표로 보여줘 (PJ NO, 고객사, 모델, 수량, 수주일)' },
    { icon:'💰', text:'이번달 채권', q:'이번달 미수금 합계와 30일 초과 비율을 알려줘' },
    { icon:'📦', text:'재고 부족 모델', q:'ATP 가용재고가 0 이하인 모델을 알려줘' },
    { icon:'📑', text:'면장 PDF OCR', q:'__OCR__' },
  ];

  // ── ERP 컨텍스트 추출 (질문에 자동 첨부) ────────────
  //   ★ 2026-05 보강: 권한 기반 PII redact + 동의 확인 + finance/매입 마스킹.
  //   - viewer/exec 등 hideFinance 권한 → 수주총액·매입가·이익 마스킹
  //   - hideVendor 권한 → 매입사 정보 컨텍스트에서 제외
  //   - 채권/aging 정보는 finance 데이터이므로 hideFinance면 차단
  function _buildContext(question) {
    const ctx = {};
    // 사용자 권한 확인 — erpAuth 가용 시 effective 권한 적용
    const perms = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole())
      : { hideFinance: false, hideVendor: false };
    const hideFinance = !!perms.hideFinance;
    const hideVendor  = !!perms.hideVendor;
    const _redact = v => hideFinance ? '***' : v;

    if (typeof getEnriched === 'function') {
      try {
        const orders = getEnriched();
        ctx.orderCount = orders.length;
        ctx.recentOrders = orders.slice(-10).map(o => ({
          PJ_NO: o.pjNo, 고객사: o.고객사, 모델: o.모델명,
          수량: o.수량, 수주일: o.수주일, 출고요청일: o.출고요청일,
          수주총액: _redact(o.수주총액),         // ★ finance redact
          상태: o.status
        }));
        // 채권/미수 — finance 정보이므로 hideFinance 시 마스킹된 요약만
        if (/채권|미수|aging|회수/i.test(question) && typeof aging !== 'undefined') {
          if (hideFinance) {
            ctx.aging = { redacted: true, message: '권한상 채권 상세 미공개' };
          } else {
            ctx.aging = aging.summary();
          }
        }
        // 재고/ATP — 비-finance 데이터 (수량 정보)
        if (/재고|ATP|가용/i.test(question) && typeof atp !== 'undefined') {
          ctx.atp = atp.all().slice(0, 20);
        }
        // 매입 정보 — vendor 마스킹 + finance 마스킹
        if (/매입|구매|단가/i.test(question) && typeof purchase !== 'undefined') {
          if (hideVendor || hideFinance) {
            ctx.purchase = { redacted: true, message: '권한상 매입 정보 미공개' };
          } else {
            ctx.purchase = purchase.summary();
          }
        }
        // 입고예정 — 운영 정보
        if (/입고|ETA|선적/i.test(question) && typeof incoming !== 'undefined') {
          ctx.incoming = incoming.summary();
        }
        // 고객사 마스터
        if (/고객|거래처|신용/i.test(question) && typeof customerMaster !== 'undefined') {
          ctx.customers = Object.keys(customerMaster.raw()).slice(0, 30);
        }
        // 권한 정보 표기 (AI가 답변 톤 조절)
        ctx._permissions = { hideFinance, hideVendor };
      } catch(e) { console.warn('[ai-chat] context build error', e); }
    }
    return ctx;
  }

  // ── 첫 사용 시 동의 확인 (1회) ─────────────────────
  //   사용자 데이터를 외부 API(Apps Script → Gemini)로 전송하기 전 명시적 동의.
  //   동의 결과는 localStorage[erp_ai_consent] 에 저장 — 재방문 시 반복 안 함.
  const CONSENT_KEY = 'erp_ai_consent';
  function _hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === 'granted'; } catch (e) { return false; }
  }
  function _grantConsent() {
    try { localStorage.setItem(CONSENT_KEY, 'granted'); } catch (e) {}
  }
  function _revokeConsent() {
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
  }
  // 동의 모달 — Promise 로 반환 (수락 시 resolve(true), 거부 시 resolve(false))
  function _showConsentDialog() {
    return new Promise(resolve => {
      const ex = document.getElementById('ai-consent-modal');
      if (ex) ex.remove();
      const m = document.createElement('div');
      m.id = 'ai-consent-modal';
      m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;';
      m.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:540px;width:90%;padding:24px;box-shadow:0 16px 60px rgba(0,0,0,0.35);">
          <h3 style="margin:0 0 12px;color:#1a1a2e;font-size:1.05em;">🔐 AI 어시스턴트 사용 동의</h3>
          <div style="font-size:0.88em;color:#444;line-height:1.6;margin-bottom:14px;">
            AI 어시스턴트는 질문에 답하기 위해 다음 ERP 데이터를 외부 API(Apps Script → Google Gemini)로 전송합니다:
            <ul style="margin:8px 0;padding-left:20px;color:#666;">
              <li>최근 수주 10건 (PJ NO·고객사·모델·수량·수주일·금액)</li>
              <li>질문 키워드 매칭 시 채권·재고·매입·입고예정 요약</li>
              <li>고객사명 일부 (마스터에서 최대 30개)</li>
            </ul>
            <strong style="color:#c62828;">전송된 데이터는 Google 서버에서 일시 처리되며 응답 후 저장되지 않습니다.</strong>
            권한 등급에 따라 금액·매입사 정보는 자동 마스킹됩니다.
          </div>
          <div style="background:#fff8e1;border-left:4px solid #f9a825;padding:8px 10px;border-radius:6px;font-size:0.82em;color:#666;margin-bottom:14px;">
            💡 동의 철회는 콘솔에서 <code>localStorage.removeItem('erp_ai_consent')</code>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button id="ai-consent-deny" style="padding:9px 16px;border:1.5px solid #ccc;background:#fff;color:#666;border-radius:7px;cursor:pointer;font-size:0.88em;">거부</button>
            <button id="ai-consent-allow" style="padding:9px 18px;border:none;background:#1a1a2e;color:#fff;border-radius:7px;cursor:pointer;font-size:0.88em;font-weight:700;">동의하고 계속</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.querySelector('#ai-consent-allow').onclick = () => {
        _grantConsent();
        m.remove();
        resolve(true);
      };
      m.querySelector('#ai-consent-deny').onclick = () => {
        m.remove();
        resolve(false);
      };
    });
  }

  function _systemPrompt() {
    return `당신은 한국 태양광 모듈 물류·영업 ERP의 AI 어시스턴트입니다.
- 응답은 한국어로 간결하게.
- 데이터가 있으면 표 형태로 정리. 마크다운 사용.
- 모델/Wp/매수/kW/MW 단위에 익숙해야 함.
- 채권·미수금은 30/60/90/120일 4단계로 분류.
- 추측하지 말고 제공된 데이터만 사용.`;
  }

  // ── API 호출 ────────────────────────────────────────
  async function ask(question, opts) {
    opts = opts || {};
    // ★ 첫 사용 시 동의 확인 — 거부 시 즉시 throw
    if (!_hasConsent()) {
      const granted = await _showConsentDialog();
      if (!granted) throw new Error('AI 어시스턴트 사용 거부됨 (개인정보 전송 동의 필요)');
    }
    const cfg = (function(){
      try { return JSON.parse(localStorage.getItem('erp_notify_config')||'{}'); }
      catch(e) { return {}; }
    })();
    if (typeof gsUrl === 'undefined' || !gsUrl) {
      throw new Error('Apps Script URL 미설정 (설정 탭에서 등록)');
    }
    if (!cfg.gsToken) throw new Error('gsToken 미설정 — erpNotify.config({gsToken:"..."})');

    const ctx = _buildContext(question);
    const ctxStr = Object.keys(ctx).length ? '\n\n[ERP 데이터]\n' + JSON.stringify(ctx, null, 2).slice(0, 8000) : '';
    const fullPrompt = _systemPrompt() + '\n\n[질문]\n' + question + ctxStr;

    const res = await fetch(gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'aiChat',
        token: cfg.gsToken,
        text: fullPrompt,
        image: opts.imageBase64 || null,
        mimeType: opts.imageMime || null
      }),
      redirect: 'follow'
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'AI 응답 실패');
    return json.text || '';
  }

  async function ocr(file) {
    if (!file) throw new Error('파일 필요');
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(String(e.target.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    return ask('이 이미지/PDF의 텍스트를 그대로 추출해서 정리해주세요. 표가 있으면 마크다운 표로 변환.', {
      imageBase64: base64,
      imageMime: file.type
    });
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-ai-fab')) return;
    const css = `
      #erp-ai-fab{position:fixed;bottom:18px;right:506px;width:44px;height:44px;border-radius:50%;
        background:linear-gradient(135deg,#673ab7,#9c27b0);color:#fff;border:none;cursor:pointer;
        font-size:18px;z-index:9000;box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s;}
      #erp-ai-fab:hover{transform:scale(1.07);}
      #erp-ai-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:4vh;}
      #erp-ai-modal.open{display:flex;}
      .ai-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:92%;max-width:880px;height:88vh;display:flex;flex-direction:column;overflow:hidden;}
      .ai-hd{padding:14px 18px;background:linear-gradient(135deg,#673ab7,#9c27b0);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .ai-quick{padding:10px 18px;border-bottom:1px solid #eee;display:flex;gap:6px;flex-wrap:wrap;background:#fafafa;}
      .ai-chip{padding:6px 12px;background:#fff;border:1px solid #ddd;border-radius:18px;cursor:pointer;font-size:0.82em;color:#444;transition:all .15s;}
      .ai-chip:hover{background:#f3e5f5;border-color:#9c27b0;color:#7b1fa2;}
      .ai-bd{flex:1;overflow-y:auto;padding:14px 18px;font-size:0.88em;line-height:1.7;}
      .ai-msg{margin-bottom:14px;}
      .ai-msg.user{text-align:right;}
      .ai-msg.user .ai-bubble{background:#1565c0;color:#fff;display:inline-block;padding:8px 14px;border-radius:14px 14px 2px 14px;max-width:80%;text-align:left;}
      .ai-msg.bot .ai-bubble{background:#f3e5f5;color:#333;display:inline-block;padding:10px 16px;border-radius:14px 14px 14px 2px;max-width:90%;}
      .ai-msg.bot.thinking .ai-bubble{font-style:italic;color:#9c27b0;}
      .ai-msg.bot .ai-bubble pre{background:#fff;padding:8px;border-radius:6px;overflow-x:auto;font-size:0.86em;}
      .ai-msg.bot .ai-bubble table{border-collapse:collapse;margin:8px 0;font-size:0.86em;}
      .ai-msg.bot .ai-bubble table th{background:#1a1a2e;color:#fff;padding:4px 8px;}
      .ai-msg.bot .ai-bubble table td{border:1px solid #ddd;padding:4px 8px;}
      .ai-msg.bot .ai-bubble code{background:#fff;padding:1px 6px;border-radius:3px;font-size:0.9em;color:#c62828;}
      .ai-input{padding:10px 14px;border-top:1px solid #eee;display:flex;gap:6px;background:#fff;}
      .ai-input textarea{flex:1;padding:10px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.92em;resize:none;font-family:inherit;}
      .ai-input button{padding:10px 16px;background:#673ab7;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;}
      .ai-input button:disabled{background:#ccc;cursor:not-allowed;}
      .ai-input label{padding:10px;background:#f5f5f5;border-radius:10px;cursor:pointer;font-size:1.2em;}
      .ai-empty{text-align:center;color:#bbb;padding:40px 20px;}
      .ai-empty h3{color:#9c27b0;margin:0 0 10px;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-ai-style'; style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-ai-fab'; fab.title = 'AI 어시스턴트 (Gemini)'; fab.textContent = '🤖';
    fab.onclick = open; document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-ai-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="ai-box">
        <div class="ai-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🤖 AI 업무 도우미 — Gemini 1.5 Flash</h4>
          <button onclick="document.getElementById('erp-ai-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="ai-quick">
          ${QUICK_QUESTIONS.map((q,i) => `<button class="ai-chip" onclick="ai._quickAsk(${i})">${q.icon} ${q.text}</button>`).join('')}
        </div>
        <div class="ai-bd" id="ai-bd"></div>
        <div class="ai-input">
          <textarea id="ai-input" rows="1" placeholder="질문을 입력하세요... (Enter 전송 / Shift+Enter 줄바꿈)"></textarea>
          <label title="PDF/이미지 OCR">📎<input type="file" id="ai-file" accept="image/*,.pdf" style="display:none;" onchange="ai._fileSelected(this.files[0])"></label>
          <button id="ai-send-btn" onclick="ai._send()">전송</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const inp = document.getElementById('ai-input');
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _send();
      }
      // 자동 높이
      inp.style.height = 'auto';
      inp.style.height = Math.min(120, inp.scrollHeight) + 'px';
    });
  }

  function _renderHistory() {
    const bd = document.getElementById('ai-bd');
    if (!bd) return;
    if (!history.length) {
      bd.innerHTML = `<div class="ai-empty">
        <h3>🤖 무엇을 도와드릴까요?</h3>
        <p>위 빠른 질문 칩을 클릭하거나 직접 입력하세요.</p>
        <p style="font-size:0.84em;margin-top:14px;color:#999;">📎 PDF/이미지 첨부 시 OCR 자동 인식</p>
      </div>`;
      return;
    }
    bd.innerHTML = history.slice(-30).map(m => {
      const cls = m.role === 'user' ? 'user' : 'bot';
      return `<div class="ai-msg ${cls}"><div class="ai-bubble">${m.html || _renderMd(m.text)}</div></div>`;
    }).join('');
    bd.scrollTop = bd.scrollHeight;
  }

  // ★ XSS 차단 — 본문을 먼저 통째로 escape 한 뒤 마크다운 패턴 적용.
  //   AI 응답이나 사용자 입력에 <script>, onerror= 등이 섞여도 안전.
  //   허용되는 마크업: <pre><code>, <h3>, <h4>, <code>, <strong>, <table>, <ul>, <li>, <br>
  function _renderMd(text) {
    if (!text) return '';
    const escAll = s => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    // 1) 전체 escape
    let h = escAll(text);
    // 2) 코드블록 — escape 된 ``` 그대로 매칭됨 (특수문자 모두 escape 됐으므로 안전)
    h = h.replace(/```([a-z]*)\n([\s\S]*?)```/g, (m,l,c) => `<pre><code>${c}</code></pre>`);
    // 3) 헤딩
    h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^# (.+)$/gm, '<h3>$1</h3>');
    // 4) 인라인 코드/강조
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 5) 표
    h = h.replace(/((?:^\|.*\|\s*\n)+)/gm, table => {
      const rows = table.trim().split('\n');
      if (rows.length < 2) return table;
      const head = rows[0].split('|').slice(1,-1).map(c => `<th>${c.trim()}</th>`).join('');
      const body = rows.slice(2).map(r => '<tr>' + r.split('|').slice(1,-1).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>').join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    });
    // 6) 리스트
    h = h.replace(/((?:^[-*] .+\n?)+)/gm, m => '<ul>' + m.trim().split('\n').map(l => '<li>' + l.replace(/^[-*]\s+/,'') + '</li>').join('') + '</ul>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  function _saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100))); } catch(e) {}
  }

  function _quickAsk(i) {
    const q = QUICK_QUESTIONS[i];
    if (q.q === '__OCR__') {
      document.getElementById('ai-file').click();
      return;
    }
    document.getElementById('ai-input').value = q.q;
    _send();
  }

  function _fileSelected(file) {
    if (!file) return;
    history.push({ role: 'user', text: `📎 ${file.name} (OCR 요청)` });
    history.push({ role: 'bot', text: '⏳ OCR 처리 중...', html: '⏳ OCR 처리 중...' });
    _renderHistory();
    document.getElementById('ai-send-btn').disabled = true;
    ocr(file).then(text => {
      history.pop();   // thinking 제거
      history.push({ role: 'bot', text });
      _saveHistory(); _renderHistory();
    }).catch(e => {
      history.pop();
      history.push({ role: 'bot', text: '❌ OCR 실패: ' + e.message });
      _saveHistory(); _renderHistory();
    }).finally(() => {
      document.getElementById('ai-send-btn').disabled = false;
    });
  }

  async function _send() {
    const inp = document.getElementById('ai-input');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    inp.style.height = 'auto';
    history.push({ role: 'user', text: q });
    history.push({ role: 'bot', text: '⏳ 생각 중...', html: '⏳ 생각 중...' });
    _renderHistory();
    document.getElementById('ai-send-btn').disabled = true;
    try {
      const ans = await ask(q);
      history.pop();
      history.push({ role: 'bot', text: ans });
    } catch(e) {
      history.pop();
      history.push({ role: 'bot', text: '❌ ' + e.message });
    }
    _saveHistory();
    _renderHistory();
    document.getElementById('ai-send-btn').disabled = false;
  }

  function clearHistory() {
    if (!confirm('대화 이력 ' + history.length + '건을 모두 삭제합니까?')) return;
    history = [];
    _saveHistory(); _renderHistory();
  }

  function open() {
    _injectUI();
    document.getElementById('erp-ai-modal').classList.add('open');
    _renderHistory();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 30);
  }
  function close() { document.getElementById('erp-ai-modal')?.classList.remove('open'); }

  window.ai = {
    ask, ocr, open, close,
    history: () => history.slice(),
    clearHistory,
    // 동의 관리 (사용자가 직접 철회/재동의 가능)
    hasConsent: _hasConsent,
    revokeConsent: _revokeConsent,
    _send, _quickAsk, _fileSelected
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-AI] AI 챗봇 + OCR 활성 — 우측 하단 🤖 또는 ai.open()');
})();
