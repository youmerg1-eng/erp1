// =====================================================
//  MULTI-TAB SYNC — 다중 탭 동기화
//
//  문제
//   - 같은 브라우저에서 두 탭으로 ERP를 동시 열면, 한 탭의 saveLocal()이
//     다른 탭의 in-memory 변수(rawData, localMeta 등)와 충돌.
//     늦게 저장한 탭이 먼저 저장한 탭의 변경을 silent 덮어씀.
//
//  해결
//   - storage 이벤트로 다른 탭의 localStorage 변경을 감지
//   - ERP 데이터 키가 변경되면:
//      1) loadAllLocal() 재호출로 메모리 동기화
//      2) 사용자에게 토스트로 알림
//      3) 현재 화면 자동 재렌더 (renderOrders, renderDashboard 등)
//      4) 다른 탭이 변경 중이면 5초간 자기 saveLocal 차단 (race 방지)
//
//  이벤트 키 모니터링: rawData / localMeta / inventory / delivery / files / settings / productMaster
//  기존 코드 0줄 수정 — 순수 add-only
// =====================================================
(function() {
  'use strict';

  // 모니터링할 ERP 키들
  const WATCHED_KEYS = new Set([
    'erp_raw', 'erp_local', 'erp_inventory', 'erp_delivery',
    'erp_files', 'erp_settings', 'erp_product_master',
    // 추가 모듈
    'erp_dispatch', 'erp_atp_meta', 'erp_aging', 'erp_incoming',
    'erp_customer_master', 'erp_vendor_master', 'erp_sn_db',
    'erp_vehicle_master', 'erp_driver_master', 'erp_freight_rates',
    'erp_auth', 'erp_auth_custom_perms'
  ]);

  // 데이터 키 → 다시 로드해야 할 in-memory 변수와 fallback 매핑
  // (loadAllLocal 이 처리하므로 직접 호출)
  const RELOAD_VIA_LOAD_ALL = new Set([
    'erp_raw', 'erp_local', 'erp_inventory', 'erp_delivery',
    'erp_files', 'erp_settings', 'erp_product_master'
  ]);

  // 마지막 외부 변경 시각 — 5초간 자기 저장 차단
  let _lastExternalChange = 0;
  const COOLDOWN_MS = 5000;

  function _isInCooldown() {
    return (Date.now() - _lastExternalChange) < COOLDOWN_MS;
  }

  // 토스트 — 다른 탭에서 변경 감지 알림
  function _toast(label, detail) {
    let el = document.getElementById('erp-multitab-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'erp-multitab-toast';
      el.style.cssText = 'position:fixed;top:60px;right:20px;z-index:9800;background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;font-size:0.86em;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,0.25);max-width:340px;line-height:1.5;cursor:pointer;animation:slideIn .25s;';
      el.title = '클릭하여 닫기';
      el.onclick = () => el.remove();
      document.body.appendChild(el);
      // 키프레임
      if (!document.getElementById('erp-multitab-style')) {
        const s = document.createElement('style');
        s.id = 'erp-multitab-style';
        s.textContent = '@keyframes slideIn{from{transform:translateX(60px);opacity:0;}to{transform:translateX(0);opacity:1;}}';
        document.head.appendChild(s);
      }
    }
    el.innerHTML = `<div>🔄 ${label}</div>${detail?`<div style="font-size:0.78em;opacity:0.9;margin-top:3px;font-weight:400;">${detail}</div>`:''}`;
    // 6초 후 자동 닫기
    clearTimeout(el.__hideTimer);
    el.__hideTimer = setTimeout(() => el.remove(), 6000);
  }

  // 화면 재렌더 — 가능한 함수만 호출 (안전)
  function _refreshAll() {
    [
      ['renderDashboard', 'dashboard'],
      ['renderOrders', '수주현황'],
      ['renderInventory', '재고/입고'],
      ['renderStock', '재고'],
      ['renderShipment', '출고'],
      ['renderSales', '영업실적']
    ].forEach(([fn]) => {
      if (typeof window[fn] === 'function') {
        try { window[fn](); } catch (e) { console.warn('[multitab] ' + fn + ' 재렌더 실패', e); }
      }
    });
    // 출고지시서 목록이 열려있으면 갱신
    if (typeof window.showDeliveryList === 'function' &&
        document.getElementById('deliveryListArea')?.querySelector('table')) {
      try { window.showDeliveryList(); } catch (e) {}
    }
    // 도구 모듈 갱신 (열려있을 때만)
    if (typeof dashboardV2 !== 'undefined' && dashboardV2.refresh &&
        document.getElementById('erp-dv2-modal')?.classList.contains('open')) {
      try { dashboardV2.refresh(); } catch (e) {}
    }
  }

  // 메인 핸들러 — storage 이벤트 수신 시 호출
  function _onStorage(e) {
    // event.key === null 이면 localStorage.clear() 실행 — 전체 복구 필요
    if (e.key === null) {
      console.warn('[multitab] localStorage.clear() 감지 — 전체 새로고침 권장');
      _toast('다른 탭에서 데이터 전체 삭제 감지', '새로고침이 필요할 수 있습니다.');
      return;
    }
    // ERP 외 키는 무시
    if (!WATCHED_KEYS.has(e.key)) return;
    // 이전 값과 동일하면 무시 (중복 발화 방지)
    if (e.oldValue === e.newValue) return;

    _lastExternalChange = Date.now();

    // 1) loadAllLocal 호출 — rawData/localMeta 등 in-memory 변수 동기화
    if (RELOAD_VIA_LOAD_ALL.has(e.key)) {
      if (typeof loadAllLocal === 'function') {
        try { loadAllLocal(); } catch (err) { console.error('[multitab] loadAllLocal 실패', err); }
      }
    } else {
      // 2) 그 외 키는 해당 모듈이 자체 로드 — 모듈별 reload 시도
      const moduleReloaders = {
        'erp_dispatch':         () => typeof dispatch !== 'undefined' && dispatch._refresh && dispatch._refresh(),
        'erp_aging':            () => typeof aging !== 'undefined' && aging.refresh && aging.refresh(),
        'erp_incoming':         () => typeof incoming !== 'undefined' && incoming.refresh && incoming.refresh(),
        'erp_atp_meta':         () => typeof atp !== 'undefined' && atp.refresh && atp.refresh(),
        'erp_customer_master':  () => typeof customerMaster !== 'undefined' && customerMaster.reload && customerMaster.reload(),
        'erp_vendor_master':    () => typeof vendorMaster !== 'undefined' && vendorMaster.reload && vendorMaster.reload(),
        'erp_sn_db':            () => typeof sn !== 'undefined' && sn.reload && sn.reload(),
        // 권한 변경 — UI 즉시 적용
        'erp_auth':             () => typeof erpAuth !== 'undefined' && erpAuth.setRole && erpAuth.setRole(erpAuth.getRole()),
        'erp_auth_custom_perms':() => {
          // 커스텀 권한 변경 — 현재 역할 재적용
          if (typeof erpAuth !== 'undefined' && erpAuth.getRole && erpAuth.setRole) {
            try { erpAuth.setRole(erpAuth.getRole()); } catch (e) {}
          }
        }
      };
      const reloader = moduleReloaders[e.key];
      if (reloader) {
        try { reloader(); } catch (err) { console.warn('[multitab] ' + e.key + ' reload 실패', err); }
      }
    }

    // 3) 화면 재렌더
    setTimeout(_refreshAll, 50);

    // 4) 사용자 알림
    const labels = {
      'erp_raw':            '수주 데이터',
      'erp_local':          '메타데이터',
      'erp_inventory':      '입출고',
      'erp_delivery':       '출고지시서',
      'erp_dispatch':       '배차',
      'erp_aging':          '채권',
      'erp_incoming':       '입고예정',
      'erp_atp_meta':       '재고',
      'erp_files':          '첨부파일',
      'erp_settings':       '환경설정',
      'erp_product_master': '제품 마스터',
      'erp_customer_master':'고객사 마스터',
      'erp_vendor_master':  '매입사 마스터',
      'erp_sn_db':          'SN 추적',
      'erp_auth':           '권한 (역할 변경)',
      'erp_auth_custom_perms': '권한 (커스텀 변경)'
    };
    const label = labels[e.key] || e.key;
    _toast(`다른 탭에서 ${label} 변경됨`, '현재 화면이 자동 동기화되었습니다.');
  }

  // saveLocal 가드 — 외부 변경 직후(쿨다운) 자기 저장은 위험.
  //   덮어쓰기 race 방지를 위해 5초간 사용자에게 확인 요청.
  function _hookSaveLocal() {
    if (typeof window.saveLocal !== 'function') { setTimeout(_hookSaveLocal, 300); return; }
    if (window.saveLocal.__multitabHooked) return;
    const _orig = window.saveLocal;
    window.saveLocal = function() {
      if (_isInCooldown()) {
        // 다른 탭이 방금 변경 — 사용자에게 묻고 진행
        const ok = confirm('⚠️ 다른 탭에서 방금 데이터가 변경되었습니다.\n\n현재 변경사항을 그대로 저장하면 다른 탭의 변경이 덮어써질 수 있습니다.\n\n저장하시겠습니까?\n(취소 시 이 변경은 무시됩니다)');
        if (!ok) {
          if (typeof setBanner === 'function')
            setBanner('warn', '⚠️ 다중 탭 충돌 — 저장 취소됨. 새로고침 권장.');
          return;
        }
      }
      return _orig.apply(this, arguments);
    };
    window.saveLocal.__multitabHooked = true;
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    // storage 이벤트는 다른 탭의 변경에서만 발생 (자기 탭 setItem은 발화 안 함 — 정상)
    window.addEventListener('storage', _onStorage);
    setTimeout(_hookSaveLocal, 1500);
    console.log('[ERP-MULTITAB] 다중 탭 동기화 활성 — ' + WATCHED_KEYS.size + '개 키 모니터링');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 공개 API — 디버깅용
  window.erpMultitab = {
    keys: () => Array.from(WATCHED_KEYS),
    inCooldown: _isInCooldown,
    refreshAll: _refreshAll
  };
})();
