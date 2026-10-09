# -*- coding: utf-8 -*-
import os
from collections import deque
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC  = r"E:\body game\game-portal\assets\covers"
OUT  = r"E:\body game\game-portal\assets\covers-white"
PREV = r"E:\body game\game-portal\preview"
os.makedirs(OUT, exist_ok=True)
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

def border_touching_labels(mask):
    """返回所有接触画布边缘的连通块掩码（单次标记，省内存）"""
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
    if not edge: return np.zeros((h,w), dtype=bool), 0
    m = np.isin(lab, np.fromiter(edge, dtype=np.int32))
    return m, len(edge)

def rounded_mask(size, radius, ss=4):
    w, h = size
    big = Image.new("L", (w*ss, h*ss), 0)
    ImageDraw.Draw(big).rounded_rectangle([0,0,w*ss-1,h*ss-1], radius=radius*ss, fill=255)
    return big.resize((w,h), Image.LANCZOS)

def to_card(im, inset=56, radius=44):
    iw, ih = W - inset*2, H - inset*2
    card = im.resize((iw, ih), Image.LANCZOS).convert("RGBA")
    card.putalpha(rounded_mask((iw, ih), radius))
    canvas = Image.new("RGB", (W, H), (255,255,255))
    canvas.paste(card, (inset, inset), card)
    return canvas

sheet = []
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".png"): continue
    im = Image.open(os.path.join(SRC, f)).convert("RGB")

    if f.startswith("01"):
        res, note = to_card(im), "满幅插画 → 收进圆角卡片"
    else:
        a = np.array(im).astype(np.int16); h, w, _ = a.shape
        bg = a[2,2].copy(); d = np.abs(a - bg).max(axis=2)
        m1 = flood(border_seed(h,w) & (d <= 40), d <= 40)
        leftover = (~m1) & (a.max(axis=2) < 160)
        extra, n = border_touching_labels(leftover)
        m2 = m1 | extra
        out = a.copy(); out[m2] = 255
        ring = dilate(m1,2) & (~m1)
        wgt = np.clip(1.0 - d[ring]/70.0, 0, 1)[:,None]
        out[ring] = (a[ring]*(1-wgt) + 255*wgt).astype(np.int16)
        res = Image.fromarray(out.astype(np.uint8)).filter(ImageFilter.SMOOTH)
        note = "去底 %.0f%% + 清残留 %d 块" % (m1.mean()*100, n)

    res.save(os.path.join(OUT, f), optimize=True)
    print("%-16s %-30s %5d KB" % (f, note, os.path.getsize(os.path.join(OUT,f))/1024))
    sheet.append(res.resize((360,270), Image.LANCZOS))

cw,ch = 360,270
canvas = Image.new("RGB",(cw*3+40, ch*2+30),(255,255,255))
for i,s in enumerate(sheet):
    canvas.paste(s,(10+(i%3)*(cw+10), 10+(i//3)*(ch+10)))
canvas.save(os.path.join(PREV,"covers-white-check.png"))
print("preview saved")
