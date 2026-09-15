// =====================================================
//  DELIVERY ORDER (출고지시서)
// =====================================================

// ── PLT 자동 분할 계산 ─────────────────────────────────
//   productMaster[model].plt = 1팔레트당 수량
//   반환: { pltSize, pltCount, looseQty, pltQty, total, hasMaster }
function _calcPltSplit(model, totalQty) {
  const m = (model || '').trim();
  const total = Math.max(0, parseInt(totalQty) || 0);
  const rec = productMaster[m];
  const pltSize = rec && rec.plt ? parseInt(rec.plt) || 0 : 0;
  if (!pltSize || total <= 0) {
    return { pltSize: 0, pltCount: 0, looseQty: total, pltQty: 0, total, hasMaster: !!pltSize };
  }
  const pltCount = Math.floor(total / pltSize);
  const looseQty = total - pltCount * pltSize;
  return { pltSize, pltCount, looseQty, pltQty: pltCount * pltSize, total, hasMaster: true };
}

// ── 분할 결과를 사람이 읽는 문자열로 ───────────────────
//   예: "3PLT(90매) + 소분 5매 = 총 95매"  /  "총 95매 (PLT 미등록)"
function _formatPltBreakdown(model, totalQty, opts) {
  const inline = opts && opts.inline;   // true → 한 줄 단축형
  const r = _calcPltSplit(model, totalQty);
  if (!r.hasMaster) {
    return inline ? `${fmt(r.total)}매` : `📦 총 ${fmt(r.total)}매 <span style="color:#999;">(제품 마스터 PLT 미등록)</span>`;
  }
  if (r.pltCount === 0) {
    return inline ? `소분 ${fmt(r.looseQty)}매` : `📦 소분 ${fmt(r.looseQty)}매 <span style="color:#888;">(1PLT=${r.pltSize}매 기준)</span>`;
  }
  if (r.looseQty === 0) {
    return inline ? `${r.pltCount}PLT(${fmt(r.pltQty)}매)` : `📦 <strong>${r.pltCount}PLT</strong>(${fmt(r.pltQty)}매) <span style="color:#888;">— 1PLT=${r.pltSize}매 · 정수배</span>`;
  }
  if (inline) return `${r.pltCount}PLT(${fmt(r.pltQty)}매) + 소분 ${fmt(r.looseQty)}매`;
  return `📦 <strong>${r.pltCount}PLT</strong>(${fmt(r.pltQty)}매) + <strong>소분 ${fmt(r.looseQty)}매</strong> = 총 ${fmt(r.total)}매 <span style="color:#888;">(1PLT=${r.pltSize}매)</span>`;
}

// 출고지시서 모달 — 모델·수량·FOC 입력 시 실시간 PLT 분할 표시
function updateDoQtyBreakdown() {
  const model = (document.getElementById('do-model')?.value || '').trim();
  const qty   = parseInt(document.getElementById('do-qty')?.value)   || 0;
  const foc   = parseInt(document.getElementById('do-foc')?.value)   || 0;
  const total = qty + foc;
  const el    = document.getElementById('do-qty-breakdown');
  if (!el) return;
  if (!model || total <= 0) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const r = _calcPltSplit(model, total);
  if (!r.hasMaster) {
    el.style.display = 'block';
    el.style.borderColor = '#999';
    el.style.background = '#f5f5f5';
    el.style.color = '#777';
    el.innerHTML = `⚠️ <strong>${model}</strong> 의 1PLT 수량이 제품 마스터에 등록되지 않았습니다 — 설정 탭에서 등록하면 자동 분할됩니다.`;
    return;
  }
  el.style.display = 'block';
  el.style.borderColor = '#1565c0';
  el.style.background = '#f0f8ff';
  el.style.color = '#1565c0';
  el.innerHTML = `${_formatPltBreakdown(model, total)}${foc > 0 ? `<span style="color:#888;font-size:0.92em;"> · 수주수량 ${fmt(qty)}매 + FOC ${fmt(foc)}매</span>` : ''}`;
}

// 모델명으로 재고가 가장 많이 남아있는 창고를 자동 제안
function suggestWarehouseForModel(model) {
  if (!model) return '';
  const whMap = {};
  inventoryData.forEach(r => {
    if (!r.warehouse || (r.model || '').trim() !== model.trim()) return;
    if (!whMap[r.warehouse]) whMap[r.warehouse] = 0;
    whMap[r.warehouse] += r.type === '입고' ? (r.qty || 0) : -(r.qty || 0);
  });
  // 재고가 있는(>0) 창고 중 수량이 가장 많은 것
  const best = Object.entries(whMap).filter(([,q]) => q > 0).sort((a,b) => b[1]-a[1])[0];
  return best ? best[0] : '';
}

