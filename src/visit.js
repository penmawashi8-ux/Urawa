import { config, assertCredentials } from './config.js';
import { withLogin, readPoints, readErrorMessage } from './login-core.js';
import { findFirstVisible, log } from './browser.js';
import { savePoints } from './points.js';

/**
 * ポイント付与 URL（QR コードの中身など）を、ログイン状態で全アカウント分開く。
 *   node src/visit.js https://urawakeiba-funclub.com/coupon2/xxxx/
 * URL は引数か URAWA_VISIT_URL で渡す。
 */

// 付与結果のお知らせが入りやすい場所
const NOTICE_SELECTORS = [
  '.notice',
  '.message',
  '.alert',
  '.woocommerce-message',
  '.entry-content p:has-text("ポイント")',
];

/** 画面本文から、結果らしき一文を拾う */
function firstNotice(bodyText) {
  const text = bodyText.replace(/\s+/g, ' ');
  const match = text.match(
    /[^。]{0,60}(?:ポイント|クーポン|URL)[^。]{0,60}(?:しました|されました|できません|ください|です)[^。]{0,20}/,
  );
  return match ? match[0].trim().slice(0, 200) : null;
}

/** 1 アカウント分：URL を開いて結果を読む */
async function openVisitUrl(page, account, url) {
  log(`[${account.label}] URL を開きます`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const body = await page.locator('body').innerText().catch(() => '');
  const notice = await findFirstVisible(page, NOTICE_SELECTORS);
  const noticeText = notice ? (await notice.locator.innerText().catch(() => '')).trim() : '';
  const message = (await readErrorMessage(page)) || noticeText || firstNotice(body);
  log(`[${account.label}] 表示されたメッセージ: ${message || '（取得できませんでした）'}`);

  if (/無効|不正|期限|終了|既に|すでに|使用済|エラー|できません/.test(message || '')) {
    // サイトが明確に拒否した場合は繰り返しても同じなのでリトライしない
    const error = new Error(`受け付けられませんでした: ${message}`);
    error.noRetry = true;
    throw error;
  }

  return readPoints(page, account);
}

async function main() {
  const url = (process.argv[2] || process.env.URAWA_VISIT_URL || '').trim();
  if (!url) {
    log('URL が指定されていません。例: node src/visit.js https://urawakeiba-funclub.com/coupon2/xxxx/');
    return 1;
  }
  assertCredentials();

  log(`URL を ${config.accounts.length} アカウントで開きます: ${url}`);
  const failed = [];
  const points = [];

  for (const account of config.accounts) {
    const { ok, result } = await withLogin(account, (page) => openVisitUrl(page, account, url));
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
    log(`開けなかったアカウント: ${failed.join(', ')}`);
    return 1;
  }
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
