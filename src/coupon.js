import { config, assertCredentials } from './config.js';
import { withLogin, readPoints, readErrorMessage } from './login-core.js';
import { findFirstVisible, log } from './browser.js';
import { savePoints } from './points.js';

/**
 * クーポンコードを全アカウントに入力する。
 *   node src/coupon.js ABCD1234
 * コードは引数か URAWA_COUPON_CODE で渡す。
 */

const COUPON_LINK_SELECTORS = [
  'a:has-text("クーポンコード入力")',
  'a:has-text("クーポンコード")',
  'a:has-text("クーポン")',
  'a[href*="coupon" i]',
];

const COUPON_INPUT_SELECTORS = [
  'input[name*="coupon" i]',
  'input[id*="coupon" i]',
  'input[placeholder*="クーポン"]',
  'input[placeholder*="コード"]',
  'input[name*="code" i]',
  'form input[type="text"]',
];

const COUPON_SUBMIT_SELECTORS = [
  'form button[type="submit"]',
  'form input[type="submit"]',
  'button:has-text("送信")',
  'button:has-text("適用")',
  'button:has-text("登録")',
  'button:has-text("使用")',
  'input[type="submit"]',
];

// 送信結果のお知らせが入りやすい場所
const NOTICE_SELECTORS = [
  '.notice',
  '.message',
  '.alert',
  '.woocommerce-message',
  '.entry-content p:has-text("ポイント")',
];

/** クーポン入力ページを開く。URL 直指定が無ければマイページのリンクから辿る */
async function openCouponPage(page, account) {
  if (config.couponUrl) {
    await page.goto(config.couponUrl, { waitUntil: 'domcontentloaded' });
  } else {
    if (!page.url().startsWith(config.pointsUrl)) {
      await page.goto(config.pointsUrl, { waitUntil: 'domcontentloaded' });
    }
    const link = await findFirstVisible(page, COUPON_LINK_SELECTORS);
    if (!link) {
      throw new Error(
        'クーポン入力ページへのリンクが見つかりませんでした。URAWA_COUPON_URL でページの URL を直接指定してください。',
      );
    }
    log(`[${account.label}] クーポンページへ移動: ${link.selector}`);
    await link.locator.click();
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  log(`[${account.label}] クーポンページ: ${page.url()}`);
}

/** クーポンコードを 1 アカウントに入力する */
async function applyCoupon(page, account, code) {
  await openCouponPage(page, account);

  const input = await findFirstVisible(page, config.selectors.coupon || COUPON_INPUT_SELECTORS);
  if (!input) {
    throw new Error(
      'クーポンコードの入力欄が見つかりませんでした。`npm run inspect:member` で構造を確認してください。',
    );
  }

  await input.locator.fill(code);
  const submit = await findFirstVisible(page, COUPON_SUBMIT_SELECTORS);
  if (submit) {
    await submit.locator.click();
  } else {
    await input.locator.press('Enter');
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // 送信後の画面に出たメッセージをそのまま記録に残す
  const body = await page.locator('body').innerText().catch(() => '');
  const notice = await findFirstVisible(page, NOTICE_SELECTORS);
  const noticeText = notice ? (await notice.locator.innerText().catch(() => '')).trim() : '';
  const message = (await readErrorMessage(page)) || noticeText || firstNotice(body);
  log(`[${account.label}] 送信後のメッセージ: ${message || '（取得できませんでした）'}`);

  if (/無効|不正|期限|既に|すでに|使用済|エラー|正しく/.test(message || '')) {
    // サイトが明確に拒否した場合は、何度送っても同じなのでリトライしない
    const error = new Error(`クーポンが受け付けられませんでした: ${message}`);
    error.noRetry = true;
    throw error;
  }

  return readPoints(page, account);
}

/** 画面本文から、結果らしき短い一文を拾う */
function firstNotice(bodyText) {
  const text = bodyText.replace(/\s+/g, ' ');
  const match = text.match(
    /[^。]{0,60}(?:ポイント|クーポン)[^。]{0,60}(?:しました|されました|できません|ください)[^。]{0,20}/,
  );
  return match ? match[0].trim().slice(0, 200) : null;
}

async function main() {
  const code = (process.argv[2] || process.env.URAWA_COUPON_CODE || '').trim();
  if (!code) {
    log('クーポンコードが指定されていません。例: node src/coupon.js ABCD1234');
    return 1;
  }
  assertCredentials();

  log(`クーポンコード "${code}" を ${config.accounts.length} アカウントに入力します。`);
  const failed = [];
  const points = [];

  for (const account of config.accounts) {
    const { ok, result } = await withLogin(account, (page) => applyCoupon(page, account, code));
    if (!ok) {
      failed.push(account.label);
    } else if (result) {
      points.push({ label: account.label, points: result });
    }
  }

  const succeeded = config.accounts.length - failed.length;
  log(`結果: 成功 ${succeeded} / ${config.accounts.length}`);

  if (points.length > 0) {
    log(`ポイント: ${points.map((p) => `${p.label}=${p.points}`).join(' / ')}`);
    await savePoints(points).catch((error) => log(`ポイントの保存に失敗: ${error.message}`));
  }

  if (failed.length > 0) {
    log(`入力できなかったアカウント: ${failed.join(', ')}`);
    return 1;
  }
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
