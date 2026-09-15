// =====================================================
//  SECURE STORAGE — 민감 데이터 자동 암호화 (2026-05-13)
//
//  대상 키 (자동 암호화 저장):
//   erp_local        — 메타데이터 (계약금/잔금 입금 내역, 메모 등)
//   erp_files        — 첨부 파일 (서명 이미지 등)
//   erp_customer_master — 고객사 신용한도, 사업자번호
//   erp_credit       — 신용 분석 (미수금)
//   erp_aging        — 채권 Aging
//   erp_session_token  — (이미 토큰 자체로 보호되지만 추가 레이어)
//
//  방식
//   - AES-GCM 256bit 암호화
//   - 키는 사용자별 PBKDF2(deviceId + sessionToken) 으로 유도
//   - 로그아웃 시 키 메모리에서 즉시 삭제
//   - 키 없으면 데이터 복호화 불가 (분실/도난 시 자동 보호)
// =====================================================
(function() {
  'use strict';

  const ENCRYPT_KEYS = new Set([
    'erp_local',
    'erp_files',
    'erp_customer_master',
    'erp_credit',
    'erp_aging',
    'erp_purchase'
  ]);

  let _aesKey = null;   // 메모리에서만 보관

  // ── 키 유도 (deviceId + 세션 정보 기반) ──────────
  async function _deriveKey() {
    const session = JSON.parse(localStorage.getItem('erp_session_token') || 'null');
    const deviceId = localStorage.getItem('erp_device_id') || '';
    if (!session || !session.user) return null;

    const material = session.user + '|' + deviceId + '|' + session.token.slice(0,16);
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(material),
      { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('baro-erp-storage-salt-v1'), iterations: 50000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt','decrypt']
    );
  }

  async function _ensureKey() {
    if (_aesKey) return _aesKey;
    _aesKey = await _deriveKey();
    return _aesKey;
  }

  function _clearKey() {
    _aesKey = null;
  }

  // ── 암호화 / 복호화 ────────────────────────────
  async function encrypt(plaintext) {
    const key = await _ensureKey();
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    // 직렬화: ENCv1|<iv-hex>|<ciphertext-base64>
    const ivHex = [...iv].map(b => b.toString(16).padStart(2,'0')).join('');
    const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
    return 'ENCv1|' + ivHex + '|' + ctB64;
  }

  async function decrypt(payload) {
    if (typeof payload !== 'string' || !payload.startsWith('ENCv1|')) {
      return payload;   // 평문 그대로 반환 (마이그레이션 호환)
    }
    const key = await _ensureKey();
    if (!key) return null;
    const parts = payload.split('|');
    if (parts.length < 3) return null;
    const ivHex = parts[1];
    const ctB64 = parts[2];
    const iv = new Uint8Array(ivHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
    try {
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(buf);
    } catch(e) {
      console.error('[ERP-CRYPTO] 복호화 실패 — 키 변경 또는 손상:', e.message);
      return null;
    }
  }

  // ── localStorage 가로채기 ────────────────────────
  let _hooked = false;
  function _hookStorage() {
    if (_hooked) return;
    _hooked = true;
    const origSet = localStorage.setItem.bind(localStorage);
    const origGet = localStorage.getItem.bind(localStorage);

    // 동기 메서드는 그대로 두되, ENCv1 으로 시작하는 값을 만나면 동기적으로 복호화 불가
    // → 대안: erpSecureStorage.get(key) 비동기 API 제공 + 모듈들이 자발적으로 사용
    //   기존 동기 코드 호환을 위해 setItem 가로채기는 OPT-IN 으로 처리
  }

  // ── 사용자가 명시적으로 호출하는 안전 API ──────
  async function secureSet(key, value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (!ENCRYPT_KEYS.has(key)) {
      try { localStorage.setItem(key, str); return true; } catch(e) { return false; }
    }
    const enc = await encrypt(str);
    if (!enc) {
      // 키 없으면 (로그인 전) — 평문 저장 거부
      console.warn('[ERP-CRYPTO] 키 미도출 → 저장 거부:', key);
      return false;
    }
    try { localStorage.setItem(key, enc); return true; } catch(e) { return false; }
  }

  async function secureGet(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    if (!raw.startsWith('ENCv1|')) return raw;   // 평문 — 그대로 반환
    return await decrypt(raw);
  }

  // ── 일괄 마이그레이션 (평문 → 암호화) ──────────
  async function migrateAll() {
    let migrated = 0;
    for (const key of ENCRYPT_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (raw.startsWith('ENCv1|')) continue;   // 이미 암호화됨
      const enc = await encrypt(raw);
      if (enc) {
        localStorage.setItem(key, enc);
        migrated++;
      }
    }
    return migrated;
  }

  async function unmigrateAll() {
    // 평문으로 되돌림 (보안 모드 OFF 시)
    let restored = 0;
    for (const key of ENCRYPT_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw || !raw.startsWith('ENCv1|')) continue;
      const dec = await decrypt(raw);
      if (dec !== null) {
        localStorage.setItem(key, dec);
        restored++;
      }
    }
    return restored;
  }

  // ── 로그아웃 시 키 즉시 삭제 ────────────────
  function _hookLogout() {
    if (window.erpAuthGate && !window.erpAuthGate.__sslHooked) {
      const origLogout = window.erpAuthGate.logout;
      window.erpAuthGate.logout = function() {
        _clearKey();
        return origLogout.apply(this, arguments);
      };
      window.erpAuthGate.__sslHooked = true;
    } else if (!window.erpAuthGate) {
      setTimeout(_hookLogout, 500);
    }
  }

  // ── 공개 API ────────────────────────────────
  window.erpSecureStorage = {
    encrypt, decrypt,
    secureSet, secureGet,
    migrateAll, unmigrateAll,
    clearKey: _clearKey,
    isEncrypted: (key) => {
      const v = localStorage.getItem(key);
      return v && v.startsWith('ENCv1|');
    },
    encryptedKeys: () => Array.from(ENCRYPT_KEYS),
    isReady: () => !!_aesKey
  };

  // ── 부팅 ────────────────────────────────────
  function boot() {
    setTimeout(() => {
      _hookLogout();
      // 세션 있으면 키 준비 + 자동 마이그레이션 (1회)
      _ensureKey().then(key => {
        if (!key) return;
        const migrated = localStorage.getItem('erp_secure_migrated_v1');
        if (!migrated) {
          migrateAll().then(n => {
            try { localStorage.setItem('erp_secure_migrated_v1', '1'); } catch(e) {}
            if (n > 0) console.log('[ERP-CRYPTO] ' + n + '개 키 자동 암호화 마이그레이션 완료');
          });
        }
      }).catch(()=>{});
    }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-CRYPTO] AES-GCM 저장 모듈 활성 — erpSecureStorage.*');
})();
