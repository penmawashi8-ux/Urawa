import { config, assertCredentials } from './config.js';
import { launchBrowser, dismissConsentBanner, log } from './browser.js';
import { attemptLogin } from './login-core.js';

/**
 * ログイン状態で任意のページを開き、フォーム構造と本文を出力する調査用スクリプト。
 *   node src/inspect-url.js https://urawakeiba-funclub.com/survey202609/
 * 1 つ目のアカウントだけを使い、送信は一切行わない。
 */
const url = (process.argv[2] || process.env.URAWA_INSPECT_URL || '').trim();
if (!url) {
  log('URL が指定されていません。例: node src/inspect-url.js https://example.com/page/');
  process.exit(1);
}
assertCredentials();

// 何番目のアカウントで開くか（既定は 1 つ目）
const index = Math.max(1, Number(process.env.URAWA_ACCOUNT_INDEX || 1)) - 1;
const account = config.accounts[index];
if (!account) {
  log(`アカウント${index + 1} は設定されていません。`);
  process.exit(1);
}
log(`${account.label} で開きます`);
const { browser, context } = await launchBrowser();
const { page } = await attemptLogin(context, account);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await dismissConsentBanner(page);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
log(`調査対象: ${page.url()}`);

const forms = await page.evaluate(() =>
  Array.from(document.querySelectorAll('form')).map((form) => ({
    action: form.getAttribute('action'),
    method: form.getAttribute('method'),
    id: form.id || null,
    fields: Array.from(form.querySelectorAll('input, button, select, textarea')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id || null,
      required: el.hasAttribute('required'),
      placeholder: el.getAttribute('placeholder'),
      value: el.getAttribute('type') === 'hidden' ? '(hidden)' : el.getAttribute('value'),
      // ラジオ・チェックボックスは、すぐ近くのラベル文言も拾う
      label:
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText?.trim()) ||
        el.closest('label')?.innerText?.trim() ||
        null,
      options:
        el.tagName.toLowerCase() === 'select'
          ? Array.from(el.options).map((o) => ({ value: o.value, text: o.text.trim() }))
          : undefined,
    })),
  })),
);

console.log('\n===== フォーム構造 =====');
console.log(JSON.stringify(forms, null, 2));

const body = await page.locator('body').innerText();
console.log('\n===== ページ本文 =====');
console.log(body.replace(/\n{3,}/g, '\n\n').slice(0, 4000));

await browser.close();
