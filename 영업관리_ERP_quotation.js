// =====================================================
//  QUOTATION — 견적서 모듈 (Sprint 4 · #1)
//
//  기능
//   1) 견적서 작성 (Q-YYYYMMDD-NNN 자동번호)
//   2) 상태 흐름: 작성 → 발송 → 승인 → 수주변환 / 거절 / 만료
//   3) 승인된 견적서 → 1클릭으로 수주현황(rawData)에 자동 등록
//   4) PDF 인쇄 (jsPDF)
//   5) 만료일 임박 알림 (D-3 이하 → notify trigger 자동 등록)
//
//  데이터 키 (자동 백업 보호)
//   erp_quotations → [
//     { id, no, date, validUntil, customer, plantName, address, contact,
//       items: [{ model, mfr, watt, qty, unitPrice, amount }],
//       subtotal, vat, total, status, notes, convertedToPjNo, _ts }
//   ]
//
//  UI: 도구함의 새 카드 + 모달 (도구 카테고리: 비즈니스)
//  공개 API: window.quotation
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_quotations';
  // safety.js public API 사용 (Sprint 3 ②)
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  // ── 데이터 로드/저장 ──────────────────────────────
  let quotations = [];
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      quotations = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(quotations)) quotations = [];
    } catch (e) {
      console.error('[quotation] load 실패', e);
      quotations = [];
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(quotations));
    } catch (e) {
      console.error('[quotation] save 실패', e);
      if (typeof setBanner === 'function')
        setBanner('err', '❌ 견적서 저장 실패: ' + (e.message || ''));
      throw e;
    }
  }

  // ── 자동 번호 생성 ────────────────────────────────
  //   Q-20260507-001 형식 (날짜+일련번호)
  function _genNo() {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const sameDay = quotations.filter(q => q.no && q.no.startsWith('Q-'+today));
    const next = String(sameDay.length + 1).padStart(3, '0');
    return 'Q-' + today + '-' + next;
  }

  function _genId() {
    return 'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  // ── CRUD ─────────────────────────────────────────
  function list() { return quotations.slice(); }

  function add(data) {
    const q = {
      id: _genId(),
      no: data.no || _genNo(),
      date: data.date || (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10)),
      // 기본 유효기간 30일
      validUntil: data.validUntil || _addDays(data.date || new Date(), 30),
      customer: data.customer || '',
      plantName: data.plantName || '',
      address: data.address || '',
      contact: data.contact || '',
      items: Array.isArray(data.items) ? data.items : [],
      subtotal: Number(data.subtotal) || 0,
      vat: Number(data.vat) || 0,
      total: Number(data.total) || 0,
      status: data.status || '작성',                // 작성|발송|승인|거절|만료|수주변환
      notes: data.notes || '',
      convertedToPjNo: null,
      _ts: Date.now()
    };
    // 자동 합계 계산
    if (!q.subtotal && q.items.length) {
      q.subtotal = q.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
      q.vat = Math.round(q.subtotal * 0.1);
      q.total = q.subtotal + q.vat;
    }
    quotations.push(q);
    save();
    return q;
  }

  function update(id, patch) {
    const i = quotations.findIndex(q => q.id === id);
    if (i < 0) return null;
    quotations[i] = { ...quotations[i], ...patch, _ts: Date.now() };
    save();
    return quotations[i];
  }

  function remove(id) {
    const i = quotations.findIndex(q => q.id === id);
    if (i < 0) return false;
    quotations.splice(i, 1);
    save();
    return true;
  }

  function get(id) {
    return quotations.find(q => q.id === id);
  }

  // ── 상태 흐름 액션 ────────────────────────────────
  function send(id) { return update(id, { status: '발송' }); }
  function approve(id) { return update(id, { status: '승인' }); }
  function reject(id, reason) { return update(id, { status: '거절', notes: (get(id)?.notes||'') + ' [거절: ' + (reason||'') + ']' }); }
  function expire(id) { return update(id, { status: '만료' }); }

  // ── 견적서 → 수주 변환 (핵심 기능) ─────────────────
  function convertToOrder(id) {
    const q = get(id);
    if (!q) throw new Error('견적서 없음');
    if (q.status === '수주변환') {
      if (q.convertedToPjNo) {
        if (!confirm(`이 견적서는 이미 수주(${q.convertedToPjNo})로 변환됨.\n중복 변환하시겠습니까?`)) return null;
      }
    }
    if (q.status !== '승인' && q.status !== '수주변환') {
      if (!confirm(`견적서 상태가 "${q.status}"입니다. 승인 상태가 아니지만 수주로 변환하시겠습니까?`)) return null;
    }
    if (typeof rawData === 'undefined') throw new Error('rawData 미로드');
    if (!q.items.length) throw new Error('견적 항목 없음 — 모델/수량 입력 필요');

    // 견적서의 각 항목을 1개의 수주로 등록 (다품목인 경우 여러 row)
    const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    const newRows = [];
    const pjBase = 'Q' + q.no.replace(/[^0-9]/g,'').slice(-8);   // Q26050701 형식
    q.items.forEach((it, idx) => {
      const pjNo = q.items.length > 1 ? `${pjBase}-${idx+1}` : pjBase;
      const id_ = (typeof genId === 'function') ? genId() : 'R-' + Date.now() + '-' + idx;
      const totalAmount = Number(it.amount) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      const newRow = {
        _id: id_,
        '담당자': '',
        'PJ NO': pjNo,
        '수주일': today,
        '고객사': q.customer,
        '제품군': it.category || '모듈',
        '제조사': it.mfr || '',
        '매입NO': '',
        '모델명': it.model || '',
        '제품용량(W)': it.watt || '',
        '수량': it.qty || 0,
        '수주용량(kW)': ((Number(it.qty)||0) * (Number(it.watt)||0) / 1000).toFixed(0),
        '제품단가(원)': it.unitPrice || 0,
        '수주총액(원)': totalAmount,
        '총금액(VAT포함)': Math.round(totalAmount * 1.1),
        '매입사': '', '매입단가': '', '매입총액(원)': '',
        '영업이익(원)': '', '영업이익률(%)': '',
        '출고요청일': q.validUntil || '',
        '납품일': '',
        '허가증': '', 'FD성적서': '', '인증서': '', '사용전검사일정': '',
        '발전소명': q.plantName,
        '납품주소': q.address,
        '인수담당자': q.contact,
        '비고': '견적서 ' + q.no + ' 변환' + (q.notes ? ' / ' + q.notes : ''),
        '수금조건': ''
      };
      rawData.push(newRow);
      newRows.push(newRow);
    });

    // 저장 + 견적서 상태 업데이트
    try {
      localStorage.setItem('erp_raw', JSON.stringify(rawData));
    } catch (e) {
      // 롤백 — 추가한 row 제거
      newRows.forEach(r => {
        const idx = rawData.indexOf(r);
        if (idx >= 0) rawData.splice(idx, 1);
      });
      throw new Error('수주 데이터 저장 실패: ' + (e.message || ''));
    }
    update(id, { status: '수주변환', convertedToPjNo: newRows.map(r => r['PJ NO']).join(', ') });

    // 화면 갱신
    if (typeof renderOrders === 'function') try { renderOrders(); } catch(e) {}
    if (typeof renderDashboard === 'function') try { renderDashboard(); } catch(e) {}
    if (typeof setBanner === 'function')
      setBanner('ok', `✅ 견적서 ${q.no} → 수주 ${newRows.length}건 자동 등록 (PJ: ${newRows.map(r=>r['PJ NO']).join(', ')})`);
    return newRows;
  }

  // ── 만료 자동 처리 (D-day 지났는데 승인/발송 상태인 경우) ─
  function autoExpire() {
    const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    let expired = 0;
    quotations.forEach(q => {
      if ((q.status === '작성' || q.status === '발송') &&
          q.validUntil && q.validUntil < today) {
        q.status = '만료';
        q._ts = Date.now();
        expired++;
      }
    });
    if (expired > 0) save();
    return expired;
  }

  // ── 통계 요약 ────────────────────────────────────
  function summary() {
    autoExpire();   // 통계 보기 전 만료 자동 처리
    const byStatus = {};
    let totalAmount = 0, approvedAmount = 0, convertedAmount = 0;
    const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    let expiringSoon = 0;
    quotations.forEach(q => {
      byStatus[q.status] = (byStatus[q.status]||0) + 1;
      totalAmount += q.total || 0;
      if (q.status === '승인') approvedAmount += q.total || 0;
      if (q.status === '수주변환') convertedAmount += q.total || 0;
      // D-3 이하 만료 임박
      if ((q.status === '발송' || q.status === '승인') && q.validUntil) {
        const days = (typeof daysUntil === 'function') ? daysUntil(q.validUntil) : null;
        if (days !== null && days >= 0 && days <= 3) expiringSoon++;
      }
    });
    return { total: quotations.length, byStatus, totalAmount, approvedAmount, convertedAmount, expiringSoon };
  }

  // ── 헬퍼 ─────────────────────────────────────────
  function _addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0,10);
  }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _e(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }
  function _ea(v) {
    return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,'');
  }

  // ── UI ───────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-qt-modal')) return;
    const css = `
      #erp-qt-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:3vh;}
      #erp-qt-modal.open{display:flex;}
      .qt-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:96%;max-width:1200px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}
      .qt-hd{padding:14px 18px;background:#7b1fa2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .qt-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .qt-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .qt-tab{padding:8px 16px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.86em;}
      .qt-tab.active{background:#7b1fa2;color:#fff;border-color:#7b1fa2;font-weight:700;}
      .qt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .qt-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .qt-stat-l{font-size:0.74em;color:#666;text-transform:uppercase;font-weight:700;}
      .qt-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .qt-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .qt-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .qt-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .qt-tbl tr:hover{background:#f9f9ff;}
      .qt-status{padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;}
      .qt-s-작성{background:#e3f2fd;color:#1565c0;}
      .qt-s-발송{background:#fff3e0;color:#e65100;}
      .qt-s-승인{background:#e8f5e9;color:#27ae60;}
      .qt-s-거절{background:#ffebee;color:#c62828;}
      .qt-s-만료{background:#f5f5f5;color:#888;}
      .qt-s-수주변환{background:#f3e5f5;color:#7b1fa2;font-weight:800;}
      .qt-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#fff;padding:16px;border-radius:8px;}
      .qt-form-full{grid-column:span 2;}
      .qt-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:4px;}
      .qt-form input, .qt-form textarea, .qt-form select{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}
      .qt-items{margin-top:10px;}
      .qt-items table{width:100%;border-collapse:collapse;font-size:0.84em;}
      .qt-items th, .qt-items td{padding:6px 8px;border:1px solid #e0e0e0;}
      .qt-items input{width:100%;border:none;background:transparent;padding:2px 4px;font-size:0.88em;}
      .qt-items input:focus{background:#fffde7;outline:1px solid #f9a825;}
      .qt-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .qt-btn-primary{background:#7b1fa2;color:#fff;}
      .qt-btn-success{background:#27ae60;color:#fff;}
      .qt-btn-warn{background:#e65100;color:#fff;}
      .qt-btn-danger{background:#c62828;color:#fff;}
      .qt-btn-ghost{background:#fff;color:#555;border:1px solid #ccc;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-qt-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-qt-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="qt-box">
        <div class="qt-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">견적서 관리</h4>
        </div>
        <div class="qt-bd" id="qt-bd"></div>
      </div>`;
    document.body.appendChild(modal);

    // ★ 위임 핸들러 — modal 과 box 모두에 부착 (탭 마운트 시 box 가 분리됨)
    modal.addEventListener('click', _onModalClick);
    const box = modal.querySelector('.qt-box');
    if (box) box.addEventListener('click', _onModalClick);
  }

  function _renderList() {
    const s = summary();
    const _erp = (typeof erpAuth !== 'undefined' && erpAuth.effective)
      ? erpAuth.effective(erpAuth.getRole()) : { hideFinance: false };
    const hideFin = !!_erp.hideFinance;
    const fmtMoney = v => hideFin ? '***' : (_fmt(v) + '원');

    const html = `
      <div class="qt-stats">
        <div class="qt-stat"><div class="qt-stat-l">총 견적</div><div class="qt-stat-v">${s.total}건</div></div>
        <div class="qt-stat"><div class="qt-stat-l">작성</div><div class="qt-stat-v">${s.byStatus['작성']||0}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">발송</div><div class="qt-stat-v" style="color:#e65100;">${s.byStatus['발송']||0}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">승인</div><div class="qt-stat-v" style="color:#27ae60;">${s.byStatus['승인']||0}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">수주변환</div><div class="qt-stat-v" style="color:#7b1fa2;">${s.byStatus['수주변환']||0}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">만료 임박 (D-3)</div><div class="qt-stat-v" style="color:#c62828;">${s.expiringSoon}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">승인 금액</div><div class="qt-stat-v">${fmtMoney(s.approvedAmount)}</div></div>
        <div class="qt-stat"><div class="qt-stat-l">변환 금액</div><div class="qt-stat-v" style="color:#7b1fa2;">${fmtMoney(s.convertedAmount)}</div></div>
      </div>
      <div style="margin-bottom:8px;">
        <button class="qt-btn qt-btn-primary" data-act="qt-new">새 견적서 작성</button>
      </div>
      <table class="qt-tbl">
        <thead><tr>
          <th>견적번호</th><th>작성일</th><th>유효기간</th><th>고객사</th><th>발전소</th><th>품목수</th>
          <th style="text-align:right;">금액</th><th>상태</th><th>액션</th>
        </tr></thead>
        <tbody>
          ${quotations.length === 0
            ? '<tr><td colspan="9" style="padding:30px;text-align:center;color:#bbb;">등록된 견적서 없음</td></tr>'
            : quotations.slice().reverse().map(q => `
              <tr>
                <td style="font-weight:700;color:#7b1fa2;">${_e(q.no)}</td>
                <td>${_e(q.date)}</td>
                <td>${_e(q.validUntil||'-')}</td>
                <td>${_e(q.customer)}</td>
                <td style="font-size:0.86em;">${_e(q.plantName||'-')}</td>
                <td style="text-align:center;">${q.items.length}</td>
                <td style="text-align:right;font-weight:700;">${fmtMoney(q.total)}</td>
                <td><span class="qt-status qt-s-${q.status}">${_e(q.status)}</span>${q.convertedToPjNo?`<br><span style="font-size:0.74em;color:#7b1fa2;">→ ${_e(q.convertedToPjNo)}</span>`:''}</td>
                <td>
                  <button class="qt-btn qt-btn-ghost" data-act="qt-view" data-id="${_ea(q.id)}" title="보기/편집">📝</button>
                  ${q.status === '작성' ? `<button class="qt-btn qt-btn-warn" data-act="qt-send" data-id="${_ea(q.id)}" title="발송 처리">📨</button>` : ''}
                  ${q.status === '발송' ? `<button class="qt-btn qt-btn-success" data-act="qt-approve" data-id="${_ea(q.id)}" title="승인">✓</button>` : ''}
                  ${(q.status === '승인' || (q.status === '수주변환' && !q.convertedToPjNo)) ? `<button class="qt-btn qt-btn-primary" data-act="qt-convert" data-id="${_ea(q.id)}" title="수주로 변환">🔄</button>` : ''}
                  ${q.status !== '수주변환' ? `<button class="qt-btn qt-btn-danger" data-act="qt-delete" data-id="${_ea(q.id)}" title="삭제">🗑</button>` : ''}
                </td>
              </tr>`).join('')}
        </tbody>
      </table>`;
    document.getElementById('qt-bd').innerHTML = html;
  }

  function _renderEditor(id) {
    const q = id ? get(id) : {
      id: null, no: _genNo(), date: (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10)),
      validUntil: _addDays(new Date(), 30), customer: '', plantName: '', address: '', contact: '',
      items: [{ model: '', mfr: '', watt: 0, qty: 0, unitPrice: 0, amount: 0 }],
      subtotal: 0, vat: 0, total: 0, status: '작성', notes: ''
    };
    const isReadonly = q.status === '수주변환' || q.status === '만료';

    const itemsRows = (q.items || []).map((it, i) => `
      <tr data-row="${i}">
        <td><input data-field="model" value="${_ea(it.model)}" ${isReadonly?'readonly':''}></td>
        <td><input data-field="mfr" value="${_ea(it.mfr)}" ${isReadonly?'readonly':''}></td>
        <td style="width:80px;"><input data-field="watt" type="number" value="${it.watt||0}" ${isReadonly?'readonly':''}></td>
        <td style="width:80px;"><input data-field="qty" type="number" value="${it.qty||0}" ${isReadonly?'readonly':''}></td>
        <td style="width:120px;"><input data-field="unitPrice" type="number" value="${it.unitPrice||0}" ${isReadonly?'readonly':''}></td>
        <td style="width:130px;text-align:right;font-weight:700;" data-cell="amount">${_fmt((Number(it.qty)||0)*(Number(it.unitPrice)||0))}</td>
        <td style="width:30px;text-align:center;">${isReadonly?'':`<button class="qt-btn qt-btn-danger" data-act="qt-row-del" data-row="${i}" style="padding:2px 6px;">×</button>`}</td>
      </tr>`).join('');

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#7b1fa2;">${id ? '견적서 편집' : '새 견적서'} · ${_e(q.no)}</h3>
        <div>
          <button class="qt-btn qt-btn-ghost" data-act="qt-back">← 목록</button>
          ${isReadonly ? `<span style="margin-left:10px;color:#888;font-size:0.86em;">📖 ${q.status} 상태 — 읽기 전용</span>` : `
            <button class="qt-btn qt-btn-primary" data-act="qt-save" data-id="${_ea(q.id||'')}">💾 저장</button>
            <button class="qt-btn qt-btn-success" data-act="qt-print" data-id="${_ea(q.id||'')}">🖨 인쇄</button>
          `}
        </div>
      </div>
      <div class="qt-form" id="qt-form" data-id="${_ea(q.id||'')}">
        <div><label>견적번호</label><input data-field="no" value="${_ea(q.no)}" ${isReadonly?'readonly':''}></div>
        <div><label>작성일</label><input data-field="date" type="date" value="${_ea(q.date)}" ${isReadonly?'readonly':''}></div>
        <div><label>유효기간 (만료일)</label><input data-field="validUntil" type="date" value="${_ea(q.validUntil)}" ${isReadonly?'readonly':''}></div>
        <div><label>상태</label><select data-field="status" ${isReadonly?'disabled':''}>
          ${['작성','발송','승인','거절','만료','수주변환'].map(s => `<option value="${s}" ${s===q.status?'selected':''}>${s}</option>`).join('')}
        </select></div>
        <div class="qt-form-full"><label>고객사</label><input data-field="customer" value="${_ea(q.customer)}" ${isReadonly?'readonly':''}></div>
        <div><label>발전소명</label><input data-field="plantName" value="${_ea(q.plantName)}" ${isReadonly?'readonly':''}></div>
        <div><label>인수담당자</label><input data-field="contact" value="${_ea(q.contact)}" ${isReadonly?'readonly':''}></div>
        <div class="qt-form-full"><label>납품주소</label><input data-field="address" value="${_ea(q.address)}" ${isReadonly?'readonly':''}></div>
        <div class="qt-form-full"><label>비고</label><textarea data-field="notes" rows="2" ${isReadonly?'readonly':''}>${_e(q.notes)}</textarea></div>
      </div>
      <div class="qt-items">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 6px;">
          <strong style="color:#1a1a2e;">📋 견적 품목</strong>
          ${isReadonly?'':`<button class="qt-btn qt-btn-ghost" data-act="qt-row-add">+ 품목 추가</button>`}
        </div>
        <table id="qt-items-tbl">
          <thead><tr>
            <th>모델명</th><th>제조사</th><th>Wp</th><th>수량</th><th>단가(원)</th><th>금액</th><th></th>
          </tr></thead>
          <tbody>${itemsRows}</tbody>
        </table>
        <div style="margin-top:10px;text-align:right;font-size:0.92em;">
          <div>공급가액: <strong id="qt-sum-subtotal">${_fmt(q.subtotal)}</strong>원</div>
          <div>부가세(10%): <strong id="qt-sum-vat">${_fmt(q.vat)}</strong>원</div>
          <div style="font-size:1.2em;color:#7b1fa2;font-weight:900;margin-top:4px;">합계: <strong id="qt-sum-total">${_fmt(q.total)}</strong>원</div>
        </div>
      </div>`;
    document.getElementById('qt-bd').innerHTML = html;
    if (!isReadonly) _bindEditor();
  }

  function _bindEditor() {
    const tbl = document.getElementById('qt-items-tbl');
    if (!tbl) return;
    // 항목 입력 시 금액·합계 실시간 갱신
    tbl.addEventListener('input', e => {
      const row = e.target.closest('tr[data-row]');
      if (!row) return;
      const qty = Number(row.querySelector('[data-field="qty"]').value)||0;
      const price = Number(row.querySelector('[data-field="unitPrice"]').value)||0;
      const amount = qty * price;
      row.querySelector('[data-cell="amount"]').textContent = _fmt(amount);
      _recalcSum();
    });
  }

  function _recalcSum() {
    const tbl = document.getElementById('qt-items-tbl');
    if (!tbl) return;
    let subtotal = 0;
    tbl.querySelectorAll('tr[data-row]').forEach(row => {
      const qty = Number(row.querySelector('[data-field="qty"]').value)||0;
      const price = Number(row.querySelector('[data-field="unitPrice"]').value)||0;
      subtotal += qty * price;
    });
    const vat = Math.round(subtotal * 0.1);
    document.getElementById('qt-sum-subtotal').textContent = _fmt(subtotal);
    document.getElementById('qt-sum-vat').textContent = _fmt(vat);
    document.getElementById('qt-sum-total').textContent = _fmt(subtotal + vat);
  }

  function _collectForm() {
    const form = document.getElementById('qt-form');
    const data = {};
    form.querySelectorAll('[data-field]').forEach(el => {
      data[el.getAttribute('data-field')] = el.value;
    });
    const items = [];
    document.querySelectorAll('#qt-items-tbl tr[data-row]').forEach(row => {
      const it = {};
      row.querySelectorAll('[data-field]').forEach(el => {
        const k = el.getAttribute('data-field');
        const v = el.value;
        it[k] = (k === 'watt' || k === 'qty' || k === 'unitPrice') ? Number(v)||0 : v;
      });
      it.amount = (it.qty||0) * (it.unitPrice||0);
      if (it.model || it.qty) items.push(it);
    });
    data.items = items;
    data.subtotal = items.reduce((s,it) => s + (it.amount||0), 0);
    data.vat = Math.round(data.subtotal * 0.1);
    data.total = data.subtotal + data.vat;
    return data;
  }

  function _saveFromForm(id) {
    const data = _collectForm();
    if (!data.customer) { alert('고객사 입력 필요'); return; }
    if (!data.items.length) { alert('견적 품목 1개 이상 필요'); return; }
    if (id) {
      update(id, data);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 견적서 ${data.no} 수정 완료`);
    } else {
      const q = add(data);
      if (typeof setBanner === 'function') setBanner('ok', `✅ 견적서 ${q.no} 작성 완료`);
    }
    _renderList();
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    const rowIdx = btn.getAttribute('data-row');

    if (act === 'qt-new') _renderEditor(null);
    else if (act === 'qt-back') _renderList();
    else if (act === 'qt-view') _renderEditor(id);
    else if (act === 'qt-save') _saveFromForm(id || null);
    else if (act === 'qt-send') {
      send(id);
      if (typeof setBanner === 'function') setBanner('ok', '📨 발송 처리됨');
      _renderList();
    }
    else if (act === 'qt-approve') {
      approve(id);
      if (typeof setBanner === 'function') setBanner('ok', '✅ 승인됨');
      _renderList();
    }
    else if (act === 'qt-convert') {
      try {
        const rows = convertToOrder(id);
        if (rows) _renderList();
      } catch (err) { alert('변환 실패: ' + err.message); }
    }
    else if (act === 'qt-delete') {
      if (!confirm('견적서를 삭제하시겠습니까?')) return;
      remove(id);
      _renderList();
    }
    else if (act === 'qt-row-add') {
      const tbody = document.querySelector('#qt-items-tbl tbody');
      const idx = tbody.querySelectorAll('tr').length;
      const tr = document.createElement('tr');
      tr.setAttribute('data-row', idx);
      tr.innerHTML = `
        <td><input data-field="model" value=""></td>
        <td><input data-field="mfr" value=""></td>
        <td style="width:80px;"><input data-field="watt" type="number" value="0"></td>
        <td style="width:80px;"><input data-field="qty" type="number" value="0"></td>
        <td style="width:120px;"><input data-field="unitPrice" type="number" value="0"></td>
        <td style="width:130px;text-align:right;font-weight:700;" data-cell="amount">0</td>
        <td style="width:30px;text-align:center;"><button class="qt-btn qt-btn-danger" data-act="qt-row-del" data-row="${idx}" style="padding:2px 6px;">×</button></td>`;
      tbody.appendChild(tr);
    }
    else if (act === 'qt-row-del') {
      const tr = btn.closest('tr');
      tr.remove();
      _recalcSum();
    }
    else if (act === 'qt-print') {
      const data = _collectForm();
      _printQuotation(data);
    }
  }

  // ── 인쇄 ─────────────────────────────────────────
  function _printQuotation(q) {
    const win = window.open('', '_blank');
    if (!win) { alert('팝업 차단됨'); return; }
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>견적서 ${q.no}</title>
<style>
  body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;margin:30px;color:#1a1a2e;}
  h1{text-align:center;margin:0 0 20px;letter-spacing:8px;border-bottom:3px double #333;padding-bottom:10px;}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:0.9em;}
  .info div{padding:6px 10px;border-bottom:1px solid #eee;}
  table{width:100%;border-collapse:collapse;margin:14px 0;font-size:0.86em;}
  th, td{border:1px solid #555;padding:6px 10px;text-align:left;}
  th{background:#f0f0f0;font-weight:700;}
  td.r{text-align:right;}
  .total{font-size:1.2em;font-weight:900;background:#fffde7;}
  .footer{margin-top:30px;font-size:0.84em;color:#666;text-align:center;border-top:1px solid #ddd;padding-top:12px;}
</style></head><body>
<h1>견 적 서</h1>
<div class="info">
  <div><strong>견적번호:</strong> ${_e(q.no)}</div>
  <div><strong>작성일:</strong> ${_e(q.date)}</div>
  <div><strong>고객사:</strong> ${_e(q.customer)}</div>
  <div><strong>유효기간:</strong> ${_e(q.validUntil)}</div>
  <div><strong>발전소명:</strong> ${_e(q.plantName||'-')}</div>
  <div><strong>인수담당자:</strong> ${_e(q.contact||'-')}</div>
  <div style="grid-column:span 2;"><strong>납품주소:</strong> ${_e(q.address||'-')}</div>
</div>
<table>
  <thead><tr><th>NO</th><th>모델명</th><th>제조사</th><th>Wp</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
  <tbody>
    ${(q.items||[]).map((it,i) => `<tr>
      <td>${i+1}</td>
      <td>${_e(it.model)}</td>
      <td>${_e(it.mfr)}</td>
      <td class="r">${it.watt||0}</td>
      <td class="r">${_fmt(it.qty)}</td>
      <td class="r">${_fmt(it.unitPrice)}</td>
      <td class="r">${_fmt((it.qty||0)*(it.unitPrice||0))}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot>
    <tr><th colspan="6" class="r">공급가액</th><th class="r">${_fmt(q.subtotal)}</th></tr>
    <tr><th colspan="6" class="r">부가세 (10%)</th><th class="r">${_fmt(q.vat)}</th></tr>
    <tr class="total"><th colspan="6" class="r">합계</th><th class="r">${_fmt(q.total)}</th></tr>
  </tfoot>
</table>
${q.notes ? `<div style="background:#fffde7;padding:10px;border-left:4px solid #f9a825;font-size:0.9em;">📝 ${_e(q.notes)}</div>` : ''}
<div class="footer">본 견적서는 ${_e(q.validUntil)}까지 유효합니다.</div>
<script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
</body></html>`;
    win.document.write(html);
    win.document.close();
  }

  function open() {
    _injectUI();
    autoExpire();
    // ★ 영업 탭(salesops)의 견적서관리 서브탭으로 이동됨 (2026-05-12)
    if (typeof window.setSalesOpsSubtab === 'function'
        && document.getElementById('quotationTabHost')) {
      if (typeof showTab === 'function') {
        try { showTab('salesops'); } catch(e) {}
      }
      setTimeout(() => window.setSalesOpsSubtab('quote'), 30);
      return;
    }
    document.getElementById('erp-qt-modal').classList.add('open');
    setTimeout(_renderList, 30);
  }
  function close() { document.getElementById('erp-qt-modal')?.classList.remove('open'); }

  // ── 탭 마운트 (영업 탭의 quotationTabHost 로 box 이동) ──
  function _mountToTab() {
    const host = document.getElementById('quotationTabHost');
    if (!host) return;
    let modal = document.getElementById('erp-qt-modal');
    if (!modal) { try { _injectUI(); } catch(e){ console.error('[quotation] _injectUI 실패:', e); return; } modal = document.getElementById('erp-qt-modal'); if (!modal) return; }
    const box = modal.querySelector('.qt-box');
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
    autoExpire();
    setTimeout(_renderList, 30);
  }

  // ── 공개 API ─────────────────────────────────────
  window.quotation = {
    list, get, add, update, remove,
    send, approve, reject, expire, convertToOrder,
    summary, autoExpire,
    open, close, reload: load,
    _mountToTab
  };

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    load();
    autoExpire();
    setTimeout(_injectUI, 800);
    // 도구함에 등록 (toolbar.js 가 있다면)
    setTimeout(() => {
      if (typeof window.erpToolbar !== 'undefined' && window.erpToolbar.tools) {
        const tools = window.erpToolbar.tools();
        if (!tools.some(t => t.id === 'erp-qt-fab')) {
          // toolbar 의 TOOLS 는 read-only 이므로 직접 수정 불가 — 콘솔 안내만
          console.log('[ERP-QT] erpToolbar 통합 — quotation.open() 으로 사용');
        }
      }
    }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-QT] 견적서 모듈 활성 — quotation.open()');
})();
