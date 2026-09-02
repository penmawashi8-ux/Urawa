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

## セットアップ（スマホだけで完結します）

PC は不要です。ブラウザで GitHub を開いて操作してください（GitHub モバイルアプリでは Secrets の設定ができないので、**ブラウザで github.com を開く**のがポイント。表示が崩れるときはブラウザの「デスクトップ用サイト」表示に切り替えてください）。

1. このリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で 2 つ登録
   - `URAWA_EMAIL` … ログイン ID（メールアドレス）
   - `URAWA_PASSWORD` … パスワード
2. **Actions** タブ → 左の「毎日自動ログイン」→ **Run workflow** で手動実行
3. 実行結果が緑（成功）なら完了。あとは毎日 **00:10 JST** と **12:00 JST** に自動実行されます
   （1 回目が失敗・遅延したときの保険で 2 回。二重にログインしても害はありません）

> GitHub Actions の cron は UTC 指定です。時刻を変えたい場合は `.github/workflows/daily-login.yml` の `cron` を「JST − 9 時間」で書き換えてください。
> また、実行時刻は GitHub の混雑状況で数分〜十数分ずれることがあります。

> GitHub Actions の cron は UTC 指定です。時刻を変えたい場合は `.github/workflows/daily-login.yml` の `cron` を「JST − 9 時間」で書き換えてください。
> また、実行時刻は GitHub の混雑状況で数分〜十数分ずれることがあります。

失敗するとワークフローが red になり、GitHub から通知メールが届きます（Actions の通知設定に従います）。そのときの画面のスクリーンショットは、実行ページの Artifacts からダウンロードできます。

---

## 入力欄の自動検出が外れた場合

サイトのフォーム構造が想定と違うと「パスワード入力欄が見つかりませんでした」で止まります。
その場合、**失敗したワークフローの実行ログに、ログインフォームの中身（input の `name` / `id`、CAPTCHA の有無）が自動で出力されます**。Actions の該当実行を開いて「失敗時にログインフォームの構造を出力」のログを見てください。

いつでも手動で調べたいときは、**Actions → 「ログインフォームを調べる」→ Run workflow**（認証情報を使わないので安全です）。

出てきた `name` / `id` に合わせて、`.github/workflows/daily-login.yml` の「ログイン実行」ステップの `env:` に追記すれば、検出結果を上書きできます。

```yaml
      - name: ログイン実行
        env:
          URAWA_EMAIL: ${{ secrets.URAWA_EMAIL }}
          URAWA_PASSWORD: ${{ secrets.URAWA_PASSWORD }}
          URAWA_USER_SELECTOR: 'input[name="log"]'
          URAWA_PASS_SELECTOR: 'input[name="pwd"]'
          URAWA_SUBMIT_SELECTOR: 'input[type="submit"]'
        run: npm run login
```

---

## PC がある場合（任意）

ローカルで動かして確認することもできます。

```bash
npm install && npx playwright install chromium
cp .env.example .env   # URAWA_EMAIL / URAWA_PASSWORD を記入
npm run login          # HEADFUL=1 を付けるとブラウザ画面が見えます
npm test               # モックサイトを使った動作テスト（本番にはアクセスしません）
```

crontab（macOS / Linux）で回す場合の例:

```
10 0 * * * cd /path/to/Urawa && /usr/bin/env node src/login.js >> cron.log 2>&1
```

---

## 注意事項

- **CAPTCHA や 2 段階認証が入ると自動ログインはできません。** 「ログインフォームを調べる」ワークフローの CAPTCHA 判定で確認できます（実サイトでは未確認のため、まずこれを実行するのが確実です）。
- **アクセス元 IP**: GitHub Actions のランナーは海外 IP です。サイト側が海外からのログインを弾く場合は、国内 VPS やセルフホストランナー、PC のスケジューラで動かす必要があります。
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
.github/workflows/inspect.yml      フォーム構造を手動で調べるワークフロー
```