function openDeliveryOrderModal(pjNo, rowId) {
  // ★ 2026-08: 매입사 게이트 — 광주창고 계열·탑솔라 물량만 출고지시서 발행 가능
  //   (수주에서 진입한 경우만 검사. PJ 없이 여는 신규 작성은 통과)
  if (pjNo && typeof canCreateDO === 'function' && typeof getEnriched === 'function') {
    const _o = rowId ? getEnriched().find(x => x._id === rowId) : getEnriched().find(x => x.pjNo === pjNo);
    if (_o && !canCreateDO(_o)) {
      alert('🚫 출고지시서를 생성할 수 없습니다.\n\n' + (typeof doBlockReason === 'function' ? doBlockReason(_o) : ''));
      return;
    }
  }
  const doNo = 'DO-' + new Date().getFullYear() + '-' + String(deliveryOrders.length+1).padStart(4,'0');
  document.getElementById('do-no').value = doNo;
  document.getElementById('do-date').value = todayStr();
  const doRowIdEl = document.getElementById('do-row-id');
  if (doRowIdEl) doRowIdEl.value = rowId || '';

  if (pjNo) {
    const o = rowId ? getEnriched().find(x => x._id === rowId) : getEnriched().find(x => x.pjNo === pjNo);
    if (o) {
      document.getElementById('do-pjno').value = pjNo;
      document.getElementById('do-receiver').value = o.고객사;
      document.getElementById('do-plant').value = o.발전소명;
      document.getElementById('do-address').value = o.납품주소;
      document.getElementById('do-mfr').value = o.제조사;
      document.getElementById('do-model').value = o.모델명;
      document.getElementById('do-watt').value = o.제품용량;
      document.getElementById('do-qty').value = o.수량;
      document.getElementById('do-foc').value = 0;
      document.getElementById('do-site-mgr').value = o.인수담당자 || o.추가정보 || '';
      // 창고 자동 제안: 해당 모델 재고가 있는 창고 우선 채우기
      const whEl = document.getElementById('do-warehouse');
      if (whEl) whEl.value = suggestWarehouseForModel(o.모델명);
    }
  } else {
    ['do-pjno','do-receiver','do-plant','do-address','do-mfr','do-model','do-watt',
     'do-warehouse','do-site-mgr','do-vehicle','do-remarks','do-manager','do-approver'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('do-qty').value = '';
    document.getElementById('do-foc').value = 0;
  }

  // 설정에 등록된 출고담당/승인자 기본값 자동 채움 (사용자가 비워뒀을 때만)
  try {
    const mgrEl = document.getElementById('do-manager');
    const aprEl = document.getElementById('do-approver');
    const compEl = document.getElementById('do-company');
    if (mgrEl && !mgrEl.value && appSettings.defaultManager) mgrEl.value = appSettings.defaultManager;
    if (aprEl && !aprEl.value && appSettings.defaultApprover) aprEl.value = appSettings.defaultApprover;
    if (compEl && !compEl.value && appSettings.companyName) compEl.value = appSettings.companyName;
  } catch(e) {}

  openModal('deliveryOrderModal');
  // PLT 분할 표시 초기 갱신
  setTimeout(() => { if (typeof updateDoQtyBreakdown === 'function') updateDoQtyBreakdown(); }, 50);
}

function createDeliveryOrder() {
  const doNo = document.getElementById('do-no').value;
  const pjNo = document.getElementById('do-pjno').value;
  const qty = parseInt(document.getElementById('do-qty').value)||0;
  const foc = parseInt(document.getElementById('do-foc').value)||0;
  if (!doNo || !qty) { alert('출고지시서 번호와 수량을 입력하세요.'); return; }

  const rowId = document.getElementById('do-row-id')?.value || '';
  const modelName = document.getElementById('do-model').value;
  const totalQty = qty + foc;
  // PLT 분할(소분) 자동 계산 — 제품 마스터의 1PLT 수량 기준
  const plt = _calcPltSplit(modelName, totalQty);
  const order = {
    id: doNo, pjNo, rowId, date: document.getElementById('do-date').value,
    receiver: document.getElementById('do-receiver').value,
    plant: document.getElementById('do-plant').value,
    address: document.getElementById('do-address').value,
    mfr: document.getElementById('do-mfr').value,
    model: modelName,
    watt: document.getElementById('do-watt').value,
    qty, foc, totalQty,
    pltSize: plt.pltSize,
    pltCount: plt.pltCount,
    looseQty: plt.looseQty,
    pltQty: plt.pltQty,
    warehouse: (document.getElementById('do-warehouse')?.value || '').trim(),
    vehicle: document.getElementById('do-vehicle').value,
    siteMgr: document.getElementById('do-site-mgr').value,
    remarks: document.getElementById('do-remarks').value,
    manager: document.getElementById('do-manager').value,
    approver: document.getElementById('do-approver').value,
    companyName: document.getElementById('do-company').value,
    createdAt: new Date().toISOString()
  };

  _persistDeliveryOrder(order, { rowId, pjNo });
  saveLocal();
  renderOrders();
  renderDashboard();
  if (typeof renderStockTab === 'function') renderStockTab();
  if (typeof renderInventory === 'function') renderInventory();
  closeModal('deliveryOrderModal');
  setBanner('ok', `✅ 출고지시서 ${doNo} 생성 완료 — 재고 ${fmt(order.qty)}매 차감${order.vehicle?' · 🚚 배차일정 자동 등록':''}`);
  showDeliveryPreview(order);
}

// =====================================================
//  출고지시서 1건 저장 코어 (2026-08 분리)
//   deliveryOrders 등록 + 수주 meta 연결 + 재고 출고 반영
//   + 분할출고 연동 + 배차일정 등록
//   단건 생성(createDeliveryOrder) 과 일괄 생성이 함께 사용한다.
//   ※ 저장(saveLocal)·화면 갱신은 호출부 책임
// =====================================================
function _persistDeliveryOrder(order, ctx) {
  ctx = ctx || {};
  const doNo = order.id;
  const rowId = ctx.rowId || order.rowId || '';
  const pjNo = ctx.pjNo || order.pjNo || '';
  const silent = !!ctx.silent;

  deliveryOrders.push(order);
  const metaKey = rowId || pjNo;
  if (metaKey) {
    if (!localMeta[metaKey]) localMeta[metaKey] = {};
    localMeta[metaKey].deliveryOrderId = doNo;
  }

  // ── 재고관리 자동 출고 반영 ────────────────────────────────────
  // 출고지시서 생성 시 재고에 '출고' 레코드 자동 추가
  if (order.model) {
    inventoryData.push({
      id: 'OB-DO-' + doNo,
      type: '출고',
      date: order.date,
      model: order.model,
      qty: order.qty,
      mfr: order.mfr || '',
      pjNo: order.pjNo || '',
      warehouse: order.warehouse || '',
      bl: '',
      remarks: `출고지시서 자동반영 (${doNo})`
    });
  }
  // ────────────────────────────────────────────────────────────

  // ── 분할출고 자동 연동 ──────────────────────────────────────
  // 출고지시서를 생성한 PJ NO가 분할출고로 등록된 경우 → 자동으로 분할출고 이력에 추가(대기)
  const splitMetaKey = rowId || rawData.find(r => String(r['PJ NO']||'').trim() === pjNo)?._id;
  if (splitMetaKey && localMeta[splitMetaKey] && localMeta[splitMetaKey].splitRegistered) {
    if (!localMeta[splitMetaKey].splits) localMeta[splitMetaKey].splits = [];
    const round = localMeta[splitMetaKey].splits.length + 1;
    const splitId = 'SL-' + splitMetaKey + '-' + Date.now();
    localMeta[splitMetaKey].splits.push({
      id: splitId,
      date: order.date,
      qty: order.qty,
      note: `${round}차 출고 (지시서: ${doNo})`,
      processed: false,
      doId: doNo,
      round
    });
    if (!silent) setBanner('ok', `📦 분할출고 ${round}차 자동 등록 — ${order.qty}매 (${doNo})`);
  }
  // ────────────────────────────────────────────────────────────

  // ── 배차일정 자동 등록 (원가관리 모듈) ─────────────────────
  //  do-vehicle 입력값에서 차량 정보를 파싱해 해당 월 배차일정에 추가
  try {
    if (order.vehicle && order.date) {
      const ym = order.date.slice(0, 7); // YYYY-MM
      const KEY_SCH = 'erp_cost_schedule';
      let sch = {};
      try { sch = JSON.parse(localStorage.getItem(KEY_SCH) || '{}') || {}; } catch(e) {}
      if (!sch[ym]) sch[ym] = [];
      // 차량 대수 파싱 (예: "2.5t × 2", "5t 1대", "2" 등)
      const vt = String(order.vehicle).trim();
      const vMatch = vt.match(/[×x*]\s*(\d+)|(\d+)\s*대|^(\d+)$/i);
      const vehicles = vMatch ? parseInt(vMatch[1]||vMatch[2]||vMatch[3]) || 1 : 1;
      // PLT (소수 표현 가능)
      const plt = order.pltCount ? (order.pltCount + (order.looseQty>0?0.5:0)) : 0;
      sch[ym].push({
        id: 'SCH-DO-' + doNo,
        date: order.date,
        vehicles: vehicles,
        plt: plt,
        qty: order.totalQty || order.qty || 0,
        note: `${order.pjNo||'-'} ${order.model||''} (${order.vehicle}) [지시서: ${doNo}]`,
        _doId: doNo
      });
      localStorage.setItem(KEY_SCH, JSON.stringify(sch));
      // 원가관리 화면이 열려있으면 즉시 갱신
      if (window.costMgmt && typeof window.costMgmt.refresh === 'function') {
        setTimeout(() => { try { window.costMgmt.refresh(); } catch(e){} }, 50);
      }
    }
  } catch(e) { console.warn('[createDeliveryOrder] 배차일정 자동 등록 실패:', e); }
  // ────────────────────────────────────────────────────────────

  return order;
}


// =====================================================
//  출고지시서 일괄 생성 (2026-08 추가)
//   수주현황에서 체크박스로 여러 건을 고르고 "출고지시서 생성" 을 누르면
//   각 건에 대해 출고지시서를 한 번에 발행한다.
//   · 매입사가 광주창고·탑솔라 계열인 건만 대상 (canCreateDO)
//   · 이미 지시서가 있는 건 · 완료/취소 건은 자동 제외
//   · 수량 = 수주수량 − 기발행 지시서 수량 (잔량)
//   · 창고는 해당 모델 재고가 가장 많은 곳으로 자동 지정
//   상세 정보(차량·비고 등)가 필요하면 생성 후 개별 지시서에서 수정하세요.
// =====================================================
function _nextDoNo(taken) {
  const year = new Date().getFullYear();
  let n = deliveryOrders.length + 1, id;
  do {
    id = 'DO-' + year + '-' + String(n).padStart(4, '0');
    n++;
  } while (deliveryOrders.some(d => d.id === id) || (taken && taken.has(id)));
  return id;
}

function _issuedQtyOf(o) {
  return deliveryOrders
    .filter(d => (o._id && d.rowId === o._id) || (o.pjNo && d.pjNo === o.pjNo))
    .reduce((a, d) => a + (Number(d.qty) || 0) + (Number(d.foc) || 0), 0);
}

function createSelectedDeliveryOrders() {
  if (typeof blockIfReadOnly === 'function' && blockIfReadOnly('출고지시서 일괄 생성')) return;
  const cbs = document.querySelectorAll('.order-row-cb:checked');
  if (!cbs.length) { alert('출고지시서를 생성할 수주를 체크박스로 선택하세요.'); return; }
  const ids = [...cbs].map(cb => cb.getAttribute('data-id')).filter(Boolean);
  const enriched = getEnriched();
  const picked = ids.map(id => enriched.find(x => x._id === id)).filter(Boolean);

  const DONE = ['납품완료', '수금완료', '취소', '출고취소'];
  const skipDone    = picked.filter(o => DONE.includes(o.status || ''));
  const rest1       = picked.filter(o => !DONE.includes(o.status || ''));
  const skipExist   = rest1.filter(o => o.deliveryOrderId && deliveryOrders.some(d => d.id === o.deliveryOrderId));
  const rest2       = rest1.filter(o => !skipExist.includes(o));
  const skipVendor  = rest2.filter(o => typeof canCreateDO === 'function' && !canCreateDO(o));
  const rest3       = rest2.filter(o => !skipVendor.includes(o));
  const todo        = rest3.map(o => ({ o, qty: (Number(o.수량) || 0) - _issuedQtyOf(o) }))
                           .filter(x => x.qty > 0);
  const skipQty     = rest3.length - todo.length;

  if (!todo.length) {
    alert('생성 가능한 건이 없습니다.\n\n'
      + (skipDone.length   ? `· 완료/취소 상태 ${skipDone.length}건\n` : '')
      + (skipExist.length  ? `· 이미 출고지시서 있음 ${skipExist.length}건\n` : '')
      + (skipVendor.length ? `· 출고 대상 아닌 매입사 ${skipVendor.length}건\n` : '')
      + (skipQty           ? `· 잔여수량 없음 ${skipQty}건\n` : ''));
    return;
  }

  const totalQty = todo.reduce((a, x) => a + x.qty, 0);
  const preview = todo.slice(0, 5).map(x => `· ${x.o.pjNo} ${x.o.모델명} ${fmt(x.qty)}매`).join('\n');
  if (!confirm(`출고지시서 ${todo.length}건을 일괄 생성할까요? (총 ${fmt(totalQty)}매)\n\n`
    + `${preview}${todo.length > 5 ? `\n· 외 ${todo.length - 5}건` : ''}\n\n`
    + `출고일은 오늘(${todayStr()}), 창고는 재고가 있는 곳으로 자동 지정됩니다.\n`
    + `생성 즉시 재고에서 차감됩니다.\n`
    + (skipDone.length   ? `\n제외 — 완료/취소 ${skipDone.length}건` : '')
    + (skipExist.length  ? `\n제외 — 지시서 기발행 ${skipExist.length}건` : '')
    + (skipVendor.length ? `\n제외 — 출고 대상 아님 ${skipVendor.length}건` : '')
    + (skipQty           ? `\n제외 — 잔여수량 없음 ${skipQty}건` : ''))) return;

  const today = todayStr();
  const taken = new Set();
  const created = [];
  todo.forEach(({ o, qty }) => {
    const doNo = _nextDoNo(taken);
    taken.add(doNo);
    const plt = _calcPltSplit(o.모델명, qty);
    const order = {
      id: doNo, pjNo: o.pjNo, rowId: o._id, date: today,
      receiver: o.고객사 || '', plant: o.발전소명 || '', address: o.납품주소 || '',
      mfr: o.제조사 || '', model: o.모델명 || '', watt: o.제품용량 || '',
      qty, foc: 0, totalQty: qty,
      pltSize: plt.pltSize, pltCount: plt.pltCount, looseQty: plt.looseQty, pltQty: plt.pltQty,
      warehouse: (typeof suggestWarehouseForModel === 'function') ? suggestWarehouseForModel(o.모델명) : '',
      // ★ 2026-08: 비고는 비워 둔다 — 인수증·출고지시서 비고란에 그대로 인쇄되므로
      //   생성 방식은 화면에 찍지 않고 _bulkCreated 플래그로만 남긴다.
      vehicle: '', siteMgr: o.인수담당자 || '', remarks: '',
      _bulkCreated: true,
      manager: appSettings.defaultManager || '',
      approver: appSettings.defaultApprover || '',
      companyName: appSettings.companyName || '',
      createdAt: new Date().toISOString()
    };
    _persistDeliveryOrder(order, { rowId: o._id, pjNo: o.pjNo, silent: true });
    created.push(doNo);
  });

  saveLocal();
  document.querySelectorAll('.order-row-cb:checked').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('orderSelectAll'); if (sa) sa.checked = false;
  renderOrders();
  renderDashboard();
  if (typeof showDeliveryList === 'function') { try { showDeliveryList(); } catch (e) {} }
  if (typeof renderSplitTab === 'function') { try { renderSplitTab(); } catch (e) {} }
  if (typeof _refreshOutboundViews === 'function') _refreshOutboundViews();
  else { if (typeof renderStockTab === 'function') renderStockTab(); if (typeof renderInventory === 'function') renderInventory(); }

  console.log('[BULK-DO] 일괄 생성:', created.join(', '));
  setBanner('ok', `✅ 출고지시서 ${created.length}건 일괄 생성 (${fmt(totalQty)}매 재고 차감) — ${created[0]}${created.length > 1 ? ` 외 ${created.length - 1}건` : ''}`);
}
window.createSelectedDeliveryOrders = createSelectedDeliveryOrders;

// =====================================================
//  기존 데이터 정리 (2026-08) — 일괄 생성분의 비고 '일괄 생성' 제거
//   해당 문구가 인수증·출고지시서 비고란에 그대로 인쇄되던 문제.
//   앱 로드 시 1회만 수행하며, 사용자가 직접 적은 비고는 건드리지 않는다.
// =====================================================
function _cleanupBulkRemarks() {
  if (typeof deliveryOrders === 'undefined' || !Array.isArray(deliveryOrders)) return 0;
  let n = 0;
  deliveryOrders.forEach(d => {
    if (String(d.remarks || '').trim() === '일괄 생성') {
      d.remarks = '';
      d._bulkCreated = true;
      n++;
    }
  });
  if (n > 0) {
    try { if (typeof saveLocal === 'function') saveLocal(); } catch (e) {}
    console.log('[BULK-DO] 기존 출고지시서 ' + n + '건의 비고 "일괄 생성" 제거');
  }
  return n;
}
window._cleanupBulkRemarks = _cleanupBulkRemarks;
if (typeof document !== 'undefined') {
  const _cb = () => setTimeout(_cleanupBulkRemarks, 1500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _cb);
  else _cb();
}
function showDeliveryPreview(order) {
  _currentPreviewDoId = order.id;
  const company = order.companyName || appSettings.companyName || '(주)영업관리';

  // 전자결재 렌더 헬퍼
  const signBoxHtml = (role, roleName, signerName, signData) => {
    if (signData) {
      return `<div class="do-sign-box">
        <div class="do-sign-title">${roleName}</div>
        <div style="background:#e3f2fd;border:2px solid #1565c0;border-radius:7px;padding:8px 4px;text-align:center;margin:8px 0;">
          <div style="font-size:1.1em;color:#1565c0;font-weight:900;">✅ 전자서명</div>
          <div style="font-size:0.85em;font-weight:700;color:#1a1a2e;margin-top:2px;">${signData.name}</div>
          <div style="font-size:0.72em;color:#888;margin-top:1px;">${signData.signedAt}</div>
        </div>
        <div class="do-sign-line">${signerName||'&nbsp;'}</div>
        <button onclick="revokeDeliverySign('${order.id}','${role}')" class="btn btn-xs btn-gray" style="margin-top:6px;font-size:0.72em;">서명 취소</button>
      </div>`;
    }
    return `<div class="do-sign-box">
      <div class="do-sign-title">${roleName}</div>
      <div style="height:44px;"></div>
      <div class="do-sign-line">${signerName||'&nbsp;'}</div>
      <button onclick="openSignModal('${order.id}','${role}')" class="btn btn-xs btn-blue" style="margin-top:6px;font-size:0.78em;">✍️ 전자결재</button>
    </div>`;
  };

  const html = `
    <div class="do-wrap" id="doContent" data-do-id="${order.id}">
      <div style="text-align:right;font-size:0.78em;color:#999;margin-bottom:8px;">No. ${order.id}</div>
      <div class="do-company">${company}</div>
      <div class="do-title">출 고 지 시 서</div>
      <div class="do-subtitle">DELIVERY ORDER</div>
      <div class="do-meta-grid">
        <div class="do-meta-item"><span class="do-meta-label">출고일자</span><span class="do-meta-value">${order.date}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">PJ NO</span><span class="do-meta-value">${order.pjNo||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">수신처</span><span class="do-meta-value"><strong>${order.receiver}</strong></span></div>
        <div class="do-meta-item"><span class="do-meta-label">발전소명</span><span class="do-meta-value">${order.plant||'-'}</span></div>
        <div class="do-meta-item" style="grid-column:1/-1;"><span class="do-meta-label">납품주소</span><span class="do-meta-value">${order.address||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">차량번호</span><span class="do-meta-value">${order.vehicle||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">현장담당자</span><span class="do-meta-value">${order.siteMgr||'-'}</span></div>
      </div>
      <div class="sec-title" style="margin-bottom:10px;">📦 출고 품목 내역</div>
      <table class="do-table">
        <thead><tr><th>No</th><th>제조사</th><th>모델명</th><th>제품용량</th><th>수량(매)</th><th>FOC(매)</th><th>합계(매)</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>${order.mfr}</td>
            <td class="left" style="font-weight:700;">${order.model}</td>
            <td>${order.watt}W</td>
            <td style="font-weight:800;font-size:1.1em;">${fmt(order.qty)}</td>
            <td>${order.foc||0}</td>
            <td style="font-weight:800;color:#1a1a2e;">${fmt(order.totalQty)}</td>
          </tr>
          <tr>
            <td colspan="4" style="background:#fafbfc;"></td>
            <td colspan="3" style="text-align:center;font-size:0.88em;color:#1565c0;background:#f0f8ff;font-weight:700;">${_formatPltBreakdown(order.model, order.totalQty, {inline:true})}</td>
          </tr>
        </tbody>
      </table>
      ${order.remarks ? `<div style="font-size:0.84em;color:#555;padding:10px 12px;background:#fffde7;border-radius:6px;margin-bottom:14px;border-left:3px solid #f9a825;"><strong>비고:</strong> ${order.remarks}</div>` : ''}
      <div style="font-size:0.8em;color:#888;text-align:center;margin:10px 0;padding:8px;background:#fff8e1;border-radius:6px;">
        ⚠️ 본 출고지시서 확인 후 제품을 수령하시기 바랍니다. 수령 후 이상 발생 시 즉시 연락 바랍니다.
      </div>
      <div class="do-sign-row">
        ${signBoxHtml('manager', '담당자 (출고)', order.manager, order.managerSign)}
        ${signBoxHtml('approver', '확인 (내부)', order.approver, order.approverSign)}
        <div class="do-sign-box">
          <div class="do-sign-title">수령 확인 (현장)</div>
          <div style="height:44px;"></div>
          <div class="do-sign-line">서명: ____________</div>
        </div>
      </div>
    </div>`;

  document.getElementById('deliveryPrintArea').innerHTML = html;
  document.getElementById('deliveryListArea').style.display = 'none';
  document.getElementById('deliveryPreviewArea').style.display = 'block';
}

// =====================================================
//  전자결재 (Digital Signature)
// =====================================================
function openSignModal(doId, role) {
  const roleLabel = role === 'manager' ? '담당자 (출고)' : '확인 (내부)';
  const existing = document.getElementById('signModal');
  if (existing) existing.remove();

  const order = deliveryOrders.find(x => x.id === doId);
  const defaultName = role === 'manager' ? (order?.manager || '') : (order?.approver || '');

  const modalHtml = `<div id="signModal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:3000;display:flex;align-items:center;justify-content:center;">
    <div style="background:white;border-radius:14px;padding:28px;min-width:340px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 6px;color:#1a1a2e;font-size:1.05em;">✍️ 전자결재 — ${roleLabel}</h3>
      <p style="margin:0 0 18px;color:#666;font-size:0.84em;">서명자 성명을 입력하면 현재 일시로 전자서명이 등록됩니다.</p>
      <div style="margin-bottom:14px;">
        <label style="font-size:0.85em;font-weight:700;color:#333;display:block;margin-bottom:5px;">서명자 성명</label>
        <input type="text" id="signNameInput" value="${defaultName}" placeholder="성명 입력"
          style="width:100%;padding:10px 12px;border:1.5px solid #ced4da;border-radius:8px;font-size:1em;">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button onclick="document.getElementById('signModal').remove()"
          style="padding:9px 20px;border:1.5px solid #adb5bd;border-radius:7px;background:white;cursor:pointer;font-size:0.9em;color:#555;">취소</button>
        <button onclick="confirmDeliverySign('${doId}','${role}')"
          style="padding:9px 22px;border:none;border-radius:7px;background:#1a1a2e;color:white;cursor:pointer;font-size:0.9em;font-weight:600;">✅ 서명 확인</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  setTimeout(() => document.getElementById('signNameInput')?.focus(), 50);
}

function confirmDeliverySign(doId, role) {
  const name = (document.getElementById('signNameInput')?.value || '').trim();
  if (!name) { alert('서명자 성명을 입력하세요.'); return; }
  const order = deliveryOrders.find(x => x.id === doId);
  if (!order) { alert('출고지시서를 찾을 수 없습니다.'); return; }
  const signedAt = new Date().toLocaleString('ko-KR', { year:'2-digit', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  const signKey = role === 'manager' ? 'managerSign' : 'approverSign';
  order[signKey] = { name, signedAt };
  saveLocal();
  document.getElementById('signModal')?.remove();
  const roleLabel = role === 'manager' ? '담당자(출고)' : '확인(내부)';
  setBanner('ok', `✅ ${roleLabel} 전자결재 완료 — ${name} (${signedAt})`);
  showDeliveryPreview(order);
}

function revokeDeliverySign(doId, role) {
  if (!confirm('전자서명을 취소하시겠습니까?')) return;
  const order = deliveryOrders.find(x => x.id === doId);
  if (!order) return;
  const signKey = role === 'manager' ? 'managerSign' : 'approverSign';
  delete order[signKey];
  saveLocal();
  setBanner('ok', '✅ 전자서명 취소 완료');
  showDeliveryPreview(order);
}

// 목록 필터 상태 (pending | done | all)
let _deliveryListFilter = 'pending';

function setDeliveryListFilter(f) {
  _deliveryListFilter = f;
  showDeliveryList();
}

function showDeliveryList() {
  document.getElementById('deliveryPreviewArea').style.display = 'none';
  document.getElementById('deliveryListArea').style.display = 'block';

  const pendingCount = deliveryOrders.filter(d => !d.processed).length;
  const doneCount = deliveryOrders.filter(d => d.processed).length;
  const allCount = deliveryOrders.length;
  const f = _deliveryListFilter || 'pending';

  const tabBtn = (key, label, cnt) => {
    const active = key === f;
    return `<button onclick="setDeliveryListFilter('${key}')"
      style="padding:8px 18px;border:none;border-bottom:3px solid ${active?'#1a1a2e':'transparent'};
        background:transparent;cursor:pointer;font-size:0.92em;font-weight:${active?'700':'500'};
        color:${active?'#1a1a2e':'#888'};">${label} <span style="color:#bbb;">(${cnt})</span></button>`;
  };
  const tabsHtml = `<div style="display:flex;gap:6px;border-bottom:1px solid #e0e0e0;margin-bottom:14px;">
    ${tabBtn('pending','📦 대기', pendingCount)}
    ${tabBtn('done','✅ 출고완료', doneCount)}
    ${tabBtn('all','📋 전체', allCount)}
  </div>`;

  let rows = [...deliveryOrders].reverse();
  if (f === 'pending') rows = rows.filter(d => !d.processed);
  else if (f === 'done') rows = rows.filter(d => d.processed);

  if (!deliveryOrders.length) {
    document.getElementById('deliveryListArea').innerHTML = tabsHtml +
      '<div class="alert alert-info">생성된 출고지시서가 없습니다. "새 출고지시서" 버튼 또는 수주현황에서 생성하세요.</div>';
    return;
  }
  if (!rows.length) {
    const msg = f==='pending' ? '대기중인 출고지시서가 없습니다.' :
                f==='done'    ? '출고완료된 출고지시서가 없습니다.' :
                                '데이터가 없습니다.';
    document.getElementById('deliveryListArea').innerHTML = tabsHtml +
      `<div class="alert alert-info">${msg}</div>`;
    return;
  }

  const renderSign = (sg, label) => sg && sg.name
    ? `<span class="tag green" style="font-size:0.72em;" title="${label} 서명: ${sg.name}${sg.signedAt?' / '+sg.signedAt:''}">✅ ${label} ${sg.name}</span>`
    : `<span class="tag gray" style="font-size:0.72em;color:#999;">⏳ ${label} 미서명</span>`;

  document.getElementById('deliveryListArea').innerHTML = tabsHtml + `
    <div id="doBulkActionBar" style="display:none;background:#f0f7ff;border:1px solid #cfe2ff;border-radius:8px;padding:10px 14px;margin-bottom:10px;align-items:center;gap:8px;">
      <span style="font-size:0.86em;color:#1565c0;font-weight:700;">선택된 <span id="doSelCnt">0</span>건</span>
      <span style="color:#aaa;">|</span>
      <button class="btn btn-xs btn-success" onclick="bulkDeliveryProcess()">🚚 출고처리</button>
      <button class="btn btn-xs btn-danger" onclick="bulkDeliveryDelete()">🗑 삭제</button>
      <button class="btn btn-xs btn-outline" onclick="bulkDeliveryReceipt()">📄 인수증</button>
      <span class="spacer" style="flex:1;"></span>
      <button class="btn btn-xs btn-ghost" onclick="document.querySelectorAll('.do-row-cb').forEach(cb=>cb.checked=false);updateDoBulkBar();">× 선택 해제</button>
    </div>
    <div style="margin-bottom:8px;font-size:0.82em;color:#666;">
      💡 체크박스로 복수 선택 시 상단에 일괄 액션 버튼이 나타납니다.
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th style="width:32px;"><input type="checkbox" onclick="document.querySelectorAll('.do-row-cb').forEach(cb=>cb.checked=this.checked);updateDoBulkBar();"></th>
        <th>출고지시서 번호</th><th>PJ NO</th><th>출고일</th><th>수신처</th><th>발전소명</th><th>모델명</th><th>수량</th><th>상태</th><th>승인 (서명)</th>
      </tr></thead>
      <tbody>${rows.map(d => `<tr>
        <td style="text-align:center;"><input type="checkbox" class="do-row-cb" data-id="${d.id}" onchange="updateDoBulkBar()"></td>
        <td><strong style="cursor:pointer;color:#1565c0;text-decoration:underline;" onclick="showDeliveryPreview(deliveryOrders.find(x=>x.id==='${d.id}'))">${d.id}</strong></td>
        <td>${d.pjNo||'-'}</td><td>${d.date}</td>
        <td>${d.receiver}</td><td>${d.plant||'-'}</td>
        <td style="font-size:0.82em;">${d.model}</td>
        <td style="font-size:0.82em;">
          <strong>${fmt(d.totalQty)}매</strong>
          <div style="font-size:0.85em;color:#1565c0;margin-top:2px;">${_formatPltBreakdown(d.model, d.totalQty, {inline:true})}</div>
        </td>
        <td>${d.processed ? '<span class="tag green">✅ 출고완료</span>' : '<span class="tag">대기</span>'}</td>
        <td style="font-size:0.78em;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${renderSign(d.managerSign, '담당자')}
            ${renderSign(d.approverSign, '확인')}
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  // 초기 일괄 액션 바 상태
  updateDoBulkBar();
}

