# Prompton 点検・突合一覧（2026-11-11）

3本の報告（`opus.md`・`gemini.md`・`fable.md`）を1件ずつコードと実際の動作で確かめ、1本にまとめた。
再現の方法：**再現**＝ローカル（`http://localhost:3459`、PAT なしの訪問者状態、PC と 375px 幅）で実際に開いて確認／**読解**＝コードを読んで確認（動作は未再現）／**照合**＝スクリプトでデータ突合。
状態の欄は修正後に埋める。

## 採用した項目

### 高

| # | 内容 | 報告 | 再現 | 直し方・触るファイル | バッチ | 状態 |
|---|---|---|---|---|---|---|
| M01 | unlisted の `prompton-handoff`・`_folder_demo` が訪問者のホーム「Made for you」に出る | O#4 G#5 F1 | 再現 | `render.js` の抽出に `isListed` | B1 | 完了：訪問者で行から消えたことを PC・スマホ幅で確認 |
| M02 | 訪問者の既定ハンドル `you` が owner の author と一致し、訪問者に「新バージョンを保存」「プロフィール編集」、プレイリスト編集、投稿 UI（下書き・＋Share・FAB）が出る。ホームの「Made for you」も訪問者に出る | O#3 G#5 F R3 O#22 G#28 | 再現 | `render.js`・`github.js`・`index.html`・`css`：owner 判定は `isOwner()` のみ。`body.is-owner` で投稿 UI を出し分け | B1 | 完了：訪問者は保存・編集・投稿・プレイリスト作成が非表示、ダミー PAT の owner では表示（PC・スマホ幅で確認） |
| M03 | 詳細プレビュー iframe の sandbox に `allow-popups-to-escape-sandbox` | O#2 G#4 | 読解（コードで確認。攻撃は未再現） | `render.js` 1176：属性を削除 | B3 | |
| M05 | 東京今昔マップ：トップレベル最新（207,712B）が versions 最新 v2 で上書きされ、ダウンロード・比較が古い v2 | O#5 G#6 F6 | 再現（メモリ 171,691 文字 vs ファイル 174,977 文字） | `index.html`：`syncTopLevelFromLatest` は html を上書きしない（HTML は常にファイルから取る） | B1 | 完了：読込後の p.html が最新ファイルと一致（174,977 文字）を確認 |
| M06 | 起動時に HTML 29本（5.3MB）を全部取得してから描画／同量を localStorage（5.24M 文字）に保存し 5MB 上限の99% | O#6 O#13 G#8 G#20 F | 再現（htmlBytes 5,275,416・localStorage 5,236,685） | `index.html`：manifest だけで描画、HTML はオンデマンド取得、localStorage はメタデータのみ | B3 | |
| M08 | スマホ詳細：オーバーレイの「全画面」「別タブで開く」が `pointer-events: none` のため押せず（後ろのサムネが受ける）、サムネ未生成作品は空枠 | G#1 | 再現（hit 要素が `IMG.preview-thumb-mobile`、`pe: none`、handoff は iframe 非表示で空） | `css/main.css`・`render.js` | B4 | |
| M09 | 検索：≤900px で検索欄が非表示のままタブから出せない／PC でも入力で一覧が絞られない（並び替えで初めて絞られホーム行が消える）。`description` 欠落で例外の余地 | G#2 F8 | 再現 | `css`・`index.html`・`router.js`・`render.js` | B4 | |
| M10 | フォルダ型は `p.html` が空のため「フォーク」で 0 バイト、md 型は wrapper HTML が落ちる | G#7 F2 | 再現（フォルダ型 `p.html` 長 0 を確認） | `render.js`：ダウンロードと共通化（zip／raw md） | B2 | |
| M11 | フォーク用 `prompton_fork_parent` が投稿するまで残り、別の投稿が Fork 扱いになる | G#7 | 再現 | `render.js`・`router.js`：投稿画面を離れたら消す | B2 | |

### 中

