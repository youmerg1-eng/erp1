// =====================================================
//  INVENTORY LOTS — 입고 LOT 단위 매입단가 + FIFO 출고 (Phase 6)
//
//  배경
//   - 같은 모델이라도 입고 시점/매입처마다 매입단가가 다름
//   - 출고 시 어떤 LOT의 재고를 사용했는지 추적 + 매입원가 자동 계산
//
//  설계
//   - 기존 inventoryData 구조 유지 (확장만, breaking change 없음)
//   - 입고 row에 추가 필드: unitPrice, watt, totalAmount, vendor, qtyRemaining
//   - 출고 row에 추가 필드: lotAllocations[] (어느 LOT에서 얼마)
//   - 입고 폼에 매입단가 입력란 자동 활성화
//   - 출고 시 자동 FIFO (가장 오래된 LOT부터 차감)
//   - 출고관리 신규 화면 (입고관리와 분리)
//
//  공개 API
//   window.inventoryLots = { ... }
// =====================================================
(function() {
  'use strict';

  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _normModel(m) { return String(m||'').toLowerCase().replace(/[\s\-_.,/\\()[\]{}]+/g, ''); }

  // ============================================================
  //  LOT 조회 — 입고 row 를 LOT 으로 해석
  // ============================================================
  function listLots(filter) {
    if (typeof inventoryData === 'undefined') return [];
    filter = filter || {};
    return inventoryData
      .filter(r => r.type === '입고')
      .filter(r => !filter.model || _normModel(r.model) === _normModel(filter.model))
      .filter(r => !filter.mfr || (r.mfr||'') === filter.mfr)
      .filter(r => !filter.warehouse || (r.warehouse||'') === filter.warehouse)
      .map(r => {
        const out = listOutbounds().filter(o =>
          (o.lotAllocations||[]).some(a => a.lotId === r.id)
        );
        const usedQty = out.reduce((s, o) => {
          const a = (o.lotAllocations||[]).find(x => x.lotId === r.id);
          return s + (a ? Number(a.qty)||0 : 0);
        }, 0);
        const watt = Number(r.watt) ||
          (typeof productMaster !== 'undefined' && productMaster[r.model]?.watt) || 0;
        return {
          ...r,
          watt,
          qtyRemaining: Math.max(0, (Number(r.qty)||0) - usedQty),
          qtyUsed: usedQty,
          unitPrice: Number(r.unitPrice)||0,
          totalAmount: Number(r.totalAmount) || (Number(r.unitPrice)||0)*(Number(r.qty)||0)
        };
      });
  }

  function listOutbounds(filter) {
    if (typeof inventoryData === 'undefined') return [];
    filter = filter || {};
    return inventoryData
      .filter(r => r.type === '출고')
      .filter(r => !filter.model || _normModel(r.model) === _normModel(filter.model))
      .filter(r => !filter.pjNo || (r.pjNo||'') === filter.pjNo)
      .slice();
  }

  // ============================================================
  //  FIFO 출고 — 가장 오래된 LOT부터 차감
  // ============================================================
  // ★ 매입단가 = Wp당 원
  //   원가 산식: cost = 수량 × 제품용량(W) × Wp당단가(원)
  function allocateFifo(model, qty, opts) {
    opts = opts || {};
    const targetQty = Number(qty) || 0;
    if (!targetQty) return { allocations: [], shortage: 0, totalCost: 0 };

    const lots = listLots({ model })
      .filter(l => l.qtyRemaining > 0)
      .sort((a,b) => (a.date||'').localeCompare(b.date||''));

    const allocations = [];
    let remaining = targetQty;
    let totalCost = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.qtyRemaining);
      if (take <= 0) continue;
      // 원가 = 수량 × 제품용량 × Wp당 단가
      const watt = Number(lot.watt) || 0;
      const upPerWp = Number(lot.unitPrice) || 0;
      const cost = take * watt * upPerWp;
      allocations.push({
        lotId: lot.id,
        lotDate: lot.date,
        vendor: lot.mfr || lot.vendor || '',
        warehouse: lot.warehouse || '',
        qty: take,
        watt,
        unitPriceAtOut: upPerWp,    // Wp당
        cost
      });
      totalCost += cost;
      remaining -= take;
    }

    const usedQty = targetQty - remaining;
    return {
      allocations,
      shortage: remaining,
      totalCost: Math.round(totalCost),
      avgUnitPriceWp: usedQty > 0 ? (totalCost / usedQty / (allocations[0]?.watt || 1)) : 0,
      avgCostPerUnit: usedQty > 0 ? Math.round(totalCost / usedQty) : 0   // 매당 평균 원가
    };
  }

  // ============================================================
  //  입고 등록 폼 보강 — saveInbound hook
  // ============================================================
  function _hookSaveInbound() {
    if (typeof window.saveInbound !== 'function') {
      setTimeout(_hookSaveInbound, 500);
      return;
    }
    if (window.saveInbound.__lotHooked) return;
    const _orig = window.saveInbound;
    window.saveInbound = function() {
      // 1) 폼에서 추가 필드 읽기
      const watt = Number(document.getElementById('ib-watt')?.value) || 0;
      const unitPricePerWp = Number(document.getElementById('ib-unitprice')?.value) || 0;
      const totalAmountInput = Number(document.getElementById('ib-totalamount')?.value) || 0;
      const vendor = document.getElementById('ib-vendor')?.value?.trim() || '';

      // 2) 원본 saveInbound 실행 (inventoryData에 row 추가)
      const result = _orig.apply(this, arguments);

      // 3) 방금 추가된 row 식별 (가장 마지막 입고)
      if (typeof inventoryData !== 'undefined') {
        const lastInbound = [...inventoryData].reverse().find(r => r.type === '입고');
        if (lastInbound) {
          if (watt) lastInbound.watt = watt;
          // ★ 매입단가는 Wp당 원 단위
          if (unitPricePerWp) lastInbound.unitPrice = unitPricePerWp;
          // ★ 산식: 수량 × 제품용량(W) × Wp당 단가
          const qty = Number(lastInbound.qty)||0;
          lastInbound.totalAmount = totalAmountInput || (qty * watt * unitPricePerWp);
          if (vendor) lastInbound.vendor = vendor;
          if (typeof saveLocal === 'function') saveLocal();
          console.log('[inventory-lots] LOT 등록:', lastInbound.id,
            `${qty}매 × ${watt}W × ${unitPricePerWp}원/Wp = ${lastInbound.totalAmount.toLocaleString()}원`);
        }
      }
      return result;
    };
    window.saveInbound.__lotHooked = true;
  }

  // ============================================================
  //  출고 등록 — FIFO 자동 + lotAllocations 저장
  // ============================================================
  function _hookSaveOutbound() {
    if (typeof window.saveOutbound !== 'function') {
      setTimeout(_hookSaveOutbound, 500);
      return;
    }
    if (window.saveOutbound.__lotHooked) return;
    const _orig = window.saveOutbound;
    window.saveOutbound = function() {
      const model = document.getElementById('ob-model')?.value?.trim() || '';
      const qty = Number(document.getElementById('ob-qty')?.value) || 0;
      // 출고 전 — FIFO 미리 계산해서 재고 부족 검증
      if (model && qty) {
        const alloc = allocateFifo(model, qty);
        if (alloc.shortage > 0) {
          if (!confirm(
            `⚠️ 재고 부족: ${model}\n\n` +
            `요청 수량: ${qty.toLocaleString()}매\n` +
            `현재 재고: ${(qty - alloc.shortage).toLocaleString()}매\n` +
            `부족 수량: ${alloc.shortage.toLocaleString()}매\n\n` +
            `그래도 출고를 등록하시겠습니까?`
          )) return false;
        }
      }
      // 원본 실행
      const result = _orig.apply(this, arguments);
      // 방금 추가된 출고 row에 LOT allocation 정보 부여
      if (typeof inventoryData !== 'undefined' && model && qty) {
        const lastOut = [...inventoryData].reverse().find(r => r.type === '출고');
        if (lastOut && !lastOut.lotAllocations) {
          const alloc = allocateFifo(model, qty);
          lastOut.lotAllocations = alloc.allocations;
          lastOut.totalCost = alloc.totalCost;
          lastOut.avgUnitPriceAtOut = alloc.avgUnitPrice;
          if (typeof saveLocal === 'function') saveLocal();
          console.log('[inventory-lots] 출고 LOT 매칭:', alloc.allocations.length + '개 LOT', alloc.totalCost.toLocaleString() + '원');
        }
      }
      return result;
    };
    window.saveOutbound.__lotHooked = true;
  }

  // ============================================================
  //  입고 폼에 매입금액 자동 계산 hook
  //  ★ 2026-05 변경: 매입단가 = Wp당 원 단위로 통일.
  //   계산식: 매입금액 = 제품용량(W) × 매입단가(원/Wp) × 수량(매)
  //   예: 600W × 1원/Wp × 1,000매 = 600,000원
  // ============================================================
  window._calcInboundTotal = function() {
    const qty = Number(document.getElementById('ib-qty')?.value) || 0;
    const watt = Number(document.getElementById('ib-watt')?.value) || 0;
    const upPerWp = Number(document.getElementById('ib-unitprice')?.value) || 0;
    const totalEl = document.getElementById('ib-totalamount');
    // 산식: 수량 × 제품용량 × Wp당 단가
    const total = qty * watt * upPerWp;
    if (totalEl) totalEl.value = Math.round(total);
  };

  // 모달 열릴 때 폼에 watt 자동 채우기 (productMaster 활용)
  function _hookOpenInbound() {
    if (typeof window.openInboundModal !== 'function') {
      setTimeout(_hookOpenInbound, 500);
      return;
    }
    if (window.openInboundModal.__lotHooked) return;
    const _orig = window.openInboundModal;
    window.openInboundModal = function() {
      const r = _orig.apply(this, arguments);
      // 모델 입력 시 productMaster 의 watt 자동 채우기
      setTimeout(() => {
        const modelEl = document.getElementById('ib-model');
        const wattEl = document.getElementById('ib-watt');
        if (modelEl && wattEl && !modelEl.__lotBound) {
          modelEl.addEventListener('blur', () => {
            const m = modelEl.value.trim();
            if (m && typeof productMaster !== 'undefined' && productMaster[m]?.watt) {
              if (!wattEl.value) wattEl.value = productMaster[m].watt;
            }
          });
          modelEl.__lotBound = true;
        }
        // qty 변경 시 매입금액 자동 계산
        const qtyEl = document.getElementById('ib-qty');
        if (qtyEl && !qtyEl.__lotBound) {
          qtyEl.addEventListener('input', window._calcInboundTotal);
          qtyEl.__lotBound = true;
        }
      }, 100);
      return r;
    };
    window.openInboundModal.__lotHooked = true;
  }

  // ============================================================
  //  출고관리 신규 모달 (출고 이력 전용)
  // ============================================================
  function _injectOutboundUI() {
    if (document.getElementById('erp-ob-modal')) return;
    const css = `
      #erp-ob-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:2vh;}
      #erp-ob-modal.open{display:flex;}
      .ob-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:97%;max-width:1200px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;}
      .ob-hd{padding:14px 20px;background:linear-gradient(135deg,#e65100,#bf360c);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .ob-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .ob-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;}
      .ob-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #e65100;}
      .ob-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .ob-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .ob-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .ob-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .ob-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .ob-tbl tr.ob-row{border-left:4px solid #e65100;}
      .ob-lot-detail{background:#fff8e1;padding:6px 10px;border-radius:5px;font-size:0.82em;line-height:1.5;}
      .ob-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .ob-btn-primary{background:#e65100;color:#fff;}
      .ob-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-ob-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-ob-modal';
    modal.onclick = e => { if (e.target === modal) closeOutbound(); };
    modal.innerHTML = `
      <div class="ob-box">
        <div class="ob-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">📤 출고관리 — 출고 이력 + LOT별 원가 추적</h4>
          <div>
            <button class="ob-btn ob-btn-ghost" onclick="if(typeof openOutboundModal==='function') openOutboundModal()">➕ 출고 등록</button>
            <button class="ob-btn ob-btn-ghost" onclick="document.getElementById('erp-ob-modal').classList.remove('open')">✕</button>
          </div>
        </div>
        <div class="ob-bd" id="ob-bd"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  // ★ 출고관리 본문 렌더 — 모달과 정식 탭 모두 지원
  // 한국식 큰 금액 — utils 의 fmtKrAmt 폴백
  function _fmtAmt(n) {
    if (typeof window.fmtKrAmt === 'function') return window.fmtKrAmt(n);
    const v = Number(n)||0;
    if (Math.abs(v) < 10000000) return v.toLocaleString('ko-KR') + '원';
    const eok = v/100000000;
    return (Math.abs(eok) >= 1 ? eok.toFixed(1) : eok.toFixed(2)) + '억원';
  }

  function _buildOutboundHtml() {
    const rows = listOutbounds().slice().reverse();
    const totalQty = rows.reduce((s, r) => s + (Number(r.qty)||0), 0);
    const totalCost = rows.reduce((s, r) => s + (Number(r.totalCost)||0), 0);
    const matchedCount = rows.filter(r => r.lotAllocations && r.lotAllocations.length > 0).length;

    return `
      <div class="ob-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
        <div class="stat" style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #e65100;">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">전체 출고</div>
          <div style="font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;">${rows.length}건</div>
        </div>
        <div class="stat" style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #e65100;">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">총 출고 수량</div>
          <div style="font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;">${_fmt(totalQty)}매</div>
        </div>
        <div class="stat" style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #e65100;">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">총 매입원가</div>
          <div style="font-size:1.4em;font-weight:900;color:#e65100;line-height:1.1;margin-top:2px;">${_fmtAmt(totalCost)}</div>
        </div>
        <div class="stat" style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #e65100;">
          <div style="font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;">LOT 매칭률</div>
          <div style="font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;">${rows.length > 0 ? (matchedCount/rows.length*100).toFixed(0) : 0}%</div>
        </div>
      </div>

      <div style="background:#e8f5e9;padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:0.84em;line-height:1.6;">
        💡 <strong>FIFO 자동 매칭</strong>: 출고 시 가장 오래된 LOT부터 차감<br>
        💡 <strong>매입원가 산식</strong>: 수량 × 제품용량(W) × Wp당 단가 (예: 1,000매 × 600W × 1원/Wp = 600,000원)
      </div>

      ${rows.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">출고 이력 없음</div>'
        : `<table class="ob-tbl" style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <thead><tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:8px 10px;text-align:left;">출고일</th>
            <th style="padding:8px 10px;text-align:left;">모델</th>
            <th style="padding:8px 10px;text-align:right;">수량</th>
            <th style="padding:8px 10px;text-align:left;">PJ NO</th>
            <th style="padding:8px 10px;text-align:right;">매입원가</th>
            <th style="padding:8px 10px;text-align:right;">매당 평균</th>
            <th style="padding:8px 10px;text-align:left;">LOT 분배 (FIFO)</th>
          </tr></thead>
          <tbody>${rows.map(r => {
            const allocations = r.lotAllocations || [];
            const lotDetail = allocations.length === 0
              ? '<span style="color:#999;font-style:italic;">미매칭 (구버전 출고)</span>'
              : `<details><summary style="cursor:pointer;font-weight:700;color:#e65100;">${allocations.length}개 LOT 펼치기</summary>
                  <div style="background:#fff8e1;padding:6px 10px;border-radius:5px;font-size:0.82em;line-height:1.6;margin-top:4px;">${allocations.map(a =>
                    `📦 <strong>${_e(a.lotDate)}</strong> · ${_fmt(a.qty)}매 × ${a.watt||0}W × ${a.unitPriceAtOut||0}원/Wp = <strong>${_fmtAmt(a.cost)}</strong> (${_e(a.vendor||'-')})`
                  ).join('<br>')}</div></details>`;
            return `<tr style="border-left:4px solid #e65100;">
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;"><strong>${_e(r.date)}</strong></td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${_e(r.model)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${_fmt(r.qty)}매</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${_e(r.pjNo||'-')}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#e65100;">${_fmtAmt(r.totalCost||0)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;">${r.avgCostPerUnit?_fmt(r.avgCostPerUnit)+'원':(r.avgUnitPriceAtOut?_fmt(r.avgUnitPriceAtOut)+'원/Wp':'-')}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">${lotDetail}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`}
    `;
  }

  function _renderOutboundList() {
    const html = _buildOutboundHtml();
    const modalBd = document.getElementById('ob-bd');
    if (modalBd) modalBd.innerHTML = html;
  }

  // ★ 정식 탭 (#tab-outbound) 인라인 렌더
  function _renderOutboundTab() {
    const tabBody = document.getElementById('outboundTabBody');
    if (!tabBody) return;
    tabBody.innerHTML = _buildOutboundHtml();
  }

  function openOutbound() {
    _injectOutboundUI();
    document.getElementById('erp-ob-modal').classList.add('open');
    setTimeout(_renderOutboundList, 30);
  }
  function closeOutbound() { document.getElementById('erp-ob-modal')?.classList.remove('open'); }

  // ============================================================
  //  재고관리·입고관리 탭 자동 주입 출고관리 버튼 — 비활성화 (사용자 요청)
  //  대신 사이드바의 🚛 출고관리 도구 탭 사용
  // ============================================================
  function _addOutboundButton() {
    // 기존에 주입된 버튼이 남아있으면 제거
    ['tab-stock','tab-inventory'].forEach(tabId => {
      const tab = document.getElementById(tabId);
      if (!tab) return;
      const old = tab.querySelector('#btnOutboundMgmt');
      if (old) old.remove();
    });
    // 새로 주입하지 않음
  }

  // ============================================================
  //  통계
  // ============================================================
  function summary() {
    const lots = listLots();
    const totalLots = lots.length;
    const totalRemaining = lots.reduce((s, l) => s + l.qtyRemaining, 0);
    const totalValue = lots.reduce((s, l) => s + (l.qtyRemaining * (l.unitPrice||0)), 0);
    const lotsWithPrice = lots.filter(l => l.unitPrice > 0).length;
    const outbounds = listOutbounds();
    const matchedOuts = outbounds.filter(o => o.lotAllocations && o.lotAllocations.length > 0).length;
    return {
      totalLots,
      totalRemaining,
      totalValue,
      lotsWithPrice,
      pricedRatio: totalLots > 0 ? (lotsWithPrice/totalLots*100).toFixed(1) : 0,
      totalOutbounds: outbounds.length,
      matchedOutbounds: matchedOuts,
      matchRatio: outbounds.length > 0 ? (matchedOuts/outbounds.length*100).toFixed(1) : 0
    };
  }

  // ============================================================
  //  부팅
  // ============================================================
  function boot() {
    setTimeout(_hookSaveInbound, 1500);
    setTimeout(_hookSaveOutbound, 1500);
    setTimeout(_hookOpenInbound, 1500);
    setTimeout(_injectOutboundUI, 1800);
    // 재고관리 탭에 출고관리 버튼 추가
    setTimeout(_addOutboundButton, 2500);
    // showTab hook — 출고관리 탭 진입 시 자동 렌더
    if (typeof window.showTab === 'function' && !window.showTab.__lotHooked) {
      const _orig = window.showTab;
      window.showTab = function(id) {
        const r = _orig.apply(this, arguments);
        if (id === 'outbound') {
          setTimeout(_renderOutboundTab, 80);
        }
        if (id === 'stock' || id === 'inventory') {
          setTimeout(_addOutboundButton, 100);
        }
        return r;
      };
      window.showTab.__lotHooked = true;
    }
    // 페이지 첫 진입 시 outbound가 active면 즉시 렌더
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-outbound') _renderOutboundTab();
    }, 2500);
    // 출고 등록 시 탭 자동 갱신 (saveOutbound hook 후)
    setTimeout(() => {
      if (typeof window.saveOutbound === 'function') {
        const _origSave = window.saveOutbound;
        if (!window.saveOutbound.__tabRefreshHooked) {
          window.saveOutbound = function() {
            const r = _origSave.apply(this, arguments);
            setTimeout(_renderOutboundTab, 200);
            return r;
          };
          window.saveOutbound.__tabRefreshHooked = true;
        }
      }
    }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ============================================================
  //  공개 API
  // ============================================================
  window.inventoryLots = {
    listLots,
    listOutbounds,
    allocateFifo,
    summary,
    openOutbound,
    closeOutbound,
    refreshOutbound: _renderOutboundList,
    refreshOutboundTab: _renderOutboundTab,
    refreshAll: () => { _renderOutboundList(); _renderOutboundTab(); }
  };

  console.log('[ERP-LOTS] 입고 LOT 단위 매입단가 + FIFO 출고 활성 — inventoryLots.summary()');
})();
