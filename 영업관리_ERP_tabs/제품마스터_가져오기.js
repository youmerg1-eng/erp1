// =====================================================
//  제품 마스터 — 엑셀 가져오기 / 기본 목록 적재 (2026-08 추가)
//
//  설정 → 제품 마스터 화면에서
//    · 📥 엑셀 불러오기   : .xls / .xlsx / .csv 파일을 직접 읽어 적재
//    · 📋 기본 목록       : 제품마스터_기본데이터.js 의 내장 목록을 적재
//    · 🗑 전체 삭제       : 제품 마스터 비우기
//
//  엑셀 열 인식 — 헤더명을 자동 매칭하고, 못 찾으면 열 순서로 처리
//    모델명 / 제품용량(W) / 제조사 / 1PLT 수량(매)
//
//  저장 구조 (기존과 동일)
//    productMaster[모델명] = { watt: Number, mfr: String, plt: Number }
//
//  공개 API : window.productMasterImport
// =====================================================
(function () {
  'use strict';

  const KEY = (typeof KEYS !== 'undefined' && KEYS.PRODUCT_MASTER) ? KEYS.PRODUCT_MASTER : 'erp_product_master';

  // ── 헤더 별칭 ─────────────────────────────────────────
  const ALIAS = {
    model: ['모델명', '모델', '제품명', '품명', 'model', 'modelname', '모델번호'],
    watt:  ['제품용량', '제품용량(w)', '용량', '출력', '와트', 'watt', 'w', 'wp', '출력(w)'],
    mfr:   ['제조사', '제조', '메이커', '브랜드', 'mfr', 'maker', 'brand', 'vendor'],
    plt:   ['1plt수량', '1plt수량(매)', 'plt수량', '1plt', 'plt', '파렛트', '팔레트', '파레트', 'pallet', '1파렛트']
  };
  const _norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  const _num = (v) => {
    const s = String(v == null ? '' : v).replace(/[^\d.\-]/g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };

  //  헤더 행에서 열 인덱스 찾기 → { model, watt, mfr, plt } (없으면 -1)
  function _mapHeader(cells) {
    const idx = { model: -1, watt: -1, mfr: -1, plt: -1 };
    cells.forEach((c, i) => {
      const k = _norm(c);
      if (!k) return;
      for (const field in ALIAS) {
        if (idx[field] >= 0) continue;
        if (ALIAS[field].some(a => k === a || k.indexOf(a) === 0)) { idx[field] = i; return; }
      }
    });
    return idx;
  }

  //  AOA(2차원 배열) → [{model, watt, mfr, plt}]
  function _rowsFromAoa(aoa) {
    if (!aoa || !aoa.length) return { list: [], usedHeader: false };
    // 위에서 5행까지 헤더 후보 검색
    let idx = null, start = 0;
    for (let i = 0; i < Math.min(5, aoa.length); i++) {
      const cand = _mapHeader(aoa[i] || []);
      if (cand.model >= 0) { idx = cand; start = i + 1; break; }
    }
    const usedHeader = !!idx;
    if (!idx) idx = { model: 0, watt: 1, mfr: 2, plt: 3 };   // 헤더 없음 → 열 순서 가정

    const list = [];
    for (let i = start; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const model = String(row[idx.model] == null ? '' : row[idx.model]).trim();
      if (!model) continue;
      // 합계/소계 행 스킵
      if (/^(합계|소계|total|계)$/i.test(model)) continue;
      list.push({
        model,
        watt: idx.watt >= 0 ? _num(row[idx.watt]) : 0,
        mfr:  idx.mfr  >= 0 ? String(row[idx.mfr] == null ? '' : row[idx.mfr]).trim() : '',
        plt:  idx.plt  >= 0 ? Math.round(_num(row[idx.plt])) : 0
      });
    }
    return { list, usedHeader };
  }

  //  실제 적재 — 병합(기존 유지 + 추가·갱신)
  function _apply(list, sourceLabel) {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('제품 마스터 가져오기')) return;
    if (!list.length) { alert('가져올 제품이 없습니다. 파일의 첫 열이 모델명인지 확인하세요.'); return; }

    // 파일 내 중복 모델 — 뒤 행이 앞 행을 덮음
    const seen = {};
    let dupInFile = 0;
    list.forEach(r => { if (seen[r.model]) dupInFile++; seen[r.model] = r; });
    const uniq = Object.values(seen);

    const before = (typeof productMaster !== 'undefined' && productMaster) ? productMaster : {};
    const isNew = uniq.filter(r => !before[r.model]).length;
    const isUpd = uniq.length - isNew;
    const noWatt = uniq.filter(r => !(r.watt > 0)).length;

    const msg = `${sourceLabel}에서 제품 ${uniq.length}종을 읽었습니다.\n\n`
      + `· 신규 등록: ${isNew}종\n`
      + `· 기존 갱신: ${isUpd}종\n`
      + (dupInFile ? `· 파일 내 중복 ${dupInFile}건은 마지막 값으로 병합\n` : '')
      + (noWatt ? `· 용량(W) 없는 품목 ${noWatt}종 (구조물·자재 등) — 0W 로 등록\n` : '')
      + `\n기존 제품 마스터에 병합할까요?\n(전체를 새로 채우려면 먼저 "전체 삭제" 후 실행하세요)`;
    if (!confirm(msg)) return;

    uniq.forEach(r => {
      productMaster[r.model] = { watt: Number(r.watt) || 0, mfr: r.mfr || '', plt: Number(r.plt) || 0 };
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(productMaster));
    } catch (e) {
      alert('저장 실패 — 브라우저 저장 공간이 부족합니다.');
      return;
    }
    if (typeof renderProductMasterTable === 'function') renderProductMasterTable();
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ 제품 마스터 ${uniq.length}종 적재 (신규 ${isNew} · 갱신 ${isUpd}) — 총 ${Object.keys(productMaster).length}종`);
  }

  // ── 내장 기본 목록 적재 ───────────────────────────────
  function loadSeed() {
    const seed = window.PRODUCT_MASTER_SEED;
    if (!Array.isArray(seed) || !seed.length) {
      alert('기본 목록 데이터를 찾을 수 없습니다.\n제품마스터_기본데이터.js 가 로드되었는지 확인하세요.');
      return;
    }
    const info = window.PRODUCT_MASTER_SEED_INFO || {};
    const list = seed.map(a => ({ model: String(a[0] || '').trim(), watt: Number(a[1]) || 0, mfr: String(a[2] || ''), plt: Number(a[3]) || 0 }))
                     .filter(r => r.model);
    _apply(list, `기본 목록 (제품마스터.xls${info.date ? ' · ' + info.date : ''})`);
  }

  // ── 엑셀/CSV 파일 가져오기 ────────────────────────────
  function pickFile() {
    if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리(XLSX)가 로드되지 않았습니다.'); return; }
    let input = document.getElementById('pm-import-file');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'pm-import-file';
      input.accept = '.xls,.xlsx,.xlsm,.csv';
      input.style.display = 'none';
      input.addEventListener('change', _onFile);
      document.body.appendChild(input);
    }
    input.value = '';
    input.click();
  }

  function _onFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let wb;
      try {
        wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      } catch (err) {
        alert('파일을 읽지 못했습니다: ' + err.message);
        return;
      }
      if (!wb.SheetNames.length) { alert('시트가 없습니다.'); return; }
      // 모델명을 찾을 수 있는 첫 시트 사용
      let picked = null, pickedName = '';
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        const r = _rowsFromAoa(aoa);
        if (r.list.length) { picked = r; pickedName = name; break; }
      }
      if (!picked) { alert('제품 데이터를 찾지 못했습니다. 첫 열에 모델명이 있는지 확인하세요.'); return; }
      _apply(picked.list, `${file.name} [${pickedName}]${picked.usedHeader ? '' : ' · 헤더 미인식 → 열 순서로 처리'}`);
    };
    reader.onerror = () => alert('파일 읽기에 실패했습니다.');
    reader.readAsArrayBuffer(file);
  }

  // ── 전체 삭제 ─────────────────────────────────────────
  function clearAll() {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('제품 마스터 전체 삭제')) return;
    const n = Object.keys(productMaster || {}).length;
    if (!n) { alert('등록된 제품이 없습니다.'); return; }
    if (!confirm(`제품 마스터 ${n}종을 모두 삭제합니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    productMaster = {};
    try { localStorage.setItem(KEY, JSON.stringify(productMaster)); } catch (e) {}
    if (typeof renderProductMasterTable === 'function') renderProductMasterTable();
    if (typeof setBanner === 'function') setBanner('ok', `🗑 제품 마스터 ${n}종 삭제 완료`);
  }

  window.productMasterImport = { loadSeed, pickFile, clearAll, _rowsFromAoa };

  console.log('[ERP-PM-IMPORT] 제품 마스터 가져오기 활성 — 설정 → 제품 마스터');
})();
