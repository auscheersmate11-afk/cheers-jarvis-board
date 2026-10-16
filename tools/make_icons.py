"""ホーム画面アイコン（赤いアーク・リアクター）を docs/icons に作る。"""
import math, pathlib
from PIL import Image, ImageDraw, ImageFilter
OUT = pathlib.Path(__file__).resolve().parent.parent / "docs/icons"

def reactor(size, pad):
    S = size * 4                                    # 大きく描いて縮小（なめらかに）
    im = Image.new("RGB", (S, S), (1, 1, 2))
    glow = Image.new("RGB", (S, S), (0, 0, 0)); g = ImageDraw.Draw(glow)
    c, r = S / 2, S / 2 * (1 - pad)
    g.ellipse([c - r * .8, c - r * .8, c + r * .8, c + r * .8], fill=(150, 10, 25))
    im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(S * .08)), .9)
    d = ImageDraw.Draw(im)
    for i in range(60):                             # 外周の目盛り
        a = 2 * math.pi * i / 60; r1, r2 = r * .93, r * (1.0 if i % 5 == 0 else .97)
        d.line([c + r1 * math.cos(a), c + r1 * math.sin(a), c + r2 * math.cos(a), c + r2 * math.sin(a)], fill=(243, 223, 166), width=max(2, S // 220))
    def ring(rr, col, w): d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=col, width=w)
    ring(r * .86, (214, 176, 100), S // 45)
    for i in range(10):                             # リアクターの区切り
        a0 = 360 * i / 10 + 4; d.arc([c - r * .7, c - r * .7, c + r * .7, c + r * .7], a0, a0 + 28, fill=(255, 42, 61), width=S // 22)
    ring(r * .5, (243, 223, 166), S // 45)
    core = Image.new("L", (S, S), 0); ImageDraw.Draw(core).ellipse([c - r * .34, c - r * .34, c + r * .34, c + r * .34], fill=255)
    im.paste(Image.new("RGB", (S, S), (255, 60, 75)), mask=core.filter(ImageFilter.GaussianBlur(S * .03)))
    d.ellipse([c - r * .2, c - r * .2, c + r * .2, c + r * .2], fill=(255, 228, 215))
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(parents=True, exist_ok=True)
reactor(192, .06).save(OUT / "icon-192.png")
reactor(512, .06).save(OUT / "icon-512.png")
reactor(512, .22).save(OUT / "icon-maskable-512.png")   # 安全領域に収める
reactor(180, .08).save(OUT / "apple-touch-icon.png")
print("icons ok")
