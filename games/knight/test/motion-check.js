/* ============================================================
 * test/motion-check.js — 体感输入纯逻辑单测（parseMotion）
 * 验证动作映射：左右(死区) / 跳跃(瞬态+锁存) / 下蹲(髋降+膝弯) /
 *               二段跳(拍手) / 暂停(握拳) / 人体丢失回静止
 * 运行：node test/motion-check.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stubs = require('./smoke-stubs.js');
const sandbox = stubs.sandbox;
const { getEl, fireWin, drainTimers } = stubs;

vm.createContext(sandbox);

const ROOT = path.join(__dirname, '..');
const files = ['audio.js', 'input.js', 'sprites.js', 'player.js', 'obstacles.js', 'collectibles.js', 'background.js', 'particles.js', 'ui.js', 'motion.js', 'game.js'];
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

const parse = sandbox.Motion.parseMotion;
const cfg = {
  deadzone: 0.10, sens: 1, jumpVel: 0.35, jumpFrames: 2, squatHipDrop: 0.12,
  squatKneeAngle: 110, clapDist: 0.15, fistDist: 0.22, fistHold: 0.8,
  lockMs: 180, lostTimeout: 0.5, emaSmooth: 0.15, slideSuppressFrames: 4,
};

// 构造 33 点站姿（MediaPipe 索引）
function pose() {
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 });
  const set = (i, x, y, v) => { lm[i] = { x, y, z: 0, visibility: v !== undefined ? v : 0.9 }; };
  set(11, 0.42, 0.30); set(12, 0.58, 0.30);
  set(13, 0.40, 0.42); set(14, 0.60, 0.42);
  set(15, 0.38, 0.52); set(16, 0.62, 0.52);
  set(23, 0.44, 0.50); set(24, 0.56, 0.50);
  set(25, 0.45, 0.68); set(26, 0.55, 0.68);
  set(27, 0.46, 0.86); set(28, 0.54, 0.86);
  return { lm, set };
}
function shift(lm, dx) { for (const i of [11, 12, 23, 24]) lm[i].x += dx; return lm; }
function hipTo(lm, y) { lm[23].y = lm[24].y = y; return lm; }
function squat(lm, hipY) {
  hipTo(lm, hipY);
  lm[25] = { x: 0.55, y: hipY + 0.10, z: 0, visibility: 0.9 };   // 膝前突 → 膝角 < 110°
  lm[26] = { x: 0.45, y: hipY + 0.10, z: 0, visibility: 0.9 };
  lm[27] = { x: 0.46, y: hipY + 0.16, z: 0, visibility: 0.9 };
  lm[28] = { x: 0.54, y: hipY + 0.16, z: 0, visibility: 0.9 };
  return lm;
}
function clap(lm) { lm[15].x = lm[16].x = 0.5; lm[15].y = lm[16].y = 0.35; return lm; }
function handsFist() {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  for (const i of [4, 8, 12, 16, 20]) lm[i] = { x: 0.49, y: 0.49, z: 0 }; // 指尖贴腕 → 握拳
  return [{ landmarks: lm, handedness: 'Right' }];
}

function freshSt(hipY = 0.5) {
  return { now: 0, dt: 0.1, emaX: 0.5, emaInit: false, prevHipY: null, jumpCounter: 0,
    clapPrev: false, fistT: 0, lostT: 0, baseline: { hipY }, calibPhase: 'done',
    lockJumpUntil: 0, lockClapUntil: 0, lockPauseUntil: 0, slideSuppress: 0 };
}
function tick(st, ms = 100) { st.now += ms; st.dt = ms / 1000; }

(async function main() {
  console.log('[motion] 左右移动 —— 默认自动向右跑（身体左右不控制，可开启）');
  {
    const st = freshSt();
    const a1 = parse(pose().lm, null, cfg, st);
    assert(`身体居中 → 静止（left=${a1.left}, right=${a1.right}）`, !a1.left && !a1.right && a1.hasBody);

    // 默认 cfg 不含 enableLateral → 左右关闭 = 自动向右跑，身体左右不影响前进
    const st2 = freshSt();
    const a2 = parse(shift(pose().lm, -0.15), null, cfg, st2);
    assert(`身体左偏（默认关闭左右）→ 不左移（left=${a2.left}）`, !a2.left && !a2.right);

    const st3 = freshSt();
    const a3 = parse(shift(pose().lm, 0.15), null, cfg, st3);
    assert(`身体右偏（默认关闭左右）→ 不右移（right=${a3.right}）`, !a3.right && !a3.left);

    const st4 = freshSt();
    const a4 = parse(shift(pose().lm, 0.03), null, cfg, st4);
    assert(`微小偏移(±0.03)在死区内 → 静止（left=${a4.left}, right=${a4.right}）`, !a4.left && !a4.right);

    // 显式开启 enableLateral 后恢复左右控制（可选模式）
    const cfgLat = Object.assign({}, cfg, { enableLateral: true });
    const st5 = freshSt();
    const a5 = parse(shift(pose().lm, -0.15), null, cfgLat, st5);
    assert(`开启 enableLateral 后身体左偏 → 左移（left=${a5.left}）`, a5.left && !a5.right);
  }

  console.log('\n[motion] 跳跃 —— 髋部向上速度（瞬态 + 锁存）');
  {
    const st = freshSt();
    const p = pose().lm;
    tick(st); const a1 = parse(p, null, cfg, st);                 // 帧1：记录基线
    tick(st); const a2 = parse(hipTo(p, 0.45), null, cfg, st);    // 帧2：上移 vy=0.5
    assert(`跳起第 2 帧未达标（counter）→ 不触发（jump=${a2.jump}）`, !a2.jump);
    tick(st); const a3 = parse(hipTo(p, 0.40), null, cfg, st);    // 帧3：连续达标 → 触发
    assert(`连续上移 2 帧 → 跳跃触发（jump=${a3.jump}）`, a3.jump === true);
    tick(st); const a4 = parse(hipTo(p, 0.35), null, cfg, st);    // 帧4：锁存期内不再触发
    assert(`锁存期内不重复触发（jump=${a4.jump}）`, a4.jump === false);

    const st5 = freshSt();
    tick(st5); parse(pose().lm, null, cfg, st5);
    tick(st5); parse(hipTo(pose().lm, 0.45), null, cfg, st5);
    tick(st5); const slow = parse(hipTo(pose().lm, 0.498), null, cfg, st5); // vy=0.02 < 0.35
    assert(`缓慢上移（vy=0.02）不触发跳跃（jump=${slow.jump}）`, slow.jump === false);
  }

  console.log('\n[motion] 下蹲 —— 髋降 + 膝弯（稳态）');
  {
    const st = freshSt();
    tick(st); parse(pose().lm, null, cfg, st);
    tick(st); const a = parse(squat(pose().lm, 0.65), null, cfg, st);
    assert(`蹲下（髋降0.15 + 膝角<110°）→ slide=true`, a.slide === true);
    // 蹲起瞬间抑制跳跃
    const st2 = freshSt();
    tick(st2); parse(pose().lm, null, cfg, st2);
    tick(st2); parse(squat(pose().lm, 0.65), null, cfg, st2);
    tick(st2); const rise = parse(hipTo(pose().lm, 0.55), null, cfg, st2); // 快速站起 vy 大
    assert(`蹲起瞬间不误触发跳跃（jump=${rise.jump}）`, rise.jump === false);
  }

  console.log('\n[motion] 二段跳 —— 拍手');
  {
    const st = freshSt();
    tick(st); parse(pose().lm, null, cfg, st);
    tick(st); const a1 = parse(clap(pose().lm), null, cfg, st);
    assert(`双腕靠近 → 拍手触发二段跳（doubleJump=${a1.doubleJump}）`, a1.doubleJump === true);
    tick(st); const a2 = parse(clap(pose().lm), null, cfg, st);
    assert(`持续拍手不重复触发（doubleJump=${a2.doubleJump}）`, a2.doubleJump === false);
  }

  console.log('\n[motion] 暂停 —— 默认关闭握拳暂停（避免菜单态信号堆积），开启后仍可触发');
  {
    const st = freshSt();
    let got = false;
    for (let i = 0; i < 12; i++) {
      tick(st);
      const a = parse(pose().lm, handsFist(), cfg, st);
      if (a.pause) got = true;
    }
    assert(`默认关闭握拳暂停 → 握拳 1.2s 也不触发（pause=${got}）`, got === false);
  }
  {
    const st = freshSt();
    const cfgOn = Object.assign({}, cfg, { enableFistPause: true });
    let got = false;
    for (let i = 0; i < 12; i++) {
      tick(st);
      const a = parse(pose().lm, handsFist(), cfgOn, st);
      if (a.pause) got = true;
    }
    assert(`显式开启 enableFistPause=true → 握拳 0.8s 触发（pause=${got}）`, got === true);
  }

  console.log('\n[motion] 人体丢失 —— 回静止');
  {
    const st = freshSt();
    for (let i = 0; i < 7; i++) {
      tick(st);
      const a = parse(null, null, cfg, st);
      if (i === 0) assert(`人体丢失 → hasBody=false`, a.hasBody === false && !a.left && !a.right);
    }
    assert(`丢失超时后仍全静止（emaX=${st.emaX.toFixed(2)} 已复位）`, Math.abs(st.emaX - 0.5) < 1e-6);
  }

  if (failed) {
    console.error(`\n❌ ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n✅ 体感映射单测全部通过：左右/跳跃/下蹲/二段跳/暂停/丢失保护');
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
