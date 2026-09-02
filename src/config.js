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

/** 複数の環境変数名のうち、最初に値が入っているものを返す */
function envValue(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return '';
}

/**
 * 環境変数からアカウント一覧を組み立てる。
 *   1 件目: URAWA_EMAIL / URAWA_PASSWORD
 *   2 件目以降: URAWA_EMAIL_2 / URAWA_PASSWORD_2（URAWA_EMAIL2 のように "_" なしでも可）
 * 番号付きのパスワードが無い場合は 1 件目のパスワードを使う（全アカウント同じパスワードのケース）。
 * メールアドレスが無いのにパスワードだけある場合は、設定漏れとして warnings に入れる。
 */
function collectAccounts() {
  const accounts = [];
  const warnings = [];
  const basePassword = process.env.URAWA_PASSWORD || '';

  for (let index = 1; index <= MAX_ACCOUNTS; index += 1) {
    const email =
      index === 1 ? process.env.URAWA_EMAIL || '' : envValue(`URAWA_EMAIL_${index}`, `URAWA_EMAIL${index}`);
    const ownPassword =
      index === 1 ? basePassword : envValue(`URAWA_PASSWORD_${index}`, `URAWA_PASSWORD${index}`);
    const password = ownPassword || basePassword;

    if (!email) {
      if (ownPassword && index > 1) {
        warnings.push(`URAWA_EMAIL_${index} が未設定のため、アカウント${index} をスキップします。`);
      }
      continue;
    }

    if (!password) {
      warnings.push(`アカウント${index} のパスワードが未設定のためスキップします。`);
      continue;
    }

    accounts.push({
      id: `account${index}`,
      label: `アカウント${index}`,
      email,
      password,
      sharedPassword: index > 1 && !ownPassword,
    });
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
