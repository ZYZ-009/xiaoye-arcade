# -*- coding: utf-8 -*-
import os, base64
from collections import deque
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC  = r"E:\body game\game-portal\assets\covers"
OUT  = r"E:\body game\game-portal\assets\covers-white"
WEB  = r"E:\body game\game-portal\assets\covers-web"
os.makedirs(WEB, exist_ok=True)
W, H = 1200, 900

def flood(seed, allowed):
    h, w = allowed.shape
    seen = seed.copy(); dq = deque(zip(*np.nonzero(seed)[::-1]))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0<=nx<w and 0<=ny<h and allowed[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; dq.append((nx,ny))
    return seen

def dilate(m, r):
    return np.array(Image.fromarray((m*255).astype(np.uint8),"L")
                    .filter(ImageFilter.MaxFilter(r*2+1))) > 127

def border_seed(h, w):
    s = np.zeros((h,w), dtype=bool)
    s[0,:] = s[-1,:] = True; s[:,0] = s[:,-1] = True
    return s

def border_touching(mask):
    h, w = mask.shape
    lab = np.zeros((h,w), dtype=np.int32); cur = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if lab[y0,x0]: continue
        cur += 1; lab[y0,x0]=cur; stack=[(x0,y0)]
        while stack:
            x,y = stack.pop()
            for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                if 0<=nx<w and 0<=ny<h and mask[ny,nx] and lab[ny,nx]==0:
                    lab[ny,nx]=cur; stack.append((nx,ny))
    edge = set(lab[0,:].tolist()) | set(lab[-1,:].tolist()) | \
           set(lab[:,0].tolist()) | set(lab[:,-1].tolist())
    edge.discard(0)
    if not edge: return np.zeros((h,w), dtype=bool)
    return np.isin(lab, np.fromiter(edge, dtype=np.int32))

def rounded_mask(size, radius, ss=4):
    w, h = size
    big = Image.new("L", (w*ss, h*ss), 0)
    ImageDraw.Draw(big).rounded_rectangle([0,0,w*ss-1,h*ss-1], radius=radius*ss, fill=255)
    return big.resize((w,h), Image.LANCZOS)

def to_card(im, inset=56, radius=44):
    iw, ih = W-inset*2, H-inset*2
    card = im.resize((iw,ih), Image.LANCZOS).convert("RGBA")
    card.putalpha(rounded_mask((iw,ih), radius))
    c = Image.new("RGB",(W,H),(255,255,255)); c.paste(card,(inset,inset),card); return c

SLUG = {"01":"bumper","02":"nose","03":"drift","04":"knight","05":"voxel"}
b64 = {}
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".png"): continue
    im = Image.open(os.path.join(SRC,f)).convert("RGB")
    if f.startswith("01"):
        res, note = to_card(im), "圆角卡片"
    else:
        a = np.array(im).astype(np.int16); h,w,_ = a.shape
        bg = a[2,2].copy(); d = np.abs(a-bg).max(axis=2)
        m1 = flood(border_seed(h,w) & (d<=40), d<=40)
        leftover = (~m1) & (a.max(axis=2) < 160)
        extra = border_touching(leftover)
        extra = dilate(extra, 3)          # 连同外描边一起清掉
        m2 = m1 | extra
        out = a.copy(); out[m2] = 255
        ring = dilate(m1,2) & (~m1)
        wgt = np.clip(1.0-d[ring]/70.0, 0, 1)[:,None]
        out[ring] = (a[ring]*(1-wgt) + 255*wgt).astype(np.int16)
        res = Image.fromarray(out.astype(np.uint8)).filter(ImageFilter.SMOOTH)
        note = "去底+清边"
    res.save(os.path.join(OUT,f), optimize=True)
    web = res.resize((800,600), Image.LANCZOS)
    wp = os.path.join(WEB, SLUG[f[:2]]+".webp")
    web.save(wp, "WEBP", quality=86, method=6)
    b64[SLUG[f[:2]]] = base64.b64encode(open(wp,"rb").read()).decode("ascii")
    print("%-16s %-10s png=%4d KB   webp=%3d KB" % (f, note, os.path.getsize(os.path.join(OUT,f))/1024, os.path.getsize(wp)/1024))

import json
json.dump(b64, open(r"E:\body game\game-portal\assets\covers.b64.json","w"), ensure_ascii=False)
print("total webp: %d KB   base64: %d KB" % (sum(os.path.getsize(os.path.join(WEB,f)) for f in os.listdir(WEB))/1024,
                                              sum(len(v) for v in b64.values())/1024))
