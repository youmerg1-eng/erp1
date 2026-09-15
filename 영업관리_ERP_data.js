// =====================================================
//  DATA & CONFIG
// =====================================================
const KEYS = {
  GS_URL: 'erp_gs_url', RAW: 'erp_raw', LOCAL: 'erp_local',
  INVENTORY: 'erp_inventory', DELIVERY: 'erp_delivery',
  SETTINGS: 'erp_settings', FILES: 'erp_files',
  PRODUCT_MASTER: 'erp_product_master'
};

// Column indices (0-based) matching GS columns A~AD
const C = {
  담당자:0,pjNo:1,수주일:2,고객사:3,제품군:4,제조사:5,매입No:6,모델명:7,
  제품용량:8,수량:9,수주용량kW:10,제품단가:11,수주총액:12,총금액VAT:13,
  매입사:14,매입단가:15,매입총액:16,영업이익:17,영업이익률:18,
  출고요청일:19,납품일:20,허가증:21,FD성적서:22,인증서:23,사용전검사:24,
  발전소명:25,납품주소:26,인수담당자:27,비고:28,수금조건:29
};

const HEADER_NAMES = [
  '담당자','PJ NO','수주일','고객사','제품군','제조사','매입NO','모델명',
  '제품용량(W)','수량','수주용량(kW)','제품단가(원)','수주총액(원)','총금액(VAT포함)',
  '매입사','매입단가','매입총액(원)','영업이익(원)','영업이익률(%)',
  '출고요청일','납품일','허가증','FD성적서','인증서','사용전검사일정',
  '발전소명','납품주소','인수담당자','비고','수금조건'
];

let gsUrl = '';
let rawData = []; // array of objects from GS (keyed by header name)
let localMeta = {}; // { _id: { status, notes, deliveryOrderId, ... } }
let inventoryData = []; // inbound/outbound records
let deliveryOrders = []; // created delivery orders
let appSettings = { companyName: '', autoSync: 0 };
let autoSyncTimer = null;
let currentDetailPjNo = null;
let filesData = {};
let productMaster = {}; // { modelName: { watt, mfr } } — 제품 마스터 (1순위 용량 기준)

function genId() {
  return 'R-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

function loadAllLocal() {
  // ★ 2026-05 변경: 각 키를 독립적으로 파싱(개별 try/catch).
  //   이전 구현은 하나의 키가 손상되면 전체 로드가 중단되어 화면이 비어 보이고,
  //   사용자가 새로 입력하면 saveLocal()이 정상 키까지 빈 값으로 덮어써
  //   데이터가 영구 소실되는 위험이 있었음.
  //   이제는 손상된 키만 빈 기본값으로 폴백하고 콘솔에 경고 + 자동 백업 시도.
  gsUrl = localStorage.getItem(KEYS.GS_URL) || '';

  const _safeParse = (key, fallback, label) => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error(`[loadAllLocal] ${label} (${key}) 파싱 실패 — 손상된 데이터 백업 후 기본값 사용`, e);
      // 손상된 원본을 보존 — 복구 시 참조 가능
      try {
        const ts = new Date().toISOString().replace(/[:.]/g,'-');
        localStorage.setItem(`${key}_corrupted_${ts}`, raw);
      } catch (e2) {
        // quota 초과 시도 무시 (정상 백업이 우선)
      }
      // 사용자에게 알림 (setBanner 가능하면 표시)
      if (typeof setBanner === 'function') {
        setTimeout(() => setBanner('warn',
          `⚠️ ${label} 데이터가 손상되어 기본값으로 초기화했습니다. 손상본은 erp_*_corrupted_* 키에 보존됨. 복원 도구 사용 권장.`), 1500);
      }
      return fallback;
    }
  };

  rawData         = _safeParse(KEYS.RAW,            [],                                  '수주 원본(rawData)');
  localMeta       = _safeParse(KEYS.LOCAL,          {},                                  '메타데이터(localMeta)');
  inventoryData   = _safeParse(KEYS.INVENTORY,      [],                                  '입출고 이력(inventoryData)');
  deliveryOrders  = _safeParse(KEYS.DELIVERY,       [],                                  '출고지시서(deliveryOrders)');
  appSettings     = _safeParse(KEYS.SETTINGS,       { companyName:'', autoSync:0 },       '환경설정(appSettings)');
  filesData       = _safeParse(KEYS.FILES,          {},                                  '첨부파일(filesData)');
  productMaster   = _safeParse(KEYS.PRODUCT_MASTER, {},                                  '제품 마스터(productMaster)');

  // 타입 가드 — JSON.parse 결과가 예상 타입이 아니면 기본값으로 폴백 (예: null, 객체↔배열 혼동)
  if (!Array.isArray(rawData))        { console.warn('[loadAllLocal] rawData가 배열이 아님 → []'); rawData = []; }
  if (!Array.isArray(inventoryData))  { console.warn('[loadAllLocal] inventoryData가 배열이 아님 → []'); inventoryData = []; }
  if (!Array.isArray(deliveryOrders)) { console.warn('[loadAllLocal] deliveryOrders가 배열이 아님 → []'); deliveryOrders = []; }
  if (!localMeta || typeof localMeta !== 'object') { console.warn('[loadAllLocal] localMeta가 객체가 아님 → {}'); localMeta = {}; }
  if (!filesData || typeof filesData !== 'object') { console.warn('[loadAllLocal] filesData가 객체가 아님 → {}'); filesData = {}; }
  if (!productMaster || typeof productMaster !== 'object') { console.warn('[loadAllLocal] productMaster가 객체가 아님 → {}'); productMaster = {}; }
  if (!appSettings || typeof appSettings !== 'object') { console.warn('[loadAllLocal] appSettings가 객체가 아님 → 기본값'); appSettings = { companyName:'', autoSync:0 }; }

  // Assign _id to rows that don't have one
  let needsSave = false;
  rawData.forEach(row => {
    if (!row._id) { row._id = genId(); needsSave = true; }
  });

  if (needsSave) {
    const idSet = new Set(rawData.map(r => r._id));
    // Migrate localMeta: copy pjNo-keyed entries to _id-keyed entries
    rawData.forEach(row => {
      const pjNo = String(row['PJ NO'] || row[1] || '').trim();
      if (pjNo && localMeta[pjNo] && !localMeta[row._id]) {
        localMeta[row._id] = { ...localMeta[pjNo] };
      }
    });
    // Remove old pjNo-keyed entries that are not valid _id keys
    Object.keys(localMeta).forEach(k => {
      if (!idSet.has(k)) delete localMeta[k];
    });
    // Migrate filesData: pjNo-keyed → first matching row's _id
    const pjNoToFirstId = {};
    rawData.forEach(row => {
      const pjNo = String(row['PJ NO'] || row[1] || '').trim();
      if (pjNo && !pjNoToFirstId[pjNo]) pjNoToFirstId[pjNo] = row._id;
    });
    Object.keys(filesData).forEach(k => {
      if (!idSet.has(k)) {
        if (pjNoToFirstId[k]) { filesData[pjNoToFirstId[k]] = filesData[k]; }
        delete filesData[k];
      }
    });
    localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));
    localStorage.setItem(KEYS.LOCAL, JSON.stringify(localMeta));
    localStorage.setItem(KEYS.FILES, JSON.stringify(filesData));
  }
}

