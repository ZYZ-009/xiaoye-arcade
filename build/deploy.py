# -*- coding: utf-8 -*-
"""打部署包：把线上需要的文件挑出来，生成 deploy/ 和 deploy.zip
   用法：python build/deploy.py
   —— 改完 src/page.html 后：先 build.py，再 deploy.py               """
import os, re, shutil, zipfile

B = r"E:\body game\game-portal"
DEPLOY = os.path.join(B, "deploy")
ZIP    = os.path.join(B, "deploy.zip")

ROOT_FILES = ["index.html", "games.json", "sw.js", "manifest.webmanifest", ".nojekyll"]
ICONS = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]

def main():
    # 1) 检查必需文件都在
    missing = []
    for f in ROOT_FILES:
        if not os.path.exists(os.path.join(B, f)): missing.append(f)
    for f in ICONS:
        if not os.path.exists(os.path.join(B, "assets", f)): missing.append("assets/" + f)
    if missing:
        print("缺文件:", ", ".join(missing)); return 1

    # 2) 重建 deploy/
    if os.path.exists(DEPLOY): shutil.rmtree(DEPLOY)
    os.makedirs(DEPLOY)
    os.makedirs(os.path.join(DEPLOY, "assets"))

    for f in ROOT_FILES:
        shutil.copy2(os.path.join(B, f), os.path.join(DEPLOY, f))
    for f in ICONS:
        shutil.copy2(os.path.join(B, "assets", f), os.path.join(DEPLOY, "assets", f))
    shutil.copytree(os.path.join(B, "games"), os.path.join(DEPLOY, "games"))

    # 3) 打 zip（index.html 放根目录）
    if os.path.exists(ZIP): os.remove(ZIP)
    n = 0
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dp, dn, fn in os.walk(DEPLOY):
            for f in fn:
                full = os.path.join(dp, f)
                rel  = os.path.relpath(full, DEPLOY).replace("\\", "/")
                z.write(full, rel); n += 1

    # 4) 报告
    tot = sum(os.path.getsize(os.path.join(dp, f))
              for dp, dn, fn in os.walk(DEPLOY) for f in fn)
    print("deploy/  %d 个文件  %.1f MB" % (n, tot/1024/1024))
    print("deploy.zip  %.2f MB" % (os.path.getsize(ZIP)/1024/1024))
    html = open(os.path.join(DEPLOY, "index.html"), encoding="utf-8").read()
    sw   = open(os.path.join(DEPLOY, "sw.js"), encoding="utf-8").read()
    print("自检：")
    print("  内部清单数量        : %d 处（每个游戏一个，勿改）" % html.count('"id"'))
    print("  有 manifest 链接    : %s" % ("是" if "manifest.webmanifest" in html else "否"))
    print("  有 SW 注册          : %s" % ("是" if "serviceWorker" in html else "否"))
    print("  SW 缓存版本         : %s" % (re.search(r"CACHE\s*=\s*'([^']+)'", sw).group(1)))
    print("  zip 根有 index.html : %s" % ("是" if "index.html" in zipfile.ZipFile(ZIP).namelist() else "否"))
    return 0

raise SystemExit(main())