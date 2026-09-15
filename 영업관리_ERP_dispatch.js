// =====================================================
//  DISPATCH BOARD — Phase E · Day 3~4
//  배차/일정 보드 — 일자×차량 단위로 출고를 묶어 배송 일정 관리
//
//  데이터 키: erp_dispatch
//   { id, date, vehicleNo, driver, capacity_plt, status, items: [doId,...], notes }
//   status: 'planned' | 'loading' | 'transit' | 'completed' | 'cancelled'
//
//  KPI 3개: 배차 묶음 / 할당 출고 / 미배차 출고
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_dispatch';
  let data = [];
  try { data = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e) { data = []; }

  function _save() {
    try {
      const prev = localStorage.getItem(KEY);
      if (prev != null) localStorage.setItem(KEY + '_backup', prev);
    } catch(e) {}
    try { localStorage.setItem(KEY, JSON.stringify(data.slice(-1000))); }
    catch(e) { if (typeof logError === 'function') logError('dispatch.save', e); }
  }

  function _genId() { return 'DSP-' + Date.now() + '-' + Math.random().toString(36).slice(2,5); }

  // 미배차 출고지시서 = deliveryOrders 중 어느 dispatch에도 포함 안 됨
  function _assignedDoIds() {
    const set = new Set();
    data.forEach(d => {
      if (d.status === 'cancelled') return;
      (d.items || []).forEach(id => set.add(id));
    });
    return set;
  }

  function unassigned() {
    if (typeof deliveryOrders === 'undefined') return [];
    const assigned = _assignedDoIds();
    return deliveryOrders.filter(d => !d.processed && !assigned.has(d.id));
  }

  function summary(fromDate, toDate) {
    let dispatchList = data.filter(d => d.status !== 'cancelled');
    if (fromDate) dispatchList = dispatchList.filter(d => (d.date||'') >= fromDate);
    if (toDate)   dispatchList = dispatchList.filter(d => (d.date||'') <= toDate);
    const assigned = dispatchList.reduce((s,d) => s + (d.items?.length||0), 0);
    const un = unassigned().length;
    return {
      groupCount: dispatchList.length,
      assignedCount: assigned,
      unassignedCount: un,
      list: dispatchList
    };
  }

  function add(rec) {
    const entry = {
      id: rec.id || _genId(),
      createdAt: new Date().toISOString(),
      date: rec.date || new Date().toISOString().slice(0,10),
      vehicleNo: rec.vehicleNo || '',
      driver: rec.driver || '',
      driverPhone: rec.driverPhone || '',
      capacityPlt: Number(rec.capacityPlt) || 7,
      status: rec.status || 'planned',
      items: rec.items || [],
      notes: rec.notes || ''
    };
    data.push(entry);
    _save();
    _refresh();
    return entry;
  }

  function update(id, patch) {
    const i = data.findIndex(d => d.id === id);
    if (i < 0) return null;
    data[i] = { ...data[i], ...patch, updatedAt: new Date().toISOString() };
    _save(); _refresh();
    return data[i];
  }

  function remove(id) {
    if (!confirm('이 배차 묶음을 삭제합니까? (포함된 출고지시서는 미배차로 돌아갑니다)')) return false;
    data = data.filter(d => d.id !== id);
    _save(); _refresh();
    return true;
  }

  function assignTo(dispatchId, doId) {
    const i = data.findIndex(d => d.id === dispatchId);
    if (i < 0) return false;
    if (!data[i].items) data[i].items = [];
    if (data[i].items.includes(doId)) return true;
    data[i].items.push(doId);
    _save(); _refresh();
    return true;
  }

  function removeFrom(dispatchId, doId) {
    const i = data.findIndex(d => d.id === dispatchId);
    if (i < 0) return false;
    data[i].items = (data[i].items || []).filter(x => x !== doId);
    _save(); _refresh();
    return true;
  }

  function _statusLabel(s) {
    return ({
      planned:   { lbl:'계획',  bg:'#e3f2fd', color:'#1565c0' },
      loading:   { lbl:'상차중', bg:'#fff3e0', color:'#e65100' },
      transit:   { lbl:'운송중', bg:'#7b1fa2', color:'#fff' },
      completed: { lbl:'완료',  bg:'#e8f5e9', color:'#2e7d32' },
      cancelled: { lbl:'취소',  bg:'#fafafa', color:'#999' }
    })[s] || { lbl:s, bg:'#eee', color:'#666' };
  }

  // ── UI ──────────────────────────────────────────────
  function _injectUI() {
    if (document.getElementById('erp-dsp-fab')) return;
    const css = `
      #erp-dsp-fab{position:fixed;bottom:18px;right:452px;width:44px;height:44px;border-radius:50%;
        background:#0d47a1;color:#fff;border:none;cursor:pointer;font-size:18px;z-index:9000;
        box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform .15s,background .2s;}
      #erp-dsp-fab:hover{background:#002171;transform:scale(1.07);}
      #erp-dsp-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
        z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:5vh;}
      #erp-dsp-modal.open{display:flex;}
      .dsp-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.35);
        width:92%;max-width:1180px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}
      .dsp-hd{padding:14px 18px;background:#0d47a1;color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .dsp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px 18px;background:#fafafa;border-bottom:1px solid #eee;}
      .dsp-stat{padding:10px;border-radius:8px;background:#fff;border:1px solid #e0e0e0;}
      .dsp-stat-l{font-size:0.74em;color:#888;font-weight:600;margin-bottom:4px;}
      .dsp-stat-v{font-size:1.4em;font-weight:800;}
      .dsp-toolbar{padding:8px 18px;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center;}
      .dsp-toolbar input,.dsp-toolbar select{padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.84em;}
      .dsp-bd{flex:1;overflow-y:auto;padding:14px 18px;display:grid;grid-template-columns:2fr 1fr;gap:14px;}
      .dsp-section h5{margin:0 0 8px;font-size:0.92em;font-weight:700;color:#1a1a2e;padding-bottom:4px;border-bottom:2px solid #1a1a2e;}
      .dsp-card{background:#fff;border-radius:8px;border:1px solid #e0e0e0;padding:10px 12px;margin-bottom:8px;}
      .dsp-card-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
      .dsp-card-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;}
      .dsp-card-items{margin-top:6px;padding:6px;background:#fafafa;border-radius:5px;font-size:0.82em;}
      .dsp-item-row{padding:3px 6px;border-bottom:1px dashed #eee;display:flex;justify-content:space-between;}
      .dsp-form{padding:10px 14px;background:#fffde7;border-radius:8px;margin-bottom:10px;border:1px solid #f9a825;display:none;}
      .dsp-form.open{display:block;}
      .dsp-form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px;}
      .dsp-form input,.dsp-form select{padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:0.84em;}
      .dsp-form button{padding:5px 10px;border-radius:5px;border:none;cursor:pointer;font-size:0.84em;}
      .dsp-unassigned-card{background:#ffebee;border:1px solid #ffcdd2;border-radius:6px;padding:8px 10px;margin-bottom:6px;cursor:grab;font-size:0.82em;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-dsp-style'; style.textContent = css;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'erp-dsp-fab'; fab.title = '배차/일정 보드'; fab.textContent = '🚛';
    fab.onclick = open; document.body.appendChild(fab);

    const today = new Date().toISOString().slice(0,10);
    const inTen = new Date(); inTen.setDate(inTen.getDate()+10);
    const inTenStr = inTen.toISOString().slice(0,10);

    const modal = document.createElement('div');
    modal.id = 'erp-dsp-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="dsp-box">
        <div class="dsp-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">🚛 배차/일정 보드 — 일자×차량 단위로 출고 묶음</h4>
          <button onclick="document.getElementById('erp-dsp-modal').classList.remove('open')"
            style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div id="dsp-stats" class="dsp-stats"></div>
        <div class="dsp-toolbar">
          <input type="date" id="dsp-from" value="${today}">
          <span style="color:#888;">~</span>
          <input type="date" id="dsp-to" value="${inTenStr}">
          <select id="dsp-status-filter">
            <option value="">전체 상태</option>
            <option value="planned">계획</option>
            <option value="loading">상차중</option>
            <option value="transit">운송중</option>
            <option value="completed">완료</option>
          </select>
          <button class="btn btn-sm btn-blue" onclick="dispatch._toggleForm()">배차 추가</button>
          <button class="btn btn-sm btn-green" onclick="dispatch._togglePaste()">붙여넣기 등록</button>
          <button class="btn btn-sm btn-dark" onclick="dispatch._refresh()">새로고침</button>
        </div>
        <div class="dsp-bd">
          <div class="dsp-section">
            <h5>📋 배차 묶음</h5>
            <div id="dsp-paste" class="dsp-form" style="background:#fffbf0;border:2px dashed #f9a825;padding:12px;border-radius:8px;margin-bottom:10px;">
              <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px;">
                <div>
                  <label style="display:block;font-size:0.78em;color:#666;font-weight:700;margin-bottom:3px;">출고일자</label>
                  <input type="date" id="dsp-paste-date" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;">
                </div>
                <div>
                  <label style="display:block;font-size:0.78em;color:#666;font-weight:700;margin-bottom:3px;">기본 트럭당 PLT</label>
                  <input type="number" id="dsp-paste-capacity" value="14" min="1" style="padding:6px 8px;border:1px solid #ddd;border-radius:5px;width:90px;">
                </div>
                <button onclick="dispatch._parsePaste()" style="background:#0d47a1;color:#fff;padding:7px 14px;border:none;border-radius:5px;cursor:pointer;font-weight:700;">분석</button>
                <button onclick="dispatch._togglePaste()" style="background:#999;color:#fff;padding:7px 14px;border:none;border-radius:5px;cursor:pointer;">취소</button>
              </div>
              <div style="font-size:0.8em;color:#666;margin-bottom:6px;">
                <strong>지원 형식:</strong>
                <div style="background:#fff;padding:6px 10px;border-radius:4px;margin-top:4px;font-family:monospace;font-size:0.86em;line-height:1.5;">
                  <span style="color:#1565c0;">① 화성 유성별</span><br>
                  <span style="color:#1565c0;">&nbsp;&nbsp;&nbsp;신정식 경기94자6254</span><br>
                  <span style="color:#1565c0;">&nbsp;&nbsp;&nbsp;01063731986</span><br><br>
                  <span style="color:#7b1fa2;">② 대성스틸 발전소 / 화성   14 PLT * 2대</span><br>
                  <span style="color:#7b1fa2;">&nbsp;&nbsp;&nbsp;전북86사1490   010-7797-2372   유복현</span><br>
                  <span style="color:#7b1fa2;">&nbsp;&nbsp;&nbsp;전남80바7816   010-3607-5395   김종익</span>
                </div>
              </div>
              <textarea id="dsp-paste-text" rows="8" placeholder="여기에 배차 정보를 붙여넣으세요 (위 두 형식 자동 인식)"
                style="width:100%;padding:8px;border:1px solid #ddd;border-radius:5px;font-family:'Consolas',monospace;font-size:0.84em;resize:vertical;box-sizing:border-box;"></textarea>
              <div id="dsp-paste-preview" style="display:none;margin-top:10px;background:#fff;border-radius:6px;padding:10px;max-height:300px;overflow:auto;"></div>
            </div>
            <div id="dsp-form" class="dsp-form">
              <div class="dsp-form-grid">
                <input type="date" id="dsp-f-date">
                <input id="dsp-f-vehicle" placeholder="차량번호 (예: 12가3456)">
                <input id="dsp-f-capacity" type="number" placeholder="트럭당 PLT (기본 7)" value="7">
              </div>
              <div class="dsp-form-grid">
                <input id="dsp-f-driver" placeholder="기사명">
                <input id="dsp-f-phone" placeholder="기사 연락처">
                <select id="dsp-f-status">
                  <option value="planned">계획</option>
                  <option value="loading">상차중</option>
                  <option value="transit">운송중</option>
                </select>
              </div>
              <input id="dsp-f-notes" placeholder="비고" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:5px;font-size:0.84em;margin-top:4px;box-sizing:border-box;">
              <div style="margin-top:8px;display:flex;gap:6px;">
                <button onclick="dispatch._submitForm()" style="background:#27ae60;color:#fff;">💾 저장</button>
                <button onclick="dispatch._toggleForm()" style="background:#999;color:#fff;">취소</button>
              </div>
            </div>
            <div id="dsp-list"></div>
          </div>
          <div class="dsp-section">
            <h5>⚠️ 미배차 출고</h5>
            <div id="dsp-unassigned"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('dsp-from').addEventListener('change', _refresh);
    document.getElementById('dsp-to').addEventListener('change', _refresh);
    document.getElementById('dsp-status-filter').addEventListener('change', _refresh);
  }

  function _toggleForm() {
    const f = document.getElementById('dsp-form');
    f.classList.toggle('open');
    if (f.classList.contains('open')) {
      document.getElementById('dsp-f-date').value = new Date().toISOString().slice(0,10);
      ['dsp-f-vehicle','dsp-f-driver','dsp-f-phone','dsp-f-notes'].forEach(id => document.getElementById(id).value = '');
    }
  }

  // ── 붙여넣기 등록 (텍스트 파싱) ─────────────────────
  function _togglePaste() {
    const f = document.getElementById('dsp-paste');
    f.classList.toggle('open');
    if (f.classList.contains('open')) {
      const dEl = document.getElementById('dsp-paste-date');
      if (dEl && !dEl.value) dEl.value = new Date().toISOString().slice(0,10);
      document.getElementById('dsp-paste-text').value = '';
      document.getElementById('dsp-paste-preview').style.display = 'none';
      document.getElementById('dsp-paste-preview').innerHTML = '';
      setTimeout(() => document.getElementById('dsp-paste-text').focus(), 30);
    }
  }

  // 한글 차량번호 정규식 — "경기94자6254" / "전남83바2601" / "12가3456" 등
  //   지역2자(선택) + 1~3자리숫자 + 한글1자 + 4자리숫자
  const _RE_PLATE = /([가-힣]{1,3})?(\d{1,3})([가-힣])(\d{4})/;
  // 휴대전화: 010-1234-5678 / 01012345678
  //   ★ 앞에 다른 숫자 없도록 lookbehind — 차량번호("2017") 내부 매칭 방지
  const _RE_PHONE = /(?<!\d)(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})(?!\d)/;
  // PLT 수량 헤더: "14 PLT * 2대" / "8 PLT" / "14PLT*2"
  const _RE_PLT = /(\d+)\s*PLT/i;
  const _RE_TRUCKS = /\*\s*(\d+)\s*대/;
  // 날짜 힌트: "5/8일" / "5월 8일" / "2026-05-08"
  function _detectDateHint(text) {
    let m;
    if (m = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)) {
      return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    }
    if (m = text.match(/(\d{1,2})[/.](\d{1,2})\s*일/) || text.match(/(\d{1,2})월\s*(\d{1,2})일/)) {
      const yr = new Date().getFullYear();
      return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    }
    return null;
  }

  // 텍스트를 블록 단위로 파싱 — 두 가지 형식 자동 인식
  function _parseBlock(lines) {
    // lines: 빈 줄 제외 1~N 줄의 배열
    // 결과: { kind:'simple'|'header', ... }
    if (lines.length === 0) return null;

    // 헤더 형식 판단 — 첫 줄에 PLT 또는 "/" + 지역명 패턴
    const head = lines[0];
    const hasPlt = _RE_PLT.test(head);
    const hasSlash = head.includes('/');
    const isHeader = hasPlt || hasSlash;

    if (isHeader && lines.length >= 2) {
      // 형식 ②: 헤더 + N대 차량 라인
      const pltMatch = head.match(_RE_PLT);
      const truckMatch = head.match(_RE_TRUCKS);
      const headerPlt = pltMatch ? parseInt(pltMatch[1]) : 0;
      const headerTrucks = truckMatch ? parseInt(truckMatch[1]) : 1;
      // 발전소 / 지역 파싱 — slash 기준 split
      let plant = head, region = '';
      if (hasSlash) {
        const parts = head.split('/').map(s => s.trim());
        plant = parts[0].replace(_RE_PLT,'').replace(_RE_TRUCKS,'').replace(/\*$/,'').trim();
        const tail = parts.slice(1).join('/').trim();
        // tail에서 PLT 정보 제거 → 지역만 남김
        region = tail.replace(_RE_PLT,'').replace(_RE_TRUCKS,'').replace(/\*/g,'').trim();
      } else {
        plant = head.replace(_RE_PLT,'').replace(_RE_TRUCKS,'').replace(/\*/g,'').trim();
      }

      // 차량 라인 (헤더 이후): "차량번호  전화번호  이름" (공백 다수로 구분)
      const vehicles = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const pm = line.match(_RE_PLATE);
        const phm = line.match(_RE_PHONE);
        if (!pm) continue;
        const plate = pm[0];
        const phone = phm ? `${phm[1]}-${phm[2]}-${phm[3]}` : '';
        // 이름 = 라인에서 plate + phone 제거 후 남은 한글
        let rest = line.replace(plate, '').replace(_RE_PHONE, '').replace(/\s+/g,' ').trim();
        const nameMatch = rest.match(/[가-힣]{2,4}/);
        const driver = nameMatch ? nameMatch[0] : rest.trim();
        vehicles.push({
          plate, phone, driver,
          plant, region,
          capacityPlt: headerPlt > 0 ? headerPlt : 0,
          notes: head
        });
      }
      return { kind:'header', plant, region, headerPlt, headerTrucks, vehicles };
    }

    // 형식 ①: 3줄 단순 형식 — 지역+발전소 / 운전자+차량 / 전화
    if (lines.length >= 2) {
      const loc = lines[0];
      let driver = '', plate = '', phone = '';
      // 차량번호와 운전자 라인
      const line2 = lines[1];
      const pm2 = line2.match(_RE_PLATE);
      if (pm2) {
        plate = pm2[0];
        const rest = line2.replace(plate, '').replace(/\s+/g,' ').trim();
        const nm = rest.match(/[가-힣]{2,4}/);
        driver = nm ? nm[0] : rest;
      }
      // 전화번호 (line3 또는 line2)
      const phLine = lines.slice(1).join(' ');
      const phm = phLine.match(_RE_PHONE);
      if (phm) phone = `${phm[1]}-${phm[2]}-${phm[3]}`;
      // 지역과 발전소 분리 — 첫 단어 = 지역, 나머지 = 발전소
      let region = '', plant = loc;
      const locParts = loc.trim().split(/\s+/);
      if (locParts.length >= 2) {
        region = locParts[0];
        plant = locParts.slice(1).join(' ');
      }
      if (!plate) return null;
      return { kind:'simple', vehicles:[{ plate, phone, driver, plant, region, capacityPlt:0, notes: loc }] };
    }
    return null;
  }

  // ★ 전체 텍스트 파싱
  function _parsePasteText(text) {
    if (!text) return { dateHint:null, items:[] };
    const dateHint = _detectDateHint(text);
    // 날짜 힌트 라인 제거
    const cleaned = text.replace(/^.*?\d{1,2}[/.월]\d{1,2}[일 ].*?(?:정보|차량|입니다).*$/m,'');
    // 블록 분리 — 빈 줄 기준
    const blocks = cleaned.split(/\n\s*\n+/);
    const items = [];
    blocks.forEach(block => {
      const lines = block.split(/\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length === 0) return;
      const parsed = _parseBlock(lines);
      if (parsed && parsed.vehicles) {
        items.push(...parsed.vehicles);
      }
    });
    return { dateHint, items };
  }

  function _parsePaste() {
    const text = document.getElementById('dsp-paste-text').value || '';
    if (!text.trim()) { alert('붙여넣을 텍스트가 없습니다.'); return; }
    const result = _parsePasteText(text);
    if (result.dateHint) {
      const dEl = document.getElementById('dsp-paste-date');
      if (dEl && !dEl.value) dEl.value = result.dateHint;
    }
    const items = result.items;
    const preview = document.getElementById('dsp-paste-preview');
    if (items.length === 0) {
      preview.style.display = 'block';
      preview.innerHTML = '<div style="color:#c62828;font-weight:700;">⚠️ 인식된 차량 없음 — 형식을 확인하세요</div>';
      return;
    }
    const defaultPlt = parseInt(document.getElementById('dsp-paste-capacity').value) || 14;
    preview.style.display = 'block';
    preview.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#0d47a1;">분석 결과: ${items.length}대 인식</strong>
        <button onclick="dispatch._registerPaste()" style="background:#27ae60;color:#fff;padding:6px 14px;border:none;border-radius:5px;cursor:pointer;font-weight:700;">✅ 전체 등록</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:0.84em;">
        <thead><tr style="background:#1a1a2e;color:#fff;">
          <th style="padding:6px;text-align:left;">#</th>
          <th style="padding:6px;text-align:left;">차량번호</th>
          <th style="padding:6px;text-align:left;">운전자</th>
          <th style="padding:6px;text-align:left;">전화</th>
          <th style="padding:6px;text-align:left;">발전소</th>
          <th style="padding:6px;text-align:left;">지역</th>
          <th style="padding:6px;text-align:right;">PLT</th>
        </tr></thead>
        <tbody>${items.map((v,i) => `<tr style="border-bottom:1px solid #eee;">
          <td style="padding:5px;">${i+1}</td>
          <td style="padding:5px;font-weight:700;color:#0d47a1;">${_esc(v.plate)}</td>
          <td style="padding:5px;">${_esc(v.driver||'-')}</td>
          <td style="padding:5px;color:#666;">${_esc(v.phone||'-')}</td>
          <td style="padding:5px;">${_esc(v.plant||'-')}</td>
          <td style="padding:5px;color:#888;">${_esc(v.region||'-')}</td>
          <td style="padding:5px;text-align:right;">${v.capacityPlt || defaultPlt}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div style="margin-top:6px;font-size:0.78em;color:#888;">※ PLT 빈 행은 기본값(${defaultPlt}) 적용</div>`;
    // 파싱 결과 캐시
    window._dspPasteCache = { items, defaultPlt };
  }

  function _esc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    return String(s||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
  }

  function _registerPaste() {
    const cache = window._dspPasteCache;
    if (!cache || !cache.items || cache.items.length === 0) { alert('먼저 분석 버튼을 눌러주세요.'); return; }
    const date = document.getElementById('dsp-paste-date').value || new Date().toISOString().slice(0,10);
    const defaultPlt = cache.defaultPlt || 14;
    if (!confirm(`${date} 일자로 ${cache.items.length}건의 배차를 등록하시겠습니까?`)) return;
    let n = 0;
    cache.items.forEach(v => {
      const plant = v.plant || '';
      const region = v.region || '';
      const noteParts = [];
      if (plant) noteParts.push('발전소: ' + plant);
      if (region) noteParts.push('지역: ' + region);
      const rec = {
        date,
        vehicleNo: v.plate,
        driver: v.driver || '',
        driverPhone: v.phone || '',
        capacityPlt: v.capacityPlt > 0 ? v.capacityPlt : defaultPlt,
        status: 'planned',
        items: [],
        notes: noteParts.join(' / ')
      };
      add(rec);
      n++;
    });
    document.getElementById('dsp-paste-text').value = '';
    document.getElementById('dsp-paste-preview').style.display = 'none';
    window._dspPasteCache = null;
    // 폼 닫기
    document.getElementById('dsp-paste').classList.remove('open');
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${n}건 배차 일괄 등록 완료 (${date})`);
  }
  function _submitForm() {
    const date = document.getElementById('dsp-f-date').value;
    const vehicle = document.getElementById('dsp-f-vehicle').value.trim();
    if (!date || !vehicle) { alert('일자 + 차량번호 필수'); return; }
    add({
      date, vehicleNo: vehicle,
      driver: document.getElementById('dsp-f-driver').value.trim(),
      driverPhone: document.getElementById('dsp-f-phone').value.trim(),
      capacityPlt: parseInt(document.getElementById('dsp-f-capacity').value) || 22,
      status: document.getElementById('dsp-f-status').value,
      notes: document.getElementById('dsp-f-notes').value.trim()
    });
    _toggleForm();
    if (typeof setBanner === 'function') setBanner('ok', `✅ ${date} ${vehicle} 배차 등록`);
  }

  function _refresh() {
    if (!document.getElementById('erp-dsp-modal')?.classList.contains('open')) return;
    const fromDate = document.getElementById('dsp-from').value;
    const toDate = document.getElementById('dsp-to').value;
    const statusF = document.getElementById('dsp-status-filter').value;

    const s = summary(fromDate, toDate);
    document.getElementById('dsp-stats').innerHTML = `
      <div class="dsp-stat" style="background:#e3f2fd;">
        <div class="dsp-stat-l">배차 묶음</div>
        <div class="dsp-stat-v" style="color:#1565c0;">${s.groupCount}건</div>
      </div>
      <div class="dsp-stat" style="background:#e8f5e9;">
        <div class="dsp-stat-l">할당 출고</div>
        <div class="dsp-stat-v" style="color:#2e7d32;">${s.assignedCount}건</div>
      </div>
      <div class="dsp-stat" style="background:#ffebee;">
        <div class="dsp-stat-l">미배차 출고</div>
        <div class="dsp-stat-v" style="color:#c62828;">${s.unassignedCount}건</div>
      </div>`;

    let list = s.list;
    if (statusF) list = list.filter(d => d.status === statusF);
    list = list.sort((a,b) => (a.date||'').localeCompare(b.date||''));

    const listEl = document.getElementById('dsp-list');
    if (!list.length) {
      listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#bbb;font-size:0.86em;">조회 기간 내 배차 없음</div>';
    } else {
      // ★ XSS 차단 — vehicleNo·driver·pjNo·model 등 사용자 입력 escape
      const _e = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v||''));
      const _a = (typeof escapeAttr === 'function') ? escapeAttr : (v => String(v||'').replace(/['"&]/g,''));
      listEl.innerHTML = list.map(d => {
        const tag = _statusLabel(d.status);
        const items = (d.items || []).map(doId => {
          const o = (typeof deliveryOrders !== 'undefined') ? deliveryOrders.find(x => x.id === doId) : null;
          if (!o) return `<div class="dsp-item-row"><span style="color:#c62828;">⚠️ 삭제된 출고: ${_e(doId)}</span><button data-act="dsp-remove-item" data-dsp="${_a(d.id)}" data-do="${_a(doId)}" style="border:none;background:transparent;color:#c62828;cursor:pointer;">✕</button></div>`;
          return `<div class="dsp-item-row">
            <span><strong>${_e(o.id)}</strong> · ${_e(o.pjNo || '-')} · ${_e(o.model || '-')} · ${(o.totalQty||0).toLocaleString()}매</span>
            <button data-act="dsp-remove-item" data-dsp="${_a(d.id)}" data-do="${_a(doId)}" style="border:none;background:transparent;color:#c62828;cursor:pointer;font-size:0.84em;">✕</button>
          </div>`;
        }).join('');
        const itemCount = (d.items || []).length;
        return `<div class="dsp-card">
          <div class="dsp-card-hd">
            <div>
              <strong>${_e(d.date)}</strong> · ${_e(d.vehicleNo)}
              ${d.driver?`<span style="color:#666;">(${_e(d.driver)}${d.driverPhone?' '+_e(d.driverPhone):''})</span>`:''}
            </div>
            <div>
              <span class="dsp-card-tag" style="background:${tag.bg};color:${tag.color};">${_e(tag.lbl)}</span>
              <select data-act="dsp-update-status" data-dsp="${_a(d.id)}" style="margin-left:6px;font-size:0.78em;padding:2px 4px;">
                ${['planned','loading','transit','completed','cancelled'].map(s => `<option value="${s}" ${s===d.status?'selected':''}>${_e(_statusLabel(s).lbl)}</option>`).join('')}
              </select>
              <button data-act="dsp-remove" data-dsp="${_a(d.id)}" style="border:none;background:transparent;color:#c62828;cursor:pointer;margin-left:4px;">🗑️</button>
            </div>
          </div>
          <div style="font-size:0.82em;color:#666;">
            할당 ${itemCount}건 · 캐파 ${d.capacityPlt} PLT
            ${d.notes?` · 💬 ${d.notes}`:''}
          </div>
          ${itemCount ? `<div class="dsp-card-items">${items}</div>` : '<div style="margin-top:6px;color:#bbb;font-size:0.82em;text-align:center;">미배차 출고에서 ➕ 클릭하여 할당</div>'}
        </div>`;
      }).join('');
    }

    // 미배차 패널
    const un = unassigned();
    const unEl = document.getElementById('dsp-unassigned');
    if (!un.length) {
      unEl.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;font-size:0.86em;">✅ 미배차 출고 없음</div>';
    } else {
      unEl.innerHTML = un.map(o => {
        const dispatchOptions = list.map(d => `<option value="${d.id}">${d.date} · ${d.vehicleNo}</option>`).join('');
        return `<div class="dsp-unassigned-card">
          <div style="font-weight:700;">${o.id}</div>
          <div style="color:#666;margin-top:2px;">${o.pjNo || '-'} · ${o.plant || o.receiver || '-'}</div>
          <div style="color:#888;font-size:0.92em;margin-top:2px;">${o.model || '-'} · ${(o.totalQty||0).toLocaleString()}매</div>
          ${list.length ? `<div style="margin-top:6px;display:flex;gap:4px;">
            <select id="assign-${o.id}" style="flex:1;padding:3px 5px;font-size:0.82em;">${dispatchOptions}</select>
            <button onclick="dispatch._assignFromList('${o.id}')" style="background:#27ae60;color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:0.82em;">➕ 할당</button>
          </div>` : '<div style="margin-top:4px;color:#999;font-size:0.78em;">먼저 ➕ 배차 추가</div>'}
        </div>`;
      }).join('');
    }
  }

  function _assignFromList(doId) {
    const sel = document.getElementById('assign-'+doId);
    if (!sel) return;
    const dspId = sel.value;
    if (!dspId) return;
    assignTo(dspId, doId);
  }

  function open() {
    _injectUI();
    const modal = document.getElementById('erp-dsp-modal');
    modal.classList.add('open');
    setTimeout(_refresh, 50);
    // ★ XSS 차단 후속 — 위임 핸들러 (한 번만)
    if (!modal.__delegated) {
      modal.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        const dsp = btn.getAttribute('data-dsp');
        const doId = btn.getAttribute('data-do');
        if (act === 'dsp-remove-item' && dsp && doId) removeFrom(dsp, doId);
        else if (act === 'dsp-remove' && dsp)         remove(dsp);
      });
      modal.addEventListener('change', e => {
        const sel = e.target.closest('[data-act="dsp-update-status"]');
        if (!sel) return;
        const dsp = sel.getAttribute('data-dsp');
        if (dsp) update(dsp, { status: sel.value });
      });
      modal.__delegated = true;
    }
  }
  function close() { document.getElementById('erp-dsp-modal')?.classList.remove('open'); }

  window.dispatch = {
    add, update, remove, assignTo, removeFrom,
    list: () => data.slice(),
    summary, unassigned, open, close,
    _toggleForm, _submitForm, _refresh: _refresh, _assignFromList,
    _togglePaste, _parsePaste, _registerPaste,
    _parsePasteText,   // 단위테스트 / 콘솔 디버그용
    raw: () => data.slice()
  };

  function boot() { _injectUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-DSP] 배차/일정 보드 활성 — 우측 하단 🚛 또는 dispatch.open()');
})();
