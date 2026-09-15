// =====================================================
//  TAX INVOICE — VAT 세금계산서 발행 추적 (Sprint 4 · #2)
//
//  기능
//   1) 출고지시서(deliveryOrder) 단위로 세금계산서 상태 추적
//      상태: 미발행 / 발행대기 / 발행완료 / 입금완료
//   2) 발행 일자, 계산서 번호, 공급가액·부가세·합계, 세금계산서 PDF/이미지 첨부
//   3) 일괄 발행 처리 (월말 정산용)
//   4) 미발행 알림 — 출고완료 후 N일 경과 시
//   5) 통계: 발행률, 미수금, 월별 발행액, 매출 인식 시점
//
//  데이터 구조
//   localMeta[doId 또는 pjNo].taxInvoice = {
//     status, no, issueDate, supplyAmount, vat, total, paidDate, fileRef, notes
//   }
//
//  공개 API: window.taxInvoice
// =====================================================
(function() {
  'use strict';

  // safety.js 보호 — localMeta 안에 들어가므로 별도 키 불필요
  // (erp_local 이 이미 보호됨)

  // ── 헬퍼 ─────────────────────────────────────────
  function _e(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }
  function _ea(v) {
    return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,'');
  }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _daysSince(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(_today()) - new Date(dateStr);
    return Math.floor(diff / 86400000);
  }

  // ── 데이터 액세스 ─────────────────────────────────
  // 출고지시서 1건을 식별하는 키: rowId 또는 pjNo
  function _metaKey(d) { return d.rowId || d.pjNo || d.id; }

  function getInvoice(doId) {
    if (typeof deliveryOrders === 'undefined') return null;
    const d = deliveryOrders.find(x => x.id === doId);
    if (!d) return null;
    const key = _metaKey(d);
    if (!key || typeof localMeta === 'undefined') return null;
    return (localMeta[key] && localMeta[key].taxInvoice) || null;
  }

  function setInvoice(doId, patch) {
    if (typeof deliveryOrders === 'undefined') throw new Error('deliveryOrders 미로드');
    const d = deliveryOrders.find(x => x.id === doId);
    if (!d) throw new Error('출고지시서 없음: ' + doId);
    const key = _metaKey(d);
    if (!key) throw new Error('식별 키 없음 (rowId/pjNo 모두 비어있음)');
    if (typeof localMeta === 'undefined') throw new Error('localMeta 미로드');
    if (!localMeta[key]) localMeta[key] = {};
    localMeta[key].taxInvoice = { ...(localMeta[key].taxInvoice || {}), ...patch };
    if (typeof saveLocal === 'function') saveLocal();
    return localMeta[key].taxInvoice;
  }

  function clearInvoice(doId) {
    if (typeof deliveryOrders === 'undefined') return;
    const d = deliveryOrders.find(x => x.id === doId);
    if (!d) return;
    const key = _metaKey(d);
    if (!key || typeof localMeta === 'undefined' || !localMeta[key]) return;
    delete localMeta[key].taxInvoice;
    if (typeof saveLocal === 'function') saveLocal();
  }

  // ── 발행 처리 ────────────────────────────────────
  function issue(doId, opts) {
    opts = opts || {};
    const d = deliveryOrders.find(x => x.id === doId);
    if (!d) throw new Error('출고지시서 없음');
    if (!d.processed) {
      if (!confirm('출고처리 안 된 지시서입니다.\n그래도 세금계산서를 발행하시겠습니까?')) return null;
    }
    // 자동 금액 계산 — 출고지시서의 totalAmount 또는 수주의 수주총액 활용
    let supplyAmount = Number(opts.supplyAmount) || Number(d.totalAmount) || 0;
    if (!supplyAmount && d.pjNo && typeof getEnriched === 'function') {
      const o = getEnriched().find(x => x.pjNo === d.pjNo);
      if (o) supplyAmount = Number(o.수주총액) || 0;
    }
    const vat = Math.round(supplyAmount * 0.1);
    return setInvoice(doId, {
      status: '발행완료',
      no: opts.no || _genInvoiceNo(),
      issueDate: opts.issueDate || _today(),
      supplyAmount,
      vat,
      total: supplyAmount + vat,
      notes: opts.notes || ''
    });
  }

  function markPaid(doId, opts) {
    opts = opts || {};
    return setInvoice(doId, {
      status: '입금완료',
      paidDate: opts.paidDate || _today(),
      paidNotes: opts.paidNotes || ''
    });
  }

  function markPending(doId, opts) {
    opts = opts || {};
    return setInvoice(doId, {
      status: '발행대기',
      pendingNotes: opts.notes || '',
      requestedAt: opts.requestedAt || _today()
    });
  }

  // 자동 번호 — TI-YYYYMMDD-NNN
  function _genInvoiceNo() {
    const today = _today().replace(/-/g,'');
    const all = listAll();
    const sameDay = all.filter(x => x.invoice && x.invoice.no && x.invoice.no.startsWith('TI-'+today));
    const next = String(sameDay.length + 1).padStart(3, '0');
    return 'TI-' + today + '-' + next;
  }

  // ── 일괄 발행 ────────────────────────────────────
  // 처리된 출고지시서 중 미발행 또는 발행대기인 것을 일괄 발행
  function bulkIssue(doIds, opts) {
    opts = opts || {};
    const results = { issued: [], skipped: [], failed: [] };
    doIds.forEach(doId => {
      try {
        const cur = getInvoice(doId);
        if (cur && cur.status === '발행완료') {
          results.skipped.push({ doId, reason: '이미 발행됨' });
          return;
        }
        if (cur && cur.status === '입금완료') {
          results.skipped.push({ doId, reason: '입금완료' });
          return;
        }
        const inv = issue(doId, { issueDate: opts.issueDate || _today() });
        if (inv) results.issued.push({ doId, no: inv.no });
      } catch (err) {
        results.failed.push({ doId, error: err.message });
      }
    });
    return results;
  }

  // ── 조회 ─────────────────────────────────────────
  // 모든 출고지시서 + 세금계산서 상태 (조인된 형태로 반환)
  function listAll() {
    if (typeof deliveryOrders === 'undefined') return [];
    return deliveryOrders.map(d => {
      const key = _metaKey(d);
      const inv = (typeof localMeta !== 'undefined' && localMeta[key])
        ? localMeta[key].taxInvoice : null;
      return {
        doId: d.id,
        pjNo: d.pjNo || '',
        date: d.date || '',
        processed: !!d.processed,
        totalAmount: d.totalAmount || 0,
        invoice: inv,
        // 미발행 경과일 (발행 안 됐고 출고처리 됐을 때만)
        daysOverdue: (!inv || inv.status === '미발행')
          ? (d.processed ? _daysSince(d.date) : null)
          : null
      };
    });
  }

  function summary() {
    const all = listAll();
    let total = all.length;
    const byStatus = { '미발행':0, '발행대기':0, '발행완료':0, '입금완료':0 };
    let totalSupply = 0, totalVat = 0, totalIssued = 0, totalPaid = 0;
    let overdue7 = 0, overdue30 = 0;
    all.forEach(x => {
      const status = x.invoice?.status || '미발행';
      byStatus[status] = (byStatus[status]||0) + 1;
      if (x.invoice) {
        totalSupply += x.invoice.supplyAmount || 0;
        totalVat += x.invoice.vat || 0;
        if (x.invoice.status === '발행완료' || x.invoice.status === '입금완료') {
          totalIssued += x.invoice.total || 0;
        }
        if (x.invoice.status === '입금완료') {
          totalPaid += x.invoice.total || 0;
        }
      }
      if (x.daysOverdue !== null && x.daysOverdue >= 7) overdue7++;
      if (x.daysOverdue !== null && x.daysOverdue >= 30) overdue30++;
    });
    return {
      total, byStatus, totalSupply, totalVat, totalIssued, totalPaid,
      overdue7, overdue30,
      issuanceRate: total > 0 ? ((byStatus['발행완료']+byStatus['입금완료']) / total * 100).toFixed(1) : 0
    };
  }

  // 미발행 D-7 이상 경과 항목 (notify trigger 용)
  function overdueIssuance(days) {
    days = days || 7;
    return listAll().filter(x => x.daysOverdue !== null && x.daysOverdue >= days);
  }

  // ── UI ───────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-ti-modal')) return;
    const css = `
      #erp-ti-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-ti-modal.open{display:flex;}
      .ti-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1200px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .ti-hd{padding:14px 18px;background:#1565c0;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .ti-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .ti-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .ti-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .ti-stat-l{font-size:0.74em;color:#666;text-transform:uppercase;font-weight:700;}
      .ti-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .ti-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .ti-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .ti-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .ti-status{padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;}
      .ti-s-미발행{background:#ffebee;color:#c62828;}
      .ti-s-발행대기{background:#fff3e0;color:#e65100;}
      .ti-s-발행완료{background:#e3f2fd;color:#1565c0;}
      .ti-s-입금완료{background:#e8f5e9;color:#27ae60;}
      .ti-overdue{background:#c62828;color:#fff;padding:1px 6px;border-radius:4px;font-size:0.74em;font-weight:700;margin-left:4px;}
      .ti-btn{padding:5px 10px;border:none;border-radius:5px;cursor:pointer;font-size:0.78em;font-weight:700;}
      .ti-btn-primary{background:#1565c0;color:#fff;}
      .ti-btn-success{background:#27ae60;color:#fff;}
      .ti-btn-warn{background:#e65100;color:#fff;}
      .ti-btn-ghost{background:#fff;color:#555;border:1px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-ti-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-ti-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="ti-box">
        <div class="ti-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🧾 세금계산서 관리</h4>
          <div>
            <button class="ti-btn ti-btn-ghost" data-act="ti-bulk">📤 일괄 발행</button>
            <button class="ti-btn ti-btn-ghost" onclick="document.getElementById('erp-ti-modal').classList.remove('open')">✕</button>
          </div>
        </div>
        <div class="ti-bd" id="ti-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);
  }

  function _renderList() {
    const s = summary();
    const all = listAll().sort((a,b) => (b.date||'').localeCompare(a.date||''));
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : (_fmt(v) + '원');

    const html = `
      <div class="ti-stats">
        <div class="ti-stat"><div class="ti-stat-l">전체 출고지시서</div><div class="ti-stat-v">${s.total}건</div></div>
        <div class="ti-stat"><div class="ti-stat-l">미발행</div><div class="ti-stat-v" style="color:#c62828;">${s.byStatus['미발행']||0}</div></div>
        <div class="ti-stat"><div class="ti-stat-l">발행완료</div><div class="ti-stat-v" style="color:#1565c0;">${s.byStatus['발행완료']||0}</div></div>
        <div class="ti-stat"><div class="ti-stat-l">입금완료</div><div class="ti-stat-v" style="color:#27ae60;">${s.byStatus['입금완료']||0}</div></div>
        <div class="ti-stat"><div class="ti-stat-l">발행률</div><div class="ti-stat-v">${s.issuanceRate}%</div></div>
        <div class="ti-stat"><div class="ti-stat-l">D-7 미발행</div><div class="ti-stat-v" style="color:#c62828;">${s.overdue7}</div></div>
        <div class="ti-stat"><div class="ti-stat-l">총 발행액</div><div class="ti-stat-v">${fmtMoney(s.totalIssued)}</div></div>
        <div class="ti-stat"><div class="ti-stat-l">입금 완료액</div><div class="ti-stat-v" style="color:#27ae60;">${fmtMoney(s.totalPaid)}</div></div>
      </div>

      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
        <strong>필터:</strong>
        <button class="ti-btn ti-btn-ghost" data-filter="all">전체</button>
        <button class="ti-btn ti-btn-ghost" data-filter="미발행">미발행</button>
        <button class="ti-btn ti-btn-ghost" data-filter="발행대기">대기</button>
        <button class="ti-btn ti-btn-ghost" data-filter="발행완료">발행</button>
        <button class="ti-btn ti-btn-ghost" data-filter="입금완료">입금</button>
        <button class="ti-btn ti-btn-warn" data-filter="overdue">⚠️ 7일 초과 미발행</button>
      </div>

      <table class="ti-tbl" id="ti-tbl">
        <thead><tr>
          <th><input type="checkbox" id="ti-cb-all" onchange="document.querySelectorAll('.ti-cb').forEach(cb=>cb.checked=this.checked)"></th>
          <th>출고일</th><th>출고지시서</th><th>PJ NO</th><th style="text-align:right;">금액</th>
          <th>발행상태</th><th>발행번호</th><th>발행일</th><th>경과</th><th>액션</th>
        </tr></thead>
        <tbody>
          ${all.length === 0
            ? '<tr><td colspan="10" style="padding:30px;text-align:center;color:#bbb;">출고지시서 없음</td></tr>'
            : all.map(x => {
              const st = x.invoice?.status || '미발행';
              const overdueBadge = x.daysOverdue !== null && x.daysOverdue >= 7
                ? `<span class="ti-overdue">D+${x.daysOverdue}</span>` : '';
              return `<tr data-do="${_ea(x.doId)}" data-status="${_ea(st)}" data-overdue="${x.daysOverdue||0}">
                <td><input type="checkbox" class="ti-cb" data-do="${_ea(x.doId)}" ${x.processed?'':'disabled'}></td>
                <td>${_e(x.date)}</td>
                <td style="font-weight:700;color:#1565c0;">${_e(x.doId)}${x.processed?'':'<br><span style="font-size:0.74em;color:#888;">미처리</span>'}</td>
                <td>${_e(x.pjNo)}</td>
                <td style="text-align:right;font-weight:700;">${fmtMoney(x.totalAmount)}</td>
                <td><span class="ti-status ti-s-${st}">${_e(st)}</span></td>
                <td>${_e(x.invoice?.no || '-')}</td>
                <td>${_e(x.invoice?.issueDate || '-')}${x.invoice?.paidDate?'<br><span style="font-size:0.74em;color:#27ae60;">입금: '+_e(x.invoice.paidDate)+'</span>':''}</td>
                <td>${overdueBadge}</td>
                <td>
                  ${st === '미발행' && x.processed ? `<button class="ti-btn ti-btn-primary" data-act="ti-issue" data-do="${_ea(x.doId)}">📤 발행</button>` : ''}
                  ${st === '발행대기' ? `<button class="ti-btn ti-btn-primary" data-act="ti-issue" data-do="${_ea(x.doId)}">📤 발행</button>` : ''}
                  ${st === '발행완료' ? `<button class="ti-btn ti-btn-success" data-act="ti-paid" data-do="${_ea(x.doId)}">💰 입금</button>` : ''}
                  ${(st === '발행완료' || st === '입금완료') ? `<button class="ti-btn ti-btn-ghost" data-act="ti-edit" data-do="${_ea(x.doId)}">📝</button>` : ''}
                  ${(st !== '미발행') ? `<button class="ti-btn ti-btn-ghost" data-act="ti-clear" data-do="${_ea(x.doId)}" title="발행 취소">↩️</button>` : ''}
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>`;
    document.getElementById('ti-bd').innerHTML = html;
    _bindFilters();
  }

  function _bindFilters() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.onclick = () => _applyFilter(btn.getAttribute('data-filter'));
    });
  }

  function _applyFilter(filter) {
    const rows = document.querySelectorAll('#ti-tbl tbody tr[data-do]');
    rows.forEach(tr => {
      const status = tr.getAttribute('data-status');
      const overdue = parseInt(tr.getAttribute('data-overdue') || '0');
      let show = true;
      if (filter === 'all') show = true;
      else if (filter === 'overdue') show = (status === '미발행' && overdue >= 7);
      else show = (status === filter);
      tr.style.display = show ? '' : 'none';
    });
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const doId = btn.getAttribute('data-do');

    if (act === 'ti-issue') {
      const inv = issue(doId);
      if (inv && typeof setBanner === 'function')
        setBanner('ok', `📤 세금계산서 ${inv.no} 발행 완료`);
      _renderList();
    }
    else if (act === 'ti-paid') {
      const date = prompt('입금일 (YYYY-MM-DD):', _today());
      if (!date) return;
      markPaid(doId, { paidDate: date });
      if (typeof setBanner === 'function') setBanner('ok', '💰 입금 처리 완료');
      _renderList();
    }
    else if (act === 'ti-edit') {
      const cur = getInvoice(doId);
      const no = prompt('계산서 번호:', cur?.no || '');
      if (no === null) return;
      const date = prompt('발행일 (YYYY-MM-DD):', cur?.issueDate || _today());
      if (date === null) return;
      const supplyStr = prompt('공급가액 (원):', cur?.supplyAmount || 0);
      if (supplyStr === null) return;
      const supply = Number(supplyStr) || 0;
      setInvoice(doId, {
        status: '발행완료',
        no, issueDate: date,
        supplyAmount: supply,
        vat: Math.round(supply * 0.1),
        total: supply + Math.round(supply * 0.1)
      });
      _renderList();
    }
    else if (act === 'ti-clear') {
      if (!confirm('세금계산서 발행 정보를 삭제하시겠습니까?')) return;
      clearInvoice(doId);
      _renderList();
    }
    else if (act === 'ti-bulk') {
      const checked = Array.from(document.querySelectorAll('.ti-cb:checked'))
        .map(cb => cb.getAttribute('data-do'));
      if (!checked.length) {
        alert('체크박스로 발행할 출고지시서를 선택하세요.');
        return;
      }
      if (!confirm(`선택한 ${checked.length}건을 일괄 발행하시겠습니까?\n(이미 발행된 건은 자동 스킵)`)) return;
      const r = bulkIssue(checked);
      const msg = `📤 일괄 발행 결과\n• 발행: ${r.issued.length}건\n• 스킵: ${r.skipped.length}건\n• 실패: ${r.failed.length}건`;
      alert(msg);
      if (typeof setBanner === 'function')
        setBanner('ok', `✅ 일괄 발행 — ${r.issued.length}/${checked.length}건 처리`);
      _renderList();
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-ti-modal').classList.add('open');
    setTimeout(_renderList, 30);
  }
  function close() { document.getElementById('erp-ti-modal')?.classList.remove('open'); }

  // ── 공개 API ─────────────────────────────────────
  window.taxInvoice = {
    get: getInvoice, set: setInvoice, clear: clearInvoice,
    issue, markPaid, markPending, bulkIssue,
    list: listAll, summary, overdueIssuance,
    open, close
  };

  // ── 부팅 ────────────────────────────────────────
  function boot() { setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-TAX] 세금계산서 추적 활성 — taxInvoice.open()');
})();
