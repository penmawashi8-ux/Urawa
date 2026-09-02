import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACCOUNTS, SHARED_PASSWORD, VALID_COUPON, startServer, createChecker } from './mock-server.js';

/**
 * モックサイトに対して src/coupon.js を動かし、
 * クーポンコードの一括入力と、失敗時の扱いを確認する。
 */

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runCoupon(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/coupon.js', ...args], {
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
const workDir = path.join(rootDir, 'artifacts', 'test-coupon');
const baseEnv = {
  URAWA_LOGIN_URL: `${base}/signin/`,
  URAWA_HOME_URL: `${base}/`,
  URAWA_POINTS_URL: `${base}/mypage/`,
  URAWA_ARTIFACT_DIR: workDir,
  URAWA_DATA_DIR: workDir,
  URAWA_RETRIES: '1',
  URAWA_EMAIL: ACCOUNTS[0].email,
  URAWA_PASSWORD: SHARED_PASSWORD,
  URAWA_EMAIL_2: ACCOUNTS[1].email,
};

const { state, check } = createChecker();

// 1) 正しいコード → 2 アカウントに入り、ポイントが増える
const ok = await runCoupon(baseEnv, [VALID_COUPON]);
console.log(ok.output);
check(ok.code === 0, '正しいコードなら終了コード 0');
check(
  ok.output.includes('[アカウント1] 送信後のメッセージ: 50ポイントを付与しました。'),
  'サイトの結果メッセージを記録する',
);
check(
  ok.output.includes('ポイント: アカウント1=150 / アカウント2=250'),
  '付与後のポイントを読み直す',
);
const summary = await fs.readFile(path.join(workDir, 'POINTS.md'), 'utf8').catch(() => '');
check(summary.includes('| アカウント2 | 250 |'), 'POINTS.md を更新する');

// 2) 無効なコード → 全アカウント失敗で終了コード 1。拒否は確定なのでリトライしない
const ng = await runCoupon({ ...baseEnv, URAWA_RETRIES: '3' }, ['WRONGCODE']);
check(ng.code === 1, '無効なコードなら終了コード 1');
check(ng.output.includes('クーポンコードが無効です'), 'サイトのエラーメッセージを拾う');
check(
  !ng.output.includes('ログイン試行 2/3'),
  '拒否されたコードは再送信しない（サイトに無駄な負荷をかけない）',
);

// 3) 使用済みのコード → 使用済みと判定して失敗にする（1 回目で使用済みになっている）
const used = await runCoupon(baseEnv, [VALID_COUPON]);
check(
  used.code === 1 && used.output.includes('すでに使用済み'),
  '使用済みのコードは受け付けられなかったと判定する',
);

// 4) コード未指定 → 何もせず終了コード 1
const empty = await runCoupon(baseEnv, []);
check(
  empty.code === 1 && empty.output.includes('クーポンコードが指定されていません'),
  'コード未指定なら何もしない',
);

server.close();
console.log(state.failures === 0 ? '\nクーポンのテストに合格しました。' : `\n${state.failures} 件のテストが失敗しました。`);
process.exit(state.failures === 0 ? 0 : 1);
