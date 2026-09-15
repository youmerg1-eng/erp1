// =====================================================
//  CREDIT — 고객사 신용한도 + 입금 지연 패턴 분석 (Sprint 5 · #3)
//
//  기능
//   1) 고객사별 신용한도 vs 현재 미수금 사용률 (gauge)
//   2) 입금 지연 패턴 분석 — 평균 지연일, 최근 6개월 추세
//   3) 위험 등급 자동 산정: SAFE / WATCH / DANGER / CRITICAL
//      - 한도 사용률 / 평균 지연일 / 30일 초과 채권 비율 종합
//   4) 신규 수주 시 사전 경고 (확장)
//   5) notify trigger T11 — 한도 초과 임박 / 만성 지연 고객
//
//  데이터 소스
//   - customerMaster (신용한도)
//   - rawData + localMeta (수주·계약금·입금일)
//   - aging.byCustomer (현재 미수금)
//
//  공개 API: window.erpCredit
// =====================================================
(function() {
  'use strict';

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.floor((new Date(b) - new Date(a)) / 86400000);
  }

  // ── 분석 핵심 — 고객사별 신용 프로파일 ────────────
  function buildProfile(customer) {
    if (!customer) return null;
    const profile = {
      customer,
      creditLimit: 0,
      currentAR: 0,            // 현재 미수금
      utilization: 0,          // 사용률 (%)
      ordersCount: 0,
      paidCount: 0,
      paidLatencies: [],       // 결제완료 건의 지연일 배열
      avgLatency: 0,           // 평균 지연일 (마이너스면 조기 입금)
      maxLatency: 0,
      onTimeRate: 0,           // 정시 입금률 (%)
      riskLevel: 'SAFE',       // SAFE / WATCH / DANGER / CRITICAL
      riskScore: 0,            // 0~100
      orderHistory: []
    };

    // 1) 신용한도 (customerMaster)
    if (typeof customerMaster !== 'undefined' && customerMaster.get) {
      try {
        const m = customerMaster.get(customer);
        if (m) profile.creditLimit = Number(m.creditLimit) || 0;
      } catch (e) {}
    }

    // 2) 수주·입금 이력 (getEnriched + localMeta)
    if (typeof getEnriched !== 'function') return profile;
    const orders = getEnriched().filter(o => (o.고객사||'') === customer);
    profile.ordersCount = orders.length;

    let totalAR = 0;
    orders.forEach(o => {
      const total = Number(o.총금액VAT) || Number(o.수주총액) || 0;
      const deposit = Number(o.계약금) || 0;
      const balance = Number(o.잔금) || 0;

      // 미수금 = 미입금 계약금 + 미입금 잔금
      let unpaid = 0;
      if (deposit > 0 && !o.계약금입금) unpaid += deposit;
      if (balance > 0 && !o.잔금입금) unpaid += balance;
      totalAR += unpaid;

      // 입금 지연 분석 — 출고요청일 vs 실제 입금일
      // (입금일 메타 추출 — localMeta에 _depositPaidDate / _balancePaidDate 가 있다면)
      const meta = (typeof localMeta !== 'undefined') ? (localMeta[o._id] || {}) : {};
      const dueDate = o.출고요청일;
      let entry = {
        pjNo: o.pjNo, total, dueDate,
        depositPaid: !!o.계약금입금, balancePaid: !!o.잔금입금,
        unpaid, status: o.status,
        latency: null
      };
      // 잔금 입금일이 있으면 지연일 계산 (납품일 또는 출고요청일 기준)
      const paidDate = meta._balancePaidDate || meta._depositPaidDate || (o.잔금입금 || o.계약금입금 ? o.납품일 : null);
      if (paidDate && dueDate) {
        const lat = _daysBetween(dueDate, paidDate);
        if (lat !== null) {
          entry.latency = lat;
          profile.paidLatencies.push(lat);
          if (lat > profile.maxLatency) profile.maxLatency = lat;
        }
      }
      if (entry.depositPaid || entry.balancePaid) profile.paidCount++;
      profile.orderHistory.push(entry);
    });
    profile.currentAR = totalAR;
    profile.utilization = profile.creditLimit > 0
      ? Math.round((totalAR / profile.creditLimit) * 100)
      : 0;

    // 3) 평균 지연 + 정시 입금률
    if (profile.paidLatencies.length) {
      const sum = profile.paidLatencies.reduce((a,b) => a+b, 0);
      profile.avgLatency = Math.round(sum / profile.paidLatencies.length);
      profile.onTimeRate = Math.round(
        (profile.paidLatencies.filter(l => l <= 0).length / profile.paidLatencies.length) * 100
      );
    }

    // 4) 위험 등급 점수 (0~100, 높을수록 위험)
    let score = 0;
    // 한도 사용률
    if (profile.utilization >= 100) score += 40;
    else if (profile.utilization >= 80) score += 25;
    else if (profile.utilization >= 60) score += 10;
    // 평균 지연일
    if (profile.avgLatency >= 30) score += 30;
    else if (profile.avgLatency >= 14) score += 18;
    else if (profile.avgLatency >= 7) score += 8;
    // 최대 지연일
    if (profile.maxLatency >= 60) score += 15;
    else if (profile.maxLatency >= 30) score += 8;
    // 정시 입금률
    if (profile.paidLatencies.length >= 3) {
      if (profile.onTimeRate < 30) score += 15;
      else if (profile.onTimeRate < 60) score += 8;
    }
    profile.riskScore = Math.min(100, score);
    profile.riskLevel = score >= 70 ? 'CRITICAL'
                      : score >= 50 ? 'DANGER'
                      : score >= 25 ? 'WATCH' : 'SAFE';
    return profile;
  }

  // 모든 고객사 프로파일
  function allProfiles() {
    if (typeof getEnriched !== 'function') return [];
    const customers = new Set();
    getEnriched().forEach(o => o.고객사 && customers.add(o.고객사));
    return Array.from(customers)
      .map(buildProfile)
      .filter(p => p)
      .sort((a, b) => b.riskScore - a.riskScore);
  }

  // 한도 임박 또는 만성 지연 고객 (notify trigger 용)
  function alerts() {
    const list = allProfiles();
    return list.filter(p =>
      p.riskLevel === 'CRITICAL' ||
      p.riskLevel === 'DANGER' ||
      (p.creditLimit > 0 && p.utilization >= 80)
    );
  }

  // 신규 수주 사전 검증 (이미 customer.js에 일부 있음 — 이쪽은 강화판)
  function preCheckOrder(customer, newAmount) {
    const p = buildProfile(customer);
    if (!p) return { ok: true };
    if (p.creditLimit <= 0) {
      return { ok: true, warning: `신용한도 미설정 — 위험 등급: ${p.riskLevel}` };
    }
    const projected = p.currentAR + (Number(newAmount) || 0);
    const projectedRatio = projected / p.creditLimit * 100;
    if (projected > p.creditLimit) {
      return {
        ok: false,
        block: true,
        reason: `신용한도 초과 — 현재 미수 ${_fmt(p.currentAR)}원 + 신규 ${_fmt(newAmount)}원 = ${_fmt(projected)}원 > 한도 ${_fmt(p.creditLimit)}원`,
        profile: p
      };
    }
    if (projectedRatio >= 80) {
      return {
        ok: true,
        warning: `한도 ${projectedRatio.toFixed(0)}% 사용 예상 — 위험 등급: ${p.riskLevel}, 평균 지연 ${p.avgLatency}일`,
        profile: p
      };
    }
    return { ok: true, profile: p };
  }

  // ── UI ──────────────────────────────────────────
  const RISK_COLORS = {
    SAFE:     { bg:'#e8f5e9', color:'#27ae60', label:'안전' },
    WATCH:    { bg:'#fff8e1', color:'#f9a825', label:'주시' },
    DANGER:   { bg:'#fff3e0', color:'#e65100', label:'위험' },
    CRITICAL: { bg:'#ffebee', color:'#c62828', label:'긴급' }
  };

  function _injectUI() {
    if (document.getElementById('erp-cr-modal')) return;
    const css = `
      #erp-cr-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-cr-modal.open{display:flex;}
      .cr-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1300px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .cr-hd{padding:14px 18px;background:#c62828;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .cr-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .cr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;}
      .cr-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .cr-stat-l{font-size:0.74em;color:#666;text-transform:uppercase;font-weight:700;}
      .cr-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .cr-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .cr-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .cr-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .cr-risk{padding:3px 10px;border-radius:5px;font-size:0.78em;font-weight:800;}
      .cr-gauge{display:inline-block;width:100px;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;vertical-align:middle;}
      .cr-gauge-fill{height:100%;border-radius:4px;}
      .cr-detail-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9700;display:none;align-items:center;justify-content:center;}
      .cr-detail-modal.open{display:flex;}
      .cr-detail-box{background:#fff;border-radius:12px;width:92%;max-width:700px;max-height:85vh;overflow-y:auto;padding:20px;box-shadow:0 16px 60px rgba(0,0,0,0.35);}
    `;
    const style = document.createElement('style');
    style.id = 'erp-cr-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-cr-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="cr-box">
        <div class="cr-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">고객사 신용 분석</h4>
          <button class="cr-close-x" onclick="document.getElementById('erp-cr-modal').classList.remove('open')" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div class="cr-bd" id="cr-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    // ★ 2026-05-13 _mountToTab() 시 .cr-box 가 modal 밖으로 이동하면 이벤트 전파 X
    //   modal·box 양쪽에 클릭 핸들러 부착
    modal.addEventListener('click', _onModalClick);
    const box = modal.querySelector('.cr-box');
    if (box) box.addEventListener('click', _onModalClick);
  }

  function _renderList() {
    const profiles = allProfiles();
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : _fmt(v);

    const counts = { SAFE:0, WATCH:0, DANGER:0, CRITICAL:0 };
    let totalAR = 0, totalLimit = 0;
    profiles.forEach(p => {
      counts[p.riskLevel]++;
      totalAR += p.currentAR;
      totalLimit += p.creditLimit;
    });

    const html = `
      <div class="cr-stats">
        <div class="cr-stat"><div class="cr-stat-l">전체 고객사</div><div class="cr-stat-v">${profiles.length}</div></div>
        <div class="cr-stat"><div class="cr-stat-l">🟢 안전</div><div class="cr-stat-v" style="color:#27ae60;">${counts.SAFE}</div></div>
        <div class="cr-stat"><div class="cr-stat-l">🟡 주시</div><div class="cr-stat-v" style="color:#f9a825;">${counts.WATCH}</div></div>
        <div class="cr-stat"><div class="cr-stat-l">🟠 위험</div><div class="cr-stat-v" style="color:#e65100;">${counts.DANGER}</div></div>
        <div class="cr-stat"><div class="cr-stat-l">🔴 긴급</div><div class="cr-stat-v" style="color:#c62828;">${counts.CRITICAL}</div></div>
        <div class="cr-stat"><div class="cr-stat-l">총 미수금</div><div class="cr-stat-v">${fmtMoney(totalAR)}원</div></div>
        <div class="cr-stat"><div class="cr-stat-l">총 한도</div><div class="cr-stat-v">${fmtMoney(totalLimit)}원</div></div>
      </div>

      <div style="background:#fffde7;border-left:4px solid #f9a825;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:0.84em;color:#666;">
        💡 <strong>위험 점수 산정</strong>: 한도 사용률 (40점) + 평균 지연일 (30점) + 최대 지연일 (15점) + 정시 입금률 (15점)
      </div>

      <table class="cr-tbl">
        <thead><tr>
          <th>위험</th><th>고객사</th><th>수주</th><th style="text-align:right;">미수금</th><th style="text-align:right;">한도</th>
          <th>한도 사용률</th><th>평균 지연</th><th>정시율</th><th>상세</th>
        </tr></thead>
        <tbody>
          ${profiles.length === 0
            ? '<tr><td colspan="9" style="padding:30px;text-align:center;color:#bbb;">고객사 데이터 없음</td></tr>'
            : profiles.map(p => {
              const risk = RISK_COLORS[p.riskLevel];
              const utilColor = p.utilization >= 100 ? '#c62828' : p.utilization >= 80 ? '#e65100' : p.utilization >= 60 ? '#f9a825' : '#27ae60';
              const limitText = p.creditLimit > 0 ? fmtMoney(p.creditLimit) + '원' : '<span style="color:#bbb;">미설정</span>';
              const utilText = p.creditLimit > 0
                ? `<span style="color:${utilColor};font-weight:700;">${p.utilization}%</span>`
                : '<span style="color:#bbb;">-</span>';
              const gauge = p.creditLimit > 0
                ? `<div class="cr-gauge"><div class="cr-gauge-fill" style="width:${Math.min(100,p.utilization)}%;background:${utilColor};"></div></div>`
                : '';
              const latencyText = p.paidLatencies.length > 0
                ? `<span style="color:${p.avgLatency<=0?'#27ae60':p.avgLatency<=7?'#f9a825':'#c62828'};font-weight:700;">${p.avgLatency>=0?'+':''}${p.avgLatency}일</span> <span style="color:#888;font-size:0.86em;">(${p.paidLatencies.length}건)</span>`
                : '<span style="color:#bbb;">-</span>';
              const onTimeText = p.paidLatencies.length > 0
                ? `<span style="color:${p.onTimeRate>=80?'#27ae60':p.onTimeRate>=50?'#f9a825':'#c62828'};font-weight:700;">${p.onTimeRate}%</span>`
                : '<span style="color:#bbb;">-</span>';

              return `<tr>
                <td><span class="cr-risk" style="background:${risk.bg};color:${risk.color};">${risk.label} ${p.riskScore}</span></td>
                <td style="font-weight:700;">${_e(p.customer)}</td>
                <td style="text-align:center;">${p.ordersCount}</td>
                <td style="text-align:right;font-weight:700;color:${p.currentAR>0?'#c62828':'#27ae60'};">${fmtMoney(p.currentAR)}</td>
                <td style="text-align:right;">${limitText}</td>
                <td>${utilText} ${gauge}</td>
                <td>${latencyText}</td>
                <td>${onTimeText}</td>
                <td><button class="qt-btn qt-btn-ghost" data-act="cr-detail" data-customer="${_ea(p.customer)}" style="padding:5px 10px;border:1px solid #ccc;background:#fff;color:#555;border-radius:5px;cursor:pointer;font-size:0.78em;">📊 상세</button></td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>`;
    document.getElementById('cr-bd').innerHTML = html;
  }

  function _renderDetail(customer) {
    const p = buildProfile(customer);
    if (!p) return;
    const risk = RISK_COLORS[p.riskLevel];
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : _fmt(v);

    let detail = document.querySelector('.cr-detail-modal');
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'cr-detail-modal';
      detail.onclick = e => { if (e.target === detail) detail.classList.remove('open'); };
      document.body.appendChild(detail);
    }

    // 최근 6개월 추세 (단순 텍스트 미니 차트)
    const recent = p.orderHistory.slice(-12);
    const ordersByMonth = {};
    recent.forEach(o => {
      if (!o.dueDate) return;
      const ym = o.dueDate.slice(0, 7);
      ordersByMonth[ym] = (ordersByMonth[ym] || 0) + 1;
    });
    const trendHtml = Object.entries(ordersByMonth)
      .sort()
      .map(([ym, cnt]) => `<div style="display:flex;align-items:center;gap:8px;font-size:0.82em;margin:2px 0;">
        <span style="width:60px;color:#666;">${ym}</span>
        <div style="background:#1565c0;height:14px;width:${Math.min(200, cnt*20)}px;border-radius:3px;"></div>
        <span style="font-weight:700;">${cnt}건</span>
      </div>`)
      .join('');

    detail.innerHTML = `
      <div class="cr-detail-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;color:#1a1a2e;">📊 ${_e(p.customer)}</h3>
          <button onclick="this.closest('.cr-detail-modal').classList.remove('open')" style="background:transparent;border:none;font-size:22px;cursor:pointer;">✕</button>
        </div>

        <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px;background:${risk.bg};padding:14px;border-radius:8px;">
          <div style="font-size:2.4em;font-weight:900;color:${risk.color};">${p.riskScore}</div>
          <div>
            <div style="font-size:1.2em;font-weight:800;color:${risk.color};">${risk.label}</div>
            <div style="font-size:0.86em;color:#666;">위험 점수: ${p.riskScore}/100</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">신용 한도</div><div style="font-weight:800;font-size:1.1em;">${p.creditLimit>0?fmtMoney(p.creditLimit)+'원':'미설정'}</div></div>
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">현재 미수금</div><div style="font-weight:800;font-size:1.1em;color:${p.currentAR>0?'#c62828':'#27ae60'};">${fmtMoney(p.currentAR)}원</div></div>
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">한도 사용률</div><div style="font-weight:800;font-size:1.1em;">${p.creditLimit>0?p.utilization+'%':'-'}</div></div>
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">총 수주</div><div style="font-weight:800;font-size:1.1em;">${p.ordersCount}건</div></div>
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">평균 지연일</div><div style="font-weight:800;font-size:1.1em;color:${p.avgLatency<=0?'#27ae60':p.avgLatency<=7?'#f9a825':'#c62828'};">${p.paidLatencies.length>0?(p.avgLatency>=0?'+':'')+p.avgLatency+'일':'-'}</div></div>
          <div style="background:#f9f9f9;padding:10px;border-radius:6px;"><div style="font-size:0.74em;color:#666;">정시 입금률</div><div style="font-weight:800;font-size:1.1em;">${p.paidLatencies.length>0?p.onTimeRate+'%':'-'}</div></div>
        </div>

        ${trendHtml ? `<div style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:6px;">📈 월별 수주 추세 (최근 12건 기준)</div>${trendHtml}</div>` : ''}

        <div style="margin-bottom:6px;font-weight:700;">📋 최근 수주 이력</div>
        <table class="cr-tbl" style="font-size:0.78em;">
          <thead><tr><th>PJ NO</th><th style="text-align:right;">금액</th><th>출고요청일</th><th>상태</th><th>지연</th></tr></thead>
          <tbody>
            ${p.orderHistory.slice(-10).reverse().map(o => `<tr>
              <td style="font-weight:700;">${_e(o.pjNo)}</td>
              <td style="text-align:right;">${fmtMoney(o.total)}원</td>
              <td>${_e(o.dueDate||'-')}</td>
              <td>${_e(o.status||'-')}</td>
              <td>${o.latency!=null ? `<span style="color:${o.latency<=0?'#27ae60':o.latency<=7?'#f9a825':'#c62828'};font-weight:700;">${o.latency>=0?'+':''}${o.latency}일</span>` : '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>

        <div style="margin-top:14px;padding:10px;background:#fffde7;border-left:4px solid #f9a825;border-radius:6px;font-size:0.82em;color:#666;">
          💡 위 데이터는 출고요청일·납품일 기반 자동 추정. 정확한 입금일 추적은 메타데이터 _depositPaidDate / _balancePaidDate 활용 권장.
        </div>
      </div>`;
    detail.classList.add('open');
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'cr-detail') {
      const c = btn.getAttribute('data-customer');
      _renderDetail(c);
    }
  }

  function open(customer) {
    _injectUI();
    // ★ 영업실적 탭(sales)의 신용분석 서브탭으로 이동됨 (2026-05-12)
    if (typeof window.setSalesSubtab === 'function'
        && document.getElementById('creditTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('sales'); } catch(e) {}
      }
      setTimeout(() => {
        window.setSalesSubtab('credit');
        if (customer) setTimeout(() => _renderDetail(customer), 100);
      }, 30);
      return;
    }
    document.getElementById('erp-cr-modal').classList.add('open');
    setTimeout(() => {
      _renderList();
      if (customer) setTimeout(() => _renderDetail(customer), 100);
    }, 30);
  }
  function close() { document.getElementById('erp-cr-modal')?.classList.remove('open'); }

  // ── 탭 마운트 (영업실적 탭의 creditTabHost 로 box 이동) ──
  function _mountToTab() {
    const host = document.getElementById('creditTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-cr-modal');
    if (!modal) { try { _injectUI(); } catch(e){ console.error('[erpCredit] _injectUI 실패:', e); return; } modal = document.getElementById('erp-cr-modal'); if (!modal) return; }
    const box = modal.querySelector('.cr-box');
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
      // ★ 2026-05-13 box 가 modal 밖으로 이동하면서 이벤트 위임이 끊김 — 재부착
      if (!box.__crClickHooked) {
        box.addEventListener('click', _onModalClick);
        box.__crClickHooked = true;
      }
    }
    // ★ 탭 모드에서는 헤더의 X(닫기) 버튼 의미 없음 — 숨김 (사용자 요청)
    const closeBtn = box.querySelector('.cr-close-x');
    if (closeBtn) closeBtn.style.display = 'none';
    setTimeout(_renderList, 30);
  }

  // ── 공개 API ────────────────────────────────────
  window.erpCredit = {
    profile: buildProfile,
    all: allProfiles,
    alerts,
    preCheckOrder,
    open, close,
    _mountToTab
  };

  // ── 부팅 ───────────────────────────────────────
  function boot() { setTimeout(_injectUI, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-CREDIT] 신용 분석 활성 — erpCredit.open() / erpCredit.alerts()');
})();
