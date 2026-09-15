// =====================================================
//  WAREHOUSE DASHBOARD INTEGRATION (Phase 4)
//
//  대시보드에 창고 사업 KPI 카드 추가:
//   1. 자체 재고 ATP (기존)
//   2. 타사 보관 재고 (신규, 보라색)
//   3. 임대 수익 (신규, 초록색, 영업외)
//   4. 창고 점유율 (신규)
//
//  영업실적 탭에 영업외수익 섹션 추가:
//   - 본업 매출 (모듈 영업)
//   - 영업외 수익 (보관료 + 임대료) — 별도 표시
//   - 합계 = 총 매출
// =====================================================
(function() {
  'use strict';

  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _fmtAmt(n) {
    n = Number(n)||0;
    if (n >= 100000000) return (n/100000000).toFixed(1) + '억';
    if (n >= 10000) return Math.round(n/10000).toLocaleString() + '만';
    return n.toLocaleString();
  }
  function _today() { return new Date().toISOString().slice(0,10); }

  // ── KPI 카드 — 대시보드 v2 인라인에 통합 ─────────
  // tools_layout.js 의 _buildDv2Cards 가 만드는 카드들에 추가 카드 후처리 inject
  function _addWarehouseCards() {
    // 대시보드 패널 내 기존 카드들 다음에 창고 사업 KPI 추가
    const tab = document.getElementById('tab-dashboard');
    if (!tab) return;
    if (tab.querySelector('#wh-dash-cards')) return;   // 이미 추가됨
    // dashStats 또는 dv2-grid 다음에 위치
    const target = tab.querySelector('.stats-row') || tab.querySelector('[data-erp-dash-cards]') || tab.firstChild;
    if (!target) return;

    const wrap = document.createElement('div');
    wrap.id = 'wh-dash-cards';
    // ★ 2026-05 수정: 다른 KPI 카드 그리드와 동일한 스타일(흰 카드, box-shadow)로 변경.
    //   기존의 갈색 좌측 보더 + 그라데이션 wrapper 제거 → 일관성 있는 대시보드 룩
    wrap.style.cssText = 'margin-top:14px;';
    wrap.innerHTML = _buildCards();
    target.parentNode.insertBefore(wrap, target.nextSibling);

    // 클릭 이벤트
    wrap.addEventListener('click', e => {
      const card = e.target.closest('[data-wh-tool]');
      if (!card) return;
      const tool = card.getAttribute('data-wh-tool');
      const fn = {
        warehouse: () => window.warehouseMaster?.open(),
        thirdparty: () => window.thirdParty?.open(),
        rental: () => window.warehouseRental?.open()
      }[tool];
      if (fn) try { fn(); } catch(err) { alert('실행 실패'); }
    });
  }

  function _buildCards() {
    // 데이터 수집
    let whSummary = { total:0, used:0, free:0, pct:0 };
    if (typeof window.warehouseMaster !== 'undefined') {
      try {
        const list = window.warehouseMaster.list();
        list.forEach(w => {
          const occ = window.warehouseMaster.occupancy(w.id);
          if (occ) {
            whSummary.total += occ.total;
            whSummary.used += occ.used;
            whSummary.free += occ.free;
          }
        });
        whSummary.pct = whSummary.total > 0 ? (whSummary.used/whSummary.total*100).toFixed(1) : 0;
        whSummary.warehouseCount = list.length;
      } catch(e) {}
    }

    let tpSummary = { ownerCount:0, totalMW:0, thisMonthBilling:0, unpaid:0 };
    if (typeof window.thirdParty !== 'undefined' && window.thirdParty.summary) {
      try { tpSummary = window.thirdParty.summary(); } catch(e) {}
    }

    let rtSummary = { activeContracts:0, expiringSoon:0, monthlyRecurring:0, unpaidTotal:0 };
    if (typeof window.warehouseRental !== 'undefined' && window.warehouseRental.summary) {
      try { rtSummary = window.warehouseRental.summary(); } catch(e) {}
    }

    // ★ 다른 KPI 카드(_buildDv2Cards)와 동일한 룩: 흰 카드, box-shadow, 같은 폰트 크기
    const cardStyle = 'background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);cursor:pointer;transition:transform .12s,box-shadow .12s;';
    return `
      <div style="font-size:0.78em;color:#888;font-weight:700;margin-bottom:6px;padding-left:2px;">🏢 창고 사업 (영업외수익 포함)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
        <div data-wh-tool="warehouse" style="${cardStyle}" title="창고 마스터 열기">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">📐 창고 점유율 <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:#5d4037;line-height:1.1;">${whSummary.pct}<span style="font-size:0.5em;">%</span></div>
          <div style="font-size:0.82em;color:#666;">${_fmt(whSummary.used)}m² / ${_fmt(whSummary.total)}m² (${whSummary.warehouseCount||0}개 창고)</div>
        </div>
        <div data-wh-tool="thirdparty" style="${cardStyle}" title="위탁 재고 관리 열기">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">🤝 위탁 재고 <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:#7b1fa2;line-height:1.1;">${tpSummary.totalMW.toFixed(2)}<span style="font-size:0.5em;color:#888;">MW</span></div>
          <div style="font-size:0.82em;color:#666;">${tpSummary.ownerCount}개 화주 · 이번달 ${_fmtAmt(tpSummary.thisMonthBilling)}원</div>
        </div>
        <div data-wh-tool="rental" style="${cardStyle}" title="임대사업 열기">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">🏘️ 임대 수익 (영업외) <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:#27ae60;line-height:1.1;">${_fmtAmt(rtSummary.monthlyRecurring)}<span style="font-size:0.5em;color:#888;">원</span></div>
          <div style="font-size:0.82em;color:#666;">${rtSummary.activeContracts}건 활성${rtSummary.expiringSoon?' · ⚠️ '+rtSummary.expiringSoon+'건 만료임박':''}</div>
        </div>
      </div>
    `;
  }

  // ── 영업실적 탭에 영업외수익 섹션 추가 ─────────
  function _injectIntoSalesTab() {
    const tab = document.getElementById('tab-sales');
    if (!tab) return;
    if (tab.querySelector('#wh-sales-section')) return;

    const sec = document.createElement('div');
    sec.id = 'wh-sales-section';
    sec.style.cssText = 'margin-top:24px;background:#fff;border-radius:12px;padding:18px;border:1px solid #e0e0e0;';
    sec.innerHTML = _buildSalesSection();
    tab.appendChild(sec);
  }

  function _buildSalesSection() {
    let tpThisMonth = 0, rtMonthly = 0, rtThisMonthIssued = 0;
    if (typeof window.thirdParty !== 'undefined' && window.thirdParty.summary) {
      try { tpThisMonth = window.thirdParty.summary().thisMonthBilling || 0; } catch(e) {}
    }
    if (typeof window.warehouseRental !== 'undefined' && window.warehouseRental.summary) {
      try {
        const s = window.warehouseRental.summary();
        rtMonthly = s.monthlyRecurring || 0;
        rtThisMonthIssued = s.thisMonthIssued || 0;
      } catch(e) {}
    }

    // 본업 매출 (모듈 영업)
    let coreSales = 0, coreThisMonth = 0;
    if (typeof getEnriched === 'function') {
      try {
        const orders = getEnriched();
        const thisMonth = _today().slice(0,7);
        coreSales = orders.reduce((s,o) => s + (o.수주총액||0), 0);
        coreThisMonth = orders
          .filter(o => (o.수주일||'').startsWith(thisMonth))
          .reduce((s,o) => s + (o.수주총액||0), 0);
      } catch (e) {}
    }

    const totalThisMonth = coreThisMonth + tpThisMonth + rtThisMonthIssued;
    const corePct = totalThisMonth > 0 ? (coreThisMonth/totalThisMonth*100).toFixed(1) : 0;
    const auxPct = totalThisMonth > 0 ? ((tpThisMonth+rtThisMonthIssued)/totalThisMonth*100).toFixed(1) : 0;

    return `
      <h3 style="margin:0 0 12px;color:#1a1a2e;font-size:1.05em;">💼 매출 구조 (이번달 + 누계)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px;">
        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);padding:14px;border-radius:8px;">
          <div style="font-size:0.78em;color:#1565c0;font-weight:700;">🏭 본업 매출 (모듈 영업)</div>
          <div style="font-size:1.5em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:4px;">${_fmtAmt(coreThisMonth)}원</div>
          <div style="font-size:0.78em;color:#666;margin-top:2px;">이번달 · 누계 ${_fmtAmt(coreSales)}원</div>
          <div style="font-size:0.74em;color:#1565c0;margin-top:4px;font-weight:700;">전체의 ${corePct}%</div>
        </div>
        <div style="background:linear-gradient(135deg,#f3e5f5,#e1bee7);padding:14px;border-radius:8px;">
          <div style="font-size:0.78em;color:#7b1fa2;font-weight:700;">🤝 타사 보관료 (영업외)</div>
          <div style="font-size:1.5em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:4px;">${_fmtAmt(tpThisMonth)}원</div>
          <div style="font-size:0.78em;color:#666;margin-top:2px;">이번달 청구액</div>
        </div>
        <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);padding:14px;border-radius:8px;">
          <div style="font-size:0.78em;color:#27ae60;font-weight:700;">🏘️ 임대 수익 (영업외)</div>
          <div style="font-size:1.5em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:4px;">${_fmtAmt(rtThisMonthIssued)}원</div>
          <div style="font-size:0.78em;color:#666;margin-top:2px;">월 정기 ${_fmtAmt(rtMonthly)}원 (계약 기준)</div>
        </div>
        <div style="background:linear-gradient(135deg,#fffde7,#fff9c4);padding:14px;border-radius:8px;border:2px solid #f9a825;">
          <div style="font-size:0.78em;color:#f57f17;font-weight:700;">📊 이번달 총 매출</div>
          <div style="font-size:1.6em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:4px;">${_fmtAmt(totalThisMonth)}원</div>
          <div style="font-size:0.78em;color:#666;margin-top:2px;">본업 ${corePct}% + 영업외 ${auxPct}%</div>
        </div>
      </div>
    `;
  }

  // ── showTab hook ─────────────────────────────────
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__whDashHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (id === 'dashboard') setTimeout(_addWarehouseCards, 200);
      if (id === 'sales')     setTimeout(_injectIntoSalesTab, 200);
      return r;
    };
    window.showTab.__whDashHooked = true;
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    setTimeout(_hookShowTab, 1500);
    // 첫 부팅 시 대시보드가 active 라면 즉시 추가
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-dashboard') _addWarehouseCards();
      else if (active?.id === 'tab-sales') _injectIntoSalesTab();
    }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 외부 노출
  window.warehouseDashboard = {
    refreshCards: () => {
      const wrap = document.getElementById('wh-dash-cards');
      if (wrap) wrap.innerHTML = _buildCards();
    },
    refreshSalesSection: () => {
      const sec = document.getElementById('wh-sales-section');
      if (sec) sec.innerHTML = _buildSalesSection();
    }
  };

  console.log('[ERP-WH-DASH] 창고 사업 대시보드 통합 활성');
})();
