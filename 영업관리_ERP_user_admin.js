// =====================================================
//  USER ADMIN — 사용자 계정 관리 (2026-05-13)
//
//  기능
//   - 새 사용자 등록 (admin 전용)
//   - 사용자 목록 표시 + 역할 변경
//   - 비밀번호 초기화 (강제 변경 요구)
//   - 사용자 비활성화/삭제
//   - 본인 비밀번호 변경
//
//  설정 → 권한 관리 서브탭에 카드 자동 주입
// =====================================================
(function() {
  'use strict';

  const ROLE_LABELS = {
    admin: '시스템 관리자',
    exec: '경영진',
    sales: '영업팀',
    ops: '운영팀',
    viewer: '조회자'
  };

  // ── 사용자 목록 가져오기 ────────────────────────
  async function listUsers() {
    if (!window.gsUrl) throw new Error('서버 URL 미설정');
    const s = window.erpAuthGate?.getCurrentUser();
    if (!s) throw new Error('로그인 필요');
    const res = await fetch(window.gsUrl + '?action=list_users&device=' + encodeURIComponent(s.deviceId), {
      redirect: 'follow'
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '목록 조회 실패');
    return json.users || [];
  }

  // ── 새 사용자 등록 ─────────────────────────────
  async function registerUser(username, password, role) {
    if (!window.erpAuthGate) throw new Error('인증 모듈 미로드');
    if (!username || !password) throw new Error('아이디·비밀번호 필수');
    if (password.length < 8) throw new Error('비밀번호는 최소 8자');
    if (!_strong(password)) throw new Error('영문 대소문자·숫자·특수문자 중 3종 이상 조합 필요');
    const me = window.erpAuthGate.getCurrentUser();
    if (!me) throw new Error('로그인 필요');
    const clientHash = await window.erpAuthGate.hashPassword(password);
    const res = await fetch(window.gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'register_user',
        adminUser: me.user,
        username,
        clientHash,
        role: role || 'sales',
        deviceId: me.deviceId
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '등록 실패');
    return json;
  }

  // ── 비밀번호 초기화 (admin) ───────────────────
  async function resetPassword(username, newPassword) {
    if (!_strong(newPassword)) throw new Error('영문 대소문자·숫자·특수문자 중 3종 이상 조합 필요');
    const me = window.erpAuthGate.getCurrentUser();
    if (!me) throw new Error('로그인 필요');
    const clientHash = await window.erpAuthGate.hashPassword(newPassword);
    const res = await fetch(window.gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'reset_password',
        adminUser: me.user,
        username,
        newHash: clientHash,
        deviceId: me.deviceId
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '비밀번호 초기화 실패');
    return json;
  }

  async function deleteUser(username) {
    if (!confirm(`사용자 "${username}" 을(를) 삭제합니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const me = window.erpAuthGate.getCurrentUser();
    if (!me) throw new Error('로그인 필요');
    const res = await fetch(window.gsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'delete_user',
        adminUser: me.user,
        username,
        deviceId: me.deviceId
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '삭제 실패');
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${username} 삭제 완료`);
    _renderCard();
    return json;
  }

  function _strong(p) {
    let score = 0;
    if (/[a-z]/.test(p)) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score >= 3 && p.length >= 8;
  }

  function _e(v) {
    return String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }

  // ── UI: 사용자 관리 카드 ────────────────────────
  async function _renderCard() {
    const host = document.getElementById('set-section-perm');
    if (!host) return;
    const me = window.erpAuthGate?.getCurrentUser();
    if (!me) return;
    const isAdmin = me.role === 'admin';

    let card = document.getElementById('ua-user-mgr-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'ua-user-mgr-card';
      card.className = 'card';
      host.appendChild(card);
    }

    if (!isAdmin) {
      card.innerHTML = `
        <div class="card-head"><h3>🔐 본인 계정</h3><span class="tag gray">${_e(ROLE_LABELS[me.role]||me.role)}</span></div>
        <div class="card-body">
          <div style="padding:14px;background:#f8f9fa;border-radius:8px;">
            <div><strong>${_e(me.user)}</strong> 님</div>
            <div style="font-size:0.84em;color:#666;margin-top:4px;">역할: ${_e(ROLE_LABELS[me.role]||me.role)}</div>
          </div>
          <button class="btn btn-sm" style="margin-top:14px;" onclick="window.erpUserAdmin.openChangePw()">🔑 비밀번호 변경</button>
          <button class="btn btn-sm btn-outline" style="margin-top:14px;margin-left:6px;" onclick="window.erpAuthGate.logout('사용자 요청')">로그아웃</button>
        </div>
      `;
      return;
    }

    // 관리자 — 사용자 목록 로드
    card.innerHTML = `
      <div class="card-head">
        <h3>👥 사용자 관리</h3>
        <span class="tag blue">관리자 전용</span>
      </div>
      <div class="card-body">
        <div style="margin-bottom:14px;">
          <button class="btn btn-sm btn-primary" onclick="window.erpUserAdmin.openRegister()">➕ 새 사용자 등록</button>
          <button class="btn btn-sm" onclick="window.erpUserAdmin.openChangePw()">🔑 내 비밀번호 변경</button>
          <button class="btn btn-sm btn-outline" onclick="window.erpUserAdmin.refresh()">🔄 목록 새로고침</button>
          <button class="btn btn-sm btn-outline" onclick="window.erpUserAdmin.openSecurityLog()">🔍 보안 로그</button>
        </div>
        <div id="ua-list" style="font-size:0.9em;color:#888;">로딩 중...</div>
      </div>
    `;

    try {
      const users = await listUsers();
      const listEl = document.getElementById('ua-list');
      if (!users.length) {
        listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;">등록된 사용자 없음 — 첫 사용자를 등록하세요</div>';
        return;
      }
      listEl.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.86em;">
            <thead>
              <tr style="background:#1a1a2e;color:#fff;">
                <th style="padding:8px;text-align:left;">아이디</th>
                <th style="padding:8px;text-align:left;">역할</th>
                <th style="padding:8px;text-align:left;">등록일</th>
                <th style="padding:8px;text-align:left;">마지막 로그인</th>
                <th style="padding:8px;text-align:center;">작업</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr style="border-bottom:1px solid #eee;${u.username===me.user?'background:#fffde7;':''}">
                  <td style="padding:8px;font-weight:700;">${_e(u.username)}${u.username===me.user?' <span style="color:#1565c0;font-size:0.78em;">(나)</span>':''}</td>
                  <td style="padding:8px;">${_e(ROLE_LABELS[u.role]||u.role)}</td>
                  <td style="padding:8px;color:#888;">${_e((u.createdAt||'').slice(0,10))}</td>
                  <td style="padding:8px;color:#888;">${u.lastLogin ? _e(u.lastLogin.slice(0,16).replace('T',' ')) : '-'}</td>
                  <td style="padding:8px;text-align:center;">
                    <button class="btn btn-xs" onclick="window.erpUserAdmin.openResetPw('${_e(u.username)}')">🔑 초기화</button>
                    ${u.username!==me.user ? `<button class="btn btn-xs btn-danger" onclick="window.erpUserAdmin.deleteUser('${_e(u.username)}').catch(e=>alert(e.message))">🗑</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch(e) {
      document.getElementById('ua-list').innerHTML = `<div style="padding:14px;background:#ffebee;color:#c62828;border-radius:6px;">목록 조회 실패: ${_e(e.message)}</div>`;
    }
  }

  // ── 다이얼로그들 ────────────────────────────────
  function _showDialog(title, html, onSubmit) {
    let modal = document.getElementById('ua-dialog');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'ua-dialog';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9750;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:90%;max-width:440px;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,0.35);">
        <div style="padding:14px 18px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;">
          <h4 style="margin:0;font-size:1em;">${title}</h4>
          <button onclick="document.getElementById('ua-dialog').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:20px;">${html}</div>
        <div style="padding:12px 18px;background:#fafafa;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-sm" onclick="document.getElementById('ua-dialog').remove()">취소</button>
          <button class="btn btn-sm btn-primary" id="ua-dialog-ok">확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('ua-dialog-ok').addEventListener('click', async () => {
      const btn = document.getElementById('ua-dialog-ok');
      btn.disabled = true; btn.textContent = '처리 중...';
      try {
        await onSubmit();
        modal.remove();
        _renderCard();
      } catch(e) {
        alert(e.message);
        btn.disabled = false; btn.textContent = '확인';
      }
    });
  }

  function openRegister() {
    _showDialog('➕ 새 사용자 등록', `
      <label style="font-size:0.84em;font-weight:700;">아이디</label>
      <input id="ua-reg-user" type="text" maxlength="40" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <label style="font-size:0.84em;font-weight:700;">비밀번호 (8자 이상, 3종 이상 조합)</label>
      <input id="ua-reg-pw" type="password" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <label style="font-size:0.84em;font-weight:700;">역할</label>
      <select id="ua-reg-role" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;">
        <option value="admin">시스템 관리자</option>
        <option value="exec">경영진</option>
        <option value="sales" selected>영업팀</option>
        <option value="ops">운영팀</option>
        <option value="viewer">조회자</option>
      </select>
    `, async () => {
      const u = document.getElementById('ua-reg-user').value.trim();
      const p = document.getElementById('ua-reg-pw').value;
      const r = document.getElementById('ua-reg-role').value;
      await registerUser(u, p, r);
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${u} 사용자 등록 완료`);
    });
  }

  function openResetPw(username) {
    _showDialog(`🔑 비밀번호 초기화 — ${username}`, `
      <div style="padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;margin-bottom:14px;font-size:0.84em;">
        ⚠ 새 비밀번호는 임시이며, 해당 사용자가 다음 로그인 후 직접 변경해야 합니다.
      </div>
      <label style="font-size:0.84em;font-weight:700;">새 비밀번호 (8자 이상)</label>
      <input id="ua-reset-pw" type="password" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;">
    `, async () => {
      const p = document.getElementById('ua-reset-pw').value;
      await resetPassword(username, p);
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${username} 비밀번호 초기화 완료`);
    });
  }

  function openChangePw() {
    _showDialog('🔑 내 비밀번호 변경', `
      <label style="font-size:0.84em;font-weight:700;">현재 비밀번호</label>
      <input id="ua-cur-pw" type="password" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <label style="font-size:0.84em;font-weight:700;">새 비밀번호 (8자 이상, 3종 이상 조합)</label>
      <input id="ua-new-pw" type="password" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <label style="font-size:0.84em;font-weight:700;">새 비밀번호 확인</label>
      <input id="ua-confirm-pw" type="password" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;box-sizing:border-box;">
    `, async () => {
      const cur = document.getElementById('ua-cur-pw').value;
      const np = document.getElementById('ua-new-pw').value;
      const cf = document.getElementById('ua-confirm-pw').value;
      if (np !== cf) throw new Error('새 비밀번호 확인이 일치하지 않음');
      await window.erpAuthGate.changePassword(cur, np);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 비밀번호 변경 완료`);
    });
  }

  function openSecurityLog() {
    const logs = window.erpAuthGate.securityLog();
    let modal = document.getElementById('ua-dialog');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'ua-dialog';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9750;display:flex;align-items:center;justify-content:center;';
    const kindColors = {
      login_success: '#27ae60',
      login_fail:    '#c62828',
      logout:        '#888',
      lockout:       '#e65100',
      passwd_change: '#1565c0',
      passwd_change_fail: '#c62828'
    };
    modal.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:90%;max-width:720px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,0.35);">
        <div style="padding:14px 18px;background:#1a1a2e;color:#fff;display:flex;justify-content:space-between;align-items:center;">
          <h4 style="margin:0;font-size:1em;">🔍 로컬 보안 로그 (최근 ${logs.length}건)</h4>
          <button onclick="document.getElementById('ua-dialog').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">
          ${logs.length === 0 ? '<div style="padding:30px;text-align:center;color:#aaa;">기록 없음</div>' :
          `<table style="width:100%;border-collapse:collapse;font-size:0.84em;">
            <thead><tr style="background:#fafafa;">
              <th style="padding:6px;text-align:left;">시각</th>
              <th style="padding:6px;text-align:left;">종류</th>
              <th style="padding:6px;text-align:left;">사용자</th>
              <th style="padding:6px;text-align:left;">상세</th>
            </tr></thead>
            <tbody>
              ${logs.map(l => `<tr style="border-bottom:1px solid #f5f5f5;">
                <td style="padding:6px;color:#666;font-family:monospace;font-size:0.86em;">${_e(l.ts.slice(0,19).replace('T',' '))}</td>
                <td style="padding:6px;"><span style="background:${kindColors[l.kind]||'#888'};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.76em;">${_e(l.kind)}</span></td>
                <td style="padding:6px;">${_e(l.user||'-')}</td>
                <td style="padding:6px;color:#888;">${_e(l.detail||'')}</td>
              </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
        <div style="padding:10px 18px;background:#fafafa;border-top:1px solid #eee;text-align:right;">
          <button class="btn btn-sm btn-outline" onclick="window.erpAuthGate.clearSecurityLog();document.getElementById('ua-dialog').remove();">🗑 로그 삭제</button>
          <button class="btn btn-sm" onclick="document.getElementById('ua-dialog').remove()">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // ── 공개 API ──────────────────────────────────────
  window.erpUserAdmin = {
    listUsers, registerUser, resetPassword, deleteUser,
    refresh: _renderCard,
    openRegister, openResetPw, openChangePw, openSecurityLog
  };

  // ── 부팅 ─────────────────────────────────────────
  function boot() {
    setTimeout(() => {
      _renderCard();
      // 설정 탭이 열릴 때마다 다시 렌더
      if (typeof window.showTab === 'function' && !window.showTab.__uaHooked) {
        const orig = window.showTab;
        window.showTab = function(id) {
          const r = orig.apply(this, arguments);
          if (id === 'settings') setTimeout(_renderCard, 600);
          return r;
        };
        window.showTab.__uaHooked = true;
      }
    }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-USER-ADMIN] 사용자 관리 모듈 활성 — erpUserAdmin.refresh()');
})();
