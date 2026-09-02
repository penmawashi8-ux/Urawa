# 浦和競馬公式ファンクラブ 自動ログイン

[浦和競馬公式ファンクラブ](https://urawakeiba-funclub.com/signin/) に、自分のアカウントで**毎日自動ログイン**するためのスクリプトです。
ログインボーナスのポイント取り逃しを防ぐのが目的です。

Playwright（実際の Chromium を動かすブラウザ自動化）でログインフォームを操作し、GitHub Actions のスケジュール実行で毎日走らせます。

---

## 仕組み

1. `https://urawakeiba-funclub.com/signin/` を開く
2. ログイン ID / パスワードの入力欄を**自動検出**して入力（`input[name="log"]` など、よくあるパターンを順に試す）
3. 送信 → ログイン成功かどうかを判定（ログアウトリンクの有無・パスワード欄が残っていないか・URL の変化）
4. ログイン後にトップページを開く
5. 失敗したら最大 3 回リトライ。それでもダメなら終了コード 1 で終了し、そのときの画面を `artifacts/` にスクリーンショット保存

---

## セットアップ（まずローカルで動作確認）

```bash
npm install
npx playwright install chromium

cp .env.example .env
# .env に URAWA_EMAIL / URAWA_PASSWORD を記入

npm run login
```

`ログイン成功` と出れば OK です。画面を見ながら確認したいときは:

```bash
HEADFUL=1 npm run login
```

ローカルサイトを立てた動作テスト（本番サイトにはアクセスしません）:

```bash
npm test
```

---

## GitHub Actions で毎日自動実行する

1. このリポジトリを GitHub に push
2. リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で登録
   - `URAWA_EMAIL` … ログイン ID（メールアドレス）
   - `URAWA_PASSWORD` … パスワード
3. **Actions** タブ → 「毎日自動ログイン」→ **Run workflow** で手動実行し、成功するか確認
4. あとは毎日 **00:10 JST** と **12:00 JST** に自動実行されます（1 回目が失敗・遅延したときの保険として 2 回設定しています。二重ログインしても害はありません）

> GitHub Actions の cron は UTC 指定です。時刻を変えたい場合は `.github/workflows/daily-login.yml` の `cron` を「JST − 9 時間」で書き換えてください。
> また、実行時刻は GitHub の混雑状況で数分〜十数分ずれることがあります。

失敗するとワークフローが red になり、GitHub から通知メールが届きます（Actions の通知設定に従います）。そのときの画面のスクリーンショットは、実行ページの Artifacts からダウンロードできます。

---

## 入力欄の自動検出が外れた場合

サイトのフォーム構造が想定と違うと「パスワード入力欄が見つかりませんでした」で止まります。その場合は調査コマンドでフォームの中身を出力してください。

```bash
npm run inspect
```

`name` や `id`、CAPTCHA の有無が表示されるので、`.env`（GitHub 側なら Secrets ではなくワークフローの `env`）でセレクタを指定します。

```bash
URAWA_USER_SELECTOR=input[name="log"]
URAWA_PASS_SELECTOR=input[name="pwd"]
URAWA_SUBMIT_SELECTOR=input[type="submit"]
```

---

## PC のスケジューラで動かす場合

GitHub Actions を使わず、自宅 PC で回すこともできます。

- **macOS / Linux（crontab）** — 毎日 0:10 に実行:
  ```
  10 0 * * * cd /path/to/Urawa && /usr/bin/env node src/login.js >> cron.log 2>&1
  ```
- **Windows** — タスクスケジューラで `node src/login.js` を作業ディレクトリ指定で登録

PC がスリープしていると実行されない点に注意してください。

---

## 注意事項

- **CAPTCHA や 2 段階認証が入ると自動ログインはできません。** `npm run inspect` の CAPTCHA 判定で確認できます（現状は未確認 — 実際のページにアクセスできる環境で一度実行してください）。
- **アクセス元 IP**: GitHub Actions のランナーは海外 IP です。サイト側が海外からのログインを弾く場合は、PC のスケジューラや国内 VPS、セルフホストランナーで動かしてください。
- **60 日ルール**: GitHub の仕様で、リポジトリに 60 日間コミットなどの活動がないとスケジュール実行が自動停止します。停止したら Actions タブから再有効化してください。
- **パスワードの扱い**: `.env` は `.gitignore` 済みです。GitHub では必ず Secrets を使い、ソースやログに直接書かないでください（スクリプトはパスワードをログ出力しません）。
- 自分のアカウントへのログインを自動化するものです。サイトの利用規約が自動化を禁じていないか確認のうえ、自己責任でご利用ください。アクセスは 1 日数回だけで、サイトに負荷はかけません。

---

## ファイル構成

```
src/config.js     設定と、入力欄セレクタの候補リスト
src/browser.js    ブラウザ起動・要素検索・スクショの共通処理
src/login.js      ログイン本体（成功判定・リトライ）
src/inspect.js    フォーム構造の調査用
test/             ローカルのモックサイトを使った動作テスト
.github/workflows/daily-login.yml  毎日実行するワークフロー
```
