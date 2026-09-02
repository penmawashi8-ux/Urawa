import fs from 'node:fs/promises';
import path from 'node:path';

// 出力先。テストではリポジトリを汚さないよう URAWA_DATA_DIR で差し替える
const BASE_DIR = process.env.URAWA_DATA_DIR || '.';
const DATA_FILE = path.join(BASE_DIR, 'data', 'points.json');
const SUMMARY_FILE = path.join(BASE_DIR, 'POINTS.md');
const MAX_HISTORY = 90;

/** ページ本文から保有ポイントらしき数字を拾う。取れなければ null */
export function extractPoints(bodyText) {
  const text = bodyText.replace(/\s+/g, ' ');
  const patterns = [
    /(?:保有|現在の|所持|利用可能)\s*ポイント[^0-9]{0,20}([0-9][0-9,]*)/,
    /ポイント[^0-9]{0,10}([0-9][0-9,]*)\s*(?:pt|ポイント|P)\b/i,
    /([0-9][0-9,]*)\s*(?:pt|ポイント)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/,/g, '');
  }
  return null;
}

/** ポイントが読み取れなかったときに、原因調査用の抜粋を作る */
export function excerptAroundPoints(bodyText) {
  const text = bodyText.replace(/\s+/g, ' ');
  const index = text.search(/ポイント|pt\b/i);
  if (index < 0) return '「ポイント」という語がページ内に見つかりません。';
  return text.slice(Math.max(0, index - 60), index + 100);
}

/** JST の YYYY-MM-DD */
function todayJst() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/**
 * ポイントを data/points.json と POINTS.md に保存する。
 * 「最終確認」は日付までなので、値が変わらなければ 1 日 1 回しか差分が出ない。
 */
export async function savePoints(entries) {
  const date = todayJst();

  let store = { updated: date, latest: {}, history: [] };
  try {
    store = { ...store, ...JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) };
  } catch {
    // 初回はファイルが無いので、そのまま新規作成する
  }

  store.updated = date;
  for (const { label, points } of entries) {
    if (points === null || points === undefined) continue;
    if (store.latest[label] !== points) {
      store.history.push({ date, label, points });
    }
    store.latest[label] = points;
  }
  store.history = store.history.slice(-MAX_HISTORY);

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`);
  await fs.writeFile(SUMMARY_FILE, renderSummary(store));

  return store;
}

function renderSummary(store) {
  const labels = Object.keys(store.latest).sort();
  const rows = labels.map((label) => `| ${label} | ${store.latest[label]} |`).join('\n');
  const history = store.history
    .slice(-30)
    .reverse()
    .map((entry) => `- ${entry.date} ${entry.label}: ${entry.points}`)
    .join('\n');

  return `# 保有ポイント

最終確認: ${store.updated}（JST）

| アカウント | ポイント |
| --- | --- |
${rows || '| （まだ記録がありません） | - |'}

## 変化の履歴

${history || '（まだ記録がありません）'}

<!-- このファイルは毎日のログイン処理が自動更新します。手で編集しても次回上書きされます。 -->
`;
}
