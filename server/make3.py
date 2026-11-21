import json, subprocess, os, html, sys
from PIL import Image
W, H = 1080, 1350
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else "plain_stories.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out3"
stories = json.load(open(os.path.join(ROOT, SRC)))

CSS = """
html,body{margin:0;padding:0;background:#fff}
.c{width:1080px;height:1350px;position:relative;overflow:hidden;background:#fff;color:#111;font-family:'Noto Sans CJK KR',sans-serif;word-break:keep-all;overflow-wrap:break-word}
.in{position:absolute;left:64px;right:64px;top:80px;bottom:96px;display:flex;flex-direction:column;justify-content:center}
.t{white-space:pre-wrap;letter-spacing:-.015em}
.beats .t{font-weight:700;line-height:1.55}
.raw .t{font-weight:500;line-height:1.62;color:#222}
.t h{display:block;font-weight:900;color:#111;line-height:1.35;margin-bottom:6px}
.t b{font-weight:900;background:linear-gradient(transparent 60%,#FFE08A 60%)}
.num{font-weight:900}
.wm{position:absolute;right:46px;bottom:34px;font-size:26px;color:#B8B8B8;font-weight:500;letter-spacing:.02em}
.pg{position:absolute;left:46px;bottom:34px;font-size:26px;color:#C8C8C8;font-weight:500}
.vote .t{font-weight:700;line-height:1.6;text-align:center}
.vote .t h{font-size:1.3em}
"""

def esc(s):
    s = html.escape(s, quote=False)
    for tag in ("b", "h", "vote"):
        s = s.replace(f"&lt;{tag}&gt;", f"<{tag}>").replace(f"&lt;/{tag}&gt;", f"</{tag}>")
    return s

def size_for(text, style):
    lines = text.count("\n") + 1
    longest = max(len(l) for l in text.replace("<h>", "").replace("</h>", "").split("\n"))
    if style == "beats":
        fs = 56 if lines <= 13 else 50 if lines <= 15 else 46
        while fs > 40 and longest * fs * 0.98 > 912:
            fs -= 2
    else:
        chars = len(text)
        fs = 50 if chars <= 230 else 46 if chars <= 300 else 43 if chars <= 360 else 40
    # guard: estimate wrapped height and shrink until it fits the 1174px text box
    import math
    plain = text.replace("<b>", "").replace("</b>", "")
    def height(f):
        h = 0
        for l in plain.split("\n"):
            title = "<h>" in l or "</h>" in l
            l2 = l.replace("<h>", "").replace("</h>", "")
            ff = f * 1.22 if title else f
            rows = max(1, math.ceil(len(l2) * ff * 0.98 / 952)) if l2.strip() else 1
            h += rows * ff * (1.35 if title else (1.55 if style == "beats" else 1.62))
        return h
    while fs > 34 and height(fs) > 1110:
        fs -= 2
    return fs

def numberize(s):
    out = []
    for line in s.split("\n"):
        if line.strip().isdigit():
            out.append(f"<span class='num'>{line.strip()}</span>")
        else:
            out.append(line)
    return "\n".join(out)

def page(st, body, k, n):
    vote = body.startswith("<vote>")
    text = body.replace("<vote>", "").replace("</vote>", "")
    cls = "vote" if vote else st["style"]
    fs = size_for(text, "beats" if vote else st["style"])
    inner = esc(text).replace("&lt;h&gt;", "<h>")
    if st["style"] == "beats" and not vote:
        inner = numberize(inner)
    inner = inner.replace("<h>", f"<h style='font-size:{int(fs*1.22)}px'>")
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"
            f"<div class='c {cls}'><div class='in'><div class='t' style='font-size:{fs}px'>{inner}</div></div>"
            f"<div class='pg'>{k}/{n}</div><div class='wm'>썰마카세 @sseol_makase</div></div></body></html>")

def build(st):
    out = os.path.join(ROOT, OUT, st["id"])
    os.makedirs(out, exist_ok=True)
    n = len(st["slides"])
    files = []
    for k, body in enumerate(st["slides"], start=1):
        hp = os.path.join(ROOT, "tmp3.html"); png = os.path.join(ROOT, "tmp3.png")
        open(hp, "w").write(page(st, body, k, n))
        subprocess.run(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", f"--screenshot={png}", f"file://{hp}"], capture_output=True)
        Image.open(png).convert("RGB").save(f"{out}/{k}.jpg", quality=92)
        files.append(f"{k}.jpg")
    return {"id": st["id"], "title": st["title"], "category": st["category"], "images": files, "description": st["description"]}

if __name__ == "__main__":
    metas = [build(s) for s in stories]
    json.dump(metas, open(os.path.join(ROOT, OUT, "posts.json"), "w"), ensure_ascii=False, indent=1)
    print([(m["id"], len(m["images"])) for m in metas])
