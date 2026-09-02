import http from 'node:http';

/**
 * 本番サイトを模したモックサイト。ログイン・マイページ・クーポン入力を再現する。
 * 本番にはアクセスしないので、何度実行しても安全。
 */

export const SHARED_PASSWORD = 'correct-horse';
export const ACCOUNTS = [
  { email: 'tester1@example.com', password: SHARED_PASSWORD },
  { email: 'tester2@example.com', password: SHARED_PASSWORD },
  { email: 'tester3@example.com', password: SHARED_PASSWORD },
];
export const VALID_COUPON = 'URAWA2026';
const COUPON_BONUS = 50;

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

// アカウントごとに違うポイントを表示して、取り違えていないか確認できるようにする
const memberTop = (points, notice) =>
  page(`
    <h1>マイページ</h1>
    ${notice ? `<div class="notice">${notice}</div>` : ''}
    <p>ログインボーナスを獲得しました。</p>
    <p>保有ポイント ${points} pt</p>
    <a href="/coupon/">クーポンコード入力</a>
    <a href="/logout">ログアウト</a>`);

const couponForm = (error) =>
  page(`
    <h1>クーポンコード入力</h1>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form action="/coupon/" method="post">
      <input type="text" name="coupon_code" placeholder="クーポンコード">
      <button type="submit">送信</button>
    </form>
    <a href="/mypage/">マイページへ戻る</a>`);

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}

export function startServer() {
  // アカウント番号 → クーポンで加算されたポイント
  const bonuses = new Map();
  const pointsOf = (accountNumber) => accountNumber * 100 + (bonuses.get(accountNumber) || 0);

  const server = http.createServer(async (req, res) => {
    const session = (req.headers.cookie || '').match(/mock_session=(\d+)/);
    const loggedIn = Boolean(session);
    const accountNumber = session ? Number(session[1]) : 0;
    const html = (body) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };

    if (req.method === 'POST' && req.url.startsWith('/signin')) {
      const params = await readBody(req);
      const matched = ACCOUNTS.findIndex(
        (a) => a.email === params.get('log') && a.password === params.get('pwd'),
      );
      if (matched >= 0) {
        res.writeHead(302, {
          location: '/mypage/',
          'set-cookie': `mock_session=${matched + 1}; Path=/`,
        });
        res.end();
      } else {
        html(loginForm('ID またはパスワードが違います。'));
      }
      return;
    }

    if (req.url.startsWith('/signin')) {
      html(loggedIn ? memberTop(pointsOf(accountNumber)) : loginForm(null));
      return;
    }

    if (!loggedIn) {
      res.writeHead(302, { location: '/signin/' });
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url.startsWith('/coupon')) {
      const params = await readBody(req);
      const code = (params.get('coupon_code') || '').trim();
      if (code !== VALID_COUPON) {
        html(couponForm('クーポンコードが無効です。'));
        return;
      }
      if (bonuses.has(accountNumber)) {
        html(couponForm('このクーポンはすでに使用済みです。'));
        return;
      }
      bonuses.set(accountNumber, COUPON_BONUS);
      html(memberTop(pointsOf(accountNumber), `${COUPON_BONUS}ポイントを付与しました。`));
      return;
    }

    if (req.url.startsWith('/coupon')) {
      html(couponForm(null));
      return;
    }

    html(memberTop(pointsOf(accountNumber)));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** テスト用の共通ヘルパ: 判定結果を出力し、失敗数を数える */
export function createChecker() {
  const state = { failures: 0 };
  return {
    state,
    check(condition, label) {
      console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
      if (!condition) state.failures += 1;
    },
  };
}
