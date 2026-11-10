# Prompton サイト点検報告（2026-11-10）

対象：`morohami/prompton` の `main`（最新コミット `e685e7a`）と公開サイト <https://morohami.github.io/prompton/>。公開中の `manifest.json` の ETag は手元のファイルサイズ 51,876 バイトと一致し、同じ版が公開されていることを確認済み。
コードの修正・コミット・プッシュは一切していません。

## 確かめ方

- **実際に開いた（ローカル）**：リポジトリを `/prompton/` 配下に置いた静的サーバーを立て、ヘッドレス Chrome（Playwright）で全作品の詳細画面・ランキング・プレイリスト・プロフィール・設定・比較・存在しない URL・各作品の単体ページ・`p/<id>/` を開き、コンソールエラー、ページエラー、400 番台以上のリクエストを記録した。英語と日本語、PC（1280px）とスマホ（390px）の両方で確認。
- **実際に開いた（公開）**：公開サイトを同じ方法で開いた。通信量の計測と低速 4G の再現もこちらで行った。
- **データ照合**：manifest.json と実ファイル（htmls/・thumbs/・p/）、i18n の en/ja、CSS のセレクタと JS の参照をスクリプトで突き合わせた。
- **コードを読んだだけ（未）**：動作を再現していないもの。

HANDOFF.md の決まり（作品は prompton と呼ぶ、prompt は本文用、AI ベンダー名は原則出さない、iframe は `allow-same-origin` なし、PAT 欄は `type="text"` にマスク、`.nojekyll` は消さない）を前提にしています。PAT 欄の作り、`.nojekyll`、プレビュー iframe に `allow-same-origin` がないことは、いずれも決まりどおりでした。

## 一覧（重要度順）

