# Markdown prompton demo

これは **.md がそのまま prompton になる**ことの確認用ドキュメントです。

## 仕組み

- リポジトリの `htmls/_md_demo.md` がこのファイル
- manifest.json に `"format": "md"` が付いているだけ
- HTML の prompton と同じワークフロー: AIセッションがファイルを編集して push すれば、それが即このページ

## つまり

引き継ぎ・仕様メモ・作業ログ — なんでも md で放り込めば、
Prompton がそのまま保管庫 + 閲覧 + ダウンロードの作業台になる。

- [x] 保管 (GitHub)
- [x] 表示 (この画面)
- [x] ダウンロード (↓ ボタンで raw .md が落ちる)
- [x] 非公開 (このデモ自体 unlisted — 一覧には出ない)
