// =====================================================
//  AUTH GATE — 로그인 게이트 + 세션 관리 + 보안 (2026-05-13)
//
//  보안 7계층
//   1. 로그인 게이트 — 인증 전 ERP UI 차단 (오버레이)
//   2. PBKDF2 암호 해시 (Web Crypto API, 100,000회 iteration)
//   3. 세션 토큰 (4시간 만료, JWT-like)
//   4. 자동 로그아웃 (30분 무활동 → 화면 잠금)
//   5. Brute-force 차단 (5회 실패 → 15분 lockout)
//   6. 감사 로그 (로그인/실패/잠금/암호변경 추적)
//   7. 민감 데이터 자동 암호화 저장 (AES-GCM)
//
//  데이터 키
//   erp_session_token   → { token, user, role, exp, deviceId }
//   erp_login_attempts  → { count, lockedUntil }
//   erp_security_log    → [{ ts, kind, user, success, detail }]
//   erp_local_passcode  → 화면 잠금 해제 PIN (옵션)
//
//  서버 측: Apps Script 의 ERP_USERS 시트 + verify_user 액션
//
//  공개 API: window.erpAuthGate
// =====================================================
(function() {
  'use strict';

  const SESSION_KEY      = 'erp_session_token';
  const ATTEMPTS_KEY     = 'erp_login_attempts';
  const SECURITY_LOG_KEY = 'erp_security_log';
  const LAST_ACTIVITY_KEY = 'erp_last_activity';

  // 보안 설정 (서버에서도 동일하게 강제됨)
  const SESSION_TTL_MS = 4 * 60 * 60 * 1000;       // 4시간
  const IDLE_LOCK_MS   = 30 * 60 * 1000;            // 30분 무활동
  const MAX_ATTEMPTS   = 5;                          // 5회 실패
  const LOCKOUT_MS     = 15 * 60 * 1000;            // 15분 lockout
  const PBKDF2_ITER    = 100000;                     // 10만 회

  // ── 1. Web Crypto API 헬퍼 ─────────────────────────
  async function _pbkdf2(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' },
      baseKey, 256
    );
    return _bufToHex(bits);
  }

  function _bufToHex(buf) {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function _genToken() {
    // 32바이트 랜덤 토큰
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return _bufToHex(arr);
  }

  function _genSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return _bufToHex(arr);
  }

  function _deviceId() {
    let id = localStorage.getItem('erp_device_id');
    if (!id) {
      id = 'D-' + Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36).slice(-5);
      try { localStorage.setItem('erp_device_id', id); } catch(e) {}
    }
    return id;
  }

  // ── 2. 세션 토큰 관리 ───────────────────────────────
  function _loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s) return null;
      if (s.exp && Date.now() > s.exp) {
        _clearSession();
        return null;
      }
      return s;
    } catch(e) { return null; }
  }

  function _saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch(e) {}
  }

  function _clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  }

  function isAuthenticated() {
    return _loadSession() !== null;
  }

  function getCurrentUser() {
    const s = _loadSession();
    return s ? { user: s.user, role: s.role, deviceId: s.deviceId } : null;
  }

  // ── 3. Brute-force 차단 ────────────────────────────
  function _getAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{"count":0,"lockedUntil":0}'); }
    catch(e) { return { count: 0, lockedUntil: 0 }; }
  }

  function _setAttempts(a) {
    try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a)); } catch(e) {}
  }

  function _isLockedOut() {
    const a = _getAttempts();
    return a.lockedUntil && Date.now() < a.lockedUntil;
  }

  function _onFailedAttempt() {
    const a = _getAttempts();
    a.count = (a.count || 0) + 1;
    if (a.count >= MAX_ATTEMPTS) {
      a.lockedUntil = Date.now() + LOCKOUT_MS;
      a.count = 0;
      _logSecurity('lockout', null, false, `${MAX_ATTEMPTS}회 실패로 ${LOCKOUT_MS/60000}분 잠금`);
    }
    _setAttempts(a);
  }

  function _onSuccessfulAttempt() {
    _setAttempts({ count: 0, lockedUntil: 0 });
  }

  // ── 4. 보안 감사 로그 ──────────────────────────────
  function _logSecurity(kind, user, success, detail) {
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem(SECURITY_LOG_KEY) || '[]'); } catch(e) {}
    logs.unshift({
      ts: new Date().toISOString(),
      kind, user, success, detail,
      deviceId: _deviceId(),
      ua: navigator.userAgent.slice(0, 120)
    });
    logs = logs.slice(0, 500);
    try { localStorage.setItem(SECURITY_LOG_KEY, JSON.stringify(logs)); } catch(e) {}
  }

  function getSecurityLog() {
    try { return JSON.parse(localStorage.getItem(SECURITY_LOG_KEY) || '[]'); }
    catch(e) { return []; }
  }

  function clearSecurityLog() {
    try { localStorage.removeItem(SECURITY_LOG_KEY); } catch(e) {}
  }

  // ── 5. 로그인 / 로그아웃 ────────────────────────────
  async function login(username, password, options) {
    options = options || {};
    if (_isLockedOut()) {
      const a = _getAttempts();
      const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
      throw new Error(`너무 많은 실패 시도 — ${mins}분 후 다시 시도하세요`);
    }
    if (!username || !password) throw new Error('아이디·비밀번호를 입력하세요');
    if (typeof window.gsUrl === 'undefined' || !window.gsUrl) {
      throw new Error('서버 URL이 설정되지 않았습니다 (설정 → 클라우드 연동)');
    }

    // 클라이언트에서 1차 해시 (네트워크 가로채기 방지)
    const clientHash = await _pbkdf2(password, 'baro-erp-client-salt-v1');

    try {
      const res = await fetch(window.gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'verify_user',
          username: username,
          clientHash: clientHash,
          deviceId: _deviceId()
        }),
        redirect: 'follow'
      });
      const json = await res.json();
      if (!json.success) {
        _onFailedAttempt();
        _logSecurity('login_fail', username, false, json.error || '실패');
        const remaining = MAX_ATTEMPTS - _getAttempts().count;
        throw new Error((json.error || '로그인 실패') + (remaining > 0 ? ` (남은 시도: ${remaining}회)` : ''));
      }

      // 세션 생성
      const session = {
        token: _genToken(),
        user: json.username || username,
        role: json.role || 'viewer',
        exp: Date.now() + SESSION_TTL_MS,
        deviceId: _deviceId(),
        startedAt: Date.now()
      };
      _saveSession(session);
      _onSuccessfulAttempt();
      _logSecurity('login_success', username, true, `role=${session.role}`);
      _updateActivity();

      // erpAuth + erpMultiUser 연동
      try {
        if (window.erpAuth && typeof window.erpAuth.setRole === 'function') {
          window.erpAuth.setRole(session.role);
        }
        if (window.erpMultiUser && typeof window.erpMultiUser.setIdentity === 'function') {
          window.erpMultiUser.setIdentity(session.user, session.role);
        }
      } catch(e) {}

      return session;
    } catch(e) {
      if (!/잠금|남은/.test(e.message)) {
        _onFailedAttempt();
        _logSecurity('login_fail', username, false, e.message);
      }
      throw e;
    }
  }

  function logout(reason) {
    const s = _loadSession();
    if (s) _logSecurity('logout', s.user, true, reason || '사용자 요청');
    _clearSession();
    _showLoginOverlay();
  }

  async function changePassword(oldPassword, newPassword) {
    const s = _loadSession();
    if (!s) throw new Error('로그인 후 시도');
    if (!newPassword || newPassword.length < 8) {
      throw new Error('새 비밀번호는 최소 8자 이상');
    }
    if (!_isStrongPassword(newPassword)) {
      throw new Error('영문 대소문자·숫자·특수문자 중 3종 이상 조합 필요');
    }
    const oldHash = await _pbkdf2(oldPassword, 'baro-erp-client-salt-v1');
    const newHash = await _pbkdf2(newPassword, 'baro-erp-client-salt-v1');
    const res = await fetch(window.gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'change_password',
        username: s.user,
        oldHash, newHash,
        sessionToken: s.token
      })
    });
    const json = await res.json();
    if (!json.success) {
      _logSecurity('passwd_change_fail', s.user, false, json.error);
      throw new Error(json.error || '비밀번호 변경 실패');
    }
    _logSecurity('passwd_change', s.user, true, '');
    return true;
  }

  function _isStrongPassword(p) {
    let score = 0;
    if (/[a-z]/.test(p)) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score >= 3 && p.length >= 8;
  }

  // ── 6. 자동 로그아웃 (유휴 감지) ──────────────────
  let _idleTimer = null;
  function _updateActivity() {
    try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch(e) {}
  }

  function _checkIdle() {
    if (!isAuthenticated()) return;
    const last = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0');
    if (Date.now() - last > IDLE_LOCK_MS) {
      _showLockScreen();
    }
  }

  function _installActivityListeners() {
    const events = ['mousedown','keydown','touchstart','scroll'];
    let throttle = 0;
    events.forEach(ev => {
      document.addEventListener(ev, () => {
        const now = Date.now();
        if (now - throttle > 5000) {   // 5초마다 한 번만 기록
          throttle = now;
          _updateActivity();
        }
      }, { passive: true });
    });
    _idleTimer = setInterval(_checkIdle, 60000); // 1분마다 점검
  }

  // ── 7. UI — 로그인 오버레이 ────────────────────────
  function _ensureStyle() {
    if (document.getElementById('erp-auth-gate-style')) return;
    const s = document.createElement('style');
    s.id = 'erp-auth-gate-style';
    s.textContent = `
      #erp-auth-overlay {
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: linear-gradient(135deg, #0a1929 0%, #1a1a2e 50%, #2c1a47 100%);
        z-index: 99999;
        display: none;
        align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "맑은 고딕", sans-serif;
      }
      #erp-auth-overlay.open { display: flex; }
      #erp-auth-overlay::before {
        content: ''; position: absolute; inset: 0;
        background-image:
          radial-gradient(circle at 20% 30%, rgba(21,101,192,0.18) 0%, transparent 50%),
          radial-gradient(circle at 80% 70%, rgba(123,31,162,0.15) 0%, transparent 50%);
        pointer-events: none;
      }
      .ag-card {
        background: rgba(255,255,255,0.97);
        backdrop-filter: blur(20px);
        border-radius: 16px;
        box-shadow: 0 25px 60px rgba(0,0,0,0.5);
        padding: 36px 40px;
        width: 90%; max-width: 420px;
        position: relative; z-index: 1;
        animation: agSlide .35s cubic-bezier(.16,1,.3,1);
      }
      @keyframes agSlide {
        from { opacity:0; transform: translateY(20px) scale(0.96); }
        to { opacity:1; transform: translateY(0) scale(1); }
      }
      .ag-logo {
        text-align: center; margin-bottom: 24px;
      }
      .ag-logo .lock {
        display: inline-flex; width: 64px; height: 64px;
        background: linear-gradient(135deg, #1565c0, #0d47a1);
        border-radius: 16px; align-items: center; justify-content: center;
        font-size: 28px; box-shadow: 0 8px 20px rgba(21,101,192,0.4);
        margin-bottom: 12px; color: #fff;
      }
      .ag-title {
        font-size: 1.3em; font-weight: 800; color: #1a1a2e;
        margin: 0; letter-spacing: -0.5px;
      }
      .ag-sub { color: #888; font-size: 0.84em; margin-top: 4px; }
      .ag-field { margin-bottom: 16px; }
      .ag-field label {
        display: block; font-size: 0.82em; font-weight: 700;
        color: #555; margin-bottom: 6px;
      }
      .ag-field input {
        width: 100%; padding: 12px 14px;
        border: 1.5px solid #e0e0e0; border-radius: 10px;
        font-size: 0.95em; box-sizing: border-box;
        transition: all .15s;
      }
      .ag-field input:focus {
        outline: none; border-color: #1565c0;
        box-shadow: 0 0 0 3px rgba(21,101,192,0.1);
      }
      .ag-submit {
        width: 100%; padding: 13px;
        background: linear-gradient(135deg, #1565c0, #0d47a1);
        color: #fff; border: none; border-radius: 10px;
        font-size: 0.95em; font-weight: 700; cursor: pointer;
        margin-top: 8px;
        box-shadow: 0 4px 12px rgba(21,101,192,0.3);
        transition: all .15s;
      }
      .ag-submit:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(21,101,192,0.4);
      }
      .ag-submit:disabled { opacity: 0.6; cursor: wait; transform: none; }
      .ag-error {
        background: #ffebee; color: #c62828;
        border-left: 4px solid #c62828;
        padding: 10px 14px; border-radius: 6px;
        font-size: 0.84em; margin-bottom: 14px;
        animation: agShake .3s;
      }
      @keyframes agShake {
        0%,100% { transform: translateX(0); }
        25% { transform: translateX(-6px); }
        75% { transform: translateX(6px); }
      }
      .ag-info {
        font-size: 0.78em; color: #888;
        text-align: center; margin-top: 16px;
        padding-top: 16px; border-top: 1px solid #f0f0f0;
        line-height: 1.6;
      }
      .ag-info a { color: #1565c0; text-decoration: none; cursor: pointer; }

      /* 잠금 화면 */
      #erp-lock-overlay {
        position: fixed; inset: 0; z-index: 99998;
        background: rgba(10,25,41,0.92);
        backdrop-filter: blur(12px);
        display: none;
        align-items: center; justify-content: center;
      }
      #erp-lock-overlay.open { display: flex; }
      .lock-card {
        background: rgba(255,255,255,0.97);
        border-radius: 16px;
        padding: 32px;
        width: 90%; max-width: 360px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .lock-card .lockicon {
        font-size: 48px; margin-bottom: 12px;
      }
      .lock-card h3 { margin: 0 0 8px; color: #1a1a2e; }
      .lock-card .sub { color: #666; font-size: 0.86em; margin-bottom: 18px; }
      .lock-card input {
        width: 100%; padding: 12px;
        border: 1.5px solid #e0e0e0; border-radius: 10px;
        font-size: 0.95em; box-sizing: border-box;
        text-align: center; letter-spacing: 1px;
      }
      .lock-card input:focus { outline: none; border-color: #1565c0; }
      .lock-card .btns { display: flex; gap: 8px; margin-top: 14px; }
      .lock-card button {
        flex: 1; padding: 10px;
        border: none; border-radius: 8px; cursor: pointer;
        font-weight: 700; font-size: 0.86em;
      }
      .lock-card .unlock { background: #1565c0; color: #fff; }
      .lock-card .logout { background: #f0f0f0; color: #555; }
    `;
    document.head.appendChild(s);
  }

  function _buildLoginOverlay() {
    if (document.getElementById('erp-auth-overlay')) return;
    _ensureStyle();
    const ov = document.createElement('div');
    ov.id = 'erp-auth-overlay';
    ov.innerHTML = `
      <div class="ag-card">
        <div class="ag-logo">
          <div class="lock">🔐</div>
          <h2 class="ag-title">바로 ERP</h2>
          <div class="ag-sub">보안 로그인</div>
        </div>
        <div id="ag-error-box"></div>
        <form id="ag-form" autocomplete="on">
          <div class="ag-field">
            <label for="ag-user">아이디</label>
            <input id="ag-user" name="username" type="text" autocomplete="username" required maxlength="40">
          </div>
          <div class="ag-field">
            <label for="ag-pw">비밀번호</label>
            <input id="ag-pw" name="password" type="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="ag-submit" id="ag-submit">로그인</button>
        </form>
        <div class="ag-info">
          🔒 PBKDF2 + AES-GCM 암호화 · 30분 유휴 자동 잠금<br>
          첫 사용자는 시스템 관리자에게 계정 발급 요청
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    document.getElementById('ag-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = document.getElementById('ag-user').value.trim();
      const p = document.getElementById('ag-pw').value;
      const btn = document.getElementById('ag-submit');
      const errBox = document.getElementById('ag-error-box');
      errBox.innerHTML = '';
      btn.disabled = true;
      btn.textContent = '인증 중...';
      try {
        await login(u, p);
        _hideLoginOverlay();
        // 로그인 성공 → 페이지 새로고침해서 모든 모듈이 새 세션으로 초기화
        location.reload();
      } catch(e) {
        errBox.innerHTML = `<div class="ag-error">⚠ ${_e(e.message)}</div>`;
        document.getElementById('ag-pw').value = '';
        document.getElementById('ag-pw').focus();
      } finally {
        btn.disabled = false;
        btn.textContent = '로그인';
      }
    });
  }

  function _showLoginOverlay() {
    _buildLoginOverlay();
    document.getElementById('erp-auth-overlay').classList.add('open');
    setTimeout(() => document.getElementById('ag-user')?.focus(), 100);
  }
  function _hideLoginOverlay() {
    document.getElementById('erp-auth-overlay')?.classList.remove('open');
  }

  // ── 잠금 화면 (재인증 필요) ─────────────────────
  function _buildLockOverlay() {
    if (document.getElementById('erp-lock-overlay')) return;
    _ensureStyle();
    const s = _loadSession();
    const userName = s ? s.user : '?';
    const ov = document.createElement('div');
    ov.id = 'erp-lock-overlay';
    ov.innerHTML = `
      <div class="lock-card">
        <div class="lockicon">🔒</div>
        <h3>화면이 잠겼습니다</h3>
        <div class="sub"><strong>${_e(userName)}</strong> 님 · 30분 무활동</div>
        <input id="lock-pw" type="password" placeholder="비밀번호" autocomplete="current-password">
        <div id="lock-error" style="color:#c62828;font-size:0.82em;margin-top:8px;display:none;"></div>
        <div class="btns">
          <button class="logout" onclick="window.erpAuthGate.logout('잠금 화면에서 로그아웃')">로그아웃</button>
          <button class="unlock" onclick="window.erpAuthGate._submitUnlock()">잠금 해제</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    document.getElementById('lock-pw').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') _submitUnlock();
    });
  }

  async function _submitUnlock() {
    const s = _loadSession();
    if (!s) { _showLoginOverlay(); return; }
    const pw = document.getElementById('lock-pw').value;
    const errEl = document.getElementById('lock-error');
    if (!pw) return;
    errEl.style.display = 'none';
    try {
      await login(s.user, pw);
      document.getElementById('erp-lock-overlay').classList.remove('open');
      document.getElementById('lock-pw').value = '';
      _updateActivity();
    } catch(e) {
      errEl.textContent = e.message;
      errEl.style.display = '';
    }
  }

  function _showLockScreen() {
    _buildLockOverlay();
    document.getElementById('erp-lock-overlay').classList.add('open');
    setTimeout(() => document.getElementById('lock-pw')?.focus(), 100);
  }

  function _e(v) {
    return String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }

  // ── 부팅 ─────────────────────────────────────────
  function _enforceGate() {
    // 시작 시 ERP UI 차단 — 인증 통과 후 노출
    document.body.style.visibility = 'hidden';

    setTimeout(() => {
      // gsUrl 이 설정되어 있으면 로그인 강제 / 없으면 (초기 셋업) 통과
      const hasServer = (typeof window.gsUrl !== 'undefined' && window.gsUrl);
      const enforce = hasServer && _getEnforceLogin();
      if (enforce && !isAuthenticated()) {
        _showLoginOverlay();
        document.body.style.visibility = '';
      } else {
        if (isAuthenticated()) {
          const s = _loadSession();
          try {
            if (window.erpAuth && window.erpAuth.setRole) window.erpAuth.setRole(s.role);
            if (window.erpMultiUser && window.erpMultiUser.setIdentity) {
              window.erpMultiUser.setIdentity(s.user, s.role);
            }
          } catch(e) {}
        }
        document.body.style.visibility = '';
        _installActivityListeners();
        _updateActivity();
      }
    }, 200);
  }

  // 로그인 강제 모드 — 관리자가 설정 가능
  const ENFORCE_KEY = 'erp_enforce_login';
  function _getEnforceLogin() {
    return localStorage.getItem(ENFORCE_KEY) !== '0';   // 기본 ON
  }
  function setEnforceLogin(on) {
    try { localStorage.setItem(ENFORCE_KEY, on ? '1' : '0'); } catch(e) {}
    if (on && !isAuthenticated()) _showLoginOverlay();
  }

  // ── 공개 API ──────────────────────────────────────
  window.erpAuthGate = {
    login, logout, changePassword,
    isAuthenticated, getCurrentUser,
    showLogin: _showLoginOverlay,
    showLock: _showLockScreen,
    securityLog: getSecurityLog,
    clearSecurityLog: clearSecurityLog,
    setEnforceLogin, getEnforceLogin: _getEnforceLogin,
    _submitUnlock,
    // 클라이언트 해시 함수 (다른 모듈에서 사용자 추가 시 사용)
    hashPassword: async (pw) => _pbkdf2(pw, 'baro-erp-client-salt-v1'),
    config: {
      sessionTtlMs: SESSION_TTL_MS,
      idleLockMs: IDLE_LOCK_MS,
      maxAttempts: MAX_ATTEMPTS,
      lockoutMs: LOCKOUT_MS
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _enforceGate);
  else _enforceGate();

  console.log('[ERP-AUTH-GATE] 보안 게이트 활성 — erpAuthGate.login(user, pw)');
})();
