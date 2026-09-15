// =====================================================
//  FORECAST — 매출 예측 대시보드 (Sprint 5 · #4)
//
//  기능
//   1) 월별/분기별 매출 예측 — 출고요청일 기준 (forward-looking)
//   2) 과거 12개월 실적 + 향후 6개월 예측 비교 시각화
//   3) 신뢰도 표시 — 계약금 입금 여부로 가중
//      - 계약금 입금 (출고가능)  → 100%
//      - 계약금 미입금          → 60%
//      - 취소 상태             → 0%
//   4) 매입 원가 누적 → 영업이익 예측
//   5) 채권 회수 일정 (납품완료 후 30/60/90일 buckets)
//   6) 캐시플로우 예상 (입금 - 매입)
//
//  공개 API: window.erpForecast
// =====================================================
(function() {
  'use strict';

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _fmtAmt(n) {
    if (Math.abs(n) >= 100000000) return (n/100000000).toFixed(1) + '억';
    if (Math.abs(n) >= 10000) return Math.round(n/10000).toLocaleString() + '만';
    return Math.round(n).toLocaleString();
  }
  function _ym(d) {
    return d ? d.slice(0, 7) : '';
  }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _addMonths(ym, n) {
    const [y, m] = ym.split('-').map(x => parseInt(x));
    const d = new Date(y, m-1+n, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function _quarter(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(x => parseInt(x));
    return `${y}-Q${Math.ceil(m/3)}`;
  }

  // ── 신뢰도 가중치 ────────────────────────────────
  function _confidence(o) {
    if (o.status === '취소' || o.status === '출고취소') return 0;
    if (o.status === '수금완료') return 1.0;
    if (o.status === '납품완료') return 1.0;
    if (o.status === '수주' && o.계약금입금) return 0.85;     // 계약금 입금됨
    if (o.status === '수주') return 0.55;                     // 계약금 미입금
    return 0.7;
  }

  // ── 메인 분석 ───────────────────────────────────
  function compute(opts) {
    opts = opts || {};
    const monthsBack = opts.monthsBack || 12;
    const monthsAhead = opts.monthsAhead || 6;
    const todayDate = _today();
    const todayYm = todayDate.slice(0, 7);

    // 월 라벨 생성 (과거 + 현재 + 미래)
    const months = [];
    for (let i = -monthsBack; i <= monthsAhead; i++) {
      months.push(_addMonths(todayYm, i));
    }

    // 월별 집계 초기화
    const monthly = {};
    months.forEach(ym => {
      monthly[ym] = {
        ym,
        type: ym < todayYm ? 'past' : ym === todayYm ? 'current' : 'future',
        revenue: 0,           // 가중 안 한 총수주액
        revenueWeighted: 0,   // 신뢰도 가중
        cost: 0,              // 매입총액 가중
        profit: 0,            // 영업이익 가중
        orderCount: 0,
        qtySum: 0,
        kwSum: 0,
        confirmedCount: 0,    // 계약금 입금된 확정 건
        unconfirmedCount: 0   // 계약금 미입금
      };
    });

    if (typeof getEnriched !== 'function') return { monthly: Object.values(monthly), months };

    const orders = getEnriched();
    orders.forEach(o => {
      // 출고요청일 기준 (미래 예측), 없으면 수주일
      const refDate = o.출고요청일 || o.수주일;
      if (!refDate) return;
      const ym = _ym(refDate);
      if (!monthly[ym]) return;

      const conf = _confidence(o);
      const rev = Number(o.수주총액) || 0;
      const cost = Number(o.매입총액) || 0;
      const profit = Number(o.영업이익) || 0;
      const qty = Number(o.수량) || 0;
      const kw = Number(String(o.수주용량kW||'').replace(/[^\d.]/g,'')) || 0;

      monthly[ym].revenue += rev;
      monthly[ym].revenueWeighted += rev * conf;
      monthly[ym].cost += cost * conf;
      monthly[ym].profit += profit * conf;
      monthly[ym].orderCount++;
      monthly[ym].qtySum += qty;
      monthly[ym].kwSum += kw;
      if (o.계약금입금) monthly[ym].confirmedCount++;
      else monthly[ym].unconfirmedCount++;
    });

    // 분기별 합산
    const quarterly = {};
    Object.values(monthly).forEach(m => {
      const q = _quarter(m.ym);
      if (!quarterly[q]) quarterly[q] = {
        q, type: m.type,
        revenue: 0, revenueWeighted: 0, cost: 0, profit: 0,
        orderCount: 0, qtySum: 0, kwSum: 0,
        confirmedCount: 0, unconfirmedCount: 0
      };
      quarterly[q].revenue += m.revenue;
      quarterly[q].revenueWeighted += m.revenueWeighted;
      quarterly[q].cost += m.cost;
      quarterly[q].profit += m.profit;
      quarterly[q].orderCount += m.orderCount;
      quarterly[q].qtySum += m.qtySum;
      quarterly[q].kwSum += m.kwSum;
      quarterly[q].confirmedCount += m.confirmedCount;
      quarterly[q].unconfirmedCount += m.unconfirmedCount;
      // 분기 type — 과거이면 past, 그 외엔 미래
      if (quarterly[q].type === 'past' && m.type !== 'past') quarterly[q].type = 'future';
    });

    // 채권 회수 예상 일정 (납품완료된 미수금)
    const receivablesSchedule = { '0-30':0, '31-60':0, '61-90':0, '91-120':0, '120+':0 };
    orders.forEach(o => {
      if (o.status !== '납품완료' || o.잔금입금) return;
      if (!o.납품일) return;
      const days = Math.floor((new Date(todayDate) - new Date(o.납품일)) / 86400000);
      const balance = Number(o.잔금) || 0;
      if (balance <= 0) return;
      const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 120 ? '91-120' : '120+';
      receivablesSchedule[bucket] += balance;
    });

    // 요약 통계
    const monthlyArr = Object.values(monthly);
    const past = monthlyArr.filter(m => m.type === 'past');
    const future = monthlyArr.filter(m => m.type === 'future');
    const avgPastMonthly = past.length > 0
      ? past.reduce((s,m) => s+m.revenue, 0) / past.length
      : 0;
    const futureRev = future.reduce((s,m) => s+m.revenue, 0);
    const futureRevWeighted = future.reduce((s,m) => s+m.revenueWeighted, 0);
    const futureProfit = future.reduce((s,m) => s+m.profit, 0);

    return {
      months,
      monthly: monthlyArr,
      quarterly: Object.values(quarterly),
      receivablesSchedule,
      summary: {
        avgPastMonthly,
        futureRev,
        futureRevWeighted,
        futureProfit,
        confidenceRatio: futureRev > 0 ? (futureRevWeighted / futureRev * 100) : 0
      }
    };
  }

  // ── SVG 차트 헬퍼 ────────────────────────────────
  function _barChart(data, valueKey, w, h, opts) {
    opts = opts || {};
    if (!data.length) return '';
    const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
    const barWidth = w / data.length;
    const padding = 2;
    const labels = (typeof opts.label === 'function') ? opts.label : (d => '');
    return `<svg width="${w}" height="${h+24}" viewBox="0 0 ${w} ${h+24}" style="display:block;">
      ${data.map((d, i) => {
        const x = i * barWidth + padding;
        const bw = barWidth - padding*2;
        const v = d[valueKey] || 0;
        const bh = max > 0 ? (Math.abs(v) / max) * h : 0;
        const y = h - bh;
        const color = d.type === 'past' ? '#1565c0'
                    : d.type === 'current' ? '#7b1fa2'
                    : '#27ae60';
        const opacity = d.type === 'future' ? 0.7 : 1;
        return `<g>
          <rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${color}" opacity="${opacity}" rx="2"/>
          <text x="${x+bw/2}" y="${h+14}" text-anchor="middle" font-size="9" fill="#666">${labels(d) || ''}</text>
        </g>`;
      }).join('')}
      <line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="#ccc" stroke-width="0.5"/>
    </svg>`;
  }

  // ── UI ──────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-fc-modal')) return;
    const css = `
      #erp-fc-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-fc-modal.open{display:flex;}
      .fc-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1300px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .fc-hd{padding:14px 18px;background:#27ae60;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .fc-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .fc-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .fc-tab{padding:8px 16px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.86em;}
      .fc-tab.active{background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;}
      .fc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;}
      .fc-stat{background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .fc-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .fc-stat-v{font-size:1.5em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:3px;}
      .fc-card{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:12px;}
      .fc-card-h{font-weight:700;color:#1a1a2e;font-size:1em;margin-bottom:10px;}
      .fc-tbl{width:100%;border-collapse:collapse;font-size:0.84em;}
      .fc-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:right;font-size:0.8em;}
      .fc-tbl th:first-child{text-align:left;}
      .fc-tbl td{padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;}
      .fc-tbl td:first-child{text-align:left;font-weight:700;}
      .fc-tbl tr.past td{background:#fafafa;}
      .fc-tbl tr.current td{background:#fffde7;font-weight:700;}
      .fc-tbl tr.future td{color:#27ae60;}
      .fc-conf{display:inline-block;width:60px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;}
      .fc-conf-fill{height:100%;background:#27ae60;}
      .fc-receivables{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;}
      .fc-bucket{padding:10px;border-radius:6px;text-align:center;}
      .fc-bucket-l{font-size:0.74em;font-weight:700;}
      .fc-bucket-v{font-size:1.1em;font-weight:900;margin-top:3px;}
      @media (max-width:700px){
        .fc-stats{grid-template-columns:repeat(2,1fr);}
        .fc-receivables{grid-template-columns:repeat(2,1fr);}
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-fc-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-fc-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="fc-box">
        <div class="fc-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">매출 예측 대시보드</h4>
          <button class="fc-close-x" onclick="document.getElementById('erp-fc-modal').classList.remove('open')" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="fc-bd" id="fc-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    // ★ 2026-05-13 클릭 핸들러를 modal 만이 아닌 .fc-box 에도 부착
    //   _mountToTab() 시 .fc-box 가 modal 밖으로 이동하므로 modal 이벤트가 전파 안 됨
    modal.addEventListener('click', _onModalClick);
    const box = modal.querySelector('.fc-box');
    if (box) box.addEventListener('click', _onModalClick);
  }

  let _tab = 'monthly';   // monthly | quarterly | cashflow

  function _renderTabs() {
    return `
      <div class="fc-tabs">
        <button class="fc-tab ${_tab==='monthly'?'active':''}" data-tab="monthly">📅 월별</button>
        <button class="fc-tab ${_tab==='quarterly'?'active':''}" data-tab="quarterly">📊 분기별</button>
        <button class="fc-tab ${_tab==='cashflow'?'active':''}" data-tab="cashflow">💰 캐시플로우</button>
      </div>`;
  }

  function _render() {
    const result = compute({ monthsBack: 12, monthsAhead: 6 });
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : _fmtAmt(v);

    const todayDate = _today();
    const todayYm = todayDate.slice(0, 7);

    // 헤더 통계
    const s = result.summary;
    const headHtml = `
      <div class="fc-stats">
        <div class="fc-stat">
          <div class="fc-stat-l">과거 12개월 평균</div>
          <div class="fc-stat-v">${fmtMoney(s.avgPastMonthly)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">월평균 매출</div>
        </div>
        <div class="fc-stat">
          <div class="fc-stat-l">향후 6개월 예상</div>
          <div class="fc-stat-v" style="color:#27ae60;">${fmtMoney(s.futureRev)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">총 수주잔액</div>
        </div>
        <div class="fc-stat">
          <div class="fc-stat-l">신뢰도 가중 예상</div>
          <div class="fc-stat-v" style="color:#1565c0;">${fmtMoney(s.futureRevWeighted)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">계약금 가중치 적용</div>
        </div>
        <div class="fc-stat">
          <div class="fc-stat-l">예상 영업이익</div>
          <div class="fc-stat-v" style="color:#7b1fa2;">${fmtMoney(s.futureProfit)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">매입 원가 차감</div>
        </div>
        <div class="fc-stat">
          <div class="fc-stat-l">예측 신뢰도</div>
          <div class="fc-stat-v" style="color:${s.confidenceRatio>=80?'#27ae60':s.confidenceRatio>=60?'#f9a825':'#c62828'};">${s.confidenceRatio.toFixed(1)}%</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">계약금 입금 비율</div>
        </div>
      </div>
    `;

    let bodyHtml = '';
    if (_tab === 'monthly') bodyHtml = _renderMonthly(result, fmtMoney, todayYm);
    else if (_tab === 'quarterly') bodyHtml = _renderQuarterly(result, fmtMoney);
    else if (_tab === 'cashflow') bodyHtml = _renderCashflow(result, fmtMoney);

    document.getElementById('fc-bd').innerHTML = _renderTabs() + headHtml + bodyHtml;
  }

  function _renderMonthly(result, fmtMoney, todayYm) {
    const m = result.monthly;
    const chart = _barChart(m, 'revenueWeighted', 1100, 140, {
      label: d => d.ym.slice(2, 7).replace('-', '/')
    });
    return `
      <div class="fc-card">
        <div class="fc-card-h">📊 월별 매출 추세 (실적 + 예측)</div>
        <div style="overflow-x:auto;">${chart}</div>
        <div style="display:flex;gap:14px;justify-content:center;font-size:0.82em;color:#666;margin-top:8px;">
          <span><span style="display:inline-block;width:10px;height:10px;background:#1565c0;margin-right:4px;"></span>과거 실적</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#7b1fa2;margin-right:4px;"></span>이번달</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#27ae60;opacity:0.7;margin-right:4px;"></span>예측 (가중치 적용)</span>
        </div>
      </div>

      <div class="fc-card">
        <div class="fc-card-h">📋 월별 상세</div>
        <table class="fc-tbl">
          <thead><tr>
            <th>월</th><th>건수</th><th>수량(매)</th><th>용량(kW)</th>
            <th>총수주액</th><th>가중 예상</th><th>예상 이익</th><th>신뢰도</th>
          </tr></thead>
          <tbody>
            ${m.map(row => {
              const conf = row.revenue > 0 ? (row.revenueWeighted / row.revenue * 100) : 0;
              return `<tr class="${row.type}">
                <td>${row.ym}${row.type==='current'?' 🔆':''}</td>
                <td>${row.orderCount}</td>
                <td>${_fmt(row.qtySum)}</td>
                <td>${_fmt(Math.round(row.kwSum))}</td>
                <td>${fmtMoney(row.revenue)}</td>
                <td style="font-weight:700;color:${row.type==='future'?'#27ae60':'#1a1a2e'};">${fmtMoney(row.revenueWeighted)}</td>
                <td>${fmtMoney(row.profit)}</td>
                <td><div class="fc-conf"><div class="fc-conf-fill" style="width:${conf}%;"></div></div> <span style="font-size:0.82em;color:#666;">${conf.toFixed(0)}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function _renderQuarterly(result, fmtMoney) {
    const q = result.quarterly;
    const chart = _barChart(q, 'revenueWeighted', 800, 160, { label: d => d.q });
    return `
      <div class="fc-card">
        <div class="fc-card-h">📊 분기별 매출 추세</div>
        <div style="overflow-x:auto;">${chart}</div>
      </div>

      <div class="fc-card">
        <div class="fc-card-h">📋 분기별 상세</div>
        <table class="fc-tbl">
          <thead><tr>
            <th>분기</th><th>건수</th><th>총수주액</th><th>가중 예상</th>
            <th>매입 원가</th><th>예상 이익</th><th>이익률</th>
          </tr></thead>
          <tbody>
            ${q.map(row => {
              const margin = row.revenueWeighted > 0 ? (row.profit / row.revenueWeighted * 100) : 0;
              return `<tr class="${row.type}">
                <td>${row.q}</td>
                <td>${row.orderCount}</td>
                <td>${fmtMoney(row.revenue)}</td>
                <td style="font-weight:700;color:${row.type==='future'?'#27ae60':'#1a1a2e'};">${fmtMoney(row.revenueWeighted)}</td>
                <td>${fmtMoney(row.cost)}</td>
                <td>${fmtMoney(row.profit)}</td>
                <td>${margin.toFixed(1)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function _renderCashflow(result, fmtMoney) {
    const r = result.receivablesSchedule;
    const total = Object.values(r).reduce((s,v) => s+v, 0);
    const future = result.monthly.filter(m => m.type === 'future');
    let cashIn = 0, cashOut = 0;
    future.forEach(m => {
      // 입금 — revenueWeighted 의 60% (계약금 출고시 + 잔금 출고후 30일)
      cashIn += m.revenueWeighted * 0.6;
      cashOut += m.cost;   // 매입 원가
    });
    const netCashflow = cashIn - cashOut;

    const bucketColors = {
      '0-30':   { bg:'#e8f5e9', color:'#27ae60', label:'정상' },
      '31-60':  { bg:'#fff8e1', color:'#f9a825', label:'주시' },
      '61-90':  { bg:'#fff3e0', color:'#e65100', label:'위험' },
      '91-120': { bg:'#ffebee', color:'#c62828', label:'긴급' },
      '120+':   { bg:'#f3e5f5', color:'#7b1fa2', label:'장기' }
    };

    return `
      <div class="fc-card">
        <div class="fc-card-h">💰 미회수 채권 분포 (잔금 미입금)</div>
        <div class="fc-receivables">
          ${Object.entries(r).map(([bucket, amount]) => {
            const c = bucketColors[bucket];
            const pct = total > 0 ? (amount/total*100).toFixed(1) : 0;
            return `<div class="fc-bucket" style="background:${c.bg};color:${c.color};">
              <div class="fc-bucket-l">${bucket}일 (${c.label})</div>
              <div class="fc-bucket-v">${fmtMoney(amount)}원</div>
              <div style="font-size:0.74em;margin-top:2px;">${pct}%</div>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:14px;text-align:right;font-size:0.92em;font-weight:700;">
          총 미회수: <span style="color:#c62828;">${fmtMoney(total)}원</span>
        </div>
      </div>

      <div class="fc-card">
        <div class="fc-card-h">📈 향후 6개월 캐시플로우 추정</div>
        <table class="fc-tbl">
          <tbody>
            <tr><td>예상 입금 (가중 매출의 60%)</td><td style="color:#27ae60;font-weight:800;">${fmtMoney(cashIn)}원</td></tr>
            <tr><td>예상 매입 (원가)</td><td style="color:#c62828;font-weight:800;">-${fmtMoney(cashOut)}원</td></tr>
            <tr style="border-top:2px solid #1a1a2e;"><td style="font-weight:900;">순 캐시플로우</td><td style="color:${netCashflow>=0?'#27ae60':'#c62828'};font-weight:900;font-size:1.1em;">${netCashflow>=0?'+':''}${fmtMoney(netCashflow)}원</td></tr>
          </tbody>
        </table>
        <div style="margin-top:10px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.82em;color:#666;">
          💡 <strong>가정</strong>: 가중 매출의 60%는 출고+30일 내 입금, 매입은 출고 시점 즉시 지출. 실제 결제조건에 따라 차이 가능.
        </div>
      </div>
    `;
  }

  function _onModalClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab) { _tab = tab.getAttribute('data-tab'); _render(); return; }
  }

  function open() {
    _injectUI();
    _tab = 'monthly';
    // 영업실적 탭에 매출 예측 서브탭이 존재하면 → 인라인 패널 사용
    if (typeof window.setSalesSubtab === 'function'
        && document.getElementById('forecastTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('sales'); } catch(e) {}
      }
      setTimeout(() => window.setSalesSubtab('forecast'), 30);
      return;
    }
    document.getElementById('erp-fc-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() { document.getElementById('erp-fc-modal')?.classList.remove('open'); }

  // ── 탭 마운트 (영업실적 탭의 forecastTabHost 로 box 이동) ──
  function _mountToTab() {
    const host = document.getElementById('forecastTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-fc-modal');
    if (!modal) { try { _injectUI(); } catch(e){ console.error('[erpForecast] _injectUI 실패:', e); return; } modal = document.getElementById('erp-fc-modal'); if (!modal) return; }
    const box = modal.querySelector('.fc-box');
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
      // ★ 2026-05-13 box 가 modal 밖으로 이동하면서 이벤트 위임이 끊김
      //   box 자체에 클릭 핸들러 재부착
      if (!box.__fcClickHooked) {
        box.addEventListener('click', _onModalClick);
        box.__fcClickHooked = true;
      }
    }
    // ★ 탭 모드에서는 헤더의 X(닫기) 버튼이 의미 없음 — 숨김
    const closeBtn = box.querySelector('.fc-close-x');
    if (closeBtn) closeBtn.style.display = 'none';
    setTimeout(_render, 30);
  }

  // ── 공개 API ────────────────────────────────────
  window.erpForecast = {
    compute,
    open, close,
    _mountToTab
  };

  // ── 부팅 ───────────────────────────────────────
  function boot() { setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-FC] 매출 예측 활성 — erpForecast.open()');
})();
