// =====================================================
//  TOOLBAR — 메인 탭으로 통합
//
//  변경 사항 (v2)
//   - 좌측 사이드바에 "🛠 도구함" nav-item 추가 (탭처럼)
//   - 메인 영역에 #tab-tools 패널 (다른 탭과 동일 형태)
//   - 카드 그리드: 카테고리별 + 검색
//   - 우상단 미니바 4개 유지 (자주 쓰는 도구 빠른 액세스)
//   - 우측 하단 ⊞ Quick Access 유지 (Alt+T)
//
//  기존 13개 fab은 모두 hidden — toolbar의 카드/메뉴로 통합 진입
// =====================================================
(function() {
  'use strict';

  const TOOLS = [
    { id:'erp-gs-fab',     icon:'🔍', short:'검색',   label:'글로벌 검색',  desc:'PJ·고객·SN 통합', cat:'핵심', pinned:true,
      api:'openErpSearch', shortcut:'Ctrl+K' },
    { id:'erp-calc-fab',   icon:'🧮', short:'계산기', label:'용량 계산기',  desc:'장수↔kW↔PLT↔트럭', cat:'핵심', pinned:true,
      api:'erpCalc.open' },
    { id:'erp-ai-fab',     icon:'🤖', short:'바로AI', label:'AI 어시스턴트', desc:'Gemini + OCR', cat:'핵심', pinned:true,
      api:'ai.open' },
    { id:'erp-fb-fab',     icon:'💬', short:'피드백', label:'피드백',        desc:'버그·제안·질문', cat:'핵심', pinned:true,
      api:'erpFeedback.open' },

    // ── 비즈니스 도구 ──
    //   ★ 2026-05-13 (1차) 탭으로 이전된 도구는 toolbar 메뉴에서 제거 (중복 정리):
    //     - 견적서 → 영업 탭 → 견적서관리 서브탭
    //     - 반품/RMA → 반품/RMA 관리 탭
    //     - 매입처 견적비교 → 영업 탭 → 견적비교 서브탭
    //     - 출고 캘린더 → 대시보드 통합 캘린더 (6가지 이벤트 통합)
    //     - 신용 분석 → 영업실적 탭 → 신용분석 서브탭
    //     - 매출 예측 → 영업실적 탭 → 매출 예측 서브탭
    //     - 가용재고 ATP → 영업 탭 → 실시간 가용재고 서브탭
    //     - 입고예정 → 입고관리 탭 → 입고예정 서브탭
    //   ★ 2026-05-13 (2차) 사용자 요청 — 도구함에서 삭제:
    //     - 통합엑셀 / 튜토리얼 / 세금계산서 / 배차일정
    //     - 셋업(v1) → 셋업 마법사 v2 단독으로 통합
    //   ★ 2026-05-13 (3차) 사용자 요청 — 대체 가능한 도구 추가 삭제:
    //     - 시스템 상태 → 자동 백업/정합성/에러 로그 카드(설정-데이터 보호)로 대체
    //     - 운영 대시보드 → 대시보드 탭에 KPI 카드(이미 존재)로 대체
    //     - 백업/복구 → 자동 백업 모듈(설정-데이터 보호)로 대체
    //     - 셋업 마법사 → 설정-셋업 서브탭으로 이동
    //   ★ 2026-05-12 구매이력 항목도 메뉴/탭에서 삭제됨
    { id:'erp-aging-fab',  icon:'💰', label:'채권 Aging',    desc:'30/60/90/120일', cat:'비즈니스', api:'aging.open' },

    { id:'erp-mob-fab',    icon:'📱', label:'모바일',        desc:'QR·서명·사진', cat:'모바일·추적', api:'erpMobile.open' },
    { id:'_sn',            icon:'🏷', label:'SN 추적',       desc:'시리얼 단위 이력', cat:'모바일·추적', api:'sn.open' },

    { id:'_migrate',       icon:'🔄', label:'데이터 마이그레이션', desc:'schema 자동 변환·롤백', cat:'운영', api:'erpMigrate.open' }
  ];

  const CAT_ORDER = ['핵심','비즈니스','모바일·추적','운영','도구'];
  const CAT_ICONS = { '핵심':'⭐', '비즈니스':'💼', '모바일·추적':'📱', '운영':'🛠', '도구':'🔧' };

  // ── 스타일 주입 ─────────────────────────────────────
  function _injectStyle() {
    if (document.getElementById('erp-toolbar-style')) return;
    const css = `
      /* 기존 13개 fab 모두 숨김 — toolbar로 진입 통일 */
      #erp-health-fab, #erp-gs-fab, #erp-atp-fab, #erp-aging-fab, #erp-mob-fab,
      #erp-calc-fab, #erp-in-fab, #erp-pur-fab, #erp-dsp-fab,
      #erp-ai-fab, #erp-dv2-fab, #erp-ops-fab, #erp-fb-fab,
      .erp-gs-fab,
      #erp-fabmenu-toggle, #erp-fabmenu-list {
        display: none !important;
      }

      /* ── 우상단 미니바 (자주 쓰는 4개) ─── */
      /* ★ 2026-05-13 erp-top-toolbar 와 겹침 방지 — toptools 컨테이너 내부로 통합 */
      /* ★ 2026-05-13 한글 라벨 표시 (검색·계산기·바로AI·피드백) */
      #erp-minibar {
        display: flex; gap: 4px;
        background: rgba(26,26,46,0.92); padding: 4px;
        border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        pointer-events: auto;
        flex: 0 0 auto;
      }
      /* 컨테이너 밖에 떠 있는 경우(부팅 직후 잠깐) 화면 좌상단으로 빠지지 않도록 */
      body > #erp-minibar {
        position: fixed; top: 8px; right: 210px; z-index: 9050;
      }
      #erp-minibar button {
        position: relative;
        height: 32px; padding: 0 10px;
        border-radius: 6px;
        background: transparent; color: #fff; border: none; cursor: pointer;
        font-size: 0.78em; font-weight: 700;
        transition: background 0.15s;
        display: flex; align-items: center; justify-content: center;
        gap: 5px;
        white-space: nowrap;
      }
      #erp-minibar button .mb-ic { font-size: 15px; line-height: 1; }
      #erp-minibar button .mb-lb { line-height: 1; letter-spacing: -0.2px; }
      #erp-minibar button:hover { background: rgba(255,255,255,0.18); }
      #erp-minibar button .tip {
        position: absolute; top: 38px; right: 0;
        background: #1a1a2e; color: #fff; padding: 3px 8px; border-radius: 4px;
        font-size: 0.86em; white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity 0.15s;
        z-index: 100;
        font-weight: 500;
      }
      #erp-minibar button:hover .tip { opacity: 1; }
      /* 좁은 화면 — 라벨 숨기고 아이콘만 표시 (toptools 컨테이너 wrap 대응) */
      @media (max-width: 900px) {
        #erp-minibar button { padding: 0; width: 32px; }
        #erp-minibar button .mb-lb { display: none; }
      }

      /* ── 우측 하단 Quick Access (작게) ─── */
      #erp-tb-toggle {
        position: fixed; bottom: 18px; right: 18px;
        width: 44px; height: 44px; border-radius: 12px;
        background: linear-gradient(135deg,#1a1a2e,#37474f); color: #fff;
        border: none; cursor: pointer; font-size: 20px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 9100;
        transition: transform 0.18s;
      }
      #erp-tb-toggle:hover { transform: scale(1.08); }
      #erp-tb-toggle.open { transform: rotate(45deg); background: #c62828; }

      /* Quick Access 패널 */
      #erp-tb-panel {
        position: fixed; bottom: 72px; right: 18px;
        width: 380px; max-height: 70vh;
        background: #fff; border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        z-index: 9099; opacity: 0; pointer-events: none;
        transform: translateY(10px);
        transition: opacity 0.15s, transform 0.15s;
        display: flex; flex-direction: column; overflow: hidden;
      }
      #erp-tb-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0); }
      .qa-hd {
        padding: 10px 14px; background: #1a1a2e; color: #fff;
        font-size: 0.86em; font-weight: 700; display: flex; justify-content: space-between;
      }
      .qa-bd { padding: 8px; max-height: 60vh; overflow-y: auto; }
      .qa-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
      .qa-item {
        padding: 8px 4px; border-radius: 7px; background: #fafafa;
        text-align: center; cursor: pointer; font-size: 0.72em;
        transition: all 0.15s;
      }
      .qa-item:hover { background: #fffde7; transform: translateY(-1px); }
      .qa-item .ic { font-size: 18px; display: block; margin-bottom: 2px; }

      /* ── 메인 도구함 탭 패널 ─── */
      #tab-tools .tools-hero {
        background: linear-gradient(135deg, #1a1a2e 0%, #37474f 100%);
        color: #fff; padding: 20px 24px; border-radius: 12px;
        margin-bottom: 18px;
      }
      #tab-tools .tools-hero h2 { margin: 0 0 6px; font-size: 1.2em; font-weight: 700; }
      #tab-tools .tools-hero p { margin: 0; opacity: 0.85; font-size: 0.86em; }
      #tab-tools .tools-search {
        margin-bottom: 18px;
      }
      #tab-tools .tools-search input {
        width: 100%; padding: 12px 16px;
        border: 2px solid #e0e0e0; border-radius: 10px;
        font-size: 0.95em; box-sizing: border-box;
        transition: border 0.15s;
      }
      #tab-tools .tools-search input:focus { outline: none; border-color: #1a1a2e; }
      #tab-tools .cat-section { margin-bottom: 22px; }
      #tab-tools .cat-label {
        font-size: 0.84em; font-weight: 800; color: #555;
        margin-bottom: 10px; padding-bottom: 6px;
        border-bottom: 2px solid #1a1a2e;
        display: flex; align-items: center; gap: 8px;
      }
      #tab-tools .cat-label .count {
        background: #f0f0f0; color: #888; padding: 1px 8px; border-radius: 10px;
        font-size: 0.78em; font-weight: 600;
      }
      #tab-tools .tool-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px;
      }
      #tab-tools .tool-card {
        background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
        padding: 16px; cursor: pointer;
        display: flex; gap: 12px; align-items: center;
        transition: all 0.18s;
      }
      #tab-tools .tool-card:hover {
        border-color: #1a1a2e; transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.1);
      }
      #tab-tools .tool-card .ico {
        width: 44px; height: 44px; border-radius: 10px;
        background: linear-gradient(135deg, #fff3e0, #fce4ec);
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; flex-shrink: 0;
      }
      #tab-tools .tool-card.pinned .ico {
        background: linear-gradient(135deg, #fffde7, #fff3e0);
      }
      #tab-tools .tool-card .meta { flex: 1; min-width: 0; }
      #tab-tools .tool-card .name {
        font-weight: 700; color: #1a1a2e; font-size: 0.92em;
        display: flex; align-items: center; gap: 6px;
      }
      #tab-tools .tool-card .name .pin {
        background: #f9a825; color: #fff; padding: 1px 5px;
        border-radius: 3px; font-size: 0.7em;
      }
      #tab-tools .tool-card .desc {
        font-size: 0.78em; color: #888; margin-top: 2px;
      }
      #tab-tools .tool-card .sc {
        font-size: 0.72em; color: #666;
        background: #f5f5f5; padding: 1px 6px; border-radius: 3px;
        margin-left: auto;
      }
      #tab-tools .empty {
        text-align: center; padding: 40px; color: #bbb;
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-toolbar-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── 좌측 nav에 "도구함" 항목 추가 + 메인 패널 생성 ──
  function _injectNavAndPanel() {
    if (document.getElementById('tab-tools')) return;
    const nav = document.querySelector('nav');
    if (!nav) { setTimeout(_injectNavAndPanel, 300); return; }

    // 1) 좌측 nav에 도구함 추가 (마지막 settings 위에)
    const settingsBtn = nav.querySelector('button[onclick*="settings"]');
    const sep = document.createElement('div');
    sep.className = 'nav-section-label';
    sep.style.cssText = 'padding:8px 14px 3px;font-size:0.66em;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;opacity:0.7;margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);';
    sep.textContent = '도구함';

    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.setAttribute('onclick', "showTab('tools')");
    btn.innerHTML = '<span>🛠</span><span class="nav-label">도구함</span>';

    if (settingsBtn) {
      // settings 위에 삽입
      const settingsLabel = settingsBtn.previousElementSibling;
      if (settingsLabel && settingsLabel.classList.contains('nav-section-label')) {
        nav.insertBefore(sep, settingsLabel);
        nav.insertBefore(btn, settingsLabel);
      } else {
        nav.insertBefore(sep, settingsBtn);
        nav.insertBefore(btn, settingsBtn);
      }
    } else {
      nav.appendChild(sep);
      nav.appendChild(btn);
    }

    // 2) 메인 영역에 tab-panel 생성
    const main = document.querySelector('.main') || document.body;
    const panel = document.createElement('div');
    panel.id = 'tab-tools';
    panel.className = 'tab-panel';
    panel.innerHTML = `
      <div class="tools-hero">
        <h2>🛠 도구함</h2>
        <p>핵심 도구 통합 — 클릭하면 모달이 열립니다 · 자주 쓰는 4개는 우상단 미니바 / Alt+T로 빠른 패널</p>
      </div>
      <div class="tools-search">
        <input id="tools-search" placeholder="🔎 도구 검색 (예: 채권, ATP, 계산기, AI)" autocomplete="off">
      </div>
      <div id="tools-bd"></div>`;
    main.appendChild(panel);

    document.getElementById('tools-search').addEventListener('input', _renderToolsTab);
    _renderToolsTab();
  }

  // ── 도구함 탭 렌더 ──────────────────────────────────
  function _renderToolsTab() {
    const bd = document.getElementById('tools-bd');
    if (!bd) return;
    const q = (document.getElementById('tools-search')?.value || '').trim().toLowerCase();
    const filtered = q
      ? TOOLS.filter(t => (t.label+' '+t.desc+' '+t.cat).toLowerCase().includes(q))
      : TOOLS;

    if (!filtered.length) {
      bd.innerHTML = '<div class="empty">검색 결과 없음 — 다른 키워드로 시도</div>';
      return;
    }
    const groups = {};
    filtered.forEach(t => { (groups[t.cat] = groups[t.cat] || []).push(t); });

    bd.innerHTML = CAT_ORDER.filter(c => groups[c]).map(c => `
      <div class="cat-section">
        <div class="cat-label">
          ${CAT_ICONS[c]||'•'} ${c}
          <span class="count">${groups[c].length}</span>
        </div>
        <div class="tool-grid">
          ${groups[c].map(t => `
            <div class="tool-card ${t.pinned?'pinned':''}" onclick="erpToolbar.exec('${t.id}')">
              <div class="ico">${t.icon}</div>
              <div class="meta">
                <div class="name">${t.label}${t.pinned?'<span class="pin">PIN</span>':''}</div>
                <div class="desc">${t.desc||''}</div>
              </div>
              ${t.shortcut?`<span class="sc">${t.shortcut}</span>`:''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  // ── 우상단 미니바 ───────────────────────────────────
  //   ★ 2026-05-13 한글 라벨 추가 — 아이콘 + short label (검색·계산기·바로AI·피드백)
  function _buildMinibar() {
    if (document.getElementById('erp-minibar')) return;
    const mb = document.createElement('div');
    mb.id = 'erp-minibar';
    const pinned = TOOLS.filter(t => t.pinned);
    mb.innerHTML = pinned.map(t => `
      <button onclick="erpToolbar.exec('${t.id}')" title="${t.label}">
        <span class="mb-ic">${t.icon}</span><span class="mb-lb">${t.short||t.label}</span>
        <span class="tip">${t.label}${t.shortcut?' · '+t.shortcut:''}</span>
      </button>
    `).join('');
    document.body.appendChild(mb);
  }

  // ── 우하단 Quick Access ────────────────────────────
  function _buildQuickAccess() {
    if (document.getElementById('erp-tb-toggle')) return;
    const toggle = document.createElement('button');
    toggle.id = 'erp-tb-toggle';
    toggle.title = 'Quick Access (Alt+T)';
    toggle.textContent = '⊞';
    toggle.onclick = togglePanel;
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'erp-tb-panel';
    panel.innerHTML = `
      <div class="qa-hd">
        <span>⊞ Quick Access</span>
        <span style="opacity:0.7;font-size:0.86em;font-weight:400;">Alt+T · Esc</span>
      </div>
      <div class="qa-bd">
        <div class="qa-grid">
          ${TOOLS.map(t => `
            <div class="qa-item" onclick="erpToolbar.exec('${t.id}');erpToolbar.close()">
              <span class="ic">${t.icon}</span>
              ${t.label}
            </div>
          `).join('')}
        </div>
      </div>`;
    document.body.appendChild(panel);

    // 키보드
    document.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        togglePanel();
      }
      if (e.key === 'Escape' && document.getElementById('erp-tb-panel').classList.contains('open')) {
        close();
      }
    });
    // 외부 클릭
    document.addEventListener('click', e => {
      const tg = document.getElementById('erp-tb-toggle');
      const pn = document.getElementById('erp-tb-panel');
      if (!tg || !pn || !pn.classList.contains('open')) return;
      if (tg.contains(e.target) || pn.contains(e.target)) return;
      close();
    });
  }

  function togglePanel() {
    const pn = document.getElementById('erp-tb-panel');
    if (!pn) return;
    if (pn.classList.contains('open')) close();
    else open();
  }

  function open() {
    document.getElementById('erp-tb-toggle')?.classList.add('open');
    document.getElementById('erp-tb-panel')?.classList.add('open');
  }
  function close() {
    document.getElementById('erp-tb-toggle')?.classList.remove('open');
    document.getElementById('erp-tb-panel')?.classList.remove('open');
  }

  // ── 도구 실행 (검색 오류 회피 — fab.click 대신 API 직접 호출) ─
  function exec(id) {
    const tool = TOOLS.find(t => t.id === id);
    if (!tool) { console.warn('[ERP-TB] 미정의 도구', id); return; }

    // 1) API 경로가 있으면 직접 호출 (가장 안정적)
    if (tool.api) {
      try {
        const path = tool.api.split('.');
        let fn = window;
        for (const p of path) { fn = fn ? fn[p] : null; }
        if (typeof fn === 'function') { fn(); return; }
      } catch(e) { console.warn('[ERP-TB] API 직접 호출 실패', tool.api, e); }
    }
    // 2) 기존 fab의 click fallback
    const fab = document.getElementById(id);
    if (fab && typeof fab.click === 'function') {
      // hidden 상태에서도 click 이벤트는 발화됨
      fab.click();
      return;
    }
    alert('해당 도구를 로드할 수 없습니다: ' + tool.label + '\n페이지 새로고침 후 다시 시도하세요.');
  }

  // ── 공개 API ────────────────────────────────────────
  window.erpToolbar = {
    open, close, toggle: togglePanel, exec,
    tools: () => TOOLS.slice(),
    refresh: _renderToolsTab
  };

  // ★ 2026-05 추가: 13개 FAB DOM 정리 (dead weight 제거)
  //   각 모듈은 자기 FAB 을 body 에 append 하는데, toolbar.js 가 CSS 로
  //   숨기는 방식이었음. 노드는 여전히 DOM 에 남아 있으며 일부 모듈이
  //   click 이벤트·MutationObserver 등을 붙여 메모리·CPU 낭비.
  //   이제 늦게 boot 하는 toolbar 가 한 번에 제거 + 이후 생성도 자동 제거.
  const FAB_IDS = [
    'erp-health-fab','erp-gs-fab','erp-atp-fab','erp-aging-fab','erp-mob-fab',
    'erp-calc-fab','erp-in-fab','erp-pur-fab','erp-dsp-fab',
    'erp-ai-fab','erp-dv2-fab','erp-ops-fab','erp-fb-fab',
    'erp-fabmenu-toggle','erp-fabmenu-list',
    // ★ 2026-05-13 삭제된 도구의 FAB · 모달 흔적까지 제거
    'erp-dispatch-fab','erp-tax-fab','erp-excel-fab'
  ];
  function _removeFabs() {
    let n = 0;
    FAB_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.remove(); n++; }
    });
    // 동적 생성 fab(.erp-gs-fab class 등)도 제거
    document.querySelectorAll('.erp-gs-fab').forEach(el => { el.remove(); n++; });
    return n;
  }
  function _watchFabs() {
    // 이후에 모듈이 생성하는 FAB 도 즉시 제거
    if (window.__erpFabObserver) return;
    const obs = new MutationObserver(records => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (FAB_IDS.indexOf(node.id) >= 0 || node.classList?.contains('erp-gs-fab')) {
            node.remove();
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });
    window.__erpFabObserver = obs;
  }

  function boot() {
    _injectStyle();
    setTimeout(() => {
      // [v3] 도구함 nav 항목·메인 패널 제거 — 각 탭에 분산 inject (tools_layout.js)
      // _injectNavAndPanel();   // 비활성화
      _buildMinibar();
      _buildQuickAccess();
      // ★ FAB 정리 — 모든 모듈이 boot 한 후
      const removed = _removeFabs();
      if (removed > 0) console.log('[ERP-TOOLBAR] 사용 안 하는 FAB ' + removed + '개 제거');
      _watchFabs();
    }, 800);
    // 늦게 boot 하는 모듈 대비 — 5초 후 한 번 더 정리
    setTimeout(_removeFabs, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-TOOLBAR] 도구함 메인 탭 활성 — 좌측 nav "🛠 도구함" 또는 Alt+T (Quick Access)');
})();
