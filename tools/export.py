"""Notion の統合タスクボード（正本）→ docs/data/tasks.enc.json（暗号化済み）を書き出す。

  python3 tools/export.py            # 書き出すだけ（git には触らない）
  python3 tools/export.py --plain    # 確認用に docs/data/tasks.plain.json も出す（.gitignore 済み）

- Notion のトークンはキーチェーン cm-notion（~/cm-discord-archive/karte.py 経由）。コードには入れない。
- 暗号のパスフレーズはキーチェーン cm-jarvis-board。AES-256-GCM／PBKDF2-SHA256 で暗号化し、
  ブラウザは同じパスフレーズで WebCrypto 復号する。GitHub には暗号文しか置かない。
"""
import base64, datetime, json, os, pathlib, subprocess, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

sys.path.insert(0, str(pathlib.Path.home() / "cm-discord-archive"))
from karte import notion  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOARD_CFG = pathlib.Path.home() / "cm-tasks/config.json"
OUT = ROOT / "docs/data/tasks.enc.json"
ITER = 310_000
JST = datetime.timezone(datetime.timedelta(hours=9))


def val(row, name):
    p = row["properties"].get(name)
    if not p: return ""
    t = p["type"]
    if t in ("title", "rich_text"): return "".join(x["plain_text"] for x in p[t])
    if t == "select": return (p["select"] or {}).get("name", "")
    if t == "date": return (p["date"] or {}).get("start", "")
    if t == "checkbox": return p["checkbox"]
    if t == "url": return p["url"] or ""
    return ""


def rows(db):
    out, cur = [], None
    while True:
        r = notion("POST", f"/databases/{db}/query", {"page_size": 100, **({"start_cursor": cur} if cur else {})})
        out += r["results"]
        if not r.get("has_more"): return out
        cur = r["next_cursor"]


def snapshot():
    cfg = json.loads(BOARD_CFG.read_text())
    tasks = []
    for r in rows(cfg["db_id"]):
        tasks.append({
            "id": r["id"].replace("-", "")[:12],
            "name": val(r, "タスク名"), "st": val(r, "状態"), "pri": val(r, "優先度"),
            "due": val(r, "期限"), "proj": val(r, "プロジェクト"), "who": val(r, "担当者"),
            "next": val(r, "次のアクション"), "src": val(r, "元の場所"), "url": val(r, "元リンク"),
            "upd": val(r, "最終更新日"), "today": bool(val(r, "今日やる")), "memo": val(r, "メモ"),
            "notion": r["url"],
        })
    return {"generated": datetime.datetime.now(JST).isoformat(timespec="minutes"),
            "board": cfg["page_url"], "tasks": tasks}


def passphrase():
    return subprocess.run(["security", "find-generic-password", "-s", "cm-jarvis-board", "-w"],
                          capture_output=True, text=True, check=True).stdout.strip()


def encrypt(obj, pw):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b(salt), "iv": b(iv), "data": b(ct)}


if __name__ == "__main__":
    snap = snapshot()
    OUT.write_text(json.dumps(encrypt(snap, passphrase())))
    if "--plain" in sys.argv:
        (OUT.parent / "tasks.plain.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1))
    print(f"書き出し: {len(snap['tasks'])}件 → {OUT.relative_to(ROOT)}（{snap['generated']}）")
