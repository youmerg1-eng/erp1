// =====================================================
//  AR AGING DASHBOARD — Phase B · Week 9
//
//  채권 연령 분석 (30/60/90/120일+ 4단계)
//  + 일일 무결성·채권 메일 자동 발송
//
//  채권 = 수주총액 − 입금합계 (계약/중도금/잔금 모두 포함)
//  연령 기준: 납품일 (납품일 없으면 출고요청일)
//
//  콘솔
//    aging.compute()       전체 채권 표
//    aging.byCustomer()    고객사별 합계
//    aging.open()          패널 열기
//    aging.dailyMail()     무결성+채권 일일 메일 발송
// =====================================================
(function() {
  'use strict';

  function _baseDate(o) {
    return o.납품일 || o.출고요청일 || o.수주일 || '';
  }

  function _ageDays(o) {
    const d = _baseDate(o);
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return Math.floor((new Date() - new Date(d)) / 86400000);
  }

  function _bucketOf(days) {
    if (days == null || days < 0) return '미경과';
    if (days <= 30)  return '0-30';
    if (days <= 60)  return '31-60';
    if (days <= 90)  return '61-90';
    if (days <= 120) return '91-120';
    return '120+';
  }

  function _outstanding(o) {
    const t = o.수주총액 || 0;
    const c = (o.계약금입금 ? (o.계약금||0) : 0)
            + (o.중도금1입금 ? (o.중도금1||0) : 0)
            + (o.중도금2입금 ? (o.중도금2||0) : 0)
            + (o.중도금3입금 ? (o.중도금3||0) : 0)
            + (o.잔금입금 ? (o.잔금||0) : 0);
    return Math.max(0, t - c);
  }

  function compute() {
    if (typeof getEnriched !== 'function') return [];
    return getEnriched()
      .filter(o => o.status !== '취소' && o.status !== '수금완료')
      .map(o => {
        const out = _outstanding(o);
        if (out <= 0) return null;
        const age = _ageDays(o);
        return {
          _id: o._id, pjNo: o.pjNo, 고객사: o.고객사,
          담당자: o.담당자, 모델명: o.모델명,
          수주총액: o.수주총액 || 0,
          미수금: out,
          납품일: o.납품일 || '',
          출고요청일: o.출고요청일 || '',
          age, bucket: _bucketOf(age),
          status: o.status
        };
      })
      .filter(Boolean)
      .sort((a,b) => (b.age||0) - (a.age||0));
  }

  function byCustomer() {
    const rows = compute();
    const map = {};
    rows.forEach(r => {
      const c = r.고객사 || '미지정';
      if (!map[c]) map[c] = { 고객사:c, total:0, count:0,
        b0_30:0, b31_60:0, b61_90:0, b91_120:0, b120:0 };
      const m = map[c];
      m.total += r.미수금; m.count++;
      if (r.bucket === '0-30')   m.b0_30   += r.미수금;
      if (r.bucket === '31-60')  m.b31_60  += r.미수금;
      if (r.bucket === '61-90')  m.b61_90  += r.미수금;
      if (r.bucket === '91-120') m.b91_120 += r.미수금;
      if (r.bucket === '120+')   m.b120    += r.미수금;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }

  function summary() {
    const rows = compute();
    const buckets = { '0-30':0, '31-60':0, '61-90':0, '91-120':0, '120+':0, '미경과':0 };
    const counts  = { '0-30':0, '31-60':0, '61-90':0, '91-120':0, '120+':0, '미경과':0 };
    rows.forEach(r => { buckets[r.bucket] += r.미수금; counts[r.bucket]++; });
    const total = Object.values(buckets).reduce((s,v) => s+v, 0);
    const overdue = buckets['31-60'] + buckets['61-90'] + buckets['91-120'] + buckets['120+'];
    return { rows, buckets, counts, total, overdue, customers: byCustomer().length };
  }

  // ── 일일 메일 ───────────────────────────────────────
  async function dailyMail() {
    const cfg = (function(){
      try { return JSON.parse(localStorage.getItem('erp_notify_config')||'{}'); }
      catch(e) { return {}; }
    })();
    if (!cfg.email) {
      console.warn('이메일 미설정 — erpNotify.config({email:"..."})');
      if (typeof setBanner === 'function') setBanner('warn', '이메일 미설정');
      return { skipped: true };
    }
    if (typeof gsUrl === 'undefined' || !gsUrl) {
      console.warn('GS URL 미설정');
      return { skipped: true };
    }

    const s = summary();
    const today = new Date().toISOString().slice(0,10);

    // 무결성
    let healthLines = '';
    if (typeof healthCheck !== 'undefined') {
      const r = healthCheck.run(false);
      healthLines = r.issues.length
        ? '⚠️ 무결성 진단:\n  • ' + r.issues.join('\n  • ')
        : '✅ 무결성 진단 통과';
    }

    // 상위 5개 고객
    const top = byCustomer().slice(0, 5);

    const body = [
      `📊 영업관리 ERP 일일 리포트 (${today})`,
      '────────────────────────────',
      '',
      `💰 채권 총액: ${s.total.toLocaleString()}원 (${s.rows.length}건)`,
      `   30일 이내 : ${s.buckets['0-30'].toLocaleString()}원 (${s.counts['0-30']}건)`,
      `   31~60일   : ${s.buckets['31-60'].toLocaleString()}원 (${s.counts['31-60']}건)`,
      `   61~90일   : ${s.buckets['61-90'].toLocaleString()}원 (${s.counts['61-90']}건)`,
      `   91~120일  : ${s.buckets['91-120'].toLocaleString()}원 (${s.counts['91-120']}건)`,
      `   120일 이상: ${s.buckets['120+'].toLocaleString()}원 (${s.counts['120+']}건)`,
      `   ⚠️ 30일 초과 합계: ${s.overdue.toLocaleString()}원`,
      '',
      '🏆 상위 5개 고객사 채권:',
      ...top.map((c,i) => `   ${i+1}. ${c.고객사}: ${c.total.toLocaleString()}원 (${c.count}건)`),
      '',
      healthLines,
      '',
      '— 영업관리 ERP 자동 일일 리포트'
    ].join('\n');

    if (!cfg.gsToken) {
      console.warn('aging.dailyMail: gsToken 미설정');
      if (typeof setBanner === 'function')
        setBanner('warn', 'gsToken 미설정 — erpNotify.config({gsToken:"..."})');
      return { skipped: true };
    }
    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendEmail',
          token: cfg.gsToken,                           // [PATCH-J]
          to: cfg.email,
          subject: `[ERP일일] ${today} 채권 ${s.total.toLocaleString()}원 / 30일초과 ${s.overdue.toLocaleString()}원`,
          body
        }),
        redirect: 'follow'
      });
      const json = await res.json();
      if (json.success) {
        if (typeof setBanner === 'function') setBanner('ok', '✅ 일일 리포트 메일 발송');
        return { ok: true, summary: s };
      }
      throw new Error(json.error || 'send failed');
    } catch(e) {
      if (typeof logError === 'function') logError('aging.dailyMail', e);
      if (typeof setBanner === 'function') setBanner('err', '메일 발송 실패: ' + e.message);
      return { error: e.message };
    }
  }

  function _scheduleDailyMail() {
    setInterval(() => {
      const cfg = (function(){
        try { return JSON.parse(localStorage.getItem('erp_notify_config')||'{}'); }
        catch(e) { return {}; }
      })();
      if (!cfg.email || cfg.dailyMailAt == null) return;
      const now = new Date();
      const today = now.toISOString().slice(0,10);
      const lastKey = 'erp_aging_last_daily';
      if (localStorage.getItem(lastKey) === today) return;
      if (now.getHours() < cfg.dailyMailAt) return;
      try { localStorage.setItem(lastKey, today); } catch(e) {}
      console.log('[AGING] 일일 리포트 자동 발송');
      dailyMail().catch(e => console.error(e));
    }, 5 * 60 * 1000);
  }

  // ── UI 패널 ─────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-aging-fab')) return;

    const css = `
      #erp-aging-fab{position:fixed;bottom:18px;right:182px;width:44px;height:44px;border-radius:50%;
        background:#e65100;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s, background .2s;}
      #erp-aging-fab:hover{background:#bf360c;transform:scale(1.07);}
      #erp-aging-fab.has-overdue{animation:agingPulse 1.8s infinite;}
      @keyframes agingPulse{0%,100%{box-shadow:0 4px 14px rgba(230,81,0,0.5);}50%{box-shadow:0 4px 22px rgba(230,81,0,0.95);}}
      #erp-aging-panel{position:fixed;bottom:72px;right:18px;width:680px;max-width:94vw;max-height:80vh;
        background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.25);
        z-index:9001;display:none;flex-direction:column;overflow:hidden;}
      #erp-aging-panel.open{display:flex;}
      .ag-hd{padding:14px 18px;background:#e65100;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .ag-hd h4{margin:0;font-size:1em;font-weight:700;}
      .ag-tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa;}
      .ag-tabs button{flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-size:0.84em;color:#888;border-bottom:2px solid transparent;}
      .ag-tabs button.active{color:#e65100;font-weight:700;border-bottom-color:#e65100;background:#fff;}
      .ag-body{flex:1;overflow-y:auto;padding:14px 18px;font-size:0.85em;}
      .ag-bucket-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
      .ag-bucket{padding:10px;border-radius:8px;text-align:center;}
      .ag-bucket-lbl{font-size:0.74em;color:#666;margin-bottom:4px;font-weight:600;}
      .ag-bucket-val{font-size:0.95em;font-weight:800;}
      .ag-bucket-cnt{font-size:0.72em;color:#888;margin-top:2px;}
      .ag-tbl{width:100%;border-collapse:collapse;font-size:0.8em;}
      .ag-tbl th{background:#1a1a2e;color:#fff;padding:6px;text-align:left;}
      .ag-tbl td{padding:6px;border-bottom:1px solid #eee;}
      .ag-tbl tr:hover{background:#f0f8ff;}
      .ag-actions{padding:10px 18px;background:#fafafa;border-top:1px solid #eee;display:flex;gap:8px;}
      .ag-foot{padding:6px 18px;background:#fafafa;font-size:0.74em;color:#888;text-align:center;border-top:1px solid #eee;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-aging-style';
    style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-aging-fab';
    fab.title = '채권 연령 분석';
    fab.textContent = '💰';
    fab.onclick = open;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'erp-aging-panel';
    panel.innerHTML = `
      <div class="ag-hd">
        <h4>💰 채권 연령 분석 (AR Aging)</h4>
        <button onclick="document.getElementById('erp-aging-panel').classList.remove('open')"
          style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div class="ag-tabs">
        <button data-tab="overview" class="active" onclick="_renderAgingTab('overview')">개요</button>
        <button data-tab="customer" onclick="_renderAgingTab('customer')">고객사별</button>
        <button data-tab="detail" onclick="_renderAgingTab('detail')">상세 (PJ별)</button>
      </div>
      <div class="ag-body" id="ag-body"></div>
      <div class="ag-actions">
        <button class="btn btn-sm btn-blue" onclick="aging.dailyMail()">📧 지금 일일 리포트 메일 발송</button>
        <button class="btn btn-sm btn-dark" onclick="_renderAgingTab(document.querySelector('.ag-tabs button.active').dataset.tab)">🔄 새로고침</button>
      </div>
      <div class="ag-foot">매일 자동 발송: erpNotify.config({dailyMailAt:9})</div>`;
    document.body.appendChild(panel);
  }

  window._renderAgingTab = function(tab) {
    document.querySelectorAll('#erp-aging-panel .ag-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const body = document.getElementById('ag-body');
    if (!body) return;
    const s = summary();

    if (tab === 'overview') {
      const buckets = [
        { k:'0-30',   color:'#27ae60', lbl:'0-30일' },
        { k:'31-60',  color:'#f9a825', lbl:'31-60일' },
        { k:'61-90',  color:'#e65100', lbl:'61-90일' },
        { k:'91-120', color:'#c62828', lbl:'91-120일' },
        { k:'120+',   color:'#7b1fa2', lbl:'120일+' }
      ];
      const grid = buckets.map(b => `
        <div class="ag-bucket" style="background:${b.color}15;border-left:4px solid ${b.color};">
          <div class="ag-bucket-lbl">${b.lbl}</div>
          <div class="ag-bucket-val" style="color:${b.color};">${(s.buckets[b.k]||0).toLocaleString()}</div>
          <div class="ag-bucket-cnt">${s.counts[b.k]||0}건</div>
        </div>`).join('');

      body.innerHTML = `
        <div style="margin-bottom:14px;padding:14px;background:linear-gradient(135deg,#fff3e0,#ffebee);border-radius:10px;">
          <div style="font-size:0.78em;color:#888;">총 채권 미수</div>
          <div style="font-size:1.6em;font-weight:900;color:#1a1a2e;margin:4px 0;">${s.total.toLocaleString()}원</div>
          <div style="font-size:0.84em;color:#e65100;font-weight:700;">⚠️ 30일 초과: ${s.overdue.toLocaleString()}원 (${(s.overdue / Math.max(1,s.total) * 100).toFixed(0)}%)</div>
          <div style="font-size:0.78em;color:#888;margin-top:4px;">총 ${s.rows.length}건 · 고객사 ${s.customers}곳</div>
        </div>
        <div class="ag-bucket-grid">${grid}</div>
        <div style="margin-top:14px;font-size:0.8em;color:#666;line-height:1.6;">
          💡 <strong>업계 표준</strong>: 30일 초과 비율 20% 이하 권장 · 90일 초과는 회수 가능성 급락 · 120일+ 는 채권 손실 위험 검토 필요.
        </div>`;
    }

    if (tab === 'customer') {
      const rows = byCustomer();
      if (!rows.length) { body.innerHTML = '<div style="padding:30px;text-align:center;color:#bbb;">미수금 없음 ✅</div>'; return; }
      body.innerHTML = `<table class="ag-tbl">
        <thead><tr><th>고객사</th><th style="text-align:right;">합계</th>
          <th style="text-align:right;color:#27ae60;">0-30</th>
          <th style="text-align:right;color:#f9a825;">31-60</th>
          <th style="text-align:right;color:#e65100;">61-90</th>
          <th style="text-align:right;color:#c62828;">91-120</th>
          <th style="text-align:right;color:#7b1fa2;">120+</th>
          <th style="text-align:center;">건수</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="font-weight:700;">${r.고객사}</td>
          <td style="text-align:right;font-weight:700;color:#1a1a2e;">${r.total.toLocaleString()}</td>
          <td style="text-align:right;">${r.b0_30 ? r.b0_30.toLocaleString() : '-'}</td>
          <td style="text-align:right;">${r.b31_60 ? r.b31_60.toLocaleString() : '-'}</td>
          <td style="text-align:right;">${r.b61_90 ? r.b61_90.toLocaleString() : '-'}</td>
          <td style="text-align:right;">${r.b91_120 ? r.b91_120.toLocaleString() : '-'}</td>
          <td style="text-align:right;">${r.b120 ? r.b120.toLocaleString() : '-'}</td>
          <td style="text-align:center;">${r.count}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    if (tab === 'detail') {
      const rows = s.rows;
      if (!rows.length) { body.innerHTML = '<div style="padding:30px;text-align:center;color:#bbb;">미수금 없음 ✅</div>'; return; }
      // ★ XSS 차단 — 사용자 입력(고객사·모델명·담당자·pjNo·_id) escape
      const _e = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v||''));
      const _a = (typeof escapeAttr === 'function') ? escapeAttr : (v => String(v||'').replace(/['"&]/g,''));
      body.innerHTML = `<table class="ag-tbl">
        <thead><tr><th>PJ NO</th><th>고객사</th><th>모델</th><th>담당</th><th style="text-align:right;">미수금</th><th style="text-align:right;">경과일</th><th>구간</th></tr></thead>
        <tbody>${rows.slice(0, 200).map(r => {
          const colorMap = {'0-30':'#27ae60','31-60':'#f9a825','61-90':'#e65100','91-120':'#c62828','120+':'#7b1fa2','미경과':'#999'};
          const c = colorMap[r.bucket] || '#666';
          return `<tr data-row-id="${_a(r._id)}" style="cursor:pointer;" class="ag-row">
            <td style="font-weight:700;color:#1a1a2e;">${_e(r.pjNo)}</td>
            <td>${_e(r.고객사 || '-')}</td>
            <td style="font-size:0.86em;">${_e(r.모델명 || '-')}</td>
            <td>${_e(r.담당자 || '-')}</td>
            <td style="text-align:right;font-weight:700;">${r.미수금.toLocaleString()}</td>
            <td style="text-align:right;color:${c};">${r.age != null ? r.age + '일' : '-'}</td>
            <td><span style="background:${c}20;color:${c};padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:700;">${_e(r.bucket)}</span></td>
          </tr>`;
        }).join('')}</tbody></table>
        ${rows.length > 200 ? `<div style="margin-top:10px;text-align:center;color:#888;font-size:0.78em;">상위 200건만 표시 (전체 ${rows.length}건)</div>` : ''}`;
    }
  };

  function open() {
    const p = document.getElementById('erp-aging-panel');
    p.classList.add('open');
    window._renderAgingTab('overview');
    // ★ 행 클릭 위임 — 한 번만 등록 (escapeHtml 도입 시 inline onclick 제거됨)
    if (!p.__rowDelegated) {
      p.addEventListener('click', e => {
        const row = e.target.closest('tr.ag-row');
        if (!row) return;
        const id = row.getAttribute('data-row-id');
        if (id && typeof openOrderDetail === 'function') openOrderDetail(id);
      });
      p.__rowDelegated = true;
    }
  }

  // FAB 깜빡임 — 30일 초과 채권 있으면
  function _updateFab() {
    const fab = document.getElementById('erp-aging-fab');
    if (!fab) return;
    const s = summary();
    if (s.overdue > 0) {
      fab.classList.add('has-overdue');
      fab.title = `⚠️ 30일초과 채권 ${s.overdue.toLocaleString()}원`;
    } else {
      fab.classList.remove('has-overdue');
      fab.title = '✅ 채권 정상';
    }
  }

  // ── 공개 API ────────────────────────────────────────
  window.aging = {
    compute: compute,
    byCustomer: byCustomer,
    summary: summary,
    dailyMail: dailyMail,
    open: open
  };

  function boot() {
    _injectUI();
    setTimeout(_updateFab, 3000);
    setInterval(_updateFab, 5 * 60 * 1000);
    _scheduleDailyMail();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-AGING] 채권 Aging 모듈 활성 — 우측 하단 💰');
})();
