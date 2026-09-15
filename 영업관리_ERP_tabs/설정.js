// =====================================================
//  설정 탭 (Settings Tab)
// =====================================================

function renderSettingsTab() {
  renderProductMasterTable();
  if (window.whSetting && typeof whSetting.render === 'function') { try { whSetting.render(); } catch(e) { console.warn('[설정] 창고 마스터 렌더 실패:', e); } }
  loadSettingsUI();
}

// =====================================================
//  구글 시트 설정
// =====================================================
function saveGSUrlSettings() {
  const url = (document.getElementById('gs-url-input')?.value || '').trim();
  gsUrl = url;
  localStorage.setItem(KEYS.GS_URL, gsUrl);
  showInlineMsg('gsTestResult', '✅ URL이 저장되었습니다.', 'ok');
}

async function testGSConnectionSettings() {
  const url = (document.getElementById('gs-url-input')?.value || '').trim();
  if (!url) { showInlineMsg('gsTestResult', 'URL을 입력하세요.', 'warn'); return; }
  showInlineMsg('gsTestResult', '🔄 연결 테스트 중...', 'info');
  try {
    const res  = await fetch(url + '?action=ping', { redirect: 'follow' });
    const json = await res.json();
    if (json.success) {
      showInlineMsg('gsTestResult', `✅ 연결 성공! 시트 행 수: ${json.rows}건. "${json.message}"`, 'ok');
    } else {
      showInlineMsg('gsTestResult', '❌ ' + json.error, 'danger');
    }
  } catch(e) {
    showInlineMsg('gsTestResult', '❌ 연결 실패: ' + e.message, 'danger');
  }
}

// =====================================================
//  회사 / 앱 설정
// =====================================================
function loadSettingsUI() {
  const gsEl = document.getElementById('gs-url-input');
  if (gsEl) gsEl.value = gsUrl || '';
  const cnEl = document.getElementById('company-name-input');
  if (cnEl) cnEl.value = appSettings.companyName || '';
  const asEl = document.getElementById('auto-sync-input');
  if (asEl) asEl.value = appSettings.autoSync || 0;
  // 출고지시서 결재 라인 기본값
  const dmEl = document.getElementById('default-manager-input');
  if (dmEl) dmEl.value = appSettings.defaultManager || '';
  const daEl = document.getElementById('default-approver-input');
  if (daEl) daEl.value = appSettings.defaultApprover || '';
  // ★ 2026-05-13 수정 권한은 시스템 관리자 → 추가 권한 플래그 (수정 권한 컬럼) 으로 이동됨
  //   설정 탭의 개별 토글은 제거됨. 호환성 유지를 위해 element 가 있으면 체크 상태만 반영.
  const permEl = document.getElementById('perm-edit-input');
  if (permEl) permEl.checked = (typeof canEdit === 'function') ? canEdit() : true;
}

function saveCompanySettings() {
  const cn = (document.getElementById('company-name-input')?.value || '').trim();
  const as = parseInt(document.getElementById('auto-sync-input')?.value) || 0;
  const dm = (document.getElementById('default-manager-input')?.value || '').trim();
  const da = (document.getElementById('default-approver-input')?.value || '').trim();
  appSettings.companyName = cn;
  appSettings.autoSync = as;
  appSettings.defaultManager = dm;
  appSettings.defaultApprover = da;
  saveSettings();
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  if (typeof setupAutoSync === 'function' && as > 0) setupAutoSync(as);
  setBanner('ok', `✅ 설정 저장 완료${dm?' · 담당자 '+dm:''}${da?' · 승인자 '+da:''}`);
}

// =====================================================
//  제품 마스터 (product master) — moved here from utils.js
// =====================================================
// Note: saveProductMaster / deleteProductMaster / renderProductMasterTable
// remain in utils.js for compatibility.
// This file provides the settings tab rendering wrapper.
