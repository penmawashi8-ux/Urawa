import { config } from './config.js';
import { launchBrowser, dismissConsentBanner, saveScreenshot, log } from './browser.js';

/**
 * ログインページのフォーム構造を出力する調査用スクリプト。
 * 自動検出が外れたときに、どの name / id を指定すればよいか確認するために使う。
 * （認証情報は使わないので、パスワードを設定していなくても実行できる）
 */
const { browser, context } = await launchBrowser();
const page = await context.newPage();

log(`調査対象: ${config.loginUrl}`);
await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
await dismissConsentBanner(page);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

const forms = await page.evaluate(() =>
  Array.from(document.querySelectorAll('form')).map((form) => ({
    action: form.getAttribute('action'),
    method: form.getAttribute('method'),
    id: form.id || null,
    class: form.className || null,
    fields: Array.from(form.querySelectorAll('input, button, select, textarea')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id || null,
      placeholder: el.getAttribute('placeholder'),
      value: el.getAttribute('type') === 'hidden' ? '(hidden)' : null,
      text: (el.innerText || '').trim().slice(0, 40) || null,
    })),
  })),
);

console.log(`\nページタイトル: ${await page.title()}`);
console.log(`最終 URL: ${page.url()}`);
console.log(`\n見つかった form: ${forms.length} 件`);
console.log(JSON.stringify(forms, null, 2));

const hasCaptcha = await page.evaluate(() =>
  Boolean(
    document.querySelector(
      '.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .cf-turnstile',
    ),
  ),
);
console.log(`\nCAPTCHA らしき要素: ${hasCaptcha ? 'あり（自動化には追加対応が必要）' : 'なし'}`);

await saveScreenshot(page, 'inspect');
await browser.close();
