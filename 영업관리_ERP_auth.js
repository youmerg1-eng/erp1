// =====================================================
//  AUTH (5-LEVEL ROLES) — Phase E · Day 6
//  단일 PC 환경에서도 의미있는 역할 기반 UI 제어
//
//  역할 5단계
//   admin    — 시스템관리자 👑: 전체 + 설정·사용자 관리
//   exec     — 경영진 🎯:       전체 조회 (입력 없음)
//   sales    — 영업팀 💼:       영업·재고·채권 입력 (매입사 마스터 X)
//   ops      — 운영팀 ⚙️:       전체 입력 (설정 제외)
//   viewer   — 조회 👁:          재고·대시보드만
//
//  데이터 키: erp_auth (현재 역할)
//  진입점:
//   - 우상단 🔐 배지 클릭 → 빠른 전환 모달 (열기/닫기 토글)
//   - 설정 탭에 inject — 권한 매트릭스 표
//   - 콘솔: erpAuth.setRole('sales')
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_auth';
  const CUSTOM_KEY = 'erp_auth_custom_perms';   // ★ 시스템관리자가 부여한 사용자 권한 override

  // 탭 → 카테고리 매핑 (UI 그룹용)
  const TAB_CATEGORIES = [
    { key: 'main',     label: '🏠 메인',   tabs: [{id:'dashboard', label:'대시보드'}] },
    { key: 'sales',    label: '🛒 판매',   tabs: [
      {id:'orders', label:'수주현황'},
      {id:'delivery', label:'출고지시서'},
      {id:'splitdelivery', label:'분할출고관리'},
      {id:'inventory', label:'입고관리'},
      {id:'outbound', label:'출고관리'},
      {id:'stock', label:'재고관리'}
    ]},
    // ★ Phase 7: 창고 사업 — 정식 탭으로 승격
    { key: 'warehouse', label: '🏢 창고 사업', tabs: [
      {id:'warehouse_master', label:'창고 마스터'},
      {id:'thirdparty', label:'위탁 재고'},
      {id:'warehouse_rental', label:'임대사업'},
      {id:'logistics', label:'위탁 물류비'}
    ]},
    { key: 'analysis', label: '📊 분석',   tabs: [{id:'sales', label:'영업실적'}, {id:'cost_mgmt', label:'원가관리'}] },
    { key: 'docs',     label: '📋 문서',   tabs: [{id:'fr', label:'전수조사서(FR)'}] },
    { key: 'system',   label: '⚙️ 시스템', tabs: [{id:'settings', label:'설정'}] }
  ];
  function _allTabIds() {
    const ids = [];
    TAB_CATEGORIES.forEach(c => c.tabs.forEach(t => ids.push(t.id)));
    return ids;
  }

  const ROLES = {
    admin:  { lbl: '시스템관리자', icon: '👑', desc: '전체 기능 + 사용자 관리·설정',          color: '#c62828', bg: '#ffebee' },
    exec:   { lbl: '경영진',       icon: '🎯', desc: '전체 조회 (민감정보 포함, 입력 없음)',  color: '#7b1fa2', bg: '#f3e5f5' },
    sales:  { lbl: '영업팀',       icon: '💼', desc: '영업·재고·채권 입력 (매입사 마스터 X)', color: '#1565c0', bg: '#e3f2fd' },
    ops:    { lbl: '운영팀',       icon: '⚙️', desc: '전체 입력 (설정 제외)',                color: '#e65100', bg: '#fff3e0' },
    viewer: { lbl: '조회',         icon: '👁',  desc: '재고·대시보드만',                       color: '#27ae60', bg: '#e8f5e9' }
  };

  // 역할별 권한 매트릭스
  const PERMS = {
    admin:  { tabs:'*', edit: true,  hideFinance: false, hideSettings: false, hideVendor: false },
    exec:   { tabs:'*', edit: false, hideFinance: false, hideSettings: true,  hideVendor: false },
    sales:  { tabs:'*', edit: true,  hideFinance: false, hideSettings: true,  hideVendor: true  },
    ops:    { tabs:'*', edit: true,  hideFinance: false, hideSettings: true,  hideVendor: false },
    viewer: { tabs:['dashboard','stock'], edit: false, hideFinance: true, hideSettings: true, hideVendor: true }
  };

  function getRole() {
    let r = localStorage.getItem(KEY) || 'admin';
    // 마이그레이션: 구 'chief' (본부장) → 'sales' (영업팀)
    if (r === 'chief') {
      r = 'sales';
      try { localStorage.setItem(KEY, r); } catch(e) {}
    }
    return r;
  }

  // ── Custom perms (admin override layer) ───────────────
  //   기본 PERMS 위에 사용자가 부여한 권한을 덮어씀.
  //   tabs 가 모든 탭을 포함하면 '*' 로 저장.
  function _loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); } catch(e) { return {}; }
  }
  function _saveCustom(obj) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(obj || {})); } catch(e) {}
  }
  // 역할별 effective(최종) 권한 = 기본 ⊕ custom override
  function _effective(role) {
    const def = PERMS[role] || {};
    const cust = _loadCustom()[role] || {};
    return Object.assign({}, def, cust);
  }
  // admin 권한 — UI 노출 가드
  function _isAdmin() { return getRole() === 'admin'; }

  function setRole(r) {
    if (!ROLES[r]) throw new Error('invalid role: ' + r);
    try { localStorage.setItem(KEY, r); } catch(e) {}
    _applyRole();
    _renderCurrent();
    // admin ↔ non-admin 전환 시 권한 부여 UI를 다시 렌더링
    if (document.getElementById('auth-admin-editor')) _renderAdminEditor();
    if (typeof setBanner === 'function')
      setBanner('ok', `🔐 역할 변경: ${ROLES[r].lbl}`);
  }

  function check(action) {
    const r = getRole();
    const p = _effective(r);
    if (!p) return false;
    if (action === 'edit') return p.edit;
    if (action === 'finance') return !p.hideFinance;
    if (action === 'settings') return !p.hideSettings;
    return true;
  }

  // ── UI 적용 ─────────────────────────────────────────
  function _applyRole() {
    const r = getRole();
    const p = _effective(r);
    document.body.dataset.erpRole = r;

    // 1. 탭 visibility
    document.querySelectorAll('.nav-item').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/showTab\('([^']+)'\)/);
      if (!m) return;
      const tabId = m[1];
      const allowed = p.tabs === '*' || p.tabs.includes(tabId);
      btn.style.display = allowed ? '' : 'none';
    });

    // 2. 입력 비활성화 (edit:false면 모든 input/button 작업 readonly)
    if (!p.edit) {
      document.body.dataset.erpReadonly = '1';
    } else {
      delete document.body.dataset.erpReadonly;
    }

    // 3. 금융 정보 숨김 (hideFinance)
    const financeStyle = document.getElementById('erp-auth-finance-style');
    if (p.hideFinance) {
      if (!financeStyle) {
        const s = document.createElement('style');
        s.id = 'erp-auth-finance-style';
        s.textContent = `
          [data-erp-role="${r}"] .finance, [data-erp-role="${r}"] .col-amount,
          [data-erp-role="${r}"] td:has-text("원"), [data-erp-role="${r}"] [data-finance="1"] {
            filter: blur(4px); user-select: none; pointer-events: none;
          }
          [data-erp-role="${r}"] .finance::after { content: ' (가림)'; font-size: 0.8em; color: #c62828; }
        `;
        document.head.appendChild(s);
      }
    } else {
      financeStyle?.remove();
    }

    // 4. 설정 탭 숨김
    document.querySelectorAll('[onclick*="settings"]').forEach(el => {
      if (el.classList.contains('nav-item')) {
        el.style.display = p.hideSettings ? 'none' : '';
      }
    });

    // 4-1. 매입사 마스터 가림 (영업팀·조회 등)
    const vmSec = document.getElementById('vm-section');
    if (vmSec) vmSec.style.display = p.hideVendor ? 'none' : '';

    // 5. fab readonly 표시 (edit:false면 일부 fab은 안전 장치)
    if (!p.edit) {
      ['erp-mob-fab','erp-in-fab','erp-dsp-fab'].forEach(id => {
        const fab = document.getElementById(id);
        if (fab) fab.style.opacity = '0.5';
      });
    } else {
      ['erp-mob-fab','erp-in-fab','erp-dsp-fab'].forEach(id => {
        const fab = document.getElementById(id);
        if (fab) fab.style.opacity = '';
      });
    }

    // 6. 헤더 우상단에 역할 배지
    _updateRoleBadge();
  }

  function _updateRoleBadge() {
    let badge = document.getElementById('erp-auth-badge');
    const r = getRole();
    const m = ROLES[r];
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'erp-auth-badge';
      badge.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9050;padding:4px 10px;border-radius:6px;font-size:0.78em;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.15);';
      badge.title = '클릭 → 권한 빠른 전환';
      badge.onclick = openSwitcher;
      document.body.appendChild(badge);
    }
    badge.style.background = m.bg;
    badge.style.color = m.color;
    badge.innerHTML = `${m.icon} ${m.lbl}`;
  }

  // ── 권한 빠른 전환 모달 (우상단 배지 클릭) ──────────
  function openSwitcher() {
    let m = document.getElementById('erp-auth-switcher');
    if (m) { m.remove(); return; }   // 토글 — 이미 열려있으면 닫기
    m = document.createElement('div');
    m.id = 'erp-auth-switcher';
    m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;animation:fadeIn .15s;';
    m.onclick = e => { if (e.target === m) closeSwitcher(); };
    const cur = getRole();
    m.innerHTML = `
      <style>
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .auth-sw-box {
          background: #fff; border-radius: 14px;
          box-shadow: 0 16px 60px rgba(0,0,0,0.35);
          width: 92%; max-width: 520px; overflow: hidden;
        }
        .auth-sw-hd {
          padding: 14px 18px; background: #1a1a2e; color: #fff;
          display: flex; justify-content: space-between; align-items: center;
        }
        .auth-sw-hd h4 { margin: 0; font-size: 1em; font-weight: 700; }
        .auth-sw-bd { padding: 16px; }
        .auth-sw-list { display: grid; gap: 8px; }
        .auth-sw-item {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 10px;
          border: 2px solid #e0e0e0; cursor: pointer;
          transition: all .15s; background: #fafafa;
        }
        .auth-sw-item:hover { transform: translateY(-1px); }
        .auth-sw-item.cur { border-color: #1a1a2e; background: #fffde7; }
        .auth-sw-item.cur::after { content: '✓ 현재'; margin-left:auto; background:#1a1a2e; color:#fff; padding:2px 8px; border-radius:5px; font-size:0.74em; font-weight:700; }
        .auth-sw-icon {
          width: 36px; height: 36px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
        }
        .auth-sw-meta { flex: 1; }
        .auth-sw-name { font-weight: 800; font-size: 0.96em; }
        .auth-sw-desc { font-size: 0.78em; color: #666; margin-top: 2px; }
      </style>
      <div class="auth-sw-box">
        <div class="auth-sw-hd">
          <h4>🔐 권한 빠른 전환</h4>
          <button onclick="erpAuth.closeSwitcher()"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="auth-sw-bd">
          <div class="auth-sw-list">
            ${Object.entries(ROLES).map(([k,v]) => `
              <div class="auth-sw-item ${k===cur?'cur':''}" onclick="erpAuth.pickRole('${k}')"
                style="border-color:${k===cur?v.color:'#e0e0e0'};">
                <div class="auth-sw-icon" style="background:${v.bg};color:${v.color};">${v.icon}</div>
                <div class="auth-sw-meta">
                  <div class="auth-sw-name" style="color:${v.color};">${v.lbl}</div>
                  <div class="auth-sw-desc">${v.desc}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:14px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.82em;color:#666;">
            💡 클릭 즉시 적용 · 다시 변경 시 콘솔 또는 우상단 🔐 배지 클릭<br>
            ⚠️ 단일 PC UI 제어 — 데이터 자체는 보호되지 않음
          </div>
        </div>
      </div>`;
    document.body.appendChild(m);
    // ESC로 닫기
    setTimeout(() => {
      document.addEventListener('keydown', _swEscHandler);
    }, 50);
  }

  function _swEscHandler(e) {
    if (e.key === 'Escape') closeSwitcher();
  }

  function closeSwitcher() {
    const m = document.getElementById('erp-auth-switcher');
    if (m) m.remove();
    document.removeEventListener('keydown', _swEscHandler);
  }

  function pickRole(r) {
    if (!ROLES[r]) return;
    setRole(r);
    closeSwitcher();
    // 설정 탭이 열려있으면 권한 매트릭스 갱신
    const sec = document.getElementById('auth-section');
    if (sec) {
      _renderCurrent();
    }
  }

  // ── 설정 탭 inject ──────────────────────────────────
  function _injectIntoSettings() {
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    if (document.getElementById('auth-section')) return;

    const section = document.createElement('div');
    section.id = 'auth-section';
    section.style.cssText = 'margin-top:24px;padding:18px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;';
    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:1.05em;color:#1a1a2e;">🔐 사용자 권한 (5단계)</h3>
        <span style="font-size:0.78em;color:#888;">단일 사용자 환경 — 화면 가시성 제어</span>
      </div>
      <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:14px;">
        <div style="font-size:0.84em;color:#666;margin-bottom:8px;font-weight:700;">현재 역할</div>
        <div id="auth-current" style="display:flex;align-items:center;gap:8px;"></div>
      </div>
      <div id="auth-role-picker" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
        ${Object.entries(ROLES).map(([k,m]) => {
          const isCur = k === getRole();
          return `
          <label class="auth-role-pick" data-role="${k}" style="padding:14px 10px;border:2px solid ${isCur?m.color:'#e0e0e0'};border-radius:10px;background:${isCur?m.bg:'#fafafa'};color:${m.color};cursor:pointer;text-align:left;display:block;position:relative;transition:all .15s;">
            <input type="radio" name="auth-role" value="${k}" ${isCur?'checked':''} onchange="erpAuth.setRole(this.value)" style="position:absolute;top:10px;right:10px;width:18px;height:18px;cursor:pointer;accent-color:${m.color};">
            <div style="font-weight:800;font-size:0.92em;margin-bottom:4px;padding-right:24px;">${m.icon} ${m.lbl}</div>
            <div style="font-size:0.74em;line-height:1.4;opacity:0.85;">${m.desc}</div>
          </label>`;
        }).join('')}
      </div>
      <div style="margin-top:16px;font-size:0.82em;color:#666;line-height:1.6;">
        <strong>권한 매트릭스 (현재 적용 상태)</strong>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.86em;">
          <thead><tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">역할</th>
            <th style="padding:6px 10px;">접근 탭</th>
            <th style="padding:6px 10px;">데이터 입력</th>
            <th style="padding:6px 10px;">금액 표시</th>
            <th style="padding:6px 10px;">매입사 마스터</th>
            <th style="padding:6px 10px;">설정 접근</th>
          </tr></thead>
          <tbody>
            ${Object.keys(ROLES).map(k => {
              const p = _effective(k);
              const m = ROLES[k];
              const cust = _loadCustom()[k];
              const dot = cust ? ' <span style="color:#1565c0;font-size:0.78em;" title="커스텀 적용됨">●</span>' : '';
              return `<tr><td style="padding:6px 10px;background:${m.bg};color:${m.color};font-weight:700;">${m.icon} ${m.lbl}${dot}</td>
                <td style="padding:6px 10px;text-align:center;">${p.tabs === '*' ? '전체' : (p.tabs||[]).length+'개'}</td>
                <td style="padding:6px 10px;text-align:center;">${p.edit ? '✅' : '❌'}</td>
                <td style="padding:6px 10px;text-align:center;">${p.hideFinance ? '❌ (가림)' : '✅'}</td>
                <td style="padding:6px 10px;text-align:center;">${p.hideVendor ? '❌' : '✅'}</td>
                <td style="padding:6px 10px;text-align:center;">${p.hideSettings ? '❌' : '✅'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="font-size:0.78em;color:#888;margin-top:4px;">● = 시스템 관리자가 커스텀 권한 부여한 역할</div>
      </div>
      <div id="auth-admin-editor"></div>
      <div style="margin-top:14px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.82em;color:#666;">
        💡 <strong>안내</strong>: 단일 PC에서도 사용. 영업·경영진 화면을 보여줄 때 임시로 viewer/exec 모드로 전환하면 민감 정보 자동 가림.<br>
        ⚠️ 데이터 자체는 보호되지 않음 — F12 콘솔에서 erpAuth.setRole('admin')으로 즉시 복원 가능 (단순 UI 제어).
      </div>`;
    tab.appendChild(section);
    _renderCurrent();
    _renderAdminEditor();   // ★ admin 일 때만 권한 부여 UI 표시
  }

  // ── 시스템 관리자 전용 권한 부여 UI ────────────────
  //   카테고리 × 역할 행렬에서 탭 단위 체크박스 + 권한 플래그 토글.
  //   저장 시 _saveCustom() 호출, 즉시 _applyRole() 재적용.
  function _renderAdminEditor() {
    const host = document.getElementById('auth-admin-editor');
    if (!host) return;
    if (!_isAdmin()) {
      host.innerHTML = `
        <div style="margin-top:14px;padding:14px;background:#f5f5f5;border-radius:8px;text-align:center;color:#888;font-size:0.84em;">
          🔒 <strong>권한 부여 기능은 시스템 관리자(👑)만 사용할 수 있습니다.</strong>
        </div>`;
      return;
    }
    const custom = _loadCustom();
    const allTabs = _allTabIds();

    // 역할별 탭 셋 (체크박스 상태)
    const roleTabSet = {};
    Object.keys(ROLES).forEach(rk => {
      const eff = _effective(rk);
      roleTabSet[rk] = eff.tabs === '*' ? new Set(allTabs) : new Set(eff.tabs||[]);
    });

    // 카테고리 × 역할 그리드
    const tabHeaderHtml = TAB_CATEGORIES.map(c => `
      <div class="aae-cat">
        <div class="aae-cat-hd">
          <span style="font-weight:800;">${c.label}</span>
          <span style="font-size:0.74em;color:#888;">${c.tabs.length}개 탭</span>
        </div>
        <table class="aae-tbl">
          <thead>
            <tr>
              <th style="width:40%;">탭</th>
              ${Object.keys(ROLES).map(rk => {
                const m = ROLES[rk];
                return `<th title="${m.lbl}" style="text-align:center;background:${m.bg};color:${m.color};">${m.icon}<br><span style="font-size:0.74em;">${m.lbl}</span></th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${c.tabs.map(t => `
              <tr>
                <td style="font-weight:600;color:#333;">${t.label}<br><span style="font-size:0.72em;color:#888;font-weight:400;">${t.id}</span></td>
                ${Object.keys(ROLES).map(rk => {
                  const checked = roleTabSet[rk].has(t.id);
                  const isAdmin = rk === 'admin';
                  return `<td style="text-align:center;">
                    <input type="checkbox" class="aae-tab-cb" data-role="${rk}" data-tab="${t.id}"
                      ${checked?'checked':''} ${isAdmin?'disabled title="시스템관리자는 항상 전체 접근"':''}
                      style="width:18px;height:18px;cursor:${isAdmin?'not-allowed':'pointer'};accent-color:${ROLES[rk].color};">
                  </td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');

    // 추가 권한 플래그 (입력/금액/매입사/설정)
    const flagRowsHtml = Object.keys(ROLES).map(rk => {
      const m = ROLES[rk];
      const eff = _effective(rk);
      const isAdmin = rk === 'admin';
      const dis = isAdmin ? 'disabled' : '';
      return `<tr>
        <td style="background:${m.bg};color:${m.color};font-weight:700;padding:8px 10px;">${m.icon} ${m.lbl}</td>
        <td style="text-align:center;"><input type="checkbox" class="aae-flag-cb" data-role="${rk}" data-flag="edit"        ${eff.edit?'checked':''}        ${dis} style="width:18px;height:18px;accent-color:${m.color};"></td>
        <td style="text-align:center;"><input type="checkbox" class="aae-flag-cb" data-role="${rk}" data-flag="hideFinance" ${eff.hideFinance?'checked':''} ${dis} style="width:18px;height:18px;accent-color:#c62828;"></td>
        <td style="text-align:center;"><input type="checkbox" class="aae-flag-cb" data-role="${rk}" data-flag="hideVendor"  ${eff.hideVendor?'checked':''}  ${dis} style="width:18px;height:18px;accent-color:#c62828;"></td>
        <td style="text-align:center;"><input type="checkbox" class="aae-flag-cb" data-role="${rk}" data-flag="hideSettings"${eff.hideSettings?'checked':''} ${dis} style="width:18px;height:18px;accent-color:#c62828;"></td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      <style>
        .aae-box{margin-top:18px;padding:16px;background:linear-gradient(135deg,#fff8e1,#fffde7);border:2px solid #f9a825;border-radius:12px;}
        .aae-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
        .aae-hd h4{margin:0;color:#c62828;font-size:1em;font-weight:800;}
        .aae-cat{background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
        .aae-cat-hd{display:flex;justify-content:space-between;align-items:center;padding:4px 0 8px;border-bottom:1px solid #eee;margin-bottom:6px;}
        .aae-tbl{width:100%;border-collapse:collapse;font-size:0.84em;}
        .aae-tbl th, .aae-tbl td{padding:6px 8px;border-bottom:1px solid #f0f0f0;}
        .aae-flag-tbl{width:100%;border-collapse:collapse;font-size:0.84em;background:#fff;border-radius:8px;overflow:hidden;}
        .aae-flag-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;font-size:0.82em;text-align:center;}
        .aae-flag-tbl td{padding:6px 10px;border-bottom:1px solid #f0f0f0;}
        .aae-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}
        .aae-btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:0.86em;font-weight:700;}
        .aae-btn.primary{background:#1a1a2e;color:#fff;}
        .aae-btn.danger{background:#fff;color:#c62828;border:1.5px solid #c62828;}
        .aae-btn.gray{background:#fff;color:#666;border:1.5px solid #ccc;}
      </style>
      <div class="aae-box">
        <div class="aae-hd">
          <h4>👑 시스템 관리자 — 사용자 권한 부여</h4>
          <span style="font-size:0.78em;color:#666;">카테고리·탭별 접근 권한 + 추가 플래그</span>
        </div>

        <!-- 카테고리·탭 체크박스 -->
        ${tabHeaderHtml}

        <!-- 추가 권한 플래그 -->
        <div style="margin-top:14px;">
          <div style="font-weight:700;color:#1a1a2e;margin-bottom:6px;font-size:0.92em;">⚙️ 추가 권한 플래그</div>
          <table class="aae-flag-tbl">
            <thead>
              <tr>
                <th style="text-align:left;">역할</th>
                <th title="체크 시: 수주·서류·결제 등 모든 데이터 입력/수정 가능 — 미체크 시: 읽기 전용">수정 권한</th>
                <th title="체크하면 금액 가림">금액 가림</th>
                <th title="체크하면 매입사 마스터 가림">매입사 가림</th>
                <th title="체크하면 설정 탭 숨김">설정 숨김</th>
              </tr>
            </thead>
            <tbody>${flagRowsHtml}</tbody>
          </table>
          <div style="margin-top:6px;font-size:0.78em;color:#666;background:#fff;padding:6px 10px;border-radius:5px;border:1px dashed #f9a825;">
            💡 <strong>수정 권한</strong> 미체크 시 ✏️ 수정 / 📎 파일첨부 / 등록 / 삭제 등 모든 변경 작업이 차단됩니다.
            조회 / 다운로드 / 출력 / 엑셀 내보내기는 정상 작동.
          </div>
        </div>

        <div class="aae-actions">
          <button class="aae-btn gray" onclick="erpAuth.adminReset()" title="기본 권한으로 초기화">🔄 기본값 복원</button>
          <button class="aae-btn danger" onclick="erpAuth.adminClearOne()" title="특정 역할의 커스텀 권한만 제거">↩️ 선택 역할 초기화</button>
          <button class="aae-btn primary" onclick="erpAuth.adminSave()">💾 권한 저장 + 즉시 적용</button>
        </div>

        <div style="margin-top:10px;padding:8px 10px;background:rgba(255,193,7,0.15);border-radius:6px;font-size:0.78em;color:#666;line-height:1.5;">
          📌 시스템 관리자(👑) 자신의 권한은 항상 전체 접근으로 고정되어 보호됩니다.<br>
          📌 변경사항은 <strong>저장 즉시</strong> 사이드바·탭 표시에 반영됩니다.
        </div>
      </div>`;
  }

  // ── admin UI 액션 ───────────────────────────────────
  function adminSave() {
    if (!_isAdmin()) { alert('시스템 관리자만 사용 가능합니다.'); return; }
    const allTabs = _allTabIds();
    const newCustom = {};
    Object.keys(ROLES).forEach(rk => {
      if (rk === 'admin') return;     // admin은 기본값 유지
      // 1) 탭 체크박스 수집
      const tabs = [];
      document.querySelectorAll(`.aae-tab-cb[data-role="${rk}"]:checked`).forEach(cb => {
        tabs.push(cb.getAttribute('data-tab'));
      });
      // 2) 플래그 수집
      const flags = {};
      document.querySelectorAll(`.aae-flag-cb[data-role="${rk}"]`).forEach(cb => {
        flags[cb.getAttribute('data-flag')] = cb.checked;
      });
      // 3) 모든 탭이 체크되어있으면 '*' 로 단순화
      const tabsValue = tabs.length === allTabs.length ? '*' : tabs;
      // 4) 기본 PERMS와 다른 것만 custom으로 저장
      const def = PERMS[rk] || {};
      const cust = {};
      // tabs 비교
      const sameTabs = (a,b) => {
        if (a === '*' && b === '*') return true;
        if (a === '*' || b === '*') return false;
        const sa = new Set(a||[]), sb = new Set(b||[]);
        if (sa.size !== sb.size) return false;
        for (const x of sa) if (!sb.has(x)) return false;
        return true;
      };
      if (!sameTabs(tabsValue, def.tabs)) cust.tabs = tabsValue;
      ['edit','hideFinance','hideVendor','hideSettings'].forEach(f => {
        if (flags[f] !== def[f]) cust[f] = flags[f];
      });
      if (Object.keys(cust).length) newCustom[rk] = cust;
    });
    _saveCustom(newCustom);
    _applyRole();
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ 권한 부여 저장 완료 — ${Object.keys(newCustom).length}개 역할 커스텀 적용`);
    // 매트릭스·에디터 리렌더
    const sec = document.getElementById('auth-section');
    if (sec) { sec.remove(); _injectIntoSettings(); }
  }

  function adminReset() {
    if (!_isAdmin()) { alert('시스템 관리자만 사용 가능합니다.'); return; }
    if (!confirm('모든 역할의 커스텀 권한을 제거하고 기본값으로 복원합니다.\n계속하시겠습니까?')) return;
    _saveCustom({});
    _applyRole();
    if (typeof setBanner === 'function')
      setBanner('ok', '🔄 모든 권한이 기본값으로 복원되었습니다.');
    const sec = document.getElementById('auth-section');
    if (sec) { sec.remove(); _injectIntoSettings(); }
  }

  function adminClearOne() {
    if (!_isAdmin()) { alert('시스템 관리자만 사용 가능합니다.'); return; }
    const opts = Object.keys(ROLES).filter(k => k !== 'admin').map(k => `${ROLES[k].icon} ${ROLES[k].lbl} (${k})`);
    const sel = prompt(`초기화할 역할을 선택하세요 (1~${opts.length}):\n\n${opts.map((o,i)=>`${i+1}. ${o}`).join('\n')}`);
    if (!sel) return;
    const idx = parseInt(sel) - 1;
    const keys = Object.keys(ROLES).filter(k => k !== 'admin');
    if (isNaN(idx) || idx < 0 || idx >= keys.length) { alert('잘못된 선택입니다.'); return; }
    const key = keys[idx];
    const cust = _loadCustom();
    delete cust[key];
    _saveCustom(cust);
    _applyRole();
    if (typeof setBanner === 'function')
      setBanner('ok', `↩️ ${ROLES[key].lbl} 권한 기본값 복원 완료`);
    const sec = document.getElementById('auth-section');
    if (sec) { sec.remove(); _injectIntoSettings(); }
  }

  function _renderCurrent() {
    const el = document.getElementById('auth-current');
    const r = getRole();
    const m = ROLES[r];
    if (el) {
      el.innerHTML = `<span style="background:${m.bg};color:${m.color};padding:6px 14px;border-radius:6px;font-weight:800;font-size:1em;">🔐 ${m.lbl}</span>
        <span style="color:#666;font-size:0.86em;">${m.desc}</span>`;
    }
    // 라디오 picker 상태 동기화 (setRole 후에도 시각적 반영)
    const picker = document.getElementById('auth-role-picker');
    if (picker) {
      picker.querySelectorAll('.auth-role-pick').forEach(lbl => {
        const k = lbl.dataset.role;
        const rm = ROLES[k];
        const isCur = k === r;
        lbl.style.borderColor = isCur ? rm.color : '#e0e0e0';
        lbl.style.background = isCur ? rm.bg : '#fafafa';
        const radio = lbl.querySelector('input[type="radio"]');
        if (radio) radio.checked = isCur;
      });
    }
  }

  // ── 입력 차단 CSS ───────────────────────────────────
  function _injectReadonlyCss() {
    if (document.getElementById('erp-auth-ro-style')) return;
    const css = `
      body[data-erp-readonly="1"] button[onclick*="save"],
      body[data-erp-readonly="1"] button[onclick*="submit"],
      body[data-erp-readonly="1"] button[onclick*="add"],
      body[data-erp-readonly="1"] button[onclick*="delete"],
      body[data-erp-readonly="1"] button[onclick*="register"],
      body[data-erp-readonly="1"] button[onclick*="create"],
      body[data-erp-readonly="1"] button[onclick*="update"] {
        opacity: 0.4 !important; pointer-events: none !important; cursor: not-allowed !important;
      }
      body[data-erp-readonly="1"] input:not([type="search"]):not(.calc-input):not(#gs-search-input):not([id*="search"]):not([id*="filter"]),
      body[data-erp-readonly="1"] textarea {
        background: #fafafa !important; pointer-events: none !important;
      }
      body[data-erp-readonly="1"]::before {
        content: "📖 조회 모드 — 입력·수정 비활성";
        position: fixed; top: 50px; right: 10px; z-index: 9050;
        background: rgba(123,31,162,0.92); color: #fff; padding: 4px 10px;
        border-radius: 6px; font-size: 0.74em; font-weight: 700;
      }
    `;
    const s = document.createElement('style');
    s.id = 'erp-auth-ro-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── showTab hook (auth.js inject) ───────────────────
  function _hookSettings() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookSettings, 300); return; }
    if (window.showTab.__authHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (id === 'settings') setTimeout(() => { _injectIntoSettings(); _renderCurrent(); }, 50);
      return r;
    };
    window.showTab.__authHooked = true;
  }

  // ── 공개 API ────────────────────────────────────────
  // ★ 보안 — saveCustom 은 public 으로 노출하지 않음.
  //   이전에는 viewer 가 콘솔에서 erpAuth.saveCustom({viewer:{tabs:'*',edit:true}})
  //   를 호출해 admin 권한을 즉시 획득할 수 있었음.
  //   이제는 admin 검증을 거친 adminSave/adminReset/adminClearOne 만 노출.
  //   customPerms 도 read-only 노출 (정보 조회용).
  window.erpAuth = {
    getRole, setRole, check,
    list: () => ROLES,
    perms: () => PERMS,                    // 기본 권한 (read-only)
    effective: _effective,                 // 최종 적용 권한 (read-only)
    customPerms: () => {                   // 커스텀 권한 (read-only deep copy)
      try { return JSON.parse(JSON.stringify(_loadCustom())); } catch (e) { return {}; }
    },
    categories: () => TAB_CATEGORIES,
    // 시스템관리자 전용 액션 — 내부에서 _isAdmin() 체크
    adminSave, adminReset, adminClearOne,
    openSwitcher, closeSwitcher, pickRole
  };
  // saveCustom 직접 변경은 차단 — 의도적으로 노출 안 함

  function boot() {
    _injectReadonlyCss();
    _hookSettings();
    setTimeout(() => {
      _applyRole();
      const t = document.getElementById('tab-settings');
      if (t && t.classList.contains('active')) _injectIntoSettings();
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-AUTH] 5단계 권한 활성 — 현재 역할: ' + ROLES[getRole()].lbl + ' (erpAuth.setRole)');
})();