| # | 重要度 | 種類 | 場所 | 何が起きているか | 確かめ方 | 直し方の案（1行） |
|---|---|---|---|---|---|---|
| 1 | 高 | よくない（セキュリティ）／矛盾 | `js/github.js` 10–27行（PAT を localStorage に保存）、`js/render.js` 1489行（別タブで開く）、`htmls/p1779746643461.html` 1100・1107行 | PAT は `morohami.github.io` というオリジンの localStorage に入る。このオリジンは他の公開サイト `hotel-and-money` と `sekigahara`（どちらも 200 応答）と共有されている。さらに「別タブで開く」で単体表示した作品は sandbox なしの同一オリジンで動く。そのため、作品が読み込む外部スクリプト（Fourier の Google Tag Manager / GA / Cloudflare ビーコン、unpkg・cdnjs・jsdelivr の CDN。integrity 指定は 1 件だけ）や他の 2 サイトから PAT を読める。HANDOFF の「URL を共有しても PAT は漏れない」はプレビューの中でしか成り立っていない | 実際に開いた（公開：他 2 サイトの 200 応答、Fourier を単体表示して GA へ送信されるのを確認）。他サイトから実際に読めるかの攻撃は（未） | PAT を sessionStorage に移すか毎回入力にし、作品の単体表示は別オリジン（raw 配信や別サブドメイン）に分ける |
| 2 | 高 | よくない（セキュリティ）／矛盾 | `js/render.js` 1176行（詳細プレビュー iframe） | sandbox に `allow-popups-to-escape-sandbox` が付いている。作品の JS が `window.open('htmls/<id>.html')` を呼ぶと、sandbox が外れた同一オリジンのタブが開き、PAT を読める。HANDOFF の「作品は opaque origin で動く」という防御を作品側から外せる | コードを読んだだけ（未） | `allow-popups-to-escape-sandbox` を外す（ポップアップが必要な作品は単体表示に任せる） |
| 3 | 高 | 壊れ／矛盾 | `js/render.js` 1105–1106行（`isYours`）、`index.html` 397–401行（`ownerHandle()` の既定値 `you`） | PAT のない訪問者も既定のハンドルが `you` で、owner の作品の作者も `you`。そのため訪問者が作者扱いになり、詳細画面に「✎ 新バージョンを保存」が出る。保存するとローカルにだけ残り、再読み込みで消える。下のタブ「あなた」やギャラリーの「Made for you」にも owner の作品が自分の物として並ぶ。HANDOFF の「owner 用ボタンは `isOwner()` で出し分け」と食い違う | 実際に開いた（ローカル・スマホ。PAT なしで「新バージョンを保存」が表示された） | `canSaveNewVersion` を `isOwner()` だけで判定し、訪問者の既定ハンドルは `you` 以外（空など）にする |
| 4 | 高 | 壊れ／矛盾 | `js/render.js` 742–744・837–845行（「Made for you」の行） | この行だけ `isListed` を通しておらず、unlisted の `prompton-handoff`（HANDOFF.md の中身）と `_folder_demo` が訪問者のホーム画面に出る | 実際に開いた（ローカル・スマホのスクリーンショットに HANDOFF のカードが写った） | `yourForks` に `.filter(isListed)` を足す |
| 5 | 高 | 壊れ／データの食い違い | `manifest.json` の `p1779734355097`（東京 今昔マップ）、`index.html` 646–656行（`syncTopLevelFromLatest`）、`js/render.js` 1385・2181行 | V3.4〜3.8 の更新は `htmls/p1779734355097.html`（207,712 バイト）にだけ入っていて、manifest の versions は v2 まで。起動時に `p.html` が v2（198,139 バイト）で上書きされる。結果として、プレビューは最新なのに「HTMLをダウンロード」「フォーク」で落ちてくるのは古い v2、サイズ表示も 193.5KB と食い違う | 実際に開いた（ローカル：ダウンロードしたファイルが 198,139 バイトで v2 と一致） | v3 のエントリを manifest に足すか、ダウンロードとフォークではトップレベルのファイルを取り直す |
| 6 | 高 | よくない（容量・安定性） | `index.html` 1643行（`promptshare_v4` への保存）、`js/github.js` 26行（`saveSyncConfig` が例外を握りつぶす） | 起動のたびに全作品の HTML を localStorage に保存していて、5,206,513 文字ある。Firefox の上限（1 オリジン約 5,242,880）の 99% 超で、上限は他の 2 サイトとも共有。作品が 1 つ増えれば保存に失敗しうる。失敗は握りつぶされるので、PAT や下書きの保存が「保存しました」と出たまま実際には残らない恐れがある | 実際に開いた（Chrome でサイズを計測）。Firefox / Safari で実際に失敗するかは（未） | localStorage にはメタデータだけ保存し、HTML は Service Worker のキャッシュに任せる |
| 7 | 高 | よくない（権利表記）／データの食い違い | `manifest.json` の `p1779746643461`（Fourier: Making Waves）、`htmls/p1779746643461.html` | 中身は phet.colorado.edu の PhET シミュレーションを保存したもの（PhET は CC BY 4.0 のはず。要確認）。それなのにライセンスは「CC0 — Public domain」、モデルは「Claude Opus 4.7」、userPrompt は `n`、説明とタグは空。計測タグ（GTM-WLNGBXD など）も残っている | コードを読んだだけ（ファイル内の phet 表記を確認。単体表示で GA 送信も確認） | 出典と CC BY の表記を付けて計測タグを外す。それが難しければ unlisted にするか削除する |
| 8 | 中 | 壊れ | `js/render.js` 1489行、`index.html` 939–949行（カードの全画面が失敗したときの代わり） | 「別タブで開く」と全画面の代わりのリンクが常に `htmls/<id>.html` を指す。フォルダ型の `prompton-app`・`_folder_demo`・`p1779770067635` と md 型の `prompton-handoff` では 404 になる | 実際に開いた（ローカル：4 件とも 404。`p001` は 200） | `promptHtmlPath(p, viewing)` を使う（過去版を表示中ならその版を指す） |
| 9 | 中 | よくない（使い勝手） | `js/router.js` 125–130行（`setRoute` が `replaceState` しか使わない） | 画面を移っても履歴が積まれない。詳細画面でブラウザの「戻る」を押すとサイトの外へ出てしまう（スマホのスワイプで戻るも同じ） | 実際に開いた（ローカル：カードをクリックしたあと戻ると about:blank になった） | ユーザー操作による移動は `pushState` にし、`popstate` でも描画する |
| 10 | 中 | 壊れ／重複 | `js/render.js` 1876・1948行と `index.html` 150–158行（モデルの選択肢が 3 か所に重複） | 選択肢に「Claude Sonnet 4.5」がないため、`p1779823200000` のメタデータ編集を開くだけでモデル欄が「AI」になる。そのまま保存するとモデルが黙って書き換わる | 実際に開いた（ローカル：ダミー PAT で編集欄を開き、選択値が AI になった。保存はしていない） | 選択肢を共通の定数 1 つにまとめ、今の値がなければ選択肢に足す |
| 11 | 中 | 壊れ／データの食い違い | `p/` フォルダ | 7 作品（`prompton-app`、`prompton-handoff`、`p1779823200000`、`p1779797611652`、`p1779770067635`、`p1779770067636`、`p1779555000005`）に OG ページがない。github.io 上のシェアリンク `p/<id>/` は HTTP 404 を返したあと 404.html が転送するので、人は開けるがリンクプレビューは出ない。どの OG ページにも `og:image` がない | 実際に開いた（公開：`p/p1779770067635/` が 404） | 足りない `p/<id>/index.html` を作るスクリプトを用意し、`og:image` にサムネを入れる |
| 12 | 中 | よくない（表示の速さ） | `js/render.js` 2340–2343行（プロフィールの「公開」タブ） | サムネ画像を使わず、作品ごとにスクリプト無効（`sandbox=""`）の iframe を一度に 17 個作る。約 10.3MB・463 リクエスト・コンソールエラー 688 件（Blocked script execution）。地図系は白や黒のまま表示される | 実際に開いた（公開） | ギャラリーと同じサムネ画像と遅延読み込みにする |
| 13 | 中 | よくない（表示の速さ） | `index.html` 1529–1579行（`fetchSeed`） | 最初の描画の前に全 29 作品の HTML（通信量 1.35〜1.6MB）を読み終えるまで待つ。低速 4G 相当では最初のカードが出るまで約 10 秒 | 実際に開いた（公開・回線を絞って計測） | manifest だけで先に描画し、HTML は詳細を開くときやダウンロード時に取りに行く |
| 14 | 中 | 壊れ | `thumbs/prompton-app.jpg`、`htmls/prompton-app/index.html` | 「Prompton on Prompton」のサムネが、額縁の見出しだけの空画像になっている。額縁の中の本体では、sandbox のせいで Service Worker へのアクセスが例外になり（ページエラー）、localStorage の警告も出る | 実際に開いた（公開・ローカル） | サムネは手動の静的画像にする。`navigator.serviceWorker` の参照を try で囲む |
| 15 | 中 | 矛盾（i18n） | `js/render.js` 753–851・670–674・940行、`index.html` 67–280・1093–1210行、`js/upload.js` | 日本語表示でも英語が多く残る：「Good afternoon, reader.」「Your collection」「Recently added」「Made for you」「All promptons」「SHOW ALL」「← Back to gallery」、カードの downloads / forks、比較画面の全体、ランキングの説明文、アップロード画面の全体、設定の説明文、通知の多く。「比較」ボタンは一度押すと「⇄ Cancel compare」→「⇄ Compare」と英語に戻る。逆に PAT 欄の「表示 / 隠す」は英語表示でも日本語のまま。en/ja のキーの抜けはないが、未使用のキーが 12 個ある | 実際に開いた（ローカル・ja）とデータ照合 | 表示文言を `t()` 経由にしてキーを足す。比較ボタンも `t('filter.compare')` を使う |
| 16 | 中 | 矛盾（呼び方） | `js/upload.js` 171–173・418・422行、`index.html` 1039行、`js/render.js` 2330行、`manifest.webmanifest` | 作品の意味で「prompt」と書かれた箇所が残る：送信ボタンは投稿後に「Publish prompt →」へ戻る（HTML 側は「Publish prompton →」）、一括投稿の「Publish N prompts」「Published N prompts」、「Could not find prompts to compare.」「No prompts published yet.」。PWA の名前は「Prompton — recipes for AI」、説明文は「Prompts you can actually cook with…」で、サイトタイトルの決まりとも違う | コードを読んだ（webmanifest はファイルを確認） | 作品の意味で使っている箇所を prompton に直し、webmanifest の名前と説明をサイトタイトルに揃える |
| 17 | 中 | 矛盾（呼び方・ブランド） | `profiles.json`、`index.html` 318–320行 | 旧名 PromptShare が画面に出る：プロフィールの「New to PromptShare. Click "Edit profile"…」、見本ユーザーのメール `@promptshare.example`。コードのコメントにも「PromptShare prototype — single-file, localStorage-backed」が残る | 実際に開いた（プロフィール画面） | profiles.json の文言を直す（localStorage のキー名は移行の手間があるので据え置きでよい） |
| 18 | 中 | 矛盾（データ） | `manifest.json` の p001–p009、`profiles.json`、ランキング画面 | 架空の作者（Mira Tanaka など 4 人）と架空の DL 数（合計 8,841 / フォーク 328）を持つ見本 9 件がランキングの上位を占める。一方、実際の作品は 0〜1 回。説明文は「Updated live from the manifest」だが、訪問者のダウンロードは記録されず（owner だけがコミットする）、数字に意味がない | 実際に開いた（ランキング） | 見本データは消すか「見本」と明示する。数を表示し続けるかも含めて決める |
| 19 | 中 | 矛盾（ベンダー名） | `js/render.js` 950行（カードのリボン）、964–965行 | ギャラリーのカード右上のリボンにモデル名の最初の単語（Claude / GPT-5 / GPT-4o）がそのまま出て、カードの上にもモデル名が出る。HANDOFF は Claude の表記をモデル選択と「Claude.aiで開く」ボタンだけに限っている | 実際に開いた（公開：リボンに Claude と GPT-5 を確認） | リボンはタグや「Fork / MD」だけにし、モデル名は詳細画面だけに出す（owner の判断） |
| 20 | 中 | よくない（データ破損のおそれ） | `js/github.js` 259–272行（`updatePromptMetadataOnGitHub`） | 手元のオブジェクトを丸ごと manifest に書き戻す。md 型では `mdSource`（HANDOFF.md 全文）まで書き込まれる。ローカルだけの投票数、ページを開いた後に workflow が更新した `thumbVer`、他の AI セッションが同時に加えた変更も上書きしてしまう | コードを読んだだけ（未） | 編集した項目だけを最新の manifest エントリに合体させ、`mdSource` などの内部用項目は除く |
| 21 | 中 | よくない（キャッシュ） | `sw.js` 75–88行 | htmls/ と thumbs/ はキャッシュ優先（裏で更新）。作品を更新した直後の 1 回目の訪問では古い HTML が表示・ダウンロードされる。`thumbs/*.jpg?v=` は版ごとに別エントリとして溜まり続け、VERSION を上げるまで消えない | コードを読んだだけ（未） | htmls はネットワーク優先にし、サムネは古い `?v=` の削除処理を入れる |
| 22 | 中 | 矛盾／よくない（使い勝手） | `index.html` 178行、`js/upload.js` 335行、`js/render.js` 2092・1230行 | 未設定の訪問者がアップロード・新バージョン・投票をすると「Saved locally」になるが、次の起動で manifest から上書きされて消える。投稿画面の「Saved locally · No backend」は、実際には GitHub に公開する仕組みと食い違う | コードを読んだだけ（未） | owner 以外には投稿 UI を出さないか、「GitHub 設定が必要」と表示する |
| 23 | 中 | よくない（アクセシビリティ） | `js/render.js` 770・944行（カード）、`index.html` 32–36行（ナビ） | カードは click だけの div で、Tab で移動できない（tabIndex -1、role なし）。上部ナビとテーマ切替は href のない `<a>` なのでキーボードで操作できない。プレビュー iframe に title がない。サムネの alt はすべて空 | 実際に開いた（DOM を調べた）。読み上げソフトでの確認は（未） | カードは `<a href="#/p/<id>">` にし、ナビは button か href 付きにして、iframe に title を付ける |
| 24 | 低 | 不要なファイル | `htmls/_folder_demo/`、`thumbs/_folder_demo.jpg`、`p/_folder_demo/`、manifest の該当エントリ | HANDOFF の削除条件「本物のフォルダ型作品ができたら」はもう満たされている（`p1779770067635`、`prompton-app`）。`fileList` がないので、zip ダウンロードは index.html だけで動かない | データ照合 | HANDOFF の backlog 5 に沿って 4 か所まとめて削除する |
| 25 | 低 | 不要なファイル | `htmls/_md_demo.md` | manifest にない孤立ファイル（HANDOFF には名前が残っている） | データ照合 | 削除し、HANDOFF からも消す |
| 26 | 低 | 矛盾（HANDOFF） | `manifest.json` の `prompton-app` | HANDOFF のフォルダ化手順の 5 番では `fileList` 必須だが、付いていない（ファイルは 1 つなので実害はなし） | データ照合 | `"fileList": ["index.html"]` を足す |
| 27 | 低 | 未使用コード | `index.html` 699–723・736・1247–1254行、`js/render.js` 1020–1021・2225–2229行、`js/tags.js` 151行、`css/main.css` | 使われていないもの：`renderTagChips`（何もしない関数）、`mountCuratedTagChips`（表示先の要素がない）、`getMostProlificAuthor`、spotlight / trending / 号数（`FEATURES` が false 固定）、`issueDate` / `issueCount` の保険コード、操作 UI のない `currentFilter`、CSS の未使用クラス 55 個（cover-* / lead-* / major-* / briefs-* / 旧 version-* など）、i18n の未使用キー 12 個。`renderStoriesBar` は中身と名前が合っていない | データ照合とコード読み | まとめて削除し、関数名を `renderDraftsMenu` に変える |
| 28 | 低 | 重複 | `js/render.js` 1308–1335 と 1724–1745行、1299–1306 と 1748–1755行、1499–1508 と 1762–1771行、`js/github.js`（manifest の読み書きが 6 か所）、`css/main.css` | 同じ働きのコードが複数ある：必須チェック、プロンプト組み立て、「Claude.aiで開く」の処理がそれぞれ 2 つ。「✓ Copied」表示とエラー通知の書き方が何度も繰り返される。manifest の取得→編集→PUT が 6 回書かれている。過去版のパス計算が 3 か所。HTML エスケープの関数が 2 つ。CSS で同じセレクタの重複定義が 45 個（`.detail-actions` と `.anatomy pre` は 3 回） | データ照合とコード読み | 共通の関数（`buildPromptText`、`withManifest(fn)` など）にまとめ、CSS の重複定義も 1 つに統合する |
| 29 | 低 | よくない | `index.html` 1305行、設定画面 | `/auth/me` をドメインの直下（`morohami.github.io/auth/me`）に問い合わせて毎回 404 になる。開発中のメッセージ「OAuth backend not deployed」が訪問者にも見える | 実際に開いた（公開・ローカル） | OAuth を設定していないときは欄ごと隠し、問い合わせ先も相対パスにする |
| 30 | 低 | よくない（使い勝手） | `js/router.js`、`404.html` | 投稿画面には URL がなく（`#/upload` を処理していない）、再読み込みするとギャラリーに戻る。存在しない URL や `#/p/存在しないID` は何も言わずにギャラリーへ移る | 実際に開いた（ローカル） | `#/upload` のルートを足し、見つからないときは「見つかりません」と表示する |
| 31 | 低 | よくない（スマホ） | 上部とボトムタブ | タップしにくい小さな要素：テーマ切替 26×28px、設定 26×28px、「SHOW ALL」71×18px、ボトムタブの高さ 30px | 実際に開いた（390px で寸法を計測） | タップ領域を 44px 以上にする |
| 32 | 低 | よくない（PWA） | `index.html` 11行、`manifest.webmanifest` | `apple-touch-icon` もアプリのアイコンも SVG だけ。iOS は SVG のホーム画面アイコンを使わず、一部の Android はインストールに PNG（192px / 512px）を求める | コードを読んだだけ（未） | PNG（180 / 192 / 512px）を追加する |
| 33 | 低 | データの食い違い | `manifest.json` | 説明・タグが空、userPrompt が `n` / `na` の作品が 4 件（`p1779746643461`、`p1779489296529`、`p1779487555469`、`p1779462705263`）。東京今昔マップの説明は V3 の機能に触れているのに、versions は v2 まで、モデルは「Other」（既定は「AI」） | データ照合 | owner がメタデータ編集で埋める |
| 34 | 低 | よくない | `js/render.js` 541・692・968・1142行など | `data-author="${p.author}"` がエスケープなしで埋め込まれている（書けるのは owner だけなので危険度は低い） | コードを読んだだけ（未） | `escapeAttr` を通す |
| 35 | 低 | 矛盾 | `js/render.js` 1618行、`js/upload.js` 296行 | 削除の確認文が、フォルダ型や md 型でも「htmls/<id>.html を消す」と表示する。フォークしたときの親のフォーク数の増加がローカルだけで、GitHub に保存されない | コードを読んだだけ（未） | 確認文は実際のパスを出し、親のフォーク数は manifest にも書く |
| 36 | 低 | 矛盾（HANDOFF） | `HANDOFF.md` 冒頭 | 「No known open bugs」「Last updated 2026-07-16」とあるが、東京今昔マップへのコミットは 07-21 まで続いており、上記の不具合もある | データ照合 | 今回の結果で HANDOFF を更新する |

