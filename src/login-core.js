import { config } from './config.js';
import { extractPoints, excerptAroundPoints } from './points.js';
import { launchBrowser, findFirstVisible, dismissConsentBanner, saveScreenshot, log, sleep } from './browser.js';

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
export async function isLoggedIn(page) {
  if (await findFirstVisible(page, LOGGED_IN_SELECTORS)) return true;
  // パスワード欄がまだ見えている＝ログインフォームに留まっている
  if (await findFirstVisible(page, config.selectors.pass)) return false;
  return !page.url().includes('/signin');
}

/** 画面上のエラーメッセージを拾う（原因表示用） */
export async function readErrorMessage(page) {
  const found = await findFirstVisible(page, ERROR_MESSAGE_SELECTORS);
  if (!found) return null;
  const text = await found.locator.innerText().catch(() => '');
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/** ログインを 1 回試みる */
export async function attemptLogin(context, account) {
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
  await userField.locator.fill(account.email);
  await passField.locator.fill(account.password);

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

/** マイページを開いて保有ポイントを読む。読めなければ null */
export async function readPoints(page, account) {
  try {
    if (config.pointsUrl && !page.url().startsWith(config.pointsUrl)) {
      await page.goto(config.pointsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
    const body = await page.locator('body').innerText();
    const points = extractPoints(body);
    if (points) {
      log(`[${account.label}] 保有ポイント: ${points}`);
      if (process.env.URAWA_DEBUG_POINTS) {
        log(`[${account.label}] 読み取り位置: ${excerptAroundPoints(body)}`);
      }
      return points;
    }
    log(`[${account.label}] ポイントを読み取れませんでした。ページ抜粋: ${excerptAroundPoints(body)}`);
  } catch (error) {
    log(`[${account.label}] ポイントの取得に失敗: ${error.message}`);
  }
  return null;
}

/**
 * ログインしたブラウザで任意の処理を行う（リトライ込み）。
 * task(page, account) の戻り値をそのまま result として返す。
 */
export async function withLogin(account, task) {
  let lastError = null;

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    // アカウントごとに新しいブラウザを起動するので、Cookie は混ざらない
    const { browser, context } = await launchBrowser();
    try {
      log(`[${account.label}] ログイン試行 ${attempt}/${config.retries}`);
      const { page } = await attemptLogin(context, account);
      log(`[${account.label}] ログイン成功: ${page.url()}`);

      const result = await task(page, account);
      await browser.close();
      return { ok: true, result };
    } catch (error) {
      lastError = error;
      log(`[${account.label}] 失敗: ${error.message}`);
      const pages = context.pages();
      if (pages.length > 0) {
        await saveScreenshot(pages[pages.length - 1], `failure-${account.id}-${attempt}`);
      }
      await browser.close();

      // サイト側が明確に拒否した場合（無効なクーポンなど）は繰り返しても無駄
      if (error.noRetry) break;

      if (attempt < config.retries) {
        const waitMs = 5000 * 2 ** (attempt - 1); // 5s, 10s, 20s ...
        log(`[${account.label}] ${waitMs / 1000} 秒待って再試行します。`);
        await sleep(waitMs);
      }
    }
  }

  log(`[${account.label}] 処理できませんでした: ${lastError?.message ?? '不明なエラー'}`);
  return { ok: false, result: null, error: lastError };
}
