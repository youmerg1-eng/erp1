// =====================================================
//  PURCHASE PRICE — 매입단가 수동 편집 + 자동 매칭
//
//  문제
//   - 구매이력의 매입단가는 수주(rawData) 의 '매입단가' 컬럼에서만 옴
//   - 입고 직접 등록(inventoryData)이나 해외 입고(incoming)는 단가 = 0
//   - 결과: 대부분 행에서 매입단가 "-" 로 표시
//
//  해결 (3-tier)
//   A. inventoryData 의 unitPrice 필드 자동 활용 — 이미 있으면 사용
//   B. 자동 매칭 — model + 비슷한 날짜 + 비슷한 수량의 수주에서 단가 복사
//   C. 수동 편집 — 구매이력 행 클릭 → 매입단가 직접 입력
//
//  데이터 키
//   erp_purchase_prices = { 'invId': { unitPrice, totalAmount, currency, source, _ts } }
//
//  공개 API: window.purchasePrice
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_purchase_prices';
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _normModel(m) { return String(m||'').toLowerCase().replace(/[\s\-_.,/\\()[\]{}]+/g, ''); }

  // ── 사용자 수동 입력 단가 저장소 ─────────────────
  function _loadPrices() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function _savePrices(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj || {})); }
    catch (e) { console.error('[purchase-price] save 실패', e); }
  }

  // ★ 2026-05 수정: 수동 단가를 inventoryData 에 직접 저장.
  //   purchase.js 의 _aggregate 가 r.unitPrice 를 그대로 쓰도록 변경됐으므로,
  //   별도 저장소(erp_purchase_prices)는 폴백 캐시로만 유지.
  function setManualPrice(invId, unitPrice, totalAmount) {
    if (!invId) return false;
    const up = Number(unitPrice) || 0;
    const total = Number(totalAmount) || 0;

    // 1차: inventoryData 에 직접 저장 (가장 정확하고 영구적)
    let updatedInInventory = false;
    if (typeof inventoryData !== 'undefined') {
      const inv = inventoryData.find(r => r.id === invId);
      if (inv) {
        inv.unitPrice = up;
        inv.totalAmount = total || (up * (Number(inv.qty)||0));
        if (typeof saveLocal === 'function') saveLocal();
        updatedInInventory = true;
      }
    }

    // 2차: 별도 저장소(폴백 — inventoryData 에 없는 incoming/order 행용)
    const all = _loadPrices();
    all[invId] = {
      unitPrice: up,
      totalAmount: total,
      source: 'manual',
      _ts: Date.now()
    };
    _savePrices(all);

    // 화면 즉시 갱신 — 모달 다시 그리기
    setTimeout(() => {
      const modal = document.getElementById('erp-pur-modal');
      if (modal && modal.classList.contains('open')) {
        // purchase 모듈의 refresh 시도
        if (typeof window.purchase !== 'undefined') {
          if (window.purchase.refresh) {
            try { window.purchase.refresh(); } catch (e) {}
          } else if (window.purchase.open && window.purchase.close) {
            // refresh 없으면 닫고 다시 열기
            try { window.purchase.close(); window.purchase.open(); } catch (e) {}
          }
        }
      }
      // 재고 화면도 갱신 (입고 이력에서 단가 표시 위해)
      if (typeof renderStockTab === 'function') try { renderStockTab(); } catch (e) {}
      if (typeof renderInventory === 'function') try { renderInventory(); } catch (e) {}
    }, 100);

    console.log('[purchase-price] 수동 단가 저장:', invId, up + '원', updatedInInventory ? '(inventoryData)' : '(폴백)');
    return true;
  }

  function clearManualPrice(invId) {
    const all = _loadPrices();
    if (!all[invId]) return false;
    delete all[invId];
    _savePrices(all);
    return true;
  }

  // ── 자동 매칭 — 입고 행에 매입단가가 없으면 수주에서 추정 ──
  //   규칙: 같은 model normalize + 같은 vendor + ±30일 이내 + 수량 비슷한 수주에서 단가 평균
  function _autoMatchFromOrders(invRow) {
    if (typeof getEnriched !== 'function') return null;
    const orders = getEnriched();
    const tgtModel = _normModel(invRow.model);
    const tgtVendor = (invRow.vendor || '').trim().toLowerCase();
    if (!tgtModel) return null;

    const tgtDate = invRow.date ? new Date(invRow.date) : null;
    const candidates = [];
    orders.forEach(o => {
      if (!o.매입단가 || Number(o.매입단가) <= 0) return;
      if (_normModel(o.모델명) !== tgtModel) return;
      if (tgtVendor && o.매입사 && o.매입사.trim().toLowerCase() !== tgtVendor) return;
      // 날짜 ±30일
      if (tgtDate && o.수주일) {
        const diff = Math.abs(new Date(o.수주일) - tgtDate);
        if (diff > 30 * 86400000) return;
      }
      candidates.push({ unitPrice: Number(o.매입단가), pjNo: o.pjNo, date: o.수주일 });
    });
    if (!candidates.length) return null;
    // 가장 가까운 날짜 우선, 동률이면 평균
    if (tgtDate) {
      candidates.sort((a,b) => Math.abs(new Date(a.date) - tgtDate) - Math.abs(new Date(b.date) - tgtDate));
    }
    const best = candidates[0];
    return {
      unitPrice: best.unitPrice,
      source: 'auto-match',
      reference: `유사 수주 ${best.pjNo} (${best.date})`,
      candidatesCount: candidates.length
    };
  }

  // ── purchase._aggregate hook — 매입단가 보강 ─────
  function _hookPurchase() {
    if (typeof window.purchase === 'undefined' || !window.purchase) {
      setTimeout(_hookPurchase, 500);
      return;
    }
    if (window.purchase._priceHooked) return;

    // purchase 모듈이 _aggregate 를 직접 노출하지 않으므로,
    // open() 또는 list() 호출 시점에 후처리하는 식으로 hook
    const _origList = window.purchase.list;
    if (_origList) {
      window.purchase.list = function() {
        const rows = _origList.apply(this, arguments) || [];
        return _enrichRows(rows);
      };
    }

    // open hook — 모달 열린 후 가격 보강된 결과 활용
    const _origOpen = window.purchase.open;
    if (_origOpen) {
      window.purchase.open = function() {
        const r = _origOpen.apply(this, arguments);
        // 모달이 자체적으로 _aggregate 호출 — 후처리 위해 수동 보강
        setTimeout(() => _injectEditButtons(), 200);
        return r;
      };
    }

    window.purchase._priceHooked = true;
    console.log('[purchase-price] purchase 모듈 hook 적용됨');
  }

  // 행 보강 — 매입단가 우선순위:
  //   1. 수동 입력 (erp_purchase_prices)
  //   2. 자동 매칭 (수주에서 추정)
  //   3. inventoryData 의 unitPrice 필드 (있으면)
  //   4. 기존 값 유지 (수주 source는 그대로)
  function _enrichRows(rows) {
    const manual = _loadPrices();
    return rows.map(r => {
      // 이미 단가가 있으면 (수주 source) — 그대로
      if (r.unitPrice > 0 && r.source === 'order') return r;

      // 수동 입력 우선
      if (manual[r.id]) {
        const m = manual[r.id];
        return {
          ...r,
          unitPrice: m.unitPrice,
          totalAmount: m.totalAmount || (m.unitPrice * (r.qty||0)),
          unitPriceWp: r.watt > 0 ? m.unitPrice / r.watt : 0,
          priceSource: 'manual',
          priceNote: '수동 입력'
        };
      }

      // inventory 자체 unitPrice 활용 (있으면)
      if (r.source === 'inventory' && typeof inventoryData !== 'undefined') {
        const inv = inventoryData.find(x => x.id === r.id);
        if (inv && Number(inv.unitPrice) > 0) {
          const up = Number(inv.unitPrice);
          return {
            ...r,
            unitPrice: up,
            totalAmount: up * (r.qty||0),
            unitPriceWp: r.watt > 0 ? up / r.watt : 0,
            priceSource: 'inventory',
            priceNote: '입고 등록'
          };
        }
      }

      // 자동 매칭 시도
      const auto = _autoMatchFromOrders(r);
      if (auto) {
        return {
          ...r,
          unitPrice: auto.unitPrice,
          totalAmount: auto.unitPrice * (r.qty||0),
          unitPriceWp: r.watt > 0 ? auto.unitPrice / r.watt : 0,
          priceSource: 'auto',
          priceNote: auto.reference
        };
      }

      // 단가 없음 — 그대로
      return { ...r, priceSource: 'none' };
    });
  }

  // ── 구매이력 모달에 편집 버튼 + 단가 source 라벨 ──
  function _injectEditButtons() {
    const modal = document.getElementById('erp-pur-modal');
    if (!modal || !modal.classList.contains('open')) return;
    // table rows
    const rows = modal.querySelectorAll('tbody tr[data-id], .pur-row');
    if (!rows.length) {
      // 다른 셀렉터 시도
      const tbody = modal.querySelector('tbody');
      if (!tbody) return;
      tbody.querySelectorAll('tr').forEach((tr, i) => tr.setAttribute('data-row-idx', i));
    }

    // 편집 버튼 위임 — 모달 내 어떤 행이든 dblclick 으로 편집 가능
    if (!modal.__priceDelegated) {
      modal.addEventListener('dblclick', e => {
        const tr = e.target.closest('tbody tr');
        if (!tr || !tr.parentElement) return;
        // 행에서 모델명 텍스트 추출
        const cells = tr.querySelectorAll('td');
        if (cells.length < 4) return;
        const dateText = cells[0]?.textContent?.trim() || '';
        const modelText = cells[1]?.textContent?.trim() || '';
        if (!modelText) return;
        // 매칭되는 row id 찾기 (purchase._aggregate 결과에서)
        const rows = (typeof window.purchase !== 'undefined' && window.purchase.list)
          ? window.purchase.list() : [];
        const target = rows.find(r =>
          (r.date||'').includes(dateText.slice(0,10)) &&
          _normModel(r.model) === _normModel(modelText.split('\n')[0])
        );
        if (!target) {
          alert('행 매칭 실패 — 콘솔에서 purchasePrice.setManualPrice(invId, 단가) 사용');
          return;
        }
        _openEditDialog(target);
      });
      modal.__priceDelegated = true;
      // 안내 배너
      const bd = modal.querySelector('.pur-bd, .pur-box') || modal;
      if (bd && !bd.querySelector('.pp-hint')) {
        const hint = document.createElement('div');
        hint.className = 'pp-hint';
        hint.style.cssText = 'background:#e3f2fd;color:#1565c0;padding:8px 14px;font-size:0.84em;border-radius:6px;margin:8px 14px;';
        hint.innerHTML = '💡 행을 <strong>더블 클릭</strong>하면 매입단가를 수동 입력할 수 있습니다.';
        const target = modal.querySelector('.pur-bd') || bd.firstElementChild;
        if (target && target.parentNode) target.parentNode.insertBefore(hint, target);
      }
    }
  }

  // 매입단가 편집 다이얼로그
  function _openEditDialog(row) {
    const ex = document.getElementById('pp-edit-modal');
    if (ex) ex.remove();
    const m = document.createElement('div');
    m.id = 'pp-edit-modal';
    m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9800;display:flex;align-items:center;justify-content:center;';
    m.onclick = e => { if (e.target === m) m.remove(); };
    const auto = _autoMatchFromOrders(row);
    m.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:92%;max-width:480px;padding:20px;box-shadow:0 16px 50px rgba(0,0,0,0.35);">
        <h3 style="margin:0 0 14px;color:#1a1a2e;">💰 매입단가 편집</h3>
        <div style="background:#f9f9f9;padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:0.86em;line-height:1.6;">
          <div><strong>입고일:</strong> ${_e(row.date)}</div>
          <div><strong>모델:</strong> ${_e(row.model)}</div>
          <div><strong>매입처:</strong> ${_e(row.vendor||'-')}</div>
          <div><strong>수량:</strong> ${_fmt(row.qty)}장</div>
          <div><strong>단품 용량:</strong> ${row.watt||'-'}W</div>
        </div>
        ${auto ? `<div style="background:#fffde7;border-left:4px solid #f9a825;padding:8px 12px;border-radius:6px;margin-bottom:14px;font-size:0.84em;">
          🤖 자동 매칭 추천: <strong>${auto.unitPrice}원/Wp</strong> (${_e(auto.reference)})
          <button onclick="document.getElementById('pp-input').value=${auto.unitPrice};window.purchasePrice._calcTotal();" style="margin-left:8px;padding:3px 10px;background:#f9a825;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.78em;">적용</button>
        </div>` : ''}
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:0.84em;color:#666;font-weight:700;margin-bottom:4px;">매입단가 (원/Wp) ★</label>
          <input id="pp-input" type="number" step="0.01" value="${row.unitPrice||0}"
            style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:6px;font-size:1em;box-sizing:border-box;"
            oninput="window.purchasePrice._calcTotal()">
          <div style="font-size:0.78em;color:#888;margin-top:3px;">Wp당 원 단위 (보통 0.5~5원). 예: 1원/Wp + 600W 모듈 = 매당 600원</div>
        </div>
        <div style="margin-bottom:14px;font-size:0.86em;color:#666;background:#fff8e1;padding:8px 10px;border-radius:5px;">
          매입총액: <strong id="pp-total" style="color:#e65100;font-size:1.1em;">${typeof fmtKrAmt==='function'?fmtKrAmt((row.unitPrice||0)*(row.qty||0)*(row.watt||0)):_fmt((row.unitPrice||0)*(row.qty||0)*(row.watt||0))+'원'}</strong>
          <span style="font-size:0.84em;margin-left:8px;color:#888;">= ${_fmt(row.qty)} × ${row.watt||0} × <span id="pp-rate">${row.unitPrice||0}</span>원/Wp</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <button onclick="window.purchasePrice._clear('${_ea(row.id)}');document.getElementById('pp-edit-modal').remove();" style="padding:8px 14px;background:#fff;border:1.5px solid #c62828;color:#c62828;border-radius:6px;cursor:pointer;font-size:0.86em;font-weight:700;">🗑 단가 초기화</button>
          <div>
            <button onclick="document.getElementById('pp-edit-modal').remove()" style="padding:8px 14px;background:#fff;border:1.5px solid #ccc;color:#666;border-radius:6px;cursor:pointer;font-size:0.86em;">취소</button>
            <button onclick="window.purchasePrice._saveFromDialog('${_ea(row.id)}',${row.qty||0})" style="padding:8px 16px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.86em;font-weight:700;">💾 저장</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(m);
    // store row for calc helpers
    m.dataset.qty = row.qty || 0;
    m.dataset.watt = row.watt || 0;
    setTimeout(() => document.getElementById('pp-input')?.focus(), 50);
  }

  function _calcTotal() {
    const m = document.getElementById('pp-edit-modal');
    if (!m) return;
    const upPerWp = Number(document.getElementById('pp-input').value) || 0;
    const qty = Number(m.dataset.qty) || 0;
    const watt = Number(m.dataset.watt) || 0;
    // ★ 산식: 수량 × 제품용량(W) × Wp당 단가
    const total = Math.round(qty * watt * upPerWp);
    const totalEl = document.getElementById('pp-total');
    if (totalEl) totalEl.textContent = (typeof fmtKrAmt === 'function') ? fmtKrAmt(total) : (_fmt(total) + '원');
    const rateEl = document.getElementById('pp-rate');
    if (rateEl) rateEl.textContent = upPerWp;
  }

  function _saveFromDialog(invId, qty) {
    const upPerWp = Number(document.getElementById('pp-input').value) || 0;
    if (upPerWp < 0) { alert('단가는 0 이상이어야 합니다.'); return; }
    // 매입금액 = 수량 × 제품용량 × Wp당 단가
    const m = document.getElementById('pp-edit-modal');
    const watt = Number(m?.dataset.watt) || 0;
    const total = Math.round(qty * watt * upPerWp);
    setManualPrice(invId, upPerWp, total);
    document.getElementById('pp-edit-modal')?.remove();
    if (typeof setBanner === 'function') setBanner('ok', `💰 매입단가 ${upPerWp}원/Wp 저장 (총 ${typeof fmtKrAmt==='function'?fmtKrAmt(total):_fmt(total)+'원'})`);
    // 구매이력 화면 자동 갱신
    if (typeof window.purchase !== 'undefined' && window.purchase.refresh) {
      try { window.purchase.refresh(); } catch (e) {}
    } else if (typeof window.purchase !== 'undefined' && window.purchase.open) {
      // refresh 없으면 닫고 다시 열기
      const wasOpen = document.getElementById('erp-pur-modal')?.classList.contains('open');
      if (wasOpen) {
        try { window.purchase.close(); window.purchase.open(); } catch (e) {}
      }
    }
  }

  function _clearAndClose(invId) {
    if (!confirm('이 행의 매입단가 수동 입력을 초기화합니까?')) return;
    clearManualPrice(invId);
    if (typeof setBanner === 'function') setBanner('ok', '🗑 단가 초기화됨');
    document.getElementById('pp-edit-modal')?.remove();
    if (typeof window.purchase !== 'undefined' && window.purchase.refresh) {
      try { window.purchase.refresh(); } catch (e) {}
    }
  }

  // ── 일괄 자동 매칭 ────────────────────────────────
  function autoMatchAll() {
    if (typeof window.purchase === 'undefined' || !window.purchase.list) return null;
    const rows = window.purchase.list();
    const all = _loadPrices();
    let matched = 0, skipped = 0;
    rows.forEach(r => {
      if (r.unitPrice > 0 && r.priceSource !== 'auto') return;
      if (all[r.id]) { skipped++; return; }     // 수동 입력은 보존
      const auto = _autoMatchFromOrders(r);
      if (auto) {
        all[r.id] = {
          unitPrice: auto.unitPrice,
          totalAmount: auto.unitPrice * (r.qty || 0),
          source: 'auto-batch',
          reference: auto.reference,
          _ts: Date.now()
        };
        matched++;
      }
    });
    _savePrices(all);
    return { matched, skipped, total: rows.length };
  }

  // ── 통계 ────────────────────────────────────────
  function summary() {
    const prices = _loadPrices();
    const total = Object.keys(prices).length;
    let totalAmount = 0;
    Object.values(prices).forEach(p => { totalAmount += p.totalAmount || 0; });
    return { manualEntries: total, totalAmount };
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    setTimeout(_hookPurchase, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.purchasePrice = {
    set: setManualPrice,
    clear: clearManualPrice,
    list: _loadPrices,
    autoMatchAll,
    summary,
    edit: _openEditDialog,
    _calcTotal, _saveFromDialog,
    _clear: _clearAndClose,
    _autoMatch: _autoMatchFromOrders,
    _enrichRows
  };

  console.log('[ERP-PURCHASE-PRICE] 매입단가 편집 + 자동 매칭 활성 — 행 더블클릭 또는 purchasePrice.autoMatchAll()');
})();
