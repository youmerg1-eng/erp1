/**
 * =====================================================
 *  영업관리 ERP — Apps Script 양방향 동기화 (서버측)
 *  Phase B · Week 5
 *
 *  설치 방법 (5분):
 *   1) script.google.com 접속 → 새 프로젝트
 *   2) 이 파일 전체 내용 복사 → 코드.gs에 붙여넣기
 *   3) 메뉴: 배포 → 새 배포 → 유형: 웹 앱
 *      - 실행 사용자: 본인
 *      - 액세스 권한: 모든 사용자
 *   4) 배포 후 표시되는 웹 앱 URL을 ERP 설정 탭의 "Apps Script URL"에 붙여넣기
 *   5) ERP에서 F12 → erpSync.enable(true)
 *
 *  스프레드시트 자동 생성:
 *   - 처음 호출 시 ERP_SYNC_DATA 시트가 자동 생성됩니다.
 *   - 모든 디바이스의 변경이 timestamp + device로 기록됩니다.
 * =====================================================
 */

const SHEET_NAME = 'ERP_SYNC_DATA';
// ★ 2026-05-13 다중 사용자 — Presence 시트
const PRESENCE_SHEET_NAME = 'ERP_PRESENCE';
// ★ 2026-05-13 보안 강화 — 사용자 / 로그인 로그 시트
const USERS_SHEET_NAME = 'ERP_USERS';
const LOGIN_LOG_SHEET_NAME = 'ERP_LOGIN_LOG';

// 서버 측 PBKDF2 iteration 동일하게 적용
const SERVER_HASH_SALT = 'baro-erp-server-salt-v1';
const MAX_LOGIN_ATTEMPTS_SERVER = 10;   // 서버 측 1차 차단 (클라보다 관대)
const SERVER_LOCKOUT_MS = 15 * 60 * 1000;

// =====================================================
// [PATCH-J] 보안 토큰 — sendEmail 액션 인증
//   1) 아래 SECRET_TOKEN 값을 임의 문자열로 변경 (예: 'erp-7k9-xRqL2-Wm')
//   2) 클라이언트에서 erpNotify.config({gsToken: '같은 값'}) 등록
//   3) 토큰 미일치 시 sendEmail 거부 — 외부의 임의 메일 발송 차단
//
//   ⚠️ 초기값 그대로 사용하면 전 세계 누구나 이 GS URL로 메일 발송 가능
// =====================================================
const SECRET_TOKEN = 'CHANGE_ME_TO_RANDOM_STRING';

function _getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('ERP Cloud Sync');
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['timestamp','device','type','op','payload']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ★ 2026-05-13 다중 사용자 Presence 시트
//   schema: [deviceId, name, role, lastSeen, online]
function _getPresenceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('ERP Cloud Sync');
  let sh = ss.getSheetByName(PRESENCE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PRESENCE_SHEET_NAME);
    sh.appendRow(['deviceId','name','role','lastSeen','online']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ★ 2026-05-13 보안 사용자 시트
//   schema: [username, serverHash, role, createdAt, lastLogin, failedCount, lockedUntil, mustChangePw]
function _getUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('ERP Cloud Sync');
  let sh = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET_NAME);
    sh.appendRow(['username','serverHash','role','createdAt','lastLogin','failedCount','lockedUntil','mustChangePw']);
    sh.setFrozenRows(1);
    // 시트 즉시 보호 — 시트 수동 편집으로 인한 데이터 손상 방지 (협업자 차단)
    try {
      const prot = sh.protect().setDescription('ERP_USERS - 보안 시트 (직접 편집 금지)');
      prot.setWarningOnly(true);   // 경고만 (스크립트는 계속 쓸 수 있음)
    } catch(e) {}
  }
  return sh;
}

