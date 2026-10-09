/* ============================================================
 * collectibles.js — 金币 / 宝石 / 红心 / 道具（护盾、磁铁、双倍）
 * 红心 heart：悬在空中，必须跳跃撞击；回血 +1 或 +2，可超过血量上限
 * ============================================================ */
'use strict';

const Collectibles = (() => {

  let sprites = null;

  // 红心的悬空高度范围（离地 px）：站立够不到，必须跳起来撞
  const HEART_H_MIN = 88, HEART_H_MAX = 112;

  function init(s) { sprites = s; }

  // 金币弧线生成
  function coinArc(x, groundY, count, radius = 54) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const p = i / (count - 1);
      const cy = groundY - 30 - Math.sin(p * Math.PI) * radius;
      items.push({ type: 'coin', x: x + i * 26, y: cy, animT: Math.random() * 6, taken: false, phase: 0 });
    }
    return items;
  }

  // 直线金币
  function coinLine(x, groundY, count, gap = 30, height = 30) {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({ type: 'coin', x: x + i * gap, y: groundY - height, animT: Math.random() * 6, taken: false, phase: 0 });
    }
    return items;
  }

  // 红心（悬空，需跳跃撞击）：可指定离地高度，默认取随机高度
  function heartAt(x, groundY, height) {
    const it = create('heart', x, groundY);
    it.y = groundY - (height !== undefined ? height : HEART_H_MIN + Math.random() * (HEART_H_MAX - HEART_H_MIN));
    return it;
  }

  // 一组红心（沿路排列，偶尔双心）
  function heartArc(x, groundY, count = 1, gap = 64) {
    const items = [];
    const h = HEART_H_MIN + Math.random() * (HEART_H_MAX - HEART_H_MIN);
    for (let i = 0; i < count; i++) {
      // 轻微起伏，让连跳更有节奏
      items.push(heartAt(x + i * gap, groundY, h + (i % 2 ? -6 : 6)));
    }
    return items;
  }

  function create(type, x, groundY) {
    const cfg = {
      coin:   { r: 16, v: 1,  img: () => sprites.items.coin },
      gem:    { r: 15, v: 5,  img: () => sprites.items.gem },
      shield: { r: 18, v: 0,  img: () => sprites.items.shield },
      magnet: { r: 18, v: 0,  img: () => sprites.items.magnet },
      star:   { r: 18, v: 0,  img: () => sprites.items.star },
      potion: { r: 16, v: 0,  img: () => sprites.items.potion },
      heart:  { r: 19, v: 0,  img: () => sprites.items.heart },
    }[type];
    return {
      type, x, y: groundY - 30, r: cfg.r, value: cfg.v,
      animT: Math.random() * 6, taken: false, phase: 0, bobAmp: 6,
      imgFn: cfg.img,
    };
  }

  function update(c, dt, speed, player, onCollect) {
    c.x -= speed * dt;
    c.animT += dt * 6;
    c.phase += dt * 3;

    // 磁铁吸引
    if (player.magnet > 0 && !c.taken) {
      const dx = player.x - c.x, dy = (player.y - 26) - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 220 && d > 1) {
        const pull = 420 * dt;
        c.x += (dx / d) * pull;
        c.y += (dy / d) * pull;
      }
    }

    if (c.x < -40) c.dead = true;

    // 碰撞检测（圆形）
    if (!c.taken && !player.dead) {
      const px = player.x, py = player.y - player.h / 2;
      const pr = Math.max(player.w, player.h) / 2;
      if (Math.hypot(px - c.x, py - c.y) < c.r + pr * 0.62) {
        c.taken = true;
        onCollect(c);
      }
    }
  }

  function draw(ctx, c, viewH) {
    const img = c.imgFn ? c.imgFn() : sprites.items[c.type];
    let frames;
    if (Array.isArray(img)) frames = img; else frames = [img];
    const f = frames[Math.floor(c.animT) % frames.length];
    const bob = Math.sin(c.phase) * c.bobAmp * 0.5;
    let sc = 2.6;
    if (c.type === 'heart') sc = 3.0 + Math.sin(c.phase * 2) * 0.2; // 心跳脉动
    const dw = f.width * sc, dh = f.height * sc;
    ctx.save();
    if (c.type === 'gem') {
      // 宝石闪光
      ctx.shadowColor = '#55c8e8';
      ctx.shadowBlur = 14;
    } else if (c.type === 'heart') {
      // 红心红光
      ctx.shadowColor = 'rgba(255, 77, 109, 0.95)';
      ctx.shadowBlur = 18;
    } else if (c.taken) {
      ctx.globalAlpha = 0;
    }
    ctx.drawImage(f, c.x - dw / 2, c.y - dh / 2 + bob, dw, dh);
    ctx.restore();
  }

  return { init, coinArc, coinLine, heartArc, heartAt, create, update, draw };
})();
