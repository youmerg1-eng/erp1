// =====================================================
//  CONTRACT OCR — 계약서 PDF/이미지 자동 입력 (Phase 5)
//
//  흐름
//   1) PDF 또는 이미지 업로드
//   2) ai.ocr() 호출 (Apps Script → Gemini 멀티모달)
//   3) 추출된 텍스트를 정규식 + AI 프롬프트로 구조화
//   4) 미리보기 모달 → 사용자 검증 → 화주 등록 폼에 자동 적용
//
//  지원 계약서 패턴
//   - 3PL 물류대행 계약서 (SCGS 표준)
//   - 한국 일반 위탁/보관 계약서 형식
//
//  공개 API: window.contractOcr.open(callback)
// =====================================================
(function() {
  'use strict';

  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }

  // ── 한국 계약서 텍스트 → 구조화 데이터 추출 ─────
  //   1차: 정규식 (안정성 우선)
  //   2차: 매칭 안 된 필드는 AI 추가 호출 (옵션)
  function _parseContractText(text) {
    const T = String(text || '').replace(/ /g, ' ');   // NBSP 정리
    const out = {
      _rawText: T,
      _confidence: {}     // 필드별 추출 신뢰도
    };

    // ── 위탁인 (화주) 회사명 ──
    //   "(위탁인) 상 호 : 에스씨지솔루션즈㈜"
    //   "위탁인 :  ㈜...  "
    let m = T.match(/\(?위탁인\)?\s*(?:상\s*호)?\s*[:：]?\s*([^\n\r(]+(?:㈜|\(주\)|주식회사)?[^\n\r]*?)(?=\s*(?:이하|\(이하|상\s*호|주\s*소|대표|$))/);
    if (m) {
      out.name = m[1].replace(/\s+/g,' ').trim();
      out._confidence.name = 0.9;
    }

    // ── 사업자번호 ── (123-45-67890)
    m = T.match(/(\d{3}-\d{2}-\d{5})/);
    if (m) { out.bizNo = m[1]; out._confidence.bizNo = 0.95; }

    // ── 대표이사 ──
    m = T.match(/대표\s*이사\s*[:：]?\s*([가-힣\s]+?)(?=\s*\(인\)|인\)|\n|\(|$)/);
    if (m) {
      // 첫 번째 매치는 위탁인의 대표이사
      out.ceoName = m[1].replace(/\s+/g,'').trim();
      out._confidence.ceoName = 0.85;
    }

    // ── 위탁인 주소 ──
    //   "(위탁인) 주 소 : 서울시 송파구 ..."
    m = T.match(/\(?위탁인\)?\s*주\s*소\s*[:：]?\s*([^\n\r]+?)(?=\s*상\s*호|\s*대표|\n)/);
    if (m) {
      out.address = m[1].replace(/\s+/g,' ').trim();
      out._confidence.address = 0.85;
    } else {
      // fallback — 첫 번째 "주 소" 매치
      m = T.match(/주\s*소\s*[:：]?\s*([가-힣]+(?:특별시|광역시|도|시|군)[^\n\r]+?)(?=\s*상\s*호|\s*대표|\n)/);
      if (m) {
        out.address = m[1].replace(/\s+/g,' ').trim();
        out._confidence.address = 0.7;
      }
    }

    // ── 계약 기간 ──
    //   "2025년 12월 1일부터 2026년 11월 30일까지"
    //   "유효기간은 YYYY년 M월 D일부터 YYYY년 M월 D일까지"
    m = T.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*부터\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*까지/);
    if (m) {
      out.contractStart = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      out.contractEnd = `${m[4]}-${m[5].padStart(2,'0')}-${m[6].padStart(2,'0')}`;
      out._confidence.contractStart = 0.95;
      out._confidence.contractEnd = 0.95;
    }

    // ── 자동 갱신 ── (다양한 표현 지원)
    //   "자동으로 1년간 재계약" / "자동 연장" / "자동으로 1년 갱신"
    if (/자동\s*(?:으로)?\s*(\d+)\s*년\s*(?:간)?\s*(?:재계약|갱신|연장)/.test(T)
       || /자동\s*연장/.test(T)
       || /자동\s*갱신/.test(T)) {
      out.autoRenew = true;
      const ym = T.match(/자동\s*(?:으로)?\s*(\d+)\s*년/);
      out.renewMonths = ym ? Number(ym[1]) * 12 : 12;
      out._confidence.autoRenew = 0.9;
    }

    // ── 보관 단가 (Wp당) ──
    //   "물류대행 단가는 WP당 7.8원" / "WP당 5.5원"
    m = T.match(/(?:WP|wp|Wp|와트)\s*당\s*(\d+(?:\.\d+)?)\s*원/);
    if (m) { out.ratePerWp = Number(m[1]); out._confidence.ratePerWp = 0.9; }

    // ── 무상 / 추가 보관 기간 ──
    //   "입고일로부터 3개월(최대 5개월)이내 제품의 출고를 진행"
    m = T.match(/(\d+)\s*개월\s*\(\s*최대\s*(\d+)\s*개월\s*\)/);
    if (m) {
      out.freeMonths = Number(m[1]);
      // 정상가 추가 기간 = 최대 - 무상
      out.extraMonths = Math.max(0, Number(m[2]) - Number(m[1]));
      out._confidence.freeMonths = 0.9;
      out._confidence.extraMonths = 0.85;
    } else {
      // fallback — "무상 N개월"
      m = T.match(/무상\s*(?:보관)?\s*(\d+)\s*개월/);
      if (m) { out.freeMonths = Number(m[1]); out._confidence.freeMonths = 0.7; }
    }

    // ── 할증 추가 단가 ──
    //   "5개월이 초과된 제품에 대해서 ... WP당 0.5원을 추가로 청구"
    m = T.match(/(?:초과|장기보관)\D{0,40}?(?:WP|wp)\s*당\s*(\d+(?:\.\d+)?)\s*원\s*(?:을\s*)?추가/);
    if (m) { out.surchargeAddPerWp = Number(m[1]); out._confidence.surchargeAddPerWp = 0.9; }

    // ── 결제 — 은행/계좌/예금주 ──
    //   "은행명 : 하나은행 / 계좌번호 : 724-910031-56604 / 예금주 : 바로 주식회사"
    m = T.match(/은행\s*명?\s*[:：]?\s*([가-힣]+은행)/);
    if (m) { out.bankName = m[1]; out._confidence.bankName = 0.9; }

    m = T.match(/계\s*좌\s*번호\s*[:：]?\s*([\d\-]+)/);
    if (m) { out.bankAccount = m[1]; out._confidence.bankAccount = 0.95; }

    m = T.match(/예\s*금\s*주\s*[:：]?\s*([^\n\r]+?)(?=\s*은행|\s*계좌|\n|$)/);
    if (m) { out.accountHolder = m[1].trim(); out._confidence.accountHolder = 0.85; }

    // ── 결제 조건 ──
    //   "익월 말일까지" / "전월 1일부터 전월 말일까지"
    if (/익월\s*말일\s*까지/.test(T)) {
      out.paymentTerms = '월말 마감 / 익월 말일 입금';
      out._confidence.paymentTerms = 0.85;
    }

    // ── 계산 신뢰도 평균
    const confidences = Object.values(out._confidence);
    out._avgConfidence = confidences.length > 0
      ? (confidences.reduce((s,c) => s+c, 0) / confidences.length).toFixed(2)
      : 0;

    return out;
  }

  // ── PDF.js 동적 로드 (안정성 보강) ─────────────
  //   ★ 2026-05 수정: type="module" 빌드는 onload 콜백 호환성 떨어짐.
  //   안정적인 UMD(legacy) 빌드 + worker 명시 + 다중 CDN fallback.
  let _pdfJsLoadPromise = null;
  function _loadPdfJs() {
    if (typeof window.pdfjsLib !== 'undefined') return Promise.resolve(true);
    if (_pdfJsLoadPromise) return _pdfJsLoadPromise;

    const CDNS = [
      // UMD legacy build — onload 호환
      { js: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js' },
      // jsdelivr 폴백
      { js: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js',
        worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js' },
      // unpkg 폴백
      { js: 'https://unpkg.com/pdfjs-dist@3.11.174/legacy/build/pdf.min.js',
        worker: 'https://unpkg.com/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js' }
    ];

    _pdfJsLoadPromise = (async () => {
      for (const cdn of CDNS) {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = cdn.js;
            s.async = true;
            s.onload = () => {
              if (typeof window.pdfjsLib !== 'undefined') {
                try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = cdn.worker; }
                catch (e) {}
                res(true);
              } else rej(new Error('pdfjsLib not exposed'));
            };
            s.onerror = () => rej(new Error('script error'));
            document.head.appendChild(s);
            setTimeout(() => rej(new Error('timeout')), 8000);
          });
          console.log('[contract-ocr] PDF.js 로드 성공:', cdn.js);
          return true;
        } catch (e) {
          console.warn('[contract-ocr] PDF.js CDN 실패:', cdn.js, e.message);
        }
      }
      _pdfJsLoadPromise = null;   // 재시도 가능하게 리셋
      return false;
    })();
    return _pdfJsLoadPromise;
  }

  async function _extractPdfText(file) {
    const loaded = await _loadPdfJs();
    if (!loaded || typeof window.pdfjsLib === 'undefined') {
      console.warn('[contract-ocr] PDF.js 로드 최종 실패');
      return null;
    }
    try {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({
        data: buf,
        // 워커 없이도 동작하도록 disableWorker (선택)
        // disableWorker: false
      }).promise;
      let allText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it => it.str).join(' ');
        allText += pageText + '\n';
      }
      // 텍스트가 있는지 검증 (스캔된 PDF면 거의 비어있음)
      if (!allText || allText.replace(/[\s\n\r]/g,'').length < 30) {
        console.warn('[contract-ocr] PDF에서 텍스트가 거의 추출되지 않음 (스캔 PDF 가능성)');
        return null;
      }
      return allText;
    } catch (e) {
      console.warn('[contract-ocr] PDF.js 추출 실패', e);
      return null;
    }
  }

  // ── AI OCR 호출 (Apps Script → Gemini) ──────────
  async function _aiOcrFile(file) {
    if (typeof window.ai === 'undefined' || !window.ai.ocr) {
      throw new Error('AI 어시스턴트(ai.ocr)가 로드되지 않았습니다. 설정 탭에서 Apps Script + Gemini 설정 필요.');
    }
    return await window.ai.ocr(file);
  }

  // ── PDF → base64 변환 (계약서 보관용) ───────────
  function _fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // ============================================================
  //  UI
  // ============================================================
  let _callback = null;

  function _injectUI() {
    if (document.getElementById('erp-co-modal')) return;
    const css = `
      #erp-co-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9700;display:none;align-items:center;justify-content:center;}
      #erp-co-modal.open{display:flex;}
      .co-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:96%;max-width:880px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .co-hd{padding:14px 20px;background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .co-bd{flex:1;overflow-y:auto;padding:18px;}
      .co-drop{border:3px dashed #1565c0;border-radius:12px;padding:40px;text-align:center;background:#e3f2fd;cursor:pointer;transition:background .15s;}
      .co-drop:hover{background:#bbdefb;}
      .co-drop.processing{border-color:#f9a825;background:#fff8e1;cursor:wait;}
      .co-extracted{background:#fafafa;border-radius:8px;padding:14px;margin-top:14px;}
      .co-field-row{display:grid;grid-template-columns:130px 1fr 80px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eee;font-size:0.86em;}
      .co-field-row label{font-weight:700;color:#666;}
      .co-field-row input{width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:5px;font-size:0.92em;}
      .co-conf{padding:1px 7px;border-radius:4px;font-size:0.74em;font-weight:700;text-align:center;}
      .co-conf.high{background:#e8f5e9;color:#27ae60;}
      .co-conf.mid{background:#fff3e0;color:#e65100;}
      .co-conf.low{background:#ffebee;color:#c62828;}
      .co-btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:0.88em;font-weight:700;}
      .co-btn-primary{background:#1565c0;color:#fff;}
      .co-btn-success{background:#27ae60;color:#fff;}
      .co-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-co-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-co-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="co-box">
        <div class="co-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">📄 계약서 자동 입력 (OCR)</h4>
          <button class="co-btn co-btn-ghost" onclick="document.getElementById('erp-co-modal').classList.remove('open')">✕</button>
        </div>
        <div class="co-bd" id="co-bd"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  function _renderUpload() {
    const aiReady = _checkAiOcrReady();
    document.getElementById('co-bd').innerHTML = `
      <div style="background:#fffde7;border-left:4px solid #f9a825;padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:0.86em;line-height:1.6;">
        💡 <strong>3PL 물류대행 계약서 표준 패턴 인식</strong><br>
        지원: 위탁인/수탁인 정보, 계약 기간, WP당 단가, 무상기간, 할증 단가, 결제 계좌
      </div>

      <label class="co-drop" id="co-drop" for="co-file" style="display:block;">
        <div style="font-size:3em;margin-bottom:10px;">📑</div>
        <div style="font-size:1.1em;font-weight:800;color:#1565c0;margin-bottom:6px;">계약서 PDF/이미지를 선택하거나 드래그</div>
        <div style="font-size:0.86em;color:#666;">PDF · JPG · PNG (최대 10MB)</div>
        <input id="co-file" type="file" accept=".pdf,image/*" style="display:none;">
      </label>

      <div style="margin-top:14px;text-align:center;">
        <span style="color:#888;font-size:0.84em;">또는</span>
      </div>

      <div style="margin-top:10px;text-align:center;">
        <button class="co-btn co-btn-ghost" data-act="co-paste-text" style="padding:10px 20px;">📋 텍스트 직접 붙여넣기 (PDF 변환 안 될 때)</button>
      </div>

      <div style="margin-top:14px;font-size:0.84em;color:#666;line-height:1.6;background:#f9f9f9;padding:10px;border-radius:6px;">
        <strong>처리 흐름:</strong><br>
        1️⃣ <strong>PDF.js</strong> 로 텍스트 직접 추출 (가장 빠르고 정확)<br>
        2️⃣ 실패 시 <strong>AI OCR (Gemini)</strong> ${aiReady.ok ? '<span style="color:#27ae60;">✓ 사용 가능</span>' : `<span style="color:#c62828;">⚠️ ${_e(aiReady.reason)}</span>`}<br>
        3️⃣ 모두 실패하면 <strong>수동 텍스트 입력</strong> (붙여넣기)<br>
        4️⃣ 정규식 + 패턴으로 핵심 필드 자동 추출 → 검토 후 [✅ 화주로 등록]
      </div>

      ${!aiReady.ok ? `<div style="margin-top:10px;background:#ffebee;border-left:4px solid #c62828;padding:10px 12px;border-radius:6px;font-size:0.84em;color:#c62828;line-height:1.6;">
        ⚠️ <strong>AI OCR 사용 불가</strong>: ${_e(aiReady.reason)}<br>
        <span style="color:#666;">텍스트 PDF는 PDF.js로 처리되지만, 스캔된 이미지 PDF는 OCR이 필요합니다.<br>설정 탭에서 <code>erpSetupV2.open()</code> 실행하여 셋업을 완료하세요.</span>
      </div>` : ''}
    `;
    // 파일 선택 + 드래그 처리
    const drop = document.getElementById('co-drop');
    const fileInput = document.getElementById('co-file');
    fileInput.addEventListener('change', e => _handleFile(e.target.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.background = '#bbdefb'; });
    drop.addEventListener('dragleave', () => { drop.style.background = ''; });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.style.background = '';
      _handleFile(e.dataTransfer.files[0]);
    });
    // "텍스트 직접 붙여넣기" 버튼
    const bd = document.getElementById('co-bd');
    bd.addEventListener('click', e => {
      const btn = e.target.closest('[data-act="co-paste-text"]');
      if (!btn) return;
      _renderManualFallback(null, new Error('사용자가 텍스트 직접 입력 선택'));
    });
  }

  // AI OCR 사용 가능 여부 검사 (사전)
  function _checkAiOcrReady() {
    if (typeof window.ai === 'undefined' || !window.ai.ocr) {
      return { ok: false, reason: 'ai.ocr 미로드' };
    }
    if (typeof window.gsUrl === 'undefined' || !window.gsUrl) {
      return { ok: false, reason: 'Apps Script URL 미설정 (설정 탭에서 등록 필요)' };
    }
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('erp_notify_config') || '{}'); } catch (e) {}
    if (!cfg.gsToken) {
      return { ok: false, reason: 'gsToken 미설정 (셋업 마법사 v2 완료 필요)' };
    }
    return { ok: true };
  }

  async function _handleFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (!confirm('파일이 10MB 이상입니다. 계속하시겠습니까?')) return;
    }
    const drop = document.getElementById('co-drop');
    if (drop) {
      drop.classList.add('processing');
      drop.innerHTML = '<div style="font-size:3em;margin-bottom:10px;">⏳</div><div style="font-size:1.1em;font-weight:800;color:#e65100;">처리 중... PDF 텍스트 추출 시도</div>';
    }

    let text = null;
    let extractMethod = null;
    let lastError = null;

    // 1차: PDF.js 직접 추출 (텍스트 PDF는 빠르고 정확)
    if (file.type === 'application/pdf') {
      try {
        text = await _extractPdfText(file);
        if (text) extractMethod = 'pdfjs';
      } catch (e) {
        lastError = e;
        console.warn('[contract-ocr] PDF.js 시도 실패', e);
      }
    }

    // 2차: AI OCR 폴백 (스캔 PDF 또는 이미지)
    if (!text) {
      const aiReady = _checkAiOcrReady();
      if (aiReady.ok) {
        if (drop) drop.innerHTML = '<div style="font-size:3em;margin-bottom:10px;">🤖</div><div style="font-size:1.1em;font-weight:800;color:#7b1fa2;">AI OCR 처리 중... (Gemini)</div>';
        try {
          text = await _aiOcrFile(file);
          if (text) extractMethod = 'ai';
        } catch (e) {
          lastError = e;
          console.error('[contract-ocr] AI OCR 실패', e);
        }
      } else {
        lastError = new Error('AI OCR 사용 불가: ' + aiReady.reason);
      }
    }

    // 3차: 수동 텍스트 입력 옵션 (graceful fallback)
    if (!text) {
      if (drop) drop.classList.remove('processing');
      _renderManualFallback(file, lastError);
      return;
    }

    try {
      // 추출된 텍스트 → 구조화
      const parsed = _parseContractText(text);
      const pdfBase64 = await _fileToBase64(file);
      parsed.contractPdf = pdfBase64;
      parsed.contractFileName = file.name;
      parsed._extractMethod = extractMethod;
      _renderPreview(parsed, text);
    } catch (err) {
      console.error('[contract-ocr] 파싱 실패', err);
      if (drop) drop.classList.remove('processing');
      alert('계약서 파싱 실패: ' + err.message);
      _renderUpload();
    }
  }

  // ── 수동 텍스트 입력 폴백 (가장 신뢰 가능한 마지막 보루) ──
  function _renderManualFallback(file, lastError) {
    const errMsg = lastError ? lastError.message : '';
    const isUserChoice = errMsg.includes('사용자가 텍스트 직접 입력');
    const titleHtml = isUserChoice
      ? `📋 <strong>계약서 텍스트 직접 입력</strong><br><span style="color:#666;font-size:0.92em;">PDF 본문을 복사해서 아래 영역에 붙여넣으세요.</span>`
      : `⚠️ <strong>자동 OCR 실패</strong>: ${_e(errMsg)}<br><span style="color:#666;font-size:0.92em;">아래에 계약서 텍스트를 직접 붙여넣으면 정규식 파싱으로 자동 입력됩니다.</span>`;
    const bgColor = isUserChoice ? '#e3f2fd' : '#fff3e0';
    const borderColor = isUserChoice ? '#1565c0' : '#e65100';
    document.getElementById('co-bd').innerHTML = `
      <div style="background:${bgColor};border-left:4px solid ${borderColor};padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:0.86em;line-height:1.6;">
        ${titleHtml}
      </div>

      <div style="background:#e3f2fd;padding:10px 12px;border-radius:6px;margin-bottom:10px;font-size:0.84em;line-height:1.6;">
        💡 <strong>대안 방법</strong>:<br>
        ① PDF를 외부에서 열어 본문 전체를 <kbd>Ctrl+A</kbd> → <kbd>Ctrl+C</kbd> → 아래 영역에 붙여넣기<br>
        ② 또는 PDF의 텍스트가 추출 안 되는 스캔본이면 → 설정 탭에서 셋업 마법사 v2 완료 후 다시 시도<br>
        ③ 또는 이 다이얼로그 닫고 화주 폼에 직접 입력
      </div>

      <textarea id="co-manual-text" rows="12" placeholder="여기에 계약서 본문을 붙여넣으세요...&#10;&#10;예시:&#10;물류대행 계약서&#10;(위탁인) 상 호 : 에스씨지솔루션즈㈜&#10;계약 유효기간은 2025년 12월 1일부터 2026년 11월 30일까지&#10;물류대행 단가는 WP당 7.8원..." style="width:100%;border:1.5px solid #ddd;border-radius:6px;padding:10px;font-family:inherit;font-size:0.86em;box-sizing:border-box;line-height:1.6;"></textarea>

      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;">
        <button class="co-btn co-btn-ghost" data-act="co-back-upload">← 다시 시도</button>
        <button class="co-btn co-btn-success" data-act="co-parse-manual">📋 텍스트 분석</button>
      </div>

      <details style="margin-top:14px;">
        <summary style="cursor:pointer;font-size:0.84em;color:#888;">🔍 디버깅 정보 (개발자용)</summary>
        <pre style="background:#fafafa;padding:10px;border-radius:5px;font-size:0.78em;color:#666;line-height:1.5;">${_e(errMsg||'(none)')}${file ? `\n\n파일 정보: ${_e(file.name)} (${(file.size/1024).toFixed(0)}KB, type: ${_e(file.type||'unknown')})` : '\n\n파일 첨부 없음 — 텍스트 입력 모드'}</pre>
      </details>
    `;

    // 이벤트 핸들러
    const bd = document.getElementById('co-bd');
    if (!bd.__manualBound) {
      bd.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (act === 'co-back-upload') _renderUpload();
        else if (act === 'co-parse-manual') _parseManualText(file);
      });
      bd.__manualBound = true;
    }
  }

  async function _parseManualText(file) {
    const text = document.getElementById('co-manual-text')?.value?.trim();
    if (!text || text.length < 50) {
      alert('계약서 본문을 충분히 입력하세요 (최소 50자 이상).');
      return;
    }
    try {
      const parsed = _parseContractText(text);
      // 파일 첨부 (가능하면)
      let pdfBase64 = null;
      try { pdfBase64 = await _fileToBase64(file); } catch (e) {}
      parsed.contractPdf = pdfBase64;
      parsed.contractFileName = file?.name || 'manual-input.txt';
      parsed._extractMethod = 'manual';
      _renderPreview(parsed, text);
    } catch (err) {
      alert('텍스트 분석 실패: ' + err.message);
    }
  }

  function _renderPreview(data, rawText) {
    const fields = [
      ['name',             '회사명 *',        'text',   data.name],
      ['bizNo',            '사업자번호',     'text',   data.bizNo],
      ['ceoName',          '대표이사',       'text',   data.ceoName],
      ['address',          '주소',           'text',   data.address],
      ['contractStart',    '계약 시작일',    'date',   data.contractStart],
      ['contractEnd',      '계약 종료일',    'date',   data.contractEnd],
      ['ratePerWp',        '월 단가 (원/Wp)','number', data.ratePerWp],
      ['freeMonths',       '무상 기간 (개월)','number', data.freeMonths],
      ['extraMonths',      '추가 정상가 (개월)','number', data.extraMonths],
      ['surchargeAddPerWp','초과 추가 단가 (원/Wp)', 'number', data.surchargeAddPerWp],
      ['bankName',         '은행',           'text',   data.bankName],
      ['bankAccount',      '계좌번호',       'text',   data.bankAccount],
      ['accountHolder',    '예금주',         'text',   data.accountHolder],
      ['paymentTerms',     '결제 조건',      'text',   data.paymentTerms]
    ];

    const confLabel = c => {
      if (c >= 0.85) return '<span class="co-conf high">신뢰 높음</span>';
      if (c >= 0.7) return '<span class="co-conf mid">신뢰 중간</span>';
      if (c > 0) return '<span class="co-conf low">신뢰 낮음</span>';
      return '<span class="co-conf low">미감지</span>';
    };

    const html = `
      <div style="background:#e8f5e9;border-left:4px solid #27ae60;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:0.86em;">
        ✅ 계약서 분석 완료 — <strong>${fields.filter(f => data[f[0]] !== undefined && data[f[0]] !== '').length}/${fields.length}개 필드 추출</strong>
        (평균 신뢰도 ${(Number(data._avgConfidence)*100).toFixed(0)}%)
      </div>

      <div class="co-extracted">
        <h3 style="margin:0 0 8px;font-size:0.96em;color:#1565c0;">📋 추출된 정보 (편집 가능)</h3>
        <div id="co-fields">
          ${fields.map(([key, label, type, value]) => {
            const conf = data._confidence[key] || 0;
            return `<div class="co-field-row">
              <label>${_e(label)}</label>
              <input data-f="${_ea(key)}" type="${type}" value="${_ea(value || '')}" ${type==='number'?'step="0.1"':''}>
              ${confLabel(conf)}
            </div>`;
          }).join('')}
        </div>

        <details style="margin-top:14px;">
          <summary style="cursor:pointer;font-size:0.84em;color:#666;font-weight:700;">📄 추출된 원본 텍스트 보기 (디버깅)</summary>
          <pre style="background:#fafafa;padding:10px;border-radius:5px;font-size:0.78em;overflow-x:auto;max-height:200px;line-height:1.5;color:#666;">${_e(rawText.slice(0, 3000))}${rawText.length > 3000 ? '\n... (이하 생략)' : ''}</pre>
        </details>
      </div>

      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;">
        <button class="co-btn co-btn-ghost" data-act="co-back">← 다른 파일</button>
        <button class="co-btn co-btn-success" data-act="co-apply">✅ 화주 등록 폼에 자동 입력</button>
      </div>
    `;
    document.getElementById('co-bd').innerHTML = html;

    // 액션 핸들러
    document.getElementById('co-bd').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'co-back') _renderUpload();
      else if (act === 'co-apply') _applyAndClose(data);
    });
  }

  function _applyAndClose(data) {
    // 사용자가 편집한 값 수집
    const edited = {};
    document.querySelectorAll('#co-fields [data-f]').forEach(el => {
      const k = el.getAttribute('data-f');
      const t = el.type;
      if (t === 'number') edited[k] = Number(el.value)||0;
      else edited[k] = el.value;
    });
    // 계약서 PDF + 파일명 그대로 전달
    edited.contractPdf = data.contractPdf;
    edited.contractFileName = data.contractFileName;
    // 콜백 호출
    if (typeof _callback === 'function') {
      try { _callback(edited); } catch (e) { console.error('[contract-ocr] callback 실패', e); }
    }
    close();
  }

  function open(callback) {
    _injectUI();
    _callback = callback || null;
    document.getElementById('erp-co-modal').classList.add('open');
    setTimeout(_renderUpload, 30);
  }

  function close() {
    document.getElementById('erp-co-modal')?.classList.remove('open');
    _callback = null;
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() { setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.contractOcr = {
    open, close,
    parse: _parseContractText,         // 텍스트 → 구조화 (테스트용)
    extractPdf: _extractPdfText        // PDF → 텍스트
  };

  console.log('[ERP-CO] 계약서 OCR 활성 — contractOcr.open(callback)');
})();