| # | 内容 | 報告 | 再現 | 直し方・触るファイル | バッチ | 状態 |
|---|---|---|---|---|---|---|
| M12 | 「別タブで開く」と全画面の逃げ先が `htmls/<id>.html` 固定でフォルダ型3件・md型1件は 404、過去版閲覧中も最新を開く。容量表示が「0.0 KB」 | O#8 G#10 F2 | 再現（standalone 404・caption 0.0 KB） | `render.js`・`index.html`：`promptHtmlPath` | B2 | |
| M13 | フォルダ型・md型でも「新バージョンを保存」が出て、実行すると空の `htmls/<id>.html` `_v1.html` を作る | G#11 F R2 | 読解（ボタン表示は再現） | `render.js`：フラット型のみ許可 | B2 | |
| M14 | ドラフトの自動保存タイマーが削除・投稿で止まらず、消したドラフトが空タイトルで復活 | G#12 | 再現（`d_test:` が復活） | `render.js` | B5 | |
| M15 | スマホ（≤680px）で Rankings / Playlists へ行く導線がない | G#13 | 再現（display:none、タブにもなし） | `render.js`・`css` | B4 | |
| M16 | 設定画面で言語ボタンを押すとギャラリーへ飛ぶ。`#/rankings/forks` は `#/rankings` に潰れる | G#14 F4 | 再現 | `index.html`・`render.js`：現在の hash で再描画 | B5 | |
| M17 | 旧テーマの `color:#000` が濃赤背景に残る（設定の Save・Save tag config・Popular リボン等。コントラスト約2:1）。緑の `rgba(29,185,84)` も残る | G#15 | 再現（背景 rgb(140,21,21) に文字 rgb(0,0,0)）。`.btn.primary` の通常時は白で正常 | `css/main.css` | B5 | |
| M18 | 画面遷移が `replaceState` のみで、戻るで離脱する | O#9 G#16 F7 | 再現 | `router.js` | B5 | |
| M19 | モデルの選択肢が3か所に重複し、`Claude Sonnet 4.5` がなく、編集フォームを開くと「AI」に変わる | O#10 G#17 F3 | 再現 | 共通定数＋現在値を保持 | B1 | 完了：編集フォームが Claude Sonnet 4.5 を保持、共有フォームの選択肢8件を確認 |
| M20 | OG ページが7作品で欠落、2件はタイトルが古い、全件 `og:image` なし | O#11 G#18 F | 再現（照合） | `p/*/index.html` 生成、`github.js` に og:image | B7 | |
| M21 | プロフィール「公開」タブがサムネ画像でなく iframe 17個（srcdoc 4.6MB） | O#12 G#19 F9 | 再現 | `render.js` | B3 | |
| M22 | `thumbs/prompton-app.jpg` が額縁だけの白紙。`generate-thumbs.mjs` が `git diff HEAD~1 HEAD` で複数コミット push を取りこぼし、md 未対応 | O#14 G#21 | 再現（画像確認）＋読解 | `.github/` | B7 | |
| M23 | 削除が md 型・フォルダ型の深い階層に未対応。メタ更新が `mdSource` 等を manifest に混入。manifest の JSON 解析失敗時に `[]` で上書き（5か所） | G#22 O#20 F R1 | 読解 | `github.js`：共通ヘルパーに集約 | B2 | |
| M24 | Service Worker が `htmls/` をキャッシュ優先で古い HTML を返し、`thumbs/?v=` が溜まる | O#21 G#23 | 読解 | `sw.js` | B3 | |
| M25 | 日本語モードに英語の直書きが多数。比較ボタンが英語に化ける。PAT「表示/隠す」は逆 | O#15 G#24 F | 再現 | `i18n/*.json`・`render.js`・`index.html` | B6 | |
| M26 | 呼称：`Publish prompt`、`recipes for AI`、`PromptShare`、旧説明文 | O#16 O#17 G#25 F | 再現 | `upload.js`・`manifest.webmanifest`・`profiles.json` | B6 | |
| M29 | キーボード操作：カード・ナビが `div`/href なし `<a>`、iframe に `title` なし、サムネ `alt` 空 | O#23 G#27 | 読解（両報告は DOM 計測） | `render.js`・`index.html` | B6 | |
| M30 | 訪問者の投稿・投票・プレイリスト操作は「Saved locally」と出るが次回起動で消える | O#22 G#28 F5 | 読解 | M02 の owner 限定表示で解消。残る文言は修正 | B1 | 一部完了：訪問者の投稿 UI・プレイリスト編集を隠し、投稿画面の文言を修正。投票は J7 |
| M31 | 自分のプロフィールを編集しても GitHub に保存されず、リロードで元に戻る（owner でも） | F5 | 読解（保存処理が存在しない） | `render.js`・`github.js` | B3 | |

### 低

