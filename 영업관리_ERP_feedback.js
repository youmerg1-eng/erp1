// =====================================================
//  FEEDBACK — 운영 안정화
//  화면에서 한 번에 피드백 보내기
//   - 텍스트 + 카테고리 (버그/제안/질문)
//   - 자동 첨부: 현재 URL, 화면 크기, 누적 에러 5건, Health Score, 활성 역할
//   - Apps Script 경유 → 운영자 이메일 발송
//
//  데이터 키: erp_feedback_log (보낸 이력)
//  콘솔: erpFeedback.send("내용") / erpFeedback.history()
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_feedback_log';
  let log = [];
  try { log = JSON.parse(localStorage.getItem(KEY)||'[]'); } catch(e) { log = []; }

  function _autoContext() {
    const ctx = {
      url: location.href,
      ua: navigator.userAgent.slice(0, 120),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      role: typeof erpAuth !== 'undefined' ? erpAuth.getRole() : '-',
      device: typeof _deviceId === 'function' ? _deviceId() : (localStorage.getItem('erp_device_id') || '-'),
      when: new Date().toISOString()
    };
    // Health Score
    if (typeof ops !== 'undefined' && ops.score) {
      try {
        const s = ops.score();
        ctx.healthScore = s.total;
        ctx.healthIssues = s.issues.length;
      } catch(e) {}
    }
    // 누적 에러 5건
    try {
      const errs = JSON.parse(localStorage.getItem('erp_errors')||'[]');
      ctx.recentErrors = errs.slice(-5).map(e => ({ when: e.when, label: e.label, msg: (e.message||'').slice(0,60) }));
    } catch(e) {}
    // 데이터 카운트
    if (typeof rawData !== 'undefined') ctx.orderCount = rawData.length;
    if (typeof deliveryOrders !== 'undefined') ctx.doCount = deliveryOrders.length;
    if (typeof inventoryData !== 'undefined') ctx.invCount = inventoryData.length;
    return ctx;
  }

  async function send(text, category) {
    const cfg = (function(){
      try { return JSON.parse(localStorage.getItem('erp_notify_config')||'{}'); }
      catch(e) { return {}; }
    })();
    if (!cfg.email) throw new Error('수신 이메일 미설정 (erpNotify.config({email:"...", gsToken:"..."}))');
    if (!cfg.gsToken) throw new Error('gsToken 미설정');
    if (typeof gsUrl === 'undefined' || !gsUrl) throw new Error('Apps Script URL 미설정');

    const ctx = _autoContext();
    const entry = {
      id: 'FB-' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
      when: ctx.when,
      category: category || 'feedback',
      text,
      ctx,
      sent: false
    };

    const body = `[ERP 피드백] ${category || '의견'}

${text}

──── 자동 수집 컨텍스트 ────
역할: ${ctx.role}
디바이스: ${ctx.device}
화면: ${ctx.viewport}
URL: ${ctx.url}
Health Score: ${ctx.healthScore || '-'}/100 (개선 ${ctx.healthIssues || 0}건)
데이터: 수주 ${ctx.orderCount||0}건, 출고지시서 ${ctx.doCount||0}건, 입출고 ${ctx.invCount||0}건
브라우저: ${ctx.ua}
시각: ${ctx.when}

[최근 에러 ${(ctx.recentErrors||[]).length}건]
${(ctx.recentErrors||[]).map(e => `  • ${e.when.slice(0,19)} ${e.label}: ${e.msg}`).join('\n') || '  (없음)'}
`;

    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendEmail',
          token: cfg.gsToken,
          to: cfg.email,
          subject: `[ERP 피드백] ${category || ''} ${text.slice(0, 30)}`,
          body
        }),
        redirect: 'follow'
      });
      const json = await res.json();
      if (json.success) {
        entry.sent = true;
        if (typeof setBanner === 'function') setBanner('ok', '✅ 피드백 발송 완료');
      } else {
        throw new Error(json.error || 'send failed');
      }
    } catch(e) {
      entry.sentError = e.message;
      if (typeof setBanner === 'function') setBanner('warn', '⚠️ 피드백 저장됨 (메일 미발송: ' + e.message + ')');
    }

    log.push(entry);
    try { localStorage.setItem(KEY, JSON.stringify(log.slice(-100))); } catch(e) {}
    return entry;
  }

  function history(n) {
    const slice = log.slice(-(n||20)).reverse();
    console.table(slice.map(e => ({
      when: e.when.replace('T',' ').slice(0,16),
      cat: e.category,
      text: e.text.slice(0,50),
      sent: e.sent ? '✅' : '⏸'
    })));
    return slice;
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-fb-fab')) return;
    const css = `
      #erp-fb-fab{position:fixed;bottom:18px;right:668px;width:44px;height:44px;border-radius:50%;
        background:#ff9800;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;}
      #erp-fb-fab:hover{background:#f57c00;transform:scale(1.07);}
      #erp-fb-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9700;display:none;align-items:flex-start;justify-content:center;padding-top:10vh;}
      #erp-fb-modal.open{display:flex;}
      .fb-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:540px;display:flex;flex-direction:column;overflow:hidden;}
      .fb-hd{padding:14px 18px;background:#ff9800;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .fb-bd{padding:18px;}
      .fb-cat{display:flex;gap:6px;margin-bottom:14px;}
      .fb-cat button{flex:1;padding:8px;border:1.5px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:0.86em;font-weight:700;}
      .fb-cat button.active{background:#ff9800;color:#fff;border-color:#ff9800;}
      .fb-textarea{width:100%;min-height:120px;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:0.95em;font-family:inherit;box-sizing:border-box;resize:vertical;}
      .fb-info{font-size:0.78em;color:#888;margin-top:6px;line-height:1.6;}
      .fb-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-fb-style'; style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-fb-fab'; fab.title = '피드백 보내기'; fab.textContent = '💬';
    fab.onclick = open; document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-fb-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="fb-box">
        <div class="fb-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">💬 빠른 피드백</h4>
          <button onclick="document.getElementById('erp-fb-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="fb-bd">
          <div class="fb-cat">
            <button data-cat="버그" onclick="erpFeedback._cat('버그')">🐛 버그</button>
            <button data-cat="제안" class="active" onclick="erpFeedback._cat('제안')">💡 제안</button>
            <button data-cat="질문" onclick="erpFeedback._cat('질문')">❓ 질문</button>
            <button data-cat="칭찬" onclick="erpFeedback._cat('칭찬')">👍 칭찬</button>
          </div>
          <textarea class="fb-textarea" id="fb-text" placeholder="자유롭게 작성해주세요...&#10;&#10;예시) - 출고지시서 PDF 출력 시 글씨가 잘립니다&#10;     - 채권 패널에 고객사별 색상 구분 추가했으면&#10;     - 어떻게 PJ NO 자동 생성하나요?"></textarea>
          <div class="fb-info">
            🔒 자동 첨부: 현재 화면 정보, 누적 에러 5건, Health Score, 데이터 카운트<br>
            📧 수신 이메일은 erpNotify.config 에 설정한 주소로 발송됩니다
          </div>
          <div class="fb-actions">
            <button onclick="erpFeedback._send()" style="padding:8px 18px;background:#ff9800;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">📨 발송</button>
            <button onclick="document.getElementById('erp-fb-modal').classList.remove('open')" style="padding:8px 18px;background:#999;color:#fff;border:none;border-radius:6px;cursor:pointer;">취소</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  let _currentCat = '제안';
  function _cat(c) {
    _currentCat = c;
    document.querySelectorAll('#erp-fb-modal .fb-cat button').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === c);
    });
  }

  async function _send() {
    const text = document.getElementById('fb-text').value.trim();
    if (!text) { alert('내용을 입력해주세요'); return; }
    try {
      await send(text, _currentCat);
      document.getElementById('fb-text').value = '';
      close();
    } catch(e) {
      alert('발송 실패: ' + e.message);
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-fb-modal').classList.add('open');
    setTimeout(() => document.getElementById('fb-text')?.focus(), 30);
  }
  function close() { document.getElementById('erp-fb-modal')?.classList.remove('open'); }

  window.erpFeedback = {
    send, history, open, close, _send, _cat
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-FB] 피드백 모듈 활성 — 우측 하단 💬 또는 erpFeedback.send("내용")');
})();
