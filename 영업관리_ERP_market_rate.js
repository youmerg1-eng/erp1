// =====================================================
//  MARKET RATE — Phase F · Day 4
//  USD/KRW · CNY/KRW 실시간 환율 위젯 (무료 API)
//
//  데이터 소스: exchangerate.host (CORS 허용 무료 API)
//   fallback: open.er-api.com (역시 무료)
//
//  표시 위치: 우상단 작은 위젯 (역할 배지 옆)
//  갱신: 1시간마다 자동 + localStorage 캐시 30분
// =====================================================
(function() {
  'use strict';

  const CACHE_KEY = 'erp_market_rate_cache';
  const CACHE_TTL_MS = 30 * 60 * 1000;   // 30분
  const PAIRS = ['USD', 'CNY', 'EUR', 'JPY'];

  function _loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && (Date.now() - c.when) < CACHE_TTL_MS) return c;
    } catch(e) {}
    return null;
  }

  function _saveCache(rates) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ when: Date.now(), rates }));
    } catch(e) {}
  }

  async function fetchRates(force) {
    if (!force) {
      const cached = _loadCache();
      if (cached) return cached.rates;
    }
    // exchangerate.host (무료, CORS 허용, base 지원)
    let rates = null;
    try {
      // base: USD, KRW만 가져오기
      const urls = [
        'https://open.er-api.com/v6/latest/USD',
        'https://open.er-api.com/v6/latest/CNY',
        'https://open.er-api.com/v6/latest/EUR',
        'https://open.er-api.com/v6/latest/JPY'
      ];
      const results = await Promise.all(urls.map(u => fetch(u).then(r => r.json()).catch(() => null)));
      rates = {};
      const codes = ['USD','CNY','EUR','JPY'];
      results.forEach((r, i) => {
        if (r && r.rates && r.rates.KRW) {
          rates[codes[i] + '/KRW'] = r.rates.KRW;
        }
      });
      if (Object.keys(rates).length === 0) throw new Error('API 응답 없음');
    } catch(e) {
      if (typeof logError === 'function') logError('marketRate', e);
      throw e;
    }
    _saveCache(rates);
    return rates;
  }

  // 이전 환율 (변동률 계산용) — 갱신할 때마다 이전 값과 비교
  //   매 갱신 시 직전 환율과 현재 환율의 변동을 보여줌 (24h 단위 아님)
  function _getPrevious() {
    try {
      const p = JSON.parse(localStorage.getItem('erp_market_rate_previous') || 'null');
      return p && p.rates ? p.rates : null;
    } catch(e) { return null; }
  }

  function _savePrevious(rates) {
    // 새 데이터로 직전 데이터를 갱신 — 다음 호출 때 변동 계산에 사용
    try {
      localStorage.setItem('erp_market_rate_previous', JSON.stringify({ when: Date.now(), rates }));
    } catch(e) {}
  }

  // 하위 호환 — 기존 호출 이름 보존
  const _getYesterday = _getPrevious;
  const _saveYesterday = _savePrevious;

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-rate-widget')) return;
    const css = `
      #erp-rate-widget{position:fixed;top:42px;right:10px;z-index:9050;background:#1a1a2e;color:#fff;
        border-radius:8px;padding:8px 12px;font-size:0.78em;box-shadow:0 4px 14px rgba(0,0,0,0.25);
        cursor:pointer;display:flex;gap:14px;align-items:center;font-family:'SF Mono','Consolas',monospace;}
      #erp-rate-widget:hover{background:#0d47a1;}
      #erp-rate-widget .pair{display:flex;flex-direction:column;align-items:flex-start;}
      #erp-rate-widget .pair-name{font-size:0.78em;opacity:0.7;line-height:1;}
      #erp-rate-widget .pair-val{font-weight:700;line-height:1.2;}
      #erp-rate-widget .pair-chg{font-size:0.74em;line-height:1;}
      #erp-rate-widget .up{color:#ef5350;}
      #erp-rate-widget .down{color:#42a5f5;}
      #erp-rate-widget .same{color:#999;}
      #erp-rate-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9700;display:none;align-items:flex-start;justify-content:center;padding-top:10vh;}
      #erp-rate-modal.open{display:flex;}
      .rate-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:520px;padding:24px;}
      .rate-box h3{margin:0 0 14px;color:#1a1a2e;}
      .rate-tbl{width:100%;border-collapse:collapse;margin-top:10px;}
      .rate-tbl th{background:#1a1a2e;color:#fff;padding:8px 12px;text-align:left;}
      .rate-tbl td{padding:8px 12px;border-bottom:1px solid #eee;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-rate-style'; style.textContent = css;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'erp-rate-widget';
    widget.title = '시장 시세 (클릭하면 상세) · 30분 캐시';
    widget.innerHTML = '<span style="opacity:0.6;">시세 로딩...</span>';
    widget.onclick = open;
    document.body.appendChild(widget);

    const modal = document.createElement('div');
    modal.id = 'erp-rate-modal';
    modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
    document.body.appendChild(modal);
  }

  function _renderWidget(rates, prev) {
    const w = document.getElementById('erp-rate-widget');
    if (!w) return;
    if (!rates || !Object.keys(rates).length) {
      w.innerHTML = '<span style="opacity:0.6;">시세 미연결</span>';
      return;
    }
    const pairs = ['USD/KRW', 'CNY/KRW'];   // widget 핵심만
    w.innerHTML = pairs.map(p => {
      const cur = rates[p];
      if (!cur) return '';
      let chg = '';
      if (prev && prev[p]) {
        const diff = cur - prev[p];
        const pct = (diff / prev[p]) * 100;
        const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
        const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '•';
        chg = `<span class="pair-chg ${cls}">${arrow}${Math.abs(pct).toFixed(2)}%</span>`;
      }
      return `<div class="pair">
        <span class="pair-name">${p}</span>
        <span class="pair-val">${cur.toLocaleString('ko-KR', {maximumFractionDigits: 2})}</span>
        ${chg}
      </div>`;
    }).join('');
  }

  function _renderModal(rates, prev) {
    const m = document.getElementById('erp-rate-modal');
    if (!m) return;
    const cached = _loadCache();
    const updated = cached ? new Date(cached.when).toLocaleString('ko-KR') : '-';
    m.innerHTML = `<div class="rate-box">
      <h3>💱 시장 시세 (KRW 기준)</h3>
      <p style="font-size:0.84em;color:#666;">📡 출처: open.er-api.com (무료 공개 API)</p>
      <table class="rate-tbl">
        <thead><tr><th>통화</th><th style="text-align:right;">이전 환율</th><th style="text-align:right;">현재 환율</th><th style="text-align:right;">대비</th></tr></thead>
        <tbody>${PAIRS.map(c => {
          const k = c+'/KRW';
          const cur = rates[k];
          const p = prev && prev[k];
          if (!cur) return `<tr><td>${k}</td><td style="text-align:right;color:#bbb;">-</td><td style="text-align:right;color:#bbb;">미연결</td><td></td></tr>`;
          let chg = '<span style="color:#888;">최초</span>';
          let prevStr = '<span style="color:#bbb;">-</span>';
          if (p) {
            prevStr = p.toLocaleString('ko-KR',{maximumFractionDigits:2});
            const diff = cur - p;
            const pct = (Math.abs(p) > 0) ? (diff/p) * 100 : 0;
            const cls = diff > 0 ? 'color:#c62828;' : diff < 0 ? 'color:#1565c0;' : 'color:#888;';
            const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '•';
            chg = `<span style="${cls}font-weight:700;">${arrow}${Math.abs(diff).toFixed(2)} (${Math.abs(pct).toFixed(2)}%)</span>`;
          }
          return `<tr>
            <td><strong>${c}</strong></td>
            <td style="text-align:right;color:#777;">${prevStr}</td>
            <td style="text-align:right;font-weight:700;">${cur.toLocaleString('ko-KR',{maximumFractionDigits:2})}</td>
            <td style="text-align:right;">${chg}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <div style="margin-top:14px;font-size:0.78em;color:#888;">
        🕐 마지막 갱신: ${updated}<br>
        💡 ${(CACHE_TTL_MS/60000)|0}분마다 자동 캐시 · 매입 시점 단가 협상에 활용
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="erpMarket.refresh()" style="padding:8px 14px;background:#1565c0;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 강제 갱신</button>
        <button onclick="document.getElementById('erp-rate-modal').classList.remove('open')" style="padding:8px 14px;background:#999;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
      </div>
    </div>`;
  }

  async function refresh(force) {
    try {
      const rates = await fetchRates(force);
      const prev = _getYesterday();
      _renderWidget(rates, prev);
      _renderModal(rates, prev);
      _saveYesterday(rates);
      return rates;
    } catch(e) {
      const w = document.getElementById('erp-rate-widget');
      if (w) w.innerHTML = '<span style="opacity:0.6;">시세 오류</span>';
      console.warn('[ERP-RATE]', e.message);
    }
  }

  function open() {
    const m = document.getElementById('erp-rate-modal');
    if (!m) return;
    m.classList.add('open');
    refresh();
  }

  window.erpMarket = {
    refresh,
    open,
    rates: () => _loadCache()?.rates || null
  };

  function boot() {
    _injectUI();
    setTimeout(() => refresh(), 1500);
    setInterval(() => refresh(), 60 * 60 * 1000);   // 1시간
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-RATE] 시장 시세 위젯 활성 — 우상단 또는 erpMarket.open()');
})();
