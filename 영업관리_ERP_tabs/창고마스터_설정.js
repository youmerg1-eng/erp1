// =====================================================
//  설정 → 창고 마스터 (2026-08 추가)
//
//  창고 목록을 설정 화면에서 바로 등록·수정·삭제한다.
//  데이터는 기존 창고 마스터 모듈(window.warehouseMaster, key: erp_warehouses)을
//  그대로 사용하므로 "창고 사업 → 창고 마스터" 탭과 항상 같은 목록을 본다.
//  (도면·구역(zone) 편집은 기존 창고 마스터 탭에서 계속 진행)
//
//  여기 등록한 창고는 입고등록·재고수정 화면의 창고 선택 목록에 즉시 반영된다.
//
//  공개 API : window.whSetting
// =====================================================
(function () {
  'use strict';

  const HOST_ID = 'warehouseMasterSettingHost';

  function _e(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v)
      : String(v == null ? '' : v).replace(/[<>&"]/g, ch => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[ch]));
  }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v == null ? '' : v).replace(/["'&]/g, ''); }
  function _fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function _wm() { return (typeof window.warehouseMaster !== 'undefined') ? window.warehouseMaster : null; }

  let _editId = null;

  //  창고별 현재 보관 수량 (inventoryData 기준 — 창고명 또는 "창고 · 구역" 접두 매칭)
  function _stockOf(name) {
    if (typeof inventoryData === 'undefined' || !name) return 0;
    return inventoryData.reduce((s, r) => {
      const w = String(r.warehouse || '').trim();
      if (!w) return s;
      if (w !== name && w.indexOf(name + ' ·') !== 0) return s;
      return s + (r.type === '입고' ? 1 : -1) * (Number(r.qty) || 0);
    }, 0);
  }

  function render() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const wm = _wm();
    if (!wm) {
      host.innerHTML = '<div class="card"><div class="card-body"><div class="empty">창고 마스터 모듈을 불러오지 못했습니다.</div></div></div>';
      return;
    }
    const list = wm.list().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));

    const rows = list.length ? list.map(w => {
      if (w.id === _editId) {
        return `<tr style="background:#fffde7;">
          <td><input id="whs-edit-name" type="text" value="${_ea(w.name)}" style="width:100%;min-width:140px;padding:4px 7px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;font-weight:700;"></td>
          <td><input id="whs-edit-addr" type="text" value="${_ea(w.address)}" placeholder="주소" style="width:100%;min-width:180px;padding:4px 7px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;"></td>
          <td style="text-align:right;"><input id="whs-edit-area" type="number" value="${w.totalArea || ''}" placeholder="0" style="width:90px;padding:4px 6px;border:1.5px solid #f9a825;border-radius:6px;font-size:0.9em;text-align:right;"></td>
          <td class="center">${(w.zones || []).length}</td>
          <td class="num">${_fmt(_stockOf(w.name))}</td>
          <td class="center" style="white-space:nowrap;">
            <button class="btn btn-xs btn-success" onclick="whSetting.save('${_ea(w.id)}')">저장</button>
            <button class="btn btn-xs btn-outline" onclick="whSetting.cancel()">취소</button>
          </td>
        </tr>`;
      }
      return `<tr>
        <td style="font-weight:700;">${_e(w.name)}</td>
        <td style="color:#666;font-size:0.9em;">${_e(w.address) || '<span style="color:#ccc;">-</span>'}</td>
        <td style="text-align:right;color:#888;">${w.totalArea ? _fmt(w.totalArea) + 'm²' : '<span style="color:#ccc;">-</span>'}</td>
        <td class="center">${(w.zones || []).length ? `<span class="tag blue" style="font-size:0.76em;">${(w.zones || []).length}구역</span>` : '<span style="color:#ccc;">-</span>'}</td>
        <td class="num" style="font-weight:700;color:${_stockOf(w.name) > 0 ? '#1565c0' : '#bbb'};">${_fmt(_stockOf(w.name))}</td>
        <td class="center" style="white-space:nowrap;">
          <button class="btn btn-xs btn-dark" onclick="whSetting.edit('${_ea(w.id)}')" title="수정">✏️</button>
          <button class="btn btn-xs btn-red" onclick="whSetting.remove('${_ea(w.id)}')">삭제</button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">등록된 창고가 없습니다. 위 폼에서 창고명을 입력해 등록하세요.</td></tr>';

    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>창고 마스터</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="tag purple">입고·재고 창고 선택 목록</span>
            <button class="btn btn-xs btn-outline" onclick="if(typeof showTab==='function')showTab('warehouse_master')" title="도면 업로드와 구역(zone) 편집은 창고 마스터 탭에서">🗺 도면·구역 관리</button>
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;padding:10px;background:#fafbfc;border-radius:8px;">
            <div style="display:flex;flex-direction:column;gap:2px;">
              <label style="font-size:0.72em;color:#888;font-weight:700;">창고명 *</label>
              <input id="whs-new-name" type="text" placeholder="예: 광주창고" style="min-width:180px;"
                     onkeydown="if(event.key==='Enter')whSetting.add()">
            </div>
            <div style="display:flex;flex-direction:column;gap:2px;">
              <label style="font-size:0.72em;color:#888;font-weight:700;">주소</label>
              <input id="whs-new-addr" type="text" placeholder="예: 광주 광산구 …" style="min-width:220px;">
            </div>
            <div style="display:flex;flex-direction:column;gap:2px;">
              <label style="font-size:0.72em;color:#888;font-weight:700;">면적(m²)</label>
              <input id="whs-new-area" type="number" placeholder="예: 1200" style="width:110px;">
            </div>
            <button class="btn btn-success btn-sm" onclick="whSetting.add()">등록</button>
          </div>
          <div style="max-height:340px;overflow-y:auto;border:1px solid #eef0f4;border-radius:8px;">
            <table style="margin:0;">
              <thead><tr style="position:sticky;top:0;background:#1a1a2e;color:#fff;z-index:1;">
                <th>창고명</th><th>주소</th><th style="text-align:right;">면적</th>
                <th style="text-align:center;">구역</th>
                <th style="text-align:right;">현재 보관</th>
                <th style="text-align:center;">수정 · 삭제</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div style="font-size:0.8em;color:#888;margin-top:8px;line-height:1.7;">
            · 여기 등록한 창고는 <strong>입고 등록 · 재고 수정</strong> 화면의 창고 선택 목록에 바로 나타납니다.<br>
            · 구역(zone)을 만들면 <code>창고명 · 구역명</code> 형태로도 선택할 수 있습니다 — 구역 편집은 <strong>🗺 도면·구역 관리</strong> 에서.<br>
            · <strong>현재 보관</strong> 은 입출고 이력 기준 수량입니다.
          </div>
        </div>
      </div>`;
  }

  function add() {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('창고 등록')) return;
    const wm = _wm(); if (!wm) return;
    const name = (document.getElementById('whs-new-name')?.value || '').trim();
    if (!name) { alert('창고명은 필수입니다.'); return; }
    if (wm.list().some(w => String(w.name || '').trim() === name)) {
      alert(`"${name}" 은(는) 이미 등록된 창고입니다.`); return;
    }
    wm.add({
      name,
      address: (document.getElementById('whs-new-addr')?.value || '').trim(),
      totalArea: parseFloat(document.getElementById('whs-new-area')?.value) || 0
    });
    ['whs-new-name', 'whs-new-addr', 'whs-new-area'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    render();
    if (typeof setBanner === 'function') setBanner('ok', `✅ 창고 등록: ${name}`);
  }

  function edit(id) {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('창고 수정')) return;
    _editId = id;
    render();
    setTimeout(() => { const el = document.getElementById('whs-edit-name'); if (el) { el.focus(); el.select(); } }, 20);
  }
  function cancel() { _editId = null; render(); }

  function save(id) {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('창고 수정')) return;
    const wm = _wm(); if (!wm) return;
    const before = wm.get(id);
    if (!before) { _editId = null; render(); return; }
    const name = (document.getElementById('whs-edit-name')?.value || '').trim();
    if (!name) { alert('창고명은 필수입니다.'); return; }
    if (wm.list().some(w => w.id !== id && String(w.name || '').trim() === name)) {
      alert(`"${name}" 은(는) 이미 등록된 창고입니다.`); return;
    }
    const oldName = String(before.name || '').trim();
    wm.update(id, {
      name,
      address: (document.getElementById('whs-edit-addr')?.value || '').trim(),
      totalArea: parseFloat(document.getElementById('whs-edit-area')?.value) || 0
    });
    // 창고명이 바뀌면 입출고 이력의 창고명도 함께 정리할지 확인
    let moved = 0;
    if (oldName && oldName !== name && typeof inventoryData !== 'undefined') {
      const hit = inventoryData.filter(r => {
        const w = String(r.warehouse || '').trim();
        return w === oldName || w.indexOf(oldName + ' ·') === 0;
      });
      if (hit.length && confirm(`창고명이 "${oldName}" → "${name}" 으로 변경되었습니다.\n`
        + `기존 입출고 이력 ${hit.length}건의 창고명도 함께 바꿀까요?\n\n`
        + `[확인] 이력도 변경  /  [취소] 이력은 그대로 둠`)) {
        hit.forEach(r => {
          const w = String(r.warehouse || '').trim();
          r.warehouse = (w === oldName) ? name : name + w.slice(oldName.length);
          moved++;
        });
        if (typeof saveLocal === 'function') saveLocal();
      }
    }
    _editId = null;
    render();
    if (typeof _refreshOutboundViews === 'function') _refreshOutboundViews();
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ 창고 수정: ${name}` + (moved ? ` · 입출고 이력 ${moved}건 창고명 변경` : ''));
  }

  function remove(id) {
    if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('창고 삭제')) return;
    const wm = _wm(); if (!wm) return;
    const w = wm.get(id);
    if (!w) return;
    const stock = _stockOf(w.name);
    const zones = (w.zones || []).length;
    if (!confirm(`창고 "${w.name}" 을(를) 삭제합니까?\n`
      + (zones ? `· 등록된 구역 ${zones}개도 함께 삭제됩니다.\n` : '')
      + (stock ? `· ⚠️ 현재 보관 수량 ${_fmt(stock)}매가 있습니다. 입출고 이력은 지워지지 않고 창고명만 남습니다.\n` : '')
      + `\n이 작업은 되돌릴 수 없습니다.`)) return;
    wm.remove(id);
    if (_editId === id) _editId = null;
    render();
    if (typeof setBanner === 'function') setBanner('ok', `🗑 창고 삭제: ${w.name}`);
  }

  window.whSetting = { render, add, edit, cancel, save, remove };

  console.log('[ERP-WH-SET] 설정 창고 마스터 활성 — 설정 → 제품·창고 마스터');
})();

// =====================================================
//  창고 선택 드롭다운 — 입고등록 · 재고수정 공용 (2026-08 추가)
//   창고 마스터 목록 + 기존 입출고 이력에 등장한 창고를 합쳐 보여주고,
//   목록에 없는 창고는 "✏️ 직접 입력…" 으로 입력할 수 있다.
//   값은 기존과 동일하게 <input id="{prefix}-warehouse"> 에 담긴다 (저장 코드 변경 없음).
// =====================================================
function warehouseOptionList() {
  const set = new Set();
  try {
    if (window.warehouseMaster && typeof warehouseMaster.list === 'function') {
      warehouseMaster.list().forEach(w => {
        if (w.name) set.add(String(w.name).trim());
        (w.zones || []).forEach(z => { if (z.name) set.add(`${String(w.name).trim()} · ${String(z.name).trim()}`); });
      });
    }
  } catch (e) {}
  // 마스터에 없지만 기존 이력에 쓰인 창고도 선택할 수 있게 포함
  if (typeof inventoryData !== 'undefined' && Array.isArray(inventoryData)) {
    inventoryData.forEach(r => { if (r.warehouse) set.add(String(r.warehouse).trim()); });
  }
  set.delete('');
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}
window.warehouseOptionList = warehouseOptionList;

function fillWarehouseSelect(prefix, current) {
  const sel = document.getElementById(prefix + '-warehouse-sel');
  const inp = document.getElementById(prefix + '-warehouse');
  if (!sel || !inp) return;
  const names = warehouseOptionList();
  const cur = String((current == null ? inp.value : current) || '').trim();
  const esc = (v) => (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v).replace(/["'&]/g, '');
  const escH = (v) => (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v);
  const opts = ['<option value="">(미지정)</option>'];
  if (cur && names.indexOf(cur) < 0) opts.push(`<option value="${esc(cur)}">${escH(cur)}</option>`);
  names.forEach(n => opts.push(`<option value="${esc(n)}">${escH(n)}</option>`));
  opts.push('<option value="__custom__">✏️ 직접 입력…</option>');
  sel.innerHTML = opts.join('');
  sel.value = cur;
  inp.value = cur;
  inp.style.display = 'none';
}
window.fillWarehouseSelect = fillWarehouseSelect;

function onWarehouseSelectChange(prefix) {
  const sel = document.getElementById(prefix + '-warehouse-sel');
  const inp = document.getElementById(prefix + '-warehouse');
  if (!sel || !inp) return;
  if (sel.value === '__custom__') {
    inp.style.display = '';
    inp.value = '';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = sel.value;
  }
}
window.onWarehouseSelectChange = onWarehouseSelectChange;
