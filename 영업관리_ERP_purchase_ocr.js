// =====================================================
//  PURCHASE ORDER OCR — 발주서 자동 파싱
//  지원: PDF · 이미지 · 카카오톡/문자 스크린샷
//  AI: Gemini 2.0 Flash (직접 호출, Apps Script 불필요)
//  생성: 2026-05-21 · 바로(주) ERP
//
//  공개 API:
//    window.purchaseOcr.open(callback)   — 모달 열기
//    window.purchaseOcr.close()          — 모달 닫기
//    window.purchaseOcr.setApiKey(key)   — API 키 설정
// =====================================================
(function () {
  'use strict';

  // ── Gemini API 키 (설정 탭에서 저장된 값 우선 사용) ──
  const GEMINI_API_KEY =
    (typeof localStorage !== 'undefined' && localStorage.getItem('erp_gemini_key')) ||
    'AIzaSyB4FTT4xp7J12xBWEXaXGDh7OvCK89B0Kg';

  const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;

  let _callback = null;

  // ── 유틸 ──────────────────────────────────────────
  function _e(v) {
    return String(v || '').replace(/[<>&"]/g, ch =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  }

  function _fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('파일 읽기 실패'));
      r.readAsDataURL(file);
    });
  }

  // ── PDF.js 로드 ───────────────────────────────────
  let _pdfJsPromise = null;
  function _loadPdfJs() {
    if (typeof window.pdfjsLib !== 'undefined') return Promise.resolve(true);
    if (_pdfJsPromise) return _pdfJsPromise;
    _pdfJsPromise = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          res(true);
        } else res(false);
      };
      s.onerror = () => res(false);
      document.head.appendChild(s);
      setTimeout(() => res(false), 8000);
    });
    return _pdfJsPromise;
  }

  async function _pdfToImages(file) {
    const loaded = await _loadPdfJs();
    if (!loaded) throw new Error('PDF.js 로드 실패');
    const ab = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
    const images = [];
    const maxPages = Math.min(pdf.numPages, 5); // 최대 5페이지
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return images;
  }

  // ── Gemini API 호출 ───────────────────────────────
  async function _callGemini(parts) {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Gemini API 오류: ' + resp.status + ' ' + err.slice(0, 200));
    }
    const json = await resp.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // ── 발주서 파싱 프롬프트 ─────────────────────────
  const PARSE_PROMPT = `아래는 발주서 이미지입니다. 발주서에서 다음 정보를 추출해 JSON으로만 응답하세요.
다른 설명 없이 JSON 객체만 출력하세요.

추출 필드:
{
  "vendor": "공급업체/발주처 회사명",
  "vendorContact": "담당자 연락처 또는 이름",
  "poNumber": "발주번호 또는 주문번호",
  "orderDate": "발주일 (YYYY-MM-DD 형식)",
  "deliveryDate": "납기일 (YYYY-MM-DD 형식)",
  "items": [
    {
      "model": "품목명 또는 모델명",
      "qty": 수량(숫자),
      "unitPrice": 단가(숫자, 원화),
      "totalPrice": 합계금액(숫자, 원화),
      "watt": 단품용량W(숫자, 태양광 모듈인 경우),
      "note": "비고"
    }
  ],
  "totalAmount": 총 발주금액(숫자),
  "currency": "통화 (KRW/USD/CNY 등)",
  "deliveryAddress": "납품지 주소",
  "paymentTerms": "결제 조건",
  "memo": "기타 특이사항"
}

값이 없으면 null로 표기하세요. 금액은 쉼표 제거한 숫자만 넣으세요.`;

  async function _parseWithGemini(file) {
    const mimeType = file.type || 'image/jpeg';
    let parts;

    if (mimeType === 'application/pdf') {
      // PDF → 이미지 변환 후 전송
      const images = await _pdfToImages(file);
      parts = [
        { text: PARSE_PROMPT },
        ...images.map(b64 => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } }))
      ];
    } else {
      // 이미지 직접 전송 (카카오톡/문자 스크린샷 포함)
      const b64 = await _fileToBase64(file);
      parts = [
        { text: PARSE_PROMPT },
        { inlineData: { mimeType: mimeType, data: b64 } }
      ];
    }

    const raw = await _callGemini(parts);
    // JSON 파싱
    const clean = raw.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(clean);
    } catch (e) {
      // JSON 파싱 실패 시 텍스트에서 객체 추출 시도
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('AI 응답 파싱 실패: ' + clean.slice(0, 100));
    }
  }

  // ── UI 스타일 주입 ────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('pocr-style')) return;
    const style = document.createElement('style');
    style.id = 'pocr-style';
    style.textContent = `
      #pocr-overlay {
        display:none; position:fixed; inset:0; background:rgba(0,0,0,.55);
        z-index:99999; align-items:center; justify-content:center;
      }
      #pocr-overlay.open { display:flex; }
      .pocr-box {
        background:#fff; border-radius:14px; width:min(760px,96vw);
        max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.3);
        font-family:'Noto Sans KR',sans-serif; font-size:14px;
      }
      .pocr-head {
        background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
        color:#fff; padding:18px 22px; border-radius:14px 14px 0 0;
        display:flex; align-items:center; justify-content:space-between;
      }
      .pocr-head h2 { margin:0; font-size:1.05em; font-weight:700; }
      .pocr-head .pocr-close {
        background:rgba(255,255,255,.15); border:none; color:#fff;
        width:30px; height:30px; border-radius:50%; cursor:pointer;
        font-size:16px; display:flex; align-items:center; justify-content:center;
      }
      .pocr-head .pocr-close:hover { background:rgba(255,255,255,.3); }
      .pocr-body { padding:20px 22px; }

      /* 드롭존 */
      .pocr-drop {
        border:2.5px dashed #c5cae9; border-radius:12px;
        padding:40px 20px; text-align:center; cursor:pointer;
        transition:all .2s; background:#f8f9ff;
      }
      .pocr-drop:hover, .pocr-drop.dragover {
        border-color:#3f51b5; background:#e8eaf6;
      }
      .pocr-drop.processing {
        border-color:#ff9800; background:#fff8e1; cursor:wait;
      }
      .pocr-drop-icon { font-size:3em; margin-bottom:10px; }
      .pocr-drop-title { font-size:1.05em; font-weight:700; color:#1a1a2e; margin-bottom:6px; }
      .pocr-drop-sub { font-size:0.84em; color:#888; line-height:1.7; }
      .pocr-file-badges {
        display:flex; gap:8px; justify-content:center; margin-top:14px; flex-wrap:wrap;
      }
      .pocr-badge {
        padding:4px 12px; border-radius:20px; font-size:0.78em; font-weight:700;
        color:#fff;
      }
      .pocr-badge.pdf { background:#e53935; }
      .pocr-badge.img { background:#1e88e5; }
      .pocr-badge.kakao { background:#fee500; color:#3c1e1e; }
      .pocr-badge.sms { background:#43a047; }

      /* 로딩 */
      .pocr-loading {
        text-align:center; padding:40px 20px;
      }
      .pocr-spinner {
        width:48px; height:48px; border:4px solid #e3e8ff;
        border-top-color:#3f51b5; border-radius:50%;
        animation:pocr-spin .8s linear infinite; margin:0 auto 16px;
      }
      @keyframes pocr-spin { to { transform:rotate(360deg); } }
      .pocr-loading-text { color:#555; font-size:0.92em; line-height:1.8; }

      /* 결과 미리보기 */
      .pocr-result-banner {
        background:#e8f5e9; border-left:4px solid #27ae60;
        padding:10px 14px; border-radius:6px; margin-bottom:16px;
        font-size:0.86em;
      }
      .pocr-items-table {
        width:100%; border-collapse:collapse; font-size:0.84em; margin-bottom:16px;
      }
      .pocr-items-table th {
        background:#1a1a2e; color:#fff; padding:8px 10px;
        text-align:left; font-weight:600;
      }
      .pocr-items-table td {
        padding:8px 10px; border-bottom:1px solid #eee;
      }
      .pocr-items-table tr:hover td { background:#f5f7ff; }
      .pocr-field-grid {
        display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;
      }
      @media(max-width:520px){ .pocr-field-grid{ grid-template-columns:1fr; } }
      .pocr-field {
        display:flex; flex-direction:column; gap:4px;
      }
      .pocr-field label {
        font-size:0.78em; color:#888; font-weight:600; text-transform:uppercase;
        letter-spacing:.04em;
      }
      .pocr-field input {
        border:1.5px solid #ddd; border-radius:7px; padding:7px 10px;
        font-size:0.9em; font-family:inherit; transition:border .2s;
      }
      .pocr-field input:focus { outline:none; border-color:#3f51b5; }

      /* 버튼 */
      .pocr-btn-row {
        display:flex; justify-content:space-between; gap:10px; margin-top:16px;
        flex-wrap:wrap;
      }
      .pocr-btn {
        padding:10px 20px; border-radius:8px; border:none; cursor:pointer;
        font-size:0.9em; font-weight:700; font-family:inherit; transition:all .15s;
      }
      .pocr-btn-ghost {
        background:#f5f5f5; color:#555;
      }
      .pocr-btn-ghost:hover { background:#e0e0e0; }
      .pocr-btn-primary {
        background:linear-gradient(135deg,#1a1a2e,#3f51b5); color:#fff;
        box-shadow:0 4px 14px rgba(63,81,181,.3);
      }
      .pocr-btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(63,81,181,.4); }
      .pocr-btn-success {
        background:linear-gradient(135deg,#27ae60,#2ecc71); color:#fff;
        box-shadow:0 4px 14px rgba(39,174,96,.3);
      }
      .pocr-btn-success:hover { transform:translateY(-1px); }

      /* 품목 편집 행 추가 */
      .pocr-add-item {
        background:#f0f4ff; border:1.5px dashed #3f51b5; border-radius:8px;
        padding:8px 14px; text-align:center; cursor:pointer; font-size:0.84em;
        color:#3f51b5; font-weight:700; margin-bottom:10px; transition:all .2s;
      }
      .pocr-add-item:hover { background:#e3e8ff; }
      .pocr-item-row td input {
        border:1px solid #ddd; border-radius:5px; padding:4px 6px;
        font-size:0.82em; width:100%; box-sizing:border-box;
      }
      .pocr-del-btn {
        background:#ffebee; border:none; color:#c62828; cursor:pointer;
        border-radius:5px; padding:3px 8px; font-size:0.8em;
      }
      .pocr-del-btn:hover { background:#ffcdd2; }

      /* 에러 */
      .pocr-error {
        background:#ffebee; border-left:4px solid #c62828;
        padding:10px 14px; border-radius:6px; font-size:0.86em;
        color:#c62828; margin-bottom:12px;
      }
    `;
    document.head.appendChild(style);
  }

  // ── UI 구조 주입 ──────────────────────────────────
  function _injectUI() {
    if (document.getElementById('pocr-overlay')) return;
    _injectStyles();
    const div = document.createElement('div');
    div.id = 'pocr-overlay';
    div.innerHTML = `
      <div class="pocr-box">
        <div class="pocr-head">
          <h2>📦 발주서 자동 파싱 <span style="font-size:.78em;opacity:.7;font-weight:400;">— Gemini 2.0 Flash</span></h2>
          <button class="pocr-close" id="pocr-x">✕</button>
        </div>
        <div class="pocr-body" id="pocr-bd"></div>
      </div>
    `;
    document.body.appendChild(div);
    document.getElementById('pocr-x').addEventListener('click', close);
    div.addEventListener('click', e => { if (e.target === div) close(); });
  }

  // ── 업로드 화면 ───────────────────────────────────
  function _renderUpload(errMsg) {
    const bd = document.getElementById('pocr-bd');
    bd.innerHTML = `
      ${errMsg ? `<div class="pocr-error">⚠️ ${_e(errMsg)}</div>` : ''}
      <div class="pocr-drop" id="pocr-drop">
        <div class="pocr-drop-icon">📄</div>
        <div class="pocr-drop-title">발주서 파일을 드래그하거나 클릭하여 업로드</div>
        <div class="pocr-drop-sub">
          카카오톡 발주서 캡처 · 문자 스크린샷 · PDF 발주서 · 이미지 파일<br>
          Gemini AI가 품목·수량·단가·납기일을 자동으로 읽어드립니다
        </div>
        <div class="pocr-file-badges">
          <span class="pocr-badge pdf">PDF</span>
          <span class="pocr-badge img">JPG/PNG</span>
          <span class="pocr-badge kakao">카카오톡</span>
          <span class="pocr-badge sms">문자캡처</span>
        </div>
        <input type="file" id="pocr-file" accept=".pdf,image/*" style="display:none">
      </div>
      <div style="margin-top:14px;padding:12px 14px;background:#fff8e1;border-radius:8px;font-size:0.83em;color:#795548;line-height:1.7;">
        💡 <strong>팁</strong>: 카카오톡 발주 메시지 캡처, 이메일 첨부 PDF, 문자 스크린샷 모두 지원합니다.<br>
        이미지가 흐리거나 글씨가 작아도 Gemini AI가 최대한 읽어드립니다.
      </div>
    `;

    const drop = document.getElementById('pocr-drop');
    const fileInput = document.getElementById('pocr-file');

    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) _processFile(e.target.files[0]);
    });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      if (e.dataTransfer.files[0]) _processFile(e.dataTransfer.files[0]);
    });
  }

  // ── 로딩 화면 ─────────────────────────────────────
  function _renderLoading(fileName) {
    document.getElementById('pocr-bd').innerHTML = `
      <div class="pocr-loading">
        <div class="pocr-spinner"></div>
        <div class="pocr-loading-text">
          <strong>${_e(fileName)}</strong><br>
          Gemini 2.0 Flash가 발주서를 분석 중입니다...<br>
          <span style="color:#bbb;font-size:0.85em;">품목명 · 수량 · 단가 · 납기일 자동 추출 중</span>
        </div>
      </div>
    `;
  }

  // ── 파일 처리 (메인) ──────────────────────────────
  async function _processFile(file) {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png',
      'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif'];
    const isAllowed = allowedTypes.includes(file.type) ||
      file.name.match(/\.(pdf|jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i);
    if (!isAllowed) {
      _renderUpload('지원하지 않는 파일 형식입니다. PDF 또는 이미지 파일을 업로드하세요.');
      return;
    }

    _renderLoading(file.name);

    try {
      const parsed = await _parseWithGemini(file);
      _renderPreview(parsed, file.name);
    } catch (err) {
      console.error('[purchase-ocr] 파싱 실패', err);
      _renderUpload('분석 실패: ' + err.message + '\n\n다시 시도하거나 다른 파일을 업로드해보세요.');
    }
  }

  // ── 결과 미리보기 화면 ────────────────────────────
  function _renderPreview(data, fileName) {
    const items = Array.isArray(data.items) ? data.items : [];
    const totalItems = items.length;
    const totalQty = items.reduce((s, r) => s + (Number(r.qty) || 0), 0);

    const bd = document.getElementById('pocr-bd');
    bd.innerHTML = `
      <div class="pocr-result-banner">
        ✅ <strong>${_e(fileName)}</strong> 분석 완료 —
        품목 <strong>${totalItems}개</strong> · 총 수량 <strong>${totalQty.toLocaleString()}장</strong>
        ${data.totalAmount ? ` · 총액 <strong>${Number(data.totalAmount).toLocaleString()}${data.currency || '원'}</strong>` : ''}
      </div>

      <!-- 기본 정보 -->
      <div class="pocr-field-grid">
        <div class="pocr-field">
          <label>공급업체 / 발주처</label>
          <input id="pf-vendor" value="${_e(data.vendor || '')}" placeholder="공급업체명">
        </div>
        <div class="pocr-field">
          <label>발주번호 (PO No.)</label>
          <input id="pf-poNumber" value="${_e(data.poNumber || '')}" placeholder="PO-2026-001">
        </div>
        <div class="pocr-field">
          <label>발주일</label>
          <input id="pf-orderDate" type="date" value="${_e(data.orderDate || '')}">
        </div>
        <div class="pocr-field">
          <label>납기일</label>
          <input id="pf-deliveryDate" type="date" value="${_e(data.deliveryDate || '')}">
        </div>
        <div class="pocr-field">
          <label>납품지 주소</label>
          <input id="pf-deliveryAddress" value="${_e(data.deliveryAddress || '')}" placeholder="납품지">
        </div>
        <div class="pocr-field">
          <label>결제 조건</label>
          <input id="pf-paymentTerms" value="${_e(data.paymentTerms || '')}" placeholder="30일 후 결제 등">
        </div>
        <div class="pocr-field">
          <label>담당자</label>
          <input id="pf-vendorContact" value="${_e(data.vendorContact || '')}" placeholder="담당자명 또는 연락처">
        </div>
        <div class="pocr-field">
          <label>메모</label>
          <input id="pf-memo" value="${_e(data.memo || '')}" placeholder="기타 특이사항">
        </div>
      </div>

      <!-- 품목 테이블 -->
      <div style="font-weight:700;font-size:0.9em;margin-bottom:8px;color:#1a1a2e;">📋 발주 품목 (편집 가능)</div>
      <table class="pocr-items-table" id="pocr-items-tbl">
        <thead>
          <tr>
            <th>품목명 / 모델</th>
            <th style="width:70px;text-align:right;">수량</th>
            <th style="width:90px;text-align:right;">단가(원)</th>
            <th style="width:90px;text-align:right;">합계(원)</th>
            <th style="width:70px;text-align:right;">용량(W)</th>
            <th style="width:50px;"></th>
          </tr>
        </thead>
        <tbody id="pocr-items-body">
          ${items.map((item, i) => _itemRowHtml(item, i)).join('')}
        </tbody>
      </table>
      <div class="pocr-add-item" id="pocr-add-row">+ 품목 추가</div>

      <div style="background:#f8f9ff;border-radius:8px;padding:10px 14px;font-size:0.84em;color:#555;margin-bottom:14px;">
        총액: <strong id="pocr-total-display">${data.totalAmount ? Number(data.totalAmount).toLocaleString() + (data.currency || '원') : '자동 계산'}</strong>
        ${data.currency && data.currency !== 'KRW' ? ` <span style="color:#e65100;">(${data.currency} — 환율 변환 필요)</span>` : ''}
      </div>

      <div class="pocr-btn-row">
        <button class="pocr-btn pocr-btn-ghost" id="pocr-back">← 다른 파일</button>
        <div style="display:flex;gap:8px;">
          <button class="pocr-btn pocr-btn-primary" id="pocr-to-purchase">📥 발주 이력에 추가</button>
          <button class="pocr-btn pocr-btn-success" id="pocr-apply">✅ ERP 발주 입력 적용</button>
        </div>
      </div>
    `;

    // 이벤트
    document.getElementById('pocr-back').addEventListener('click', _renderUpload);
    document.getElementById('pocr-add-row').addEventListener('click', _addItemRow);
    document.getElementById('pocr-to-purchase').addEventListener('click', () => _applyToPurchaseHistory(_collectData()));
    document.getElementById('pocr-apply').addEventListener('click', () => _applyAndClose(_collectData()));

    // 품목 삭제 버튼 위임
    document.getElementById('pocr-items-body').addEventListener('click', e => {
      const btn = e.target.closest('.pocr-del-btn');
      if (btn) btn.closest('tr').remove();
      _recalcTotal();
    });

    // 합계 자동 계산
    document.getElementById('pocr-items-body').addEventListener('input', _recalcTotal);
  }

  function _itemRowHtml(item, i) {
    return `<tr class="pocr-item-row" data-idx="${i}">
      <td><input class="pi-model" value="${_e(item.model || '')}" placeholder="품목명"></td>
      <td><input class="pi-qty" type="number" value="${item.qty || ''}" placeholder="0" style="text-align:right;"></td>
      <td><input class="pi-unitPrice" type="number" value="${item.unitPrice || ''}" placeholder="0" style="text-align:right;"></td>
      <td><input class="pi-total" type="number" value="${item.totalPrice || ''}" placeholder="자동" style="text-align:right;"></td>
      <td><input class="pi-watt" type="number" value="${item.watt || ''}" placeholder="W" style="text-align:right;"></td>
      <td><button class="pocr-del-btn">✕</button></td>
    </tr>`;
  }

  let _rowIdx = 1000;
  function _addItemRow() {
    const tbody = document.getElementById('pocr-items-body');
    const tr = document.createElement('tr');
    tr.className = 'pocr-item-row';
    tr.dataset.idx = _rowIdx++;
    tr.innerHTML = `
      <td><input class="pi-model" value="" placeholder="품목명"></td>
      <td><input class="pi-qty" type="number" value="" placeholder="0" style="text-align:right;"></td>
      <td><input class="pi-unitPrice" type="number" value="" placeholder="0" style="text-align:right;"></td>
      <td><input class="pi-total" type="number" value="" placeholder="자동" style="text-align:right;"></td>
      <td><input class="pi-watt" type="number" value="" placeholder="W" style="text-align:right;"></td>
      <td><button class="pocr-del-btn">✕</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('.pi-model').focus();
  }

  function _recalcTotal() {
    let total = 0;
    document.querySelectorAll('#pocr-items-body tr').forEach(tr => {
      const qty = Number(tr.querySelector('.pi-qty')?.value) || 0;
      const up = Number(tr.querySelector('.pi-unitPrice')?.value) || 0;
      const tot = tr.querySelector('.pi-total');
      if (qty && up) {
        const calc = qty * up;
        if (tot && !tot.value) tot.placeholder = calc.toLocaleString();
        total += Number(tot?.value) || calc;
      } else {
        total += Number(tot?.value) || 0;
      }
    });
    const disp = document.getElementById('pocr-total-display');
    if (disp && total > 0) disp.textContent = total.toLocaleString() + '원';
  }

  // ── 데이터 수집 ───────────────────────────────────
  function _collectData() {
    const g = id => document.getElementById(id)?.value || '';
    const items = [];
    document.querySelectorAll('#pocr-items-body tr').forEach(tr => {
      const model = tr.querySelector('.pi-model')?.value?.trim();
      if (!model) return;
      items.push({
        model,
        qty: Number(tr.querySelector('.pi-qty')?.value) || 0,
        unitPrice: Number(tr.querySelector('.pi-unitPrice')?.value) || 0,
        totalPrice: Number(tr.querySelector('.pi-total')?.value) || 0,
        watt: Number(tr.querySelector('.pi-watt')?.value) || 0
      });
    });
    return {
      vendor: g('pf-vendor'),
      vendorContact: g('pf-vendorContact'),
      poNumber: g('pf-poNumber'),
      orderDate: g('pf-orderDate'),
      deliveryDate: g('pf-deliveryDate'),
      deliveryAddress: g('pf-deliveryAddress'),
      paymentTerms: g('pf-paymentTerms'),
      memo: g('pf-memo'),
      items,
      totalAmount: items.reduce((s, r) => s + (r.totalPrice || r.qty * r.unitPrice || 0), 0),
      _source: 'purchase_ocr'
    };
  }

  // ── ERP 발주 이력(purchase 모듈)에 추가 ───────────
  function _applyToPurchaseHistory(data) {
    try {
      // inventoryData 또는 rawData에 추가
      const now = new Date().toISOString().slice(0, 10);
      data.items.forEach(item => {
        const record = {
          id: 'POC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          type: '입고',
          date: data.orderDate || now,
          model: item.model,
          mfr: data.vendor,
          qty: item.qty,
          watt: item.watt,
          unitPrice: item.unitPrice,
          totalAmount: item.totalPrice || item.qty * item.unitPrice,
          pjNo: data.poNumber,
          warehouse: data.deliveryAddress || '',
          _ocrSource: true
        };
        if (typeof inventoryData !== 'undefined') {
          inventoryData.push(record);
        }
      });
      if (typeof saveData === 'function') saveData();
      alert(`✅ ${data.items.length}개 품목이 발주 이력에 추가되었습니다.`);
      if (typeof purchase !== 'undefined' && typeof purchase.open === 'function') {
        close();
        purchase.open();
      }
    } catch (e) {
      alert('발주 이력 추가 실패: ' + e.message);
    }
  }

  // ── 콜백으로 데이터 전달 후 닫기 ─────────────────
  function _applyAndClose(data) {
    if (typeof _callback === 'function') {
      try { _callback(data); } catch (e) { console.error('[purchase-ocr] callback 오류', e); }
    } else {
      // 콜백 없으면 발주 이력에 바로 추가
      _applyToPurchaseHistory(data);
      return;
    }
    close();
  }

  // ── 공개 API ──────────────────────────────────────
  function open(callback) {
    _injectUI();
    _callback = callback || null;
    document.getElementById('pocr-overlay').classList.add('open');
    setTimeout(_renderUpload, 30);
  }

  function close() {
    document.getElementById('pocr-overlay')?.classList.remove('open');
    _callback = null;
  }

  function setApiKey(key) {
    if (typeof localStorage !== 'undefined') localStorage.setItem('erp_gemini_key', key);
  }

  window.purchaseOcr = { open, close, setApiKey };

  // ── FAB 버튼 (발주서 업로드 빠른 접근) ───────────
  function _injectFab() {
    if (document.getElementById('pocr-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'pocr-fab';
    fab.title = '발주서 자동 파싱 (PDF/이미지/카카오톡)';
    fab.innerHTML = '📦';
    fab.style.cssText = `
      position:fixed; bottom:72px; right:18px; width:48px; height:48px;
      border-radius:50%; background:linear-gradient(135deg,#1a1a2e,#3f51b5);
      color:#fff; border:none; cursor:pointer; font-size:20px; z-index:9000;
      box-shadow:0 4px 16px rgba(63,81,181,.4); transition:transform .15s,box-shadow .15s;
    `;
    fab.addEventListener('mouseenter', () => {
      fab.style.transform = 'scale(1.1)';
      fab.style.boxShadow = '0 6px 20px rgba(63,81,181,.5)';
    });
    fab.addEventListener('mouseleave', () => {
      fab.style.transform = '';
      fab.style.boxShadow = '0 4px 16px rgba(63,81,181,.4)';
    });
    fab.addEventListener('click', () => open());
    document.body.appendChild(fab);
  }

  function boot() {
    setTimeout(() => {
      _injectUI();
      _injectFab();
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-POCR] 발주서 OCR 모듈 활성 — purchaseOcr.open(callback) 또는 📦 FAB 버튼');
})();
