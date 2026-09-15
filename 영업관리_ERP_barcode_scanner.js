// =====================================================
//  BARCODE SCANNER — 모바일 카메라 바코드 스캐너 (2026-05-13)
//
//  기능
//   1) 모바일 카메라 활성화 (HTTPS 환경에서만 동작)
//   2) 실시간 바코드 스캔 (QR / EAN / CODE128 / CODE39 등)
//   3) 스캔 결과 → ERP 데이터 자동 검색
//      - SN 매칭 → 모델, 제조사, 입고일, PJ NO, 상태 표시
//      - 모델명 매칭 → 제품 마스터 정보
//      - PJ NO 매칭 → 수주 정보 + 고객사
//   4) 4가지 모드:
//      - 조회: 스캔 후 정보 표시만
//      - 출고: 스캔된 SN을 출고지시서에 할당
//      - 입고: 새 SN을 일괄 등록
//      - 실사: 스캔된 SN을 재고 확인
//   5) 스캔 히스토리 + Excel 내보내기
//
//  기술
//   - 1차: BarcodeDetector API (Chrome/Edge 네이티브)
//   - 2차: html5-qrcode 라이브러리 (Safari/Firefox 호환)
//   - HTTPS 필수 (file:// 안 됨, localhost 또는 Netlify HTTPS)
//
//  공개 API: window.erpBarcode
// =====================================================
(function() {
  'use strict';

  const SCAN_HISTORY_KEY = 'erp_barcode_scan_history';
  const MAX_HISTORY = 500;

  let _stream = null;
  let _video = null;
  let _detector = null;
  let _scanInterval = null;
  let _lastScanned = '';
  let _lastScanTime = 0;
  let _mode = 'lookup';   // lookup | outbound | inbound | audit
  let _audit_ctx = null;  // 모드별 컨텍스트 (예: outbound 시 doId)

  let _history = [];
  try { _history = JSON.parse(localStorage.getItem(SCAN_HISTORY_KEY) || '[]'); } catch(e) {}

  // ── BarcodeDetector 또는 html5-qrcode 로드 ──────
  async function _initDetector() {
    // 1차: 네이티브 BarcodeDetector
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        _detector = new window.BarcodeDetector({
          formats: ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','data_matrix','itf','codabar']
            .filter(f => formats.includes(f))
        });
        return 'native';
      } catch(e) {/* fallback */}
    }
    // 2차: html5-qrcode 동적 로드
    if (!window.Html5Qrcode) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('html5-qrcode 로드 실패 — 인터넷 연결 확인'));
        document.head.appendChild(s);
      });
    }
    return 'html5-qrcode';
  }

  // ── 카메라 시작 ───────────────────────────────
  async function _startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 브라우저는 카메라를 지원하지 않습니다. Chrome/Safari 최신 버전 사용 권장.');
    }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      throw new Error('HTTPS 환경에서만 카메라 사용 가능 — Netlify URL 또는 localhost 로 접속하세요.\n현재: ' + location.protocol);
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',   // 후면 카메라 우선
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch(e) {
      if (e.name === 'NotAllowedError') {
        throw new Error('카메라 권한이 거부됨 — 브라우저 설정에서 카메라 권한 허용 후 새로고침');
      }
      throw new Error('카메라 시작 실패: ' + e.message);
    }

    const video = document.getElementById('bc-video');
    if (!video) throw new Error('비디오 요소 없음');
    video.srcObject = _stream;
    await video.play().catch(() => {});
    _video = video;
  }

  function _stopCamera() {
    if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
    if (_video) { _video.srcObject = null; }
    _video = null;
  }

  // ── 실시간 스캔 루프 ──────────────────────────
  async function _startScanLoop() {
    if (!_detector || !_video) return;
    _scanInterval = setInterval(async () => {
      if (!_video || _video.paused || _video.readyState < 2) return;
      try {
        const barcodes = await _detector.detect(_video);
        if (barcodes && barcodes.length > 0) {
          _onScanned(barcodes[0].rawValue || barcodes[0].text);
        }
      } catch(e) {/* 조용히 실패 */}
    }, 250);   // 4 fps 정도면 충분
  }

  // ── 스캔 결과 처리 ────────────────────────────
  function _onScanned(text) {
    if (!text) return;
    const code = String(text).trim();
    if (!code) return;

    // 디바운스 — 같은 코드 2초 안에 중복 무시
    const now = Date.now();
    if (code === _lastScanned && (now - _lastScanTime) < 2000) return;
    _lastScanned = code;
    _lastScanTime = now;

    // 진동 피드백 (모바일)
    if (navigator.vibrate) try { navigator.vibrate(100); } catch(e) {}
    // 비프음
    _beep();

    // ERP 데이터 검색
    const matched = _lookup(code);

    // 히스토리 추가
    const entry = {
      ts: new Date().toISOString(),
      code: code,
      mode: _mode,
      matched: matched.type,
      detail: matched.summary
    };
    _history.unshift(entry);
    _history = _history.slice(0, MAX_HISTORY);
    try { localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(_history)); } catch(e) {}

    // 모드별 처리
    if (_mode === 'lookup') {
      _showLookupResult(code, matched);
    } else if (_mode === 'outbound') {
      _doOutbound(code, matched);
    } else if (_mode === 'inbound') {
      _doInbound(code, matched);
    } else if (_mode === 'audit') {
      _doAudit(code, matched);
    }
  }

  function _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 80);
    } catch(e) {}
  }

  // ── ERP 데이터 검색 ──────────────────────────
  function _lookup(code) {
    const result = { type: 'none', data: null, summary: '매칭 없음' };
    const upper = code.toUpperCase();

    // 1) SN 매칭 (가장 자주 쓰임)
    try {
      if (window.sn && typeof window.sn.find === 'function') {
        const rec = window.sn.find(upper);
        if (rec) {
          result.type = 'sn';
          result.data = rec;
          result.summary = `SN: ${rec.sn} · ${rec.model||'-'} · 상태: ${rec.status||'-'}`;
          return result;
        }
      }
      // 직접 검색 (sn.find 가 없을 경우)
      const snDb = JSON.parse(localStorage.getItem('erp_sn_records') || '{}');
      if (snDb[upper]) {
        result.type = 'sn';
        result.data = snDb[upper];
        result.summary = `SN: ${upper} · ${snDb[upper].model||'-'}`;
        return result;
      }
    } catch(e) {}

    // 2) PJ NO 매칭
    try {
      if (typeof getEnriched === 'function') {
        const orders = getEnriched();
        const matched = orders.find(o => (o.pjNo||'').toUpperCase() === upper);
        if (matched) {
          result.type = 'order';
          result.data = matched;
          result.summary = `수주: ${matched.pjNo} · ${matched.고객사||''} · ${matched.모델명||''}`;
          return result;
        }
      }
    } catch(e) {}

    // 3) 모델명 매칭 (부분 매칭)
    try {
      const productMaster = JSON.parse(localStorage.getItem('erp_product_master') || '{}');
      // 정확 매칭
      if (productMaster[code]) {
        result.type = 'product';
        result.data = productMaster[code];
        result.summary = `제품: ${code} · ${productMaster[code].watt||'-'}W`;
        return result;
      }
      // 부분 매칭
      const found = Object.entries(productMaster).find(([k]) =>
        k.toUpperCase().includes(upper) || upper.includes(k.toUpperCase())
      );
      if (found) {
        result.type = 'product';
        result.data = found[1];
        result.summary = `제품 (유사): ${found[0]} · ${found[1].watt||'-'}W`;
        return result;
      }
    } catch(e) {}

    // 4) 출고지시서 ID 매칭
    try {
      if (typeof deliveryOrders !== 'undefined') {
        const doMatch = deliveryOrders.find(d => (d.id||'').toUpperCase() === upper);
        if (doMatch) {
          result.type = 'delivery';
          result.data = doMatch;
          result.summary = `출고지시서: ${doMatch.id} · ${doMatch.pjNo||''}`;
          return result;
        }
      }
    } catch(e) {}

    return result;
  }

  // ── 4가지 모드 동작 ──────────────────────────
  function _showLookupResult(code, matched) {
    const panel = document.getElementById('bc-result');
    if (!panel) return;
    const m = matched;
    let html = '';

    if (m.type === 'sn') {
      const r = m.data;
      const statusColors = {
        in_stock: '#27ae60', shipped: '#1565c0', installed: '#7b1fa2',
        returned: '#e65100', damaged: '#c62828'
      };
      const statusLabels = {
        in_stock: '✅ 재고', shipped: '🚛 출고', installed: '⚡ 설치',
        returned: '↩️ 반품', damaged: '❌ 파손'
      };
      html = `
        <div class="bc-match bc-match-sn">
          <div class="bc-tag" style="background:${statusColors[r.status]||'#888'};">${statusLabels[r.status]||r.status}</div>
          <h3>${_e(r.sn)}</h3>
          <table class="bc-info">
            <tr><th>모델</th><td>${_e(r.model||'-')}</td></tr>
            <tr><th>제조사</th><td>${_e(r.mfr||'-')}</td></tr>
            <tr><th>입고일</th><td>${_e(r.inboundDate||'-')}</td></tr>
            <tr><th>BL</th><td>${_e(r.inboundBL||'-')}</td></tr>
            <tr><th>창고</th><td>${_e(r.warehouse||'-')}</td></tr>
            <tr><th>PJ NO</th><td>${r.pjNo ? `<strong>${_e(r.pjNo)}</strong>` : '-'}</td></tr>
            <tr><th>출고일</th><td>${_e(r.outboundDate||'-')}</td></tr>
            <tr><th>출고지시서</th><td>${_e(r.doId||'-')}</td></tr>
          </table>
        </div>`;
    } else if (m.type === 'order') {
      const o = m.data;
      html = `
        <div class="bc-match bc-match-order">
          <div class="bc-tag" style="background:#1565c0;">📋 수주</div>
          <h3>${_e(o.pjNo)}</h3>
          <table class="bc-info">
            <tr><th>고객사</th><td><strong>${_e(o.고객사||'-')}</strong></td></tr>
            <tr><th>발전소</th><td>${_e(o.발전소명||'-')}</td></tr>
            <tr><th>모델</th><td>${_e(o.모델명||'-')}</td></tr>
            <tr><th>수량</th><td>${(o.수량||0).toLocaleString()}매</td></tr>
            <tr><th>수주일</th><td>${_e(o.수주일||'-')}</td></tr>
            <tr><th>출고요청일</th><td>${_e(o.출고요청일||'-')}</td></tr>
            <tr><th>상태</th><td>${_e(o.status||'-')}</td></tr>
            <tr><th>담당자</th><td>${_e(o.담당자||'-')}</td></tr>
          </table>
        </div>`;
    } else if (m.type === 'product') {
      const p = m.data;
      html = `
        <div class="bc-match bc-match-product">
          <div class="bc-tag" style="background:#7b1fa2;">📦 제품 마스터</div>
          <h3>${_e(code)}</h3>
          <table class="bc-info">
            <tr><th>제조사</th><td>${_e(p.mfr||'-')}</td></tr>
            <tr><th>출력</th><td>${_e(p.watt||'-')} W</td></tr>
            <tr><th>1PLT</th><td>${_e(p.plt||'-')} 매</td></tr>
          </table>
        </div>`;
    } else if (m.type === 'delivery') {
      const d = m.data;
      html = `
        <div class="bc-match bc-match-delivery">
          <div class="bc-tag" style="background:#e65100;">🚛 출고지시서</div>
          <h3>${_e(d.id)}</h3>
          <table class="bc-info">
            <tr><th>PJ NO</th><td>${_e(d.pjNo||'-')}</td></tr>
            <tr><th>모델</th><td>${_e(d.model||'-')}</td></tr>
            <tr><th>수량</th><td>${(d.totalQty||d.qty||0).toLocaleString()}매</td></tr>
            <tr><th>날짜</th><td>${_e(d.date||'-')}</td></tr>
          </table>
        </div>`;
    } else {
      html = `
        <div class="bc-match bc-match-none">
          <div class="bc-tag" style="background:#888;">❓ 매칭 없음</div>
          <h3>${_e(code)}</h3>
          <p>ERP 데이터에서 일치 항목을 찾지 못했습니다.</p>
          <button class="bc-btn" onclick="erpBarcode.registerSN('${_ea(code)}')">+ 새 SN으로 등록</button>
        </div>`;
    }

    panel.innerHTML = html;
    panel.classList.add('flash');
    setTimeout(() => panel.classList.remove('flash'), 400);
  }

  function _doOutbound(code, matched) {
    if (matched.type !== 'sn') {
      _showLookupResult(code, matched);
      _toast('❌ SN 매칭 안 됨 — 출고 불가', 'err');
      return;
    }
    const ctx = _audit_ctx || {};
    try {
      if (window.sn && typeof window.sn.assign === 'function') {
        window.sn.assign([code], ctx.pjNo, ctx.doId);
        _toast(`✅ ${code} 출고 처리 완료`);
        _showLookupResult(code, _lookup(code));   // 갱신
      }
    } catch(e) {
      _toast('❌ ' + e.message, 'err');
    }
  }

  function _doInbound(code, matched) {
    const ctx = _audit_ctx || {};
    try {
      if (window.sn && typeof window.sn.bulkAdd === 'function') {
        const r = window.sn.bulkAdd([code], {
          model: ctx.model || '',
          mfr: ctx.mfr || '',
          inboundBL: ctx.bl || '',
          warehouse: ctx.warehouse || ''
        });
        _toast(`✅ ${code} 입고 등록 완료`);
        _showLookupResult(code, _lookup(code));
      }
    } catch(e) {
      _toast('❌ ' + e.message, 'err');
    }
  }

  function _doAudit(code, matched) {
    if (matched.type !== 'sn') {
      _showLookupResult(code, matched);
      _toast('⚠ SN 매칭 안 됨 (실사 외)', 'warn');
      return;
    }
    _showLookupResult(code, matched);
    _toast(`✅ ${code} 실사 확인`);
  }

  function _toast(msg, type) {
    const el = document.getElementById('bc-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'bc-toast bc-toast-' + (type||'ok');
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  function _e(v) {
    return String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }
  function _ea(v) { return _e(v).replace(/'/g, '&#39;'); }

  // ── UI: 스캐너 모달 ──────────────────────────
  function _ensureStyle() {
    if (document.getElementById('bc-style')) return;
    const s = document.createElement('style');
    s.id = 'bc-style';
    s.textContent = `
      #bc-modal{position:fixed;inset:0;background:#000;z-index:9900;display:none;flex-direction:column;}
      #bc-modal.open{display:flex;}
      .bc-hd{padding:12px 16px;background:linear-gradient(180deg,rgba(0,0,0,0.85),rgba(0,0,0,0.4));
        color:#fff;display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2;}
      .bc-hd h3{margin:0;font-size:1em;}
      .bc-hd .bc-x{background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;padding:4px 10px;}
      .bc-modes{padding:8px 12px;background:rgba(0,0,0,0.6);display:flex;gap:6px;overflow-x:auto;position:relative;z-index:2;}
      .bc-modes button{flex:0 0 auto;padding:8px 14px;border:1.5px solid rgba(255,255,255,0.3);background:transparent;
        color:#fff;border-radius:18px;font-size:0.84em;font-weight:700;cursor:pointer;white-space:nowrap;}
      .bc-modes button.active{background:#1565c0;border-color:#1565c0;}
      .bc-view{position:relative;flex:1;overflow:hidden;background:#000;}
      #bc-video{width:100%;height:100%;object-fit:cover;}
      .bc-overlay{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;}
      .bc-target{width:240px;height:180px;border:3px solid #4caf50;border-radius:12px;
        box-shadow:0 0 0 9999px rgba(0,0,0,0.4);animation:bcPulse 2s ease-in-out infinite;}
      @keyframes bcPulse {0%,100%{transform:scale(1);} 50%{transform:scale(1.04);}}
      .bc-hint{position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#fff;
        font-size:0.86em;text-shadow:0 1px 4px rgba(0,0,0,0.8);pointer-events:none;}
      #bc-result{background:#fff;max-height:50vh;overflow-y:auto;padding:14px;transition:transform 0.18s;}
      #bc-result.flash{animation:bcFlash 0.4s;}
      @keyframes bcFlash {0%{background:#c8e6c9;} 100%{background:#fff;}}
      .bc-match{position:relative;}
      .bc-tag{display:inline-block;padding:3px 10px;color:#fff;border-radius:12px;font-size:0.78em;font-weight:700;margin-bottom:8px;}
      .bc-match h3{margin:0 0 10px;font-size:1.1em;color:#1a1a2e;word-break:break-all;}
      .bc-info{width:100%;border-collapse:collapse;font-size:0.86em;}
      .bc-info th{text-align:left;padding:6px 8px;background:#fafafa;width:100px;color:#666;font-weight:600;font-size:0.84em;}
      .bc-info td{padding:6px 8px;border-bottom:1px solid #f0f0f0;}
      .bc-btn{padding:10px 16px;background:#1565c0;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;margin-top:10px;}
      #bc-toast{position:absolute;top:60px;left:50%;transform:translateX(-50%);padding:10px 18px;
        border-radius:22px;color:#fff;font-size:0.92em;font-weight:700;opacity:0;transition:opacity 0.3s;z-index:10;
        box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;}
      .bc-toast-ok{background:#27ae60;}
      .bc-toast-err{background:#c62828;}
      .bc-toast-warn{background:#e65100;}
      .bc-ft{padding:10px;background:#fafafa;border-top:1px solid #eee;display:flex;gap:6px;justify-content:space-between;}
      .bc-ft button{padding:10px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.86em;font-weight:700;}
      .bc-ft .history{background:#37474f;color:#fff;}
      .bc-ft .export{background:#2e7d32;color:#fff;}
      .bc-ft .clear{background:#c62828;color:#fff;}
      .bc-ft .torch{background:#f9a825;color:#fff;}

      /* 히스토리 패널 */
      #bc-history-modal{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9950;display:none;align-items:center;justify-content:center;}
      #bc-history-modal.open{display:flex;}
      .bc-hist-box{background:#fff;border-radius:14px;width:92%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;}
      .bc-hist-hd{padding:12px 16px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .bc-hist-bd{flex:1;overflow-y:auto;}
      .bc-hist-row{padding:10px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:8px;align-items:flex-start;}
      .bc-hist-row .code{font-family:monospace;font-weight:700;color:#1a1a2e;font-size:0.92em;}
      .bc-hist-row .detail{font-size:0.78em;color:#666;margin-top:2px;}
      .bc-hist-row .meta{font-size:0.72em;color:#888;text-align:right;flex-shrink:0;}
      .bc-hist-empty{padding:40px;text-align:center;color:#aaa;}

      /* 모바일 — 작은 화면 */
      @media (max-width: 480px) {
        .bc-target { width: 80vw; height: 40vw; max-height: 200px; }
        .bc-modes button { padding: 6px 10px; font-size: 0.78em; }
      }
    `;
    document.head.appendChild(s);
  }

  function _buildModal() {
    if (document.getElementById('bc-modal')) return;
    _ensureStyle();
    const modal = document.createElement('div');
    modal.id = 'bc-modal';
    modal.innerHTML = `
      <div class="bc-hd">
        <h3>📷 바코드 스캐너</h3>
        <button class="bc-x" onclick="erpBarcode.close()">✕</button>
      </div>
      <div class="bc-modes" id="bc-modes">
        <button data-mode="lookup"  class="active">🔍 조회</button>
        <button data-mode="outbound">🚛 출고</button>
        <button data-mode="inbound">📦 입고</button>
        <button data-mode="audit">📋 실사</button>
      </div>
      <div class="bc-view">
        <video id="bc-video" playsinline muted autoplay></video>
        <div class="bc-overlay"><div class="bc-target"></div></div>
        <div class="bc-hint">초록 박스 안에 바코드를 비추세요</div>
        <div id="bc-toast" class="bc-toast"></div>
      </div>
      <div id="bc-result">
        <div style="color:#888;text-align:center;padding:18px;">스캔 대기 중...</div>
      </div>
      <div class="bc-ft">
        <button class="torch" onclick="erpBarcode.toggleTorch()">💡 플래시</button>
        <button class="history" onclick="erpBarcode.showHistory()">📋 이력</button>
        <button class="export" onclick="erpBarcode.exportHistory()">⬇ Excel</button>
        <button class="clear" onclick="erpBarcode.clearHistory()">🗑 지우기</button>
      </div>
    `;
    document.body.appendChild(modal);

    // 모드 변경
    document.getElementById('bc-modes').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      _mode = btn.getAttribute('data-mode');
      document.querySelectorAll('#bc-modes button').forEach(b => b.classList.toggle('active', b === btn));
      // 출고/입고 모드는 컨텍스트 입력 받기
      if (_mode === 'outbound') _promptOutboundCtx();
      else if (_mode === 'inbound') _promptInboundCtx();
    });

    // 히스토리 모달
    const hist = document.createElement('div');
    hist.id = 'bc-history-modal';
    hist.onclick = (e) => { if (e.target === hist) hist.classList.remove('open'); };
    hist.innerHTML = `
      <div class="bc-hist-box">
        <div class="bc-hist-hd">
          <h4 style="margin:0;">📋 스캔 이력</h4>
          <button class="bc-x" onclick="document.getElementById('bc-history-modal').classList.remove('open')">✕</button>
        </div>
        <div class="bc-hist-bd" id="bc-hist-bd"></div>
      </div>
    `;
    document.body.appendChild(hist);
  }

  function _promptOutboundCtx() {
    const pjNo = prompt('출고할 PJ NO 입력:');
    if (!pjNo) { _mode = 'lookup'; return; }
    const doId = prompt('출고지시서 ID (선택, 없으면 빈칸):') || '';
    _audit_ctx = { pjNo, doId };
    _toast(`출고 모드: ${pjNo}`, 'ok');
  }

  function _promptInboundCtx() {
    const model = prompt('입고 모델명:');
    if (!model) { _mode = 'lookup'; return; }
    const mfr = prompt('제조사:') || '';
    const bl = prompt('BL 번호 (선택):') || '';
    _audit_ctx = { model, mfr, bl };
    _toast(`입고 모드: ${model}`, 'ok');
  }

  // ── 토치 (모바일 플래시) ──────────────────────
  async function toggleTorch() {
    if (!_stream) return;
    const track = _stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      if (!caps.torch) { _toast('이 기기는 플래시 지원 안 함', 'warn'); return; }
      const settings = track.getSettings();
      await track.applyConstraints({ advanced: [{ torch: !settings.torch }] });
    } catch(e) {
      _toast('플래시 제어 실패: ' + e.message, 'err');
    }
  }

  // ── 히스토리 ───────────────────────────────
  function showHistory() {
    const bd = document.getElementById('bc-hist-bd');
    if (!bd) return;
    if (_history.length === 0) {
      bd.innerHTML = '<div class="bc-hist-empty">스캔 이력 없음</div>';
    } else {
      bd.innerHTML = _history.map(h => `
        <div class="bc-hist-row">
          <div style="flex:1;min-width:0;">
            <div class="code">${_e(h.code)}</div>
            <div class="detail">${_e(h.detail||'')}</div>
          </div>
          <div class="meta">
            ${_e((h.ts||'').slice(5,16).replace('T',' '))}<br>
            <span style="background:#eee;padding:1px 6px;border-radius:8px;font-size:0.92em;">${_e(h.mode)}</span>
          </div>
        </div>
      `).join('');
    }
    document.getElementById('bc-history-modal').classList.add('open');
  }

  function exportHistory() {
    if (_history.length === 0) { _toast('이력 없음', 'warn'); return; }
    const headers = ['스캔시각', '코드', '모드', '매칭타입', '상세'];
    const rows = _history.map(h => [h.ts, h.code, h.mode, h.matched, (h.detail||'').replace(/,/g,';')]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `바코드_스캔이력_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    _toast(`✅ ${_history.length}건 내보내기 완료`);
  }

  function clearHistory() {
    if (!confirm('스캔 이력을 모두 삭제할까요?')) return;
    _history = [];
    try { localStorage.removeItem(SCAN_HISTORY_KEY); } catch(e) {}
    _toast('✅ 이력 삭제됨');
    if (document.getElementById('bc-history-modal').classList.contains('open')) showHistory();
  }

  // ── 새 SN 등록 (매칭 안 됐을 때) ────────────
  function registerSN(code) {
    if (!window.sn || !window.sn.bulkAdd) { alert('SN 모듈 미로드'); return; }
    const model = prompt('모델명:');
    if (!model) return;
    const mfr = prompt('제조사 (선택):') || '';
    try {
      window.sn.bulkAdd([code], { model, mfr });
      _toast(`✅ ${code} 등록 완료`);
      _showLookupResult(code, _lookup(code));
    } catch(e) {
      _toast('❌ ' + e.message, 'err');
    }
  }

  // ── 진입 / 종료 ───────────────────────────
  async function open(mode) {
    if (mode) _mode = mode;
    _buildModal();
    document.getElementById('bc-modal').classList.add('open');
    // 모드 활성 표시
    document.querySelectorAll('#bc-modes button').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-mode') === _mode);
    });

    try {
      await _initDetector();
      await _startCamera();
      _startScanLoop();
      _toast('카메라 시작됨');
    } catch(e) {
      _toast('❌ ' + e.message, 'err');
      // result 패널에도 표시
      const r = document.getElementById('bc-result');
      if (r) r.innerHTML = `<div style="padding:20px;background:#ffebee;color:#c62828;border-radius:8px;">${_e(e.message)}</div>`;
    }
  }

  function close() {
    _stopCamera();
    document.getElementById('bc-modal')?.classList.remove('open');
    _lastScanned = '';
    _audit_ctx = null;
  }

  // ── 토구바 진입 버튼 추가 ──────────────────
  function _addToolbarButton() {
    if (document.getElementById('erp-bc-launch-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'erp-bc-launch-btn';
    btn.title = '바코드 스캐너 (모바일 카메라)';
    btn.style.cssText = [
      'background:linear-gradient(135deg,#1565c0,#0d47a1)',
      'color:#fff',
      'border:none',
      'border-radius:14px',
      'padding:6px 12px',
      'font-size:0.78em',
      'font-weight:700',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'box-shadow:0 2px 6px rgba(0,0,0,0.2)'
    ].join(';');
    btn.innerHTML = '📷 <span style="letter-spacing:-0.3px;">스캔</span>';
    btn.onclick = () => open('lookup');
    document.body.appendChild(btn);
    // toptools 컨테이너에 흡수
    if (window.toptools && typeof window.toptools.register === 'function') {
      window.toptools.register('erp-bc-launch-btn');
    }
  }

  // ── 공개 API ──────────────────────────────
  window.erpBarcode = {
    open, close,
    toggleTorch,
    showHistory, exportHistory, clearHistory,
    registerSN,
    history: () => _history.slice(),
    lookup: _lookup,
    isHTTPS: () => location.protocol === 'https:' || location.hostname === 'localhost'
  };

  // ── 부팅 ─────────────────────────────────
  function boot() {
    setTimeout(_addToolbarButton, 2500);
    console.log('[ERP-BARCODE] 바코드 스캐너 활성 — erpBarcode.open()');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
