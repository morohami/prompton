# Prompton 点検報告（fable・2026-11-11）

対象：`morohami/prompton` の `main`（コミット `e685e7a`）。全ソース（index.html / js/*.js / sw.js / css の構造 / i18n / functions / workflow / script）を通読し、manifest.json・htmls/・thumbs/・p/ をスクリプトで照合し、ローカル静的サーバー（ポート 3459）で訪問者状態（PAT なし）として実際に開いて確認した。コードの変更はしていない。

確かめ方の表記：**実際に開いた**＝ブラウザで再現／**照合**＝スクリプトで全件突合／**読解**＝コードを読んだだけ。

## 壊れている

| # | 場所 | 内容 | 確かめ方 |
|---|---|---|---|
| F1 | `js/render.js` 742–744 | ホームの「Made for you」だけ `isListed` を通しておらず、unlisted の `prompton-handoff` と `_folder_demo` が訪問者に出る | 実際に開いた |
| F2 | `js/render.js` 1489、`index.html` 939–949 | 「別タブで開く」と全画面失敗時の逃げ先が `htmls/<id>.html` 固定。フォルダ型3件・md型1件は 404。同じ原因で詳細の容量表示が「0.0 KB」、フォークも空ファイル | 実際に開いた（404 と 0.0 KB を確認） |
| F3 | `js/render.js` 1948・1876、`index.html` 150–158 | モデル選択肢がない値（`Claude Sonnet 4.5` 2件）の編集フォームは先頭の「AI」を選んで開く。保存するとモデルが書き換わる。選択肢が3か所に重複 | 実際に開いた |
| F4 | `index.html` 1352–1362 | 設定画面で言語ボタンを押すと、再描画の分岐に設定がなくギャラリーへ飛ぶ | 実際に開いた |
| F5 | `index.html` 1536・1644、`js/github.js` | 訪問者のプレイリスト・プロフィール編集・投票は起動時にリモートで上書きされ消える。プロフィールは GitHub へ書く処理が存在しない | 読解＋リロード挙動 |
| F6 | `index.html` 646–656 | `syncTopLevelFromLatest` が versions 最新（v2）でメモリ上の html を上書き。東京今昔マップは画面が V3.8（207,712B）、ダウンロード・フォーク・比較は v2（198,139B） | 実際に開いた（メモリ 171,691 文字 vs ファイル 174,977 文字） |
| F7 | `js/router.js` 125–130 | 画面遷移がすべて `replaceState`。戻るで離脱する | 実際に開いた |
| F8 | `index.html` 796–828・838–841、`js/render.js` 924 | 検索入力は候補ドロップダウンだけで一覧は絞られない。並び替えを触ると初めて絞られ、ホームの行が消える（挙動が不整合） | 実際に開いた |
| F9 | `js/render.js` 2340 | プロフィール「公開」タブはサムネ画像でなく生の iframe 17個（srcdoc 4.6MB） | 実際に開いた |

## 危ない（未発生）

- **R1** `js/github.js` 220・250・264・292 ほか5か所：`manifest.json` の JSON.parse 失敗時に `manifest = []` で続行し、PUT すると全作品の一覧が消える。
- **R2** `js/render.js` 2113–2134：フォルダ型・md型にも「新バージョンを保存」が出て、空の `htmls/<id>.html` / `_v1.html` を作る。md型はメタ編集で `mdSource` も manifest に入る。
- **R3** `js/render.js` 1105–1107、`index.html` 397：訪問者の既定ハンドルが `you`（owner の author と同じ）。訪問者に「新バージョンを保存」「プロフィール編集」が出る。F1 の根にもなっている。

## 矛盾

- ランキング上位9件は架空サンプル（p001〜p009・架空作者4人・DL計8,841）。本物は0〜1。訪問者の DL は記録されず「Updated live」と食い違う。
- `manifest.webmanifest` が「recipes for AI」。`upload.js` のボタン文言が `Publish prompt`。`profiles.json` に PromptShare。
- 日本語モードで英語が大量に混在（挨拶・見出し・比較トグルが英語に化ける等）。PAT「表示/隠す」は逆。
- 設定の OAuth パネルが `/auth/me` を毎回 404、訪問者に内部向け文言。
- HANDOFF.md が「No known open bugs / 2026-07-16」のまま。`_folder_demo` 削除条件は既に満たされている。
- `tag` と `tags` の二重管理。

## 重複・不要

- ホームで同じ作品が最大4回出る（Recently added 26 / Made for you 19 / By You 8 / 一覧 26）。
- カード描画が5か所コピペ。公開経路が3つ（フォーム・下書き・一括）。詳細内の必須チェック・プロンプト組み立て・Claude.ai 起動が2重定義。manifest 読み書きが6回。
- 未使用：CSS 55クラス、spotlight/trending/号数、`renderTagChips`・`mountCuratedTagChips`・`getMostProlificAuthor`、i18n 12キー、`htmls/_md_demo.md`、`functions/`（未デプロイ）。
- `tiles/saigai`（764ファイル 3.2MB）はリポジトリ内に参照が見当たらない（要確認）。

## よくない

- 起動のたびに HTML 29本・5.3MB を全部取得してから描画し、同量を localStorage に保存（約5.2MB、上限直前）。
- OGカード：7件未生成、2件はタイトルが古い、全件 og:image なし。
- 訪問者に「下書き」「＋Share」が見えるが投稿できない。
