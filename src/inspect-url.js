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

console.log(`\n===== フォーム数: ${forms.length} =====`);

// 設問と選択肢を、入力欄の name 単位でまとめて一覧にする
const questions = await page.evaluate(() => {
  const groups = new Map();
  for (const el of document.querySelectorAll('input[type="radio"], input[type="checkbox"], select, textarea, input[type="text"], input[type="number"]')) {
    const name = el.getAttribute('name') || '(名前なし)';
    if (!groups.has(name)) groups.set(name, { name, type: el.type || el.tagName.toLowerCase(), options: [] });
    const g = groups.get(name);
    const label =
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText?.trim()) ||
      el.closest('label')?.innerText?.trim() ||
      null;
    if (label && !g.options.includes(label)) g.options.push(label);
    if (!g.heading) {
      // 近くの見出し・説明文を設問文として拾う
      let node = el.closest('li, tr, div, fieldset');
      for (let i = 0; i < 4 && node; i += 1) {
        const text = (node.innerText || '').trim().split('\n')[0];
        if (text && text.length > 6) { g.heading = text.slice(0, 120); break; }
        node = node.parentElement;
      }
    }
  }
  return [...groups.values()];
});

console.log('\n===== 設問一覧 =====');
console.log(`入力欄グループ数: ${questions.length}`);
questions.forEach((q, i) => {
  console.log(`\n[${i + 1}] name=${q.name} (${q.type})`);
  if (q.heading) console.log(`  設問: ${q.heading}`);
  if (q.options.length) console.log(`  選択肢: ${q.options.slice(0, 40).join(' / ')}`);
});

await browser.close();
