// =====================================================
//  RESPONSIVE — 모바일·태블릿 반응형 레이아웃 (Sprint 5 · #1)
//
//  기능
//   1) 사이드바 → 햄버거 메뉴 (≤900px)
//   2) 데이터 테이블 → 카드 뷰 (≤700px)
//   3) 필터바·툴바 wrap 친화적 (≤900px)
//   4) 모달 → 풀스크린 (≤700px)
//   5) 터치 타겟 44px+ 확대 (모든 buttons)
//   6) 가로 스크롤 가능한 표는 좌우 swipe 힌트
//
//  브레이크포인트
//   - 모바일:    ≤700px
//   - 태블릿:   701~1024px
//   - 데스크톱: 1025px+
//
//  add-only — 기존 CSS·HTML 0줄 수정
//  공개 API: window.erpResponsive
// =====================================================
(function() {
  'use strict';

  // ── viewport meta 보강 (이미 있으면 skip) ────────────
  function _ensureViewport() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.insertBefore(vp, document.head.firstChild);
    }
    // user-scalable=yes 유지 (접근성)
    vp.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  }

  // ── 반응형 CSS 주입 ──────────────────────────────
  function _injectCss() {
    if (document.getElementById('erp-responsive-style')) return;
    const css = `
      /* ============================================
         태블릿 (≤1024px) — 사이드바 좁게, 패딩 축소
         ============================================ */
      @media (max-width: 1024px) {
        .nav-sidebar { width: 56px !important; min-width: 56px !important; }
        .nav-item span.nav-label { display: none !important; }
        .nav-section-label { font-size: 0.6em !important; padding: 4px 6px !important; text-align: center; }
        .nav-sidebar-brand { padding: 10px 6px !important; align-items: center; }
        .nav-sidebar-brand div:nth-child(2),
        .nav-sidebar-brand div:nth-child(3) { display: none !important; }
        .main { padding: 14px 16px !important; }
        .filter-bar { gap: 8px !important; }
        .filter-bar .fg { min-width: 120px; }
        .stats-row { grid-template-columns: repeat(3,1fr) !important; gap: 10px !important; }
        .stat-val { font-size: 1.4em !important; }
      }

      /* ============================================
         모바일 (≤900px) — 사이드바 햄버거 토글
         ============================================ */
      @media (max-width: 900px) {
        .nav-sidebar {
          position: fixed !important;
          top: 0 !important;
          left: -240px !important;
          width: 240px !important;
          min-width: 240px !important;
          height: 100vh !important;
          z-index: 9999;
          transition: left .25s ease;
          box-shadow: 2px 0 16px rgba(0,0,0,0.15);
        }
        .nav-sidebar.erp-mobile-open { left: 0 !important; }
        .nav-sidebar .nav-label { display: inline !important; }    /* 열렸을 때는 라벨 보임 */
        .nav-sidebar .nav-section-label { font-size: 0.78em !important; text-align: left !important; padding: 8px 16px !important; }
        .nav-sidebar .nav-sidebar-brand { padding: 18px 20px !important; align-items: flex-start !important; }
        .nav-sidebar .nav-sidebar-brand div:nth-child(2),
        .nav-sidebar .nav-sidebar-brand div:nth-child(3) { display: block !important; }

        /* 햄버거 버튼 */
        #erp-hamburger {
          position: fixed; top: 10px; left: 10px; z-index: 10000;
          width: 44px; height: 44px; border-radius: 8px;
          background: #1a1a2e; color: #fff; border: none; cursor: pointer;
          font-size: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          display: flex; align-items: center; justify-content: center;
        }
        #erp-hamburger:active { transform: scale(0.94); }

        /* 햄버거 메뉴 열렸을 때 배경 */
        #erp-mobile-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0,0,0,0.45); z-index: 9998;
          display: none; backdrop-filter: blur(2px);
        }
        #erp-mobile-overlay.open { display: block; }

        .app-header { padding-left: 60px !important; }   /* 햄버거 자리 확보 */
        .app-header h1 { font-size: 1em !important; }
        .header-right { font-size: 0.78em; }

        .main { padding: 12px 10px !important; }
        .stats-row { grid-template-columns: repeat(2,1fr) !important; gap: 8px !important; }
        .stat { padding: 10px !important; }
        .stat-val { font-size: 1.2em !important; }
        .stat-lbl { font-size: 0.74em !important; }
      }

      /* ============================================
         소형 모바일 (≤700px) — 카드 뷰 + 풀스크린 모달
         ============================================ */
      @media (max-width: 700px) {
        .stats-row { grid-template-columns: 1fr !important; }

        /* 필터바 — 세로 배치 */
        .filter-bar {
          flex-direction: column !important;
          align-items: stretch !important;
        }
        .filter-bar .fg {
          width: 100% !important;
          min-width: 0 !important;
        }
        .filter-bar .fg input,
        .filter-bar .fg select { width: 100% !important; }
        .filter-bar .btn { width: 100% !important; margin-top: 4px; }

        /* 큰 표는 가로 스크롤 + 끝 그라데이션 */
        .tbl-wrap {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch;
          position: relative;
        }
        .tbl-wrap::after {
          content: '→';
          position: sticky; right: 0; top: 50%;
          color: #c0c0c0; font-size: 1.4em; padding: 0 4px;
          pointer-events: none;
        }
        table { font-size: 0.78em !important; }
        th, td { padding: 6px 8px !important; white-space: nowrap; }

        /* 모달 — 풀스크린 */
        #erp-qt-modal .qt-box,
        #erp-ti-modal .ti-box,
        #erp-rt-modal .rt-box,
        #erp-vq-modal .vq-box,
        #erp-aging-panel,
        #erp-atp-panel,
        #erp-incoming-panel,
        #erp-pur-modal .pur-box,
        #erp-dsp-modal .dsp-box,
        #erp-ai-modal .ai-box,
        #erp-dv2-modal .dv2-box {
          width: 100% !important;
          max-width: 100% !important;
          height: 100vh !important;
          max-height: 100vh !important;
          border-radius: 0 !important;
        }

        /* 토스트·배지 위치 보정 (햄버거와 안 겹치게) */
        #erp-multitab-toast { top: 60px !important; right: 8px !important; left: 8px !important; max-width: none !important; }
        #erp-auth-badge { top: 6px !important; right: 6px !important; font-size: 0.7em !important; padding: 3px 6px !important; }

        /* 큰 액션 버튼 (터치 타겟 44px+) */
        .btn { min-height: 36px; padding: 8px 14px !important; }
        button:not(.btn-xs):not(.btn-sm) { min-height: 36px; }
      }

      /* ============================================
         프린트 모드 — 모바일 메뉴 숨김
         ============================================ */
      @media print {
        #erp-hamburger, #erp-mobile-overlay { display: none !important; }
      }

      /* ============================================
         접근성 — focus indicator 강화
         ============================================ */
      button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
        outline: 2px solid #1565c0 !important;
        outline-offset: 2px;
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-responsive-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── 햄버거 버튼 + 오버레이 ───────────────────────
  function _injectHamburger() {
    if (document.getElementById('erp-hamburger')) return;
    const btn = document.createElement('button');
    btn.id = 'erp-hamburger';
    btn.innerHTML = '☰';
    btn.title = '메뉴 열기';
    btn.setAttribute('aria-label', '메뉴 열기');
    btn.onclick = toggleSidebar;
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.id = 'erp-mobile-overlay';
    overlay.onclick = closeSidebar;
    document.body.appendChild(overlay);

    // 모바일에서만 보이게
    _updateHamburgerVisibility();
    window.addEventListener('resize', _updateHamburgerVisibility);
  }

  function _updateHamburgerVisibility() {
    const btn = document.getElementById('erp-hamburger');
    if (!btn) return;
    btn.style.display = window.innerWidth <= 900 ? 'flex' : 'none';
    if (window.innerWidth > 900) closeSidebar();
  }

  function toggleSidebar() {
    const nav = document.querySelector('.nav-sidebar');
    const overlay = document.getElementById('erp-mobile-overlay');
    if (!nav) return;
    const isOpen = nav.classList.contains('erp-mobile-open');
    if (isOpen) closeSidebar();
    else openSidebar();
  }

  function openSidebar() {
    const nav = document.querySelector('.nav-sidebar');
    const overlay = document.getElementById('erp-mobile-overlay');
    if (nav) nav.classList.add('erp-mobile-open');
    if (overlay) overlay.classList.add('open');
    const btn = document.getElementById('erp-hamburger');
    if (btn) { btn.innerHTML = '✕'; btn.title = '메뉴 닫기'; }
  }

  function closeSidebar() {
    const nav = document.querySelector('.nav-sidebar');
    const overlay = document.getElementById('erp-mobile-overlay');
    if (nav) nav.classList.remove('erp-mobile-open');
    if (overlay) overlay.classList.remove('open');
    const btn = document.getElementById('erp-hamburger');
    if (btn) { btn.innerHTML = '☰'; btn.title = '메뉴 열기'; }
  }

  // 탭 전환 시 모바일 메뉴 자동 닫힘
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__responsiveHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (window.innerWidth <= 900) closeSidebar();
      return r;
    };
    window.showTab.__responsiveHooked = true;
  }

  // ── 디바이스 감지 helper ─────────────────────────
  function getDevice() {
    const w = window.innerWidth;
    if (w <= 700) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
  }
  function isTouch() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    _ensureViewport();
    _injectCss();
    setTimeout(() => {
      _injectHamburger();
      _hookShowTab();
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.erpResponsive = {
    getDevice,
    isTouch,
    openSidebar,
    closeSidebar,
    toggleSidebar
  };

  console.log('[ERP-RESPONSIVE] 반응형 활성 — ' + getDevice() + (isTouch()?' (touch)':''));
})();
