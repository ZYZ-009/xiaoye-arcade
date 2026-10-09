/* ============================================================
 * test/hp-analysis.js — 血量设计分析
 * 测量 5 分钟（300 秒）内的：生成模式数、障碍总数、需闪避次数、
 * 平均可用反应时间；据此推算"存活 5 分钟"所需血量与扣血机制。
 * 运行：node test/hp-analysis.js
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

(async function main() {
  await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 10));
  getEl('btn-play').dispatch('click');
  step();

  const gd = sandbox._gameDebug;
  if (!gd) throw new Error('缺少 _gameDebug');

  const RUNS = 8;          // 多局取平均（消除生成随机性）
  const TOTAL_FRAMES = 18000; // 300 秒 @60fps

  const results = [];
  for (let r = 0; r < RUNS; r++) {
    if (r > 0) getEl('btn-retry').dispatch('click'); // 重开一局
    step();

    const spawn0 = gd().counters.spawns; // 计数器跨局不清零，记录开局累计值
    let jumps = 0, slides = 0, attempts = 0;
    let maxSpeed = 0;
    let frames = 0;
    const cooldown = { jump: 0, slide: 0 };

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      step(); frames++;
      cooldown.jump = Math.max(0, cooldown.jump - 1);
      cooldown.slide = Math.max(0, cooldown.slide - 1);
      const d = gd();
      if (d.state !== 'playing') break; // 不应发生（完美 AI）
      maxSpeed = Math.max(maxSpeed, d.speed);
      const px = d.player.x;
      let target = null;
      for (const o of d.obstacles) {
        if (o.hit || o.dead) continue;
        if (o.x - 20 > px - 26 && o.x - 20 < px + 240) { target = o; break; }
      }
      if (!target) continue;
      const ahead = target.x - 20 - px;
      if (target.t.kind === 'air') {
        if (ahead < 100 && cooldown.slide <= 0 && !d.player.sliding) {
          fireWin('keydown', { key: 's', code: 'KeyS' });
          fireWin('keyup', { key: 's' });
          cooldown.slide = 18; slides++; attempts++;
        }
      } else {
        const tall = target.t.tall;
        if (ahead < (tall ? 150 : 110) && cooldown.jump <= 0) {
          fireWin('keydown', { key: 'w', code: 'KeyW' });
          fireWin('keyup', { key: 'w' });
          cooldown.jump = tall ? 32 : 24; jumps++; attempts++;
        }
      }
    }
    const dEnd = gd();
    results.push({
      dist: dEnd.dist, attempts, jumps, slides,
      obstacles: dEnd.counters.spawns - spawn0, // 本局新增障碍数
      maxSpeed,
      secs: frames / 60, // 本局实际运行秒数（AI 可能提前失误结束）
    });
  }

  // ---- 汇总 ----
  // 用实测生成速率（障碍/秒、闪避/秒，按实际运行秒数）外推到完整 300 秒。
  const avg = f => results.reduce((s, r) => s + (typeof f === 'string' ? r[f] : f(r)), 0) / results.length;
  const obsPerSec = avg(r => r.obstacles / r.secs);
  const dodgePerSec = avg(r => r.attempts / r.secs);
  const O5 = obsPerSec * 300;        // 5 分钟障碍总数
  const G5 = O5 / 1.33;              // 5 分钟模式组数（每模式均 1.33 障碍）
  const N = dodgePerSec * 300;       // 5 分钟需闪避次数
  const D = avg('dist');
  const meanSecs = avg('secs');

  console.log('════════ 5 分钟（300s）生成密度实测（AI 模拟，8 局）════════');
  console.log(`  AI 平均存活     : ${meanSecs.toFixed(0)} 秒/局（简单反应式 AI，非人类水平）`);
  console.log(`  障碍生成速率    : ${obsPerSec.toFixed(2)} 个/秒（约每 ${(1 / obsPerSec).toFixed(2)} 秒 1 个）`);
  console.log(`  模式生成速率    : ${(obsPerSec / 1.33).toFixed(2)} 组/秒（含多障碍组合）`);
  console.log(`  需闪避操作速率  : ${dodgePerSec.toFixed(2)} 次/秒（跳跃 ${avg(r => r.jumps / r.secs).toFixed(2)} + 滑铲 ${avg(r => r.slides / r.secs).toFixed(2)}）`);
  console.log('  ───────────────────────────────────────────────');
  console.log(`  外推 5 分钟      : 约 ${G5.toFixed(0)} 组模式 / ${O5.toFixed(0)} 个障碍 / ${N.toFixed(0)} 次闪避操作`);
  console.log(`  实测平均距离    : ${D.toFixed(0)} 米（AI 提前失误时的均值，仅参考）`);
  console.log(`  峰值速度        : ${Math.max(...results.map(r => r.maxSpeed)).toFixed(0)} px/s（上限 800）`);

  // ---- 二项分布推导：失误率 p → 5 分钟总失误数 → 所需血量 ----
  console.log('\n════════ 血量需求推算（失误率假设模型）════════');
  console.log('  假设每次闪避操作有 p 的概率失误（漏按/按晚），失误即中 1 点伤害：');
  console.log('  ┌────────┬──────────┬────────────┬───────────────────┐');
  console.log('  │ 失误率 │ 5分钟失误 │ 50%生存所需 │ 95%生存所需血量    │');
  console.log('  ├────────┼──────────┼────────────┼───────────────────┤');
  const quantile95 = (n, p) => {
    // 二项分布 95% 分位数（正态近似 + 连续性校正）
    const mean = n * p, sd = Math.sqrt(n * p * (1 - p));
    return Math.max(1, Math.ceil(mean + 1.645 * sd + 0.5));
  };
  for (const p of [0.005, 0.01, 0.02, 0.03, 0.05]) {
    const exp = N * p;
    const q50 = Math.max(1, Math.ceil(exp));
    const q95 = quantile95(N, p);
    console.log(`  │ ${(p * 100).toFixed(1)}%   │ ${exp.toFixed(1).padStart(6)} 次  │ ${String(q50).padStart(6)} 点     │ ${String(q95).padStart(8)} 点        │`);
  }
  console.log('  └────────┴──────────┴────────────┴───────────────────┘');

  // ---- 建议 ----
  console.log('\n════════ 设计建议 ════════');
  console.log('  ■ 推荐血量：5 点（经典设计）＋ 道具补给');
  console.log('  ■ 扣血机制：每次撞障碍 -1 点；巨兽/连击组合 -1 点（统一，易理解）');
  console.log('  ■ 关键保护：受击后 1.5s 无敌帧（防止连环扣血，现已有 1.1s）');
  console.log('  ■ 回血途径：药水道具 +1 点（约每 40~60s 掉一个）＋ 护盾免费挡 1 次');
  console.log('  ■ 死亡判定：血量归 0 即死亡（沿用现有死亡动画）');
})().catch(e => { console.error('❌ 分析异常:', e); process.exit(1); });