function saveLocal() {
  localStorage.setItem(KEYS.LOCAL, JSON.stringify(localMeta));
  localStorage.setItem(KEYS.INVENTORY, JSON.stringify(inventoryData));
  localStorage.setItem(KEYS.DELIVERY, JSON.stringify(deliveryOrders));
  // ★ 2026-05 추가: getEnriched 캐시 무효화 (메타·인벤·출고지시서 변경 시)
  if (typeof _bumpEnrichedTs === 'function') _bumpEnrichedTs();
}

function saveFilesLocal() {
  try {
    localStorage.setItem(KEYS.FILES, JSON.stringify(filesData));
  } catch(e) {
    alert('파일 저장 실패: 저장 공간이 부족합니다. 일부 파일을 삭제해주세요.');
  }
}

function saveSettings() {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(appSettings));
}

function saveGSUrl() {
  // Delegated to 설정.js → saveGSUrlSettings()
  if (typeof saveGSUrlSettings === 'function') saveGSUrlSettings();
}

function loadSettingsUI() {
  // Delegated to 설정.js → renderSettingsTab()
}

function setupAutoSync(sec) {
  autoSyncTimer = setInterval(() => loadFromGS(), sec * 1000);
}

// =====================================================
//  GOOGLE SHEETS INTEGRATION
// =====================================================
async function loadFromGS() {
  if (!gsUrl) { setBanner('warn','⚠️ Apps Script URL이 설정되지 않았습니다.'); return; }
  setBanner('info','🔄 구글 시트에서 데이터 불러오는 중...');
  try {
    const res = await fetch(gsUrl + '?action=read', { redirect: 'follow' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '알 수 없는 오류');
    // json.data = array of objects with column header keys
    rawData = json.data || [];
    localStorage.setItem(KEYS.RAW, JSON.stringify(rawData));
    const now = new Date();
    localStorage.setItem('erp_lastSync', now.toISOString());
    document.getElementById('lastSyncLabel').textContent = '마지막 동기화: ' + now.toLocaleTimeString('ko-KR');
    setBanner('ok', `✅ ${rawData.length}건 로드 완료 (${now.toLocaleTimeString('ko-KR')})`);
    document.getElementById('syncCount').textContent = rawData.length + '건';
    refreshAllTabs();
  } catch(e) {
    setBanner('err', '❌ 로드 실패: ' + e.message + ' — 설정에서 URL과 배포 설정을 확인하세요.');
  }
}

async function testGSConnection() {
  const url = document.getElementById('gs-url-input').value.trim();
  if (!url) { showInlineMsg('gsTestResult','URL을 입력하세요.','warn'); return; }
  showInlineMsg('gsTestResult','🔄 연결 테스트 중...','info');
  try {
    const res = await fetch(url + '?action=ping', { redirect: 'follow' });
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
//  BACKUP / RESTORE
// =====================================================
function exportBackup() {
  const backup = { rawData, localMeta, inventoryData, deliveryOrders, appSettings, gsUrl, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ERP_백업_${todayStr()}.json`; a.click();
}

function importBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const b = JSON.parse(evt.target.result);
      if (b.rawData) { rawData = b.rawData; localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); }
      if (b.localMeta) { localMeta = b.localMeta; }
      if (b.inventoryData) { inventoryData = b.inventoryData; }
      if (b.deliveryOrders) { deliveryOrders = b.deliveryOrders; }
      if (b.appSettings) { appSettings = b.appSettings; }
      if (b.gsUrl) { gsUrl = b.gsUrl; localStorage.setItem(KEYS.GS_URL, gsUrl); }
      saveLocal(); saveSettings();
      refreshAllTabs();
      setBanner('ok','✅ 백업 복원 완료. 데이터 ' + rawData.length + '건');
      alert('복원 완료!');
    } catch(err) { alert('복원 실패: ' + err.message); }
  };
  reader.readAsText(file);
}

function resetLocalData() {
  localMeta = {}; inventoryData = []; deliveryOrders = [];
  saveLocal(); refreshAllTabs();
  setBanner('ok','✅ 로컬 데이터 초기화 완료');
}

function runFullDiagnostics() {}
function openLocalServer() {}
function importFromPaste() {}
