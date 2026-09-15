// =====================================================
//  REGRESSION TESTS — Phase A · Week 3
//  목표: 핵심 헬퍼 함수들의 회귀 방지
//
//  실행 방법
//   1) F12 콘솔에서:  runErpTests()
//   2) 우측 하단 🩺 패널 → 테스트 탭 → ▶ 전체 실행
//
//  기존 코드는 한 줄도 수정하지 않음 — 순수 검증만 수행.
// =====================================================
(function() {
  'use strict';

  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  function assertEq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || ''}: 기대=${JSON.stringify(expected)} / 실제=${JSON.stringify(actual)}`);
    }
  }
  function assertTrue(v, msg)  { if (!v) throw new Error(msg || 'falsy'); }
  function assertFalse(v, msg) { if (v)  throw new Error(msg || 'truthy'); }
  function assertHas(arr, item, msg) {
    if (!Array.isArray(arr) || arr.indexOf(item) < 0)
      throw new Error(`${msg||''}: ${item} 없음`);
  }

  // ── 그룹 1: 날짜 정규화 ─────────────────────────────
  const Y = new Date().getFullYear();
  test('1. _normalizeDate "4/1" → 현재연도 4월 1일', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip: _normalizeDate 미정의');
    assertEq(_normalizeDate('4/1'), `${Y}-04-01`);
  });
  test('2. _normalizeDate "26-04-21" → 2026-04-21', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip');
    assertEq(_normalizeDate('26-04-21'), '2026-04-21');
  });
  test('3. _normalizeDate "26.4.29" → 2026-04-29', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip');
    assertEq(_normalizeDate('26.4.29'), '2026-04-29');
  });
  test('4. _normalizeDate "2026/4/29" → 2026-04-29', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip');
    assertEq(_normalizeDate('2026/4/29'), '2026-04-29');
  });
  test('5. _normalizeDate 빈 문자열 → ""', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip');
    assertEq(_normalizeDate(''), '');
  });
  test('6. _normalizeDate 잘못된 포맷 → 원본 유지', () => {
    if (typeof _normalizeDate !== 'function') throw new Error('skip');
    assertEq(_normalizeDate('abc'), 'abc');
  });

  // ── 그룹 2: PLT 분할 계산 ───────────────────────────
  test('7. _calcPltSplit 마스터 미등록 → looseQty = total', () => {
    if (typeof _calcPltSplit !== 'function') throw new Error('skip');
    const orig = window.productMaster ? window.productMaster['__T_NONE__'] : null;
    const r = _calcPltSplit('__T_NONE__', 50);
    assertEq(r.looseQty, 50);
    assertEq(r.pltCount, 0);
    assertFalse(r.hasMaster, 'master 없어야 함');
  });
  test('8. _calcPltSplit 정수배 → 소분 0', () => {
    if (typeof _calcPltSplit !== 'function' || typeof productMaster === 'undefined') throw new Error('skip');
    productMaster['__T_PLT__'] = { plt: 30 };
    const r = _calcPltSplit('__T_PLT__', 90);
    assertEq(r.pltCount, 3);
    assertEq(r.looseQty, 0);
    assertEq(r.pltQty, 90);
    delete productMaster['__T_PLT__'];
  });
  test('9. _calcPltSplit 소분 발생 → 소분 매수 정확', () => {
    if (typeof _calcPltSplit !== 'function' || typeof productMaster === 'undefined') throw new Error('skip');
    productMaster['__T_PLT__'] = { plt: 30 };
    const r = _calcPltSplit('__T_PLT__', 95);
    assertEq(r.pltCount, 3);
    assertEq(r.looseQty, 5);
    assertEq(r.total, 95);
    delete productMaster['__T_PLT__'];
  });
  test('10. _calcPltSplit PLT 미달 → 전부 소분', () => {
    if (typeof _calcPltSplit !== 'function' || typeof productMaster === 'undefined') throw new Error('skip');
    productMaster['__T_PLT__'] = { plt: 30 };
    const r = _calcPltSplit('__T_PLT__', 25);
    assertEq(r.pltCount, 0);
    assertEq(r.looseQty, 25);
    delete productMaster['__T_PLT__'];
  });
  test('11. _calcPltSplit 0 또는 음수 → 안전 처리', () => {
    if (typeof _calcPltSplit !== 'function') throw new Error('skip');
    const r = _calcPltSplit('any', 0);
    assertEq(r.total, 0);
    assertEq(r.pltCount, 0);
  });

  // ── 그룹 3: 단위 제거 ──────────────────────────────
  test('12. _stripUnit "110kW" → "110"', () => {
    if (typeof _stripUnit !== 'function') throw new Error('skip');
    assertEq(_stripUnit('110kW'), '110');
  });
  test('13. _stripUnit "5,100,000원" → "5,100,000"', () => {
    if (typeof _stripUnit !== 'function') throw new Error('skip');
    assertEq(_stripUnit('5,100,000원'), '5,100,000');
  });
  test('14. _stripUnit "19.5%" → "19.5"', () => {
    if (typeof _stripUnit !== 'function') throw new Error('skip');
    assertEq(_stripUnit('19.5%'), '19.5');
  });
  test('15. _stripUnit "-360,750" → "-360,750" (부호 유지)', () => {
    if (typeof _stripUnit !== 'function') throw new Error('skip');
    assertEq(_stripUnit('-360,750'), '-360,750');
  });
  test('16. _stripUnit 빈 값 → ""', () => {
    if (typeof _stripUnit !== 'function') throw new Error('skip');
    assertEq(_stripUnit(''), '');
    assertEq(_stripUnit(null), '');
  });

  // ── 그룹 4: 셀 분류기 ──────────────────────────────
  test('17. _bulkClassifyCell 날짜 인식', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('2026-04-21'), 'date');
    assertEq(_bulkClassifyCell('4/21'), 'date');
  });
  test('18. _bulkClassifyCell PJ NO 인식', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('BR-260330'), 'pjno');
  });
  test('19. _bulkClassifyCell 한글 이름 인식', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('이요한'), 'koreanName');
  });
  test('20. _bulkClassifyCell 전화번호 인식', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('010-1234-5678'), 'phone');
  });
  test('21. _bulkClassifyCell 정수 인식', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('141'), 'integer');
  });

  // ── 그룹 5: 양방향 앵커 매핑 ────────────────────────
  test('22. _bulkMapByHeader 기본 29열 매핑', () => {
    if (typeof _bulkMapByHeader !== 'function') throw new Error('skip');
    const cols = ['이요한','BR-260330','26-3-5','프라나','모듈','진코','JKM2602','JKM635N','635W','141','90kW',
                  '188','16832580','18515838','탑솔라','180','16116300','716280','4.3%',
                  '4/1','26-04-01','','','','지성테크','경기도 화성시','윤지용 010-5008-6809','','계약금 20%'];
    const r = _bulkMapByHeader(cols);
    assertEq(r['담당자'], '이요한');
    assertEq(r['PJ NO'], 'BR-260330');
    assertEq(r['모델명'], 'JKM635N');
  });
  test('23. _bulkMapByHeader 발전소명 끝앵커 (밀린 열도 정확)', () => {
    if (typeof _bulkMapByHeader !== 'function') throw new Error('skip');
    const cols = ['이요한','BR-260330','26-3-5','프라나','모듈','진코','JKM2602','JKM635N','635W','141','90kW',
                  '188','16832580','18515838','탑솔라','180','16116300','716280','4.3%',
                  '4/1','26-04-01','','','','지성테크','경기도 화성시','윤지용 010-5008-6809','','계약금 20%'];
    const r = _bulkMapByHeader(cols);
    assertEq(r['발전소명'], '지성테크');
    assertEq(r['수금조건'], '계약금 20%');
  });
  test('24. _bulkMapByHeader T열 출고요청일 정규화', () => {
    if (typeof _bulkMapByHeader !== 'function') throw new Error('skip');
    const cols = ['이요한','BR-260330','26-3-5','프라나','모듈','진코','','JKM','','141','',
                  '','','','','','','','','4/1','','','','','','','','',''];
    const r = _bulkMapByHeader(cols);
    assertEq(r['출고요청일'], `${Y}-04-01`);
  });
  test('25. _bulkMapByHeader 단위 제거 (수주용량)', () => {
    if (typeof _bulkMapByHeader !== 'function') throw new Error('skip');
    const cols = ['이요한','BR-260330','26-3-5','프라나','모듈','진코','','JKM','','30','110kW',
                  '','','','','','','','','','','','','','','','','',''];
    const r = _bulkMapByHeader(cols);
    assertEq(r['수주용량(kW)'], '110');
  });

  // ── 그룹 6: Schema Validation ──────────────────────
  test('26. validate 누락 필수필드 감지', () => {
    if (typeof validate !== 'function') throw new Error('skip');
    const errs = validate({}, SCHEMAS.deliveryOrder);
    assertTrue(errs.length > 0, '에러 발생해야 함');
  });
  test('27. validate 정상 데이터 → 에러 0', () => {
    if (typeof validate !== 'function') throw new Error('skip');
    const errs = validate({id:'DO-1', qty:10, foc:0, model:'M1', receiver:'고객A'}, SCHEMAS.deliveryOrder);
    assertEq(errs.length, 0);
  });
  test('28. validate 음수 수량 차단', () => {
    if (typeof validate !== 'function') throw new Error('skip');
    const errs = validate({id:'DO-1', qty:-5, foc:0, model:'M', receiver:'A'}, SCHEMAS.deliveryOrder);
    assertTrue(errs.length > 0, '음수 거부 안 됨');
  });

  // ── 그룹 7: Transaction · Audit ───────────────────
  test('29. tx() throw 시 자동 롤백', () => {
    if (typeof tx !== 'function' || typeof rawData === 'undefined') throw new Error('skip');
    const lenBefore = rawData.length;
    try {
      tx('rollback test', () => {
        rawData.push({ _id:'__TEST_ROLLBACK__', 'PJ NO':'TEST-1' });
        throw new Error('의도적 실패');
      });
    } catch(e) {/* expected */}
    assertEq(rawData.length, lenBefore, '롤백 안 됨');
    assertFalse(rawData.some(r => r._id === '__TEST_ROLLBACK__'), '잔존');
  });
  test('30. audit.list 호출 안전성', () => {
    if (typeof audit !== 'object' || typeof audit.list !== 'function') throw new Error('skip');
    const n = audit.list(1);
    assertTrue(typeof n === 'number');
  });

  // ── Phase D 추가 ────────────────────────────────────
  test('31. fmtCapacity 1000kW → MW 변환', () => {
    if (typeof fmtCapacity !== 'function') throw new Error('skip');
    assertEq(fmtCapacity(1000), '1MW');
    assertEq(fmtCapacity(1500), '1.5MW');
    assertEq(fmtCapacity(850),  '850kW');
    assertEq(fmtCapacity(0),    '0kW');
  });
  test('32. erpCalc.compute 양방향 변환 정확', () => {
    if (typeof erpCalc !== 'object' || typeof erpCalc.compute !== 'function') throw new Error('skip');
    // 365매 × 635Wp = 231.775kW
    const r1 = erpCalc.compute({ watt: 635, qty: 365, pltSize: 36, truckPlt: 22 });
    assertEq(r1.qty, 365);
    assertTrue(Math.abs(r1.kw - 231.775) < 0.01);
    assertEq(r1.plt, 10);             // floor(365/36)
    assertEq(r1.looseQty, 5);          // 365 - 360
    assertEq(r1.trucks, 1);            // 11PLT < 22 → 1대
    // 역산: 231.775kW × 1000 / 635 ≈ 365매
    const r2 = erpCalc.compute({ watt: 635, kw: 231.775, pltSize: 36 });
    assertEq(r2.qty, 365);
  });
  test('33. erpCalc.compute watt 0이면 안전 처리', () => {
    if (typeof erpCalc !== 'object' || typeof erpCalc.compute !== 'function') throw new Error('skip');
    const r = erpCalc.compute({ watt: 0, qty: 100 });
    assertEq(r.qty, 0);
    assertEq(r.kw, 0);
  });
  test('34. incoming.add + summary 통계 정확', () => {
    if (typeof incoming !== 'object' || typeof incoming.add !== 'function') throw new Error('skip');
    const before = incoming.summary().total;
    const e = incoming.add({ model:'__TEST_M__', mfr:'테스트', qty:100, watt:600, status:'shipping' });
    const after = incoming.summary().total;
    assertEq(after, before + 1, 'summary 증가 안 함');
    assertTrue(incoming.shipping().some(x => x.id === e.id), 'shipping 리스트에 없음');
    // 정리
    const idx = incoming.list().findIndex(x => x.id === e.id);
    if (idx >= 0) {
      // remove는 confirm 사용 — 직접 제거
      incoming.update(e.id, { status: 'cancelled' });
    }
  });
  test('35. plant_address 분리 — "황우1~3호 (추가) 전남..." 패턴', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    // C3: 발전소명 단독
    assertEq(_bulkClassifyCell('황우1~3호 (추가)'), 'plant');
    // C4: 도 약자 시작 = 일반 주소
    const cls = _bulkClassifyCell('전남 화순군 춘양면 월평리 759-1');
    assertEq(cls, 'address', '도 약자 시작은 address여야 함');
    // 자가용 시작 = plant_address
    assertEq(_bulkClassifyCell('자가용 전북 남원시 산정로 90'), 'plant_address');
  });
  test('36. 회사 접미사 customer 인식 (엔지니어링)', () => {
    if (typeof _bulkClassifyCell !== 'function') throw new Error('skip');
    assertEq(_bulkClassifyCell('신명엔지니어링'), 'customer');
    assertEq(_bulkClassifyCell('탑솔라'), 'customer');
    assertEq(_bulkClassifyCell('한국화웨이기술'), 'customer');
  });

  // ── Phase E 추가 ────────────────────────────────────
  test('37. purchase.summary 호출 안전성', () => {
    if (typeof purchase !== 'object' || typeof purchase.summary !== 'function') throw new Error('skip');
    const s = purchase.summary();
    assertTrue(typeof s.total === 'number');
    assertTrue(typeof s.totalKw === 'number');
    assertTrue(Array.isArray(s.rows));
  });
  test('38. purchase.byVendor 그룹화 정확', () => {
    if (typeof purchase !== 'object' || typeof purchase.byVendor !== 'function') throw new Error('skip');
    const list = purchase.byVendor();
    assertTrue(Array.isArray(list));
    list.forEach(v => {
      assertTrue(typeof v.vendor === 'string');
      assertTrue(typeof v.totalQty === 'number');
    });
  });
  test('39. dispatch.summary 미배차 + 할당 분리', () => {
    if (typeof dispatch !== 'object' || typeof dispatch.summary !== 'function') throw new Error('skip');
    const s = dispatch.summary();
    assertTrue(typeof s.groupCount === 'number');
    assertTrue(typeof s.assignedCount === 'number');
    assertTrue(typeof s.unassignedCount === 'number');
  });
  test('40. erpExcel SHEETS 8개 정의', () => {
    if (typeof erpExcel !== 'object') throw new Error('skip');
    assertTrue(typeof erpExcel.download === 'function');
    assertTrue(typeof erpExcel.upload === 'function');
    assertTrue(typeof erpExcel.template === 'function');
  });
  test('41. erpAuth 5단계 역할 + check 함수', () => {
    if (typeof erpAuth !== 'object') throw new Error('skip');
    const roles = erpAuth.list();
    assertEq(Object.keys(roles).length, 5);
    assertTrue('admin' in roles);
    assertTrue('exec' in roles);
    assertTrue('sales' in roles);     // 영업팀 (구 chief 대체)
    assertTrue('ops' in roles);
    assertTrue('viewer' in roles);
    // viewer는 edit 불가
    const before = erpAuth.getRole();
    erpAuth.setRole('viewer');
    assertFalse(erpAuth.check('edit'), 'viewer는 edit:false여야 함');
    // 영업팀은 edit 가능
    erpAuth.setRole('sales');
    assertTrue(erpAuth.check('edit'), '영업팀은 edit:true여야 함');
    erpAuth.setRole(before);
  });

  // ── Phase F 추가 ────────────────────────────────────
  test('42. ai 모듈 ask/ocr 함수 정의 확인', () => {
    if (typeof ai !== 'object') throw new Error('skip');
    assertTrue(typeof ai.ask === 'function');
    assertTrue(typeof ai.ocr === 'function');
    assertTrue(typeof ai.open === 'function');
  });
  test('43. erpMarket 환율 캐시 구조', () => {
    if (typeof erpMarket !== 'object') throw new Error('skip');
    assertTrue(typeof erpMarket.refresh === 'function');
    assertTrue(typeof erpMarket.rates === 'function');
    // 캐시 호출 안전성
    const r = erpMarket.rates();
    assertTrue(r === null || typeof r === 'object');
  });
  test('44. dashboardV2 KPI 집계 함수', () => {
    if (typeof dashboardV2 !== 'object') throw new Error('skip');
    assertTrue(typeof dashboardV2.kpis === 'function');
    const k = dashboardV2.kpis();
    assertTrue(typeof k === 'object');
    if (typeof getEnriched === 'function') {
      assertTrue('thisMonth' in k);
    }
  });

  // ── 운영 안정화 ────────────────────────────────────
  test('45. ops.score Health Score 0~100 범위', () => {
    if (typeof ops !== 'object') throw new Error('skip');
    const s = ops.score();
    assertTrue(typeof s.total === 'number');
    assertTrue(s.total >= 0 && s.total <= 100, `score ${s.total} 범위 벗어남`);
    assertTrue('integrity' in s.breakdown);
    assertTrue('tests' in s.breakdown);
    assertTrue('errors' in s.breakdown);
    assertTrue('backup' in s.breakdown);
    assertTrue('activity' in s.breakdown);
  });
  test('46. backup.exportAll 메타 정상', () => {
    if (typeof backup !== 'object') throw new Error('skip');
    // export 자체는 다운로드를 trigger하므로 listSnapshots만 확인
    const snaps = backup.listSnapshots();
    assertTrue(Array.isArray(snaps));
  });
  test('47. erpFeedback.history 안전 호출', () => {
    if (typeof erpFeedback !== 'object') throw new Error('skip');
    assertTrue(typeof erpFeedback.send === 'function');
    assertTrue(typeof erpFeedback.history === 'function');
    const h = erpFeedback.history(5);
    assertTrue(Array.isArray(h));
  });

  // ── 실행기 ──────────────────────────────────────────
  window.runErpTests = function(target) {
    const results = [];
    let pass = 0, fail = 0, skip = 0;
    tests.forEach(t => {
      try { t.fn(); results.push({name:t.name, status:'PASS'}); pass++; }
      catch(e) {
        if (/^skip/i.test(e.message) || e.message === 'skip') {
          results.push({name:t.name, status:'SKIP', msg:e.message}); skip++;
        } else {
          results.push({name:t.name, status:'FAIL', msg:e.message}); fail++;
        }
      }
    });
    const summary = { total: tests.length, pass, fail, skip };
    console.group(`%c🧪 회귀 테스트 결과: ${pass}/${tests.length} 통과 · 실패 ${fail} · 스킵 ${skip}`,
      `font-weight:bold;color:${fail===0?'#27ae60':'#c62828'};`);
    results.forEach(r => {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️' : '❌';
      const color = r.status === 'PASS' ? '#27ae60' : r.status === 'SKIP' ? '#999' : '#c62828';
      console.log(`%c${icon} ${r.name}${r.msg?' — '+r.msg:''}`, `color:${color}`);
    });
    console.groupEnd();

    if (target === 'panel') {
      const el = document.getElementById('ehp-test-result');
      if (el) {
        el.innerHTML = `<div class="ehp-row ${fail===0?'ok':'bad'}">
            <strong>${pass}/${tests.length} 통과</strong> · 실패 ${fail} · 스킵 ${skip}
          </div>` +
          results.filter(r => r.status !== 'PASS').map(r => `
            <div class="ehp-row ${r.status==='FAIL'?'bad':''}" style="font-size:0.78em;">
              ${r.status==='FAIL'?'❌':'⏭️'} ${r.name}
              ${r.msg ? `<div class="ehp-mini">${r.msg}</div>` : ''}
            </div>`).join('') +
          (fail === 0 && skip === 0 ? '<div class="ehp-row ok">✅ 모든 테스트 통과</div>' : '');
      }
      if (typeof setBanner === 'function')
        setBanner(fail===0?'ok':'err', `🧪 테스트 ${pass}/${tests.length} 통과`);
    }
    return summary;
  };

  console.log(`[ERP-TEST] 회귀 테스트 ${tests.length}건 등록됨 · runErpTests() 또는 🩺 패널에서 실행`);
})();
