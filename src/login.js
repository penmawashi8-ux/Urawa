import { config, assertCredentials } from './config.js';
import { savePoints } from './points.js';
import { withLogin, readPoints } from './login-core.js';
import { log } from './browser.js';

/** 1 アカウント分：ログインしてサイトを開き、ポイントを読む */
async function loginAccount(account) {
  const { ok, result } = await withLogin(account, async (page) => {
    // ログイン後にサイトを一度開く（ログインボーナスの判定がトップ側の場合に備える）
    if (config.homeUrl && !page.url().startsWith(config.homeUrl)) {
      log(`[${account.label}] サイトを開きます: ${config.homeUrl}`);
      await page.goto(config.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
    return readPoints(page, account);
  });

  return { ok, points: ok ? result : null };
}

async function main() {
  assertCredentials();
  config.accountWarnings.forEach((warning) => log(`警告: ${warning}`));

  log(`対象アカウント数: ${config.accounts.length}`);

  const shared = config.accounts.filter((a) => a.sharedPassword).map((a) => a.label);
  if (shared.length > 0) {
    log(`${shared.join(' / ')} は 1 つ目のパスワード（URAWA_PASSWORD）を使います。`);
  }
  const failed = [];
  const points = [];

  for (const account of config.accounts) {
    const result = await loginAccount(account);
    if (!result.ok) failed.push(account.label);
    if (result.points !== null && result.points !== undefined) {
      points.push({ label: account.label, points: result.points });
    }
  }

  const succeeded = config.accounts.length - failed.length;
  log(`結果: 成功 ${succeeded} / ${config.accounts.length}`);

  if (points.length > 0) {
    log(`ポイント: ${points.map((p) => `${p.label}=${p.points}`).join(' / ')}`);
    // POINTS.md / data/points.json を更新する（ワークフローが差分をコミットする）
    await savePoints(points).catch((error) => log(`ポイントの保存に失敗: ${error.message}`));
  }

  if (failed.length > 0) {
    log(`失敗したアカウント: ${failed.join(', ')}`);
    return 1;
  }

  log('すべてのアカウントでログインできました。');
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
