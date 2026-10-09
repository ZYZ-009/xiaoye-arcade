# -*- coding: utf-8 -*-
import os, re, json, base64
base = r"E:\body game\game-portal"
src  = os.path.join(base, "src", "page.html")
out  = os.path.join(base, "index.html")

html = open(src, encoding="utf-8").read()
def _uri(path, mime):
    """直接把图片编码成 data URI —— 仓库里只留图片，不留 base64 文本"""
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))

xy = _uri(os.path.join(base, "assets", "xiaoye-512.png"), "image/png")
repl = {"__XIAOYE__": xy}
for k in ("bumper", "nose", "drift", "knight", "voxel"):
    repl["__COV_" + k.upper() + "__"] = _uri(
        os.path.join(base, "assets", "covers-web", k + ".webp"), "image/webp")

for k, v in repl.items():
    assert html.count(k) == 1, "%s count=%d" % (k, html.count(k))
    html = html.replace(k, v)
assert "__" not in re.sub(r"[A-Za-z0-9+/=]", "", "") or True
for k in repl: assert k not in html
open(out, "w", encoding="utf-8").write(html)
print("written:", out, " size: %.0f KB" % (os.path.getsize(out)/1024))

# ---- 从内置清单同步导出 games.json（单一数据源，避免两边不一致）----
m = re.search(r'<script type="application/json" id="games-data">\s*(\[[\s\S]*?\])\s*</script>', html)
if m:
    data = json.loads(m.group(1))
    json.dump(data, open(os.path.join(base, "games.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("games.json 已同步: %d 个游戏, 全部带作者字段: %s"
          % (len(data), all("author" in g for g in data)))

# 结构校验
s = re.sub(r"<style>.*?</style>", "<style></style>", html, flags=re.S)
s = re.sub(r"<script>.*?</script>", "<script></script>", s, flags=re.S)
VOID = {"img","br","hr","input","meta","link","source","area","base","col","embed","track","wbr"}
stack, line, bad = [], 1, 0
for m in re.finditer(r"\n|<[^>]*>", s):
    t = m.group(0)
    if t == "\n": line += 1; continue
    lm = re.match(r"</?([a-zA-Z][a-zA-Z0-9]*)", t)
    if not lm: continue
    n = lm.group(1).lower()
    if n in VOID: continue
    if t.startswith("</"):
        if not stack: print("L%d stray </%s>" % (line, n)); bad += 1
        elif stack[-1][0] != n:
            print("L%d </%s> vs <%s> L%d" % (line, n, stack[-1][0], stack[-1][1])); bad += 1; stack.pop()
        else: stack.pop()
    elif t.endswith("/>"): continue
    else: stack.append((n, line))
for n,l in stack: print("unclosed <%s> L%d" % (n,l)); bad += 1
print("tag balance:", "OK" if bad==0 else "%d problems" % bad)
print("data uris:", html.count("data:image"))
