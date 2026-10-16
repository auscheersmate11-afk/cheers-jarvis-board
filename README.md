# J.A.R.V.I.S. タスクボード（チアーズメイト）

スマホで「判断待ち・作業中・順番待ち・要注意／停止・完了」が一目で分かる PWA。
正本は Notion の「統合タスクボード」（【運営】の下）。このアプリは読み取り専用の表示係。

## しくみ
```
Notion 統合タスクボード（正本・編集はここ）
   ↑ ~/cm-tasks/board.py sync（Discord返信待ち・今日やること・週1配信を自動で取り込み）
   ↓ tools/export.py（Notion → 暗号化 → docs/data/tasks.enc.json）
GitHub Pages（docs/ をそのまま公開）→ iPhone のホーム画面アプリ
```
- データは AES-256-GCM で暗号化して置く。パスフレーズは Mac のキーチェーン `cm-jarvis-board` だけ。
  アプリは初回だけパスフレーズを聞き、その端末に覚える（「この端末から鍵を消す」で消せる）。
- Notion のトークン（キーチェーン `cm-notion`）・パスフレーズ・平文データはリポジトリに入れない（.gitignore 済み）。
- 分類：完了/入れ替え済み→完了、保留・相手待ち・期限切れ→要注意／停止、ゆうすけ確認待ち・要確認→判断待ち、対応中→作業中、ほか→順番待ち。

## 毎日の更新
```
cd ~/cm-tasks && python3 board.py sync           # Notion を最新に（毎朝6時のタスクで自動）
cd ~/cm-jarvis-board && python3 tools/export.py  # 暗号化データを書き出す（同上）
git add docs/data/tasks.enc.json && git commit -m "data: $(date +%F)" && git push   # ← 公開の承認後に有効化
```
タスクの完了・追加は Notion で（アプリの各タスク「Notionで開く」から）。

## ローカル確認・テスト
```
cd docs && python3 -m http.server 8796 --bind 127.0.0.1   # http://127.0.0.1:8796/
JARVIS_PASS="$(security find-generic-password -s cm-jarvis-board -w)" node tools/test_ui.mjs
```
アイコンを作り直す：`python3 tools/make_icons.py`
