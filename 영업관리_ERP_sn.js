// =====================================================
//  SN TRACEABILITY — Phase C · Week 10
//
//  태양광 모듈 SN(시리얼) 단위 입출고 추적
//
//  데이터: erp_sn_records
//   { sn: { sn, model, mfr, pltId, cartonId, inboundDate, inboundBL,
//           warehouse, pjNo, outboundDate, doId, status, flashSpec, notes }}
//
//  status: in_stock | shipped | installed | returned | damaged
//
//  핵심 흐름
//   입고 → sn.bulkAdd(snList, {model, mfr, ...})
//   출고지시서 발행 → sn.assign(snList, pjNo, doId)
//   클레임 → sn.markDamaged(sn, reason)
//   조회 → sn.find('JKM2602...')   /   sn.byPJ('BR-260330')
//
//  글로벌 검색에 자동 통합 — Ctrl+K로 SN 검색 가능.
// =====================================================
(function() {
  'use strict';

  const SN_KEY = 'erp_sn_records';
  let snDb = {};
  try { snDb = JSON.parse(localStorage.getItem(SN_KEY) || '{}'); }
  catch(e) { snDb = {}; }

  function _save() {
    try { localStorage.setItem(SN_KEY, JSON.stringify(snDb)); }
    catch(e) {
      if (typeof logError === 'function') logError('sn.save', e);
    }
  }

  // ── 핵심 API ────────────────────────────────────────
  function bulkAdd(snList, meta) {
    if (!Array.isArray(snList) || !snList.length) throw new Error('SN 목록 필요');
    meta = meta || {};
    let added = 0, skipped = 0;
    const audit = (typeof tx === 'function') ? tx : (label, fn) => fn();
    audit('SN 일괄 등록 (' + snList.length + '건)', () => {
      snList.forEach(sn => {
        const k = String(sn||'').trim().toUpperCase();
        if (!k) return;
        if (snDb[k]) { skipped++; return; }
        snDb[k] = {
          sn: k,
          model: meta.model || '',
          mfr: meta.mfr || '',
          pltId: meta.pltId || '',
          cartonId: meta.cartonId || '',
          inboundDate: meta.inboundDate || new Date().toISOString().slice(0,10),
          inboundBL: meta.inboundBL || '',
          warehouse: meta.warehouse || '',
          pjNo: null,
          outboundDate: null,
          doId: null,
          status: 'in_stock',
          flashSpec: meta.flashSpec || null,
          notes: meta.notes || '',
          createdAt: new Date().toISOString()
        };
        added++;
      });
      _save();
    });
    return { added, skipped, total: Object.keys(snDb).length };
  }

  function assign(snList, pjNo, doId) {
    if (!Array.isArray(snList)) snList = [snList];
    if (!pjNo) throw new Error('PJ NO 필요');
    let ok = 0, miss = 0, conflict = 0;
    const audit = (typeof tx === 'function') ? tx : (label, fn) => fn();
    audit('SN 출고 할당 → ' + pjNo, () => {
      const today = new Date().toISOString().slice(0,10);
      snList.forEach(sn => {
        const k = String(sn||'').trim().toUpperCase();
        if (!snDb[k]) { miss++; return; }
        if (snDb[k].pjNo && snDb[k].pjNo !== pjNo) { conflict++; return; }
        snDb[k].pjNo = pjNo;
        snDb[k].doId = doId || null;
        snDb[k].outboundDate = today;
        snDb[k].status = 'shipped';
        ok++;
      });
      _save();
    });
    return { assigned: ok, notFound: miss, conflict };
  }

  function unassign(sn) {
    const k = String(sn||'').trim().toUpperCase();
    if (!snDb[k]) return false;
    snDb[k].pjNo = null;
    snDb[k].doId = null;
    snDb[k].outboundDate = null;
    snDb[k].status = 'in_stock';
    _save(); return true;
  }

  function markDamaged(sn, reason) {
    const k = String(sn||'').trim().toUpperCase();
    if (!snDb[k]) return false;
    snDb[k].status = 'damaged';
    snDb[k].damagedAt = new Date().toISOString();
    snDb[k].damageReason = reason || '';
    _save(); return true;
  }

  function find(query) {
    const q = String(query||'').trim().toUpperCase();
    if (!q) return null;
    if (snDb[q]) return snDb[q];
    // 부분 매치
    const partial = Object.values(snDb).filter(r => r.sn.includes(q));
    return partial.length === 1 ? partial[0] : partial;
  }

  function byPJ(pjNo) {
    return Object.values(snDb).filter(r => r.pjNo === pjNo);
  }

  function byMfr(mfr) {
    return Object.values(snDb).filter(r => r.mfr === mfr);
  }

  function byStatus(s) {
    return Object.values(snDb).filter(r => r.status === s);
  }

  function summary() {
    const all = Object.values(snDb);
    const buckets = { in_stock:0, shipped:0, installed:0, returned:0, damaged:0 };
    all.forEach(r => { buckets[r.status] = (buckets[r.status]||0) + 1; });
    return { total: all.length, ...buckets };
  }

  // ── 전수조사서(FR) 인덱스에서 자동 가져오기 ─────────
  function importFromFR(fileFilter) {
    if (typeof _frRowIndex === 'undefined' || !_frRowIndex) {
      throw new Error('전수조사서 데이터 미로드 — FR 탭에서 파일 불러오기 먼저');
    }
    let imported = 0;
    _frRowIndex.forEach((entries, key) => {
      entries.forEach(e => {
        if (fileFilter && !e.file.includes(fileFilter)) return;
        const k = String(key).toUpperCase();
        if (!snDb[k]) {
          snDb[k] = {
            sn: k,
            model: e.model || '',
            mfr: e.mfr || '',
            pltId: '',
            cartonId: '',
            inboundDate: '',
            inboundBL: '',
            warehouse: '',
            pjNo: null, outboundDate: null, doId: null,
            status: 'in_stock',
            flashSpec: e.spec || null,
            notes: 'FR 임포트: ' + (e.file||''),
            createdAt: new Date().toISOString()
          };
          imported++;
        }
      });
    });
    _save();
    return { imported, total: Object.keys(snDb).length };
  }

  // ── UI 패널 (open by command) ───────────────────────
  function _injectUI() {
    if (document.getElementById('erp-sn-panel')) return;
    const css = `
      #erp-sn-panel{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:6vh;}
      #erp-sn-panel.open{display:flex;}
      .sn-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:780px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;}
      .sn-hd{padding:14px 18px;background:#7b1fa2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .sn-hd h4{margin:0;font-size:1em;font-weight:700;}
      .sn-search{padding:14px 18px;border-bottom:1px solid #eee;}
      .sn-search input{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:0.95em;box-sizing:border-box;}
      .sn-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:10px 18px;background:#fafafa;border-bottom:1px solid #eee;}
      .sn-stat{padding:6px;text-align:center;border-radius:6px;background:#fff;border:1px solid #eee;}
      .sn-stat-l{font-size:0.7em;color:#888;}
      .sn-stat-v{font-weight:800;font-size:1em;}
      .sn-body{flex:1;overflow-y:auto;padding:14px 18px;font-size:0.86em;}
      .sn-card{padding:14px;border-radius:10px;background:#f8f9fa;border-left:4px solid #7b1fa2;margin-bottom:10px;}
      .sn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;font-size:0.82em;}
      .sn-grid div{padding:6px 8px;background:#fff;border-radius:5px;}
      .sn-grid b{display:block;font-size:0.74em;color:#888;margin-bottom:2px;font-weight:600;}
      .sn-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;}
      .sn-tag.in_stock{background:#e3f2fd;color:#1565c0;}
      .sn-tag.shipped{background:#fff3e0;color:#e65100;}
      .sn-tag.installed{background:#e8f5e9;color:#2e7d32;}
      .sn-tag.damaged{background:#ffebee;color:#c62828;}
      .sn-tag.returned{background:#fce4ec;color:#ad1457;}
      .sn-actions{padding:10px 18px;background:#fafafa;border-top:1px solid #eee;display:flex;gap:8px;flex-wrap:wrap;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-sn-style';
    style.textContent = css;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'erp-sn-panel';
    panel.onclick = e => { if (e.target === panel) close(); };
    panel.innerHTML = `
      <div class="sn-box">
        <div class="sn-hd">
          <h4>🏷️ SN 추적 (Serial Traceability)</h4>
          <button onclick="document.getElementById('erp-sn-panel').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="sn-summary" id="sn-summary"></div>
        <div class="sn-search">
          <input id="sn-search-input" placeholder="🔍 SN · 모델 · PJ NO · 매입사 — 부분 일치 가능">
        </div>
        <div class="sn-body" id="sn-body"></div>
        <div class="sn-actions">
          <button class="btn btn-sm btn-blue" onclick="sn.importFromFRPrompt()">📥 전수조사서에서 가져오기</button>
          <button class="btn btn-sm btn-dark" onclick="sn.exportCSV()">📋 CSV 내보내기</button>
          <span style="font-size:0.74em;color:#888;align-self:center;margin-left:auto;">콘솔: <code>sn.find(...)</code> · <code>sn.byPJ(...)</code></span>
        </div>
      </div>`;
    document.body.appendChild(panel);

    document.getElementById('sn-search-input').addEventListener('input', e => _renderBody(e.target.value));
  }

  function _renderSummary() {
    const el = document.getElementById('sn-summary');
    if (!el) return;
    const s = summary();
    el.innerHTML = `
      <div class="sn-stat"><div class="sn-stat-l">총 SN</div><div class="sn-stat-v">${s.total.toLocaleString()}</div></div>
      <div class="sn-stat" style="background:#e3f2fd;"><div class="sn-stat-l">재고</div><div class="sn-stat-v" style="color:#1565c0;">${(s.in_stock||0).toLocaleString()}</div></div>
      <div class="sn-stat" style="background:#fff3e0;"><div class="sn-stat-l">출고</div><div class="sn-stat-v" style="color:#e65100;">${(s.shipped||0).toLocaleString()}</div></div>
      <div class="sn-stat" style="background:#e8f5e9;"><div class="sn-stat-l">설치완료</div><div class="sn-stat-v" style="color:#2e7d32;">${(s.installed||0).toLocaleString()}</div></div>
      <div class="sn-stat" style="background:#ffebee;"><div class="sn-stat-l">하자/반품</div><div class="sn-stat-v" style="color:#c62828;">${((s.damaged||0)+(s.returned||0)).toLocaleString()}</div></div>`;
  }

  function _renderBody(query) {
    const body = document.getElementById('sn-body');
    if (!body) return;
    const q = String(query||'').trim().toUpperCase();
    if (!q) {
      const all = Object.values(snDb).slice(-30).reverse();
      if (!all.length) { body.innerHTML = '<div style="padding:40px;text-align:center;color:#bbb;">SN 데이터 없음 — 입고 시 등록 또는 FR 임포트</div>'; return; }
      body.innerHTML = '<div style="font-size:0.78em;color:#888;margin-bottom:8px;">최근 등록 30건 (검색어 입력 시 필터)</div>' +
                       all.map(_renderCard).join('');
      return;
    }
    const matches = Object.values(snDb).filter(r =>
      r.sn.includes(q) ||
      (r.model||'').toUpperCase().includes(q) ||
      (r.mfr||'').toUpperCase().includes(q) ||
      (r.pjNo||'').toUpperCase().includes(q) ||
      (r.warehouse||'').toUpperCase().includes(q)
    );
    if (!matches.length) {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:#bbb;">"${query}" 일치 SN 없음</div>`;
      return;
    }
    body.innerHTML = `<div style="font-size:0.78em;color:#888;margin-bottom:8px;">${matches.length}건 매치 (상위 50)</div>` +
                     matches.slice(0,50).map(_renderCard).join('');
  }

  function _renderCard(r) {
    const flash = r.flashSpec ? Object.entries(r.flashSpec).slice(0,4).map(([k,v]) => `${k}:${v}`).join(' · ') : '';
    return `<div class="sn-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:800;font-family:monospace;font-size:0.96em;color:#1a1a2e;">${r.sn}</div>
        <span class="sn-tag ${r.status}">${r.status}</span>
      </div>
      <div class="sn-grid">
        <div><b>모델</b>${r.model || '-'}</div>
        <div><b>매입사</b>${r.mfr || '-'}</div>
        <div><b>창고</b>${r.warehouse || '-'}</div>
        <div><b>입고일</b>${r.inboundDate || '-'}</div>
        <div><b>B/L</b>${r.inboundBL || '-'}</div>
        <div><b>PLT/Carton</b>${r.pltId || '-'} / ${r.cartonId || '-'}</div>
        <div><b>출고 PJ</b>${r.pjNo ? `<a href="#" onclick="if(typeof openOrderDetail==='function')openOrderDetail('${r.pjNo}');return false;" style="color:#1565c0;text-decoration:underline;">${r.pjNo}</a>` : '-'}</div>
        <div><b>출고지시서</b>${r.doId || '-'}</div>
        <div><b>출고일</b>${r.outboundDate || '-'}</div>
      </div>
      ${flash ? `<div style="margin-top:8px;padding:6px 10px;background:#fff3e0;border-radius:5px;font-size:0.78em;color:#e65100;">⚡ ${flash}</div>` : ''}
      ${r.notes ? `<div style="margin-top:6px;font-size:0.78em;color:#888;">${r.notes}</div>` : ''}
    </div>`;
  }

  function open() {
    _injectUI();
    document.getElementById('erp-sn-panel').classList.add('open');
    _renderSummary();
    _renderBody('');
    setTimeout(() => document.getElementById('sn-search-input')?.focus(), 30);
  }
  function close() {
    document.getElementById('erp-sn-panel')?.classList.remove('open');
  }

  function importFromFRPrompt() {
    const f = prompt('파일명 필터 (비워두면 전체):', '');
    if (f === null) return;
    try {
      const r = importFromFR(f || null);
      if (typeof setBanner === 'function') setBanner('ok', `✅ FR에서 ${r.imported}건 임포트 (전체 ${r.total})`);
      _renderSummary(); _renderBody('');
    } catch(e) {
      alert(e.message);
    }
  }

  function exportCSV() {
    const rows = Object.values(snDb);
    if (!rows.length) { alert('데이터 없음'); return; }
    // 한글 헤더 매핑 — Excel 가독성·한글 깨짐 방지
    const colMap = [
      ['sn','SN'], ['model','모델명'], ['mfr','제조사'], ['warehouse','창고'],
      ['inboundDate','입고일'], ['inboundBL','입고 B/L'], ['pltId','파레트 ID'], ['cartonId','카톤 ID'],
      ['status','상태'], ['pjNo','PJ NO'], ['doId','출고지시서'], ['outboundDate','출고일'], ['notes','비고']
    ];
    const aoa = [colMap.map(c => c[1])].concat(
      rows.map(r => colMap.map(c => r[c[0]] ?? ''))
    );
    // ★ UTF-8 BOM 포함 → Excel 한글 깨짐 방지
    const csv = (typeof csvJoin === 'function') ? csvJoin(aoa) : aoa.map(row => row.join(',')).join('\r\n');
    const fname = `SN_${new Date().toISOString().slice(0,10)}.csv`;
    if (typeof downloadCsv === 'function') downloadCsv(fname, csv);
    else {
      const blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
    }
  }

  // ── 글로벌 검색 통합 ────────────────────────────────
  // 검색 결과에 SN 매치 자동 포함
  function _hookGlobalSearch() {
    // 단순 명령어 등록 — Ctrl+K 검색창에 'sn:XXX' 입력하면 SN 패널 열림
    if (typeof openErpSearch === 'function') {
      window.openSnFromGlobalSearch = function(query) {
        open();
        setTimeout(() => {
          const inp = document.getElementById('sn-search-input');
          if (inp) { inp.value = query; inp.dispatchEvent(new Event('input')); }
        }, 50);
      };
    }
  }

  // ── 공개 API ────────────────────────────────────────
  window.sn = {
    bulkAdd, assign, unassign, markDamaged,
    find, byPJ, byMfr, byStatus, summary,
    importFromFR, importFromFRPrompt,
    exportCSV,
    open, close,
    raw: () => ({ ...snDb })
  };

  // 부팅
  function boot() {
    _injectUI();
    _hookGlobalSearch();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-SN] SN 추적 활성 — sn.open()으로 패널, ' + Object.keys(snDb).length + '건 등록');
})();
