// 웹 배포용 폴더 생성: node build-web.js  →  ./web/
// web/ 폴더를 Netlify Drop(https://app.netlify.com/drop) 또는 Cloudflare Pages 에 그대로 올리면 됩니다.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DEST = path.join(__dirname, 'web');

const INCLUDE_FILES = ['영업관리_ERP.html', '영업관리_ERP_styles.css', 'manifest.webmanifest', '_headers', '_redirects'];
const INCLUDE_DIRS = ['영업관리_ERP_tabs', 'vendor'];
const INCLUDE_PATTERN = /^영업관리_ERP_.*\.js$/;

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

let count = 0;
function copy(rel) {
  const to = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), to);
  count++;
}

for (const f of INCLUDE_FILES) {
  if (!fs.existsSync(path.join(SRC, f))) throw new Error(`필수 파일 없음: ${f}`);
  copy(f);
}
for (const name of fs.readdirSync(SRC)) {
  if (INCLUDE_PATTERN.test(name) && fs.statSync(path.join(SRC, name)).isFile()) copy(name);
}
for (const dir of INCLUDE_DIRS) {
  const abs = path.join(SRC, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (fs.statSync(path.join(abs, name)).isFile()) copy(path.join(dir, name));
  }
}

// 루트 주소(/)로 접속해도 열리도록 index.html 을 메인 HTML 사본으로 생성
fs.copyFileSync(path.join(SRC, '영업관리_ERP.html'), path.join(DEST, 'index.html'));
count++;

// Netlify 설정 (헤더·리다이렉트는 _headers/_redirects 와 중복되어도 무방)
fs.writeFileSync(path.join(DEST, 'netlify.toml'), `[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=*, microphone=(), geolocation=()"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "no-cache"
`);
count++;

console.log(`[build-web] ${count}개 파일 → ${DEST}`);
console.log('다음 단계: https://app.netlify.com/drop 에 web 폴더를 끌어다 놓으세요.');
