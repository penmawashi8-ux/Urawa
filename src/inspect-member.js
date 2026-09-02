import { config, assertCredentials } from './config.js';
import { launchBrowser, findFirstVisible, dismissConsentBanner, log } from './browser.js';
import { attemptLogin } from './login-core.js';

/**
 * ログイン後のページ構造を調べる調査用スクリプト。
 * マイページのリンク一覧と、クーポンコード入力ページのフォーム構造を出力する。
 * 1 つ目のアカウントだけを使い、コードの送信は行わない。
 */
const account = config.accounts[0];
assertCredentials();

const { browser, context } = await launchBrowser();
const { page } = await attemptLogin(context, account);
log(`ログイン後の URL: ${page.url()}`);

const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a'))
    .map((a) => ({ text: (a.innerText || '').trim().slice(0, 30), href: a.href }))
    .filter((link) => link.text),
);
console.log('\n===== マイページのリンク一覧 =====');
console.log(JSON.stringify(links, null, 2));

// クーポン入力ページへのリンクを探す
const couponLink = links.find(
  (link) => /クーポン|coupon/i.test(link.text) || /coupon/i.test(link.href),
);
console.log(`\nクーポン入力ページ: ${couponLink ? couponLink.href : '見つかりませんでした'}`);

if (couponLink) {
  await page.goto(couponLink.href, { waitUntil: 'domcontentloaded' });
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
        text: (el.innerText || el.getAttribute('value') || '').trim().slice(0, 30) || null,
      })),
    })),
  );
  console.log('\n===== クーポン入力ページのフォーム =====');
  console.log(`URL: ${page.url()}`);
  console.log(JSON.stringify(forms, null, 2));

  const bodyText = await page.locator('body').innerText();
  console.log('\n===== ページ本文（先頭 800 文字）=====');
  console.log(bodyText.replace(/\n{3,}/g, '\n\n').slice(0, 800));
}

await browser.close();
