// =====================================================
//  전수조사서(FR) 자동 생성 — FD추출기 검증 로직 기반
//  - 모든 셀을 ID-like 값으로 인덱싱 (S/N·Pallet·Carton 통합)
//  - endsWith 부분일치 fallback
//  - 파일별 그룹 결과 + 수주 첨부
// =====================================================

// ── 전역 상태 ─────────────────────────────────────────
const _frRowIndex   = new Map();  // normalizedKey → [{file,sheet,header,row,keyCol}]
const _frAllHeaders = new Map();  // file||sheet → header[]
let _frTotalRows   = 0;
let _frTotalSheets = 0;
let _frFileCount   = 0;
let _frLastResults = null;
let _frLoadedFiles = [];

// ── 유틸 ──────────────────────────────────────────────
const _frN  = v => (v === null || v === undefined) ? '' : String(v).trim();
const _frNU = v => _frN(v).toUpperCase();
const _frNL = v => _frN(v).toLowerCase();

// ID처럼 생긴 값인지 판별
//  - 영문+숫자 혼합 (일반 S/N·Pallet)
//  - 또는 12자리 이상 순수 숫자 (순수숫자 Carton/Pallet ID)
//  - 스펙값(Voc, Isc 등 소수점 포함)·헤더 키워드·순수 짧은 숫자는 제외
function frIsIdLike(v) {
  const s = _frN(v);
  if (s.length < 5 || s.length > 80) return false;
  if (/^\d+\.\d+%?$/.test(s)) return false;               // 소수·퍼센트 값 (스펙) 제외
  if (/^(no\.?|id|sn|s\/n|voc|isc|pmax|ff|vpm|ipm|vm|im|pm|average|minimum|maximum|module|type|date|color|watt|class|carton|pallet|serial|container|box|invoice|lot|customer|客户|日期|型号|填充|托盘|短路|开路|最大|最小|平均|fill factor|current class|watt marking)$/i.test(s)) return false;

  const hasLetter = /[A-Za-z]/.test(s);
  const hasDigit  = /[0-9]/.test(s);

  // 영문+숫자 혼합: 일반 케이스
  if (hasLetter && hasDigit) return true;

  // 순수 숫자: 12자리 이상이면 ID로 간주 (Carton/Pallet 숫자형)
  if (!hasLetter && hasDigit && /^\d+$/.test(s) && s.length >= 12) return true;

  // 하이픈·언더스코어 포함 숫자 덩어리도 허용 (길이 10+)
  if (!hasLetter && /^[\d\-_]+$/.test(s) && s.replace(/[^\d]/g,'').length >= 10) return true;

  return false;
}

function frDetectHeaderRow(aoa) {
  const kwds = ['sn','s/n','id','pallet','carton','cartoon','托盘','serial','module','container','box'];
  for (let r = 0; r < Math.min(25, aoa.length); r++) {
    const row = aoa[r] || [];
    const lRow = row.map(_frNL);
    if (kwds.some(k => lRow.some(c => c === k || c.includes(k)))) {
      return { idx: r, header: row.map(_frN) };
    }
  }
  for (let r = 0; r < Math.min(5, aoa.length); r++) {
    if ((aoa[r]||[]).some(v => _frN(v))) return { idx: r, header: (aoa[r]||[]).map(_frN) };
  }
  return { idx: 0, header: [] };
}

// ── 탭 초기화 (수주 선택/첨부 기능 제거됨) ────────────
function renderFrTab() { /* no-op */ }

// ── XLSX 읽기 ────────────────────────────────────────
function _frReadXlsx(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = e => {
      try { res(XLSX.read(new Uint8Array(e.target.result), {type:'array'})); }
      catch(err) { rej(err); }
    };
    fr.onerror = rej;
    fr.readAsArrayBuffer(file);
  });
}

