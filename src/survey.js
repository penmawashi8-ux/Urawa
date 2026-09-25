import { config, assertCredentials } from './config.js';
import { withLogin } from './login-core.js';
import { log, saveScreenshot } from './browser.js';

/**
 * 2026 年 9 月のアンケートに回答する。
 *   node src/survey.js            … 入力するだけ（送信しない・内容をログに出す）
 *   URAWA_SURVEY_SUBMIT=1 node …  … 実際に送信する
 *
 * 属性（性別・年齢・住所）は本人の実際の情報を使う。
 * それ以外の設問は、意見を作らずに「分からない」「どちらともいえない」などの
 * 非回答の選択肢を選ぶ。
 */

const SURVEY_URL = process.env.URAWA_SURVEY_URL || 'https://urawakeiba-funclub.com/survey202609/';
const SUBMIT = process.env.URAWA_SURVEY_SUBMIT === '1';

// アカウントごとの実際の属性
const PROFILES = {
  account2: { sex: '男性', age: '50', prefecture: '東京23区内', ward: '練馬区' },
  account3: { sex: '女性', age: '50', prefecture: '東京23区内', ward: '練馬区' },
};

// 意見を問う設問で選ぶ、非回答にあたる選択肢
const NEUTRAL_IMAGE = '特にイメージが無い・分からない';
const NEUTRAL_WEB_SNS = '知らない・当てはまるものはない';
const NEUTRAL_FUNCLUB = 'どちらともいえない';
const NEUTRAL_SITUATION = '購入したことはない';

const IMAGE_FIELDS = [
  'question_image_urawa[]',
  'question_image_tck[]',
  'question_image_funabashi[]',
  'question_image_kawasaki[]',
  'question_image_jra[]',
];

const WEB_SNS_FIELDS = [
  'question_web_sns_wallpaper',
  'question_web_sns_mailmagazine',
  'question_web_sns_onlineevent',
  'question_web_sns_present',
  'question_web_sns_invitation',
  'question_web_sns_post',
  'question_web_sns_youtube_live',
  'question_web_sns_youtube',
  'question_web_sns_netkeiba',
  'question_web_sns_homepage',
];

const FUNCLUB_FIELDS = ['question_funclub_design', 'question_funclub_responsive', 'question_funclub_contents'];

/** ラジオ／チェックボックスを、ラベル文言で選ぶ */
async function choose(page, name, labelText, chosen) {
  const inputs = page.locator(`input[name="${name.replace(/"/g, '\\"')}"]`);
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const id = await input.getAttribute('id');
    let label = '';
    if (id) label = (await page.locator(`label[for="${id}"]`).first().innerText().catch(() => '')).trim();
    if (!label) label = (await input.locator('xpath=ancestor::label[1]').first().innerText().catch(() => '')).trim();
    if (label.includes(labelText)) {
      await input.check({ force: true });
      chosen.push(`${name} = ${label.replace(/\s+/g, ' ')}`);
      return true;
    }
  }
  chosen.push(`${name} = （"${labelText}" が見つからず未選択）`);
  return false;
}

/** アンケートに入力する。submit=false なら送信しない */
async function fillSurvey(page, account) {
  const profile = PROFILES[account.id];
  if (!profile) throw new Error(`${account.label} の回答内容が設定されていません。`);

  await page.goto(SURVEY_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const body = await page.locator('body').innerText().catch(() => '');
  if (body.includes('すでにご回答済み')) {
    const error = new Error('すでに回答済みです。');
    error.noRetry = true;
    throw error;
  }

  const chosen = [];

  // 属性（実際の情報）
  await choose(page, 'question_sex', profile.sex, chosen);
  await page.locator('input[name="question_age"]').first().fill(profile.age);
  chosen.push(`question_age = ${profile.age}`);
  await choose(page, 'question_prefecture', profile.prefecture, chosen);
  await choose(page, 'question_prefecture-tokyo', profile.ward, chosen);

  // 馬券の購入頻度（プルダウン）: 最後の選択肢＝購入しない系を選ぶ
  for (const name of ['question_buy_1', 'question_buy_2', 'question_buy_3', 'question_buy_4']) {
    const select = page.locator(`select[name="${name}"]`).first();
    if ((await select.count()) === 0) continue;
    const options = await select.locator('option').allInnerTexts();
    const target =
      options.find((o) => /購入しない|購入したことがない|利用しない|ない$/.test(o.trim())) ||
      options[options.length - 1];
    await select.selectOption({ label: target });
    chosen.push(`${name} = ${target.trim()}`);
  }

  // 購入する状況（複数選択）
  for (const name of ['question_situation_1[]', 'question_situation_2[]']) {
    await choose(page, name, NEUTRAL_SITUATION, chosen);
  }

  // 各競馬場のイメージ（複数選択）
  for (const name of IMAGE_FIELDS) {
    await choose(page, name, NEUTRAL_IMAGE, chosen);
  }

  // SNS・WEB 施策の認知
  for (const name of WEB_SNS_FIELDS) {
    await choose(page, name, NEUTRAL_WEB_SNS, chosen);
  }

  // ファンクラブサイトの評価
  for (const name of FUNCLUB_FIELDS) {
    await choose(page, name, NEUTRAL_FUNCLUB, chosen);
  }

  // 推奨度は 0〜10 点しか無く「分からない」が無いため、中央の 5 点を選ぶ
  await choose(page, 'question_funclub_recommend', '5点', chosen);

  // 自由記述は空欄のままにする（必須なら「特にありません」を入れる）
  for (const name of ['question_reason_recommend', 'question_request_contents', 'question_free_request']) {
    const area = page.locator(`textarea[name="${name}"]`).first();
    if ((await area.count()) === 0) continue;
    if (await area.evaluate((el) => el.hasAttribute('required')).catch(() => false)) {
      await area.fill('特にありません');
      chosen.push(`${name} = 特にありません（必須のため）`);
    } else {
      chosen.push(`${name} = （空欄）`);
    }
  }

  log(`[${account.label}] 入力内容:`);
  chosen.forEach((line) => log(`    ${line}`));

  await saveScreenshot(page, `survey-${account.id}-${SUBMIT ? 'submit' : 'dryrun'}`);

  if (!SUBMIT) {
    log(`[${account.label}] 確認モードのため送信しません。`);
    return '確認のみ';
  }

  const submit = page.locator('form input[type="submit"], form button[type="submit"]').first();
  await submit.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const after = await page.locator('body').innerText().catch(() => '');
  const message = after.replace(/\s+/g, ' ').slice(0, 300);
  log(`[${account.label}] 送信後の画面: ${message}`);
  await saveScreenshot(page, `survey-${account.id}-after`);
  return message;
}

async function main() {
  assertCredentials();
  log(SUBMIT ? '送信モードで実行します。' : '確認モード（送信しません）で実行します。');

  const targets = (process.env.URAWA_SURVEY_ACCOUNTS || 'account2,account3')
    .split(',')
    .map((s) => s.trim());
  const failed = [];

  for (const account of config.accounts) {
    if (!targets.includes(account.id)) continue;
    const { ok } = await withLogin(account, (page) => fillSurvey(page, account));
    if (!ok) failed.push(account.label);
  }

  if (failed.length > 0) {
    log(`できなかったアカウント: ${failed.join(', ')}`);
    return 1;
  }
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
