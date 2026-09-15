// =====================================================
//  RETURNS / RMA — 자재 반품 관리 (Sprint 4 · #6)
//
//  기능
//   1) 반품 등록 — 고객사 반품(반품입고) 또는 매입사 반품(반품출고)
//   2) 상태 흐름: 접수 → 검수 → 처리완료 / 폐기 / 재판매
//   3) 사유 분류: 파손·하자·오송·고객변심·기타
//   4) inventoryData 연동 — type='반품입고' / '반품출고' 자동 등록
//   5) 모델별·매입사별·사유별 통계
//   6) 반품 일자, 수량, 사진 첨부, 처리 메모
//
//  데이터 키
//   erp_returns → [
//     { id, no, type, date, pjNo, doId, model, mfr, qty, reason,
//       status, customerOrVendor, photos[], notes, processedDate, _ts }
//   ]
//
//  상태:
//   접수    — RMA 신청 받음
//   검수    — 물품 도착·검수 중
//   처리중  — 교환 발송/환불 진행
//   완료    — 종료
//   폐기    — 검수 후 사용 불가
//   재판매  — 검수 후 재고로 복귀
//
//  공개 API: window.returns
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_returns';
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  // ── 상수 ─────────────────────────────────────────
  const TYPES = {
    inbound:  { lbl: '반품입고 (고객→당사)', icon: '↩️', color: '#e65100' },
    outbound: { lbl: '반품출고 (당사→매입사)', icon: '↪️', color: '#1565c0' }
  };
  const REASONS = ['파손', '하자', '오송', '수량부족', '인증불일치', '고객변심', '기타'];
  const STATUSES = ['접수', '검수', '처리중', '완료', '폐기', '재판매'];

  // ── 데이터 로드/저장 ──────────────────────────────
  let returns = [];
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      returns = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(returns)) returns = [];
    } catch (e) {
      console.error('[returns] load 실패', e);
      returns = [];
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(returns)); }
    catch (e) {
      console.error('[returns] save 실패', e);
      if (typeof setBanner === 'function') setBanner('err', '❌ 반품 저장 실패');
      throw e;
    }
  }

  // ── 헬퍼 ─────────────────────────────────────────
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _genNo(type) {
    const today = _today().replace(/-/g,'');
    const prefix = type === 'inbound' ? 'RI' : 'RO';
    const sameDay = returns.filter(r => r.no && r.no.startsWith(prefix+'-'+today));
    return prefix + '-' + today + '-' + String(sameDay.length+1).padStart(3,'0');
  }
  function _genId() { return 'RT-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); }
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }

  // ── CRUD ─────────────────────────────────────────
  function list() { return returns.slice(); }
  function get(id) { return returns.find(r => r.id === id); }

  function add(data) {
    const r = {
      id: _genId(),
      no: data.no || _genNo(data.type || 'inbound'),
      type: data.type || 'inbound',
      date: data.date || _today(),
      pjNo: data.pjNo || '',
      doId: data.doId || '',
      model: data.model || '',
      mfr: data.mfr || '',
      qty: Number(data.qty) || 0,
      reason: data.reason || '기타',
      status: data.status || '접수',
      customerOrVendor: data.customerOrVendor || '',
      photos: Array.isArray(data.photos) ? data.photos : [],
      notes: data.notes || '',
      processedDate: data.processedDate || null,
      _ts: Date.now()
    };
    returns.push(r);
    save();
    return r;
  }

  function update(id, patch) {
    const i = returns.findIndex(r => r.id === id);
    if (i < 0) return null;
    returns[i] = { ...returns[i], ...patch, _ts: Date.now() };
    save();
    return returns[i];
  }

  function remove(id) {
    const i = returns.findIndex(r => r.id === id);
    if (i < 0) return false;
    returns.splice(i, 1);
    save();
    return true;
  }

  // ── inventoryData 연동 ───────────────────────────
  // 반품을 inventory에 자동 반영 (선택적)
  //   inbound  → type='반품입고' (재고 +)
  //   outbound → type='반품출고' (재고 -)
  function applyToInventory(id) {
    const r = get(id);
    if (!r) throw new Error('반품 건 없음');
    if (typeof inventoryData === 'undefined') throw new Error('inventoryData 미로드');
    if (r.inventoryRefId) {
      console.warn('[returns] 이미 inventory에 반영됨:', r.inventoryRefId);
      return null;
    }
    const invType = r.type === 'inbound' ? '반품입고' : '반품출고';
    const invRec = {
      id: 'INV-' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
      type: invType,
      date: r.date,
      model: r.model,
      mfr: r.mfr,
      qty: r.qty,
      pjNo: r.pjNo || '',
      bl: r.no,             // 반품번호를 B/L 자리에 기록
      warehouse: '반품창고',
      notes: '반품: ' + (r.reason||'') + (r.notes ? ' / ' + r.notes : ''),
      _returnRefId: r.id    // 역추적
    };
    inventoryData.push(invRec);
    if (typeof saveLocal === 'function') saveLocal();
    update(id, { inventoryRefId: invRec.id });
    return invRec;
  }

  // 처리 완료 처리 (status 전환 + processedDate 기록)
  function complete(id, opts) {
    opts = opts || {};
    return update(id, {
      status: opts.status || '완료',
      processedDate: opts.processedDate || _today(),
      processedNotes: opts.notes || ''
    });
  }

  // ── 통계 ─────────────────────────────────────────
  function summary() {
    const byType = { inbound: 0, outbound: 0 };
    const byStatus = {};
    const byReason = {};
    const byModel = {};
    let totalQty = 0, openCount = 0;
    returns.forEach(r => {
      byType[r.type] = (byType[r.type]||0) + 1;
      byStatus[r.status] = (byStatus[r.status]||0) + 1;
      byReason[r.reason] = (byReason[r.reason]||0) + 1;
      byModel[r.model] = (byModel[r.model]||0) + (Number(r.qty)||0);
      totalQty += Number(r.qty)||0;
      if (r.status !== '완료' && r.status !== '폐기' && r.status !== '재판매') openCount++;
    });
    return { total: returns.length, openCount, byType, byStatus, byReason, byModel, totalQty };
  }

  // ── UI ───────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-rma-modal')) return;
    const css = `
      #erp-rma-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-rma-modal.open{display:flex;}
      .rma-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1100px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .rma-hd{padding:14px 18px;background:#5d4037;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .rma-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .rma-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;}
      .rma-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .rma-stat-l{font-size:0.74em;color:#666;text-transform:uppercase;font-weight:700;}
      .rma-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .rma-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .rma-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .rma-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .rma-status{padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;}
      .rma-s-접수{background:#fff3e0;color:#e65100;}
      .rma-s-검수{background:#e3f2fd;color:#1565c0;}
      .rma-s-처리중{background:#fff8e1;color:#f9a825;}
      .rma-s-완료{background:#e8f5e9;color:#27ae60;}
      .rma-s-폐기{background:#ffebee;color:#c62828;}
      .rma-s-재판매{background:#f3e5f5;color:#7b1fa2;}
      .rma-type-inbound{color:#e65100;font-weight:700;}
      .rma-type-outbound{color:#1565c0;font-weight:700;}
      .rma-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#fff;padding:16px;border-radius:8px;}
      .rma-form-full{grid-column:span 2;}
      .rma-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:4px;}
      .rma-form input, .rma-form select, .rma-form textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}
      .rma-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .rma-btn-primary{background:#5d4037;color:#fff;}
      .rma-btn-success{background:#27ae60;color:#fff;}
      .rma-btn-warn{background:#e65100;color:#fff;}
      .rma-btn-danger{background:#c62828;color:#fff;}
      .rma-btn-ghost{background:#fff;color:#555;border:1px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-rma-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-rma-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="rma-box">
        <div class="rma-bd" id="rma-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    // ★ 2026-05 버그수정: rma-box 가 returnsTabHost 로 이동되면 modal 의 클릭 리스너가
    //   동작하지 않아 ➕ 새 반품 등록 등 버튼 클릭이 무반응. rma-box 자체에 직접 부착.
    const box = modal.querySelector('.rma-box');
    if (box) box.addEventListener('click', _onModalClick);
    modal.addEventListener('click', _onModalClick);   // 모달 모드 호환
  }

  function _renderList() {
    const s = summary();
    const html = `
      <div class="rma-stats">
        <div class="rma-stat"><div class="rma-stat-l">전체</div><div class="rma-stat-v">${s.total}</div></div>
        <div class="rma-stat"><div class="rma-stat-l">진행 중</div><div class="rma-stat-v" style="color:#e65100;">${s.openCount}</div></div>
        <div class="rma-stat"><div class="rma-stat-l">반품 입고</div><div class="rma-stat-v" style="color:#e65100;">${s.byType.inbound||0}</div></div>
        <div class="rma-stat"><div class="rma-stat-l">반품 출고</div><div class="rma-stat-v" style="color:#1565c0;">${s.byType.outbound||0}</div></div>
        <div class="rma-stat"><div class="rma-stat-l">완료</div><div class="rma-stat-v" style="color:#27ae60;">${s.byStatus['완료']||0}</div></div>
        <div class="rma-stat"><div class="rma-stat-l">총 수량</div><div class="rma-stat-v">${_fmt(s.totalQty)}매</div></div>
      </div>

      <!-- ★ 일괄 액션 툴바 — 새 반품 등록 옆에 텍스트 버튼으로 -->
      <div style="margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <button class="rma-btn rma-btn-primary" data-act="rma-new">새 반품 등록</button>
        <span style="border-left:1px solid #ddd;height:24px;margin:0 4px;"></span>
        <button class="rma-btn rma-btn-ghost"   data-act="rma-bulk-view"      title="선택 1건 상세보기/편집">상세보기</button>
        <button class="rma-btn rma-btn-warn"    data-act="rma-bulk-process"   title="선택 항목 상태 → 처리중">처리중</button>
        <button class="rma-btn rma-btn-success" data-act="rma-bulk-complete"  title="선택 항목 최종 처리(완료/폐기/재판매)">완료처리</button>
        <button class="rma-btn rma-btn-ghost"   data-act="rma-bulk-inv"       title="선택 항목을 재고(inventory)에 반영">재고반영</button>
        <button class="rma-btn rma-btn-danger"  data-act="rma-bulk-delete"    title="선택 항목 삭제">삭제</button>
        <span id="rma-sel-info" style="font-size:0.82em;color:#666;margin-left:6px;">선택 <strong style="color:#0d47a1;">0</strong>건</span>
      </div>

      <table class="rma-tbl">
        <thead><tr>
          <th style="width:32px;text-align:center;"><input type="checkbox" id="rma-sel-all" onclick="if(window.returns&&window.returns._toggleAllSel)window.returns._toggleAllSel(this.checked)"></th>
          <th>반품번호</th><th>구분</th><th>일자</th><th>PJ NO</th><th>모델</th>
          <th style="text-align:right;">수량</th><th>사유</th><th>고객/매입처</th><th>상태</th>
        </tr></thead>
        <tbody>
          ${returns.length === 0
            ? '<tr><td colspan="10" style="padding:30px;text-align:center;color:#bbb;">반품 이력 없음</td></tr>'
            : returns.slice().reverse().map(r => {
              const invTag = r.inventoryRefId ? '<span style="color:#27ae60;font-size:0.74em;margin-left:4px;">·재고반영</span>' : '';
              return `<tr>
                <td style="text-align:center;"><input type="checkbox" class="rma-row-chk" data-id="${_ea(r.id)}" onchange="if(window.returns&&window.returns._updateSelInfo)window.returns._updateSelInfo()"></td>
                <td style="font-weight:700;color:#5d4037;cursor:pointer;" onclick="if(window.returns&&window.returns._viewById)window.returns._viewById('${_ea(r.id)}')" title="클릭=상세보기">${_e(r.no)}${invTag}</td>
                <td><span class="rma-type-${_ea(r.type)}">${TYPES[r.type]?.icon||''} ${_e(TYPES[r.type]?.lbl||r.type)}</span></td>
                <td>${_e(r.date)}</td>
                <td>${_e(r.pjNo||'-')}</td>
                <td style="font-size:0.86em;">${_e(r.model||'-')}</td>
                <td style="text-align:right;font-weight:700;">${_fmt(r.qty)}</td>
                <td>${_e(r.reason||'-')}</td>
                <td>${_e(r.customerOrVendor||'-')}</td>
                <td><span class="rma-status rma-s-${_ea(r.status)}">${_e(r.status)}</span></td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>`;
    document.getElementById('rma-bd').innerHTML = html;
  }

  // ── 선택 헬퍼 ────────────────────────────────────
  function _getSelectedIds() {
    return [...document.querySelectorAll('.rma-row-chk:checked')].map(c => c.getAttribute('data-id'));
  }
  function _toggleAllSel(checked) {
    document.querySelectorAll('.rma-row-chk').forEach(c => { c.checked = !!checked; });
    _updateSelInfo();
  }
  function _updateSelInfo() {
    const total = document.querySelectorAll('.rma-row-chk').length;
    const cnt = _getSelectedIds().length;
    const info = document.getElementById('rma-sel-info');
    if (info) info.innerHTML = `선택 <strong style="color:#0d47a1;">${cnt}</strong>건`;
    const all = document.getElementById('rma-sel-all');
    if (all) all.checked = total > 0 && cnt === total;
  }
  function _viewById(id) { _renderEditor(id); }

  // ── 일괄 액션 ────────────────────────────────────
  function _bulkView() {
    const ids = _getSelectedIds();
    if (ids.length === 0) { alert('상세보기할 반품을 1건 이상 체크해주세요.'); return; }
    if (ids.length > 1) { alert('상세보기는 1건만 선택해주세요.\n(현재 ' + ids.length + '건 선택)'); return; }
    _renderEditor(ids[0]);
  }
  function _bulkProcess() {
    const ids = _getSelectedIds();
    if (ids.length === 0) { alert('처리중으로 변경할 반품을 1건 이상 체크해주세요.'); return; }
    if (!confirm(`선택한 ${ids.length}건을 "처리중" 으로 변경하시겠습니까?`)) return;
    let n = 0;
    ids.forEach(id => { update(id, { status: '처리중' }); n++; });
    if (typeof setBanner === 'function') setBanner('ok', `⏩ ${n}건 처리중 변경 완료`);
    _renderList();
  }
  function _bulkComplete() {
    const ids = _getSelectedIds();
    if (ids.length === 0) { alert('완료처리할 반품을 1건 이상 체크해주세요.'); return; }
    const dispOpts = ['완료', '폐기', '재판매'];
    const sel = prompt(`선택한 ${ids.length}건의 최종 처리 상태:\n1. 완료 (정상 처리)\n2. 폐기 (사용 불가)\n3. 재판매 (재고 복귀)\n\n번호 입력 (1~3):`, '1');
    if (!sel) return;
    const idx = parseInt(sel) - 1;
    if (idx < 0 || idx > 2) { alert('잘못된 선택'); return; }
    const status = dispOpts[idx];
    let n = 0;
    ids.forEach(id => { try { complete(id, { status }); n++; } catch(e) {} });
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${n}건 ${status} 처리 완료`);
    _renderList();
  }
  function _bulkInv() {
    const ids = _getSelectedIds();
    if (ids.length === 0) { alert('재고에 반영할 반품을 1건 이상 체크해주세요.'); return; }
    if (!confirm(`선택한 ${ids.length}건을 재고(inventoryData)에 반영하시겠습니까?\n반품입고는 +수량, 반품출고는 -수량으로 등록됩니다.`)) return;
    let n = 0, skip = 0;
    ids.forEach(id => {
      try {
        const r = get(id);
        if (r && r.inventoryRefId) { skip++; return; }
        applyToInventory(id);
        n++;
      } catch (err) { console.warn('[bulkInv]', id, err.message); }
    });
    if (typeof setBanner === 'function') setBanner('ok', `📦 ${n}건 재고 반영 완료${skip?` · ${skip}건 이미 반영됨`:''}`);
    _renderList();
  }
  function _bulkDelete() {
    const ids = _getSelectedIds();
    if (ids.length === 0) { alert('삭제할 반품을 1건 이상 체크해주세요.'); return; }
    if (!confirm(`선택한 ${ids.length}건의 반품을 삭제하시겠습니까?\n(연결된 inventory 항목은 그대로 남습니다)`)) return;
    let n = 0;
    ids.forEach(id => {
      const i = returns.findIndex(r => r.id === id);
      if (i >= 0) { returns.splice(i, 1); n++; }
    });
    // ★ 2026-05-13 버그 수정 — _save() → save() (함수명 오타)
    //   기존 코드는 ReferenceError 로 인해 localStorage 미저장 → 새로고침 시 삭제된 항목이 다시 보임
    save();
    if (typeof setBanner === 'function') setBanner('ok', `🗑 ${n}건 반품 삭제 완료`);
    _renderList();
    // ★ live_refresh 트리거 (다른 탭/패널까지 즉각 반영)
    if (window.erpLiveRefresh && window.erpLiveRefresh.trigger) {
      window.erpLiveRefresh.trigger('returns:bulk-delete');
    }
  }

  function _renderEditor(id) {
    const r = id ? get(id) : {
      id: null, no: _genNo('inbound'), type: 'inbound', date: _today(),
      pjNo: '', doId: '', model: '', mfr: '', qty: 0, reason: '파손',
      status: '접수', customerOrVendor: '', notes: ''
    };

    // ★ PJ NO 자동완성용 datalist — 수주현황(getEnriched) 의 PJ NO 목록 제공
    let pjnoOptions = '';
    try {
      if (typeof getEnriched === 'function') {
        const orders = getEnriched();
        pjnoOptions = orders
          .filter(o => o.pjNo)
          .map(o => `<option value="${_ea(o.pjNo)}">${_e(o.고객사||'')} · ${_e(o.모델명||'')}</option>`)
          .join('');
      }
    } catch(e) {}

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#5d4037;">${id ? '반품 편집' : '새 반품 등록'} · ${_e(r.no)}</h3>
        <div>
          <button class="rma-btn rma-btn-ghost" data-act="rma-back">← 목록</button>
          <button class="rma-btn rma-btn-primary" data-act="rma-save" data-id="${_ea(r.id||'')}">저장</button>
        </div>
      </div>
      <div class="rma-form" id="rma-form" data-id="${_ea(r.id||'')}">
        <div><label>반품번호</label><input data-field="no" value="${_ea(r.no)}"></div>
        <div><label>구분</label><select data-field="type">
          ${Object.entries(TYPES).map(([k,v]) => `<option value="${k}" ${k===r.type?'selected':''}>${v.icon} ${v.lbl}</option>`).join('')}
        </select></div>
        <div><label>일자</label><input data-field="date" type="date" value="${_ea(r.date)}"></div>
        <div><label>상태</label><select data-field="status">
          ${STATUSES.map(s => `<option value="${s}" ${s===r.status?'selected':''}>${s}</option>`).join('')}
        </select></div>
        <div class="rma-form-full" style="background:#fffbf0;border:1px dashed #f9a825;padding:8px;border-radius:6px;">
          <label style="display:flex;align-items:center;gap:8px;">
            PJ NO (관련 수주)
            <span style="font-size:0.78em;color:#888;font-weight:400;">— 입력 시 자동완성 · 정확한 일치 시 모델·제조사·고객사·수량 자동 채움</span>
          </label>
          <div style="display:flex;gap:6px;align-items:stretch;">
            <input data-field="pjNo" value="${_ea(r.pjNo)}" placeholder="PJ NO 입력 (예: BR-260141)"
                   list="rma-pjno-list" autocomplete="off"
                   oninput="if(window.returns&&window.returns._onPjNoInput)window.returns._onPjNoInput()"
                   onchange="if(window.returns&&window.returns._onPjNoInput)window.returns._onPjNoInput()"
                   style="flex:1;">
            <button type="button" class="rma-btn rma-btn-ghost" style="padding:6px 12px;" onclick="if(window.returns&&window.returns._onPjNoInput)window.returns._onPjNoInput(true)">조회</button>
          </div>
          <datalist id="rma-pjno-list">${pjnoOptions}</datalist>
          <div id="rma-pjno-info" style="margin-top:6px;font-size:0.84em;display:none;border-radius:5px;padding:6px 10px;"></div>
        </div>
        <div><label>출고지시서 (해당 시)</label><input data-field="doId" value="${_ea(r.doId)}"></div>
        <div><label>모델명</label><input data-field="model" value="${_ea(r.model)}"></div>
        <div><label>제조사</label><input data-field="mfr" value="${_ea(r.mfr)}"></div>
        <div><label>수량</label><input data-field="qty" type="number" value="${r.qty||0}"></div>
        <div><label>사유</label><select data-field="reason">
          ${REASONS.map(rs => `<option value="${rs}" ${rs===r.reason?'selected':''}>${rs}</option>`).join('')}
        </select></div>
        <div class="rma-form-full"><label>${r.type === 'inbound' ? '반품 고객사' : '반품 매입사'}</label><input data-field="customerOrVendor" value="${_ea(r.customerOrVendor)}"></div>
        <div class="rma-form-full"><label>비고 / 처리 메모</label><textarea data-field="notes" rows="3">${_e(r.notes)}</textarea></div>
      </div>`;
    document.getElementById('rma-bd').innerHTML = html;
  }

  // ── PJ NO 입력 → 수주현황에서 매칭 → 빈칸 자동 채움 ──────────
  //   force=true 면 비어있지 않은 필드도 덮어씀 ([조회] 버튼 동작)
  function _onPjNoInput(force) {
    const inp = document.querySelector('#rma-form [data-field="pjNo"]');
    if (!inp) return;
    const pjNo = (inp.value || '').trim();
    const info = document.getElementById('rma-pjno-info');
    if (!info) return;

    if (!pjNo) {
      info.style.display = 'none';
      return;
    }

    let orders = [];
    try { orders = (typeof getEnriched === 'function') ? getEnriched() : []; } catch(e) {}
    // 정확 일치 우선 → 없으면 부분 일치
    const q = pjNo.toLowerCase();
    const exact = orders.find(o => (o.pjNo||'').trim().toLowerCase() === q);
    const partial = exact ? null : orders.filter(o => (o.pjNo||'').toLowerCase().includes(q)).slice(0, 5);

    if (exact) {
      info.style.display = 'block';
      info.style.background = '#e8f5e9';
      info.style.color = '#1b5e20';
      info.innerHTML = `<strong>✓ 매칭:</strong> ${_e(exact.pjNo)} · ${_e(exact.고객사||'-')} · ${_e(exact.모델명||'-')} · 수량 ${exact.수량||0}매`;
      // 빈 필드(또는 force) 자동 채움
      const fillIfEmpty = (field, value) => {
        const el = document.querySelector(`#rma-form [data-field="${field}"]`);
        if (!el) return;
        if (force || !el.value || el.value === '0') {
          if (value !== undefined && value !== null && value !== '') el.value = value;
        }
      };
      fillIfEmpty('model', exact.모델명 || '');
      fillIfEmpty('mfr', exact.제조사 || '');
      fillIfEmpty('qty', exact.수량 || 0);
      // 구분(type)에 따라 적절한 곳에 채움
      const typeEl = document.querySelector('#rma-form [data-field="type"]');
      const typeVal = typeEl ? typeEl.value : 'inbound';
      // inbound (고객 반품) → 고객사 / outbound (매입사 반품) → 매입사
      const candidate = (typeVal === 'inbound') ? (exact.고객사 || '') : (exact.매입사 || '');
      fillIfEmpty('customerOrVendor', candidate);
      // 출고지시서 ID
      if (exact.deliveryOrderId) fillIfEmpty('doId', exact.deliveryOrderId);
    } else if (partial && partial.length > 0) {
      info.style.display = 'block';
      info.style.background = '#fff8e1';
      info.style.color = '#5d4037';
      info.innerHTML = `<strong>유사 PJ NO:</strong> ${partial.map(o => `<a href="#" onclick="document.querySelector('#rma-form [data-field=&quot;pjNo&quot;]').value='${_ea(o.pjNo)}';window.returns._onPjNoInput(true);return false;" style="color:#1565c0;font-weight:700;margin-right:6px;text-decoration:underline;">${_e(o.pjNo)}</a>`).join(' / ')}`;
    } else {
      info.style.display = 'block';
      info.style.background = '#ffebee';
      info.style.color = '#c62828';
      info.innerHTML = `<strong>⚠️ 매칭 없음:</strong> "${_e(pjNo)}" — 수주현황에서 PJ NO를 다시 확인하세요`;
    }
  }

  function _collectForm() {
    const data = {};
    document.querySelectorAll('#rma-form [data-field]').forEach(el => {
      const k = el.getAttribute('data-field');
      const v = el.value;
      data[k] = (k === 'qty') ? Number(v)||0 : v;
    });
    return data;
  }

  function _saveFromForm(id) {
    const data = _collectForm();
    if (!data.model) { alert('모델명 입력 필요'); return; }
    if (!data.qty || data.qty <= 0) { alert('수량은 1 이상'); return; }
    if (id) {
      update(id, data);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 반품 ${data.no} 수정`);
    } else {
      const r = add(data);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 반품 ${r.no} 등록`);
    }
    _renderList();
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');

    if (act === 'rma-new') _renderEditor(null);
    else if (act === 'rma-back') _renderList();
    else if (act === 'rma-view') _renderEditor(id);
    else if (act === 'rma-save') _saveFromForm(id || null);
    else if (act === 'rma-process') {
      update(id, { status: '처리중' });
      if (typeof setBanner === 'function') setBanner('ok', '⏩ 처리중으로 변경');
      _renderList();
    }
    else if (act === 'rma-complete') {
      const dispOpts = ['완료', '폐기', '재판매'];
      const sel = prompt(`최종 처리 상태를 선택하세요:\n1. 완료 (정상 처리)\n2. 폐기 (사용 불가)\n3. 재판매 (재고 복귀)\n\n번호 입력 (1~3):`, '1');
      if (!sel) return;
      const idx = parseInt(sel) - 1;
      if (idx < 0 || idx > 2) { alert('잘못된 선택'); return; }
      const status = dispOpts[idx];
      complete(id, { status });
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${status} 처리 완료`);
      _renderList();
    }
    else if (act === 'rma-inv') {
      if (!confirm('이 반품을 재고(inventoryData)에 반영하시겠습니까?\n반품입고는 +수량, 반품출고는 -수량으로 등록됩니다.')) return;
      try {
        const inv = applyToInventory(id);
        if (inv && typeof setBanner === 'function')
          setBanner('ok', `📦 재고 반영 완료 (${inv.type} ${inv.qty}매)`);
        _renderList();
      } catch (err) { alert('재고 반영 실패: ' + err.message); }
    }
    else if (act === 'rma-delete') {
      if (!confirm('반품 건을 삭제하시겠습니까?\n(연결된 inventory 항목은 그대로 남습니다)')) return;
      remove(id);
      _renderList();
      // ★ 2026-05-13 live_refresh 트리거 (다른 탭의 데이터까지 갱신)
      if (window.erpLiveRefresh && window.erpLiveRefresh.trigger) {
        window.erpLiveRefresh.trigger('returns:delete');
      }
      if (typeof setBanner === 'function') setBanner('ok', '🗑 반품 건 삭제 완료');
    }
    // ★ 일괄 액션 핸들러
    else if (act === 'rma-bulk-view')     _bulkView();
    else if (act === 'rma-bulk-process')  _bulkProcess();
    else if (act === 'rma-bulk-complete') _bulkComplete();
    else if (act === 'rma-bulk-inv')      _bulkInv();
    else if (act === 'rma-bulk-delete')   _bulkDelete();
  }

  function open() {
    _injectUI();
    document.getElementById('erp-rma-modal').classList.add('open');
    setTimeout(_renderList, 30);
  }
  function close() { document.getElementById('erp-rma-modal')?.classList.remove('open'); }

  // ── 공개 API ─────────────────────────────────────
  window.returns = {
    list, get, add, update, remove,
    complete, applyToInventory, summary,
    open, close, reload: load,
    _onPjNoInput,
    _toggleAllSel, _updateSelInfo, _viewById,
    _bulkView, _bulkProcess, _bulkComplete, _bulkInv, _bulkDelete,
    TYPES, REASONS, STATUSES
  };

  // ── 탭 마운트 (returns 탭으로 전환된 경우 box 를 host 로 이동) ─
  function _mountToTab(){
    const host = document.getElementById('returnsTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-rma-modal');
    if (!modal) {
      // 모달 아직 안 만들어졌으면 즉시 생성
      try { _injectUI(); } catch(e){ console.error('[returns] _injectUI 실패:', e); return; }
      modal = document.getElementById('erp-rma-modal');
      if (!modal) return;
    }
    const box = modal.querySelector('.rma-box');
    if (!box) return;
    // 모달 자체는 숨김 처리 (display:none)
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (!host.contains(box)) {
      host.appendChild(box);
      // 탭 환경에 맞게 모달 스타일 제거
      box.style.maxHeight = 'none';
      box.style.width = '100%';
      box.style.maxWidth = '100%';
      box.style.boxShadow = 'none';
      box.style.borderRadius = '12px';
    }
    setTimeout(_renderList, 30);
  }

  function _hookShowTabForReturns(){
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTabForReturns, 300); return; }
    if (window.showTab.__returnsHooked) return;
    const orig = window.showTab;
    window.showTab = function(id){
      const r = orig.apply(this, arguments);
      if (id === 'returns') setTimeout(_mountToTab, 30);
      return r;
    };
    window.showTab.__returnsHooked = true;
  }

  // open() 호출 시에도 탭으로 이동하도록 외부 API 오버라이드
  const _origOpen = window.returns.open;
  window.returns.open = function(){
    if (typeof showTab === 'function' && document.getElementById('tab-returns')) {
      showTab('returns');
    } else if (typeof _origOpen === 'function') {
      _origOpen();
    }
  };

  // ── 부팅 ────────────────────────────────────────
  function boot() { load(); setTimeout(_injectUI, 800); setTimeout(_hookShowTabForReturns, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-RT] 반품/RMA 모듈 활성 — 탭(showTab("returns")) 또는 returns.open()');
})();
