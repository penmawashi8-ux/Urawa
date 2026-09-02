import { config, assertCredentials } from './config.js';
import { extractPoints, excerptAroundPoints, savePoints } from './points.js';
import {
  launchBrowser,
  findFirstVisible,
  dismissConsentBanner,
  saveScreenshot,
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

/** ログインを 1 回試みる */
async function attemptLogin(context, account) {
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

/** マイページを開いて保有ポイントを読む。読めなければ null（ログインの成否には影響しない） */
async function readPoints(page, account) {
  try {
    if (config.pointsUrl && !page.url().startsWith(config.pointsUrl)) {
      await page.goto(config.pointsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
    const body = await page.locator('body').innerText();
    const points = extractPoints(body);
    if (points) {
      log(`[${account.label}] 保有ポイント: ${points}`);
      return points;
    }
    log(`[${account.label}] ポイントを読み取れませんでした。ページ抜粋: ${excerptAroundPoints(body)}`);
  } catch (error) {
    log(`[${account.label}] ポイントの取得に失敗: ${error.message}`);
  }
  return null;
}

/** 1 アカウント分のログイン（リトライ込み）。{ ok, points } を返す */
async function loginAccount(account) {
  let lastError = null;

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    // アカウントごとに新しいブラウザを起動するので、Cookie は混ざらない
    const { browser, context } = await launchBrowser();
    try {
      log(`[${account.label}] ログイン試行 ${attempt}/${config.retries}`);
      const { page } = await attemptLogin(context, account);

      log(`[${account.label}] ログイン成功: ${page.url()}`);

      // ログイン後にサイトを一度開く（ログインボーナスの判定がトップ側の場合に備える）
      if (config.homeUrl && !page.url().startsWith(config.homeUrl)) {
        log(`[${account.label}] サイトを開きます: ${config.homeUrl}`);
        await page.goto(config.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }

      const points = await readPoints(page, account);
      await browser.close();
      return { ok: true, points };
    } catch (error) {
      lastError = error;
      log(`[${account.label}] 失敗: ${error.message}`);
      const pages = context.pages();
      if (pages.length > 0) {
        await saveScreenshot(pages[pages.length - 1], `failure-${account.id}-${attempt}`);
      }
      await browser.close();

      if (attempt < config.retries) {
        const waitMs = 5000 * 2 ** (attempt - 1); // 5s, 10s, 20s ...
        log(`[${account.label}] ${waitMs / 1000} 秒待って再試行します。`);
        await sleep(waitMs);
      }
    }
  }

  log(`[${account.label}] ログインできませんでした: ${lastError?.message ?? '不明なエラー'}`);
  return { ok: false, points: null };
}

async function main() {
  assertCredentials();
  config.accountWarnings.forEach((warning) => log(`警告: ${warning}`));

  log(`対象アカウント数: ${config.accounts.length}`);

  const shared = config.accounts.filter((a) => a.sharedPassword).map((a) => a.label);
  if (shared.length > 0) {
    log(`${shared.join(' / ')} は 1 つ目のパスワード（URAWA_PASSWORD）を使います。`);
  }
  const failed = [];
  const points = [];

  for (const account of config.accounts) {
    const result = await loginAccount(account);
    if (!result.ok) failed.push(account.label);
    if (result.points !== null) points.push({ label: account.label, points: result.points });
  }

  const succeeded = config.accounts.length - failed.length;
  log(`結果: 成功 ${succeeded} / ${config.accounts.length}`);

  if (points.length > 0) {
    log(`ポイント: ${points.map((p) => `${p.label}=${p.points}`).join(' / ')}`);
    // POINTS.md / data/points.json を更新する（ワークフローが差分をコミットする）
    await savePoints(points).catch((error) => log(`ポイントの保存に失敗: ${error.message}`));
  }

  if (failed.length > 0) {
    log(`失敗したアカウント: ${failed.join(', ')}`);
    return 1;
  }

  log('すべてのアカウントでログインできました。');
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