// ★ 드래그&드롭 영역 바인딩 (페이지 로드 시 1회)
function _frBindDropZone() {
  const zone = document.getElementById('fr-flash-drop');
  if (!zone || zone.__bound) return;
  zone.__bound = true;
  ['dragenter','dragover'].forEach(ev => {
    zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      zone.style.background = '#cce4ff';
      zone.style.borderColor = '#0d47a1';
    });
  });
  ['dragleave','dragend'].forEach(ev => {
    zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return;
      zone.style.background = '#f5faff';
      zone.style.borderColor = '#1565c0';
    });
  });
  zone.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    zone.style.background = '#f5faff';
    zone.style.borderColor = '#1565c0';
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    const valid = files.filter(f => /\.(xlsx|xls)$/i.test(f.name));
    if (valid.length === 0) { alert('엑셀 파일 (.xlsx, .xls) 만 업로드 가능합니다.'); return; }
    frLoadFlashFile(valid);
  });
}
// 자동 바인딩 (DOM 로드 + 탭 진입 양쪽 안전망)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_frBindDropZone, 100));
  } else {
    setTimeout(_frBindDropZone, 100);
  }
  setTimeout(() => {
    if (typeof window.showTab === 'function' && !window.showTab.__frDropHooked) {
      const _orig = window.showTab;
      window.showTab = function(id) {
        const r = _orig.apply(this, arguments);
        if (id === 'fr') setTimeout(_frBindDropZone, 50);
        return r;
      };
      window.showTab.__frDropHooked = true;
    }
  }, 1500);
}

// ── 데이터 파일 로드 (다중 XLSX → 전체 셀 인덱싱) ─────
async function frLoadFlashFile(event) {
  const files = Array.from(event.target?.files || event || []);
  if (!files.length) return;

  const info = document.getElementById('fr-flash-info');
  const chips = document.getElementById('fr-file-chips');
  info.innerHTML = `🔄 ${files.length}개 파일 인덱싱 중...`;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    info.innerHTML = `🔄 로드 중 (${fi+1}/${files.length}): ${file.name}`;

    try {
      const wb = await _frReadXlsx(file);
      let fileRows = 0;

      // 파일 단위 중복체크용 Set (key||rowSig) — O(1) 조회
      const seenKeyRow = new Set();

      for (const sName of wb.SheetNames) {
        const ws = wb.Sheets[sName];
        if (!ws) continue;
        const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});
        if (!aoa || aoa.length < 2) continue;

        const { idx: headerIdx, header } = frDetectHeaderRow(aoa);
        const sheetKey = `${file.name}||${sName}`;
        _frAllHeaders.set(sheetKey, header);

        for (let r = headerIdx + 1; r < aoa.length; r++) {
          const row = aoa[r] || [];
          // rowStr 1회만 계산
          let hasContent = false;
          let rowStr = '';
          for (let i = 0; i < row.length; i++) {
            const sv = _frN(row[i]);
            if (sv) hasContent = true;
            rowStr += (i ? '|' : '') + sv;
          }
          if (!hasContent) continue;

          const rowSig = `${sName}||${rowStr}`;
          let registeredThisRow = false;

          for (let c = 0; c < row.length; c++) {
            const v = _frNU(row[c]);
            if (!frIsIdLike(v)) continue;

            const dupKey = v + '\x01' + rowSig;
            if (seenKeyRow.has(dupKey)) continue;
            seenKeyRow.add(dupKey);

            let bucket = _frRowIndex.get(v);
            if (!bucket) { bucket = []; _frRowIndex.set(v, bucket); }
            bucket.push({ file: file.name, sheet: sName, header, row, keyCol: c });

            if (!registeredThisRow) { fileRows++; registeredThisRow = true; }
          }
        }
        _frTotalSheets++;
      }
      // 파일 단위로만 UI yield (시트 단위 yield는 오버헤드가 큼)
      await new Promise(r => setTimeout(r, 0));

      _frTotalRows += fileRows;
      _frFileCount++;
      _frLoadedFiles.push({ name: file.name, rows: fileRows, sheets: wb.SheetNames.length });
      _frAddFileChip(file.name, fileRows, wb.SheetNames.length, false);
    } catch (err) {
      console.error(file.name, err);
      _frAddFileChip(file.name, -1, 0, true);
    }
  }

  info.innerHTML = `✅ <strong>${_frFileCount}개 파일</strong> · ${_frTotalSheets}시트 · 인덱싱 행 <strong>${_frTotalRows.toLocaleString()}</strong> · 고유 키 <strong>${_frRowIndex.size.toLocaleString()}</strong>`;

  // 이미 입력된 시리얼 있으면 자동 매칭
  if (document.getElementById('fr-serials').value.trim()) frMatchSerials();

  event.target.value = '';
}