// 일괄 액션 바 — 체크된 개수 갱신
function updateDoBulkBar() {
  const cnt = document.querySelectorAll('.do-row-cb:checked').length;
  const bar = document.getElementById('doBulkActionBar');
  const cntEl = document.getElementById('doSelCnt');
  if (cntEl) cntEl.textContent = cnt;
  if (bar) bar.style.display = cnt > 0 ? 'flex' : 'none';
}

// 미리보기에서 출고처리 — 현재 미리보기 중인 출고지시서를 처리
function processDeliveryFromPreview() {
  const id = _currentPreviewDoId;
  if (!id) { alert('미리보기 중인 출고지시서가 없습니다.'); return; }
  const d = deliveryOrders.find(x => x.id === id);
  if (!d) { alert('출고지시서를 찾을 수 없습니다.'); return; }
  if (d.processed) { alert('이미 출고처리 완료된 건입니다.'); return; }
  processDelivery(id);
}
window.processDeliveryFromPreview = processDeliveryFromPreview;

// 일괄 출고처리
function bulkDeliveryProcess() {
  const ids = [...document.querySelectorAll('.do-row-cb:checked')].map(cb => cb.getAttribute('data-id'));
  if (!ids.length) { alert('선택된 항목이 없습니다.'); return; }
  const pending = ids.filter(id => {
    const d = deliveryOrders.find(x => x.id === id);
    return d && !d.processed;
  });
  if (!pending.length) { alert('이미 출고완료된 항목만 선택되었습니다.'); return; }
  if (!confirm(`${pending.length}건을 일괄 출고처리합니까?`)) return;
  let done = 0;
  pending.forEach((id, idx) => {
    try { processDelivery(id, {skipConfirm:true, skipRender:true, skipSave: idx < pending.length-1}); done++; }
    catch(e) { console.error('processDelivery 실패:', id, e); }
  });
  if (typeof setBanner === 'function') setBanner('ok', `✅ ${done}건 일괄 출고처리 완료`);
  showDeliveryList();
}

