// =====================================================
//  VENDOR QUOTES — 매입처 견적 비교 (Sprint 4 · #7)
//
//  기능
//   1) 모델별로 여러 매입사의 견적 등록
//   2) 자동 비교: 최저가/평균가/최고가 + 매입사 순위
//   3) 유효기간 추적 (만료 임박 표시)
//   4) 환율·운송비 옵션 — 단가에 부가
//   5) 견적 요청서(RFQ) 발송 — 매입사 마스터와 연동
//   6) 모델 선택 시 추천 매입사 1순위 자동 제안
//
//  데이터 키
//   erp_vendor_quotes → [
//     { id, model, mfr, vendor, vendorContact, unitPrice, currency,
//       moq, validUntil, deliveryDays, includesShipping, notes, _ts }
//   ]
//
//  공개 API: window.vendorQuotes
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_vendor_quotes';
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  const CURRENCIES = ['KRW','USD','CNY','EUR','JPY'];
  const FX_DEFAULT = { KRW:1, USD:1469, CNY:217, EUR:1580, JPY:9.7 };  // 폴백 환율

  // ── 데이터 ──────────────────────────────────────
  let quotes = [];
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      quotes = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(quotes)) quotes = [];
    } catch (e) { console.error('[vq] load 실패', e); quotes = []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(quotes)); }
    catch (e) {
      console.error('[vq] save 실패', e);
      if (typeof setBanner === 'function') setBanner('err', '❌ 견적 저장 실패');
      throw e;
    }
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _genId() { return 'VQ-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); }
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _daysUntil(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr) - new Date(_today())) / 86400000);
  }

  // 환율 조회 — market_rate 모듈 우선, 없으면 폴백
  function _fxRate(currency) {
    if (currency === 'KRW') return 1;
    try {
      if (typeof window.marketRate !== 'undefined' && window.marketRate.get) {
        const r = window.marketRate.get(currency);
        if (r && r > 0) return r;
      }
    } catch (e) {}
    return FX_DEFAULT[currency] || 1;
  }

  // 단가 → 원화 환산 (운송비/MOQ 가산 옵션)
  function _toKrw(q) {
    const base = Number(q.unitPrice) || 0;
    const fx = _fxRate(q.currency || 'KRW');
    return Math.round(base * fx);
  }

  // ── CRUD ────────────────────────────────────────
  function list() { return quotes.slice(); }
  function get(id) { return quotes.find(q => q.id === id); }

  function add(data) {
    const q = {
      id: _genId(),
      model: (data.model||'').trim(),
      mfr: data.mfr || '',
      watt: Number(data.watt) || 0,
      vendor: (data.vendor||'').trim(),
      vendorContact: data.vendorContact || '',
      unitPrice: Number(data.unitPrice) || 0,
      currency: data.currency || 'KRW',
      moq: Number(data.moq) || 0,
      validUntil: data.validUntil || '',
      deliveryDays: Number(data.deliveryDays) || 0,
      includesShipping: !!data.includesShipping,
      notes: data.notes || '',
      _ts: Date.now()
    };
    if (!q.model || !q.vendor) throw new Error('모델명·매입사 필수');
    quotes.push(q);
    save();
    return q;
  }

  function update(id, patch) {
    const i = quotes.findIndex(q => q.id === id);
    if (i < 0) return null;
    quotes[i] = { ...quotes[i], ...patch, _ts: Date.now() };
    save();
    return quotes[i];
  }

  function remove(id) {
    const i = quotes.findIndex(q => q.id === id);
    if (i < 0) return false;
    quotes.splice(i, 1);
    save();
    return true;
  }

  // ── 비교 분석 — 모델 단위 ──────────────────────────
  function compareByModel(model) {
    if (!model) return null;
    const norm = String(model).trim().toLowerCase().replace(/[\s\-_.]+/g,'');
    const matched = quotes.filter(q =>
      String(q.model||'').toLowerCase().replace(/[\s\-_.]+/g,'') === norm
    );
    if (!matched.length) return null;
    const today = _today();
    const valid = matched.filter(q => !q.validUntil || q.validUntil >= today);
    const expired = matched.filter(q => q.validUntil && q.validUntil < today);

    const withKrw = valid.map(q => ({ ...q, krwPrice: _toKrw(q) }));
    withKrw.sort((a,b) => a.krwPrice - b.krwPrice);

    const prices = withKrw.map(q => q.krwPrice).filter(p => p > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const avg = prices.length ? Math.round(prices.reduce((s,p)=>s+p,0)/prices.length) : 0;

    return {
      model,
      total: matched.length,
      validCount: valid.length,
      expiredCount: expired.length,
      min, max, avg,
      savings: max && min ? max - min : 0,
      savingsPercent: max && min ? ((max-min)/max*100).toFixed(1) : 0,
      ranked: withKrw,
      expired
    };
  }

  // 추천 매입처 — 모델별 1순위
  function recommend(model) {
    const c = compareByModel(model);
    if (!c || !c.ranked.length) return null;
    return c.ranked[0];
  }

  // ── 통계 ────────────────────────────────────────
  function summary() {
    const today = _today();
    const byModel = {};
    let validCount = 0, expiredCount = 0;
    let expiringSoon = 0;     // 7일 이내 만료
    quotes.forEach(q => {
      if (!byModel[q.model]) byModel[q.model] = 0;
      byModel[q.model]++;
      if (!q.validUntil || q.validUntil >= today) {
        validCount++;
        if (q.validUntil) {
          const d = _daysUntil(q.validUntil);
          if (d !== null && d >= 0 && d <= 7) expiringSoon++;
        }
      } else expiredCount++;
    });
    const vendors = new Set(quotes.map(q => q.vendor).filter(Boolean));
    return {
      total: quotes.length,
      validCount, expiredCount, expiringSoon,
      uniqueModels: Object.keys(byModel).length,
      uniqueVendors: vendors.size,
      byModel
    };
  }

  // 모델 목록 (중복 제거)
  function uniqueModels() {
    return Array.from(new Set(quotes.map(q => q.model).filter(Boolean))).sort();
  }

  // ── UI ──────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-vq-modal')) return;
    const css = `
      #erp-vq-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-vq-modal.open{display:flex;}
      .vq-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1300px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .vq-hd{padding:14px 18px;background:#0d47a1;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .vq-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .vq-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;}
      .vq-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .vq-stat-l{font-size:0.74em;color:#666;text-transform:uppercase;font-weight:700;}
      .vq-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .vq-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .vq-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .vq-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .vq-tbl tr.expired{opacity:0.5;}
      .vq-tbl tr.best{background:#e8f5e9;}
      .vq-tbl tr.best td{font-weight:700;}
      .vq-rank{display:inline-block;width:22px;height:22px;border-radius:50%;background:#1a1a2e;color:#fff;text-align:center;font-size:0.78em;font-weight:800;line-height:22px;}
      .vq-rank-1{background:linear-gradient(135deg,#ffd700,#ffa000);}
      .vq-rank-2{background:linear-gradient(135deg,#c0c0c0,#888);}
      .vq-rank-3{background:linear-gradient(135deg,#cd7f32,#8d4925);}
      .vq-form{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;background:#fff;padding:16px;border-radius:8px;}
      .vq-form-full{grid-column:span 3;}
      .vq-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:4px;}
      .vq-form input, .vq-form select, .vq-form textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}
      .vq-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .vq-tab{padding:8px 16px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.86em;}
      .vq-tab.active{background:#0d47a1;color:#fff;border-color:#0d47a1;font-weight:700;}
      .vq-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .vq-btn-primary{background:#0d47a1;color:#fff;}
      .vq-btn-success{background:#27ae60;color:#fff;}
      .vq-btn-danger{background:#c62828;color:#fff;}
      .vq-btn-ghost{background:#fff;color:#555;border:1px solid #ccc;}
      .vq-savings-box{background:linear-gradient(135deg,#fffde7,#fff8e1);border:2px solid #f9a825;border-radius:10px;padding:14px;margin:14px 0;}
      .vq-expire-warn{background:#ffebee;color:#c62828;padding:2px 6px;border-radius:4px;font-size:0.74em;font-weight:700;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-vq-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-vq-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="vq-box">
        <div class="vq-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">매입처 견적 비교</h4>
        </div>
        <div class="vq-bd" id="vq-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    // ★ 위임 핸들러 — modal 과 box 모두에 부착 (탭 마운트 시 box 가 분리됨)
    modal.addEventListener('click', _onModalClick);
    const box = modal.querySelector('.vq-box');
    if (box) box.addEventListener('click', _onModalClick);
  }

  let _tab = 'compare';   // compare | list | new
  let _selectedModel = '';

  function _renderTabs() {
    const tabs = `
      <div class="vq-tabs">
        <button class="vq-tab ${_tab==='compare'?'active':''}" data-tab="compare">📊 모델별 비교</button>
        <button class="vq-tab ${_tab==='list'?'active':''}" data-tab="list">📋 전체 견적</button>
      </div>`;
    return tabs;
  }

  function _renderCompare() {
    const s = summary();
    const models = uniqueModels();
    const selected = _selectedModel || (models[0] || '');
    const c = selected ? compareByModel(selected) : null;

    const html = `
      ${_renderTabs()}
      <div class="vq-stats">
        <div class="vq-stat"><div class="vq-stat-l">전체 견적</div><div class="vq-stat-v">${s.total}건</div></div>
        <div class="vq-stat"><div class="vq-stat-l">유효</div><div class="vq-stat-v" style="color:#27ae60;">${s.validCount}</div></div>
        <div class="vq-stat"><div class="vq-stat-l">만료</div><div class="vq-stat-v" style="color:#888;">${s.expiredCount}</div></div>
        <div class="vq-stat"><div class="vq-stat-l">만료 임박 (D-7)</div><div class="vq-stat-v" style="color:#c62828;">${s.expiringSoon}</div></div>
        <div class="vq-stat"><div class="vq-stat-l">등록 모델</div><div class="vq-stat-v">${s.uniqueModels}</div></div>
        <div class="vq-stat"><div class="vq-stat-l">매입사</div><div class="vq-stat-v">${s.uniqueVendors}</div></div>
      </div>

      <div style="background:#fff;padding:12px;border-radius:8px;margin-bottom:14px;display:flex;align-items:center;gap:10px;">
        <strong>모델 선택:</strong>
        <select id="vq-model-select" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:6px;">
          <option value="">— 모델을 선택하세요 —</option>
          ${models.map(m => `<option value="${_ea(m)}" ${m===selected?'selected':''}>${_e(m)}</option>`).join('')}
        </select>
        <button class="vq-btn vq-btn-primary" data-act="vq-new">새 견적</button>
      </div>

      ${c ? `
        <div class="vq-savings-box">
          <div style="display:flex;justify-content:space-around;text-align:center;">
            <div><div style="font-size:0.78em;color:#666;">최저가</div><div style="font-size:1.4em;font-weight:900;color:#27ae60;">${_fmt(c.min)}원</div></div>
            <div><div style="font-size:0.78em;color:#666;">평균가</div><div style="font-size:1.4em;font-weight:900;color:#1a1a2e;">${_fmt(c.avg)}원</div></div>
            <div><div style="font-size:0.78em;color:#666;">최고가</div><div style="font-size:1.4em;font-weight:900;color:#c62828;">${_fmt(c.max)}원</div></div>
            <div><div style="font-size:0.78em;color:#666;">최대 절감</div><div style="font-size:1.4em;font-weight:900;color:#7b1fa2;">${_fmt(c.savings)}원<span style="font-size:0.6em;color:#888;"> (${c.savingsPercent}%)</span></div></div>
          </div>
        </div>

        <table class="vq-tbl">
          <thead><tr>
            <th>순위</th><th>매입사</th><th>제조사</th><th style="text-align:right;">단가</th>
            <th>통화</th><th style="text-align:right;">원화 환산</th><th>MOQ</th><th>납기일</th><th>유효기간</th><th>액션</th>
          </tr></thead>
          <tbody>
            ${c.ranked.map((q, i) => {
              const expDays = q.validUntil ? _daysUntil(q.validUntil) : null;
              const warn = expDays !== null && expDays >= 0 && expDays <= 7
                ? `<span class="vq-expire-warn">D-${expDays}</span>` : '';
              return `<tr class="${i===0?'best':''}">
                <td><span class="vq-rank vq-rank-${i+1}">${i+1}</span></td>
                <td style="font-weight:700;">${_e(q.vendor)}${q.vendorContact?'<br><span style="font-size:0.74em;color:#888;">'+_e(q.vendorContact)+'</span>':''}</td>
                <td>${_e(q.mfr||'-')}</td>
                <td style="text-align:right;font-weight:700;">${_fmt(q.unitPrice)}</td>
                <td><strong>${_e(q.currency)}</strong></td>
                <td style="text-align:right;font-weight:700;color:#0d47a1;">${_fmt(q.krwPrice)}원</td>
                <td>${q.moq?_fmt(q.moq)+'매':'-'}</td>
                <td>${q.deliveryDays?q.deliveryDays+'일':'-'}</td>
                <td>${_e(q.validUntil||'-')} ${warn}</td>
                <td>
                  <button class="vq-btn vq-btn-ghost" data-act="vq-edit" data-id="${_ea(q.id)}">📝</button>
                  <button class="vq-btn vq-btn-danger" data-act="vq-delete" data-id="${_ea(q.id)}">🗑</button>
                </td>
              </tr>`;
            }).join('')}
            ${c.expired.length ? `<tr><td colspan="10" style="background:#f5f5f5;color:#888;text-align:center;font-size:0.84em;">만료된 견적 ${c.expired.length}건 (보기 위해선 [전체 견적] 탭 사용)</td></tr>` : ''}
          </tbody>
        </table>
      ` : `<div style="background:#fff;padding:40px;text-align:center;color:#bbb;border-radius:8px;">${models.length===0?'등록된 견적이 없습니다. [견적 등록] 버튼을 클릭하세요.':'위에서 모델을 선택하세요.'}</div>`}
    `;
    document.getElementById('vq-bd').innerHTML = html;

    document.getElementById('vq-model-select')?.addEventListener('change', e => {
      _selectedModel = e.target.value;
      _renderCompare();
    });
  }

  function _renderListAll() {
    const all = quotes.slice().sort((a,b) => (b._ts||0) - (a._ts||0));
    const today = _today();

    const html = `
      ${_renderTabs()}
      <div style="margin-bottom:8px;">
        <button class="vq-btn vq-btn-primary" data-act="vq-new">견적 등록</button>
      </div>
      <table class="vq-tbl">
        <thead><tr>
          <th>모델</th><th>제조사</th><th>매입사</th><th style="text-align:right;">단가</th>
          <th>통화</th><th style="text-align:right;">원화</th><th>MOQ</th><th>유효기간</th><th>등록일</th><th>액션</th>
        </tr></thead>
        <tbody>
          ${all.length === 0
            ? '<tr><td colspan="10" style="padding:30px;text-align:center;color:#bbb;">등록된 견적 없음</td></tr>'
            : all.map(q => {
              const expired = q.validUntil && q.validUntil < today;
              const expDays = q.validUntil ? _daysUntil(q.validUntil) : null;
              const warn = !expired && expDays !== null && expDays >= 0 && expDays <= 7
                ? `<span class="vq-expire-warn">D-${expDays}</span>` : '';
              return `<tr class="${expired?'expired':''}">
                <td style="font-weight:700;">${_e(q.model)}</td>
                <td>${_e(q.mfr||'-')}</td>
                <td>${_e(q.vendor)}</td>
                <td style="text-align:right;font-weight:700;">${_fmt(q.unitPrice)}</td>
                <td>${_e(q.currency)}</td>
                <td style="text-align:right;color:#0d47a1;">${_fmt(_toKrw(q))}</td>
                <td>${q.moq?_fmt(q.moq):'-'}</td>
                <td>${_e(q.validUntil||'-')} ${expired?'<span class="vq-expire-warn">만료</span>':warn}</td>
                <td>${q._ts?new Date(q._ts).toISOString().slice(0,10):'-'}</td>
                <td>
                  <button class="vq-btn vq-btn-ghost" data-act="vq-edit" data-id="${_ea(q.id)}">📝</button>
                  <button class="vq-btn vq-btn-danger" data-act="vq-delete" data-id="${_ea(q.id)}">🗑</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>`;
    document.getElementById('vq-bd').innerHTML = html;
  }

  function _renderEditor(id) {
    const q = id ? get(id) : {
      id: null, model: _selectedModel || '', mfr: '', watt: 0,
      vendor: '', vendorContact: '', unitPrice: 0, currency: 'KRW',
      moq: 0, validUntil: '', deliveryDays: 0, includesShipping: false, notes: ''
    };
    // 매입사 마스터 활용 (있으면 datalist)
    let vendorDatalist = '';
    if (typeof vendorMaster !== 'undefined' && vendorMaster.raw) {
      try {
        const vendors = Object.keys(vendorMaster.raw());
        vendorDatalist = `<datalist id="vq-vendor-list">${vendors.map(v => `<option value="${_ea(v)}">`).join('')}</datalist>`;
      } catch (e) {}
    }

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#0d47a1;">${id ? '견적 편집' : '새 견적 등록'}</h3>
        <div>
          <button class="vq-btn vq-btn-ghost" data-act="vq-back">← 비교 화면</button>
          <button class="vq-btn vq-btn-primary" data-act="vq-save" data-id="${_ea(q.id||'')}">💾 저장</button>
        </div>
      </div>
      ${vendorDatalist}
      <div class="vq-form" id="vq-form">
        <div class="vq-form-full"><label>모델명 *</label><input data-field="model" value="${_ea(q.model)}" placeholder="JKM635N-78HL4-BDV-S1"></div>
        <div><label>제조사</label><input data-field="mfr" value="${_ea(q.mfr)}" placeholder="진코솔라"></div>
        <div><label>제품용량 (Wp)</label><input data-field="watt" type="number" value="${q.watt||0}"></div>
        <div></div>
        <div><label>매입사 *</label><input data-field="vendor" value="${_ea(q.vendor)}" ${vendorDatalist?'list="vq-vendor-list"':''} placeholder="에스케이쉴더스"></div>
        <div class="vq-form-full"><label>매입사 연락처/담당자</label><input data-field="vendorContact" value="${_ea(q.vendorContact)}" placeholder="홍길동 010-1234-5678"></div>
        <div><label>단가</label><input data-field="unitPrice" type="number" step="0.01" value="${q.unitPrice||0}"></div>
        <div><label>통화</label><select data-field="currency">
          ${CURRENCIES.map(c => `<option value="${c}" ${c===q.currency?'selected':''}>${c}</option>`).join('')}
        </select></div>
        <div><label>MOQ (최소수량)</label><input data-field="moq" type="number" value="${q.moq||0}"></div>
        <div><label>유효기간 (만료일)</label><input data-field="validUntil" type="date" value="${_ea(q.validUntil)}"></div>
        <div><label>납기일 (영업일)</label><input data-field="deliveryDays" type="number" value="${q.deliveryDays||0}"></div>
        <div><label><input data-field="includesShipping" type="checkbox" ${q.includesShipping?'checked':''}> 단가에 운송비 포함</label></div>
        <div class="vq-form-full"><label>비고</label><textarea data-field="notes" rows="3">${_e(q.notes)}</textarea></div>
      </div>`;
    document.getElementById('vq-bd').innerHTML = html;
  }

  function _collectForm() {
    const data = {};
    document.querySelectorAll('#vq-form [data-field]').forEach(el => {
      const k = el.getAttribute('data-field');
      if (el.type === 'checkbox') data[k] = el.checked;
      else if (el.type === 'number') data[k] = Number(el.value)||0;
      else data[k] = el.value;
    });
    return data;
  }

  function _saveFromForm(id) {
    const data = _collectForm();
    if (!data.model) { alert('모델명 필수'); return; }
    if (!data.vendor) { alert('매입사 필수'); return; }
    if (!data.unitPrice || data.unitPrice <= 0) { alert('단가는 0보다 커야 함'); return; }
    try {
      if (id) {
        update(id, data);
        if (typeof setBanner === 'function') setBanner('ok', '✅ 견적 수정');
      } else {
        const q = add(data);
        _selectedModel = q.model;
        if (typeof setBanner === 'function') setBanner('ok', `✅ 견적 등록 — ${q.model} / ${q.vendor}`);
      }
      _tab = 'compare';
      _renderCompare();
    } catch (err) { alert('저장 실패: ' + err.message); }
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act],[data-tab]');
    if (!btn) return;
    if (btn.hasAttribute('data-tab')) {
      _tab = btn.getAttribute('data-tab');
      _render();
      return;
    }
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    if (act === 'vq-new') { _tab = 'new'; _renderEditor(null); }
    else if (act === 'vq-edit') { _tab = 'new'; _renderEditor(id); }
    else if (act === 'vq-back') { _tab = 'compare'; _renderCompare(); }
    else if (act === 'vq-save') _saveFromForm(id || null);
    else if (act === 'vq-delete') {
      if (!confirm('견적을 삭제하시겠습니까?')) return;
      remove(id);
      _render();
    }
  }

  function _render() {
    if (_tab === 'compare') _renderCompare();
    else if (_tab === 'list') _renderListAll();
    else if (_tab === 'new') _renderEditor(null);
  }

  function open(modelHint) {
    _injectUI();
    if (modelHint) _selectedModel = modelHint;
    _tab = 'compare';
    // ★ 2026-05-12 영업 탭(salesops)의 견적비교 서브탭으로 이동됨 (입고관리 → 영업)
    if (typeof window.setSalesOpsSubtab === 'function'
        && document.getElementById('vendorQuotesTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('salesops'); } catch(e) {}
      }
      setTimeout(() => window.setSalesOpsSubtab('compare'), 30);
      return;
    }
    document.getElementById('erp-vq-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() { document.getElementById('erp-vq-modal')?.classList.remove('open'); }

  // ── 탭 마운트 (입고관리 탭의 vendorQuotesTabHost 로 box 이동) ──
  function _mountToTab() {
    const host = document.getElementById('vendorQuotesTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-vq-modal');
    if (!modal) { try { _injectUI(); } catch(e){ console.error('[vendorQuotes] _injectUI 실패:', e); return; } modal = document.getElementById('erp-vq-modal'); if (!modal) return; }
    const box = modal.querySelector('.vq-box');
    if (!box) return;
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (!host.contains(box)) {
      host.appendChild(box);
      // 탭 환경에 맞게 모달 스타일 조정
      box.style.maxHeight = 'none';
      box.style.width = '100%';
      box.style.maxWidth = '100%';
      box.style.boxShadow = 'none';
      box.style.borderRadius = '12px';
    }
    setTimeout(_render, 30);
  }

  // ── 공개 API ────────────────────────────────────
  window.vendorQuotes = {
    list, get, add, update, remove,
    compareByModel, recommend, summary, uniqueModels,
    open, close, reload: load,
    _mountToTab
  };

  // ── 부팅 ───────────────────────────────────────
  function boot() { load(); setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-VQ] 매입처 견적 비교 활성 — vendorQuotes.open() 또는 vendorQuotes.recommend("모델명")');
})();
