// =====================================================
//  MULTI-USER LAYER — 다중 사용자 지원 (2026-05-13)
//
//  목표
//   - 기존 sync.js (양방향 Google Sheets) 위에 다중 사용자 기능 추가
//   - 단일 사용자 모드와 100% 호환 — 사용자 식별 미등록 시 기존 동작
//   - 별도 서버 없이 Apps Script 만으로 동작
//
//  추가 기능
//   1) 사용자 식별 — 이름 + 역할 + 디바이스 ID
//   2) Presence — 60초마다 heartbeat, 현재 접속자 목록 표시
//   3) Activity Feed — 다른 사용자 변경 알림
//   4) 자동 sync 활성화 — 다중사용자 모드면 sync 자동 ON
//   5) 빠른 polling — 다중사용자 모드면 10초 (기본 30초)
//
//  데이터 키
//   erp_user_identity → { name, role, deviceId, registeredAt }
//   erp_presence_cache → 마지막 본 접속자 목록 (UI 캐시용)
//
//  공개 API: window.erpMultiUser
// =====================================================
(function() {
  'use strict';

  const IDENTITY_KEY = 'erp_user_identity';
  const PRESENCE_CACHE_KEY = 'erp_presence_cache';
  const ACTIVITY_LOG_KEY = 'erp_activity_log';

  // ── 1. 사용자 식별 ────────────────────────────────
  let _identity = null;
  try { _identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null'); }
  catch(e) { _identity = null; }

  function _deviceId() {
    let id = localStorage.getItem('erp_device_id');
    if (!id) {
      id = 'D-' + Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36).slice(-5);
      try { localStorage.setItem('erp_device_id', id); } catch(e) {}
    }
    return id;
  }

  function isMultiUserMode() {
    // sync.js 활성 + 사용자 신원 등록 + GS URL 설정 → 다중사용자 모드
    if (!_identity || !_identity.name) return false;
    if (typeof window.gsUrl === 'undefined' || !window.gsUrl) return false;
    return true;
  }

  function getIdentity() {
    return _identity ? { ..._identity, deviceId: _deviceId() } : null;
  }

  function setIdentity(name, role) {
    const trimmed = String(name||'').trim();
    if (!trimmed) throw new Error('이름은 필수입니다');
    _identity = {
      name: trimmed.slice(0, 30),
      role: role || 'sales',
      deviceId: _deviceId(),
      registeredAt: _identity?.registeredAt || new Date().toISOString()
    };
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(_identity)); } catch(e) {}
    // erpAuth 역할도 함께 설정
    try {
      if (window.erpAuth && typeof window.erpAuth.setRole === 'function') {
        window.erpAuth.setRole(role);
      }
    } catch(e) {}
    // 다중사용자 모드면 sync 자동 활성화
    _maybeEnableSync();
    _hbBeat();
    return _identity;
  }

  function clearIdentity() {
    _identity = null;
    try { localStorage.removeItem(IDENTITY_KEY); } catch(e) {}
  }

  function _maybeEnableSync() {
    if (!isMultiUserMode()) return;
    if (!window.erpSync) return;
    if (!window.erpSync.isEnabled()) {
      try {
        window.erpSync.enable(true);
        console.log('[ERP-MU] 다중사용자 모드 — sync 자동 활성화');
      } catch(e) {}
    }
    // ★ sync.js 가 polling 주기를 다중사용자 모드에 맞춰 단축
    try { window.dispatchEvent(new CustomEvent('erp:multiuser:changed')); } catch(e) {}
  }

  // ── 2. Presence (접속 상태) ──────────────────────
  const HB_INTERVAL_MS = 60 * 1000;   // 60초 마다 heartbeat
  const PULL_PRESENCE_MS = 30 * 1000; // 30초 마다 접속자 pull
  const ONLINE_WINDOW_MS = 3 * 60 * 1000; // 3분 안에 heartbeat 보낸 사람만 "online"

  let _hbTimer = null;
  let _pullPresenceTimer = null;
  let _onlineUsers = [];
  try { _onlineUsers = JSON.parse(localStorage.getItem(PRESENCE_CACHE_KEY) || '[]'); } catch(e) {}

  async function _hbBeat() {
    if (!isMultiUserMode()) return;
    if (!window.gsUrl) return;
    try {
      const me = getIdentity();
      const url = window.gsUrl + '?action=heartbeat'
                + '&device=' + encodeURIComponent(me.deviceId)
                + '&name=' + encodeURIComponent(me.name)
                + '&role=' + encodeURIComponent(me.role)
                + '&v=' + Date.now();
      await fetch(url, { redirect: 'follow' });
    } catch(e) {/* 조용히 실패 */}
  }

  async function _pullPresence() {
    if (!isMultiUserMode()) return;
    if (!window.gsUrl) return;
    try {
      const url = window.gsUrl + '?action=presence&window=' + (ONLINE_WINDOW_MS/1000);
      const res = await fetch(url, { redirect: 'follow' });
      const json = await res.json();
      if (json && json.success && Array.isArray(json.users)) {
        _onlineUsers = json.users;
        try { localStorage.setItem(PRESENCE_CACHE_KEY, JSON.stringify(_onlineUsers)); } catch(e) {}
        _renderPresenceBadge();
      }
    } catch(e) {/* 조용히 실패 */}
  }

  function getOnlineUsers() {
    return _onlineUsers.slice();
  }

  // ── 3. UI — Presence Badge (상단 도구바) ───────
  function _renderPresenceBadge() {
    let badge = document.getElementById('erp-presence-badge');
    if (!isMultiUserMode()) {
      if (badge) badge.style.display = 'none';
      return;
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'erp-presence-badge';
      badge.title = '접속 중인 사용자 보기';
      badge.style.cssText = [
        'background:linear-gradient(135deg,#27ae60,#1b8a4c)',
        'color:#fff',
        'border:none',
        'border-radius:14px',
        'padding:6px 12px',
        'font-size:0.78em',
        'font-weight:700',
        'cursor:pointer',
        'box-shadow:0 2px 6px rgba(0,0,0,0.2)',
        'display:flex',
        'align-items:center',
        'gap:6px'
      ].join(';');
      badge.onclick = openPresencePanel;
      document.body.appendChild(badge);
      // toptools.js 가 컨테이너로 흡수
      if (window.toptools && typeof window.toptools.register === 'function') {
        window.toptools.register('erp-presence-badge');
      }
    }
    const n = _onlineUsers.length;
    const me = getIdentity();
    const others = _onlineUsers.filter(u => u.deviceId !== me?.deviceId).length;
    badge.innerHTML = `👥 <span style="font-weight:800;">${n}명</span>${others>0?` <span style="background:rgba(255,255,255,0.25);padding:1px 6px;border-radius:8px;font-size:0.86em;">+${others}</span>`:''}`;
    badge.style.display = '';
  }

  function openPresencePanel() {
    let panel = document.getElementById('erp-presence-panel');
    if (panel) { panel.classList.toggle('open'); _renderPresencePanel(); return; }
    panel = document.createElement('div');
    panel.id = 'erp-presence-panel';
    panel.style.cssText = [
      'position:fixed',
      'top:50px',
      'right:14px',
      'background:#fff',
      'border-radius:12px',
      'box-shadow:0 10px 40px rgba(0,0,0,0.2)',
      'width:320px',
      'max-height:60vh',
      'overflow:hidden',
      'z-index:9200',
      'display:none',
      'flex-direction:column'
    ].join(';');
    panel.classList.add('erp-presence-panel');
    document.body.appendChild(panel);

    if (!document.getElementById('erp-presence-style')) {
      const s = document.createElement('style');
      s.id = 'erp-presence-style';
      s.textContent = `
        .erp-presence-panel.open { display:flex !important; animation: ppSlide .18s; }
        @keyframes ppSlide { from{opacity:0;transform:translateY(-10px);} to{opacity:1;transform:translateY(0);} }
        .pp-hd { padding:12px 16px; background:#1a1a2e; color:#fff; display:flex; justify-content:space-between; align-items:center; }
        .pp-hd h4 { margin:0; font-size:0.92em; }
        .pp-bd { padding:8px 0; overflow-y:auto; flex:1; }
        .pp-user { padding:10px 16px; display:flex; align-items:center; gap:10px; border-bottom:1px solid #f5f5f5; }
        .pp-user:last-child { border-bottom:none; }
        .pp-avatar { width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#1565c0,#0d47a1); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.84em; flex-shrink:0; }
        .pp-info { flex:1; min-width:0; }
        .pp-name { font-weight:700; color:#1a1a2e; font-size:0.88em; }
        .pp-meta { font-size:0.72em; color:#888; margin-top:1px; }
        .pp-status { width:8px; height:8px; border-radius:50%; background:#27ae60; flex-shrink:0; }
        .pp-status.stale { background:#f9a825; }
        .pp-empty { padding:30px; text-align:center; color:#bbb; font-size:0.86em; }
        .pp-x { background:transparent; border:none; color:#fff; cursor:pointer; font-size:18px; }
      `;
      document.head.appendChild(s);
    }
    panel.classList.add('open');
    _renderPresencePanel();
  }

  function _renderPresencePanel() {
    const panel = document.getElementById('erp-presence-panel');
    if (!panel) return;
    const me = getIdentity();
    const now = Date.now();
    const sorted = _onlineUsers.slice().sort((a,b) => (b.lastSeen||'').localeCompare(a.lastSeen||''));
    panel.innerHTML = `
      <div class="pp-hd">
        <h4>👥 접속 중인 사용자 (${_onlineUsers.length}명)</h4>
        <button class="pp-x" onclick="document.getElementById('erp-presence-panel').classList.remove('open')">✕</button>
      </div>
      <div class="pp-bd">
        ${sorted.length === 0 ? '<div class="pp-empty">접속자 정보 없음 — 30초 후 갱신됩니다</div>'
          : sorted.map(u => {
            const isMe = me && u.deviceId === me.deviceId;
            const ageMs = u.lastSeen ? (now - new Date(u.lastSeen).getTime()) : 0;
            const stale = ageMs > (90 * 1000);
            const initial = (u.name||'?').slice(0,1);
            const ago = ageMs < 60000 ? '방금' : Math.floor(ageMs/60000)+'분 전';
            return `<div class="pp-user">
              <span class="pp-status ${stale?'stale':''}"></span>
              <div class="pp-avatar">${initial}</div>
              <div class="pp-info">
                <div class="pp-name">${_e(u.name)}${isMe?' <span style="color:#1565c0;font-size:0.78em;">(나)</span>':''}</div>
                <div class="pp-meta">${_e(u.role||'-')} · 마지막 활동 ${ago}</div>
              </div>
            </div>`;
          }).join('')}
      </div>
    `;
  }

  function _e(v) {
    return String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }

  // ── 4. 활동 피드 — 다른 사용자 변경 알림 ───────
  let _activityLog = [];
  try { _activityLog = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || '[]'); } catch(e) {}

  function _recordActivity(entry) {
    _activityLog.unshift(entry);
    _activityLog = _activityLog.slice(0, 50);   // 최근 50개만 유지
    try { localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(_activityLog)); } catch(e) {}
  }

  function getRecentActivity() {
    return _activityLog.slice();
  }

  // sync.js 가 _applyUpdate 할 때 호출되도록 hook
  function _hookSyncApply() {
    if (!window.erpSync || window.erpSync.__muHooked) {
      setTimeout(_hookSyncApply, 500);
      return;
    }
    // sync 의 pull 결과를 가로채는 가장 안정적인 방법:
    // refreshAllTabs 가 호출되기 전에 banner 가 표시되므로 banner 메시지에서 추출
    const origBanner = window.setBanner;
    if (typeof origBanner === 'function' && !origBanner.__muHooked) {
      window.setBanner = function(type, msg) {
        const r = origBanner.apply(this, arguments);
        if (typeof msg === 'string' && /다른 사용자 변경/.test(msg)) {
          _recordActivity({
            ts: new Date().toISOString(),
            kind: 'sync',
            message: msg
          });
        }
        return r;
      };
      window.setBanner.__muHooked = true;
    }
    window.erpSync.__muHooked = true;
  }

  // ── 5. 사용자 등록 다이얼로그 ─────────────────────
  function showRegisterDialog() {
    if (document.getElementById('mu-reg-modal')) {
      document.getElementById('mu-reg-modal').classList.add('open');
      return;
    }
    if (!document.getElementById('mu-reg-style')) {
      const s = document.createElement('style');
      s.id = 'mu-reg-style';
      s.textContent = `
        #mu-reg-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9700;display:none;align-items:center;justify-content:center;}
        #mu-reg-modal.open{display:flex;}
        .mu-reg-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:90%;max-width:480px;overflow:hidden;}
        .mu-reg-hd{padding:14px 18px;background:linear-gradient(135deg,#1a1a2e,#37474f);color:#fff;}
        .mu-reg-hd h4{margin:0;font-size:1em;}
        .mu-reg-bd{padding:20px;}
        .mu-reg-bd label{display:block;font-size:0.84em;font-weight:700;color:#444;margin:10px 0 4px;}
        .mu-reg-bd input, .mu-reg-bd select{width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.94em;box-sizing:border-box;}
        .mu-reg-bd input:focus, .mu-reg-bd select:focus{outline:none;border-color:#1565c0;}
        .mu-reg-ft{padding:12px 18px;background:#fafafa;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px;}
        .mu-reg-ft button{padding:8px 18px;border:none;border-radius:6px;cursor:pointer;font-size:0.86em;font-weight:600;}
        .mu-reg-ft .ok{background:#1565c0;color:#fff;}
        .mu-reg-ft .cancel{background:#eee;color:#555;}
        .mu-reg-hint{font-size:0.78em;color:#888;margin-top:14px;padding:10px;background:#fffde7;border-left:3px solid #f9a825;border-radius:4px;}
      `;
      document.head.appendChild(s);
    }
    const cur = getIdentity();
    const modal = document.createElement('div');
    modal.id = 'mu-reg-modal';
    modal.innerHTML = `
      <div class="mu-reg-box">
        <div class="mu-reg-hd"><h4>👤 사용자 등록 (다중 접속 활성화)</h4></div>
        <div class="mu-reg-bd">
          <label>이름 *</label>
          <input id="mu-name" type="text" placeholder="예: 홍길동" value="${_e(cur?.name||'')}" maxlength="30">
          <label>역할</label>
          <select id="mu-role">
            <option value="admin"${cur?.role==='admin'?' selected':''}>시스템 관리자</option>
            <option value="exec"${cur?.role==='exec'?' selected':''}>경영진</option>
            <option value="sales"${(!cur?.role||cur?.role==='sales')?' selected':''}>영업팀</option>
            <option value="ops"${cur?.role==='ops'?' selected':''}>운영팀</option>
            <option value="viewer"${cur?.role==='viewer'?' selected':''}>조회자</option>
          </select>
          <div class="mu-reg-hint">
            💡 이름과 역할을 등록하면 <strong>자동으로 다중 접속 모드</strong>가 활성화됩니다.
            <ul style="margin:6px 0 0 18px;padding:0;">
              <li>설정 → 클라우드 연동에서 Google Sheets URL 등록 필요</li>
              <li>같은 URL을 쓰는 다른 사용자와 실시간으로 데이터 공유</li>
              <li>현재 접속자 목록이 상단에 표시됩니다</li>
            </ul>
          </div>
        </div>
        <div class="mu-reg-ft">
          <button class="cancel" onclick="document.getElementById('mu-reg-modal').classList.remove('open')">취소</button>
          <button class="ok" onclick="window.erpMultiUser._submitRegister()">등록</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('open'), 10);
    setTimeout(() => document.getElementById('mu-name')?.focus(), 100);
  }

  function _submitRegister() {
    const name = document.getElementById('mu-name').value;
    const role = document.getElementById('mu-role').value;
    try {
      setIdentity(name, role);
      document.getElementById('mu-reg-modal').classList.remove('open');
      if (typeof setBanner === 'function')
        setBanner('ok', `✅ ${name}님 등록 완료 — 다중 접속 모드 활성화`);
      _renderPresenceBadge();
      _renderUserCard();
    } catch(e) {
      alert(e.message);
    }
  }

  // ── 6. 설정 → 클라우드 연동 섹션에 사용자 카드 주입 ──
  function _renderUserCard() {
    const host = document.getElementById('set-section-cloud') || document.getElementById('set-section-perm');
    if (!host) return;
    let card = document.getElementById('mu-user-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'mu-user-card';
      card.className = 'card';
      host.insertBefore(card, host.firstChild);
    }
    const me = getIdentity();
    const roleLabel = {
      admin:'시스템 관리자', exec:'경영진', sales:'영업팀',
      ops:'운영팀', viewer:'조회자'
    };
    if (me) {
      card.innerHTML = `
        <div class="card-head">
          <h3>👤 다중 접속 사용자</h3>
          <span class="tag green">${isMultiUserMode()?'활성':'대기 (URL 미설정)'}</span>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:16px;align-items:center;padding:14px;background:#f0f7ff;border-radius:10px;">
            <div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#1565c0,#0d47a1);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2em;">
              ${_e((me.name||'?').slice(0,1))}
            </div>
            <div style="flex:1;">
              <div style="font-weight:800;font-size:1.05em;color:#1a1a2e;">${_e(me.name)}</div>
              <div style="font-size:0.82em;color:#666;">${_e(roleLabel[me.role]||me.role)} · ${_e(me.deviceId)}</div>
              <div style="font-size:0.74em;color:#888;margin-top:2px;">등록일: ${_e((me.registeredAt||'').slice(0,10))}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <button class="btn btn-sm btn-outline" onclick="window.erpMultiUser.showRegister()">정보 수정</button>
              <button class="btn btn-sm" onclick="window.erpMultiUser.openPresence()">👥 접속자 보기</button>
            </div>
          </div>
          <div style="margin-top:10px;font-size:0.82em;color:#666;">
            ${isMultiUserMode()
              ? `✅ 다중 접속 모드 활성 — 60초 마다 heartbeat / 30초 마다 다른 사용자 변경 동기화`
              : `⚠ 클라우드 연동 카드에서 <strong>Apps Script URL</strong>을 설정하면 다중 접속이 활성화됩니다`}
          </div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="card-head">
          <h3>👤 다중 접속 사용자</h3>
          <span class="tag gray">미등록</span>
        </div>
        <div class="card-body">
          <div style="padding:18px;background:#fffde7;border-left:4px solid #f9a825;border-radius:8px;">
            <div style="font-weight:700;color:#1a1a2e;margin-bottom:6px;">💡 다중 사용자 환경을 사용하려면 본인 정보를 등록하세요</div>
            <div style="font-size:0.86em;color:#666;line-height:1.6;">
              여러 사용자가 같은 ERP를 동시에 사용할 수 있습니다.<br>
              현재 누가 접속 중인지, 어떤 변경이 발생했는지 실시간으로 확인됩니다.
            </div>
            <button class="btn btn-primary" style="margin-top:14px;" onclick="window.erpMultiUser.showRegister()">👤 사용자 등록 시작</button>
          </div>
        </div>`;
    }
  }

  // ── 7. 부팅 / 타이머 ─────────────────────────────
  function _startTimers() {
    if (_hbTimer) clearInterval(_hbTimer);
    if (_pullPresenceTimer) clearInterval(_pullPresenceTimer);
    if (!isMultiUserMode()) return;
    _hbTimer = setInterval(_hbBeat, HB_INTERVAL_MS);
    _pullPresenceTimer = setInterval(_pullPresence, PULL_PRESENCE_MS);
    // 즉시 1회
    _hbBeat();
    setTimeout(_pullPresence, 2000);
  }

  // gsUrl 변경 감지 — 설정 저장 시 자동 활성화
  function _watchGsUrl() {
    let last = window.gsUrl || '';
    setInterval(() => {
      const cur = window.gsUrl || '';
      if (cur !== last) {
        last = cur;
        _maybeEnableSync();
        _startTimers();
        _renderPresenceBadge();
        _renderUserCard();
      }
    }, 2000);
  }

  // ── 공개 API ──────────────────────────────────────
  window.erpMultiUser = {
    isActive: isMultiUserMode,
    getIdentity, setIdentity, clearIdentity,
    getOnlineUsers, getRecentActivity,
    showRegister: showRegisterDialog,
    openPresence: openPresencePanel,
    _submitRegister,
    _renderCard: _renderUserCard,
    forceHeartbeat: _hbBeat,
    forcePullPresence: _pullPresence
  };

  function boot() {
    setTimeout(() => {
      _hookSyncApply();
      _renderPresenceBadge();
      _renderUserCard();
      _maybeEnableSync();
      _startTimers();
      _watchGsUrl();
      // 설정 탭이 열릴 때마다 카드 갱신
      if (typeof window.showTab === 'function' && !window.showTab.__muHooked) {
        const orig = window.showTab;
        window.showTab = function(id) {
          const r = orig.apply(this, arguments);
          if (id === 'settings') setTimeout(_renderUserCard, 500);
          return r;
        };
        window.showTab.__muHooked = true;
      }
      // 페이지를 닫을 때 heartbeat 한 번 더 (오프라인 알림)
      window.addEventListener('beforeunload', () => {
        if (!isMultiUserMode() || !window.gsUrl) return;
        try {
          const me = getIdentity();
          const url = window.gsUrl + '?action=heartbeat'
                    + '&device=' + encodeURIComponent(me.deviceId)
                    + '&name=' + encodeURIComponent(me.name)
                    + '&role=' + encodeURIComponent(me.role)
                    + '&offline=1';
          navigator.sendBeacon ? navigator.sendBeacon(url) : fetch(url, { keepalive: true });
        } catch(e) {}
      });
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-MU] 다중 사용자 모듈 활성 — erpMultiUser.showRegister()');
})();
