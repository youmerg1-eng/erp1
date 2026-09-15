// =====================================================
//  WAREHOUSE TABS — 창고 마스터 / 타사 재고 / 창고 임대 정식 탭화 (Phase 7, v3)
//
//  v3 전략 (단순화)
//   1) 부팅 시 박스를 host 로 영구 이동 (탭 전환 시 이동 안 함)
//   2) 모달 #erp-XX-modal 은 display:none 으로 영구 숨김
//   3) api.open() 을 오버라이드 → showTab(탭 ID) 호출 + 원본 렌더 트리거
//   4) api.close() 는 no-op (탭 모드에선 의미 없음)
//
//  결과
//   - 사이드바 클릭 → showTab → tab-X.active → 박스(이미 host 안) 표시
//   - 대시보드 카드 클릭 → api.open() → showTab → 같은 탭 전환
//   - 모달은 절대 화면에 안 보임
//
//  공개 API: window.warehouseTabs
// =====================================================
(function() {
  'use strict';

  const TABS = {
    warehouse_master: {
      modalId: 'erp-wh-modal',
      boxClass: 'wh-box',
      hostId: 'warehouseMasterTabHost',
      apiName: 'warehouseMaster'
    },
    thirdparty: {
      modalId: 'erp-tp-modal',
      boxClass: 'tp-box',
      hostId: 'thirdPartyTabHost',
      apiName: 'thirdParty'
    },
    warehouse_rental: {
      modalId: 'erp-rt-modal',
      boxClass: 'rt-box',
      hostId: 'warehouseRentalTabHost',
      apiName: 'warehouseRental'
    },
    logistics: {
      modalId: 'erp-log-modal',
      boxClass: 'log-box',
      hostId: 'logisticsTabHost',
      apiName: 'logistics'
    }
  };

  // ── 모달 ID → cfg 역인덱스 ────────────────────────
  const TABS_BY_MODAL_ID = {};
  Object.values(TABS).forEach(cfg => { TABS_BY_MODAL_ID[cfg.modalId] = cfg; });

  // ── ★ 핵심 패치: addEventListener 후크 ───────────
  //   warehouse 모듈들은 modal.addEventListener('click', _onModalClick) 패턴 사용.
  //   박스를 host 로 이동하면 모달이 클릭 이벤트를 못 받아 핸들러가 작동 안 함.
  //   해결: modal 에 addEventListener 호출 시 box 에도 같은 핸들러를 부착.
  //   → 박스가 어디로 이동해도 핸들러가 따라감.
  //   addEventListener 는 EventTarget.prototype 에 정의 — 그쪽을 패치해야 확실히 동작.
  if (!window.__whTabsAelPatched) {
    const _origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      _origAEL.call(this, type, listener, options);
      // warehouse 모달이고 click/dblclick/change 이벤트면 box 에도 부착
      try {
        if (this && this.id && TABS_BY_MODAL_ID[this.id] &&
            (type === 'click' || type === 'dblclick' || type === 'change' || type === 'submit')) {
          const cfg = TABS_BY_MODAL_ID[this.id];
          const box = this.querySelector ? this.querySelector('.' + cfg.boxClass) : null;
          if (box) {
            if (!box.__whTabsListeners) box.__whTabsListeners = new Set();
            const sig = type + ':' + (typeof listener === 'function' ? listener.toString().slice(0, 100) : String(listener));
            if (!box.__whTabsListeners.has(sig)) {
              box.__whTabsListeners.add(sig);
              _origAEL.call(box, type, listener, options);
            }
          }
        }
      } catch(e) {
        // 패치 실패는 원본 동작에 영향 없도록 무시
      }
    };
    window.__whTabsAelPatched = true;
    console.log('[warehouse-tabs] addEventListener 패치 적용 — modal 핸들러가 box 에도 부착됨');
  }

  // ── 박스를 host 로 이동 (1회) ─────────────────────
  function _migrate(tabKey) {
    const cfg = TABS[tabKey];
    if (!cfg) return false;

    const api = window[cfg.apiName];
    if (!api || typeof api.open !== 'function') return false;

    const host = document.getElementById(cfg.hostId);
    if (!host) return false;

    // 이미 host 에 박스가 있으면 done
    if (host.querySelector('.' + cfg.boxClass)) return true;

    // 모달이 아직 없으면 강제로 _injectUI 트리거 (원본 open 호출)
    let modal = document.getElementById(cfg.modalId);
    let box = modal ? modal.querySelector('.' + cfg.boxClass) : null;
    if (!box) {
      try {
        const origOpen = api.__origOpen || api.open;
        origOpen.call(api);
      } catch(e) {
        console.error('[warehouse-tabs] _injectUI 트리거 실패:', tabKey, e);
      }
      modal = document.getElementById(cfg.modalId);
      box = modal ? modal.querySelector('.' + cfg.boxClass) : null;
    }
    if (!box || !modal) return false;

    // 모달 영구 숨김 (탭 모드에서 모달 overlay 불필요)
    modal.classList.remove('open');
    modal.style.display = 'none';

    // 박스를 host 로 이동
    host.appendChild(box);

    // 탭 모드 스타일
    box.style.maxHeight = 'none';
    box.style.maxWidth = '100%';
    box.style.width = '100%';
    box.style.boxShadow = '0 1px 6px rgba(0,0,0,0.06)';
    box.style.borderRadius = '12px';
    box.dataset.tabMode = '1';

    // 모달 close × 버튼 숨김 (탭에서 의미 없음)
    box.querySelectorAll('button').forEach(btn => {
      const txt = (btn.textContent || '').trim();
      const oc = btn.getAttribute('onclick') || '';
      if (txt === '✕' && oc.includes('classList.remove')) {
        btn.style.display = 'none';
      }
    });

    return true;
  }

  // ── api.open() 오버라이드 ─────────────────────────
  //   기존: 모달 띄움
  //   신규: 탭 전환 + 원본 렌더 호출 (모달은 inline display:none 로 가려짐)
  function _overrideOpen(tabKey) {
    const cfg = TABS[tabKey];
    if (!cfg) return false;
    const api = window[cfg.apiName];
    if (!api || typeof api.open !== 'function') return false;
    if (api.__whTabsOverridden) return true;

    const _origOpen = api.open;
    const _origClose = api.close;
    api.__origOpen = _origOpen;

    api.open = function() {
      // 1) 박스가 host 에 있는지 보장
      _migrate(tabKey);

      // 2) 탭으로 전환 (사이드바 클릭과 동일한 효과)
      if (typeof window.showTab === 'function') {
        try { window.showTab(tabKey); } catch(e) { console.error('[warehouse-tabs] showTab 실패', e); }
      }

      // 3) 원본 open 호출 → _renderList/_render 트리거
      //    (모달은 inline display:none 이므로 add('open') 해도 안 보임)
      try { _origOpen.call(this); } catch(e) { console.error('[warehouse-tabs] _origOpen 실패', e); }

      // 4) 모달 inline display:none 재확인
      const modal = document.getElementById(cfg.modalId);
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
    };

    api.close = function() {
      // 탭 모드에선 close 의미 없음
    };

    api.__whTabsOverridden = true;
    return true;
  }

  // ── 부팅 마이그레이션 ───────────────────────────
  let _migrateAttempts = 0;
  function _bootMigrate() {
    let allDone = true;
    Object.keys(TABS).forEach(k => {
      const ok = _migrate(k) && _overrideOpen(k);
      if (!ok) allDone = false;
    });
    if (!allDone) {
      _migrateAttempts++;
      if (_migrateAttempts < 30) {  // 최대 30회 = 6초
        setTimeout(_bootMigrate, 200);
      } else {
        console.error('[warehouse-tabs] 박스 마이그레이션 실패 — 모듈 미로드');
      }
    } else {
      console.log('[warehouse-tabs] v3 마이그레이션 완료 — 모든 박스가 탭 host 에 있음');
    }
  }

  // ── showTab 후크 — 탭 전환 시 렌더 갱신 ──────────
  //   _origOpen 호출 → _renderList 스케줄 → wh-bd 갱신
  //   (api.open 은 오버라이드돼 showTab 호출 → 무한 재귀 위험. _origOpen 사용)
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') {
      setTimeout(_hookShowTab, 50);
      return;
    }
    if (window.showTab.__whTabHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (TABS[id]) {
        const cfg = TABS[id];
        const api = window[cfg.apiName];
        // 박스가 아직 host 에 없으면 마이그레이션 시도
        const host = document.getElementById(cfg.hostId);
        if (host && !host.querySelector('.' + cfg.boxClass)) {
          _migrate(id);
          _overrideOpen(id);
        }
        // 원본 open 호출 → 렌더 트리거 (재귀 방지)
        if (api && api.__origOpen) {
          try { api.__origOpen.call(api); } catch(e) {}
          const modal = document.getElementById(cfg.modalId);
          if (modal) {
            modal.classList.remove('open');
            modal.style.display = 'none';
          }
        }
      }
      return r;
    };
    window.showTab.__whTabHooked = true;
    console.log('[warehouse-tabs] showTab hook 적용됨 (v3)');
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    _hookShowTab();
    // 모듈들은 setTimeout(_injectUI, 800) — 1000ms 후 시작
    setTimeout(_bootMigrate, 1000);
    // 페이지 로드 시 active 가 창고 사업 탭이면 즉시 렌더
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active) {
        const id = active.id.replace('tab-', '');
        if (TABS[id]) {
          const cfg = TABS[id];
          const api = window[cfg.apiName];
          if (api && api.__origOpen) {
            try { api.__origOpen.call(api); } catch(e) {}
            const modal = document.getElementById(cfg.modalId);
            if (modal) {
              modal.classList.remove('open');
              modal.style.display = 'none';
            }
          }
        }
      }
    }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 공개 API (디버그용)
  window.warehouseTabs = {
    migrate: _bootMigrate,
    forceMigrate: () => {
      _migrateAttempts = 0;
      _bootMigrate();
    },
    debug: () => {
      const out = {};
      Object.entries(TABS).forEach(([k, cfg]) => {
        const modal = document.getElementById(cfg.modalId);
        const host = document.getElementById(cfg.hostId);
        const api = window[cfg.apiName];
        out[k] = {
          modalExists: !!modal,
          modalDisplay: modal ? (modal.style.display || '(default)') : null,
          hostExists: !!host,
          boxInHost: host ? !!host.querySelector('.' + cfg.boxClass) : false,
          boxInModal: modal ? !!modal.querySelector('.' + cfg.boxClass) : false,
          apiLoaded: !!api,
          apiOverridden: !!(api && api.__whTabsOverridden),
          tabActive: document.getElementById('tab-' + k)?.classList.contains('active') || false
        };
      });
      return out;
    }
  };

  console.log('[warehouse-tabs] v3 활성 — 박스 영구 이동 + api.open() 오버라이드');
})();
