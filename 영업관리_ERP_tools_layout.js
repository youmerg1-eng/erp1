// =====================================================
//  TOOLS LAYOUT — 도구 재배치 + 글로벌 ESC + 인라인 대시보드 v2
//
//  배치
//   • 대시보드 탭          : 통계 대시보드 v2 (인라인, 위쪽)
//   • 출고지시서 탭         : 🚛 배차/일정 버튼
//   • 입고관리·재고관리 탭   : 📦 ATP · 🧾 구매이력 · 🚢 입고예정 버튼
//   • 전수조사서(FR) 탭     : 🏷 SN 추적 버튼
//   • 설정 탭              : 🩺 시스템상태 · 🎯 운영 · 💾 백업 · 📥 통합엑셀 · 🚀 셋업 버튼
//
//  ESC: 어떤 도구 모달이 열려있어도 ESC 한 번에 닫힘
//
//  기존 코드 0줄 수정 — showTab hook + DOM inject만
// =====================================================
(function() {
  'use strict';

  // ── 1. 글로벌 ESC — 모든 열린 도구 모달 닫기 ────────
  function _bindEsc() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // 입력 중에 IME 조합 중이면 스킵
      if (e.isComposing) return;
      let closed = 0;
      // *.open 클래스를 가진 모든 모달
      document.querySelectorAll(
        '#erp-calc-modal.open, #erp-in-modal.open, #erp-aging-panel.open, #erp-atp-panel.open, ' +
        '#erp-mob-modal.open, #erp-pur-modal.open, #erp-dsp-modal.open, #erp-ai-modal.open, ' +
        '#erp-dv2-modal.open, #erp-ops-modal.open, #erp-fb-modal.open, #erp-rate-modal.open, ' +
        '#erp-sn-panel.open, #erp-gs-modal.open, #erp-tb-panel.open, ' +
        '#erp-health-panel.open, #receiptSelectModal, #doReceiptSelectModal, #bk-modal, ' +
        '#erp-setup-modal, #erp-excel-modal'
      ).forEach(m => {
        if (m.id === 'bk-modal' || m.id === 'erp-setup-modal' || m.id === 'erp-excel-modal' ||
            m.id === 'receiptSelectModal' || m.id === 'doReceiptSelectModal') {
          m.remove();
        } else {
          m.classList.remove('open');
        }
        closed++;
      });
      // 토글 버튼 상태도 정리
      document.getElementById('erp-tb-toggle')?.classList.remove('open');
    });
  }

  // ── 2. 탭별 도구 inject ─────────────────────────────
  function _toolButton(label, icon, color, onclick, sub) {
    return `<button onclick="${onclick}" style="
      padding:12px 18px;background:${color};color:#fff;border:none;border-radius:10px;cursor:pointer;
      font-size:0.92em;font-weight:700;display:inline-flex;align-items:center;gap:8px;
      box-shadow:0 2px 8px rgba(0,0,0,0.12);transition:transform .12s, box-shadow .12s;margin:0 6px 6px 0;"
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,0.2)'"
      onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'">
      <span style="font-size:1.2em;">${icon}</span>
      <span>${label}${sub?`<span style="display:block;font-size:0.7em;font-weight:400;opacity:0.85;">${sub}</span>`:''}</span>
    </button>`;
  }

  function _toolBar(id, title, buttons) {
    return `<div id="${id}" data-tools-injected="1" style="
      background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:14px;
      border:1px solid #eaeaea;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="font-size:0.78em;font-weight:700;color:#888;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">
        🛠 ${title}
      </div>
      <div>${buttons}</div>
    </div>`;
  }

  // ── 3. 대시보드 탭 — KPI 카드를 대시보드와 통합 (헤더 없이) ─────
  //   기존: "📊 통계 대시보드 v2" 헤더 + 갱신 버튼 + 카드 + 상세 모달 보기 버튼
  //   변경: 헤더·버튼 모두 제거, 카드만 dashStats 위에 자연스럽게 배치
  function _injectDashboard() {
    const tab = document.getElementById('tab-dashboard');
    if (!tab) return;
    if (document.getElementById('dv2-inline')) {
      _refreshDashboardV2Inline();
      return;
    }
    const wrap = document.createElement('div');
    wrap.id = 'dv2-inline';
    wrap.style.cssText = 'margin-bottom:14px;';
    wrap.innerHTML = `<div id="dv2-inline-bd"></div>`;
    // 첫 번째 자식으로 삽입 (대시보드 위)
    if (tab.firstChild) tab.insertBefore(wrap, tab.firstChild);
    else tab.appendChild(wrap);
    _refreshDashboardV2Inline();
  }

  function _refreshDashboardV2Inline() {
    const bd = document.getElementById('dv2-inline-bd');
    if (!bd) return;
    if (typeof dashboardV2 === 'undefined' || !dashboardV2.kpis) {
      bd.innerHTML = '<div style="padding:20px;color:#bbb;text-align:center;">KPI 데이터 로드 중...</div>';
      return;
    }
    // dashboardV2.kpis() — KPI 데이터만 가져와 인라인 카드로 렌더
    try {
      const k = dashboardV2.kpis();
      bd.innerHTML = _buildDv2Cards(k);
    } catch(e) {
      bd.innerHTML = '<div style="padding:20px;color:#c62828;">⚠️ KPI 렌더 실패: ' + e.message + '</div>';
    }
  }
  window._refreshDv2Inline = _refreshDashboardV2Inline;

  function _buildDv2Cards(k) {
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';
    const fmtAmt = n => {
      if (n >= 100000000) return (n/100000000).toFixed(1) + '억';
      if (n >= 10000) return Math.round(n/10000).toLocaleString() + '만';
      return n.toLocaleString();
    };
    const tm = k.thisMonth || {};
    const ag = k.aging?.buckets || {};
    // ★ 2026-05 v2 재작성: 인라인 onclick의 백슬래시-쿼트 escape 문제로 클릭 무반응 발생.
    //   해결책 — data-tool 속성으로 도구 이름만 표기하고, 한 번만 등록되는 위임 핸들러가
    //   실제 호출(window.atp.open() 등)을 담당. HTML escape 이슈 완전 회피.
    //   동시에 <div>의 중복 style 속성도 단일 style 로 통합.
    const cardStyle = 'background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);cursor:pointer;transition:transform .12s,box-shadow .12s;';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;" data-erp-dash-cards="1">
        <div style="background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">영업이익률</div>
          <div style="font-size:1.8em;font-weight:900;color:#27ae60;line-height:1.1;">${(k.profit?.rate||0).toFixed(1)}<span style="font-size:0.5em;">%</span></div>
          <div style="font-size:0.82em;color:#666;">이익 ${fmtAmt(k.profit?.totalProfit||0)}원</div>
        </div>
        <div data-tool="aging" title="클릭하면 채권 분석 도구가 열립니다" style="${cardStyle}">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">채권 30일 초과 <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:#e65100;line-height:1.1;">${fmtAmt(k.aging?.overdue||0)}<span style="font-size:0.5em;color:#888;">원</span></div>
          <div style="font-size:0.82em;color:#666;">전체 ${fmtAmt(k.aging?.total||0)}원</div>
        </div>
        <div data-tool="atp" title="클릭하면 가용재고 도구가 열립니다" style="${cardStyle}">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">가용재고 <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:${(k.atp?.shortage||0)>0?'#c62828':'#27ae60'};line-height:1.1;">${(k.atp?.totalMw||0).toFixed(2)}<span style="font-size:0.5em;color:#888;">MW</span></div>
          <div style="font-size:0.82em;color:#666;">${(k.atp?.shortage||0)>0?'⚠️ 부족 '+k.atp.shortage+'개':'✅ 정상'} · ${k.atp?.totalModels||0}개 모델</div>
        </div>
        <div data-tool="incoming" title="클릭하면 입고예정 도구가 열립니다" style="${cardStyle}">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">입고예정 <span style="color:#1565c0;font-weight:400;font-size:0.86em;">▶</span></div>
          <div style="font-size:1.8em;font-weight:900;color:#1565c0;line-height:1.1;">${fmtCap(k.incoming?.totalKw||0)}</div>
          <div style="font-size:0.82em;color:#666;">${k.incoming?.total||0}건 · 7일내 ${k.incoming?.within7||0}건</div>
        </div>
      </div>`;
  }

  // ── 카드 클릭 위임 핸들러 (한 번만 등록) ─────────────
  //   data-tool 속성을 가진 카드 클릭 시 해당 도구를 안전하게 호출.
  //   호버 효과도 여기서 전역 위임으로 통일.
  function _bindDashCardDelegate() {
    if (window.__erpDashCardBound) return;
    window.__erpDashCardBound = true;
    const TOOL_API = {
      aging:    () => (typeof aging    !== 'undefined' && aging.open)    ? aging.open()    : alert('채권 모듈이 로드되지 않았습니다.'),
      atp:      () => (typeof atp      !== 'undefined' && atp.open)      ? atp.open()      : alert('가용재고(ATP) 모듈이 로드되지 않았습니다.'),
      incoming: () => (typeof incoming !== 'undefined' && incoming.open) ? incoming.open() : alert('입고예정 모듈이 로드되지 않았습니다.')
    };
    document.addEventListener('click', e => {
      const card = e.target.closest('[data-tool]');
      if (!card) return;
      const tool = card.getAttribute('data-tool');
      const fn = TOOL_API[tool];
      if (fn) { try { fn(); } catch(err) { console.error('[dash-card]', tool, err); alert(tool + ' 도구 실행 오류: ' + err.message); } }
    });
    document.addEventListener('mouseover', e => {
      const card = e.target.closest('[data-tool]');
      if (!card) return;
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
    });
    document.addEventListener('mouseout', e => {
      const card = e.target.closest('[data-tool]');
      if (!card) return;
      card.style.transform = '';
      card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
    });
  }

  // ── 4. 출고지시서 탭 — 배차/일정 ────────────────────
  function _injectDelivery() {
    const tab = document.getElementById('tab-delivery');
    if (!tab) return;
    if (document.getElementById('tools-delivery')) return;
    const buttons = _toolButton('🚛 배차/일정 보드', '🚛', '#0d47a1', "dispatch && dispatch.open()", '트럭별 출고 묶음');
    const bar = document.createElement('div');
    bar.innerHTML = _toolBar('tools-delivery', '운영 도구', buttons);
    if (tab.firstChild) tab.insertBefore(bar.firstChild, tab.firstChild);
    else tab.appendChild(bar.firstChild);
  }

  // ── 5. 입고관리 + 재고관리 — 도구 박스 제거 (사용자 요청)
  //   기존에 주입된 "재고·입고 도구" 박스(구매이력 버튼)를 강제 제거하고 새로 주입하지 않음.
  function _injectInventory(tabId) {
    const tab = document.getElementById('tab-' + tabId);
    if (!tab) return;
    const existing = document.getElementById('tools-' + tabId);
    if (existing) existing.remove();
    // 도구바 자체를 주입하지 않음 (요청: 재고·입고 도구 구매이력 삭제)
  }

  // ── 6. 전수조사서 — SN 추적 ────────────────────────
  function _injectFR() {
    const tab = document.getElementById('tab-fr');
    if (!tab) return;
    if (document.getElementById('tools-fr')) return;
    const buttons = _toolButton('🏷 SN 추적', '🏷', '#7b1fa2', "sn && sn.open()", '시리얼 단위 이력');
    const bar = document.createElement('div');
    bar.innerHTML = _toolBar('tools-fr', '추적 도구', buttons);
    if (tab.firstChild) tab.insertBefore(bar.firstChild, tab.firstChild);
    else tab.appendChild(bar.firstChild);
  }

  // ── 7. 설정 탭 — 운영·도구 ─────────────────────────
  // ★ 2026-05-13 사용자 요청 — 설정 탭의 운영·도구 영역 비활성화
  //   시스템 상태/운영 대시보드/백업/복구/셋업 마법사 도구는 모두 대체 가능하거나
  //   설정 서브탭으로 이동했으므로 더 이상 별도 영역으로 노출하지 않음
  function _injectSettings() {
    // no-op (의도적으로 비활성)
  }

  // ── 8. showTab hook ────────────────────────────────
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__layoutHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      setTimeout(() => _injectForTab(id), 50);
      return r;
    };
    window.showTab.__layoutHooked = true;
  }

  function _injectForTab(id) {
    if (id === 'dashboard') _injectDashboard();
    if (id === 'delivery')  _injectDelivery();
    if (id === 'inventory') _injectInventory('inventory');
    if (id === 'stock')     _injectInventory('stock');
    if (id === 'fr')        _injectFR();
    if (id === 'settings')  _injectSettings();
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _bindEsc();
    _bindDashCardDelegate();   // ★ data-tool 카드 클릭 위임 (한 번만 등록)
    setTimeout(_hookShowTab, 200);
    // 첫 화면이 dashboard라면 즉시 inject
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active) {
        const tabId = active.id.replace('tab-', '');
        _injectForTab(tabId);
      }
      // 입고/재고 탭의 stale 도구바가 남아있으면 청소 (이전 버전 호환)
      ['inventory','stock'].forEach(id => {
        const el = document.getElementById('tools-' + id);
        if (el) el.remove();
      });
    }, 1200);
    // 혹시 dashboard가 active 아니어도 inject (dashboard 탭은 자주 봄)
    setTimeout(() => _injectDashboard(), 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 공개 API
  window.erpToolsLayout = {
    refreshDashboard: _refreshDashboardV2Inline,
    inject: _injectForTab
  };

  console.log('[ERP-LAYOUT] 도구 재배치 + 글로벌 ESC 활성');
})();
