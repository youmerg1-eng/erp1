// =====================================================
//  THIRD-PARTY INVENTORY — 타사 위탁 재고 관리 (Phase 2)
//
//  기능
//   1) 화주(Owner) 마스터 — 회사 정보 + 보관료 정책
//   2) 위탁 입고/출고 — 자체 재고와 분리되어 관리됨
//   3) 보관료 자동 계산 — Wp당 단가 × 보관 일수
//      ├ 무상 보관 기간 (예: 30일 free)
//      ├ 추가 보관 기간 (예: + 60일까지 정상 단가)
//      └ 초과 시 할증 단가 (옵션)
//   4) 월별 청구서 자동 생성 + 세금계산서 발행 연동
//   5) 화주별 재고 현황 + 정산 이력
//
//  자체 재고 격리
//   - 자체 inventoryData 와 절대 합쳐지지 않음
//   - atp.all() 등 자체 재고 계산에서 제외
//   - 시각적 구분 (보라색 #7b1fa2)
//
//  데이터 키
//   erp_tp_owners       — 화주 마스터
//   erp_tp_inventory    — 위탁 입출고
//   erp_tp_billing      — 월 청구 이력
//
//  공개 API: window.thirdParty
// =====================================================
(function() {
  'use strict';

  const KEY_OWNERS    = 'erp_tp_owners';
  const KEY_INVENTORY = 'erp_tp_inventory';
  const KEY_BILLING   = 'erp_tp_billing';

  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => {
      window.erpSafety.protect(KEY_OWNERS);
      window.erpSafety.protect(KEY_INVENTORY);
      window.erpSafety.protect(KEY_BILLING);
    }, 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _genId(p) { return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,5); }
  function _daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    return Math.max(0, Math.floor((new Date(d2) - new Date(d1)) / 86400000));
  }
  function _addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  }
  // ★ 2026-05-08 추가: 월 단위 계산 (입고당월 포함 정책 지원)
  //   ymA, ymB: 'YYYY-MM' 형식. ymB - ymA + 1 = 입고당월 포함 경과 개월 수.
  //   예: 입고 2026-01, 청구 2026-06 → 6개월 경과 (입고당월 포함)
  function _monthsElapsedInclusive(ymA, ymB) {
    if (!ymA || !ymB) return 0;
    const [yA, mA] = ymA.split('-').map(Number);
    const [yB, mB] = ymB.split('-').map(Number);
    return Math.max(0, (yB - yA) * 12 + (mB - mA) + 1);
  }
  // ★ 2026-05-08 신규 정책: 입고 다음달 1일 기준 경과 개월
  //   예: 입고 2026-01-15 → 무상 시작 = 2026-02-01
  //       청구 2026-02 → 1개월 경과 (첫 무상 월)
  //       청구 2026-06 → 5개월 경과 (5개월 무상 정책의 마지막 월)
  //       청구 2026-07 → 6개월 경과 → 초과 1개월
  function _monthsAfterInbound(ymA, ymB) {
    if (!ymA || !ymB) return 0;
    const [yA, mA] = ymA.split('-').map(Number);
    const [yB, mB] = ymB.split('-').map(Number);
    return Math.max(0, (yB - yA) * 12 + (mB - mA));
  }
  // 해당 월의 마지막 날짜 ('YYYY-MM' → 'YYYY-MM-DD')
  function _monthEnd(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${String(last).padStart(2,'0')}`;
  }

  // ── 데이터 로드/저장 ──────────────────────────────
  let owners = [], inventory = [], billing = [];
  function _load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function _save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (e) {
      console.error('[tp] save 실패', key, e);
      if (typeof setBanner === 'function') setBanner('err', '❌ 저장 실패: ' + (e.message||''));
      throw e;
    }
  }
  function loadAll() {
    owners    = _load(KEY_OWNERS,    []);
    inventory = _load(KEY_INVENTORY, []);
    billing   = _load(KEY_BILLING,   []);
    if (!Array.isArray(owners))    owners = [];
    if (!Array.isArray(inventory)) inventory = [];
    if (!Array.isArray(billing))   billing = [];
  }

  // ============================================================
  //  화주 (Owner) CRUD
  // ============================================================
  function listOwners() { return owners.slice(); }
  function getOwner(id) { return owners.find(o => o.id === id); }

  function addOwner(data) {
    // ★ 2026-05 변경: 할증 정책을 배수 → 절대값 추가 단가로 변경
    //   계약서(SCGS 3PL 물류대행) 표준 패턴 반영:
    //   "정상 단가 7.8원 + 5개월 초과 시 0.5원 추가" 형태
    //   기존 surchargeRate(배수) 는 하위 호환을 위해 유지하나, 신규 owner 는
    //   surchargeAddPerWp 사용을 권장.
    const o = {
      id: _genId('OW'),
      // ── 기본 정보
      name: data.name || '신규 화주',
      bizNo: data.bizNo || '',
      ceoName: data.ceoName || '',                     // ★ 대표이사
      contact: data.contact || '',
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      // ── 계약 기간
      contractStart: data.contractStart || _today(),
      contractEnd: data.contractEnd || '',
      autoRenew: !!data.autoRenew,                     // ★ 자동 1년 연장
      renewMonths: Number(data.renewMonths) || 12,
      // ── 물류대행비 (★ 2026-05-08 추가) — 입고 시 1회성 청구
      //   공식: 물류대행비 = 입고수량 × 용량(W) × 계약단가(원/Wp)
      logisticsContractRatePerWp: Number(data.logisticsContractRatePerWp) || 0,  // 계약단가 (원/Wp, 입고당월 1회 청구)
      // ── 보관료 정책 (Wp당 원 단가)
      ratePerWp: Number(data.ratePerWp) || 0,          // 정상 단가 (원/Wp/월) — 0 이면 무상 정책
      freeMonths: Number(data.freeMonths) || 0,        // 무상 보관 개월 (입고 다음달 1일부터)
      extraMonths: Number(data.extraMonths) || 0,      // 무상 추가 개월 (총 무상 = freeMonths + extraMonths)
      // ★ 신규: 절대값 추가 할증 — 무상 기간 초과 시 매월 청구
      surchargeAddPerWp: Number(data.surchargeAddPerWp) || 0,  // 초과 시 매월 단가 (원/Wp/월)
      // 하위 호환 — 기존 데이터 보존
      surchargeRate: Number(data.surchargeRate) || 0,
      // ── 입출고 수수료 (옵션, 계약서엔 보통 없음)
      inboundFeePerWp: Number(data.inboundFeePerWp) || 0,
      outboundFeePerWp: Number(data.outboundFeePerWp) || 0,
      // ── 결제 정보 (계약서에서 명시)
      paymentTerms: data.paymentTerms || '월말 마감 / 익월 말일 입금',
      bankName: data.bankName || '',                   // ★ 은행명
      bankAccount: data.bankAccount || '',             // ★ 계좌번호
      accountHolder: data.accountHolder || '',         // ★ 예금주
      vatIncluded: !!data.vatIncluded,
      // ── 계약서 첨부 (PDF base64)
      contractPdf: data.contractPdf || null,           // ★ 계약서 PDF
      contractFileName: data.contractFileName || '',
      // ── 통지 의무 변경 이력 (사업자등록증, 자본 구성 등)
      changeHistory: Array.isArray(data.changeHistory) ? data.changeHistory : [],
      // ── 해지/만료
      terminationReason: data.terminationReason || null,
      terminationDate: data.terminationDate || null,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      _ts: Date.now()
    };
    owners.push(o);
    _save(KEY_OWNERS, owners);
    return o;
  }

  function updateOwner(id, patch) {
    const i = owners.findIndex(o => o.id === id);
    if (i < 0) return null;
    owners[i] = { ...owners[i], ...patch, _ts: Date.now() };
    _save(KEY_OWNERS, owners);
    return owners[i];
  }

  function removeOwner(id) {
    const inUse = inventory.some(r => r.ownerId === id);
    if (inUse) {
      if (!confirm('이 화주의 입출고 이력이 있습니다. 정말 삭제합니까?')) return false;
    }
    owners = owners.filter(o => o.id !== id);
    _save(KEY_OWNERS, owners);
    return true;
  }

  // ============================================================
  //  위탁 입출고 CRUD
  // ============================================================
  function listInventory(filter) {
    filter = filter || {};
    return inventory.filter(r => {
      if (filter.ownerId && r.ownerId !== filter.ownerId) return false;
      if (filter.type && r.type !== filter.type) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    });
  }

  function addInventory(data) {
    const owner = getOwner(data.ownerId);
    if (!owner) throw new Error('화주를 찾을 수 없음: ' + data.ownerId);

    const r = {
      id: _genId('TP'),
      ownerId: data.ownerId,
      ownerName: owner.name,
      type: data.type || 'inbound',         // 'inbound' | 'outbound'
      date: data.date || _today(),
      model: data.model || '',
      mfr: data.mfr || '',
      qty: Number(data.qty) || 0,
      watt: Number(data.watt) || 0,
      // 보관 위치 (warehouseMaster의 zone 연결)
      warehouseId: data.warehouseId || '',
      zoneId: data.zoneId || '',
      warehouseName: data.warehouseName || '',
      zoneName: data.zoneName || '',
      // 입고 시
      bl: data.bl || '',                     // B/L 번호
      ref: data.ref || '',                   // 참조번호
      inboundDate: data.type === 'inbound' ? (data.date || _today()) : null,
      // 출고 시 — 입고 이력 ID 참조
      relatedInboundId: data.relatedInboundId || null,
      // 상태
      status: data.status || (data.type === 'inbound' ? '보관중' : '출고완료'),
      billingMonth: data.billingMonth || _today().slice(0,7),
      billed: false,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      _ts: Date.now()
    };
    inventory.push(r);
    _save(KEY_INVENTORY, inventory);
    return r;
  }

  function updateInventoryRec(id, patch) {
    const i = inventory.findIndex(r => r.id === id);
    if (i < 0) return null;
    inventory[i] = { ...inventory[i], ...patch, _ts: Date.now() };
    _save(KEY_INVENTORY, inventory);
    return inventory[i];
  }

  function removeInventoryRec(id) {
    inventory = inventory.filter(r => r.id !== id);
    _save(KEY_INVENTORY, inventory);
    return true;
  }

  // 화주별 현재 재고 (입고 - 출고)
  function ownerStock(ownerId) {
    const stock = {};   // model → { qty, watt, owner, ... }
    inventory.forEach(r => {
      if (r.ownerId !== ownerId) return;
      const k = r.model;
      if (!stock[k]) stock[k] = { model: r.model, mfr: r.mfr, watt: r.watt, qty: 0, totalWp: 0 };
      stock[k].qty += (r.type === 'inbound' ? r.qty : -r.qty);
    });
    Object.values(stock).forEach(s => s.totalWp = s.qty * s.watt);
    return Object.values(stock).filter(s => s.qty > 0);
  }

  // ============================================================
  //  보관료 자동 계산 — 월 단위 (★ 2026-05-08 정책 변경)
  // ============================================================
  //  새 정책 (사용자 요구사항)
  //   ① 위탁품 입고일부터 3개월 이내 출고 (무상 기본)
  //   ② 무상 2개월 추가 가능 (총 5개월 무상, ★ 입고 다음달 1일부터 계산)
  //   ③ 5개월 초과 시 매월 WP당 0.5원 추가 청구
  //   ④ 화주 부담 물류비는 매월 말일 정산
  //
  //  공식
  //   - totalFreeMonths = freeMonths(3) + extraMonths(2) = 5 (★ 입고 다음달부터)
  //   - monthsElapsed = (청구월 - 입고월) + 1  (입고당월 = 1)
  //   - 정상 단가(ratePerWp) > 0 인 경우 (계약서 패턴, 하위 호환):
  //       normalMonths = min(max(0, monthsElapsed - freeMonths), extraMonths)
  //       surchargeMonths = max(0, monthsElapsed - totalFreeMonths)
  //       fee = totalWp × ratePerWp × normalMonths
  //           + totalWp × (ratePerWp + surchargeAddPerWp) × surchargeMonths
  //   - ratePerWp == 0 인 경우 (신규 무상 정책):
  //       fee = totalWp × surchargeAddPerWp × surchargeMonths
  //
  //  하위 호환: 일 단위 계산이 필요하면 calcStorageFeeDaily(item, date) 사용 (deprecated)
  function calcStorageFee(item, billingDate) {
    const owner = getOwner(item.ownerId);
    if (!owner) return null;
    const inDate = item.inboundDate || item.date;
    const inYM = inDate.slice(0, 7);
    // billingDate 가 없으면 오늘 기준 월말로 자동 설정 (매월 말일 정산 정책)
    const billingEnd = billingDate || _monthEnd(_today().slice(0, 7));
    const billingYM = billingEnd.slice(0, 7);

    const totalDays = _daysBetween(inDate, billingEnd);
    // ★ 2026-05-08 정책 변경: 입고 다음달 1일부터 기간 산정 (입고당월 무상)
    const monthsElapsed = _monthsAfterInbound(inYM, billingYM);

    const freeMonths = owner.freeMonths || 0;
    const extraMonths = owner.extraMonths || 0;
    const totalFreeMonths = freeMonths + extraMonths;

    // 무상 기간 이내면 보관료 0
    let normalMonths = 0;
    let surchargeMonths = 0;
    if (monthsElapsed > freeMonths) {
      // 정상가 적용 가능 개월 (계약서 패턴 — ratePerWp > 0)
      normalMonths = Math.min(Math.max(0, monthsElapsed - freeMonths), extraMonths);
      // 총 무상 기간 초과 = 할증 청구
      surchargeMonths = Math.max(0, monthsElapsed - totalFreeMonths);
    }

    const totalWp = item.qty * item.watt;
    const ratePerWp = owner.ratePerWp || 0;
    const surchargeAddPerWp = owner.surchargeAddPerWp || 0;

    let normalFee = 0;
    let surchargeFee = 0;
    let surchargeMode;

    if (ratePerWp > 0) {
      // 계약서 패턴: 정상가 + 초과 시 추가
      normalFee = totalWp * ratePerWp * normalMonths;
      if (surchargeAddPerWp > 0) {
        surchargeFee = totalWp * (ratePerWp + surchargeAddPerWp) * surchargeMonths;
        surchargeMode = 'add';
      } else if (owner.surchargeRate > 1) {
        // ▷ 하위 호환: 배수 모델
        surchargeFee = totalWp * ratePerWp * surchargeMonths * owner.surchargeRate;
        surchargeMode = 'multiply';
      } else {
        surchargeFee = totalWp * ratePerWp * surchargeMonths;
        surchargeMode = 'none';
      }
    } else {
      // ★ 신규 무상 정책: 정상가 0, 5개월 초과 시 매월 0.5원/Wp 만 청구
      surchargeFee = totalWp * surchargeAddPerWp * surchargeMonths;
      surchargeMode = 'free-then-surcharge';
    }

    const total = Math.round(normalFee + surchargeFee);

    return {
      itemId: item.id,
      ownerId: item.ownerId,
      model: item.model,
      qty: item.qty,
      watt: item.watt,
      totalWp,
      inDate,
      billingEnd,
      billingYM,
      totalDays,
      // 월 단위 정보 (★ 신규)
      monthsElapsed,
      freeMonths,
      extraMonths,
      totalFreeMonths,
      normalMonths,
      surchargeMonths,
      // 하위 호환 (일 단위 — 더 이상 사용 안 함)
      freeDays: freeMonths * 30,
      normalDays: normalMonths * 30,
      surchargeDays: surchargeMonths * 30,
      ratePerWp,
      surchargeAddPerWp,
      surchargeRate: owner.surchargeRate || 0,
      surchargeMode,
      normalFee: Math.round(normalFee),
      surchargeFee: Math.round(surchargeFee),
      total
    };
  }

  // 화주의 월 보관료 합계 (★ 2026-05-08: 물류대행비 + 매월 말일 정산)
  function calcMonthlyBilling(ownerId, yearMonth) {
    const owner = getOwner(ownerId);
    if (!owner) return null;
    // 매월 말일 정산 — billingEnd 는 해당 월 말일
    const billingEnd = _monthEnd(yearMonth);
    // 해당 월 말 시점에 보관 중이거나 출고된 항목들
    const items = inventory.filter(r => {
      if (r.ownerId !== ownerId) return false;
      if (r.type !== 'inbound') return false;
      if (r.date > billingEnd) return false;
      return true;
    });

    let storageFee = 0;       // 보관료 (정상 + 할증)
    let logisticsFee = 0;     // ★ 신규: 물류대행비 (입고당월 1회 청구)
    let inboundFee = 0;       // 옵션 입고 수수료
    let outboundFee = 0;      // 옵션 출고 수수료
    const breakdown = [];
    const logisticsBreakdown = [];

    items.forEach(r => {
      // ★ 물류대행비 — 입고당월에만 청구 (입고수량 × 용량 × 계약단가)
      if (r.date.startsWith(yearMonth) && (owner.logisticsContractRatePerWp || 0) > 0) {
        const fee = (r.qty || 0) * (r.watt || 0) * (owner.logisticsContractRatePerWp || 0);
        logisticsFee += fee;
        logisticsBreakdown.push({
          itemId: r.id,
          model: r.model,
          qty: r.qty,
          watt: r.watt,
          totalWp: (r.qty || 0) * (r.watt || 0),
          ratePerWp: owner.logisticsContractRatePerWp,
          fee: Math.round(fee)
        });
      }
      // 보관료 (월 단위 계산)
      const fee = calcStorageFee(r, billingEnd);
      if (fee && fee.total > 0) {
        storageFee += fee.total;
        breakdown.push(fee);
      }
      // 입고 수수료 (옵션, 해당 월 입고만)
      if (r.date.startsWith(yearMonth)) {
        inboundFee += (r.qty * r.watt) * (owner.inboundFeePerWp || 0);
      }
    });
    // 출고 수수료 (옵션)
    inventory.forEach(r => {
      if (r.ownerId !== ownerId || r.type !== 'outbound') return;
      if (!r.date.startsWith(yearMonth)) return;
      outboundFee += (r.qty * r.watt) * (owner.outboundFeePerWp || 0);
    });
    const subtotal = storageFee + Math.round(logisticsFee) + Math.round(inboundFee) + Math.round(outboundFee);
    const vat = Math.round(subtotal * 0.1);
    return {
      ownerId, ownerName: owner.name,
      billingMonth: yearMonth,
      billingEnd,                          // ★ 월말 정산일
      itemCount: items.length,
      storageFee,
      logisticsFee: Math.round(logisticsFee),  // ★ 신규
      inboundFee: Math.round(inboundFee),
      outboundFee: Math.round(outboundFee),
      subtotal,
      vat,
      total: subtotal + vat,
      breakdown,
      logisticsBreakdown                   // ★ 신규
    };
  }

  // 청구서 발행
  function issueBilling(ownerId, yearMonth, opts) {
    opts = opts || {};
    const calc = calcMonthlyBilling(ownerId, yearMonth);
    if (!calc) throw new Error('계산 실패');
    if (calc.total <= 0) {
      if (!confirm('청구할 금액이 0원입니다. 그래도 발행하시겠습니까?')) return null;
    }
    // ★ 매월 말일 정산 정책 — 발행일은 청구월 말일, 결제 마감은 익월 말일 기본
    const issueDateDefault = _monthEnd(yearMonth);
    const nextYM = (() => {
      const [y, m] = yearMonth.split('-').map(Number);
      const d = new Date(y, m, 1);  // 익월 1일
      return d.toISOString().slice(0, 7);
    })();
    const dueDateDefault = _monthEnd(nextYM);
    const b = {
      id: _genId('BL'),
      ownerId, ownerName: calc.ownerName,
      billingMonth: yearMonth,
      ...calc,
      invoiceNo: opts.invoiceNo || ('TP-' + yearMonth.replace('-','') + '-' + (billing.filter(x => x.billingMonth === yearMonth).length + 1).toString().padStart(3,'0')),
      issueDate: opts.issueDate || issueDateDefault,
      dueDate: opts.dueDate || dueDateDefault,
      paidDate: null,
      status: '발행',
      createdAt: new Date().toISOString(),
      _ts: Date.now()
    };
    billing.push(b);
    _save(KEY_BILLING, billing);
    return b;
  }

  function markBillingPaid(billingId, paidDate) {
    const i = billing.findIndex(b => b.id === billingId);
    if (i < 0) return null;
    billing[i].paidDate = paidDate || _today();
    billing[i].status = '입금완료';
    _save(KEY_BILLING, billing);
    return billing[i];
  }

  // ── 통계 ────────────────────────────────────────
  function summary() {
    const ownerCount = owners.length;
    const totalItems = inventory.filter(r => r.type === 'inbound').length;
    const totalWp = inventory.reduce((s, r) => {
      if (r.type !== 'inbound') return s;
      const out = inventory.filter(o => o.relatedInboundId === r.id && o.type === 'outbound')
        .reduce((s2, o) => s2 + o.qty, 0);
      return s + (r.qty - out) * r.watt;
    }, 0);
    const totalMW = totalWp / 1000000;
    const thisMonth = _today().slice(0,7);
    const thisMonthBilling = billing.filter(b => b.billingMonth === thisMonth)
      .reduce((s, b) => s + (b.total || 0), 0);
    const unpaid = billing.filter(b => b.status === '발행')
      .reduce((s, b) => s + (b.total || 0), 0);
    return { ownerCount, totalItems, totalMW, thisMonthBilling, unpaid };
  }

  // ============================================================
  //  UI
  // ============================================================
  function _injectUI() {
    if (document.getElementById('erp-tp-modal')) return;
    const css = `
      #erp-tp-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:2vh;}
      #erp-tp-modal.open{display:flex;}
      .tp-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:97%;max-width:1300px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;}
      .tp-hd{padding:14px 20px;background:linear-gradient(135deg,#7b1fa2,#9c27b0);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .tp-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}

      .tp-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .tp-tab{padding:9px 18px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.88em;}
      .tp-tab.active{background:#7b1fa2;color:#fff;border-color:#7b1fa2;font-weight:700;}

      .tp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .tp-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #7b1fa2;}
      .tp-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .tp-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}

      .tp-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .tp-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .tp-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .tp-tbl tr.tp-row{border-left:4px solid #7b1fa2;}

      .tp-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#fff;padding:14px;border-radius:8px;}
      .tp-form-full{grid-column:span 2;}
      .tp-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:3px;}
      .tp-form input, .tp-form select, .tp-form textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}

      .tp-policy{background:#f3e5f5;padding:12px;border-radius:8px;border-left:4px solid #7b1fa2;margin:10px 0;font-size:0.86em;line-height:1.6;}
      .tp-policy strong{color:#7b1fa2;}

      .tp-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .tp-btn-primary{background:#7b1fa2;color:#fff;}
      .tp-btn-success{background:#27ae60;color:#fff;}
      .tp-btn-danger{background:#c62828;color:#fff;}
      .tp-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}

      .tp-fee-detail{background:#fffde7;border-left:4px solid #f9a825;padding:10px;border-radius:6px;margin-top:8px;font-size:0.82em;line-height:1.6;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-tp-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-tp-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="tp-box">
        <div class="tp-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">🤝 타사 위탁 재고 관리</h4>
          <div>
            <button class="tp-btn tp-btn-ghost" onclick="document.getElementById('erp-tp-modal').classList.remove('open')">✕</button>
          </div>
        </div>
        <div class="tp-bd" id="tp-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);
  }

  let _curTab = 'overview';
  let _selectedOwnerId = null;
  let _selectedBillOwnerId = null;       // ★ 보관료 청구 발행 이력 필터용

  function _renderTabs() {
    const tabs = [
      { key:'overview',  label:'📊 개요' },
      { key:'owners',    label:'🏢 화주 관리' },
      { key:'inventory', label:'📦 위탁 재고' },
      { key:'billing',   label:'💰 보관료 청구' },
      { key:'revenue',   label:'💹 수익 분석' }
    ];
    return `<div class="tp-tabs">${tabs.map(t =>
      `<button class="tp-tab ${_curTab===t.key?'active':''}" data-tab="${t.key}">${t.label}</button>`
    ).join('')}</div>`;
  }

  function _renderOverview() {
    const s = summary();
    const recentBilling = billing.slice().reverse().slice(0, 5);
    return `
      ${_renderTabs()}
      <div class="tp-stats">
        <div class="tp-stat"><div class="tp-stat-l">등록 화주</div><div class="tp-stat-v">${s.ownerCount}</div></div>
        <div class="tp-stat"><div class="tp-stat-l">위탁 재고</div><div class="tp-stat-v">${_fmt(s.totalItems)}건</div></div>
        <div class="tp-stat"><div class="tp-stat-l">총 보관량</div><div class="tp-stat-v" style="color:#7b1fa2;">${s.totalMW.toFixed(2)}MW</div></div>
        <div class="tp-stat"><div class="tp-stat-l">이번달 청구</div><div class="tp-stat-v">${_fmt(s.thisMonthBilling)}원</div></div>
        <div class="tp-stat"><div class="tp-stat-l">미수금</div><div class="tp-stat-v" style="color:#c62828;">${_fmt(s.unpaid)}원</div></div>
      </div>

      <div class="tp-policy">
        <strong>📌 위탁 재고는 자체 재고와 분리됩니다.</strong><br>
        ATP 가용재고 계산·매입 분석에 포함되지 않으며, 보관료는 영업외수익으로 분류됩니다.
      </div>

      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="tp-btn" style="background:linear-gradient(135deg,#0d47a1,#1565c0);color:#fff;padding:10px 16px;font-size:0.92em;" onclick="if(window.logistics)window.logistics.open();else alert('logistics 모듈 미로드')">
          🚚 물류비 관리 — 거래명세서 업로드 + 매칭 분석
        </button>
      </div>

      <div style="margin-top:14px;">
        <h3 style="font-size:1em;color:#1a1a2e;margin:0 0 8px;">📋 최근 청구</h3>
        ${recentBilling.length === 0 ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">청구 이력 없음</div>' :
          `<table class="tp-tbl">
            <thead><tr><th>발행일</th><th>화주</th><th>청구월</th><th style="text-align:right;">금액</th><th>상태</th></tr></thead>
            <tbody>${recentBilling.map(b => `<tr>
              <td>${_e(b.issueDate)}</td>
              <td>${_e(b.ownerName)}</td>
              <td>${_e(b.billingMonth)}</td>
              <td style="text-align:right;font-weight:700;">${_fmt(b.total)}원</td>
              <td><span style="padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;background:${b.status==='입금완료'?'#e8f5e9':'#fff3e0'};color:${b.status==='입금완료'?'#27ae60':'#e65100'};">${_e(b.status)}</span></td>
            </tr>`).join('')}</tbody>
          </table>`}
      </div>
    `;
  }

  function _renderOwners() {
    return `
      ${_renderTabs()}
      <div style="margin-bottom:8px;">
        <button class="tp-btn tp-btn-primary" data-act="tp-owner-new">➕ 새 화주 등록</button>
      </div>
      ${owners.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">등록된 화주 없음</div>'
        : `<table class="tp-tbl">
          <thead><tr>
            <th>화주명</th><th>사업자번호</th><th>담당자</th><th>연락처</th>
            <th style="text-align:right;">물류단가 (원/Wp)</th>
            <th style="text-align:right;">보관 단가 (원/Wp/월)</th>
            <th>무상</th><th>추가</th><th>초과 할증</th><th>액션</th>
          </tr></thead>
          <tbody>${owners.map(o => `<tr class="tp-row">
            <td><strong>${_e(o.name)}</strong></td>
            <td>${_e(o.bizNo||'-')}</td>
            <td>${_e(o.contact||'-')}</td>
            <td>${_e(o.phone||'-')}<br><span style="font-size:0.78em;color:#888;">${_e(o.email||'')}</span></td>
            <td style="text-align:right;font-weight:700;color:#0d47a1;">${o.logisticsContractRatePerWp ? _fmt(o.logisticsContractRatePerWp)+'원' : '-'}</td>
            <td style="text-align:right;font-weight:700;color:#7b1fa2;">${_fmt(o.ratePerWp)}원</td>
            <td>${o.freeMonths||0}개월</td>
            <td>+${o.extraMonths||0}개월</td>
            <td style="text-align:right;color:${(o.surchargeAddPerWp||0)>0?'#c62828':'#888'};">${(o.surchargeAddPerWp||0)>0?'+'+o.surchargeAddPerWp+'원':'-'}${o.surchargeRate>1?'<br><span style="font-size:0.78em;color:#c62828;">×'+o.surchargeRate+'</span>':''}</td>
            <td>
              <button class="tp-btn tp-btn-ghost" data-act="tp-owner-edit" data-id="${_ea(o.id)}">📝</button>
              <button class="tp-btn tp-btn-danger" data-act="tp-owner-delete" data-id="${_ea(o.id)}">🗑</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`}
    `;
  }

  function _renderOwnerEditor(id) {
    const o = id ? getOwner(id) : {
      name: '', bizNo: '', ceoName: '', contact: '', phone: '', email: '', address: '',
      contractStart: _today(), contractEnd: '', autoRenew: true, renewMonths: 12,
      // ★ 2026-05-08 정책 default
      //   - 물류대행비: 입고 시 1회 (수량×용량×계약단가) — 사용자가 단가 입력
      //   - 무상 보관: 3개월 + 추가 2개월 = 총 5개월 (★ 입고 다음달 1일부터)
      //   - 5개월 초과 시 매월 0.5원/Wp 추가 청구
      //   - 매월 말일 정산
      logisticsContractRatePerWp: 0,                   // ★ 신규: 입고 시 물류대행비 단가
      ratePerWp: 0,                                    // 무상 정책 default (계약서 패턴 시 7.8 등 입력)
      freeMonths: 3, extraMonths: 2,
      surchargeAddPerWp: 0.5, surchargeRate: 0,
      inboundFeePerWp: 0, outboundFeePerWp: 0,
      paymentTerms: '매월 말일 정산 / 익월 말일 입금',
      bankName: '하나은행', bankAccount: '', accountHolder: '',
      vatIncluded: false, notes: '',
      contractPdf: null, contractFileName: ''
    };
    return `
      ${_renderTabs()}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#7b1fa2;">${id ? '화주 편집' : '새 화주 등록'} ${o.name?'· '+_e(o.name):''}</h3>
        <div>
          <button class="tp-btn tp-btn-ghost" data-act="tp-back-owners">← 목록</button>
          ${id ? '' : `<button class="tp-btn tp-btn-success" data-act="tp-import-contract">📄 계약서 업로드 (자동 입력)</button>`}
          <button class="tp-btn tp-btn-primary" data-act="tp-owner-save" data-id="${_ea(id||'')}">💾 저장</button>
        </div>
      </div>

      ${id ? '' : `<div style="background:linear-gradient(135deg,#e8f5e9,#fffde7);border:2px dashed #f9a825;border-radius:8px;padding:12px;margin-bottom:12px;font-size:0.86em;line-height:1.5;">
        💡 <strong>계약서 PDF가 있으면 [📄 계약서 업로드] 버튼을 클릭하세요.</strong><br>
        AI가 자동으로 회사명·사업자번호·계약 기간·WP 단가·계좌 정보를 추출해 입력합니다.
      </div>`}

      <h4 style="margin:14px 0 6px;color:#5d4037;font-size:0.94em;">🏢 회사 정보</h4>
      <div class="tp-form" id="tp-owner-form">
        <div class="tp-form-full"><label>화주 회사명 *</label><input data-f="name" value="${_ea(o.name)}" placeholder="에스씨지솔루션즈㈜"></div>
        <div><label>사업자번호</label><input data-f="bizNo" value="${_ea(o.bizNo)}" placeholder="123-45-67890"></div>
        <div><label>대표이사</label><input data-f="ceoName" value="${_ea(o.ceoName)}"></div>
        <div><label>담당자</label><input data-f="contact" value="${_ea(o.contact)}"></div>
        <div><label>연락처</label><input data-f="phone" value="${_ea(o.phone)}"></div>
        <div class="tp-form-full"><label>이메일</label><input data-f="email" type="email" value="${_ea(o.email)}"></div>
        <div class="tp-form-full"><label>주소</label><input data-f="address" value="${_ea(o.address)}"></div>
      </div>

      <h4 style="margin:18px 0 6px;color:#5d4037;font-size:0.94em;">📅 계약 기간</h4>
      <div class="tp-form">
        <div><label>계약 시작일</label><input data-f="contractStart" type="date" value="${_ea(o.contractStart)}"></div>
        <div><label>계약 종료일</label><input data-f="contractEnd" type="date" value="${_ea(o.contractEnd)}"></div>
        <div><label><input type="checkbox" data-f="autoRenew" ${o.autoRenew?'checked':''}> 자동 1년 연장 (만료 1개월 전 미통지 시)</label></div>
        <div><label>연장 기간 (개월)</label><input data-f="renewMonths" type="number" value="${o.renewMonths||12}"></div>
      </div>

      <div class="tp-policy" style="margin-top:14px;">
        <strong>💰 위탁 보관 정책 (2026-05 기준)</strong><br>
        ① <strong>물류대행비</strong> = 입고수량 × 용량(W) × 계약단가(원/Wp) — <em>입고 시 1회 청구</em><br>
        ② <strong>무상 보관</strong>: 입고일부터 3개월 이내 출고 (무상 2개월 추가 가능) → 총 <strong>5개월 무상</strong> (★ <span style="color:#c62828;">입고 다음달 1일부터 계산</span>)<br>
        ③ <strong>5개월 초과</strong>: 매월 WP당 <strong>0.5원</strong> 추가 청구<br>
        ④ <strong>화주 부담 물류비는 매월 말일 정산</strong><br><br>
        <strong>예시</strong>: 600W 모듈 1,000매(600,000Wp), 계약단가 1원/Wp, 2026-01-15 입고, 2026-08 보관 중<br>
        &nbsp;&nbsp;물류대행비 (1회) = 1,000 × 600 × 1 = <strong>600,000원</strong> (2026-01 청구)<br>
        &nbsp;&nbsp;<strong>입고당월(2026-01)</strong>: 무상 (입고 다음달부터 계산)<br>
        &nbsp;&nbsp;무상 5개월 (2026-02 ~ 2026-06): 0원<br>
        &nbsp;&nbsp;초과 (2026-07 ~ 2026-08): 2개월 × 600,000 × 0.5 = <strong>600,000원</strong>
      </div>

      <h4 style="margin:14px 0 6px;color:#5d4037;font-size:0.94em;">🚚 물류대행비 (입고 시 1회)</h4>
      <div class="tp-form">
        <div class="tp-form-full"><label>계약단가 (원/Wp) ★ — 수량×용량×단가로 청구</label><input data-f="logisticsContractRatePerWp" type="number" step="0.01" value="${o.logisticsContractRatePerWp||0}" placeholder="1.0">
          <div style="font-size:0.78em;color:#888;margin-top:3px;">예: 1원 입력 시 600W × 1,000매 입고 시 600,000원 1회 청구. 0 입력 시 물류대행비 없음.</div></div>
      </div>

      <h4 style="margin:14px 0 6px;color:#5d4037;font-size:0.94em;">📦 보관료 단가 (월 단위)</h4>
      <div class="tp-form">
        <div><label>월 정상 단가 (원/Wp/월)</label><input data-f="ratePerWp" type="number" step="0.1" value="${o.ratePerWp||0}" placeholder="0">
          <div style="font-size:0.78em;color:#888;margin-top:3px;">신규 정책(무상 5개월 후 0.5원만)은 0 입력. 계약서 패턴(7.8원 등)은 단가 입력.</div></div>
        <div><label>무상 보관 기간 (개월) ★</label><input data-f="freeMonths" type="number" value="${o.freeMonths||0}" placeholder="3">
          <div style="font-size:0.74em;color:#888;margin-top:2px;">입고 다음달 1일부터 계산</div></div>
        <div><label>무상 추가 기간 (개월) ★</label><input data-f="extraMonths" type="number" value="${o.extraMonths||0}" placeholder="2"></div>
        <div><label>초과 시 매월 추가 단가 (원/Wp/월) ★</label><input data-f="surchargeAddPerWp" type="number" step="0.1" value="${o.surchargeAddPerWp||0}" placeholder="0.5">
          <div style="font-size:0.78em;color:#888;margin-top:3px;">"5개월 초과 시 매월 0.5원" 같은 절대값.</div></div>
        <div><label>입고 수수료 (원/Wp, 옵션)</label><input data-f="inboundFeePerWp" type="number" step="0.1" value="${o.inboundFeePerWp||0}"></div>
        <div><label>출고 수수료 (원/Wp, 옵션)</label><input data-f="outboundFeePerWp" type="number" step="0.1" value="${o.outboundFeePerWp||0}"></div>
      </div>

      <h4 style="margin:18px 0 6px;color:#5d4037;font-size:0.94em;">💳 결제 정보</h4>
      <div class="tp-form">
        <div class="tp-form-full"><label>결제 조건</label><input data-f="paymentTerms" value="${_ea(o.paymentTerms||'')}"></div>
        <div><label>입금 은행</label><input data-f="bankName" value="${_ea(o.bankName)}" placeholder="하나은행"></div>
        <div><label>계좌번호</label><input data-f="bankAccount" value="${_ea(o.bankAccount)}" placeholder="724-910031-56604"></div>
        <div><label>예금주</label><input data-f="accountHolder" value="${_ea(o.accountHolder)}" placeholder="바로 주식회사"></div>
        <div><label><input type="checkbox" data-f="vatIncluded" ${o.vatIncluded?'checked':''}> 단가에 VAT 포함</label></div>
        <div class="tp-form-full"><label>비고</label><textarea data-f="notes" rows="2">${_e(o.notes)}</textarea></div>
      </div>

      ${o.contractPdf ? `<div style="margin-top:12px;background:#e8f5e9;padding:10px;border-radius:6px;border-left:4px solid #27ae60;font-size:0.86em;">
        📄 <strong>계약서 첨부됨:</strong> ${_e(o.contractFileName||'contract.pdf')}
        <button class="tp-btn tp-btn-ghost" onclick="window.thirdParty._openContractPdf('${_ea(o.id||'')}')" style="margin-left:6px;">🔍 보기</button>
      </div>` : ''}
    `;
  }

  // ★ 화주별 재고현황 요약 — 입고-출고 차이 + 모델별 합산
  function _renderOwnerStockSummary() {
    if (owners.length === 0) return '';

    // 화주 × 모델 단위 집계
    const stockMap = {};   // ownerId → { ownerName, models: {model: {qty, watt, mfr, inDates: [], outDates: []}}, totalQty, totalWp, inboundDays, outboundCnt }
    owners.forEach(o => {
      stockMap[o.id] = {
        ownerId: o.id,
        ownerName: o.name,
        models: {},
        totalQty: 0,
        totalWp: 0,
        inboundCount: 0,
        outboundCount: 0,
        firstInDate: null,    // 가장 오래된 입고일
        contractRate: o.logisticsContractRatePerWp || 0,
        freeMonths: (o.freeMonths || 0) + (o.extraMonths || 0)
      };
    });

    inventory.forEach(r => {
      const s = stockMap[r.ownerId];
      if (!s) return;
      const k = r.model || '(미지정)';
      if (!s.models[k]) s.models[k] = { model: k, mfr: r.mfr, watt: r.watt, qty: 0, totalWp: 0, lastInDate: null };
      const m = s.models[k];
      m.watt = r.watt || m.watt;
      m.mfr = r.mfr || m.mfr;
      if (r.type === 'inbound') {
        m.qty += (r.qty || 0);
        s.inboundCount++;
        if (!s.firstInDate || r.date < s.firstInDate) s.firstInDate = r.date;
        if (!m.lastInDate || r.date > m.lastInDate) m.lastInDate = r.date;
      } else {
        m.qty -= (r.qty || 0);
        s.outboundCount++;
      }
      m.totalWp = m.qty * (m.watt || 0);
    });

    // 합계 계산 + 0 이하 모델 제외
    Object.values(stockMap).forEach(s => {
      const arr = Object.values(s.models).filter(m => m.qty > 0);
      s.modelsArr = arr;
      s.modelCount = arr.length;
      s.totalQty = arr.reduce((sum, m) => sum + m.qty, 0);
      s.totalWp = arr.reduce((sum, m) => sum + m.totalWp, 0);
    });

    // 재고가 있거나 입출고 이력이 있는 화주만 표시 (등록된 화주 중 활동 있는 것)
    const activeOwners = Object.values(stockMap).filter(s => s.inboundCount > 0 || s.outboundCount > 0);

    if (activeOwners.length === 0) {
      return `<div style="background:#fff;padding:14px;border-radius:8px;color:#888;text-align:center;border:1px dashed #ddd;">
        📦 위탁 입고/출고 이력이 있는 화주가 없습니다.
      </div>`;
    }

    return `
      <h3 style="font-size:1em;color:#1a1a2e;margin:0 0 8px;">📦 화주별 재고현황 — ${activeOwners.length}개 화주</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;">
        ${activeOwners.map(s => {
          const freeRem = _freeStorageDaysRemaining(s);  // 무상기간 남은/초과 일수
          return `<div style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid ${s.totalQty>0?'#7b1fa2':'#bbb'};cursor:pointer;" onclick="window.thirdParty._setFilterOwner('${_ea(s.ownerId)}')">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
              <div>
                <div style="font-weight:700;font-size:0.94em;color:#1a1a2e;">🏢 ${_e(s.ownerName)}</div>
                <div style="font-size:0.74em;color:#888;margin-top:2px;">계약단가 ${s.contractRate}원/Wp · 무상 ${s.freeMonths}개월</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.2em;font-weight:900;color:${s.totalQty>0?'#7b1fa2':'#bbb'};">${_fmt(s.totalQty)}매</div>
                <div style="font-size:0.74em;color:#666;">${(s.totalWp/1000000).toFixed(2)}MW</div>
              </div>
            </div>
            ${s.modelsArr.length === 0
              ? `<div style="font-size:0.78em;color:#bbb;font-style:italic;">현재 보관 재고 없음 (이력 ${s.inboundCount}건 입고 / ${s.outboundCount}건 출고)</div>`
              : `<div style="border-top:1px solid #f0f0f0;padding-top:6px;margin-top:4px;">
                  ${s.modelsArr.slice(0, 5).map(m => `<div style="font-size:0.82em;display:flex;justify-content:space-between;padding:2px 0;">
                    <span style="color:#444;">${_e(m.model)}${m.mfr?' <span style="color:#aaa;">('+_e(m.mfr)+')</span>':''}</span>
                    <span style="font-weight:700;color:#1565c0;">${_fmt(m.qty)}매 · ${(m.totalWp/1000).toFixed(1)}kW</span>
                  </div>`).join('')}
                  ${s.modelsArr.length > 5 ? `<div style="font-size:0.78em;color:#888;text-align:right;">... 외 ${s.modelsArr.length-5}개 모델</div>` : ''}
                </div>`}
            ${freeRem ? `<div style="font-size:0.78em;margin-top:6px;text-align:right;${freeRem.expired?'color:#c62828;font-weight:700;':'color:#27ae60;'}">
              ${freeRem.expired
                ? `⚠️ 무상기간 만료 ${freeRem.days}일 경과`
                : `⏳ 무상기간 ${freeRem.days}일 남음`}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:0.76em;color:#888;margin-top:6px;">
        💡 카드 클릭 → 해당 화주만 필터 적용. 모듈 표시는 <strong>수량 · 재고 용량(kW)</strong>.
      </div>
    `;
  }

  // 무상 기간 남은 일수 계산 — 입고 다음달 1일부터 freeMonths+extraMonths 개월
  //   반환: null (입고 없음) | { expired: false, days: 남은일수 } | { expired: true, days: 초과일수 }
  function _freeStorageDaysRemaining(s) {
    if (!s.firstInDate || s.totalQty <= 0) return null;
    // 입고 다음달 1일
    const inDate = new Date(s.firstInDate);
    const startYear = inDate.getFullYear();
    const startMonth = inDate.getMonth() + 1;  // 0-base → 1-base + 1 (다음달)
    const freeStart = new Date(startYear, startMonth, 1);
    // 무상 종료일 = 무상 시작 + freeMonths 개월 - 1일
    const freeEnd = new Date(freeStart.getFullYear(), freeStart.getMonth() + s.freeMonths, 0);
    // 오늘
    const today = new Date(_today());
    const diffDays = Math.floor((freeEnd - today) / 86400000);
    if (diffDays >= 0) return { expired: false, days: diffDays };
    return { expired: true, days: -diffDays };
  }

  // 무상 기간 초과 여부 — 입고 다음달 1일부터 freeMonths+extraMonths 개월 초과
  function _checkStorageExpired(s) {
    if (!s.firstInDate || s.totalQty <= 0) return false;
    const inYM = s.firstInDate.slice(0, 7);
    const now = _today().slice(0, 7);
    const monthsElapsed = _monthsAfterInbound(inYM, now);
    return monthsElapsed > s.freeMonths;
  }

  function _renderInventory() {
    const filter = _selectedOwnerId ? { ownerId: _selectedOwnerId } : {};
    const rows = listInventory(filter).slice().reverse();

    // ★ 화주별 재고현황 — 입고 수량 - 출고 수량
    const ownerStockHtml = _renderOwnerStockSummary();

    return `
      ${_renderTabs()}

      ${ownerStockHtml}

      <div style="display:flex;gap:8px;margin:14px 0 8px;align-items:center;flex-wrap:wrap;">
        <h3 style="font-size:1em;color:#1a1a2e;margin:0;">📋 위탁 입출고 이력</h3>
        <button class="tp-btn tp-btn-primary" data-act="tp-inv-new" style="margin-left:auto;">➕ 위탁 입고/출고 등록</button>
        <select id="tp-filter-owner" onchange="window.thirdParty._setFilterOwner(this.value)" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
          <option value="">전체 화주</option>
          ${owners.map(o => `<option value="${_ea(o.id)}" ${_selectedOwnerId===o.id?'selected':''}>${_e(o.name)}</option>`).join('')}
        </select>
      </div>
      ${rows.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">위탁 재고 이력 없음</div>'
        : `<table class="tp-tbl">
          <thead><tr>
            <th>일자</th><th>구분</th><th>화주</th><th>모델</th><th>제조사</th>
            <th style="text-align:right;">수량</th><th style="text-align:right;">총 Wp</th>
            <th>위치</th><th>상태</th><th>액션</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr class="tp-row">
            <td>${_e(r.date)}</td>
            <td><span style="background:${r.type==='inbound'?'#e8f5e9':'#fff3e0'};color:${r.type==='inbound'?'#27ae60':'#e65100'};padding:2px 8px;border-radius:4px;font-size:0.78em;font-weight:700;">${r.type==='inbound'?'⬇️ 입고':'⬆️ 출고'}</span></td>
            <td>${_e(r.ownerName)}</td>
            <td>${_e(r.model)}</td>
            <td>${_e(r.mfr||'-')}</td>
            <td style="text-align:right;font-weight:700;">${_fmt(r.qty)}매</td>
            <td style="text-align:right;color:#7b1fa2;">${_fmt(r.qty * r.watt)}</td>
            <td>${_e(r.warehouseName||'-')}${r.zoneName?' · '+_e(r.zoneName):''}</td>
            <td>${_e(r.status)}</td>
            <td>
              <button class="tp-btn tp-btn-danger" data-act="tp-inv-delete" data-id="${_ea(r.id)}">🗑</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`}
    `;
  }

  function _renderInventoryEditor() {
    if (owners.length === 0) {
      return `${_renderTabs()}<div style="background:#ffebee;padding:20px;border-radius:8px;color:#c62828;">⚠️ 먼저 화주를 등록해주세요.</div>`;
    }
    // warehouseMaster 의 zone 가져오기 — '타사 위탁' / '비어있음' 유형만 노출
    let zoneOptions = '<option value="">(위치 선택)</option>';
    let zoneCount = 0;
    let zoneWarning = '';
    if (typeof window.warehouseMaster !== 'undefined') {
      try {
        const tpZones   = window.warehouseMaster.getZonesByType ? window.warehouseMaster.getZonesByType('thirdparty') : [];
        const freeZones = window.warehouseMaster.getZonesByType ? window.warehouseMaster.getZonesByType('free')       : [];
        const ZONE_ICONS = { thirdparty: '🤝', free: '⬜' };
        const ZONE_LABELS = { thirdparty: '타사 위탁', free: '비어있음' };
        // 창고별 그룹핑 — <optgroup> 으로 가독성 향상
        const byWarehouse = {};
        [...tpZones, ...freeZones].forEach(z => {
          if (!byWarehouse[z.warehouseId]) byWarehouse[z.warehouseId] = { name: z.warehouseName, zones: [] };
          byWarehouse[z.warehouseId].zones.push(z);
          zoneCount++;
        });
        zoneOptions += Object.values(byWarehouse).map(grp => `<optgroup label="🏭 ${_e(grp.name)}">
          ${grp.zones.map(z => {
            const icon = ZONE_ICONS[z.type] || '⬜';
            const lbl = ZONE_LABELS[z.type] || z.type;
            return `<option value="${_ea(z.warehouseId+'|'+z.zoneId)}">${icon} ${_e(z.zoneName)} · ${lbl} (${_fmt(z.area)}m²)</option>`;
          }).join('')}
        </optgroup>`).join('');
        if (zoneCount === 0) {
          zoneWarning = `<div style="background:#fff3e0;border-left:4px solid #f9a825;padding:10px;border-radius:6px;margin-top:6px;font-size:0.84em;line-height:1.5;">
            ⚠️ <strong>등록된 보관 구역이 없습니다.</strong><br>
            <strong>창고 마스터</strong> 탭에서 창고를 만들고 도면에 구역을 그린 뒤,
            구역 유형을 <strong>"🤝 타사 위탁"</strong> 또는 <strong>"⬜ 비어있음"</strong> 으로 지정하세요.
          </div>`;
        }
      } catch (e) {
        zoneWarning = `<div style="background:#ffebee;color:#c62828;padding:10px;border-radius:6px;margin-top:6px;font-size:0.84em;">⚠️ 구역 정보 로드 실패: ${_e(e.message)}</div>`;
      }
    }
    return `
      ${_renderTabs()}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:#7b1fa2;">위탁 입출고 등록</h3>
        <div>
          <button class="tp-btn tp-btn-ghost" data-act="tp-back-inv">← 목록</button>
          <button class="tp-btn tp-btn-primary" data-act="tp-inv-save">💾 저장</button>
        </div>
      </div>
      <div class="tp-form" id="tp-inv-form">
        <div><label>구분 *</label><select data-f="type">
          <option value="inbound">⬇️ 입고 (위탁)</option>
          <option value="outbound">⬆️ 출고 (반출)</option>
        </select></div>
        <div><label>일자</label><input data-f="date" type="date" value="${_today()}"></div>
        <div class="tp-form-full"><label>화주 *</label><select data-f="ownerId">
          ${owners.map(o => `<option value="${_ea(o.id)}">${_e(o.name)}</option>`).join('')}
        </select></div>
        <div><label>모델명 *</label><input data-f="model" placeholder="JKM635N-78HL4-BDV-S1"></div>
        <div><label>제조사</label><input data-f="mfr" placeholder="진코솔라"></div>
        <div><label>제품용량 (W)</label><input data-f="watt" type="number" placeholder="635"></div>
        <div><label>수량 (매)</label><input data-f="qty" type="number" placeholder="1000"></div>
        <div class="tp-form-full"><label>보관 위치 (창고·구역) — 등록된 구역 ${zoneCount}개</label><select data-f="zoneSelect">${zoneOptions}</select>
          <div style="font-size:0.78em;color:#888;margin-top:3px;">창고 마스터에서 <strong>"🤝 타사 위탁"</strong> 또는 <strong>"⬜ 비어있음"</strong> 유형으로 등록된 구역만 선택 가능</div>
          ${zoneWarning}
        </div>
        <div><label>B/L 번호</label><input data-f="bl"></div>
        <div><label>참조번호</label><input data-f="ref"></div>
        <div class="tp-form-full"><label>비고</label><textarea data-f="notes" rows="2"></textarea></div>
      </div>
    `;
  }

  function _renderBilling() {
    // ★ 화주 필터 적용 (_selectedBillOwnerId)
    const filtered = _selectedBillOwnerId
      ? billing.filter(b => b.ownerId === _selectedBillOwnerId)
      : billing;
    const sorted = filtered.slice().sort((a,b) => (b.billingMonth||'').localeCompare(a.billingMonth||''));
    return `
      ${_renderTabs()}
      <div style="margin-bottom:14px;background:#fff;padding:14px;border-radius:8px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
        <div>
          <label style="display:block;font-size:0.82em;color:#666;font-weight:700;">청구 월</label>
          <input id="tp-bill-month" type="month" value="${_today().slice(0,7)}" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
        </div>
        <div>
          <label style="display:block;font-size:0.82em;color:#666;font-weight:700;">화주 (청구 발행용)</label>
          <select id="tp-bill-owner" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;min-width:180px;">
            ${owners.map(o => `<option value="${_ea(o.id)}">${_e(o.name)}</option>`).join('')}
          </select>
        </div>
        <button class="tp-btn tp-btn-ghost" data-act="tp-bill-preview">🔍 계산 미리보기</button>
        <button class="tp-btn tp-btn-primary" data-act="tp-bill-issue">📤 청구서 발행</button>
        <!-- 발행 옆 액션 (체크박스 선택 행에 적용) -->
        <button class="tp-btn tp-btn-success" data-act="tp-bill-bulk-paid">💰 입금처리</button>
        <button class="tp-btn tp-btn-ghost" data-act="tp-bill-bulk-print">🖨 인쇄</button>
        <button class="tp-btn tp-btn-danger" data-act="tp-bill-bulk-delete">🗑 삭제</button>
        <span style="margin-left:6px;font-size:0.84em;color:#666;">선택 <strong id="tp-bill-sel-cnt" style="color:#7b1fa2;">0</strong>건</span>
      </div>

      <!-- ★ 발행 이력 화주 필터 -->
      <div style="margin-bottom:10px;background:#f3e5f5;padding:10px;border-radius:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-size:0.84em;color:#666;font-weight:700;">📋 발행 이력 필터:</label>
        <select id="tp-bill-filter-owner" onchange="window.thirdParty&&window.thirdParty._setBillFilterOwner(this.value)" style="padding:6px;border:1.5px solid #ddd;border-radius:6px;min-width:200px;">
          <option value="">전체 화주 (${billing.length}건)</option>
          ${owners.map(o => {
            const cnt = billing.filter(b => b.ownerId === o.id).length;
            return `<option value="${_ea(o.id)}" ${_selectedBillOwnerId===o.id?'selected':''}>${_e(o.name)} (${cnt}건)</option>`;
          }).join('')}
        </select>
        ${_selectedBillOwnerId ? `<span style="font-size:0.84em;color:#7b1fa2;">→ ${sorted.length}건 표시 중</span>
          <button class="tp-btn tp-btn-ghost" onclick="window.thirdParty._setBillFilterOwner('')" style="padding:4px 10px;font-size:0.78em;">✕ 필터 해제</button>` : ''}
      </div>

      <div id="tp-bill-result"></div>

      <h3 style="font-size:1em;color:#1a1a2e;margin:14px 0 8px;">📋 발행 이력 (매월 말일 정산)</h3>
      ${sorted.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">청구 이력 없음</div>'
        : `<table class="tp-tbl">
          <thead><tr>
            <th style="width:36px;text-align:center;"><input type="checkbox" id="tp-bill-sel-all" onclick="window.thirdParty&&window.thirdParty._toggleAllBills(this.checked)"></th>
            <th>청구번호</th><th>발행일</th><th>화주</th><th>청구월</th>
            <th style="text-align:right;">물류대행비</th>
            <th style="text-align:right;">보관료</th>
            <th style="text-align:right;">수수료</th>
            <th style="text-align:right;">VAT 포함</th><th>마감일</th><th>상태</th>
          </tr></thead>
          <tbody>${sorted.map(b => `<tr class="tp-row">
            <td style="text-align:center;"><input type="checkbox" class="tp-bill-chk" data-id="${_ea(b.id)}" onchange="window.thirdParty&&window.thirdParty._updateBillSelCount()"></td>
            <td><strong>${_e(b.invoiceNo)}</strong></td>
            <td>${_e(b.issueDate)}</td>
            <td>${_e(b.ownerName)}</td>
            <td>${_e(b.billingMonth)}</td>
            <td style="text-align:right;color:#0d47a1;">${_fmt(b.logisticsFee||0)}원</td>
            <td style="text-align:right;">${_fmt(b.storageFee)}원</td>
            <td style="text-align:right;">${_fmt((b.inboundFee||0)+(b.outboundFee||0))}원</td>
            <td style="text-align:right;font-weight:700;color:#7b1fa2;">${_fmt(b.total)}원</td>
            <td>${_e(b.dueDate||'-')}</td>
            <td><span style="padding:3px 8px;border-radius:5px;font-size:0.78em;font-weight:700;background:${b.status==='입금완료'?'#e8f5e9':'#fff3e0'};color:${b.status==='입금완료'?'#27ae60':'#e65100'};">${_e(b.status)}</span></td>
          </tr>`).join('')}</tbody>
        </table>`}
    `;
  }

  // ── 액션 핸들러 ──────────────────────────────────
  function _onModalClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { _curTab = tabBtn.getAttribute('data-tab'); _render(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');

    if (act === 'tp-owner-new')        _renderOwnerEditorMode(null);
    else if (act === 'tp-owner-edit')  _renderOwnerEditorMode(id);
    else if (act === 'tp-owner-save')  _saveOwnerForm(id || null);
    else if (act === 'tp-owner-delete')_deleteOwner(id);
    else if (act === 'tp-back-owners') { _curTab = 'owners'; _render(); }
    else if (act === 'tp-import-contract') {
      // ★ 계약서 OCR 업로드 트리거
      if (typeof window.contractOcr !== 'undefined' && window.contractOcr.open) {
        window.contractOcr.open(_applyContractData);
      } else {
        alert('계약서 OCR 모듈이 로드되지 않았습니다.');
      }
    }

    else if (act === 'tp-inv-new')     _renderInventoryEditorMode();
    else if (act === 'tp-inv-save')    _saveInventoryForm();
    else if (act === 'tp-inv-delete')  _deleteInvRec(id);
    else if (act === 'tp-back-inv')    { _curTab = 'inventory'; _render(); }

    else if (act === 'tp-bill-preview')_previewBilling();
    else if (act === 'tp-bill-issue')  _issueBillingFromUI();
    else if (act === 'tp-bill-paid')   _markPaidUI(id);
    else if (act === 'tp-bill-print')  _printBilling(id);
    else if (act === 'tp-bill-delete') _deleteBillUI(id);
    else if (act === 'tp-bill-bulk-delete') _bulkDeleteBillsUI();
    else if (act === 'tp-bill-bulk-paid')  _bulkPaidBillsUI();
    else if (act === 'tp-bill-bulk-print') _bulkPrintBillsUI();
  }

  // ── 청구서 일괄 입금 처리 ─────────────────────
  function _bulkPaidBillsUI() {
    const checked = document.querySelectorAll('.tp-bill-chk:checked');
    if (checked.length === 0) { alert('입금 처리할 청구서를 선택하세요.'); return; }
    const ids = Array.from(checked).map(el => el.getAttribute('data-id'));
    const date = prompt('입금일 (YYYY-MM-DD):', _today());
    if (!date) return;
    let cnt = 0;
    ids.forEach(id => { if (markBillingPaid(id, date)) cnt++; });
    if (typeof setBanner === 'function') setBanner('ok', `💰 청구서 ${cnt}건 입금 처리`);
    _render();
  }

  // ── 청구서 일괄 인쇄 ─────────────────────────
  function _bulkPrintBillsUI() {
    const checked = document.querySelectorAll('.tp-bill-chk:checked');
    if (checked.length === 0) { alert('인쇄할 청구서를 선택하세요.'); return; }
    const ids = Array.from(checked).map(el => el.getAttribute('data-id'));
    // 단건은 바로 인쇄, 다건은 순차 호출
    ids.forEach((id, idx) => setTimeout(() => _printBilling(id), idx * 300));
  }

  // ── 청구서 발행 단건 삭제 ────────────────────────
  function _deleteBillUI(id) {
    const b = billing.find(x => x.id === id);
    if (!b) return;
    if (!confirm(`청구서 ${b.invoiceNo} (${b.ownerName} · ${b.billingMonth}) 를 삭제합니까?`)) return;
    billing = billing.filter(x => x.id !== id);
    _save(KEY_BILLING, billing);
    if (typeof setBanner === 'function') setBanner('ok', `🗑 청구서 ${b.invoiceNo} 삭제`);
    _render();
  }

  // ── 청구서 발행 일괄 삭제 ────────────────────────
  function _bulkDeleteBillsUI() {
    const checked = document.querySelectorAll('.tp-bill-chk:checked');
    if (checked.length === 0) {
      alert('삭제할 청구서를 체크박스로 선택하세요.');
      return;
    }
    const ids = Array.from(checked).map(el => el.getAttribute('data-id'));
    if (!confirm(`선택한 ${ids.length}건의 청구서를 모두 삭제합니까?`)) return;
    const before = billing.length;
    billing = billing.filter(b => !ids.includes(b.id));
    _save(KEY_BILLING, billing);
    const removed = before - billing.length;
    if (typeof setBanner === 'function') setBanner('ok', `🗑 청구서 ${removed}건 일괄 삭제`);
    _render();
  }

  // 체크박스 전체 선택/해제
  function _toggleAllBills(checked) {
    document.querySelectorAll('.tp-bill-chk').forEach(el => { el.checked = checked; });
    _updateBillSelCount();
  }

  // 선택된 청구서 개수 카운트 업데이트
  function _updateBillSelCount() {
    const cnt = document.querySelectorAll('.tp-bill-chk:checked').length;
    const lbl = document.getElementById('tp-bill-sel-cnt');
    if (lbl) lbl.textContent = cnt;
  }

  let _editorMode = null;   // 'owner-edit' | 'inventory-edit' | null
  function _renderOwnerEditorMode(id) {
    _editorMode = { type: 'owner', id };
    _curTab = 'owners-edit';
    document.getElementById('tp-bd').innerHTML = _renderOwnerEditor(id);
  }

  // ★ 계약서 OCR 데이터를 화주 등록 폼에 자동 적용
  //   extracted = { name, bizNo, ceoName, address, contractStart, contractEnd,
  //                 logisticsContractRatePerWp, ratePerWp, freeMonths, extraMonths, surchargeAddPerWp,
  //                 bankName, bankAccount, accountHolder, contractPdf, contractFileName }
  function _applyContractData(extracted) {
    if (!extracted) return;
    const fields = ['name','bizNo','ceoName','contact','phone','email','address',
                    'contractStart','contractEnd',
                    'logisticsContractRatePerWp',                    // ★ 신규: 물류대행비 단가
                    'ratePerWp','freeMonths','extraMonths',
                    'surchargeAddPerWp','bankName','bankAccount','accountHolder',
                    'paymentTerms','renewMonths'];
    fields.forEach(f => {
      const el = document.querySelector(`#tp-owner-form [data-f="${f}"]`);
      if (el && extracted[f] !== undefined && extracted[f] !== null && extracted[f] !== '') {
        if (el.type === 'checkbox') el.checked = !!extracted[f];
        else el.value = extracted[f];
      }
    });
    // 계약서 PDF 임시 저장 (저장 버튼 누를 때 화주 데이터에 포함)
    if (extracted.contractPdf) {
      window._tpPendingContractPdf = extracted.contractPdf;
      window._tpPendingContractFileName = extracted.contractFileName || 'contract.pdf';
    }
    if (typeof setBanner === 'function')
      setBanner('ok', '✅ 계약서 OCR 자동 입력 완료 — 검토 후 [💾 저장] 클릭');
  }

  // 계약서 PDF 보기 (별도 창)
  function _openContractPdf(ownerId) {
    const o = ownerId ? getOwner(ownerId) : null;
    if (!o || !o.contractPdf) {
      alert('첨부된 계약서가 없습니다.');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) { alert('팝업 차단'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>${_e(o.contractFileName||'contract.pdf')}</title></head><body style="margin:0;">
      <iframe src="${o.contractPdf}" style="width:100%;height:100vh;border:none;"></iframe>
    </body></html>`);
    win.document.close();
  }
  function _renderInventoryEditorMode() {
    _editorMode = { type: 'inventory' };
    _curTab = 'inv-edit';
    document.getElementById('tp-bd').innerHTML = _renderInventoryEditor();
  }

  function _setFilterOwner(id) {
    _selectedOwnerId = id || null;
    _render();
  }
  // ★ 보관료 청구 발행 이력 필터
  function _setBillFilterOwner(id) {
    _selectedBillOwnerId = id || null;
    _render();
  }
  window.thirdParty = window.thirdParty || {};
  window.thirdParty._setFilterOwner = _setFilterOwner;
  window.thirdParty._setBillFilterOwner = _setBillFilterOwner;
  // 청구서 발행 체크박스 일괄 삭제용
  window.thirdParty._toggleAllBills = _toggleAllBills;
  window.thirdParty._updateBillSelCount = _updateBillSelCount;
  // ★ 비용 계산 디버그용 — 콘솔에서 호출 가능
  window.thirdParty._debugRevenue = function(ownerName) {
    const owner = owners.find(o => o.name === ownerName || o.id === ownerName);
    if (!owner) {
      const names = owners.map(o => o.name).join(', ');
      console.error('화주를 찾을 수 없습니다. 등록된 화주: ' + names);
      return null;
    }
    const result = _calcOwnerRevenue(owner);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('화주:', owner.name, '(ID:', owner.id, ')');
    console.log('계약단가:', owner.logisticsContractRatePerWp, '원/Wp');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('매출:', result.revenue.toLocaleString(), '원 (위탁 입고', result.inboundCount, '건)');
    console.log('비용:', result.cost.toLocaleString(), '원 — 출처:', result.costNote);
    console.log('이익:', result.profit.toLocaleString(), '원 (', result.profitRate.toFixed(1), '%)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    // logistics 데이터 확인
    if (typeof window.logistics !== 'undefined' && window.logistics.listInvoices) {
      const invs = window.logistics.listInvoices();
      console.log('등록된 운송 명세서:', invs.length, '장');
      const ownedInvs = invs.filter(i => i.ownerId === owner.id);
      console.log('  ▸ 이 화주에 할당된 명세서:', ownedInvs.length, '장');
      ownedInvs.forEach(i => console.log('    - ' + i.fileName + ' (' + i.month + ')  운송료+VAT: ' + (i.totalAmount||0).toLocaleString() + '원'));
      const unassigned = invs.filter(i => !i.ownerId);
      if (unassigned.length > 0) {
        console.log('  ⚠️ 화주 미지정 명세서:', unassigned.length, '장');
        unassigned.forEach(i => console.log('    - ' + i.fileName + ' (' + i.month + ')'));
      }
    }
    return result;
  };

  function _saveOwnerForm(id) {
    const data = {};
    // ★ BUG FIX: 기존 '#tp-owner-form [data-f]' 는 첫 번째 tp-form 만 검색해서
    //   단가/보관기간/할증 필드(다른 tp-form 안)가 저장 안 됨.
    //   화주 편집 모드일 땐 #tp-bd 의 전체 [data-f] 입력값을 수집한다.
    document.querySelectorAll('#tp-bd [data-f]').forEach(el => {
      const k = el.getAttribute('data-f');
      if (el.type === 'checkbox') data[k] = el.checked;
      else if (el.type === 'number') data[k] = Number(el.value)||0;
      else data[k] = el.value;
    });
    // 임시 저장된 계약서 PDF 첨부
    if (window._tpPendingContractPdf) {
      data.contractPdf = window._tpPendingContractPdf;
      data.contractFileName = window._tpPendingContractFileName || 'contract.pdf';
      delete window._tpPendingContractPdf;
      delete window._tpPendingContractFileName;
    }
    if (!data.name) { alert('회사명 필수'); return; }
    try {
      if (id) {
        updateOwner(id, data);
        if (typeof setBanner === 'function') setBanner('ok', `✅ ${data.name} 화주 정보 수정`);
      } else {
        const o = addOwner(data);
        if (typeof setBanner === 'function') setBanner('ok', `✅ ${o.name} 화주 등록${data.contractPdf?' (계약서 첨부)':''}`);
      }
      _curTab = 'owners';
      _render();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  }

  function _deleteOwner(id) {
    if (!confirm('화주를 삭제합니까?')) return;
    if (removeOwner(id)) {
      if (typeof setBanner === 'function') setBanner('ok', '🗑 화주 삭제');
      _render();
    }
  }

  function _saveInventoryForm() {
    const data = {};
    document.querySelectorAll('#tp-inv-form [data-f]').forEach(el => {
      const k = el.getAttribute('data-f');
      if (el.type === 'number') data[k] = Number(el.value)||0;
      else data[k] = el.value;
    });
    if (!data.ownerId) { alert('화주 선택 필요'); return; }
    if (!data.model) { alert('모델명 필수'); return; }
    if (!data.qty) { alert('수량 필수'); return; }
    // zone 분리
    if (data.zoneSelect) {
      const [whId, zId] = data.zoneSelect.split('|');
      data.warehouseId = whId;
      data.zoneId = zId;
      if (typeof window.warehouseMaster !== 'undefined') {
        const w = window.warehouseMaster.get(whId);
        const z = w?.zones?.find(z => z.id === zId);
        if (w) data.warehouseName = w.name;
        if (z) data.zoneName = z.name;
      }
      delete data.zoneSelect;
    }
    try {
      const r = addInventory(data);
      if (typeof setBanner === 'function')
        setBanner('ok', `✅ 위탁 ${r.type==='inbound'?'입고':'출고'} 등록 — ${r.model} ${_fmt(r.qty)}매`);
      _curTab = 'inventory';
      _render();
    } catch (err) { alert('저장 실패: ' + err.message); }
  }

  function _deleteInvRec(id) {
    if (!confirm('이 위탁 입출고 기록을 삭제합니까?')) return;
    removeInventoryRec(id);
    _render();
  }

  function _previewBilling() {
    const month = document.getElementById('tp-bill-month').value;
    const ownerId = document.getElementById('tp-bill-owner').value;
    if (!ownerId || !month) { alert('월과 화주 선택 필요'); return; }
    const calc = calcMonthlyBilling(ownerId, month);
    if (!calc) return;
    document.getElementById('tp-bill-result').innerHTML = _renderCalcDetail(calc);
  }

  function _renderCalcDetail(calc) {
    return `<div class="tp-fee-detail">
      <strong>📊 ${_e(calc.ownerName)} · ${_e(calc.billingMonth)} 청구 미리보기</strong>
      <span style="color:#888;font-size:0.86em;margin-left:6px;">정산일: ${_e(calc.billingEnd||'')}</span><br>
      • 보관 항목: ${calc.itemCount}건<br>
      • <strong style="color:#0d47a1;">물류대행비: ${_fmt(calc.logisticsFee||0)}원</strong> <span style="color:#888;font-size:0.86em;">(입고당월 1회)</span><br>
      • 보관료: <strong>${_fmt(calc.storageFee)}원</strong> <span style="color:#888;font-size:0.86em;">(무상 5개월 후 매월)</span><br>
      • 입고 수수료: ${_fmt(calc.inboundFee)}원<br>
      • 출고 수수료: ${_fmt(calc.outboundFee)}원<br>
      • 공급가액: ${_fmt(calc.subtotal)}원<br>
      • VAT (10%): ${_fmt(calc.vat)}원<br>
      • <strong style="color:#7b1fa2;font-size:1.1em;">총 청구액: ${_fmt(calc.total)}원</strong>
      ${(calc.logisticsBreakdown && calc.logisticsBreakdown.length) ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-weight:700;color:#0d47a1;">🚚 물류대행비 상세 (${calc.logisticsBreakdown.length}건)</summary>
        <table style="width:100%;margin-top:6px;font-size:0.84em;border-collapse:collapse;">
          <thead><tr><th style="text-align:left;padding:4px;">모델</th><th style="text-align:right;padding:4px;">수량</th><th style="text-align:right;padding:4px;">용량(W)</th><th style="text-align:right;padding:4px;">총 Wp</th><th style="text-align:right;padding:4px;">계약단가</th><th style="text-align:right;padding:4px;">물류대행비</th></tr></thead>
          <tbody>${calc.logisticsBreakdown.map(b => `<tr style="border-top:1px solid #eee;">
            <td style="padding:4px;">${_e(b.model)}</td>
            <td style="text-align:right;padding:4px;">${_fmt(b.qty)}</td>
            <td style="text-align:right;padding:4px;">${_fmt(b.watt)}</td>
            <td style="text-align:right;padding:4px;">${_fmt(b.totalWp)}</td>
            <td style="text-align:right;padding:4px;">${b.ratePerWp}원/Wp</td>
            <td style="text-align:right;padding:4px;font-weight:700;">${_fmt(b.fee)}원</td>
          </tr>`).join('')}</tbody>
        </table>
      </details>` : ''}
      ${calc.breakdown.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-weight:700;">📋 보관료 항목별 상세 (${calc.breakdown.length}건)</summary>
        <table style="width:100%;margin-top:6px;font-size:0.84em;border-collapse:collapse;">
          <thead><tr><th style="text-align:left;padding:4px;">모델</th><th style="text-align:right;padding:4px;">수량</th><th style="text-align:right;padding:4px;">총 Wp</th><th style="text-align:right;padding:4px;">경과월</th><th style="text-align:right;padding:4px;">정상월</th><th style="text-align:right;padding:4px;">할증월</th><th style="text-align:right;padding:4px;">금액</th></tr></thead>
          <tbody>${calc.breakdown.map(b => `<tr style="border-top:1px solid #eee;">
            <td style="padding:4px;">${_e(b.model)}</td>
            <td style="text-align:right;padding:4px;">${_fmt(b.qty)}</td>
            <td style="text-align:right;padding:4px;">${_fmt(b.totalWp)}</td>
            <td style="text-align:right;padding:4px;">${b.monthsElapsed||0}개월</td>
            <td style="text-align:right;padding:4px;">${b.normalMonths||0}개월</td>
            <td style="text-align:right;padding:4px;color:${(b.surchargeMonths||0)>0?'#c62828':'#888'};">${b.surchargeMonths||0}개월</td>
            <td style="text-align:right;padding:4px;font-weight:700;">${_fmt(b.total)}원</td>
          </tr>`).join('')}</tbody>
        </table>
      </details>` : ''}
    </div>`;
  }

  function _issueBillingFromUI() {
    const month = document.getElementById('tp-bill-month').value;
    const ownerId = document.getElementById('tp-bill-owner').value;
    if (!ownerId || !month) { alert('월과 화주 선택 필요'); return; }
    if (!confirm(`${month} 청구서를 발행하시겠습니까?`)) return;
    try {
      const b = issueBilling(ownerId, month);
      if (b && typeof setBanner === 'function')
        setBanner('ok', `📤 청구서 ${b.invoiceNo} 발행 완료 (${_fmt(b.total)}원)`);
      _render();
    } catch (err) { alert('발행 실패: ' + err.message); }
  }

  function _markPaidUI(id) {
    const date = prompt('입금일 (YYYY-MM-DD):', _today());
    if (!date) return;
    markBillingPaid(id, date);
    if (typeof setBanner === 'function') setBanner('ok', '💰 입금 처리됨');
    _render();
  }

  function _printBilling(id) {
    const b = billing.find(x => x.id === id);
    if (!b) return;
    const win = window.open('', '_blank');
    if (!win) { alert('팝업 차단'); return; }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${_e(b.invoiceNo)}</title>
      <style>
        body{font-family:'Malgun Gothic',sans-serif;margin:30px;color:#1a1a2e;}
        h1{text-align:center;margin:0 0 20px;letter-spacing:8px;border-bottom:3px double #7b1fa2;padding-bottom:10px;}
        table{width:100%;border-collapse:collapse;margin:10px 0;}
        th,td{border:1px solid #555;padding:6px 10px;}
        th{background:#f3e5f5;font-weight:700;}
        .total{font-size:1.2em;font-weight:900;background:#fffde7;}
      </style></head><body>
      <h1>보 관 료 청 구 서</h1>
      <table>
        <tr><th>청구번호</th><td>${_e(b.invoiceNo)}</td><th>발행일</th><td>${_e(b.issueDate)}</td></tr>
        <tr><th>화주</th><td>${_e(b.ownerName)}</td><th>청구월</th><td>${_e(b.billingMonth)}</td></tr>
        <tr><th>마감일</th><td colspan="3">${_e(b.dueDate||'-')}</td></tr>
      </table>
      <table>
        <tr><th>항목</th><th style="text-align:right;">금액</th></tr>
        <tr><td>보관료</td><td style="text-align:right;">${_fmt(b.storageFee)}원</td></tr>
        <tr><td>입고 수수료</td><td style="text-align:right;">${_fmt(b.inboundFee)}원</td></tr>
        <tr><td>출고 수수료</td><td style="text-align:right;">${_fmt(b.outboundFee)}원</td></tr>
        <tr><th style="text-align:right;">공급가액</th><th style="text-align:right;">${_fmt(b.subtotal)}원</th></tr>
        <tr><th style="text-align:right;">VAT (10%)</th><th style="text-align:right;">${_fmt(b.vat)}원</th></tr>
        <tr class="total"><th style="text-align:right;">총 청구액</th><th style="text-align:right;">${_fmt(b.total)}원</th></tr>
      </table>
      <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
      </body></html>`;
    win.document.write(html);
    win.document.close();
  }

  // ── 메인 렌더 ────────────────────────────────────
  // ── 💹 수익 분석 (★ 2026-05-08 logistics 에서 이전) ────
  //   매출 = 화주별 위탁 입고 × 용량 × 계약단가 (전기간)
  //   비용 = 화주별 매칭된 거래명세서 운송료 (VAT 포함)
  //          + 매칭 실패 시 logistics 가 화주 지정한 청구건도 합산 (fallback)
  function _renderRevenue() {
    const hasLog = (typeof window.logistics !== 'undefined');
    if (!hasLog) {
      return `${_renderTabs()}<div style="background:#fff3e0;padding:20px;border-radius:8px;color:#e65100;">⚠️ 물류비 모듈이 로드되지 않았습니다.</div>`;
    }
    if (owners.length === 0) {
      return `${_renderTabs()}<div style="background:#fff3e0;padding:20px;border-radius:8px;color:#e65100;">⚠️ 등록된 화주가 없습니다. <strong>화주 관리</strong> 탭에서 화주를 먼저 등록하세요.</div>`;
    }

    const rows = owners.map(o => _calcOwnerRevenue(o));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCost    = rows.reduce((s, r) => s + r.cost, 0);
    const totalProfit  = totalRevenue - totalCost;
    const totalRate    = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
    // ★ 전체 비용단가 = 전체 비용 ÷ (비용 있는 화주들의 Wp 합)
    //   비용이 0인 화주의 Wp는 분모에서 제외 → 화주별 비용단가와 합계가 일치
    //   (이전: 모든 Wp 합산으로 평균이 희석되어 화주별 단가와 불일치)
    const totalWpForCost = rows.reduce((s, r) => s + (r.cost > 0 ? r.totalWp : 0), 0);
    const totalCostRate  = totalWpForCost > 0 ? (totalCost / totalWpForCost) : 0;

    return `
      ${_renderTabs()}
      <h3 style="font-size:1em;color:#1a1a2e;margin:0 0 10px;">💹 화주별 수익 분석 (전체 기간 누적)</h3>

      <div class="tp-stats">
        <div class="tp-stat" style="border-left-color:#27ae60;">
          <div class="tp-stat-l">전체 매출</div>
          <div class="tp-stat-v" style="color:#27ae60;">${_fmt(totalRevenue)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">화주 청구 합계</div>
        </div>
        <div class="tp-stat" style="border-left-color:#c62828;">
          <div class="tp-stat-l">전체 비용</div>
          <div class="tp-stat-v" style="color:#c62828;">${_fmt(totalCost)}원 <span style="font-size:0.62em;color:#666;">(${totalCostRate.toFixed(1)}원/Wp)</span></div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">운송료 합계 (VAT 포함)</div>
        </div>
        <div class="tp-stat" style="border-left-color:${totalProfit>=0?'#1565c0':'#c62828'};">
          <div class="tp-stat-l">전체 이익</div>
          <div class="tp-stat-v" style="color:${totalProfit>=0?'#1565c0':'#c62828'};">${_fmt(totalProfit)}원</div>
        </div>
        <div class="tp-stat">
          <div class="tp-stat-l">평균 이익률</div>
          <div class="tp-stat-v" style="color:${totalRate>=0?'#1565c0':'#c62828'};">${totalRate.toFixed(1)}%</div>
        </div>
      </div>

      <h3 style="font-size:1em;color:#1a1a2e;margin:18px 0 8px;">🏢 화주별 상세</h3>
      <table class="tp-tbl">
        <thead><tr>
          <th>화주</th>
          <th style="text-align:right;">매출단가<br><span style="font-size:0.78em;color:#aaa;">(계약단가)</span></th>
          <th style="text-align:right;">위탁 입고</th>
          <th style="text-align:right;">매출</th>
          <th style="text-align:right;">비용 (VAT 포함)<br><span style="font-size:0.78em;color:#aaa;">(비용단가)</span></th>
          <th style="text-align:right;">비용 출처</th>
          <th style="text-align:right;">이익</th>
          <th style="text-align:right;">이익률</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${_e(r.ownerName)}</strong></td>
          <td style="text-align:right;color:#0d47a1;">${r.contractRate>0 ? r.contractRate+'원/Wp' : '<span style="color:#c62828;">미설정</span>'}</td>
          <td style="text-align:right;">${r.inboundCount}건</td>
          <td style="text-align:right;font-weight:700;color:#27ae60;">${_fmt(r.revenue)}원</td>
          <td style="text-align:right;color:#c62828;">${_fmt(r.cost)}원${r.costRate>0?`<br><span style="font-size:0.78em;color:#888;">(${r.costRate.toFixed(1)}원/Wp)</span>`:''}</td>
          <td style="text-align:right;font-size:0.78em;color:#666;">${r.costNote}</td>
          <td style="text-align:right;font-weight:700;color:${r.profit>=0?'#1565c0':'#c62828'};">${_fmt(r.profit)}원</td>
          <td style="text-align:right;font-weight:700;color:${r.profitRate>=0?'#1565c0':'#c62828'};">${r.profitRate.toFixed(1)}%</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:#f5f5f5;font-weight:700;">
          <td colspan="3">합계</td>
          <td style="text-align:right;color:#27ae60;">${_fmt(totalRevenue)}원</td>
          <td style="text-align:right;color:#c62828;">${_fmt(totalCost)}원${totalCostRate>0?`<br><span style="font-size:0.78em;color:#888;">(${totalCostRate.toFixed(1)}원/Wp)</span>`:''}</td>
          <td></td>
          <td style="text-align:right;color:${totalProfit>=0?'#1565c0':'#c62828'};">${_fmt(totalProfit)}원</td>
          <td style="text-align:right;color:${totalRate>=0?'#1565c0':'#c62828'};">${totalRate.toFixed(1)}%</td>
        </tr></tfoot>
      </table>

    `;
  }

  // 화주별 매출/비용 계산
  //   ★ 2026-05-08 비용 0원 버그 수정:
  //   logistics 는 invoice 전체 단위로 ownerId 를 할당 (invoice.ownerId).
  //   기존 코드는 item.ownerId 만 봐서 invoice 레벨 할당이 무시됐음.
  //   이제 invoice.ownerId / item.ownerId / notes-매칭 3중 처리.
  function _calcOwnerRevenue(owner) {
    // ── 매출 ──
    let revenue = 0, inboundCount = 0;
    inventory.forEach(r => {
      if (r.type !== 'inbound' || r.ownerId !== owner.id) return;
      const fee = (r.qty||0) * (r.watt||0) * (owner.logisticsContractRatePerWp||0);
      if (fee > 0) { revenue += fee; inboundCount++; }
    });

    // ── 비용 (3중 fallback) ──
    let cost = 0;
    const sources = [];
    // 이미 비용에 합산된 logistics item ID — 중복 방지
    const countedItemIds = new Set();

    if (typeof window.logistics !== 'undefined') {
      const allInvoices = window.logistics.listInvoices ? window.logistics.listInvoices() : [];

      // (1) ★ invoice 레벨 ownerId 할당 (logistics → 🏢 화주별 탭에서 명세서 단위 지정)
      let invoiceCost = 0, invoiceCnt = 0, invoiceItemCnt = 0;
      allInvoices.forEach(inv => {
        if (inv.ownerId === owner.id) {
          invoiceCnt++;
          (inv.items||[]).forEach(it => {
            invoiceCost += (it.fee||0) + (it.vat||0);
            invoiceItemCnt++;
            const k = inv.id + ':' + (it.no || it.notes || invoiceItemCnt);
            countedItemIds.add(k);
          });
        }
      });
      if (invoiceCnt > 0) {
        cost += invoiceCost;
        sources.push(`명세서 ${invoiceCnt}장(${invoiceItemCnt}건)`);
      }

      // (2) item 레벨 ownerId 할당 (개별 항목 할당)
      let itemCost = 0, itemCnt = 0;
      allInvoices.forEach(inv => {
        if (inv.ownerId === owner.id) return;  // 이미 (1) 에서 처리됨
        (inv.items||[]).forEach((it, idx) => {
          if (it.ownerId === owner.id) {
            const k = inv.id + ':' + (it.no || it.notes || idx);
            if (countedItemIds.has(k)) return;
            itemCost += (it.fee||0) + (it.vat||0);
            itemCnt++;
            countedItemIds.add(k);
          }
        });
      });
      if (itemCnt > 0) { cost += itemCost; sources.push(`개별 항목 ${itemCnt}건`); }

      // (3) 위탁 출고 자동 매칭 (notes + 일자)
      if (window.logistics.matchOutbounds) {
        try {
          const ownerOutIds = new Set(
            inventory.filter(r => r.type === 'outbound' && r.ownerId === owner.id).map(r => r.id)
          );
          if (ownerOutIds.size > 0) {
            const m = window.logistics.matchOutbounds();
            let matchCost = 0, matchCnt = 0;
            m.matched.forEach(mm => {
              if (!ownerOutIds.has(mm.outbound.id)) return;
              // 이미 (1)/(2) 에서 합산된 항목은 중복 제외
              const logInv = allInvoices.find(inv => (inv.items||[]).some(it => it === mm.log));
              if (logInv) {
                if (logInv.ownerId === owner.id) return;  // (1) 이미 합산
                const k = logInv.id + ':' + (mm.log.no || mm.log.notes);
                if (countedItemIds.has(k)) return;
                countedItemIds.add(k);
              }
              if (mm.log.ownerId === owner.id) return;  // (2) 이미 합산
              matchCost += (mm.log.fee||0) + (mm.log.vat||0);
              matchCnt++;
            });
            if (matchCnt > 0) { cost += matchCost; sources.push(`매칭 ${matchCnt}건`); }
          }
        } catch(e) { console.error('[tp-revenue] matchOutbounds 실패:', e); }
      }
    }

    // ★ 비용단가 계산
    //   매출단가 = owner.logisticsContractRatePerWp (원/Wp)
    //   매출 = qty × watt × 매출단가 → 매출/매출단가 = 총 Wp
    //   비용단가 = 비용 ÷ (매출 ÷ 매출단가) = 비용 ÷ 총Wp (원/Wp)
    const contractRate = owner.logisticsContractRatePerWp || 0;
    const totalWp = contractRate > 0 ? (revenue / contractRate) : 0;
    const costRate = totalWp > 0 ? (cost / totalWp) : 0;

    return {
      ownerId: owner.id,
      ownerName: owner.name,
      contractRate,
      inboundCount,
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      costRate: costRate,                          // ★ 비용단가 (원/Wp)
      totalWp: Math.round(totalWp),                // 총 Wp (검증용)
      profit: Math.round(revenue) - Math.round(cost),
      profitRate: revenue > 0 ? ((Math.round(revenue) - Math.round(cost)) / Math.round(revenue) * 100) : 0,
      costNote: sources.length > 0 ? sources.join(', ') : '<span style="color:#bbb;">없음</span>'
    };
  }

  function _render() {
    const bd = document.getElementById('tp-bd');
    if (!bd) return;
    if (_curTab === 'overview')  bd.innerHTML = _renderOverview();
    else if (_curTab === 'owners')    bd.innerHTML = _renderOwners();
    else if (_curTab === 'inventory') bd.innerHTML = _renderInventory();
    else if (_curTab === 'billing')   bd.innerHTML = _renderBilling();
    else if (_curTab === 'revenue')   bd.innerHTML = _renderRevenue();   // ★ 신규
    else if (_curTab === 'owners-edit') bd.innerHTML = _renderOwnerEditor(_editorMode?.id);
    else if (_curTab === 'inv-edit')    bd.innerHTML = _renderInventoryEditor();
    else _curTab = 'overview', _render();
  }

  function open() {
    _injectUI();
    loadAll();
    _curTab = 'overview';
    document.getElementById('erp-tp-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() { document.getElementById('erp-tp-modal')?.classList.remove('open'); }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    loadAll();
    setTimeout(_injectUI, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  Object.assign(window.thirdParty || {}, {
    // 화주
    listOwners, getOwner, addOwner, updateOwner, removeOwner,
    // 위탁 입출고
    listInventory, addInventory, updateInventoryRec, removeInventoryRec,
    ownerStock,
    // 보관료
    calcStorageFee, calcMonthlyBilling, issueBilling, markBillingPaid,
    // 통계
    summary,
    // UI
    open, close, reload: loadAll,
    // 계약서 OCR 연동 헬퍼 (외부 호출용)
    _applyContractData,
    _openContractPdf
  });
  if (typeof window.thirdParty === 'undefined') window.thirdParty = {};

  console.log('[ERP-TP] 타사 위탁 재고 관리 활성 — thirdParty.open()');
})();
