// =====================================================
//  LOGISTICS — 물류비 관리 (Phase 8)
//
//  목적
//   1) 운송회사(스마일로지스 등) 거래명세서 엑셀 파일 업로드 + 자동 파싱
//   2) 월별 물류비 집계 / 위탁건(비고)별 집계 / 운송지역별 집계
//   3) 타사 위탁 출고 이력과 운송 명세서 매칭 — 누락·오류 검출
//   4) 수익 분석: 매출(화주 청구) - 비용(운송 지급) = 이익
//
//  데이터
//   erp_logistics_invoices  — 운송 명세서 (월별 invoice 배열)
//
//  엑셀 양식 인식 (자동)
//   - 헤더: 번호 | 일자 | 운송지역 | 품목 | 성함 | 차량(톤) | 차량번호 | 연락처 | 운송료 | 부가세 | 비고
//   - 합계금액 (VAT 포함) 셀 자동 추출
//   - 명세서 분할(NO 1, NO 2, ...) 자동 병합
//
//  공개 API: window.logistics
// =====================================================
(function() {
  'use strict';

  const KEY_INVOICES = 'erp_logistics_invoices';

  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY_INVOICES), 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }
  function _today() { return (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10); }
  function _genId(p) { return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,5); }
  function _num(v) { return Number(String(v||'0').replace(/[,₩\s원]/g, '')) || 0; }

  // 데이터
  let invoices = [];
  function load() {
    try { invoices = JSON.parse(localStorage.getItem(KEY_INVOICES) || '[]'); }
    catch(e) { invoices = []; }
    if (!Array.isArray(invoices)) invoices = [];
  }
  function save() {
    try { localStorage.setItem(KEY_INVOICES, JSON.stringify(invoices)); }
    catch(e) { console.error('[logistics] save 실패', e); }
  }

  // ============================================================
  //  엑셀 파싱
  // ============================================================
  // SCG/바로 거래명세서 양식 파싱 — 헤더 자동 감지 + 페이지 병합
  function _parseSheet(ws) {
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

    // 헤더 컬럼 매핑 찾기 (재발생 가능한 헤더는 한 번만 감지)
    let colMap = null;
    for (let i = 0; i < data.length && !colMap; i++) {
      const row = data[i];
      const idxs = {};
      row.forEach((cell, j) => {
        const s = String(cell||'').trim();
        if (s === '번호') idxs.no = j;
        else if (s === '일 자' || s === '일자') idxs.day = j;
        else if (s === '운송지역') idxs.region = j;
        else if (s === '품목') idxs.item = j;
        else if (s === '성함') idxs.name = j;
        else if (s === '차량(톤)' || s === '차량톤') idxs.ton = j;
        else if (s === '차량번호') idxs.plate = j;
        else if (s === '연락처') idxs.phone = j;
        else if (s === '운송료') idxs.fee = j;
        else if (s === '부가세') idxs.vat = j;
        else if (s === '비고') idxs.notes = j;
      });
      if (idxs.no !== undefined && idxs.fee !== undefined && idxs.region !== undefined) {
        colMap = idxs;
      }
    }
    if (!colMap) throw new Error('거래명세서 헤더를 찾을 수 없습니다 (번호/운송지역/운송료 컬럼 필요)');

    // 합계금액 셀 + 거래일자 + 공급자/공급받는자 추출
    let supplier = '', buyer = '', headerSum = 0, billDate = '';
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      const row = data[i].map(c => String(c||'').trim());
      const joined = row.join(' | ');
      // 상호 N번째 등장 = N번째 회사 (1=공급받는자, 2=공급자)
      let storeCount = 0;
      row.forEach((c, j) => {
        // "상호" 단독 또는 "상호\n(법인명)" 패턴
        if (c === '상호' || /^상호\s*[\(\n]/.test(c) || c === '상호(법인명)') {
          storeCount++;
          // 다음 셀에서 회사명 (단, "(법인명)" 같은 보조 라벨은 스킵)
          let k = j + 1;
          while (k < row.length) {
            const v = row[k];
            if (v && v !== '(법인명)' && !v.startsWith('(') && v !== '성명' && !v.includes('(인)')) break;
            k++;
          }
          const name = row[k] || '';
          if (name) {
            if (storeCount === 1 && !buyer) buyer = name;
            else if (storeCount === 2 && !supplier) supplier = name;
          }
        }
      });
      // 합계금액 (VAT 포함)
      if (joined.includes('합계금액')) {
        row.forEach(c => {
          const n = _num(c);
          if (n > 100000 && n > headerSum) headerSum = n;
        });
      }
      // 거래일자
      if (joined.includes('거래') && joined.includes('일자')) {
        const nextRow = data[i+1];
        if (nextRow) {
          for (const c of nextRow) {
            const s = String(c||'').trim();
            if (/^\d{5}$/.test(s)) {
              const ms = (Number(s) - 25569) * 86400000;
              billDate = new Date(ms).toISOString().slice(0,10);
              break;
            }
            if (/^\d+\/\d+\/\d+$/.test(s)) {
              const [m, d, y] = s.split('/').map(Number);
              const yyyy = y < 50 ? 2000+y : (y < 100 ? 1900+y : y);
              billDate = `${yyyy}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              break;
            }
          }
        }
      }
    }

    // 데이터 행 추출 — 모든 페이지 병합
    //   ★ 2026-05-12: 합계/소계/유령 행 (번호+운송료만 있고 일자·지역·품목 모두 비어있는 행) 제외
    //   거래명세서 양식에 따라 끝에 "번호 93"처럼 번호가 부풀려져 있고 마지막 행에 운송료가
    //   숨겨진 소계로 들어가 있는 경우가 있음 → 데이터로 잡혀 운송료 2배 합산되는 버그.
    const items = [];
    data.forEach(row => {
      const noVal = String(row[colMap.no]||'').trim();
      if (!/^\d+$/.test(noVal)) return;
      const fee = _num(row[colMap.fee]);
      if (fee <= 0) return;
      const day    = String(row[colMap.day]||'').trim();
      const region = String(row[colMap.region]||'').trim();
      const item   = String(row[colMap.item]||'').trim();
      const driver = String(row[colMap.name]||'').trim();
      // 핵심 필드 (일자·지역·품목·성함) 중 최소 2개 이상이 채워져 있어야 진짜 데이터 행
      const filledCore = [day, region, item, driver].filter(v => v).length;
      if (filledCore < 2) return;  // 1개 이하 채워진 행은 합계/소계 행으로 판단해 건너뜀
      items.push({
        no: Number(noVal),
        day, region, item,
        driver,
        ton: String(row[colMap.ton]||'').trim(),
        plate: String(row[colMap.plate]||'').trim(),
        phone: String(row[colMap.phone]||'').trim(),
        fee,
        vat: _num(row[colMap.vat]),
        notes: String(row[colMap.notes]||'').trim()
      });
    });

    return { supplier, buyer, billDate, headerSum, items };
  }

  // ArrayBuffer → base64 (원본 파일 보관용)
  function _bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // 파일 → invoice 객체 (Promise)
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') return reject(new Error('XLSX 라이브러리 미로드'));
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const fileBase64 = _bufferToBase64(e.target.result);   // ★ 원본 파일 base64
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const parsed = _parseSheet(ws);
          // 청구월 자동 감지: billDate 의 YYYY-MM, 또는 파일명에서 추출
          let yearMonth = parsed.billDate ? parsed.billDate.slice(0, 7) : '';
          if (!yearMonth) {
            const m = file.name.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
            if (m) yearMonth = `${m[1]}-${String(m[2]).padStart(2,'0')}`;
          }
          if (!yearMonth) yearMonth = _today().slice(0, 7);

          const totalFee = parsed.items.reduce((s, r) => s + r.fee, 0);
          const totalVat = parsed.items.reduce((s, r) => s + r.vat, 0);
          const totalAmount = totalFee + totalVat;

          // 일자 → 풀 날짜 (해당 월 기반)
          const [year, mon] = yearMonth.split('-');
          parsed.items.forEach(r => {
            const d = parseInt(r.day) || 0;
            if (d > 0 && d <= 31) {
              r.date = `${year}-${mon}-${String(d).padStart(2,'0')}`;
            } else {
              r.date = '';
            }
          });

          const invoice = {
            id: _genId('LOG'),
            supplier: parsed.supplier || '스마일로지스',
            buyer: parsed.buyer || '바로 주식회사',
            ownerId: '',
            ownerName: '',
            month: yearMonth,
            billDate: parsed.billDate || _today(),
            fileName: file.name,
            fileSize: file.size,                                 // ★ 파일 크기
            fileBase64,                                          // ★ 원본 파일 (다운로드용)
            uploadedAt: new Date().toISOString(),
            totalFee,
            totalVat,
            totalAmount,
            headerSum: parsed.headerSum,
            sumValid: parsed.headerSum === 0 || Math.abs(parsed.headerSum - totalAmount) < 100,
            items: parsed.items
          };
          resolve(invoice);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ============================================================
  //  CRUD
  // ============================================================
  function listInvoices() { return invoices.slice(); }
  function getInvoice(id) { return invoices.find(i => i.id === id); }
  function addInvoice(inv) {
    // 중복 체크 (같은 파일명 + 같은 월)
    const dup = invoices.find(i => i.fileName === inv.fileName && i.month === inv.month);
    if (dup) {
      if (!confirm(`동일 파일이 이미 등록되어 있습니다 (${dup.month}, ${dup.fileName}).\n덮어쓰시겠습니까?`)) {
        return null;
      }
      removeInvoice(dup.id);
    }
    invoices.push(inv);
    save();
    return inv;
  }
  function removeInvoice(id) {
    invoices = invoices.filter(i => i.id !== id);
    save();
  }
  function updateInvoice(id, patch) {
    const i = invoices.findIndex(inv => inv.id === id);
    if (i < 0) return null;
    invoices[i] = { ...invoices[i], ...patch };
    save();
    return invoices[i];
  }

  // ============================================================
  //  집계 & 분석
  // ============================================================
  // 월별 요약
  function getMonthSummary(yearMonth) {
    const monthInvs = invoices.filter(i => i.month === yearMonth);
    let totalFee = 0, totalVat = 0, totalAmount = 0, itemCount = 0;
    monthInvs.forEach(i => {
      totalFee += i.totalFee || 0;
      totalVat += i.totalVat || 0;
      totalAmount += i.totalAmount || 0;
      itemCount += (i.items || []).length;
    });
    return { yearMonth, invoiceCount: monthInvs.length, itemCount, totalFee, totalVat, totalAmount, invoices: monthInvs };
  }

  // 비고(위탁건)별 집계
  function getByNotes(yearMonth) {
    const filter = yearMonth ? invoices.filter(i => i.month === yearMonth) : invoices;
    const map = {};
    filter.forEach(inv => {
      (inv.items || []).forEach(r => {
        const k = r.notes || '(미지정)';
        if (!map[k]) map[k] = { notes: k, count: 0, fee: 0, vat: 0, items: [], months: new Set() };
        map[k].count++;
        map[k].fee += r.fee;
        map[k].vat += r.vat;
        map[k].items.push({ ...r, _invoiceId: inv.id, _month: inv.month });
        map[k].months.add(inv.month);
      });
    });
    return Object.values(map).map(v => ({ ...v, months: [...v.months].sort() })).sort((a,b) => b.fee - a.fee);
  }

  // 운송지역별 집계
  function getByRegion(yearMonth, ownerId) {
    const filter = invoices.filter(i =>
      (!yearMonth || i.month === yearMonth) &&
      (!ownerId   || i.ownerId === ownerId)
    );
    const map = {};
    filter.forEach(inv => {
      (inv.items || []).forEach(r => {
        const k = r.region || '(미지정)';
        if (!map[k]) map[k] = { region: k, count: 0, fee: 0 };
        map[k].count++;
        map[k].fee += r.fee;
      });
    });
    return Object.values(map).sort((a,b) => b.fee - a.fee);
  }

  // 화주별 집계
  function getByOwner(yearMonth) {
    const filter = yearMonth ? invoices.filter(i => i.month === yearMonth) : invoices;
    const map = {};
    filter.forEach(inv => {
      const k = inv.ownerId || '(미지정)';
      const label = inv.ownerName || '(화주 미지정)';
      if (!map[k]) map[k] = { ownerId: inv.ownerId||'', ownerName: label, invoiceCount: 0, itemCount: 0, fee: 0, vat: 0, total: 0, months: new Set() };
      map[k].invoiceCount++;
      map[k].itemCount += (inv.items||[]).length;
      map[k].fee += inv.totalFee || 0;
      map[k].vat += inv.totalVat || 0;
      map[k].total += inv.totalAmount || 0;
      map[k].months.add(inv.month);
    });
    return Object.values(map).map(v => ({ ...v, months: [...v.months].sort() })).sort((a,b) => b.fee - a.fee);
  }

  // ★ 차량종류별 + 운송지역별 평균가 분석
  //   tonKey 정규화: '5장축' / '5' → '5'(5톤대) 같은 카테고리로 묶음
  function _normalizeTon(t) {
    const s = String(t||'').trim();
    if (!s) return '(미상)';
    // 숫자 추출 (소수 포함)
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return s;
    const n = Number(m[1]);
    // 5장축 → "5장축" 그대로 노출 (5톤과는 다른 차량)
    if (s.includes('장축')) return n + '장축';
    return String(n);
  }

  function getByVehicle(yearMonth, ownerId, regionFilter) {
    const filter = invoices.filter(i =>
      (!yearMonth || i.month === yearMonth) &&
      (!ownerId   || i.ownerId === ownerId)
    );
    const map = {};  // ton → { count, totalFee, fees: [] }
    filter.forEach(inv => {
      (inv.items || []).forEach(r => {
        const rk = (r.region || '').trim() || '(미지정)';
        // ★ 운송지역 필터: 지정되면 동일 지역만 통계 반영
        if (regionFilter && rk !== regionFilter) return;
        const k = _normalizeTon(r.ton);
        if (!map[k]) map[k] = { ton: k, count: 0, totalFee: 0, fees: [], regions: {} };
        map[k].count++;
        map[k].totalFee += r.fee;
        map[k].fees.push(r.fee);
        if (!map[k].regions[rk]) map[k].regions[rk] = { count: 0, fee: 0, fees: [] };
        map[k].regions[rk].count++;
        map[k].regions[rk].fee += r.fee;
        map[k].regions[rk].fees.push(r.fee);
      });
    });
    // 통계 계산 (평균/최소/최대/중위수/표준편차)
    Object.values(map).forEach(v => {
      v.fees.sort((a,b) => a-b);
      v.avg = v.count > 0 ? Math.round(v.totalFee / v.count) : 0;
      v.min = v.fees[0] || 0;
      v.max = v.fees[v.fees.length-1] || 0;
      v.median = v.fees.length > 0 ? v.fees[Math.floor(v.fees.length/2)] : 0;
      const mean = v.avg;
      const variance = v.fees.reduce((s,f) => s + (f-mean)**2, 0) / Math.max(1, v.fees.length);
      v.stdDev = Math.round(Math.sqrt(variance));
      // 지역별도 동일 통계
      Object.values(v.regions).forEach(rg => {
        rg.fees.sort((a,b) => a-b);
        rg.avg = rg.count > 0 ? Math.round(rg.fee / rg.count) : 0;
        rg.min = rg.fees[0] || 0;
        rg.max = rg.fees[rg.fees.length-1] || 0;
      });
      delete v.fees;  // UI 부담 줄이기
      Object.values(v.regions).forEach(rg => delete rg.fees);
    });
    // ★ 차량 톤급 오름차순 정렬 ('1' < '5' < '5장축' < '11' < '(미상)')
    return Object.values(map).sort((a, b) => _tonSortVal(a.ton) - _tonSortVal(b.ton));
  }

  // 운송지역 + 차량톤 → 평균가 참조표
  //   "광주-안성|5" → { avgFee, count, min, max, p25, p75 }
  function getRateReference(ownerId, regionFilter) {
    const filter = ownerId ? invoices.filter(i => i.ownerId === ownerId) : invoices;
    const map = {};
    filter.forEach(inv => {
      (inv.items || []).forEach(r => {
        const region = (r.region || '').trim() || '(미지정)';
        // ★ 운송지역 필터: 지정되면 동일 지역만 통계 반영
        if (regionFilter && region !== regionFilter) return;
        const ton = _normalizeTon(r.ton);
        const k = `${region}|${ton}`;
        if (!map[k]) map[k] = { region, ton, count: 0, totalFee: 0, fees: [] };
        map[k].count++;
        map[k].totalFee += r.fee;
        map[k].fees.push(r.fee);
      });
    });
    Object.values(map).forEach(v => {
      v.fees.sort((a,b) => a-b);
      v.avg = v.count > 0 ? Math.round(v.totalFee / v.count) : 0;
      v.min = v.fees[0];
      v.max = v.fees[v.fees.length-1];
      v.p25 = v.fees[Math.floor(v.fees.length*0.25)] || v.avg;
      v.p75 = v.fees[Math.floor(v.fees.length*0.75)] || v.avg;
      delete v.fees;
    });
    // ★ 운송지역 가나다 오름차순 → 동일 지역 내에서는 톤급 오름차순
    return Object.values(map).sort((a, b) => {
      const cmp = a.region.localeCompare(b.region, 'ko');
      if (cmp !== 0) return cmp;
      return _tonSortVal(a.ton) - _tonSortVal(b.ton);
    });
  }

  // ============================================================
  //  매칭: 운송 명세서 ↔ 위탁 출고
  // ============================================================
  // 매칭 키: notes (위탁건 ID) + 일자 (±3일 허용)
  // 또는 region 의 도착지 + 일자
  function matchOutbounds(yearMonth) {
    const monthInvs = yearMonth ? invoices.filter(i => i.month === yearMonth) : invoices;
    const allLogItems = [];
    monthInvs.forEach(inv => {
      (inv.items || []).forEach(r => allLogItems.push({ ...r, _invoiceId: inv.id, _month: inv.month }));
    });

    // 위탁 출고 이력 — thirdParty 모듈에서 가져옴
    let outbounds = [];
    if (typeof window.thirdParty !== 'undefined' && window.thirdParty.listInventory) {
      try {
        outbounds = window.thirdParty.listInventory({ type: 'outbound' });
        if (yearMonth) {
          outbounds = outbounds.filter(o => (o.date||'').startsWith(yearMonth));
        }
      } catch(e) {}
    }

    // 매칭 시도
    const matched = [];        // { logItem, outbound }
    const unmatchedLogs = [];  // 운송은 있는데 출고가 없음 (오류 의심)
    const unmatchedOuts = [];  // 출고는 있는데 운송이 없음 (누락 의심)

    const usedOuts = new Set();
    allLogItems.forEach(log => {
      const cand = outbounds.filter(o => {
        if (usedOuts.has(o.id)) return false;
        // notes 매칭 (포함 관계)
        const noteMatch = log.notes && o.notes && (
          o.notes.includes(log.notes) || log.notes.includes(o.notes) ||
          (log.notes||'').replace(/\s/g,'') === (o.notes||'').replace(/\s/g,'')
        );
        // 일자 ±3일
        const d1 = new Date(log.date);
        const d2 = new Date(o.date);
        const diff = Math.abs((d1 - d2) / 86400000);
        const dateMatch = !isNaN(diff) && diff <= 3;
        return noteMatch && dateMatch;
      });
      if (cand.length > 0) {
        matched.push({ log, outbound: cand[0], confidence: cand.length === 1 ? 1.0 : 0.7 });
        usedOuts.add(cand[0].id);
      } else {
        unmatchedLogs.push(log);
      }
    });

    outbounds.forEach(o => {
      if (!usedOuts.has(o.id)) unmatchedOuts.push(o);
    });

    return {
      matched, unmatchedLogs, unmatchedOuts,
      stats: {
        totalLogs: allLogItems.length,
        totalOuts: outbounds.length,
        matchedCount: matched.length,
        matchRate: allLogItems.length > 0 ? (matched.length / allLogItems.length * 100) : 0
      }
    };
  }

  // ============================================================
  //  화주별 수익 분석 (★ 2026-05-08 신규)
  // ============================================================
  //  매출 = 해당 화주 위탁 입고 × 용량 × 계약단가 (전기간)
  //  비용 = 해당 화주 위탁 출고와 매칭된 운송 명세서 운송료 (VAT 포함)
  //  이익 = 매출 - 비용
  function revenueAnalysisByOwner(ownerId) {
    const owner = (typeof window.thirdParty !== 'undefined' && window.thirdParty.listOwners)
      ? window.thirdParty.listOwners().find(o => o.id === ownerId) : null;
    if (!owner) return { ownerId, ownerName: '(없음)', revenue: 0, cost: 0, profit: 0, profitRate: 0, inboundCount: 0, matchedLogs: 0, contractRate: 0 };

    // 매출 — 해당 화주 위탁 입고 전기간 합산
    let revenue = 0;
    let inboundCount = 0;
    const inbounds = (window.thirdParty.listInventory)
      ? window.thirdParty.listInventory({ type: 'inbound', ownerId }) : [];
    inbounds.forEach(r => {
      const fee = (r.qty||0) * (r.watt||0) * (owner.logisticsContractRatePerWp||0);
      if (fee > 0) { revenue += fee; inboundCount++; }
    });

    // 비용 — 해당 화주 위탁 출고 ID 목록
    const outbounds = (window.thirdParty.listInventory)
      ? window.thirdParty.listInventory({ type: 'outbound', ownerId }) : [];
    const ownerOutIds = new Set(outbounds.map(o => o.id));

    // 전기간 매칭 결과에서 해당 화주 출고와 매칭된 운송 명세서 운송료 합산 (VAT 포함)
    const match = matchOutbounds();  // 전기간
    let cost = 0;
    let matchedLogs = 0;
    match.matched.forEach(m => {
      if (ownerOutIds.has(m.outbound.id)) {
        cost += (m.log.fee || 0) + (m.log.vat || 0);  // VAT 포함
        matchedLogs++;
      }
    });

    return {
      ownerId,
      ownerName: owner.name,
      contractRate: owner.logisticsContractRatePerWp || 0,
      inboundCount,
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      profit: Math.round(revenue) - Math.round(cost),
      profitRate: revenue > 0 ? ((Math.round(revenue) - Math.round(cost)) / Math.round(revenue) * 100) : 0,
      matchedLogs
    };
  }

  // ============================================================
  //  수익 분석 (월별 — 하위 호환)
  // ============================================================
  // 매출 = 화주가 부담하는 물류비 (logisticsContractRatePerWp 기반)
  // 비용 = 거래명세서 운송료 합계 (VAT 포함) ★ 2026-05-08 변경
  // 이익 = 매출 - 비용
  function revenueAnalysis(yearMonth) {
    // 비용 = 운송 명세서 VAT 포함 합계
    const cost = getMonthSummary(yearMonth);
    const costAmount = cost.totalAmount || 0;  // ★ 운송료 + VAT

    // 매출 = 해당 월 위탁 입고 → 화주 청구 물류대행비
    let revenue = 0;
    let revenueBreakdown = [];
    if (typeof window.thirdParty !== 'undefined') {
      try {
        const inventory = window.thirdParty.listInventory ? window.thirdParty.listInventory({ type: 'inbound' }) : [];
        const owners = window.thirdParty.listOwners ? window.thirdParty.listOwners() : [];
        inventory.forEach(r => {
          if (!(r.date||'').startsWith(yearMonth)) return;
          const owner = owners.find(o => o.id === r.ownerId);
          if (!owner) return;
          const fee = (r.qty||0) * (r.watt||0) * (owner.logisticsContractRatePerWp||0);
          if (fee > 0) {
            revenue += fee;
            revenueBreakdown.push({
              date: r.date,
              owner: owner.name,
              model: r.model,
              qty: r.qty,
              watt: r.watt,
              ratePerWp: owner.logisticsContractRatePerWp,
              fee: Math.round(fee)
            });
          }
        });
      } catch(e) {}
    }

    return {
      yearMonth,
      revenue: Math.round(revenue),
      cost: costAmount,                                                     // ★ VAT 포함
      profit: Math.round(revenue) - costAmount,
      profitRate: revenue > 0 ? ((Math.round(revenue) - costAmount) / revenue * 100) : 0,
      revenueBreakdown,
      costDetail: cost                                                      // 상세 (운송료 / VAT 분리 보고용)
    };
  }

  // ============================================================
  //  UI
  // ============================================================
  function _injectUI() {
    if (document.getElementById('erp-log-modal')) return;
    const css = `
      #erp-log-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:2vh;}
      #erp-log-modal.open{display:flex;}
      .log-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:97%;max-width:1400px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;}
      .log-hd{padding:14px 20px;background:linear-gradient(135deg,#0d47a1,#1565c0);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .log-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .log-tabs{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #e0e0e0;}
      .log-tab{padding:9px 18px;background:#fff;border:1px solid #e0e0e0;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:0.88em;}
      .log-tab.active{background:#1565c0;color:#fff;border-color:#1565c0;font-weight:700;}
      .log-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .log-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid #1565c0;}
      .log-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .log-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}
      .log-tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:0.84em;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .log-tbl th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:0.82em;}
      .log-tbl td{padding:8px 10px;border-bottom:1px solid #f0f0f0;}
      .log-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .log-btn-primary{background:#1565c0;color:#fff;}
      .log-btn-success{background:#27ae60;color:#fff;}
      .log-btn-danger{background:#c62828;color:#fff;}
      .log-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
      .log-upload-zone{background:#fff;border:2.5px dashed #1565c0;border-radius:10px;padding:30px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s,transform .15s;}
      .log-upload-zone:hover{background:#e3f2fd;}
      .log-upload-zone.drag-over{background:#bbdefb;border-color:#0d47a1;border-width:3.5px;transform:scale(1.01);}
      .log-match-good{background:#e8f5e9;border-left:4px solid #27ae60;}
      .log-match-warn{background:#fff3e0;border-left:4px solid #f9a825;}
      .log-match-err{background:#ffebee;border-left:4px solid #c62828;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-log-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-log-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="log-box">
        <div class="log-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">🚚 물류비 관리 — 거래명세서</h4>
          <button class="log-btn log-btn-ghost" onclick="document.getElementById('erp-log-modal').classList.remove('open')">✕</button>
        </div>
        <div class="log-bd" id="log-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);
    modal.addEventListener('change', _onChange);
    modal.addEventListener('input',  _onInput);
  }

  let _curTab = 'upload';
  let _curMonth = '';
  let _curOwnerId = '';     // ★ 화주 필터 (전역)
  let _curRegion = '';      // ★ 운송지역 필터 (전역) — 차량·평균가 탭에서 사용
  let _curVehicleSearch = ''; // ★ 차량·평균가 탭 검색어 (톤급/운송지역 자유 검색)
  let _editorState = null;
  let _pendingUpload = null;  // ★ 업로드 후 화주 지정 대기 상태

  // ── 정렬용: 톤급 문자열을 수치로 변환 ('5', '5장축', '11', '(미상)') ──
  function _tonSortVal(t) {
    if (!t || t === '(미상)') return 9999;
    const m = String(t).match(/(\d+(?:\.\d+)?)/);
    if (!m) return 9998;
    const n = Number(m[1]);
    if (String(t).includes('장축')) return n + 0.5;  // 5 < 5장축 < 6
    return n;
  }

  function _renderTabs() {
    const tabs = [
      { key:'upload',   label:'📁 업로드 / 명세서' },
      { key:'monthly',  label:'📊 월별 집계' },
      { key:'owners',   label:'🏢 화주별' },
      { key:'vehicle',  label:'🚛 차량·평균가' }
      // ★ 매칭 분석 탭 제거 (2026-05-12)
      // ★ 수익 분석 탭은 타사 재고 → 💹 수익 분석 으로 이동됨 (2026-05-08)
    ];
    // 호환성: _curTab='matching' 으로 남아있으면 upload로 리다이렉트
    if (_curTab === 'matching') _curTab = 'upload';
    return `<div class="log-tabs">${tabs.map(t =>
      `<button class="log-tab ${_curTab===t.key?'active':''}" data-tab="${t.key}">${t.label}</button>`
    ).join('')}</div>`;
  }

  // 화주 옵션 (필터/선택용)
  function _ownerOptions(selectedId) {
    let opts = '<option value="">전체 화주</option>';
    if (typeof window.thirdParty !== 'undefined' && window.thirdParty.listOwners) {
      try {
        const owners = window.thirdParty.listOwners();
        opts += owners.map(o => `<option value="${_ea(o.id)}" ${o.id===selectedId?'selected':''}>${_e(o.name)}</option>`).join('');
      } catch(e) {}
    }
    return opts;
  }

  // ★ 운송지역 옵션 (필터용) — 모든 명세서의 운송지역을 한글 가나다 오름차순으로 묶음
  function _regionOptions(selectedRegion) {
    const regionsSet = new Set();
    invoices.forEach(inv => {
      (inv.items || []).forEach(r => {
        const rg = (r.region || '').trim() || '(미지정)';
        regionsSet.add(rg);
      });
    });
    const regions = [...regionsSet].sort((a, b) => a.localeCompare(b, 'ko'));
    let opts = '<option value="">전체 지역</option>';
    opts += regions.map(rg => `<option value="${_ea(rg)}" ${rg===selectedRegion?'selected':''}>${_e(rg)}</option>`).join('');
    return opts;
  }

  function _renderUpload() {
    const filtered = _curOwnerId ? invoices.filter(i => i.ownerId === _curOwnerId) : invoices;
    const sorted = filtered.slice().sort((a,b) => (b.month||'').localeCompare(a.month||''));
    return `
      ${_renderTabs()}

      <div class="log-upload-zone" id="log-upload-zone" data-act="log-upload">
        <div style="font-size:2.4em;">📁</div>
        <div style="font-size:1em;font-weight:700;color:#1565c0;margin-top:6px;">거래명세서 엑셀 파일 — 클릭 또는 드래그&드롭</div>
        <div style="font-size:0.86em;color:#666;margin-top:4px;">SCG / 바로 / 기타 운송회사 명세서 (.xlsx) 자동 인식</div>
        <div style="font-size:0.76em;color:#888;margin-top:6px;">💡 여러 파일 동시 업로드 가능 · 화주는 업로드 후 지정</div>
        <input type="file" id="log-file-input" accept=".xlsx,.xls" multiple style="display:none;">
      </div>

      ${_pendingUpload ? _renderPendingDialog() : ''}

      <div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <h3 style="font-size:1em;color:#1a1a2e;margin:0;">📋 등록된 명세서 (${sorted.length}건${_curOwnerId?' · 화주 필터':''})</h3>
        <!-- ★ 상단 액션 (체크박스 선택 행에 적용) -->
        <button class="log-btn log-btn-ghost" data-act="log-bulk-detail">🔍 상세 보기</button>
        <button class="log-btn log-btn-ghost" data-act="log-bulk-setowner">🏢 화주 변경</button>
        <button class="log-btn log-btn-danger" data-act="log-bulk-delete">🗑 삭제</button>
        <span style="font-size:0.84em;color:#666;">선택 <strong id="log-sel-cnt" style="color:#0d47a1;">0</strong>건</span>
        <label style="font-size:0.86em;color:#666;font-weight:700;margin-left:auto;">화주 필터:</label>
        <select id="log-owner-filter" style="padding:6px;border:1.5px solid #ddd;border-radius:6px;">${_ownerOptions(_curOwnerId)}</select>
      </div>
      ${sorted.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;margin-top:8px;">등록된 명세서 없음 — 위에서 파일 업로드</div>'
        : `<table class="log-tbl" style="margin-top:8px;">
          <thead><tr>
            <th style="width:32px;text-align:center;"><input type="checkbox" id="log-sel-all" onclick="window.logistics&&window.logistics._toggleAllInvoices(this.checked)"></th>
            <th>청구월</th><th>화주</th><th>운송회사</th><th>파일명 (클릭=다운로드)</th>
            <th style="text-align:right;">건수</th>
            <th style="text-align:right;">운송료</th>
            <th style="text-align:right;">VAT</th>
            <th style="text-align:right;">합계</th>
            <th>검증</th>
            <th>업로드일시</th>
          </tr></thead>
          <tbody>${sorted.map(inv => `<tr>
            <td style="text-align:center;"><input type="checkbox" class="log-inv-chk" data-id="${_ea(inv.id)}" onchange="window.logistics&&window.logistics._updateSelCount()"></td>
            <td><strong>${_e(inv.month)}</strong></td>
            <td>${inv.ownerName ? `<strong style="color:#7b1fa2;">${_e(inv.ownerName)}</strong>` : '<span style="color:#c62828;font-size:0.84em;">⚠️ 미지정</span>'}</td>
            <td>${_e(inv.supplier)}</td>
            <td style="font-size:0.82em;">
              <a href="#" data-act="log-download" data-id="${_ea(inv.id)}"
                 style="color:#1565c0;text-decoration:underline;cursor:pointer;font-weight:600;"
                 title="클릭하면 원본 파일 다운로드${inv.fileBase64?'':' (구버전 업로드 — 다시 업로드 필요)'}">
                📥 ${_e(inv.fileName)}
              </a>
              ${!inv.fileBase64 ? '<span style="font-size:0.74em;color:#c62828;margin-left:4px;" title="구버전 업로드 — 원본 파일 데이터 없음">⚠️</span>' : ''}
            </td>
            <td style="text-align:right;">${(inv.items||[]).length}건</td>
            <td style="text-align:right;">${_fmt(inv.totalFee)}원</td>
            <td style="text-align:right;color:#888;">${_fmt(inv.totalVat)}원</td>
            <td style="text-align:right;font-weight:700;color:#0d47a1;">${_fmt(inv.totalAmount)}원</td>
            <td>${inv.sumValid
              ? '<span style="color:#27ae60;font-size:0.82em;">✅</span>'
              : `<span style="color:#c62828;font-size:0.82em;" title="엑셀 합계 ${_fmt(inv.headerSum)}">⚠️</span>`}</td>
            <td style="font-size:0.78em;color:#888;">${(inv.uploadedAt||'').slice(0,16).replace('T',' ')}</td>
          </tr>`).join('')}</tbody>
        </table>`}

      ${_editorState && _editorState.type === 'detail' ? _renderInvoiceDetail(_editorState.id) : ''}
      ${_editorState && _editorState.type === 'set-owner' ? _renderSetOwnerDialog(_editorState.id) : ''}
    `;
  }

  // 업로드 후 화주 지정 대기 (parsing 완료된 invoice)
  function _renderPendingDialog() {
    const inv = _pendingUpload;
    return `
      <div style="margin-top:14px;background:#fffde7;border-left:5px solid #f9a825;border-radius:8px;padding:14px;">
        <h4 style="margin:0 0 8px;color:#5d4037;">📥 ${_e(inv.fileName)} — 화주 지정 후 등록</h4>
        <div style="font-size:0.86em;color:#666;margin-bottom:10px;">
          ${_e(inv.month)} · ${(inv.items||[]).length}건 · 합계 <strong>${_fmt(inv.totalAmount)}원</strong>
          ${inv.sumValid ? '<span style="color:#27ae60;">✅ 검증 일치</span>' : '<span style="color:#c62828;">⚠️ 합계 불일치</span>'}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <label style="font-weight:700;">화주 선택:</label>
          <select id="log-pending-owner" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;min-width:200px;">
            <option value="">(미지정 — 나중에 변경 가능)</option>
            ${_ownerOptions('')}
          </select>
          <button class="log-btn log-btn-success" data-act="log-pending-confirm">✅ 확정 등록</button>
          <button class="log-btn log-btn-ghost" data-act="log-pending-cancel">❌ 취소</button>
        </div>
      </div>
    `;
  }

  function _renderSetOwnerDialog(id) {
    const inv = getInvoice(id);
    if (!inv) return '';
    return `
      <div style="margin-top:14px;background:#fff;border-left:4px solid #7b1fa2;border-radius:8px;padding:14px;">
        <h4 style="margin:0 0 8px;color:#7b1fa2;">🏢 ${_e(inv.fileName)} — 화주 변경</h4>
        <div style="font-size:0.86em;color:#666;margin-bottom:10px;">현재: ${inv.ownerName ? _e(inv.ownerName) : '<em>미지정</em>'}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="log-edit-owner" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;min-width:200px;">
            <option value="">(미지정)</option>
            ${_ownerOptions(inv.ownerId)}
          </select>
          <button class="log-btn log-btn-success" data-act="log-set-owner-save" data-id="${_ea(inv.id)}">💾 저장</button>
          <button class="log-btn log-btn-ghost" data-act="log-detail-close">취소</button>
        </div>
      </div>
    `;
  }

  function _renderInvoiceDetail(id) {
    const inv = getInvoice(id);
    if (!inv) return '';
    return `
      <div style="margin-top:18px;background:#fff;border-radius:8px;padding:14px;border-left:4px solid #1565c0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;color:#0d47a1;">📄 ${_e(inv.fileName)} 상세 (${inv.items.length}건)</h3>
          <button class="log-btn log-btn-ghost" data-act="log-detail-close">닫기</button>
        </div>
        <table class="log-tbl">
          <thead><tr>
            <th>NO</th><th>일자</th><th>운송지역</th><th>차량</th><th>차주</th>
            <th style="text-align:right;">운송료</th><th style="text-align:right;">VAT</th><th>비고 (위탁건)</th>
          </tr></thead>
          <tbody>${inv.items.map(r => `<tr>
            <td>${r.no}</td>
            <td>${_e(r.date||r.day)}</td>
            <td>${_e(r.region)}</td>
            <td style="font-size:0.82em;">${_e(r.plate)} (${_e(r.ton)}t)</td>
            <td>${_e(r.driver)}</td>
            <td style="text-align:right;">${_fmt(r.fee)}원</td>
            <td style="text-align:right;color:#888;">${_fmt(r.vat)}원</td>
            <td><strong style="color:#0d47a1;">${_e(r.notes||'(미지정)')}</strong></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function _renderMonthly() {
    const months = [...new Set(invoices.map(i => i.month))].sort().reverse();
    if (!_curMonth && months.length > 0) _curMonth = months[0];
    const summary = _curMonth ? getMonthSummary(_curMonth) : null;

    return `
      ${_renderTabs()}
      <div style="background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;display:flex;gap:10px;align-items:center;">
        <label style="font-weight:700;color:#666;">청구월:</label>
        <select id="log-month-select" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
          ${months.map(m => `<option value="${_ea(m)}" ${m===_curMonth?'selected':''}>${_e(m)}</option>`).join('')}
        </select>
      </div>
      ${summary ? `
        <div class="log-stats">
          <div class="log-stat"><div class="log-stat-l">명세서 수</div><div class="log-stat-v">${summary.invoiceCount}장</div></div>
          <div class="log-stat"><div class="log-stat-l">운송 건수</div><div class="log-stat-v">${summary.itemCount}건</div></div>
          <div class="log-stat"><div class="log-stat-l">운송료</div><div class="log-stat-v" style="color:#0d47a1;">${_fmt(summary.totalFee)}원</div></div>
          <div class="log-stat"><div class="log-stat-l">VAT</div><div class="log-stat-v" style="color:#888;">${_fmt(summary.totalVat)}원</div></div>
          <div class="log-stat"><div class="log-stat-l">합계 (VAT 포함)</div><div class="log-stat-v" style="color:#c62828;">${_fmt(summary.totalAmount)}원</div></div>
        </div>

        <h3 style="font-size:1em;color:#1a1a2e;margin:14px 0 8px;">🗺 운송지역별</h3>
        <table class="log-tbl">
          <thead><tr><th>운송지역</th><th style="text-align:right;">건수</th><th style="text-align:right;">운송료</th><th style="text-align:right;">비중</th></tr></thead>
          <tbody>${getByRegion(_curMonth).map(r => `<tr>
            <td><strong>${_e(r.region)}</strong></td>
            <td style="text-align:right;">${r.count}건</td>
            <td style="text-align:right;">${_fmt(r.fee)}원</td>
            <td style="text-align:right;">${(r.fee / summary.totalFee * 100).toFixed(1)}%</td>
          </tr>`).join('')}</tbody>
        </table>
      ` : '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">먼저 명세서를 업로드하세요</div>'}
    `;
  }

  // ★ 화주별 집계 탭
  function _renderOwners() {
    const months = [...new Set(invoices.map(i => i.month))].sort().reverse();
    const groups = getByOwner(_curMonth || null);
    return `
      ${_renderTabs()}
      <div style="background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-weight:700;color:#666;">청구월:</label>
        <select id="log-month-select" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
          <option value="">전체 기간</option>
          ${months.map(m => `<option value="${_ea(m)}" ${m===_curMonth?'selected':''}>${_e(m)}</option>`).join('')}
        </select>
      </div>
      <h3 style="font-size:1em;color:#1a1a2e;margin:14px 0 8px;">🏢 화주별 운송료 집계 — ${groups.length}개 그룹</h3>
      ${groups.length === 0
        ? '<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">데이터 없음</div>'
        : `<table class="log-tbl">
          <thead><tr>
            <th>화주</th><th style="text-align:right;">명세서 수</th>
            <th style="text-align:right;">운송 건수</th>
            <th style="text-align:right;">운송료</th>
            <th style="text-align:right;">VAT</th>
            <th style="text-align:right;">합계</th>
            <th>적용 월</th>
          </tr></thead>
          <tbody>${groups.map(g => `<tr>
            <td><strong style="color:${g.ownerId?'#7b1fa2':'#c62828'};">${_e(g.ownerName)}</strong></td>
            <td style="text-align:right;">${g.invoiceCount}장</td>
            <td style="text-align:right;">${g.itemCount}건</td>
            <td style="text-align:right;">${_fmt(g.fee)}원</td>
            <td style="text-align:right;color:#888;">${_fmt(g.vat)}원</td>
            <td style="text-align:right;font-weight:700;color:#0d47a1;">${_fmt(g.total)}원</td>
            <td style="font-size:0.82em;color:#666;">${g.months.join(', ')}</td>
          </tr>`).join('')}</tbody>
        </table>`}
    `;
  }

  // ★ 차량종류별 + 평균가 분석 탭
  function _renderVehicle() {
    const months = [...new Set(invoices.map(i => i.month))].sort().reverse();
    const owners = (typeof window.thirdParty !== 'undefined' && window.thirdParty.listOwners) ? window.thirdParty.listOwners() : [];
    let vehicles = getByVehicle(_curMonth || null, _curOwnerId || null, _curRegion || null);
    let rateRef = getRateReference(_curOwnerId || null, _curRegion || null);

    // ★ 검색 필터 — 톤급/운송지역 자유 검색
    const q = (_curVehicleSearch || '').toLowerCase().trim();
    if (q) {
      vehicles = vehicles.filter(v => String(v.ton||'').toLowerCase().includes(q));
      rateRef  = rateRef.filter(r =>
        String(r.region||'').toLowerCase().includes(q) ||
        String(r.ton||'').toLowerCase().includes(q)
      );
    }

    return `
      ${_renderTabs()}
      <div style="background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-weight:700;color:#666;">청구월:</label>
        <select id="log-month-select" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
          <option value="">전체 기간</option>
          ${months.map(m => `<option value="${_ea(m)}" ${m===_curMonth?'selected':''}>${_e(m)}</option>`).join('')}
        </select>
        <label style="font-weight:700;color:#666;">화주:</label>
        <select id="log-owner-filter" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">${_ownerOptions(_curOwnerId)}</select>
        <label style="font-weight:700;color:#666;">운송지역:</label>
        <select id="log-region-filter" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;min-width:180px;">${_regionOptions(_curRegion)}</select>
        <label style="font-weight:700;color:#666;">검색:</label>
        <input id="log-vehicle-search" type="search" placeholder="🔍 톤급 (예: 5, 5장축) / 지역 (예: 서울)"
               value="${_ea(_curVehicleSearch)}"
               style="padding:7px 10px;border:1.5px solid #ddd;border-radius:6px;min-width:240px;flex:1;">
        ${q ? `<button id="log-vehicle-search-clear" class="log-btn log-btn-ghost" type="button" title="검색 지우기" style="padding:5px 10px;">✕ 지우기</button>` : ''}
      </div>

      <h3 style="font-size:1em;color:#1a1a2e;margin:14px 0 8px;">🚛 차량 톤급별 평균 운송료${q?` <span style="font-size:0.78em;color:#7b1fa2;font-weight:600;">— 검색 결과 ${vehicles.length}건</span>`:''}</h3>
      ${vehicles.length === 0
        ? `<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">${q?`"${_e(_curVehicleSearch)}" 검색 결과 없음`:'데이터 없음'}</div>`
        : `<table class="log-tbl">
          <thead><tr>
            <th>차량 톤급</th>
            <th style="text-align:right;">건수</th>
            <th style="text-align:right;">운송료 합계</th>
            <th style="text-align:right;">평균</th>
            <th style="text-align:right;">중위수</th>
            <th style="text-align:right;">최소</th>
            <th style="text-align:right;">최대</th>
            <th style="text-align:right;">표준편차</th>
          </tr></thead>
          <tbody>${vehicles.map(v => `<tr>
            <td><strong style="color:#1565c0;">${_e(v.ton)}톤급</strong></td>
            <td style="text-align:right;">${v.count}건</td>
            <td style="text-align:right;">${_fmt(v.totalFee)}원</td>
            <td style="text-align:right;font-weight:700;color:#0d47a1;">${_fmt(v.avg)}원</td>
            <td style="text-align:right;">${_fmt(v.median)}원</td>
            <td style="text-align:right;color:#27ae60;">${_fmt(v.min)}원</td>
            <td style="text-align:right;color:#c62828;">${_fmt(v.max)}원</td>
            <td style="text-align:right;color:#666;">±${_fmt(v.stdDev)}원</td>
          </tr>`).join('')}</tbody>
        </table>`}

      <h3 style="font-size:1em;color:#1a1a2e;margin:18px 0 8px;">📍 운송지역 × 차량 톤급 평균가 참조표 — 차후 견적/검증용${q?` <span style="font-size:0.78em;color:#7b1fa2;font-weight:600;">— 검색 결과 ${rateRef.length}건</span>`:''}</h3>
      <div style="background:#fffde7;border-left:4px solid #f9a825;padding:8px 10px;border-radius:6px;margin-bottom:8px;font-size:0.86em;color:#5d4037;">
        💡 동일 지역 + 동일 톤급의 과거 운송료 통계입니다. 신규 견적 시 평균가와 비교해 적정성 검토 가능.
      </div>
      ${rateRef.length === 0
        ? `<div style="background:#fff;padding:30px;border-radius:8px;text-align:center;color:#bbb;">${q?`"${_e(_curVehicleSearch)}" 검색 결과 없음`:'데이터 없음'}</div>`
        : `<table class="log-tbl">
          <thead><tr>
            <th>운송지역</th><th>톤급</th>
            <th style="text-align:right;">샘플 수</th>
            <th style="text-align:right;">평균</th>
            <th style="text-align:right;">최소</th>
            <th style="text-align:right;">P25</th>
            <th style="text-align:right;">P75</th>
            <th style="text-align:right;">최대</th>
            <th>가격 변동 폭</th>
          </tr></thead>
          <tbody>${rateRef.map(r => {
            const spread = r.max - r.min;
            const spreadPct = r.avg > 0 ? (spread / r.avg * 100) : 0;
            const spreadColor = spreadPct < 10 ? '#27ae60' : (spreadPct < 25 ? '#f9a825' : '#c62828');
            return `<tr>
            <td><strong>${_e(r.region)}</strong></td>
            <td><span style="background:#e3f2fd;color:#0d47a1;padding:2px 8px;border-radius:4px;font-size:0.82em;">${_e(r.ton)}t</span></td>
            <td style="text-align:right;">${r.count}건</td>
            <td style="text-align:right;font-weight:700;color:#0d47a1;">${_fmt(r.avg)}원</td>
            <td style="text-align:right;color:#27ae60;">${_fmt(r.min)}원</td>
            <td style="text-align:right;color:#666;">${_fmt(r.p25)}원</td>
            <td style="text-align:right;color:#666;">${_fmt(r.p75)}원</td>
            <td style="text-align:right;color:#c62828;">${_fmt(r.max)}원</td>
            <td style="color:${spreadColor};font-weight:700;">±${_fmt(spread)}원 (${spreadPct.toFixed(0)}%)</td>
          </tr>`;
          }).join('')}</tbody>
        </table>`}
    `;
  }

  // _renderNotes 제거 — 위탁건별 탭 삭제 (2026-05-08, 사용자 요구)

  function _renderMatching() {
    const months = [...new Set(invoices.map(i => i.month))].sort().reverse();
    if (!_curMonth && months.length > 0) _curMonth = months[0];
    const result = matchOutbounds(_curMonth);
    const { matched, unmatchedLogs, unmatchedOuts, stats } = result;
    const matchClass = stats.matchRate >= 80 ? 'log-match-good' : (stats.matchRate >= 50 ? 'log-match-warn' : 'log-match-err');
    const matchColor = stats.matchRate >= 80 ? '#27ae60' : (stats.matchRate >= 50 ? '#f9a825' : '#c62828');
    return `
      ${_renderTabs()}
      <div style="background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="font-weight:700;color:#666;">청구월:</label>
        <select id="log-month-select" style="padding:7px;border:1.5px solid #ddd;border-radius:6px;">
          <option value="">전체 기간</option>
          ${months.map(m => `<option value="${_ea(m)}" ${m===_curMonth?'selected':''}>${_e(m)}</option>`).join('')}
        </select>
        <span style="color:#666;font-size:0.86em;margin-left:auto;">매칭 키: 비고(위탁건 ID) + 일자(±3일)</span>
      </div>

      <div class="log-stats">
        <div class="log-stat ${matchClass}">
          <div class="log-stat-l">매칭률</div>
          <div class="log-stat-v" style="color:${matchColor};">${stats.matchRate.toFixed(0)}%</div>
          <div style="font-size:0.78em;color:#666;margin-top:2px;">${stats.matchedCount}/${stats.totalLogs}</div>
        </div>
        <div class="log-stat"><div class="log-stat-l">매칭 성공</div><div class="log-stat-v" style="color:#27ae60;">${matched.length}건</div></div>
        <div class="log-stat"><div class="log-stat-l">⚠️ 운송만 (출고 미등록)</div><div class="log-stat-v" style="color:#c62828;">${unmatchedLogs.length}건</div></div>
        <div class="log-stat"><div class="log-stat-l">⚠️ 출고만 (운송 누락)</div><div class="log-stat-v" style="color:#f9a825;">${unmatchedOuts.length}건</div></div>
      </div>

      ${unmatchedLogs.length > 0 ? `
        <h3 style="font-size:1em;color:#c62828;margin:18px 0 8px;">⚠️ 운송 명세서에는 있으나 위탁 출고 기록이 없는 항목 (${unmatchedLogs.length}건)</h3>
        <div style="background:#ffebee;padding:8px;border-radius:6px;margin-bottom:8px;font-size:0.84em;color:#c62828;">
          → 출고 기록이 미등록되었거나, 비고/일자가 일치하지 않습니다. <strong>타사 재고 → 위탁 입고/출고 등록</strong>에서 확인하세요.
        </div>
        <table class="log-tbl">
          <thead><tr><th>일자</th><th>위탁건 (비고)</th><th>운송지역</th><th>차량</th><th style="text-align:right;">운송료</th></tr></thead>
          <tbody>${unmatchedLogs.map(r => `<tr class="log-match-err">
            <td>${_e(r.date||r.day)}</td>
            <td><strong>${_e(r.notes||'(미지정)')}</strong></td>
            <td>${_e(r.region)}</td>
            <td style="font-size:0.82em;">${_e(r.plate)} (${_e(r.ton)}t) ${_e(r.driver)}</td>
            <td style="text-align:right;">${_fmt(r.fee)}원</td>
          </tr>`).join('')}</tbody>
        </table>
      ` : ''}

      ${unmatchedOuts.length > 0 ? `
        <h3 style="font-size:1em;color:#f9a825;margin:18px 0 8px;">⚠️ 위탁 출고는 있으나 운송 명세서에 누락된 항목 (${unmatchedOuts.length}건)</h3>
        <div style="background:#fff3e0;padding:8px;border-radius:6px;margin-bottom:8px;font-size:0.84em;color:#e65100;">
          → 운송회사가 명세서에 누락했거나, 우리 측 출고 기록의 비고/일자가 정확하지 않을 수 있습니다.
        </div>
        <table class="log-tbl">
          <thead><tr><th>일자</th><th>화주</th><th>모델</th><th style="text-align:right;">수량</th><th>위치</th><th>비고</th></tr></thead>
          <tbody>${unmatchedOuts.map(o => `<tr class="log-match-warn">
            <td>${_e(o.date)}</td>
            <td>${_e(o.ownerName)}</td>
            <td>${_e(o.model)}</td>
            <td style="text-align:right;">${_fmt(o.qty)}매</td>
            <td>${_e(o.warehouseName||'-')}${o.zoneName?' · '+_e(o.zoneName):''}</td>
            <td>${_e(o.notes||'(없음)')}</td>
          </tr>`).join('')}</tbody>
        </table>
      ` : ''}

      ${matched.length > 0 ? `
        <h3 style="font-size:1em;color:#27ae60;margin:18px 0 8px;">✅ 매칭 성공 (${matched.length}건)</h3>
        <table class="log-tbl">
          <thead><tr><th>위탁건</th><th>운송 일자</th><th>운송료</th><th>출고 일자</th><th>화주·모델·수량</th><th>신뢰도</th></tr></thead>
          <tbody>${matched.slice(0, 30).map(m => `<tr class="log-match-good">
            <td><strong>${_e(m.log.notes)}</strong></td>
            <td>${_e(m.log.date)}</td>
            <td style="text-align:right;">${_fmt(m.log.fee)}원</td>
            <td>${_e(m.outbound.date)}</td>
            <td>${_e(m.outbound.ownerName)} · ${_e(m.outbound.model)} · ${_fmt(m.outbound.qty)}매</td>
            <td>${(m.confidence*100).toFixed(0)}%</td>
          </tr>`).join('')}${matched.length > 30 ? `<tr><td colspan="6" style="text-align:center;color:#888;">... 외 ${matched.length-30}건</td></tr>` : ''}</tbody>
        </table>
      ` : ''}
    `;
  }

  // 화주별 수익 분석 — 모든 화주를 한 화면에 비교
  function _renderRevenue() {
    const owners = (typeof window.thirdParty !== 'undefined' && window.thirdParty.listOwners)
      ? window.thirdParty.listOwners() : [];
    if (owners.length === 0) {
      return `${_renderTabs()}<div style="background:#fff3e0;padding:20px;border-radius:8px;color:#e65100;">⚠️ 등록된 화주가 없습니다. <strong>타사 재고 → 화주 관리</strong>에서 화주를 먼저 등록하세요.</div>`;
    }

    // 화주별 수익 계산
    const rows = owners.map(o => revenueAnalysisByOwner(o.id));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalProfit = totalRevenue - totalCost;
    const totalRate = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

    return `
      ${_renderTabs()}
      <h3 style="font-size:1em;color:#1a1a2e;margin:0 0 10px;">💰 화주별 수익 분석 (전체 기간 누적)</h3>

      <div class="log-stats">
        <div class="log-stat" style="border-left-color:#27ae60;">
          <div class="log-stat-l">전체 매출</div>
          <div class="log-stat-v" style="color:#27ae60;">${_fmt(totalRevenue)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">화주 청구 합계</div>
        </div>
        <div class="log-stat" style="border-left-color:#c62828;">
          <div class="log-stat-l">전체 비용</div>
          <div class="log-stat-v" style="color:#c62828;">${_fmt(totalCost)}원</div>
          <div style="font-size:0.74em;color:#888;margin-top:2px;">매칭된 운송료 (VAT 포함)</div>
        </div>
        <div class="log-stat" style="border-left-color:${totalProfit>=0?'#1565c0':'#c62828'};">
          <div class="log-stat-l">전체 이익</div>
          <div class="log-stat-v" style="color:${totalProfit>=0?'#1565c0':'#c62828'};">${_fmt(totalProfit)}원</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-l">평균 이익률</div>
          <div class="log-stat-v" style="color:${totalRate>=0?'#1565c0':'#c62828'};">${totalRate.toFixed(1)}%</div>
        </div>
      </div>

      <h3 style="font-size:1em;color:#1a1a2e;margin:18px 0 8px;">🏢 화주별 상세</h3>
      <table class="log-tbl">
        <thead><tr>
          <th>화주</th>
          <th style="text-align:right;">계약단가</th>
          <th style="text-align:right;">위탁 입고 건수</th>
          <th style="text-align:right;">매출 (청구)</th>
          <th style="text-align:right;">비용 (운송, VAT 포함)</th>
          <th style="text-align:right;">이익</th>
          <th style="text-align:right;">이익률</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${_e(r.ownerName)}</strong></td>
          <td style="text-align:right;color:#0d47a1;">${r.contractRate>0 ? r.contractRate+'원/Wp' : '<span style="color:#c62828;">미설정</span>'}</td>
          <td style="text-align:right;">${r.inboundCount}건</td>
          <td style="text-align:right;font-weight:700;color:#27ae60;">${_fmt(r.revenue)}원</td>
          <td style="text-align:right;color:#c62828;">${_fmt(r.cost)}원<br><span style="font-size:0.74em;color:#888;">${r.matchedLogs}건 매칭</span></td>
          <td style="text-align:right;font-weight:700;color:${r.profit>=0?'#1565c0':'#c62828'};">${_fmt(r.profit)}원</td>
          <td style="text-align:right;font-weight:700;color:${r.profitRate>=0?'#1565c0':'#c62828'};">${r.profitRate.toFixed(1)}%</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:#f5f5f5;font-weight:700;">
          <td colspan="3">합계</td>
          <td style="text-align:right;color:#27ae60;">${_fmt(totalRevenue)}원</td>
          <td style="text-align:right;color:#c62828;">${_fmt(totalCost)}원</td>
          <td style="text-align:right;color:${totalProfit>=0?'#1565c0':'#c62828'};">${_fmt(totalProfit)}원</td>
          <td style="text-align:right;color:${totalRate>=0?'#1565c0':'#c62828'};">${totalRate.toFixed(1)}%</td>
        </tr></tfoot>
      </table>

      <div style="margin-top:12px;background:#fff3e0;padding:10px;border-radius:6px;font-size:0.84em;color:#e65100;line-height:1.5;">
        💡 <strong>계산 방식:</strong><br>
        ▸ <strong>매출</strong> = 해당 화주 위탁 입고 × 용량(W) × 계약단가(원/Wp) — 화주별 전기간 합산<br>
        ▸ <strong>비용</strong> = 해당 화주 위탁 출고와 매칭된 거래명세서 운송료 (VAT 포함)<br>
        ▸ <strong>이익</strong> = 매출 - 비용
      </div>

      ${rows.some(r => r.contractRate === 0) ? `
        <div style="margin-top:8px;background:#ffebee;padding:10px;border-radius:6px;font-size:0.84em;color:#c62828;">
          ⚠️ 일부 화주의 <strong>계약단가(logisticsContractRatePerWp)</strong>가 설정되지 않았습니다.
          <strong>타사 재고 → 화주 관리</strong>에서 계약단가를 입력하세요.
        </div>
      ` : ''}
    `;
  }

  function _render() {
    _injectUI();
    const bd = document.getElementById('log-bd');
    if (!bd) return;
    if (_curTab === 'upload')        bd.innerHTML = _renderUpload();
    else if (_curTab === 'monthly')  bd.innerHTML = _renderMonthly();
    else if (_curTab === 'owners')   bd.innerHTML = _renderOwners();
    else if (_curTab === 'vehicle')  bd.innerHTML = _renderVehicle();
    // 'matching' / 'revenue' 탭 제거 → upload 로 리다이렉트
    else if (_curTab === 'matching' || _curTab === 'revenue') { _curTab = 'upload'; _render(); return; }
    else { _curTab = 'upload'; _render(); }
    // 업로드 탭 진입 시 드래그 핸들러 부착
    if (_curTab === 'upload') setTimeout(_bindDropZone, 30);
  }

  // ── 드래그&드롭 업로드 ────────────────────────────
  function _bindDropZone() {
    const zone = document.getElementById('log-upload-zone');
    if (!zone || zone.__bound) return;
    zone.__bound = true;
    ['dragenter','dragover'].forEach(ev => {
      zone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
      });
    });
    ['dragleave','dragend'].forEach(ev => {
      zone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        // 자식으로 이동한 dragleave 는 무시 (relatedTarget 이 zone 내부면 skip)
        if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return;
        zone.classList.remove('drag-over');
      });
    });
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
      const files = [...(e.dataTransfer?.files || [])].filter(f => /\.(xlsx|xls)$/i.test(f.name));
      if (files.length === 0) {
        alert('xlsx / xls 파일만 업로드 가능합니다.');
        return;
      }
      await _uploadFiles(files);
    });
  }

  async function _uploadFiles(files) {
    let succ = 0, fail = 0;
    for (const file of files) {
      try {
        const inv = await parseFile(file);
        // 다중 파일이면 화주 지정 dialog 없이 즉시 등록 (개별 변경 가능)
        if (files.length > 1) {
          const result = addInvoice(inv);
          if (result) succ++;
        } else {
          // 단일 파일: 화주 지정 dialog 표시
          _pendingUpload = inv;
          _render();
          return;
        }
      } catch (err) {
        console.error('[logistics] parse error', file.name, err);
        fail++;
      }
    }
    if (typeof setBanner === 'function') {
      setBanner(fail===0?'ok':'warn', `📁 다중 업로드 — 성공 ${succ}건${fail>0?', 실패 '+fail+'건':''}`);
    }
    _render();
  }

  // ── 액션 ────────────────────────────────────────
  function _onModalClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { _curTab = tabBtn.getAttribute('data-tab'); _editorState = null; _render(); return; }
    // ★ 차량·평균가 탭 검색 지우기
    if (e.target.id === 'log-vehicle-search-clear') {
      _curVehicleSearch = '';
      _render();
      const next = document.getElementById('log-vehicle-search');
      if (next) next.focus();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    if (act === 'log-upload') {
      document.getElementById('log-file-input')?.click();
    }
    else if (act === 'log-detail') {
      _editorState = { type: 'detail', id };
      _render();
    }
    else if (act === 'log-detail-close') {
      _editorState = null;
      _render();
    }
    else if (act === 'log-set-owner') {
      _editorState = { type: 'set-owner', id };
      _render();
    }
    else if (act === 'log-set-owner-save') {
      const ownerSel = document.getElementById('log-edit-owner');
      const ownerId = ownerSel?.value || '';
      let ownerName = '';
      if (ownerId && typeof window.thirdParty !== 'undefined' && window.thirdParty.getOwner) {
        const o = window.thirdParty.getOwner(ownerId);
        if (o) ownerName = o.name;
      }
      updateInvoice(id, { ownerId, ownerName });
      if (typeof setBanner === 'function') setBanner('ok', `🏢 화주 변경 — ${ownerName || '(미지정)'}`);
      _editorState = null;
      _render();
    }
    else if (act === 'log-pending-confirm') {
      if (!_pendingUpload) return;
      const ownerSel = document.getElementById('log-pending-owner');
      const ownerId = ownerSel?.value || '';
      let ownerName = '';
      if (ownerId && typeof window.thirdParty !== 'undefined' && window.thirdParty.getOwner) {
        const o = window.thirdParty.getOwner(ownerId);
        if (o) ownerName = o.name;
      }
      _pendingUpload.ownerId = ownerId;
      _pendingUpload.ownerName = ownerName;
      const result = addInvoice(_pendingUpload);
      if (result && typeof setBanner === 'function')
        setBanner('ok', `✅ ${result.month} 명세서 등록 — ${result.items.length}건, ${_fmt(result.totalAmount)}원${ownerName ? ' (화주: '+ownerName+')' : ''}`);
      _pendingUpload = null;
      _render();
    }
    else if (act === 'log-pending-cancel') {
      _pendingUpload = null;
      _render();
    }
    else if (act === 'log-delete') {
      const inv = getInvoice(id);
      if (!inv) return;
      if (!confirm(`${inv.month} ${inv.fileName} 명세서를 삭제합니까?`)) return;
      removeInvoice(id);
      if (typeof setBanner === 'function') setBanner('ok', '🗑 명세서 삭제됨');
      _render();
    }
    // ── ★ 파일명 클릭 → 원본 다운로드 ────────────────
    else if (act === 'log-download') {
      e.preventDefault();
      _downloadOriginal(id);
    }
    // ── ★ 일괄 액션 (체크박스 선택 행에 적용) ────────
    else if (act === 'log-bulk-detail') _bulkDetailUI();
    else if (act === 'log-bulk-setowner') _bulkSetOwnerUI();
    else if (act === 'log-bulk-delete') _bulkDeleteUI();
  }

  // ── 원본 파일 다운로드 (base64 → blob) ───────────
  function _downloadOriginal(id) {
    const inv = getInvoice(id);
    if (!inv) return;
    if (!inv.fileBase64) {
      alert('원본 파일이 없습니다 (구버전 업로드).\n다시 업로드하면 다운로드 가능합니다.');
      return;
    }
    try {
      const binary = atob(inv.fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = inv.fileName || ('logistics_' + inv.month + '.xlsx');
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      if (typeof setBanner === 'function') setBanner('ok', `📥 ${inv.fileName} 다운로드`);
    } catch (err) {
      alert('다운로드 실패: ' + err.message);
    }
  }

  // ── 일괄: 상세 보기 (선택된 첫 건) ────────────────
  function _bulkDetailUI() {
    const checked = document.querySelectorAll('.log-inv-chk:checked');
    if (checked.length === 0) { alert('상세를 볼 명세서를 체크박스로 선택하세요.'); return; }
    const id = checked[0].getAttribute('data-id');
    _editorState = { type: 'detail', id };
    _render();
  }

  // ── 일괄: 화주 변경 (선택된 첫 건만 — 다이얼로그 후 일괄 적용) ────
  function _bulkSetOwnerUI() {
    const checked = document.querySelectorAll('.log-inv-chk:checked');
    if (checked.length === 0) { alert('화주를 변경할 명세서를 체크박스로 선택하세요.'); return; }
    const ids = Array.from(checked).map(el => el.getAttribute('data-id'));
    // 단일 선택 → 다이얼로그, 다중 선택 → prompt 로 화주 선택
    if (ids.length === 1) {
      _editorState = { type: 'set-owner', id: ids[0] };
      _render();
      return;
    }
    // 다중 선택 — 화주 prompt
    const owners = (typeof window.thirdParty !== 'undefined' && window.thirdParty.listOwners)
      ? window.thirdParty.listOwners() : [];
    if (owners.length === 0) { alert('등록된 화주가 없습니다.'); return; }
    const list = owners.map((o, i) => `${i+1}. ${o.name}`).join('\n');
    const sel = prompt(`선택한 ${ids.length}건 명세서를 어떤 화주로 변경?\n\n${list}\n\n번호 입력 (취소: 빈칸):`);
    const idx = parseInt(sel) - 1;
    if (isNaN(idx) || idx < 0 || idx >= owners.length) return;
    const owner = owners[idx];
    ids.forEach(id => updateInvoice(id, { ownerId: owner.id, ownerName: owner.name }));
    if (typeof setBanner === 'function') setBanner('ok', `🏢 ${ids.length}건 → ${owner.name}`);
    _render();
  }

  // ── 일괄: 삭제 ────────────────────────────────────
  function _bulkDeleteUI() {
    const checked = document.querySelectorAll('.log-inv-chk:checked');
    if (checked.length === 0) { alert('삭제할 명세서를 체크박스로 선택하세요.'); return; }
    const ids = Array.from(checked).map(el => el.getAttribute('data-id'));
    if (!confirm(`선택한 ${ids.length}건의 명세서를 삭제합니까?`)) return;
    ids.forEach(id => removeInvoice(id));
    if (typeof setBanner === 'function') setBanner('ok', `🗑 명세서 ${ids.length}건 삭제`);
    _render();
  }

  // ── 체크박스 전체 토글 + 선택 카운트 ──────────────
  function _toggleAllInvoices(checked) {
    document.querySelectorAll('.log-inv-chk').forEach(el => { el.checked = checked; });
    _updateSelCount();
  }
  function _updateSelCount() {
    const cnt = document.querySelectorAll('.log-inv-chk:checked').length;
    const lbl = document.getElementById('log-sel-cnt');
    if (lbl) lbl.textContent = cnt;
  }

  async function _onChange(e) {
    if (e.target.id === 'log-file-input') {
      const files = [...(e.target.files || [])];
      if (files.length === 0) return;
      try {
        await _uploadFiles(files);
      } catch (err) {
        alert('업로드 실패: ' + err.message);
      }
      e.target.value = '';
    }
    else if (e.target.id === 'log-month-select') {
      _curMonth = e.target.value;
      _render();
    }
    else if (e.target.id === 'log-owner-filter') {
      _curOwnerId = e.target.value;
      _render();
    }
    else if (e.target.id === 'log-region-filter') {
      _curRegion = e.target.value;
      _render();
    }
  }

  // ★ 실시간 입력 이벤트 — 차량·평균가 탭 검색 (한 글자마다 필터링)
  //   _render() 가 DOM 전체를 재구성하므로, 포커스/커서 위치를 복원해야 사용자가 계속 타이핑 가능
  function _onInput(e) {
    if (e.target.id !== 'log-vehicle-search') return;
    _curVehicleSearch = e.target.value || '';
    const caret = e.target.selectionStart;
    _render();
    // 재렌더 후 검색창에 다시 포커스 + 커서 위치 복원
    const next = document.getElementById('log-vehicle-search');
    if (next) {
      next.focus();
      try { next.setSelectionRange(caret, caret); } catch(err) {}
    }
  }

  // ── 진입점 ──────────────────────────────────────
  function open() {
    _injectUI();
    document.getElementById('erp-log-modal').classList.add('open');
    setTimeout(_render, 30);
  }
  function close() {
    document.getElementById('erp-log-modal')?.classList.remove('open');
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    load();
    setTimeout(_injectUI, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.logistics = {
    listInvoices, getInvoice, addInvoice, removeInvoice, updateInvoice,
    parseFile,
    getMonthSummary, getByNotes, getByRegion, getByOwner,
    getByVehicle, getRateReference,
    matchOutbounds, revenueAnalysis, revenueAnalysisByOwner,
    open, close, reload: load,
    // ★ 체크박스 / 다운로드용 (DOM 이벤트 핸들러)
    _toggleAllInvoices, _updateSelCount
  };

  console.log('[ERP-LOG] 물류비 관리 활성 — logistics.open()');
})();
