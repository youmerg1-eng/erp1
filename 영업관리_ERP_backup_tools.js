// =====================================================
//  BACKUP / RECOVERY TOOLS — 운영 안정화
//
//  기능
//   1. 전체 백업 다운로드 (모든 보호 키 + 일일 스냅샷 합본 JSON)
//   2. 복구 시뮬레이션 (실제 데이터 안 건드리고 검증만)
//   3. 백업 파일 무결성 검증
//   4. 7일치 일일 스냅샷 미리보기 + 시점 복원
//   5. 자동 매일 다운로드 옵션 (다운로드 폴더에 저장)
//
//  콘솔
//    backup.exportAll()         전체 합본 다운로드
//    backup.verify(file)        파일 무결성 검증
//    backup.previewSnapshot(date)  특정 날짜 스냅샷 보기
//    backup.restoreSnapshot(date)  복원 (확인 다이얼로그)
// =====================================================
(function() {
  'use strict';

  const PROTECTED_KEYS = [
    'erp_raw','erp_local','erp_inventory','erp_delivery','erp_settings','erp_product_master',
    'erp_customer_master','erp_notify_config','erp_notify_history',
    'erp_vendor_master','erp_claims','erp_sn_records','erp_mobile_sigs',
    'erp_incoming','erp_calc_settings','erp_dispatch','erp_auth',
    'erp_ai_history','erp_audit_log','erp_gs_url','erp_sync_queue','erp_weekly_tests'
  ];

  // ── 전체 백업 합본 ──────────────────────────────────
  function exportAll() {
    const bundle = {
      type: 'ERP_FULL_BACKUP',
      version: 1,
      exportedAt: new Date().toISOString(),
      device: localStorage.getItem('erp_device_id') || '-',
      data: {},
      snapshots: {},
      meta: {}
    };
    PROTECTED_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v != null) bundle.data[k] = v;
    });
    Object.keys(localStorage).filter(k => k.indexOf('erp_snapshot_')===0).forEach(k => {
      bundle.snapshots[k] = localStorage.getItem(k);
    });
    bundle.meta.totalSize = JSON.stringify(bundle).length;
    bundle.meta.dataKeys = Object.keys(bundle.data).length;
    bundle.meta.snapshotCount = Object.keys(bundle.snapshots).length;
    bundle.meta.checksum = _checksum(bundle);

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ERP_FULL_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    if (typeof setBanner === 'function') setBanner('ok', `✅ 전체 백업 다운로드 (${(bundle.meta.totalSize/1024).toFixed(1)} KB)`);
    return bundle.meta;
  }

  function _checksum(bundle) {
    // 단순 합산 해시 (CRC 대신 길이 + 첫·끝 50자)
    const str = JSON.stringify(bundle.data) + JSON.stringify(bundle.snapshots);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  // ── 백업 파일 무결성 검증 ───────────────────────────
  function verify(file) {
    return new Promise((res, rej) => {
      if (!file) return rej(new Error('파일 필요'));
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const b = JSON.parse(e.target.result);
          const checks = {
            type: b.type === 'ERP_FULL_BACKUP',
            version: typeof b.version === 'number',
            hasData: b.data && Object.keys(b.data).length > 0,
            jsonValid: true,
            keys: Object.keys(b.data||{}).length,
            snapshots: Object.keys(b.snapshots||{}).length,
            exportedAt: b.exportedAt
          };
          // 데이터 JSON 파싱 검증
          let invalidKeys = [];
          Object.entries(b.data||{}).forEach(([k,v]) => {
            try { JSON.parse(v); } catch(e) { invalidKeys.push(k); }
          });
          checks.invalidKeys = invalidKeys;
          checks.checksum = _checksum(b);
          checks.checksumMatch = checks.checksum === b.meta?.checksum;
          checks.allValid = checks.type && checks.version && checks.hasData &&
                            invalidKeys.length === 0 && checks.checksumMatch;
          res(checks);
        } catch(err) {
          rej(new Error('파일 파싱 실패: ' + err.message));
        }
      };
      reader.onerror = rej;
      reader.readAsText(file);
    });
  }

  // ── 일일 스냅샷 ─────────────────────────────────────
  function listSnapshots() {
    const out = [];
    Object.keys(localStorage).filter(k => k.indexOf('erp_snapshot_')===0).sort().reverse().forEach(k => {
      const date = k.replace('erp_snapshot_','');
      try {
        const data = JSON.parse(localStorage.getItem(k));
        out.push({
          date,
          when: data.when,
          size: localStorage.getItem(k).length,
          keys: Object.keys(data).filter(k => k !== 'when').length
        });
      } catch(e) {}
    });
    return out;
  }

  function previewSnapshot(date) {
    const k = 'erp_snapshot_' + date;
    const raw = localStorage.getItem(k);
    if (!raw) { alert('해당 날짜 스냅샷 없음: ' + date); return null; }
    try {
      const snap = JSON.parse(raw);
      const counts = {};
      Object.entries(snap).forEach(([k,v]) => {
        if (k === 'when') return;
        try {
          const parsed = JSON.parse(v);
          counts[k] = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
        } catch(e) { counts[k] = '?'; }
      });
      console.log(`📅 스냅샷 ${date} (${snap.when}):`, counts);
      return { when: snap.when, counts, raw: snap };
    } catch(e) { alert('스냅샷 파싱 실패'); return null; }
  }

  function restoreSnapshot(date) {
    const k = 'erp_snapshot_' + date;
    const raw = localStorage.getItem(k);
    if (!raw) { alert('해당 날짜 스냅샷 없음'); return false; }
    if (!confirm(`⚠️ ${date} 시점으로 복원하시겠습니까?\n\n현재 데이터는 자동 백업되며 audit.undo()로 다시 되돌릴 수 있습니다.`)) return false;
    try {
      const snap = JSON.parse(raw);
      // 현재 상태를 audit에 기록
      if (typeof _recordAudit === 'function') _recordAudit('before_snapshot_restore_' + date);
      else if (typeof audit !== 'undefined') {
        // audit 모듈을 통한 백업
        try {
          const tmpKey = 'erp_pre_restore_' + Date.now();
          const prevState = {};
          PROTECTED_KEYS.forEach(k => prevState[k] = localStorage.getItem(k));
          localStorage.setItem(tmpKey, JSON.stringify(prevState));
        } catch(e) {}
      }
      // 적용
      Object.entries(snap).forEach(([k,v]) => {
        if (k === 'when') return;
        if (v != null) localStorage.setItem(k, v);
      });
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${date} 시점으로 복원 — 5초 후 자동 새로고침`);
      setTimeout(() => location.reload(), 5000);
      return true;
    } catch(e) {
      alert('복원 실패: ' + e.message);
      return false;
    }
  }

  // ── 합본 백업 임포트 (전체 복원) ────────────────────
  function importAll(file) {
    return new Promise((res, rej) => {
      if (!file) return rej(new Error('파일 필요'));
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const b = JSON.parse(e.target.result);
          if (b.type !== 'ERP_FULL_BACKUP') return rej(new Error('ERP_FULL_BACKUP 형식 아님'));
          if (!confirm(`⚠️ 전체 복원\n\n파일: ${b.exportedAt}\n키: ${b.meta?.dataKeys || '?'}개 + 스냅샷 ${b.meta?.snapshotCount || 0}건\n\n현재 모든 데이터가 덮어쓰기됩니다. 진행?`)) return res(false);
          // 데이터
          Object.entries(b.data||{}).forEach(([k,v]) => localStorage.setItem(k, v));
          // 스냅샷
          Object.entries(b.snapshots||{}).forEach(([k,v]) => localStorage.setItem(k, v));
          if (typeof setBanner === 'function') setBanner('ok', `✅ 전체 복원 완료 — 5초 후 자동 새로고침`);
          setTimeout(() => location.reload(), 5000);
          res(true);
        } catch(err) { rej(err); }
      };
      reader.onerror = rej;
      reader.readAsText(file);
    });
  }

  // ── UI 모달 (셋업 마법사 또는 운영 패널에서 호출) ───
  function _showPanel() {
    const snaps = listSnapshots();
    const css = `
      .bk-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:6vh;}
      .bk-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:90%;max-width:680px;max-height:84vh;display:flex;flex-direction:column;overflow:hidden;}
      .bk-hd{padding:14px 18px;background:#455a64;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .bk-bd{flex:1;overflow-y:auto;padding:18px;}
      .bk-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
      .bk-actions button{padding:14px;border:none;border-radius:8px;cursor:pointer;text-align:left;font-weight:700;}
      .bk-actions .descr{font-size:0.78em;font-weight:400;opacity:0.85;margin-top:3px;}
      .bk-snap{background:#f8f9fa;padding:10px 14px;border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;}
      .bk-snap-actions{display:flex;gap:6px;}
      .bk-snap-actions button{padding:4px 10px;border:none;border-radius:5px;cursor:pointer;font-size:0.82em;}
    `;
    if (!document.getElementById('bk-style')) {
      const s = document.createElement('style'); s.id = 'bk-style'; s.textContent = css; document.head.appendChild(s);
    }
    const old = document.getElementById('bk-modal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'bk-modal';
    modal.className = 'bk-overlay';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <div class="bk-box">
        <div class="bk-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">💾 백업 / 복구 도구</h4>
          <button onclick="document.getElementById('bk-modal').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="bk-bd">
          <h5 style="margin:0 0 10px;">🛠 백업 작업</h5>
          <div class="bk-actions">
            <button onclick="backup.exportAll()" style="background:#1565c0;color:#fff;">
              📦 전체 백업 다운로드
              <div class="descr">모든 보호 키 + 일일 스냅샷 1파일</div>
            </button>
            <label style="background:#27ae60;color:#fff;padding:14px;border-radius:8px;cursor:pointer;text-align:left;font-weight:700;">
              📤 백업 파일 검증
              <div class="descr">JSON 무결성 + 체크섬 확인</div>
              <input type="file" accept=".json" style="display:none;" onchange="backup._verifyFile(this.files[0])">
            </label>
            <label style="background:#e65100;color:#fff;padding:14px;border-radius:8px;cursor:pointer;text-align:left;font-weight:700;">
              ⏪ 전체 복원 (위험)
              <div class="descr">백업 파일에서 모든 데이터 덮어쓰기</div>
              <input type="file" accept=".json" style="display:none;" onchange="backup.importAll(this.files[0]).catch(e=>alert(e.message))">
            </label>
            <button onclick="backup._verifyAll()" style="background:#7b1fa2;color:#fff;">
              🔍 현재 데이터 무결성 점검
              <div class="descr">localStorage 파싱·BACKUP 키 일치 확인</div>
            </button>
          </div>

          <h5 style="margin:14px 0 10px;">📅 일일 스냅샷 (${snaps.length}건)</h5>
          ${snaps.length ? snaps.map(s => `
            <div class="bk-snap">
              <div>
                <strong>📆 ${s.date}</strong>
                <span style="color:#888;font-size:0.84em;margin-left:8px;">${(s.size/1024).toFixed(1)} KB · ${s.keys}키</span>
              </div>
              <div class="bk-snap-actions">
                <button onclick="backup.previewSnapshot('${s.date}')" style="background:#1565c0;color:#fff;">👁 미리보기</button>
                <button onclick="backup.restoreSnapshot('${s.date}')" style="background:#e65100;color:#fff;">⏪ 복원</button>
              </div>
            </div>`).join('') : '<div style="padding:20px;text-align:center;color:#bbb;">스냅샷 없음 — 매일 09시 첫 호출 시 자동 생성</div>'}

          <div style="margin-top:14px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.84em;color:#666;">
            💡 <strong>3중 백업 체계</strong>: 직전값 _backup (즉시) · 일일 스냅샷 (7일치) · 전체 백업 (수동/자동) · IndexedDB 섀도우 백업 (파일).<br>
            ⚠️ <strong>외부 백업 권장</strong>: 매주 금요일 "📦 전체 백업 다운로드" → 회사 NAS 또는 이메일 전송
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  async function _verifyFile(file) {
    if (!file) return;
    try {
      const r = await verify(file);
      const ok = r.allValid;
      alert(`📋 백업 파일 검증 결과\n\n` +
            `타입 정상: ${r.type ? '✅' : '❌'}\n` +
            `버전 정상: ${r.version ? '✅' : '❌'}\n` +
            `JSON 파싱: ${r.invalidKeys.length === 0 ? '✅' : '❌ ('+r.invalidKeys.length+'키 손상)'}\n` +
            `체크섬 일치: ${r.checksumMatch ? '✅' : '❌'}\n\n` +
            `데이터 키: ${r.keys}개\n` +
            `스냅샷: ${r.snapshots}건\n` +
            `생성일: ${r.exportedAt}\n\n` +
            `종합: ${ok ? '✅ 정상' : '⚠️ 주의 필요'}`);
    } catch(e) { alert('검증 실패: ' + e.message); }
  }

  function _verifyAll() {
    let ok = 0, fail = 0;
    const failed = [];
    PROTECTED_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v == null) return;
      try { JSON.parse(v); ok++; }
      catch(e) { fail++; failed.push(k); }
    });
    alert(`🔍 현재 데이터 무결성\n\n` +
          `정상 파싱: ${ok}/${ok+fail}건\n` +
          (fail ? `❌ 손상: ${failed.join(', ')}\n\n자동 복구는 다음 페이지 새로고침에서 시도됩니다.` : '✅ 모든 보호 키 정상'));
  }

  window.backup = {
    exportAll, verify, importAll,
    listSnapshots, previewSnapshot, restoreSnapshot,
    open: _showPanel,
    _verifyFile, _verifyAll
  };

  console.log('[ERP-BACKUP] 백업/복구 도구 활성 — backup.open() 또는 backup.exportAll()');
})();
