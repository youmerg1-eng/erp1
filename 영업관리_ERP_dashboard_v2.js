// =====================================================
//  DASHBOARD V2 — Phase F · Day 5~6
//  KPI 카드 6개 + SVG 미니차트 (라이브러리 무료, 자체 구현)
//
//  카드 구성
//   1. 이번달 수주 (건수/총액/MW + 12개월 추세 라인)
//   2. 영업이익률 (이번달/전체 + 도넛)
//   3. 채권 분포 (5단계 스택 막대)
//   4. 재고 ATP (가용 MW + 부족 모델 카운트)
//   5. 입고예정 (MW + 7일내 ETA)
//   6. 담당자 TOP3 (이익 비교 막대)
//
//  자체 fab 추가 + 콘솔 진입
// =====================================================
(function() {
  'use strict';

  const COLORS = {
    primary: '#1565c0', success: '#27ae60', warning: '#e65100',
    danger: '#c62828', purple: '#7b1fa2', gold: '#f9a825',
    teal: '#00897b', muted: '#999'
  };

  // ── 데이터 집계 ─────────────────────────────────────
  function _kpis() {
    const out = {};
    if (typeof getEnriched === 'function') {
      try {
        const all = getEnriched();
        const today = new Date();
        const thisMonth = today.toISOString().slice(0,7);
        // 1) 이번달 수주
        const tm = all.filter(o => (o.수주일||'').startsWith(thisMonth));
        out.thisMonth = {
          count: tm.length,
          revenue: tm.reduce((s,o) => s + (o.수주총액||0), 0),
          kw: tm.reduce((s,o) => {
            const w = Number(String(o.수주용량kW||'').replace(/[^\d.]/g,''))||0;
            return s + w;
          }, 0)
        };
        // 12개월 추세
        const trend = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const ym = d.toISOString().slice(0,7);
          const arr = all.filter(o => (o.수주일||'').startsWith(ym));
          trend.push({
            ym,
            count: arr.length,
            rev: arr.reduce((s,o)=>s+(o.수주총액||0),0)
          });
        }
        out.trend = trend;

        // 2) 영업이익률
        const totalRev = all.reduce((s,o)=>s+(o.수주총액||0),0);
        const totalProfit = all.reduce((s,o)=>s+(o.영업이익||0),0);
        out.profit = {
          rate: totalRev > 0 ? (totalProfit/totalRev*100) : 0,
          totalProfit,
          totalRev,
          tmRate: out.thisMonth.revenue > 0 ?
            (tm.reduce((s,o)=>s+(o.영업이익||0),0)/out.thisMonth.revenue*100) : 0
        };

        // 6) 담당자 TOP3
        const mgrMap = {};
        all.forEach(o => {
          if (!o.담당자) return;
          if (!mgrMap[o.담당자]) mgrMap[o.담당자] = { name: o.담당자, profit: 0, rev: 0, count: 0 };
          mgrMap[o.담당자].profit += o.영업이익||0;
          mgrMap[o.담당자].rev += o.수주총액||0;
          mgrMap[o.담당자].count++;
        });
        out.topMgrs = Object.values(mgrMap).sort((a,b)=>b.profit-a.profit).slice(0,5);
      } catch(e) {}
    }

    // 3) 채권
    if (typeof aging !== 'undefined') {
      try { out.aging = aging.summary(); } catch(e) {}
    }
    // 4) ATP
    if (typeof atp !== 'undefined') {
      try {
        const list = atp.all();
        const totalAtpKw = list.reduce((s,r) => s + (r.kw?.atp||0), 0);
        out.atp = {
          totalMw: totalAtpKw / 1000,
          shortage: list.filter(r => r.atp <= 0).length,
          totalModels: list.length
        };
      } catch(e) {}
    }
    // 5) 입고예정
    if (typeof incoming !== 'undefined') {
      try { out.incoming = incoming.summary(); } catch(e) {}
    }
    return out;
  }

  // ── SVG 미니차트 헬퍼 ───────────────────────────────
  function _miniLine(data, w, h, color) {
    if (!data || !data.length) return '';
    const max = Math.max(1, ...data);
    const min = Math.min(0, ...data);
    const range = max - min || 1;
    const step = w / Math.max(1, data.length - 1);
    const pts = data.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const area = `M0,${h} L${pts.split(' ').join(' L')} L${w},${h} Z`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
      <path d="${area}" fill="${color}" opacity="0.15"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/>
    </svg>`;
  }

  function _donut(value, max, color, size) {
    size = size || 80;
    const r = size/2 - 6;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, value/max));
    const dash = c * pct;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#eee" stroke-width="6"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${dash} ${c}" stroke-linecap="round"/>
    </svg>`;
  }

  function _stackBar(parts, w, h) {
    if (!parts.length) return '';
    const total = parts.reduce((s,p) => s+p.value, 0) || 1;
    let x = 0;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
      ${parts.map(p => {
        const pw = (p.value/total) * w;
        const rect = `<rect x="${x.toFixed(1)}" y="0" width="${pw.toFixed(1)}" height="${h}" fill="${p.color}"/>`;
        x += pw;
        return rect;
      }).join('')}
    </svg>`;
  }

  function _hbar(items, w, color) {
    if (!items.length) return '';
    const max = Math.max(...items.map(i => i.value), 1);
    return items.map(i => {
      const pw = (i.value / max) * w;
      return `<div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;font-size:0.78em;margin-bottom:2px;">
          <span style="color:#444;font-weight:700;">${i.name}</span>
          <span style="color:#666;">${i.label || i.value.toLocaleString()}</span>
        </div>
        <div style="background:#f0f0f0;height:8px;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pw.toFixed(1)}px;background:${color};border-radius:4px;"></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── 패널 렌더 ───────────────────────────────────────
  function _render() {
    const k = _kpis();
    const fmtCap = (typeof fmtCapacity === 'function') ? fmtCapacity : n => Math.round(n).toLocaleString()+'kW';
    const fmtAmt = n => {
      if (n >= 100000000) return (n/100000000).toFixed(1) + '억';
      if (n >= 10000) return Math.round(n/10000).toLocaleString() + '만';
      return n.toLocaleString();
    };

    const trendVals = (k.trend || []).map(t => t.rev);
    const tmKwMw = (k.thisMonth?.kw || 0) / 1000;

    // 채권 5단계 스택
    const ag = k.aging?.buckets || {};
    const stackParts = [
      { value: ag['0-30']||0,   color: COLORS.success },
      { value: ag['31-60']||0,  color: COLORS.gold },
      { value: ag['61-90']||0,  color: COLORS.warning },
      { value: ag['91-120']||0, color: COLORS.danger },
      { value: ag['120+']||0,   color: COLORS.purple }
    ];
    const arTotal = stackParts.reduce((s,p)=>s+p.value, 0);

    // 담당자 TOP
    const topMgrs = (k.topMgrs || []).map(m => ({
      name: m.name,
      value: m.profit,
      label: fmtAmt(m.profit) + '원'
    }));

    const html = `
      <div class="dv2-grid">
        <!-- Card 2: 영업이익률 -->
        <div class="dv2-card">
          <div class="dv2-lbl">영업이익률</div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div>
              <div class="dv2-val" style="color:${COLORS.success};">${(k.profit?.rate||0).toFixed(1)}<span style="font-size:0.5em;">%</span></div>
              <div class="dv2-sub">이익 ${fmtAmt(k.profit?.totalProfit||0)}원</div>
              <div style="font-size:0.78em;color:${COLORS.warning};margin-top:2px;">이번달: ${(k.profit?.tmRate||0).toFixed(1)}%</div>
            </div>
            <div style="position:relative;">
              ${_donut(k.profit?.rate||0, 30, COLORS.success, 70)}
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:0.74em;font-weight:700;">${(k.profit?.rate||0).toFixed(0)}%</div>
            </div>
          </div>
        </div>

        <!-- Card 3: 채권 분포 -->
        <div class="dv2-card">
          <div class="dv2-lbl">채권 분포</div>
          <div class="dv2-val">${fmtAmt(arTotal)}<span style="font-size:0.5em;color:#888;">원</span></div>
          <div class="dv2-sub" style="color:${COLORS.warning};">⚠️ 30일초과 ${fmtAmt(k.aging?.overdue||0)}원</div>
          <div style="margin-top:8px;">${_stackBar(stackParts, 240, 14)}</div>
          <div style="display:flex;gap:6px;margin-top:6px;font-size:0.7em;">
            <span style="color:${COLORS.success};">●0-30</span>
            <span style="color:${COLORS.gold};">●31-60</span>
            <span style="color:${COLORS.warning};">●61-90</span>
            <span style="color:${COLORS.danger};">●91-120</span>
            <span style="color:${COLORS.purple};">●120+</span>
          </div>
        </div>

      </div>`;

    document.getElementById('dv2-bd').innerHTML = html;
  }

  // ── UI ──────────────────────────────────────────────
  //   대시보드와 통합된 후 모달·FAB 모두 제거됨.
  //   KPI 데이터(_kpis)와 _render 만 남겨 외부 호출 호환성 유지.
  //   tools_layout.js 의 _buildDv2Cards 가 직접 _kpis() 호출해 인라인 카드를 렌더.
  function _injectUI() {
    // 기존 FAB·모달 DOM 잔존 시 제거 (이전 버전 호환)
    ['erp-dv2-fab', 'erp-dv2-modal', 'erp-dv2-style'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // 외부 호환용 — 더 이상 모달 안 열고 대시보드 탭으로 이동
  function open() {
    _injectUI();  // 잔존 DOM 정리
    if (typeof window.showTab === 'function') {
      try { window.showTab('dashboard'); } catch(e) {}
    }
    // 인라인 카드 갱신 트리거
    if (typeof window._refreshDv2Inline === 'function') {
      try { window._refreshDv2Inline(); } catch(e) {}
    }
  }
  function close() { /* 통합되어 close 의미 없음 */ }

  window.dashboardV2 = {
    open, close,
    refresh: () => {
      if (typeof window._refreshDv2Inline === 'function') {
        try { window._refreshDv2Inline(); } catch(e) {}
      }
    },
    kpis: _kpis
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-DV2] 대시보드와 통합됨 — 모달·FAB 제거, 인라인 카드만 사용');
})();