// ★ 2026-05-13 로그인 로그 시트
//   schema: [timestamp, username, deviceId, kind, success, detail, ip]
function _getLoginLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('ERP Cloud Sync');
  let sh = ss.getSheetByName(LOGIN_LOG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(LOGIN_LOG_SHEET_NAME);
    sh.appendRow(['timestamp','username','deviceId','kind','success','detail','ua']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _logLogin(username, deviceId, kind, success, detail, ua) {
  try {
    const sh = _getLoginLogSheet();
    sh.appendRow([
      new Date().toISOString(), username || '', deviceId || '',
      kind, success ? 1 : 0, detail || '', (ua || '').slice(0, 200)
    ]);
    // 10,000건 넘으면 오래된 것부터 정리
    const last = sh.getLastRow();
    if (last > 10000) sh.deleteRows(2, last - 10000);
  } catch(e) {}
}

// 서버 측 2차 해시 (PBKDF2 대용 — Apps Script 는 Web Crypto 없음 → digest 반복)
function _serverHash(clientHash) {
  // 클라이언트가 이미 PBKDF2(password) 한 결과를 받음
  // 서버에서 다시 SHA-256(clientHash + SERVER_HASH_SALT) 5,000회 반복
  let h = clientHash + SERVER_HASH_SALT;
  for (let i = 0; i < 5000; i++) {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h);
    h = Utilities.base64Encode(digest);
  }
  return h;
}

function _findUserRow(sh, username) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const usernames = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < usernames.length; i++) {
    if (String(usernames[i][0]).toLowerCase() === String(username).toLowerCase()) {
      return i + 2;
    }
  }
  return -1;
}

function _isAdmin(username) {
  const sh = _getUsersSheet();
  const row = _findUserRow(sh, username);
  if (row < 2) return false;
  return sh.getRange(row, 3).getValue() === 'admin';
}

