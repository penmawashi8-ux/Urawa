import { config, assertCredentials } from './config.js';
import {
  launchBrowser,
  findFirstVisible,
  dismissConsentBanner,
  saveScreenshot,
  notify,
  log,
  sleep,
} from './browser.js';

const ERROR_MESSAGE_SELECTORS = [
  '#login_error',
  '.login_error',
  '[role="alert"]',
  '.error',
  '.errors',
  '.alert-danger',
  '.woocommerce-error',
  '.wp-die-message',
  '.message--error',
];

const LOGGED_IN_SELECTORS = [
  'a[href*="logout" i]',
  'a[href*="signout" i]',
  'a[href*="sign-out" i]',
  'button:has-text("ログアウト")',
  'a:has-text("ログアウト")',
  'a:has-text("マイページ")',
];

/** ログイン後の状態かどうかを、複数の手がかりから判定する */
async function isLoggedIn(page) {
  if (await findFirstVisible(page, LOGGED_IN_SELECTORS)) return true;
  // パスワード欄がまだ見えている＝ログインフォームに留まっている
  if (await findFirstVisible(page, config.selectors.pass)) return false;
  return !page.url().includes('/signin');
}

/** 画面上のエラーメッセージを拾う（原因表示用） */
async function readErrorMessage(page) {
  const found = await findFirstVisible(page, ERROR_MESSAGE_SELECTORS);
  if (!found) return null;
  const text = await found.locator.innerText().catch(() => '');
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/** 保有ポイントらしき数字をベストエフォートで拾う（取れなくてもログインは成功扱い） */
async function readPoints(page) {
  const body = await page.locator('body').innerText().catch(() => '');
  const patterns = [
    /(?:保有|現在の|所持)?\s*ポイント[^0-9]{0,12}([0-9][0-9,]*)/,
    /([0-9][0-9,]*)\s*(?:pt|Pt|PT|ポイント)/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** ログインを 1 回試みる */
async function attemptLogin(context) {
  const page = await context.newPage();
  log(`ログインページを開きます: ${config.loginUrl}`);
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await dismissConsentBanner(page);

  const passField = await findFirstVisible(page, config.selectors.pass);
  if (!passField) {
    if (await isLoggedIn(page)) {
      log('すでにログイン済みの状態でした。');
      return { page, alreadyLoggedIn: true };
    }
    throw new Error(
      'パスワード入力欄が見つかりませんでした。`npm run inspect` でフォーム構造を確認し、URAWA_PASS_SELECTOR などで指定してください。',
    );
  }

  const userField = await findFirstVisible(page, config.selectors.user);
  if (!userField) {
    throw new Error(
      'ログイン ID 入力欄が見つかりませんでした。`npm run inspect` でフォーム構造を確認し、URAWA_USER_SELECTOR で指定してください。',
    );
  }

  log(`入力欄を検出: ID=${userField.selector} / PW=${passField.selector}`);
  await userField.locator.fill(config.email);
  await passField.locator.fill(config.password);

  const submit = await findFirstVisible(page, config.selectors.submit);
  if (submit) {
    log(`送信ボタンをクリック: ${submit.selector}`);
    await submit.locator.click();
  } else {
    log('送信ボタンが見つからないため Enter キーで送信します。');
    await passField.locator.press('Enter');
  }

  // 画面遷移 / 非同期ログインのどちらでも待てるようにする
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!(await isLoggedIn(page))) {
    const message = await readErrorMessage(page);
    throw new Error(
      `ログインに失敗しました${message ? `: ${message}` : '（サイト側のエラーメッセージは取得できませんでした）'}`,
    );
  }

  return { page, alreadyLoggedIn: false };
}

async function main() {
  assertCredentials();

  let lastError = null;

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    const { browser, context } = await launchBrowser();
    try {
      log(`ログイン試行 ${attempt}/${config.retries}`);
      const { page } = await attemptLogin(context);

      log(`ログイン成功: ${page.url()}`);

      // ログインボーナス判定はトップ/マイページ側で行われることがあるので一度開いておく
      if (config.homeUrl && !page.url().startsWith(config.homeUrl)) {
        await page.goto(config.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }

      const points = await readPoints(page);
      if (points) log(`現在のポイント（推定）: ${points}`);

      await saveScreenshot(page, 'success');
      await browser.close();

      log('完了しました。');
      return 0;
    } catch (error) {
      lastError = error;
      log(`失敗: ${error.message}`);
      const pages = context.pages();
      if (pages.length > 0) await saveScreenshot(pages[pages.length - 1], `failure-${attempt}`);
      await browser.close();

      if (attempt < config.retries) {
        const waitMs = 5000 * 2 ** (attempt - 1); // 5s, 10s, 20s ...
        log(`${waitMs / 1000} 秒待って再試行します。`);
        await sleep(waitMs);
      }
    }
  }

  const message = `浦和競馬ファンクラブへの自動ログインに失敗しました: ${lastError?.message ?? '不明なエラー'}`;
  log(message);
  await notify(message);
  return 1;
}

const exitCode = await main();
process.exit(exitCode);
