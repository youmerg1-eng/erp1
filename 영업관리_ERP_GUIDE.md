# 영업관리 ERP — 운영 가이드

> 12개 모듈 + Critical/HIGH/MEDIUM 패치(A~K) 통합 매뉴얼
> 모든 기능 비용 0원 · 기존 UI 그대로 + 추가 모듈만 add-only.

---

## 1. 빠른 시작

### 1-1. 일반 사용자 (브라우저 1대만 사용)
1. `영업관리_ERP.html` 더블클릭 → 브라우저에서 열림
2. 기존 탭들 그대로 사용 (수주/출고지시서/입출고/재고/영업실적/설정)
3. 우측 하단 5개 fab 활용 (모바일에선 ＋ 햄버거 1개)

### 1-2. 다중 사용자 (Apps Script 백엔드 활성화)
**서버측 (1회)**
1. https://script.google.com → 새 프로젝트
2. `apps_script_template.gs` 내용 전체 복사 → 코드.gs에 붙여넣기
3. **`SECRET_TOKEN` 값을 임의 문자열로 변경** (예: `erp-2026-x9k-Aq7L`)
4. 메뉴 → 배포 → 새 배포 → 유형: 웹 앱 → 액세스: 모든 사용자
5. 표시되는 웹 앱 URL을 **설정 탭 → Apps Script URL**에 등록

**클라이언트 (각 PC에서)**
```js
// F12 콘솔에서 1회만 실행
erpSync.enable(true)
erpNotify.config({
  email: 'me@company.com',
  gsToken: 'erp-2026-x9k-Aq7L',   // ⚠️ Apps Script SECRET_TOKEN과 동일하게
  browser: true,
  autoDailyAt: 9,
  dailyMailAt: 9
})
```

---

## 2. 우측 하단 5개 Fab 한눈에

| 아이콘 | 색 | 기능 | 핵심 단축키/명령 |
|---|---|---|---|
| 🩺 | 검정 | **시스템 상태 패널** — 진단/이력/에러/테스트 | - |
| 🔍 | 파랑 | **글로벌 검색** — PJ/SN/고객/모델 통합 | **Ctrl+K** |
| 📦 | 초록 | **ATP 가용재고** — 모델별 즉답 | `atp.of('TSM-720')` |
| 💰 | 주황 | **채권 Aging** — 30/60/90/120일 5단계 | `aging.summary()` |
| 📱 | 보라 | **모바일** — QR스캔/서명/사진 | `erpMobile.open()` |

**모바일 (768px 이하)**: 5개 모두 숨김 + ＋ 햄버거 1개로 통합

---

## 3. 12개 모듈 핵심 명령

### 🛡 안전 (safety.js)
```js
viewErpErrors()              // 누적 에러 표
healthCheck.run()            // 무결성 6항목 진단
healthCheck.fix()            // 자동수정 (안전장치 작동: 데이터 5건 미만 차단)
healthCheck.fixForce()       // 강제 (안전장치 무시 — 콘솔 전용)
audit.list(10)               // 변경 이력 메타 10건
audit.undo()                 // 직전 1단계 복원 + 새로고침
audit.redo()                 // undo 취소
tx('label', () => { ... })   // 원자적 트랜잭션 (실패 시 자동 롤백)
                             //   ⚠️ async 함수는 throw됨
```

### ✅ 입력 검증 (validation.js — 34개 룰)
```js
validationRules.list()              // 전체 룰
validationRules.list('order')       // 수주 룰만
validationRules.run('inventory', { type:'출고', model:'X', qty:100 })
                                    // 임의 데이터 직접 검증
```
**자동 적용**: 수주 등록·수정·삭제, 출고지시서 생성, 입출고 등록·수정·삭제, 제품 마스터

### 🏢 고객사 마스터 (customer.js)
```js
customerMaster.list()               // 전체
customerMaster.set('X사', { creditLimit: 50_000_000, riskLevel: 'watch' })
customerMaster.outstanding('X사')   // 미수금 즉시 계산
```
**자동 차단**: 수주 등록 시 미수금+신규 > 신용한도이면 confirm 다이얼로그 (R31)

### 🏭 매입사 마스터 + 클레임 (vendor.js)
```js
vendor.list()                       // 점수표
vendor.set('진코', { riskLevel: 'high' })
claim.add({ vendor:'진코', sn:'JKM...', qty:5, defectType:'출력저하', claimAmount:3000000 })
claim.byVendor('진코')              // 매입사별 클레임
```
**자동 차단**: `riskLevel: 'blacklist'` 매입사 수주 등록 BLOCK (R33)

### ☁ 클라우드 동기화 (sync.js)
```js
erpSync.enable(true)                // 활성
erpSync.now()                       // 즉시 push+pull
erpSync.status()                    // 큐/마지막 시각
```
**자동 작동**: 30초 폴링 + saveLocal 시 자동 push + 페이지네이션 1000건씩 50페이지 (5만건 한도)

