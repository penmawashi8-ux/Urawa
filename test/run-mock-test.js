import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * ローカルのモックログインサイトに対して src/login.js を動かし、
 * 「成功 → 終了コード 0」「失敗 → 終了コード 1」になることを確認する。
 * （本番サイトにアクセスしないので、何度実行しても安全）
 */

const EMAIL = 'tester@example.com';
const PASSWORD = 'correct-horse';
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const page = (body) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>モックファンクラブ</title></head><body>${body}</body></html>`;

const loginForm = (error) =>
  page(`
    <h1>ログイン</h1>
    ${error ? `<div id="login_error">${error}</div>` : ''}
    <form action="/signin/" method="post">
      <input type="hidden" name="redirect_to" value="/">
      <input type="text" name="log" placeholder="メールアドレス">
      <input type="password" name="pwd" placeholder="パスワード">
      <input type="submit" value="ログイン">
    </form>`);

const memberTop = page(`
    <h1>マイページ</h1>
    <p>ログインボーナスを獲得しました。</p>
    <p>保有ポイント 120 pt</p>
    <a href="/logout">ログアウト</a>`);

function startServer() {
  const server = http.createServer((req, res) => {
    const loggedIn = (req.headers.cookie || '').includes('mock_session=1');

    if (req.method === 'POST' && req.url.startsWith('/signin')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('log') === EMAIL && params.get('pwd') === PASSWORD) {
          res.writeHead(302, { location: '/', 'set-cookie': 'mock_session=1; Path=/' });
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(loginForm('ID またはパスワードが違います。'));
        }
      });
      return;
    }

    if (req.url.startsWith('/signin')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(loggedIn ? memberTop : loginForm(null));
      return;
    }

    if (!loggedIn) {
      res.writeHead(302, { location: '/signin/' });
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(memberTop);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runLogin(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/login.js'], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

const server = await startServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const baseEnv = {
  URAWA_LOGIN_URL: `${base}/signin/`,
  URAWA_HOME_URL: `${base}/`,
  URAWA_ARTIFACT_DIR: path.join(rootDir, 'artifacts', 'test'),
  URAWA_RETRIES: '1',
};

let failures = 0;

const ok = await runLogin({ ...baseEnv, URAWA_EMAIL: EMAIL, URAWA_PASSWORD: PASSWORD });
console.log(ok.output);
if (ok.code === 0 && ok.output.includes('ログイン成功')) {
  console.log('PASS: 正しい認証情報でログインできる');
} else {
  console.log(`FAIL: 正しい認証情報でログインできない (exit=${ok.code})`);
  failures += 1;
}
if (ok.output.includes('120')) {
  console.log('PASS: ポイント数を読み取れる');
} else {
  console.log('FAIL: ポイント数を読み取れない');
  failures += 1;
}

const ng = await runLogin({ ...baseEnv, URAWA_EMAIL: EMAIL, URAWA_PASSWORD: 'wrong-password' });
console.log(ng.output);
if (ng.code === 1 && ng.output.includes('パスワードが違います')) {
  console.log('PASS: 認証エラーを検知して終了コード 1 になる');
} else {
  console.log(`FAIL: 認証エラーを検知できない (exit=${ng.code})`);
  failures += 1;
}

server.close();
console.log(failures === 0 ? '\nすべてのテストに合格しました。' : `\n${failures} 件のテストが失敗しました。`);
process.exit(failures === 0 ? 0 : 1);
