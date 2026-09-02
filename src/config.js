import 'dotenv/config';

/** カンマ区切りの環境変数をセレクタ配列にする（未設定なら null） */
function selectorList(value) {
  if (!value) return null;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

// ログイン ID 欄の候補。WordPress 系 / 一般的な会員サイトでよく使われる name を上から順に試す。
const DEFAULT_USER_SELECTORS = [
  'input[name="log"]',
  'input[name="user_login"]',
  'input[name="username"]',
  'input[name="userid"]',
  'input[name="user_id"]',
  'input[name="login_id"]',
  'input[name="mail"]',
  'input[name="email"]',
  'input[type="email"]',
  'input[name*="mail" i]',
  'input[name*="user" i]',
  'input[id*="mail" i]',
  'input[id*="user" i]',
  'form input[type="text"]',
];

const DEFAULT_PASS_SELECTORS = [
  'input[name="pwd"]',
  'input[name="password"]',
  'input[name="pass"]',
  'input[type="password"]',
];

const DEFAULT_SUBMIT_SELECTORS = [
  'form input[type="submit"]',
  'form button[type="submit"]',
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("ログイン")',
  'a:has-text("ログイン")[role="button"]',
  'button:has-text("サインイン")',
];

// Cookie 同意バナーなどが被っていると submit が押せないので、見つかったら閉じる。
const DEFAULT_CONSENT_SELECTORS = [
  'button:has-text("同意する")',
  'button:has-text("同意して閉じる")',
  'button:has-text("承諾")',
  'button:has-text("閉じる")',
  'button:has-text("OK")',
  'button:has-text("Accept")',
  '#cookie-accept',
  '.cookie-accept',
];

const MAX_ACCOUNTS = 10;

/**
 * 環境変数からアカウント一覧を組み立てる。
 *   1 件目: URAWA_EMAIL      / URAWA_PASSWORD
 *   2 件目以降: URAWA_EMAIL_2 / URAWA_PASSWORD_2 …（最大 10 件）
 * 片方だけ設定されている場合は設定漏れとして warnings に入れる。
 */
function collectAccounts() {
  const accounts = [];
  const warnings = [];

  for (let index = 1; index <= MAX_ACCOUNTS; index += 1) {
    const suffix = index === 1 ? '' : `_${index}`;
    const emailKey = `URAWA_EMAIL${suffix}`;
    const passwordKey = `URAWA_PASSWORD${suffix}`;
    const email = process.env[emailKey] || '';
    const password = process.env[passwordKey] || '';

    if (email && password) {
      accounts.push({ id: `account${index}`, label: `アカウント${index}`, email, password });
    } else if (email || password) {
      warnings.push(`${email ? passwordKey : emailKey} が未設定のため、アカウント${index} をスキップします。`);
    }
  }

  return { accounts, warnings };
}

const { accounts, warnings } = collectAccounts();

export const config = {
  loginUrl: process.env.URAWA_LOGIN_URL || 'https://urawakeiba-funclub.com/signin/',
  homeUrl: process.env.URAWA_HOME_URL || 'https://urawakeiba-funclub.com/',
  accounts,
  accountWarnings: warnings,

  headless: process.env.HEADFUL !== '1',
  // 既存の Chrome / Chromium を使いたい場合のみ指定（未指定なら Playwright 同梱版）
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  timeoutMs: Number(process.env.URAWA_TIMEOUT_MS || 30000),
  retries: Number(process.env.URAWA_RETRIES || 3),
  artifactDir: process.env.URAWA_ARTIFACT_DIR || 'artifacts',

  selectors: {
    user: selectorList(process.env.URAWA_USER_SELECTOR) || DEFAULT_USER_SELECTORS,
    pass: selectorList(process.env.URAWA_PASS_SELECTOR) || DEFAULT_PASS_SELECTORS,
    submit: selectorList(process.env.URAWA_SUBMIT_SELECTOR) || DEFAULT_SUBMIT_SELECTORS,
    consent: DEFAULT_CONSENT_SELECTORS,
  },
};

export function assertCredentials() {
  if (config.accounts.length === 0) {
    throw new Error(
      'URAWA_EMAIL / URAWA_PASSWORD が未設定です。.env（ローカル）または GitHub Secrets に設定してください。',
    );
  }
}
