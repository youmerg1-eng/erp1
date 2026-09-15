// =====================================================
//  TOP TOOLS COORDINATOR — 상단 우측 도구 모음 정리
//
//  문제: 여러 모듈이 각자 position:fixed; top/right 로 우상단에 배치
//        → 겹침 / z-index 충돌 / 좁은 화면 깨짐
//
//  해결: 단일 flex 컨테이너로 모든 도구를 통합
//        - 통합 캘린더 / 알림 / 동기화 / 에러 / 권한 / 환율 위젯 / AI 채팅 등
//        - 자동 감지 + 컨테이너로 이동 + 원래 inline 스타일 제거
//        - 좁은 화면에서 한 줄 → 여러 줄로 자동 wrap
// =====================================================
(function() {
  'use strict';

  // 정리 대상 ID 목록 + 표시 순서 (왼쪽 → 오른쪽)
  //   환율 위젯/AI 채팅 등은 별도 행/위치를 가지므로 컨테이너 미포함
  // ★ 2026-05-13 toolbar 의 미니바도 컨테이너에 포함시켜 겹침 해소
  const TOOL_IDS = [
    'erp-minibar',             // 미니바 (검색·계산기·AI·피드백) — 가장 왼쪽
    'uc-launch-btn',           // 통합 캘린더 (unified_calendar.js)
    'notif-bell',              // 알림 센터 (notification_center.js)
    'erp-error-indicator',     // 에러 인디케이터 (error_logger.js)
    'erp-sync-badge',          // 동기화 상태 (sync_stability.js)
    'erp-auth-badge',          // 권한 배지 (auth.js)
    'erp-un-badge'             // 미확정 알림 배지
  ];

  const CONTAINER_ID = 'erp-top-toolbar';

  function _ensureContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (c) return c;
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    c.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:14px',
      'z-index:9100',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'flex-wrap:wrap',
      'justify-content:flex-end',
      'max-width:calc(100vw - 320px)',  // 환율 위젯이 들어갈 공간 확보
      'pointer-events:none'
    ].join(';');
    // ★ 2026-05-13 미니바가 통합될 수 있도록 컨테이너 클래스 부여
    c.classList.add('erp-top-tools-host');
    document.body.appendChild(c);

    // ★ 2026-05-13 환율 위젯 — toptools 와 같은 줄에서 겹치는 문제 해결
    //   toptools 우측 끝에 위젯을 두면 통합 캘린더/알림/에러 배지가 가림.
    //   해결: 두 번째 행으로 내려서 표시 (top:48px) — 충돌 없음
    if (!document.getElementById('erp-toptools-override-style')) {
      const s = document.createElement('style');
      s.id = 'erp-toptools-override-style';
      s.textContent = `
        #erp-rate-widget {
          top: 48px !important;
          right: 14px !important;
          padding: 6px 10px !important;
          font-size: 0.74em !important;
          gap: 10px !important;
          z-index: 9050 !important;
        }
        /* toptools 컨테이너가 한 줄에 너무 길어지면 자동 wrap → 환율 위젯 위치도 살짝 더 내림 */
        @media (max-width: 1280px) {
          #erp-rate-widget {
            top: 50px !important;
          }
        }
        @media (max-width: 1100px) {
          /* 화면 좁아지면 환율 위젯은 숨김 — toptools 가 두 줄 차지 */
          #erp-rate-widget { display: none !important; }
        }
        @media (max-width: 768px) {
          #erp-top-toolbar {
            top: auto !important;
            bottom: 12px !important;
            right: 12px !important;
            max-width: calc(100vw - 24px) !important;
          }
          #erp-rate-widget {
            display: none !important;
          }
        }
      `;
      document.head.appendChild(s);
    }
    return c;
  }

  // 도구 1개를 컨테이너로 옮기고 inline 위치 스타일 제거
  function _migrateOne(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.dataset.toptoolsMigrated === '1') return false;

    const c = _ensureContainer();
    // 원래 fixed 위치/z-index 제거 (컨테이너가 관리)
    el.style.position = 'static';
    el.style.top = '';
    el.style.right = '';
    el.style.left = '';
    el.style.bottom = '';
    el.style.zIndex = '';
    el.style.pointerEvents = 'auto';   // 도구는 클릭 가능
    el.style.flex = '0 0 auto';
    el.dataset.toptoolsMigrated = '1';
    // ★ 미니바는 다른 도구보다 살짝 좌측(앞쪽)에 위치하도록 보장
    if (id === 'erp-minibar') c.insertBefore(el, c.firstChild);
    else c.appendChild(el);
    return true;
  }

  // 정렬 — 표시 순서대로 재배치
  function _reorder() {
    const c = _ensureContainer();
    TOOL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode === c) c.appendChild(el);   // 끝으로 옮김
    });
  }

  // 주기적으로 신규 도구 감지 + 이동
  function _scanAndMigrate() {
    let moved = 0;
    TOOL_IDS.forEach(id => {
      if (_migrateOne(id)) moved++;
    });
    if (moved > 0) _reorder();
  }

  // ── MutationObserver — 새 노드 추가 시 즉시 처리 ───
  function _observe() {
    if (!window.MutationObserver) return;
    const obs = new MutationObserver((mutations) => {
      let needScan = false;
      mutations.forEach(m => {
        m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (TOOL_IDS.includes(n.id)) needScan = true;
          // 자손 중에도 검사
          TOOL_IDS.forEach(id => {
            if (n.querySelector && n.querySelector('#'+id)) needScan = true;
          });
        });
      });
      if (needScan) _scanAndMigrate();
    });
    obs.observe(document.body, { childList: true, subtree: false });
  }

  // ── 모바일 대응 — 좁은 화면에서 하단으로 ──────────
  function _applyResponsive() {
    const c = document.getElementById(CONTAINER_ID);
    if (!c) return;
    if (window.innerWidth <= 768) {
      // 모바일: 하단 우측, 세로 정렬
      c.style.top = 'auto';
      c.style.bottom = '12px';
      c.style.right = '12px';
      c.style.flexDirection = 'row-reverse';
      c.style.flexWrap = 'wrap';
      c.style.maxWidth = 'calc(100vw - 24px)';
    } else {
      c.style.top = '8px';
      c.style.bottom = '';
      c.style.right = '14px';
      c.style.flexDirection = '';
    }
  }

  // ── 공개 API ────────────────────────────────────────
  window.toptools = {
    scan: _scanAndMigrate,
    reorder: _reorder,
    register: function(id) {
      if (id && !TOOL_IDS.includes(id)) TOOL_IDS.push(id);
      _scanAndMigrate();
    },
    container: () => document.getElementById(CONTAINER_ID)
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _ensureContainer();
    // 0초·1초·3초·6초 후 반복 스캔 — 모듈 부팅 타이밍이 다름
    setTimeout(_scanAndMigrate, 100);
    setTimeout(_scanAndMigrate, 1500);
    setTimeout(_scanAndMigrate, 3500);
    setTimeout(_scanAndMigrate, 6500);
    setTimeout(_scanAndMigrate, 12000);
    _observe();
    _applyResponsive();
    window.addEventListener('resize', _applyResponsive);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-TOPTOOLS] 상단 도구 코디네이터 활성 — toptools.scan()');
})();
