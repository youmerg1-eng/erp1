// =====================================================
//  DATA INTEGRITY — 데이터 정합성 검사 도구 (Phase 1 · #3)
//
//  검사 항목 (10가지)
//   1. 고아 출고지시서 (수주가 삭제됨)
//   2. 고아 배차 묶음 (출고지시서가 삭제됨)
//   3. 고아 반품 (관련 수주 없음)
//   4. 중복 PJ NO
//   5. 음수 재고 모델
//   6. 입금 합계 불일치 (계약금+중도금+잔금 ≠ 수주총액)
//   7. 출고 수량 > 수주 수량
//   8. 미사용 첨부 파일 (수주 삭제됐는데 filesData 잔존)
//   9. 잘못된 날짜 형식
//  10. 매입사/창고 마스터에 없는 참조
//
//  실행
//   - 수동: dataIntegrity.runAll() / 설정 탭의 카드
//   - 자동: 매주 월요일 첫 실행 시 백그라운드 검사 (결과를 알림 센터에)
//
//  공개 API: window.dataIntegrity
// =====================================================
(function() {
  'use strict';

  const REPORT_KEY = 'erp_integrity_last_report';
  const LAST_RUN_KEY = 'erp_integrity_last_run';

  // ── 개별 검사 함수들 ────────────────────────────────

  // 1. 고아 출고지시서 — pjNo 가 rawData 에 없음
  function _checkOrphanedDeliveries() {
    if (typeof deliveryOrders === 'undefined' || typeof rawData === 'undefined') return [];
    const pjSet = new Set(rawData.map(r => r['PJ NO']).filter(Boolean));
    return deliveryOrders.filter(d => d.pjNo && !pjSet.has(d.pjNo));
  }

  // 2. 고아 배차 묶음 — items 의 출고지시서가 없음
  function _checkOrphanedDispatches() {
    if (typeof window.dispatch === 'undefined' || typeof deliveryOrders === 'undefined') return [];
    const dispatchData = window.dispatch.raw ? window.dispatch.raw() : [];
    const doIds = new Set(deliveryOrders.map(d => d.id));
    const result = [];
    dispatchData.forEach(d => {
      const missing = (d.items || []).filter(id => !doIds.has(id));
      if (missing.length > 0) result.push({ dispatch: d, missingItems: missing });
    });
    return result;
  }

  // 3. 고아 반품 — pjNo 가 rawData 에 없음 (단 pjNo 가 비어있으면 OK)
  function _checkOrphanedReturns() {
    if (typeof window.returns === 'undefined' || typeof rawData === 'undefined') return [];
    const ret = window.returns.list ? window.returns.list() : [];
    const pjSet = new Set(rawData.map(r => r['PJ NO']).filter(Boolean));
    return ret.filter(r => r.pjNo && !pjSet.has(r.pjNo));
  }

  // 4. 중복 PJ NO
  function _checkDuplicatePjNo() {
    if (typeof rawData === 'undefined') return [];
    const seen = {};
    const dups = [];
    rawData.forEach(r => {
      const pj = r['PJ NO'];
      if (!pj) return;
      if (seen[pj]) {
        if (!dups.find(d => d.pjNo === pj)) dups.push({ pjNo: pj, count: 2, rows: [seen[pj], r] });
        else { const e = dups.find(d => d.pjNo === pj); e.count++; e.rows.push(r); }
      } else {
        seen[pj] = r;
      }
    });
    return dups;
  }

  // 5. 음수 재고 모델
  function _checkNegativeStock() {
    if (typeof inventoryData === 'undefined') return [];
    const stock = {};
    inventoryData.forEach(r => {
      const key = (r.mfr||'') + '|' + (r.model||r.moduleModel||'');
      if (!stock[key]) stock[key] = { mfr:r.mfr||'', model:r.model||r.moduleModel||'', inQty:0, outQty:0 };
      const qty = Number(r.qty)||0;
      if (r.type === '입고') stock[key].inQty += qty;
      else if (r.type === '출고') stock[key].outQty += qty;
    });
    return Object.values(stock)
      .map(s => ({ ...s, current: s.inQty - s.outQty }))
      .filter(s => s.current < 0);
  }

  // 6. 입금 합계 불일치
  function _checkPaymentMismatch() {
    if (typeof rawData === 'undefined' || typeof localMeta === 'undefined') return [];
    const result = [];
    rawData.forEach(r => {
      const id = r._id;
      const meta = localMeta[id] || {};
      const total = Number(r['수주총액(원)'] || 0);
      if (total <= 0) return;
      const payments = (Number(meta.계약금)||0) + (Number(meta.중도금1)||0) + (Number(meta.중도금2)||0) + (Number(meta.중도금3)||0) + (Number(meta.잔금)||0);
      // 입금이 하나라도 등록되어 있는 경우만 검사
      if (payments > 0) {
        const diff = Math.abs(total - payments);
        // 1% 또는 1만원 이상 차이면 불일치
        if (diff > Math.max(total * 0.01, 10000)) {
          result.push({ pjNo: r['PJ NO'], 고객사: r['고객사'], 수주총액: total, 입금합계: payments, 차이: total - payments });
        }
      }
    });
    return result;
  }

  // 7. 출고 수량 > 수주 수량
  function _checkOverShipped() {
    if (typeof rawData === 'undefined' || typeof deliveryOrders === 'undefined') return [];
    const orderQty = {};
    rawData.forEach(r => {
      const pj = r['PJ NO'];
      if (!pj) return;
      orderQty[pj] = (orderQty[pj] || 0) + (Number(r['수량']) || 0);
    });
    const shippedQty = {};
    deliveryOrders.forEach(d => {
      const pj = d.pjNo;
      if (!pj) return;
      shippedQty[pj] = (shippedQty[pj] || 0) + (Number(d.qty || d.totalQty || 0));
    });
    const result = [];
    Object.keys(shippedQty).forEach(pj => {
      const ord = orderQty[pj] || 0;
      const ship = shippedQty[pj];
      if (ord > 0 && ship > ord) {
        result.push({ pjNo: pj, 수주수량: ord, 출고수량: ship, 초과: ship - ord });
      }
    });
    return result;
  }

  // 8. 미사용 첨부 파일
  function _checkOrphanedFiles() {
    if (typeof filesData === 'undefined' || typeof rawData === 'undefined') return [];
    const validIds = new Set(rawData.map(r => r._id).filter(Boolean));
    const orphaned = [];
    Object.keys(filesData).forEach(k => {
      // nested 구조: filesData[id][type]
      const v = filesData[k];
      if (!v) return;
      // flat 구조: filesData[id|type]
      if (k.includes('|')) {
        const id = k.split('|')[0];
        if (!validIds.has(id)) orphaned.push({ key: k, type: 'flat', id, fileName: v.name||'-' });
      } else {
        // nested
        if (!validIds.has(k) && typeof v === 'object') {
          Object.keys(v).forEach(type => {
            if (v[type] && v[type].data) orphaned.push({ key: k+'|'+type, type: 'nested', id: k, fileType: type, fileName: v[type].name||'-' });
          });
        }
      }
    });
    return orphaned;
  }

  // 9. 잘못된 날짜 형식
  function _checkInvalidDates() {
    if (typeof rawData === 'undefined') return [];
    const result = [];
    const dateFields = ['수주일','출고요청일','납품일','사용전검사일정'];
    rawData.forEach(r => {
      dateFields.forEach(f => {
        const v = r[f];
        if (v && typeof v === 'string' && v.trim()) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !/^\d{2}[-./]\d{1,2}[-./]\d{1,2}$/.test(v.trim())) {
            result.push({ pjNo: r['PJ NO'], field: f, value: v });
          }
        }
      });
    });
    return result;
  }

  // 10. 매입사 마스터에 없는 참조
  function _checkUnknownVendors() {
    if (typeof rawData === 'undefined' || typeof window.vendorMaster === 'undefined') return [];
    const vendorMaster = (window.vendorMaster && window.vendorMaster.list) ? window.vendorMaster.list() : [];
    if (!vendorMaster.length) return [];  // 마스터 비어있으면 검사 안 함
    const knownVendors = new Set(vendorMaster.map(v => v.name));
    const unknown = {};
    rawData.forEach(r => {
      const v = r['매입사'];
      if (v && v.trim() && !knownVendors.has(v.trim())) {
        unknown[v] = (unknown[v] || 0) + 1;
      }
    });
    return Object.entries(unknown).map(([name, count]) => ({ vendor: name, count }));
  }

  // ── 전체 검사 실행 ──────────────────────────────────
  function runAll() {
    const startTime = Date.now();
    const checks = [
      { id:'orphan-do',   label:'고아 출고지시서',        fn: _checkOrphanedDeliveries },
      { id:'orphan-dsp',  label:'고아 배차 묶음',          fn: _checkOrphanedDispatches },
      { id:'orphan-rma',  label:'고아 반품',              fn: _checkOrphanedReturns },
      { id:'dup-pjno',    label:'중복 PJ NO',              fn: _checkDuplicatePjNo },
      { id:'neg-stock',   label:'음수 재고 모델',          fn: _checkNegativeStock },
      { id:'pay-mismatch',label:'입금 합계 불일치',        fn: _checkPaymentMismatch },
      { id:'over-ship',   label:'출고 수량 초과',          fn: _checkOverShipped },
      { id:'orphan-file', label:'미사용 첨부 파일',        fn: _checkOrphanedFiles },
      { id:'bad-date',    label:'잘못된 날짜 형식',        fn: _checkInvalidDates },
      { id:'unknown-vendor',label:'매입사 마스터 미등록', fn: _checkUnknownVendors }
    ];
    const results = checks.map(c => {
      try {
        const issues = c.fn() || [];
        return { id:c.id, label:c.label, count:issues.length, issues, success:true };
      } catch(e) {
        console.warn('[dataIntegrity]', c.id, e);
        return { id:c.id, label:c.label, count:0, issues:[], success:false, error:e.message };
      }
    });
    const totalIssues = results.reduce((s, r) => s + r.count, 0);
    const report = {
      at: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      totalIssues,
      results
    };
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(report)); } catch(e) {}
    try { localStorage.setItem(LAST_RUN_KEY, report.at); } catch(e) {}
    return report;
  }

  function getLastReport() {
    try { return JSON.parse(localStorage.getItem(REPORT_KEY) || 'null'); }
    catch(e) { return null; }
  }

  // ── 수정 액션 ───────────────────────────────────────
  function fixOrphanedFiles() {
    const issues = _checkOrphanedFiles();
    if (issues.length === 0) { alert('정리할 미사용 파일이 없습니다.'); return; }
    if (!confirm(`미사용 첨부 파일 ${issues.length}건을 삭제하시겠습니까?\n(연결된 수주가 없는 파일)`)) return;
    let n = 0;
    issues.forEach(i => {
      if (i.type === 'flat') delete filesData[i.key];
      else if (i.type === 'nested') {
        if (filesData[i.id] && filesData[i.id][i.fileType]) {
          delete filesData[i.id][i.fileType];
          if (Object.keys(filesData[i.id]).length === 0) delete filesData[i.id];
        }
      }
      n++;
    });
    try { localStorage.setItem('erp_files', JSON.stringify(filesData)); } catch(e) {}
    if (typeof setBanner === 'function') setBanner('ok', `🗑 미사용 파일 ${n}건 정리 완료`);
  }

  function fixOrphanedDeliveries() {
    const issues = _checkOrphanedDeliveries();
    if (issues.length === 0) { alert('정리할 고아 출고지시서가 없습니다.'); return; }
    if (!confirm(`수주가 삭제된 출고지시서 ${issues.length}건을 삭제하시겠습니까?`)) return;
    if (typeof deliveryOrders !== 'undefined') {
      const removeIds = new Set(issues.map(d => d.id));
      for (let i = deliveryOrders.length - 1; i >= 0; i--) {
        if (removeIds.has(deliveryOrders[i].id)) deliveryOrders.splice(i, 1);
      }
      try { localStorage.setItem('erp_delivery', JSON.stringify(deliveryOrders)); } catch(e) {}
      if (typeof setBanner === 'function') setBanner('ok', `🗑 고아 출고지시서 ${issues.length}건 정리 완료`);
    }
  }

  // ── UI ──────────────────────────────────────────────
  function _renderReportCard(hostEl) {
    if (!hostEl) return;
    const report = getLastReport();
    const _fmtTime = (s) => {
      if (!s) return '없음';
      try { return new Date(s).toLocaleString('ko-KR', { dateStyle:'short', timeStyle:'short' }); }
      catch(e) { return s; }
    };

    if (!report) {
      hostEl.innerHTML = `
        <div style="padding:20px;text-align:center;color:#888;">
          아직 검사 이력이 없습니다.
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;">
          <button class="btn btn-primary btn-sm" onclick="dataIntegrity._runAndShow()">전체 검사 실행</button>
        </div>
      `;
      return;
    }

    const total = report.totalIssues;
    const color = total === 0 ? '#27ae60' : total < 10 ? '#e65100' : '#c62828';
    const icon = total === 0 ? '✓' : total < 10 ? '⚠' : '✗';

    hostEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:${total===0?'#e8f5e9':total<10?'#fff3e0':'#ffebee'};border-radius:8px;margin-bottom:14px;border-left:4px solid ${color};">
        <div>
          <div style="font-size:1.8em;font-weight:900;color:${color};">${icon} ${total}건</div>
          <div style="font-size:0.84em;color:#666;margin-top:2px;">
            ${total === 0 ? '✅ 정합성 문제 없음' : `${total}건의 정합성 이슈 발견`}
            · 검사 시각: ${_fmtTime(report.at)}
            · 소요: ${report.durationMs}ms
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="dataIntegrity._runAndShow()">다시 검사</button>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:0.86em;">
        <thead><tr style="background:#1a1a2e;color:#fff;">
          <th style="padding:8px 10px;text-align:left;">검사 항목</th>
          <th style="padding:8px 10px;text-align:right;">발견 건수</th>
          <th style="padding:8px 10px;text-align:center;">조치</th>
        </tr></thead>
        <tbody>
          ${report.results.map(r => {
            const cnt = r.count;
            const ccol = cnt === 0 ? '#27ae60' : '#c62828';
            const cbg = cnt === 0 ? '#e8f5e9' : '#ffebee';
            return `<tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px 10px;">${r.label}${r.success===false?` <span style="color:#c62828;font-size:0.8em;">⚠️ 검사 실패: ${r.error||'-'}</span>`:''}</td>
              <td style="padding:8px 10px;text-align:right;">
                <span style="background:${cbg};color:${ccol};padding:3px 10px;border-radius:10px;font-weight:700;">${cnt}</span>
              </td>
              <td style="padding:8px 10px;text-align:center;">
                ${cnt > 0 ? `
                  <button class="btn btn-xs btn-outline" onclick="dataIntegrity._showDetails('${r.id}')">상세</button>
                  ${(r.id === 'orphan-file' || r.id === 'orphan-do') ? `<button class="btn btn-xs btn-danger" onclick="dataIntegrity._fix('${r.id}')">자동 정리</button>` : ''}
                ` : '-'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      <details style="margin-top:14px;background:#fffde7;border-left:3px solid #f9a825;border-radius:6px;padding:8px 12px;">
        <summary style="cursor:pointer;font-weight:700;color:#5d4037;">💡 정합성 검사 안내</summary>
        <div style="margin-top:8px;font-size:0.84em;color:#555;line-height:1.6;">
          이 도구는 데이터 간 참조 무결성, 중복, 음수 재고 등을 자동 점검합니다.
          <ul style="margin:6px 0 0 18px;padding:0;">
            <li>매주 월요일 첫 진입 시 자동 실행</li>
            <li>발견된 이슈는 자동 수정되지 않습니다 (사용자 확인 필요)</li>
            <li>"자동 정리" 가능한 항목만 일괄 처리 버튼 제공</li>
          </ul>
        </div>
      </details>
    `;
  }

  function _runAndShow() {
    if (typeof setBanner === 'function') setBanner('info', '🔍 데이터 정합성 검사 중...');
    setTimeout(() => {
      const r = runAll();
      _renderReportCard(document.getElementById('integrity-report-card'));
      if (typeof setBanner === 'function') {
        if (r.totalIssues === 0) setBanner('ok', '✅ 정합성 검사 통과 — 문제 없음');
        else setBanner('warn', `⚠️ 정합성 이슈 ${r.totalIssues}건 발견 — 설정 탭에서 확인`);
      }
    }, 100);
  }

  function _showDetails(id) {
    const report = getLastReport();
    if (!report) return;
    const r = report.results.find(x => x.id === id);
    if (!r || r.issues.length === 0) { alert('상세 정보 없음'); return; }

    const lines = r.issues.slice(0, 30).map((it, i) => {
      return `${i+1}. ${JSON.stringify(it).slice(0, 200)}`;
    }).join('\n\n');
    const more = r.issues.length > 30 ? `\n\n... 외 ${r.issues.length - 30}건` : '';
    alert(`[${r.label}] 발견된 이슈 ${r.issues.length}건\n\n${lines}${more}`);
  }

  function _fix(id) {
    if (id === 'orphan-file') fixOrphanedFiles();
    else if (id === 'orphan-do') fixOrphanedDeliveries();
    setTimeout(() => _runAndShow(), 100);
  }

  // ── 설정 탭 자동 주입 ───────────────────────────────
  function _injectIntoSettings() {
    if (document.getElementById('integrity-report-card')) return;
    const tab = document.getElementById('tab-settings');
    if (!tab) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div class="card-head">
        <h3>데이터 정합성 검사</h3>
        <span class="tag purple">10가지 자동 검사</span>
      </div>
      <div class="card-body" id="integrity-report-card"></div>
    `;
    // 동기화 카드 다음에 삽입
    const syncCard = tab.querySelector('#syncstab-status-card')?.closest('.card');
    if (syncCard) syncCard.parentNode.insertBefore(card, syncCard.nextSibling);
    else tab.appendChild(card);
    _renderReportCard(document.getElementById('integrity-report-card'));
  }

  function _hookShowTab() {
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__integrityHooked) return;
    const orig = window.showTab;
    window.showTab = function(id) {
      const r = orig.apply(this, arguments);
      if (id === 'settings') setTimeout(_injectIntoSettings, 300);
      return r;
    };
    window.showTab.__integrityHooked = true;
  }

  // ── 주간 자동 검사 ──────────────────────────────────
  function _autoRunIfNeeded() {
    const last = localStorage.getItem(LAST_RUN_KEY);
    if (!last) return; // 첫 진입 시는 수동
    const daysAgo = (Date.now() - new Date(last)) / 86400000;
    const today = new Date();
    // 매주 월요일 + 마지막 검사 7일 이상 전이면 자동 실행
    if (today.getDay() === 1 && daysAgo >= 7) {
      console.log('[dataIntegrity] 주간 자동 검사 실행');
      const r = runAll();
      if (r.totalIssues > 0 && typeof setBanner === 'function') {
        setTimeout(() => {
          setBanner('warn', `⚠️ 주간 정합성 검사 — ${r.totalIssues}건 이슈 발견 (설정 탭에서 확인)`);
        }, 5000);
      }
    }
  }

  // ── 공개 API ────────────────────────────────────────
  window.dataIntegrity = {
    runAll,
    getLastReport,
    fixOrphanedFiles,
    fixOrphanedDeliveries,
    // 개별 검사
    checkOrphanedDeliveries: _checkOrphanedDeliveries,
    checkOrphanedDispatches: _checkOrphanedDispatches,
    checkOrphanedReturns: _checkOrphanedReturns,
    checkDuplicatePjNo: _checkDuplicatePjNo,
    checkNegativeStock: _checkNegativeStock,
    checkPaymentMismatch: _checkPaymentMismatch,
    checkOverShipped: _checkOverShipped,
    checkOrphanedFiles: _checkOrphanedFiles,
    checkInvalidDates: _checkInvalidDates,
    checkUnknownVendors: _checkUnknownVendors,
    // UI helpers
    _runAndShow, _showDetails, _fix, _renderReportCard
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _hookShowTab();
    setTimeout(_autoRunIfNeeded, 8000);
    setTimeout(() => {
      const active = document.querySelector('.tab-panel.active');
      if (active?.id === 'tab-settings') _injectIntoSettings();
    }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-INTEGRITY] 데이터 정합성 검사 활성 — dataIntegrity.runAll()');
})();
