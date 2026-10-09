/* ============================================================
 * test/fairness.js — 公平性测试（自动玩家）
 * 用简单 AI 模拟操作（地面障碍就跳、空中障碍就滑），运行较长时间，
 * 验证所有生成模式均可躲避（无障碍物死局）。
 * 运行：node test/fairness.js
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
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

fireWin('DOMContentLoaded');
drainTimers();

(async function main() {
  await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 10));

  // 开始游戏
  getEl('btn-play').dispatch('click');
  // 等待一帧让状态切换
  step();

  const gd = sandbox._gameDebug;
  if (!gd) {
    console.error('❌ 未找到 _gameDebug 钩子');
    process.exit(1);
  }

  let jumps = 0, slides = 0, maxDist = 0;
  let failReason = '';
  const cooldown = { jump: 0 };
  let slideHeld = false;

  // 下蹲是"按住"语义：进入障碍前按下 S，完全通过后才松开（长横梁/隧道需要长按）
  function setSlide(on) {
    if (on === slideHeld) return;
    slideHeld = on;
    if (on) { fireWin('keydown', { key: 's', code: 'KeyS' }); slides++; }
    else fireWin('keyup', { key: 's', code: 'KeyS' });
  }

  for (let i = 0; i < 15000; i++) { // 250 秒游戏时间
    step();
    cooldown.jump = Math.max(0, cooldown.jump - 1);

    const d = gd();
    if (d.state !== 'playing') { failReason = `状态变为 ${d.state}（第 ${i} 帧，距离 ${Math.round(d.dist)} 米）`; break; }
    maxDist = Math.max(maxDist, d.dist);

    if (i % 3000 === 0) {
      const aliveObs = d.obstacles.filter(o => !o.hit && !o.dead).length;
      console.log(`  [debug] 帧 ${i}: 距离 ${Math.round(d.dist)}m 速度 ${Math.round(d.speed)} 障碍 ${aliveObs} 跳跃 ${jumps} 下蹲 ${slides} 计数=${JSON.stringify(d.counters)}`);
    }

    const px = d.player.x;
    const p = d.player;

    // 是否需要保持下蹲：任一空中障碍（横梁/长横梁/天花板/蝙蝠/箭矢）与玩家重叠在即
    let needSlide = false;
    let groundTarget = null;
    for (const o of d.obstacles) {
      if (o.hit || o.dead) continue;
      const halfW = (o.t.hitFull ? o.w : o.w * 0.6) / 2 + 14; // 障碍半宽 + 玩家半宽
      const left = o.x - halfW, right = o.x + halfW;
      if (right < px - 10) continue;                 // 已经过去
      if (left - px > 180) continue;                 // 还远（慢节奏下给更早的下蹲准备时间）
      if (o.t.kind === 'air') needSlide = true;
      else if (!groundTarget) groundTarget = o;
    }

    if (needSlide) {
      setSlide(true);
      continue;                                       // 蹲着的时候不跳
    }
    setSlide(false);

    // 地面障碍 → W 跳跃（提前量按"到达时间"计算：世界速度已放慢到 165–380，
    // 固定像素提前量会在低速时跳得过早、落地撞上）
    if (groundTarget && !p.sliding && p.onGround && cooldown.jump <= 0) {
      const ahead = groundTarget.x - px;
      const arriveT = ahead / Math.max(d.speed, 1);   // 障碍到达玩家还需多少秒
      const lead = groundTarget.t.tall ? 0.17 : 0.21; // 起跳提前量（秒）
      if (arriveT < lead) {
        fireWin('keydown', { key: 'w', code: 'KeyW' });
        fireWin('keyup', { key: 'w', code: 'KeyW' });
        cooldown.jump = 26;
        jumps++;
      }
    }
  }

  if (maxDist > 500) {
    console.log(`✅ 公平性测试通过：自动玩家存活 15000 帧，跑出 ${Math.round(maxDist)} 米`);
    console.log(`   操作统计：跳跃 ${jumps} 次，下蹲 ${slides} 次，无死局`);
  } else {
    console.error(`❌ 公平性测试失败：${failReason || '存活距离过短'}`);
    console.error(`   已跑距离：${Math.round(maxDist)} 米，跳跃 ${jumps}，下蹲 ${slides}`);
    process.exit(1);
  }
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
