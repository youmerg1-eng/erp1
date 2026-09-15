// =====================================================
//  WAREHOUSE MASTER — 창고 + 구역(Zone) 관리 (Phase 1)
//
//  기능
//   1) 창고 등록 (이름·주소·총면적·도면 이미지)
//   2) 도면 위에 마우스 드래그로 zone 분할 (사각형 그리기)
//   3) Zone 속성: 이름·면적·유형(자체/타사위탁/임대) + 화주·임차인 연결
//   4) 점유율 시각화 + 색상 구분
//   5) 후속 모듈 (thirdparty, warehouse_rental) 의 zone 선택지 제공
//
//  데이터 키
//   erp_warehouses → [{
//     id, name, address, totalArea (m²), imageData, imgW, imgH,
//     zones: [{
//       id, name, area (m²), type: 'self'|'thirdparty'|'rented'|'free',
//       color, ownerId?, rentalId?,
//       rect: { x, y, w, h }   // % 단위 (도면 위 위치)
//     }]
//   }]
//
//  공개 API: window.warehouseMaster
// =====================================================
(function() {
  'use strict';

  const KEY = 'erp_warehouses';
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(KEY), 800);
  }

  // ── 헬퍼 ────────────────────────────────────────
  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }
  function _ea(v) { return (typeof escapeAttr === 'function') ? escapeAttr(v) : String(v||'').replace(/['"&]/g,''); }
  function _fmt(n) { return Number(n||0).toLocaleString('ko-KR'); }

  const ZONE_TYPES = {
    self:        { label: '자체 사용',  color: '#1565c0', icon: '🏭' },
    thirdparty:  { label: '타사 위탁',  color: '#7b1fa2', icon: '🤝' },
    rented:      { label: '임대',       color: '#27ae60', icon: '🏘️' },
    free:        { label: '비어있음',   color: '#999',    icon: '⬜' }
  };

  // ── 데이터 로드/저장 ──────────────────────────────
  let warehouses = [];
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      warehouses = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(warehouses)) warehouses = [];
    } catch (e) {
      console.error('[warehouse] load 실패', e);
      warehouses = [];
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(warehouses));
    } catch (e) {
      console.error('[warehouse] save 실패', e);
      // 도면 이미지가 너무 클 가능성 — 안내
      if (e.name === 'QuotaExceededError' || /quota/i.test(e.message||'')) {
        if (typeof setBanner === 'function')
          setBanner('err', '⚠️ 저장 공간 부족 — 도면 이미지를 작게 (압축 또는 1MB 이하) 줄여주세요.');
      } else if (typeof setBanner === 'function') {
        setBanner('err', '❌ 창고 저장 실패: ' + (e.message||''));
      }
      throw e;
    }
  }

  function _genId(prefix) {
    return (prefix || 'WH') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,5);
  }

  // ── CRUD ────────────────────────────────────────
  function list() { return warehouses.slice(); }
  function get(id) { return warehouses.find(w => w.id === id); }

  function add(data) {
    const w = {
      id: data.id || _genId('WH'),
      name: data.name || '신규 창고',
      address: data.address || '',
      totalArea: Number(data.totalArea) || 0,
      imageData: data.imageData || null,
      imgW: data.imgW || 0,
      imgH: data.imgH || 0,
      zones: Array.isArray(data.zones) ? data.zones : [],
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      _ts: Date.now()
    };
    warehouses.push(w);
    save();
    return w;
  }

  function update(id, patch) {
    const i = warehouses.findIndex(w => w.id === id);
    if (i < 0) return null;
    warehouses[i] = { ...warehouses[i], ...patch, _ts: Date.now() };
    save();
    return warehouses[i];
  }

  function remove(id) {
    const i = warehouses.findIndex(w => w.id === id);
    if (i < 0) return false;
    warehouses.splice(i, 1);
    save();
    return true;
  }

  // ── Zone CRUD ───────────────────────────────────
  function addZone(warehouseId, zone) {
    const w = get(warehouseId);
    if (!w) return null;
    const z = {
      id: _genId('Z'),
      name: zone.name || '신규 구역',
      area: Number(zone.area) || 0,
      type: zone.type || 'free',
      color: zone.color || ZONE_TYPES[zone.type||'free'].color,
      ownerId: zone.ownerId || null,
      rentalId: zone.rentalId || null,
      rect: zone.rect || { x: 0, y: 0, w: 20, h: 20 },
      notes: zone.notes || ''
    };
    w.zones = w.zones || [];
    w.zones.push(z);
    save();
    return z;
  }

  function updateZone(warehouseId, zoneId, patch) {
    const w = get(warehouseId);
    if (!w) return null;
    const z = (w.zones||[]).find(x => x.id === zoneId);
    if (!z) return null;
    Object.assign(z, patch);
    if (patch.type && !patch.color) z.color = ZONE_TYPES[patch.type].color;
    save();
    return z;
  }

  function removeZone(warehouseId, zoneId) {
    const w = get(warehouseId);
    if (!w) return false;
    w.zones = (w.zones||[]).filter(z => z.id !== zoneId);
    save();
    return true;
  }

  // ── 점유율 계산 ──────────────────────────────────
  function occupancy(warehouseId) {
    const w = get(warehouseId);
    if (!w) return null;
    const total = Number(w.totalArea) || 0;
    const used = (w.zones||[]).reduce((s, z) => {
      if (z.type === 'free') return s;
      return s + (Number(z.area) || 0);
    }, 0);
    const byType = { self:0, thirdparty:0, rented:0, free:Math.max(0, total-used) };
    (w.zones||[]).forEach(z => {
      byType[z.type] = (byType[z.type]||0) + (Number(z.area)||0);
    });
    return {
      total, used,
      free: Math.max(0, total - used),
      pct: total > 0 ? (used/total*100).toFixed(1) : 0,
      byType
    };
  }

  // ── 이미지 압축 (도면 업로드 시) ─────────────────
  //   localStorage 5MB 한계 대응 — 최대 1280px 너비 + JPEG 0.7
  function _compressImage(file, maxWidth) {
    return new Promise((resolve, reject) => {
      maxWidth = maxWidth || 1280;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
          const canvas = document.createElement('canvas');
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // JPEG 압축 (도면은 단색이 많아 JPEG도 충분)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve({ dataUrl, w: canvas.width, h: canvas.height });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  //  UI
  // ============================================================
  function _injectUI() {
    if (document.getElementById('erp-wh-modal')) return;
    const css = `
      #erp-wh-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9500;display:none;align-items:flex-start;justify-content:center;padding-top:2vh;}
      #erp-wh-modal.open{display:flex;}
      .wh-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:97%;max-width:1200px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;}
      .wh-hd{padding:14px 20px;background:linear-gradient(135deg,#5d4037,#8d6e63);color:#fff;display:flex;justify-content:space-between;align-items:center;}
      .wh-bd{flex:1;overflow-y:auto;padding:18px;background:#fafafa;}
      .wh-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;}
      .wh-stat{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
      .wh-stat-l{font-size:0.74em;color:#666;font-weight:700;text-transform:uppercase;}
      .wh-stat-v{font-size:1.4em;font-weight:900;color:#1a1a2e;line-height:1.1;margin-top:2px;}

      .wh-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
      .wh-card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.08);overflow:hidden;cursor:pointer;transition:transform .12s,box-shadow .12s;}
      .wh-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.12);}
      .wh-card-thumb{height:140px;background:#eee;display:flex;align-items:center;justify-content:center;color:#888;font-size:2em;}
      .wh-card-thumb img{width:100%;height:100%;object-fit:cover;}
      .wh-card-bd{padding:10px 12px;}
      .wh-card-bd h3{margin:0 0 4px;font-size:1em;color:#1a1a2e;}
      .wh-card-bd .addr{font-size:0.78em;color:#888;margin-bottom:6px;}
      .wh-card-bd .occ-bar{height:6px;background:#eee;border-radius:3px;overflow:hidden;margin:4px 0;}
      .wh-card-bd .occ-fill{height:100%;background:linear-gradient(90deg,#1565c0,#7b1fa2,#27ae60);}

      /* 편집 캔버스 */
      .wh-editor-row{display:grid;grid-template-columns:2fr 1fr;gap:14px;}
      .wh-canvas-wrap{background:#1a1a2e;border-radius:8px;padding:8px;position:relative;min-height:400px;}
      #wh-canvas-bg{position:relative;display:inline-block;width:100%;}
      #wh-canvas-bg img{display:block;width:100%;height:auto;border-radius:4px;user-select:none;-webkit-user-drag:none;}
      .wh-zone-rect{position:absolute;border:2.5px solid #fff;background:rgba(0,0,0,0.25);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,0.6);transition:background .1s;font-size:0.86em;user-select:none;}
      .wh-zone-rect:hover{background:rgba(0,0,0,0.45);}
      .wh-zone-rect.selected{outline:3px solid #ffd700;outline-offset:2px;z-index:10;cursor:move;}
      .wh-zone-rect.selected:active{cursor:grabbing;}
      .wh-zone-rect .lbl{padding:3px 8px;border-radius:4px;background:rgba(0,0,0,0.5);font-size:0.78em;}
      .wh-zone-handle{position:absolute;width:10px;height:10px;background:#ffd700;border:1.5px solid #1a1a2e;border-radius:50%;cursor:nwse-resize;}
      .wh-zone-handle.br{right:-5px;bottom:-5px;}
      .wh-draft-rect{position:absolute;border:3px dashed #ffd700;background:rgba(255,215,0,0.15);pointer-events:none;}

      .wh-zone-list{background:#fff;border-radius:8px;padding:12px;}
      .wh-zone-item{padding:8px 10px;border-radius:6px;border-left:4px solid #ccc;background:#fafafa;margin-bottom:6px;cursor:pointer;font-size:0.86em;transition:transform .12s,box-shadow .12s;}
      .wh-zone-item:hover{transform:translateX(2px);box-shadow:0 1px 4px rgba(0,0,0,0.1);}
      .wh-zone-item.selected{background:#fffde7;border-left-color:#f9a825;}
      .wh-zone-item .name{font-weight:700;color:#1a1a2e;}
      .wh-zone-item .meta{font-size:0.78em;color:#666;margin-top:2px;}
      /* ★ floating zone editor popup */
      #wh-zone-edit-popup{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9700;display:none;align-items:center;justify-content:center;}
      #wh-zone-edit-popup.open{display:flex;}
      .wh-zone-edit-box{background:#fff;border-radius:12px;box-shadow:0 16px 60px rgba(0,0,0,0.35);width:520px;max-width:94vw;max-height:90vh;overflow-y:auto;}
      .wh-zone-edit-hd{padding:12px 16px;background:linear-gradient(135deg,#5d4037,#8d6e63);color:#fff;display:flex;justify-content:space-between;align-items:center;border-radius:12px 12px 0 0;}
      .wh-zone-edit-bd{padding:14px 16px;}

      .wh-form{display:grid;gap:10px;}
      .wh-form label{display:block;font-size:0.82em;color:#666;font-weight:700;margin-bottom:3px;}
      .wh-form input, .wh-form select, .wh-form textarea{width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88em;box-sizing:border-box;}

      .wh-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .wh-btn-primary{background:#5d4037;color:#fff;}
      .wh-btn-success{background:#27ae60;color:#fff;}
      .wh-btn-danger{background:#c62828;color:#fff;}
      .wh-btn-ghost{background:#fff;color:#444;border:1.5px solid #ccc;}
      .wh-btn-warn{background:#e65100;color:#fff;}

      .wh-help{background:#e3f2fd;color:#1565c0;padding:8px 12px;border-radius:6px;font-size:0.84em;line-height:1.5;}
    `;
    const style = document.createElement('style');
    style.id = 'erp-wh-style'; style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'erp-wh-modal';
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.innerHTML = `
      <div class="wh-box">
        <div class="wh-hd">
          <h4 style="margin:0;font-size:1.05em;font-weight:700;">📐 창고 마스터 — 도면·구역 관리</h4>
          <div>
            <button class="wh-btn wh-btn-ghost" data-act="wh-new">➕ 새 창고</button>
            <button class="wh-btn wh-btn-ghost" onclick="document.getElementById('erp-wh-modal').classList.remove('open')">✕</button>
          </div>
        </div>
        <div class="wh-bd" id="wh-bd"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', _onModalClick);

    // ★ zone 편집 popup (별도 modal) — 클릭 시 표시
    const popup = document.createElement('div');
    popup.id = 'wh-zone-edit-popup';
    popup.onclick = e => { if (e.target === popup) _closeZonePopup(); };
    popup.innerHTML = `
      <div class="wh-zone-edit-box">
        <div class="wh-zone-edit-hd">
          <h4 style="margin:0;font-size:1em;font-weight:700;">⚙️ 구역 편집</h4>
          <button class="wh-btn wh-btn-ghost" data-act="wh-zone-close" style="background:transparent;color:#fff;">✕</button>
        </div>
        <div class="wh-zone-edit-bd" id="wh-zone-edit-bd"></div>
      </div>`;
    document.body.appendChild(popup);
    popup.addEventListener('click', _onModalClick);
  }

  // zone 편집 popup 표시/숨김
  function _openZonePopup(zoneId) {
    const w = get(_curWarehouseId);
    if (!w) return;
    const z = (w.zones||[]).find(x => x.id === zoneId);
    if (!z) return;
    _selectedZoneId = zoneId;
    const popup = document.getElementById('wh-zone-edit-popup');
    const bd = document.getElementById('wh-zone-edit-bd');
    if (popup && bd) {
      bd.innerHTML = _renderZoneEditor(z);
      popup.classList.add('open');
      setTimeout(() => {
        const nameEl = document.getElementById('zn-name');
        if (nameEl) { nameEl.focus(); nameEl.select(); }
      }, 30);
    }
    // 도면 위 선택 표시도 갱신
    _renderEdit(_curWarehouseId);
  }
  function _closeZonePopup() {
    const popup = document.getElementById('wh-zone-edit-popup');
    if (popup) popup.classList.remove('open');
  }

  // ── 화면: 창고 목록 ─────────────────────────────
  let _curView = 'list';   // 'list' | 'edit'
  let _curWarehouseId = null;
  let _selectedZoneId = null;

  function _renderList() {
    _curView = 'list';
    const total = warehouses.length;
    const totalArea = warehouses.reduce((s,w) => s + (Number(w.totalArea)||0), 0);
    const totalZones = warehouses.reduce((s,w) => s + (w.zones||[]).length, 0);
    const usedArea = warehouses.reduce((s,w) => {
      const occ = occupancy(w.id);
      return s + (occ ? occ.used : 0);
    }, 0);

    const html = `
      <div class="wh-stats">
        <div class="wh-stat"><div class="wh-stat-l">등록 창고</div><div class="wh-stat-v">${total}</div></div>
        <div class="wh-stat"><div class="wh-stat-l">총 면적</div><div class="wh-stat-v">${_fmt(totalArea)}m²</div></div>
        <div class="wh-stat"><div class="wh-stat-l">분할 구역</div><div class="wh-stat-v">${totalZones}</div></div>
        <div class="wh-stat"><div class="wh-stat-l">평균 점유율</div><div class="wh-stat-v">${totalArea>0?(usedArea/totalArea*100).toFixed(1):0}%</div></div>
      </div>
      <div style="margin-bottom:8px;">
        <button class="wh-btn wh-btn-primary" data-act="wh-new">➕ 새 창고 등록</button>
      </div>
      ${total === 0
        ? '<div style="background:#fff;padding:40px;border-radius:10px;text-align:center;color:#888;">등록된 창고가 없습니다. 위 버튼을 클릭해 시작하세요.</div>'
        : `<div class="wh-list">${warehouses.map(w => _renderCard(w)).join('')}</div>`}
    `;
    document.getElementById('wh-bd').innerHTML = html;
  }

  function _renderCard(w) {
    const occ = occupancy(w.id);
    const types = Object.entries(occ.byType).filter(([,v]) => v > 0)
      .map(([k,v]) => `<span style="color:${ZONE_TYPES[k].color};">${ZONE_TYPES[k].icon} ${ZONE_TYPES[k].label} ${_fmt(v)}m²</span>`)
      .join(' · ');
    return `<div class="wh-card" data-act="wh-edit" data-id="${_ea(w.id)}">
      <div class="wh-card-thumb">
        ${w.imageData ? `<img src="${_ea(w.imageData)}" alt="${_ea(w.name)}">` : '🏭'}
      </div>
      <div class="wh-card-bd">
        <h3>${_e(w.name)}</h3>
        <div class="addr">${_e(w.address || '주소 미입력')}</div>
        <div style="display:flex;justify-content:space-between;font-size:0.82em;margin-bottom:4px;">
          <span>${_fmt(w.totalArea)}m² · ${(w.zones||[]).length}구역</span>
          <strong style="color:#5d4037;">${occ.pct}%</strong>
        </div>
        <div class="occ-bar"><div class="occ-fill" style="width:${occ.pct}%;"></div></div>
        <div style="font-size:0.74em;color:#888;margin-top:4px;">${types || '구역 미등록'}</div>
      </div>
    </div>`;
  }

  // ── 화면: 창고 편집 (도면 + zone) ─────────────────
  //   ★ BUG FIX: 같은 창고 안에서 zone 선택 후 _renderEdit 재호출 시 selection 유지
  //     이전엔 무조건 null 로 리셋해서 zone 편집기가 표시되지 않던 문제 해결.
  function _renderEdit(id) {
    _curView = 'edit';
    // 다른 창고로 이동 시에만 zone 선택 초기화
    if (_curWarehouseId !== id) {
      _selectedZoneId = null;
    }
    _curWarehouseId = id;
    const w = id ? get(id) : { id: null, name: '', address: '', totalArea: 0, imageData: null, zones: [] };
    if (id && !w) { _renderList(); return; }
    // 선택된 zone 이 현재 창고에 존재하지 않으면 초기화 (방어적)
    if (_selectedZoneId && !(w.zones||[]).find(z => z.id === _selectedZoneId)) {
      _selectedZoneId = null;
    }

    const occ = id ? occupancy(id) : { total:0, used:0, free:0, pct:0, byType:{self:0,thirdparty:0,rented:0,free:0} };

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;color:#5d4037;">${id ? '창고 편집' : '새 창고 등록'}${w.name ? ' · '+_e(w.name) : ''}</h3>
        <div>
          <button class="wh-btn wh-btn-ghost" data-act="wh-back">← 목록</button>
          ${id ? `<button class="wh-btn wh-btn-danger" data-act="wh-delete" data-id="${_ea(id)}">🗑 삭제</button>` : ''}
          <button class="wh-btn wh-btn-primary" data-act="wh-save" data-id="${_ea(id||'')}">💾 ${id ? '저장' : '생성'}</button>
        </div>
      </div>

      <div class="wh-form" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;background:#fff;padding:14px;border-radius:8px;margin-bottom:14px;">
        <div><label>창고명 *</label><input id="wh-name" value="${_ea(w.name)}" placeholder="3공장 SIDE1동"></div>
        <div><label>총 면적 (m²)</label><input id="wh-area" type="number" value="${w.totalArea||0}"></div>
        <div><label>주소</label><input id="wh-addr" value="${_ea(w.address)}" placeholder="경기도..."></div>
        <div style="grid-column:span 3;">
          <label>도면 이미지 업로드 (JPG/PNG, 자동 압축)</label>
          <input id="wh-img" type="file" accept="image/*" onchange="window.warehouseMaster._handleImageUpload(this)">
          <div style="font-size:0.78em;color:#888;margin-top:3px;">최대 1280px 너비로 자동 압축 · 도면이 없으면 빈 격자 위에 zone을 그릴 수 있습니다.</div>
        </div>
      </div>

      ${id ? `
        <div class="wh-stats" style="margin-bottom:14px;">
          <div class="wh-stat"><div class="wh-stat-l">총 면적</div><div class="wh-stat-v">${_fmt(occ.total)}m²</div></div>
          <div class="wh-stat"><div class="wh-stat-l">사용 면적</div><div class="wh-stat-v" style="color:#5d4037;">${_fmt(occ.used)}m²</div></div>
          <div class="wh-stat"><div class="wh-stat-l">여유 면적</div><div class="wh-stat-v" style="color:#27ae60;">${_fmt(occ.free)}m²</div></div>
          <div class="wh-stat"><div class="wh-stat-l">점유율</div><div class="wh-stat-v">${occ.pct}%</div></div>
        </div>
      ` : ''}

      <div class="wh-help">
        💡 <strong>구역(Zone) 그리기:</strong> 도면 위에서 <strong>마우스를 클릭+드래그</strong>하면 사각형이 생성됩니다. <strong>구역 이름과 유형</strong>(자체/타사/임대)을 지정할 수 있습니다.
      </div>

      <div class="wh-editor-row" style="margin-top:12px;">
        <div class="wh-canvas-wrap" id="wh-canvas-wrap">
          ${_renderCanvas(w)}
        </div>
        <div class="wh-zone-list" id="wh-zone-list">
          ${_renderZoneList(w)}
        </div>
      </div>
    `;
    document.getElementById('wh-bd').innerHTML = html;
    setTimeout(_bindCanvas, 50);
  }

  function _renderCanvas(w) {
    const hasImage = !!w.imageData;
    const zonesHtml = (w.zones||[]).map(z => _renderZoneRect(z, w)).join('');
    return `<div id="wh-canvas-bg" style="${hasImage?'':'min-height:400px;background:repeating-linear-gradient(45deg,#2c2c4e,#2c2c4e 14px,#1a1a2e 14px,#1a1a2e 28px);'}">
      ${hasImage ? `<img src="${_ea(w.imageData)}" alt="${_ea(w.name)}" id="wh-canvas-img">` : `<div style="position:relative;width:100%;height:400px;display:flex;align-items:center;justify-content:center;color:#888;">📐 도면을 업로드하면 여기에 표시됩니다 (없어도 빈 격자에 구역 그리기 가능)</div>`}
      <div id="wh-zones-layer" style="position:absolute;top:0;left:0;width:100%;height:100%;">
        ${zonesHtml}
      </div>
    </div>`;
  }

  function _renderZoneRect(z, w) {
    const r = z.rect || { x:0, y:0, w:20, h:20 };
    const isSel = z.id === _selectedZoneId;
    const meta = ZONE_TYPES[z.type] || ZONE_TYPES.free;
    return `<div class="wh-zone-rect ${isSel?'selected':''}" data-zone-id="${_ea(z.id)}" data-act="wh-zone-select"
      style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%;background:${meta.color}66;border-color:${meta.color};">
      <div class="lbl">${meta.icon} ${_e(z.name)}<br><span style="font-size:0.86em;opacity:0.9;">${_fmt(z.area)}m²</span></div>
      ${isSel ? '<div class="wh-zone-handle br" data-act="wh-zone-resize"></div>' : ''}
    </div>`;
  }

  function _renderZoneList(w) {
    const zones = w.zones || [];
    if (!zones.length) {
      return '<div style="color:#bbb;text-align:center;padding:40px 10px;font-size:0.88em;">구역이 없습니다.<br>도면을 드래그하여 그리세요.</div>';
    }
    return `<h4 style="margin:0 0 8px;font-size:0.92em;color:#1a1a2e;">분할 구역 (${zones.length}) <span style="font-size:0.74em;font-weight:400;color:#888;">— 클릭해서 편집</span></h4>
      ${zones.map(z => {
        const meta = ZONE_TYPES[z.type];
        const isSel = z.id === _selectedZoneId;
        return `<div class="wh-zone-item ${isSel?'selected':''}" data-zone-id="${_ea(z.id)}" data-act="wh-zone-select"
          style="border-left-color:${meta.color};">
          <div class="name">${meta.icon} ${_e(z.name)}</div>
          <div class="meta">${meta.label} · ${_fmt(z.area)}m²</div>
        </div>`;
      }).join('')}
      <!-- ★ 인라인 zone editor 제거 — 클릭 시 floating popup 으로 표시 -->
    `;
  }

  function _renderZoneEditor(z) {
    if (!z) return '';
    const r = z.rect || { x: 0, y: 0, w: 20, h: 20 };
    const meta = ZONE_TYPES[z.type] || ZONE_TYPES.free;
    return `<div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h4 style="margin:0;font-size:0.92em;color:#5d4037;">⚙️ 구역 편집 <span style="display:inline-block;width:12px;height:12px;background:${meta.color};border-radius:3px;vertical-align:middle;margin-left:4px;"></span></h4>
        <button class="wh-btn wh-btn-danger" data-act="wh-zone-delete" style="padding:5px 10px;font-size:0.78em;">🗑 구역 삭제</button>
      </div>
      <div class="wh-form">
        <div><label>이름 *</label><input id="zn-name" value="${_ea(z.name)}" placeholder="A-1구역"></div>
        <div><label>유형 *</label><select id="zn-type">
          ${Object.entries(ZONE_TYPES).map(([k,v]) => `<option value="${k}" ${k===z.type?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
        </select></div>
        <div><label>면적 (m²)</label><input id="zn-area" type="number" value="${z.area||0}"></div>
        <div><label>비고</label><input id="zn-notes" value="${_e(z.notes||'')}"></div>
      </div>

      <h4 style="margin:12px 0 6px;font-size:0.86em;color:#1565c0;">📍 위치 · 크기 (% 단위, 도면 기준)</h4>
      <div class="wh-form" style="grid-template-columns:1fr 1fr 1fr 1fr;">
        <div><label>X (가로 위치)</label><input id="zn-x" type="number" step="0.1" min="0" max="100" value="${(r.x||0).toFixed(1)}"></div>
        <div><label>Y (세로 위치)</label><input id="zn-y" type="number" step="0.1" min="0" max="100" value="${(r.y||0).toFixed(1)}"></div>
        <div><label>W (너비)</label><input id="zn-w" type="number" step="0.1" min="2" max="100" value="${(r.w||20).toFixed(1)}"></div>
        <div><label>H (높이)</label><input id="zn-h" type="number" step="0.1" min="2" max="100" value="${(r.h||20).toFixed(1)}"></div>
      </div>
      <div style="font-size:0.76em;color:#888;margin:4px 0 8px;">
        💡 도면 위에서 <strong>구역을 드래그하면 이동</strong>, 우하단 <strong>노란 점을 드래그하면 크기 변경</strong>됩니다. 정확한 위치는 위 입력창으로 조정 가능.
      </div>

      <div style="display:flex;gap:6px;margin-top:10px;">
        <button class="wh-btn wh-btn-success" style="flex:1;" data-act="wh-zone-update">💾 적용 (이름·유형·위치·크기 저장)</button>
      </div>
    </div>`;
  }

  // ── 캔버스 이벤트 (드래그로 zone 그리기) ──────────
  let _dragState = null;

  function _bindCanvas() {
    const wrap = document.getElementById('wh-canvas-wrap');
    if (!wrap) return;
    const bg = document.getElementById('wh-canvas-bg');
    if (!bg) return;

    bg.addEventListener('mousedown', _onCanvasMouseDown);
    bg.addEventListener('mousemove', _onCanvasMouseMove);
    document.addEventListener('mouseup', _onCanvasMouseUp);
  }

  function _getRel(e, bg) {
    const rect = bg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // 도면 영역 안으로 제한 (드래그가 캔버스 밖으로 나가도 안전)
    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y))
    };
  }

  function _onCanvasMouseDown(e) {
    if (e.target.closest('.wh-zone-rect')) {
      const rect = e.target.closest('.wh-zone-rect');
      const zoneId = rect.getAttribute('data-zone-id');
      // 리사이즈 핸들 드래그 = 크기 변경 모드
      if (e.target.classList.contains('wh-zone-handle')) {
        _dragState = { mode: 'resize', zoneId, startX: 0, startY: 0 };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // zone 본체 드래그 = 이동 모드 (선택된 zone 만)
      const wh = get(_curWarehouseId);
      const z = (wh?.zones || []).find(x => x.id === zoneId);
      if (z && z.id === _selectedZoneId) {
        const bg = document.getElementById('wh-canvas-bg');
        const rel = _getRel(e, bg);
        _dragState = {
          mode: 'move',
          zoneId,
          // 드래그 시작 시 zone 의 좌표와 마우스의 차이를 기억 (offset)
          offsetX: rel.x - (z.rect?.x || 0),
          offsetY: rel.y - (z.rect?.y || 0),
          moved: false
        };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // 미선택 zone — 클릭 처리 (선택)는 handler 가 처리
      return;
    }
    const bg = document.getElementById('wh-canvas-bg');
    const rel = _getRel(e, bg);
    _dragState = { mode: 'create', startX: rel.x, startY: rel.y };
    // draft rect
    let draft = document.getElementById('wh-draft');
    if (!draft) {
      draft = document.createElement('div');
      draft.id = 'wh-draft';
      draft.className = 'wh-draft-rect';
      bg.appendChild(draft);
    }
    draft.style.left = rel.x + '%';
    draft.style.top = rel.y + '%';
    draft.style.width = '0';
    draft.style.height = '0';
    draft.style.display = 'block';
    e.preventDefault();
  }

  function _onCanvasMouseMove(e) {
    if (!_dragState) return;
    const bg = document.getElementById('wh-canvas-bg');
    const rel = _getRel(e, bg);
    if (_dragState.mode === 'create') {
      const x = Math.min(_dragState.startX, rel.x);
      const y = Math.min(_dragState.startY, rel.y);
      const w = Math.abs(rel.x - _dragState.startX);
      const h = Math.abs(rel.y - _dragState.startY);
      const draft = document.getElementById('wh-draft');
      if (draft) {
        draft.style.left = x + '%';
        draft.style.top = y + '%';
        draft.style.width = w + '%';
        draft.style.height = h + '%';
      }
    } else if (_dragState.mode === 'resize' && _dragState.zoneId) {
      const w = get(_curWarehouseId);
      const z = (w?.zones||[]).find(z => z.id === _dragState.zoneId);
      if (z && z.rect) {
        z.rect.w = Math.max(2, Math.min(100 - z.rect.x, rel.x - z.rect.x));
        z.rect.h = Math.max(2, Math.min(100 - z.rect.y, rel.y - z.rect.y));
        const rect = document.querySelector(`.wh-zone-rect[data-zone-id="${z.id}"]`);
        if (rect) {
          rect.style.width = z.rect.w + '%';
          rect.style.height = z.rect.h + '%';
        }
        // ★ 편집 폼 입력 필드 실시간 동기화
        const wEl = document.getElementById('zn-w');
        const hEl = document.getElementById('zn-h');
        if (wEl) wEl.value = z.rect.w.toFixed(1);
        if (hEl) hEl.value = z.rect.h.toFixed(1);
        // 면적 자동 추정 (도면 비율 기준)
        const wh = get(_curWarehouseId);
        const totalArea = Number(wh?.totalArea) || 0;
        if (totalArea > 0) {
          const estArea = Math.round(totalArea * (z.rect.w * z.rect.h / 10000));
          const aEl = document.getElementById('zn-area');
          if (aEl) aEl.value = estArea;
          z.area = estArea;
        }
      }
    } else if (_dragState.mode === 'move' && _dragState.zoneId) {
      const w = get(_curWarehouseId);
      const z = (w?.zones||[]).find(z => z.id === _dragState.zoneId);
      if (z && z.rect) {
        // 새 위치 = 마우스 위치 - 드래그 시작 시의 offset
        let newX = rel.x - _dragState.offsetX;
        let newY = rel.y - _dragState.offsetY;
        // 화면 안으로 제한
        newX = Math.max(0, Math.min(100 - z.rect.w, newX));
        newY = Math.max(0, Math.min(100 - z.rect.h, newY));
        z.rect.x = newX;
        z.rect.y = newY;
        _dragState.moved = true;
        const rect = document.querySelector(`.wh-zone-rect[data-zone-id="${z.id}"]`);
        if (rect) {
          rect.style.left = newX + '%';
          rect.style.top = newY + '%';
        }
        // ★ 편집 폼 입력 필드 실시간 동기화
        const xEl = document.getElementById('zn-x');
        const yEl = document.getElementById('zn-y');
        if (xEl) xEl.value = newX.toFixed(1);
        if (yEl) yEl.value = newY.toFixed(1);
      }
    }
  }

  function _onCanvasMouseUp(e) {
    if (!_dragState) return;
    if (_dragState.mode === 'create') {
      const draft = document.getElementById('wh-draft');
      if (draft) {
        const x = parseFloat(draft.style.left);
        const y = parseFloat(draft.style.top);
        const w = parseFloat(draft.style.width);
        const h = parseFloat(draft.style.height);
        if (w > 2 && h > 2) {
          // 새 zone 생성
          if (!_curWarehouseId) {
            alert('창고를 먼저 저장한 후 zone을 그릴 수 있습니다.');
          } else {
            const wh = get(_curWarehouseId);
            const totalArea = Number(wh?.totalArea) || 0;
            // 면적 추정 — 비율로 계산
            const estArea = totalArea > 0 ? Math.round(totalArea * (w * h / 10000)) : 0;
            const z = addZone(_curWarehouseId, {
              name: `구역 ${(wh.zones||[]).length + 1}`,
              area: estArea,
              type: 'free',
              rect: { x, y, w, h }
            });
            _selectedZoneId = z.id;
            if (typeof setBanner === 'function') setBanner('ok', `✅ 새 구역 "${z.name}" 추가 — 우측에서 이름·유형 변경`);
            _renderEdit(_curWarehouseId);
          }
        }
        draft.remove();
      }
    } else if (_dragState.mode === 'resize') {
      save();
      _renderEdit(_curWarehouseId);
    } else if (_dragState.mode === 'move') {
      if (_dragState.moved) {
        save();
        _renderEdit(_curWarehouseId);
      }
    }
    _dragState = null;
  }

  // ── 이미지 업로드 ────────────────────────────────
  async function _handleImageUpload(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능합니다.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      if (!confirm('파일이 10MB 이상입니다. 업로드하시겠습니까? (자동 압축됨)')) return;
    }
    try {
      const result = await _compressImage(file, 1280);
      // 임시 메모리에 저장 — 저장 버튼 누를 때 실제 적용
      window._whTempImage = result;
      // 미리보기
      const bg = document.getElementById('wh-canvas-bg');
      if (bg) {
        let img = bg.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          bg.insertBefore(img, bg.firstChild);
        }
        img.src = result.dataUrl;
        // 빈 격자 배경 제거
        bg.style.background = '';
        bg.style.minHeight = '';
        // 안내 텍스트 제거
        const hint = bg.querySelector('div[style*="display:flex;align-items:center"]');
        if (hint) hint.remove();
      }
      if (typeof setBanner === 'function')
        setBanner('ok', `📐 도면 압축 완료 — ${result.w}×${result.h}px`);
    } catch (err) {
      alert('이미지 처리 실패: ' + err.message);
    }
  }

  function _saveFromForm(id) {
    const name = document.getElementById('wh-name').value.trim();
    if (!name) { alert('창고명 입력 필요'); return; }
    const data = {
      name,
      address: document.getElementById('wh-addr').value.trim(),
      totalArea: Number(document.getElementById('wh-area').value) || 0
    };
    if (window._whTempImage) {
      data.imageData = window._whTempImage.dataUrl;
      data.imgW = window._whTempImage.w;
      data.imgH = window._whTempImage.h;
      window._whTempImage = null;
    }
    try {
      if (id) {
        update(id, data);
        if (typeof setBanner === 'function') setBanner('ok', `✅ 창고 ${name} 저장됨`);
      } else {
        const w = add(data);
        _curWarehouseId = w.id;
        if (typeof setBanner === 'function') setBanner('ok', `✅ 창고 ${name} 등록 완료`);
        _renderEdit(w.id);
        return;
      }
      _renderEdit(id);
    } catch (err) {
      // 저장 실패 (quota 등) — 사용자에게 안내됨
    }
  }

  function _updateZoneFromForm() {
    if (!_selectedZoneId || !_curWarehouseId) return;
    const nameEl = document.getElementById('zn-name');
    const typeEl = document.getElementById('zn-type');
    const areaEl = document.getElementById('zn-area');
    const notesEl = document.getElementById('zn-notes');
    const xEl = document.getElementById('zn-x');
    const yEl = document.getElementById('zn-y');
    const wEl = document.getElementById('zn-w');
    const hEl = document.getElementById('zn-h');
    if (!nameEl || !typeEl) {
      alert('편집 폼을 찾을 수 없습니다. 구역을 다시 선택해주세요.');
      return;
    }
    const name = (nameEl.value || '').trim();
    if (!name) { alert('구역 이름 입력 필요'); return; }

    // 위치·크기 파싱 (% 단위, 0~100 범위)
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const newRect = {
      x: clamp(Number(xEl?.value) || 0, 0, 100),
      y: clamp(Number(yEl?.value) || 0, 0, 100),
      w: clamp(Number(wEl?.value) || 20, 2, 100),
      h: clamp(Number(hEl?.value) || 20, 2, 100)
    };
    // 화면 밖으로 안 나가도록 보정
    if (newRect.x + newRect.w > 100) newRect.w = 100 - newRect.x;
    if (newRect.y + newRect.h > 100) newRect.h = 100 - newRect.y;

    const patch = {
      name,
      type: typeEl.value,
      area: Number(areaEl?.value) || 0,
      notes: (notesEl?.value || '').trim(),
      rect: newRect
    };
    updateZone(_curWarehouseId, _selectedZoneId, patch);
    if (typeof setBanner === 'function') setBanner('ok', `✅ 구역 "${name}" 저장됨 (${patch.type})`);
    _closeZonePopup();           // ★ 저장 후 popup 자동 닫기
    _renderEdit(_curWarehouseId);
  }

  function _deleteZone() {
    if (!_selectedZoneId || !_curWarehouseId) return;
    if (!confirm('이 구역을 삭제합니까?')) return;
    removeZone(_curWarehouseId, _selectedZoneId);
    _selectedZoneId = null;
    _closeZonePopup();           // ★ 삭제 후 popup 자동 닫기
    _renderEdit(_curWarehouseId);
  }

  function _onModalClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    const zoneId = btn.getAttribute('data-zone-id');

    if (act === 'wh-new') _renderEdit(null);
    else if (act === 'wh-back') _renderList();
    else if (act === 'wh-edit') _renderEdit(id);
    else if (act === 'wh-save') _saveFromForm(id || null);
    else if (act === 'wh-delete') {
      if (!confirm('창고와 모든 구역을 삭제합니까?')) return;
      remove(id);
      if (typeof setBanner === 'function') setBanner('ok', '🗑 창고 삭제');
      _renderList();
    }
    else if (act === 'wh-zone-select') {
      // ★ 구역 클릭 시 편집 popup 띄움
      _openZonePopup(zoneId);
    }
    else if (act === 'wh-zone-close') {
      _closeZonePopup();
    }
    else if (act === 'wh-zone-update') _updateZoneFromForm();
    else if (act === 'wh-zone-delete') _deleteZone();
  }

  function open() {
    _injectUI();
    document.getElementById('erp-wh-modal').classList.add('open');
    setTimeout(_renderList, 30);
  }
  function close() {
    document.getElementById('erp-wh-modal')?.classList.remove('open');
  }

  // ── 후속 모듈에 zone 선택지 제공 ─────────────────
  function getZonesByType(type) {
    const result = [];
    warehouses.forEach(w => {
      (w.zones||[]).forEach(z => {
        if (!type || z.type === type) {
          result.push({
            warehouseId: w.id,
            warehouseName: w.name,
            zoneId: z.id,
            zoneName: z.name,
            area: z.area,
            type: z.type,
            full: `${w.name} · ${z.name}`
          });
        }
      });
    });
    return result;
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    load();
    setTimeout(_injectUI, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.warehouseMaster = {
    list, get, add, update, remove,
    addZone, updateZone, removeZone,
    occupancy, getZonesByType,
    open, close, reload: load,
    types: ZONE_TYPES,
    _handleImageUpload
  };

  console.log('[ERP-WH] 창고 마스터 활성 — warehouseMaster.open()');
})();
