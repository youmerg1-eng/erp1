// =====================================================
//  TUTORIAL — 인터랙티브 온보딩 (Sprint 6 · #6)
//
//  3가지 트랙
//   1) 영업 담당자 (📋) — 수주 등록·출고지시서·견적서
//   2) 운영팀 (🏭) — 입고·재고·배차·반품
//   3) 관리자 (📊) — 대시보드·예측·권한·신용·백업
//
//  Spotlight 효과
//   - 현재 안내 요소만 강조 (clip-path or box-shadow)
//   - 나머지 어둡게 (overlay)
//   - 다음/이전/스킵 버튼
//   - 자동 스크롤 to target
//
//  진행률·스킵 옵션·재실행 가능
//  공개 API: window.erpTutorial
// =====================================================
(function() {
  'use strict';

  const STATE_KEY = 'erp_tutorial_state';
  if (typeof window.erpSafety !== 'undefined' && window.erpSafety.protect) {
    setTimeout(() => window.erpSafety.protect(STATE_KEY), 800);
  }

  function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v||'').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])); }

  function _loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{"completed":[]}'); }
    catch (e) { return { completed: [] }; }
  }
  function _saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function _markCompleted(track) {
    const s = _loadState();
    if (!s.completed.includes(track)) s.completed.push(track);
    s.lastCompletedAt = new Date().toISOString();
    _saveState(s);
  }

  // ── 트랙 정의 ────────────────────────────────────
  const TRACKS = {
    sales: {
      id: 'sales',
      label: '영업 담당자',
      icon: '📋',
      color: '#1565c0',
      desc: '수주 등록 → 출고지시서 → 견적서까지 영업 흐름',
      duration: '약 8분',
      steps: [
        {
          target: '.nav-sidebar', position: 'right',
          title: '환영합니다! 사이드바',
          body: '왼쪽 사이드바에서 모든 주요 기능에 접근합니다. 메인·판매·분석·문서·시스템 카테고리로 정리되어 있습니다.'
        },
        {
          target: 'button[onclick*="orders"]', position: 'right', click: false,
          title: '수주 현황 탭',
          body: '여기에서 모든 수주를 관리합니다. 클릭해보세요.',
          waitClick: true
        },
        {
          target: 'button[onclick="openNewOrderModal()"]', position: 'bottom', click: false,
          title: '➕ 수주 등록',
          body: '신규 수주는 이 버튼으로 추가합니다. 다량 발주는 위쪽 [📋 다량 발주 등록] 카드의 붙여넣기 영역을 이용하세요.'
        },
        {
          target: '#bulkOrderCard, [id*="bulk"]', position: 'bottom', optional: true,
          title: '📋 다량 발주 — 엑셀 붙여넣기',
          body: '엑셀에서 여러 행을 복사해 붙여넣으면 자동으로 30개 컬럼을 인식합니다. 카드를 펼쳐 textarea에 붙여넣어보세요.'
        },
        {
          target: 'button[onclick*="delivery"]', position: 'right', click: false,
          title: '출고지시서 탭',
          body: '계약금이 입금된 수주는 출고지시서를 발행할 수 있습니다.',
          waitClick: true
        },
        {
          target: '#tab-delivery .btn-green, button[onclick*="openDeliveryOrderModal"]', position: 'bottom', optional: true,
          title: '➕ 새 출고지시서',
          body: '출고지시서를 작성하면 자동으로 인쇄·PDF 양식이 생성됩니다.'
        },
        {
          target: '#erp-minibar', position: 'bottom', optional: true,
          title: '🛠 도구함 (우상단)',
          body: '계산기·검색·AI 등 자주 쓰는 도구가 모여있습니다. Alt+T로 빠른 액세스.'
        },
        {
          target: 'body', position: 'center',
          title: '📋 견적서 작성',
          body: '도구함 또는 콘솔에서 quotation.open()으로 견적서를 작성하세요.\n승인된 견적서는 1-클릭으로 수주현황에 자동 등록됩니다.',
          api: 'quotation.open'
        },
        {
          target: 'body', position: 'center',
          title: '🎉 완료!',
          body: '영업 담당자 기본 흐름을 익혔습니다.\n• 수주 등록 (단건/다량)\n• 출고지시서 발행\n• 견적서 → 수주 변환\n\n도움이 필요하면 콘솔에서 erpTutorial.open()으로 다시 시작할 수 있습니다.',
          final: true
        }
      ]
    },
    ops: {
      id: 'ops',
      label: '운영팀',
      icon: '🏭',
      color: '#e65100',
      desc: '입고·재고·배차·반품 운영 흐름',
      duration: '약 8분',
      steps: [
        {
          target: 'button[onclick*="inventory"]', position: 'right', click: false,
          title: '입고관리 탭',
          body: '실제 입고된 자재를 등록합니다.',
          waitClick: true
        },
        {
          target: 'body', position: 'center',
          title: '📦 가용재고(ATP) 도구',
          body: '대시보드의 "가용재고" 카드를 클릭하면 모델별 재고 현황을 볼 수 있습니다.\n현재 재고 - 출고 예정 - 안전재고 = ATP 가용량',
          api: 'atp.open'
        },
        {
          target: 'body', position: 'center',
          title: '🚛 배차/일정 보드',
          body: '여러 출고지시서를 한 트럭에 묶어 배차할 수 있습니다.\n5톤 장축은 보통 6~8 PLT까지 적재 가능.',
          api: 'dispatch.open'
        },
        {
          target: 'body', position: 'center',
          title: '↩️ 반품/RMA 처리',
          body: '고객사 반품(반품입고) 또는 매입사 반품(반품출고)을 등록합니다.\n반품을 inventoryData에 자동 반영해 재고 재계산됩니다.',
          api: 'returns.open'
        },
        {
          target: 'button[onclick*="stock"]', position: 'right', click: false,
          title: '재고관리 탭',
          body: '모델별 현재 재고와 입출고 이력을 한눈에 볼 수 있습니다.',
          waitClick: true
        },
        {
          target: 'body', position: 'center',
          title: '🎉 완료!',
          body: '운영팀 기본 흐름을 익혔습니다.\n• 입고 등록 + ATP 확인\n• 배차 묶음 + 분할출고\n• 반품 처리\n\n실제 데이터로 연습해보세요.',
          final: true
        }
      ]
    },
    admin: {
      id: 'admin',
      label: '관리자',
      icon: '📊',
      color: '#7b1fa2',
      desc: '대시보드·예측·권한·신용·백업·audit',
      duration: '약 12분',
      steps: [
        {
          target: 'button[onclick*="dashboard"]', position: 'right', click: false,
          title: '대시보드',
          body: '한눈에 전체 KPI와 위험 알림을 확인합니다. 카드를 클릭하면 해당 도구가 열립니다.'
        },
        {
          target: 'body', position: 'center',
          title: '📈 매출 예측',
          body: '과거 12개월 + 향후 6개월 매출 forecast.\n신뢰도 가중치(계약금 입금 여부)로 정확도를 높입니다.',
          api: 'erpForecast.open'
        },
        {
          target: 'body', position: 'center',
          title: '🚨 고객사 신용 분석',
          body: '한도 사용률·평균 입금 지연·정시율을 종합해 4단계 위험 등급을 자동 산정합니다.',
          api: 'erpCredit.open'
        },
        {
          target: 'body', position: 'center',
          title: '📅 출고 캘린더',
          body: '일별 출고량을 heatmap으로 시각화. 특정 날짜 클릭 시 해당일 상세 표시.',
          api: 'erpCalendar.open'
        },
        {
          target: 'button[onclick*="settings"]', position: 'right', click: false,
          title: '⚙️ 설정 탭',
          body: '권한 부여, audit log, 백업 등 관리자 전용 기능이 모여있습니다.',
          waitClick: true
        },
        {
          target: '#auth-section, #auth-admin-editor', position: 'top',
          title: '🔐 권한 부여',
          body: '시스템 관리자는 카테고리·탭 단위로 각 역할의 접근 권한을 변경할 수 있습니다.',
          optional: true
        },
        {
          target: '#auth-audit-section', position: 'top', optional: true,
          title: '🔍 권한 변경 이력 (Audit Log)',
          body: '누가 언제 어떤 권한을 변경했는지 모두 기록됩니다. CSV 다운로드도 가능합니다.'
        },
        {
          target: 'body', position: 'center',
          title: '💾 백업·복원',
          body: '모든 핵심 데이터는 자동 백업됩니다.\n콘솔: audit.list() / audit.undo() / backup.open()',
          api: 'backup.open'
        },
        {
          target: 'body', position: 'center',
          title: '🎉 완료!',
          body: '관리자 기본 흐름을 익혔습니다.\n• KPI 대시보드 + 매출 예측\n• 신용 위험 분석\n• 권한 부여 + audit log\n• 백업·복원\n\n실제 운영을 시작하기 전에 erpSetupV2.open()으로 셋업을 완료하세요.',
          final: true
        }
      ]
    }
  };

  // ── UI ──────────────────────────────────────────
  let _activeTrack = null;
  let _stepIdx = 0;
  let _currentTarget = null;

  function _injectUI() {
    if (document.getElementById('erp-tut-overlay')) return;
    const css = `
      #erp-tut-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9800;display:none;}
      #erp-tut-overlay.open{display:block;}
      #erp-tut-spotlight{position:absolute;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,0.7),0 0 24px rgba(255,255,255,0.5);transition:all .3s;pointer-events:none;}

      #erp-tut-tooltip{
        position:fixed;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.4);
        max-width:380px;padding:18px;z-index:9810;
      }
      .tut-h{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}
      .tut-h h3{margin:0;font-size:1.05em;color:#1a1a2e;flex:1;line-height:1.3;}
      .tut-track-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;}
      .tut-body{font-size:0.9em;line-height:1.6;color:#444;white-space:pre-line;}
      .tut-progress{display:flex;gap:3px;margin:14px 0 8px;}
      .tut-progress-pill{flex:1;height:4px;background:#e0e0e0;border-radius:2px;}
      .tut-progress-pill.done{background:#27ae60;}
      .tut-progress-pill.active{background:#1565c0;}
      .tut-ft{display:flex;justify-content:space-between;gap:6px;margin-top:8px;}
      .tut-btn{padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:0.84em;font-weight:700;}
      .tut-btn-primary{background:#1565c0;color:#fff;}
      .tut-btn-ghost{background:#fff;color:#666;border:1.5px solid #ccc;}
      .tut-btn-skip{background:transparent;color:#888;border:none;text-decoration:underline;font-size:0.78em;}

      /* 트랙 선택 모달 */
      #erp-tut-pick{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9750;display:none;align-items:center;justify-content:center;}
      #erp-tut-pick.open{display:flex;}
      .tut-pick-box{background:#fff;border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,0.4);width:96%;max-width:680px;padding:24px;}
      .tut-pick-h{font-size:1.3em;font-weight:800;color:#1a1a2e;margin-bottom:6px;}
      .tut-pick-desc{font-size:0.86em;color:#666;margin-bottom:18px;}
      .tut-tracks{display:grid;gap:10px;}
      .tut-track-card{
        background:linear-gradient(135deg,#fff,#f9f9f9);border:2px solid #e0e0e0;border-radius:10px;
        padding:16px;cursor:pointer;transition:all .15s;display:flex;gap:14px;align-items:center;
      }
      .tut-track-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,0.1);}
      .tut-track-card-icon{font-size:2.2em;flex-shrink:0;}
      .tut-track-card-meta{flex:1;}
      .tut-track-card-title{font-size:1.1em;font-weight:800;color:#1a1a2e;}
      .tut-track-card-desc{font-size:0.84em;color:#666;margin-top:3px;}
      .tut-track-card-meta-bar{font-size:0.78em;color:#888;margin-top:6px;}
      .tut-done-badge{background:#27ae60;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.74em;font-weight:700;}

      @media(max-width:700px){
        #erp-tut-tooltip{max-width:90%;left:5% !important;right:5% !important;}
      }
    `;
    const style = document.createElement('style');
    style.id = 'erp-tut-style'; style.textContent = css;
    document.head.appendChild(style);

    // 오버레이 + spotlight
    const overlay = document.createElement('div');
    overlay.id = 'erp-tut-overlay';
    overlay.innerHTML = '<div id="erp-tut-spotlight"></div>';
    document.body.appendChild(overlay);

    // 툴팁
    const tip = document.createElement('div');
    tip.id = 'erp-tut-tooltip';
    tip.style.display = 'none';
    document.body.appendChild(tip);

    // 트랙 선택 모달
    const pick = document.createElement('div');
    pick.id = 'erp-tut-pick';
    pick.onclick = e => { if (e.target === pick) closePicker(); };
    document.body.appendChild(pick);
  }

  // ── 트랙 선택 ────────────────────────────────────
  function openPicker() {
    _injectUI();
    const state = _loadState();
    const completed = state.completed || [];
    const html = `
      <div class="tut-pick-box">
        <div class="tut-pick-h">🎓 튜토리얼 선택</div>
        <div class="tut-pick-desc">역할에 맞는 튜토리얼을 선택하세요. 언제든 다시 시작할 수 있습니다.</div>
        <div class="tut-tracks">
          ${Object.values(TRACKS).map(t => `
            <div class="tut-track-card" data-track="${_e(t.id)}" style="border-left:5px solid ${t.color};">
              <div class="tut-track-card-icon">${t.icon}</div>
              <div class="tut-track-card-meta">
                <div class="tut-track-card-title">${_e(t.label)} ${completed.includes(t.id)?'<span class="tut-done-badge">✓ 완료</span>':''}</div>
                <div class="tut-track-card-desc">${_e(t.desc)}</div>
                <div class="tut-track-card-meta-bar">⏱ ${t.duration} · ${t.steps.length}단계</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="text-align:right;margin-top:18px;">
          <button class="tut-btn tut-btn-ghost" onclick="window.erpTutorial.closePicker()">닫기</button>
        </div>
      </div>`;
    document.getElementById('erp-tut-pick').innerHTML = html;
    document.getElementById('erp-tut-pick').classList.add('open');
    document.querySelectorAll('.tut-track-card').forEach(card => {
      card.onclick = () => {
        const track = card.getAttribute('data-track');
        closePicker();
        startTrack(track);
      };
    });
  }
  function closePicker() {
    document.getElementById('erp-tut-pick')?.classList.remove('open');
  }

  // ── 트랙 시작/진행 ────────────────────────────────
  function startTrack(trackId) {
    const track = TRACKS[trackId];
    if (!track) { alert('잘못된 트랙: ' + trackId); return; }
    _activeTrack = track;
    _stepIdx = 0;
    document.getElementById('erp-tut-overlay').classList.add('open');
    _renderStep();
  }

  function _renderStep() {
    const track = _activeTrack;
    if (!track) return;
    const step = track.steps[_stepIdx];
    if (!step) { _completeTrack(); return; }

    // 타겟 찾기
    let target = null;
    if (step.target && step.target !== 'body') {
      // 여러 selector 가능 (콤마 분리)
      const selectors = step.target.split(',').map(s => s.trim());
      for (const sel of selectors) {
        target = document.querySelector(sel);
        if (target && _isVisible(target)) break;
      }
    }
    _currentTarget = target;

    // optional 단계 — 타겟 없으면 스킵
    if (!target && step.optional) {
      _stepIdx++;
      _renderStep();
      return;
    }

    // spotlight 위치
    const spotlight = document.getElementById('erp-tut-spotlight');
    if (target && step.target !== 'body') {
      const rect = target.getBoundingClientRect();
      const padding = 6;
      spotlight.style.display = 'block';
      spotlight.style.top = (rect.top - padding + window.scrollY) + 'px';
      spotlight.style.left = (rect.left - padding + window.scrollX) + 'px';
      spotlight.style.width = (rect.width + padding*2) + 'px';
      spotlight.style.height = (rect.height + padding*2) + 'px';
      // 스크롤
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // body 또는 타겟 없음 — 화면 중앙 spotlight 숨김
      spotlight.style.display = 'none';
    }

    // 툴팁 위치 + 내용
    const tip = document.getElementById('erp-tut-tooltip');
    const isFirst = _stepIdx === 0;
    const isLast = _stepIdx === track.steps.length - 1;
    const progressPills = track.steps.map((_, i) => {
      const cls = i < _stepIdx ? 'done' : i === _stepIdx ? 'active' : '';
      return `<div class="tut-progress-pill ${cls}"></div>`;
    }).join('');

    tip.innerHTML = `
      <div class="tut-h">
        <h3>${_e(step.title)}</h3>
        <span class="tut-track-pill" style="background:${track.color}20;color:${track.color};">${track.icon} ${_e(track.label)}</span>
      </div>
      <div class="tut-body">${_e(step.body)}</div>
      ${step.api ? `<div style="margin-top:10px;padding:8px 10px;background:#fffde7;border-radius:5px;font-size:0.82em;">
        💡 콘솔에서 <code style="background:#fff;padding:1px 4px;border-radius:3px;font-family:monospace;">${_e(step.api)}()</code> 실행 가능
        <button class="tut-btn tut-btn-ghost" onclick="window.erpTutorial._tryApi('${_e(step.api)}')" style="margin-left:6px;padding:3px 8px;font-size:0.78em;">실행</button>
      </div>` : ''}
      <div class="tut-progress">${progressPills}</div>
      <div class="tut-ft">
        <button class="tut-btn tut-btn-skip" onclick="window.erpTutorial.cancel()">⏏ 종료</button>
        <div>
          ${!isFirst ? `<button class="tut-btn tut-btn-ghost" onclick="window.erpTutorial.prev()">← 이전</button>` : ''}
          <button class="tut-btn tut-btn-primary" onclick="window.erpTutorial.next()">${isLast ? '🎉 완료' : '다음 →'}</button>
        </div>
      </div>
    `;
    tip.style.display = 'block';
    _positionTooltip(tip, target, step.position);
  }

  function _positionTooltip(tip, target, position) {
    const tipRect = tip.getBoundingClientRect();
    const w = tipRect.width || 380;
    const h = tipRect.height || 200;

    if (!target || position === 'center') {
      tip.style.left = `calc(50% - ${w/2}px)`;
      tip.style.top = `calc(50% - ${h/2}px)`;
      return;
    }
    const rect = target.getBoundingClientRect();
    const margin = 14;
    let top, left;

    switch (position) {
      case 'right':
        left = rect.right + margin;
        top = rect.top + rect.height/2 - h/2;
        break;
      case 'left':
        left = rect.left - w - margin;
        top = rect.top + rect.height/2 - h/2;
        break;
      case 'top':
        left = rect.left + rect.width/2 - w/2;
        top = rect.top - h - margin;
        break;
      case 'bottom':
      default:
        left = rect.left + rect.width/2 - w/2;
        top = rect.bottom + margin;
    }

    // 화면 밖으로 나가지 않게 보정
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (left < 10) left = 10;
    if (left + w > winW - 10) left = winW - w - 10;
    if (top < 10) top = 10;
    if (top + h > winH - 10) top = winH - h - 10;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function _isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function next() {
    if (!_activeTrack) return;
    if (_stepIdx >= _activeTrack.steps.length - 1) {
      _completeTrack();
      return;
    }
    _stepIdx++;
    _renderStep();
  }

  function prev() {
    if (!_activeTrack || _stepIdx === 0) return;
    _stepIdx--;
    _renderStep();
  }

  function cancel() {
    if (!_activeTrack) return;
    if (!confirm('튜토리얼을 종료하시겠습니까?')) return;
    _close();
  }

  function _completeTrack() {
    if (_activeTrack) {
      _markCompleted(_activeTrack.id);
      if (typeof setBanner === 'function')
        setBanner('ok', `🎉 ${_activeTrack.label} 튜토리얼 완료!`);
    }
    _close();
  }

  function _close() {
    _activeTrack = null;
    _stepIdx = 0;
    document.getElementById('erp-tut-overlay')?.classList.remove('open');
    document.getElementById('erp-tut-tooltip').style.display = 'none';
  }

  function _tryApi(apiPath) {
    try {
      const fn = apiPath.split('.').reduce((o, k) => o && o[k], window);
      if (typeof fn === 'function') fn();
      else alert(`함수 ${apiPath}() 미로드`);
    } catch (e) { alert('실행 실패: ' + e.message); }
  }

  // ── 부팅 ────────────────────────────────────────
  function boot() {
    setTimeout(_injectUI, 800);
    // 첫 사용자 자동 안내 (한번만)
    setTimeout(() => {
      const state = _loadState();
      if (state.completed.length === 0 && !localStorage.getItem('erp_tutorial_offered')) {
        try { localStorage.setItem('erp_tutorial_offered', '1'); } catch (e) {}
        // 셋업 마법사 보다 늦게
        setTimeout(() => {
          if (typeof setBanner === 'function') {
            setBanner('info',
              '🎓 처음 사용자이신가요? erpTutorial.open() 으로 5~12분 가이드 시작 가능');
          }
        }, 6000);
      }
    }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── 공개 API ────────────────────────────────────
  window.erpTutorial = {
    open: openPicker,
    close: closePicker,
    closePicker,
    start: startTrack,
    next, prev, cancel,
    state: _loadState,
    reset: () => { _saveState({ completed: [] }); },
    tracks: () => Object.keys(TRACKS),
    _tryApi
  };

  console.log('[ERP-TUTORIAL] 튜토리얼 활성 — erpTutorial.open() · 트랙: ' + Object.keys(TRACKS).join(', '));
})();
