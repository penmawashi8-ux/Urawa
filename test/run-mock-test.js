import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACCOUNTS, SHARED_PASSWORD, startServer, createChecker } from './mock-server.js';

/**
 * モックサイトに対して src/login.js を動かし、
 * 複数アカウントの処理・成否判定・ポイント記録を確認する。
 */

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runLogin(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/login.js'], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

const server = await startServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const workDir = path.join(rootDir, 'artifacts', 'test');
const baseEnv = {
  URAWA_LOGIN_URL: `${base}/signin/`,
  URAWA_HOME_URL: `${base}/`,
  URAWA_POINTS_URL: `${base}/mypage/`,
  URAWA_ARTIFACT_DIR: workDir,
  URAWA_DATA_DIR: workDir, // POINTS.md をリポジトリ直下に書かないようにする
  URAWA_RETRIES: '1',
};

const { state, check } = createChecker();

// 1) 2 アカウントとも正しい → 両方成功して終了コード 0
const both = await runLogin({
  ...baseEnv,
  URAWA_EMAIL: ACCOUNTS[0].email,
  URAWA_PASSWORD: SHARED_PASSWORD,
  URAWA_EMAIL_2: ACCOUNTS[1].email,
  URAWA_PASSWORD_2: ACCOUNTS[1].password,
});
console.log(both.output);
check(both.code === 0, '2 アカウントとも成功して終了コード 0');
check(both.output.includes('対象アカウント数: 2'), '2 アカウントを認識する');
check(both.output.includes('[アカウント1] ログイン成功'), 'アカウント1 がログインできる');
check(both.output.includes('[アカウント2] ログイン成功'), 'アカウント2 がログインできる');

// 2) 2 件目だけパスワードが誤り → 1 件目は成功したうえで終了コード 1
const partial = await runLogin({
  ...baseEnv,
  URAWA_EMAIL: ACCOUNTS[0].email,
  URAWA_PASSWORD: SHARED_PASSWORD,
  URAWA_EMAIL_2: ACCOUNTS[1].email,
  URAWA_PASSWORD_2: 'wrong-password',
});
console.log(partial.output);
check(partial.code === 1, '1 件でも失敗したら終了コード 1');
check(partial.output.includes('[アカウント1] ログイン成功'), '失敗があっても他アカウントは処理される');
check(partial.output.includes('結果: 成功 1 / 2'), '成功／失敗の件数を集計する');
check(partial.output.includes('パスワードが違います'), 'サイト側のエラーメッセージを拾う');

// 3) 実際の Secrets 設定と同じ形: "_" なしのメール 2 件＋パスワードは 1 つだけ
const sharedPassword = await runLogin({
  ...baseEnv,
  URAWA_EMAIL: ACCOUNTS[0].email,
  URAWA_PASSWORD: SHARED_PASSWORD,
  URAWA_EMAIL2: ACCOUNTS[1].email,
  URAWA_EMAIL3: ACCOUNTS[2].email,
});
console.log(sharedPassword.output);
check(sharedPassword.output.includes('対象アカウント数: 3'), '"_" なしの環境変数名も認識する');
check(
  sharedPassword.output.includes('アカウント2 / アカウント3 は 1 つ目のパスワード'),
  '番号付きパスワードが無ければ 1 つ目のパスワードを使う',
);
check(sharedPassword.code === 0 && sharedPassword.output.includes('結果: 成功 3 / 3'), '3 アカウントともログインできる');
check(
  sharedPassword.output.includes('ポイント: アカウント1=100 / アカウント2=200 / アカウント3=300'),
  'アカウントごとのポイントを取り違えずに読み取る',
);

const summary = await fs.readFile(path.join(workDir, 'POINTS.md'), 'utf8').catch(() => '');
check(
  summary.includes('| アカウント2 | 200 |') && summary.includes('# 保有ポイント'),
  'POINTS.md にポイント一覧を書き出す',
);
const stored = JSON.parse(await fs.readFile(path.join(workDir, 'data', 'points.json'), 'utf8').catch(() => '{}'));
check(stored.latest?.アカウント3 === '300', 'data/points.json に最新値を保存する');

// 4) メールが無いのにパスワードだけある → 設定漏れとして警告しスキップ
const orphanPassword = await runLogin({
  ...baseEnv,
  URAWA_EMAIL: ACCOUNTS[0].email,
  URAWA_PASSWORD: SHARED_PASSWORD,
  URAWA_PASSWORD_2: 'no-email-for-this',
});
check(
  orphanPassword.code === 0 && orphanPassword.output.includes('URAWA_EMAIL_2 が未設定'),
  'メールだけ無い場合は警告してスキップする',
);

server.close();
console.log(state.failures === 0 ? '\nログインのテストに合格しました。' : `\n${state.failures} 件のテストが失敗しました。`);
process.exit(state.failures === 0 ? 0 : 1);
