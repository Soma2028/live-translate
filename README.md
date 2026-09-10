# 翻訳中継サーバー（Cloudflare Worker）

`call.html` は翻訳を直接呼ばず、`worker/` にあるCloudflare Workerを経由する。
翻訳の主経路はAzure Translator。Workers AI（LLM、友人同士のくだけた口調・反말/タメ口で
訳すようプロンプトで指示したもの）も実装は残っており、`worker/index.js` 先頭の
`PRIMARY_ENGINE` フラグ（`"azure"` / `"workers-ai"`）を書き換えるだけで切り替えられる。
どちらを主経路にしても、失敗時はもう一方に自動でフォールバックする。

## 事前準備

- Cloudflareアカウント（<https://dash.cloudflare.com/>）。Workers AIは追加のアカウント設定不要（`wrangler.toml`の`[ai]` bindingだけで使える）
- `npm install -g wrangler`（または毎回 `npx wrangler` でもよい）
- `wrangler login`
- Azure Portalで Translator リソースを作成し、キーとリージョンを控えておく（フォールバック用）

## デプロイ手順

`worker/` ディレクトリで実行する。

```bash
cd worker

# シークレットを登録する（値はコードに書かない。対話式で値を聞かれる）
wrangler secret put AZURE_TRANSLATOR_KEY
wrangler secret put AZURE_TRANSLATOR_REGION

# デプロイ
wrangler deploy
```

デプロイが終わると `https://live-translate-translator.<あなたのサブドメイン>.workers.dev` のようなURLが表示される。

## アプリ側の設定

表示されたURLを `call.html` 内の `TRANSLATE_WORKER_URL` に書き写す。

```js
const TRANSLATE_WORKER_URL = "https://live-translate-translator.xxxx.workers.dev";
```

書き換えたらコミットしてGitHub Pagesにpushする。

## 制限（Worker側で強制している内容）

- 許可オリジン: `https://soma2028.github.io` と `http://localhost:8000` のみ（CORSに加え、サーバー側でも拒否）
- レート制限: 同一IPから1分あたり60回まで（Worker内メモリでの簡易カウントのため、複数拠点・複数アイソレートをまたぐと厳密ではない。2人だけの私用アプリという前提での簡易対策）
- 1リクエストの `text` は1〜2000文字
- 主経路の切り替え: `worker/index.js` 先頭の `PRIMARY_ENGINE`（`"azure"` か `"workers-ai"`）
- Workers AIのモデルは `WORKERS_AI_MODEL` 定数で変更できる（現在は `@cf/qwen/qwen3.8-27b`）

## ローカルで動作確認する場合

```bash
cd worker
wrangler dev
```

`http://localhost:8000` をOriginとして許可しているので、`call.html` をローカルサーバー（`python3 -m http.server 8000` など）で開いてテストできる。
