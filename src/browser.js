import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';

/** 日本時間のタイムスタンプ付きでログ出力する */
export function log(message) {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`[${now}] ${message}`);
}

/** JST の YYYY-MM-DD-HHmmss（ファイル名用） */
export function stampJst(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

/** 実ブラウザに近い設定（日本語・東京時間）でブラウザを起動する */
export async function launchBrowser() {
  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: config.executablePath,
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
  context.setDefaultTimeout(config.timeoutMs);
  context.setDefaultNavigationTimeout(config.timeoutMs);
  return { browser, context };
}

/** 候補セレクタを順に試して、最初に見つかった表示中の要素を返す */
export async function findFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) return { locator, selector };
  }
  return null;
}

/** Cookie 同意バナーなどが出ていれば閉じる（無ければ何もしない） */
export async function dismissConsentBanner(page) {
  const found = await findFirstVisible(page, config.selectors.consent);
  if (!found) return;
  await found.locator.click({ timeout: 3000 }).catch(() => {});
  log(`同意バナーを閉じました (${found.selector})`);
}

/** スクリーンショットを artifacts/ に保存してパスを返す */
export async function saveScreenshot(page, label) {
  try {
    await fs.mkdir(config.artifactDir, { recursive: true });
    const file = path.join(config.artifactDir, `${stampJst()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log(`スクリーンショットを保存しました: ${file}`);
    return file;
  } catch (error) {
    log(`スクリーンショットの保存に失敗: ${error.message}`);
    return null;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
