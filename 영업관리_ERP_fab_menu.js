// =====================================================
//  FAB MENU CONSOLIDATION — 모바일 좁은 화면 대응
//  [PATCH-I]
//
//  데스크탑 (>= 768px): 기존 5개 fab 그대로 노출
//  모바일 (<  768px):
//    - 5개 fab 모두 숨김
//    - 우측 하단 햄버거 fab(☰) 1개만 노출
//    - 클릭 시 위로 펼쳐지며 5개 액션 라벨과 함께 표시
//
//  기존 fab 코드 한 줄도 수정하지 않음 — DOM 검색 + 미디어쿼리 이벤트 기반.
// =====================================================
(function() {
  'use strict';

  const FAB_IDS = ['erp-health-fab', 'erp-gs-fab', 'erp-atp-fab', 'erp-aging-fab', 'erp-mob-fab', 'erp-calc-fab', 'erp-in-fab', 'erp-pur-fab', 'erp-dsp-fab', 'erp-ai-fab', 'erp-dv2-fab', 'erp-ops-fab', 'erp-fb-fab'];
  const FAB_META = {
    'erp-health-fab': { label: '시스템 상태',     color: '#1a1a2e' },
    'erp-gs-fab':     { label: '글로벌 검색',     color: '#1565c0' },
    'erp-atp-fab':    { label: 'ATP 가용재고',    color: '#27ae60' },
    'erp-aging-fab':  { label: '채권 Aging',     color: '#e65100' },
    'erp-mob-fab':    { label: '모바일/QR/서명',  color: '#7b1fa2' },
    'erp-calc-fab':   { label: '용량 계산기',     color: '#f9a825' },
    'erp-in-fab':     { label: '입고예정 ETA',    color: '#1976d2' },
    'erp-pur-fab':    { label: '구매이력',        color: '#5d4037' },
    'erp-dsp-fab':    { label: '배차/일정',       color: '#0d47a1' },
    'erp-ai-fab':     { label: 'AI 어시스턴트',   color: '#673ab7' },
    'erp-dv2-fab':    { label: '대시보드 v2',     color: '#00897b' },
    'erp-ops-fab':    { label: '운영 대시보드',   color: '#37474f' },
    'erp-fb-fab':     { label: '피드백',          color: '#ff9800' }
  };

  function _injectStyles() {
    if (document.getElementById('erp-fabmenu-style')) return;
    const css = `
      @media (max-width: 768px) {
        #erp-health-fab, #erp-gs-fab, #erp-atp-fab, #erp-aging-fab, #erp-mob-fab,
        #erp-calc-fab, #erp-in-fab, #erp-pur-fab, #erp-dsp-fab,
        #erp-ai-fab, #erp-dv2-fab, #erp-ops-fab, #erp-fb-fab,
        .erp-gs-fab {
          display: none !important;
        }
      }
      @media (min-width: 769px) {
        #erp-fabmenu-toggle, #erp-fabmenu-list { display: none !important; }
      }
      #erp-fabmenu-toggle {
        position:fixed; bottom:18px; right:18px;
        width:52px; height:52px; border-radius:50%;
        background:#1a1a2e; color:#fff; border:none; cursor:pointer;
        font-size:22px; z-index:9100;
        box-shadow:0 4px 16px rgba(0,0,0,0.3);
        transition:transform .2s ease;
      }
      #erp-fabmenu-toggle.open { transform:rotate(45deg); }
      #erp-fabmenu-list {
        position:fixed; bottom:80px; right:14px;
        z-index:9099;
        display:flex; flex-direction:column-reverse; gap:8px;
        opacity:0; pointer-events:none;
        transform:translateY(10px);
        transition:opacity .18s ease, transform .18s ease;
      }
      #erp-fabmenu-list.open { opacity:1; pointer-events:auto; transform:translateY(0); }
      .erp-fabmenu-item {
        display:flex; align-items:center; gap:10px;
        background:transparent; border:none; cursor:pointer;
        padding:0; outline:none;
      }
      .erp-fabmenu-item .lbl {
        background:#1a1a2e; color:#fff;
        padding:6px 12px; border-radius:6px;
        font-size:0.82em; font-weight:600;
        box-shadow:0 2px 8px rgba(0,0,0,0.2);
      }
      .erp-fabmenu-item .ico {
        width:46px; height:46px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        color:#fff; font-size:18px;
        box-shadow:0 3px 10px rgba(0,0,0,0.25);
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-fabmenu-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function _build() {
    if (document.getElementById('erp-fabmenu-toggle')) return;

    const toggle = document.createElement('button');
    toggle.id = 'erp-fabmenu-toggle';
    toggle.title = '메뉴 (모바일 통합)';
    toggle.textContent = '＋';
    toggle.onclick = () => {
      toggle.classList.toggle('open');
      document.getElementById('erp-fabmenu-list')?.classList.toggle('open');
      // 토글 시 사용 가능한 fab만 다시 빌드
      if (toggle.classList.contains('open')) _renderList();
    };
    document.body.appendChild(toggle);

    const list = document.createElement('div');
    list.id = 'erp-fabmenu-list';
    document.body.appendChild(list);

    // 외부 클릭 시 닫기
    document.addEventListener('click', e => {
      if (!toggle.classList.contains('open')) return;
      if (e.target === toggle || toggle.contains(e.target)) return;
      if (list.contains(e.target)) return;
      toggle.classList.remove('open');
      list.classList.remove('open');
    });
  }

  function _renderList() {
    const list = document.getElementById('erp-fabmenu-list');
    if (!list) return;

    const items = [];
    FAB_IDS.forEach(id => {
      const fab = document.getElementById(id);
      if (!fab) return;   // 모듈 미로드 시 스킵
      const m = FAB_META[id];
      const icon = fab.textContent || '?';
      items.push({ id, icon, label: m.label, color: m.color });
    });

    list.innerHTML = items.map(it => `
      <button class="erp-fabmenu-item" data-target="${it.id}">
        <span class="lbl">${it.label}</span>
        <span class="ico" style="background:${it.color};">${it.icon}</span>
      </button>
    `).join('');

    list.querySelectorAll('.erp-fabmenu-item').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.target;
        const target = document.getElementById(id);
        if (target && target.click) {
          // 임시로 보이게 한 후 클릭 (display:none이면 click 효과 X 일부 브라우저)
          // → CSS에서 모바일 시 display:none이지만 click 이벤트 자체는 동작
          target.click();
        }
        document.getElementById('erp-fabmenu-toggle')?.classList.remove('open');
        list.classList.remove('open');
      };
    });
  }

  function boot() {
    _injectStyles();
    // 다른 모듈의 fab 로드 대기
    setTimeout(_build, 1500);
    setTimeout(_build, 3000);   // 안전망
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-FABMENU] 모바일 통합 메뉴 활성 (768px 이하에서 햄버거 토글)');
})();