// 일괄 삭제
function bulkDeliveryDelete() {
  const ids = [...document.querySelectorAll('.do-row-cb:checked')].map(cb => cb.getAttribute('data-id'));
  if (!ids.length) { alert('선택된 항목이 없습니다.'); return; }
  if (!confirm(`선택된 ${ids.length}건의 출고지시서를 삭제합니까?\n연결된 재고 출고 레코드도 함께 정리됩니다.`)) return;
  let done = 0;
  ids.forEach(id => {
    try { deleteDeliveryOrder(id, true); done++; } catch(e) { console.error('deleteDeliveryOrder 실패:', id, e); }
  });
  if (typeof setBanner === 'function') setBanner('ok', `🗑 ${done}건 일괄 삭제 완료`);
  showDeliveryList();
}

// 일괄 인수증 — 기존 printSelectedReceipts 재활용
function bulkDeliveryReceipt() {
  if (typeof printSelectedReceipts === 'function') printSelectedReceipts();
  else alert('인수증 출력 함수를 찾을 수 없습니다.');
}

// ★ 2026-05 추가: 출고지시서와 연관된 inventory 출고 레코드를 모두 찾아 정리.
//   기존엔 'OB-DO-${id}' 정확 매칭만 했지만, 분할출고·수동 등록·구버전 데이터로
//   동일한 출고 건이 다른 ID 패턴으로 남아있을 수 있음.
//   이제 다음 4가지 패턴 모두 정리:
//     1. id === 'OB-DO-${doId}'                        (자동 생성, 정확 매칭)
//     2. id.startsWith('OB-DO-${doId}-')              (분할출고 suffix, 예: OB-DO-D001-1)
//     3. type === '출고' && remarks 에 doId 포함
//     4. type === '출고' && pjNo 일치 + model 일치 + ±2일 이내 (백업 매칭)
function _cleanupInventoryForDO(doId, d) {
  if (typeof inventoryData === 'undefined') return 0;
  const before = inventoryData.length;
  const safePjNo = d?.pjNo || '';
  const safeModel = d?.model || '';
  const safeDate = d?.date || '';

  inventoryData = inventoryData.filter(r => {
    if (r.type !== '출고') return true;        // 출고 타입만 검사
    // 1. 정확 매칭
    if (r.id === 'OB-DO-' + doId) return false;
    // 2. 분할출고 suffix (OB-DO-D001-1, OB-DO-D001-2 등)
    if (r.id && r.id.startsWith('OB-DO-' + doId + '-')) return false;
    // 3. remarks 에 doId 명시
    if (r.remarks && r.remarks.includes(doId)) return false;
    // 4. 백업 매칭 — pjNo + model + 같은 날짜 (자동 생성된 레코드가 ID 변형됐을 경우)
    if (safePjNo && safeModel && safeDate
        && r.pjNo === safePjNo
        && r.model === safeModel
        && r.date === safeDate
        && r.remarks && /출고지시서.*자동반영/.test(r.remarks)) {
      return false;
    }
    return true;
  });
  return before - inventoryData.length;
}

function deleteDeliveryOrder(id, skipConfirm) {
  const d = deliveryOrders.find(x => x.id === id);
  if (!d) {
    if (!skipConfirm) alert('출고지시서 ' + id + ' 를 찾을 수 없습니다.');
    return;
  }
  // 사전 미리보기 — 정리될 inventory 개수 표시 (일괄 삭제 시 스킵)
  if (!skipConfirm && !confirm(
    `출고지시서 ${id} 를 삭제합니까?\n` +
    `· PJ NO: ${d.pjNo || '-'}\n` +
    `· 모델: ${d.model || '-'} · 수량: ${(d.totalQty||0).toLocaleString()}매\n` +
    `· 처리 상태: ${d.processed ? '✅ 출고완료' : '대기'}\n\n` +
    `연결된 재고 출고 레코드도 함께 삭제되며, 수주 상태는 "출고취소"로 변경됩니다.`
  )) return;

  // 1. 메타데이터 정리 — 출고지시서 삭제 시 항상 수주상태를 '출고취소'로 변경
  const metaKey = d.rowId || d.pjNo;
  if (metaKey) {
    if (!localMeta[metaKey]) localMeta[metaKey] = {};
    delete localMeta[metaKey].deliveryOrderId;
    localMeta[metaKey].status = '출고취소';
    // 납품일 초기화 (원상 복구)
    delete localMeta[metaKey].납품일;
  }

  // 2. inventory 출고 레코드 정리 (4-tier 매칭)
  const removed = _cleanupInventoryForDO(id, d);

  // 3. rawData 의 납품일 컬럼도 비움
  if (typeof rawData !== 'undefined') {
    const row = rawData.find(r => r._id === d.rowId || String(r['PJ NO']||'').trim() === d.pjNo);
    if (row && row['납품일']) {
      row['납품일'] = '';
      try { localStorage.setItem('erp_raw', JSON.stringify(rawData)); } catch (e) {}
    }
  }

  // 4. 출고지시서 자체 삭제
  deliveryOrders = deliveryOrders.filter(x => x.id !== id);
  saveLocal();
  renderOrders();
  renderDashboard();
  if (typeof renderStockTab === 'function') renderStockTab();
  if (typeof renderInventory === 'function') renderInventory();
  if (typeof _refreshOutboundViews === 'function') _refreshOutboundViews();   // ★ 출고관리 출고 이력·모델별 분석 동기 갱신
  showDeliveryList();

  if (typeof setBanner === 'function')
    setBanner('ok', `✅ 출고지시서 ${id} 삭제 완료 — 재고 출고 레코드 ${removed}건 정리, 수량 복구됨`);
}

