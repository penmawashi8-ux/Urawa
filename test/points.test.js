import { extractPoints, excerptAroundPoints } from '../src/points.js';

/** ポイント抽出のパターンを、想定されるページ表記で確認する */
const cases = [
  ['保有ポイント 120 pt', '120'],
  ['保有ポイント：1,250ポイント', '1250'],
  ['現在のポイント 30', '30'],
  ['あなたのポイント数は 45 ポイントです', '45'],
  ['ようこそ！ 0 pt', '0'],
  ['ポイント交換はこちら', null], // 数字が無ければ拾わない
  ['お知らせ 2026年9月の開催日程', null], // 「ポイント」と無関係な数字は拾わない
];

let failures = 0;
for (const [input, expected] of cases) {
  const actual = extractPoints(input);
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}: "${input}" → ${actual}（期待値 ${expected}）`);
  if (!ok) failures += 1;
}

const excerpt = excerptAroundPoints('ヘッダー ナビ 保有ポイント交換 メニュー');
const excerptOk = excerpt.includes('ポイント');
console.log(`${excerptOk ? 'PASS' : 'FAIL'}: 読み取れないときは抜粋を返す`);
if (!excerptOk) failures += 1;

const noKeyword = excerptAroundPoints('ログインしました');
const noKeywordOk = noKeyword.includes('見つかりません');
console.log(`${noKeywordOk ? 'PASS' : 'FAIL'}: 「ポイント」が無いページはその旨を返す`);
if (!noKeywordOk) failures += 1;

process.exit(failures === 0 ? 0 : 1);
