import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACCOUNTS, SHARED_PASSWORD, VALID_VISIT_TOKEN, startServer, createChecker } from './mock-server.js';

/**
 * モックサイトに対して src/visit.js を動かし、
 * QR から読み取った URL 形式のポイント付与を確認する。
 */

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runVisit(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/visit.js', ...args], {
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
const workDir = path.join(rootDir, 'artifacts', 'test-visit');
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

// 1) 正しい URL → 2 アカウントにポイントが入る
const ok = await runVisit(baseEnv, [`${base}/coupon2/${VALID_VISIT_TOKEN}/`]);
console.log(ok.output);
check(ok.code === 0, '正しい URL なら終了コード 0');
check(
  ok.output.includes('[アカウント1] 表示されたメッセージ: 50ポイントを付与しました。'),
  'サイトの付与メッセージを記録する',
);
check(ok.output.includes('ポイント: アカウント1=150 / アカウント2=250'), '付与後のポイントを読み直す');

// 2) 同じ URL をもう一度 → 使用済みと判定して失敗にする
const again = await runVisit({ ...baseEnv, URAWA_RETRIES: '3' }, [`${base}/coupon2/${VALID_VISIT_TOKEN}/`]);
check(again.code === 1 && again.output.includes('すでに使用済み'), '使用済みの URL は失敗として扱う');
check(!again.output.includes('ログイン試行 2/3'), '拒否された URL は開き直さない');

// 3) 無効な URL → 失敗
const bad = await runVisit(baseEnv, [`${base}/coupon2/wrongtoken/`]);
check(bad.code === 1 && bad.output.includes('この URL は無効です'), '無効な URL を検知する');

// 4) URL 未指定 → 何もしない
const empty = await runVisit(baseEnv, []);
check(
  empty.code === 1 && empty.output.includes('URL が指定されていません'),
  'URL 未指定なら何もしない',
);

server.close();
console.log(state.failures === 0 ? '\nURL 付与のテストに合格しました。' : `\n${state.failures} 件のテストが失敗しました。`);
process.exit(state.failures === 0 ? 0 : 1);
