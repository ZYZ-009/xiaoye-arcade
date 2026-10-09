/* ============================================================
 * game.js — 游戏主控：状态机 / 生成逻辑 / 碰撞 / 渲染循环
 * ============================================================ */
'use strict';

const Game = (() => {
  // ---- 逻辑视口（16:9），CSS 缩放适配 ----
  const VIEW_W = 960, VIEW_H = 540;
  const GROUND_TOP = 404;
  const GRAVITY = 2050;

  // ---- 全局状态 ----
  let canvas, ctx, dpr = 1;
  let state = 'boot';        // boot | menu | playing | paused | over
  let player;
  let obstacles = [];
  let items = [];
  let sprites = null;

  let speed = 0;             // px/s
  let dist = 0;              // 米
  let coins = 0;
  let best = 0;
  let lastTime = 0;
  let rafId = 0;
  let nextSpawnT = 0;        // 距下一个生成模式的剩余时间（秒）
  let forceCrouchIntro = false; // 开局第一组强制下蹲障碍
  let crouchHintT = 0;       // 开局下蹲提示剩余时间（桌面端与移动端都显示）
  let shakeT = 0, shakeAmp = 0;
  let deathTimer = 0;
  let runT = 0;
  let hudTimer = 0;
  let speedLineT = 0;
  let pauseGuardT = 0;       // 开局保护：刚开局短暂忽略暂停，防止误触/残留信号立即弹暂停
  const debugCounters = { spawns: 0, hits: 0, hurt: 0, deaths: 0 };

  // ---- 效果接口（供 Player / 其它模块调用） ----
  const effects = {
    dust: (x, y, n) => Particles.dust(x, y, n),
    doubleJump: (x, y) => Particles.doubleJump(x, y),
    shake(amp = 6, t = 0.25) { shakeAmp = amp; shakeT = t; },
  };

  // ---- 初始化 ----
  async function boot() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    best = 0;
    try { best = parseInt(localStorage.getItem('knightRunBest') || '0', 10) || 0; } catch (e) { best = 0; }

    UI.init((action) => {
      switch (action) {
        case 'play': startRun(); break;
        case 'resume': setState('playing'); break;
        case 'restart': startRun(); break;
        case 'retry': startRun(); break;
        case 'quit': toMenu(); break;
        case 'pause': setState('paused'); break;
      }
    });

    Input.init({
      onMute() { toggleMute(); },
      onTap() { /* 触控轻点已由 Input.consume 处理跳跃 */ },
      onSlide() { UI.showSlideHint(false); },
    });

    // 首次交互解锁音频
    const unlock = () => { Sound.unlock(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);

    // 开始加载素材
    Sprites.loadImages();
    await Sprites.ready();
    sprites = Sprites.build();
    Obstacles.init(sprites);
    Collectibles.init(sprites);
    Background.init(sprites, VIEW_W, VIEW_H, GROUND_TOP);
    Particles.init(VIEW_W, VIEW_H);
    player = new Player();

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'playing') setState('paused');
    });

    lastTime = performance.now();
    requestAnimationFrame(loop);
    setState('menu');
    UI.show('menu');
  }

  // ---- 视口适配（移动端/桌面端） ----
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const winW = window.innerWidth, winH = window.innerHeight;
    const scale = Math.min(winW / VIEW_W, winH / VIEW_H);
    const cssW = Math.floor(VIEW_W * scale), cssH = Math.floor(VIEW_H * scale);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(VIEW_W * dpr);
    canvas.height = Math.floor(VIEW_H * dpr);
  }

  // ---- 状态机 ----
  function setState(s) {
    if (state === s) return;
    state = s;
    if (s === 'playing') {
      UI.show('game');
      lastTime = performance.now();
      Sound.startMusic();
    } else if (s === 'paused') {
      UI.show('pause');
      Sound.stopMusic();
    } else if (s === 'over') {
      UI.show('over');
      Sound.stopMusic();
    } else if (s === 'menu') {
      UI.show('menu');
      Sound.stopMusic();
    }
  }

  function toMenu() {
    setState('menu');
  }

  // ---- 开始一局 ----
  function startRun() {
    player.reset();
    player.x = VIEW_W * 0.28;
    player.y = GROUND_TOP;
    obstacles = [];
    items = [];
    speed = 165;
    dist = 0;
    coins = 0;
    runT = 0;
    deathTimer = 0;
    shakeT = 0;
    nextSpawnT = 1.5;          // 开局 1.5 秒出第一组障碍（慢节奏）
    forceCrouchIntro = true;   // 第一组固定为下蹲障碍
    hudTimer = 0;
    // 开局下蹲提示（桌面端与移动端都显示）
    UI.showSlideHint(true);
    crouchHintT = 4.2;
    pauseGuardT = 0.6;      // 开局保护窗口：开局 0.6 秒内忽略暂停输入
    if (Input.isTouch() && window.innerHeight > window.innerWidth) {
      UI.showRotateHint(true);
      setTimeout(() => UI.showRotateHint(false), 3000);
    }
    // 清掉进入游戏前积累的输入信号（体感在菜单态可能已写入 pauseQueued）
    if (typeof Input.clear === 'function') Input.clear();
    setState('playing');
  }

  function gameOver() {
    const score = Math.floor(dist + coins); // coins 已是数值（1 金币 = 10）
    const isRecord = score > best;
    if (isRecord) best = score;
    try { localStorage.setItem('knightRunBest', String(best)); } catch (e) { /* 隐私模式忽略 */ }
    UI.gameOver(dist, coins, best, isRecord);
    setState('over');
  }

  function toggleMute() {
    Sound.setMuted(Sound.muted !== true ? true : false);
  }

  // ---- 生成系统 ----
  // 基于时间的生成节奏：每 nextSpawnT 秒在屏幕右缘生成一组模式。
  // 模式间隔随速度增大（像素间距 = 速度 × 时间间隔），保证反应时间一致。
  function spawn() {
    return spawnPattern(rollPattern());
  }

  function updateSpawn(dt) {
    nextSpawnT -= dt;
    if (nextSpawnT <= 0) {
      // 开局第一组：固定为下蹲障碍（让玩家立刻熟悉 S 键）
      let extraGap = 0;
      if (forceCrouchIntro) {
        forceCrouchIntro = false;
        spawnPattern(introCrouch());
        kindBag = ['jump'];     // 开局第一组是下蹲，下一组固定为跳跃 → 开局即五五开
      } else {
        const pat = spawn();
        // 下蹲隧道（含天花板）后多留空格，保证有反应时间
        if (pat && pat.heavy) extraGap = 0.55;
      }
      // 模式间隔：1.5–2.2 秒（慢节奏，随距离略微收紧难度）
      const tighten = Math.min(dist / 4000, 0.25);
      nextSpawnT = (1.5 - tighten) + Math.random() * (0.7 - tighten * 0.4) + extraGap;
    }
  }

  // 按模式对象生成（障碍 + 收集物）
  let groupSeq = 0;                       // 生成批次序号（用于下蹲/跳跃配比统计）
  function spawnPattern(pat) {
    const spawnX = VIEW_W + 80 + Math.random() * 60;
    const gid = ++groupSeq;
    for (const o of (pat.obs || [])) {
      o.x += spawnX;
      o.groupKind = pat.kind || 'jump';   // 标记该障碍属于"下蹲组"还是"跳跃组"
      o.groupId = gid;
      obstacles.push(o);
      debugCounters.spawns++;
    }
    for (const it of (pat.items || [])) {
      if (it.x === 0) it.x = spawnX + 150 + Math.random() * 60;
      items.push(it);
    }
    return pat;
  }

  // 返回模式：{ obs: [...], items: [...] }
  // 难度配比：用"配额袋"决定这一组是下蹲型还是跳跃型 —— 每 2 组里必有 1 蹲 1 跳
  // （顺序随机），避免纯随机掷硬币带来的长时间偏科，保证稳定五五开。
  let kindBag = [];
  function nextKind() {
    if (!kindBag.length) {
      kindBag = Math.random() < 0.5 ? ['crouch', 'jump'] : ['jump', 'crouch'];
    }
    return kindBag.pop();
  }

  function rollPattern() {
    const d = dist;
    const pool = [];
    const add = (w, fn) => { for (let i = 0; i < w; i++) pool.push(fn); };
    const wantCrouch = nextKind() === 'crouch';

    if (wantCrouch) {
      // ---- 下蹲型（S）：权重偏向"单个大障碍"，避免蹲的比跳的多 ----
      add(20, () => crouchBeam());                       // 长横梁：必须长按 S（1 个障碍）
      add(12, () => crouchBar());                        // 双横梁
      add(10, () => batPass());                          // 双蝙蝠
      add(d > 60 ? 14 : 0, () => crouchTunnel());        // 下蹲隧道：天花板封死跳跃，只能蹲
      add(d > 200 ? 10 : 0, () => crouchSpike());        // 横梁 + 尖刺（蹲完接跳）
      add(d > 380 ? 10 : 0, () => batStorm());           // 蝙蝠 + 长横梁
      add(d > 560 ? 9 : 0, () => crouchGauntlet());      // 横梁 + 蝙蝠
      add(d > 900 ? 6 : 0, () => tunnelSpike());         // 隧道 + 尖刺（高难）
    } else {
      // ---- 跳跃型（W / 空格）----
      add(14, () => single('spike'));                    // 尖刺
      add(10, () => single('crate'));                    // 木箱
      add(10, () => single('barrel'));                   // 木桶
      add(20, () => doubleSpikes());                     // 双尖刺（开局即有，权重最高）
      add(d > 200 ? 10 : 0, () => single('goblin'));     // 哥布林
      add(d > 380 ? 9 : 0, () => single('slime'));       // 史莱姆
      add(d > 560 ? 12 : 0, () => spikeCrate());         // 尖刺 + 木箱
      add(d > 780 ? 12 : 0, () => arrowVolley());        // 箭矢三连（跳或蹲均可）
      add(d > 900 ? 10 : 0, () => tripleGauntlet());     // 尖刺 + 木箱 + 巨兽
      add(d > 1200 ? 6 : 0, () => single('big'));        // 巨兽
      add(d > 1400 ? 8 : 0, () => arrowGoblin());        // 箭矢 + 哥布林
    }

    // 兜底：极端情况下池子为空
    if (!pool.length) add(1, () => single('spike'));

    // 金币模式（独立于障碍）—— 多铺金币，增强成就感（1 枚金币 = 10 数值）
    const coinPool = [
      () => Collectibles.coinArc(0, GROUND_TOP, 7),
      () => Collectibles.coinLine(0, GROUND_TOP, 10, 28, 34),
      () => Collectibles.coinLine(0, GROUND_TOP, 8, 36, 88),
      () => Collectibles.coinLine(0, GROUND_TOP, 12, 30, 34),
      () => Collectibles.coinLine(0, GROUND_TOP, 9, 32, 60),
    ];

    const fn = pool[Math.floor(Math.random() * pool.length)];
    const pat = fn();
    const coinFn = coinPool[Math.floor(Math.random() * coinPool.length)];
    const coinItems = coinFn();

    // 注意：必须透传 kind（下蹲组/跳跃组）与 heavy，否则生成时会丢失分组标记
    const result = {
      kind: pat.kind || 'jump',
      heavy: !!pat.heavy,
      obs: pat.obs || [],
      items: coinItems,
    };

    // 宝石（少量）
    if (Math.random() < 0.16) {
      result.items.push(Collectibles.create('gem', 0, GROUND_TOP));
    }
    // 药水（回血 +1）：血量偏低时概率提升
    const potP = player.hp <= 2 ? 0.28 : 0.1;
    if (Math.random() < potP) {
      result.items.push(Collectibles.create('potion', 0, GROUND_TOP));
    }
    // 道具（护盾/磁铁/双倍），概率随时间提升
    const powP = Math.min(0.09 + d / 20000, 0.2);
    if (Math.random() < powP) {
      const kind = ['shield', 'magnet', 'star'][Math.floor(Math.random() * 3)];
      result.items.push(Collectibles.create(kind, 0, GROUND_TOP));
    }
    // 红心（跳跃撞击回血 +1~+2，可超上限）：较为普及，残血时更容易出现
    const heartP = player.hp <= 3 ? 0.68 : (player.hp <= 5 ? 0.5 : 0.34);
    if (Math.random() < heartP) {
      const n = Math.random() < 0.26 ? 2 : 1;
      // 跳跃组：摆在障碍上方，跳过障碍时顺手吃到；
      // 下蹲组：摆在障碍之后 205~260px 的空档（也正好落在两组障碍之间），蹲过去后再跳起来吃
      const hx = wantCrouch ? (205 + Math.random() * 55) : (35 + Math.random() * 55);
      for (const h of Collectibles.heartArc(hx, GROUND_TOP, n)) result.items.push(h);
    }
    return result;
  }

  // 模式辅助：kind 标记这一组是"下蹲型"还是"跳跃型"（用于五五开配比与测试统计）
  function jumpPat(obs, extra) { return Object.assign({ kind: 'jump', obs }, extra || {}); }
  function crouchPat(obs, extra) { return Object.assign({ kind: 'crouch', obs }, extra || {}); }

  function single(type) {
    return jumpPat([Obstacles.create(type, 0, GROUND_TOP, VIEW_H)]);
  }
  function doubleSpikes() {
    return jumpPat([
      Obstacles.create('spike', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('spike', 66, GROUND_TOP, VIEW_H),
    ]);
  }
  function spikeCrate() {
    return jumpPat([
      Obstacles.create('spike', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('crate', 120, GROUND_TOP, VIEW_H),
    ]);
  }
  function batPass() {
    return crouchPat([
      Obstacles.create('bat', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('bat', 96, GROUND_TOP, VIEW_H),
    ]);
  }
  function crouchBar() {
    return crouchPat([
      Obstacles.create('bar', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('bar', 96, GROUND_TOP, VIEW_H),
    ]);
  }

  // ===== 下蹲型新增模式（FATFIGHT）=====
  // 长横梁：一整段低矮横梁，必须长按 S 才能通过
  function crouchBeam() {
    return crouchPat([Obstacles.create('beam', 0, GROUND_TOP, VIEW_H)]);
  }
  // 下蹲隧道：上方天花板封死跳跃 + 下方横梁，唯一解 = S 下蹲
  function crouchTunnel() {
    return crouchPat([
      Obstacles.create('ceil', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('beam', 0, GROUND_TOP, VIEW_H),
    ], { heavy: true });
  }
  // 横梁 + 尖刺：先蹲过横梁，立刻起跳越过尖刺
  function crouchSpike() {
    return crouchPat([
      Obstacles.create('bar', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('spike', 150, GROUND_TOP, VIEW_H),
    ]);
  }
  // 蝙蝠 + 长横梁
  function batStorm() {
    return crouchPat([
      Obstacles.create('bat', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('beam', 190, GROUND_TOP, VIEW_H),
    ]);
  }
  // 隧道 + 尖刺（高难）：蹲过隧道后马上跳
  function tunnelSpike() {
    return crouchPat([
      Obstacles.create('ceil', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('beam', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('spike', 230, GROUND_TOP, VIEW_H),
    ], { heavy: true });
  }
  // 开局教学组：一组最直观的双横梁（无天花板，跳或蹲都能过）
  function introCrouch() {
    return crouchPat([
      Obstacles.create('bar', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('bar', 96, GROUND_TOP, VIEW_H),
    ]);
  }
  function arrowVolley() {
    return jumpPat([
      Obstacles.create('arrowLow', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('arrowLow', 70, GROUND_TOP, VIEW_H),
      Obstacles.create('arrowLow', 140, GROUND_TOP, VIEW_H),
    ]);
  }
  function tripleGauntlet() {
    return jumpPat([
      Obstacles.create('spike', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('crate', 110, GROUND_TOP, VIEW_H),
      Obstacles.create('big', 250, GROUND_TOP, VIEW_H),
    ]);
  }
  function arrowGoblin() {
    return jumpPat([
      Obstacles.create('arrowLow', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('goblin', 120, GROUND_TOP, VIEW_H),
    ]);
  }
  function crouchGauntlet() {
    return crouchPat([
      Obstacles.create('bar', 0, GROUND_TOP, VIEW_H),
      Obstacles.create('bat', 170, GROUND_TOP, VIEW_H),
    ]);
  }

  // ---- 碰撞 ----
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function handleCollisions() {
    const ph = player.hitbox;
    for (const o of obstacles) {
      if (o.hit || o.dead) continue;
      const oh = Obstacles.hitbox(o, VIEW_H);
      if (!rectsOverlap(ph, oh)) continue;
      o.hit = true; // 一次性障碍
      debugCounters.hits++;
      const res = player.damage();
      if (res === 'shield') {
        Sound.sfx.shieldBreak();
        Particles.hitBurst(player.x, player.y - 22);
        effects.shake(8, 0.3);
        UI.powerups(player);
      } else if (res === 'hit') {
        debugCounters.hurt++;
        effects.shake(8, 0.3);
        Particles.hitBurst(player.x, player.y - 22);
        // 保命机制：被降到 1 血时，自动花 2 枚金币回满血（1 枚金币 = 10 数额）
        if (player.hp === 1) {
          if (coins >= 2) {
            coins -= 2;
            player.heal(player.maxHp, false);
            Sound.sfx.power();
            Particles.coinSparkle(player.x, player.y - 22, '#ffd75e');
            Particles.floatText(player.x, player.y - 60, '保命回满血 -2 数值', '#7ee787');
          } else {
            Particles.floatText(player.x, player.y - 60, '金币不足，无法保命！', '#ff7b72');
          }
        }
        UI.powerups(player);
        // 注意：受击不再产生任何位移 —— 水平移动只由 A/D 决定（无击退、无惯性）
      } else if (res === 'died') {
        debugCounters.deaths++;
        effects.shake(14, 0.45);
        Particles.hitBurst(player.x, player.y - 22);
        deathTimer = 0;
        Sound.stopMusic();
      }
    }
  }

  function onCollect(c) {
    c.taken = true;
    if (c.type === 'coin') {
      coins += 10;   // 1 枚金币 = 10 数值
      Sound.sfx.coin();
      Particles.coinSparkle(c.x, c.y, '#ffd75e');
      Particles.floatText(c.x, c.y - 24, '+10', '#ffd75e');
    } else if (c.type === 'gem') {
      coins += 50;   // 宝石 = 5 枚金币 = 50 数值
      Sound.sfx.gem();
      Particles.coinSparkle(c.x, c.y, '#55c8e8');
      Particles.floatText(c.x, c.y - 24, '+50', '#55c8e8');
    } else if (c.type === 'shield') {
      player.shield = true;
      Sound.sfx.power();
      Particles.coinSparkle(c.x, c.y, '#6fe8ff');
    } else if (c.type === 'magnet') {
      player.magnet = 8;
      Sound.sfx.power();
      Particles.coinSparkle(c.x, c.y, '#ff8a6a');
    } else if (c.type === 'star') {
      player.scoreMult = 2;
      player.multT = 10;
      Sound.sfx.levelup();
      Particles.coinSparkle(c.x, c.y, '#ffe06a');
    } else if (c.type === 'potion') {
      player.heal(1);
      Sound.sfx.power();
      Particles.coinSparkle(c.x, c.y, '#ff6a8a');
      Particles.floatText(c.x, c.y - 24, '+1 HP', '#ff8ab0');
    } else if (c.type === 'heart') {
      // 红心：随机 +1 或 +2，允许超过基础满血（最多 OVERHEAL_CAP）
      const gain = Math.random() < 0.5 ? 1 : 2;
      const real = player.heal(gain, true);
      Sound.sfx.power();
      Sound.sfx.coin();
      Particles.coinSparkle(c.x, c.y, '#ff4d6d');
      Particles.floatText(c.x, c.y - 24, real > 0 ? `+${real} HP` : 'HP 已满', real > 0 ? '#ff5c7a' : '#c9b98a');
      if (real > 0) Game.effects.dust(c.x, c.y + 10, 3);
    }
    UI.powerups(player);
  }

  // ---- 更新 ----
  function update(dt) {
    runT += dt;
    // 世界滚动速度（FATFIGHT 慢节奏版）：起步 165，每秒 +2，上限 380
    // 玩家不按 A/D 就完全静止，世界慢速滚动给足观察与操作时间
    speed = Math.min(165 + runT * 2, 380);
    dist += speed * dt / 60; // 1 米 = 60px

    // 开局保护：刚开局短暂忽略暂停（防误触 / 防残留信号立即弹暂停界面）
    if (pauseGuardT > 0) pauseGuardT -= dt;
    // 输入
    const inp = Input.consume();
    if (inp.pause && pauseGuardT <= 0) { setState('paused'); return; }
    if (inp.restart && state === 'playing') { startRun(); return; }

    // 玩家（WASD 自由移动，边界限制在屏幕内）
    player.update(dt, inp, GROUND_TOP, GRAVITY, [46, VIEW_W - 46]);

    // 障碍
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      Obstacles.update(o, dt, speed, VIEW_H);
      if (o.dead) obstacles.splice(i, 1);
    }
    // 金币/道具
    for (let i = items.length - 1; i >= 0; i--) {
      const c = items[i];
      Collectibles.update(c, dt, speed, player, onCollect);
      if (c.dead) items.splice(i, 1);
    }

    // 碰撞
    handleCollisions();

    // 生成（基于时间节奏）
    updateSpawn(dt);

    // 粒子
    Particles.update(dt);
    if (shakeT > 0) shakeT -= dt;

    // 高速速度线（新上限 380，从 300 起有速度感）
    if (speed > 300) {
      speedLineT -= dt;
      if (speedLineT <= 0) {
        Particles.speedLines(2, speed);
        speedLineT = 0.3;
      }
    }

    // 下蹲提示（开局 4 秒，桌面端与移动端都显示）
    if (crouchHintT > 0) {
      crouchHintT -= dt;
      if (crouchHintT <= 0) UI.showSlideHint(false);
    }

    // 死亡结算
    if (player.dead) {
      deathTimer += dt;
      if (deathTimer > 1.15) gameOver();
    }

    // HUD
    hudTimer -= dt;
    if (hudTimer <= 0) {
      UI.hud(dist, coins, player.hp, player.maxHp);
      UI.powerups(player);
      hudTimer = 0.12;
    }
  }

  // ---- 渲染 ----
  function render() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 震屏
    if (shakeT > 0) {
      const a = shakeAmp * (shakeT / 0.25);
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }

    // 场景
    Background.draw(ctx, dist, speed, 1 / 60);

    // 收集物
    for (const c of items) Collectibles.draw(ctx, c, VIEW_H);

    // 障碍
    for (const o of obstacles) Obstacles.draw(ctx, o, VIEW_H, sprites);

    // 玩家
    player.draw(ctx, sprites, 3);

    // 粒子
    Particles.draw(ctx);

    ctx.restore();
  }

  // ---- 主循环 ----
  function loop(t) {
    rafId = requestAnimationFrame(loop);
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;

    if (state === 'playing') update(dt);
    else if (state === 'menu') menuSim(dt);
    render();
  }

  // 主菜单背景模拟跑酷
  function menuSim(dt) {
    speed = 150;
    dist += speed * dt / 60;
    Particles.update(dt);
    player.animT += dt * 11;
    if (player.y < GROUND_TOP) { player.y = Math.min(GROUND_TOP, player.y + 400 * dt); player.onGround = true; }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      Obstacles.update(obstacles[i], dt, speed, VIEW_H);
      if (obstacles[i].dead) obstacles.splice(i, 1);
    }
    for (let i = items.length - 1; i >= 0; i--) {
      Collectibles.update(items[i], dt, speed, player, () => {});
      if (items[i].dead) items.splice(i, 1);
    }
    if (obstacles.length < 4 && Math.random() < 0.03) {
      const p = single(['spike', 'crate', 'barrel'][Math.floor(Math.random() * 3)]);
      for (const o of p.obs) { o.x = VIEW_W + 60 + Math.random() * 200; obstacles.push(o); }
    }
  }

  // ---- 启动 ----
  window.addEventListener('DOMContentLoaded', boot);

  // 调试钩子（供自动化测试/控制台调试使用）
  function debug() {
    return {
      state, player, obstacles, items, dist, speed, coins,
      GroundTop: GROUND_TOP, ViewW: VIEW_W, ViewH: VIEW_H,
      Obstacles, TYPES: Obstacles.TYPES,
      Collectibles,
      counters: { ...debugCounters },
    };
  }
  window._gameDebug = debug;

  return { effects, debug };
})();