### 🔔 알림 (notify.js)
```js
erpNotify.dry()                     // 미리보기
erpNotify.run()                     // 즉시 발송
erpNotify.config({ email:'me@x.com', gsToken:'토큰', browser:true, autoDailyAt:9 })
erpNotify.test('email','테스트')
erpNotify.history(20)
```
**채널**: 브라우저 푸시 / Gmail (Apps Script) / 카카오 "나에게"  
**트리거 8종**: 납기 D-3 · 납기초과 · 14일내 미입금 · 채권30/60/90 · 재고음수 · 서명누락 · 출고요청일 미입력 · 무결성 진단

### 📦 ATP 가용재고 (atp.js)
```js
atp.of('TSM-720NEG21C.20K')         // 단일 모델
atp.all()                           // 전체 정렬
atp.open()                          // 패널
```
**공식**: `ATP = 실재고 − 미출고확정 − 안전재고`

### 💰 채권 Aging (aging.js)
```js
aging.summary()                     // 5단계 합계
aging.byCustomer()                  // 고객사별
aging.dailyMail()                   // 즉시 일일 리포트 메일
```
**자동**: `dailyMailAt: 9` 설정 시 매일 9시 메일

### 🏷 SN 추적 (sn.js)
```js
sn.bulkAdd(snList, { model, mfr, warehouse, BL })   // 입고 시
sn.assign(snList, pjNo, doId)                       // 출고 시
sn.markDamaged(sn, '출력 5% 저하')                   // 클레임 시
sn.find('JKM26')                                    // 부분 매치
sn.byPJ('BR-260330')                                // PJ에 출고된 모든 SN
sn.summary()
sn.open()                                           // 패널
sn.importFromFR()                                   // 전수조사서에서 임포트
```

### 📱 모바일 (mobile.js)
- **📷 QR**: 카메라로 QR 스캔 → SN 일괄 등록
- **✍️ 서명**: 캔버스 터치 서명 → 출고지시서/인수증
- **🖼️ 사진**: 적재/하차/현장 사진 (IndexedDB 저장)
```js
erpMobile.open()
erpMobile.photoList('PJ NO')        // 사진 목록
```

### 🔍 글로벌 검색 (search.js)
```
Ctrl + K                            검색창
↑↓                                  결과 이동
Enter                               선택
Esc                                 닫기
```
인덱스 2초 캐싱 + saveLocal 시 자동 무효화

### 🧪 회귀 테스트 (tests.js)
```js
runErpTests()                       // 30건 일괄
// 또는 🩺 패널 → 테스트 탭 → ▶
```

---

## 4. 일상 운영 체크리스트

### 매일
- [ ] 🩺 fab 빨간색 깜빡임 확인 (문제 발견 시)
- [ ] 💰 fab 빨간색 깜빡임 확인 (30일 초과 채권)
- [ ] 일일 메일 도착 확인 (`dailyMailAt` 설정 시)

### 매주 금요일
- [ ] `runErpTests()` — 30건 모두 통과 확인
- [ ] `healthCheck.run()` — 6항목 진단
- [ ] `audit.list(20)` — 한 주 변경 이력 검토

### 매월 말일
- [ ] `erpNotify.history(50)` — 한 달 알림 발송 이력
- [ ] `customerMaster.list()` — 미수금 사용률 80% 이상 고객사 점검
- [ ] `vendor.list()` — 점수 60 미만 매입사 거래 재검토
- [ ] `aging.byCustomer()` — 60일 이상 채권 회수 계획

---

## 5. 트러블슈팅

### "데이터가 갑자기 바뀌었어요"
1. `audit.list(10)` — 최근 변경 확인
2. `audit.undo()` — 직전 1단계 복원 (새로고침됨)
3. 그 이전이면 `localStorage.getItem('erp_snapshot_2026-04-30')` 등 일일 스냅샷에서 수동 복구

### "앱이 멈췄어요"
1. F12 → `viewErpErrors()` — 누적 에러 확인
2. 🩺 패널 → 에러 탭에서 자세히
3. 새로고침 — `_backup` 키에서 자동 복구되거나, JSON 손상 시 자동 복원

### "다른 사람이 데이터를 못 봐요"
1. `erpSync.status()` — `enabled: true`, `gsUrl: true` 확인
2. Apps Script 배포 시 **"모든 사용자" 액세스** 인지 재확인
3. `SECRET_TOKEN`이 Apps Script와 클라이언트 `gsToken` 일치하는지

### "메일이 안 와요"
1. `erpNotify.test('email', '테스트')` — 결과 확인
2. `gsToken` 미설정 또는 불일치
3. Apps Script `SECRET_TOKEN`이 `CHANGE_ME_...` 그대로면 의도적으로 차단됨
4. Gmail 일 100건 한도 초과 (다음날 자동 복구)

