// =====================================================
//  MOBILE + QR + SIGNATURE — Phase C · Week 11
//
//  현장 작업용 기능 3종
//   A) QR/바코드 스캔으로 SN 일괄 등록 (입고)
//   B) 캔버스 터치 서명 (인수증)
//   C) 카메라 사진 첨부 (적재/하차/현장)
//
//  jsQR 라이브러리 동적 로드 (CDN, 무료)
//
//  우측 하단 📱 fab — 모바일·태블릿에서 특히 유용
// =====================================================
(function() {
  'use strict';

  const JSQR_CDN = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  let jsqrLoaded = false;
  let _stream = null;
  let _scanInterval = null;
  let _scanned = new Set();   // 중복 방지
  let _signatures = {};       // doId -> dataURL
  try { _signatures = JSON.parse(localStorage.getItem('erp_mobile_sigs')||'{}'); } catch(e) { _signatures = {}; }

  function _loadJsQR() {
    if (jsqrLoaded || window.jsQR) { jsqrLoaded = true; return Promise.resolve(); }
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = JSQR_CDN; s.onload = () => { jsqrLoaded = true; res(); };
      s.onerror = () => rej(new Error('jsQR 로드 실패 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    });
  }

  // ── UI 패널 ─────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-mob-fab')) return;

    const css = `
      #erp-mob-fab{position:fixed;bottom:18px;right:236px;width:44px;height:44px;border-radius:50%;
        background:#7b1fa2;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s, background .2s;}
      #erp-mob-fab:hover{background:#4a148c;transform:scale(1.07);}
      #erp-mob-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:6vh;}
      #erp-mob-modal.open{display:flex;}
      .mob-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:560px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;}
      .mob-hd{padding:14px 18px;background:#7b1fa2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .mob-hd h4{margin:0;font-size:1em;font-weight:700;}
      .mob-tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa;}
      .mob-tabs button{flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:0.86em;color:#888;border-bottom:2px solid transparent;}
      .mob-tabs button.active{color:#7b1fa2;font-weight:700;border-bottom-color:#7b1fa2;background:#fff;}
      .mob-body{flex:1;overflow-y:auto;padding:14px 18px;font-size:0.88em;}
      .mob-video{width:100%;max-height:300px;background:#000;border-radius:8px;}
      .mob-list{margin-top:10px;max-height:200px;overflow-y:auto;background:#f8f9fa;border-radius:8px;padding:8px;}
      .mob-list-item{padding:6px 8px;background:#fff;border-radius:5px;margin-bottom:4px;font-family:monospace;font-size:0.84em;display:flex;justify-content:space-between;align-items:center;}
      .mob-list-item .x{color:#c62828;cursor:pointer;}
      .mob-canvas{width:100%;height:200px;background:#fff;border:2px dashed #ccc;border-radius:8px;touch-action:none;cursor:crosshair;}
      .mob-input{width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:8px;box-sizing:border-box;}
      .mob-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-mob-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-mob-fab';
    fab.title = '모바일 — QR스캔 / 서명 / 사진';
    fab.textContent = '📱';
    fab.onclick = open;
    document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-mob-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="mob-box">
        <div class="mob-hd">
          <h4>📱 현장 모바일</h4>
          <button onclick="document.getElementById('erp-mob-modal').classList.remove('open');erpMobile._stop()"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="mob-tabs">
          <button data-tab="qr" class="active" onclick="erpMobile._tab('qr')">📷 QR 스캔</button>
          <button data-tab="sig" onclick="erpMobile._tab('sig')">✍️ 서명</button>
          <button data-tab="photo" onclick="erpMobile._tab('photo')">🖼️ 사진</button>
        </div>
        <div class="mob-body" id="mob-body"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  function _renderQR() {
    document.getElementById('mob-body').innerHTML = `
      <div style="margin-bottom:10px;">
        <div class="mob-grid">
          <input class="mob-input" id="mob-qr-model" placeholder="모델명*">
          <input class="mob-input" id="mob-qr-mfr" placeholder="매입사">
        </div>
        <div class="mob-grid">
          <input class="mob-input" id="mob-qr-bl" placeholder="B/L 번호">
          <input class="mob-input" id="mob-qr-wh" placeholder="창고">
        </div>
      </div>
      <video class="mob-video" id="mob-qr-video" playsinline></video>
      <canvas id="mob-qr-canvas" style="display:none;"></canvas>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-sm btn-green" onclick="erpMobile._startScan()">▶ 스캔 시작</button>
        <button class="btn btn-sm btn-gray" onclick="erpMobile._stop()">⏹ 정지</button>
        <button class="btn btn-sm btn-blue" onclick="erpMobile._manualSn()">⌨️ 직접입력</button>
        <span id="mob-qr-cnt" style="margin-left:auto;align-self:center;font-size:0.86em;color:#666;">스캔된 SN: 0건</span>
      </div>
      <div class="mob-list" id="mob-qr-list"></div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn btn-sm btn-dark" onclick="erpMobile._registerScans()" style="flex:1;">💾 SN 일괄 등록</button>
        <button class="btn btn-sm btn-red" onclick="erpMobile._clearScans()">🗑️ 비우기</button>
      </div>
      <div style="margin-top:10px;font-size:0.78em;color:#888;">
        💡 카메라 권한 허용 필수. PC에서도 카메라 있으면 작동. QR이 인식 안 되면 직접입력 사용.
      </div>`;
    _renderScanList();
  }

  async function _startScan() {
    try { await _loadJsQR(); }
    catch(e) { alert('jsQR 로드 실패 — 인터넷 연결 확인 후 재시도'); return; }
    const video = document.getElementById('mob-qr-video');
    const canvas = document.getElementById('mob-qr-canvas');
    const ctx = canvas.getContext('2d');
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch(e) {
      alert('카메라 접근 실패: ' + e.message);
      return;
    }
    video.srcObject = _stream;
    video.setAttribute('playsinline', true);
    video.play();

    _scanInterval = setInterval(() => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        const value = code.data.trim();
        if (value && !_scanned.has(value)) {
          _scanned.add(value);
          _renderScanList();
          // 비프 음 (간단)
          try { (new (window.AudioContext||window.webkitAudioContext)()).resume; } catch(e){}
          if (typeof setBanner === 'function') setBanner('ok', `📷 ${value} (${_scanned.size}건)`);
        }
      }
    }, 250);
  }

  function _stop() {
    if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
  }

  function _manualSn() {
    const v = prompt('SN 입력 (여러 개는 줄바꿈 또는 콤마):');
    if (!v) return;
    v.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).forEach(s => _scanned.add(s));
    _renderScanList();
  }

  function _renderScanList() {
    const list = document.getElementById('mob-qr-list');
    const cnt = document.getElementById('mob-qr-cnt');
    if (!list) return;
    cnt.textContent = `스캔된 SN: ${_scanned.size}건`;
    if (!_scanned.size) { list.innerHTML = '<div style="text-align:center;color:#bbb;padding:20px;">스캔 결과 없음</div>'; return; }
    list.innerHTML = [..._scanned].slice(-50).reverse().map(s =>
      `<div class="mob-list-item">${s}<span class="x" onclick="erpMobile._removeScan('${s.replace(/'/g,"\\'")}')">✕</span></div>`
    ).join('');
  }

  function _removeScan(s) {
    _scanned.delete(s);
    _renderScanList();
  }

  function _clearScans() {
    if (!confirm(`${_scanned.size}건 모두 삭제?`)) return;
    _scanned.clear();
    _renderScanList();
  }

  function _registerScans() {
    if (!_scanned.size) { alert('스캔된 SN 없음'); return; }
    if (typeof sn === 'undefined' || !sn.bulkAdd) { alert('SN 모듈 미로드'); return; }
    const model = document.getElementById('mob-qr-model').value.trim();
    if (!model) { alert('모델명 입력 필수'); return; }
    const meta = {
      model,
      mfr: document.getElementById('mob-qr-mfr').value.trim(),
      inboundBL: document.getElementById('mob-qr-bl').value.trim(),
      warehouse: document.getElementById('mob-qr-wh').value.trim(),
      inboundDate: new Date().toISOString().slice(0,10)
    };
    const r = sn.bulkAdd([..._scanned], meta);
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ SN 등록 ${r.added}건 / 중복스킵 ${r.skipped}건`);
    _scanned.clear();
    _renderScanList();
  }

  // ── 서명 캔버스 ─────────────────────────────────────
  let _sigCtx = null, _sigDrawing = false;

  function _renderSig() {
    document.getElementById('mob-body').innerHTML = `
      <input class="mob-input" id="mob-sig-doid" placeholder="대상 ID (출고지시서 번호 등)">
      <input class="mob-input" id="mob-sig-name" placeholder="서명자 성명">
      <canvas class="mob-canvas" id="mob-sig-canvas" width="800" height="220"></canvas>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-sm btn-gray" onclick="erpMobile._sigClear()">🗑️ 지우기</button>
        <button class="btn btn-sm btn-blue" onclick="erpMobile._sigSave()" style="flex:1;">💾 서명 저장</button>
      </div>
      <div style="margin-top:14px;">
        <strong style="font-size:0.86em;">저장된 서명 (${Object.keys(_signatures).length}건)</strong>
        <div class="mob-list">${Object.entries(_signatures).slice(-10).reverse().map(([id,s]) => `
          <div class="mob-list-item">
            <span>${id}</span>
            <span>
              <button class="btn btn-xs btn-dark" onclick="erpMobile._sigShow('${id.replace(/'/g,"\\'")}')">👁️</button>
              <button class="btn btn-xs btn-red" onclick="erpMobile._sigDelete('${id.replace(/'/g,"\\'")}')">🗑️</button>
            </span>
          </div>`).join('') || '<div style="text-align:center;color:#bbb;padding:10px;">없음</div>'}</div>
      </div>`;
    _sigInit();
  }

  function _sigInit() {
    const canvas = document.getElementById('mob-sig-canvas');
    if (!canvas) return;
    _sigCtx = canvas.getContext('2d');
    _sigCtx.lineWidth = 2.2; _sigCtx.lineCap = 'round'; _sigCtx.strokeStyle = '#1a1a2e';
    const _pos = e => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * canvas.width / r.width, y: (t.clientY - r.top) * canvas.height / r.height };
    };
    const start = e => { _sigDrawing = true; const p = _pos(e); _sigCtx.beginPath(); _sigCtx.moveTo(p.x, p.y); e.preventDefault(); };
    const move  = e => { if (!_sigDrawing) return; const p = _pos(e); _sigCtx.lineTo(p.x, p.y); _sigCtx.stroke(); e.preventDefault(); };
    const end   = () => { _sigDrawing = false; };
    canvas.addEventListener('mousedown',  start); canvas.addEventListener('mousemove', move);  canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);
  }

  function _sigClear() {
    const c = document.getElementById('mob-sig-canvas');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  function _sigSave() {
    const id = document.getElementById('mob-sig-doid').value.trim();
    const name = document.getElementById('mob-sig-name').value.trim();
    if (!id) { alert('대상 ID 필수'); return; }
    const c = document.getElementById('mob-sig-canvas');
    const data = c.toDataURL('image/png');
    _signatures[id] = { name, data, signedAt: new Date().toISOString() };
    try { localStorage.setItem('erp_mobile_sigs', JSON.stringify(_signatures)); } catch(e) {}
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${id} 서명 저장`);
    _renderSig();
  }

  function _sigShow(id) {
    const s = _signatures[id]; if (!s) return;
    const w = window.open('', '_blank', 'width=720,height=400');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>서명 ${id}</title></head>
      <body style="font-family:sans-serif;padding:20px;background:#fafafa;">
        <h3>${id}</h3>
        <p>서명자: ${s.name||'-'} · ${s.signedAt}</p>
        <img src="${s.data}" style="border:1px solid #ddd;background:#fff;">
      </body></html>`);
  }

  function _sigDelete(id) {
    if (!confirm(`${id} 서명 삭제?`)) return;
    delete _signatures[id];
    try { localStorage.setItem('erp_mobile_sigs', JSON.stringify(_signatures)); } catch(e) {}
    _renderSig();
  }

  // ── 사진 첨부 ───────────────────────────────────────
  function _renderPhoto() {
    document.getElementById('mob-body').innerHTML = `
      <input class="mob-input" id="mob-pho-id" placeholder="대상 ID (PJ NO·DO 번호 등)">
      <input class="mob-input" id="mob-pho-tag" placeholder="구분 (예: 적재전, 하차후, 현장)">
      <input type="file" accept="image/*" capture="environment" id="mob-pho-file"
        style="width:100%;padding:14px;border:2px dashed #ccc;border-radius:8px;background:#fafafa;cursor:pointer;">
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-sm btn-blue" onclick="erpMobile._photoSave()" style="flex:1;">💾 사진 저장 (IndexedDB)</button>
      </div>
      <div style="margin-top:14px;font-size:0.82em;color:#888;">
        💡 사진은 IndexedDB에 저장됩니다 (localStorage 용량 보호). 다운로드는 콘솔: <code>erpMobile.photoList()</code>
      </div>`;
  }

  async function _photoSave() {
    const id = document.getElementById('mob-pho-id').value.trim();
    const tag = document.getElementById('mob-pho-tag').value.trim() || 'photo';
    const file = document.getElementById('mob-pho-file').files[0];
    if (!id || !file) { alert('대상 ID + 사진 파일 필수'); return; }
    if (typeof idbPut !== 'function') { alert('IndexedDB 모듈 미로드 (safety.js 확인)'); return; }
    const reader = new FileReader();
    reader.onload = async e => {
      const key = `photo|${id}|${tag}|${Date.now()}`;
      try {
        await idbPut(key, { id, tag, name: file.name, type: file.type, data: e.target.result, when: new Date().toISOString() });
        if (typeof setBanner === 'function') setBanner('ok', `✅ ${id}/${tag} 사진 저장`);
        document.getElementById('mob-pho-file').value = '';
      } catch(err) { alert('저장 실패: ' + err.message); }
    };
    reader.readAsDataURL(file);
  }

  async function photoList(idFilter) {
    if (typeof openIDB !== 'function' && typeof idbPut !== 'function') return [];
    // Use raw IDB
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('erpFilesDB', 1);
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });
    return new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = store.openCursor();
      const out = [];
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) {
          if (cur.key.indexOf('photo|') === 0) {
            if (!idFilter || cur.key.indexOf(idFilter) >= 0) {
              out.push({ key: cur.key, ...cur.value });
            }
          }
          cur.continue();
        } else {
          console.table(out.map(o => ({key:o.key, id:o.id, tag:o.tag, when:o.when})));
          res(out);
        }
      };
      req.onerror = e => rej(e.target.error);
    });
  }

  // ── 진입 ────────────────────────────────────────────
  function open() {
    _injectUI();
    document.getElementById('erp-mob-modal').classList.add('open');
    _tab('qr');
  }
  function close() {
    document.getElementById('erp-mob-modal')?.classList.remove('open');
    _stop();
  }
  function _tab(t) {
    document.querySelectorAll('#erp-mob-modal .mob-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === t);
    });
    if (t === 'qr')    _renderQR();
    if (t === 'sig')   _renderSig();
    if (t === 'photo') _renderPhoto();
  }

  // ── 공개 API ────────────────────────────────────────
  window.erpMobile = {
    open, close,
    _tab, _stop, _startScan, _manualSn, _renderScanList,
    _removeScan, _clearScans, _registerScans,
    _sigClear, _sigSave, _sigShow, _sigDelete,
    _photoSave,
    photoList,
    signatures: () => ({ ..._signatures })
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-MOBILE] 모바일·QR·서명·사진 모듈 활성 — 우측 하단 📱');
})();
