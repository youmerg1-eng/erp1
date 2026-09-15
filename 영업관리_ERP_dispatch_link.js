// =====================================================
//  DISPATCH LINK — 배차 ↔ 출고지시서 양방향 자동 연동
//
//  연동 흐름
//   ① 출고지시서 생성 (createDeliveryOrder)
//      → 배차 보드 열려있으면 자동 갱신 (미배차 큐 즉시 반영)
//   ② 출고지시서 출고처리 (processDelivery)
//      → 묶인 배차 카드 자동 갱신
//   ③ 출고지시서 삭제 (deleteDeliveryOrder)
//      → 배차의 items 배열에서 자동 제거
//   ④ 배차 status='completed'
//      → 묶인 모든 출고지시서를 processed=true 로 자동 처리
//   ⑤ 배차 status='cancelled'
//      → items의 출고지시서들을 미배차로 자동 복귀 (items 비움)
//   ⑥ 출고지시서 목록 표에 "배차" 컬럼 inject
//      → 어느 배차에 속하는지 즉시 확인
//   ⑦ 미배차 카운트 우상단 알림 (10건 이상 시)
//
//  기존 dispatch.js / 출고지시서.js 코드는 0줄 수정 — wrap만 추가
// =====================================================
(function() {
  'use strict';

  // ── 헬퍼: doId가 어느 dispatch에 묶였는지 찾기 ──────
  function findDispatchOf(doId) {
    if (typeof dispatch === 'undefined') return null;
    return dispatch.list().find(d =>
      d.status !== 'cancelled' && (d.items || []).includes(doId)
    );
  }

  // ── ① createDeliveryOrder hook ─────────────────────
  function _hookCreate() {
    if (typeof window.createDeliveryOrder !== 'function') { setTimeout(_hookCreate, 300); return; }
    if (window.createDeliveryOrder.__linkHooked) return;
    const _orig = window.createDeliveryOrder;
    window.createDeliveryOrder = function() {
      const r = _orig.apply(this, arguments);
      // 배차 보드 열려있으면 갱신
      try {
        if (typeof dispatch !== 'undefined' && document.getElementById('erp-dsp-modal')?.classList.contains('open')) {
          dispatch._refresh();
        }
      } catch(e) {}
      _updateUnassignedBadge();
      return r;
    };
    window.createDeliveryOrder.__linkHooked = true;
  }

  // ── ② processDelivery hook ─────────────────────────
  function _hookProcess() {
    if (typeof window.processDelivery !== 'function') { setTimeout(_hookProcess, 300); return; }
    if (window.processDelivery.__linkHooked) return;
    const _orig = window.processDelivery;
    window.processDelivery = function(doId) {
      const r = _orig.apply(this, arguments);
      // 배차 보드 갱신
      try {
        if (typeof dispatch !== 'undefined' && document.getElementById('erp-dsp-modal')?.classList.contains('open')) {
          dispatch._refresh();
        }
      } catch(e) {}
      _updateUnassignedBadge();
      return r;
    };
    window.processDelivery.__linkHooked = true;
  }

  // ── ③ deleteDeliveryOrder hook ─────────────────────
  function _hookDelete() {
    if (typeof window.deleteDeliveryOrder !== 'function') { setTimeout(_hookDelete, 300); return; }
    if (window.deleteDeliveryOrder.__linkHooked) return;
    const _orig = window.deleteDeliveryOrder;
    window.deleteDeliveryOrder = function(id) {
      // 삭제 전: 어느 배차에 묶였는지 확인 후 미리 제거 (orig 호출 후 deliveryOrders가 사라지므로)
      let dspId = null;
      try {
        const dsp = findDispatchOf(id);
        if (dsp) dspId = dsp.id;
      } catch(e) {}
      const r = _orig.apply(this, arguments);
      // 배차에서 자동 제거
      if (dspId && typeof dispatch !== 'undefined' && dispatch.removeFrom) {
        try { dispatch.removeFrom(dspId, id); } catch(e) {}
      }
      _updateUnassignedBadge();
      return r;
    };
    window.deleteDeliveryOrder.__linkHooked = true;
  }

  // ── ④/⑤ dispatch.update hook (status 변경 자동 전파) ─
  function _hookDispatchUpdate() {
    if (typeof dispatch === 'undefined' || typeof dispatch.update !== 'function') {
      setTimeout(_hookDispatchUpdate, 300); return;
    }
    if (dispatch.update.__linkHooked) return;
    const _orig = dispatch.update;
    dispatch.update = function(id, patch) {
      const before = dispatch.list().find(d => d.id === id);
      const result = _orig.apply(this, arguments);
      if (!before || !patch) return result;

      // ④ completed → 묶인 출고지시서들도 processed 처리
      //   ★ 2026-05 변경: 저장 실패 시 롤백 + 명시적 에러 배너.
      //   이전 구현은 in-memory mutation 후 saveLocal()이 silent fail 해도
      //   "성공" 배너가 떠서 사용자가 새로고침하면 변경분이 사라지는 데이터
      //   불일치를 일으켰음. 이제 변경 전 snapshot을 떠두고 try/catch로 감싸
      //   실패 시 원상복구 + 사용자에게 알림.
      if (patch.status === 'completed' && before.status !== 'completed') {
        const items = (before.items || []);
        let updated = 0;
        if (typeof deliveryOrders !== 'undefined') {
          // ── snapshot — 롤백을 위해 변경 대상 deliveryOrder + meta 백업 ──
          const snapshot = {
            doProcessed: new Map(),    // doId → original processed flag
            metaPatches: new Map()     // metaKey → original status (또는 미존재 시 sentinel)
          };
          const _SENTINEL = Symbol('absent');

          try {
            items.forEach(doId => {
              const d = deliveryOrders.find(x => x.id === doId);
              if (d && !d.processed) {
                snapshot.doProcessed.set(doId, d.processed);
                d.processed = true;
                const metaKey = d.rowId || d.pjNo;
                if (metaKey && typeof localMeta !== 'undefined') {
                  if (!snapshot.metaPatches.has(metaKey)) {
                    snapshot.metaPatches.set(metaKey,
                      localMeta[metaKey] ? { ...localMeta[metaKey] } : _SENTINEL);
                  }
                  if (!localMeta[metaKey]) localMeta[metaKey] = {};
                  localMeta[metaKey].status = '납품완료';
                }
                updated++;
              }
            });

            if (updated > 0) {
              // saveLocal 시도 — 실패 시 throw 되어 catch로 진입
              if (typeof saveLocal === 'function') {
                try { saveLocal(); }
                catch (e) { throw new Error('saveLocal 실패: ' + (e.message || e)); }
              }
              if (typeof renderOrders === 'function') renderOrders();
              if (typeof renderDashboard === 'function') renderDashboard();
              if (typeof setBanner === 'function')
                setBanner('ok', `✅ 배차 완료 → 출고지시서 ${updated}건 자동 출고처리`);
            }
          } catch (err) {
            // ── 롤백 — snapshot 으로 복원 ──
            console.error('[dispatch-link] completed 처리 실패, 롤백 시도', err);
            try {
              snapshot.doProcessed.forEach((origProcessed, doId) => {
                const d = deliveryOrders.find(x => x.id === doId);
                if (d) d.processed = origProcessed;
              });
              snapshot.metaPatches.forEach((origMeta, metaKey) => {
                if (typeof localMeta !== 'undefined') {
                  if (origMeta === _SENTINEL) delete localMeta[metaKey];
                  else localMeta[metaKey] = origMeta;
                }
              });
            } catch (rollbackErr) {
              console.error('[dispatch-link] 롤백 실패', rollbackErr);
            }
            if (typeof setBanner === 'function')
              setBanner('err', `❌ 배차 완료 처리 실패 — 변경사항 롤백됨 (${err.message || '알 수 없는 오류'})`);
          }
        }
      }

      // ⑤ cancelled → 묶인 출고지시서를 미배차로 복귀 (items 비우기)
      if (patch.status === 'cancelled' && before.status !== 'cancelled') {
        // dispatch 데이터의 items는 그대로 두지만, status가 cancelled면 미배차 계산에서 제외됨
        // 별도 처리 불필요 (이미 unassigned()에서 status !== 'cancelled' 필터)
        if (typeof setBanner === 'function')
          setBanner('info', `↩️ 배차 취소 → 출고지시서 ${(before.items||[]).length}건 미배차 큐로 복귀`);
      }
      _updateUnassignedBadge();
      return result;
    };
    dispatch.update.__linkHooked = true;
  }

  // ── ⑥ 출고지시서 목록 표에 "배차" 컬럼 inject ───────
  function _hookDeliveryList() {
    if (typeof window.showDeliveryList !== 'function') { setTimeout(_hookDeliveryList, 300); return; }
    if (window.showDeliveryList.__linkHooked) return;
    const _orig = window.showDeliveryList;
    window.showDeliveryList = function() {
      const r = _orig.apply(this, arguments);
      setTimeout(_injectDispatchColumn, 50);
      return r;
    };
    window.showDeliveryList.__linkHooked = true;
  }

  function _injectDispatchColumn() {
    const area = document.getElementById('deliveryListArea');
    if (!area) return;
    const table = area.querySelector('table');
    if (!table || table.dataset.linkInjected) return;
    table.dataset.linkInjected = '1';

    // 헤더에 "배차" 컬럼 추가 (상태 앞)
    const thead = table.querySelector('thead tr');
    if (thead) {
      const ths = thead.querySelectorAll('th');
      // 상태 th 찾기 (마지막에서 두 번째)
      const statusTh = Array.from(ths).find(th => th.textContent.trim() === '상태');
      if (statusTh) {
        const newTh = document.createElement('th');
        newTh.textContent = '배차';
        thead.insertBefore(newTh, statusTh);
      }
    }

    // tbody 각 행에 배차 정보 셀 추가
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      const cb = tr.querySelector('.do-row-cb');
      if (!cb) return;
      const doId = cb.getAttribute('data-id');
      const dsp = findDispatchOf(doId);
      // 상태 셀 찾기
      const tds = tr.querySelectorAll('td');
      const statusTd = Array.from(tds).find(td => /대기|출고완료/.test(td.textContent));
      if (!statusTd) return;
      const newTd = document.createElement('td');
      newTd.style.fontSize = '0.82em';
      if (dsp) {
        const statusColors = { planned:'#1565c0', loading:'#e65100', transit:'#7b1fa2', completed:'#27ae60' };
        const c = statusColors[dsp.status] || '#666';
        newTd.innerHTML = `<div style="cursor:pointer;" onclick="if(typeof dispatch!=='undefined')dispatch.open()" title="배차 보드 열기">
          <span style="color:${c};font-weight:700;">📅 ${dsp.date}</span><br>
          <span style="color:#666;">🚛 ${dsp.vehicleNo}</span>
        </div>`;
      } else {
        newTd.innerHTML = `<button onclick="if(typeof dispatch!=='undefined')dispatch.open()"
          style="background:#ffebee;color:#c62828;border:1px dashed #c62828;padding:3px 8px;border-radius:4px;font-size:0.8em;cursor:pointer;">⚠️ 미배차</button>`;
      }
      tr.insertBefore(newTd, statusTd);
    });
  }

  // ── ⑦ 미배차 카운트 알림 ───────────────────────────
  function _updateUnassignedBadge() {
    if (typeof dispatch === 'undefined') return;
    const cnt = dispatch.unassigned().length;
    let badge = document.getElementById('erp-unassigned-badge');
    if (!badge && cnt >= 5) {
      badge = document.createElement('div');
      badge.id = 'erp-unassigned-badge';
      badge.style.cssText = 'position:fixed;top:42px;right:160px;z-index:9050;background:#c62828;color:#fff;padding:5px 12px;border-radius:8px;font-size:0.78em;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(198,40,40,0.4);animation:unBadgePulse 2s infinite;';
      badge.onclick = () => { if (typeof dispatch !== 'undefined') dispatch.open(); };
      document.body.appendChild(badge);
      // 펄스 애니메이션
      if (!document.getElementById('erp-unbadge-style')) {
        const s = document.createElement('style');
        s.id = 'erp-unbadge-style';
        s.textContent = '@keyframes unBadgePulse { 0%,100%{box-shadow:0 2px 8px rgba(198,40,40,0.4);} 50%{box-shadow:0 2px 16px rgba(198,40,40,0.95);} }';
        document.head.appendChild(s);
      }
    }
    if (cnt >= 5) {
      if (badge) {
        badge.innerHTML = `⚠️ 미배차 ${cnt}건`;
        badge.title = `미배차 출고지시서 ${cnt}건 — 클릭하면 배차 보드 열림`;
      }
    } else if (badge) {
      badge.remove();
    }
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    setTimeout(() => {
      _hookCreate();
      _hookProcess();
      _hookDelete();
      _hookDispatchUpdate();
      _hookDeliveryList();
      _updateUnassignedBadge();
    }, 1500);
    // 안전망 — 늦게 로드되는 모듈 대비
    setTimeout(() => {
      _hookCreate(); _hookProcess(); _hookDelete();
      _hookDispatchUpdate(); _hookDeliveryList();
    }, 4000);
    // 5분마다 미배차 배지 갱신
    setInterval(_updateUnassignedBadge, 5 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 공개 API — 디버깅용
  window.dispatchLink = {
    findDispatchOf,
    refreshUnassignedBadge: _updateUnassignedBadge,
    refreshDeliveryColumn: _injectDispatchColumn
  };

  console.log('[ERP-DSP-LINK] 배차↔출고지시서 양방향 연동 활성 (7-way hooks)');
})();