function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'ping') {
      const sh = _getSheet();
      return _resp({ success:true, message:'ERP Sync OK', rows: sh.getLastRow() - 1, serverTime: new Date().toISOString() });
    }
    if (action === 'pull') {
      // [PATCH-H] 페이지네이션 — limit/cursor 지원, 메모리 폭발 방지
      const since  = e.parameter.since  || '';
      const device = e.parameter.device || '';
      const limit  = Math.min(parseInt(e.parameter.limit) || 1000, 5000);
      const cursor = parseInt(e.parameter.cursor) || 2;   // 시작 행 (1-based, 2 = 헤더 다음)
      const sh = _getSheet();
      const last = sh.getLastRow();
      if (last < 2 || cursor > last) {
        return _resp({ success:true, updates:[], serverTime: new Date().toISOString(), hasMore:false, nextCursor:null });
      }
      // limit 단위로만 읽음
      const rowsToRead = Math.min(limit, last - cursor + 1);
      const rows = sh.getRange(cursor, 1, rowsToRead, 5).getValues();
      const updates = [];
      rows.forEach(r => {
        const ts = r[0] ? new Date(r[0]).toISOString() : '';
        if (since && ts <= since) return;
        if (device && r[1] === device) return;
        try {
          updates.push({
            timestamp: ts, device: r[1], type: r[2], op: r[3],
            payload: JSON.parse(r[4])
          });
        } catch(err) {}
      });
      // 동일 type 중 최신 1건만 (이 페이지 내에서 — 클라이언트가 누적 처리)
      const lastOf = {};
      updates.forEach(u => { lastOf[u.type] = u; });
      const result = Object.values(lastOf);
      const nextCursor = cursor + rowsToRead;
      const hasMore = nextCursor <= last;
      return _resp({
        success:true,
        updates:result,
        serverTime: new Date().toISOString(),
        hasMore,
        nextCursor: hasMore ? nextCursor : null,
        totalRows: last - 1
      });
    }
    // ★ 2026-05-13 다중 사용자 heartbeat
    //   GET ?action=heartbeat&device=D-xxx&name=홍길동&role=sales&offline=0
    if (action === 'heartbeat') {
      const dev = e.parameter.device || '';
      const name = e.parameter.name || '';
      const role = e.parameter.role || '';
      const offline = e.parameter.offline === '1';
      if (!dev) return _resp({ success:false, error:'device required' });

      const sh = _getPresenceSheet();
      const lock = LockService.getScriptLock();
      lock.waitLock(5000);
      try {
        const last = sh.getLastRow();
        const now = new Date().toISOString();
        let foundRow = 0;
        if (last >= 2) {
          const ids = sh.getRange(2, 1, last - 1, 1).getValues();
          for (let i = 0; i < ids.length; i++) {
            if (ids[i][0] === dev) { foundRow = i + 2; break; }
          }
        }
        if (foundRow > 0) {
          sh.getRange(foundRow, 1, 1, 5).setValues([[dev, name, role, now, offline ? 0 : 1]]);
        } else {
          sh.appendRow([dev, name, role, now, offline ? 0 : 1]);
        }
        // 30일 이상 안 들어온 사용자 자동 정리
        const cutoff = new Date(Date.now() - 30*24*3600*1000).toISOString();
        const rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow()-1, 5).getValues() : [];
        for (let i = rows.length - 1; i >= 0; i--) {
          const lastSeen = rows[i][3];
          if (lastSeen && lastSeen < cutoff) {
            sh.deleteRow(i + 2);
          }
        }
      } finally {
        lock.releaseLock();
      }
      return _resp({ success:true, serverTime: new Date().toISOString() });
    }

    // ★ 2026-05-13 다중 사용자 presence 목록
    //   GET ?action=presence&window=180  (180초 안에 heartbeat 보낸 사용자 = online)
    if (action === 'presence') {
      const windowSec = parseInt(e.parameter.window) || 180;
      const cutoff = new Date(Date.now() - windowSec * 1000).toISOString();
      const sh = _getPresenceSheet();
      const last = sh.getLastRow();
      if (last < 2) return _resp({ success:true, users:[], serverTime: new Date().toISOString() });
      const rows = sh.getRange(2, 1, last - 1, 5).getValues();
      const users = rows
        .filter(r => r[3] && r[3] >= cutoff && r[4] !== 0)
        .map(r => ({
          deviceId: r[0],
          name: r[1],
          role: r[2],
          lastSeen: r[3]
        }))
        .sort((a, b) => (b.lastSeen||'').localeCompare(a.lastSeen||''));
      return _resp({ success:true, users:users, serverTime: new Date().toISOString() });
    }

    // ★ 2026-05-13 보안 — 사용자 목록 (admin 전용)
    //   GET ?action=list_users&device=D-xxx
    //   클라이언트의 device → 세션이 살아있다고 가정. 더 강한 보안은 토큰 검증 추가
    if (action === 'list_users') {
      // 누구나 호출 가능하지만 비밀번호 해시는 반환 안 함
      const sh = _getUsersSheet();
      const last = sh.getLastRow();
      if (last < 2) return _resp({ success:true, users:[] });
      const rows = sh.getRange(2, 1, last - 1, 8).getValues();
      const users = rows.map(r => ({
        username: r[0], role: r[2],
        createdAt: r[3], lastLogin: r[4],
        mustChangePw: !!r[7]
        // serverHash, failedCount, lockedUntil — 비공개
      }));
      return _resp({ success:true, users:users });
    }

    if (action === 'read') {
      // 기존 호환 — 가장 최신 rawData snapshot 1건 반환
      const sh = _getSheet();
      const last = sh.getLastRow();
      if (last < 2) return _resp({ success:true, data:[] });
      const rows = sh.getRange(2, 1, last - 1, 5).getValues();
      // 마지막 snapshot 찾기
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][2] === 'snapshot') {
          try {
            const p = JSON.parse(rows[i][4]);
            return _resp({ success:true, data: p.rawData || [] });
          } catch(err) {}
        }
      }
      return _resp({ success:true, data:[] });
    }
    return _resp({ success:false, error:'unknown action: ' + action });
  } catch(e) {
    return _resp({ success:false, error: e.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');

    // ── 이메일 발송 (Gmail SMTP, 무료 일 100건) ──
    if (body.action === 'sendEmail') {
      // [PATCH-J] 토큰 인증
      if (!body.token || body.token !== SECRET_TOKEN) {
        return _resp({ success:false, error:'unauthorized — set SECRET_TOKEN in Apps Script + erpNotify.config({gsToken})' });
      }
      if (SECRET_TOKEN === 'CHANGE_ME_TO_RANDOM_STRING') {
        return _resp({ success:false, error:'SECRET_TOKEN을 임의 문자열로 변경 필요 (코드 상단)' });
      }
      if (!body.to || !body.subject || !body.body) {
        return _resp({ success:false, error:'to/subject/body 필수' });
      }
      try {
        MailApp.sendEmail({
          to: body.to,
          subject: body.subject,
          body: body.body
        });
        return _resp({ success:true });
      } catch(err) {
        return _resp({ success:false, error: err.message });
      }
    }

    // ── AI 챗봇 (Gemini 1.5 Flash, 무료 티어) ──
    // 사전 준비: 프로젝트 설정 → 스크립트 속성에 GEMINI_API_KEY 등록
    //   1) https://aistudio.google.com 에서 API key 무료 발급
    //   2) Apps Script 편집기 → 톱니바퀴 → 스크립트 속성 → GEMINI_API_KEY 추가
    if (body.action === 'aiChat') {
      if (!body.token || body.token !== SECRET_TOKEN) {
        return _resp({ success:false, error:'unauthorized' });
      }
      const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
      if (!apiKey) {
        return _resp({ success:false, error:'GEMINI_API_KEY 미설정 (스크립트 속성에 등록 필요)' });
      }
      try {
        const parts = [{ text: body.text || '' }];
        if (body.image) {
          parts.push({ inline_data: { mime_type: body.mimeType || 'image/jpeg', data: body.image }});
        }
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + apiKey;
        const res = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }] }),
          muteHttpExceptions: true
        });
        const json = JSON.parse(res.getContentText());
        if (json.candidates && json.candidates[0] && json.candidates[0].content) {
          const text = json.candidates[0].content.parts.map(p => p.text || '').join('\n');
          return _resp({ success:true, text: text });
        }
        return _resp({ success:false, error: 'Gemini 응답 오류: ' + JSON.stringify(json).slice(0,300) });
      } catch(err) {
        return _resp({ success:false, error: err.message });
      }
    }

    // ★ 2026-05-13 보안 — 로그인 인증
    if (body.action === 'verify_user') {
      const username = String(body.username || '').trim();
      const clientHash = String(body.clientHash || '');
      const deviceId = String(body.deviceId || '');
      if (!username || !clientHash) {
        return _resp({ success:false, error:'username/clientHash 필수' });
      }
      const sh = _getUsersSheet();
      const row = _findUserRow(sh, username);
      if (row < 2) {
        _logLogin(username, deviceId, 'login', false, '사용자 없음', '');
        // 사용자 없음/암호 틀림 동일 메시지 (정보 누출 방지)
        return _resp({ success:false, error:'아이디 또는 비밀번호 오류' });
      }
      const rec = sh.getRange(row, 1, 1, 8).getValues()[0];
      const [u, hash, role, createdAt, lastLogin, failedCount, lockedUntil, mustChangePw] = rec;

      // 서버 측 lockout 체크
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        _logLogin(username, deviceId, 'login', false, '계정 잠금', '');
        return _resp({ success:false, error:'계정이 일시 잠금 상태입니다. 잠시 후 다시 시도하세요.' });
      }

      const expected = _serverHash(clientHash);
      if (expected !== hash) {
        // 실패 카운트 증가 + lockout
        const newCount = (failedCount || 0) + 1;
        const newLockedUntil = newCount >= MAX_LOGIN_ATTEMPTS_SERVER
          ? new Date(Date.now() + SERVER_LOCKOUT_MS).toISOString()
          : '';
        sh.getRange(row, 6, 1, 2).setValues([[
          newCount >= MAX_LOGIN_ATTEMPTS_SERVER ? 0 : newCount,
          newLockedUntil
        ]]);
        _logLogin(username, deviceId, 'login', false, '비밀번호 오류 ('+newCount+'회)', '');
        return _resp({ success:false, error:'아이디 또는 비밀번호 오류' });
      }

      // 성공 → 카운트 초기화, lastLogin 갱신
      sh.getRange(row, 5, 1, 3).setValues([[new Date().toISOString(), 0, '']]);
      _logLogin(username, deviceId, 'login', true, 'role='+role, '');
      return _resp({
        success:true,
        username: u,
        role: role,
        mustChangePw: !!mustChangePw,
        serverTime: new Date().toISOString()
      });
    }

    // ★ 2026-05-13 보안 — 새 사용자 등록 (admin 전용)
    if (body.action === 'register_user') {
      const admin = String(body.adminUser || '');
      if (!_isAdmin(admin)) {
        return _resp({ success:false, error:'관리자 권한 필요' });
      }
      const username = String(body.username || '').trim();
      const clientHash = String(body.clientHash || '');
      const role = String(body.role || 'sales');
      if (!username || !clientHash) return _resp({ success:false, error:'필수 필드 누락' });
      if (!/^[a-zA-Z0-9가-힣._-]{2,40}$/.test(username)) {
        return _resp({ success:false, error:'아이디는 2~40자 영숫자·한글·._-' });
      }
      if (!['admin','exec','sales','ops','viewer'].includes(role)) {
        return _resp({ success:false, error:'역할 값 오류' });
      }
      const sh = _getUsersSheet();
      const existing = _findUserRow(sh, username);
      if (existing >= 2) return _resp({ success:false, error:'이미 존재하는 아이디' });

      const serverHash = _serverHash(clientHash);
      sh.appendRow([username, serverHash, role, new Date().toISOString(), '', 0, '', 1]);
      _logLogin(admin, body.deviceId || '', 'user_create', true, `new=${username} role=${role}`, '');
      return _resp({ success:true, message:'사용자 등록 완료' });
    }

    // ★ 2026-05-13 보안 — 비밀번호 변경 (본인)
    if (body.action === 'change_password') {
      const username = String(body.username || '');
      const oldHash = String(body.oldHash || '');
      const newHash = String(body.newHash || '');
      const sh = _getUsersSheet();
      const row = _findUserRow(sh, username);
      if (row < 2) return _resp({ success:false, error:'사용자 없음' });
      const curHash = sh.getRange(row, 2).getValue();
      if (_serverHash(oldHash) !== curHash) {
        _logLogin(username, body.deviceId || '', 'passwd_change', false, '현재 암호 오류', '');
        return _resp({ success:false, error:'현재 비밀번호가 일치하지 않음' });
      }
      sh.getRange(row, 2).setValue(_serverHash(newHash));
      sh.getRange(row, 8).setValue(0);   // mustChangePw 해제
      _logLogin(username, body.deviceId || '', 'passwd_change', true, '', '');
      return _resp({ success:true });
    }

    // ★ 2026-05-13 보안 — 비밀번호 초기화 (admin 전용)
    if (body.action === 'reset_password') {
      const admin = String(body.adminUser || '');
      if (!_isAdmin(admin)) return _resp({ success:false, error:'관리자 권한 필요' });
      const username = String(body.username || '');
      const newHash = String(body.newHash || '');
      const sh = _getUsersSheet();
      const row = _findUserRow(sh, username);
      if (row < 2) return _resp({ success:false, error:'사용자 없음' });
      sh.getRange(row, 2).setValue(_serverHash(newHash));
      sh.getRange(row, 6, 1, 3).setValues([[0, '', 1]]);  // failedCount=0, lockedUntil='', mustChangePw=1
      _logLogin(admin, body.deviceId || '', 'passwd_reset', true, `target=${username}`, '');
      return _resp({ success:true });
    }

    // ★ 2026-05-13 보안 — 사용자 삭제 (admin 전용)
    if (body.action === 'delete_user') {
      const admin = String(body.adminUser || '');
      if (!_isAdmin(admin)) return _resp({ success:false, error:'관리자 권한 필요' });
      const username = String(body.username || '');
      if (username.toLowerCase() === admin.toLowerCase()) {
        return _resp({ success:false, error:'본인 계정은 삭제 불가' });
      }
      const sh = _getUsersSheet();
      const row = _findUserRow(sh, username);
      if (row < 2) return _resp({ success:false, error:'사용자 없음' });
      sh.deleteRow(row);
      _logLogin(admin, body.deviceId || '', 'user_delete', true, `target=${username}`, '');
      return _resp({ success:true });
    }

    if (body.action === 'push') {
      const items = body.items || [];
      const device = body.device || '';
      const sh = _getSheet();
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const now = new Date().toISOString();
        items.forEach(it => {
          sh.appendRow([
            now,
            device,
            it.type || '',
            it.op || '',
            JSON.stringify(it.payload || {})
          ]);
        });
        // 행 100,000건 넘으면 오래된 것부터 정리 (안전)
        const last = sh.getLastRow();
        if (last > 100000) {
          sh.deleteRows(2, last - 100000);
        }
      } finally {
        lock.releaseLock();
      }
      return _resp({ success:true, accepted: items.length });
    }
    return _resp({ success:false, error:'unknown action' });
  } catch(e) {
    return _resp({ success:false, error: e.message });
  }
}