// 콘솔에서 수동으로 정리 가능하게 노출
window._cleanupInventoryForDO = _cleanupInventoryForDO;

function printDeliveryOrder() {
  // Opens a standalone popup — only DO prints (no full-page issue)
  // Korean characters render correctly via UTF-8 charset in popup
  const doIdFromEl = document.getElementById('doContent')?.getAttribute('data-do-id');
  const id = doIdFromEl || _currentPreviewDoId;
  const order = id ? deliveryOrders.find(x => x.id === id) : deliveryOrders[deliveryOrders.length-1];
  if (!order) { alert('미리보기를 먼저 열어주세요.'); return; }
  openDeliveryOrderPopup(order);
}

function pdfDeliveryOrder() {
  // PDF 저장 = 인쇄 팝업에서 PDF로 저장
  printDeliveryOrder();
  setBanner('info', '💡 팝업 인쇄 화면에서 "PDF로 저장"을 선택하세요.');
}

// 현재 미리보기 중인 출고지시서 ID 추적
let _currentPreviewDoId = null;

function openDeliveryOrderPopup(order) {
  const company = order.companyName || appSettings.companyName || '(주)영업관리';
  const managerSignHtml = order.managerSign
    ? `<div class="sign-stamp">✅ ${order.managerSign.name}<br><span style="font-size:0.72em;color:#888;">${order.managerSign.signedAt}</span></div>`
    : '<div style="height:44px;"></div>';
  const approverSignHtml = order.approverSign
    ? `<div class="sign-stamp">✅ ${order.approverSign.name}<br><span style="font-size:0.72em;color:#888;">${order.approverSign.signedAt}</span></div>`
    : '<div style="height:44px;"></div>';

  const css = `
    @page{size:A4 portrait;margin:10mm}
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{font-family:"맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-size:13px;color:#111;background:#fff;}
    .no-print{padding:12px 16px;background:#f5f5f5;text-align:center;border-bottom:1px solid #ddd;}
    .do-wrap{width:100%;max-width:700px;margin:0 auto;padding:14px;}
    .do-top-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;}
    .do-company{font-size:1.1em;font-weight:800;color:#1a1a2e;letter-spacing:1px;}
    .do-no{font-size:0.78em;color:#999;}
    .do-title{font-size:2em;font-weight:900;text-align:center;letter-spacing:6px;color:#1a1a2e;margin:6px 0 4px;}
    .do-subtitle{text-align:center;font-size:0.85em;color:#888;letter-spacing:4px;margin-bottom:18px;}
    .do-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1.5px solid #1a1a2e;margin-bottom:18px;}
    .do-meta-item{padding:7px 12px;border:1px solid #ddd;display:flex;gap:8px;align-items:flex-start;}
    .do-meta-label{font-weight:700;color:#888;font-size:0.82em;min-width:70px;white-space:nowrap;}
    .do-meta-value{font-size:0.88em;color:#222;word-break:break-all;}
    .do-table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:0.9em;}
    .do-table th{background:#1a1a2e;color:#fff;padding:8px 6px;text-align:center;font-size:0.82em;}
    .do-table td{border:1px solid #ccc;padding:8px 6px;text-align:center;}
    .do-table td.left{text-align:left;padding-left:10px;}
    .do-sign-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px;}
    .do-sign-box{border:1.5px solid #ccc;border-radius:8px;padding:12px;text-align:center;min-height:100px;}
    .do-sign-title{font-size:0.82em;font-weight:700;color:#555;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:8px;}
    .do-sign-line{font-size:0.82em;color:#888;margin-top:8px;padding-top:8px;border-top:1px solid #eee;}
    .sign-stamp{color:#1565c0;font-weight:700;font-size:0.88em;line-height:1.4;padding:8px 4px;border:2px solid #1565c0;border-radius:6px;background:#e3f2fd;}
    @media print{.no-print{display:none!important}}
    @media screen{body{background:#f0f0f0;}.do-wrap{background:white;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);}}`;

  const html = `<!DOCTYPE html><html lang="ko"><head>
    <meta charset="UTF-8"><title>출고지시서 ${order.id}</title>
    <style>${css}</style></head><body>
    <div class="no-print">
      <button onclick="window.print()" style="padding:10px 30px;font-size:15px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-right:10px;">🖨️ 인쇄 / PDF 저장</button>
      <button onclick="window.close()" style="padding:10px 20px;font-size:13px;background:#6c757d;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
      <span style="margin-left:16px;font-size:0.82em;color:#888;">💡 PDF 저장: 인쇄 → 대상 = "PDF로 저장"</span>
    </div>
    <div class="do-wrap">
      <div class="do-top-row">
        <div class="do-company">${company}</div>
        <div class="do-no">No. ${order.id}</div>
      </div>
      <div class="do-title">출 고 지 시 서</div>
      <div class="do-subtitle">DELIVERY ORDER</div>
      <div class="do-meta-grid">
        <div class="do-meta-item"><span class="do-meta-label">출고일자</span><span class="do-meta-value">${order.date}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">PJ NO</span><span class="do-meta-value">${order.pjNo||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">수신처</span><span class="do-meta-value"><strong>${order.receiver}</strong></span></div>
        <div class="do-meta-item"><span class="do-meta-label">발전소명</span><span class="do-meta-value">${order.plant||'-'}</span></div>
        <div class="do-meta-item" style="grid-column:1/-1;"><span class="do-meta-label">납품주소</span><span class="do-meta-value">${order.address||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">차량번호</span><span class="do-meta-value">${order.vehicle||'-'}</span></div>
        <div class="do-meta-item"><span class="do-meta-label">현장담당자</span><span class="do-meta-value">${order.siteMgr||'-'}</span></div>
      </div>
      <div style="font-weight:700;font-size:0.9em;color:#1a1a2e;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #1a1a2e;">📦 출고 품목 내역</div>
      <table class="do-table">
        <thead><tr><th>No</th><th>제조사</th><th>모델명</th><th>제품용량</th><th>수량(매)</th><th>FOC(매)</th><th>합계(매)</th></tr></thead>
        <tbody>
          <tr>
            <td>1</td><td>${order.mfr}</td>
            <td class="left" style="font-weight:700;">${order.model}</td>
            <td>${order.watt}W</td>
            <td style="font-weight:800;font-size:1.05em;">${Number(order.qty||0).toLocaleString('ko-KR')}</td>
            <td>${order.foc||0}</td>
            <td style="font-weight:800;">${Number(order.totalQty||0).toLocaleString('ko-KR')}</td>
          </tr>
          <tr>
            <td colspan="4" style="background:#fafbfc;"></td>
            <td colspan="3" style="text-align:center;font-size:0.85em;color:#1565c0;background:#f0f8ff;font-weight:700;">${_formatPltBreakdown(order.model, order.totalQty, {inline:true})}</td>
          </tr>
        </tbody>
      </table>
      ${order.remarks ? `<div style="font-size:0.85em;color:#444;padding:10px 12px;background:#fffde7;border-radius:6px;margin-bottom:14px;border-left:3px solid #f9a825;"><strong>비고:</strong> ${order.remarks}</div>` : ''}
      <div style="font-size:0.78em;color:#888;text-align:center;margin:10px 0;padding:8px;background:#fff8e1;border-radius:6px;">
        ⚠️ 본 출고지시서 확인 후 제품을 수령하시기 바랍니다. 수령 후 이상 발생 시 즉시 연락 바랍니다.
      </div>
      <div class="do-sign-row">
        <div class="do-sign-box">
          <div class="do-sign-title">담당자 (출고)</div>
          ${managerSignHtml}
          <div class="do-sign-line">${order.manager||'&nbsp;'}</div>
        </div>
        <div class="do-sign-box">
          <div class="do-sign-title">확인 (내부)</div>
          ${approverSignHtml}
          <div class="do-sign-line">${order.approver||'&nbsp;'}</div>
        </div>
        <div class="do-sign-box">
          <div class="do-sign-title">수령 확인 (현장)</div>
          <div style="height:44px;"></div>
          <div class="do-sign-line">서명: ____________</div>
        </div>
      </div>
    </div></body></html>`;

  const w = window.open('', '_blank', 'width=760,height=1050');
  if (w) { w.document.write(html); w.document.close(); }
  else { alert('팝업 차단이 해제되어 있어야 합니다.'); }
}