function _frAddFileChip(name, rows, sheets, isErr) {
  const chips = document.getElementById('fr-file-chips');
  if (!chips) return;
  const chip = document.createElement('span');
  chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:14px;font-size:0.78em;font-weight:600;margin:2px;background:${isErr?'#ffebee':'#e8f5e9'};color:${isErr?'#c62828':'#2e7d32'};`;
  const short = name.replace(/\.(xlsx|xls)$/i,'').substring(0, 24);
  chip.title = `${name}\n${sheets}시트 / ${rows}행 인덱싱`;
  chip.textContent = isErr ? `${short} ⚠오류` : `${short} ${rows.toLocaleString()}행`;
  chips.appendChild(chip);
}

// ── 입력 파싱 ────────────────────────────────────────
function frParseSerials(text) {
  return (text || '')
    .split(/[\r\n,;\t]+/)
    .map(s => s.trim().replace(/^["']|["']$/g,''))
    .filter(s => s.length >= 4);
}

// ── 매칭 실행 (FD추출기 runSearch 기반) ────────────────
async function frMatchSerials() {
  const raw = document.getElementById('fr-serials').value;
  const queries = frParseSerials(raw);
  const cnt = document.getElementById('fr-serial-count');

  if (!_frRowIndex.size) {
    if (cnt) cnt.textContent = queries.length ? `입력 ${queries.length}건 · ⚠️ 플래시 데이터를 먼저 업로드하세요` : '';
    document.getElementById('fr-result-area').style.display = 'none';
    return;
  }
  if (cnt) cnt.textContent = `입력 ${queries.length}건`;
  if (!queries.length) {
    document.getElementById('fr-result-area').style.display = 'none';
    return;
  }

  const foundSet = new Map();
  const notFound = [];

  for (const q of queries) {
    const key = _frNU(q);
    const hits = _frRowIndex.get(key);
    if (hits && hits.length) {
      foundSet.set(q, hits);
    } else {
      // endsWith 부분일치 (스캐너가 앞자 누락한 경우)
      let matched = null;
      if (key.length >= 8) {
        for (const [k] of _frRowIndex) {
          if (k === key || k.endsWith(key)) { matched = _frRowIndex.get(k); break; }
        }
      }
      if (matched) foundSet.set(q, matched);
      else notFound.push(q);
    }
  }

  // 같은 행이 여러 쿼리에서 잡히면 1번만
  const seenSigs = new Set();
  const allFoundRows = [];
  for (const [q, hits] of foundSet) {
    for (const hit of hits) {
      const sig = `${hit.file}||${hit.sheet}||${hit.row.map(_frN).join('|')}`;
      if (seenSigs.has(sig)) continue;
      seenSigs.add(sig);
      allFoundRows.push({ query: q, ...hit });
    }
  }

  _frLastResults = { allFoundRows, notFound, queries };
  frRenderResult(allFoundRows, notFound, queries.length);
}

// ── 결과 렌더링 ──────────────────────────────────────
function frRenderResult(allFoundRows, notFound, totalQueries) {
  const area = document.getElementById('fr-result-area');
  area.style.display = 'block';

  const byFile = {};
  allFoundRows.forEach(r => { (byFile[r.file] = byFile[r.file] || []).push(r); });
  const fileNames = Object.keys(byFile);

  const chip = (t, v, bg, c) =>
    `<div style="padding:6px 12px;background:${bg};color:${c};border-radius:8px;font-weight:700;font-size:0.88em;">${t}: ${v}</div>`;

  document.getElementById('fr-summary').innerHTML = [
    chip('조회', totalQueries.toLocaleString(), '#e3f2fd', '#1565c0'),
    chip('✅ 추출 행', allFoundRows.length.toLocaleString(), '#e8f5e9', '#2e7d32'),
    notFound.length ? chip('❌ 미발견', notFound.length.toLocaleString(), '#ffebee', '#c62828') : '',
    ...fileNames.map(f => chip(`📁 ${f.replace(/\.(xlsx|xls)$/i,'').substring(0,22)}`, byFile[f].length, '#fff3e0', '#e65100'))
  ].filter(Boolean).join('');

  // 미발견
  const missingArea = document.getElementById('fr-missing-area');
  if (notFound.length) {
    missingArea.style.display = 'block';
    const list = notFound.slice(0, 300).join(', ');
    const more = notFound.length > 300 ? ` ... 외 ${notFound.length - 300}건` : '';
    document.getElementById('fr-missing-list').textContent = list + more;
  } else {
    missingArea.style.display = 'none';
  }

  // 테이블: 공통 헤더 + 최대 500행
  const thead = document.getElementById('fr-matched-thead');
  const tbody = document.getElementById('fr-matched-tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!allFoundRows.length) {
    tbody.innerHTML = '<tr><td style="padding:20px;text-align:center;color:#888;">매칭된 행이 없습니다.</td></tr>';
    return;
  }

  const maxHeader = allFoundRows.slice(0, 500).reduce((best, r) => r.header.length > best.length ? r.header : best, []);
  const thRow = document.createElement('tr');
  ['출처파일','시트','매칭ID'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.background = '#e8eef8';
    thRow.appendChild(th);
  });
  maxHeader.slice(0, 12).forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    thRow.appendChild(th);
  });
  if (maxHeader.length > 12) {
    const th = document.createElement('th');
    th.textContent = `... 외 ${maxHeader.length-12}`;
    thRow.appendChild(th);
  }
  thead.appendChild(thRow);

  let count = 0;
  for (const fname of fileNames) {
    if (count >= 500) break;
    const groupTr = document.createElement('tr');
    const groupTd = document.createElement('td');
    groupTd.colSpan = 3 + Math.min(maxHeader.length, 12) + (maxHeader.length > 12 ? 1 : 0);
    groupTd.style.cssText = 'background:#fff8f0;font-weight:700;color:#e65100;font-size:0.84em;padding:6px 10px;';
    groupTd.textContent = `📁 ${fname} — ${byFile[fname].length}행`;
    groupTr.appendChild(groupTd);
    tbody.appendChild(groupTr);

    for (const item of byFile[fname]) {
      if (count++ >= 500) break;
      const tr = document.createElement('tr');
      [item.file.replace(/\.(xlsx|xls)$/i,'').substring(0,22), item.sheet, item.query].forEach(v => {
        const td = document.createElement('td');
        td.textContent = v;
        td.style.cssText = 'color:#1565c0;font-weight:600;font-size:0.82em;';
        tr.appendChild(td);
      });
      maxHeader.slice(0, 12).forEach((colName, ci) => {
        const td = document.createElement('td');
        const srcIdx = item.header.findIndex(h => h === colName);
        td.textContent = srcIdx >= 0 ? _frN(item.row[srcIdx]) : (_frN(item.row[ci]) || '');
        td.style.cssText = 'font-family:monospace;font-size:0.78em;';
        tr.appendChild(td);
      });
      if (maxHeader.length > 12) {
        const td = document.createElement('td');
        td.textContent = '…';
        td.style.color = '#ccc';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  if (allFoundRows.length > 500) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3 + Math.min(maxHeader.length, 12) + (maxHeader.length > 12 ? 1 : 0);
    td.style.cssText = 'text-align:center;color:#888;padding:8px;';
    td.textContent = `... 외 ${allFoundRows.length - 500}행 (엑셀 다운로드엔 전체 포함)`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// ── 엑셀 빌드 (파일별 별도 시트) ─────────────────────
function frBuildMatchedWorkbook(mode = 'found') {
  if (!_frLastResults || !_frLastResults.allFoundRows.length) {
    alert('매칭된 데이터가 없습니다.'); return null;
  }
  const { allFoundRows, notFound } = _frLastResults;

  const wb = XLSX.utils.book_new();
  const byFile = {};
  allFoundRows.forEach(r => { (byFile[r.file] = byFile[r.file] || []).push(r); });

  for (const fname of Object.keys(byFile)) {
    const fRows = byFile[fname];
    const header = fRows.reduce((best, r) => r.header.length > best.length ? r.header : best, []);
    const aoa = [['출처파일','시트','매칭ID', ...header]];
    fRows.forEach(item => {
      const dataRow = header.map((h, ci) => {
        const srcIdx = item.header.findIndex(hh => hh === h);
        return srcIdx >= 0
          ? (item.row[srcIdx] === undefined ? '' : item.row[srcIdx])
          : (item.row[ci] === undefined ? '' : item.row[ci]);
      });
      aoa.push([item.file, item.sheet, item.query, ...dataRow]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:24},{wch:10},{wch:20}, ...header.map(h => ({wch: Math.max(String(h).length + 2, 14)}))];
    const sheetName = fname.replace(/\.(xlsx|xls)$/i,'').substring(0, 28);
    let unique = sheetName, k = 2;
    while (wb.SheetNames.includes(unique)) unique = (sheetName + '_' + (k++)).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, unique);
  }

  if (mode === 'all' && notFound.length) {
    const ws2 = XLSX.utils.aoa_to_sheet([['NO','미발견 ID'], ...notFound.map((v,i)=>[i+1,v])]);
    XLSX.utils.book_append_sheet(wb, ws2, '미발견');
  }
  return wb;
}

function frExportMatched() {
  const wb = frBuildMatchedWorkbook('all');
  if (!wb) return;
  const fname = `FR_전수조사서_${typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fname);
  if (typeof setBanner === 'function') setBanner('ok', `✅ ${_frLastResults.allFoundRows.length}행 엑셀 저장: ${fname}`);
}

