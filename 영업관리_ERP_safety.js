// =====================================================
//  SAFETY LAYER v1 — Phase A · Week 1
//  목표: 기존 UI/코드 비침입 + 결함 0% 토대 마련
//
//  포함 기능
//   1) Safe Wrapper · 글로벌 에러 캡처
//   2) Schema Validation (수주/출고지시서/입출고)
//   3) 자동 백업 (직전값 _backup 키 + 일일 스냅샷)
//   4) 손상 시 자동 복구
//   5) IndexedDB 파일 저장소 — localStorage 용량 회수
// =====================================================
(function() {
  'use strict';

  // ── 0. 에러 로그 저장소 ──────────────────────────────
  window.__erpErrors = window.__erpErrors || [];

  function _stringify(v) {
    try { return typeof v === 'object' ? JSON.stringify(v).slice(0,300) : String(v).slice(0,300); }
    catch(e) { return '[unserializable]'; }
  }

  function logError(label, error, args) {
    const entry = {
      when: new Date().toISOString(),
      label: label || 'unknown',
      message: (error && error.message) || String(error),
      stack: (error && error.stack) || '',
      args: args ? Array.from(args).map(_stringify).join(' | ') : ''
    };
    console.error(`[ERP-SAFE] ${entry.label}`, error);
    window.__erpErrors.push(entry);
    if (window.__erpErrors.length > 200) window.__erpErrors.shift();
    try { localStorage.setItem('erp_errors', JSON.stringify(window.__erpErrors.slice(-50))); }
    catch(e) {}
  }
  window.logError = logError;

  // 콘솔에서 에러 보기 — F12 → viewErpErrors()
  window.viewErpErrors = function() {
    if (!window.__erpErrors.length) { console.log('✅ 누적 에러 없음'); return 0; }
    console.table(window.__erpErrors.map(e => ({when:e.when, label:e.label, msg:e.message})));
    return window.__erpErrors.length;
  };

  // ── 1. Safe Wrapper ─────────────────────────────────
  // 사용 예: const myFn = safe(_myFnImpl, '내함수', undefined);
  window.safe = function(fn, label, fallback) {
    return function(...args) {
      try { return fn.apply(this, args); }
      catch(e) {
        logError(label || fn.name || 'anon', e, args);
        if (typeof setBanner === 'function') {
          setBanner('err', `⚠️ ${label||fn.name||'작업'} 처리 중 오류 — 자동 보고됨 (F12 → viewErpErrors())`);
        }
        return fallback;
      }
    };
  };

  // ── 2. 글로벌 에러 캡처 ─────────────────────────────
  window.addEventListener('error', e => {
    logError('global:' + (e.filename||'').split('/').pop(), e.error || e, [e.message]);
  });
  window.addEventListener('unhandledrejection', e => {
    logError('promise', e.reason, []);
  });

  // ── 3. Schema Validation ────────────────────────────
  const SCHEMAS = {
    order: {
      'PJ NO':       { required:true,  type:'string', pattern:/^[A-Za-z0-9]{1,8}-?\d+(-\d+)?$/i, label:'PJ NO' },
      '담당자':      { type:'string', maxLen:50,  label:'담당자' },
      '고객사':      { type:'string', maxLen:200, label:'고객사' },
      '수량':        { type:'number', min:0, max:1000000, label:'수량' },
      '수주총액(원)': { type:'number', min:0, max:1e12,  label:'수주총액' }
    },
    deliveryOrder: {
      id:       { required:true, type:'string', label:'출고지시서 번호' },
      qty:      { required:true, type:'number', min:1, max:1000000, label:'수량' },
      foc:      { type:'number', min:0, max:1000000, label:'FOC' },
      model:    { required:true, type:'string', maxLen:200, label:'모델명' },
      receiver: { type:'string', maxLen:200, label:'수신처' }
    },
    inventory: {
      type: { required:true, type:'string', oneOf:['입고','출고'], label:'유형' },
      date: { required:true, type:'date', label:'날짜' },
      model:{ required:true, type:'string', maxLen:200, label:'모델명' },
      qty:  { required:true, type:'number', min:1, max:1000000, label:'수량' }
    }
  };

  function validate(obj, schema) {
    const errors = [];
    if (!obj || !schema) return errors;
    for (const [field, rule] of Object.entries(schema)) {
      const v = obj[field];
      const lbl = rule.label || field;
      const isEmpty = v == null || v === '' || (typeof v === 'string' && v.trim()==='');
      if (rule.required && isEmpty) { errors.push(`${lbl}: 필수 입력`); continue; }
      if (isEmpty) continue;
      if (rule.type === 'number') {
        const n = Number(String(v).replace(/,/g,''));
        if (!Number.isFinite(n)) { errors.push(`${lbl}: 숫자 형식 아님`); continue; }
        if (rule.min != null && n < rule.min) errors.push(`${lbl}: 최소 ${rule.min}`);
        if (rule.max != null && n > rule.max) errors.push(`${lbl}: 최대 ${rule.max.toLocaleString()}`);
      }
      if (rule.type === 'string') {
        const s = String(v);
        if (rule.maxLen && s.length > rule.maxLen) errors.push(`${lbl}: ${rule.maxLen}자 초과 (${s.length}자)`);
        if (rule.pattern && !rule.pattern.test(s)) errors.push(`${lbl}: 형식 오류 — "${s.slice(0,30)}"`);
        if (rule.oneOf && !rule.oneOf.includes(s)) errors.push(`${lbl}: 허용값 (${rule.oneOf.join('/')}) 아님`);
      }
      if (rule.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(`${lbl}: 날짜 형식 (YYYY-MM-DD)`);
      }
    }
    return errors;
  }

  window.validate = validate;
  window.SCHEMAS  = SCHEMAS;

  // 호출자 헬퍼: false 반환 시 호출자가 return 처리
  window.validateOrAlert = function(obj, schemaName) {
    const errs = validate(obj, SCHEMAS[schemaName] || {});
    if (errs.length) {
      alert(`❌ 입력 검증 실패\n\n• ${errs.join('\n• ')}\n\n수정 후 다시 시도해주세요.`);
      return false;
    }
    return true;
  };

  // ── 4. 자동 백업 — 직전값 _backup 키로 보존 ─────────
  //   [PATCH-A] Phase B/C 신규 모듈의 키 8개 추가 — 손상 시 자동 복구 보장
  //   ★ 2026-05 변경: BACKUP_KEYS를 Set 으로 변환 + window.erpSafety.protect()
  //   public API 노출. 신규 모듈이 자동 백업 보호를 받으려면 외부에서 호출하면 됨.
  const BACKUP_KEYS = new Set([
    // 코어 (Phase A 이전부터)
    'erp_raw','erp_local','erp_inventory','erp_delivery','erp_settings','erp_product_master','erp_files',
    // Phase B (4·6·7주차)
    'erp_customer_master','erp_notify_config','erp_notify_history',
    // Phase C (10·11·12주차)
    'erp_vendor_master','erp_claims','erp_sn_records','erp_mobile_sigs',
    // Phase D (Quick Wins)
    'erp_incoming','erp_calc_settings',
    // Phase E (구매·배차·권한)
    'erp_dispatch','erp_auth','erp_auth_custom_perms',
    // Phase F (AI·시세·대시보드v2)
    'erp_ai_history','erp_ai_consent','erp_market_rate_cache',
    // 배차 확장 (차량·기사·운송비)
    'erp_vehicle_master','erp_driver_master','erp_freight_rates',
    // Audit 자체도 보호 (이력 손상 방지)
    'erp_audit_log',
    // 운영·피드백·동기화
    'erp_feedback_log','erp_sync_queue','erp_device_id','erp_weekly_tests','erp_setup_seen'
  ]);
  // 콘솔에서 모니터링·관리 가능
  window.erpSafetyBackupKeys = BACKUP_KEYS;
  const _origSetItem = localStorage.setItem.bind(localStorage);
  const _origRemove  = localStorage.removeItem.bind(localStorage);

  // setItem 가로채기: 보호키는 직전값 _backup 보존 + getEnriched 캐시 무효화 + quota 가드
  // ★ 2026-05 추가: QuotaExceededError 시 자동 정리 + 사용자 알림.
  //   기본 5MB 한도 도달 시 (대략 ~3000 수주 + 첨부파일) silent 실패 위험.
  //   대응: 오래된 _backup, _undo_backup, erp_snapshot_*, erp_*_corrupted_* 정리 후 재시도.
  function _quotaCleanup() {
    let freed = 0;
    const keys = Object.keys(localStorage);
    // 우선순위: corrupted 백업 → 오래된 snapshot → undo_backup → 7일 이상 audit 단편
    const removableByPattern = [
      /_corrupted_/,                  // 손상 데이터 백업 (재발생 시 가장 먼저)
      /erp_snapshot_/,                // 일일 스냅샷
      /_undo_backup$/                 // undo 메타
    ];
    for (const pattern of removableByPattern) {
      keys.filter(k => pattern.test(k)).forEach(k => {
        try { _origRemove(k); freed++; } catch(e) {}
      });
      if (freed > 5) break;          // 한 번에 너무 많이 정리하지 않음
    }
    return freed;
  }

  localStorage.setItem = function(key, val) {
    if (BACKUP_KEYS.has(key)) {
      try {
        const prev = localStorage.getItem(key);
        if (prev != null && prev !== val) _origSetItem(key + '_backup', prev);
      } catch(e) {
        // _backup 저장 실패 — 본 데이터 저장은 시도해야 함, 무시
      }
    }
    // ★ 2026-05 추가: 핵심 데이터 키 변경 시 getEnriched 캐시 무효화
    if (key === 'erp_raw' || key === 'erp_local' || key === 'erp_delivery') {
      if (typeof window._bumpEnrichedTs === 'function') {
        try { window._bumpEnrichedTs(); } catch(e) {}
      }
    }
    // ★ quota 가드 — 실패 시 자동 정리 후 1회 재시도
    try {
      return _origSetItem(key, val);
    } catch (err) {
      const isQuota = err && (err.name === 'QuotaExceededError'
                       || err.code === 22 || err.code === 1014  // Firefox NS_ERROR_DOM_QUOTA_REACHED
                       || /quota/i.test(err.message || ''));
      if (!isQuota) throw err;
      const freed = _quotaCleanup();
      console.warn('[ERP-SAFE] localStorage quota 초과 — 정리 ' + freed + '개 후 재시도', { key });
      try {
        const result = _origSetItem(key, val);
        if (typeof setBanner === 'function') {
          setTimeout(() => setBanner('warn',
            `⚠️ 저장 공간 부족 — ${freed}개 백업/스냅샷 자동 정리 후 재저장 완료. ` +
            `장기적으로 첨부파일 정리 또는 백업 다운로드 후 audit clear 권장.`), 800);
        }
        return result;
      } catch (err2) {
        // 재시도도 실패 — 사용자에게 명시적 에러 + 데이터 보존 가이드
        console.error('[ERP-SAFE] localStorage quota 재시도 실패', err2);
        if (typeof setBanner === 'function') {
          setBanner('err',
            `❌ 저장 공간 부족 — 데이터 저장 실패. 백업 다운로드(설정 탭) 후 일부 데이터 정리 필요.`);
        } else {
          alert('저장 공간 부족 — 데이터 저장 실패\n설정 탭에서 백업을 다운로드 후 일부 데이터를 정리해주세요.');
        }
        throw err2;
      }
    }
  };

  // 일일 스냅샷 (하루 1회) + 7일 이상 자동 정리
  function saveDailySnapshot() {
    const today = new Date().toISOString().slice(0,10);
    const snapKey = 'erp_snapshot_' + today;
    if (localStorage.getItem(snapKey)) return;
    const snap = { when: new Date().toISOString() };
    BACKUP_KEYS.forEach(k => snap[k] = localStorage.getItem(k));
    try {
      _origSetItem(snapKey, JSON.stringify(snap));
      // 오래된 스냅샷 정리
      Object.keys(localStorage).forEach(k => {
        if (k.indexOf('erp_snapshot_') !== 0) return;
        const d = k.replace('erp_snapshot_','');
        const age = (new Date() - new Date(d)) / 86400000;
        if (age > 7) _origRemove(k);
      });
      console.log('[ERP-SAFE] 일일 스냅샷 저장:', snapKey);
    } catch(e) {
      console.warn('[ERP-SAFE] 스냅샷 저장 실패 (용량 부족) — 자동 정리 시도');
      Object.keys(localStorage).filter(k=>k.indexOf('erp_snapshot_')===0).forEach(_origRemove);
    }
  }

  // 손상 시 자동 복구 (앱 시작 시 1회)
  //   [PATCH-A] 배열형 키 패턴 확장 (claims/audit/notify_history 추가)
  const _ARRAY_KEY_PATTERN = /raw|inventory|delivery|claims|audit|notify_history/;
  function autoRecoverIfCorrupted() {
    const recovered = [];
    BACKUP_KEYS.forEach(key => {
      const v = localStorage.getItem(key);
      if (v == null) return;
      try { JSON.parse(v); }
      catch(e) {
        const bk = localStorage.getItem(key + '_backup');
        if (bk) {
          try { JSON.parse(bk); _origSetItem(key, bk); recovered.push(key); }
          catch(e2) { _origSetItem(key, _ARRAY_KEY_PATTERN.test(key) ? '[]' : '{}'); }
        } else {
          _origSetItem(key, _ARRAY_KEY_PATTERN.test(key) ? '[]' : '{}');
        }
      }
    });
    if (recovered.length) {
      console.warn('[ERP-SAFE] 손상 키 백업 복원:', recovered);
      setTimeout(() => {
        if (typeof setBanner === 'function')
          setBanner('warn', `⚠️ 일부 데이터 손상 → 직전 백업에서 자동 복구: ${recovered.join(', ')}`);
      }, 800);
    }
  }

  // ── 5. IndexedDB 파일 저장소 ────────────────────────
  const IDB_NAME = 'erpFilesDB';
  const IDB_STORE = 'files';
  let _idb = null;

  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = e => { _idb = e.target.result; res(_idb); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function idbPut(key, value) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
    });
  }
  async function idbGet(key) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r  = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror   = e => rej(e.target.error);
    });
  }
  async function idbDel(key) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
    });
  }

  window.idbPut = idbPut;
  window.idbGet = idbGet;
  window.idbDel = idbDel;

  // 기존 localStorage filesData → IDB 섀도우 백업
  //   ⚠️ 기존 코드가 nested(filesData[id][type])와 flat(filesData['id|type']) 두 포맷을
  //   동시에 사용하므로 이번 단계에선 localStorage 삭제하지 않음 (백업만).
  //   향후 단계에서 단일포맷 리팩터 후 IDB 단일소스로 전환.
  async function shadowBackupFilesToIDB() {
    const old = localStorage.getItem('erp_files');
    if (!old) return;
    let parsed;
    try { parsed = JSON.parse(old); } catch(e) { return; }
    if (!parsed || typeof parsed !== 'object') return;

    // 마지막 백업 해시와 비교 — 변화 없으면 skip
    const sig = String(old.length) + ':' + (old.length > 0 ? old.slice(0, 50) : '');
    if (localStorage.getItem('erp_files_idb_sig') === sig) return;

    let count = 0;
    for (const [key, val] of Object.entries(parsed)) {
      try { await idbPut(key, val); count++; }
      catch(e) { logError('idb-backup:'+key, e); }
    }
    _origSetItem('erp_files_idb_sig', sig);
    console.log(`[ERP-SAFE] 파일 ${count}건 IndexedDB 섀도우 백업 — localStorage는 그대로 유지`);
  }

  // =====================================================
  //  v2 — Phase A · Week 2
  //  Transaction · Audit Log · Undo · Self-healing 강화
  // =====================================================

  // ── 7. Transaction (원자적 변경 + Rollback) ─────────
  //   사용 예
  //     tx('출고지시서 생성', () => {
  //       deliveryOrders.push(order);
  //       inventoryData.push(stockOut);
  //       localMeta[id].deliveryOrderId = order.id;
  //       saveLocal();
  //     });
  //   하나라도 throw 발생 → 전체 롤백 + 에러 로그 + 토스트
  function _deepClone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch(e) { return v; }
  }

  function _captureState() {
    return {
      rawData:        typeof rawData        !== 'undefined' ? _deepClone(rawData)        : null,
      localMeta:      typeof localMeta      !== 'undefined' ? _deepClone(localMeta)      : null,
      inventoryData:  typeof inventoryData  !== 'undefined' ? _deepClone(inventoryData)  : null,
      deliveryOrders: typeof deliveryOrders !== 'undefined' ? _deepClone(deliveryOrders) : null,
      productMaster:  typeof productMaster  !== 'undefined' ? _deepClone(productMaster)  : null,
      appSettings:    typeof appSettings    !== 'undefined' ? _deepClone(appSettings)    : null
    };
  }

  function _restoreState(snap) {
    if (!snap) return;
    if (snap.rawData        != null && typeof rawData        !== 'undefined') { rawData.length = 0;        Array.prototype.push.apply(rawData,        snap.rawData); }
    if (snap.inventoryData  != null && typeof inventoryData  !== 'undefined') { inventoryData.length = 0;  Array.prototype.push.apply(inventoryData,  snap.inventoryData); }
    if (snap.deliveryOrders != null && typeof deliveryOrders !== 'undefined') { deliveryOrders.length = 0; Array.prototype.push.apply(deliveryOrders, snap.deliveryOrders); }
    if (snap.localMeta     != null && typeof localMeta     !== 'undefined') { Object.keys(localMeta).forEach(k => delete localMeta[k]);     Object.assign(localMeta,     snap.localMeta); }
    if (snap.productMaster != null && typeof productMaster !== 'undefined') { Object.keys(productMaster).forEach(k => delete productMaster[k]); Object.assign(productMaster, snap.productMaster); }
    if (snap.appSettings   != null && typeof appSettings   !== 'undefined') { Object.keys(appSettings).forEach(k => delete appSettings[k]); Object.assign(appSettings,   snap.appSettings); }
    if (typeof saveLocal === 'function')    saveLocal();
    if (typeof saveSettings === 'function') saveSettings();
  }

  // [PATCH-D] async 명시적 차단 — Promise 반환 시 즉시 throw
  window.tx = function(label, fn) {
    const snap = _captureState();
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        // 비동기 작업은 롤백 보장 불가 → 즉시 차단
        _restoreState(snap);  // 안전을 위해 일단 복원
        const msg = `tx()는 동기 함수만 허용 (label: ${label}). async/await/Promise 사용 시 rollback 보장 안 됨 — 별도 처리 필요`;
        logError('tx:async-rejected', new Error(msg));
        throw new Error('[ERP-SAFE] ' + msg);
      }
      return result;
    } catch(e) {
      _restoreState(snap);
      logError('tx:' + (label||'unknown'), e);
      if (typeof setBanner === 'function')
        setBanner('err', `❌ ${label||'작업'} 실패 → 직전 상태로 자동 복구`);
      throw e;
    }
  };

  // ── 8. Audit Log (변경 이력 + Undo) ────────────────
  //   - 모든 saveLocal/saveSettings 호출 직전 스냅샷 1개 보존
  //   - 최대 50건 (FIFO) — 디스크 절약
  //   - undo(idx) 로 임의 시점 복원
  const AUDIT_MAX = 50;
  const AUDIT_KEY = 'erp_audit_log';
  let auditLog = [];
  try {
    const stored = localStorage.getItem(AUDIT_KEY);
    if (stored) auditLog = JSON.parse(stored).slice(-AUDIT_MAX);
  } catch(e) { auditLog = []; }

  function _persistAudit() {
    try { _origSetItem(AUDIT_KEY, JSON.stringify(auditLog.slice(-AUDIT_MAX))); }
    catch(e) {
      // 용량 부족 → 절반으로 줄여 재시도
      auditLog = auditLog.slice(-Math.floor(AUDIT_MAX/2));
      try { _origSetItem(AUDIT_KEY, JSON.stringify(auditLog)); } catch(e2) {}
    }
  }

  // [PATCH-B] 경량화 — 풀스냅샷 대신 메타+counts만 (10MB → 50KB)
  //   undo는 _backup 키 활용 (직전 1단계). N단계 undo는 일일 스냅샷 사용.
  function _recordAudit(label) {
    const entry = {
      id: 'A-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      when: new Date().toISOString(),
      label: label || 'save',
      counts: {
        orders:     typeof rawData        !== 'undefined' ? rawData.length        : 0,
        deliveries: typeof deliveryOrders !== 'undefined' ? deliveryOrders.length : 0,
        inventory:  typeof inventoryData  !== 'undefined' ? inventoryData.length  : 0,
        customers:  typeof window.customerMaster !== 'undefined' ? Object.keys((customerMaster.raw && customerMaster.raw())||{}).length : 0,
        vendors:    typeof window.vendor !== 'undefined' ? Object.keys((vendor.raw && vendor.raw())||{}).length : 0,
        sn:         typeof window.sn !== 'undefined' ? Object.keys((sn.raw && sn.raw())||{}).length : 0
      }
      // snap 제거 — _backup 키 시스템으로 직전 1단계 복원 가능
    };
    auditLog.push(entry);
    if (auditLog.length > AUDIT_MAX) auditLog = auditLog.slice(-AUDIT_MAX);
    _persistAudit();
  }

  // saveLocal/saveSettings를 가로채 audit 자동 기록
  function _hookSaveFunctions() {
    if (typeof window.saveLocal === 'function' && !window.saveLocal.__audited) {
      const _orig = window.saveLocal;
      window.saveLocal = function() {
        _recordAudit('saveLocal');
        return _orig.apply(this, arguments);
      };
      window.saveLocal.__audited = true;
    }
    if (typeof window.saveSettings === 'function' && !window.saveSettings.__audited) {
      const _orig = window.saveSettings;
      window.saveSettings = function() {
        _recordAudit('saveSettings');
        return _orig.apply(this, arguments);
      };
      window.saveSettings.__audited = true;
    }
  }

  // ★ 2026-05 추가: BACKUP_KEYS public API
  //   신규 모듈이 자기 키를 자동 백업 보호 대상에 추가하려면:
  //     erpSafety.protect('erp_my_module_data')
  //   콘솔에서 보호 상태 확인:
  //     erpSafety.list()  →  보호 중인 키 목록
  //     erpSafety.unprotect('erp_xxx')  →  특정 키만 보호 해제
  window.erpSafety = {
    protect: function(key) {
      if (!key || typeof key !== 'string') { console.warn('[erpSafety.protect] 키 필요'); return false; }
      BACKUP_KEYS.add(key);
      console.log('[erpSafety] 보호 추가:', key, '(총 ' + BACKUP_KEYS.size + '개)');
      return true;
    },
    unprotect: function(key) {
      const removed = BACKUP_KEYS.delete(key);
      if (removed) console.log('[erpSafety] 보호 해제:', key);
      return removed;
    },
    isProtected: function(key) { return BACKUP_KEYS.has(key); },
    list: function() { return Array.from(BACKUP_KEYS).sort(); },
    count: function() { return BACKUP_KEYS.size; }
  };

  // [PATCH-B] undo는 _backup 키 기반 (직전 1단계). 14개 키 모두 일괄 복원.
  window.audit = {
    list: function(n) {
      const slice = auditLog.slice(-(n||10)).reverse();
      console.table(slice.map(e => ({
        id: e.id,
        when: e.when.replace('T',' ').slice(0,19),
        label: e.label,
        주문: e.counts.orders,
        출고지시서: e.counts.deliveries,
        입출고: e.counts.inventory,
        고객사: e.counts.customers || 0,
        매입사: e.counts.vendors || 0,
        SN: e.counts.sn || 0
      })));
      return slice.length;
    },
    // [PATCH-B] _backup 키에서 복원 — id 무시 (직전 1단계만 가능)
    undo: function() {
      // 복원 가능 여부 확인
      const candidates = Array.from(BACKUP_KEYS).filter(k => localStorage.getItem(k+'_backup') != null);
      if (!candidates.length) {
        alert('복원할 백업이 없습니다');
        return false;
      }
      const last = auditLog[auditLog.length-1];
      if (!confirm(
        `직전 저장 상태로 복원합니다.\n` +
        (last ? `\n최근 변경: ${last.label} (${last.when.replace('T',' ').slice(0,19)})\n` : '') +
        `\n복원 가능 키: ${candidates.length}개\n` +
        `\n⚠️ 페이지가 자동 새로고침됩니다 (메모리 변수 동기화).\n진행합니까?`
      )) return false;

      // 현재 상태를 _undo_backup으로 한 번 더 저장 (undo의 undo 가능)
      let saved = 0;
      BACKUP_KEYS.forEach(k => {
        const cur = localStorage.getItem(k);
        if (cur != null) { _origSetItem(k + '_undo_backup', cur); saved++; }
      });

      // _backup → 원본으로 복원
      let restored = 0;
      BACKUP_KEYS.forEach(k => {
        const bk = localStorage.getItem(k + '_backup');
        if (bk != null) { _origSetItem(k, bk); restored++; }
      });

      _recordAudit(`undo (restored:${restored}, saved:${saved})`);
      console.log(`[audit.undo] 복원 ${restored}개 / 현재 백업 ${saved}개`);
      if (typeof setBanner === 'function')
        setBanner('ok', `✅ ${restored}개 키 직전 상태로 복원 — 새로고침 중...`);
      setTimeout(() => location.reload(), 800);
      return true;
    },
    // undo의 undo
    redo: function() {
      const candidates = Array.from(BACKUP_KEYS).filter(k => localStorage.getItem(k+'_undo_backup') != null);
      if (!candidates.length) { alert('redo 가능한 백업 없음'); return false; }
      if (!confirm('undo 직전 상태로 다시 되돌립니까? (페이지 새로고침)')) return false;
      let n = 0;
      BACKUP_KEYS.forEach(k => {
        const bk = localStorage.getItem(k + '_undo_backup');
        if (bk != null) { _origSetItem(k, bk); n++; }
      });
      console.log(`[audit.redo] 복원 ${n}개`);
      setTimeout(() => location.reload(), 500);
      return true;
    },
    clear: function() {
      if (!confirm('변경 이력 ' + auditLog.length + '건을 모두 삭제합니까?')) return;
      auditLog = []; _persistAudit();
      console.log('audit cleared');
    },
    raw: function() { return auditLog; }
  };

  // ── 9. Self-healing 강화 — 무결성 진단 ─────────────
  //   주기적으로 데이터 일관성 검사 + 자동 수정 가능한 항목 안내
  function _runIntegrityCheck() {
    const issues = [];
    const fixes  = [];   // {label, fn}

    // 9-1. _id 누락 검사
    if (typeof rawData !== 'undefined') {
      const missing = rawData.filter(r => !r._id);
      if (missing.length) {
        issues.push(`_id 누락 ${missing.length}건`);
        fixes.push({
          label: `_id 자동 부여 (${missing.length}건)`,
          fn: () => {
            missing.forEach(r => {
              r._id = 'R-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
            });
            try { _origSetItem('erp_raw', JSON.stringify(rawData)); } catch(e){}
          }
        });
      }
    }

    // 9-2. 고아 localMeta (대응 rawData 없음)
    if (typeof localMeta !== 'undefined' && typeof rawData !== 'undefined') {
      const idSet = new Set(rawData.map(r => r._id).filter(Boolean));
      const orphans = Object.keys(localMeta).filter(k => !idSet.has(k));
      if (orphans.length) {
        issues.push(`고아 localMeta ${orphans.length}건`);
        fixes.push({
          label: `고아 메타 정리 (${orphans.length}건)`,
          fn: () => {
            orphans.forEach(k => delete localMeta[k]);
            if (typeof saveLocal === 'function') saveLocal();
          }
        });
      }
    }

    // 9-3. PJ NO 중복
    if (typeof rawData !== 'undefined') {
      const pjMap = {};
      rawData.forEach(r => {
        const pj = String(r['PJ NO']||'').trim();
        if (!pj) return;
        pjMap[pj] = (pjMap[pj]||0) + 1;
      });
      const dups = Object.entries(pjMap).filter(([,c]) => c > 1);
      if (dups.length) {
        issues.push(`PJ NO 중복: ${dups.slice(0,3).map(([p,c]) => p+'×'+c).join(', ')}${dups.length>3?` 외 ${dups.length-3}건`:''}`);
      }
    }

    // 9-4. 재고 음수 검사
    if (typeof inventoryData !== 'undefined') {
      const stockMap = {};
      inventoryData.forEach(r => {
        const m = (r.model||'').trim();
        if (!m) return;
        if (!stockMap[m]) stockMap[m] = 0;
        stockMap[m] += r.type === '입고' ? (Number(r.qty)||0) : -(Number(r.qty)||0);
      });
      const neg = Object.entries(stockMap).filter(([,q]) => q < 0);
      if (neg.length) {
        issues.push(`재고 음수: ${neg.slice(0,3).map(([m,q]) => m+'='+q).join(', ')}${neg.length>3?` 외 ${neg.length-3}건`:''}`);
      }
    }

    // 9-5. 출고지시서 ↔ 수주 무결성
    if (typeof deliveryOrders !== 'undefined' && typeof rawData !== 'undefined') {
      const idSet = new Set(rawData.map(r => r._id).filter(Boolean));
      const pjSet = new Set(rawData.map(r => String(r['PJ NO']||'').trim()).filter(Boolean));
      const orphan = deliveryOrders.filter(d => {
        if (d.rowId && idSet.has(d.rowId)) return false;
        if (d.pjNo && pjSet.has(d.pjNo))  return false;
        return true;
      });
      if (orphan.length) {
        issues.push(`연결 끊긴 출고지시서 ${orphan.length}건`);
      }
    }

    // 9-6. 결제 합계 ≠ 수주총액 (오차 1원 허용)
    if (typeof rawData !== 'undefined' && typeof localMeta !== 'undefined') {
      let mismatch = 0;
      rawData.forEach(r => {
        const id = r._id; if (!id || !localMeta[id]) return;
        const total = Number(String(r['수주총액(원)']||'').replace(/,/g,'')) || 0;
        if (total <= 0) return;
        const m = localMeta[id];
        const sum = (m.계약금||0) + (m.중도금1||0) + (m.중도금2||0) + (m.중도금3||0) + (m.잔금||0);
        if (sum > 0 && Math.abs(sum - total) > 1) mismatch++;
      });
      if (mismatch > 0) issues.push(`결제분할 합계 불일치 ${mismatch}건 (참고)`);
    }

    return { issues, fixes };
  }

  function _showHealthIssues(result) {
    if (!result.issues.length) return;
    console.warn('🩺 무결성 진단 — 문제 ' + result.issues.length + '건');
    result.issues.forEach(s => console.warn('  •', s));
    if (typeof setBanner === 'function') {
      const fixHint = result.fixes.length ? ` — F12 → healthCheck.fix()로 ${result.fixes.length}건 자동수정 가능` : '';
      setBanner('warn', `🩺 무결성 진단: ${result.issues.length}건 발견${fixHint}`);
    }
  }

  // [PATCH-E] 실제 수정 로직 — fix()와 fixForce()에서 공통 사용
  function _doFix() {
    const r = _runIntegrityCheck();
    if (!r.fixes.length) {
      console.log('자동 수정 가능 항목 없음');
      if (typeof setBanner === 'function') setBanner('info', '자동 수정 가능 항목 없음');
      return 0;
    }
    const labels = r.fixes.map(f => '• ' + f.label).join('\n');
    if (!confirm(`자동 수정 항목 ${r.fixes.length}개:\n\n${labels}\n\n수정 전 자동 백업됩니다. 진행?`)) return 0;
    _recordAudit('before_healthCheck.fix');
    let ok = 0;
    r.fixes.forEach(f => {
      try { f.fn(); ok++; }
      catch(e) { logError('fix:'+f.label, e); }
    });
    if (typeof refreshAllTabs === 'function') refreshAllTabs();
    if (typeof setBanner === 'function') setBanner('ok', `✅ 자동 수정 ${ok}/${r.fixes.length}건 완료 (audit.undo()로 되돌릴 수 있음)`);
    return ok;
  }

  window.healthCheck = {
    run: function(verbose) {
      const r = _runIntegrityCheck();
      if (verbose !== false) {
        if (r.issues.length === 0) {
          console.log('✅ 무결성 진단 통과 — 이상 없음');
          if (typeof setBanner === 'function') setBanner('ok', '✅ 무결성 진단 통과');
        } else {
          _showHealthIssues(r);
        }
      }
      return r;
    },
    fix: function() {
      // [PATCH-E] 안전장치 — rawData가 비어있거나 sync 진행중이면 차단
      if (typeof rawData !== 'undefined' && rawData.length < 5) {
        const msg = `⚠️ 안전장치: rawData가 ${rawData.length}건뿐입니다.\n\n` +
                    `클라우드 동기화가 진행 중이거나 데이터가 일시적으로 비어 있을 수 있습니다.\n` +
                    `이 상태에서 자동수정하면 모든 메타데이터를 고아로 판정해 삭제할 수 있습니다.\n\n` +
                    `정말 진행하려면 콘솔에서 healthCheck.fixForce() 사용`;
        alert(msg);
        if (typeof setBanner === 'function') setBanner('warn', '🛡️ 자동수정 차단 — 데이터 부족');
        return 0;
      }
      // sync 진행 중인지 체크
      if (typeof erpSync !== 'undefined' && erpSync.status) {
        const s = erpSync.status();
        if (s && s.queueLength > 0) {
          if (!confirm(`⚠️ 동기화 큐 ${s.queueLength}건 대기 중입니다.\n자동수정을 진행하면 큐가 손실될 수 있습니다.\n그래도 진행하시겠습니까?`)) {
            if (typeof setBanner === 'function') setBanner('info', '자동수정 취소됨');
            return 0;
          }
        }
      }
      return _doFix();
    },
    // 강제 실행 (안전장치 무시) — 콘솔에서만 사용 권장
    fixForce: function() { return _doFix(); }
  };

  // ── 10. 부팅 (v1 + v2) ─────────────────────────────
  function bootV2() {
    autoRecoverIfCorrupted();
    saveDailySnapshot();
    shadowBackupFilesToIDB();
    setInterval(shadowBackupFilesToIDB, 5 * 60 * 1000);

    // saveLocal/saveSettings hook 시도 (utils.js 로드 후)
    setTimeout(_hookSaveFunctions, 100);
    // 한 번 더 (안전망)
    setTimeout(_hookSaveFunctions, 1500);

    // 시작 시 무결성 검사 (조용히 — 문제 있을 때만 토스트)
    setTimeout(() => {
      const r = _runIntegrityCheck();
      if (r.issues.length) _showHealthIssues(r);
    }, 2500);

    // 30분마다 백그라운드 무결성 검사
    setInterval(() => {
      const r = _runIntegrityCheck();
      if (r.issues.length) _showHealthIssues(r);
    }, 30 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootV2);
  } else {
    bootV2();
  }

  console.log('[ERP-SAFE] Safety Layer v2 loaded · tx()/audit/healthCheck 추가 활성');

  // =====================================================
  //  v3 — Phase A · Week 3
  //  Health Panel UI · 진단/이력/에러를 한 화면에
  // =====================================================
  function _injectHealthPanel() {
    if (document.getElementById('erp-health-fab')) return;

    // 우측 하단 작은 floating 버튼 + 패널 (기존 UI 침범 X)
    const css = `
      #erp-health-fab{position:fixed;bottom:18px;right:18px;width:44px;height:44px;border-radius:50%;
        background:#1a1a2e;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s, background .2s;}
      #erp-health-fab:hover{background:#2a2a4e;transform:scale(1.07);}
      #erp-health-fab.has-issue{background:#c62828;animation:erpPulse 1.6s infinite;}
      @keyframes erpPulse{0%,100%{box-shadow:0 4px 14px rgba(198,40,40,0.5);}50%{box-shadow:0 4px 22px rgba(198,40,40,0.9);}}
      #erp-health-panel{position:fixed;bottom:72px;right:18px;width:380px;max-height:70vh;
        background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.25);
        z-index:9001;display:none;flex-direction:column;overflow:hidden;font-family:inherit;}
      #erp-health-panel.open{display:flex;}
      .ehp-hd{padding:14px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;background:#1a1a2e;color:#fff;}
      .ehp-hd h4{margin:0;font-size:0.95em;font-weight:700;}
      .ehp-tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa;}
      .ehp-tabs button{flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-size:0.82em;color:#888;border-bottom:2px solid transparent;}
      .ehp-tabs button.active{color:#1a1a2e;font-weight:700;border-bottom-color:#1a1a2e;background:#fff;}
      .ehp-body{flex:1;overflow-y:auto;padding:14px 16px;font-size:0.84em;}
      .ehp-row{padding:8px 10px;border-radius:6px;margin-bottom:6px;background:#f8f9fa;}
      .ehp-row.bad{background:#ffebee;color:#c62828;}
      .ehp-row.ok{background:#e8f5e9;color:#2e7d32;}
      .ehp-btn{padding:6px 12px;border:none;border-radius:5px;background:#1a1a2e;color:#fff;cursor:pointer;font-size:0.78em;margin-right:4px;}
      .ehp-btn.gray{background:#6c757d;}
      .ehp-btn.green{background:#27ae60;}
      .ehp-btn.red{background:#c62828;}
      .ehp-mini{font-size:0.74em;color:#999;margin-top:2px;}`;

    const style = document.createElement('style');
    style.id = 'erp-health-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-health-fab';
    fab.title = '시스템 상태 점검';
    fab.textContent = '🩺';
    fab.onclick = () => {
      const p = document.getElementById('erp-health-panel');
      p.classList.toggle('open');
      if (p.classList.contains('open')) _renderHealthPanel('diag');
    };
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'erp-health-panel';
    panel.innerHTML = `
      <div class="ehp-hd">
        <h4>🩺 시스템 상태 패널</h4>
        <button onclick="document.getElementById('erp-health-panel').classList.remove('open')"
          style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div class="ehp-tabs">
        <button data-tab="diag" class="active" onclick="_renderHealthPanel('diag')">진단</button>
        <button data-tab="audit" onclick="_renderHealthPanel('audit')">이력 (Undo)</button>
        <button data-tab="errors" onclick="_renderHealthPanel('errors')">에러</button>
        <button data-tab="tests" onclick="_renderHealthPanel('tests')">테스트</button>
      </div>
      <div class="ehp-body" id="ehp-body"></div>`;
    document.body.appendChild(panel);
  }

  window._renderHealthPanel = function(tab) {
    document.querySelectorAll('#erp-health-panel .ehp-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const body = document.getElementById('ehp-body');
    if (!body) return;

    if (tab === 'diag') {
      const r = _runIntegrityCheck();
      const okBlock = r.issues.length === 0
        ? `<div class="ehp-row ok"><strong>✅ 무결성 통과</strong><div class="ehp-mini">검사 6개 항목 이상 없음</div></div>`
        : r.issues.map(i => `<div class="ehp-row bad">⚠️ ${i}</div>`).join('');
      const fixBtn = r.fixes.length
        ? `<button class="ehp-btn green" onclick="healthCheck.fix();_renderHealthPanel('diag')">🔧 자동수정 ${r.fixes.length}건</button>`
        : '';
      const rerun = `<button class="ehp-btn" onclick="_renderHealthPanel('diag')">🔄 재검사</button>`;
      body.innerHTML = `${okBlock}<div style="margin-top:10px;">${fixBtn}${rerun}</div>
        <div class="ehp-mini" style="margin-top:14px;">자동 진단: 30분마다. 콘솔: <code>healthCheck.run()</code></div>`;
    }

    if (tab === 'audit') {
      if (!auditLog.length) {
        body.innerHTML = '<div class="ehp-row">변경 이력 없음</div>';
        return;
      }
      const slice = auditLog.slice(-20).reverse();
      // [PATCH-B] undo는 직전 1단계만 → 최상단에만 버튼 노출, 나머지는 이력 표시만
      body.innerHTML = `
        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <button class="ehp-btn gray" onclick="audit.undo()">↶ 직전 상태 복원</button>
          <button class="ehp-btn" onclick="audit.redo()">↷ Undo 취소</button>
        </div>
        <div style="font-size:0.74em;color:#888;margin-bottom:8px;">최근 변경 이력 (메타데이터만 보존, 실제 데이터는 _backup 키에 직전 1단계)</div>
        ` + slice.map(e => `
        <div class="ehp-row">
          <div><strong>${e.label}</strong></div>
          <div class="ehp-mini">${e.when.replace('T',' ').slice(0,19)} · 주문 ${e.counts.orders} · 출고 ${e.counts.deliveries} · 입출고 ${e.counts.inventory}${e.counts.sn?` · SN ${e.counts.sn}`:''}</div>
        </div>`).join('');
    }

    if (tab === 'errors') {
      if (!window.__erpErrors.length) {
        body.innerHTML = '<div class="ehp-row ok">✅ 누적 에러 없음</div>';
        return;
      }
      const slice = window.__erpErrors.slice(-30).reverse();
      body.innerHTML = `<div style="margin-bottom:8px;">
        <button class="ehp-btn red" onclick="window.__erpErrors=[];localStorage.removeItem('erp_errors');_renderHealthPanel('errors')">🗑️ 모두 지우기</button>
        </div>` + slice.map(e => `
        <div class="ehp-row bad">
          <div><strong>${e.label}</strong></div>
          <div style="font-size:0.84em;">${e.message}</div>
          <div class="ehp-mini">${e.when.replace('T',' ').slice(0,19)}</div>
        </div>`).join('');
    }

    if (tab === 'tests') {
      if (typeof window.runErpTests !== 'function') {
        body.innerHTML = '<div class="ehp-row">회귀 테스트 모듈이 로드되지 않았습니다. (영업관리_ERP_tests.js)</div>';
        return;
      }
      body.innerHTML = `<button class="ehp-btn green" onclick="window.runErpTests('panel')">▶ 전체 테스트 실행</button>
        <div id="ehp-test-result" style="margin-top:12px;"></div>
        <div class="ehp-mini" style="margin-top:14px;">콘솔: <code>runErpTests()</code></div>`;
    }
  };

  // FAB 빨간 깜빡임 — 문제 발견 시
  function _updateFabState() {
    const fab = document.getElementById('erp-health-fab');
    if (!fab) return;
    const r = _runIntegrityCheck();
    const errs = window.__erpErrors.length;
    if (r.issues.length || errs > 0) {
      fab.classList.add('has-issue');
      fab.title = `⚠️ 진단 ${r.issues.length}건 / 에러 ${errs}건`;
    } else {
      fab.classList.remove('has-issue');
      fab.title = '✅ 시스템 상태 양호';
    }
  }

  function bootV3() {
    _injectHealthPanel();
    setTimeout(_updateFabState, 3000);
    setInterval(_updateFabState, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootV3);
  } else {
    bootV3();
  }

  console.log('[ERP-SAFE] Safety Layer v3 loaded · 우측 하단 🩺 패널 활성');

  // =====================================================
  //  v4 — 추가 안정화 패치
  //   [PATCH-F] setBanner 디바운스 — 동일 메시지 3초 내 무시
  // =====================================================
  function _wrapSetBanner() {
    if (typeof window.setBanner !== 'function') { setTimeout(_wrapSetBanner, 200); return; }
    if (window.setBanner.__debounced) return;
    const _orig = window.setBanner;
    const recent = new Map();
    window.setBanner = function(type, msg) {
      const key = (type||'') + '|' + (msg||'');
      const now = Date.now();
      const last = recent.get(key);
      if (last && now - last < 3000) return;   // 3초 내 동일 메시지 차단
      recent.set(key, now);
      // 정리: 50개 이상이면 10초 이전 항목 제거
      if (recent.size > 50) {
        for (const [k, t] of recent) { if (now - t > 10000) recent.delete(k); }
      }
      return _orig.apply(this, arguments);
    };
    window.setBanner.__debounced = true;
    console.log('[ERP-SAFE] setBanner 디바운스 적용 (3초 내 동일 메시지 무시)');
  }
  setTimeout(_wrapSetBanner, 100);
  setTimeout(_wrapSetBanner, 1500);   // 안전망

})();