function processDelivery(doId, opts) {
  opts = opts || {};
  const d = deliveryOrders.find(x => x.id === doId);
  if (!d) return false;
  if (!opts.skipConfirm && !confirm(`출고지시서 ${doId} 출고처리 하시겠습니까?\n연결된 수주 상태가 "납품완료"로 변경됩니다.`)) return false;
  const metaKey = d.rowId || d.pjNo;
  if (metaKey) {
    if (!localMeta[metaKey]) localMeta[metaKey] = {};
    localMeta[metaKey].status = '납품완료';
    // ★ 2026-05 추가: 납품일 자동 기록 (출고처리 시점)
    if (!localMeta[metaKey].납품일) {
      localMeta[metaKey].납품일 = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    }
  }
  d.processed = true;
  // ★ 2026-05 추가: rawData 의 납품일 컬럼도 동기화 (utils.js getEnriched 가 raw + meta 모두 참조)
  if (typeof rawData !== 'undefined' && metaKey) {
    const row = rawData.find(r => r._id === d.rowId || String(r['PJ NO']||'').trim() === d.pjNo);
    if (row && !row['납품일']) {
      row['납품일'] = localMeta[metaKey].납품일;
      try { localStorage.setItem('erp_raw', JSON.stringify(rawData)); } catch (e) {}
    }
  }
  if (!opts.skipSave) saveLocal();
  if (!opts.skipRender) {
    renderOrders();
    renderDashboard();
    // ★ 2026-05 변경: "출고완료" 탭으로 자동 전환 제거 — 사용자가 의도하지 않은 탭 이동 방지.
    //   현재 보던 필터(_deliveryListFilter) 그대로 유지.
    //   pending 탭이었으면 처리된 행이 자동으로 사라지는 것이 자연스러움.
    showDeliveryList();
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ ${doId} 출고처리 완료`);
  }
  return true;
}

// ★ 2026-05 추가: 체크박스 다중 선택 → 일괄 출고처리
function processSelectedDeliveries() {
  const cbs = document.querySelectorAll('.do-row-cb:checked');
  if (!cbs.length) { alert('출고처리할 항목을 체크박스로 선택하세요.'); return; }
  const ids = [...cbs].map(cb => cb.getAttribute('data-id')).filter(Boolean);
  if (!ids.length) return;

  // 이미 처리된 건 자동 제외
  const targetIds = ids.filter(id => {
    const d = deliveryOrders.find(x => x.id === id);
    return d && !d.processed;
  });
  const skipCount = ids.length - targetIds.length;

  if (!targetIds.length) {
    alert('선택한 모든 항목이 이미 출고처리됨.');
    return;
  }
  if (!confirm(
    `선택한 ${ids.length}건 중 ${targetIds.length}건을 출고처리하시겠습니까?\n` +
    (skipCount > 0 ? `(이미 처리된 ${skipCount}건은 자동 스킵)\n` : '') +
    `연결된 수주 상태가 모두 "납품완료"로 변경되며, 납품일이 오늘 날짜로 기록됩니다.`
  )) return;

  // 트랜잭션 — 실패 시 롤백 가능하도록 snapshot
  const snapshot = {
    processed: new Map(),         // doId → original processed
    metaStatus: new Map(),        // metaKey → original meta (deep copy)
    deliveredOn: new Map()        // metaKey → original 납품일
  };
  let okCount = 0, failCount = 0;
  const failures = [];

  try {
    targetIds.forEach(id => {
      const d = deliveryOrders.find(x => x.id === id);
      if (!d) return;
      snapshot.processed.set(id, d.processed);
      const metaKey = d.rowId || d.pjNo;
      if (metaKey && typeof localMeta !== 'undefined') {
        snapshot.metaStatus.set(metaKey, localMeta[metaKey] ? { ...localMeta[metaKey] } : null);
        snapshot.deliveredOn.set(metaKey, localMeta[metaKey]?.납품일 || null);
      }
      const result = processDelivery(id, { skipConfirm: true, skipSave: true, skipRender: true });
      if (result) okCount++;
      else { failCount++; failures.push(id); }
    });

    // 한 번에 저장 + 한 번만 렌더 (성능)
    saveLocal();
    renderOrders();
    renderDashboard();
    showDeliveryList();
    if (typeof renderStockTab === 'function') renderStockTab();
    if (typeof renderInventory === 'function') renderInventory();

    if (typeof setBanner === 'function') {
      const msg = `✅ 일괄 출고처리 완료 — ${okCount}건 처리` +
                  (skipCount ? ` (이미 처리된 ${skipCount}건 스킵)` : '') +
                  (failCount ? ` · ⚠️ ${failCount}건 실패` : '');
      setBanner(failCount ? 'warn' : 'ok', msg);
    }
  } catch (err) {
    console.error('[processSelectedDeliveries] 실패, 롤백 시도', err);
    // 롤백
    snapshot.processed.forEach((orig, id) => {
      const d = deliveryOrders.find(x => x.id === id);
      if (d) d.processed = orig;
    });
    snapshot.metaStatus.forEach((orig, metaKey) => {
      if (typeof localMeta !== 'undefined') {
        if (orig) localMeta[metaKey] = orig;
        else delete localMeta[metaKey];
      }
    });
    if (typeof setBanner === 'function')
      setBanner('err', `❌ 일괄 출고처리 실패 — 롤백됨 (${err.message})`);
  }
}
window.processSelectedDeliveries = processSelectedDeliveries;

// =====================================================
//  SPLIT DELIVERY TAB (분할출고 탭)
// =====================================================
function renderSplitTab() {
  // 담당자 필터 갱신
  const sel = document.getElementById('split-f-manager');
  if (sel) {
    const managers = [...new Set(getEnriched().map(o => o.담당자).filter(Boolean))].sort();
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체</option>' + managers.map(m => `<option ${m===cur?'selected':''}>${m}</option>`).join('');
  }
  // 상태 필터 갱신 (active/done)
  const stSel = document.getElementById('split-f-status');
  if (stSel && stSel.options.length <= 1) {
    const cur = stSel.value;
    stSel.innerHTML = `<option value="">전체</option>
      <option value="active" ${cur==='active'?'selected':''}>🟠 진행중</option>
      <option value="done" ${cur==='done'?'selected':''}>✅ 완료</option>`;
  }

  let orders = getEnriched();
  const manager = document.getElementById('split-f-manager')?.value || '';
  const statusF = document.getElementById('split-f-status')?.value || '';
  const viewF   = document.getElementById('split-f-view')?.value || 'registered';
  const search  = (document.getElementById('split-f-search')?.value || '').toLowerCase();
  const pjnoF   = (document.getElementById('split-f-pjno')?.value || '').toLowerCase().trim();
  const modelF  = (document.getElementById('split-f-model')?.value || '').toLowerCase().trim();

  // ── 보기 범위 필터 ──────────────────────────────────────────
  if (viewF === 'registered') {
    orders = orders.filter(o => localMeta[o._id] && localMeta[o._id].splitRegistered === true);
  }

  if (manager) orders = orders.filter(o => o.담당자 === manager);
  if (search)  orders = orders.filter(o => [o.pjNo, o.고객사, o.발전소명, o.모델명].join(' ').toLowerCase().includes(search));
  // ★ PJ NO / 모델명 개별 검색
  if (pjnoF)   orders = orders.filter(o => (o.pjNo||'').toLowerCase().includes(pjnoF));
  if (modelF)  orders = orders.filter(o => (o.모델명||'').toLowerCase().includes(modelF));

  // 분할 정보 계산 — 출고지시서(deliveryOrders) 기준
  const rows = orders.map(o => {
    // 같은 PJ NO의 출고지시서 목록
    const doList    = deliveryOrders.filter(d => d.pjNo === o.pjNo || d.rowId === o._id);
    // 등록 시 입력한 수주수량 우선, 없으면 수주현황 수량
    const totalQty  = (localMeta[o._id] && localMeta[o._id].splitTargetQty) || o.수량 || 0;
    const shippedQty = doList.reduce((a, d) => a + (d.qty || 0), 0);
    const remaining  = totalQty - shippedQty;
    const pct        = totalQty > 0 ? Math.min(100, Math.round(shippedQty / totalQty * 100)) : 0;
    const isDone     = totalQty > 0 && remaining <= 0;
    const doCount    = doList.length;   // 출고 차수
    return { o, doList, doCount, totalQty, shippedQty, remaining, pct, isDone };
  });

  const filtered = statusF === 'active' ? rows.filter(r => !r.isDone)
                 : statusF === 'done'   ? rows.filter(r => r.isDone)
                 : rows;

  const totalOrders  = filtered.length;
  const doneCount    = filtered.filter(r => r.isDone).length;
  const activeCount  = filtered.filter(r => !r.isDone).length;
  const totalShipped = filtered.reduce((a, r) => a + r.shippedQty, 0);

  const stats = document.getElementById('splitTabStats');
  if (stats) stats.innerHTML = `
    <div class="stat s-blue"><div class="stat-lbl">분할출고 등록</div><div class="stat-val">${totalOrders}</div><div class="stat-sub">건</div></div>
    <div class="stat s-orange"><div class="stat-lbl">진행중</div><div class="stat-val">${activeCount}</div><div class="stat-sub">잔여 있음</div></div>
    <div class="stat s-green"><div class="stat-lbl">출고완료</div><div class="stat-val">${doneCount}</div><div class="stat-sub">전량 출고</div></div>
    <div class="stat"><div class="stat-lbl">총 출고수량</div><div class="stat-val">${fmt(totalShipped)}</div><div class="stat-sub">매</div></div>
  `;

  const hint = document.getElementById('splitEmptyHint');
  const tbody = document.getElementById('splitDeliveryTbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">${viewF==='registered' ? '등록된 분할출고가 없습니다. ➕ 분할출고 등록 버튼으로 등록하세요.' : '데이터가 없습니다.'}</td></tr>`;
    if (hint) hint.style.display = viewF==='registered' ? 'block' : 'none';
    if (typeof updateSplitSelCount === 'function') updateSplitSelCount();
    return;
  }
  if (hint) hint.style.display = 'none';

  tbody.innerHTML = filtered.map(({ o, doList, doCount, totalQty, shippedQty, remaining, pct, isDone }) => {
    const barColor = isDone ? 'linear-gradient(90deg,#27ae60,#2ecc71)'
                            : pct >= 50 ? 'linear-gradient(90deg,#3498db,#5dade2)'
                            : 'linear-gradient(90deg,#f39c12,#f1c40f)';
    const bar = `<div style="display:flex;align-items:center;gap:8px;">
      <div style="background:#eef0f4;border-radius:6px;height:10px;flex:1;overflow:hidden;">
        <div style="background:${barColor};height:100%;border-radius:6px;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <span style="font-size:0.78em;color:#555;font-weight:700;min-width:34px;text-align:right;">${pct}%</span>
    </div>`;

    const statusBadgeEl = isDone
      ? '<span class="tag green" style="font-size:0.76em;">✅ 완료</span>'
      : doCount > 0
        ? `<span class="tag" style="font-size:0.76em;background:#e8f5e9;color:#2e7d32;">📦 ${doCount}차 출고</span>`
        : '<span class="tag" style="font-size:0.76em;color:#aaa;background:#f0f0f0;">미출고</span>';

    // ★ 컬럼 순서: ☑ | PJ NO | 고객사 | 모델 | 총수량 | 출고수량 | 잔여수량 | 진행률 | 상태 | 작업
    return `<tr>
      <td class="center"><input type="checkbox" class="split-row-chk" data-id="${o._id}" onchange="if(typeof updateSplitSelCount==='function')updateSplitSelCount()"></td>
      <td><strong style="color:#1a1a2e;cursor:pointer;" onclick="openSplitDeliveryModal('${o._id}')">${o.pjNo}</strong></td>
      <td>${o.고객사||'-'}</td>
      <td style="font-size:0.82em;">${o.모델명||'-'}</td>
      <td class="num" style="font-weight:700;">${fmt(totalQty)}</td>
      <td class="num" style="color:#27ae60;font-weight:700;">${fmt(shippedQty)}</td>
      <td class="num" style="color:${remaining>0?'#e53935':'#aaa'};font-weight:700;">${fmt(remaining)}</td>
      <td>${bar}</td>
      <td class="center">${statusBadgeEl}</td>
      <td class="center">
        <button class="btn btn-xs btn-primary" onclick="openSplitDeliveryModal('${o._id}')" title="출고 이력 보기">📋 내역</button>
        <button class="btn btn-xs btn-ghost" onclick="unregisterSplitDelivery('${o._id}')" title="등록 해제">✕</button>
      </td>
    </tr>`;
  }).join('');
  if (typeof updateSplitSelCount === 'function') updateSplitSelCount();
}

