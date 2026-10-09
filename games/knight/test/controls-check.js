/* ============================================================
 * test/controls-check.js — FATFIGHT 三项改动回归测试
 *   1) 移动：不按=静止 / D 右移 / A 左移 / 松开即停 / A+D 同按静止 / 受击不产生位移
 *   2) 跳跃：W = 一级跳（空中再按 W 无效）；空格 = 地面起跳 + 空中二段跳（更高）
 *   3) 下蹲：开局第一组即为下蹲障碍；横梁/长横梁靠 S 通过；天花板隧道跳跃必撞
 * 运行：node test/controls-check.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stubs = require('./smoke-stubs.js');
const sandbox = stubs.sandbox;
const { getEl, fireWin, step, drainTimers } = stubs;

vm.createContext(sandbox);

const ROOT = path.join(__dirname, '..');
const files = ['audio.js', 'input.js', 'sprites.js', 'player.js', 'obstacles.js', 'collectibles.js', 'background.js', 'particles.js', 'ui.js', 'game.js'];
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
}

fireWin('DOMContentLoaded');
drainTimers();

let failed = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
}

function press(key, code) { fireWin('keydown', { key, code }); }
function release(key, code) { fireWin('keyup', { key, code }); }
function tap(key, code) { press(key, code); step(); release(key, code); }
function frames(n) { for (let i = 0; i < n; i++) step(); }

(async function main() {
  await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 10));
  getEl('btn-play').dispatch('click');
  step();

  const gd = sandbox._gameDebug;
  const d0 = gd();
  const P = d0.player;
  const GROUND = d0.GroundTop;

  // ================= 0. 开局第一组障碍必须是下蹲型 =================
  console.log('\n[0] 开局 —— 第一组障碍即为下蹲装置');
  let firstType = null, firstFrame = -1;
  for (let i = 0; i < 300 && !firstType; i++) {
    step();
    for (const o of gd().obstacles) { firstType = o.type; firstFrame = i; break; }
  }
  const firstDef = gd().TYPES[firstType];
  assert(`开局 ${(firstFrame / 60).toFixed(1)}s 出现第一组障碍，类型为下蹲型（type=${firstType}）`,
    !!firstDef && firstDef.crouch === true);
  // 期间持续给玩家续命，避免中途死亡导致停止生成，影响样本量
  const seenGroup = new Set();
  const seenObs = new Set();
  const groups = { crouch: 0, jump: 0 };   // 按生成批次统计
  const obses = { crouch: 0, jump: 0 };    // 按障碍个数统计
  for (let i = 0; i < 7200; i++) {
    const p = gd().player;
    p.hp = p.maxHp; p.dead = false; p.alive = true; p.deathT = 0; p.invincible = 0;
    step();
    for (const o of gd().obstacles) {
      if (seenObs.has(o)) continue;
      seenObs.add(o);
      // 障碍个数按"障碍自身解法"统计（混合组里的尖刺仍算跳跃障碍）
      obses[o.t && o.t.crouch ? 'crouch' : 'jump']++;
      if (seenGroup.has(o.groupId)) continue;   // 同一批（groupId）只计一次
      seenGroup.add(o.groupId);
      groups[o.groupKind === 'crouch' ? 'crouch' : 'jump']++;
    }
  }
  const gTotal = groups.crouch + groups.jump;
  const oTotal = obses.crouch + obses.jump;
  const gRatio = gTotal ? groups.crouch / gTotal : 0;
  const oRatio = oTotal ? obses.crouch / oTotal : 0;
  assert(`前 120s 生成批次 下蹲 : 跳跃 = ${groups.crouch} : ${groups.jump}（下蹲 ${(gRatio * 100).toFixed(0)}%，期望 ≈50%）`,
    gRatio >= 0.45 && gRatio <= 0.55);
  assert(`前 120s 障碍个数 下蹲 : 跳跃 = ${obses.crouch} : ${obses.jump}（下蹲 ${(oRatio * 100).toFixed(0)}%，期望 ≈50%）`,
    oRatio >= 0.42 && oRatio <= 0.58);

  // 上面 60 秒是无操作观察（会被撞死），重开一局再做操作类测试
  getEl('btn-retry').dispatch('click');
  step();
  gd().obstacles.length = 0;

  // ================= 1. 移动：严格 A/D =================
  console.log('\n[1] 移动 —— 只有 A/D 能产生位移');
  const x0 = P.x;
  frames(60);
  assert(`不按任何键：60 帧位移 ${(P.x - x0).toFixed(3)}px（应为 0）`, Math.abs(P.x - x0) < 1e-6);

  press('d', 'KeyD');
  const x1 = P.x; frames(30);
  const dMove = P.x - x1;
  assert(`按住 D 右移：30 帧 +${dMove.toFixed(1)}px（期望 ≈140）`, dMove > 125 && dMove < 160);
  release('d', 'KeyD');
  const x2 = P.x; frames(30);
  assert(`松开 D 立即静止：+${(P.x - x2).toFixed(3)}px`, Math.abs(P.x - x2) < 1e-6);

  press('a', 'KeyA');
  const x3 = P.x; frames(30);
  const aMove = P.x - x3;
  assert(`按住 A 左移：30 帧 ${aMove.toFixed(1)}px（期望 ≈-140）`, aMove < -125 && aMove > -160);

  press('d', 'KeyD');                 // A+D 同时按住
  const x4 = P.x; frames(30);
  assert(`A+D 同按静止：${(P.x - x4).toFixed(3)}px`, Math.abs(P.x - x4) < 1e-6);
  release('a', 'KeyA'); release('d', 'KeyD'); frames(5);

  // 受击不产生位移（无击退）
  const hpBefore = P.hp;
  const xBefore = P.x;
  // 注意：obstacles 数组在 startRun() 里会被重新赋值，必须每次用 gd() 取最新的
  gd().obstacles.push(gd().Obstacles.create('spike', P.x + 40, GROUND, d0.ViewH));
  frames(30);
  assert(`受击扣血（${hpBefore} → ${P.hp}）`, P.hp === hpBefore - 1);
  assert(`受击不产生位移：${(P.x - xBefore).toFixed(3)}px`, Math.abs(P.x - xBefore) < 1e-6);
  gd().obstacles.length = 0;

  // ================= 2. 跳跃：W 一级 / 空格二段 =================
  console.log('\n[2] 跳跃 —— W 起跳，空格二段跳');
  frames(30);                          // 等落地/静止
  assert('回到地面', P.onGround === true);

  // W 起跳后空中再按 W：只算一级跳
  tap('w', 'KeyW');
  frames(6);
  const jumpsAfterW = P.jumps;
  tap('w', 'KeyW');
  frames(2);
  assert(`空中再按 W 不触发二段跳（jumps=${P.jumps}）`, P.jumps === 1 && jumpsAfterW === 1);
  frames(90);                          // 落地

  // 单跳最高点
  tap('w', 'KeyW');
  let singleApex = P.y;
  for (let i = 0; i < 60; i++) { step(); singleApex = Math.min(singleApex, P.y); if (P.onGround && i > 5) break; }
  frames(40);

  // 空格：地面起跳 → 空中二段跳
  tap(' ', 'Space');
  assert(`空格在地面触发一级跳（onGround=${P.onGround}, jumps=${P.jumps}）`, P.onGround === false && P.jumps === 1);
  frames(8);
  const vyBefore = P.vy;
  tap(' ', 'Space');
  assert(`空中再按空格 = 二段跳（jumps=${P.jumps}, vy ${vyBefore.toFixed(0)} → ${P.vy.toFixed(0)}）`,
    P.jumps === 2 && P.vy <= -700);
  let dblApex = P.y;
  for (let i = 0; i < 90; i++) { step(); dblApex = Math.min(dblApex, P.y); if (P.onGround && i > 5) break; }
  assert(`二段跳更高（单跳顶点 y=${singleApex.toFixed(0)} → 二段跳顶点 y=${dblApex.toFixed(0)}）`,
    dblApex < singleApex - 80);
  frames(40);

  // W 起跳 + 空格二段跳（组合路径）
  tap('w', 'KeyW');
  frames(6);
  tap(' ', 'Space');
  assert(`W 起跳后空格二段跳（jumps=${P.jumps}）`, P.jumps === 2);
  frames(120);

  // ================= 3. 下蹲障碍 =================
  console.log('\n[3] 下蹲 —— 开局即出 + S 可解 + 天花板封死跳跃');
  const gd2 = gd();
  gd2.obstacles.length = 0;

  // 3.2 通用试跑：放置指定障碍组，按策略（站 / 蹲 / 跳）跑过去，返回扣血量
  function runAgainst(types, mode) {
    const dd = gd();
    dd.obstacles.length = 0;
    const p = dd.player;
    p.hp = 5; p.dead = false; p.alive = true; p.invincible = 0; p.shield = false;
    p.sliding = false; p.slideTimer = 0; p.onGround = true; p.y = GROUND; p.vy = 0; p.jumps = 0;
    const hp0 = p.hp;
    const obs = types.map(t => dd.Obstacles.create(t, p.x + 420, GROUND, dd.ViewH));
    obs.forEach(o => dd.obstacles.push(o));
    if (mode === 'slide') press('s', 'KeyS');

    let jumped = false;
    for (let i = 0; i < 260; i++) {
      // 跳跃策略：障碍接近时先起跳再二段跳（尽力往上）
      if (mode === 'jump' && !jumped && obs[0] && obs[0].x - p.x < 150) {
        tap(' ', 'Space'); frames(8); tap(' ', 'Space'); jumped = true;
      }
      step();
      // 干扰项：自然生成的其它障碍一律移除；收集物（红心会回血）全部作废，保证只测目标障碍
      for (const o of gd().obstacles) if (obs.indexOf(o) < 0) o.dead = true;
      for (const it of gd().items) it.taken = true;
      if (obs.every(o => o.dead || o.hit)) break;
    }
    if (mode === 'slide') release('s', 'KeyS');
    frames(4);
    gd().obstacles.length = 0;
    return hp0 - gd().player.hp;
  }

  const barHurt = runAgainst(['bar'], 'stand');
  assert(`站姿撞横梁扣血（-${barHurt}）`, barHurt >= 1);
  const barSafe = runAgainst(['bar'], 'slide');
  assert(`按住 S 通过横梁无伤（-${barSafe}）`, barSafe === 0);

  const beamHurt = runAgainst(['beam'], 'stand');
  assert(`站姿撞长横梁扣血（-${beamHurt}）`, beamHurt >= 1);
  const beamSafe = runAgainst(['beam'], 'slide');
  assert(`长按 S 通过长横梁无伤（-${beamSafe}）`, beamSafe === 0);

  // 天花板本身只封跳跃：站姿可以从下方安全走过（它总是与横梁组队出现）
  const ceilStand = runAgainst(['ceil'], 'stand');
  assert(`站姿可从天花板下方走过（-${ceilStand}，天花板只封跳跃）`, ceilStand === 0);
  const ceilJump = runAgainst(['ceil'], 'jump');
  assert(`跳跃（含二段跳）撞天花板必扣血（-${ceilJump}）`, ceilJump >= 1);

  // 下蹲隧道（天花板 + 长横梁）：唯一解是 S
  const tunStand = runAgainst(['ceil', 'beam'], 'stand');
  assert(`隧道站姿必扣血（-${tunStand}）`, tunStand >= 1);
  const tunJump = runAgainst(['ceil', 'beam'], 'jump');
  assert(`隧道跳跃必扣血（-${tunJump}）→ 跳不过去`, tunJump >= 1);
  const tunSlide = runAgainst(['ceil', 'beam'], 'slide');
  assert(`隧道按住 S 安全通过（-${tunSlide}）→ 唯一解是下蹲`, tunSlide === 0);

  // ================= 4. 空中红心（跳起来撞，+1~+2，可超上限）=================
  console.log('\n[4] 红心 —— 跳跃撞击回血');
  getEl('btn-retry').dispatch('click');
  step();
  gd().obstacles.length = 0;
  gd().items.length = 0;

  // 在玩家右前方放一颗红心，jump=true 时起跳去撞
  function tryHeart(hpStart, jump, height) {
    const dd = gd();
    dd.obstacles.length = 0;
    dd.items.length = 0;
    const p = dd.player;
    p.hp = hpStart; p.dead = false; p.alive = true; p.invincible = 0; p.shield = false;
    p.sliding = false; p.slideTimer = 0; p.onGround = true; p.y = GROUND; p.vy = 0; p.jumps = 0;
    const heart = dd.Collectibles.heartAt(p.x + 55, GROUND, height);
    dd.items.push(heart);
    if (jump) tap('w', 'KeyW');
    for (let i = 0; i < 40; i++) {
      step();
      for (const o of gd().obstacles) o.dead = true;                 // 排除自然生成障碍的干扰
      for (const it of gd().items) if (it !== heart) it.taken = true; // 只保留这颗待测红心
      if (heart.taken) break;
    }
    frames(4);
    const res = { hp: gd().player.hp, taken: heart.taken };
    gd().items.length = 0;
    return res;
  }

  const noJump = tryHeart(3, false, 88);
  assert(`站立够不到红心（拾取=${noJump.taken}，血量 3 → ${noJump.hp}）`, !noJump.taken && noJump.hp === 3);

  const jumpLow = tryHeart(3, true, 88);
  assert(`跳起来撞到红心：3 血 → ${jumpLow.hp} 血（+1 或 +2）`,
    jumpLow.taken && (jumpLow.hp === 4 || jumpLow.hp === 5));

  const from4 = tryHeart(4, true, 88);
  assert(`4 血撞红心 → ${from4.hp} 血（应为 5 或 6）`,
    from4.taken && (from4.hp === 5 || from4.hp === 6));

  const from5 = tryHeart(5, true, 88);
  assert(`满血 5 撞红心 → ${from5.hp} 血（应为 6 或 7，可超过基础满血）`,
    from5.taken && (from5.hp === 6 || from5.hp === 7));

  const atCap = tryHeart(10, true, 88);
  assert(`血量已达上限 10 时不再增加（${atCap.hp}）`, atCap.hp === 10);

  // 普及度：120 秒内红心出现数量
  let heartCount = 0;
  const seenItems = new Set();
  for (let i = 0; i < 7200; i++) {
    const p = gd().player;
    p.hp = p.maxHp; p.dead = false; p.alive = true; p.deathT = 0; p.invincible = 0;
    step();
    for (const it of gd().items) {
      if (seenItems.has(it)) continue;
      seenItems.add(it);
      if (it.type === 'heart') heartCount++;
    }
  }
  assert(`前 120s 共生成红心 ${heartCount} 颗（普及度，应 ≥ 20）`, heartCount >= 20);

  if (failed) {
    console.error(`\n❌ ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n✅ 全部通过：严格 A/D 移动 / 空格二段跳 / 开局下蹲障碍 / 五五开配比 / 空中红心回血');
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
