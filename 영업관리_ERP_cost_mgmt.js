// =====================================================
//  COST MGMT — 원가관리 (수입 물류비)
//  - 자체완결형(self-contained) IIFE 모듈 — logistics.js 패턴 따름
//  - 3개 서브섹션: 인보이스 관리 / 입고일정 보고서 / 원가 분석
//  - PDF.js 동적 로드 후 INVOICE PDF 자동 파싱 (선진로지스 · C&I LOGISTICS 등)
//  - 데이터: localStorage erp_cost_invoices / erp_cost_schedule
// =====================================================
(function(){
  'use strict';

  const TAB_ID    = 'cost_mgmt';
  const HOST_ID   = 'costMgmtTabHost';
  const PANEL_ID  = 'tab-' + TAB_ID;
  const KEY_INV   = 'erp_cost_invoices';
  const KEY_SCH   = 'erp_cost_schedule';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ─────────────────────────────────────────────────────
  //  state
  // ─────────────────────────────────────────────────────
  let _invoices = [];   // [{ id, invoiceNo, invoiceDate, blNo, masterBl, customer, actCustomer, vessel, voyage, pol, pod, etd, eta, packages, weight, cbm, containers:[{type,qty}], items:[{label,amount,vat}], totalAmount, totalVat, totalAmountVAT, filename, registeredAt }]
  let _schedule = {};   // { 'YYYY-MM': [{ id, date:'YYYY-MM-DD', vehicles, plt, qty, note }, ...] }
  let _activeSub = 'invoice';  // invoice / schedule / analysis
  let _curMonth = _ymCur();
  let _filterMonth = '';  // 인보이스 월 필터 ('' = 전체)
  let _filterSearch = '';
  let _pdfjsReady = false;

  // ─────────────────────────────────────────────────────
  //  utils
  // ─────────────────────────────────────────────────────
  function _ymCur(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _ym(s){ if(!s) return ''; const m=String(s).match(/(\d{4})-(\d{2})/); return m?m[1]+'-'+m[2]:''; }
  function _fmt(n){ return (Number(n)||0).toLocaleString('ko-KR'); }
  function _fmtM(n){ const v=Number(n)||0; return v>=100000000?(v/100000000).toFixed(1)+'억':v>=10000000?(v/10000000).toFixed(1)+'천만':v>=10000?(v/10000).toFixed(0)+'만':_fmt(v); }
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function _uid(p){ return (p||'CM')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7); }
  function _save(){
    try{ localStorage.setItem(KEY_INV, JSON.stringify(_invoices)); }catch(e){ console.error('[costMgmt] save inv:', e); }
    try{ localStorage.setItem(KEY_SCH, JSON.stringify(_schedule)); }catch(e){ console.error('[costMgmt] save sch:', e); }
  }
  function _load(){
    try{ _invoices = JSON.parse(localStorage.getItem(KEY_INV) || '[]'); if(!Array.isArray(_invoices)) _invoices=[]; }catch(e){ _invoices=[]; }
    try{ _schedule = JSON.parse(localStorage.getItem(KEY_SCH) || '{}'); if(!_schedule||typeof _schedule!=='object') _schedule={}; }catch(e){ _schedule={}; }
  }
  function _banner(t, m){
    if (typeof setBanner === 'function') setBanner(t, m);
    else console.log('[costMgmt:'+t+']', m);
  }
  function _excelDate(v){
    if (!v) return '';
    if (typeof v === 'number' && v > 25569 && v < 60000) {
      const d = new Date((v - 25569) * 86400000);
      return d.toISOString().slice(0,10);
    }
    const s = String(v).trim();
    let m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { const y = m[3].length===2 ? '20'+m[3] : m[3]; return y+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0'); }
    return s;
  }

  // ─────────────────────────────────────────────────────
  //  PDF.js loader
  // ─────────────────────────────────────────────────────
  function _ensurePdfJs(){
    if (_pdfjsReady && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window.pdfjsLib) { _pdfjsReady = true; return Promise.resolve(window.pdfjsLib); }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch(e){}
        _pdfjsReady = true;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('PDF.js 로드 실패'));
      document.head.appendChild(s);
    });
  }

  async function _readPdfText(file){
    const pdfjs = await _ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(it => it.str).join('\n'));
    }
    return pages.join('\n\n');
  }

  // ─────────────────────────────────────────────────────
  //  INVOICE PDF 파서 — 벤더 무관 (선진로지스 / C&I LOGISTICS / 기타)
  //  지원 양식:
  //   - 선진로지스: B/L No., MASTER B/L, INVOICE DATE, 운송료, CFS+SHUTTLE
  //   - C&I LOGISTICS: H.B/L No., M.B/L No., 청구일자, 컨테이너 적출료, 창고 보관료
  // ─────────────────────────────────────────────────────
  function _parseInvoicePdf(text, filename){
    const lines = text.split(/\r?\n/).map(s=>s.trim());
    const all = text;

    // m(): 첫 번째 매치의 그룹1 반환. mAll(): 모든 매치의 그룹들을 배열로
    const m = (re) => { const r = all.match(re); return r ? (r[1]||'').trim() : ''; };

    // 날짜 패턴: YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD 모두 매치
    const DATE = /(\d{4}[-./]\d{1,2}[-./]\d{1,2})/;
    const _normDate = (s) => {
      if (!s) return '';
      const r = s.match(DATE);
      if (!r) return '';
      const [y, mo, d] = r[1].split(/[-./]/);
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    };

    // SLi = single-line ([ \t] only, no newline) — 라벨+값이 같은 줄에 있을 때만 매치
    const SL = '[ \\t]*';
    // m1(): 같은 줄(single-line)에서만 값 매치
    const m1 = (re) => m(re);

    // ── B/L No. (값-우선 추출 — 알려진 패턴이 가장 신뢰성 있음) ──
    //   H.B/L 라인 (값 같은 줄에 있을 때만), 없으면 알려진 B/L 패턴
    const knownPattern = m(/\b(KD\d{8,}|CHLY[A-Z0-9]+|STL\d{6,})\b/i);
    const hbl = m(new RegExp(`H\\.?${SL}B\\/?L${SL}N[O0]\\.?${SL}[:#]${SL}([A-Z]{2,5}\\d{4,})`, 'i'));
    const mbl = m(new RegExp(`M\\.?${SL}B\\/?L${SL}N[O0]\\.?${SL}[:#]${SL}([A-Z]{2,5}\\d{4,})`, 'i'));

    const inv = {
      id: _uid('INV'),
      // INVOICE No. — 같은 줄에 값이 있어야 매치 (예: "INVOICE No. : OI2604776/1S1")
      invoiceNo:   m1(new RegExp(`INVOICE${SL}N[O0]\\.${SL}[:#]${SL}([A-Z0-9\\/]+)`, 'i')),
      // 발행일: INVOICE DATE / 청구일자
      invoiceDate: _normDate(m1(new RegExp(`INV(?:OICE)?${SL}DATE${SL}[:#]${SL}([0-9\\-\\.\\/]+)`, 'i')))
                || _normDate(m1(new RegExp(`청구일자${SL}[:#]${SL}(\\d{4}[\\-\\.\\/]\\d{1,2}[\\-\\.\\/]\\d{1,2})`, 'i'))),
      // B/L No. — 알려진 패턴 우선 (가장 신뢰성 있음)
      blNo:        knownPattern || hbl || m(/(KD\d{10,})/i),
      masterBl:    mbl || m(new RegExp(`MASTER${SL}B\\/?L${SL}[:#]${SL}([A-Z0-9\\/]+)`, 'i')) || m(/(DJSCN[A-Z0-9]{10,})/i),
      // 화주: TO 옆 또는 한글 회사명 (fallback에서 처리)
      customer:    m1(new RegExp(`CUSTOMER${SL}[:#]${SL}([^\\n]{2,40})`, 'i')),
      actCustomer: m1(new RegExp(`ACT\\.?${SL}CUSTOMER${SL}[:#]${SL}([^\\n]{2,40})`, 'i')),
      // 운송 정보 (같은 줄)
      vessel:      m1(new RegExp(`VESSEL${SL}NAME${SL}[:#]${SL}([^\\n]{2,40})`, 'i'))
                || m1(new RegExp(`VESSEL${SL}[:#]${SL}([^\\n]{2,40})`, 'i')),
      voyage:      m(/VOY(?:AGE)?\s*[:#]?\s*([A-Z0-9]+)/i),
      pol:         m1(new RegExp(`POL${SL}[:#]${SL}([A-Z][A-Z, ]{2,30})`, 'i')),
      pod:         m1(new RegExp(`POD${SL}[:#]${SL}([A-Z][A-Z, ]{2,30})`, 'i')),
      etd:         '',
      eta:         '',
      // 수량/무게/CBM
      packages:    parseFloat((m(/(\d[\d,]*)\s*PALLETS?/i)
                            || m(/PACKAGES?\s*[:#]?\s*([\d,]+)/i)).replace(/,/g,'')) || 0,
      weight:      parseFloat((m(/([\d,]+\.?\d*)\s*KGS?\b/i) || '0').replace(/,/g,'')) || 0,
      cbm:         parseFloat((m(/([\d,.]+)\s*CBM/i)
                            || m(/CBM\s*[:#]?\s*([\d,.]+)/i)
                            || '0').replace(/,/g,'')) || 0,
      containers: [],
      items: [],
      totalAmount: 0,
      totalVat: 0,
      totalAmountVAT: 0,
      filename: filename || '',
      registeredAt: new Date().toISOString()
    };

    // ── 컨테이너 타입 × 수량 ──
    //   "40HC × 18", "20DV × 1", "40HCx7", "40HCx7:0.00" 모두 매치
    const ctRe = /(\d{2,3}\s*[A-Z]{2,3})\s*[×x*]\s*(\d+)(?!\d)/gi;
    let cm;
    const seenCt = new Set();
    while ((cm = ctRe.exec(all)) !== null) {
      const type = cm[1].replace(/\s+/g,'').toUpperCase();
      const qty = parseInt(cm[2]);
      const sig = type + ':' + qty;
      if (seenCt.has(sig)) continue;
      seenCt.add(sig);
      inv.containers.push({ type, qty });
    }

    // ── 비용 항목 (벤더 무관 다중 패턴) ──
    //   C&I LOGISTICS 양식의 라인 구조: "N 항목명 KRW 1.00 단위 수량 단가 KRW총액 VAT"
    //   예: "1 컨테이너 적출료 KRW 1.00 CNTR 21 290,000 6,090,000 609,000"
    //   양식: ... <Rate(USD)> <QTY(integer)> <Rate(KRW)> <Amount(KRW)> <VAT>
    //   캡처 전략: 컴마숫자 3개 연속에서 두 번째 = KRW 총액
    const cniItemPatterns = [
      { label: '컨테이너 적출료', kw: /컨테이너\s*적출료/i },
      { label: '창고 보관료',     kw: /창고\s*보관료/i },
      { label: 'CFS 및 SHUTTLE',  kw: /CFS.*?SHUTTLE/i },
      { label: '운송료',          kw: /운송료/i }
    ];
    cniItemPatterns.forEach(p => {
      const r = all.match(p.kw);
      if (!r) return;
      // 키워드 발견 위치부터 다음 줄바꿈까지의 본문 추출 (multiline 라인 종료까지)
      const idx = r.index;
      const eol = all.indexOf('\n', idx + r[0].length);
      const segment = all.slice(idx, eol === -1 ? all.length : eol + 1);
      // segment에서 3개 이상의 콤마-숫자 연속 추출 (Rate · KRW총액 · VAT)
      const nums = segment.match(/[\d,]+/g) || [];
      const big = nums.map(n => parseFloat(n.replace(/,/g,''))||0).filter(n => n >= 1000);
      // 가장 큰 두 값: KRW 총액 = 두 번째로 큰 값 OR 마지막에서 두번째
      // 일반적으로: ...단가(big) 총액(가장 큰) VAT(작은)
      // 콤마 숫자 중 가장 큰 값을 총액으로
      if (big.length) {
        big.sort((a,b)=>b-a);
        // 단가가 100만 이상이면 같이 잡힐 수 있음. 안전하게 가장 큰 값 사용
        const amt = big[0];
        if (amt > 0) inv.items.push({ label: p.label, amount: amt });
      }
    });

    // ── 합계·VAT·총액 ──
    //   "합 계 11,904,000 1,190,400" (운송료 합계 + VAT 합계)
    //   "TOTAL AMOUNT: KRW 13,094,400" (VAT 포함 총액)
    let totalSum = 0, vatSum = 0, grand = 0;

    // 합계 라인 패턴: "합 계   11,904,000   1,190,400" (KRW + VAT)
    const sumLine = all.match(/합\s*계[\s\S]{0,80}?([\d,]{5,})\s+([\d,]{4,})/i);
    if (sumLine) {
      totalSum = parseFloat(sumLine[1].replace(/,/g,'')) || 0;
      vatSum   = parseFloat(sumLine[2].replace(/,/g,'')) || 0;
    } else {
      const t1 = m(/합\s*계\s*[:#]?\s*([\d,]+)/i) || m(/\bTOTAL\s*[:#]?\s*([\d,]+)/i);
      if (t1) totalSum = parseFloat(t1.replace(/,/g,''));
      const v1 = m(/VAT\s*\(?\s*10\s*%?\s*\)?\s*[:#]?\s*([\d,]+)/i) || m(/부\s*가\s*세\s*[:#]?\s*([\d,]+)/i);
      if (v1) vatSum = parseFloat(v1.replace(/,/g,''));
    }

    // 총액 — "TOTAL AMOUNT: KRW 13,094,400" 또는 "총 합 계"
    const grandLine = m(/TOTAL\s*AMOUNT\s*[:#]?\s*(?:KRW)?\s*([\d,]+)/i)
                   || m(/총\s*[액합]?\s*계\s*[:#]?\s*([\d,]+)/i)
                   || m(/GRAND\s*TOTAL\s*[:#]?\s*([\d,]+)/i);
    if (grandLine) grand = parseFloat(grandLine.replace(/,/g,''));

    inv.totalAmount    = totalSum || inv.items.reduce((s,it)=>s+(it.amount||0),0);
    inv.totalVat       = vatSum   || Math.round(inv.totalAmount * 0.1);
    inv.totalAmountVAT = grand    || (inv.totalAmount + inv.totalVat);

    // ── 라벨·값 분리 PDF 보강 — 빈 필드는 본문 첫 매치로 fallback ──
    if (!inv.invoiceDate) {
      const all_dates = all.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g) || [];
      // 첫 번째 발견 날짜를 청구일자로 (일반적으로 PDF 상단 = 청구일자)
      if (all_dates.length) inv.invoiceDate = _normDate(all_dates[0]);
    }
    if (!inv.etd || !inv.eta) {
      // "2026-03-29 / 2026-05-01" 형태 (ETD/ETA 한 줄)
      const etdEta = all.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*\/\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})/);
      if (etdEta) {
        if (!inv.etd) inv.etd = _normDate(etdEta[1]);
        if (!inv.eta) inv.eta = _normDate(etdEta[2]);
      }
    }
    if (!inv.customer) {
      // "바로주식회사" 같은 한글 회사명이 TO: 옆에 있을 수 있음
      const koCust = all.match(/([가-힣]{2,8}(?:주식회사|\(주\)|회사))/);
      if (koCust) inv.customer = koCust[1].trim();
    }
    if (!inv.vessel || /^KOREA|^ETD/i.test(inv.vessel)) {
      // 선박명 패턴: 2-4단어 대문자 + 4자리 항차코드 (newline 제외, space만)
      const vesselMatch = all.match(/([A-Z]{2,}(?: [A-Z]{2,}){1,4} \d{4}[A-Z]?)/);
      if (vesselMatch) inv.vessel = vesselMatch[1].trim();
    }
    if (!inv.pol || /KOREA/i.test(inv.pol)) {
      // POL = 출발항 (외국). KOREA가 아닌 첫 번째 "도시, 국가" 패턴
      const ports = all.match(/[A-Z]{4,15},\s*[A-Z]{4,15}/g) || [];
      const foreign = ports.find(p => !/KOREA/i.test(p));
      if (foreign) inv.pol = foreign.trim();
    }
    if (!inv.pod) {
      // POD = 도착항. 한국 항구
      const ports = all.match(/[A-Z]{4,15},\s*[A-Z]{4,15}/g) || [];
      const korean = ports.find(p => /KOREA/i.test(p));
      if (korean) inv.pod = korean.trim();
    }
    if (!inv.packages) {
      const pkg = all.match(/(\d[\d,]*)\s*PALLETS?/i);
      if (pkg) inv.packages = parseFloat(pkg[1].replace(/,/g,'')) || 0;
    }
    return inv;
  }
  // 하위 호환 — 기존 호출 보존
  const _parseSunjinInvoice = _parseInvoicePdf;

  // ─────────────────────────────────────────────────────
  //  mount — showTab('cost_mgmt') 시 박스를 host 안에 렌더
  // ─────────────────────────────────────────────────────
  function _mount(){
    const host = document.getElementById(HOST_ID);
    if (!host) { console.warn('[costMgmt] host not found:', HOST_ID); return; }
    _render(host);
  }

  function _render(host){
    host.innerHTML = `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-tabs">
          ${_subTab('invoice',  '📄 인보이스 관리')}
          ${_subTab('analysis', '📊 원가 분석')}
        </div>
      </div>
      <div id="cm-sub-body"></div>
    `;
    // ★ schedule 탭 제거 — 사용자 요구 (2026-05-12). _activeSub='schedule'이면 invoice로 리다이렉트
    if (_activeSub === 'schedule') _activeSub = 'invoice';
    _renderSub();
  }

  function _subTab(key, label){
    const cnt = key==='invoice' ? _invoices.length
              : key==='schedule' ? (_schedule[_curMonth]||[]).length
              : '';
    const badge = cnt ? `<span class="badge">${cnt}</span>` : '';
    return `<button class="card-tab ${key===_activeSub?'active':''}" onclick="costMgmt.sub('${key}')">${label}${badge}</button>`;
  }

  function _renderSub(){
    const body = document.getElementById('cm-sub-body');
    if (!body) return;
    if (_activeSub === 'invoice')   body.innerHTML = _viewInvoice();
    if (_activeSub === 'schedule')  body.innerHTML = _viewSchedule();
    if (_activeSub === 'analysis')  body.innerHTML = _viewAnalysis();
  }

  // ─────────────────────────────────────────────────────
  //  view: 인보이스 관리
  // ─────────────────────────────────────────────────────
  function _viewInvoice(){
    let list = [..._invoices];
    if (_filterMonth) list = list.filter(i => _ym(i.invoiceDate || i.etd) === _filterMonth);
    if (_filterSearch) {
      const q = _filterSearch.toLowerCase();
      list = list.filter(i => [i.blNo,i.masterBl,i.invoiceNo,i.customer,i.vessel].some(v => String(v||'').toLowerCase().includes(q)));
    }
    list.sort((a,b)=> (b.invoiceDate||'').localeCompare(a.invoiceDate||''));

    const months = [...new Set(_invoices.map(i => _ym(i.invoiceDate||i.etd)).filter(Boolean))].sort().reverse();

    return `
      <div id="cm-dropzone" class="dropzone" style="margin-bottom:14px;"
           ondragover="costMgmt._drag(event,1)" ondragleave="costMgmt._drag(event,0)" ondrop="costMgmt._drop(event)"
           onclick="document.getElementById('cm-file-input').click()">
        <div class="dropzone-icon">📁</div>
        <div class="dropzone-text">INVOICE PDF — 클릭 또는 드래그&드롭</div>
        <div class="dropzone-hint" style="font-size:0.78em;color:#888;margin-top:4px;">선진로지스 · C&amp;I LOGISTICS 등 물류회사 INVOICE 자동 인식</div>
        <div class="dropzone-hint">여러 PDF 동시 업로드 OK · 자동 인식 실패 시 수동 등록 가능</div>
        <input id="cm-file-input" type="file" accept=".pdf,application/pdf" multiple style="display:none;" onchange="costMgmt._onPickPdf(event)">
      </div>

      <div class="toolbar" style="margin-bottom:12px;">
        <div class="toolbar-section">
          <span class="toolbar-label">월</span>
          <select onchange="costMgmt._setMonth(this.value)">
            <option value="">전체</option>
            ${months.map(m=>`<option value="${m}" ${m===_filterMonth?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <input type="search" placeholder="🔍 B/L · INV · 화주 검색" value="${_esc(_filterSearch)}" oninput="costMgmt._setSearch(this.value)" style="flex:1;min-width:200px;">
        <button class="btn btn-sm btn-outline" onclick="costMgmt._addManual()">➕ 수동 등록</button>
        <button class="btn btn-sm btn-outline" onclick="costMgmt._exportInvXlsx()">📊 엑셀</button>
      </div>

      ${list.length ? list.map(inv => _invCard(inv)).join('') : `
        <div class="empty-state">
          <div class="empty-state-icon">📄</div>
          <div class="empty-state-title">등록된 인보이스가 없습니다</div>
          <div class="empty-state-desc">위 박스에 INVOICE PDF 를 드래그하거나 ➕ 수동 등록 으로 시작하세요</div>
        </div>`}
    `;
  }

  function _invCard(i){
    const ctrs = (i.containers||[]).map(c=>`<span class="tag blue">${c.type} × ${c.qty}</span>`).join(' ') || '<span class="tag gray">-</span>';
    const items = (i.items||[]).map(it=>`<tr><td>${_esc(it.label)}</td><td class="num">${_fmt(it.amount)}원</td></tr>`).join('');
    return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-head">
        <div>
          <h3 style="padding:0;border:none;">📄 ${_esc(i.invoiceNo||'(No INV)')} · B/L ${_esc(i.blNo||'-')}</h3>
          <div style="font-size:0.8em;color:#888;margin-top:3px;">
            ${i.invoiceDate?'📅 '+_esc(i.invoiceDate):''}
            ${i.etd?' · ETD '+_esc(i.etd):''}
            ${i.eta?' · ETA '+_esc(i.eta):''}
            ${i.vessel?' · 🚢 '+_esc(i.vessel):''}
            ${i.customer?' · '+_esc(i.customer):''}
          </div>
        </div>
        <div class="action-group">
          <button class="btn btn-xs btn-outline" onclick="costMgmt._editInv('${i.id}')">✏️</button>
          <button class="btn btn-xs btn-danger" onclick="costMgmt._delInv('${i.id}')">🗑</button>
        </div>
      </div>
      <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div>
          <div style="margin-bottom:6px;"><strong>컨테이너:</strong> ${ctrs}</div>
          <div style="font-size:0.85em;color:#555;">
            📦 PKG ${_fmt(i.packages)} · ⚖ ${_fmt(i.weight)} KG · 📐 ${i.cbm||0} CBM
          </div>
          <div style="font-size:0.82em;color:#888;margin-top:4px;">
            ${i.pol?'POL: '+_esc(i.pol):''} ${i.pod?' · POD: '+_esc(i.pod):''}
          </div>
        </div>
        <div>
          <table style="width:100%;font-size:0.86em;">
            ${items || '<tr><td colspan="2" style="color:#999;">비용 항목 없음</td></tr>'}
            <tr style="border-top:1px solid #e0e0e0;"><td><strong>합계</strong></td><td class="num"><strong>${_fmt(i.totalAmount)}원</strong></td></tr>
            <tr><td style="color:#888;">VAT</td><td class="num" style="color:#888;">${_fmt(i.totalVat)}원</td></tr>
            <tr style="background:#eef5ff;"><td><strong>총액 (VAT포함)</strong></td><td class="num"><strong style="color:#1565c0;">${_fmt(i.totalAmountVAT)}원</strong></td></tr>
          </table>
        </div>
      </div>
    </div>`;
  }

  // ─────────────────────────────────────────────────────
  //  view: 입고일정 보고서
  // ─────────────────────────────────────────────────────
  function _viewSchedule(){
    const sch = (_schedule[_curMonth] || []).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const totVeh = sch.reduce((s,r)=>s+(Number(r.vehicles)||0),0);
    const totPlt = sch.reduce((s,r)=>s+(Number(r.plt)||0),0);
    const totQty = sch.reduce((s,r)=>s+(Number(r.qty)||0),0);

    // 최근 12개월 옵션
    const opts = [];
    const d = new Date(); d.setDate(1);
    for (let i=0;i<24;i++){
      const ym = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      opts.push(ym);
      d.setMonth(d.getMonth()-1);
    }

    return `
      <div class="toolbar" style="margin-bottom:12px;">
        <div class="toolbar-section">
          <span class="toolbar-label">월</span>
          <select onchange="costMgmt._setSchedMonth(this.value)">
            ${opts.map(m=>`<option value="${m}" ${m===_curMonth?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-sm btn-success" onclick="costMgmt._addSched()">➕ 일정 추가</button>
        <button class="btn btn-sm btn-outline" onclick="costMgmt._printSched()">🖨 인쇄</button>
        <button class="btn btn-sm btn-outline" onclick="costMgmt._exportSchedXlsx()">📊 엑셀</button>
      </div>

      <div class="card">
        <div class="card-head"><h3>🚛 ${_curMonth} 입고일정 보고서</h3><span class="tag gray">총 ${sch.length}건</span></div>
        <div class="tbl-wrap" style="border-radius:0;box-shadow:none;">
          <table>
            <thead><tr>
              <th>일정 (날짜)</th><th>모듈명</th><th class="num">차량</th><th class="num">PLT</th><th class="num">수량 (매)</th><th>비고</th><th class="center">액션</th>
            </tr></thead>
            <tbody>
              ${sch.length ? sch.map(r => {
                const modelList = _getModelList();
                const modelOptions = '<option value="">(선택)</option>' + modelList.map(m =>
                  `<option value="${_esc(m.name)}" ${m.name===r.model?'selected':''}>${_esc(m.name)}${m.plt?' (PLT='+m.plt+'매)':''}</option>`
                ).join('');
                return `<tr>
                <td><input type="date" value="${_esc(r.date)}" onchange="costMgmt._updSched('${r.id}','date',this.value)" style="width:140px;"></td>
                <td><select onchange="costMgmt._updSched('${r.id}','model',this.value)" style="width:100%;min-width:160px;">${modelOptions}</select></td>
                <td class="num"><input type="number" value="${r.vehicles||''}" onchange="costMgmt._updSched('${r.id}','vehicles',this.value)" style="width:80px;text-align:right;"></td>
                <td class="num"><input type="number" step="0.1" value="${r.plt||''}" onchange="costMgmt._updSched('${r.id}','plt',this.value)" style="width:80px;text-align:right;"></td>
                <td class="num"><input type="number" value="${r.qty||''}" onchange="costMgmt._updSched('${r.id}','qty',this.value)" style="width:100px;text-align:right;" placeholder="자동"></td>
                <td><input type="text" value="${_esc(r.note||'')}" onchange="costMgmt._updSched('${r.id}','note',this.value)" placeholder="비고" style="width:100%;"></td>
                <td class="center"><button class="btn btn-xs btn-danger" onclick="costMgmt._delSched('${r.id}')">🗑</button></td>
              </tr>`;
              }).join('') : `<tr><td colspan="7" class="empty">${_curMonth} 입고일정이 없습니다. ➕ 일정 추가로 시작하세요.</td></tr>`}
            </tbody>
            ${sch.length ? `<tfoot>
              <tr style="background:#fafbfc;font-weight:700;">
                <td colspan="2">합계</td>
                <td class="num">${_fmt(totVeh)}</td>
                <td class="num">${totPlt%1===0?_fmt(totPlt):totPlt.toFixed(1)}</td>
                <td class="num">${_fmt(totQty)}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>`:''}
          </table>
        </div>
      </div>

      ${sch.length ? `<div class="summary-bar" style="margin-top:12px;">
        <div class="summary-item"><div class="lbl">총 일정</div><div class="val">${sch.length}건</div></div>
        <div class="summary-item"><div class="lbl">차량</div><div class="val">${_fmt(totVeh)}대</div></div>
        <div class="summary-item"><div class="lbl">팔레트</div><div class="val">${totPlt%1===0?_fmt(totPlt):totPlt.toFixed(1)} PLT</div></div>
        <div class="summary-item"><div class="lbl">모듈</div><div class="val">${_fmt(totQty)}매</div></div>
      </div>` : ''}
    `;
  }

  // ─────────────────────────────────────────────────────
  //  view: 원가 분석
  // ─────────────────────────────────────────────────────
  function _viewAnalysis(){
    if (!_invoices.length) return `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">분석할 데이터가 없습니다</div><div class="empty-state-desc">📄 인보이스 관리 탭에서 PDF 를 등록하세요</div></div>`;

    // 비용 항목별 — 각 항목 + 비례 VAT 포함액 표시
    //   ★ 2026-05-13 fallback 강화 — 인보이스 items[] 가 비어있을 때 인보이스 전체 금액을
    //   "운송료(인식 실패)" 로 누적하여 비용 항목별 차트가 비지 않도록 함
    const itemMap = {};
    let grandVAT = 0;
    let invoicesWithoutItems = 0;
    _invoices.forEach(i => {
      // 인보이스별 VAT 비율 계산 (실제 VAT/운송료) — 없으면 10% 기본
      const subTotal = Number(i.totalAmount) || 0;
      const vat = Number(i.totalVat) || (subTotal * 0.1);
      const vatRate = subTotal > 0 ? (vat / subTotal) : 0.1;
      const items = i.items || [];
      if (items.length === 0) {
        // 항목 인식 실패 → 인보이스 총액을 fallback 라벨로 누적
        if (subTotal > 0) {
          const amtVAT = Math.round(subTotal * (1 + vatRate));
          const label = (i.supplier || '운송료') + ' (항목 미인식)';
          itemMap[label] = (itemMap[label] || 0) + amtVAT;
          grandVAT += amtVAT;
          invoicesWithoutItems++;
        }
        return;
      }
      items.forEach(it => {
        const amt = Number(it.amount) || 0;
        const amtVAT = Math.round(amt * (1 + vatRate));  // 항목별로 비례 VAT 적용
        itemMap[it.label] = (itemMap[it.label] || 0) + amtVAT;
        grandVAT += amtVAT;
      });
    });
    // 그래도 0 이면 인보이스 총액(VAT 포함) 합으로 grand 채움
    if (grandVAT === 0) grandVAT = _invoices.reduce((s,i)=>s+(Number(i.totalAmountVAT)||((Number(i.totalAmount)||0)*1.1)), 0);
    const grand = grandVAT;

    // 컨테이너 타입별
    const ctMap = {};
    _invoices.forEach(i => (i.containers||[]).forEach(c => {
      const k = c.type;
      if (!ctMap[k]) ctMap[k] = { qty:0, amount:0 };
      ctMap[k].qty += Number(c.qty)||0;
      // 균등 분할 — 인보이스 총액을 컨테이너 수량 가중치로 분배
      const totalCtrs = (i.containers||[]).reduce((s,c)=>s+(Number(c.qty)||0),0);
      const share = totalCtrs>0 ? (Number(i.totalAmount)||0) * (Number(c.qty)||0) / totalCtrs : 0;
      ctMap[k].amount += share;
    }));

    // ★ 2026-05-13 단위 원가 카드(PKG/KG/CBM 당) 제거 — 사용자 요청
    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h3>비용 항목별</h3><span class="tag gray">합계 ${_fmt(grand)}원 (VAT 포함)</span></div>
          <div class="card-body">
            ${Object.entries(itemMap).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
              const pct = grand>0 ? (v/grand*100).toFixed(1) : 0;
              return `<div class="bar-row"><div class="name">${_esc(k)}</div><div class="bar"><div class="bar-fill" style="width:${pct}%;"></div></div><div class="v">${_fmt(v)}원 (${pct}%)</div></div>`;
            }).join('') || `<div style="color:#999;text-align:center;padding:20px;">비용 항목 데이터 없음<br><span style="font-size:0.82em;color:#bbb;">인보이스 PDF 에서 항목 인식 실패 — 인보이스 관리 탭에서 수동 등록 가능</span></div>`}
            ${invoicesWithoutItems > 0 ? `<div style="margin-top:8px;font-size:0.78em;color:#e65100;background:#fff8e1;padding:6px 10px;border-radius:5px;">⚠️ ${invoicesWithoutItems}건의 인보이스에서 세부 항목이 인식되지 않아 총액으로 누적했습니다.</div>` : ''}
            <div style="margin-top:8px;font-size:0.78em;color:#888;border-top:1px dashed #eef0f4;padding-top:8px;">💡 각 항목 금액은 인보이스 VAT 비율을 비례 적용한 <strong>VAT 포함액</strong> 입니다.</div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>컨테이너 타입별 평균 단가</h3></div>
          <div class="card-body">
            <table style="width:100%;font-size:0.88em;">
              <thead><tr><th>타입</th><th class="num">총 수량</th><th class="num">평균 단가</th></tr></thead>
              <tbody>
                ${Object.entries(ctMap).sort((a,b)=>b[1].qty-a[1].qty).map(([k,v])=>`<tr>
                  <td><strong>${_esc(k)}</strong></td>
                  <td class="num">${v.qty}대</td>
                  <td class="num"><strong>${_fmt(Math.round(v.amount/v.qty))}원</strong></td>
                </tr>`).join('') || '<tr><td colspan="3" style="color:#999;text-align:center;padding:20px;">컨테이너 데이터 없음</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      ${_renderPurchaseCostSummary()}
    `;
  }

  // 구매이력 데이터를 가져와 원가 요약 + 모델별 평균단가 표시
  function _renderPurchaseCostSummary(){
    // 구매이력 모듈에서 데이터 가져오기 — purchase.list() 또는 inventoryData 직접 사용
    let purchaseRows = [];
    try {
      if (window.purchase && typeof window.purchase.list === 'function') {
        purchaseRows = window.purchase.list() || [];
      }
    } catch(e){}

    // fallback: inventoryData에서 입고 + 매입단가 있는 행
    if (!purchaseRows.length && typeof inventoryData !== 'undefined') {
      purchaseRows = inventoryData.filter(r =>
        r.type === '입고' && (Number(r.unitPrice)>0 || Number(r.totalAmount)>0)
      );
    }

    if (!purchaseRows.length) return `
      <div class="card">
        <div class="card-head"><h3>🧾 구매 원가 (구매이력 연동)</h3><span class="tag gray">데이터 없음</span></div>
        <div class="card-body" style="color:#888;font-size:0.88em;">
          💡 <strong>구매이력 탭</strong>에서 매입 단가가 입력된 데이터가 있으면 여기에 자동 요약됩니다.
        </div>
      </div>`;

    // 모델별 집계 — qty, amt, 총 Wp(=qty×watt) 모두 추적
    const byModel = {};
    let totalQtyP = 0, totalAmtP = 0, totalWpP = 0;
    purchaseRows.forEach(r => {
      const model = r.model || r.moduleModel || '(기타)';
      const qty = Number(r.qty||0);
      const watt = Number(r.watt||0) || (typeof productMaster === 'object' && productMaster && productMaster[model] ? Number(productMaster[model].watt)||0 : 0);
      const amt = Number(r.totalAmount||0) || (Number(r.unitPrice||0) * (watt||1) * qty);
      const wp = qty * watt;  // 총 Wp
      if (!byModel[model]) byModel[model] = { qty:0, amt:0, wp:0, watt:watt, cnt:0 };
      byModel[model].qty += qty;
      byModel[model].amt += amt;
      byModel[model].wp += wp;
      byModel[model].cnt += 1;
      if (!byModel[model].watt && watt) byModel[model].watt = watt;
      totalQtyP += qty;
      totalAmtP += amt;
      totalWpP  += wp;
    });

    const sorted = Object.entries(byModel).sort((a,b) => b[1].amt - a[1].amt).slice(0, 10);
    return `
      <div class="card">
        <div class="card-head"><h3>🧾 구매 원가 (구매이력 연동)</h3><span class="tag purple">${purchaseRows.length}건 · ${_fmt(totalQtyP)}매</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px;">
            <div class="kpi kpi-dark"><span class="kpi-icon">📦</span><div class="kpi-label">총 매입 수량</div><div class="kpi-value">${_fmt(totalQtyP)}</div><div class="kpi-sub">매</div></div>
            <div class="kpi kpi-warning"><span class="kpi-icon">💰</span><div class="kpi-label">총 매입 금액</div><div class="kpi-value">${_fmtM(totalAmtP)}</div><div class="kpi-sub">원</div></div>
            <div class="kpi kpi-success"><span class="kpi-icon">⚖</span><div class="kpi-label">매당 평균</div><div class="kpi-value">${totalQtyP>0?_fmt(Math.round(totalAmtP/totalQtyP)):'-'}</div><div class="kpi-sub">원 / 매</div></div>
            <div class="kpi kpi-purple"><span class="kpi-icon">⚡</span><div class="kpi-label">Wp 당 평균</div><div class="kpi-value">${totalWpP>0?(totalAmtP/totalWpP).toFixed(2):'-'}</div><div class="kpi-sub">원 / Wp</div></div>
          </div>
          <table style="width:100%;font-size:0.86em;">
            <thead><tr>
              <th>모델</th>
              <th class="num">매입건수</th>
              <th class="num">총수량 (매)</th>
              <th class="num">평균가 (원/매)</th>
              <th class="num">평균가 (원/Wp)</th>
              <th class="num">총금액</th>
            </tr></thead>
            <tbody>
              ${sorted.map(([m,v]) => `<tr>
                <td><strong>${_esc(m)}</strong>${v.watt?` <span style="font-size:0.78em;color:#888;">(${v.watt}W)</span>`:''}</td>
                <td class="num">${v.cnt}건</td>
                <td class="num">${_fmt(v.qty)}</td>
                <td class="num">${v.qty>0?_fmt(Math.round(v.amt/v.qty)):'-'}원</td>
                <td class="num" style="color:#6c3483;font-weight:700;">${v.wp>0?(v.amt/v.wp).toFixed(2):'-'}원/Wp</td>
                <td class="num"><strong>${_fmt(Math.round(v.amt))}원</strong></td>
              </tr>`).join('')}
            </tbody>
          </table>
          ${sorted.length < Object.keys(byModel).length ? `<div style="text-align:center;margin-top:8px;font-size:0.82em;color:#888;">상위 10개 모델만 표시 (전체 ${Object.keys(byModel).length}개) — <button class="btn btn-xs btn-outline" onclick="if(typeof showTab==='function')showTab('purchase')">구매이력 탭으로 이동</button></div>` : ''}
          <div style="margin-top:8px;font-size:0.78em;color:#888;border-top:1px dashed #eef0f4;padding-top:8px;">💡 <strong>원/매</strong>는 모듈 1개당 매입가, <strong>원/Wp</strong>는 정격용량 1Wp 당 매입가(국제 표준 비교 단위). 모델 등록 시 W 정보가 있어야 /Wp 계산 가능합니다.</div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────
  //  PDF 드래그&드롭 / 파일 선택
  // ─────────────────────────────────────────────────────
  function _drag(e, on){
    e.preventDefault(); e.stopPropagation();
    const dz = document.getElementById('cm-dropzone');
    if (dz) dz.classList.toggle('over', !!on);
  }
  function _drop(e){
    e.preventDefault(); e.stopPropagation();
    const dz = document.getElementById('cm-dropzone'); if (dz) dz.classList.remove('over');
    const files = [...(e.dataTransfer?.files||[])].filter(f => /pdf$/i.test(f.name));
    if (!files.length) { _banner('warn','PDF 파일이 아닙니다'); return; }
    _processPdfs(files);
  }
  function _onPickPdf(e){
    const files = [...(e.target.files||[])];
    if (!files.length) return;
    _processPdfs(files);
    e.target.value = '';
  }

  async function _processPdfs(files){
    _banner('info', `🔄 ${files.length}건 PDF 분석 중...`);
    let ok = 0, manual = 0;
    for (const f of files) {
      try {
        const text = await _readPdfText(f);
        const inv  = _parseSunjinInvoice(text, f.name);
        if (!inv.invoiceNo && !inv.blNo) {
          // 자동 인식 실패 → 수동 등록 폼 fallback
          inv.invoiceNo = '(수동)';
          inv.filename  = f.name;
          inv._rawText  = text.slice(0, 2000);
          manual++;
        }
        _invoices.push(inv);
        ok++;
      } catch(err) {
        console.error('[costMgmt] PDF parse err:', f.name, err);
        _banner('err', `❌ ${f.name} 분석 실패: ${err.message}`);
      }
    }
    _save();
    _renderSub();
    _banner('ok', `✅ ${ok}건 등록 완료 (자동 ${ok-manual} · 수동확인 필요 ${manual})`);
  }

  // ─────────────────────────────────────────────────────
  //  인보이스 액션
  // ─────────────────────────────────────────────────────
  function _setMonth(v){ _filterMonth = v; _renderSub(); }
  function _setSearch(v){ _filterSearch = v; _renderSub(); }

  function _delInv(id){
    if (!confirm('인보이스를 삭제하시겠습니까?')) return;
    _invoices = _invoices.filter(i => i.id !== id);
    _save(); _renderSub();
    _banner('ok','🗑 인보이스 삭제 완료');
  }

  function _addManual(){ _editInv(null); }

  function _editInv(id){
    const inv = id ? _invoices.find(i=>i.id===id) : {
      id: _uid('INV'), invoiceNo:'', invoiceDate:'', blNo:'', masterBl:'', customer:'',
      vessel:'', voyage:'', pol:'', pod:'', etd:'', eta:'',
      packages:0, weight:0, cbm:0, containers:[], items:[], totalAmount:0, totalVat:0, totalAmountVAT:0,
      filename:'', registeredAt: new Date().toISOString()
    };
    if (!inv) return;

    const ctrText = (inv.containers||[]).map(c=>`${c.type}×${c.qty}`).join(', ');
    const itemText = (inv.items||[]).map(it=>`${it.label}=${it.amount}`).join('\n');

    let host = document.getElementById('cm-edit-modal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cm-edit-modal'; host.className = 'modal';
      document.body.appendChild(host);
    }
    host.innerHTML = `
      <div class="modal-content" style="min-width:620px;max-width:800px;">
        <div class="modal-head">
          <h3>${id?'✏️ 인보이스 수정':'➕ 인보이스 수동 등록'}</h3>
          <button class="modal-close" onclick="document.getElementById('cm-edit-modal').classList.remove('open');">×</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label>Invoice No</label><input id="cme-inv" type="text" value="${_esc(inv.invoiceNo)}"></div>
          <div><label>Invoice Date</label><input id="cme-invd" type="date" value="${_esc(inv.invoiceDate)}"></div>
          <div><label>B/L No</label><input id="cme-bl" type="text" value="${_esc(inv.blNo)}"></div>
          <div><label>Master B/L</label><input id="cme-mbl" type="text" value="${_esc(inv.masterBl)}"></div>
          <div><label>화주 (Customer)</label><input id="cme-cust" type="text" value="${_esc(inv.customer)}"></div>
          <div><label>Vessel / Voyage</label><input id="cme-ves" type="text" value="${_esc(inv.vessel + (inv.voyage?' / '+inv.voyage:''))}"></div>
          <div><label>POL → POD</label><input id="cme-route" type="text" value="${_esc(inv.pol + (inv.pod?' → '+inv.pod:''))}" placeholder="QINGDAO → BUSAN"></div>
          <div><label>ETD / ETA</label><div style="display:flex;gap:6px;"><input id="cme-etd" type="date" value="${_esc(inv.etd)}" style="flex:1;"><input id="cme-eta" type="date" value="${_esc(inv.eta)}" style="flex:1;"></div></div>
          <div><label>Packages</label><input id="cme-pkg" type="number" value="${inv.packages||0}"></div>
          <div><label>Weight (KG)</label><input id="cme-wt" type="number" step="0.1" value="${inv.weight||0}"></div>
          <div><label>CBM</label><input id="cme-cbm" type="number" step="0.01" value="${inv.cbm||0}"></div>
          <div><label>컨테이너 (예: 40HC×18, 20DV×1)</label><input id="cme-ctr" type="text" value="${_esc(ctrText)}"></div>
          <div style="grid-column:span 2;"><label>비용 항목 (한 줄에 하나: 라벨=금액)</label><textarea id="cme-items" rows="4" style="width:100%;font-family:'Consolas',monospace;font-size:0.85em;">${_esc(itemText)}</textarea></div>
          <div><label>합계 (운송료+CFS 등)</label><input id="cme-tot" type="number" value="${inv.totalAmount||0}"></div>
          <div><label>VAT</label><input id="cme-vat" type="number" value="${inv.totalVat||0}"></div>
        </div>
        <div style="text-align:right;margin-top:14px;">
          <button class="btn btn-outline" onclick="document.getElementById('cm-edit-modal').classList.remove('open');">취소</button>
          <button class="btn btn-success" onclick="costMgmt._saveInv('${inv.id}', ${id?'true':'false'})">💾 저장</button>
        </div>
      </div>`;
    host.classList.add('open');
  }

  function _saveInv(id, isEdit){
    const v = (sel) => (document.getElementById(sel)||{}).value || '';
    const ctrs = v('cme-ctr').split(/[,，]/).map(s=>s.trim()).filter(Boolean).map(s=>{
      const m = s.match(/([0-9A-Z]+)\s*[×x*]\s*(\d+)/i);
      return m ? { type:m[1].toUpperCase(), qty:parseInt(m[2]) } : null;
    }).filter(Boolean);
    const items = v('cme-items').split(/\n/).map(s=>s.trim()).filter(Boolean).map(s=>{
      const m = s.match(/^(.+?)\s*=\s*([\d,.]+)$/);
      return m ? { label:m[1].trim(), amount: parseFloat(m[2].replace(/,/g,''))||0 } : null;
    }).filter(Boolean);

    const route = v('cme-route').split(/[→\->]+/).map(s=>s.trim());
    const vesvoy = v('cme-ves').split('/').map(s=>s.trim());

    const inv = {
      id: id,
      invoiceNo:   v('cme-inv'),
      invoiceDate: v('cme-invd'),
      blNo:        v('cme-bl'),
      masterBl:    v('cme-mbl'),
      customer:    v('cme-cust'),
      vessel:      vesvoy[0]||'',
      voyage:      vesvoy[1]||'',
      pol:         route[0]||'',
      pod:         route[1]||'',
      etd:         v('cme-etd'),
      eta:         v('cme-eta'),
      packages:    parseFloat(v('cme-pkg'))||0,
      weight:      parseFloat(v('cme-wt'))||0,
      cbm:         parseFloat(v('cme-cbm'))||0,
      containers:  ctrs,
      items:       items,
      totalAmount: parseFloat(v('cme-tot'))||items.reduce((s,it)=>s+(it.amount||0),0),
      totalVat:    parseFloat(v('cme-vat'))||0,
      registeredAt: new Date().toISOString()
    };
    inv.totalAmountVAT = inv.totalAmount + inv.totalVat;

    if (isEdit) {
      const idx = _invoices.findIndex(i => i.id === id);
      if (idx >= 0) _invoices[idx] = Object.assign({}, _invoices[idx], inv);
    } else {
      _invoices.push(inv);
    }
    _save();
    document.getElementById('cm-edit-modal').classList.remove('open');
    _renderSub();
    _banner('ok', `✅ 인보이스 ${isEdit?'수정':'등록'} 완료`);
  }

  function _exportInvXlsx(){
    if (typeof XLSX === 'undefined') { alert('XLSX 라이브러리가 로드되지 않았습니다.'); return; }
    if (!_invoices.length) { alert('내보낼 인보이스가 없습니다.'); return; }
    const rows = [['Invoice No','Date','B/L','Master B/L','화주','Vessel','POL','POD','ETD','ETA','PKG','WEIGHT','CBM','Containers','운송료+CFS','VAT','총액(VAT포함)']];
    _invoices.forEach(i => rows.push([
      i.invoiceNo, i.invoiceDate, i.blNo, i.masterBl, i.customer,
      i.vessel, i.pol, i.pod, i.etd, i.eta,
      i.packages, i.weight, i.cbm,
      (i.containers||[]).map(c=>`${c.type}×${c.qty}`).join(', '),
      i.totalAmount, i.totalVat, i.totalAmountVAT
    ]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '인보이스');
    XLSX.writeFile(wb, `원가관리_인보이스_${_ymCur()}.xlsx`);
  }

  // ─────────────────────────────────────────────────────
  //  입고일정 액션
  // ─────────────────────────────────────────────────────
  function _setSchedMonth(v){ _curMonth = v; _renderSub(); }

  function _addSched(){
    if (!_schedule[_curMonth]) _schedule[_curMonth] = [];
    const date = _curMonth + '-' + String(new Date().getDate()).padStart(2,'0');
    _schedule[_curMonth].push({ id:_uid('SCH'), date, model:'', vehicles:0, plt:0, qty:0, note:'' });
    _save(); _renderSub();
  }
  function _updSched(id, field, value){
    const arr = _schedule[_curMonth] || [];
    const r = arr.find(x => x.id === id); if (!r) return;
    if (field==='vehicles'||field==='plt'||field==='qty') r[field] = parseFloat(value)||0;
    else r[field] = value;

    // 모델 또는 PLT 변경 시 → 수량 자동 산출 (수량을 사용자가 명시 수정한 경우는 제외)
    if (field === 'model' || field === 'plt') {
      const pltSize = _getModelPltSize(r.model);
      if (pltSize && r.plt > 0) {
        r.qty = Math.round(pltSize * r.plt);
      }
    }
    _save();
    _renderSub();  // 즉시 반영 (합계/요약 갱신)
  }

  // 모델 목록을 productMaster에서 가져옴 (없으면 빈 배열)
  function _getModelList(){
    const list = [];
    try {
      if (typeof productMaster === 'object' && productMaster) {
        Object.entries(productMaster).forEach(([name, info]) => {
          list.push({ name, watt: info.watt||0, mfr: info.mfr||'', plt: info.plt||0 });
        });
      }
    } catch(e){}
    return list.sort((a,b) => a.name.localeCompare(b.name));
  }
  function _getModelPltSize(model){
    if (!model) return 0;
    try {
      if (typeof productMaster === 'object' && productMaster && productMaster[model]) {
        return Number(productMaster[model].plt) || 0;
      }
    } catch(e){}
    return 0;
  }
  function _delSched(id){
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    _schedule[_curMonth] = (_schedule[_curMonth]||[]).filter(r => r.id !== id);
    _save(); _renderSub();
  }

  function _printSched(){
    const sch = (_schedule[_curMonth]||[]).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    if (!sch.length) { alert('인쇄할 일정이 없습니다.'); return; }
    const totVeh = sch.reduce((s,r)=>s+(Number(r.vehicles)||0),0);
    const totPlt = sch.reduce((s,r)=>s+(Number(r.plt)||0),0);
    const totQty = sch.reduce((s,r)=>s+(Number(r.qty)||0),0);

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${_curMonth} 입고일정 보고서</title>
      <style>
        body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:24px;color:#1a1a2e;}
        h1{font-size:1.4em;margin-bottom:4px;}
        .meta{color:#888;font-size:0.85em;margin-bottom:18px;}
        table{width:100%;border-collapse:collapse;}
        th,td{border:1px solid #999;padding:6px 8px;font-size:0.92em;}
        th{background:#f0f0f0;font-weight:700;}
        .num{text-align:right;font-variant-numeric:tabular-nums;}
        tfoot td{font-weight:800;background:#fafbfc;}
        @media print{ button{display:none;} }
      </style></head><body>
      <h1>📦 ${_curMonth} 입고일정 보고서</h1>
      <div class="meta">총 ${sch.length}건 · 차량 ${_fmt(totVeh)}대 · 팔레트 ${totPlt%1===0?_fmt(totPlt):totPlt.toFixed(1)} PLT · 모듈 ${_fmt(totQty)}매</div>
      <table>
        <thead><tr><th>일정</th><th>모듈명</th><th>차량</th><th>PLT</th><th>수량</th><th>비고</th></tr></thead>
        <tbody>${sch.map(r=>`<tr><td>${_esc(r.date)}</td><td>${_esc(r.model||'')}</td><td class="num">${_fmt(r.vehicles||0)}</td><td class="num">${(r.plt||0)%1===0?_fmt(r.plt||0):(r.plt||0).toFixed(1)}</td><td class="num">${_fmt(r.qty||0)}</td><td>${_esc(r.note||'')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">합계</td><td class="num">${_fmt(totVeh)}</td><td class="num">${totPlt%1===0?_fmt(totPlt):totPlt.toFixed(1)}</td><td class="num">${_fmt(totQty)}</td><td></td></tr></tfoot>
      </table>
      <div style="margin-top:18px;text-align:center;"><button onclick="window.print()" style="padding:8px 20px;background:#1a1a2e;color:white;border:none;border-radius:6px;cursor:pointer;">🖨 인쇄</button></div>
      </body></html>`);
    w.document.close();
  }

  function _exportSchedXlsx(){
    if (typeof XLSX === 'undefined') { alert('XLSX 라이브러리가 로드되지 않았습니다.'); return; }
    const sch = (_schedule[_curMonth]||[]).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    if (!sch.length) { alert('내보낼 일정이 없습니다.'); return; }
    const totVeh = sch.reduce((s,r)=>s+(Number(r.vehicles)||0),0);
    const totPlt = sch.reduce((s,r)=>s+(Number(r.plt)||0),0);
    const totQty = sch.reduce((s,r)=>s+(Number(r.qty)||0),0);
    const rows = [['일정','모듈명','차량','PLT','수량','비고']];
    sch.forEach(r => rows.push([r.date, r.model||'', r.vehicles||0, r.plt||0, r.qty||0, r.note||'']));
    rows.push(['합계','', totVeh, totPlt, totQty, '']);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '입고일정');
    XLSX.writeFile(wb, `입고일정보고서_${_curMonth}.xlsx`);
  }

  // ─────────────────────────────────────────────────────
  //  public API
  // ─────────────────────────────────────────────────────
  window.costMgmt = {
    open: () => { if (typeof showTab==='function') showTab(TAB_ID); else _mount(); },
    refresh: () => _renderSub(),
    debug: () => ({
      activeSub: _activeSub,
      curMonth: _curMonth,
      invoices: _invoices.length,
      scheduleMonths: Object.keys(_schedule).length,
      pdfjsReady: _pdfjsReady,
      hostExists: !!document.getElementById(HOST_ID),
      panelExists: !!document.getElementById(PANEL_ID)
    }),
    _data: () => ({ invoices: _invoices, schedule: _schedule }),
    sub: (k) => { if (k === 'schedule') k = 'invoice'; _activeSub = k; _renderSub(); _render(document.getElementById(HOST_ID)); },
    _drag, _drop, _onPickPdf,
    _setMonth, _setSearch, _addManual, _delInv, _editInv, _saveInv, _exportInvXlsx,
    _setSchedMonth, _addSched, _updSched, _delSched, _printSched, _exportSchedXlsx
  };

  // ─────────────────────────────────────────────────────
  //  showTab 후크 — 'cost_mgmt' 진입 시 마운트
  // ─────────────────────────────────────────────────────
  function _hookShowTab(){
    if (typeof window.showTab !== 'function') { setTimeout(_hookShowTab, 300); return; }
    if (window.showTab.__costMgmtHooked) return;
    const orig = window.showTab;
    window.showTab = function(id){
      const r = orig.apply(this, arguments);
      if (id === TAB_ID) setTimeout(_mount, 30);
      return r;
    };
    window.showTab.__costMgmtHooked = true;
  }

  // ─────────────────────────────────────────────────────
  //  safety.js BACKUP_KEYS 등록
  // ─────────────────────────────────────────────────────
  function _registerBackup(){
    try {
      if (window.erpSafety && Array.isArray(window.erpSafety.BACKUP_KEYS)) {
        if (!window.erpSafety.BACKUP_KEYS.includes(KEY_INV)) window.erpSafety.BACKUP_KEYS.push(KEY_INV);
        if (!window.erpSafety.BACKUP_KEYS.includes(KEY_SCH)) window.erpSafety.BACKUP_KEYS.push(KEY_SCH);
      }
    } catch(e) {}
  }

  // boot
  _load();
  _hookShowTab();
  setTimeout(_registerBackup, 500);
  // 처음 진입 시도 (이미 cost_mgmt 탭이 열려있다면 즉시 마운트)
  setTimeout(() => {
    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.classList.contains('active')) _mount();
  }, 800);

  console.log('[costMgmt] 원가관리 모듈 로드 완료');
})();
