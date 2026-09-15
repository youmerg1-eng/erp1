// =====================================================
//  CLOUD SYNC (Apps Script 양방향) — Phase B · Week 5
//
//  목표
//   - 무료 0원으로 다중 사용자 환경 구축
//   - 기존 GS URL 재사용 (설정 탭의 URL)
//   - 오프라인 안전 (큐 기반)
//   - 충돌 감지 (마지막 변경 시각 비교)
//
//  필요사항
//   - Google Apps Script 측에 양방향 엔드포인트 등록
//     (apps_script_template.gs 파일 내용 참고 — 5분 작업)
//
//  콘솔
//     erpSync.now()         즉시 동기화
//     erpSync.status()      현재 상태
//     erpSync.queue()       대기 중인 변경 큐
//     erpSync.enable(true)  자동 동기화 ON/OFF
// =====================================================
(function() {
  'use strict';

  const SYNC_QUEUE_KEY  = 'erp_sync_queue';
  const SYNC_LAST_KEY   = 'erp_sync_lastpush';
  const SYNC_PULLED_KEY = 'erp_sync_lastpull';
  const SYNC_ENABLED_KEY = 'erp_sync_enabled';
  const POLL_MS = 30 * 1000;    // 30초마다 동기화 시도

  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]'); } catch(e) { queue = []; }

  let _syncing = false;
  let _enabled = localStorage.getItem(SYNC_ENABLED_KEY) === '1';
  let _timer = null;

  function _persistQueue() {
    try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue.slice(-500))); }
    catch(e) {}
  }

  // ── 변경 큐에 추가 ──────────────────────────────────
  //   type: 'rawData'|'localMeta'|'inventory'|'delivery'|'productMaster'
  //   op:   'upsert'|'delete'
  function enqueue(type, op, payload) {
    queue.push({
      id: 'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      when: new Date().toISOString(),
      type, op, payload
    });
    _persistQueue();
  }

  // ── saveLocal / saveSettings 가로채기 — 변경 자동 감지 ─
  //   단순화: 매 saveLocal 호출 시 전체 스냅샷 1건만 큐에 추가
  //   세분화는 향후 단계에서. 다중사용자 시나리오에서도 충돌은 timestamp로 처리.
  function _hookSavers() {
    if (typeof window.saveLocal === 'function' && !window.saveLocal.__synced) {
      const _orig = window.saveLocal;
      window.saveLocal = function() {
        const r = _orig.apply(this, arguments);
        if (_enabled) enqueue('snapshot', 'upsert', _captureFull());
        return r;
      };
      window.saveLocal.__synced = true;
    }
    if (typeof window.saveSettings === 'function' && !window.saveSettings.__synced) {
      const _orig = window.saveSettings;
      window.saveSettings = function() {
        const r = _orig.apply(this, arguments);
        if (_enabled && typeof appSettings !== 'undefined') {
          enqueue('settings', 'upsert', { settings: appSettings });
        }
        return r;
      };
      window.saveSettings.__synced = true;
    }
  }

  function _captureFull() {
    return {
      rawData:        typeof rawData        !== 'undefined' ? rawData        : null,
      localMeta:      typeof localMeta      !== 'undefined' ? localMeta      : null,
      inventoryData:  typeof inventoryData  !== 'undefined' ? inventoryData  : null,
      deliveryOrders: typeof deliveryOrders !== 'undefined' ? deliveryOrders : null,
      productMaster:  typeof productMaster  !== 'undefined' ? productMaster  : null,
      lastChangedAt:  new Date().toISOString(),
      device:         _deviceId()
    };
  }

  function _deviceId() {
    let id = localStorage.getItem('erp_device_id');
    if (!id) {
      id = 'D-' + Math.random().toString(36).slice(2,10);
      try { localStorage.setItem('erp_device_id', id); } catch(e) {}
    }
    return id;
  }

  // ── 동기화 실행 ─────────────────────────────────────
  async function pushOnce() {
    if (_syncing) return { skipped: true, reason: 'already syncing' };
    if (!_enabled) return { skipped: true, reason: 'disabled' };
    if (typeof gsUrl === 'undefined' || !gsUrl) return { skipped: true, reason: 'GS URL 미설정' };
    if (!queue.length) return { ok: true, pushed: 0 };

    _syncing = true;
    try {
      // 같은 타입의 연속 변경은 마지막 것만 보냄 (디바운스)
      const compact = _compactQueue(queue);
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },   // CORS 회피용
        body: JSON.stringify({ action: 'push', items: compact, device: _deviceId() }),
        redirect: 'follow'
      });
      const json = await res.json();
      if (json.success) {
        queue = [];
        _persistQueue();
        try { localStorage.setItem(SYNC_LAST_KEY, new Date().toISOString()); } catch(e) {}
        return { ok: true, pushed: compact.length };
      }
      throw new Error(json.error || 'push failed');
    } catch(e) {
      if (typeof logError === 'function') logError('sync.push', e);
      return { ok: false, error: e.message };
    } finally {
      _syncing = false;
    }
  }

  function _compactQueue(q) {
    // 같은 type/op는 마지막 것만 보냄 (snapshot 류 큰 변경에 적합)
    const lastOf = {};
    q.forEach(item => { lastOf[item.type + '|' + item.op] = item; });
    return Object.values(lastOf);
  }

  // [PATCH-H] 페이지네이션 — 1000건씩 fetch, 동일 type은 가장 최신만 적용
  async function pullOnce() {
    if (typeof gsUrl === 'undefined' || !gsUrl) return { skipped: true, reason: 'GS URL 미설정' };
    if (!_enabled) return { skipped: true, reason: 'disabled' };

    try {
      const since = localStorage.getItem(SYNC_PULLED_KEY) || '';
      const myDev = _deviceId();
      const aggregated = {};   // type → 가장 최신 update
      let cursor = 2;
      let pages = 0;
      let serverTime = null;
      const MAX_PAGES = 50;    // 50,000건 한도 (안전)

      while (pages < MAX_PAGES) {
        const url = gsUrl + '?action=pull' +
                    '&since=' + encodeURIComponent(since) +
                    '&device=' + myDev +
                    '&limit=1000&cursor=' + cursor;
        const res = await fetch(url, { redirect: 'follow' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'pull failed');

        const updates = (json.updates || []).filter(u => u.device !== myDev);
        updates.forEach(u => {
          // 같은 type은 최신 timestamp만 유지
          const cur = aggregated[u.type];
          if (!cur || (u.timestamp || '') > (cur.timestamp || '')) aggregated[u.type] = u;
        });
        if (json.serverTime) serverTime = json.serverTime;

        if (!json.hasMore || !json.nextCursor) break;
        cursor = json.nextCursor;
        pages++;
      }

      // 적용
      let applied = 0;
      Object.values(aggregated).forEach(u => {
        try { _applyUpdate(u); applied++; }
        catch(e) { if (typeof logError === 'function') logError('sync.apply', e); }
      });

      if (serverTime) {
        try { localStorage.setItem(SYNC_PULLED_KEY, serverTime); } catch(e) {}
      }

      if (applied > 0) {
        if (typeof refreshAllTabs === 'function') refreshAllTabs();
        if (typeof setBanner === 'function')
          setBanner('info', `🔄 다른 사용자 변경 ${applied}건 동기화 (페이지 ${pages+1})`);
      }
      return { ok: true, applied, pages: pages + 1 };
    } catch(e) {
      if (typeof logError === 'function') logError('sync.pull', e);
      return { ok: false, error: e.message };
    }
  }

  function _applyUpdate(u) {
    if (!u || !u.payload) return;
    const p = u.payload;
    // tx로 감싸서 안전하게 적용
    if (typeof tx === 'function') {
      tx('cloud-pull:' + (u.type||'unknown'), () => {
        _applyPayload(p);
        if (typeof saveLocal === 'function') saveLocal();
      });
    } else {
      _applyPayload(p);
      if (typeof saveLocal === 'function') saveLocal();
    }
  }

  function _applyPayload(p) {
    if (p.rawData && typeof rawData !== 'undefined') {
      rawData.length = 0; Array.prototype.push.apply(rawData, p.rawData);
    }
    if (p.localMeta && typeof localMeta !== 'undefined') {
      Object.keys(localMeta).forEach(k => delete localMeta[k]);
      Object.assign(localMeta, p.localMeta);
    }
    if (p.inventoryData && typeof inventoryData !== 'undefined') {
      inventoryData.length = 0; Array.prototype.push.apply(inventoryData, p.inventoryData);
    }
    if (p.deliveryOrders && typeof deliveryOrders !== 'undefined') {
      deliveryOrders.length = 0; Array.prototype.push.apply(deliveryOrders, p.deliveryOrders);
    }
    if (p.productMaster && typeof productMaster !== 'undefined') {
      Object.keys(productMaster).forEach(k => delete productMaster[k]);
      Object.assign(productMaster, p.productMaster);
    }
  }

  // ── 폴링 ────────────────────────────────────────────
  async function _tick() {
    if (!_enabled) return;
    try {
      await pushOnce();
      await pullOnce();
    } catch(e) {/* swallow */}
  }

  function _startPolling() {
    if (_timer) return;
    // ★ 2026-05-13 다중사용자 모드면 더 짧은 주기로 폴링
    const ms = (window.erpMultiUser && window.erpMultiUser.isActive && window.erpMultiUser.isActive())
      ? 10000   // 10초 — 다중사용자
      : POLL_MS; // 30초 — 단일사용자
    _timer = setInterval(_tick, ms);
  }
  function _stopPolling() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }
  function _restartPolling() {
    _stopPolling();
    if (_enabled) _startPolling();
  }
  // multiuser 모드 전환 시 polling 주기 재설정 (multiuser.js 가 호출)
  window.addEventListener('erp:multiuser:changed', _restartPolling);

  // ── 공개 API ────────────────────────────────────────
  window.erpSync = {
    enable: function(on) {
      _enabled = !!on;
      try { localStorage.setItem(SYNC_ENABLED_KEY, _enabled ? '1' : '0'); } catch(e) {}
      if (_enabled) { _hookSavers(); _startPolling(); _tick(); }
      else _stopPolling();
      console.log(`[ERP-SYNC] ${_enabled?'활성화':'비활성화'}`);
      if (typeof setBanner === 'function')
        setBanner('ok', `☁️ 클라우드 동기화 ${_enabled?'활성':'정지'}`);
      return _enabled;
    },
    isEnabled: () => _enabled,
    now: async function() {
      const p = await pushOnce();
      const q = await pullOnce();
      console.log('[SYNC] push:', p, 'pull:', q);
      return { push:p, pull:q };
    },
    push: pushOnce,
    pull: pullOnce,
    queue: () => queue.slice(),
    status: function() {
      return {
        enabled: _enabled,
        gsUrl: typeof gsUrl !== 'undefined' ? !!gsUrl : false,
        deviceId: _deviceId(),
        queueLength: queue.length,
        lastPush: localStorage.getItem(SYNC_LAST_KEY),
        lastPull: localStorage.getItem(SYNC_PULLED_KEY)
      };
    },
    clear: () => { queue = []; _persistQueue(); }
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    if (_enabled) {
      _hookSavers();
      _startPolling();
      // 첫 tick은 5초 뒤 (탭 스크립트 로드 안정화 대기)
      setTimeout(_tick, 5000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SYNC] 클라우드 동기화 모듈 로드됨' +
              (_enabled ? ' (활성)' : ' — erpSync.enable(true)로 활성화'));
})();
