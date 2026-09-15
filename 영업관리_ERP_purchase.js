// =====================================================
//  PURCHASE HISTORY — Phase E · Day 1~2
//  매입 이력 자동 집계 (rawData + incoming + inventoryData)
//
//  출처
//   1) rawData 의 매입사·매입단가·수량  (수주 시점 매입)
//   2) inventoryData type=입고 + mfr           (실제 입고)
//   3) incoming status=completed              (해외 입고 완료)
//
//  KPI 4개: 총 매입수량 / 총 매입용량(MW) / 평균 KRW/Wp / 원가 연결
//
//  콘솔: purchase.list() / purchase.summary() / purchase.byVendor()
// =====================================================
(function() {
  'use strict';

  function _aggregate() {
    const rows = [];
    // 1) 수주 데이터에서 매입 정보
    if (typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          const mfr = (o.매입사||'').trim();
          if (!mfr || !o.수량) return;
          const watt = (typeof productMaster !== 'undefined' && productMaster[o.모델명] && productMaster[o.모델명].watt) || Number(o.제품용량) || 0;
          const unitPrice = Number(o.매입단가)||0;
          const totalAmount = Number(o.매입총액)||0;
          rows.push({
            id: o._id,
            date: o.수주일 || '',
            model: o.모델명 || '',
            modelDetail: '',
            vendor: mfr,
            qty: Number(o.수량)||0,
            watt,
            kw: (Number(o.수량)||0) * watt / 1000,
            unitPrice,
            unitPriceWp: watt > 0 && unitPrice > 0 ? unitPrice / watt : 0,
            totalAmount,
            poRef: o.pjNo || '',
            evidence: o.pjNo ? `BR-${o.pjNo}` : '',
            warehouse: '',
            status: o.납품일 ? '입고완료' : (o.출고요청일 ? '진행중' : '발주'),
            source: 'order'
          });
        });
      } catch(e) {}
    }
    // ── dedup 헬퍼 — 모델명 정규화 + 부동소수 안전 비교 ──
    //   ★ 2026-05 추가: 엄격 비교(===)로 인한 위양성 방지.
    //   - 모델명: 공백·대소문자·특수기호 제거 후 비교 ('TSM-720NEG21C.20K' = 'tsm 720 neg21c20k')
    //   - 수량  : 부동소수 epsilon(0.001) 비교로 480 vs 480.0 또는 0.1+0.2 부동소수 오차 흡수
    const _normModel = m => String(m || '').toLowerCase().replace(/[\s\-_.,/\\()[\]{}]+/g, '');
    const _qtyEq = (a, b) => Math.abs(Number(a||0) - Number(b||0)) < 0.001;
    const _vendorEq = (a, b) => String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase();

    // 2) inventoryData에서 추가 (수주에 없는 직접 입고)
    //    ★ 2026-05 변경: 기존 dedup(model+vendor+date)이 같은 날짜·같은 모델·같은 매입사의
    //    여러 창고 입고를 1건으로 합쳐 4/5 누락. 이제 inventoryData의 record id 단위로
    //    고유 추가하고, 수주 row와는 evidence(B/L 또는 PJ NO)+model+qty 조합으로만 중복 제거.
    //    ★ 2026-05 보강: 모델명 정규화 + qty epsilon 비교로 부동소수/표기 차이 안전 처리.
    if (typeof inventoryData !== 'undefined') {
      inventoryData.forEach(r => {
        if (r.type !== '입고') return;
        // 동일한 inventoryData id가 이미 들어왔으면 skip (재호출 안전성)
        if (rows.some(x => x.source === 'inventory' && x.id === r.id)) return;
        // 수주(order) 행과 evidence·모델·수량이 모두 일치하면 동일 건으로 간주
        const evid = r.bl || r.pjNo || '';
        const rModelN = _normModel(r.model);
        if (evid && rows.some(x =>
          x.source === 'order' &&
          x.evidence === evid &&
          _normModel(x.model) === rModelN &&
          _qtyEq(x.qty, r.qty)
        )) return;
        const watt = (typeof productMaster !== 'undefined' && productMaster[r.model] && productMaster[r.model].watt) || Number(r.watt) || 0;
        // ★ 2026-05 수정: inventoryData 의 unitPrice/totalAmount 가 있으면 그대로 사용
        //   (입고 등록 시 사용자가 입력한 단가, 또는 매입단가 수동 편집으로 저장된 값)
        const qty = Number(r.qty)||0;
        const unitPrice = Number(r.unitPrice) || 0;
        const totalAmount = Number(r.totalAmount) || (unitPrice * qty);
        const unitPriceWp = (watt > 0 && unitPrice > 0) ? unitPrice / watt : 0;
        rows.push({
          id: r.id,
          date: r.date || '',
          model: r.model || '',
          modelDetail: '',
          vendor: r.mfr || '',
          qty,
          watt,
          kw: qty * watt / 1000,
          unitPrice,                       // ← 0 하드코딩 → 실제 값
          unitPriceWp,                     // ← 자동 계산
          totalAmount,                     // ← unitPrice × qty 자동
          poRef: r.pjNo || '',
          evidence: r.bl ? r.bl : (r.pjNo || ''),
          warehouse: r.warehouse || '',
          status: '입고완료',
          source: 'inventory'
        });
      });
    }
    // 3) incoming completed (B/L 단위 중복 제거)
    //    ★ 2026-05 보강: 모델명 normalize + 매입사 trim/lowercase 일치 검사
    if (typeof incoming !== 'undefined' && incoming.list) {
      incoming.list().forEach(r => {
        if (r.status !== 'completed') return;
        const rModelN = _normModel(r.model);
        // B/L 가 비어있으면 중복 검사를 우회하여 항상 추가
        const dup = !!r.bl && rows.some(x =>
          x.evidence === r.bl &&
          _normModel(x.model) === rModelN &&
          _vendorEq(x.vendor, r.mfr)
        );
        if (dup) return;
        rows.push({
          id: r.id,
          date: r.eta || r.etd || '',
          model: r.model,
          modelDetail: '',
          vendor: r.mfr,
          qty: r.qty,
          watt: r.watt,
          kw: r.qty * r.watt / 1000,
          unitPrice: 0,
          unitPriceWp: 0,
          totalAmount: 0,
          poRef: r.poNo || '',
          evidence: r.bl || '',
          warehouse: r.dest || '',
          status: '입고완료',
          source: 'incoming'
        });
      });
    }
    return rows.sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }

  function summary() {
    const rows = _aggregate();
    const totalQty = rows.reduce((s,r) => s + r.qty, 0);
    const totalKw = rows.reduce((s,r) => s + r.kw, 0);
    const withPrice = rows.filter(r => r.unitPriceWp > 0);
    const avgKrwWp = withPrice.length ? withPrice.reduce((s,r) => s + r.unitPriceWp, 0) / withPrice.length : 0;
    const totalAmount = rows.reduce((s,r) => s + r.totalAmount, 0);
    const linked = rows.filter(r => r.evidence).length;
    return { rows, totalQty, totalKw, totalMw: totalKw/1000, avgKrwWp, totalAmount, linked, total: rows.length };
  }

  function byVendor() {
    const map = {};
    _aggregate().forEach(r => {
      if (!r.vendor) return;
      if (!map[r.vendor]) map[r.vendor] = { vendor: r.vendor, count: 0, totalQty: 0, totalKw: 0, totalAmount: 0, prices: [] };
      const m = map[r.vendor];
      m.count++; m.totalQty += r.qty; m.totalKw += r.kw; m.totalAmount += r.totalAmount;
      if (r.unitPriceWp > 0) m.prices.push(r.unitPriceWp);
    });
    return Object.values(map).map(m => {
      const avg = m.prices.length ? m.prices.reduce((s,p) => s+p, 0) / m.prices.length : 0;
      const min = m.prices.length ? Math.min(...m.prices) : 0;
      const max = m.prices.length ? Math.max(...m.prices) : 0;
      return { ...m, avgKrwWp: avg, minKrwWp: min, maxKrwWp: max, prices: undefined };
    }).sort((a,b) => b.totalAmount - a.totalAmount);
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-pur-fab')) return;
    const css = `
      #erp-pur-fab{position:fixed;bottom:18px;right:398px;width:44px;height:44px;border-radius:50%;
        background:#5d4037;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;}
      #erp-pur-fab:hover{background:#3e2723;transform:scale(1.07);}
      #erp-pur-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:5vh;}
      #erp-pur-modal.open{display:flex;}
      .pur-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:92%;max-width:1180px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}
      .pur-hd{padding:14px 18px;background:#5d4037;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .pur-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 18px;background:#fafafa;border-bottom:1px solid #eee;}
      .pur-stat{padding:10px;border-radius:8px;background:#fff;border:1px solid #e0e0e0;}
      .pur-stat-l{font-size:0.74em;color:#888;font-weight:600;margin-bottom:4px;}
      .pur-stat-v{font-size:1.3em;font-weight:800;color:#1a1a2e;}
      .pur-stat-s{font-size:0.74em;color:#666;margin-top:2px;}
      .pur-tabs{display:flex;border-bottom:1px solid #eee;background:#fff;}
      .pur-tabs button{flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-size:0.86em;color:#888;border-bottom:2px solid transparent;}
      .pur-tabs button.active{color:#5d4037;font-weight:700;border-bottom-color:#5d4037;background:#fff;}
      .pur-toolbar{padding:8px 18px;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center;}
      .pur-toolbar input,.pur-toolbar select{padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.84em;}
      .pur-toolbar input.search{flex:1;}
      .pur-bd{flex:1;overflow-y:auto;padding:0;}
      .pur-tbl{width:100%;border-collapse:collapse;font-size:0.84em;}
      .pur-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;position:sticky;top:0;font-size:0.82em;}
      .pur-tbl td{padding:8px 10px;border-bottom:1px solid #eee;}
      .pur-tbl tr:hover{background:#fafafa;}
      .pur-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;background:#e8f5e9;color:#2e7d32;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-pur-style'; style.textContent = css;
    document.head.appendChild(style);

    // ★ 2026-05-12 구매이력 FAB 비활성 — 메뉴/탭에서 구매이력 제거됨 (사용자 요청)
    //   (다른 모듈이 window.purchase API 를 참조하므로 모듈 자체는 유지)
    // const fab = document.createElement('button');
    // fab.id = 'erp-pur-fab'; fab.title = '구매이력 (매입 단가·연결)'; fab.textContent = '🧾';
    // fab.onclick = open; document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'erp-pur-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="pur-box">
        <div class="pur-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🧾 구매이력 — 자체 매입 단가 + 국내 타사 구매 내역</h4>
          <button onclick="document.getElementById('erp-pur-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div id="pur-stats" class="pur-stats"></div>
        <div class="pur-tabs">
          <button data-tab="list" class="active" onclick="purchase._tab('list')">📋 매입 이력</button>
          <button data-tab="vendor" onclick="purchase._tab('vendor')">🏭 매입사별</button>
          <button data-tab="trend" onclick="purchase._tab('trend')">📈 단가 추세</button>
        </div>
        <div class="pur-toolbar">
          <input class="search" id="pur-search" placeholder="🔍 품번 / 매입처 / B/L / PO">
          <select id="pur-vendor-filter"><option value="">전체 매입처</option></select>
          <select id="pur-status-filter">
            <option value="">전체 상태</option>
            <option value="발주">발주</option>
            <option value="진행중">진행중</option>
            <option value="입고완료">입고완료</option>
          </select>
          <button class="btn btn-sm btn-dark" onclick="purchase.exportCSV()">📋 CSV</button>
        </div>
        <div class="pur-bd" id="pur-bd"></div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('pur-search').addEventListener('input', () => _renderTab(_currentTab));
    document.getElementById('pur-vendor-filter').addEventListener('change', () => _renderTab(_currentTab));
    document.getElementById('pur-status-filter').addEventListener('change', () => _renderTab(_currentTab));
  }

  let _currentTab = 'list';
  function _tab(t) {
    _currentTab = t;
    document.querySelectorAll('#erp-pur-modal .pur-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === t);
    });
    _renderTab(t);
  }

  function _renderTab(tab) {
    const s = summary();
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';

    document.getElementById('pur-stats').innerHTML = `
      <div class="pur-stat"><div class="pur-stat-l">총 매입수량</div><div class="pur-stat-v">${s.totalQty.toLocaleString()}장</div></div>
      <div class="pur-stat"><div class="pur-stat-l">총 매입용량</div><div class="pur-stat-v">${fmtCap(s.totalKw)}</div><div class="pur-stat-s">${s.total}건</div></div>
      <div class="pur-stat"><div class="pur-stat-l">평균 KRW/Wp</div><div class="pur-stat-v" style="color:#5d4037;">${s.avgKrwWp ? s.avgKrwWp.toFixed(2)+'원/Wp' : '-'}</div></div>
      <div class="pur-stat"><div class="pur-stat-l">원가 연결</div><div class="pur-stat-v" style="color:#27ae60;">${s.linked} / ${s.total}</div></div>`;

    // 매입처 필터 옵션 갱신
    const vendorSel = document.getElementById('pur-vendor-filter');
    if (vendorSel && vendorSel.options.length <= 1) {
      const all = [...new Set(s.rows.map(r => r.vendor).filter(Boolean))].sort();
      vendorSel.innerHTML = '<option value="">전체 매입처</option>' + all.map(v => `<option>${v}</option>`).join('');
    }

    if (tab === 'list') _renderList(s);
    if (tab === 'vendor') _renderByVendor();
    if (tab === 'trend') _renderTrend();
  }

  function _renderList(s) {
    const search = (document.getElementById('pur-search').value || '').toLowerCase();
    const vendorF = document.getElementById('pur-vendor-filter').value;
    const statusF = document.getElementById('pur-status-filter').value;
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';

    let rows = s.rows;
    if (search) rows = rows.filter(r => [r.model,r.vendor,r.evidence,r.poRef,r.warehouse].join(' ').toLowerCase().includes(search));
    if (vendorF) rows = rows.filter(r => r.vendor === vendorF);
    if (statusF) rows = rows.filter(r => r.status === statusF);

    if (!rows.length) {
      document.getElementById('pur-bd').innerHTML = '<div style="padding:40px;text-align:center;color:#bbb;">데이터 없음</div>';
      return;
    }

    document.getElementById('pur-bd').innerHTML = `
      <table class="pur-tbl">
        <thead><tr>
          <th>매입일</th><th>품목</th><th>매입처</th>
          <th style="text-align:right;">수량</th>
          <th style="text-align:right;">매입단가</th>
          <th style="text-align:right;">매입금액</th>
          <th>근거</th>
        </tr></thead>
        <tbody>${rows.slice(0, 500).map(r => `<tr>
          <td>${r.date || '-'}<br><span class="pur-tag">${r.status}</span></td>
          <td><strong>${r.model||'-'}</strong>${r.modelDetail?`<br><span style="font-size:0.78em;color:#888;">${r.modelDetail}</span>`:''}</td>
          <td>${r.vendor||'-'}<br><span style="font-size:0.78em;color:#888;">${r.source==='order'?'수주':r.source==='inventory'?'국내':'해외'}</span></td>
          <td style="text-align:right;">${r.qty.toLocaleString()}장<br><span style="font-size:0.78em;color:#1565c0;">${r.kw>0?fmtCap(r.kw):''}</span></td>
          <td style="text-align:right;">${r.unitPrice?r.unitPrice.toLocaleString()+'원':'-'}<br><span style="font-size:0.78em;color:#888;">${r.unitPriceWp?r.unitPriceWp.toFixed(2)+'/Wp':'—'}</span></td>
          <td style="text-align:right;">${r.totalAmount?(typeof fmtKrAmt==='function'?fmtKrAmt(r.totalAmount):Math.round(r.totalAmount/10000).toLocaleString()+'만원'):'—'}<br><span style="font-size:0.78em;color:#888;">KRW</span></td>
          <td style="font-size:0.82em;">${r.evidence||'-'}${r.warehouse?`<br><span style="color:#888;">${r.warehouse}</span>`:''}</td>
        </tr>`).join('')}
        ${rows.length > 500 ? `<tr><td colspan="7" style="text-align:center;padding:10px;color:#888;font-size:0.84em;">상위 500건만 표시 (전체 ${rows.length}건)</td></tr>` : ''}
        <tr style="background:#fafafa;font-weight:700;border-top:2px solid #1a1a2e;">
          <td>합계 · ${rows.length}건</td><td>전체 품목</td><td>매입처 ${new Set(rows.map(r=>r.vendor).filter(Boolean)).size}곳</td>
          <td style="text-align:right;">${rows.reduce((s,r)=>s+r.qty,0).toLocaleString()}장 · ${fmtCap(rows.reduce((s,r)=>s+r.kw,0))}</td>
          <td style="text-align:right;">${(() => { const w = rows.filter(r=>r.unitPriceWp>0); return w.length ? (w.reduce((s,r)=>s+r.unitPriceWp,0)/w.length).toFixed(2)+'원/Wp' : '-'; })()}</td>
          <td style="text-align:right;">${(() => { const t = rows.reduce((s,r)=>s+r.totalAmount,0); return t ? (typeof fmtKrAmt==='function'?fmtKrAmt(t):Math.round(t/100000000*100)/100+'억원') : '-'; })()}</td>
          <td style="font-size:0.78em;">현재 검색/필터 기준</td>
        </tr>
        </tbody>
      </table>`;
  }

  function _renderByVendor() {
    const list = byVendor();
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';
    if (!list.length) {
      document.getElementById('pur-bd').innerHTML = '<div style="padding:40px;text-align:center;color:#bbb;">데이터 없음</div>';
      return;
    }
    document.getElementById('pur-bd').innerHTML = `
      <table class="pur-tbl">
        <thead><tr>
          <th>매입처</th><th style="text-align:right;">건수</th>
          <th style="text-align:right;">총 수량</th><th style="text-align:right;">총 용량</th>
          <th style="text-align:right;">평균 KRW/Wp</th>
          <th style="text-align:right;">최저~최고</th>
          <th style="text-align:right;">매입금액</th>
        </tr></thead>
        <tbody>${list.map(v => `<tr>
          <td><strong>${v.vendor}</strong></td>
          <td style="text-align:right;">${v.count}</td>
          <td style="text-align:right;">${v.totalQty.toLocaleString()}장</td>
          <td style="text-align:right;color:#1565c0;font-weight:700;">${fmtCap(v.totalKw)}</td>
          <td style="text-align:right;font-weight:700;color:#5d4037;">${v.avgKrwWp?v.avgKrwWp.toFixed(2)+'원':'-'}</td>
          <td style="text-align:right;font-size:0.82em;">${v.minKrwWp?`${v.minKrwWp.toFixed(2)} ~ ${v.maxKrwWp.toFixed(2)}`:'-'}</td>
          <td style="text-align:right;">${v.totalAmount?(typeof fmtKrAmt==='function'?fmtKrAmt(v.totalAmount):Math.round(v.totalAmount/10000).toLocaleString()+'만원'):'-'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  function _renderTrend() {
    const rows = _aggregate().filter(r => r.unitPriceWp > 0 && r.date).sort((a,b) => a.date.localeCompare(b.date));
    if (rows.length < 2) {
      document.getElementById('pur-bd').innerHTML = '<div style="padding:40px;text-align:center;color:#bbb;">단가 데이터 부족 (2건 이상 필요)</div>';
      return;
    }
    // 모델별 그룹화
    const byModel = {};
    rows.forEach(r => {
      if (!byModel[r.model]) byModel[r.model] = [];
      byModel[r.model].push(r);
    });
    const html = Object.entries(byModel).map(([model, list]) => {
      const minP = Math.min(...list.map(r => r.unitPriceWp));
      const maxP = Math.max(...list.map(r => r.unitPriceWp));
      const avgP = list.reduce((s,r) => s + r.unitPriceWp, 0) / list.length;
      const trend = list.length >= 2
        ? (list[list.length-1].unitPriceWp > list[0].unitPriceWp ? '📈 상승' : list[list.length-1].unitPriceWp < list[0].unitPriceWp ? '📉 하락' : '→ 보합')
        : '-';
      return `<div style="padding:14px;border-bottom:1px solid #eee;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${model}</strong>
          <span style="background:#fff3e0;color:#e65100;padding:2px 10px;border-radius:5px;font-size:0.84em;font-weight:700;">${trend}</span>
        </div>
        <div style="margin-top:6px;font-size:0.84em;color:#666;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          <span>최저 <strong>${minP.toFixed(2)}</strong>원/Wp</span>
          <span>평균 <strong>${avgP.toFixed(2)}</strong>원/Wp</span>
          <span>최고 <strong>${maxP.toFixed(2)}</strong>원/Wp</span>
          <span>${list.length}건 (${list[0].date} ~ ${list[list.length-1].date})</span>
        </div>
      </div>`;
    }).join('');
    document.getElementById('pur-bd').innerHTML = html || '<div style="padding:40px;text-align:center;color:#bbb;">추세 데이터 없음</div>';
  }

  function exportCSV() {
    const rows = _aggregate();
    if (!rows.length) { alert('데이터 없음'); return; }
    // 한글 헤더로 가독성 향상 — 영문 컬럼명을 한글로 매핑
    const colMap = [
      ['date','매입일'], ['model','모델명'], ['vendor','매입처'],
      ['qty','수량'], ['watt','단품용량(W)'], ['kw','용량(kW)'],
      ['unitPrice','매입단가'], ['unitPriceWp','KRW/Wp'], ['totalAmount','매입금액'],
      ['poRef','PO 번호'], ['evidence','근거(B/L·PJ)'], ['warehouse','창고'], ['status','상태']
    ];
    const aoa = [colMap.map(c => c[1])].concat(
      rows.map(r => colMap.map(c => r[c[0]] ?? ''))
    );
    // ★ UTF-8 BOM 포함 → Excel 한글 깨짐 방지
    const csv = (typeof csvJoin === 'function') ? csvJoin(aoa) : aoa.map(row => row.join(',')).join('\r\n');
    const fname = `구매이력_${new Date().toISOString().slice(0,10)}.csv`;
    if (typeof downloadCsv === 'function') downloadCsv(fname, csv);
    else {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
    }
  }

  function open() {
    _injectUI();
    document.getElementById('erp-pur-modal').classList.add('open');
    _tab('list');
  }
  function close() { document.getElementById('erp-pur-modal')?.classList.remove('open'); }

  window.purchase = {
    list: _aggregate, summary, byVendor,
    open, close, exportCSV, _tab,
    raw: _aggregate
  };

  // ── 탭 마운트 (purchase 탭으로 전환 시 box 를 host 로 이동) ────
  function _mountToTab(){
    const host = document.getElementById('purchaseTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-pur-modal');
    if (!modal) {
      try { _injectUI(); } catch(e){ console.error('[purchase] _injectUI 실패:', e); return; }
      modal = document.getElementById('erp-pur-modal');
      if (!modal) return;
    }
    const box = modal.querySelector('.pur-box');
    if (!box) return;
    modal.style.display = 'none';
    modal.classList.remove('open');
    if (!host.contains(box)) {
      host.appendChild(box);
      box.style.maxHeight = 'none';
      box.style.width = '100%';
      box.style.maxWidth = '100%';
      box.style.boxShadow = 'none';
      box.style.borderRadius = '12px';
    }
    try { _tab('list'); } catch(e){}
  }

  function _hookShowTabForPurchase(){
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTabForPurchase, 300); return; }
    if (window.showTab.__purchaseHooked) return;
    const orig = window.showTab;
    window.showTab = function(id){
      const r = orig.apply(this, arguments);
      if (id === 'purchase') setTimeout(_mountToTab, 30);
      return r;
    };
    window.showTab.__purchaseHooked = true;
  }

  // open() 호출 시 탭으로 이동
  const _origPurOpen = window.purchase.open;
  window.purchase.open = function(){
    if (typeof showTab === 'function' && document.getElementById('tab-purchase')) {
      showTab('purchase');
    } else if (typeof _origPurOpen === 'function') {
      _origPurOpen();
    }
  };

  function boot() { _injectUI(); setTimeout(_hookShowTabForPurchase, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-PUR] 구매이력 모듈 활성 — 탭(showTab("purchase")) 또는 purchase.open()');
})();
