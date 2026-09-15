// =====================================================
//  MOBILE SHEET — 모바일 시트 패턴 (Phase 2 · #4)
//
//  모바일(≤ 768px) 에서 자동 적용:
//   1. 사이드바 → 햄버거 메뉴 + 슬라이드 드로어
//   2. 모달 → 바텀 시트 (아래에서 위로)
//   3. 테이블 → 카드형 리스트 (가로 스크롤 대체)
//   4. 입력 폼 → 1열 스택
//   5. 상단 FAB 버튼 자동 배치
//   6. 터치 친화 폰트 크기 (16px+)
//
//  공개 API: window.mobileSheet
// =====================================================
(function() {
  'use strict';

  const BREAKPOINT = 768;
  const CSS = `
    /* ===== 모바일 (≤ 768px) ===== */
    @media (max-width: 768px) {
      /* 햄버거 버튼 */
      .ms-hamburger {
        position: fixed; top: 8px; left: 12px; z-index: 9200;
        width: 38px; height: 38px; border-radius: 8px;
        background: #1a1a2e; color: #fff; border: none;
        font-size: 18px; cursor: pointer; padding: 0;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
      }
      .ms-hamburger:hover { background: #0d47a1; }

      /* 사이드바를 드로어로 변환 */
      .erp-side {
        position: fixed !important;
        top: 0 !important; left: -280px !important;
        width: 260px !important; height: 100vh !important;
        z-index: 9300 !important;
        transition: left 0.25s ease-out !important;
        box-shadow: 4px 0 16px rgba(0,0,0,0.2);
        overflow-y: auto;
        padding-top: 50px !important;
      }
      .erp-side.ms-open { left: 0 !important; }

      /* 오버레이 */
      .ms-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 9250;
        display: none;
      }
      .ms-overlay.ms-show { display: block; }

      /* 메인 영역 — 전체 너비 */
      .main {
        margin-left: 0 !important;
        padding: 50px 10px 10px !important;
      }

      /* 모달 → 바텀 시트 */
      .modal-content,
      .vq-box, .qt-box, .fc-box, .cr-box, .in-box, .rma-box, .uc-box,
      .dsp-box, .tp-box, .rt-box, .log-box, .pur-box {
        width: 100% !important;
        max-width: 100% !important;
        max-height: 90vh !important;
        margin: 0 !important;
        border-radius: 16px 16px 0 0 !important;
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        animation: ms-slide-up 0.25s ease-out;
      }
      .modal {
        align-items: flex-end !important;
        padding: 0 !important;
      }
      @keyframes ms-slide-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }

      /* 페이지 헤더 — 햄버거 옆 공간 확보 */
      .page-head { padding-left: 50px !important; }
      .page-title { font-size: 1.2em !important; }
      .page-sub { font-size: 0.84em !important; }

      /* 폼 1열 스택 */
      .modal-content > div[style*="grid-template-columns"],
      .card-body > div[style*="grid-template-columns"] {
        grid-template-columns: 1fr !important;
      }

      /* 입력 폰트 16px+ (iOS 줌 방지) */
      input, select, textarea, button {
        font-size: 16px !important;
      }
      .btn-xs, .btn-sm { font-size: 14px !important; }

      /* 테이블 가로 스크롤 강조 */
      .tbl-wrap {
        max-width: 100vw;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      .tbl-wrap table { font-size: 0.84em; }

      /* 토스트 위치 조정 */
      #erp-toast {
        bottom: 70px !important;
        left: 10px !important; right: 10px !important;
        max-width: none !important;
        font-size: 14px;
      }

      /* FAB 버튼 위치 — toptools 컨테이너가 관리하므로 개별 강제 위치 제거.
         단, 컨테이너 밖에 있는 경우 대비해 기본값만 지정 */
      #erp-top-toolbar {
        top: auto !important;
        bottom: 12px !important;
        right: 12px !important;
        max-width: calc(100vw - 24px) !important;
      }

      /* 통합 캘린더 셀 크기 축소 */
      .uc-cell { min-height: 55px !important; padding: 3px !important; }
      .uc-evt { font-size: 0.65em !important; padding: 1px 3px !important; }
      .uc-grid { grid-template-columns: 1fr !important; }
      .uc-side { max-height: 300px !important; }
    }

    /* ===== 태블릿 (769~1024px) ===== */
    @media (min-width: 769px) and (max-width: 1024px) {
      .modal-content,
      .vq-box, .qt-box, .fc-box, .cr-box, .in-box, .rma-box, .uc-box {
        width: 90% !important;
        max-width: 720px !important;
      }
      .page-title { font-size: 1.3em !important; }
    }
  `;

  function _injectStyles() {
    if (document.getElementById('ms-style')) return;
    const s = document.createElement('style');
    s.id = 'ms-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── 햄버거 버튼 ─────────────────────────────────────
  function _injectHamburger() {
    if (document.getElementById('ms-hamburger')) return;
    const btn = document.createElement('button');
    btn.id = 'ms-hamburger';
    btn.className = 'ms-hamburger';
    btn.innerHTML = '☰';
    btn.title = '메뉴 열기';
    btn.style.display = 'none';   // 데스크톱에서는 숨김
    btn.onclick = _toggleDrawer;
    document.body.appendChild(btn);

    // 오버레이
    const overlay = document.createElement('div');
    overlay.id = 'ms-overlay';
    overlay.className = 'ms-overlay';
    overlay.onclick = _closeDrawer;
    document.body.appendChild(overlay);
  }

  function _toggleDrawer() {
    const side = document.querySelector('.erp-side');
    const overlay = document.getElementById('ms-overlay');
    if (!side) return;
    if (side.classList.contains('ms-open')) _closeDrawer();
    else _openDrawer();
  }
  function _openDrawer() {
    document.querySelector('.erp-side')?.classList.add('ms-open');
    document.getElementById('ms-overlay')?.classList.add('ms-show');
  }
  function _closeDrawer() {
    document.querySelector('.erp-side')?.classList.remove('ms-open');
    document.getElementById('ms-overlay')?.classList.remove('ms-show');
  }

  // ── 미디어 쿼리 감지 + 햄버거 표시 ─────────────────
  function _updateHamburgerVisibility() {
    const btn = document.getElementById('ms-hamburger');
    if (!btn) return;
    const isMobile = window.innerWidth <= BREAKPOINT;
    btn.style.display = isMobile ? 'flex' : 'none';
    if (!isMobile) _closeDrawer();
  }

  // ── 사이드바 nav-item 클릭 시 드로어 자동 닫기 ──────
  function _hookNavItems() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.erp-side .nav-item');
      if (!btn) return;
      if (window.innerWidth <= BREAKPOINT) {
        setTimeout(_closeDrawer, 150);
      }
    });
  }

  // ── ESC 로 드로어 닫기 ──────────────────────────────
  function _hookEsc() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeDrawer();
    });
  }

  // ── 모바일 감지 ─────────────────────────────────────
  function isMobile() { return window.innerWidth <= BREAKPOINT; }

  // ── 공개 API ────────────────────────────────────────
  window.mobileSheet = {
    isMobile,
    openDrawer: _openDrawer,
    closeDrawer: _closeDrawer,
    toggleDrawer: _toggleDrawer
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _injectStyles();
    _injectHamburger();
    _hookNavItems();
    _hookEsc();
    _updateHamburgerVisibility();
    window.addEventListener('resize', _updateHamburgerVisibility);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-MOBILE] 모바일 시트 패턴 활성 (≤ 768px) — mobileSheet.openDrawer()');
})();
