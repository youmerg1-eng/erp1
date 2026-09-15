// =====================================================
//  SETTINGS TABS — 설정 탭 정리 (Phase 2 후속)
//
//  6개 섹션으로 그룹화:
//   1. 회사 · 기본 정보 (회사명, 결재 라인)
//   2. 제품 마스터
//   3. 데이터 보호 (자동 백업, 정합성, 에러 로그)
//   4. 클라우드 연동 (Google Sheets URL, 동기화)
//   5. 권한 관리 (역할별 권한, 고객사 마스터+신용한도, 권한 변경 이력)
//   6. 셋업 마법사 (5단계 신규 사용자 가이드)
//
//  각 모듈의 자동 주입 카드를 올바른 섹션으로 라우팅
// =====================================================
(function() {
  'use strict';

  const SECTIONS = ['company','product','safety','cloud','perm','setup'];
  const ACTIVE_KEY = 'erp_settings_section';

  // ── 섹션 전환 ───────────────────────────────────────
  function setSettingsSection(key) {
    if (!SECTIONS.includes(key)) key = 'company';
    SECTIONS.forEach(s => {
      const pane = document.getElementById('set-section-' + s);
      if (pane) pane.style.display = s === key ? '' : 'none';
      const btn = document.getElementById('set-nav-' + s);
      if (btn) {
        if (s === key) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
    try { localStorage.setItem(ACTIVE_KEY, key); } catch(e) {}
    // 섹션 진입 시 해당 모듈 카드 갱신 트리거
    _refreshSection(key);
  }
  window.setSettingsSection = setSettingsSection;

  function _refreshSection(key) {
    if (key === 'safety') {
      // 자동 백업·정합성·에러 로그 카드들을 safety 섹션으로 모음
      _gatherCardsToSection('safety', ['autobackup-status-card','integrity-report-card','errorlog-stats-card']);
      _removePlaceholder('set-safety-placeholder');
    } else if (key === 'cloud') {
      // 동기화 카드만 cloud 섹션으로
      _gatherCardsToSection('cloud', ['syncstab-status-card']);
    } else if (key === 'perm') {
      // erpAuth 의 권한 매트릭스 + 고객사 마스터 + 권한 변경 이력 모두 perm 섹션으로
      _gatherPermSection();
      _removePlaceholder('set-perm-placeholder');
    } else if (key === 'setup') {
      // 셋업 마법사 — 진행 상태 표시
      _updateSetupStatus();
    }
  }

  function _gatherCardsToSection(sectionKey, cardIds) {
    const section = document.getElementById('set-section-' + sectionKey);
    if (!section) return;
    cardIds.forEach(cardId => {
      const card = document.getElementById(cardId)?.closest('.card');
      if (card && card.parentNode !== section) {
        section.appendChild(card);
      }
    });
  }

  // ★ 2026-05-13 권한관리 섹션에 모아야 할 요소 ID
  //   - auth-section: erpAuth 의 역할별 권한 매트릭스
  //   - cm-section: 고객사 마스터 + 신용한도 (customer.js)
  //   - auth-audit-section: 권한 변경 이력 (auth_audit.js)
  const PERM_SECTION_IDS = ['auth-section','cm-section','auth-audit-section'];

  function _gatherPermSection() {
    const section = document.getElementById('set-section-perm');
    if (!section) return;
    PERM_SECTION_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== section) {
        section.appendChild(el);
      }
    });
  }

  function _updateSetupStatus() {
    const el = document.getElementById('setup-wizard-status');
    if (!el) return;
    try {
      if (window.erpSetupV2 && typeof window.erpSetupV2.isComplete === 'function') {
        const done = window.erpSetupV2.isComplete();
        if (done) {
          el.innerHTML = '<span style="color:#27ae60;font-weight:700;">✅ 셋업 완료</span> — 필요 시 마법사를 다시 열어 단계별로 수정할 수 있습니다.';
        } else {
          el.innerHTML = '<span style="color:#e65100;font-weight:700;">⚠ 셋업 미완료</span> — 권장 5단계를 모두 마치세요.';
        }
      } else {
        el.textContent = '셋업 마법사 모듈 로드 중...';
      }
    } catch(e) {
      el.textContent = '';
    }
  }

  function _removePlaceholder(id) {
    const ph = document.getElementById(id);
    if (ph) ph.style.display = 'none';
  }

  // ── 모듈 카드 자동 정리 (1초 뒤 + 주기적) ───────────
  function _autoOrganize() {
    // 모든 모듈이 동적으로 카드를 주입하므로 주기적으로 재정렬
    _gatherCardsToSection('safety', ['autobackup-status-card','integrity-report-card','errorlog-stats-card']);
    _gatherCardsToSection('cloud', ['syncstab-status-card']);
    _gatherPermSection();

    // 카드들이 들어왔으면 placeholder 숨김
    const safetySection = document.getElementById('set-section-safety');
    if (safetySection && safetySection.querySelector('.card')) _removePlaceholder('set-safety-placeholder');
    const permSection = document.getElementById('set-section-perm');
    if (permSection && (permSection.querySelector('#auth-section, .card, #cm-section, #auth-audit-section'))) {
      _removePlaceholder('set-perm-placeholder');
    }
  }

  // ── 부팅 ────────────────────────────────────────────
  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__settingsTabsHooked) return;
    const orig = window.showTab;
    window.showTab = function(id) {
      const r = orig.apply(this, arguments);
      if (id === 'settings') {
        // 페이지 진입 후 단계적으로 카드 정리 (모듈 부팅 타이밍 다름)
        setTimeout(_autoOrganize, 400);
        setTimeout(_autoOrganize, 1200);
        setTimeout(_autoOrganize, 2500);
        setTimeout(_autoOrganize, 5000);
        // 마지막 선택 섹션 복원
        const saved = localStorage.getItem(ACTIVE_KEY) || 'company';
        setTimeout(() => setSettingsSection(saved), 600);
      }
      return r;
    };
    window.showTab.__settingsTabsHooked = true;
  }

  function boot() {
    _hookShowTab();
    // 첫 진입이 설정 탭이면 즉시 적용
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-settings') {
        setTimeout(_autoOrganize, 800);
        setTimeout(_autoOrganize, 2000);
        const saved = localStorage.getItem(ACTIVE_KEY) || 'company';
        setTimeout(() => setSettingsSection(saved), 1000);
      }
    }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SETTINGS-TABS] 설정 탭 정리 활성 — setSettingsSection(key)');
})();