| # | 内容 | 報告 | 再現 | 直し方・触るファイル | バッチ | 状態 |
|---|---|---|---|---|---|---|
| M32 | `functions/`（未デプロイ）：`ALLOWED_USERS` 未設定で全員許可、`functions/` への書き込みを弾かない、ログアウトが GET 可 | G#29 | 読解 | `functions/` | B7 | |
| M34 | 未使用コード（空関数・spotlight/trending・`getMostProlificAuthor` 等）、未使用 i18n キー 12、未使用 CSS 約55クラス | O#27 G#31 F | 照合 | 削除 | B7 | |
| M35 | 重複：詳細内の必須チェック／プロンプト組み立て／Claude.ai 起動が2重、manifest 読み書き6回、エスケープ関数2つ、CSS 重複 | O#28 G#32 F | 読解 | 共通化（manifest ヘルパーは M23、詳細内の重複は B7） | B7 | |
| M36 | 設定画面が毎回 `/auth/me` を 404 で叩き、訪問者に内部向け文言 | O#29 G#33 F | 再現 | `index.html` | B6 | |
| M37 | `#/upload` ルートがなくリロードでギャラリーに戻る。存在しない `#/p/<id>` が無言でギャラリーへ | O#30 G#34 | 読解（ルート表にない） | `router.js` | B5 | |
| M38 | タップ領域が 44px 未満（テーマ・設定 28×28 など） | O#31 G#35 | 再現（28×28） | `css` | B4 | |
| M40 | 細部：`prompton-app` に `fileList` なし、`data-author` が未エスケープ、削除確認文がフォルダ型・md型でも `.html` 固定 | O#26 O#34 O#35 G#36 | 読解 | `manifest.json`・`render.js` | B7 | |
| M41 | `HANDOFF.md` が「No known open bugs / 2026-07-16」のまま | 全報告 | — | 最後に更新 | 最終 | |

## owner 判断待ち（手を付けない）

| # | 内容 | 報告 | 推奨 |
|---|---|---|---|
| J1 | **PAT の保管場所**：`morohami.github.io` の localStorage は他の公開サイト（`hotel-and-money`・`sekigahara`）と共有。「別タブで開く」は sandbox なしの同一オリジン（O#1 G#3）。`sessionStorage` 化は毎回入力になり使い勝手が変わる／単体表示の別オリジン化は配信基盤の追加が必要 | 細粒度 PAT（このリポジトリのみ）なので被害は限定的。外部スクリプトを含む作品（Fourier）を先に整理し、Cloudflare 版（バックログ #3）で根本対応 |
| J2 | **Fourier: Making Waves（`p1779746643461`）**：PhET（CC BY 4.0 のはず）の保存物なのに `CC0`・モデル `Claude Opus 4.7`・`userPrompt:"n"`、GA/GTM 計測タグが残る（O#7 G#9） | 出典と CC BY 表記に直して計測タグを外す、が無理なら unlisted か削除 |
| J3 | **見本 p001〜p009 と架空作者4人**：ランキング上位を独占（DL 計 8,841）。実作品は 0〜1（O#18 G#26 F） | 削除か「見本」表記。訪問者の DL が数えられないので数の表示自体も要検討 |
| J4 | **カードのリボン・メタ行のモデル名**（Claude / GPT）が一覧で目立つ（O#19 G#26）。HANDOFF の「Claude 表記は選択肢と Claude.ai ボタンのみ」との関係 | リボンは Fork / MD / Unlisted のみ、モデルは詳細だけに |
| J5 | **`_folder_demo` 一式・`htmls/_md_demo.md` の削除**（O#24 O#25 G#30 F）。HANDOFF の削除条件は満たされているが作品の削除にあたる | 削除（4か所＋孤立ファイル） |
| J6 | **`tiles/saigai`（764ファイル・3.2MB）**：リポジトリ内に参照が見当たらない（F）。東京被災マップが実行時に組み立てる可能性もある | 作品の作者セッションで確認してから |
| J7 | **比較画面の投票**：訪問者の票はローカルのみで次回消える（F） | 機能を残すか廃止するか |
| J8 | 東京今昔マップの `versions` に V3.x を登録するか、モデル「Other」・説明の更新（O#33 G#6） | owner のメタ編集で |
| J9 | PWA 用 PNG アイコン（180/192/512px）の追加（O#32 G#35） | 画像生成ツールが手元になく未対応。素材を決めてから |

## 外したもの

| 項目 | 理由 |
|---|---|
| O#1/G#3 の「PAT 移行」を今回の修正に含める | 使い勝手が変わる判断なので J1 へ |
| G#15 の「主ボタン `.btn.primary` が黒文字」 | 通常時の計算値は白で正常。hover 時の `color:#000`（CSS 1288行）だけを M17 に含めた |
| F の「`tag` と `tags` の二重管理」 | 実害は確認できず、設計判断の領域。今回は触らない |
| O#28 の「過去版パス計算が3か所」「通知表示の繰り返し」 | 動作に影響せず、M35 の共通化のついでに触れる範囲のみ |
| 各報告の同一指摘 | 上の表に統合（報告の欄に複数記載） |

## バッチ（直す順）

1. **B1 訪問者に見えるものを正す**：M01 M02 M05 M19（M30 の一部）
2. **B2 配布物と書き込みの安全**：M10 M11 M12 M13 M23
3. **B3 安全・容量・初期表示**：M03 M06 M21 M24 M31
4. **B4 スマホと検索**：M08 M09 M15 M38
5. **B5 遷移・見た目**：M14 M16 M17 M18 M37
6. **B6 文言とアクセシビリティ**：M25 M26 M29 M36
7. **B7 生成物・整理**：M20 M22 M32 M34 M35 M40
