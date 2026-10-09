/* ============================================================
 * particles.js — 粒子系统（尘土 / 金币闪光 / 撞击 / 得分飘字）
 * ============================================================ */
'use strict';

const Particles = (() => {
  const list = [];
  let W = 960, H = 540;

  function init(W_, H_) { W = W_; H = H_; }

  function spawn(p) { list.push(p); }

  function dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      spawn({
        kind: 'dust', x: x + (Math.random() - 0.5) * 20, y: y - Math.random() * 6,
        vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 60 - 10,
        life: 0.5 + Math.random() * 0.3, t: 0, size: 2 + Math.random() * 3,
        color: '#c8b48a',
      });
    }
  }

  function doubleJump(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      spawn({
        kind: 'ring', x, y,
        vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 30,
        life: 0.4, t: 0, size: 3, color: '#9fe8ff',
      });
    }
  }

  function coinSparkle(x, y, color = '#ffd75e') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spawn({
        kind: 'spark', x, y,
        vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
        life: 0.35, t: 0, size: 2.5, color,
      });
    }
  }

  function hitBurst(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      spawn({
        kind: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.4 + Math.random() * 0.25, t: 0, size: 2 + Math.random() * 2.5,
        color: Math.random() < 0.5 ? '#ffb0a0' : '#ffe8c0',
      });
    }
  }

  function floatText(x, y, text, color = '#fff') {
    spawn({ kind: 'text', x, y, text, color, life: 0.9, t: 0, size: 15 });
  }

  function speedLines(n, speed) {
    for (let i = 0; i < n; i++) {
      spawn({
        kind: 'line', x: Math.random() * W, y: Math.random() * H,
        vx: -speed * 1.5 - 200, vy: 0,
        life: 0.25, t: 0, size: 2, len: 40 + Math.random() * 50, color: 'rgba(255,255,255,0.5)',
      });
    }
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      if (p.t >= p.life) { list.splice(i, 1); continue; }
      if (p.kind === 'text') { p.y -= 46 * dt; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'dust') p.vy -= 60 * dt;
    }
  }

  function draw(ctx) {
    for (const p of list) {
      const k = p.t / p.life;
      ctx.save();
      if (p.kind === 'text') {
        ctx.globalAlpha = 1 - k;
        ctx.font = `bold ${p.size}px 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#1a0f2e';
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'line') {
        ctx.globalAlpha = (1 - k) * 0.5;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * (1 - k), p.y);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  return { init, spawn, dust, doubleJump, coinSparkle, hitBurst, floatText, speedLines, update, draw };
})();
