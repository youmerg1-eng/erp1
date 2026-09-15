// =====================================================
//  UI UPLIFT — Phase D · Day 2
//  1) 사이드 네비게이션 그룹화 (CSS only, 기존 HTML 0줄 수정)
//  2) MW 단위 자동 변환 헬퍼 (전역)
//  3) 대시보드 카드에 MW 표시 자동 보강
// =====================================================
(function() {
  'use strict';

  // ── 1. MW 단위 헬퍼 ────────────────────────────────
  // fmtCapacity(kW) → "1.20MW" 또는 "850kW" (자동)
  window.fmtCapacity = function(kw) {
    const n = Number(kw) || 0;
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(2).replace(/\.?0+$/,'') + 'MW';
    return Math.round(n).toLocaleString() + 'kW';
  };
  // 매수×Wp → kW
  window.qtyToKw = function(qty, watt) {
    return ((Number(qty)||0) * (Number(watt)||0)) / 1000;
  };
  // 매수×Wp → MW
  window.qtyToMw = function(qty, watt) {
    return qtyToKw(qty, watt) / 1000;
  };

  // ── 2. 사이드 네비 그룹화 ──────────────────────────
  // 기존 onclick 그대로 두고, nav-item 사이에 그룹 헤더 DOM inject
  const NAV_GROUPS = [
    { label: '🏠 홈',   items: ['dashboard'] },
    { label: '📋 영업', items: ['orders','delivery','splitdelivery','shipment'] },
    { label: '📦 재고', items: ['inventory','stock'] },
    { label: '📊 분석', items: ['sales','fr'] },
    { label: '⚙️ 도구', items: ['settings'] }
  ];

  function _groupSidebar() {
    const navItems = document.querySelectorAll('.nav-item');
    if (!navItems.length) { setTimeout(_groupSidebar, 300); return; }
    if (document.querySelector('.nav-group-label')) return;
    // 기존 nav-section-label이 있으면 inject 스킵 — 디자인만 SolarFlow 톤으로 보강
    const existing = document.querySelectorAll('.nav-section-label');
    if (existing.length > 0) {
      // 디자인 보강 — 골드 액센트 + 세로 간격
      existing.forEach((el, i) => {
        if (el.dataset.upliftDone) return;
        el.style.cssText += ';padding:8px 14px 3px;font-size:0.66em;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;opacity:0.7;' +
          (i === 0 ? '' : 'margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);');
        el.dataset.upliftDone = '1';
      });
      return;
    }
    // 기존 라벨 없으면 NAV_GROUPS로 inject
    const idMap = new Map();
    navItems.forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/showTab\('([^']+)'\)/);
      if (m) idMap.set(m[1], btn);
    });
    NAV_GROUPS.forEach(g => {
      const firstId = g.items.find(id => idMap.has(id));
      if (!firstId) return;
      const firstBtn = idMap.get(firstId);
      const label = document.createElement('div');
      label.className = 'nav-group-label';
      label.textContent = g.label;
      label.style.cssText = 'padding:8px 14px 4px;font-size:0.66em;font-weight:800;color:#888;letter-spacing:1.3px;margin-top:6px;text-transform:uppercase;border-top:1px solid rgba(255,255,255,0.08);';
      firstBtn.parentNode.insertBefore(label, firstBtn);
    });
    const first = document.querySelector('.nav-group-label');
    if (first) { first.style.borderTop = 'none'; first.style.marginTop = '0'; }
  }

  // ── 3. 대시보드 카드에 MW 표시 보강 ────────────────
  // renderDashboard 후에 카드를 찾아 용량 정보 inject
  function _enhanceDashboard() {
    if (typeof window.renderDashboard !== 'function') return;
    if (window.renderDashboard.__mwEnhanced) return;
    const _orig = window.renderDashboard;
    window.renderDashboard = function() {
      const r = _orig.apply(this, arguments);
      try { _addMwToCards(); } catch(e) {}
      return r;
    };
    window.renderDashboard.__mwEnhanced = true;
  }

  function _addMwToCards() {
    if (typeof getEnriched !== 'function') return;
    const orders = getEnriched();
    let totalKw = 0;
    orders.forEach(o => {
      // 수주용량(kW) 필드 우선 사용
      const kwStr = String(o.수주용량kW || '').replace(/[^\d.\-]/g,'');
      const kwNum = parseFloat(kwStr) || qtyToKw(o.수량, o.제품용량);
      totalKw += kwNum;
    });
    if (totalKw <= 0) return;

    // 대시보드 카드 첫 번째 (전체 수주 건수) 옆에 MW 추가
    const stats = document.getElementById('dashStats');
    if (!stats || stats.dataset.mwAdded === '1') return;
    const cards = stats.querySelectorAll('.stat');
    if (!cards.length) return;

    // 첫 카드의 stat-sub에 MW 추가 (이미 있으면 skip)
    const firstSub = cards[0]?.querySelector('.stat-sub');
    if (firstSub && !firstSub.textContent.includes('MW') && !firstSub.textContent.includes('용량')) {
      firstSub.innerHTML += ` · 용량 <strong style="color:#1565c0;">${fmtCapacity(totalKw)}</strong>`;
    }
    stats.dataset.mwAdded = '1';
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    setTimeout(_groupSidebar, 300);
    setTimeout(_groupSidebar, 1500);
    setTimeout(_enhanceDashboard, 500);
    setTimeout(_enhanceDashboard, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-UPLIFT] 사이드 그룹화 + MW 단위 자동 변환 활성');
})();
