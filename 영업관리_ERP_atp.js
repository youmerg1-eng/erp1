// =====================================================
//  ATP (Available To Promise) — Phase B · Week 8
//
//  핵심 공식
//    ATP(model) = 실재고 − 미출고 확정 출고 − 안전재고
//
//  실재고     = sum(입고 qty) − sum(출고 qty)        [from inventoryData]
//  미출고확정 = sum(deliveryOrders.qty if !processed) [확정 출고지시서]
//             + sum(rawData 수량 if status==수주 AND deliveryOrderId 없음)  [수주 미발행]
//  안전재고   = productMaster[model].safetyStock || 0
//
//  영업이 "있어요/없어요"에 즉답하기 위한 핵심 지표.
//  기존 UI 침범 없음 — 우측 하단 📦 fab + 자체 패널.
//
//  콘솔
//    atp.of('TSM-720')        한 모델
//    atp.all()                전체 모델 표
//    atp.open()               패널 열기
// =====================================================
(function() {
  'use strict';

  function _stockMap() {
    const m = {};
    if (typeof inventoryData === 'undefined') return m;
    inventoryData.forEach(r => {
      const k = (r.model||'').trim();
      if (!k) return;
      if (!m[k]) m[k] = { in:0, out:0, byWh:{} };
      const q = Number(r.qty)||0;
      if (r.type === '입고') m[k].in += q;
      else                   m[k].out += q;
      const wh = (r.warehouse||'').trim();
      if (wh) {
        if (!m[k].byWh[wh]) m[k].byWh[wh] = 0;
        m[k].byWh[wh] += r.type === '입고' ? q : -q;
      }
    });
    return m;
  }

  function _committedMap() {
    const m = {};
    // (1) 미출고 확정 출고지시서
    if (typeof deliveryOrders !== 'undefined') {
      deliveryOrders.forEach(d => {
        if (d.processed) return;
        const k = (d.model||'').trim();
        if (!k) return;
        if (!m[k]) m[k] = { fromDO:0, fromOrder:0 };
        m[k].fromDO += (Number(d.qty)||0) + (Number(d.foc)||0);
      });
    }
    // (2) status=수주 + 출고지시서 미발행 (대기 수주의 잠재 출고)
    if (typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          if (o.status !== '수주') return;
          if (o.deliveryOrderId) return;  // 이미 출고지시서 있음 → fromDO에 잡힘
          const k = (o.모델명||'').trim();
          if (!k) return;
          if (!m[k]) m[k] = { fromDO:0, fromOrder:0 };
          m[k].fromOrder += Number(o.수량)||0;
        });
      } catch(e) {}
    }
    return m;
  }

  function compute(model) {
    const k = String(model||'').trim();
    if (!k) return null;
    const sm = _stockMap();
    const cm = _committedMap();
    const stock = sm[k] || { in:0, out:0, byWh:{} };
    const onHand = stock.in - stock.out;
    const committed = cm[k] || { fromDO:0, fromOrder:0 };
    // [Day 3] 4분할: 판매배정(수주미발행) / 공사배정(출고지시서) / 안전재고 / 가용
    const sale = committed.fromOrder;        // 수주 상태이지만 출고지시서 미발행
    const project = committed.fromDO;         // 출고지시서 발행 (현장 공사 배정)
    const safety = 0;  // 안전재고 사용 안 함 (요청에 의해 제거)
    const atp = onHand - sale - project;
    // 모델 watt → MW 환산
    const watt = (typeof productMaster !== 'undefined' && productMaster[k] && productMaster[k].watt) || 0;
    return {
      model: k,
      onHand,
      committed: sale + project,
      committedDO: project,
      committedOrder: sale,
      sale, project,
      safety,
      atp,
      byWh: stock.byWh,
      pltSize: (typeof productMaster !== 'undefined' && productMaster[k] && productMaster[k].plt) || 0,
      watt,
      kw: { onHand: (onHand*watt)/1000, sale: (sale*watt)/1000, project: (project*watt)/1000, atp: (atp*watt)/1000 }
    };
  }

  function _allKnownModels() {
    const set = new Set();
    if (typeof inventoryData !== 'undefined') inventoryData.forEach(r => r.model && set.add(r.model.trim()));
    if (typeof deliveryOrders !== 'undefined') deliveryOrders.forEach(d => d.model && set.add(d.model.trim()));
    if (typeof getEnriched === 'function') {
      try { getEnriched().forEach(o => o.모델명 && set.add(o.모델명.trim())); } catch(e) {}
    }
    if (typeof productMaster !== 'undefined') Object.keys(productMaster).forEach(m => set.add(m));
    set.delete(''); return [...set];
  }

  function all() {
    return _allKnownModels()
      .map(m => compute(m))
      .filter(Boolean)
      .sort((a,b) => b.atp - a.atp);
  }

  // ── UI 패널 ─────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-atp-fab')) return;

    const css = `
      #erp-atp-fab{position:fixed;bottom:18px;right:128px;width:44px;height:44px;border-radius:50%;
        background:#27ae60;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s, background .2s;}
      #erp-atp-fab:hover{background:#1e8449;transform:scale(1.07);}
      #erp-atp-panel{position:fixed;bottom:72px;right:18px;width:540px;max-width:92vw;max-height:78vh;
        background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.25);
        z-index:9001;display:none;flex-direction:column;overflow:hidden;}
      #erp-atp-panel.open{display:flex;}
      .atp-hd{padding:14px 18px;background:#27ae60;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .atp-hd h4{margin:0;font-size:1em;font-weight:700;}
      .atp-search{padding:14px 18px;border-bottom:1px solid #eee;}
      .atp-search input{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:0.95em;box-sizing:border-box;}
      .atp-body{flex:1;overflow-y:auto;padding:14px 18px;font-size:0.86em;}
      .atp-card{background:#f8f9fa;border-left:4px solid #27ae60;border-radius:8px;padding:14px;margin-bottom:14px;}
      .atp-card.bad{border-left-color:#c62828;background:#ffebee;}
      .atp-card.warn{border-left-color:#e65100;background:#fff3e0;}
      .atp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;}
      .atp-stat{background:#fff;padding:8px;border-radius:6px;text-align:center;}
      .atp-stat-lbl{font-size:0.72em;color:#888;margin-bottom:4px;}
      .atp-stat-val{font-size:1.1em;font-weight:800;}
      .atp-tbl{width:100%;border-collapse:collapse;font-size:0.82em;background:#fff;}
      .atp-tbl thead{position:sticky;top:0;z-index:10;}
      .atp-tbl th{background:#1a1a2e;color:#fff;padding:6px;text-align:left;border-bottom:2px solid #1a1a2e;}
      .atp-tbl tbody tr{background:#fff;}
      .atp-tbl td{padding:6px;border-bottom:1px solid #eee;background:#fff;}
      .atp-tbl tbody tr:nth-child(even) td{background:#fafbfc;}
      .atp-tbl tr:hover td{background:#f0f8ff !important;cursor:pointer;}
      .atp-tbl tfoot td,.atp-tbl tr:last-child td{background:#fafafa;}
      .atp-foot{padding:8px 18px;background:#fafafa;border-top:1px solid #eee;font-size:0.74em;color:#888;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-atp-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-atp-fab';
    fab.title = '실시간 가용재고 (ATP)';
    fab.textContent = '📦';
    fab.onclick = open;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'erp-atp-panel';
    panel.innerHTML = `
      <div class="atp-hd">
        <h4>실시간 가용재고 (ATP)</h4>
        <button onclick="document.getElementById('erp-atp-panel').classList.remove('open')"
          style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div class="atp-search">
        <input id="atp-search-input" placeholder="모델명 입력 (예: TSM-720) — 즉답 가능">
      </div>
      <div class="atp-body" id="atp-body"></div>
      <div class="atp-foot">실재고 − 판매배정 − 공사배정 = ATP · 1분마다 자동 갱신</div>`;
    document.body.appendChild(panel);

    document.getElementById('atp-search-input').addEventListener('input', e => _renderBody(e.target.value));
  }

  function open() {
    // ★ 영업 탭의 가용재고 서브탭으로 이동됨 (2026-05-12)
    if (typeof window.setSalesOpsSubtab === 'function'
        && document.getElementById('atpTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('salesops'); } catch(e) {}
      }
      setTimeout(() => window.setSalesOpsSubtab('atp'), 30);
      return;
    }
    const p = document.getElementById('erp-atp-panel');
    p.classList.add('open');
    const inp = document.getElementById('atp-search-input');
    setTimeout(() => inp && inp.focus(), 30);
    _renderBody(inp ? inp.value : '');
  }

  // ── 탭 마운트 (영업 탭의 atpTabHost 로 panel 이동) ──
  //   ATP 는 .box 가 없고 panel 자체가 컨테이너 — 통째로 이동 + position 스타일 조정
  function _mountToTab() {
    const host = document.getElementById('atpTabHost');
    if (!host) return;
    let panel = document.getElementById('erp-atp-panel');
    if (!panel) { try { _injectUI(); } catch(e){ console.error('[atp] _injectUI 실패:', e); return; } panel = document.getElementById('erp-atp-panel'); if (!panel) return; }
    if (!host.contains(panel)) {
      host.appendChild(panel);
      // 패널 자체의 fixed/dimensions 제거 — 탭 영역에 자연스럽게 채움
      panel.style.position = 'static';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.width = '100%';
      panel.style.maxWidth = '100%';
      panel.style.maxHeight = 'none';
      panel.style.boxShadow = 'none';
      panel.style.borderRadius = '12px';
      panel.style.border = '1px solid #eef0f4';
    }
    panel.classList.add('open');  // display:flex 유지
    const inp = document.getElementById('atp-search-input');
    _renderBody(inp ? inp.value : '');
  }

  function _renderCard(r) {
    if (!r) return '';
    const cls = r.atp <= 0 ? 'bad' : r.atp < 10 ? 'warn' : '';
    const pltLine = r.pltSize > 0 && r.atp > 0
      ? `<div style="margin-top:8px;font-size:0.86em;color:#1565c0;">📦 ATP 분할: ${Math.floor(r.atp/r.pltSize)}PLT(${(Math.floor(r.atp/r.pltSize)*r.pltSize).toLocaleString()}매) + 소분 ${(r.atp%r.pltSize).toLocaleString()}매</div>`
      : '';
    const whLines = Object.entries(r.byWh || {})
      .filter(([,q]) => q !== 0)
      .sort((a,b) => b[1]-a[1])
      .map(([wh,q]) => `<div style="display:inline-block;margin:2px 6px 2px 0;padding:3px 8px;background:#fff;border:1px solid #e0e0e0;border-radius:5px;font-size:0.8em;">${wh}: <strong style="color:${q<0?'#c62828':'#1565c0'}">${q.toLocaleString()}</strong></div>`)
      .join('') || '<span style="color:#bbb;font-size:0.8em;">창고 분포 데이터 없음</span>';
    return `<div class="atp-card ${cls}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:800;font-size:0.96em;color:#1a1a2e;">${r.model}</div>
        <div style="font-size:1.2em;font-weight:900;color:${r.atp<=0?'#c62828':r.atp<10?'#e65100':'#27ae60'};">
          ATP: ${r.atp.toLocaleString()}매
        </div>
      </div>
      <div class="atp-grid">
        <div class="atp-stat"><div class="atp-stat-lbl">실재고</div><div class="atp-stat-val">${r.onHand.toLocaleString()}</div></div>
        <div class="atp-stat"><div class="atp-stat-lbl">판매배정</div><div class="atp-stat-val" style="color:#1565c0;">−${r.sale.toLocaleString()}</div></div>
        <div class="atp-stat"><div class="atp-stat-lbl">공사배정</div><div class="atp-stat-val" style="color:#e65100;">−${r.project.toLocaleString()}</div></div>
        <div class="atp-stat"><div class="atp-stat-lbl">가용 (ATP)</div><div class="atp-stat-val" style="color:${r.atp<=0?'#c62828':'#27ae60'};">${r.atp.toLocaleString()}</div></div>
      </div>
      ${pltLine}
      <div style="margin-top:10px;font-size:0.78em;color:#666;">
        <div style="margin-bottom:4px;">📋 미출고 내역: 출고지시서 ${r.committedDO.toLocaleString()}매 + 수주(미발행) ${r.committedOrder.toLocaleString()}매</div>
        <div>🏭 창고분포: ${whLines}</div>
      </div>
    </div>`;
  }

  function _renderBody(query) {
    const body = document.getElementById('atp-body');
    if (!body) return;
    const q = (query||'').trim().toLowerCase();

    if (q) {
      // 일치 우선, 부분 매치도 허용 (최대 3개)
      const exact = compute(q);
      const list = _allKnownModels().filter(m => m.toLowerCase().includes(q));
      const cards = list.slice(0, 5).map(m => _renderCard(compute(m))).join('');
      body.innerHTML = cards || '<div style="padding:30px;text-align:center;color:#bbb;">일치 모델 없음</div>';
      return;
    }

    // 빈 검색 → 전체 모델 정렬 표 + 위험 카드
    const list = all();
    const danger = list.filter(r => r.atp <= 0);
    const dangerHtml = danger.length
      ? `<div style="margin-bottom:14px;">${danger.slice(0,3).map(_renderCard).join('')}</div>`
      : '';
    // [Day 3] 4분할 컬럼: 실재고 / 판매배정 / 공사배정 / 안전 / 가용 + MW 합계
    const sumKw = list.reduce((s,r) => ({
      onHand: s.onHand + (r.kw?.onHand||0),
      sale:   s.sale   + (r.kw?.sale  ||0),
      project:s.project+ (r.kw?.project||0),
      atp:    s.atp    + (r.kw?.atp   ||0)
    }), { onHand:0, sale:0, project:0, atp:0 });
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : (n) => Math.round(n).toLocaleString()+'kW';
    const sumRow = list.length ? `<tr style="background:#fafafa;font-weight:700;border-top:2px solid #1a1a2e;">
      <td>합계 · ${list.length}건</td>
      <td style="text-align:right;">${fmtCap(sumKw.onHand)}</td>
      <td style="text-align:right;color:#1565c0;">${sumKw.sale?'−'+fmtCap(sumKw.sale):'-'}</td>
      <td style="text-align:right;color:#e65100;">${sumKw.project?'−'+fmtCap(sumKw.project):'-'}</td>
      <td style="text-align:right;color:${sumKw.atp<=0?'#c62828':'#27ae60'};">${fmtCap(sumKw.atp)}</td>
    </tr>` : '';
    const tbl = list.length === 0
      ? '<div style="padding:30px;text-align:center;color:#bbb;">데이터 없음</div>'
      : `<table class="atp-tbl">
          <thead><tr>
            <th>모델</th>
            <th style="text-align:right;">실재고</th>
            <th style="text-align:right;color:#90caf9;" title="수주 미발행">판매배정</th>
            <th style="text-align:right;color:#ffb74d;" title="출고지시서 발행">공사배정</th>
            <th style="text-align:right;">ATP</th>
          </tr></thead>
          <tbody>${list.map(r => `<tr onclick="document.getElementById('atp-search-input').value='${r.model.replace(/'/g,"\\'")}';document.getElementById('atp-search-input').dispatchEvent(new Event('input'))">
            <td style="font-weight:700;">${r.model}<div style="font-size:0.75em;color:#888;">${r.watt?r.watt+'W':''}</div></td>
            <td style="text-align:right;">${r.onHand.toLocaleString()}<div style="font-size:0.74em;color:#888;">${r.kw?.onHand?fmtCap(r.kw.onHand):''}</div></td>
            <td style="text-align:right;color:#1565c0;">${r.sale?'−'+r.sale.toLocaleString():'-'}<div style="font-size:0.74em;color:#888;">${r.kw?.sale?fmtCap(r.kw.sale):''}</div></td>
            <td style="text-align:right;color:#e65100;">${r.project?'−'+r.project.toLocaleString():'-'}<div style="font-size:0.74em;color:#888;">${r.kw?.project?fmtCap(r.kw.project):''}</div></td>
            <td style="text-align:right;font-weight:800;color:${r.atp<=0?'#c62828':'#27ae60'};">${r.atp.toLocaleString()}<div style="font-size:0.74em;color:inherit;">${r.kw?.atp?fmtCap(r.kw.atp):''}</div></td>
          </tr>`).join('') + sumRow}</tbody>
        </table>`;
    // ★ 2026-05-12 "즉시 조치 필요" 섹션 제거 — 전체 모델 표만 표시 (사용자 요청)
    body.innerHTML = `<div style="font-weight:700;margin-bottom:8px;">전체 모델 ATP — 4분할 (${list.length}건)</div>${tbl}`;
  }

  // ── 자동 갱신 ───────────────────────────────────────
  function _autoRefresh() {
    const p = document.getElementById('erp-atp-panel');
    if (p && p.classList.contains('open')) {
      const inp = document.getElementById('atp-search-input');
      _renderBody(inp ? inp.value : '');
    }
  }

  // ── 공개 API ────────────────────────────────────────
  window.atp = {
    of: compute,
    all: all,
    open: open,
    refresh: _autoRefresh,
    _mountToTab
  };

  function boot() {
    _injectUI();
    setInterval(_autoRefresh, 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-ATP] 실시간 가용재고 패널 활성 — 우측 하단 📦');
})();