## 問題がなかったもの

- manifest の全 28 件について、本体ファイルとサムネの jpg は存在した。サムネも htmls/ のファイルも、manifest にないものはない（例外は `_md_demo.md` だけ）。
- 過去版のファイル（`p003_v1〜v3`、`p1779734355097_v1・v2`）はすべて存在した。
- i18n の en/ja でキーの抜けはなかった。
- PAT 欄（`type="text"` にマスク）、`.nojekyll`、詳細・比較・投稿プレビューの iframe に `allow-same-origin` がないことは、いずれも決まりどおり。
- ギャラリー・詳細・ランキング・比較では、本体の JS エラーは出なかった（作品内部の WebGL の警告などは除く）。

## 先に直すべき上位5件

1. **トークンの露出をふさぐ（1・2番）**：詳細プレビューの `allow-popups-to-escape-sandbox` を外し、PAT を localStorage から外す（sessionStorage に移すか毎回入力にする）。同じオリジンの他の 2 サイトと、単体表示される作品の外部スクリプトから読める状態をなくす。
2. **Fourier 作品を整理する（7番）**：PhET の出典と CC BY の表記を付けて計測タグを外す。それが無理なら unlisted にするか削除する。権利表記の誤りと計測タグを一度に片づけられる。
3. **訪問者を owner 扱いしない、unlisted を漏らさない（3・4番）**：`canSaveNewVersion` を `isOwner()` だけで判定し、「Made for you」に `isListed` を通す。どちらも 1 行程度の修正。
4. **全作品の HTML を localStorage に保存するのをやめる（6・13番）**：manifest だけで先に描画し、HTML は必要になったときに取りに行く。容量超過の危険と、低速回線で最初のカードまで約 10 秒かかる問題が同時に解消する。
5. **最新ではないファイルが配られる問題を直す（5・8番）**：東京今昔マップに v3 を登録するかダウンロード元を直し、「別タブで開く」と全画面の代わりのリンクを `promptHtmlPath()` にする。古い v2 が配られる件と、フォルダ型・md 型の 404 が片づく。
