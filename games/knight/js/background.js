/* ============================================================
 * background.js — 视差滚动场景（天空 / 云 / 山 / 城堡 / 地面）
 * 随时间推移呈现晨→午→昏→夜的氛围变化
 * ============================================================ */
'use strict';

const Background = (() => {
  let sprites = null;
  let W = 960, H = 540;
  let groundTop = 400;

  // 视差层（世界坐标，速度系数）
  const layers = {
    clouds: [],   // 云
    mountains: [], // 远山
    castles: [],  // 城堡剪影
    props: [],    // 近景树木岩石
  };
  let scrollCloud = 0, scrollMtn = 0, scrollCastle = 0, scrollProp = 0, scrollGround = 0;

  // 氛围阶段：晨 / 午 / 昏 / 夜
  const PHASES = [
    { name: '黎明', sky: ['#ffd9a0', '#8fc7e8', '#5a9bd8'], tint: 'rgba(255,190,120,0.12)', sun: '#ffcf6e' },
    { name: '白昼', sky: ['#aee2ff', '#7ec3ee', '#4a8fd0'], tint: 'rgba(255,255,255,0)', sun: '#fff3b0' },
    { name: '黄昏', sky: ['#ffb46e', '#e08a6a', '#7a5a9a'], tint: 'rgba(255,140,80,0.16)', sun: '#ff9a4a' },
    { name: '夜晚', sky: ['#2a3a6a', '#1c2a52', '#101a3a'], tint: 'rgba(40,60,130,0.28)', sun: '#e8e8ff' },
  ];

  function init(s, W_, H_, groundTop_) {
    sprites = s;
    W = W_; H = H_; groundTop = groundTop_;
    buildWorld();
  }

  function buildWorld() {
    layers.clouds = [];
    for (let i = 0; i < 7; i++) {
      layers.clouds.push({ x: Math.random() * W * 2, y: 40 + Math.random() * 120, s: 0.7 + Math.random() * 0.8, v: 8 + Math.random() * 10 });
    }
    layers.mountains = [];
    for (let i = 0; i < 4; i++) {
      layers.mountains.push({ x: i * 340 - 60, y: groundTop - 40, s: 2.2 + Math.random() * 0.6 });
    }
    layers.castles = [];
    for (let i = 0; i < 5; i++) {
      layers.castles.push({ x: i * 260 + Math.random() * 80, y: groundTop - 8, s: 1.6 + Math.random() * 0.9 });
    }
    layers.props = [];
    for (let i = 0; i < 14; i++) {
      const r = Math.random();
      layers.props.push({
        x: i * (W / 5) + Math.random() * 90, y: groundTop + 6,
        s: 1.4 + Math.random() * 1.2,
        kind: r < 0.4 ? 'tree' : r < 0.7 ? 'bush' : 'rock',
      });
    }
  }

  function phaseFor(dist) {
    // 每 600 米切换一次氛围
    const i = Math.floor(dist / 600) % PHASES.length;
    return PHASES[i];
  }

  function draw(ctx, dist, speed, dt) {
    const ph = phaseFor(dist);

    // 天空
    const g = ctx.createLinearGradient(0, 0, 0, groundTop);
    g.addColorStop(0, ph.sky[0]);
    g.addColorStop(0.6, ph.sky[1]);
    g.addColorStop(1, ph.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, groundTop);

    // 太阳/月亮
    const sunX = W * 0.78, sunY = 70;
    ctx.save();
    ctx.shadowColor = ph.sun; ctx.shadowBlur = 40;
    ctx.fillStyle = ph.sun;
    ctx.beginPath(); ctx.arc(sunX, sunY, 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 云（滚动）
    scrollCloud = (scrollCloud + speed * 0.05 * dt) % (W * 2);
    ctx.save();
    for (const c of layers.clouds) {
      const x = ((c.x - scrollCloud) % (W + 300)) - 150;
      ctx.globalAlpha = ph.name === '夜晚' ? 0.35 : 0.9;
      const img = sprites.env.cloud;
      const dw = img.width * c.s, dh = img.height * c.s;
      ctx.drawImage(img, x, c.y, dw, dh);
    }
    ctx.restore();

    // 远山
    scrollMtn = (scrollMtn + speed * 0.14 * dt) % (W + 400);
    ctx.save();
    ctx.globalAlpha = ph.name === '夜晚' ? 0.5 : 1;
    for (const m of layers.mountains) {
      const x = ((m.x - scrollMtn) % (W + 400)) - 200;
      const img = sprites.mountains || sprites.env.mountain;
      const dw = img.width * m.s, dh = img.height * m.s;
      ctx.drawImage(img, x, m.y - dh + 40, dw, dh);
    }
    ctx.restore();

    // 城堡剪影
    scrollCastle = (scrollCastle + speed * 0.28 * dt) % (W + 300);
    ctx.save();
    ctx.globalAlpha = ph.name === '夜晚' ? 0.75 : 0.95;
    for (const c of layers.castles) {
      const x = ((c.x - scrollCastle) % (W + 300)) - 150;
      const img = sprites.env.tower;
      const dw = img.width * c.s, dh = img.height * c.s;
      ctx.drawImage(img, x, c.y - dh + 30, dw, dh);
    }
    ctx.restore();

    // 近景树木
    scrollProp = (scrollProp + speed * 0.6 * dt) % (W * 2);
    ctx.save();
    for (const p of layers.props) {
      const x = ((p.x - scrollProp) % (W + 400)) - 200;
      const img = sprites.env[p.kind];
      const dw = img.width * p.s, dh = img.height * p.s;
      ctx.drawImage(img, x, p.y - dh, dw, dh);
    }
    ctx.restore();

    // 地面
    drawGround(ctx, speed, dt);

    // 氛围色调
    if (ph.tint !== 'rgba(255,255,255,0)') {
      ctx.fillStyle = ph.tint;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawGround(ctx, speed, dt) {
    const strip = sprites.groundStrip;
    const sw = strip.width, sh = strip.height;
    scrollGround = (scrollGround + speed * dt) % sw;

    ctx.imageSmoothingEnabled = false;
    const cols = Math.ceil(W / sw) + 2;
    for (let i = -1; i < cols; i++) {
      const x = i * sw - scrollGround;
      ctx.drawImage(strip, x, groundTop, sw, sh);
    }
    // 地面以上一道草沿阴影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, groundTop, W, 2);
  }

  return { init, draw, phaseFor };
})();
