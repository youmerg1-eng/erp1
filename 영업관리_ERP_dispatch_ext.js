// =====================================================
//  DISPATCH EXTENSIONS — 배차 확장 5종
//
//  추가 기능
//   1. 차량 종류 사전 (5톤 장축·11톤 윙바디 등) + 캐파 자동
//   2. 차량 마스터 (자주 쓰는 차량번호 → 종류·기사 자동)
//   3. 기사 명부 (이름·연락처·메모)
//   4. 운송비 자동 계산 (구간별 단가표)
//   5. 캘린더 뷰 (일자별 배차 가시화)
//   6. 운송장 PDF 인쇄 (배차당 1장)
//
//  데이터 키
//   erp_vehicle_master   차량번호 → 정보
//   erp_driver_master    이름      → 정보
//   erp_freight_rates    구간      → 단가
// =====================================================
(function() {
  'use strict';

  // ── 차량 종류 사전 (한국 표준) ─────────────────────
  const VEHICLE_TYPES = [
    { code: '5T_LONG',   name: '5톤 장축',     plt: 7,  range: '6~8 PLT' },
    { code: '5T_CARGO',  name: '5톤 카고',     plt: 6,  range: '5~7 PLT' },
    { code: '8T_CARGO',  name: '8톤 카고',     plt: 10, range: '9~11 PLT' },
    { code: '11T_CARGO', name: '11톤 카고',    plt: 14, range: '13~15 PLT' },
    { code: '11T_WING',  name: '11톤 윙바디',  plt: 16, range: '15~17 PLT' },
    { code: '14T_CARGO', name: '14톤 카고',    plt: 18, range: '17~19 PLT' },
    { code: '25T_CARGO', name: '25톤 카고',    plt: 22, range: '20~24 PLT' },
    { code: '25T_WING',  name: '25톤 윙바디',  plt: 24, range: '22~26 PLT' }
  ];

  // ── 마스터 데이터 ───────────────────────────────────
  let vehicleMaster = {};
  let driverMaster = {};
  let freightRates = {};
  try { vehicleMaster = JSON.parse(localStorage.getItem('erp_vehicle_master')||'{}'); } catch(e) {}
  try { driverMaster  = JSON.parse(localStorage.getItem('erp_driver_master') ||'{}'); } catch(e) {}
  try { freightRates  = JSON.parse(localStorage.getItem('erp_freight_rates') ||'{}'); } catch(e) {}

  function _save(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch(e) {} }

  // 차량 등록
  function setVehicle(no, info) {
    vehicleMaster[no] = { ...vehicleMaster[no], ...info, updatedAt: new Date().toISOString() };
    _save('erp_vehicle_master', vehicleMaster);
  }
  function setDriver(name, info) {
    driverMaster[name] = { ...driverMaster[name], ...info, updatedAt: new Date().toISOString() };
    _save('erp_driver_master', driverMaster);
  }
  function setFreight(from, to, info) {
    const k = `${from}|${to}`;
    freightRates[k] = { from, to, ...info, updatedAt: new Date().toISOString() };
    _save('erp_freight_rates', freightRates);
  }

  // 운송비 조회 (양방향)
  function getFreight(from, to) {
    if (!from || !to) return null;
    const fwd = freightRates[`${from}|${to}`];
    if (fwd) return fwd;
    // 반방향 조회
    return freightRates[`${to}|${from}`] || null;
  }

  // ── 폼에 차량 종류 select inject ────────────────────
  function _injectVehicleTypeSelector() {
    if (typeof window._dspFormHooked !== 'undefined') return;
    const hook = setInterval(() => {
      const form = document.getElementById('dsp-form');
      if (!form) return;
      if (form.dataset.extHooked) { clearInterval(hook); return; }
      form.dataset.extHooked = '1';
      clearInterval(hook);

      // 차량번호 input의 datalist 자동완성
      const vhcInput = document.getElementById('dsp-f-vehicle');
      if (vhcInput) {
        const dlid = 'dsp-vhc-list';
        if (!document.getElementById(dlid)) {
          const dl = document.createElement('datalist');
          dl.id = dlid;
          dl.innerHTML = Object.keys(vehicleMaster).map(n => `<option value="${n}">`).join('');
          form.appendChild(dl);
          vhcInput.setAttribute('list', dlid);
        }
        // 선택 시 자동 채움
        vhcInput.addEventListener('change', () => {
          const v = vehicleMaster[vhcInput.value.trim()];
          if (!v) return;
          if (v.driver) document.getElementById('dsp-f-driver').value = v.driver;
          if (v.driverPhone) document.getElementById('dsp-f-phone').value = v.driverPhone;
          if (v.capacityPlt) document.getElementById('dsp-f-capacity').value = v.capacityPlt;
        });
      }

      // 차량 종류 select 추가 (form의 첫 grid 위에)
      const firstGrid = form.querySelector('.dsp-form-grid');
      if (firstGrid && !document.getElementById('dsp-f-vtype')) {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:0.84em;';
        div.innerHTML = `
          <label style="font-weight:700;color:#666;min-width:80px;">차량 종류</label>
          <select id="dsp-f-vtype" onchange="dispatchExt._applyVtype()" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
            <option value="">선택...</option>
            ${VEHICLE_TYPES.map(t => `<option value="${t.code}">${t.name} (${t.range})</option>`).join('')}
          </select>
          <span id="dsp-vtype-hint" style="font-size:0.78em;color:#888;"></span>`;
        form.insertBefore(div, firstGrid);
      }

      // 기사명 input의 datalist
      const drvInput = document.getElementById('dsp-f-driver');
      if (drvInput) {
        const dlid = 'dsp-drv-list';
        if (!document.getElementById(dlid)) {
          const dl = document.createElement('datalist');
          dl.id = dlid;
          dl.innerHTML = Object.keys(driverMaster).map(n => `<option value="${n}">`).join('');
          form.appendChild(dl);
          drvInput.setAttribute('list', dlid);
        }
        drvInput.addEventListener('change', () => {
          const d = driverMaster[drvInput.value.trim()];
          if (d?.phone) document.getElementById('dsp-f-phone').value = d.phone;
        });
      }

      // 폼 저장 시 마스터 자동 누적
      const submitBtn = form.querySelector('button[onclick*="_submitForm"]');
      if (submitBtn && !submitBtn.dataset.extHooked) {
        submitBtn.dataset.extHooked = '1';
        submitBtn.addEventListener('click', () => setTimeout(_persistMaster, 100), true);
      }
    }, 300);
    window._dspFormHooked = true;
  }

  function _applyVtype() {
    const sel = document.getElementById('dsp-f-vtype');
    if (!sel) return;
    const t = VEHICLE_TYPES.find(x => x.code === sel.value);
    const hint = document.getElementById('dsp-vtype-hint');
    if (!t) { if (hint) hint.textContent = ''; return; }
    document.getElementById('dsp-f-capacity').value = t.plt;
    if (hint) hint.textContent = `→ ${t.plt} PLT (표준 ${t.range})`;
  }

  function _persistMaster() {
    const vhc = document.getElementById('dsp-f-vehicle')?.value.trim();
    const drv = document.getElementById('dsp-f-driver')?.value.trim();
    const phone = document.getElementById('dsp-f-phone')?.value.trim();
    const cap = parseInt(document.getElementById('dsp-f-capacity')?.value) || 7;
    const vtype = document.getElementById('dsp-f-vtype')?.value;
    if (vhc) setVehicle(vhc, { driver: drv, driverPhone: phone, capacityPlt: cap, type: vtype });
    if (drv) setDriver(drv, { phone, lastVehicle: vhc });
  }

  // ── 캘린더 뷰 ───────────────────────────────────────
  function openCalendar() {
    let cal = document.getElementById('dsp-cal-modal');
    if (cal) cal.remove();
    cal = document.createElement('div');
    cal.id = 'dsp-cal-modal';
    cal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:5vh;';
    cal.onclick = e => { if (e.target === cal) cal.remove(); };
    cal.innerHTML = '<div id="dsp-cal-box" style="background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:92%;max-width:980px;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;"></div>';
    document.body.appendChild(cal);
    _renderCalendar(new Date());
  }
  let _calYear = new Date().getFullYear();
  let _calMonth = new Date().getMonth();

  function _renderCalendar(d) {
    _calYear = d.getFullYear(); _calMonth = d.getMonth();
    const box = document.getElementById('dsp-cal-box');
    if (!box) return;
    const list = (typeof dispatch !== 'undefined' && dispatch.list) ? dispatch.list() : [];
    const monthStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}`;
    const monthly = list.filter(x => (x.date||'').startsWith(monthStr) && x.status !== 'cancelled');
    const byDate = {};
    monthly.forEach(d => { (byDate[d.date] = byDate[d.date] || []).push(d); });

    const firstDay = new Date(_calYear, _calMonth, 1).getDay();
    const daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
    const today = new Date().toISOString().slice(0,10);

    let cells = '';
    const dows = ['일','월','화','수','목','금','토'];
    cells += dows.map((d,i) => `<div style="padding:8px;text-align:center;font-weight:700;background:#1a1a2e;color:${i===0?'#ff8a80':i===6?'#82b1ff':'#fff'};">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) cells += '<div style="background:#fafafa;"></div>';
    for (let dy = 1; dy <= daysInMonth; dy++) {
      const ds = `${monthStr}-${String(dy).padStart(2,'0')}`;
      const items = byDate[ds] || [];
      const isToday = ds === today;
      const dow = new Date(_calYear, _calMonth, dy).getDay();
      cells += `<div style="min-height:90px;padding:6px;background:${isToday?'#fffde7':'#fff'};border:1px solid #eee;${isToday?'border-color:#f9a825;':''}">
        <div style="font-size:0.82em;font-weight:700;margin-bottom:4px;color:${dow===0?'#c62828':dow===6?'#1565c0':'#333'};">${dy}</div>
        ${items.slice(0,4).map(it => {
          const colorMap = { planned:'#1565c0', loading:'#e65100', transit:'#7b1fa2', completed:'#27ae60', cancelled:'#999' };
          const c = colorMap[it.status] || '#666';
          return `<div onclick="dispatchExt._showDetail('${it.id}')" style="background:${c}15;border-left:3px solid ${c};padding:3px 6px;border-radius:3px;margin-bottom:2px;font-size:0.74em;cursor:pointer;color:${c};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${it.vehicleNo} · ${(it.items||[]).length}건
          </div>`;
        }).join('')}
        ${items.length > 4 ? `<div style="font-size:0.7em;color:#888;text-align:center;">+${items.length-4}</div>` : ''}
      </div>`;
    }

    box.innerHTML = `
      <div style="padding:14px 18px;background:#0d47a1;color:#fff;display:flex;justify-content:space-between;align-items:center;">
        <h4 style="margin:0;font-size:1em;font-weight:700;">📅 배차 캘린더 — ${_calYear}년 ${_calMonth+1}월</h4>
        <div>
          <button onclick="dispatchExt._calMove(-1)" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 10px;border-radius:5px;cursor:pointer;margin-right:4px;">◀</button>
          <button onclick="dispatchExt._calToday()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 10px;border-radius:5px;cursor:pointer;">오늘</button>
          <button onclick="dispatchExt._calMove(1)" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 10px;border-radius:5px;cursor:pointer;margin-left:4px;">▶</button>
          <button onclick="document.getElementById('dsp-cal-modal').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;margin-left:14px;">✕</button>
        </div>
      </div>
      <div style="padding:14px;overflow-y:auto;flex:1;">
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:0;">${cells}</div>
        <div style="margin-top:14px;display:flex;gap:14px;font-size:0.78em;color:#666;">
          <span><span style="display:inline-block;width:10px;height:10px;background:#1565c0;border-radius:2px;margin-right:4px;"></span>계획</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#e65100;border-radius:2px;margin-right:4px;"></span>상차중</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#7b1fa2;border-radius:2px;margin-right:4px;"></span>운송중</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#27ae60;border-radius:2px;margin-right:4px;"></span>완료</span>
        </div>
        <div style="margin-top:8px;text-align:center;font-size:0.82em;color:#888;">총 ${monthly.length}건 · 클릭하면 상세 모달 (보드)에서 확인</div>
      </div>`;
  }

  function _calMove(delta) {
    const d = new Date(_calYear, _calMonth + delta, 1);
    _renderCalendar(d);
  }
  function _calToday() { _renderCalendar(new Date()); }
  function _showDetail(id) {
    document.getElementById('dsp-cal-modal')?.remove();
    if (typeof dispatch !== 'undefined') {
      dispatch.open();
      // (해당 id 카드로 스크롤은 향후 — 일단 보드 열기만)
    }
  }

  // ── 운송장 PDF 인쇄 ────────────────────────────────
  function printWaybill(dispatchId) {
    const d = (typeof dispatch !== 'undefined') ? dispatch.list().find(x => x.id === dispatchId) : null;
    if (!d) { alert('배차 묶음을 찾을 수 없습니다'); return; }
    const items = (d.items||[]).map(doId => {
      const o = (typeof deliveryOrders !== 'undefined') ? deliveryOrders.find(x => x.id === doId) : null;
      return o || { id: doId, model: '?', totalQty: 0 };
    });
    const company = (typeof appSettings !== 'undefined' && appSettings.companyName) ? appSettings.companyName : '(주)영업관리';
    const totalQty = items.reduce((s,i) => s + (i.totalQty || i.qty || 0), 0);

    // 운송비 추정 (출발지·도착지 단일 기준 — 첫 항목 기준)
    const freight = items.length && items[0].plant ? getFreight(d.warehouse || items[0].warehouse || '광주', items[0].plant) : null;

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>운송장 ${d.id}</title>
      <style>
        @page{size:A4 portrait;margin:14mm}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:"맑은 고딕",sans-serif;color:#111;font-size:13px;}
        .no-print{padding:10px;background:#f5f5f5;text-align:center;border-bottom:1px solid #ddd;}
        @media print{.no-print{display:none}}
        .wrap{max-width:700px;margin:0 auto;padding:18px;}
        .ttl{font-size:1.6em;font-weight:900;text-align:center;letter-spacing:6px;margin:6px 0;}
        .sub{text-align:center;color:#888;font-size:0.86em;letter-spacing:3px;margin-bottom:14px;}
        .meta{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid #1a1a2e;margin-bottom:12px;}
        .meta div{padding:7px 12px;border:1px solid #ddd;display:flex;gap:8px;}
        .meta b{color:#888;font-size:0.84em;min-width:80px;font-weight:700;}
        table{width:100%;border-collapse:collapse;font-size:0.9em;margin-bottom:14px;}
        th{background:#1a1a2e;color:#fff;padding:7px;text-align:center;font-size:0.84em;}
        td{padding:7px;border:1px solid #ccc;text-align:center;}
        td.left{text-align:left;font-weight:700;padding-left:10px;}
        .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:24px;}
        .sb{border:1.5px solid #ccc;border-radius:8px;padding:14px;text-align:center;min-height:90px;}
        .sb-t{font-size:0.84em;color:#666;font-weight:700;border-bottom:1px solid #eee;padding-bottom:5px;margin-bottom:8px;}
        .sb-l{font-size:0.84em;color:#888;margin-top:8px;padding-top:8px;border-top:1px solid #eee;}
      </style></head><body>
      <div class="no-print">
        <button onclick="window.print()" style="padding:9px 26px;font-size:14px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-right:8px;">🖨️ 인쇄 / PDF 저장</button>
        <button onclick="window.close()" style="padding:9px 16px;font-size:13px;background:#999;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
      </div>
      <div class="wrap">
        <div style="text-align:right;font-size:0.78em;color:#999;margin-bottom:6px;">No. ${d.id}</div>
        <div style="font-size:1.1em;font-weight:800;color:#1a1a2e;text-align:center;">${company}</div>
        <div class="ttl">운 송 장</div>
        <div class="sub">WAYBILL</div>
        <div class="meta">
          <div><b>운송일자</b><span>${d.date}</span></div>
          <div><b>차량번호</b><span><strong>${d.vehicleNo}</strong></span></div>
          <div><b>운전자</b><span>${d.driver || '-'}${d.driverPhone?' ('+d.driverPhone+')':''}</span></div>
          <div><b>차량 캐파</b><span>${d.capacityPlt || '-'} PLT</span></div>
          ${freight ? `<div style="grid-column:1/-1;background:#fff3e0;"><b>운송비</b><span>${(freight.rate||0).toLocaleString()}원 (${freight.from} → ${freight.to})</span></div>` : ''}
          <div style="grid-column:1/-1;"><b>비고</b><span>${d.notes || '-'}</span></div>
        </div>
        <div style="font-weight:700;font-size:0.92em;color:#1a1a2e;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid #1a1a2e;">📦 운송 품목 (${items.length}건)</div>
        <table>
          <thead><tr><th style="width:8%">No</th><th>출고지시서</th><th>PJ NO</th><th>현장</th><th>모델</th><th style="width:12%">수량</th></tr></thead>
          <tbody>${items.map((it,i) => `<tr>
            <td>${i+1}</td>
            <td><strong>${it.id}</strong></td>
            <td>${it.pjNo||'-'}</td>
            <td class="left">${it.plant||it.receiver||'-'}<br><span style="font-size:0.84em;color:#888;font-weight:400;">${it.address||''}</span></td>
            <td>${it.model||'-'}</td>
            <td style="font-weight:800;">${(it.totalQty||it.qty||0).toLocaleString()}매</td>
          </tr>`).join('')}
          <tr style="background:#f0f0f0;font-weight:800;"><td colspan="5">합계 ${items.length}건</td><td>${totalQty.toLocaleString()}매</td></tr>
          </tbody>
        </table>
        <div class="sign">
          <div class="sb"><div class="sb-t">발송자 (회사)</div><div style="height:30px;"></div><div class="sb-l">${company}</div></div>
          <div class="sb"><div class="sb-t">운전자 서명</div><div style="height:30px;"></div><div class="sb-l">${d.driver||'____________'}</div></div>
          <div class="sb"><div class="sb-t">수령 확인</div><div style="height:30px;"></div><div class="sb-l">서명: ____________</div></div>
        </div>
        <div style="font-size:0.78em;color:#888;text-align:center;margin-top:18px;padding:8px;background:#fffde7;border-radius:6px;">
          ⚠️ 본 운송장 확인 후 운송 시작 · 운송 중 사고 발생 시 즉시 운송업체·발송자에 연락
        </div>
      </div></body></html>`;

    const w = window.open('', '_blank', 'width=760,height=1050');
    if (w) { w.document.write(html); w.document.close(); }
    else alert('팝업 차단을 해제해주세요');
  }

  // 카드 액션 버튼 자동 추가 (배차 카드에 🖨 운송장 / 📅 캘린더 진입)
  function _injectCardActions() {
    setInterval(() => {
      document.querySelectorAll('.dsp-card').forEach(card => {
        if (card.dataset.extActions) return;
        card.dataset.extActions = '1';
        // 카드의 헤더 우측에 운송장 버튼
        const hd = card.querySelector('.dsp-card-hd > div:last-child');
        if (!hd) return;
        // dispatch id를 추출 (delete 버튼의 onclick에서)
        const delBtn = hd.querySelector('button[onclick*="dispatch.remove"]');
        if (!delBtn) return;
        const m = (delBtn.getAttribute('onclick') || '').match(/'([^']+)'/);
        if (!m) return;
        const id = m[1];
        const wb = document.createElement('button');
        wb.title = '운송장 인쇄';
        wb.onclick = () => printWaybill(id);
        wb.style.cssText = 'border:none;background:transparent;color:#1565c0;cursor:pointer;margin-left:4px;font-size:1em;';
        wb.innerHTML = '🖨';
        hd.insertBefore(wb, delBtn);
      });
    }, 1000);
  }

  // 배차 보드 헤더에 캘린더 버튼 추가
  function _injectCalendarBtn() {
    setInterval(() => {
      const tb = document.querySelector('.dsp-toolbar');
      if (!tb || tb.dataset.extCal) return;
      tb.dataset.extCal = '1';
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-purple';
      btn.style.cssText = 'background:#7b1fa2;color:#fff;border:none;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:0.84em;';
      btn.textContent = '📅 캘린더';
      btn.onclick = openCalendar;
      tb.appendChild(btn);

      const settBtn = document.createElement('button');
      settBtn.className = 'btn btn-sm';
      settBtn.style.cssText = 'background:#5d4037;color:#fff;border:none;padding:6px 12px;border-radius:5px;cursor:pointer;font-size:0.84em;';
      settBtn.textContent = '🗂 마스터';
      settBtn.onclick = openMasters;
      tb.appendChild(settBtn);
    }, 1000);
  }

  // ── 마스터 관리 모달 (차량/기사/운송비) ────────────
  function openMasters() {
    let m = document.getElementById('dsp-master-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'dsp-master-modal';
    m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9700;display:flex;align-items:flex-start;justify-content:center;padding-top:5vh;';
    m.onclick = e => { if (e.target === m) m.remove(); };
    m.innerHTML = '<div id="dsp-mm-box" style="background:#fff;border-radius:14px;width:90%;max-width:780px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;"></div>';
    document.body.appendChild(m);
    _renderMasters('vehicle');
  }
  let _mmCurTab = 'vehicle';
  function _renderMasters(tab) {
    _mmCurTab = tab;
    const box = document.getElementById('dsp-mm-box');
    if (!box) return;
    const tabBtn = (k, lbl) => `<button onclick="dispatchExt._mmTab('${k}')" style="flex:1;padding:10px;border:none;background:${tab===k?'#fff':'#fafafa'};color:${tab===k?'#1a1a2e':'#888'};font-weight:${tab===k?'800':'400'};cursor:pointer;border-bottom:2px solid ${tab===k?'#1a1a2e':'transparent'};">${lbl}</button>`;
    let body = '';
    if (tab === 'vehicle') body = _renderVehicleMaster();
    else if (tab === 'driver') body = _renderDriverMaster();
    else if (tab === 'freight') body = _renderFreight();

    box.innerHTML = `
      <div style="padding:14px 18px;background:#5d4037;color:#fff;display:flex;justify-content:space-between;align-items:center;">
        <h4 style="margin:0;font-size:1em;font-weight:700;">🗂 마스터 — 차량 · 기사 · 운송비</h4>
        <button onclick="document.getElementById('dsp-master-modal').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;border-bottom:1px solid #eee;">
        ${tabBtn('vehicle', '🚚 차량 ('+Object.keys(vehicleMaster).length+')')}
        ${tabBtn('driver', '👤 기사 ('+Object.keys(driverMaster).length+')')}
        ${tabBtn('freight', '💰 운송비 ('+Object.keys(freightRates).length+')')}
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px;">${body}</div>`;
  }
  function _mmTab(t) { _renderMasters(t); }

  function _renderVehicleMaster() {
    const list = Object.entries(vehicleMaster);
    return `
      <div style="background:#fffde7;padding:10px 14px;border-radius:8px;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px;">
          <input id="vm-no" placeholder="차량번호*" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <select id="vm-type" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
            <option value="">차량 종류</option>
            ${VEHICLE_TYPES.map(t => `<option value="${t.code}">${t.name} (${t.plt}PLT)</option>`).join('')}
          </select>
          <input id="vm-driver" placeholder="기사" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="vm-phone" placeholder="연락처" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
        </div>
        <button onclick="dispatchExt._addVehicle()" style="background:#27ae60;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-weight:700;">➕ 추가</button>
      </div>
      ${list.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.86em;">
        <thead><tr style="background:#1a1a2e;color:#fff;">
          <th style="padding:6px 10px;text-align:left;">차량번호</th>
          <th style="padding:6px 10px;">종류</th>
          <th style="padding:6px 10px;">PLT 캐파</th>
          <th style="padding:6px 10px;text-align:left;">기사·연락처</th>
          <th style="padding:6px 10px;">사용</th>
          <th style="padding:6px 10px;"></th>
        </tr></thead><tbody>
        ${list.map(([no, v]) => {
          const cnt = (typeof dispatch !== 'undefined') ? dispatch.list().filter(d => d.vehicleNo === no && d.status !== 'cancelled').length : 0;
          const t = VEHICLE_TYPES.find(x => x.code === v.type);
          return `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px 10px;font-weight:700;">${no}</td>
            <td style="padding:6px 10px;text-align:center;">${t?t.name:'-'}</td>
            <td style="padding:6px 10px;text-align:center;">${v.capacityPlt||'-'} PLT</td>
            <td style="padding:6px 10px;font-size:0.92em;">${v.driver||'-'}${v.driverPhone?' · '+v.driverPhone:''}</td>
            <td style="padding:6px 10px;text-align:center;">${cnt}건</td>
            <td style="padding:6px 10px;text-align:center;"><button onclick="dispatchExt._delVehicle('${no.replace(/'/g,"\\'")}')" style="border:none;background:#c62828;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;">🗑</button></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<div style="padding:20px;text-align:center;color:#bbb;">등록된 차량 없음</div>'}`;
  }
  function _addVehicle() {
    const no = document.getElementById('vm-no').value.trim();
    if (!no) return alert('차량번호 필수');
    const type = document.getElementById('vm-type').value;
    const t = VEHICLE_TYPES.find(x => x.code === type);
    setVehicle(no, {
      type,
      capacityPlt: t?.plt || 7,
      driver: document.getElementById('vm-driver').value.trim(),
      driverPhone: document.getElementById('vm-phone').value.trim()
    });
    _renderMasters('vehicle');
  }
  function _delVehicle(no) {
    if (!confirm(`"${no}" 삭제?`)) return;
    delete vehicleMaster[no];
    _save('erp_vehicle_master', vehicleMaster);
    _renderMasters('vehicle');
  }

  function _renderDriverMaster() {
    const list = Object.entries(driverMaster);
    return `
      <div style="background:#fffde7;padding:10px 14px;border-radius:8px;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px;">
          <input id="dm-name" placeholder="기사명*" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="dm-phone" placeholder="연락처" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="dm-notes" placeholder="비고" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
        </div>
        <button onclick="dispatchExt._addDriver()" style="background:#27ae60;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-weight:700;">➕ 추가</button>
      </div>
      ${list.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.86em;">
        <thead><tr style="background:#1a1a2e;color:#fff;">
          <th style="padding:6px 10px;text-align:left;">이름</th>
          <th style="padding:6px 10px;">연락처</th>
          <th style="padding:6px 10px;">최근 차량</th>
          <th style="padding:6px 10px;">비고</th>
          <th style="padding:6px 10px;">사용</th>
          <th style="padding:6px 10px;"></th>
        </tr></thead><tbody>
        ${list.map(([n, d]) => {
          const cnt = (typeof dispatch !== 'undefined') ? dispatch.list().filter(x => x.driver === n).length : 0;
          return `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px 10px;font-weight:700;">${n}</td>
            <td style="padding:6px 10px;">${d.phone||'-'}</td>
            <td style="padding:6px 10px;">${d.lastVehicle||'-'}</td>
            <td style="padding:6px 10px;font-size:0.92em;">${d.notes||'-'}</td>
            <td style="padding:6px 10px;text-align:center;">${cnt}건</td>
            <td style="padding:6px 10px;text-align:center;"><button onclick="dispatchExt._delDriver('${n.replace(/'/g,"\\'")}')" style="border:none;background:#c62828;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;">🗑</button></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<div style="padding:20px;text-align:center;color:#bbb;">등록된 기사 없음</div>'}`;
  }
  function _addDriver() {
    const n = document.getElementById('dm-name').value.trim();
    if (!n) return alert('기사명 필수');
    setDriver(n, {
      phone: document.getElementById('dm-phone').value.trim(),
      notes: document.getElementById('dm-notes').value.trim()
    });
    _renderMasters('driver');
  }
  function _delDriver(n) {
    if (!confirm(`"${n}" 삭제?`)) return;
    delete driverMaster[n];
    _save('erp_driver_master', driverMaster);
    _renderMasters('driver');
  }

  function _renderFreight() {
    const list = Object.values(freightRates);
    return `
      <div style="background:#fffde7;padding:10px 14px;border-radius:8px;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px;">
          <input id="fr-from" placeholder="출발지*" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="fr-to" placeholder="도착지*" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="fr-rate" type="number" placeholder="단가(원)" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
          <input id="fr-note" placeholder="비고 (5톤기준 등)" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
        </div>
        <button onclick="dispatchExt._addFreight()" style="background:#27ae60;color:#fff;border:none;padding:6px 14px;border-radius:5px;cursor:pointer;font-weight:700;">➕ 추가</button>
      </div>
      ${list.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.86em;">
        <thead><tr style="background:#1a1a2e;color:#fff;">
          <th style="padding:6px 10px;text-align:left;">출발지</th>
          <th style="padding:6px 10px;">→</th>
          <th style="padding:6px 10px;text-align:left;">도착지</th>
          <th style="padding:6px 10px;text-align:right;">단가</th>
          <th style="padding:6px 10px;">비고</th>
          <th style="padding:6px 10px;"></th>
        </tr></thead><tbody>
        ${list.sort((a,b) => (a.from||'').localeCompare(b.from||'')).map(f => `<tr style="border-bottom:1px solid #eee;">
          <td style="padding:6px 10px;font-weight:700;">${f.from}</td>
          <td style="padding:6px 10px;text-align:center;color:#888;">→</td>
          <td style="padding:6px 10px;font-weight:700;">${f.to}</td>
          <td style="padding:6px 10px;text-align:right;color:#27ae60;font-weight:700;">${(f.rate||0).toLocaleString()}원</td>
          <td style="padding:6px 10px;font-size:0.92em;">${f.note||'-'}</td>
          <td style="padding:6px 10px;text-align:center;"><button onclick="dispatchExt._delFreight('${f.from}','${f.to}')" style="border:none;background:#c62828;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;">🗑</button></td>
        </tr>`).join('')}</tbody></table>` : '<div style="padding:20px;text-align:center;color:#bbb;">등록된 운송비 없음</div>'}`;
  }
  function _addFreight() {
    const from = document.getElementById('fr-from').value.trim();
    const to = document.getElementById('fr-to').value.trim();
    if (!from || !to) return alert('출발지·도착지 필수');
    setFreight(from, to, {
      rate: parseInt(document.getElementById('fr-rate').value) || 0,
      note: document.getElementById('fr-note').value.trim()
    });
    _renderMasters('freight');
  }
  function _delFreight(from, to) {
    if (!confirm(`${from} → ${to} 삭제?`)) return;
    delete freightRates[`${from}|${to}`];
    _save('erp_freight_rates', freightRates);
    _renderMasters('freight');
  }

  // ── 공개 API ────────────────────────────────────────
  window.dispatchExt = {
    VEHICLE_TYPES,
    setVehicle, setDriver, setFreight, getFreight,
    openCalendar, openMasters, printWaybill,
    masters: () => ({ vehicleMaster, driverMaster, freightRates }),
    _applyVtype, _calMove, _calToday, _showDetail,
    _mmTab, _addVehicle, _delVehicle, _addDriver, _delDriver, _addFreight, _delFreight
  };

  function boot() {
    _injectVehicleTypeSelector();
    _injectCardActions();
    _injectCalendarBtn();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-DSP-EXT] 배차 확장 활성 — 차량 종류·마스터·캘린더·운송장·운송비');
})();
