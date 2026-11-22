"""썰마카세 카드 v5: 첫 장만 제목, 나머지는 같은 크기의 본문. 배경 한 가지(black/white), 강조색 없음."""
import json, subprocess, os, html, sys
from PIL import Image
W, H = 1080, 1350
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, OUT, TONE = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "black")
stories = json.load(open(os.path.join(ROOT, SRC)))

PAL = {"black": dict(bg="#0F0F0F", fg="#F1F1F1", sub="#8A8A8A", line="#2A2A2A"),
       "white": dict(bg="#FFFFFF", fg="#1A1A1A", sub="#9A9A9A", line="#E6E6E6")}[TONE]

CSS = f"""
html,body{{margin:0;padding:0}}
.c{{width:1080px;height:1350px;position:relative;overflow:hidden;background:{PAL['bg']};color:{PAL['fg']};
   font-family:'Noto Sans CJK KR',sans-serif;word-break:keep-all;letter-spacing:-.01em}}
.in{{position:absolute;left:92px;right:92px;top:150px}}
.ti{{font-size:60px;font-weight:700;line-height:1.42;white-space:pre-wrap;margin-bottom:34px}}
.rule{{width:100%;height:2px;background:{PAL['line']};margin:0 0 50px}}
p{{margin:0 0 40px;font-size:41px;font-weight:400;line-height:1.75;white-space:pre-wrap}}
.pg{{position:absolute;right:70px;top:66px;font-size:28px;color:{PAL['sub']}}}
.wm{{position:absolute;left:92px;bottom:56px;font-size:28px;color:{PAL['sub']}}}
"""

def page(sl, k, n):
    title = f"<div class='ti'>{html.escape(sl['title'])}</div><div class='rule'></div>" if sl.get("title") else ""
    body = "".join(f"<p>{html.escape(p)}</p>" for p in sl["body"])
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"
            f"<div class='c'><div class='pg'>{k} / {n}</div><div class='in'>{title}{body}</div>"
            f"<div class='wm'>썰마카세 @sseol_makase</div></div></body></html>")

def build(st):
    out = os.path.join(ROOT, OUT, st["id"]); os.makedirs(out, exist_ok=True)
    n = len(st["slides"]); files = []
    for k, sl in enumerate(st["slides"], start=1):
        hp = os.path.join(ROOT, "tmp5.html"); png = os.path.join(ROOT, "tmp5.png")
        open(hp, "w").write(page(sl, k, n))
        subprocess.run(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", f"--screenshot={png}", f"file://{hp}"], capture_output=True)
        Image.open(png).convert("RGB").save(f"{out}/{k}.jpg", quality=92)
        files.append(f"{k}.jpg")
    return {"id": st["id"], "title": st["title"], "category": st["category"], "images": files, "description": st["description"]}

if __name__ == "__main__":
    metas = [build(s) for s in stories]
    json.dump(metas, open(os.path.join(ROOT, OUT, "posts.json"), "w"), ensure_ascii=False, indent=1)
    print([(m["id"], len(m["images"])) for m in metas])
