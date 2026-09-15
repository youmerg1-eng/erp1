// =====================================================
//  NOTIFY — Phase B · Week 6
//  무료 다채널 알림 시스템
//   채널 1: Browser Notification (즉시, 0원)
//   채널 2: Gmail (Apps Script 경유, 일 100건 무료)
//   채널 3: Kakao "나에게 보내기" (REST API, 무료)
//
//  트리거 8종 (납기·결제·재고·채권)
//  쿨다운: 같은 (룰id+대상id)는 24h 1회
//
//  콘솔
//    erpNotify.run()       지금 즉시 모든 트리거 검사+발송
//    erpNotify.dry()       발송 없이 대상만 미리보기
//    erpNotify.config()    채널 설정 보기
//    erpNotify.config({email:'me@x.com', kakaoToken:'...'})
//    erpNotify.history()   발송 이력
//    erpNotify.test('email','테스트')   특정 채널 테스트
// =====================================================
(function() {
  'use strict';

  const CFG_KEY  = 'erp_notify_config';
  const HIST_KEY = 'erp_notify_history';
  const COOLDOWN_KEY = 'erp_notify_cooldown';
  const COOLDOWN_HOURS = 24;

  // ── 설정 로드/저장 ──────────────────────────────────
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch(e) { return {}; }
  }
  function saveConfig(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch(e) {}
  }
  let config = loadConfig();
  /* config = {
       email: 'me@x.com' | null,
       kakaoToken: '...' | null,
       browser: true|false,
       autoDailyAt: 9          // 0~23 시각, null이면 끔
     } */
  if (config.browser === undefined) config.browser = true;
  if (config.autoDailyAt === undefined) config.autoDailyAt = 9;

  // ── 발송 이력 ──────────────────────────────────────
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-200))); } catch(e) {}
  }
  let history = loadHistory();

  // ── 쿨다운 ──────────────────────────────────────────
  function loadCooldown() {
    try { return JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}'); }
    catch(e) { return {}; }
  }
  function saveCooldown(c) {
    try { localStorage.setItem(COOLDOWN_KEY, JSON.stringify(c)); } catch(e) {}
  }
  function isOnCooldown(key) {
    const c = loadCooldown();
    const last = c[key];
    if (!last) return false;
    const ageMs = Date.now() - new Date(last).getTime();
    return ageMs < COOLDOWN_HOURS * 3600 * 1000;
  }
  function markSent(key) {
    const c = loadCooldown();
    c[key] = new Date().toISOString();
    // 30일 이상은 자동 정리
    Object.keys(c).forEach(k => {
      if (Date.now() - new Date(c[k]).getTime() > 30*86400*1000) delete c[k];
    });
    saveCooldown(c);
  }

  // ── 트리거 룰 8종 ───────────────────────────────────
  //   각 트리거는 [{ key, title, body, severity }] 배열을 반환
  const TRIGGERS = [
    {
      id: 'T1_due_d3',
      label: 'D-3 납기 임박 (출고 전날 D-0 기준)',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        getEnriched().forEach(o => {
          if (o.status !== '수주' || !o.출고요청일) return;
          // 출고요청일 전날을 D-0으로
          const raw = _daysUntil(o.출고요청일);
          if (raw == null) return;
          const d = raw - 1;
          if (d < 0 || d > 3) return;
          const lbl = d === 0 ? 'D-Day' : `D-${d}`;
          items.push({
            key: `T1_${o._id}_${o.출고요청일}`,
            title: `📅 ${lbl} 납기 임박: ${o.pjNo}`,
            body: `${o.고객사 || ''} · ${o.모델명 || ''} · ${o.수량 || 0}매 · 출고요청 ${o.출고요청일}\n발전소: ${o.발전소명 || '-'}`,
            severity: d === 0 ? 'high' : 'mid'
          });
        });
        return items;
      }
    },
    {
      id: 'T2_overdue',
      label: '납기 초과 미납',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        const today = new Date().toISOString().slice(0,10);
        getEnriched().forEach(o => {
          if (o.status !== '수주' || !o.출고요청일) return;
          if (o.출고요청일 >= today) return;
          const days = Math.ceil((new Date(today) - new Date(o.출고요청일)) / 86400000);
          items.push({
            key: `T2_${o._id}`,
            title: `🚨 납기 ${days}일 초과: ${o.pjNo}`,
            body: `${o.고객사 || ''} · ${o.모델명 || ''} · 수주총액 ${(o.수주총액||0).toLocaleString()}원`,
            severity: 'high'
          });
        });
        return items;
      }
    },
    {
      id: 'T3_no_deposit_d14',
      label: '14일 내 납기 + 계약금 미입금',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        getEnriched().forEach(o => {
          if (o.status !== '수주' || !o.출고요청일 || o.계약금입금) return;
          const d = _daysUntil(o.출고요청일);
          if (d == null || d < 0 || d > 14) return;
          items.push({
            key: `T3_${o._id}`,
            title: `💰 D-${d} 계약금 미입금: ${o.pjNo}`,
            body: `${o.고객사 || ''} · 계약금 ${(o.계약금||0).toLocaleString()}원 · 출고불가 상태`,
            severity: d <= 3 ? 'high' : 'mid'
          });
        });
        return items;
      }
    },
    {
      id: 'T4_ar_30d',
      label: '채권 30일 경과 (납품완료 후 잔금 미입금)',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        getEnriched().forEach(o => {
          if (o.status !== '납품완료' || o.잔금입금) return;
          if (!o.납품일) return;
          const days = Math.floor((new Date() - new Date(o.납품일)) / 86400000);
          if (days < 30) return;
          const bucket = days < 60 ? 30 : days < 90 ? 60 : 90;
          items.push({
            key: `T4_${o._id}_${bucket}`,
            title: `📈 채권 ${bucket}일+ 경과: ${o.pjNo}`,
            body: `${o.고객사 || ''} · 잔금 ${(o.잔금||0).toLocaleString()}원 · 납품 ${o.납품일} (${days}일 전)`,
            severity: bucket >= 60 ? 'high' : 'mid'
          });
        });
        return items;
      }
    },
    {
      id: 'T5_stock_negative',
      label: '재고 음수',
      check: () => {
        const items = [];
        if (typeof inventoryData === 'undefined') return items;
        const stockMap = {};
        inventoryData.forEach(r => {
          const m = (r.model||'').trim();
          if (!m) return;
          if (!stockMap[m]) stockMap[m] = 0;
          stockMap[m] += r.type === '입고' ? (Number(r.qty)||0) : -(Number(r.qty)||0);
        });
        Object.entries(stockMap).forEach(([m, q]) => {
          if (q >= 0) return;
          items.push({
            key: `T5_${m}`,
            title: `⚠️ 재고 음수: ${m}`,
            body: `현재 ${q}매 — 입출고 이력을 점검하세요`,
            severity: 'high'
          });
        });
        return items;
      }
    },
    {
      id: 'T6_unsigned_do',
      label: '서명 누락 출고지시서',
      check: () => {
        const items = [];
        if (typeof deliveryOrders === 'undefined') return items;
        const today = new Date();
        deliveryOrders.forEach(d => {
          if (!d.processed) return;
          if (d.managerSign && d.approverSign) return;
          const age = (today - new Date(d.date || d.createdAt || today)) / 86400000;
          if (age < 2) return;  // 처리 직후엔 알림 X
          items.push({
            key: `T6_${d.id}`,
            title: `✍️ 서명 누락: ${d.id}`,
            body: `${d.pjNo || '-'} · 출고완료 ${Math.floor(age)}일 — ${!d.managerSign?'담당자':''} ${!d.approverSign?'확인자':''} 서명 필요`,
            severity: 'mid'
          });
        });
        return items;
      }
    },
    {
      id: 'T7_no_due_date',
      label: '출고요청일 미입력 수주',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        getEnriched().forEach(o => {
          if (o.status !== '수주' || o.출고요청일) return;
          items.push({
            key: `T7_${o._id}`,
            title: `📅 출고요청일 미입력: ${o.pjNo}`,
            body: `${o.고객사 || ''} · ${o.모델명 || ''} · 수주일 ${o.수주일 || '?'}`,
            severity: 'low'
          });
        });
        return items.slice(0, 5);  // 한꺼번에 너무 많이 안 보냄
      }
    },
    {
      id: 'T8_health_issues',
      label: '무결성 진단 발견',
      check: () => {
        if (typeof healthCheck === 'undefined') return [];
        const r = healthCheck.run(false);
        if (!r.issues.length) return [];
        return [{
          key: `T8_health_${r.issues.length}`,
          title: `🩺 무결성 진단: ${r.issues.length}건 발견`,
          body: r.issues.join('\n'),
          severity: 'mid'
        }];
      }
    },
    // ★ Sprint 4 #3: 사용전검사 D-7 알림
    //   납품완료 이후 사용전검사일정이 7일 이내로 임박한 수주를 추적.
    //   필드: o.사용전검사 (HEADER_NAMES[24] = '사용전검사일정')
    {
      id: 'T9_inspection_d7',
      label: '사용전검사 D-7 임박',
      check: () => {
        const items = [];
        if (typeof getEnriched !== 'function') return items;
        getEnriched().forEach(o => {
          // 사용전검사일정이 비어있거나 이미 완료된 건은 스킵
          if (!o.사용전검사) return;
          // 빈 값/대시 등 sentinel
          const insp = String(o.사용전검사).trim();
          if (!insp || insp === '-' || insp === 'X') return;
          // ISO 형식이 아니면 normalizeDate 통과 시도
          const inspDate = (typeof normalizeDate === 'function') ? normalizeDate(insp) : insp;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(inspDate)) return;
          const d = _daysUntil(inspDate);
          if (d == null || d < 0 || d > 7) return;
          items.push({
            key: `T9_${o._id}_${inspDate}`,
            title: `🔍 사용전검사 D-${d}: ${o.pjNo}`,
            body: `${o.고객사 || ''} · ${o.발전소명 || ''} · 검사일 ${inspDate}\n모델: ${o.모델명 || '-'} · ${o.수량 || 0}매`,
            severity: d <= 2 ? 'high' : d <= 5 ? 'mid' : 'low'
          });
        });
        return items;
      }
    },
    // ★ Phase 3: 창고 임대 만료 D-30 알림
    {
      id: 'T11_rental_expiring',
      label: '창고 임대 만료 임박 (D-30)',
      check: () => {
        const items = [];
        if (typeof window.warehouseRental === 'undefined' || !window.warehouseRental.listRentals) return items;
        try {
          window.warehouseRental.listRentals().forEach(r => {
            if (r.status === '해지' || r.status === '만료') return;
            if (!r.contractEnd) return;
            const d = _daysUntil(r.contractEnd);
            if (d == null || d < 0 || d > 30) return;
            items.push({
              key: `T11_${r.id}_${r.contractEnd}`,
              title: `🏘️ 임대 만료 D-${d}: ${r.contractNo}`,
              body: `${r.tenantName} · ${r.warehouseName||''} ${r.zoneName||''} · 월 ${(r.monthlyRent||0).toLocaleString()}원\n계약 종료: ${r.contractEnd}${r.autoRenew?' (자동 연장 예정)':''}`,
              severity: d <= 7 ? 'high' : d <= 14 ? 'mid' : 'low'
            });
          });
        } catch (e) { console.warn('[T11] 실행 실패', e); }
        return items;
      }
    },
    // ★ Phase 2: 타사 재고 보관료 청구 임박 (월말 D-3)
    {
      id: 'T12_tp_billing_due',
      label: '타사 보관료 청구 임박 (월말 D-3)',
      check: () => {
        const items = [];
        if (typeof window.thirdParty === 'undefined' || !window.thirdParty.listOwners) return items;
        try {
          const today = new Date();
          const lastDay = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
          const dToEom = lastDay - today.getDate();
          if (dToEom > 3) return items;
          const yearMonth = today.toISOString().slice(0,7);
          window.thirdParty.listOwners().forEach(o => {
            // 이번 달 청구서가 아직 없으면 알림
            const calc = window.thirdParty.calcMonthlyBilling ? window.thirdParty.calcMonthlyBilling(o.id, yearMonth) : null;
            if (!calc || calc.total <= 0) return;
            items.push({
              key: `T12_${o.id}_${yearMonth}`,
              title: `🤝 타사 보관료 청구 D-${dToEom}: ${o.name}`,
              body: `${yearMonth} 보관료 ${calc.total.toLocaleString()}원 (보관 ${calc.itemCount}건)\n청구서 발행 필요 (thirdParty.open())`,
              severity: 'mid'
            });
          });
        } catch (e) { console.warn('[T12] 실행 실패', e); }
        return items;
      }
    },
    // ★ Sprint 4 #2: 세금계산서 미발행 D-7 알림
    //   출고처리된 출고지시서 중 7일 이상 세금계산서 미발행 건.
    {
      id: 'T10_taxinvoice_overdue',
      label: '세금계산서 미발행 7일 초과',
      check: () => {
        const items = [];
        if (typeof window.taxInvoice === 'undefined' || !window.taxInvoice.overdueIssuance) return items;
        try {
          const overdue = window.taxInvoice.overdueIssuance(7);
          overdue.forEach(x => {
            items.push({
              key: `T10_${x.doId}_${x.daysOverdue}`,
              title: `🧾 세금계산서 미발행 D+${x.daysOverdue}: ${x.doId}`,
              body: `${x.pjNo || '-'} · 출고일 ${x.date} · 금액 ${(x.totalAmount||0).toLocaleString()}원\n발행 처리 필요 (taxInvoice.open())`,
              severity: x.daysOverdue >= 30 ? 'high' : 'mid'
            });
          });
        } catch (e) { console.warn('[T10] 실행 실패', e); }
        return items;
      }
    },
    // ★ Sprint 5 #3: 고객사 신용 위험 알림
    //   - CRITICAL/DANGER 등급 고객 또는 한도 80%+ 사용 고객
    {
      id: 'T11_credit_risk',
      label: '고객사 신용 위험 (한도 임박/만성 지연)',
      check: () => {
        const items = [];
        if (typeof window.erpCredit === 'undefined' || !window.erpCredit.alerts) return items;
        try {
          window.erpCredit.alerts().forEach(p => {
            const sev = p.riskLevel === 'CRITICAL' ? 'high'
                      : p.riskLevel === 'DANGER' ? 'high' : 'mid';
            items.push({
              key: `T11_${p.customer}_${p.riskLevel}`,
              title: `🚨 신용 위험 [${p.riskLevel}]: ${p.customer}`,
              body: `미수 ${(p.currentAR||0).toLocaleString()}원${p.creditLimit?` / 한도 ${p.creditLimit.toLocaleString()}원 (${p.utilization}%)`:''}\n` +
                    `평균 지연 ${p.avgLatency}일 · 정시율 ${p.onTimeRate}% · 위험점수 ${p.riskScore}/100\n` +
                    `상세 확인: erpCredit.open('${p.customer}')`,
              severity: sev
            });
          });
        } catch (e) { console.warn('[T11] 실행 실패', e); }
        return items;
      }
    }
  ];

  function _daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date(new Date().toISOString().slice(0,10));
    return Math.ceil((new Date(dateStr) - today) / 86400000);
  }

  // ── 발송 채널 ──────────────────────────────────────
  // 채널 1: 브라우저 알림
  async function sendBrowser(title, body) {
    if (!config.browser) return { skipped: true };
    if (!('Notification' in window)) return { skipped: true, reason: 'API 미지원' };
    if (Notification.permission === 'denied') return { skipped: true, reason: '권한 거부' };
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return { skipped: true, reason: '권한 미부여' };
    }
    try {
      new Notification(title, { body, icon: undefined });
      return { ok: true };
    } catch(e) { return { error: e.message }; }
  }

  // 채널 2: Gmail (Apps Script 경유)
  // [PATCH-J] gsToken 첨부 — Apps Script SECRET_TOKEN과 일치해야 발송됨
  async function sendEmail(title, body) {
    if (!config.email) return { skipped: true, reason: 'email 미설정' };
    if (typeof gsUrl === 'undefined' || !gsUrl) return { skipped: true, reason: 'GS URL 미설정' };
    if (!config.gsToken) return { skipped: true, reason: 'gsToken 미설정 — erpNotify.config({gsToken:"..."}) 필요' };
    try {
      const res = await fetch(gsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'sendEmail',
          token: config.gsToken,
          to: config.email,
          subject: '[ERP] ' + title,
          body: body + '\n\n— 영업관리 ERP 자동 알림'
        }),
        redirect: 'follow'
      });
      const json = await res.json();
      if (json.success) return { ok: true };
      return { error: json.error || 'send failed' };
    } catch(e) { return { error: e.message }; }
  }

  // 채널 3: Kakao "나에게 보내기"
  async function sendKakao(title, body) {
    if (!config.kakaoToken) return { skipped: true, reason: 'token 미설정' };
    try {
      const template = {
        object_type: 'text',
        text: `${title}\n\n${body}`,
        link: { web_url: 'https://www.google.com', mobile_web_url: 'https://www.google.com' },
        button_title: '확인'
      };
      const formData = new URLSearchParams();
      formData.append('template_object', JSON.stringify(template));
      const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + config.kakaoToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });
      const json = await res.json();
      if (json.result_code === 0) return { ok: true };
      return { error: json.msg || 'kakao send failed' };
    } catch(e) { return { error: e.message }; }
  }

  // ── 통합 발송 ───────────────────────────────────────
  async function dispatch(item, channels) {
    const results = {};
    if (channels.indexOf('browser') >= 0) results.browser = await sendBrowser(item.title, item.body);
    if (channels.indexOf('email') >= 0)   results.email   = await sendEmail(item.title, item.body);
    if (channels.indexOf('kakao') >= 0)   results.kakao   = await sendKakao(item.title, item.body);
    return results;
  }

  // ── 메인 실행 ───────────────────────────────────────
  async function run(opts) {
    opts = opts || {};
    const dryRun = !!opts.dry;
    const all = [];
    TRIGGERS.forEach(t => {
      try {
        const items = t.check();
        items.forEach(i => all.push({ ...i, ruleId: t.id, ruleLabel: t.label }));
      } catch(e) {
        if (typeof logError === 'function') logError('notify:'+t.id, e);
      }
    });

    // 쿨다운 필터
    const fresh = all.filter(i => !isOnCooldown(i.key));
    const skipped = all.length - fresh.length;

    if (dryRun) {
      console.group(`🔔 알림 미리보기: 새로 ${fresh.length}건 (쿨다운 ${skipped}건 스킵)`);
      fresh.forEach(i => console.log(`[${i.severity}] ${i.title}\n   ${i.body}`));
      console.groupEnd();
      return { fresh, skipped, dry: true };
    }

    // 채널 결정
    const channels = [];
    if (config.browser && (typeof Notification !== 'undefined')) channels.push('browser');
    if (config.email)      channels.push('email');
    if (config.kakaoToken) channels.push('kakao');

    // [PATCH-K] 채널 0개 명시 안내 — 첫 1회 모달, 이후 토스트만
    if (!channels.length) {
      const warnedKey = 'erp_notify_warned_no_channel';
      const last = localStorage.getItem(warnedKey);
      const today = new Date().toISOString().slice(0,10);
      if (fresh.length > 0 && last !== today) {
        // 알림 대상이 있는데 채널이 없을 때만 강하게 안내 (하루 1회)
        try { localStorage.setItem(warnedKey, today); } catch(e) {}
        const msg = `🔔 알림 대상 ${fresh.length}건 발견되었으나 발송 채널이 없습니다.\n\n` +
                    `최소 1개 채널 활성화 필요:\n` +
                    `  • erpNotify.config({ browser: true })  ← 즉시\n` +
                    `  • erpNotify.config({ email: 'me@x.com', gsToken: '토큰' })\n` +
                    `  • erpNotify.config({ kakaoToken: '...' })\n\n` +
                    `이 안내는 하루 1회만 표시됩니다.`;
        alert(msg);
      } else if (typeof setBanner === 'function') {
        setBanner('warn', `🔔 알림 채널 없음 — ${fresh.length}건 미발송 (erpNotify.config)`);
      }
      return { fresh, skipped, sent: 0, error: 'no channels', warned: fresh.length > 0 && last !== today };
    }

    // [PATCH-K] 트리거 발견 X 알림 (선택적 — 콘솔만)
    if (!fresh.length && skipped === 0) {
      console.log('[ERP-NOTIFY] 트리거 발견 없음 — 시스템 정상');
      return { fresh: [], sent: 0, skipped: 0 };
    }

    // 발송
    let sent = 0, failed = 0;
    for (const item of fresh) {
      const result = await dispatch(item, channels);
      const anyOk = Object.values(result).some(r => r && r.ok);
      if (anyOk) {
        markSent(item.key);
        sent++;
      } else {
        failed++;
      }
      history.push({
        when: new Date().toISOString(),
        ruleId: item.ruleId, key: item.key,
        title: item.title, severity: item.severity,
        result, channels
      });
    }
    saveHistory(history);

    const summary = `🔔 알림: ${sent}건 발송 / ${failed}건 실패 / ${skipped}건 쿨다운`;
    console.log(summary);
    if (typeof setBanner === 'function')
      setBanner(failed===0?'ok':'warn', summary);

    return { fresh, sent, failed, skipped };
  }

  // ── 일일 자동 실행 ──────────────────────────────────
  function _scheduleDaily() {
    if (config.autoDailyAt == null) return;
    setInterval(() => {
      const now = new Date();
      const lastDailyKey = 'erp_notify_last_daily';
      const lastRun = localStorage.getItem(lastDailyKey) || '';
      const today = now.toISOString().slice(0,10);
      if (lastRun === today) return;     // 오늘 이미 실행됨
      if (now.getHours() < config.autoDailyAt) return;
      try { localStorage.setItem(lastDailyKey, today); } catch(e) {}
      console.log(`[ERP-NOTIFY] 일일 자동 실행 (${config.autoDailyAt}시 트리거)`);
      run().catch(e => console.error(e));
    }, 5 * 60 * 1000);  // 5분마다 시각 체크
  }

  // ── 공개 API ────────────────────────────────────────
  window.erpNotify = {
    run: run,
    dry: () => run({ dry: true }),
    config: function(patch) {
      if (patch == null) {
        const masked = { ...config };
        if (masked.kakaoToken) masked.kakaoToken = masked.kakaoToken.slice(0,8) + '...';
        console.log('[NOTIFY config]', masked);
        return masked;
      }
      config = { ...config, ...patch };
      saveConfig(config);
      console.log('✅ 설정 저장됨');
      return config;
    },
    history: function(n) {
      const slice = history.slice(-(n||20)).reverse();
      console.table(slice.map(h => ({
        when: h.when.replace('T',' ').slice(0,19),
        rule: h.ruleId,
        title: h.title.slice(0,40),
        severity: h.severity,
        channels: h.channels.join(',')
      })));
      return slice.length;
    },
    test: async function(channel, message) {
      const item = { title: '[TEST] 테스트 알림', body: message || '설정 확인용 발송 테스트' };
      let r;
      if (channel === 'browser') r = await sendBrowser(item.title, item.body);
      else if (channel === 'email') r = await sendEmail(item.title, item.body);
      else if (channel === 'kakao') r = await sendKakao(item.title, item.body);
      else return { error: 'channel: browser|email|kakao' };
      console.log('[TEST]', channel, r);
      return r;
    },
    triggers: () => TRIGGERS.map(t => ({ id:t.id, label:t.label })),
    clearCooldown: () => { try { localStorage.removeItem(COOLDOWN_KEY); } catch(e) {} return true; }
  };

  // ── 부팅 ────────────────────────────────────────────
  function boot() {
    _scheduleDaily();
    // 부팅 5분 후 dry run으로 미리보기 (조용히)
    //   ★ 2026-05 변경: 트리거 실패를 silent 처리하지 않고 console.warn 으로 기록.
    //   이전엔 한 트리거의 버그가 묻혀 그 알림이 영원히 안 뜨는 문제 발생.
    setTimeout(() => {
      try {
        const all = [];
        const failed = [];
        TRIGGERS.forEach(t => {
          try {
            t.check().forEach(i => all.push(i));
          } catch (e) {
            failed.push({ id: t.id, error: e.message || String(e) });
            console.warn('[notify-boot] 트리거 실행 실패: ' + t.id, e);
            if (typeof logError === 'function') logError('notify-boot:' + t.id, e);
          }
        });
        if (failed.length > 0) {
          console.error('[notify-boot] 트리거 ' + failed.length + '/' + TRIGGERS.length + '개 실패', failed);
          if (typeof setBanner === 'function') {
            setBanner('warn', `⚠️ 알림 트리거 ${failed.length}건 오류 — F12 콘솔 확인`);
          }
        }
        if (all.length > 0 && typeof setBanner === 'function') {
          setBanner('info', `🔔 알림 대기: ${all.length}건 — erpNotify.dry()로 확인`);
        }
      } catch (e) {
        console.error('[notify-boot] 알림 시스템 부팅 실패', e);
        if (typeof logError === 'function') logError('notify-boot:fatal', e);
      }
    }, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[ERP-NOTIFY] 알림 ' + TRIGGERS.length + '종 등록 · erpNotify.dry()로 미리보기');
})();
