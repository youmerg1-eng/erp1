// =====================================================
//  VENDOR (매입사) MASTER + EVALUATION + CLAIM — Phase C · Week 12
//
//  데이터 키
//   erp_vendor_master  — 매입사 마스터
//   erp_claims         — 클레임/하자 이력
//
//  자동 평가 지표 (수주현황·SN·입출고에서 실시간 계산)
//   - 거래액 (총 매입금액)
//   - 거래건수
//   - 평균 단가
//   - 클레임 건수·비율
//   - 평균 납기 (LeadTime)
//   - 점수 (0~100)
//
//  설정 탭 끝에 "🏭 매입사 마스터" 섹션 자동 inject
//  콘솔: vendor.list() / vendor.set('진코',{...}) / vendor.score('진코')
//        claim.add({...}) / claim.list() / claim.byVendor('진코')
// =====================================================
(function() {
  'use strict';

  const VM_KEY = 'erp_vendor_master';
  const CL_KEY = 'erp_claims';

  let vmData = {};
  let claims = [];
  try { vmData = JSON.parse(localStorage.getItem(VM_KEY) || '{}'); } catch(e) { vmData = {}; }
  try { claims = JSON.parse(localStorage.getItem(CL_KEY) || '[]'); } catch(e) { claims = []; }

  function _saveV() { try { localStorage.setItem(VM_KEY, JSON.stringify(vmData)); } catch(e) {} }
  function _saveC() { try { localStorage.setItem(CL_KEY, JSON.stringify(claims.slice(-1000))); } catch(e) {} }

  // ── 매입사 통계 자동 계산 ──────────────────────────
  function _stats(vendorName) {
    const stats = {
      vendor: vendorName,
      orderCount: 0, totalPurchase: 0, totalQty: 0,
      avgUnitPrice: 0, models: new Set(),
      claimCount: 0, claimQty: 0, claimAmount: 0, claimRate: 0,
      onTimeCount: 0, lateCount: 0, onTimeRate: null,
      lastTransactionAt: null
    };
    if (typeof getEnriched !== 'function') return stats;
    try {
      getEnriched().forEach(o => {
        if ((o.매입사||'').trim() !== vendorName) return;
        stats.orderCount++;
        stats.totalPurchase += o.매입총액 || 0;
        stats.totalQty += o.수량 || 0;
        if (o.모델명) stats.models.add(o.모델명);
        if (o.수주일 && (!stats.lastTransactionAt || o.수주일 > stats.lastTransactionAt))
          stats.lastTransactionAt = o.수주일;
        // 납기 (납품일 vs 출고요청일)
        if (o.납품일 && o.출고요청일) {
          if (o.납품일 <= o.출고요청일) stats.onTimeCount++;
          else stats.lateCount++;
        }
      });
    } catch(e) {}

    if (stats.totalQty > 0) stats.avgUnitPrice = Math.round(stats.totalPurchase / stats.totalQty);
    stats.models = [...stats.models];
    const totalDeliv = stats.onTimeCount + stats.lateCount;
    if (totalDeliv > 0) stats.onTimeRate = stats.onTimeCount / totalDeliv;

    // 클레임
    claims.forEach(c => {
      if (c.vendor !== vendorName) return;
      stats.claimCount++;
      stats.claimQty += c.qty || 0;
      stats.claimAmount += c.claimAmount || 0;
    });
    if (stats.totalQty > 0) stats.claimRate = stats.claimQty / stats.totalQty;
    return stats;
  }

  // ── 점수 (0~100) ────────────────────────────────────
  function _score(s) {
    let score = 50;  // 기본
    if (s.onTimeRate != null) score += (s.onTimeRate - 0.7) * 50;   // 70% = 0, 100% = +15
    score -= s.claimRate * 200;                                      // 1% = -2점
    if (s.orderCount >= 10) score += 5;
    if (s.orderCount >= 30) score += 5;
    if (s.totalPurchase >= 100_000_000) score += 5;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── 공개 API ────────────────────────────────────────
  window.vendor = {
    list: function() {
      const all = _allVendorNames();
      const rows = all.map(v => {
        const s = _stats(v);
        const m = vmData[v] || {};
        return { vendor: v, score: _score(s), orderCount: s.orderCount,
          totalPurchase: s.totalPurchase.toLocaleString(),
          claimRate: (s.claimRate*100).toFixed(2)+'%',
          onTimeRate: s.onTimeRate != null ? (s.onTimeRate*100).toFixed(0)+'%' : '-',
          riskLevel: m.riskLevel || '-',
          contact: m.contactPerson || '-' };
      });
      console.table(rows);
      return rows.length;
    },
    get: (v) => ({ master: vmData[v] || null, stats: _stats(v), score: _score(_stats(v)) }),
    set: function(v, patch) {
      if (!v) throw new Error('매입사명 필수');
      if (!vmData[v]) vmData[v] = { createdAt: new Date().toISOString() };
      vmData[v] = { ...vmData[v], ...patch };
      _saveV(); _renderTable();
      return vmData[v];
    },
    delete: function(v) {
      if (!confirm(`"${v}" 매입사 마스터 삭제?`)) return false;
      delete vmData[v]; _saveV(); _renderTable(); return true;
    },
    stats: _stats,
    score: (v) => _score(_stats(v)),
    raw: () => ({ ...vmData })
  };

  // ── 클레임 API ──────────────────────────────────────
  window.claim = {
    add: function(c) {
      if (!c || !c.vendor) throw new Error('vendor 필수');
      const entry = {
        id: 'CL-' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
        when: new Date().toISOString(),
        vendor: c.vendor,
        pjNo: c.pjNo || null,
        sn: c.sn || null,
        model: c.model || '',
        qty: c.qty || 1,
        defectType: c.defectType || '',
        claimAmount: c.claimAmount || 0,
        status: c.status || 'open',
        notes: c.notes || ''
      };
      claims.push(entry);
      _saveC();
      // SN 모듈 연동: 해당 SN을 damaged로 표기
      if (entry.sn && typeof sn !== 'undefined' && sn.markDamaged) {
        sn.markDamaged(entry.sn, c.defectType);
      }
      if (typeof setBanner === 'function')
        setBanner('warn', `📋 클레임 등록: ${entry.vendor} · ${entry.id}`);
      _renderTable();
      return entry;
    },
    list: function(n) {
      const slice = claims.slice(-(n||30)).reverse();
      console.table(slice.map(c => ({
        id: c.id, when: c.when.replace('T',' ').slice(0,16),
        vendor: c.vendor, pjNo: c.pjNo, model: c.model,
        qty: c.qty, defect: c.defectType, status: c.status,
        amount: (c.claimAmount||0).toLocaleString()
      })));
      return slice.length;
    },
    byVendor: (v) => claims.filter(c => c.vendor === v),
    update: function(id, patch) {
      const i = claims.findIndex(x => x.id === id);
      if (i < 0) return false;
      claims[i] = { ...claims[i], ...patch, updatedAt: new Date().toISOString() };
      _saveC(); _renderTable();
      return claims[i];
    },
    raw: () => claims.slice()
  };

  function _allVendorNames() {
    const set = new Set();
    if (typeof rawData !== 'undefined') rawData.forEach(r => {
      const v = String(r['매입사']||'').trim();
      if (v) set.add(v);
    });
    Object.keys(vmData).forEach(v => set.add(v));
    claims.forEach(c => c.vendor && set.add(c.vendor));
    return [...set].sort();
  }

  // ── 설정 탭 inject ──────────────────────────────────
  function _injectIntoSettings() {
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    if (document.getElementById('vm-section')) return;

    const section = document.createElement('div');
    section.id = 'vm-section';
    section.style.cssText = 'margin-top:24px;padding:18px;background:#fff;border-radius:12px;border:1px solid #e5e5e5;';
    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:1.05em;color:#1a1a2e;">🏭 매입사 마스터 + 평가</h3>
        <div>
          <button class="btn btn-xs btn-blue" onclick="_vmAutoExtract()">📥 수주에서 추출</button>
          <button class="btn btn-xs btn-orange" onclick="_clmShowAddForm()">➕ 클레임 등록</button>
          <button class="btn btn-xs btn-dark" onclick="_vmShowAddForm()">➕ 매입사 추가</button>
        </div>
      </div>
      <div id="vm-add-form" style="display:none;margin-bottom:14px;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <input type="text" id="vm-name"        placeholder="매입사명*" class="vm-i">
          <input type="text" id="vm-contact"     placeholder="담당자" class="vm-i">
          <input type="text" id="vm-phone"       placeholder="연락처" class="vm-i">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <input type="email" id="vm-email"      placeholder="이메일" class="vm-i">
          <input type="text" id="vm-bizno"       placeholder="사업자번호" class="vm-i">
          <input type="text" id="vm-payterm"     placeholder="결제조건" class="vm-i">
          <select id="vm-risk" class="vm-i">
            <option value="normal">정상</option>
            <option value="watch">관찰</option>
            <option value="high">고위험</option>
            <option value="blacklist">거래중지</option>
          </select>
        </div>
        <input type="text" id="vm-notes" placeholder="비고" class="vm-i" style="width:100%;margin-bottom:8px;">
        <button class="btn btn-sm btn-green" onclick="_vmSubmitAdd()">💾 저장</button>
        <button class="btn btn-sm btn-gray" onclick="document.getElementById('vm-add-form').style.display='none'">취소</button>
      </div>
      <div id="clm-add-form" style="display:none;margin-bottom:14px;padding:14px;background:#fff3e0;border-radius:8px;">
        <h4 style="margin:0 0 10px;font-size:0.95em;color:#e65100;">📋 클레임 등록</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <input type="text" id="clm-vendor" placeholder="매입사*" class="vm-i">
          <input type="text" id="clm-pjno" placeholder="PJ NO (선택)" class="vm-i">
          <input type="text" id="clm-sn" placeholder="SN (선택)" class="vm-i">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <input type="text" id="clm-model" placeholder="모델명" class="vm-i">
          <input type="number" id="clm-qty" placeholder="수량" class="vm-i">
          <input type="text" id="clm-defect" placeholder="하자유형" class="vm-i">
          <input type="number" id="clm-amount" placeholder="청구금액" class="vm-i">
        </div>
        <input type="text" id="clm-notes" placeholder="상세 사유" class="vm-i" style="width:100%;margin-bottom:8px;">
        <button class="btn btn-sm btn-orange" onclick="_clmSubmitAdd()">💾 클레임 저장</button>
        <button class="btn btn-sm btn-gray" onclick="document.getElementById('clm-add-form').style.display='none'">취소</button>
      </div>
      <div id="vm-table-wrap"></div>
      <style>.vm-i{padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;}</style>`;
    tab.appendChild(section);

    // 글로벌 헬퍼 등록 (HTML onclick에서 호출)
    window._vmShowAddForm = () => {
      const f = document.getElementById('vm-add-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
      ['vm-name','vm-contact','vm-phone','vm-email','vm-bizno','vm-payterm','vm-notes']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    };
    window._vmSubmitAdd = () => {
      const name = document.getElementById('vm-name').value.trim();
      if (!name) { alert('매입사명 필수'); return; }
      vendor.set(name, {
        contactPerson: document.getElementById('vm-contact').value.trim(),
        phone:         document.getElementById('vm-phone').value.trim(),
        email:         document.getElementById('vm-email').value.trim(),
        bizNo:         document.getElementById('vm-bizno').value.trim(),
        paymentTerm:   document.getElementById('vm-payterm').value.trim(),
        riskLevel:     document.getElementById('vm-risk').value,
        notes:         document.getElementById('vm-notes').value.trim()
      });
      document.getElementById('vm-add-form').style.display = 'none';
    };
    window._vmEdit = (name) => {
      const m = vmData[name]; if (!m) return;
      window._vmShowAddForm();
      document.getElementById('vm-name').value    = name;
      document.getElementById('vm-contact').value = m.contactPerson||'';
      document.getElementById('vm-phone').value   = m.phone||'';
      document.getElementById('vm-email').value   = m.email||'';
      document.getElementById('vm-bizno').value   = m.bizNo||'';
      document.getElementById('vm-payterm').value = m.paymentTerm||'';
      document.getElementById('vm-risk').value    = m.riskLevel || 'normal';
      document.getElementById('vm-notes').value   = m.notes||'';
    };
    window._vmDelete = (name) => vendor.delete(name);
    window._vmAutoExtract = () => {
      const all = _allVendorNames();
      let added = 0;
      all.forEach(v => { if (!vmData[v]) { vmData[v] = { createdAt: new Date().toISOString(), riskLevel:'normal' }; added++; } });
      _saveV(); _renderTable();
      if (typeof setBanner === 'function') setBanner('ok', `✅ ${added}건 신규 추출 (전체 ${all.length}건)`);
    };

    window._clmShowAddForm = () => {
      const f = document.getElementById('clm-add-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
      ['clm-vendor','clm-pjno','clm-sn','clm-model','clm-qty','clm-defect','clm-amount','clm-notes']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    };
    window._clmSubmitAdd = () => {
      const v = document.getElementById('clm-vendor').value.trim();
      if (!v) { alert('매입사 필수'); return; }
      claim.add({
        vendor: v,
        pjNo: document.getElementById('clm-pjno').value.trim() || null,
        sn:   document.getElementById('clm-sn').value.trim() || null,
        model: document.getElementById('clm-model').value.trim(),
        qty: parseInt(document.getElementById('clm-qty').value) || 1,
        defectType: document.getElementById('clm-defect').value.trim(),
        claimAmount: parseInt(document.getElementById('clm-amount').value) || 0,
        notes: document.getElementById('clm-notes').value.trim()
      });
      document.getElementById('clm-add-form').style.display = 'none';
    };

    _renderTable();
  }

  function _renderTable() {
    const wrap = document.getElementById('vm-table-wrap');
    if (!wrap) return;
    const all = _allVendorNames();
    if (!all.length) {
      wrap.innerHTML = '<div style="padding:30px;text-align:center;color:#bbb;">매입사 없음 — "📥 수주에서 추출"</div>';
      return;
    }
    let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.84em;">
      <thead><tr style="background:#1a1a2e;color:white;">
        <th style="padding:8px;text-align:left;">매입사</th>
        <th style="padding:8px;text-align:right;">점수</th>
        <th style="padding:8px;text-align:right;">거래</th>
        <th style="padding:8px;text-align:right;">매입총액</th>
        <th style="padding:8px;text-align:right;">평균단가</th>
        <th style="padding:8px;text-align:right;">납기준수</th>
        <th style="padding:8px;text-align:right;">클레임</th>
        <th style="padding:8px;text-align:center;">위험</th>
        <th style="padding:8px;text-align:center;">담당</th>
        <th style="padding:8px;text-align:center;">작업</th>
      </tr></thead><tbody>`;
    all.forEach(v => {
      const s = _stats(v);
      const sc = _score(s);
      const m = vmData[v] || {};
      const scColor = sc >= 80 ? '#27ae60' : sc >= 60 ? '#f9a825' : sc >= 40 ? '#e65100' : '#c62828';
      const riskTag = m.riskLevel === 'blacklist' ? '<span style="background:#000;color:#fff;padding:2px 6px;border-radius:4px;font-size:0.74em;font-weight:700;">⛔ 거래중지</span>'
                    : m.riskLevel === 'high' ? '<span style="background:#ffebee;color:#c62828;padding:2px 6px;border-radius:4px;font-size:0.74em;font-weight:700;">🚨 고위험</span>'
                    : m.riskLevel === 'watch' ? '<span style="background:#fff3e0;color:#e65100;padding:2px 6px;border-radius:4px;font-size:0.74em;font-weight:700;">👁 관찰</span>'
                    : '<span style="color:#888;font-size:0.78em;">정상</span>';
      html += `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px;font-weight:700;">${v}${(m.email||m.phone)?'':' <span style="font-size:0.7em;color:#bbb;">(연락처 미등록)</span>'}</td>
        <td style="padding:8px;text-align:right;font-weight:800;color:${scColor};">${sc}</td>
        <td style="padding:8px;text-align:right;">${s.orderCount}</td>
        <td style="padding:8px;text-align:right;">${s.totalPurchase.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;">${s.avgUnitPrice.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;color:${s.onTimeRate==null?'#bbb':s.onTimeRate>=0.9?'#27ae60':'#e65100'};">${s.onTimeRate==null?'-':(s.onTimeRate*100).toFixed(0)+'%'}</td>
        <td style="padding:8px;text-align:right;color:${s.claimCount?'#c62828':'#888'};">${s.claimCount}건${s.claimAmount?` (${s.claimAmount.toLocaleString()})`:''}</td>
        <td style="padding:8px;text-align:center;">${riskTag}</td>
        <td style="padding:8px;text-align:center;font-size:0.8em;">${m.contactPerson||'-'}</td>
        <td style="padding:8px;text-align:center;white-space:nowrap;">
          <button class="btn btn-xs btn-dark" onclick="_vmEdit('${v.replace(/'/g,"\\'")}')">✏️</button>
          <button class="btn btn-xs btn-red" onclick="_vmDelete('${v.replace(/'/g,"\\'")}')">🗑️</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    if (claims.length) {
      html += `<div style="margin-top:18px;"><strong style="font-size:0.9em;">📋 최근 클레임 (${claims.length}건)</strong>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">${claims.slice(-10).reverse().map(c => `
          <div style="background:#fff3e0;border-left:3px solid #e65100;padding:6px 10px;border-radius:5px;font-size:0.78em;">
            <strong>${c.vendor}</strong> · ${c.model||'-'} · ${c.qty}매 · ${c.defectType||'-'}
            ${c.claimAmount?` · ${c.claimAmount.toLocaleString()}원`:''}
            <span style="color:#888;"> · ${c.when.slice(0,10)}</span>
          </div>`).join('')}</div></div>`;
    }
    wrap.innerHTML = html;
  }

  // ── 매입사 평가 룰 (validation R33·R34) ────────────
  function _registerRules() {
    if (typeof validationRules === 'undefined' || !validationRules.register) {
      setTimeout(_registerRules, 500); return;
    }
    validationRules.register({
      id: 'R33', label: '거래중지 매입사 차단', level: 'BLOCK', target: 'order',
      fn: (o) => {
        const v = String(o['매입사']||'').trim();
        if (!v || !vmData[v]) return null;
        if (vmData[v].riskLevel === 'blacklist')
          return `매입사 "${v}"는 거래중지 상태입니다 (${vmData[v].notes||''})`;
        return null;
      }
    });
    validationRules.register({
      id: 'R34', label: '고위험 매입사 안내', level: 'INFO', target: 'order',
      fn: (o) => {
        const v = String(o['매입사']||'').trim();
        if (!v || !vmData[v]) return null;
        const m = vmData[v];
        if (m.riskLevel === 'high' || m.riskLevel === 'watch')
          return `매입사 "${v}" 위험등급: ${m.riskLevel} ${m.notes?'· '+m.notes:''}`;
        return null;
      }
    });
    console.log('[ERP-VM] 매입사 룰 R33·R34 등록');
  }

  // ── showTab 후 inject ──────────────────────────────
  function _hookSettings() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookSettings, 300); return; }
    if (window.showTab.__vmHooked) return;
    const _orig = window.showTab;
    window.showTab = function(id) {
      const r = _orig.apply(this, arguments);
      if (id === 'settings') setTimeout(() => { _injectIntoSettings(); _renderTable(); }, 50);
      return r;
    };
    window.showTab.__vmHooked = true;
  }

  function boot() {
    _registerRules();
    _hookSettings();
    setTimeout(() => {
      const t = document.getElementById('tab-settings');
      if (t && t.classList.contains('active')) _injectIntoSettings();
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-VM] 매입사 마스터 ' + Object.keys(vmData).length + '건 · 클레임 ' + claims.length + '건');
})();
