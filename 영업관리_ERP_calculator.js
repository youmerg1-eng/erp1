// =====================================================
//  CAPACITY CALCULATOR — Phase D · Day 1
//  용량 ↔ 장수 ↔ PLT ↔ 트럭 양방향 환산
//
//  영업 핵심 도구 — 통화 중 즉시 환산 가능
//
//  공식
//   용량(kW) = 장수 × Wp / 1000
//   PLT      = floor(장수 / 파렛트당 장수)
//   소분장수 = 장수 % 파렛트당 장수
//   트럭     = ceil(PLT / 트럭당 PLT)
//
//  콘솔: erpCalc.open() / erpCalc.compute(model, qty)
// =====================================================
(function() {
  'use strict';

  const TRUCK_PLT_DEFAULT = 7;      // 트럭당 PLT 기본값 (5톤 장축 기준 6~8 PLT)
  const SETTING_KEY = 'erp_calc_settings';
  let settings = { truckPlt: TRUCK_PLT_DEFAULT };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTING_KEY)||'{}')); } catch(e) {}

  function compute({model, watt, qty, kw, pltSize, truckPlt}) {
    truckPlt = truckPlt || settings.truckPlt || TRUCK_PLT_DEFAULT;
    // 모델명 → productMaster에서 watt/plt 자동
    if (model && typeof productMaster !== 'undefined' && productMaster[model]) {
      const m = productMaster[model];
      if (!watt) watt = Number(m.watt) || 0;
      if (!pltSize) pltSize = Number(m.plt) || 0;
    }
    watt = Number(watt) || 0;
    qty = Number(qty) || 0;
    kw = Number(kw) || 0;
    pltSize = Number(pltSize) || 0;

    const result = { watt, pltSize, truckPlt, qty: 0, kw: 0, plt: 0, looseQty: 0, trucks: 0, fullTrucks: 0, partialPlt: 0 };
    if (watt <= 0) return result;

    // 양방향: qty 우선, 없으면 kw에서 역산
    if (qty > 0) {
      result.qty = qty;
      result.kw = (qty * watt) / 1000;
    } else if (kw > 0) {
      result.kw = kw;
      result.qty = Math.round((kw * 1000) / watt);
    }

    if (pltSize > 0 && result.qty > 0) {
      result.plt = Math.floor(result.qty / pltSize);
      result.looseQty = result.qty - result.plt * pltSize;
      // 트럭 (소분도 1트럭 차지)
      const totalPlt = result.plt + (result.looseQty > 0 ? 1 : 0);
      result.fullTrucks = Math.floor(result.plt / truckPlt);
      result.partialPlt = totalPlt - result.fullTrucks * truckPlt;
      result.trucks = Math.ceil(totalPlt / truckPlt);
    }
    return result;
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-calc-fab')) return;
    const css = `
      #erp-calc-fab{position:fixed;bottom:18px;right:290px;width:44px;height:44px;border-radius:50%;
        background:#f9a825;color:#1a1a2e;border:none;cursor:pointer;font-size:20px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;font-weight:700;}
      #erp-calc-fab:hover{background:#f57f17;transform:scale(1.07);}
      #erp-calc-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:flex-end;padding:18px;}
      #erp-calc-modal.open{display:flex;}
      .calc-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:340px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;}
      .calc-hd{padding:12px 16px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .calc-hd h4{margin:0;font-size:0.95em;font-weight:700;}
      .calc-bd{flex:1;overflow-y:auto;padding:14px 16px;font-size:0.86em;}
      .calc-row{margin-bottom:10px;}
      .calc-lbl{font-size:0.78em;color:#666;font-weight:600;margin-bottom:3px;display:block;}
      .calc-input{width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:7px;font-size:1em;box-sizing:border-box;font-family:inherit;}
      .calc-input.readonly{background:#f5f5f5;color:#888;}
      .calc-input.active-input{border-color:#f9a825;background:#fffde7;}
      .calc-input-group{display:flex;align-items:stretch;gap:6px;}
      .calc-input-group .calc-input{flex:1;}
      .calc-input-group .unit{padding:8px 10px;background:#fafafa;border:1.5px solid #ddd;border-left:none;border-radius:0 7px 7px 0;font-size:0.86em;color:#666;}
      .calc-input-group .calc-input{border-radius:7px 0 0 7px;}
      .calc-tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.7em;font-weight:700;margin-left:4px;}
      .calc-tag.input{background:#e3f2fd;color:#1565c0;}
      .calc-swap{text-align:center;margin:4px 0;}
      .calc-swap button{background:none;border:1px solid #ddd;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px;color:#888;}
      .calc-swap button:hover{background:#f5f5f5;color:#1a1a2e;}
      .calc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
      .calc-result{background:linear-gradient(135deg,#fffde7,#fff3e0);border-radius:10px;padding:12px 14px;margin-top:8px;border-left:4px solid #f9a825;}
      .calc-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
      .calc-result-item{}
      .calc-result-l{font-size:0.74em;color:#888;font-weight:600;margin-bottom:2px;}
      .calc-result-v{font-size:1.4em;font-weight:900;color:#1a1a2e;}
      .calc-result-sub{font-size:0.74em;color:#666;margin-top:1px;}
      .calc-suggest{position:absolute;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.15);max-height:180px;overflow-y:auto;z-index:9501;width:300px;}
      .calc-suggest div{padding:6px 10px;cursor:pointer;font-size:0.86em;border-bottom:1px solid #f0f0f0;}
      .calc-suggest div:hover{background:#fffde7;}
      .calc-ft{padding:8px 16px;background:#fafafa;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:0.78em;color:#888;}
      .calc-ft button{background:transparent;border:1px solid #ddd;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:0.84em;}
      .calc-active{background:#f9a825 !important;color:#fff !important;font-weight:700;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-calc-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-calc-fab';
    fab.title = '용량 ↔ 장수 변환 계산기';
    fab.textContent = '🧮';
    fab.onclick = open;
    document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-calc-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="calc-box">
        <div class="calc-hd">
          <h4>🧮 장수 → PLT · 트럭</h4>
          <button onclick="document.getElementById('erp-calc-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="calc-bd">
          <div class="calc-row">
            <label class="calc-lbl">장수 (EA) <span class="calc-tag input">입력</span></label>
            <input class="calc-input active-input" id="calc-qty" type="number" placeholder="예: 365">
          </div>
          <div class="calc-grid2">
            <div class="calc-row">
              <label class="calc-lbl">파렛트당 장수</label>
              <input class="calc-input" id="calc-plt" type="number" placeholder="36">
            </div>
            <div class="calc-row">
              <label class="calc-lbl">트럭당 파렛트</label>
              <input class="calc-input" id="calc-truck-plt" type="number" placeholder="${TRUCK_PLT_DEFAULT}">
            </div>
          </div>
          <div class="calc-result">
            <div class="calc-result-grid">
              <div class="calc-result-item">
                <div class="calc-result-l">📦 파렛트</div>
                <div class="calc-result-v" id="calc-r-plt">- <span style="font-size:0.6em;color:#888;">PLT</span></div>
                <div class="calc-result-sub" id="calc-r-plt-sub"></div>
              </div>
              <div class="calc-result-item">
                <div class="calc-result-l">🚚 트럭</div>
                <div class="calc-result-v" id="calc-r-truck">- <span style="font-size:0.6em;color:#888;">대</span></div>
                <div class="calc-result-sub" id="calc-r-truck-sub"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="calc-ft">
          <span style="font-size:0.78em;color:#888;">장수 ÷ 파렛트당 = PLT · PLT ÷ 트럭당 = 트럭 수</span>
          <button onclick="erpCalc._reset()">초기화</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // 입력 이벤트 (간소화 — 장수·PLT·트럭당PLT만)
    ['calc-qty','calc-plt','calc-truck-plt'].forEach(id => {
      document.getElementById(id).addEventListener('input', _recalc);
    });
  }

  function _reset() {
    ['calc-qty','calc-plt','calc-truck-plt'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('calc-r-plt').innerHTML = '- <span style="font-size:0.6em;color:#888;">PLT</span>';
    document.getElementById('calc-r-truck').innerHTML = '- <span style="font-size:0.6em;color:#888;">대</span>';
    document.getElementById('calc-r-plt-sub').textContent = '';
    document.getElementById('calc-r-truck-sub').textContent = '';
  }

  function _recalc() {
    const qty = parseFloat(document.getElementById('calc-qty').value) || 0;
    const pltSize = parseFloat(document.getElementById('calc-plt').value) || 0;
    const truckPlt = parseFloat(document.getElementById('calc-truck-plt').value) || settings.truckPlt;

    const r = compute({ watt: 1, qty, pltSize, truckPlt });   // watt는 PLT/트럭 계산엔 영향 없음

    const pltEl = document.getElementById('calc-r-plt');
    const truckEl = document.getElementById('calc-r-truck');
    const pltSub = document.getElementById('calc-r-plt-sub');
    const truckSub = document.getElementById('calc-r-truck-sub');
    if (r.qty > 0 && r.pltSize > 0) {
      pltEl.innerHTML = `<span style="color:#1a1a2e;">${r.plt + (r.looseQty?' + 소분':'')}</span> <span style="font-size:0.6em;color:#888;">PLT</span>`;
      pltSub.textContent = `${r.plt}PLT${r.looseQty?' + '+r.looseQty+'장':''}`;
    } else {
      pltEl.innerHTML = '- <span style="font-size:0.6em;color:#888;">PLT</span>';
      pltSub.textContent = r.qty > 0 && r.pltSize === 0 ? '⚠️ 파렛트당 장수 미입력' : '';
    }
    if (r.trucks > 0) {
      truckEl.innerHTML = `<span style="color:#1a1a2e;">${r.trucks}</span> <span style="font-size:0.6em;color:#888;">대</span>`;
      truckSub.textContent = r.fullTrucks > 0 ? `${r.fullTrucks}대 만차 + ${r.partialPlt}PLT` : `${r.partialPlt}PLT`;
    } else {
      truckEl.innerHTML = '- <span style="font-size:0.6em;color:#888;">대</span>';
      truckSub.textContent = '';
    }

    if (truckPlt && truckPlt !== settings.truckPlt) {
      settings.truckPlt = truckPlt;
      try { localStorage.setItem(SETTING_KEY, JSON.stringify(settings)); } catch(e) {}
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-calc-modal').classList.add('open');
    setTimeout(() => document.getElementById('calc-qty')?.focus(), 30);
  }

  function close() {
    document.getElementById('erp-calc-modal')?.classList.remove('open');
  }

  // ── 공개 API ────────────────────────────────────────
  window.erpCalc = {
    open, close, compute,
    _reset
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-CALC] 용량 계산기 활성 — 우측 하단 🧮 또는 erpCalc.open()');
})();
