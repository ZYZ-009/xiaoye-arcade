/* ============================================================
 * obstacles.js — 障碍物系统
 * 地面型（跳跃通过）：尖刺 / 木箱 / 木桶 / 哥布林 / 史莱姆 / 巨兽
 * 下蹲型（S 下蹲通过）：横梁 bar / 蝙蝠 bat / 长横梁 beam / 低天花板 ceil
 *   其中 ceil（低天花板）位于跳跃最高点之上，封死"跳过去"这条路，
 *   与 beam 组合成"下蹲隧道"——唯一解就是按住 S 下蹲。
 * 双重型：箭矢（跳跃或下蹲均可）
 * ============================================================ */
'use strict';

const Obstacles = (() => {

  // 障碍物类型定义
  // 说明：airY = 1 - (障碍底边 Y) / viewH
  //   arrowLow 底边 365px：站姿会撞、跳跃可越过（下蹲也可通过）
  //   bar      底边 376px：站姿会撞、必须下蹲（下蹲后顶边 382 > 376）
  //   bat      底边 372px：站姿会撞、下蹲通过
  //   beam     底边 376px、宽 150px：一整段长横梁，需长按 S 通过
  //   ceil     底边 288px、自屏幕顶部垂下：天花板，跳跃（含二段跳）必撞，只能蹲
  const TYPES = {
    spike:   { kind: 'ground', w: 40, h: 22, img: 'spike',      scale: 3, yOff: 0 },
    crate:   { kind: 'ground', w: 44, h: 42, img: 'crate',      scale: 3, yOff: 0 },
    barrel:  { kind: 'ground', w: 38, h: 36, img: 'barrel',     scale: 3, yOff: 0 },
    goblin:  { kind: 'ground', w: 32, h: 34, img: 'goblin',     scale: 3, yOff: 0, anim: true, deadly: true },
    slime:   { kind: 'ground', w: 40, h: 28, img: 'slime',      scale: 3, yOff: 0, anim: true, hop: true, deadly: true },
    big:     { kind: 'ground', w: 60, h: 56, img: 'big',        scale: 3, yOff: 0, anim: true, tall: true, deadly: true },
    arrowLow: { kind: 'air',   w: 40, h: 14, img: 'arrow',      scale: 3, airY: 0.324 },
    bar:     { kind: 'air',   w: 46, h: 14, img: 'bar',         scale: 3, airY: 0.304, crouch: true },
    bat:     { kind: 'air',   w: 34, h: 24, img: 'bat',         scale: 3, airY: 0.311, anim: true, fly: true, deadly: true, crouch: true },
    // --- FATFIGHT 新增下蹲装置 ---
    beam:    { kind: 'air',   w: 150, h: 30, airY: 0.3037, crouch: true, hitFull: true, paint: 'beam' },
    ceil:    { kind: 'air',   w: 176, h: 288, airY: 0.4667, crouch: true, hitFull: true, paint: 'ceil' },
  };

  // ---- 程序化绘制（不依赖素材图，风格与像素美术一致）----
  const painters = {
    // 长横梁：木质横梁 + 铁包边 + 铆钉 + 两侧吊链
    beam(ctx, o, viewH) {
      const cy = viewH * (1 - o.t.airY);     // 底边
      const x = Math.round(o.x - o.w / 2), y = Math.round(cy - o.h);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x, y, o.w, o.h);
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x, y, o.w, 8);
      ctx.fillStyle = '#54371d'; ctx.fillRect(x, y + 8, o.w, 4);
      ctx.fillStyle = '#3f2a15'; ctx.fillRect(x, cy - 6, o.w, 6);
      ctx.fillStyle = '#e0c887';            // 铆钉
      for (let i = 10; i < o.w - 6; i += 24) ctx.fillRect(x + i, y + 14, 4, 4);
      ctx.fillStyle = '#2f2733';            // 吊链
      ctx.fillRect(x + 8, y - 12, 6, 14);
      ctx.fillRect(x + o.w - 14, y - 12, 6, 14);
    },
    // 低天花板：自屏幕顶部垂下的石砌顶棚（底边 288），只能从下方蹲着钻过去
    ceil(ctx, o, viewH) {
      const cy = viewH * (1 - o.t.airY);     // 底边 288
      const x = Math.round(o.x - o.w / 2), y = Math.round(cy - o.h); // 顶边 0
      ctx.fillStyle = '#3b3550'; ctx.fillRect(x, y, o.w, o.h);
      ctx.fillStyle = '#2e2942';                                    // 横缝
      for (let by = y + 26; by < cy - 14; by += 26) ctx.fillRect(x, by, o.w, 3);
      ctx.fillStyle = '#332d49';                                    // 竖缝（错缝）
      for (let row = 0, by = y + 14; by < cy - 14; row++, by += 26) {
        const off = row % 2 ? 14 : 36;
        for (let bx = x + off; bx < x + o.w; bx += 36) ctx.fillRect(bx, by, 3, 20);
      }
      ctx.fillStyle = '#241f36'; ctx.fillRect(x, cy - 14, o.w, 14);  // 底部厚边
      ctx.fillStyle = '#6b5f8f'; ctx.fillRect(x, cy - 14, o.w, 3);   // 底沿高光
      ctx.fillStyle = '#241f36';                                     // 垂链装饰
      ctx.fillRect(x + 16, cy - 34, 6, 20);
      ctx.fillRect(x + o.w - 22, cy - 34, 6, 20);
    },
  };

  let sprites = null;

  function init(s) { sprites = s; }

  // 创建障碍物实例
  function create(type, x, groundY, viewH) {
    const t = TYPES[type];
    const o = {
      type,
      x,
      dead: false,
      hit: false,
      animT: Math.random() * 10,
      bobT: Math.random() * 6,
    };
    if (t.kind === 'ground') {
      o.w = t.w; o.h = t.h;
      o.y = groundY; // 底边
      if (t.tall) o.y = groundY + 6;
      o.groundY = groundY;
    } else {
      o.w = t.w; o.h = t.h;
      o.airY = t.airY;
      o.y = viewH * (1 - t.airY); // 顶边（参考）
    }
    o.t = t;
    return o;
  }

  function update(o, dt, speed, viewH) {
    o.x -= speed * dt;
    o.animT += dt * (o.t.hop ? 9 : 6);
    if (o.t.hop) {
      // 史莱姆原地弹跳
      o.bobT += dt * 4;
      o.hopY = Math.abs(Math.sin(o.bobT)) * 14;
    }
    if (o.t.fly) {
      o.bobT += dt * 3;
      o.flyY = Math.sin(o.bobT) * 10;
    }
    if (o.x < -120) o.dead = true;
  }

  function hitbox(o, viewH) {
    if (o.t.kind === 'ground') {
      const g = o.hopY || 0;
      const w = o.w * 0.72, h = (o.h - g) * 0.9;
      return { x: o.x - w / 2, y: o.y - h - g, w, h };
    }
    // 空中障碍（长横梁 / 天花板按整宽判定，与视觉一致）
    const cy = viewH * (1 - o.t.airY) + (o.flyY || 0);
    const w = o.t.hitFull ? o.w : o.w * 0.6, h = o.h;
    return { x: o.x - w / 2, y: cy - h, w, h };
  }

  function draw(ctx, o, viewH, sp) {
    const t = o.t;
    if (t.paint && painters[t.paint]) {           // 程序化绘制的下蹲装置
      ctx.save();
      painters[t.paint](ctx, o, viewH);
      ctx.restore();
      return;
    }
    const src = sp.flat || sp; // 支持扁平查找表
    const entry = src[t.img];
    let frames, sc = t.scale;
    if (entry && entry.frames) { frames = entry.frames; sc = entry.scale; }
    else if (Array.isArray(entry)) frames = entry;
    else frames = [entry];
    const img = frames[Math.floor(o.animT) % frames.length];
    const dw = img.width * sc, dh = img.height * sc;
    ctx.save();
    if (t.kind === 'ground') {
      const g = o.hopY || 0;
      const y = o.y - g;
      ctx.drawImage(img, o.x - dw / 2, y - dh, dw, dh);
    } else {
      const cy = viewH * (1 - t.airY) + (o.flyY || 0);
      ctx.drawImage(img, o.x - dw / 2, cy - dh, dw, dh);
    }
    ctx.restore();
  }

  return { init, create, update, hitbox, draw, TYPES };
})();