// ── 체크박스 다중 선택 / 일괄 삭제 ───────────────────
function toggleAllSplitSel(checked) {
  document.querySelectorAll('.split-row-chk').forEach(c => { c.checked = !!checked; });
  updateSplitSelCount();
}
window.toggleAllSplitSel = toggleAllSplitSel;

function _getSelectedSplitIds() {
  return [...document.querySelectorAll('.split-row-chk:checked')].map(c => c.dataset.id);
}

function updateSplitSelCount() {
  const total = document.querySelectorAll('.split-row-chk').length;
  const cnt = _getSelectedSplitIds().length;
  const all = document.getElementById('split-sel-all');
  if (all) all.checked = total > 0 && cnt === total;
}
window.updateSplitSelCount = updateSplitSelCount;

function deleteSelectedSplits() {
  const ids = _getSelectedSplitIds();
  if (ids.length === 0) { alert('삭제할 분할출고 항목을 1건 이상 체크해주세요.'); return; }
  if (!confirm(`선택한 ${ids.length}건의 분할출고 등록을 해제하시겠습니까?\n(기존 출고 이력은 유지됩니다)`)) return;
  let n = 0;
  ids.forEach(id => {
    if (localMeta[id]) {
      localMeta[id].splitRegistered = false;
      delete localMeta[id].splitTargetQty;
      n++;
    }
  });
  saveLocal();
  renderSplitTab();
  setBanner('ok', `✅ ${n}건 분할출고 등록 해제 완료`);
}
window.deleteSelectedSplits = deleteSelectedSplits;

