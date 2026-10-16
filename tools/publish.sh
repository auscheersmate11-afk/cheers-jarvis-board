#!/bin/zsh
# 毎朝：Notion → 暗号化データを書き出し、tasks.enc.json だけを GitHub に送る。
# 送るのは暗号文1ファイルだけ。ほかのファイルの変更・平文・鍵は絶対に送らない。
set -euo pipefail
cd "${0:A:h}/.."
python3 tools/export.py
F=docs/data/tasks.enc.json
# 安全確認：暗号文の形か・合言葉が混ざっていないか・平文ファイルが追跡されていないか
python3 -c "import json,sys;d=json.load(open('$F'));assert set(d)=={'v','kdf','iter','salt','iv','data'},'形が違う'"
PW="$(security find-generic-password -s cm-jarvis-board -w)"
if grep -qF -- "$PW" "$F"; then echo "中止：合言葉が混ざっている"; exit 1; fi
if git ls-files | grep -qE '\.plain\.json$|\.key$'; then echo "中止：平文/鍵が追跡されている"; exit 1; fi
git pull -q --rebase --autostash origin main
if git diff --quiet -- "$F"; then echo "変更なし（送らない）"; exit 0; fi
git commit -q -m "data: $(date '+%F %H:%M')" -- "$F"
git push -q origin main
echo "送信: $(git log -1 --format='%h %s')"
