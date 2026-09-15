// =====================================================
//  LIVE REFRESH — 데이터 변경 시 즉각 반영 시스템 (v2 · 2026-05-13)
//
//  v2 강화 사항
//   ★ save 함수 자체 가로채기 (saveLocal/saveFilesLocal/saveSettings/saveAllLocal)
//   ★ 모든 탭의 정확한 render 함수 매핑 (renderInventory, renderShipment 등)
//   ★ 모달 close 시 자동 재렌더
//   ★ 폼 submit 후 자동 재렌더
//   ★ 모듈별 _mountToTab 자동 호출 (탭 안 패널 갱신)
//   ★ rawData/localMeta/inventoryData 직접 변경 후에도 catch (memory-only 변화)
//   ★ visibility change 시 자동 새로고침
// =====================================================
(function() {
  'use strict';

  // ── 감시 대상 localStorage 키 패턴 ──────────────────
  const WATCHED_KEY_PATTERNS = [
    /^erp_raw$/, /^erp_local$/, /^erp_files$/, /^erp_inventory$/,
    /^erp_delivery/, /^erp_returns/, /^erp_dispatch/, /^erp_incoming/,
    /^erp_purchase/, /^erp_warehouse/, /^erp_thirdparty/, /^erp_logistics/,
    /^erp_credit/, /^erp_aging/, /^erp_inventory_lots/, /^erp_rental/,
    /^erp_settings$/, /^erp_app_settings$/, /^erp_product_master$/,
    /^erp_customer/, /^erp_vendor/, /^erp_quotation/, /^erp_vendor_quotes/,
    /^erp_sn_data$/, /^erp_docs$/, /^erp_cost_/, /^erp_atp_/,
    /^erp_market_rate/, /^erp_notify/, /^erp_claims/, /^erp_dispatch/,
    /^erp_truck/, /^erp_freight/, /^erp_purchase_price/, /^erp_inspection/
  ];

  function _isWatched(key) {
    if (!key || typeof key !== 'string') return false;
    return WATCHED_KEY_PATTERNS.some(re => re.test(key));
  }

  // ── 1) localStorage.setItem/removeItem 가로채기 ────
  function _hookLocalStorage() {
    if (window.__erpLiveRefreshHooked) return;
    window.__erpLiveRefreshHooked = true;
    const origSet = localStorage.setItem.bind(localStorage);
    const origDel = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function(key, val) {
      const before = (function(){ try { return localStorage.getItem(key); } catch(e){ return null; } })();
      origSet(key, val);
      if (_isWatched(key) && before !== val) _scheduleRefresh(key);
    };
    localStorage.removeItem = function(key) {
      origDel(key);
      if (_isWatched(key)) _scheduleRefresh(key);
    };
  }

  // ── 2) save* 함수 직접 가로채기 (이중 보장) ──────
  //   localStorage 가 안 바뀌어도 save 호출 자체가 데이터 변경 의도이므로 재렌더
  function _hookSaveFunctions() {
    const SAVE_FNS = [
      'saveLocal', 'saveFilesLocal', 'saveSettings', 'saveAllLocal',
      'saveGSUrlSettings', 'saveCompanySettings', 'saveProductMaster'
    ];
    SAVE_FNS.forEach(name => {
      if (typeof window[name] !== 'function') return;
      if (window[name].__liveRefreshHooked) return;
      const orig = window[name];
      window[name] = function() {
        const r = orig.apply(this, arguments);
        _scheduleRefresh('save:' + name);
        return r;
      };
      window[name].__liveRefreshHooked = true;
    });
    // 모듈 부팅 타이밍 다름 — 늦게 보이는 함수도 후킹
    if (!window.__saveHookRetry) {
      window.__saveHookRetry = 0;
      const retryTimer = setInterval(() => {
        window.__saveHookRetry++;
        _hookSaveFunctions();
        if (window.__saveHookRetry > 20) clearInterval(retryTimer);
      }, 500);
    }
  }

  // ── 3) 디바운스 (다발 변경 시 1번만) ────────────
  let _refreshTimer = null;
  const _changedKeys = new Set();
  function _scheduleRefresh(key) {
    _changedKeys.add(key);
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(_doRefresh, 100);   // 100ms 후 일괄 실행 (반응성 향상)
  }

  function _doRefresh() {
    const keys = Array.from(_changedKeys);
    _changedKeys.clear();
    // 캐시 무효화
    try { if (typeof window._bumpEnrichedTs === 'function') window._bumpEnrichedTs(); } catch(e) {}
    // 변경 이벤트 발화 — 다른 모듈이 구독 가능
    try { window.dispatchEvent(new CustomEvent('erp:data:changed', { detail: { keys } })); } catch(e) {}
    // 활성 탭 재렌더
    _refreshActiveTab();
  }

  // ── 4) 활성 탭 자동 재렌더 (v2 — 정확한 함수 매핑) ─
  function _refreshActiveTab() {
    const active = document.querySelector('.tab-panel.active');
    if (!active) return;
    const id = (active.id || '').replace(/^tab-/, '');
    _renderTabById(id);
  }

  function _safe(name, ...args) {
    try {
      if (typeof window[name] === 'function') {
        window[name].apply(null, args);
        return true;
      }
    } catch(e) {
      console.warn('[LIVE-REFRESH] ' + name + '() 실패:', e.message);
    }
    return false;
  }

  function _safeApi(obj, method, ...args) {
    try {
      if (window[obj] && typeof window[obj][method] === 'function') {
        window[obj][method].apply(window[obj], args);
        return true;
      }
    } catch(e) {
      console.warn('[LIVE-REFRESH] ' + obj + '.' + method + '() 실패:', e.message);
    }
    return false;
  }

  function _renderTabById(id) {
    try {
      // 항상 대시보드는 가볍게 갱신 (다른 탭 작업 후 돌아가도 최신)
      if (id !== 'dashboard') {
        // 다른 탭에 있어도 대시보드 데이터 갱신 (background)
      }

      if (id === 'dashboard') {
        _safe('renderDashboard');
      }
      else if (id === 'orders') {
        _safe('renderOrders');
        _safe('renderOrderCalendar');
      }
      else if (id === 'delivery') {
        _safe('renderShipment');
        _safe('renderSplitTab');
      }
      else if (id === 'inventory') {
        _safe('renderInventory');
        _safe('renderInventoryHistory');
        _safe('renderShipModelTbody');
        _safe('renderOutboundHistory');
        _safe('renderStockTab');
        _safeApi('inventoryLots', '_mountToTab');
      }
      else if (id === 'sales') {
        _safe('renderSalesPerf');
        // 신용분석/매출예측 패널 활성화 시 mount 재호출
        const cBox = document.querySelector('#creditTabHost .cr-box');
        if (cBox && cBox.offsetParent !== null) _safeApi('erpCredit', '_mountToTab');
        const fBox = document.querySelector('#forecastTabHost .fc-box');
        if (fBox && fBox.offsetParent !== null) _safeApi('erpForecast', '_mountToTab');
      }
      else if (id === 'salesops') {
        // 영업 탭 — 활성 서브탭만 갱신
        if (_visible('sops-docs-pane')) _safe('renderDocsTab');
        if (_visible('sops-inspection-pane')) _safe('renderInspectionTab');
        if (_visible('sops-po-pane')) _safe('renderPoList');
        if (_visible('sops-quote-pane')) _safeApi('quotation', '_mountToTab');
        if (_visible('sops-compare-pane')) _safeApi('vendorQuotes', '_mountToTab');
        if (_visible('sops-atp-pane')) _safeApi('atp', '_mountToTab');
      }
      else if (id === 'returns') {
        _safeApi('returns', '_mountToTab');
        _safeApi('returns', 'reload');
      }
      else if (id === 'incoming') {
        _safeApi('incoming', '_mountToTab');
      }
      else if (id === 'fr') {
        _safe('renderFrTab');
      }
      else if (id === 'settings') {
        _safe('renderProductMasterTable');
        _safe('renderSettingsTab');
      }
      else if (id === 'shipsched') {
        _safeApi('shipSched', '_mountToTab');
      }
      else if (id === 'cost_mgmt') {
        _safeApi('costMgmt', '_mountToTab');
        _safe('renderCostMgmtTab');
      }
      else if (id === 'warehouse') {
        _safe('renderWarehouseTab');
        _safe('renderWarehouseDashboard');
        _safeApi('logistics', '_mountToTab');
        _safeApi('warehouseRental', '_mountToTab');
        _safeApi('thirdparty', '_mountToTab');
      }
      else if (id === 'tools') {
        if (window.erpToolbar && window.erpToolbar.refresh) window.erpToolbar.refresh();
      }

      // 대시보드 카드는 항상 백그라운드로 가볍게 갱신 (탭이 무엇이든)
      //   alert 배지, 알림 카운트 등을 항상 최신으로
      if (window.notificationCenter && window.notificationCenter.refresh) {
        try { window.notificationCenter.refresh(); } catch(e) {}
      }
    } catch(e) {
      console.warn('[LIVE-REFRESH] 탭 재렌더 실패:', id, e);
    }
  }

  function _visible(id) {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none' && el.offsetParent !== null;
  }

  // ── 5) refreshAllTabs() 강화 ──────────────────────
  function _enhanceRefreshAll() {
    if (typeof window.refreshAllTabs !== 'function') {
      setTimeout(_enhanceRefreshAll, 300);
      return;
    }
    if (window.refreshAllTabs.__liveEnhanced) return;
    const orig = window.refreshAllTabs;
    window.refreshAllTabs = function() {
      try { orig.apply(this, arguments); } catch(e) {}
      _refreshActiveTab();
    };
    window.refreshAllTabs.__liveEnhanced = true;
  }

  // ── 6) 모달 close 자동 후킹 ─────────────────────
  //   모달이 닫힐 때 (등록·수정·삭제 후) 자동 재렌더
  function _hookModalClose() {
    // closeModal(id) 가 있으면 후킹
    if (typeof window.closeModal === 'function' && !window.closeModal.__liveHooked) {
      const orig = window.closeModal;
      window.closeModal = function(id) {
        const r = orig.apply(this, arguments);
        // 모달 닫기 후 100ms 뒤 재렌더 (모달 내 비동기 저장 대기)
        setTimeout(_refreshActiveTab, 100);
        return r;
      };
      window.closeModal.__liveHooked = true;
    }

    // 일반 .modal.open → 닫히는 패턴도 감지
    if (!window.__modalObserverInstalled) {
      const obs = new MutationObserver(records => {
        for (const r of records) {
          if (r.type !== 'attributes' || r.attributeName !== 'class') continue;
          const el = r.target;
          if (!(el instanceof Element)) continue;
          const wasOpen = (r.oldValue || '').includes('open');
          const isOpen = el.classList.contains('open');
          if (wasOpen && !isOpen && el.classList.contains('modal')) {
            setTimeout(_refreshActiveTab, 100);
          }
        }
      });
      obs.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
        subtree: true
      });
      window.__modalObserverInstalled = true;
    }
  }

  // ── 7) visibility change 후킹 ───────────────────
  //   다른 탭/창에서 변경된 후 돌아오면 즉시 갱신
  function _hookVisibility() {
    if (window.__liveVisHooked) return;
    window.__liveVisHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(_refreshActiveTab, 50);
      }
    });
    // 다른 브라우저 탭에서 ERP 데이터 변경된 경우 → 'storage' 이벤트로 감지
    window.addEventListener('storage', (e) => {
      if (_isWatched(e.key)) _scheduleRefresh(e.key);
    });
  }

  // ── 8) 폼 submit 후 후킹 ────────────────────────
  function _hookForms() {
    document.addEventListener('submit', (e) => {
      // 폼 submit 후 200ms 뒤 재렌더
      setTimeout(_refreshActiveTab, 200);
    }, true);   // capture phase
  }

  // ── 9) 공개 API ──────────────────────────────────
  window.erpLiveRefresh = {
    refresh: _refreshActiveTab,
    refreshTab: _renderTabById,
    trigger: (key) => _scheduleRefresh(key || 'manual'),
    forceNow: () => { clearTimeout(_refreshTimer); _doRefresh(); }
  };

  // ── 부팅 ───────────────────────────────────────
  function boot() {
    _hookLocalStorage();
    _hookSaveFunctions();
    _enhanceRefreshAll();
    _hookModalClose();
    _hookVisibility();
    _hookForms();
    // 모듈 부팅 후 다시 한번 save 후킹 (늦게 보이는 함수)
    setTimeout(_hookSaveFunctions, 1000);
    setTimeout(_hookSaveFunctions, 3000);
    setTimeout(_hookModalClose, 1000);

    console.log('[ERP-LIVE-REFRESH v2] 즉각 반영 시스템 활성 (강화 모드)');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
