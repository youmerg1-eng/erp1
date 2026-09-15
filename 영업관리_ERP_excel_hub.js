// =====================================================
//  EXCEL HUB — Phase E · Day 5
//  통합 엑셀 양식 (1파일 N시트) 다운로드 + 업로드
//
//  시트 구성 (8장)
//   1. _안내                — 양식 설명
//   2. 수주                 — 수주현황 (HEADER_NAMES 기반)
//   3. 출고지시서           — deliveryOrders
//   4. 입고/출고            — inventoryData
//   5. 입고예정             — incoming
//   6. 제품마스터           — productMaster
//   7. 고객사마스터         — customerMaster
//   8. 매입사마스터         — vendorMaster
//
//  콘솔: erpExcel.download() / erpExcel.upload(file)
//        erpExcel.template()  — 빈 양식만
// =====================================================
(function() {
  'use strict';

  const SHEETS = {
    수주: { headers: typeof HEADER_NAMES !== 'undefined' ? HEADER_NAMES : [] },
    출고지시서: { headers: ['출고지시서번호','PJ NO','출고일','수신처','발전소명','납품주소','제조사','모델명','제품용량(W)','수량','FOC','합계','창고','차량번호','현장담당자','비고','담당자','확인자','회사명','상태','PLT 분할'] },
    '입고/출고': { headers: ['유형','날짜','모델명','제조사','수량','B/L','창고','PJ NO','비고','매입처','매입단가'] },
    입고예정: { headers: ['모델명','매입사','수량','모듈출력(Wp)','ETD','ETA','B/L','도착지','상태','PO번호','비고'] },
    제품마스터: { headers: ['모델명','제품용량(W)','제조사','1PLT 수량','안전재고'] },
    고객사마스터: { headers: ['고객사명','신용한도','결제조건','위험등급','담당자','연락처','사업자번호','비고'] },
    매입사마스터: { headers: ['매입사명','담당자','연락처','이메일','사업자번호','결제조건','위험등급','비고'] }
  };

  function _xlsx() {
    if (typeof XLSX === 'undefined') {
      alert('XLSX 라이브러리 미로드 — 인터넷 연결 확인');
      return null;
    }
    return XLSX;
  }

  // ── 다운로드: 현재 데이터 → 통합 엑셀 ───────────────
  function download() {
    const X = _xlsx(); if (!X) return;
    const wb = X.utils.book_new();

    // 0. 안내 시트
    const guide = X.utils.aoa_to_sheet([
      ['영업관리 ERP — 통합 양식'],
      [],
      ['시트별 구성:'],
      ['  • 수주 — 모든 수주 데이터 (HEADER_NAMES 기준)'],
      ['  • 출고지시서 — 발행된 출고지시서 목록'],
      ['  • 입고/출고 — 재고 입출고 이력'],
      ['  • 입고예정 — 해외/국내 입고 예정 (ETA·B/L)'],
      ['  • 제품마스터 — 모델별 Wp · PLT · 안전재고'],
      ['  • 고객사마스터 — 신용한도·연락처'],
      ['  • 매입사마스터 — 평가 등급·연락처'],
      [],
      ['업로드 방법:'],
      ['  1) 시트 데이터를 수정/추가'],
      ['  2) F12 콘솔에서 erpExcel.upload(파일) 또는 마법사 사용'],
      ['  3) 미리보기 확인 후 등록'],
      [],
      ['주의:'],
      ['  • 수주 시트의 PJ NO는 고유해야 함 (중복 차단)'],
      ['  • 빈 행은 자동 스킵'],
      ['  • 날짜는 YYYY-MM-DD 또는 26-04-01 형식'],
      [],
      ['생성일: ' + new Date().toLocaleString('ko-KR')]
    ]);
    X.utils.book_append_sheet(wb, guide, '_안내');

    // 1. 수주
    const orderRows = [SHEETS.수주.headers];
    if (typeof rawData !== 'undefined') {
      rawData.forEach(r => {
        orderRows.push(SHEETS.수주.headers.map(h => r[h] || ''));
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(orderRows), '수주');

    // 2. 출고지시서
    const doRows = [SHEETS.출고지시서.headers];
    if (typeof deliveryOrders !== 'undefined') {
      deliveryOrders.forEach(d => {
        doRows.push([
          d.id, d.pjNo||'', d.date||'', d.receiver||'', d.plant||'', d.address||'',
          d.mfr||'', d.model||'', d.watt||'', d.qty||0, d.foc||0, d.totalQty||0,
          d.warehouse||'', d.vehicle||'', d.siteMgr||'', d.remarks||'',
          d.manager||'', d.approver||'', d.companyName||'',
          d.processed ? '출고완료' : '대기',
          d.pltCount ? `${d.pltCount}PLT(${d.pltQty}매) + 소분 ${d.looseQty||0}매` : ''
        ]);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(doRows), '출고지시서');

    // 3. 입고/출고
    const invRows = [SHEETS['입고/출고'].headers];
    if (typeof inventoryData !== 'undefined') {
      inventoryData.forEach(r => {
        invRows.push([r.type, r.date, r.model, r.mfr||'', r.qty, r.bl||'', r.warehouse||'', r.pjNo||'', r.remarks||'', '', '']);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(invRows), '입고/출고');

    // 4. 입고예정
    const incRows = [SHEETS.입고예정.headers];
    if (typeof incoming !== 'undefined' && incoming.list) {
      incoming.list().forEach(r => {
        incRows.push([r.model, r.mfr, r.qty, r.watt, r.etd, r.eta, r.bl, r.dest, r.status, r.poNo||'', r.notes||'']);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(incRows), '입고예정');

    // 5. 제품마스터
    const pmRows = [SHEETS.제품마스터.headers];
    if (typeof productMaster !== 'undefined') {
      Object.entries(productMaster).forEach(([m, v]) => {
        pmRows.push([m, v.watt||'', v.mfr||'', v.plt||'', v.safetyStock||0]);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(pmRows), '제품마스터');

    // 6. 고객사마스터
    const cmRows = [SHEETS.고객사마스터.headers];
    if (typeof customerMaster !== 'undefined' && customerMaster.raw) {
      Object.entries(customerMaster.raw()).forEach(([n, v]) => {
        cmRows.push([n, v.creditLimit||'', v.paymentTerm||'', v.riskLevel||'normal', v.contactPerson||'', v.phone||'', v.bizNo||'', v.notes||'']);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(cmRows), '고객사마스터');

    // 7. 매입사마스터
    const vmRows = [SHEETS.매입사마스터.headers];
    if (typeof vendor !== 'undefined' && vendor.raw) {
      Object.entries(vendor.raw()).forEach(([n, v]) => {
        vmRows.push([n, v.contactPerson||'', v.phone||'', v.email||'', v.bizNo||'', v.paymentTerm||'', v.riskLevel||'normal', v.notes||'']);
      });
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(vmRows), '매입사마스터');

    const today = new Date().toISOString().slice(0,10);
    X.writeFile(wb, `ERP_통합양식_${today}.xlsx`);
    if (typeof setBanner === 'function') setBanner('ok', '✅ 통합 엑셀 다운로드 완료');
  }

  // ── 빈 양식만 (헤더만) ──────────────────────────────
  function template() {
    const X = _xlsx(); if (!X) return;
    const wb = X.utils.book_new();
    // 안내
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
      ['영업관리 ERP — 빈 양식 (헤더만)'],
      [],
      ['각 시트 헤더 아래에 데이터를 입력 후 erpExcel.upload(파일)']
    ]), '_안내');
    Object.entries(SHEETS).forEach(([name, def]) => {
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([def.headers]), name);
    });
    X.writeFile(wb, `ERP_통합양식_빈양식.xlsx`);
    if (typeof setBanner === 'function') setBanner('ok', '✅ 빈 양식 다운로드 완료');
  }

  // ── 업로드 + 미리보기 + 등록 ────────────────────────
  let _uploadedData = null;

  function upload(file) {
    return new Promise((resolve, reject) => {
      const X = _xlsx(); if (!X) return reject(new Error('XLSX 미로드'));
      if (!file) return reject(new Error('파일 필요'));
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = X.read(new Uint8Array(e.target.result), { type: 'array' });
          const result = _parseSheets(wb);
          _uploadedData = result;
          _showPreview(result);
          resolve(result);
        } catch(err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function _parseSheets(wb) {
    const X = _xlsx();
    const result = { sheets: {}, summary: {} };
    Object.keys(SHEETS).forEach(sheetName => {
      const sh = wb.Sheets[sheetName];
      if (!sh) return;
      const rows = X.utils.sheet_to_json(sh, { header: 1, defval: '', raw: false });
      if (rows.length < 2) return;
      const headers = rows[0];
      const data = rows.slice(1).filter(r => r.some(c => String(c||'').trim() !== ''));
      result.sheets[sheetName] = { headers, data, count: data.length };
      result.summary[sheetName] = data.length;
    });
    return result;
  }

  function _showPreview(result) {
    let html = '<h3 style="margin:0 0 14px;">📥 업로드 미리보기</h3>';
    const total = Object.values(result.summary).reduce((s,n) => s+n, 0);
    if (!total) {
      html += '<div style="padding:30px;color:#bbb;">유효한 데이터 없음</div>';
    } else {
      html += '<div style="margin-bottom:14px;">';
      Object.entries(result.summary).forEach(([k,n]) => {
        if (n > 0) html += `<span style="display:inline-block;background:#e3f2fd;color:#1565c0;padding:4px 10px;border-radius:5px;font-size:0.86em;margin:0 6px 6px 0;font-weight:700;">${k}: ${n}건</span>`;
      });
      html += '</div>';
      Object.entries(result.sheets).forEach(([name, s]) => {
        if (!s.count) return;
        html += `<div style="margin-bottom:14px;">
          <strong style="font-size:0.9em;">${name} (${s.count}건)</strong>
          <div style="margin-top:4px;font-size:0.78em;color:#666;max-height:120px;overflow:auto;background:#fafafa;padding:6px;border-radius:5px;">
            ${s.data.slice(0,5).map(r => '· ' + r.slice(0,5).join(' / ')).join('<br>')}
            ${s.count > 5 ? `<br>... 외 ${s.count-5}건` : ''}
          </div>
        </div>`;
      });
    }
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
            '<button onclick="erpExcel._cancel()" class="btn btn-sm btn-gray">취소</button>' +
            '<button onclick="erpExcel._commit()" class="btn btn-sm btn-green">✅ 일괄 등록</button>' +
            '</div>';
    _modal(html);
  }

  function _modal(html) {
    let m = document.getElementById('erp-excel-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'erp-excel-modal';
      m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:8vh;';
      m.onclick = e => { if (e.target === m) m.remove(); };
      document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff;border-radius:14px;padding:20px;width:90%;max-width:680px;max-height:80vh;overflow-y:auto;">${html}</div>`;
  }

  function _cancel() {
    _uploadedData = null;
    document.getElementById('erp-excel-modal')?.remove();
  }

  function _commit() {
    if (!_uploadedData) { alert('업로드 데이터 없음'); return; }
    if (!confirm('일괄 등록하시겠습니까? (기존 데이터 추가됨)')) return;
    const r = _uploadedData;
    let added = { 수주:0, 출고지시서:0, '입고/출고':0, 입고예정:0, 제품마스터:0, 고객사마스터:0, 매입사마스터:0 };

    // 수주 — rawData에 추가 (기존 PJ NO와 중복 검사)
    if (r.sheets.수주 && typeof rawData !== 'undefined') {
      const existPJ = new Set(rawData.map(x => String(x['PJ NO']||'').trim()).filter(Boolean));
      r.sheets.수주.data.forEach(row => {
        const obj = {};
        r.sheets.수주.headers.forEach((h, i) => obj[h] = row[i]);
        if (!obj['PJ NO']) return;
        if (existPJ.has(String(obj['PJ NO']).trim())) return;
        obj._id = (typeof genId === 'function') ? genId() : 'R-' + Date.now() + '-' + Math.random().toString(36).slice(2,5);
        rawData.push(obj);
        added.수주++;
      });
      try { localStorage.setItem('erp_raw', JSON.stringify(rawData)); } catch(e) {}
    }

    // 제품마스터
    if (r.sheets.제품마스터 && typeof productMaster !== 'undefined') {
      r.sheets.제품마스터.data.forEach(row => {
        const m = String(row[0]||'').trim(); if (!m) return;
        productMaster[m] = {
          watt: Number(row[1])||0,
          mfr: String(row[2]||'').trim(),
          plt: parseInt(row[3])||0,
          safetyStock: parseInt(row[4])||0
        };
        added.제품마스터++;
      });
      try { localStorage.setItem('erp_product_master', JSON.stringify(productMaster)); } catch(e) {}
    }

    // 고객사
    if (r.sheets.고객사마스터 && typeof customerMaster !== 'undefined' && customerMaster.set) {
      r.sheets.고객사마스터.data.forEach(row => {
        const n = String(row[0]||'').trim(); if (!n) return;
        customerMaster.set(n, {
          creditLimit: Number(row[1])||0,
          paymentTerm: String(row[2]||'').trim(),
          riskLevel: String(row[3]||'normal').trim(),
          contactPerson: String(row[4]||'').trim(),
          phone: String(row[5]||'').trim(),
          bizNo: String(row[6]||'').trim(),
          notes: String(row[7]||'').trim()
        });
        added.고객사마스터++;
      });
    }

    // 매입사
    if (r.sheets.매입사마스터 && typeof vendor !== 'undefined' && vendor.set) {
      r.sheets.매입사마스터.data.forEach(row => {
        const n = String(row[0]||'').trim(); if (!n) return;
        vendor.set(n, {
          contactPerson: String(row[1]||'').trim(),
          phone: String(row[2]||'').trim(),
          email: String(row[3]||'').trim(),
          bizNo: String(row[4]||'').trim(),
          paymentTerm: String(row[5]||'').trim(),
          riskLevel: String(row[6]||'normal').trim(),
          notes: String(row[7]||'').trim()
        });
        added.매입사마스터++;
      });
    }

    // 입고예정
    if (r.sheets.입고예정 && typeof incoming !== 'undefined' && incoming.add) {
      r.sheets.입고예정.data.forEach(row => {
        const m = String(row[0]||'').trim(); if (!m) return;
        try {
          incoming.add({
            model: m, mfr: String(row[1]||'').trim(),
            qty: parseInt(row[2])||0, watt: parseInt(row[3])||0,
            etd: String(row[4]||'').trim(), eta: String(row[5]||'').trim(),
            bl: String(row[6]||'').trim(), dest: String(row[7]||'').trim(),
            status: String(row[8]||'order').trim() || 'order',
            poNo: String(row[9]||'').trim(), notes: String(row[10]||'').trim()
          });
          added.입고예정++;
        } catch(e) {}
      });
    }

    if (typeof refreshAllTabs === 'function') refreshAllTabs();
    document.getElementById('erp-excel-modal')?.remove();
    _uploadedData = null;
    const totalAdded = Object.values(added).reduce((s,n) => s+n, 0);
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ 통합 엑셀 등록 완료: 총 ${totalAdded}건 (${Object.entries(added).filter(([,n]) => n>0).map(([k,n]) => `${k} ${n}`).join(', ')})`);
  }

  // ── 우상단 마법사 진입점 (콘솔/setup_helper에서 호출) ─
  function showWizard() {
    const html = `
      <h3 style="margin:0 0 14px;">📥 통합 엑셀 양식</h3>
      <p style="font-size:0.86em;color:#666;line-height:1.6;">
        SolarFlow 스타일의 통합 양식 — 1파일 ${Object.keys(SHEETS).length}시트로 모든 데이터 입력·내보내기.
      </p>
      <div style="display:grid;gap:10px;margin:14px 0;">
        <button onclick="erpExcel.download()" style="padding:14px;border:none;border-radius:8px;background:#1565c0;color:#fff;cursor:pointer;font-weight:700;text-align:left;">
          📦 통합 양식 다운로드 (현재 데이터 포함)
          <div style="font-size:0.78em;font-weight:400;opacity:0.85;margin-top:3px;">백업 + 외부 작업용</div>
        </button>
        <button onclick="erpExcel.template()" style="padding:14px;border:none;border-radius:8px;background:#1976d2;color:#fff;cursor:pointer;font-weight:700;text-align:left;">
          📄 빈 양식 다운로드 (헤더만)
          <div style="font-size:0.78em;font-weight:400;opacity:0.85;margin-top:3px;">새 데이터 입력용</div>
        </button>
        <label style="padding:14px;border:2px dashed #1565c0;border-radius:8px;background:#e3f2fd;color:#1565c0;cursor:pointer;text-align:left;display:block;">
          📤 통합 양식 업로드
          <div style="font-size:0.78em;font-weight:400;margin-top:3px;">파일 선택 후 미리보기 → 일괄 등록</div>
          <input type="file" accept=".xlsx,.xls" onchange="erpExcel.upload(this.files[0]).catch(e=>alert('실패: '+e.message))" style="display:none;">
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button onclick="document.getElementById('erp-excel-modal').remove()" class="btn btn-sm btn-gray">닫기</button>
      </div>`;
    _modal(html);
  }

  window.erpExcel = {
    download, template, upload, showWizard,
    _commit, _cancel
  };

  console.log('[ERP-EXCEL] 통합 엑셀 양식 모듈 활성 — erpExcel.showWizard() / download() / upload(file)');
})();