function frExportMissing() {
  if (!_frLastResults || !_frLastResults.notFound.length) { alert('미발견 ID가 없습니다.'); return; }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['NO','미발견 ID'], ..._frLastResults.notFound.map((v,i)=>[i+1,v])]);
  XLSX.utils.book_append_sheet(wb, ws, '미발견');
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `미발견_${today}.xlsx`);
}

// ── XLSX → dataURL 변환 (filesData에 저장하기 위함) ─────────
function _frWbToDataUrl(wb) {
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([wbout], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);   // data:application/...;base64,...
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── ★ 수주의 FD성적서로 등록 (매칭된 시리얼 결과 자동 첨부) ───
async function frAttachToOrder() {
  if (!_frLastResults || !_frLastResults.allFoundRows.length) {
    alert('매칭된 데이터가 없습니다. 먼저 시리얼을 입력하고 매칭을 실행하세요.');
    return;
  }
  if (typeof rawData === 'undefined' || !Array.isArray(rawData) || !rawData.length) {
    alert('등록할 수주가 없습니다. 수주현황에 수주를 먼저 등록해주세요.');
    return;
  }

  // PJ NO 선택 모달
  const modalId = 'fr-attach-modal';
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal open';
  modal.style.cssText = 'display:flex;';

  // 수주 옵션 (최근 50건, 출고요청일·고객사 표시)
  const orders = [...rawData].sort((a,b) =>
    String(b['수주일']||'').localeCompare(String(a['수주일']||''))
  ).slice(0, 100);
  const orderOptions = orders.map(o => {
    const pj = o['PJ NO'] || '-';
    const cu = o['고객사'] || '';
    const mo = o['모델명'] || '';
    const qty = o['수량'] || '';
    return `<option value="${o._id}">${pj} · ${cu} · ${mo} · ${qty}매</option>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-content" style="min-width:560px;max-width:680px;padding:20px 22px;">
      <div class="modal-head">
        <h3>📎 매칭 결과를 수주 FD성적서로 등록</h3>
        <button class="modal-close" onclick="document.getElementById('${modalId}').remove()">×</button>
      </div>
      <div style="margin-bottom:14px;background:#f0f8ff;border:1px solid #cfe2ff;border-radius:8px;padding:12px 14px;font-size:0.88em;color:#1565c0;">
        💡 현재 매칭된 <strong>${_frLastResults.allFoundRows.length}행</strong>의 Flash DATE 결과를 XLSX로 만들어 선택한 수주의 <strong>FD성적서</strong> 첨부파일로 저장합니다.
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.82em;color:#666;margin-bottom:6px;font-weight:600;">대상 수주 선택 *</label>
        <select id="fr-attach-pjno" style="width:100%;padding:8px 11px;">
          <option value="">— PJ NO 선택 —</option>
          ${orderOptions}
        </select>
        <div style="margin-top:6px;font-size:0.78em;color:#888;">최근 ${orders.length}건의 수주가 표시됩니다.</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:flex;gap:6px;align-items:center;font-size:0.85em;color:#444;">
          <input type="checkbox" id="fr-attach-include-missing" checked>
          미발견 시리얼 시트도 포함
        </label>
      </div>
      <div style="text-align:right;margin-top:14px;">
        <button class="btn btn-outline" onclick="document.getElementById('${modalId}').remove()">취소</button>
        <button class="btn btn-success" onclick="frAttachConfirm()">📎 FD성적서로 등록</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// 등록 확정 (모달의 PJ NO 선택 후 호출)
async function frAttachConfirm() {
  const sel = document.getElementById('fr-attach-pjno');
  const includeMissing = document.getElementById('fr-attach-include-missing')?.checked;
  const orderId = sel?.value;
  if (!orderId) { alert('대상 PJ NO를 선택하세요.'); return; }

  const order = rawData.find(r => r._id === orderId);
  if (!order) { alert('선택한 수주를 찾을 수 없습니다.'); return; }
  const pjNo = order['PJ NO'] || '-';

  try {
    const wb = frBuildMatchedWorkbook(includeMissing ? 'all' : 'found');
    if (!wb) return;
    const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    const fname = `FR_전수조사서_${pjNo}_${today}.xlsx`.replace(/\s+/g,'_');
    const dataUrl = await _frWbToDataUrl(wb);

    // filesData 에 저장
    if (typeof filesData === 'undefined') window.filesData = {};
    if (!filesData[orderId]) filesData[orderId] = {};
    filesData[orderId]['FD성적서'] = {
      name: fname,
      data: dataUrl,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    // rawData 의 FD성적서 텍스트 필드도 갱신
    order['FD성적서'] = fname;
    if (typeof localMeta !== 'undefined') {
      if (!localMeta[orderId]) localMeta[orderId] = {};
      localMeta[orderId]['FD성적서'] = fname;
    }
    try { localStorage.setItem(KEYS.RAW, JSON.stringify(rawData)); } catch(e){}
    try { localStorage.setItem(KEYS.FILES, JSON.stringify(filesData)); } catch(e){}
    if (typeof saveLocal === 'function') saveLocal();
    if (typeof setBanner === 'function') setBanner('ok', `📎 ${pjNo} 의 FD성적서로 등록 완료 — ${fname}`);
    if (typeof renderOrders === 'function') try { renderOrders(); } catch(e){}
    document.getElementById('fr-attach-modal')?.remove();
  } catch (err) {
    console.error('frAttachConfirm 실패:', err);
    alert('등록 중 오류: ' + err.message);
  }
}

window.frAttachToOrder = frAttachToOrder;
window.frAttachConfirm = frAttachConfirm;

// ── 인덱스 초기화 ────────────────────────────────────
function frResetIndex() {
  if (!confirm('로드된 플래시 데이터를 모두 초기화하시겠습니까?')) return;
  _frRowIndex.clear();
  _frAllHeaders.clear();
  _frTotalRows = 0; _frTotalSheets = 0; _frFileCount = 0;
  _frLoadedFiles = []; _frLastResults = null;
  document.getElementById('fr-file-chips').innerHTML = '';
  document.getElementById('fr-flash-info').innerHTML = '';
  document.getElementById('fr-result-area').style.display = 'none';
  const cnt = document.getElementById('fr-serial-count');
  if (cnt) cnt.textContent = '';
}