function resetSplitFilters() {
  ['split-f-manager','split-f-status','split-f-search','split-f-pjno','split-f-model'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const v = document.getElementById('split-f-view'); if (v) v.value = 'registered';
  renderSplitTab();
}

// 분할 출고내역 모달 — 사진 2번처럼 헤더 + 차수별 테이블 표시
function openSplitDeliveryModal(rowId) {
  const o = getEnriched().find(x => x._id === rowId);
  if (!o) { alert('수주를 찾을 수 없습니다.'); return; }

  const doList = deliveryOrders
    .filter(d => d.pjNo === o.pjNo || d.rowId === o._id)
    .sort((a,b) => (a.date||'').localeCompare(b.date||''));

  const totalQty   = (localMeta[o._id] && localMeta[o._id].splitTargetQty) || o.수량 || 0;
  const shippedQty = doList.reduce((a, d) => a + (d.qty || 0), 0);
  const remaining  = totalQty - shippedQty;

  // 상단 정보 카드
  const info = document.getElementById('splitDeliveryInfoDetail');
  if (info) {
    info.innerHTML = `
      <div><div style="font-size:0.74em;color:#888;margin-bottom:3px;">PJ NO</div><strong style="font-size:1.05em;">${escapeHtml(o.pjNo||'-')}</strong></div>
      <div><div style="font-size:0.74em;color:#888;margin-bottom:3px;">고객사</div><strong style="font-size:1.05em;">${escapeHtml(o.고객사||'-')}</strong></div>
      <div><div style="font-size:0.74em;color:#888;margin-bottom:3px;">수주수량</div><strong style="font-size:1.05em;color:#1a1a2e;">${fmt(totalQty)}매</strong></div>
      <div><div style="font-size:0.74em;color:#888;margin-bottom:3px;">출고완료 / 잔여</div><strong style="font-size:1.05em;"><span style="color:#27ae60;">${fmt(shippedQty)}매</span> / <span style="color:${remaining>0?'#e53935':'#aaa'};">${fmt(remaining)}매</span></strong></div>
    `;
  }

  // 차수별 테이블
  const tbody = document.getElementById('splitDeliveryListDetail');
  if (tbody) {
    if (!doList.length) {
      tbody.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">아직 출고된 차수가 없습니다</div><div class="empty-state-desc">출고지시서 탭에서 출고지시서를 생성하면 자동으로 차수가 등록됩니다.</div></div>`;
    } else {
      tbody.innerHTML = `
        <div class="tbl-wrap" style="box-shadow:none;border-radius:0;background:transparent;">
          <table>
            <thead><tr>
              <th class="center">차수</th>
              <th>출고일</th>
              <th class="num">수량</th>
              <th>발전소명</th>
              <th>납품주소</th>
              <th>지시서 번호</th>
              <th class="center">상태</th>
            </tr></thead>
            <tbody>
              ${doList.map((d, i) => `<tr>
                <td class="center"><strong style="color:#1565c0;">${i+1}차</strong></td>
                <td>${escapeHtml(d.date||'-')}</td>
                <td class="num" style="font-weight:700;color:#27ae60;">${fmt(d.qty||0)}매</td>
                <td>${escapeHtml(d.plant||o.발전소명||'-')}</td>
                <td style="font-size:0.85em;color:#555;">${escapeHtml(d.address||o.납품주소||'-')}</td>
                <td><strong style="color:#1565c0;cursor:pointer;text-decoration:underline;" onclick="closeModal('splitDeliveryModal');showTab('delivery');setTimeout(()=>{const dl=deliveryOrders.find(x=>x.id==='${d.id}');if(dl)showDeliveryPreview(dl);},120);">${escapeHtml(d.id||'-')}</strong></td>
                <td class="center">${d.processed ? '<span class="tag green">✅ 출고완료</span>' : '<span class="tag" style="background:#fff3cd;color:#856404;">⏳ 대기</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  openModal('splitDeliveryModal');
}
window.openSplitDeliveryModal = openSplitDeliveryModal;

// =====================================================
//  분할출고 등록 / 해제
// =====================================================
function openSplitRegisterModal() {
  // 분할출고 탭으로 이동 후 인라인 폼 초기화 + PJ NO 입력란 포커스
  if (typeof showTab === 'function') showTab('splitdelivery');
  setTimeout(() => {
    const inp   = document.getElementById('sreg-pjno-input');
    const qty   = document.getElementById('sreg-qty-input');
    const model = document.getElementById('sreg-model-input');
    const info  = document.getElementById('sreg-info');
    const ri    = document.getElementById('sreg-rowid');
    if (inp)   inp.value   = '';
    if (qty)   qty.value   = '';
    if (model) model.value = '';
    if (info)  { info.style.display = 'none'; info.innerHTML = ''; }
    if (ri)    ri.value    = '';
    if (inp) inp.focus();
  }, 100);
}

// PJ NO 입력 시 수주현황에서 자동 검색
function onSregPjNoInput() {
  const pjNo = ((document.getElementById('sreg-pjno-input') || {}).value || '').trim();
  const info  = document.getElementById('sreg-info');
  const ri    = document.getElementById('sreg-rowid');
  const qtyEl = document.getElementById('sreg-qty-input');

  if (!info || !ri) return;

  if (!pjNo) {
    info.style.display = 'none';
    ri.value = '';
    const modelEl2 = document.getElementById('sreg-model-input');
    if (modelEl2) modelEl2.value = '';
    return;
  }

  // 수주현황에서 PJ NO로 검색 (대소문자 무시)
  const o = getEnriched().find(x => x.pjNo.trim().toLowerCase() === pjNo.toLowerCase());

  if (!o) {
    ri.value = '';
    const modelElErr = document.getElementById('sreg-model-input');
    if (modelElErr) modelElErr.value = '';
    info.style.display = 'block';
    info.style.background = '#fff3f3';
    info.innerHTML = `<span style="color:#e53935;font-size:0.86em;">⚠️ 수주현황에 "${pjNo}" PJ NO가 없습니다. PJ NO를 확인해주세요.</span>`;
    return;
  }

  // 매칭 성공
  ri.value = o._id;
  // 수주수량 자동 채우기 (비어있을 때만)
  if (qtyEl && !qtyEl.value) qtyEl.value = o.수량 || '';
  // 모델명 자동 채우기
  const modelEl = document.getElementById('sreg-model-input');
  if (modelEl) modelEl.value = o.모델명 || '';

  const isReg = localMeta[o._id] && localMeta[o._id].splitRegistered;
  info.style.display = 'block';
  info.style.background = '#f0faf4';
  info.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:0.87em;">
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">고객사</div><strong>${o.고객사||'-'}</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">모델명</div><strong>${o.모델명||'-'}</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">수주수량</div><strong style="color:#1a1a2e;">${fmt(o.수량||0)}매</strong></div>
      <div><div style="font-size:0.75em;color:#888;margin-bottom:2px;">상태</div><strong>${o.status||'수주'}</strong></div>
    </div>
    ${isReg ? '<div style="margin-top:8px;color:#27ae60;font-size:0.82em;">✅ 이미 분할출고 등록된 건입니다. 수량을 수정 후 다시 등록할 수 있습니다.</div>' : ''}`;
}

function confirmSplitRegister() {
  const pjNo  = ((document.getElementById('sreg-pjno-input') || {}).value || '').trim();
  const rowId = (document.getElementById('sreg-rowid') || {}).value || '';
  const qty   = parseInt((document.getElementById('sreg-qty-input') || {}).value) || 0;
  const model = ((document.getElementById('sreg-model-input') || {}).value || '').trim();

  if (!pjNo)  { alert('PJ NO를 입력하세요.'); return; }
  if (!rowId) { alert(`"${pjNo}"를 수주현황에서 찾을 수 없습니다.\nPJ NO를 다시 확인해주세요.`); return; }
  if (!qty || qty <= 0) { alert('수주수량을 입력하세요.'); return; }

  if (!localMeta[rowId]) localMeta[rowId] = {};
  if (localMeta[rowId].splitRegistered) {
    if (!confirm(`"${pjNo}"는 이미 등록된 PJ NO입니다.\n수주수량을 ${fmt(qty)}매로 업데이트하시겠습니까?`)) return;
  }

  localMeta[rowId].splitRegistered = true;
  localMeta[rowId].splitTargetQty  = qty;   // 등록 시 입력한 수주수량 저장
  if (model) localMeta[rowId].splitModel = model;  // 모델명 저장
  saveLocal();
  closeModal('splitRegisterModal');

  const vSel = document.getElementById('split-f-view');
  if (vSel) vSel.value = 'registered';
  renderSplitTab();
  setBanner('ok', `✅ ${pjNo} 분할출고 등록 완료 (수주수량: ${fmt(qty)}매)`);
}

function unregisterSplitDelivery(rowId) {
  const o = getEnriched().find(x => x._id === rowId);
  const pj = o ? o.pjNo : rowId;
  if (!confirm(`"${pj}" 분할출고 등록을 해제하시겠습니까?\n(기존 출고 이력은 유지됩니다)`)) return;
  if (localMeta[rowId]) localMeta[rowId].splitRegistered = false;
  saveLocal();
  renderSplitTab();
  setBanner('ok', `${pj} 분할출고 등록 해제`);
}

// =====================================================
//  SHIPMENT MANAGEMENT (출고관리)
// =====================================================
function populateShipmentFilters() {
  const sel = document.getElementById('ship-manager');
  if (!sel) return;
  const managers = [...new Set(getEnriched().map(o=>o.담당자).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + managers.map(m=>`<option ${m===cur?'selected':''}>${m}</option>`).join('');
}

function resetShipmentFilters() {
  ['ship-manager','ship-status','ship-avail'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const s = document.getElementById('ship-search'); if(s) s.value='';
  renderShipment();
}

function renderShipment() {
  let orders = getEnriched();
  const manager = document.getElementById('ship-manager')?.value || '';
  const avail = document.getElementById('ship-avail')?.value || '';
  const status = document.getElementById('ship-status')?.value || '';
  const search = (document.getElementById('ship-search')?.value || '').toLowerCase();

  if (manager) orders = orders.filter(o => o.담당자===manager);
  if (avail==='yes') orders = orders.filter(o => o.출고가능);
  if (avail==='no') orders = orders.filter(o => !o.출고가능);
  if (status) orders = orders.filter(o => o.status===status);
  if (search) orders = orders.filter(o => [o.pjNo,o.고객사,o.모델명,o.발전소명].join(' ').toLowerCase().includes(search));

  const total = orders.length;
  const canShip = orders.filter(o=>o.출고가능).length;
  const cannotShip = orders.filter(o=>!o.출고가능).length;
  const totalDeposit = orders.reduce((s,o)=>s+(o.계약금입금?o.계약금:0),0);

  const ss = document.getElementById('shipStats');
  if (ss) ss.innerHTML = `
    <div class="stat s-blue"><div class="stat-lbl">전체 건수</div><div class="stat-val">${total}</div></div>
    <div class="stat s-green"><div class="stat-lbl">출고 가능</div><div class="stat-val">${canShip}</div><div class="stat-sub">계약금 입금 완료</div></div>
    <div class="stat s-red"><div class="stat-lbl">출고 불가</div><div class="stat-val">${cannotShip}</div><div class="stat-sub">계약금 미입금</div></div>
    <div class="stat s-orange"><div class="stat-lbl">수령 계약금 합계</div><div class="stat-val">${fmtM(totalDeposit)}</div></div>
  `;

  const tbody = document.getElementById('shipmentTbody');
  if (!tbody) return;
  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="14" class="empty">조건에 맞는 수주가 없습니다.</td></tr>`; return; }

  tbody.innerHTML = orders.map(o => {
    const depBadge = o.계약금입금
      ? '<span class="tag green">✅ 입금</span>'
      : `<span class="tag red" style="cursor:pointer;" onclick="quickSetDeposit('${o.pjNo}',true)" title="클릭하면 입금처리">💰 미입금</span>`;
    const shipBadge = o.출고가능 ? '<span class="tag green">✅ 가능</span>' : '<span class="tag red">🔒 불가</span>';
    return `<tr>
      <td><a href="#" onclick="openOrderDetail('${o.pjNo}');return false;" style="color:#1a1a2e;font-weight:700;">${o.pjNo}</a></td>
      <td>${o.담당자||'-'}</td><td>${o.고객사||'-'}</td>
      <td style="font-size:0.8em;">${o.모델명||'-'}</td>
      <td style="text-align:right;">${fmt(o.수량)}</td>
      <td style="text-align:right;">${fmt(o.수주총액)}</td>
      <td style="text-align:right;">${o.계약금>0?fmt(o.계약금)+'원':'-'}</td>
      <td style="text-align:center;">${depBadge}</td>
      <td style="text-align:center;">${shipBadge}</td>
      <td>${dateKo(o.출고요청일)||'-'}</td>
      <td>${statusBadge(o.status)}</td>
      <td>
        <button class="btn btn-xs btn-outline" onclick="openEditOrderModal('${o.pjNo}')">✏️</button>
      </td>
    </tr>`;
  }).join('');
}

// =====================================================
//  선택 인수증 (출고지시서 기준)
//  수주현황.js의 printSelectedReceipts를 override
//  - 출고지시서 탭에서 체크된 .do-row-cb 우선
//  - 없으면 출고지시서 목록으로 선택 모달 표시
// =====================================================
function _enrichFromDeliveryOrder(d) {
  const base = getEnriched().find(o =>
    (d.rowId && o._id === d.rowId) ||
    (d.pjNo  && o.pjNo === d.pjNo)
  ) || {};
  // 배차정보·출고지시서 비고를 인수증 요청사항에 합쳐서 표시
  const remarkParts = [];
  if (d.vehicle) remarkParts.push(`🚚 ${d.vehicle}`);
  if (d.remarks) remarkParts.push(d.remarks);
  if (!remarkParts.length && base.요청사항) remarkParts.push(base.요청사항);
  return {
    _id: base._id || d.rowId || d.id,
    pjNo: d.pjNo || base.pjNo || '',
    모델명: d.model || base.모델명 || '',
    제품용량: d.watt || base.제품용량 || '',
    수량: d.qty || base.수량 || 0,
    발전소명: d.plant || base.발전소명 || '',
    고객사: d.receiver || base.고객사 || '',
    납품주소: d.address || base.납품주소 || '',
    인수담당자: d.siteMgr || base.인수담당자 || base.추가정보 || '',
    요청사항: remarkParts.join(' · '),
    출고요청일: d.date || base.출고요청일 || '',
    _doId: d.id
  };
}

// 모달의 선택된 ID를 모듈-스코프로 보관 (onclick 속성에 JSON 삽입 시
//  내부 큰따옴표가 속성을 깨는 문제를 피함)
let _pendingDOReceiptIds = [];

// 수주현황.js 버전을 override
function printSelectedReceipts() {
  // 1) 출고지시서 탭에서 체크된 .do-row-cb 우선
  const doCbs = document.querySelectorAll('.do-row-cb:checked');
  if (doCbs.length) {
    const ids = [...doCbs].map(cb => cb.getAttribute('data-id'));
    const list = ids.map(id => deliveryOrders.find(d => d.id === id)).filter(Boolean);
    if (list.length) {
      const orderList = list.map(_enrichFromDeliveryOrder);
      printMultiReceipt(orderList);
      return;
    }
  }
  // 2) 수주현황 탭에서 체크된 .order-row-cb 우선 (수주현황에서 누른 경우)
  const ordCbs = document.querySelectorAll('.order-row-cb:checked');
  if (ordCbs.length) {
    const ids = [...ordCbs].map(cb => cb.getAttribute('data-id'));
    const enriched = getEnriched();
    const orderList = ids.map(id => enriched.find(o => o._id === id)).filter(Boolean);
    if (orderList.length) { printMultiReceipt(orderList); return; }
  }
  // 3) 둘 다 없음 → 출고지시서 목록에서 선택 모달 표시
  showDOReceiptSelectModal();
}

function showDOReceiptSelectModal() {
  const existing = document.getElementById('doReceiptSelectModal');
  if (existing) existing.remove();

  if (!deliveryOrders.length) {
    alert('생성된 출고지시서가 없습니다. 먼저 출고지시서를 생성하세요.');
    return;
  }

  // 최신순 정렬
  const list = [...deliveryOrders].reverse();
  _pendingDOReceiptIds = list.map(d => d.id);

  const rowsHtml = list.map((d, i) => {
    const statusTag = d.processed
      ? '<span class="tag green" style="font-size:0.72em;">✅ 완료</span>'
      : '<span class="tag" style="font-size:0.72em;">📦 대기</span>';
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:7px;cursor:pointer;border:1px solid #eee;margin-bottom:4px;background:#fafafa;transition:background 0.1s;" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background='#fafafa'">
      <input type="checkbox" class="drsm-cb" data-idx="${i}" style="width:16px;height:16px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.86em;font-weight:700;color:#1a1a2e;">
          ${d.id} ${statusTag}
        </div>
        <div style="font-size:0.8em;color:#555;margin-top:2px;">
          <strong>${d.pjNo||'-'}</strong> · ${d.receiver||'-'} · ${d.plant||'-'}
        </div>
        <div style="font-size:0.76em;color:#888;margin-top:1px;">
          ${d.model||'-'} · ${fmt(d.totalQty||d.qty)}매 · ${d.date||''}
        </div>
      </div>
    </label>`;
  }).join('');

  const modalHtml = `<div id="doReceiptSelectModal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;">
    <div style="background:white;border-radius:14px;padding:24px;min-width:460px;max-width:600px;width:90%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 4px;color:#1a1a2e;font-size:1.05em;">📄 인수증 대상 선택 (출고지시서)</h3>
      <p style="margin:0 0 14px;color:#666;font-size:0.83em;">인수증을 출력할 <strong>출고지시서</strong>를 선택하세요.</p>
      <div style="overflow-y:auto;flex:1;max-height:55vh;">${rowsHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
        <button onclick="document.getElementById('doReceiptSelectModal').remove()"
          style="padding:9px 20px;border:1.5px solid #adb5bd;border-radius:7px;background:white;cursor:pointer;font-size:0.9em;color:#555;">취소</button>
        <button onclick="confirmDOReceiptSelect()"
          style="padding:9px 22px;border:none;border-radius:7px;background:#1a1a2e;color:white;cursor:pointer;font-size:0.9em;font-weight:600;">✅ 인수증 출력</button>
      </div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function confirmDOReceiptSelect() {
  const cbs = document.querySelectorAll('#doReceiptSelectModal .drsm-cb:checked');
  if (!cbs.length) { alert('하나 이상 선택해주세요.'); return; }
  const allIds = _pendingDOReceiptIds || [];
  const selectedIds = [...cbs].map(cb => allIds[parseInt(cb.getAttribute('data-idx'))]).filter(Boolean);
  document.getElementById('doReceiptSelectModal').remove();
  const list = selectedIds.map(id => deliveryOrders.find(d => d.id === id)).filter(Boolean);
  if (!list.length) { alert('선택한 출고지시서를 찾을 수 없습니다.'); return; }
  const orderList = list.map(_enrichFromDeliveryOrder);
  printMultiReceipt(orderList);
}
