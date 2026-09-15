// =====================================================
//  WAREHOUSE RENTAL — 창고 임대 계약 + 월 청구 (Phase 3)
//
//  기능
//   1) 임대 계약 등록 — 창고 마스터의 zone에 임차인 연결
//   2) 월 단가 (m²당 원) × 면적 = 월 임대료 자동 계산
//   3) 매월 자동 청구서 생성 (notify trigger 연동)
//   4) 만료 D-30 알림 + 자동 연장 옵션
//   5) 보증금·관리비 별도 추적
//
//  데이터 키
//   erp_rentals      — 임대 계약
//   erp_rentals_inv  — 월 청구서
//
//  회계 분류: 임대 수익 = 영업외수익 (사용자 요청)
//  공개 API: window.warehouseRental
// =====================================================
(function() {
  'use strict';

  const KEY_RENTALS = 'erp_rentals';
  const KEY_INVOICES = 'erp_rentals_inv';

  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => {
      window.erpSafety.protect(KEY_RENTALS);
      window.erpSafety.protect(KEY_INVOICES);
    }, 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _genId(p) { return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,5); }
  function _addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  }
  function _daysUntil(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr) - new Date(_today())) / 86400000);
  }

  // ── 데이터 로드/저장 ──────────────────────────────
  let rentals = [], invoices = [];
  function _load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function _save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (e) {
      console.error('[rental] save 실패', e);
      throw e;
    }
  }
  function loadAll() {
    rentals = _load(KEY_RENTALS, []);
    invoices = _load(KEY_INVOICES, []);
    if (!Array.isArray(rentals)) rentals = [];
    if (!Array.isArray(invoices)) invoices = [];
  }

  // ── 계약 CRUD ────────────────────────────────────
  function listRentals(filter) {
    filter = filter || {};
    return rentals.filter(r => {
      if (filter.status && r.status !== filter.status) return false;
      if (filter.tenantName && !r.tenantName.includes(filter.tenantName)) return false;
      return true;
    });
  }

  function getRental(id) { return rentals.find(r => r.id === id); }

  function addRental(data) {
    const r = {
      id: _genId('RT'),
      contractNo: data.contractNo || ('R-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + (rentals.length+1).toString().padStart(3,'0')),
      // 임차인
      tenantName: data.tenantName || '',
      tenantBizNo: data.tenantBizNo || '',
      tenantContact: data.tenantContact || '',
      tenantPhone: data.tenantPhone || '',
      tenantEmail: data.tenantEmail || '',
      // 임대 위치 (warehouseMaster zone 연결)
      warehouseId: data.warehouseId || '',
      zoneId: data.zoneId || '',
      warehouseName: data.warehouseName || '',
      zoneName: data.zoneName || '',
      // 임대 조건
      area: Number(data.area) || 0,                      // m²
      ratePerSqm: Number(data.ratePerSqm) || 0,          // m²당 월 임대료
      monthlyRent: Number(data.monthlyRent) || 0,        // 월 임대료 (자동 계산 또는 수동)
      managementFee: Number(data.managementFee) || 0,    // 월 관리비
      mgmtVatIncluded: !!data.mgmtVatIncluded,            // ★ 관리비 VAT 포함 여부
      deposit: Number(data.deposit) || 0,                // 보증금
      // 계약 기간
      contractStart: data.contractStart || _today(),
      contractEnd: data.contractEnd || _addMonths(_today(), 24),
      // 결제
      paymentDay: Number(data.paymentDay) || 5,          // 매월 N일
      vatIncluded: !!data.vatIncluded,
      // 자동 연장
      autoRenew: !!data.autoRenew,
      renewMonths: Number(data.renewMonths) || 12,
      // 상태
      status: data.status || '계약중',                   // 계약중 / 만료예정 / 만료 / 해지
      depositPaidDate: data.depositPaidDate || null,
      depositReturnedDate: data.depositReturnedDate || null,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      _ts: Date.now()
    };
    // 월 임대료 자동 계산 (수동 입력 안 했을 때)
    if (!r.monthlyRent && r.area && r.ratePerSqm) {
      r.monthlyRent = r.area * r.ratePerSqm;
    }
    rentals.push(r);
    _save(KEY_RENTALS, rentals);
    // warehouse zone 의 rentalId 업데이트
    if (typeof window.warehouseMaster !== 'undefined' && r.warehouseId && r.zoneId) {
      try {
        window.warehouseMaster.updateZone(r.warehouseId, r.zoneId, {
          type: 'rented', rentalId: r.id
        });
      } catch (e) { console.warn('[rental] zone 연결 실패', e); }
    }
    return r;
  }

  function updateRental(id, patch) {
    const i = rentals.findIndex(r => r.id === id);
    if (i < 0) return null;
    rentals[i] = { ...rentals[i], ...patch, _ts: Date.now() };
    _save(KEY_RENTALS, rentals);
    return rentals[i];
  }

  function removeRental(id) {
    const r = getRental(id);
    if (!r) return false;
    if (!confirm(`임대 계약 ${r.contractNo} (${r.tenantName})을 삭제합니까?\n관련 청구서는 보존됩니다.`)) return false;
    rentals = rentals.filter(r => r.id !== id);
    _save(KEY_RENTALS, rentals);
    // warehouse zone 해제
    if (typeof window.warehouseMaster !== 'undefined' && r.warehouseId && r.zoneId) {
      try {
        window.warehouseMaster.updateZone(r.warehouseId, r.zoneId, {
          type: 'free', rentalId: null
        });
      } catch (e) {}
    }
    return true;
  }

  // 만료 임박 자동 status 갱신 (D-30 이내 → '만료예정')
  function _autoUpdateStatus() {
    let changed = 0;
    rentals.forEach(r => {
      if (r.status === '해지' || r.status === '만료') return;
      const days = _daysUntil(r.contractEnd);
      if (days === null) return;
      if (days < 0 && r.status !== '만료') {
        r.status = '만료';
        changed++;
      } else if (days >= 0 && days <= 30 && r.status !== '만료예정') {
        r.status = '만료예정';
        changed++;
      } else if (days > 30 && r.status === '만료예정') {
        r.status = '계약중';
        changed++;
      }
    });
    if (changed) _save(KEY_RENTALS, rentals);
    return changed;
  }

  // ── 월 청구서 ────────────────────────────────────
  function listInvoices(rentalId) {
    return rentalId ? invoices.filter(i => i.rentalId === rentalId) : invoices.slice();
  }

  function generateMonthlyInvoice(rentalId, yearMonth) {
    const r = getRental(rentalId);
    if (!r) throw new Error('계약 없음');
    yearMonth = yearMonth || _today().slice(0,7);
    // 이미 발행됐는지 확인
    const exists = invoices.find(i => i.rentalId === rentalId && i.billingMonth === yearMonth);
    if (exists) return { existing: true, invoice: exists };

    // ★ 임대료 / 관리비 각각 VAT 포함 여부 확인
    //   VAT 포함 = 입력값이 이미 VAT 포함된 가격 (별도 가산 X)
    //   VAT 미포함 = 입력값에 10% 추가
    const rentNet = r.monthlyRent || 0;
    const mgmtNet = r.managementFee || 0;
    const rentVat = r.vatIncluded ? 0 : Math.round(rentNet * 0.1);
    const mgmtVat = r.mgmtVatIncluded ? 0 : Math.round(mgmtNet * 0.1);
    const vat = rentVat + mgmtVat;
    const subtotal = rentNet + mgmtNet;
    const total = subtotal + vat;
    const paymentDay = r.paymentDay || 5;
    const dueDate = `${yearMonth}-${String(paymentDay).padStart(2,'0')}`;

    const inv = {
      id: _genId('RI'),
      rentalId,
      contractNo: r.contractNo,
      tenantName: r.tenantName,
      billingMonth: yearMonth,
      rentAmount: rentNet,
      mgmtAmount: mgmtNet,
      rentVat,                              // ★ 임대료 VAT
      mgmtVat,                              // ★ 관리비 VAT
      rentVatIncluded: !!r.vatIncluded,
      mgmtVatIncluded: !!r.mgmtVatIncluded,
      subtotal,
      vat,
      total,
      issueDate: _today(),
      dueDate,
      paidDate: null,
      status: '발행',
      invoiceNo: 'WR-' + yearMonth.replace('-','') + '-' + (invoices.filter(i => i.billingMonth === yearMonth).length+1).toString().padStart(3,'0'),
      createdAt: new Date().toISOString()
    };
    invoices.push(inv);
    _save(KEY_INVOICES, invoices);
    return { existing: false, invoice: inv };
  }

  // 모든 활성 계약에 대해 이번 달 청구서 자동 발행
  function generateAllForMonth(yearMonth) {
    yearMonth = yearMonth || _today().slice(0,7);
    const results = { issued: [], existed: [], failed: [] };
    listRentals({}).filter(r => r.status === '계약중' || r.status === '만료예정').forEach(r => {
      try {
        const result = generateMonthlyInvoice(r.id, yearMonth);
        if (result.existing) results.existed.push(result.invoice);
        else results.issued.push(result.invoice);
      } catch (err) {
        results.failed.push({ rental: r.contractNo, error: err.message });
      }
    });
    return results;
  }

  function markPaid(invoiceId, paidDate) {
    const i = invoices.findIndex(v => v.id === invoiceId);
    if (i < 0) return null;
    invoices[i].paidDate = paidDate || _today();
    invoices[i].status = '입금완료';
    _save(KEY_INVOICES, invoices);
    return invoices[i];
  }

  function removeInvoice(id) {
    invoices = invoices.filter(i => i.id !== id);
    _save(KEY_INVOICES, invoices);
    return true;
  }

  // ── 통계 ────────────────────────────────────────
  function summary() {
    _autoUpdateStatus();
    const active = rentals.filter(r => r.status === '계약중' || r.status === '만료예정').length;
    const expiringSoon = rentals.filter(r => r.status === '만료예정').length;
    const expired = rentals.filter(r => r.status === '만료').length;
    const monthlyRecurring = rentals
      .filter(r => r.status === '계약중' || r.status === '만료예정')
      .reduce((s, r) => s + (r.monthlyRent||0) + (r.managementFee||0), 0);
    const totalDeposit = rentals.reduce((s, r) => s + (r.deposit||0), 0);
    const thisMonth = _today().slice(0,7);
    const thisMonthIssued = invoices
      .filter(i => i.billingMonth === thisMonth)
      .reduce((s, i) => s + (i.total||0), 0);
    const unpaidTotal = invoices
      .filter(i => i.status === '발행')
      .reduce((s, i) => s + (i.total||0), 0);
    return {
      activeContracts: active,
      expiringSoon,
      expired,
      monthlyRecurring,
      totalDeposit,
      thisMonthIssued,
      unpaidTotal,
      totalInvoices: invoices.length
    };
  }

  // ── 매출 예측에 정기 임대료 반영 (영업외수익) ────
  function forecastRevenue(months) {
    months = months || 12;
    const startMonth = _today().slice(0,7);
    const result = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(startMonth + '-01');
      d.setMonth(d.getMonth() + i);
      const ym = d.toISOString().slice(0,7);
      const ymEnd = ym + '-' + new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      let rent = 0, count = 0;
      rentals.forEach(r => {
        if (r.status === '해지' || r.status === '만료') return;
        // 계약 기간 내인지 확인
        if (r.contractStart > ymEnd) return;
        if (r.contractEnd && r.contractEnd < ym + '-01' && !r.autoRenew) return;
        rent += (r.monthlyRent||0) + (r.managementFee||0);
        count++;
      });
      result.push({
        month: ym,
        contractCount: count,
        recurring: rent,
        vat: Math.round(rent * 0.1),
        total: rent + Math.round(rent * 0.1)
      });
    }
    return result;
  }

  // ============================================================
  //  UI
  // ============================================================
  function _injectUI() {
    if (document.getElementById('erp-rt-modal')) return;
    const css = `
      #erp-rt-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:2vh;}
      #erp-rt-modal.open{display:flex;}
      .rt-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:97%;max-width:1300px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;}
      .rt-hd{padding:14px 20px;background:linear-gradient(135deg,#27ae60,#2e7d32);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .rt-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .rt-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .rt-tab{padding:9px 18px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.88em;}
      .rt-tab.active{background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;}

      .rt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .rt-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #27ae60;}
      .rt-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .rt-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}

      .rt-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .rt-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .rt-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .rt-tbl tr.rt-row{border-left:4px solid #27ae60;}

      .rt-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#fff;padding:14px;border-radius:8px;}
      .rt-form-full{grid-column:span 2;}
      .rt-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:3px;}
      .rt-form input, .rt-form select, .rt-form textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}

      .rt-status-계약중{background:#e8f5e9;color:#27ae60;}
      .rt-status-만료예정{background:#fff3e0;color:#e65100;}
      .rt-status-만료{background:#ffebee;color:#c62828;}
      .rt-status-해지{background:#f5f5f5;color:#888;}

      .rt-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .rt-btn-primary{background:#27ae60;color:#fff;}
      .rt-btn-success{background:#1565c0;color:#fff;}
      .rt-btn-warn{background:#e65100;color:#fff;}
      .rt-btn-danger{background:#c62828;color:#fff;}
      .rt-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-rt-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-rt-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="rt-box">
        <div class="rt-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">🏘️ 임대사업 관리 (영업외수익)</h4>
          <button class="rt-btn rt-btn-ghost" onclick="document.getElementById('erp-rt-modal').classList.remove('open')">✕</button>
        </div>
        <div class="rt-bd" id="rt-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);
  }

  let _curTab = 'overview';
  let _editId = null;

  function _renderTabs() {
    const tabs = [
      { key: 'overview',  label: '📊 개요' },
      { key: 'contracts', label: '📋 임대 계약' },
      { key: 'invoices',  label: '💰 월 청구' },
      { key: 'forecast',  label: '📈 매출 예측 (영업외)' }
    ];
    return `<div class="rt-tabs">${tabs.map(t =>
      `<button class="rt-tab ${_curTab===t.key?'active':''}" data-tab="${t.key}">${t.label}</button>`
    ).join('')}</div>`;
  }

  function _renderOverview() {
    const s = summary();
    return `
      ${_renderTabs()}
      <div class="rt-stats">
        <div class="rt-stat"><div class="rt-stat-l">활성 계약</div><div class="rt-stat-v" style="color:#27ae60;">${s.activeContracts}건</div></div>
        <div class="rt-stat"><div class="rt-stat-l">만료 임박 (D-30)</div><div class="rt-stat-v" style="color:#e65100;">${s.expiringSoon}</div></div>
        <div class="rt-stat"><div class="rt-stat-l">월 정기 수익</div><div class="rt-stat-v">${_fmt(s.monthlyRecurring)}원</div></div>
        <div class="rt-stat"><div class="rt-stat-l">총 보증금</div><div class="rt-stat-v">${_fmt(s.totalDeposit)}원</div></div>
        <div class="rt-stat"><div class="rt-stat-l">이번달 청구</div><div class="rt-stat-v">${_fmt(s.thisMonthIssued)}원</div></div>
        <div class="rt-stat"><div class="rt-stat-l">미수금</div><div class="rt-stat-v" style="color:#c62828;">${_fmt(s.unpaidTotal)}원</div></div>
      </div>

      <div style="background:#e8f5e9;padding:12px;border-radius:8px;border-left:4px solid #27ae60;font-size:0.86em;line-height:1.6;color:#444;">
        💡 <strong>임대 수익은 영업외수익으로 분류됩니다.</strong><br>
        본업(모듈 영업)의 영업이익률 계산에서 제외되며, 매출 예측 대시보드에 별도 표시됩니다.
      </div>
    `;
  }

  function _renderContracts() {
    _autoUpdateStatus();
    const list = rentals.slice().reverse();
    return `
      ${_renderTabs()}
      <div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="rt-btn rt-btn-primary" data-act="rt-new">➕ 새 임대 계약</button>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          <span style="font-size:0.84em;color:#666;">선택 <strong id="rt-c-sel-cnt" style="color:#27ae60;">0</strong>건:</span>
          <button class="rt-btn rt-btn-success" data-act="rt-bulk-issue">📤 이번달 청구 발행</button>
          <button class="rt-btn rt-btn-danger" data-act="rt-bulk-delete">🗑 선택 삭제</button>
        </div>
      </div>
      ${list.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">등록된 계약 없음</div>'
        : `<table class="rt-tbl">
          <thead><tr>
            <th style="width:32px;text-align:center;"><input type="checkbox" id="rt-c-sel-all" onclick="window.warehouseRental._toggleAllContracts(this.checked)"></th>
            <th>계약번호</th><th>임차인</th><th>위치</th>
            <th style="text-align:right;">면적</th><th style="text-align:right;">월 임대료</th>
            <th>계약 기간</th><th>상태</th><th>액션</th>
          </tr></thead>
          <tbody>${list.map(r => {
            const days = _daysUntil(r.contractEnd);
            return `<tr class="rt-row">
              <td style="text-align:center;"><input type="checkbox" class="rt-c-chk" data-id="${_ea(r.id)}" onchange="window.warehouseRental._updateContractSelCount()"></td>
              <td><strong>${_e(r.contractNo)}</strong></td>
              <td>${_e(r.tenantName)}<br><span style="font-size:0.78em;color:#888;">${_e(r.tenantContact||'')}</span></td>
              <td style="font-size:0.86em;">${_e(r.warehouseName||'-')}<br><span style="color:#888;">${_e(r.zoneName||'')}</span></td>
              <td style="text-align:right;">${_fmt(r.area)}m²</td>
              <td style="text-align:right;font-weight:700;color:#27ae60;">${_fmt(r.monthlyRent)}원</td>
              <td style="font-size:0.86em;">${_e(r.contractStart)} ~<br>${_e(r.contractEnd)}${days!==null && days>=0 && days<=30?'<br><span style="color:#e65100;font-size:0.8em;font-weight:700;">D-'+days+'</span>':''}</td>
              <td><span class="rt-status-${_ea(r.status)}" style="padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;">${_e(r.status)}</span></td>
              <td style="white-space:nowrap;">
                <button class="rt-btn rt-btn-ghost" data-act="rt-edit" data-id="${_ea(r.id)}" style="padding:5px 10px;font-size:0.82em;">편집</button>
                <button class="rt-btn rt-btn-success" data-act="rt-issue" data-id="${_ea(r.id)}" style="padding:5px 10px;font-size:0.82em;">청구</button>
                <button class="rt-btn rt-btn-danger" data-act="rt-delete" data-id="${_ea(r.id)}" style="padding:5px 10px;font-size:0.82em;">삭제</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>`}
    `;
  }

  function _renderEditor(id) {
    const r = id ? getRental(id) : {
      tenantName: '', tenantBizNo: '', tenantContact: '', tenantPhone: '', tenantEmail: '',
      warehouseId: '', zoneId: '', area: 0, ratePerSqm: 0, monthlyRent: 0,
      managementFee: 0, mgmtVatIncluded: false,                  // ★ 신규
      deposit: 0,
      contractStart: _today(), contractEnd: _addMonths(_today(), 24),
      paymentDay: 5, vatIncluded: false,
      autoRenew: false, renewMonths: 12,
      notes: ''
    };
    // warehouse zones
    let zoneOptions = '<option value="">(위치 선택)</option>';
    if (typeof window.warehouseMaster !== 'undefined') {
      try {
        const zones = [
          ...window.warehouseMaster.getZonesByType('rented'),
          ...window.warehouseMaster.getZonesByType('free')
        ];
        zoneOptions += zones.map(z => `<option value="${_ea(z.warehouseId+'|'+z.zoneId)}" ${(r.warehouseId+'|'+r.zoneId)===(z.warehouseId+'|'+z.zoneId)?'selected':''}>${_e(z.full)} (${_fmt(z.area)}m²)</option>`).join('');
      } catch (e) {}
    }
    return `
      ${_renderTabs()}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#27ae60;">${id ? '계약 편집' : '새 임대 계약'}${r.contractNo?' · '+_e(r.contractNo):''}</h3>
        <div>
          <button class="rt-btn rt-btn-ghost" data-act="rt-back">← 목록</button>
          <button class="rt-btn rt-btn-primary" data-act="rt-save" data-id="${_ea(id||'')}">💾 저장</button>
        </div>
      </div>
      <h4 style="margin:10px 0 6px;color:#27ae60;font-size:0.94em;">🏢 임차인 정보</h4>
      <div class="rt-form" id="rt-form">
        <div class="rt-form-full"><label>임차인 회사명 *</label><input data-f="tenantName" value="${_ea(r.tenantName)}" placeholder="(주)베스트솔라"></div>
        <div><label>사업자번호</label><input data-f="tenantBizNo" value="${_ea(r.tenantBizNo)}"></div>
        <div><label>담당자</label><input data-f="tenantContact" value="${_ea(r.tenantContact)}"></div>
        <div><label>연락처</label><input data-f="tenantPhone" value="${_ea(r.tenantPhone)}"></div>
        <div><label>이메일</label><input data-f="tenantEmail" type="email" value="${_ea(r.tenantEmail)}"></div>

        <div class="rt-form-full"><label>임대 위치 (창고·구역)</label><select data-f="zoneSelect">${zoneOptions}</select>
          <div style="font-size:0.78em;color:#888;margin-top:3px;">창고 마스터에서 "임대" 또는 "비어있음" 유형의 zone만 선택 가능</div>
        </div>
      </div>

      <h4 style="margin:14px 0 6px;color:#27ae60;font-size:0.94em;">💰 임대료 / 관리비</h4>
      <div class="rt-form">
        <div><label>면적 (m²)</label><input data-f="area" type="number" value="${r.area||0}" oninput="window.warehouseRental._calcRent()"></div>
        <div><label>m²당 월 임대료 (원)</label><input data-f="ratePerSqm" type="number" value="${r.ratePerSqm||0}" oninput="window.warehouseRental._calcRent()"></div>
        <div class="rt-form-full"><label>월 임대료 (자동 계산 또는 수동 입력)</label><input data-f="monthlyRent" type="number" value="${r.monthlyRent||0}" id="rt-monthly"></div>

        <div>
          <label>임대료 VAT</label>
          <select data-f="vatIncluded" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:6px;">
            <option value="false" ${!r.vatIncluded?'selected':''}>미포함 (별도)</option>
            <option value="true" ${r.vatIncluded?'selected':''}>포함</option>
          </select>
        </div>
        <div>
          <label>보증금 (원)</label>
          <input data-f="deposit" type="number" value="${r.deposit||0}">
        </div>

        <div><label>월 관리비 (원)</label><input data-f="managementFee" type="number" value="${r.managementFee||0}"></div>
        <div>
          <label>관리비 VAT</label>
          <select data-f="mgmtVatIncluded" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:6px;">
            <option value="false" ${!r.mgmtVatIncluded?'selected':''}>미포함 (별도)</option>
            <option value="true" ${r.mgmtVatIncluded?'selected':''}>포함</option>
          </select>
        </div>
      </div>

      <h4 style="margin:14px 0 6px;color:#27ae60;font-size:0.94em;">📅 계약 기간 / 청구일</h4>
      <div class="rt-form">
        <div><label>계약 시작일</label><input data-f="contractStart" type="date" value="${_ea(r.contractStart)}"></div>
        <div><label>계약 종료일</label><input data-f="contractEnd" type="date" value="${_ea(r.contractEnd)}"></div>
        <div><label>매월 청구일 (1~28)</label><input data-f="paymentDay" type="number" min="1" max="28" value="${r.paymentDay||5}">
          <div style="font-size:0.76em;color:#888;margin-top:2px;">자동 청구 발행일 (월 단위 정산)</div>
        </div>
        <div>
          <label>자동 연장</label>
          <select data-f="autoRenew" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:6px;">
            <option value="false" ${!r.autoRenew?'selected':''}>아니오</option>
            <option value="true" ${r.autoRenew?'selected':''}>예 — 만료 시 자동 연장</option>
          </select>
        </div>
        <div><label>자동 연장 기간 (개월)</label><input data-f="renewMonths" type="number" value="${r.renewMonths||12}"></div>
      </div>

      <h4 style="margin:14px 0 6px;color:#27ae60;font-size:0.94em;">📝 기타</h4>
      <div class="rt-form">
        <div class="rt-form-full"><label>비고</label><textarea data-f="notes" rows="2">${_e(r.notes)}</textarea></div>
      </div>
    `;
  }

  function _calcRent() {
    const form = document.getElementById('rt-form');
    if (!form) return;
    const area = Number(form.querySelector('[data-f="area"]').value) || 0;
    const rate = Number(form.querySelector('[data-f="ratePerSqm"]').value) || 0;
    if (area && rate) {
      const monthly = area * rate;
      const monthlyEl = document.getElementById('rt-monthly');
      if (monthlyEl && (!monthlyEl.value || Number(monthlyEl.value) === 0 || monthlyEl.dataset.auto === '1')) {
        monthlyEl.value = monthly;
        monthlyEl.dataset.auto = '1';
      }
    }
  }

  function _renderInvoices() {
    const sorted = invoices.slice().sort((a,b) =>
      (b.billingMonth||'').localeCompare(a.billingMonth||'') ||
      (b.issueDate||'').localeCompare(a.issueDate||'')
    );
    const months = [...new Set(invoices.map(i => i.billingMonth))].sort().reverse();
    return `
      ${_renderTabs()}
      <div style="background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div>
          <label style="display:block;font-size:0.82em;color:#666;font-weight:700;">발행 월</label>
          <input id="rt-bulk-month" type="month" value="${_today().slice(0,7)}" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
        </div>
        <button class="rt-btn rt-btn-success" data-act="rt-bulk-issue">📤 모든 활성 계약 일괄 발행</button>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          <span style="font-size:0.84em;color:#666;">선택 <strong id="rt-i-sel-cnt" style="color:#27ae60;">0</strong>건:</span>
          <button class="rt-btn rt-btn-success" data-act="rt-inv-bulk-paid">💰 일괄 입금처리</button>
          <button class="rt-btn rt-btn-danger" data-act="rt-inv-bulk-delete">🗑 일괄 삭제</button>
        </div>
      </div>

      ${sorted.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">청구서 없음</div>'
        : `<table class="rt-tbl">
          <thead><tr>
            <th style="width:32px;text-align:center;"><input type="checkbox" id="rt-i-sel-all" onclick="window.warehouseRental._toggleAllInvoices(this.checked)"></th>
            <th>청구번호</th><th>발행일</th><th>임차인</th><th>청구월</th>
            <th style="text-align:right;">임대료</th><th style="text-align:right;">관리비</th>
            <th style="text-align:right;">VAT</th>
            <th style="text-align:right;">총액</th><th>마감일</th><th>상태</th><th>액션</th>
          </tr></thead>
          <tbody>${sorted.map(i => `<tr class="rt-row">
            <td style="text-align:center;"><input type="checkbox" class="rt-i-chk" data-id="${_ea(i.id)}" onchange="window.warehouseRental._updateInvoiceSelCount()"></td>
            <td><strong>${_e(i.invoiceNo)}</strong></td>
            <td>${_e(i.issueDate)}</td>
            <td>${_e(i.tenantName)}</td>
            <td>${_e(i.billingMonth)}</td>
            <td style="text-align:right;">${_fmt(i.rentAmount)}원${i.rentVatIncluded?'<br><span style="font-size:0.72em;color:#888;">VAT 포함</span>':''}</td>
            <td style="text-align:right;">${_fmt(i.mgmtAmount)}원${i.mgmtVatIncluded?'<br><span style="font-size:0.72em;color:#888;">VAT 포함</span>':''}</td>
            <td style="text-align:right;color:#888;">${_fmt(i.vat||0)}원</td>
            <td style="text-align:right;font-weight:700;color:#27ae60;">${_fmt(i.total)}원</td>
            <td>${_e(i.dueDate)}</td>
            <td><span style="padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;background:${i.status==='입금완료'?'#e8f5e9':'#fff3e0'};color:${i.status==='입금완료'?'#27ae60':'#e65100'};">${_e(i.status)}</span></td>
            <td style="white-space:nowrap;">
              ${i.status !== '입금완료' ? `<button class="rt-btn rt-btn-success" data-act="rt-inv-paid" data-id="${_ea(i.id)}" style="padding:5px 10px;font-size:0.82em;">입금</button>` : ''}
              <button class="rt-btn rt-btn-ghost" data-act="rt-inv-print" data-id="${_ea(i.id)}" style="padding:5px 10px;font-size:0.82em;">인쇄</button>
              <button class="rt-btn rt-btn-danger" data-act="rt-inv-delete" data-id="${_ea(i.id)}" style="padding:5px 10px;font-size:0.82em;">삭제</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`}
    `;
  }

  function _renderForecast() {
    const f = forecastRevenue(12);
    const total = f.reduce((s,m) => s + m.total, 0);
    return `
      ${_renderTabs()}
      <div style="background:#e8f5e9;padding:14px;border-radius:8px;margin-bottom:14px;">
        <div style="font-size:0.82em;color:#666;font-weight:700;">향후 12개월 예상 영업외수익 (정기 임대료)</div>
        <div style="font-size:1.8em;font-weight:900;color:#27ae60;line-height:1.1;margin-top:4px;">${_fmt(total)}원</div>
        <div style="font-size:0.78em;color:#888;margin-top:2px;">VAT 포함 · 자동 연장 미반영 · 신규 계약 미반영</div>
      </div>
      <table class="rt-tbl">
        <thead><tr>
          <th>월</th><th style="text-align:right;">활성 계약</th>
          <th style="text-align:right;">월 임대료</th><th style="text-align:right;">VAT</th><th style="text-align:right;">총 수익</th>
        </tr></thead>
        <tbody>${f.map(m => `<tr class="rt-row">
          <td><strong>${_e(m.month)}</strong></td>
          <td style="text-align:right;">${m.contractCount}건</td>
          <td style="text-align:right;">${_fmt(m.recurring)}원</td>
          <td style="text-align:right;">${_fmt(m.vat)}원</td>
          <td style="text-align:right;font-weight:700;color:#27ae60;">${_fmt(m.total)}원</td>
        </tr>`).join('')}</tbody>
      </table>
    `;
  }

  // ── 액션 ────────────────────────────────────────
  function _onModalClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { _curTab = tabBtn.getAttribute('data-tab'); _render(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');

    if (act === 'rt-new')           _renderEditorMode(null);
    else if (act === 'rt-edit')     _renderEditorMode(id);
    else if (act === 'rt-save')     _saveForm(id || null);
    else if (act === 'rt-back')     { _curTab = 'contracts'; _render(); }
    else if (act === 'rt-delete')   { if (removeRental(id)) { _render(); if(typeof setBanner==='function') setBanner('ok','🗑 계약 삭제'); } }
    else if (act === 'rt-issue') {
      try {
        const m = _today().slice(0,7);
        const result = generateMonthlyInvoice(id, m);
        if (result.existing) alert('이번달 청구서가 이미 발행되어 있습니다.');
        else {
          if (typeof setBanner === 'function') setBanner('ok', `📤 ${result.invoice.invoiceNo} 발행 완료`);
          _curTab = 'invoices';
          _render();
        }
      } catch (err) { alert('실패: ' + err.message); }
    }
    else if (act === 'rt-bulk-issue') {
      const m = document.getElementById('rt-bulk-month')?.value || _today().slice(0,7);
      if (!confirm(`${m} 월의 모든 활성 계약 청구서를 일괄 발행하시겠습니까?`)) return;
      const r = generateAllForMonth(m);
      alert(`📤 일괄 발행 결과\n• 신규: ${r.issued.length}건\n• 이미 발행됨: ${r.existed.length}건\n• 실패: ${r.failed.length}건`);
      _curTab = 'invoices';
      _render();
    }
    else if (act === 'rt-inv-paid') {
      const date = prompt('입금일 (YYYY-MM-DD):', _today());
      if (!date) return;
      markPaid(id, date);
      _render();
    }
    else if (act === 'rt-inv-delete') {
      if (!confirm('청구서를 삭제합니까?')) return;
      removeInvoice(id);
      _render();
    }
    else if (act === 'rt-inv-print') _printInvoice(id);
    // ── 일괄 처리 ────────────────────────────────
    else if (act === 'rt-bulk-delete') _bulkDeleteContracts();
    else if (act === 'rt-inv-bulk-paid') _bulkPaidInvoices();
    else if (act === 'rt-inv-bulk-delete') _bulkDeleteInvoices();
  }

  // ── 계약 일괄 삭제 ────────────────────────────
  function _bulkDeleteContracts() {
    const ids = Array.from(document.querySelectorAll('.rt-c-chk:checked')).map(el => el.getAttribute('data-id'));
    if (ids.length === 0) { alert('삭제할 계약을 체크박스로 선택하세요.'); return; }
    if (!confirm(`선택한 ${ids.length}건의 계약을 삭제합니까? (관련 청구서도 함께 삭제됩니다)`)) return;
    let removed = 0;
    ids.forEach(id => { if (removeRental(id)) removed++; });
    if (typeof setBanner === 'function') setBanner('ok', `🗑 계약 ${removed}건 + 관련 청구서 삭제`);
    _render();
  }

  // ── 청구서 일괄 입금 처리 ─────────────────────
  function _bulkPaidInvoices() {
    const ids = Array.from(document.querySelectorAll('.rt-i-chk:checked')).map(el => el.getAttribute('data-id'));
    if (ids.length === 0) { alert('입금 처리할 청구서를 선택하세요.'); return; }
    const date = prompt('입금일 (YYYY-MM-DD):', _today());
    if (!date) return;
    let cnt = 0;
    ids.forEach(id => { if (markPaid(id, date)) cnt++; });
    if (typeof setBanner === 'function') setBanner('ok', `💰 청구서 ${cnt}건 입금 처리`);
    _render();
  }

  // ── 청구서 일괄 삭제 ──────────────────────────
  function _bulkDeleteInvoices() {
    const ids = Array.from(document.querySelectorAll('.rt-i-chk:checked')).map(el => el.getAttribute('data-id'));
    if (ids.length === 0) { alert('삭제할 청구서를 선택하세요.'); return; }
    if (!confirm(`선택한 ${ids.length}건의 청구서를 삭제합니까?`)) return;
    let removed = 0;
    ids.forEach(id => { if (removeInvoice(id)) removed++; });
    if (typeof setBanner === 'function') setBanner('ok', `🗑 청구서 ${removed}건 삭제`);
    _render();
  }

  // ── 체크박스 전체 토글 + 선택 카운트 ──────────
  function _toggleAllContracts(checked) {
    document.querySelectorAll('.rt-c-chk').forEach(el => { el.checked = checked; });
    _updateContractSelCount();
  }
  function _updateContractSelCount() {
    const lbl = document.getElementById('rt-c-sel-cnt');
    if (lbl) lbl.textContent = document.querySelectorAll('.rt-c-chk:checked').length;
  }
  function _toggleAllInvoices(checked) {
    document.querySelectorAll('.rt-i-chk').forEach(el => { el.checked = checked; });
    _updateInvoiceSelCount();
  }
  function _updateInvoiceSelCount() {
    const lbl = document.getElementById('rt-i-sel-cnt');
    if (lbl) lbl.textContent = document.querySelectorAll('.rt-i-chk:checked').length;
  }

  let _editorMode = null;
  function _renderEditorMode(id) {
    _editorMode = { id };
    _curTab = 'edit';
    document.getElementById('rt-bd').innerHTML = _renderEditor(id);
  }

  function _saveForm(id) {
    const data = {};
    // ★ 폼이 여러 .rt-form 섹션으로 분리됨 — #rt-bd 전체 검색
    document.querySelectorAll('#rt-bd [data-f]').forEach(el => {
      const k = el.getAttribute('data-f');
      if (el.type === 'checkbox') data[k] = el.checked;
      else if (el.type === 'number') data[k] = Number(el.value)||0;
      else if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) {
        // VAT 포함/미포함, 자동 연장 등의 select boolean
        data[k] = el.value === 'true';
      }
      else data[k] = el.value;
    });
    if (!data.tenantName) { alert('임차인 입력 필요'); return; }
    if (data.zoneSelect) {
      const [whId, zId] = data.zoneSelect.split('|');
      data.warehouseId = whId; data.zoneId = zId;
      if (typeof window.warehouseMaster !== 'undefined') {
        const w = window.warehouseMaster.get(whId);
        const z = w?.zones?.find(z => z.id === zId);
        if (w) data.warehouseName = w.name;
        if (z) {
          data.zoneName = z.name;
          if (!data.area) data.area = z.area;
        }
      }
      delete data.zoneSelect;
    }
    if (id) {
      updateRental(id, data);
      if (typeof setBanner === 'function') setBanner('ok', '✅ 계약 수정');
    } else {
      const r = addRental(data);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 계약 ${r.contractNo} 등록 — 월 ${_fmt(r.monthlyRent)}원`);
    }
    _curTab = 'contracts';
    _render();
  }

  function _printInvoice(id) {
    const i = invoices.find(x => x.id === id);
    if (!i) return;
    const win = window.open('', '_blank');
    if (!win) { alert('팝업 차단'); return; }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${_e(i.invoiceNo)}</title>
      <style>
        body{font-family:'Malgun Gothic',sans-serif;margin:30px;color:#1a1a2e;}
        h1{text-align:center;margin:0 0 20px;letter-spacing:8px;border-bottom:3px double #27ae60;padding-bottom:10px;color:#1a1a2e;}
        table{width:100%;border-collapse:collapse;margin:10px 0;}
        th,td{border:1px solid #555;padding:6px 10px;}
        th{background:#e8f5e9;font-weight:700;}
        .total{font-size:1.2em;font-weight:900;background:#fffde7;}
      </style></head><body>
      <h1>임 대 료 청 구 서</h1>
      <table>
        <tr><th>청구번호</th><td>${_e(i.invoiceNo)}</td><th>발행일</th><td>${_e(i.issueDate)}</td></tr>
        <tr><th>임차인</th><td>${_e(i.tenantName)}</td><th>청구월</th><td>${_e(i.billingMonth)}</td></tr>
        <tr><th>마감일</th><td>${_e(i.dueDate)}</td><th>계약번호</th><td>${_e(i.contractNo)}</td></tr>
      </table>
      <table>
        <tr><th>항목</th><th style="text-align:right;">금액</th></tr>
        <tr><td>임대료</td><td style="text-align:right;">${_fmt(i.rentAmount)}원</td></tr>
        <tr><td>관리비</td><td style="text-align:right;">${_fmt(i.mgmtAmount)}원</td></tr>
        <tr><th style="text-align:right;">공급가액</th><th style="text-align:right;">${_fmt(i.subtotal)}원</th></tr>
        <tr><th style="text-align:right;">VAT (10%)</th><th style="text-align:right;">${_fmt(i.vat)}원</th></tr>
        <tr class="total"><th style="text-align:right;">총 청구액</th><th style="text-align:right;">${_fmt(i.total)}원</th></tr>
      </table>
      <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
      </body></html>`;
    win.document.write(html);
    win.document.close();
  }

  function _render() {
    const bd = document.getElementById('rt-bd');
    if (!bd) return;
    if (_curTab === 'overview')  bd.innerHTML = _renderOverview();
    else if (_curTab === 'contracts') bd.innerHTML = _renderContracts();
    else if (_curTab === 'invoices')  bd.innerHTML = _renderInvoices();
    else if (_curTab === 'forecast')  bd.innerHTML = _renderForecast();
    else if (_curTab === 'edit')      bd.innerHTML = _renderEditor(_editorMode?.id);
    else _curTab = 'overview', _render();
  }

  function open() {
    _injectUI();
    loadAll();
    _autoUpdateStatus();
    _curTab = 'overview';
    document.getElementById('erp-rt-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() { document.getElementById('erp-rt-modal')?.classList.remove('open'); }

  // ── notify trigger 추가 ──────────────────────────
  // 만료 D-30 알림은 notify.js TRIGGERS 에 자동 등록
  function _registerTrigger() {
    if (typeof window.erpNotifyTriggers === 'undefined') {
      // notify.js 가 TRIGGERS 를 외부에 노출 안 함 — 정보성 console 만
      return;
    }
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    loadAll();
    setTimeout(_injectUI, 800);
    setTimeout(_autoUpdateStatus, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.warehouseRental = {
    listRentals, getRental, addRental, updateRental, removeRental,
    listInvoices, generateMonthlyInvoice, generateAllForMonth, markPaid, removeInvoice,
    summary, forecastRevenue,
    open, close, reload: loadAll,
    _calcRent,
    // 체크박스 토글 / 카운트 (DOM 이벤트에서 호출)
    _toggleAllContracts, _updateContractSelCount,
    _toggleAllInvoices, _updateInvoiceSelCount
  };

  console.log('[ERP-RT] 창고 임대 관리 활성 — warehouseRental.open()');
})();
