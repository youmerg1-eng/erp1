// =====================================================
//  VALIDATION RULES — Phase B · Week 4
//  비즈니스 검증 룰 30개 + 모든 저장 지점에 자동 hook
//
//  설계 원칙
//   - 기존 코드 한 줄도 수정하지 않음
//   - 저장 함수를 가로채(wrap) 입력 검증 후 호출
//   - error level: BLOCK(차단) / WARN(확인) / INFO(알림만)
//
//  콘솔: validationRules.list() / validationRules.run(target,obj)
// =====================================================
(function() {
  'use strict';

  const RULES = [];

  function rule(id, label, level, target, fn) {
    RULES.push({ id, label, level, target, fn });
  }

  // ── 그룹 1: 수주 (10건) ─────────────────────────────
  rule('R01', 'PJ NO 필수 + 형식', 'BLOCK', 'order', (o, ctx) => {
    const pj = String(o['PJ NO']||'').trim();
    if (!pj) return 'PJ NO를 입력하세요';
    if (!/^[A-Za-z0-9]{1,8}-?\d+(-\d+)?$/i.test(pj)) return `PJ NO 형식이 올바르지 않습니다 ("${pj}")`;
    return null;
  });
  rule('R02', 'PJ NO 중복 차단', 'BLOCK', 'order', (o, ctx) => {
    if (!ctx?.isNew) return null;
    const pj = String(o['PJ NO']||'').trim();
    if (!pj || typeof rawData === 'undefined') return null;
    const dup = rawData.filter(r => String(r['PJ NO']||'').trim() === pj);
    if (dup.length > 0) return `PJ NO "${pj}"는 이미 등록되어 있습니다`;
    return null;
  });
  rule('R03', '담당자 필수', 'WARN', 'order', (o) => {
    if (!String(o['담당자']||'').trim()) return '담당자가 비어 있습니다';
    return null;
  });
  rule('R04', '고객사 필수', 'WARN', 'order', (o) => {
    if (!String(o['고객사']||'').trim()) return '고객사가 비어 있습니다';
    return null;
  });
  rule('R05', '모델명 필수', 'WARN', 'order', (o) => {
    if (!String(o['모델명']||'').trim()) return '모델명이 비어 있습니다';
    return null;
  });
  rule('R06', '수량 양수 범위', 'BLOCK', 'order', (o) => {
    const q = Number(String(o['수량']||'').replace(/,/g,''));
    if (q && (q < 0 || q > 1000000)) return `수량 ${q} — 0~1,000,000 범위여야 합니다`;
    return null;
  });
  rule('R07', '수주일 ≤ 출고요청일', 'WARN', 'order', (o) => {
    const so = String(o['수주일']||'').trim();
    const ds = String(o['출고요청일']||'').trim();
    if (so && ds && /^\d{4}-\d{2}-\d{2}$/.test(so) && /^\d{4}-\d{2}-\d{2}$/.test(ds)) {
      if (so > ds) return `수주일(${so}) > 출고요청일(${ds}) — 논리 오류`;
    }
    return null;
  });
  rule('R08', '수주총액 ≥ 0', 'BLOCK', 'order', (o) => {
    const t = Number(String(o['수주총액(원)']||'').replace(/,/g,''));
    if (t && t < 0) return `수주총액 ${t} — 음수 불가`;
    return null;
  });
  rule('R09', '매입총액 ≤ 수주총액 (이익 음수 경고)', 'INFO', 'order', (o) => {
    const sum = Number(String(o['수주총액(원)']||'').replace(/,/g,'')) || 0;
    const cost = Number(String(o['매입총액(원)']||'').replace(/,/g,'')) || 0;
    if (sum > 0 && cost > sum) return `매입(${cost.toLocaleString()})>수주(${sum.toLocaleString()}) — 손실 거래입니다`;
    return null;
  });
  rule('R10', '수량 × 제품단가 ≈ 수주총액', 'INFO', 'order', (o) => {
    const q = Number(String(o['수량']||'').replace(/,/g,'')) || 0;
    const u = Number(String(o['제품단가(원)']||'').replace(/,/g,'')) || 0;
    const t = Number(String(o['수주총액(원)']||'').replace(/,/g,'')) || 0;
    if (q && u && t) {
      const exp = q * u;
      const diff = Math.abs(exp - t) / t;
      if (diff > 0.05) return `수량×단가(${exp.toLocaleString()}) ≠ 수주총액(${t.toLocaleString()}) — 5% 이상 차이`;
    }
    return null;
  });

  // ── 그룹 2: 출고지시서 (5건) ────────────────────────
  rule('R11', '출고지시서 번호 + 수량 필수', 'BLOCK', 'deliveryOrder', (d) => {
    if (!d.id) return '출고지시서 번호가 비어 있습니다';
    if (!d.qty || d.qty <= 0) return `수량 ${d.qty} — 1 이상이어야 합니다`;
    return null;
  });
  rule('R12', '출고수량 ≤ 가용재고', 'WARN', 'deliveryOrder', (d) => {
    if (typeof inventoryData === 'undefined' || !d.model) return null;
    let stock = 0;
    inventoryData.forEach(r => {
      if ((r.model||'').trim() !== d.model.trim()) return;
      stock += r.type === '입고' ? (Number(r.qty)||0) : -(Number(r.qty)||0);
    });
    const total = (d.qty||0) + (d.foc||0);
    if (stock < total) return `가용재고 ${stock}매 < 출고요청 ${total}매 — 재고부족`;
    return null;
  });
  rule('R13', 'PJ NO 존재 확인', 'WARN', 'deliveryOrder', (d) => {
    if (!d.pjNo || typeof rawData === 'undefined') return null;
    const exists = rawData.some(r => String(r['PJ NO']||'').trim() === d.pjNo);
    if (!exists) return `PJ NO "${d.pjNo}"가 수주현황에 없습니다`;
    return null;
  });
  rule('R14', 'FOC 음수 차단', 'BLOCK', 'deliveryOrder', (d) => {
    if (d.foc != null && d.foc < 0) return `FOC ${d.foc} — 음수 불가`;
    return null;
  });
  rule('R15', '같은 PJ+모델 출고지시서 중복 경고', 'INFO', 'deliveryOrder', (d, ctx) => {
    if (!ctx?.isNew || typeof deliveryOrders === 'undefined') return null;
    const same = deliveryOrders.filter(x => x.pjNo === d.pjNo && x.model === d.model && x.id !== d.id);
    if (same.length >= 2) return `동일 PJ NO·모델 출고지시서가 이미 ${same.length}건 있습니다 (분할출고면 무시)`;
    return null;
  });

  // ── 그룹 3: 입출고 (5건) ────────────────────────────
  rule('R16', '입출고 유형/날짜/모델/수량 필수', 'BLOCK', 'inventory', (r) => {
    if (!r.type || !['입고','출고'].includes(r.type)) return `유형 "${r.type}" — 입고/출고 중 하나여야 함`;
    if (!r.date)  return '날짜를 입력하세요';
    if (!r.model) return '모델명을 입력하세요';
    if (!r.qty || r.qty <= 0) return `수량 ${r.qty} — 1 이상이어야 함`;
    return null;
  });
  rule('R17', '출고 시 재고 충분', 'WARN', 'inventory', (r) => {
    if (r.type !== '출고' || typeof inventoryData === 'undefined') return null;
    let stock = 0;
    inventoryData.forEach(x => {
      if ((x.model||'').trim() !== (r.model||'').trim()) return;
      if (x.id === r.id) return;  // 자기 자신 제외 (수정 시)
      stock += x.type === '입고' ? (Number(x.qty)||0) : -(Number(x.qty)||0);
    });
    if (stock < r.qty) return `현 재고 ${stock}매 < 출고 ${r.qty}매`;
    return null;
  });
  rule('R18', '제품 마스터에 모델 있음', 'INFO', 'inventory', (r) => {
    if (typeof productMaster === 'undefined' || !r.model) return null;
    if (!productMaster[r.model.trim()]) return `"${r.model}" 제품 마스터 미등록 — PLT 자동분할 안 됨`;
    return null;
  });
  rule('R19', '같은 날 같은 모델 중복 입고 경고', 'INFO', 'inventory', (r, ctx) => {
    if (r.type !== '입고' || !ctx?.isNew || typeof inventoryData === 'undefined') return null;
    const dup = inventoryData.filter(x => x.type==='입고' && x.date===r.date && (x.model||'').trim()===(r.model||'').trim());
    if (dup.length >= 1) return `${r.date}에 "${r.model}" 입고가 이미 ${dup.length}건 있음 — 중복인지 확인`;
    return null;
  });
  rule('R20', '날짜 형식 YYYY-MM-DD', 'BLOCK', 'inventory', (r) => {
    if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return `날짜 형식 오류 "${r.date}"`;
    return null;
  });

  // ── 그룹 4: 결제 (5건) ──────────────────────────────
  rule('R21', '계약금 ≤ 수주총액', 'BLOCK', 'payment', (p) => {
    if (p.계약금 != null && p.수주총액 != null && p.계약금 > p.수주총액)
      return `계약금(${p.계약금.toLocaleString()}) > 수주총액(${p.수주총액.toLocaleString()})`;
    return null;
  });
  rule('R22', '결제분할 합 ≈ 수주총액 (±1원)', 'WARN', 'payment', (p) => {
    if (!p.수주총액 || p.수주총액 <= 0) return null;
    const sum = (p.계약금||0)+(p.중도금1||0)+(p.중도금2||0)+(p.중도금3||0)+(p.잔금||0);
    if (sum > 0 && Math.abs(sum - p.수주총액) > 1)
      return `결제분할 합 ${sum.toLocaleString()} ≠ 수주총액 ${p.수주총액.toLocaleString()} (차이 ${(sum-p.수주총액).toLocaleString()})`;
    return null;
  });
  rule('R23', '입금 체크된 항목 금액 0 차단', 'WARN', 'payment', (p) => {
    const issues = [];
    if (p.계약금입금 && !p.계약금) issues.push('계약금');
    if (p.중도금1입금 && !p.중도금1) issues.push('중도금1');
    if (p.중도금2입금 && !p.중도금2) issues.push('중도금2');
    if (p.중도금3입금 && !p.중도금3) issues.push('중도금3');
    if (p.잔금입금 && !p.잔금) issues.push('잔금');
    if (issues.length) return `입금 체크됐으나 금액 0: ${issues.join(', ')}`;
    return null;
  });
  rule('R24', '중도금 순서 (1→2→3)', 'INFO', 'payment', (p) => {
    if (p.중도금2 && !p.중도금1) return '중도금2 입력됐으나 중도금1 없음';
    if (p.중도금3 && (!p.중도금1 || !p.중도금2)) return '중도금3 입력됐으나 중도금1·2 없음';
    return null;
  });
  rule('R25', '음수 결제 금액 차단', 'BLOCK', 'payment', (p) => {
    const fields = ['계약금','중도금1','중도금2','중도금3','잔금'];
    for (const f of fields) {
      if (p[f] != null && p[f] < 0) return `${f} 음수 불가`;
    }
    return null;
  });

  // ── 그룹 5: 고객사·마스터 (3건) ────────────────────
  rule('R26', '유사 고객사명 (오타 가능성)', 'INFO', 'order', (o) => {
    const c = String(o['고객사']||'').trim();
    if (!c || c.length < 2 || typeof rawData === 'undefined') return null;
    const norm = s => s.replace(/\(주\)|㈜|주식회사|\s+/g,'').toLowerCase();
    const my = norm(c);
    const others = [...new Set(rawData.map(r => String(r['고객사']||'').trim()).filter(Boolean))];
    const similar = others.find(x => x !== c && norm(x) === my);
    if (similar) return `유사 고객사 표기 "${similar}" 존재 — 표기 통일 권장`;
    return null;
  });
  rule('R27', '제품 마스터 1PLT 양수', 'BLOCK', 'productMaster', (pm) => {
    if (pm.plt != null && pm.plt < 0) return '1PLT 수량은 0 이상';
    return null;
  });
  rule('R28', '제품 마스터 모델 + 용량 필수', 'BLOCK', 'productMaster', (pm) => {
    if (!pm.model) return '모델명 필수';
    if (!pm.watt) return '제품용량(W) 필수';
    return null;
  });

  // ── 그룹 6: 데이터 일관성 (2건) ─────────────────────
  rule('R29', '발전소명·납품주소 중 하나는 입력', 'INFO', 'order', (o) => {
    if (!String(o['발전소명']||'').trim() && !String(o['납품주소']||'').trim())
      return '발전소명·납품주소 모두 비어 있음 — 출고지 확인 필요';
    return null;
  });
  rule('R30', '인수담당자 + 전화 형식', 'INFO', 'order', (o) => {
    const c = String(o['인수담당자']||'').trim();
    if (c && c.length > 2 && !/\d/.test(c)) return '인수담당자 입력은 있으나 전화번호 없음';
    return null;
  });

  // ── 실행기 ──────────────────────────────────────────
  function runRules(target, obj, ctx) {
    const result = { block: [], warn: [], info: [], all: [] };
    RULES.filter(r => r.target === target).forEach(r => {
      let msg;
      try { msg = r.fn(obj, ctx || {}); }
      catch(e) {
        if (typeof logError === 'function') logError('rule:'+r.id, e);
        return;
      }
      if (!msg) return;
      const item = { id: r.id, label: r.label, level: r.level, msg };
      result.all.push(item);
      if (r.level === 'BLOCK') result.block.push(item);
      else if (r.level === 'WARN') result.warn.push(item);
      else result.info.push(item);
    });
    return result;
  }

  // 사용자 다이얼로그: BLOCK이면 차단, WARN이면 확인, INFO는 토스트만
  function checkAndConfirm(target, obj, ctx, label) {
    const r = runRules(target, obj, ctx);
    if (r.block.length) {
      alert(`❌ ${label||'저장'} 차단\n\n` + r.block.map(b => `• ${b.msg}`).join('\n') +
            `\n\n위 항목을 수정 후 다시 시도해주세요.`);
      return false;
    }
    if (r.warn.length) {
      const ok = confirm(`⚠️ ${label||'저장'} 확인 필요\n\n` +
                         r.warn.map(w => `• ${w.msg}`).join('\n') +
                         `\n\n그래도 진행합니까?`);
      if (!ok) return false;
    }
    if (r.info.length && typeof setBanner === 'function') {
      setBanner('info', `ℹ️ ${r.info.length}건 권고: ${r.info[0].msg}${r.info.length>1?` 외 ${r.info.length-1}건`:''}`);
    }
    return true;
  }

  // ── 자동 hook (저장 함수 wrap) ──────────────────────
  function _hookSavers() {
    // 1) 출고지시서 생성 — createDeliveryOrder
    if (typeof window.createDeliveryOrder === 'function' && !window.createDeliveryOrder.__validated) {
      const _orig = window.createDeliveryOrder;
      window.createDeliveryOrder = function() {
        // 모달의 입력값으로 임시 객체 만들어서 검증
        const draft = {
          id: document.getElementById('do-no')?.value,
          qty: parseInt(document.getElementById('do-qty')?.value) || 0,
          foc: parseInt(document.getElementById('do-foc')?.value) || 0,
          model: document.getElementById('do-model')?.value || '',
          pjNo: document.getElementById('do-pjno')?.value || ''
        };
        if (!checkAndConfirm('deliveryOrder', draft, { isNew: true }, '출고지시서 생성')) return;
        return _orig.apply(this, arguments);
      };
      window.createDeliveryOrder.__validated = true;
    }

    // 2) 입고/출고 저장 — saveInbound / saveOutbound
    if (typeof window.saveInbound === 'function' && !window.saveInbound.__validated) {
      const _orig = window.saveInbound;
      window.saveInbound = function() {
        const draft = {
          type: '입고',
          date: document.getElementById('ib-date')?.value,
          model: document.getElementById('ib-model')?.value?.trim(),
          qty: parseInt(document.getElementById('ib-qty')?.value) || 0
        };
        if (!checkAndConfirm('inventory', draft, { isNew: true }, '입고 등록')) return;
        return _orig.apply(this, arguments);
      };
      window.saveInbound.__validated = true;
    }
    if (typeof window.saveOutbound === 'function' && !window.saveOutbound.__validated) {
      const _orig = window.saveOutbound;
      window.saveOutbound = function() {
        const draft = {
          type: '출고',
          date: document.getElementById('ob-date')?.value,
          model: document.getElementById('ob-model')?.value?.trim(),
          qty: parseInt(document.getElementById('ob-qty')?.value) || 0
        };
        if (!checkAndConfirm('inventory', draft, { isNew: true }, '출고 등록')) return;
        return _orig.apply(this, arguments);
      };
      window.saveOutbound.__validated = true;
    }

    // 3) 제품 마스터 저장 — saveProductMaster
    if (typeof window.saveProductMaster === 'function' && !window.saveProductMaster.__validated) {
      const _orig = window.saveProductMaster;
      window.saveProductMaster = function() {
        const draft = {
          model: document.getElementById('pm-model')?.value?.trim(),
          watt:  document.getElementById('pm-watt')?.value?.trim(),
          plt:   parseInt(document.getElementById('pm-plt')?.value) || 0
        };
        if (!checkAndConfirm('productMaster', draft, { isNew: true }, '제품 마스터 등록')) return;
        return _orig.apply(this, arguments);
      };
      window.saveProductMaster.__validated = true;
    }

    // [PATCH-C] 입출고 수정 — saveEditInventory
    if (typeof window.saveEditInventory === 'function' && !window.saveEditInventory.__validated) {
      const _orig = window.saveEditInventory;
      window.saveEditInventory = function() {
        const draft = {
          type:  document.getElementById('inv-edit-type')?.value,
          date:  document.getElementById('inv-edit-date')?.value,
          model: document.getElementById('inv-edit-model')?.value?.trim(),
          qty:   parseInt(document.getElementById('inv-edit-qty')?.value) || 0,
          id:    document.getElementById('inv-edit-id')?.value
        };
        if (!checkAndConfirm('inventory', draft, { isNew: false }, '입출고 수정')) return;
        return _orig.apply(this, arguments);
      };
      window.saveEditInventory.__validated = true;
    }

    // [PATCH-C] 입출고 삭제 — 재고 음수 유발 사전 시뮬
    if (typeof window.deleteInventory === 'function' && !window.deleteInventory.__validated) {
      const _orig = window.deleteInventory;
      window.deleteInventory = function(id) {
        if (typeof inventoryData !== 'undefined') {
          const rec = inventoryData.find(r => r.id === id);
          if (rec && rec.type === '입고') {
            // 입고 삭제 시 → 해당 모델 재고가 음수가 되는지 미리 계산
            let stock = 0;
            inventoryData.forEach(x => {
              if ((x.model||'').trim() !== (rec.model||'').trim()) return;
              if (x.id === id) return;   // 자기 자신 제외
              stock += x.type === '입고' ? (Number(x.qty)||0) : -(Number(x.qty)||0);
            });
            if (stock < 0) {
              if (!confirm(`⚠️ 이 입고 레코드 삭제 시 "${rec.model}" 재고가 ${stock}매 (음수) 됩니다.\n그래도 삭제합니까?`)) return;
            }
          }
        }
        return _orig.apply(this, arguments);
      };
      window.deleteInventory.__validated = true;
    }

    // [PATCH-C] 출고지시서 삭제 — 처리완료 건 재확인
    if (typeof window.deleteDeliveryOrder === 'function' && !window.deleteDeliveryOrder.__validated) {
      const _orig = window.deleteDeliveryOrder;
      window.deleteDeliveryOrder = function(id) {
        if (typeof deliveryOrders !== 'undefined') {
          const d = deliveryOrders.find(x => x.id === id);
          if (d && d.processed) {
            if (!confirm(`⚠️ ${id}는 이미 출고완료 처리되었습니다.\n삭제 시 수주 상태가 "출고취소"로 변경되고 재고가 복구됩니다.\n그래도 진행합니까?`)) return;
          }
          if (d && (d.managerSign || d.approverSign)) {
            if (!confirm(`⚠️ ${id}에 전자결재 서명이 등록되어 있습니다.\n삭제 시 서명도 함께 사라집니다.\n그래도 진행합니까?`)) return;
          }
        }
        return _orig.apply(this, arguments);
      };
      window.deleteDeliveryOrder.__validated = true;
    }

    // 4) 수주 등록/수정 — submitNewOrderModal / submitEditOrderModal 등
    //    함수명이 프로젝트마다 다를 수 있어 가장 흔한 후보들 순회
    ['submitNewOrderModal','saveOrder','submitEditOrderModal','saveOrderEdit'].forEach(fnName => {
      if (typeof window[fnName] === 'function' && !window[fnName].__validated) {
        const _orig = window[fnName];
        window[fnName] = function() {
          // 폼 값을 헤더 키 기반으로 수집
          const draft = {};
          const idMap = {
            'em-pjno':       'PJ NO',
            'em-manager':    '담당자',
            'em-customer':   '고객사',
            'em-product':    '제품군',
            'em-mfr':        '제조사',
            'em-model':      '모델명',
            'em-watt':       '제품용량(W)',
            'em-qty':        '수량',
            'em-kw':         '수주용량(kW)',
            'em-unit-price': '제품단가(원)',
            'em-total':      '수주총액(원)',
            'em-cost-total': '매입총액(원)',
            'em-orderdate':  '수주일',
            'em-duedate':    '출고요청일',
            'em-plant':      '발전소명',
            'em-address':    '납품주소',
            'em-contact':    '인수담당자'
          };
          Object.entries(idMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) draft[key] = el.value;
          });
          const isNew = !document.getElementById('em-row-id')?.value;
          if (!checkAndConfirm('order', draft, { isNew }, '수주 ' + (isNew?'등록':'수정'))) return;
          return _orig.apply(this, arguments);
        };
        window[fnName].__validated = true;
      }
    });
  }

  // ── 공개 API ────────────────────────────────────────
  window.validationRules = {
    list: function(target) {
      const filtered = target ? RULES.filter(r => r.target === target) : RULES;
      console.table(filtered.map(r => ({ id:r.id, level:r.level, target:r.target, label:r.label })));
      return filtered.length;
    },
    run: runRules,
    check: checkAndConfirm,
    raw: () => RULES.slice(),
    // 외부 모듈에서 룰 추가 가능 (예: 고객사 모듈의 신용한도 룰)
    register: function(r) {
      if (!r || !r.id || !r.target || typeof r.fn !== 'function')
        throw new Error('rule { id, label, level, target, fn } required');
      // 같은 ID 있으면 교체
      const i = RULES.findIndex(x => x.id === r.id);
      if (i >= 0) RULES[i] = r;
      else RULES.push(r);
      return RULES.length;
    }
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    setTimeout(_hookSavers, 200);
    setTimeout(_hookSavers, 1500);   // 안전망 (탭 스크립트 늦게 로드되는 경우)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log(`[ERP-VALID] 검증 룰 ${RULES.length}건 등록 · 저장 함수 자동 hook 활성`);
})();
