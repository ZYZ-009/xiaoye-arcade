/* ============================================================
 * test/wasd-check.js — 验证 WASD 直接速度控制是否生效
 * 检查：默认静止 / D 右移 / 松开停止 / A 左移 / 世界滚动
 * 运行：node test/wasd-check.js
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

function assert(name, cond) {
  if (!cond) { console.error(`❌ ${name}`); process.exit(1); }
  console.log(`  ✓ ${name}`);
}

(async function main() {
  await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 10));
  getEl('btn-play').dispatch('click');
  step();

  const gd = sandbox._gameDebug;

  // 1) 默认静止：不按任何键跑 60 帧，x 应保持不变
  const x0 = gd().player.x;
  for (let i = 0; i < 60; i++) step();
  const x1 = gd().player.x;
  assert(`默认静止：60帧内 x 不变（${x0.toFixed(1)} → ${x1.toFixed(1)}）`, Math.abs(x1 - x0) < 0.001);

  // 2) 按住 D：30 帧应向右移动约 280*0.5=140px
  fireWin('keydown', { key: 'd', code: 'KeyD' });
  for (let i = 0; i < 30; i++) step();
  const x2 = gd().player.x;
  const moved = x2 - x1;
  assert(`按住 D 右移：30帧移动 ${moved.toFixed(1)}px（期望 ≈140）`, moved > 125 && moved < 160);

  // 3) 松开 D：x 应立刻停止（再跑 30 帧不再动）
  fireWin('keyup', { key: 'd' });
  const x3 = gd().player.x;
  for (let i = 0; i < 30; i++) step();
  const x4 = gd().player.x;
  assert(`松开 D 停止：后续 30 帧移动 ${(x4 - x3).toFixed(2)}px（期望 0）`, Math.abs(x4 - x3) < 0.001);

  // 4) 按住 A：向左移动
  fireWin('keydown', { key: 'a', code: 'KeyA' });
  const x5 = gd().player.x;
  for (let i = 0; i < 30; i++) step();
  const x6 = gd().player.x;
  assert(`按住 A 左移：30帧移动 ${(x6 - x5).toFixed(1)}px（期望 ≈-140）`, (x6 - x5) < -125 && (x6 - x5) > -160);
  fireWin('keyup', { key: 'a' });

  // 5) 世界仍在滚动（dist 增加 / 障碍接近）
  const d1 = gd().dist;
  for (let i = 0; i < 120; i++) step();
  const d2 = gd().dist;
  assert(`世界滚动：120帧距离增加 ${(d2 - d1).toFixed(1)}m（慢节奏）`, d2 > d1 + 4);

  // 6) 速度曲线：起步慢、上限 380
  const sp = gd().speed;
  assert(`世界速度较低：当前 ${sp.toFixed(0)}px/s（上限 380）`, sp <= 380);

  console.log('\n✅ WASD 直接速度控制验证通过：默认静止 / D 右 / A 左 / 松开即停 / 世界慢速滚动');
})().catch(e => { console.error('❌ 验证异常:', e); process.exit(1); });
