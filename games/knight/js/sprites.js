/* ============================================================
 * sprites.js — 素材加载与程序化像素美术
 * 主素材来源：Kenney.nl 公共领域(CC0)素材包
 *   - Pixel Platformer（角色/敌人/地面/背景）
 *   - Medieval RTS（备用 2D 纹理）
 * 所有美术均可在 assets/img/ 中替换
 * ============================================================ */
'use strict';

const Sprites = (() => {

  // ---------- 素材加载 ----------
  const images = {};       // 已加载的 Image 对象
  const loadedFlags = {};  // 加载成功标记
  let readyResolve, readyPromise = new Promise(res => readyResolve = res);
  let loadedCount = 0, totalCount = 0;

  const IMG_PATHS = {
    characters: 'assets/img/tilemap-characters.png',
    tiles: 'assets/img/tilemap.png',
    backgrounds: 'assets/img/tilemap-backgrounds.png',
  };

  function loadImages() {
    const keys = Object.keys(IMG_PATHS);
    totalCount = keys.length;
    keys.forEach(k => {
      const img = new Image();
      img.onload = () => { loadedFlags[k] = true; onOneLoaded(); };
      img.onerror = () => { loadedFlags[k] = false; onOneLoaded(); };
      img.src = IMG_PATHS[k];
      images[k] = img;
    });
  }
  function onOneLoaded() {
    loadedCount++;
    if (loadedCount >= totalCount) readyResolve();
  }

  // ---------- 程序化像素美术基础设施 ----------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 从字符画渲染像素图（每个字符 = 1 个"美术像素"，scale 缩放）
  function artFrom(palette, rows, scale = 1) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const c = makeCanvas(w * scale, h * scale);
    const ctx = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const col = palette[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }

  // 从精灵图(Image)按网格裁切一格的画布
  function frameFrom(img, col, row, tw, th, gap = 1) {
    const c = makeCanvas(tw, th);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const x = col * (tw + gap), y = row * (th + gap);
    try {
      ctx.drawImage(img, x, y, tw, th, 0, 0, tw, th);
    } catch (e) { /* 加载失败则留空 */ }
    return c;
  }

  // ---------- 调色板 ----------
  const P = {
    knight: {
      '.': '', k: '#26203a', s: '#d7deee', S: '#96a1bc', g: '#3f9e55', G: '#2b6f3c',
      b: '#8a5a2b', B: '#5f3c1c', r: '#d0452f', f: '#f2c79b', w: '#ffffff', h: '#6a5a4a',
    },
    enemy: {
      '.': '', k: '#20263a', b: '#4a5578', B: '#37405e', w: '#ffffff', W: '#dfe7f5',
      g: '#6a8f3c', G: '#4e6a2a', r: '#c0523a', o: '#e08a4a', O: '#a85f2f', y: '#e8c93f',
    },
    item: {
      '.': '', k: '#3a2c1a', g: '#f5c542', G: '#c8932a', s: '#e8e8f0', S: '#9aa4c0',
      b: '#8a5a2b', B: '#5f3c1c', r: '#e04535', R: '#a03025', c: '#55c8e8', C: '#2a8fb0',
      p: '#c86ae8', P: '#8a3aa8', w: '#ffffff',
    },
  };

  // ---------- 角色精灵（程序化兜底 + 资产映射） ----------
  const knightRows = {
    runA: [
      '....rrrrr.....',
      '...rrrrrrr....',
      '...sssssss....',
      '..sssssssss...',
      '..sksssssks...',
      '..sfkssskfs...',
      '..sfkssskfs...',
      '..sssgggsss...',
      '..sgggGgggs...',
      '..sgggGgggs...',
      '..sssgggsss...',
      '..bbbbbbbbb...',
      '.ggggggggggg..',
      '.g.g.GG.g.g...',
      '.g.g..gg.g.g..',
      '....b....b....',
    ],
    runB: [
      '....rrrrr.....',
      '...rrrrrrr....',
      '...sssssss....',
      '..sssssssss...',
      '..sksssssks...',
      '..sfkssskfs...',
      '..sfkssskfs...',
      '..sssgggsss...',
      '..sgggGgggs...',
      '..sgggGgggs...',
      '..sssgggsss...',
      '..bbbbbbbbb...',
      '.ggggggggggg..',
      '..gg.GGG.gg...',
      '...g...g.g....',
      '..b....b......',
    ],
    jump: [
      '....rrrrr.....',
      '...rrrrrrr....',
      '...sssssss....',
      '..sssssssss...',
      '..sksssssks...',
      '..sfkssskfs...',
      '..sfkssskfs...',
      '..sssgggsss...',
      '..sgggGgggs...',
      '..sgggGgggs...',
      '..sssgggsss...',
      '..bbbbbbbbb...',
      '.ggggggggggg..',
      '.gg..GGG..gg..',
      '.............',
      '..b........b..',
    ],
    slide: [
      '..............',
      '..............',
      '..rrrrrrrrr...',
      '..sssssssss...',
      '..sksssssks...',
      '..sfkssskfs...',
      '..sfkssskfs...',
      '..sssgggsss...',
      '..sgggGgggs...',
      '..ssgggggss...',
      '..bbbbbbbbb...',
      '.ggggggggggg..',
      '.g.ggGGgg.gg..',
      '..bb....bb.b..',
    ],
  };
  function renderKnight() {
    const out = {};
    ['runA', 'runB', 'jump', 'slide'].forEach(k => {
      out[k] = artFrom(P.knight, knightRows[k]);
      // 镜像帧
      const m = makeCanvas(out[k].width, out[k].height);
      const mx = m.getContext('2d');
      mx.translate(out[k].width, 0);
      mx.scale(-1, 1);
      mx.drawImage(out[k], 0, 0);
      out[k + 'M'] = m;
    });
    return out;
  }

  // 敌人：史莱姆 / 哥布林 / 巨兽
  const slimeRows = [
    [
      '..............',
      '....bbbbbb....',
      '..bbbbbbbbbb..',
      '.bBbbbbbbbBb..',
      '.bwwbbbbwwbb..',
      '.bwwBbbBwwB...',
      'bbbbbbbbbbbb..',
      '.bbbbbbbbbb...',
      '..bbbbbbbb....',
      '..............',
    ],
    [
      '..............',
      '....bbbbbb....',
      '..bbbbbbbbbb..',
      '.bBbbbbbbbBb..',
      '.bbwwbbwwbb...',
      '.bbwwBwwBbb...',
      'bbbbbbbbbbbb..',
      '.bbbbbbbbbb...',
      '..bbbbbbbb....',
      '..............',
    ],
    [
      '..............',
      '..............',
      '....bbbbbb....',
      '..bbbbbbbbbb..',
      '.bBbbbbbbbBb..',
      '.bwwbbbbwwbb..',
      '.bwwBbbBwwB...',
      'bbbbbbbbbbbb..',
      '..bbbbbbbb....',
      '..............',
    ],
  ];
  const goblinRows = [
    [
      '........oo....',
      '......oOOOO...',
      '.....oOwwOo...',
      '.....OwkkwO...',
      '......OOOO....',
      '.....kgggk....',
      '....ggggggg...',
      '...ggggggggg..',
      '...g.g..g.g...',
      '...b.b..b.b...',
    ],
    [
      '.....oo.......',
      '....oOOOO.....',
      '....oOwwOo....',
      '....OwkkwO....',
      '.....OOOO.....',
      '....kgggk.....',
      '...ggggggg....',
      '..ggggggggg...',
      '..g.g..g.g....',
      '..b.b..b.b....',
    ],
    [
      '........oo....',
      '......oOOOO...',
      '.....oOwwOo...',
      '.....OwkkwO...',
      '......OOOO....',
      '.....kgggk....',
      '....ggggggg...',
      '...ggggggggg..',
      '...g..g..g.g..',
      '...b....b.b...',
    ],
  ];
  const bigRows = [
    [
      '................',
      '.....bbbbbbb....',
      '...bbwwwwbbb....',
      '..bbwwkkwwbbb...',
      '..bwkkkkkwbb....',
      '.bbwwkkwwbbbb...',
      '.bbbbbbbbbbbb...',
      '.bbbbbbbbbbbb...',
      '.bBbbbbbbbbBb...',
      'bbbbbbbbbbbbbb..',
      'bbbbbbbbbbbbbb..',
      '.bbbbbbbbbbbb...',
      '..bb...bb...bb..',
      '..bb...bb...bb..',
    ],
    [
      '.....bbbbbbb....',
      '...bbwwwwbbb....',
      '..bbwwkkwwbbb...',
      '..bwkkkkkwbb....',
      '.bbwwkkwwbbbb...',
      '.bbbbbbbbbbbb...',
      '.bbbbbbbbbbbb...',
      '.bBbbbbbbbbBb...',
      'bbbbbbbbbbbbbb..',
      'bbbbbbbbbbbbbb..',
      '.bbbbbbbbbbbb...',
      '..bb...bb...bb..',
      '..bb...bb...bb..',
      '................',
    ],
    [
      '................',
      '.....bbbbbbb....',
      '...bbwwwwbbb....',
      '..bbwwkkwwbbb...',
      '..bwkkkkkwbb....',
      '.bbwwkkwwbbbb...',
      '.bbbbbbbbbbbb...',
      '.bbbbbbbbbbbb...',
      '.bBbbbbbbbbBb...',
      'bbbbbbbbbbbbbb..',
      'bbbbbbbbbbbbbb..',
      '.bbbbbbbbbbbb...',
      '...bb....bb..bb.',
      '...bb....bb..bb.',
    ],
  ];
  function renderEnemies() {
    const out = {};
    out.slime = slimeRows.map(r => artFrom(P.enemy, r));
    out.goblin = goblinRows.map(r => artFrom(P.enemy, r));
    out.big = bigRows.map(r => artFrom(P.enemy, r));
    return out;
  }

  // 障碍物：尖刺 / 木箱 / 木桶 / 箭头 / 蝙蝠
  const spikeRows = [
    '....k....',
    '...kkk...',
    '..kkkkk..',
    '.kkkkkkk.',
    'kkkkkkkkk',
  ];
  const crateRows = [
    'kkkkkkkkkkkk',
    'kBBBBBBBBBBk',
    'kBbBbBbBbBbk',
    'kBbBbBbBbBbk',
    'kBBBBBBBBBBk',
    'kBbBbBbBbBbk',
    'kBbBbBbBbBbk',
    'kBBBBBBBBBBk',
    'kkkkkkkkkkkk',
  ];
  const barrelRows = [
    '...kkkk...',
    '..kkkkkk..',
    '.kBBBBBBk.',
    'kBBkkkkBBk',
    'kBBkkkkBBk',
    'kBBkkkkBBk',
    'kBBBBBBBBk',
    '.kBBBBBBk.',
    '..kkkkkk..',
    '...kkkk...',
  ];
  const arrowRows = [
    '.....k.....',
    '....k......',
    'kkkkkkkkkk.',
    '....k......',
    '.....k.....',
  ];
  const batRows = [
    [
      '....kk....',
      '..kkkkkk..',
      '.kwwkkwwk.',
      'kwwkkkkwwk',
      '.kkkkkkkk.',
      '..kk..kk..',
    ],
    [
      '....kk....',
      '..kkkkkk..',
      '.kwwkkwwk.',
      'kwwkkkkwwk',
      '.kkkkkkkk.',
      '..k....k..',
    ],
  ];
  // 横梁（低矮跨栏）：必须下蹲才能通过，跳跃会撞上
  const barRows = [
    '................',
    '................',
    '....kkkkkkkk....',
    '....kBBBBBBk....',
    '....kBBBBBBk....',
    '....kkkkkkkk....',
    '................',
    '...k........k...',
    '...k..kkkk..k...',
    '...k..kBBk..k...',
    '...k..kBBk..k...',
    '...k..kkkk..k...',
    '...k........k...',
    '...kkkkkkkkkk...',
  ];
  function renderObstacles() {
    const out = {};
    out.spike = artFrom(P.item, spikeRows);
    out.crate = artFrom(P.item, crateRows);
    out.barrel = artFrom(P.item, barrelRows);
    out.arrow = artFrom(P.item, arrowRows);
    out.bat = batRows.map(r => artFrom(P.enemy, r));
    out.bar = artFrom(P.item, barRows);
    return out;
  }

  // 收集物：金币 / 宝石 / 护盾 / 磁铁 / 双倍
  const coinRows = [
    [
      '..kkkk..',
      '.kggggk.',
      'kggggggk',
      'kggggggk',
      'kggggggk',
      '.kggggk.',
      '..kkkk..',
    ],
    [
      '..kkkk..',
      '.kGggGk.',
      'kGgkkggk',
      'kgkkkkGk',
      'kGgkkggk',
      '.kGggGk.',
      '..kkkk..',
    ],
  ];
  const gemRows = [
    '...kk...',
    '..kcck..',
    '.kcccck.',
    '.kcccck.',
    '..kcck..',
    '...kk...',
  ];
  const shieldRows = [
    '...kk...',
    '..kssk..',
    '.kssssk.',
    'kssssssk',
    '.kSssSk.',
    '..kssk..',
    '...kk...',
  ];
  const magnetRows = [
    '.....k.....',
    '..k..k..k..',
    '.krk.krkrk.',
    '.kkkkkkkkk.',
    '..krkrkrk..',
    '.kkkkkkkkk.',
    '..k..k..k..',
    '.....k.....',
  ];
  const starRows = [
    '....k....',
    '....k....',
    '.kkkkkkk.',
    '..kkkkk..',
    '.kkkkkkk.',
    '....k....',
    '....k....',
  ];
  // 红心（悬在空中，需跳跃撞击；回血 +1 或 +2，可超过血量上限）
  const heartRows = [
    [
      '..kk...kk..',
      '.krrk.krrk.',
      'krrrrkrrrrk',
      'krrwrrrrrrk',
      'krrrrrrrrRk',
      '.krrrrrrRk.',
      '..krrrrRk..',
      '...krrRk...',
      '....kRk....',
      '.....k.....',
    ],
    [
      '..kk...kk..',
      '.krrk.krrk.',
      'krrrkwrrrrk',
      'krrwrrrrrrk',
      '.krrrrrrRk.',
      '..krrrrRk..',
      '...krrRk...',
      '....kRk....',
      '.....k.....',
      '...........',
    ],
  ];
  // 药水（回血 +1）
  const potionRows = [
    '...kk...',
    '..kRRk..',
    '.kRRRRk.',
    '.kRRRRk.',
    'kRRRRRRk',
    'kRRRRRRk',
    'kRRRRRRk',
    '.kRRRRk.',
    '..kkkk..',
  ];
  function renderItems() {
    const out = {};
    out.coin = coinRows.map(r => artFrom(P.item, r));
    out.gem = artFrom(P.item, gemRows);
    out.shield = artFrom(P.item, shieldRows);
    out.magnet = artFrom(P.item, magnetRows);
    out.star = artFrom(P.item, starRows);
    out.potion = artFrom(P.item, potionRows);
    out.heart = heartRows.map(r => artFrom(P.item, r));
    return out;
  }

  // 环境：城堡塔 / 旗帜 / 灌木 / 树 / 岩石 / 云 / 山
  const towerRows = [
    '...kkk..........',
    '..krrrk....k....',
    '..krrrk...k.....',
    '..ksssk..k......',
    '..ksssk..k......',
    '.ksssssk.k......',
    '.ksssssk.k......',
    '.kssssskkk......',
    'ksssssssssk.....',
    'ksssssssssk.....',
    'ksssssssssk.....',
    'ksssssssssk.....',
    'kkkkkkkkkkkk....',
    '.kssssssssk.....',
    '.kskskskssk.....',
    '.kssssssssk.....',
    '.kkkkkkkkkk.....',
  ];
  const bushRows = [
    '...kkkk...',
    '..kGGGGk..',
    '.kGGggGGk.',
    'kGGggggGGk',
    'kGggggggGk',
    'kkkkkkkkkk',
  ];
  const treeRows = [
    '....kkkkk....',
    '..kggggggk...',
    '.kggggggggk..',
    'kggggggggggk.',
    'kggggggggggk.',
    '.kggggggggk..',
    '..kggggggk...',
    '....kkkkk....',
    '......kk.....',
    '.....kkkk....',
    '.....kkkk....',
    '.....kkkk....',
  ];
  const rockRows = [
    '..kkkkkk..',
    '.kddddddk.',
    'kdddkddddk',
    'kddddddddk',
    'kkkkkkkkkk',
  ];
  const cloudRows = [
    '.....kkkkkkk....',
    '...kkwwwwwwkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwwwwwwwwk.',
    'kkwwwwwwwwwwwwkk',
    'kkkkkkkkkkkkkkkk',
  ];
  const mountainRows = [
    'k..................k..................k',
    'kk................kk................kk',
    'kkk..............kkk................kk',
    'kkkk............kkkk................kk',
    'kkkkk..........kkkkk................kk',
    'kkkkkk........kkkkkk................kk',
    'kkkkkkk......kkkkkkk................kk',
    'kkkkkkkk....kkkkkkkk................kk',
    'kkkkkkkkk..kkkkkkkkk................kk',
    'kkkkkkkkkkkkkkkkkkkk................kk',
    'kkkkkkkkkkkkkkkkkkkk................kk',
    'kkkkkkkkkkkkkkkkkkkk................kk',
  ];
  function renderEnvironment() {
    const out = {};
    out.tower = artFrom(P.knight, towerRows);
    out.bush = artFrom(P.enemy, bushRows);
    out.tree = artFrom(P.enemy, treeRows);
    out.rock = artFrom(P.item, rockRows);
    out.cloud = artFrom(P.item, cloudRows);
    out.mountain = artFrom(P.enemy, mountainRows);
    return out;
  }

  // ---------- 地面拼接 ----------
  // 用资产瓷砖拼接一条地面竖条（顶部草地 + 泥土），横向重复
  function buildGroundStrip() {
    const tw = 18, th = 18; // 资产瓷砖尺寸
    const can = makeCanvas(tw, th * 4);
    const ctx = can.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let ok = false;
    if (loadedFlags.tiles) {
      try {
        // 草地顶：row0 的 t18；草体：r1 t18；草底：r2 t18；泥土：r7 t1
        ctx.drawImage(images.tiles, 18 * (tw + 1), 0, tw, th, 0, 0, tw, th);
        ctx.drawImage(images.tiles, 18 * (tw + 1), th + 1, tw, th, 0, th, tw, th);
        ctx.drawImage(images.tiles, 18 * (tw + 1), (th + 1) * 2, tw, th, 0, th * 2, tw, th);
        ctx.drawImage(images.tiles, (tw + 1), (th + 1) * 7, tw, th, 0, th * 3, tw, th);
        ok = true;
      } catch (e) { ok = false; }
    }
    if (!ok) {
      // 兜底：程序化草地
      const g = ctx.createLinearGradient(0, 0, 0, th * 4);
      g.addColorStop(0, '#4aa94f'); g.addColorStop(0.45, '#3d8a44');
      g.addColorStop(0.5, '#7a5a33'); g.addColorStop(1, '#5f3f24');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, tw, th * 4);
      ctx.fillStyle = '#3d8a44';
      for (let x = 0; x < tw; x += 3) ctx.fillRect(x, 0, 1, 3);
    }
    return can;
  }

  // ---------- 角色资产帧（Kenney Pixel Platformer 24px 精灵） ----------
  // 角色表布局（9列×3行，24px，1px 间隙）：
  //   第0行：玩家（绿/蓝/粉/黄 4 个颜色变体，各 2 帧跑步）
  //   第1行：角色动作帧（跳跃/滑铲等）
  //   第2行：敌人（史莱姆 t0-2、巨兽 t3-5、哥布林 t6-8）
  function extractCharacterFrames() {
    if (!loadedFlags.characters) return null;
    try {
      const tw = 24, th = 24, gap = 1;
      const f = (col, row) => frameFrom(images.characters, col, row, tw, th, gap);
      const mirror = (c) => {
        const mc = makeCanvas(c.width, c.height);
        const mx = mc.getContext('2d');
        mx.imageSmoothingEnabled = false;
        mx.translate(c.width, 0);
        mx.scale(-1, 1);
        mx.drawImage(c, 0, 0);
        return mc;
      };
      const g0 = f(0, 0), g1 = f(1, 0); // 绿骑士 2 帧跑步
      return {
        playerRun: [g0, g1, mirror(g0), mirror(g1)],
        playerJump: g1,
        playerSlideBase: g0,
        slime: [f(0, 2), f(1, 2), f(2, 2)],
        big: [f(3, 2), f(4, 2), f(5, 2)],
        goblin: [f(6, 2), f(7, 2), f(8, 2)],
      };
    } catch (e) {
      return null;
    }
  }

  // ---------- 公共 API ----------
  let built = null;
  function build() {
    if (built) return built;
    const chars = extractCharacterFrames();
    built = {
      knight: renderKnight(),
      enemies: renderEnemies(),
      obstacles: renderObstacles(),
      items: renderItems(),
      env: renderEnvironment(),
      groundStrip: buildGroundStrip(),
      characters: chars, // Kenney 角色帧（可能为 null）
      // 资产原图（用于可能的增强）
      images,
      flags: loadedFlags,
      tiles: null,
      mountains: null,
    };
    // 扁平查找表（供障碍/收集物按名字取图）
    built.flat = Object.assign({}, built.obstacles, built.enemies, built.items);
    // 用 Kenney 敌人帧替换程序化兜底（带各自缩放）
    if (chars) {
      built.flat.slime = { frames: chars.slime, scale: 1.7 };
      built.flat.goblin = { frames: chars.goblin, scale: 1.35 };
      built.flat.big = { frames: chars.big, scale: 2.5 };
    }
    // 资产背景：山脉剪影
    if (loadedFlags.backgrounds) {
      try {
        const c = makeCanvas(48, 72);
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(images.backgrounds, 0, 0, 48, 72, 0, 0, 48, 72);
        built.mountains = c;
      } catch (e) { built.mountains = built.env.mountain; }
    } else {
      built.mountains = built.env.mountain;
    }
    return built;
  }

  return {
    loadImages,
    ready: () => readyPromise,
    build,
    artFrom,
    frameFrom,
    makeCanvas,
  };
})();
