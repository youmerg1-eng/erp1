// =====================================================
//  CUSTOMER MASTER + CREDIT LIMIT — Phase B · Week 7
//
//  목적
//   - 고객사별 신용한도·연락처·결제조건 마스터화
//   - 수주 등록 시 "기존 미수금 + 신규 수주액 > 신용한도" 자동 차단
//   - 표기 불일치(("주)솔라텍" vs "솔라텍") 정규화 도움말
//
//  데이터 키: erp_customer_master
//   { 고객사명: { creditLimit, paymentTerm, contactPerson, phone, bizNo, notes, riskLevel, createdAt } }
//
//  UI: 설정 탭 끝에 자동 inject (기존 settings 코드 수정 X)
//
//  콘솔
//    customerMaster.list()             전체 보기
//    customerMaster.get('(주)솔라텍')   단일 조회
//    customerMaster.set('X사', { creditLimit:50000000, paymentTerm:'계약금 30%' })
//    customerMaster.outstanding('X사') 미수금 즉시 계산
//    customerMaster.recompute()        모든 고객 미수금 재계산
// =====================================================
(function() {
  'use strict';

  const CM_KEY = 'erp_customer_master';
  let cmData = {};
  try { cmData = JSON.parse(localStorage.getItem(CM_KEY) || '{}'); }
  catch(e) { cmData = {}; }

  function _save() {
    try { localStorage.setItem(CM_KEY, JSON.stringify(cmData)); } catch(e) {}
  }

  // ── 정규화 (표기 통일용) ────────────────────────────
  function _norm(s) {
    return String(s||'').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s+/g,'').toLowerCase();
  }

  // 같은 정규화 결과를 가진 고객사 목록
  function _findVariants(customer) {
    if (typeof rawData === 'undefined') return [];
    const target = _norm(customer);
    const all = [...new Set(rawData.map(r => String(r['고객사']||'').trim()).filter(Boolean))];
    return all.filter(x => _norm(x) === target);
  }

  // ── 미수금 계산 ─────────────────────────────────────
  function _outstanding(customer) {
    if (typeof getEnriched !== 'function') return 0;
    const variants = _findVariants(customer);
    let outstanding = 0;
    let totalSum = 0;
    let totalCollected = 0;
    let openOrders = 0;
    getEnriched().forEach(o => {
      if (variants.indexOf(o.고객사) < 0) return;
      if (o.status === '취소') return;
      const t = o.수주총액 || 0;
      const c = (o.계약금입금 ? (o.계약금||0) : 0)
              + (o.중도금1입금 ? (o.중도금1||0) : 0)
              + (o.중도금2입금 ? (o.중도금2||0) : 0)
              + (o.중도금3입금 ? (o.중도금3||0) : 0)
              + (o.잔금입금 ? (o.잔금||0) : 0);
      totalSum += t;
      totalCollected += c;
      if (t > c) openOrders++;
    });
    outstanding = Math.max(0, totalSum - totalCollected);
    return { outstanding, totalSum, totalCollected, openOrders, variants };
  }

  // ── 공개 API ────────────────────────────────────────
  window.customerMaster = {
    list: function() {
      const rows = Object.entries(cmData).map(([name, v]) => {
        const o = _outstanding(name);
        const limit = v.creditLimit || 0;
        const usage = limit > 0 ? Math.round(o.outstanding / limit * 100) : null;
        return {
          name,
          creditLimit: limit ? limit.toLocaleString() : '-',
          outstanding: o.outstanding.toLocaleString(),
          usagePct: usage != null ? usage + '%' : '-',
          openOrders: o.openOrders,
          riskLevel: v.riskLevel || '-'
        };
      });
      console.table(rows);
      return rows.length;
    },
    get: function(name) {
      return cmData[name] || null;
    },
    set: function(name, patch) {
      if (!name) throw new Error('고객사명 필요');
      if (!cmData[name]) cmData[name] = { createdAt: new Date().toISOString() };
      cmData[name] = { ...cmData[name], ...patch };
      _save();
      _renderTable();
      return cmData[name];
    },
    delete: function(name) {
      if (!confirm(`"${name}" 마스터 삭제?`)) return false;
      delete cmData[name];
      _save();
      _renderTable();
      return true;
    },
    outstanding: function(name) {
      const r = _outstanding(name);
      console.log(`[${name}] 미수금 ${r.outstanding.toLocaleString()}원 / 총수주 ${r.totalSum.toLocaleString()}원 / 회수 ${r.totalCollected.toLocaleString()}원 · 진행 ${r.openOrders}건 · 표기 ${r.variants.length}종`);
      return r;
    },
    recompute: function() {
      _renderTable();
      console.log('✅ 미수금 재계산 완료');
    },
    raw: () => ({ ...cmData })
  };

  // ── 신용한도 검증 룰 (validation에 등록) ────────────
  function _registerCreditRule() {
    if (typeof validationRules === 'undefined' || !validationRules.register) {
      // validation 모듈 로드 늦으면 retry
      setTimeout(_registerCreditRule, 500);
      return;
    }
    validationRules.register({
      id: 'R31', label: '고객사 신용한도 초과', level: 'WARN', target: 'order',
      fn: (o) => {
        const c = String(o['고객사']||'').trim();
        if (!c) return null;
        const master = cmData[c];
        if (!master || !master.creditLimit || master.creditLimit <= 0) return null;
        const ar = _outstanding(c).outstanding;
        const newOrder = Number(String(o['수주총액(원)']||'').replace(/,/g,'')) || 0;
        const projected = ar + newOrder;
        if (projected > master.creditLimit) {
          return `신용한도 초과: ${c} (현재 미수 ${ar.toLocaleString()} + 신규 ${newOrder.toLocaleString()} = ${projected.toLocaleString()} > 한도 ${master.creditLimit.toLocaleString()})`;
        }
        return null;
      }
    });
    validationRules.register({
      id: 'R32', label: '고위험 고객사 (manual flag)', level: 'INFO', target: 'order',
      fn: (o) => {
        const c = String(o['고객사']||'').trim();
        if (!c) return null;
        const m = cmData[c];
        if (!m || !m.riskLevel || m.riskLevel === 'normal') return null;
        return `고객사 위험등급: ${m.riskLevel} (${m.notes || ''})`;
      }
    });
    console.log('[ERP-CM] 신용한도 룰 R31·R32 등록');
  }

  // ── 설정 탭에 표 inject ─────────────────────────────
  function _injectIntoSettings() {
    // ★ 2026-05-13 권한관리 섹션(set-section-perm)에만 표시되도록 수정
    //   먼저 perm 섹션을 찾고, 없으면 tab-settings 에 append (대기 후 이동됨)
    const permSection = document.getElementById('set-section-perm');
    const tab = document.getElementById('tab-settings');
    const host = permSection || tab;
    if (!host) return;
    if (document.getElementById('cm-section')) return;  // 이미 있음

    const section = document.createElement('div');
    section.id = 'cm-section';
    section.style.cssText = 'margin-top:24px;padding:18px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;';
    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:1.05em;color:#1a1a2e;">🏢 고객사 마스터 + 신용한도</h3>
        <div>
          <button class="btn btn-xs btn-blue" onclick="_cmAutoExtract()" title="수주현황의 모든 고객사를 마스터에 자동 등록">📥 수주에서 추출</button>
          <button class="btn btn-xs btn-dark" onclick="_cmShowAddForm()">➕ 추가</button>
        </div>
      </div>
      <div id="cm-add-form" style="display:none;margin-bottom:14px;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <input type="text"   id="cm-name"        placeholder="고객사명*" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
          <input type="number" id="cm-limit"       placeholder="신용한도(원)" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
          <input type="text"   id="cm-payterm"     placeholder="결제조건 (예: 계약금 30%)" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
          <select id="cm-risk" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
            <option value="normal">정상</option>
            <option value="watch">관찰</option>
            <option value="high">고위험</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px;margin-bottom:8px;">
          <input type="text" id="cm-contact" placeholder="담당자명" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
          <input type="text" id="cm-phone"   placeholder="연락처" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
          <input type="text" id="cm-bizno"   placeholder="사업자번호 (선택)" style="padding:8px;border:1px solid #ddd;border-radius:6px;">
        </div>
        <input type="text" id="cm-notes" placeholder="비고" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;margin-bottom:8px;box-sizing:border-box;">
        <button class="btn btn-sm btn-green" onclick="_cmSubmitAdd()">💾 저장</button>
        <button class="btn btn-sm btn-gray" onclick="document.getElementById('cm-add-form').style.display='none'">취소</button>
      </div>
      <div id="cm-table-wrap"></div>
      <div style="margin-top:8px;font-size:0.78em;color:#888;">
        💡 신용한도 설정 시 — 수주 등록 단계에서 <strong>"미수금 + 신규 수주액 &gt; 한도"</strong> 인 경우 확인 다이얼로그가 뜹니다.
      </div>`;
    host.appendChild(section);

    // 전역 헬퍼 (HTML onclick에서 호출)
    window._cmShowAddForm = function() {
      const f = document.getElementById('cm-add-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
      ['cm-name','cm-limit','cm-payterm','cm-contact','cm-phone','cm-bizno','cm-notes']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
    };
    window._cmSubmitAdd = function() {
      const name = document.getElementById('cm-name').value.trim();
      if (!name) { alert('고객사명 필수'); return; }
      const patch = {
        creditLimit:   parseInt(document.getElementById('cm-limit').value) || 0,
        paymentTerm:   document.getElementById('cm-payterm').value.trim(),
        riskLevel:     document.getElementById('cm-risk').value,
        contactPerson: document.getElementById('cm-contact').value.trim(),
        phone:         document.getElementById('cm-phone').value.trim(),
        bizNo:         document.getElementById('cm-bizno').value.trim(),
        notes:         document.getElementById('cm-notes').value.trim()
      };
      customerMaster.set(name, patch);
      document.getElementById('cm-add-form').style.display = 'none';
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${name} 마스터 저장`);
    };
    window._cmEdit = function(name) {
      const m = cmData[name];
      if (!m) return;
      window._cmShowAddForm();
      document.getElementById('cm-name').value    = name;
      document.getElementById('cm-limit').value   = m.creditLimit || '';
      document.getElementById('cm-payterm').value = m.paymentTerm || '';
      document.getElementById('cm-risk').value    = m.riskLevel || 'normal';
      document.getElementById('cm-contact').value = m.contactPerson || '';
      document.getElementById('cm-phone').value   = m.phone || '';
      document.getElementById('cm-bizno').value   = m.bizNo || '';
      document.getElementById('cm-notes').value   = m.notes || '';
    };
    window._cmDelete = function(name) {
      customerMaster.delete(name);
    };
    window._cmAutoExtract = function() {
      if (typeof rawData === 'undefined') return;
      const names = [...new Set(rawData.map(r => String(r['고객사']||'').trim()).filter(Boolean))];
      let added = 0;
      names.forEach(n => {
        if (!cmData[n]) { cmData[n] = { createdAt: new Date().toISOString(), riskLevel:'normal' }; added++; }
      });
      _save();
      _renderTable();
      if (typeof setBanner === 'function')
        setBanner('ok', `✅ 수주에서 ${added}건 신규 추출 (전체 ${names.length}건)`);
    };

    _renderTable();
  }

  function _renderTable() {
    const wrap = document.getElementById('cm-table-wrap');
    if (!wrap) return;
    const entries = Object.entries(cmData).sort((a,b) => a[0].localeCompare(b[0],'ko'));
    if (!entries.length) {
      wrap.innerHTML = '<div style="padding:30px;text-align:center;color:#bbb;font-size:0.86em;">등록된 고객사 마스터 없음 — "📥 수주에서 추출" 또는 "➕ 추가"</div>';
      return;
    }
    let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.86em;">
      <thead><tr style="background:#1a1a2e;color:white;">
        <th style="padding:8px;text-align:left;">고객사</th>
        <th style="padding:8px;text-align:right;">신용한도</th>
        <th style="padding:8px;text-align:right;">미수금</th>
        <th style="padding:8px;text-align:right;">사용률</th>
        <th style="padding:8px;text-align:center;">진행</th>
        <th style="padding:8px;text-align:center;">위험</th>
        <th style="padding:8px;text-align:left;">결제조건</th>
        <th style="padding:8px;text-align:left;">담당자</th>
        <th style="padding:8px;text-align:center;">표기변형</th>
        <th style="padding:8px;text-align:center;">작업</th>
      </tr></thead><tbody>`;
    entries.forEach(([name, v]) => {
      const o = _outstanding(name);
      const limit = v.creditLimit || 0;
      const pct = limit > 0 ? o.outstanding / limit * 100 : null;
      const pctColor = pct == null ? '#999' : pct >= 100 ? '#c62828' : pct >= 80 ? '#e65100' : pct >= 50 ? '#f9a825' : '#27ae60';
      const riskTag = v.riskLevel === 'high' ? '<span style="background:#ffebee;color:#c62828;padding:2px 6px;border-radius:4px;font-size:0.78em;font-weight:700;">🚨 고위험</span>'
                    : v.riskLevel === 'watch' ? '<span style="background:#fff3e0;color:#e65100;padding:2px 6px;border-radius:4px;font-size:0.78em;font-weight:700;">👁 관찰</span>'
                    : '<span style="color:#888;font-size:0.78em;">정상</span>';
      const variantBadge = o.variants.length > 1
        ? `<span style="background:#fff3cd;color:#856404;padding:2px 6px;border-radius:4px;font-size:0.74em;cursor:help;" title="${o.variants.join(', ')}">⚠️ ${o.variants.length}종</span>`
        : '<span style="color:#bbb;">1</span>';
      html += `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px;font-weight:700;">${name}</td>
        <td style="padding:8px;text-align:right;">${limit ? limit.toLocaleString() : '-'}</td>
        <td style="padding:8px;text-align:right;color:${o.outstanding>0?'#e65100':'#888'};">${o.outstanding.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;color:${pctColor};font-weight:700;">${pct != null ? pct.toFixed(0)+'%' : '-'}</td>
        <td style="padding:8px;text-align:center;">${o.openOrders}</td>
        <td style="padding:8px;text-align:center;">${riskTag}</td>
        <td style="padding:8px;font-size:0.84em;">${v.paymentTerm || '-'}</td>
        <td style="padding:8px;font-size:0.84em;">${v.contactPerson || '-'}${v.phone ? ' ' + v.phone : ''}</td>
        <td style="padding:8px;text-align:center;">${variantBadge}</td>
        <td style="padding:8px;text-align:center;white-space:nowrap;">
          <button class="btn btn-xs btn-dark" onclick="_cmEdit('${name.replace(/'/g,"\\'")}')">✏️</button>
          <button class="btn btn-xs btn-red" onclick="_cmDelete('${name.replace(/'/g,"\\'")}')">🗑️</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  // ── showTab 후 inject (기존 함수 보강) ──────────────
  function _hookSettingsTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookSettingsTab, 300); return; }
    if (window.showTab.__cmHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (id === 'settings') {
        setTimeout(() => { _injectIntoSettings(); _renderTable(); }, 50);
      }
      return r;
    };
    window.showTab.__cmHooked = true;
  }

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _registerCreditRule();
    _hookSettingsTab();
    // 설정 탭이 이미 보이는 상태면 즉시 inject
    setTimeout(() => {
      const t = document.getElementById('tab-settings');
      if (t && t.classList.contains('active')) _injectIntoSettings();
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-CM] 고객사 마스터 모듈 로드 — 등록 ' + Object.keys(cmData).length + '건');
})();
