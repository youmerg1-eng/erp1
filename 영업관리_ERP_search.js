// =====================================================
//  GLOBAL SEARCH (Cmd+K / Ctrl+K) — Phase A · Week 3
//
//  검색 대상 (모두 통합)
//    - 수주 (PJ NO·고객사·모델명·발전소명·담당자·납품주소·인수담당자)
//    - 출고지시서 (DO 번호·PJ NO·수신처·모델명·차량번호)
//    - 입출고 이력 (모델·창고·B/L·PJ NO·비고)
//    - 제품 마스터 (모델명·제조사)
//
//  바로가기
//    Ctrl/Cmd + K  → 검색창 열기
//    ESC           → 닫기
//    ↑/↓           → 결과 이동
//    Enter         → 선택 항목으로 이동
//
//  기존 코드는 한 줄도 수정하지 않음.
// =====================================================
(function() {
  'use strict';

  let _gsItems = [];
  let _gsSelected = 0;

  function _injectSearchUI() {
    if (document.getElementById('erp-gs-modal')) return;

    const css = `
      #erp-gs-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:8vh;}
      #erp-gs-modal.open{display:flex;}
      #erp-gs-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:90%;max-width:640px;display:flex;flex-direction:column;overflow:hidden;
        animation:gsIn .15s ease-out;}
      @keyframes gsIn{from{transform:translateY(-20px);opacity:0;}to{transform:translateY(0);opacity:1;}}
      .erp-gs-input{padding:18px 22px;border:none;border-bottom:1px solid #eee;font-size:1.05em;outline:none;width:100%;box-sizing:border-box;}
      .erp-gs-results{max-height:55vh;overflow-y:auto;}
      .erp-gs-empty{padding:30px;text-align:center;color:#bbb;font-size:0.86em;}
      .erp-gs-group{padding:6px 14px;background:#fafafa;color:#999;font-size:0.74em;font-weight:700;border-bottom:1px solid #eee;}
      .erp-gs-row{padding:10px 16px;cursor:pointer;border-bottom:1px solid #f3f3f3;display:flex;align-items:center;gap:10px;}
      .erp-gs-row:hover, .erp-gs-row.sel{background:#f0f4ff;}
      .erp-gs-row.sel{box-shadow:inset 3px 0 0 #1a1a2e;}
      .erp-gs-icon{flex-shrink:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:#1a1a2e;color:#fff;font-size:14px;}
      .erp-gs-icon.do{background:#1565c0;}
      .erp-gs-icon.inv{background:#e65100;}
      .erp-gs-icon.pm{background:#27ae60;}
      .erp-gs-meta{flex:1;min-width:0;}
      .erp-gs-title{font-weight:700;color:#1a1a2e;font-size:0.9em;margin-bottom:2px;}
      .erp-gs-sub{color:#888;font-size:0.78em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .erp-gs-hi{background:#fff3cd;padding:0 2px;border-radius:2px;color:#1a1a2e;font-weight:700;}
      .erp-gs-foot{padding:8px 16px;background:#fafafa;border-top:1px solid #eee;font-size:0.72em;color:#888;display:flex;justify-content:space-between;}
      .erp-gs-fab{position:fixed;bottom:18px;right:72px;width:44px;height:44px;border-radius:50%;
        background:#1565c0;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s, background .2s;}
      .erp-gs-fab:hover{background:#0d47a1;transform:scale(1.07);}
    `;
    const style = document.createElement('style');
    style.id = 'erp-gs-style';
    style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-gs-modal';
    modal.innerHTML = `
      <div id="erp-gs-box">
        <input class="erp-gs-input" id="erp-gs-input" placeholder="🔍 PJ NO · 고객사 · 모델명 · 발전소 · 차량 · 담당자 …" autocomplete="off">
        <div class="erp-gs-results" id="erp-gs-results"></div>
        <div class="erp-gs-foot">
          <span><kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 선택 · <kbd>Esc</kbd> 닫기</span>
          <span><kbd>Ctrl+K</kbd></span>
        </div>
      </div>`;
    modal.onclick = e => { if (e.target === modal) closeSearch(); };
    document.body.appendChild(modal);

    // FAB 버튼 (검색)
    const fab = document.createElement('button');
    fab.className = 'erp-gs-fab';
    fab.title = '글로벌 검색 (Ctrl+K)';
    fab.textContent = '🔍';
    fab.onclick = openSearch;
    document.body.appendChild(fab);

    // 입력 이벤트
    const input = document.getElementById('erp-gs-input');
    input.addEventListener('input', () => _renderResults(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape')      { closeSearch(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); _moveSelection(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); _moveSelection(-1); }
      else if (e.key === 'Enter')     { e.preventDefault(); _activateSelection(); }
    });
  }

  // 단축키 등록
  function _bindShortcut() {
    window.addEventListener('keydown', e => {
      // Ctrl/Cmd + K
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openSearch();
      }
      // ESC 어디서든 닫기
      if (e.key === 'Escape') {
        const m = document.getElementById('erp-gs-modal');
        if (m && m.classList.contains('open')) closeSearch();
      }
    });
  }

  function openSearch() {
    // UI 미초기화 시 강제 재초기화 (toolbar에서 fab hidden 상태로 호출되는 경우 대비)
    if (!document.getElementById('erp-gs-modal')) {
      try { _injectSearchUI(); } catch(e) { console.error('[ERP-SEARCH] UI inject 실패', e); return; }
    }
    const m = document.getElementById('erp-gs-modal');
    if (!m) { console.error('[ERP-SEARCH] 모달 생성 실패'); return; }
    m.classList.add('open');
    const inp = document.getElementById('erp-gs-input');
    if (!inp) return;
    // 다중 시도로 focus 보장 (다른 모달이 닫히는 시점·DOM 렌더 타이밍 차이 대응)
    setTimeout(() => { try { inp.focus(); inp.select(); } catch(e) {} }, 50);
    setTimeout(() => { try { inp.focus(); } catch(e) {} }, 200);
    try { _renderResults(inp.value || ''); }
    catch(e) {
      console.error('[ERP-SEARCH] 결과 렌더 실패', e);
      const box = document.getElementById('erp-gs-results');
      if (box) box.innerHTML = '<div class="erp-gs-empty" style="color:#c62828;">⚠️ 검색 데이터 로딩 오류 — 새로고침 후 재시도</div>';
    }
  }
  function closeSearch() {
    const m = document.getElementById('erp-gs-modal');
    if (m) m.classList.remove('open');
  }
  window.openErpSearch  = openSearch;
  window.closeErpSearch = closeSearch;

  // ── 인덱스 빌드 + 캐싱 ──────────────────────────────
  // [PATCH-G] 2초 캐싱 — 매 키 입력마다 getEnriched 재호출 방지
  let _idxCache = null;
  let _idxCacheTime = 0;
  const _IDX_TTL_MS = 2000;

  function _buildIndex() {
    const now = Date.now();
    if (_idxCache && (now - _idxCacheTime) < _IDX_TTL_MS) return _idxCache;
    const items = [];
    // 안전한 문자열 추출
    const _safe = v => (v == null ? '' : String(v));
    // 수주
    if (typeof getEnriched === 'function') {
      try {
        getEnriched().forEach(o => {
          if (!o) return;
          const pjNo = _safe(o.pjNo);
          if (!pjNo) return;   // PJ NO 없으면 스킵
          items.push({
            type: 'order',
            icon: '📋',
            iconCls: '',
            title: `${pjNo} — ${_safe(o.고객사) || '-'}`,
            sub:   `${_safe(o.모델명) || '-'} · ${_safe(o.발전소명) || '-'} · ${_safe(o.담당자) || '-'} · ${_safe(o.납품주소)}`,
            haystack: [pjNo, _safe(o.고객사), _safe(o.모델명), _safe(o.발전소명), _safe(o.담당자), _safe(o.납품주소), _safe(o.인수담당자), _safe(o.제조사)].join(' ').toLowerCase(),
            action: () => {
              try { if (typeof showTab === 'function') showTab('orders'); } catch(e){}
              try { if (typeof openOrderDetail === 'function') setTimeout(() => openOrderDetail(o._id || pjNo), 250); } catch(e){}
            }
          });
        });
      } catch(e) { console.warn('[ERP-SEARCH] 수주 인덱싱 일부 실패', e); }
    }
    // 출고지시서
    if (typeof deliveryOrders !== 'undefined') {
      deliveryOrders.forEach(d => {
        items.push({
          type: 'delivery',
          icon: '📄',
          iconCls: 'do',
          title: `${d.id} — ${d.receiver || '-'}`,
          sub:   `${d.pjNo || '-'} · ${d.model || '-'} · ${d.totalQty || d.qty}매 · ${d.vehicle || '차량 미입력'}`,
          haystack: [d.id, d.pjNo, d.receiver, d.plant, d.model, d.vehicle, d.warehouse, d.siteMgr].join(' ').toLowerCase(),
          action: () => {
            if (typeof showTab === 'function') showTab('delivery');
            if (typeof showDeliveryPreview === 'function') setTimeout(() => {
              const dd = deliveryOrders.find(x => x.id === d.id);
              if (dd) showDeliveryPreview(dd);
            }, 200);
          }
        });
      });
    }
    // 입출고
    if (typeof inventoryData !== 'undefined') {
      inventoryData.slice(-200).forEach(r => {
        items.push({
          type: 'inv',
          icon: r.type === '입고' ? '📥' : '📤',
          iconCls: 'inv',
          title: `${r.type} ${r.date} — ${r.model || '-'}`,
          sub:   `${r.qty || 0}매 · ${r.warehouse || '-'} · ${r.pjNo || ''} · ${r.bl || ''}`,
          haystack: [r.model, r.warehouse, r.pjNo, r.bl, r.mfr, r.remarks, r.type].join(' ').toLowerCase(),
          action: () => {
            if (typeof showTab === 'function') showTab('stock');
          }
        });
      });
    }
    // 제품 마스터
    if (typeof productMaster !== 'undefined') {
      Object.entries(productMaster).forEach(([m, v]) => {
        items.push({
          type: 'pm',
          icon: '🏷️',
          iconCls: 'pm',
          title: m,
          sub:   `${v.watt || '-'}W · ${v.mfr || '-'}${v.plt ? ' · ' + v.plt + '매/PLT' : ''}`,
          haystack: (m + ' ' + (v.mfr || '')).toLowerCase(),
          action: () => {
            if (typeof showTab === 'function') showTab('settings');
          }
        });
      });
    }
    // [PATCH-G] 캐시 저장
    _idxCache = items;
    _idxCacheTime = now;
    return items;
  }

  // [PATCH-G] saveLocal 호출 시 캐시 무효화
  function _hookCacheInvalidate() {
    if (typeof window.saveLocal !== 'function') { setTimeout(_hookCacheInvalidate, 200); return; }
    if (window.saveLocal.__searchCacheHooked) return;
    const _orig = window.saveLocal;
    window.saveLocal = function() {
      _idxCache = null;
      _idxCacheTime = 0;
      return _orig.apply(this, arguments);
    };
    window.saveLocal.__searchCacheHooked = true;
  }
  setTimeout(_hookCacheInvalidate, 300);
  setTimeout(_hookCacheInvalidate, 1500);

  // ── 검색 + 렌더 ─────────────────────────────────────
  // ★ XSS 차단 — 본문 escape 후 검색어 강조 처리.
  //   기존 구현은 사용자 입력(text)을 escape 없이 innerHTML 에 삽입했음.
  function _highlight(text, q) {
    const _e = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])));
    const safe = _e(text || '');
    if (!q) return safe;
    try {
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').split(/\s+/).filter(Boolean).join('|') + ')', 'gi');
      return safe.replace(re, '<span class="erp-gs-hi">$1</span>');
    } catch(e) { return safe; }
  }

  function _renderResults(query) {
    const q = (query || '').trim().toLowerCase();
    const all = _buildIndex();

    let matches;
    if (!q) {
      // 빈 검색 → 최근 항목 10개 (수주 우선)
      matches = all.slice(0, 10);
    } else {
      const tokens = q.split(/\s+/).filter(Boolean);
      // 모든 토큰이 haystack에 포함될 때만 매치 (AND)
      matches = all.filter(it => tokens.every(t => it.haystack.indexOf(t) >= 0));
      // 정렬: 제목 내 등장 우선
      matches.sort((a, b) => {
        const aHit = a.title.toLowerCase().indexOf(tokens[0]);
        const bHit = b.title.toLowerCase().indexOf(tokens[0]);
        if (aHit < 0 && bHit >= 0) return 1;
        if (bHit < 0 && aHit >= 0) return -1;
        return aHit - bHit;
      });
      matches = matches.slice(0, 50);
    }

    _gsItems = matches;
    _gsSelected = 0;

    const box = document.getElementById('erp-gs-results');
    if (!matches.length) {
      box.innerHTML = `<div class="erp-gs-empty">${q ? `"${query}" 일치 항목 없음` : '검색어를 입력하세요'}</div>`;
      return;
    }

    // 그룹화
    const groupTitles = { order:'📋 수주', delivery:'📄 출고지시서', inv:'📦 입출고 이력', pm:'🏷️ 제품 마스터' };
    let lastType = null;
    let html = '';
    matches.forEach((m, i) => {
      if (m.type !== lastType) {
        html += `<div class="erp-gs-group">${groupTitles[m.type] || m.type}</div>`;
        lastType = m.type;
      }
      // _highlight 가 본문 escape — iconCls/icon 은 코드 상수이므로 별도 escape 불필요하나 방어적으로 처리
      const _ea = (typeof escapeAttr === 'function') ? escapeAttr : (v => String(v||'').replace(/['"&]/g,''));
      const _eh = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v||'').replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch])));
      html += `<div class="erp-gs-row${i===0?' sel':''}" data-idx="${i}">
        <div class="erp-gs-icon ${_ea(m.iconCls)}">${_eh(m.icon)}</div>
        <div class="erp-gs-meta">
          <div class="erp-gs-title">${_highlight(m.title, q)}</div>
          <div class="erp-gs-sub">${_highlight(m.sub, q)}</div>
        </div>
      </div>`;
    });
    box.innerHTML = html;

    // 클릭 핸들러
    box.querySelectorAll('.erp-gs-row').forEach(el => {
      el.onclick = () => {
        _gsSelected = parseInt(el.dataset.idx);
        _activateSelection();
      };
      el.onmouseenter = () => {
        box.querySelectorAll('.erp-gs-row').forEach(r => r.classList.remove('sel'));
        el.classList.add('sel');
        _gsSelected = parseInt(el.dataset.idx);
      };
    });
  }

  function _moveSelection(delta) {
    if (!_gsItems.length) return;
    _gsSelected = (_gsSelected + delta + _gsItems.length) % _gsItems.length;
    const rows = document.querySelectorAll('#erp-gs-results .erp-gs-row');
    rows.forEach(r => r.classList.remove('sel'));
    if (rows[_gsSelected]) {
      rows[_gsSelected].classList.add('sel');
      rows[_gsSelected].scrollIntoView({ block:'nearest' });
    }
  }

  function _activateSelection() {
    const item = _gsItems[_gsSelected];
    if (!item) return;
    closeSearch();
    try { item.action(); }
    catch(e) {
      console.error('[ERP-SEARCH] 이동 실패', e);
      if (typeof setBanner === 'function') setBanner('err', '이동 실패: ' + e.message);
    }
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _injectSearchUI();
    _bindShortcut();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[ERP-SEARCH] 글로벌 검색 활성 · Ctrl+K로 호출');
})();