### "QR 스캔이 안 돼요"
1. 인터넷 연결 확인 (jsQR CDN 로드)
2. 카메라 권한 허용
3. PC에서 카메라 없으면 ⌨️ 직접입력 사용

### "재고가 음수로 떠요"
1. 🩺 진단 탭에서 음수 모델 확인
2. 입출고 이력 검색해서 누락된 입고 등록 또는 잘못된 출고 수정/삭제
3. `deleteInventory` 시 음수 유발하면 자동 confirm 다이얼로그

---

## 6. 데이터 위치 정리

### localStorage 키 (14개 보호 + 6개 부가)
**Boatomicly 보호되는 14개 (BACKUP_KEYS)**:
```
erp_raw                  코어 — 수주 데이터
erp_local                코어 — 메타(상태/결제/입금)
erp_inventory            코어 — 입출고 이력
erp_delivery             코어 — 출고지시서
erp_settings             코어 — 앱 설정
erp_product_master       코어 — 제품 마스터
erp_customer_master      Phase B — 고객사
erp_vendor_master        Phase C — 매입사
erp_claims               Phase C — 클레임
erp_sn_records           Phase C — SN 추적
erp_audit_log            Phase A — 감사 이력
erp_mobile_sigs          Phase C — 모바일 서명
erp_notify_config        Phase B — 알림 설정
erp_notify_history       Phase B — 알림 발송 이력
```
각 키는 변경 시 `_backup` 자동 보존, 손상 시 자동 복구.

### IndexedDB
- `erpFilesDB` / `files` — 파일 (발주서/허가증/FD성적서/인증서/사진)

### Google Sheets (Apps Script)
- `ERP_SYNC_DATA` 시트 — 모든 디바이스 변경 이력 (timestamp + device + payload)

---

## 7. 키보드/마우스 단축키 정리

| 동작 | 단축키 |
|---|---|
| 글로벌 검색 | **Ctrl + K** (Mac: Cmd + K) |
| 검색창 닫기 | **Esc** |
| 결과 이동 | **↑ ↓** |
| 결과 선택 | **Enter** |
| 모달 닫기 | 바깥 클릭 |

---

## 8. 추가 파일 목록

```
영업관리_ERP.html                  메인 화면 (기존, 13줄만 추가)
영업관리_ERP.txt                  기존
영업관리_ERP_data.js               데이터/구글시트 (기존)
영업관리_ERP_utils.js              헬퍼 (기존)
영업관리_ERP_styles.css            스타일 (기존)
영업관리_ERP_tabs/                 탭별 코드 (기존 6개)

영업관리_ERP_safety.js             [신규] Phase A — 안전망 + Audit + Health Panel
영업관리_ERP_validation.js         [신규] Phase B — 34개 검증 룰
영업관리_ERP_customer.js           [신규] Phase B — 고객사 마스터 + 신용한도
영업관리_ERP_vendor.js             [신규] Phase C — 매입사 평가 + 클레임
영업관리_ERP_sync.js               [신규] Phase B — Apps Script 양방향
영업관리_ERP_notify.js             [신규] Phase B — 알림 8종 + 3채널
영업관리_ERP_atp.js                [신규] Phase B — ATP 실시간 가용재고
영업관리_ERP_aging.js              [신규] Phase B — 채권 Aging + 일일 메일
영업관리_ERP_sn.js                 [신규] Phase C — SN 추적
영업관리_ERP_mobile.js             [신규] Phase C — QR/서명/사진
영업관리_ERP_search.js             [신규] Week 3 — 글로벌 검색 (Ctrl+K)
영업관리_ERP_tests.js              [신규] Week 3 — 회귀 테스트 30건
영업관리_ERP_fab_menu.js           [신규] Patch I — 모바일 fab 통합

apps_script_template.gs            [신규] 서버측 (사용자가 GS에 1회 등록)
영업관리_ERP_GUIDE.md              [신규] 이 가이드
```

---

## 9. 패치 적용 이력

| 패치 | 영역 | 효과 |
|---|---|---|
| A | BACKUP_KEYS 14개 | 손상 시 자동 복구 |
| B | Audit 경량화 | 메모리 200배 절감 |
| C | 검증 누락 wrap | 입출고 수정/삭제 + 출고지시서 삭제 |
| D | tx async 차단 | Promise 반환 시 즉시 throw |
| E | healthCheck 안전장치 | 데이터 부족 시 자동수정 차단 |
| F | setBanner 디바운스 | 동일 메시지 3초 무시 |
| G | 검색 인덱스 캐싱 | 입력 lag 해소 |
| H | Apps Script 페이지네이션 | 5만건 안전 |
| I | Fab 모바일 통합 | 768px 이하 햄버거 |
| J | sendEmail 보안 토큰 | 외부 임의 발송 차단 |
| K | Notify 무음 실패 명시화 | 채널 0 시 명확 안내 |
| L | 운영 가이드 README | 본 문서 |

---

문의 또는 개선 요청은 회사 내부 운영팀으로.
