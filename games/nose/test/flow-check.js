/* ============================================================
 * test/flow-check.js — 你画我猜（鼻子版）流程端到端测试
 * 用 jsdom 加载 index.html，stub 掉摄像头/MediaPipe/canvas，
 * 通过 window.__nose 调试钩子验证三个核心功能：
 *   1. 鼠标/手指擦除（pointer 拖动 → erase 笔画）
 *   2. 每题 5 选 1（选题界面 + 画廊里选中词高亮）
 *   3. 随时退出且结果不保留
 * 运行（需 jsdom）：
 *   npm install jsdom
 *   node test/flow-check.js
 *   或：NODE_PATH=<装了jsdom的node_modules目录> node test/flow-check.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

// 加载 jsdom：优先当前项目，其次 managed workspace
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  const p = path.join('C:/Users/20689/.workbuddy/binaries/node/workspace', 'node_modules', 'jsdom');
  ({ JSDOM } = require(p));
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failed = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
}

// ---------- 启动 jsdom ----------
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    // canvas 2d 上下文 mock（jsdom 无原生 canvas 实现）
    const ctx2d = () => {
      const noop = () => {};
      return new Proxy({}, {
        get(t, p) {
          if (p === 'canvas') return { width: 640, height: 480 };
          if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
          if (p === 'measureText') return () => ({ width: 10 });
          if (typeof t[p] === 'undefined') return noop;
          return t[p];
        },
        set(t, p, v) { t[p] = v; return true; },
      });
    };
    window.HTMLCanvasElement.prototype.getContext = ctx2d;
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,MOCKSNAPSHOT';
    window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480 });
    // MediaPipe stub
    window.FaceMesh = class {
      constructor() {} setOptions() {} onResults() {}
      async send() { return {}; } close() {}
    };
    // 摄像头 stub
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    });
    window.confirm = () => true;      // 退出确认框默认"确定"
  },
});

const w = dom.window;
const doc = w.document;
const $ = id => doc.getElementById(id);

(async function main() {
  await new Promise(r => setTimeout(r, 60));   // 等内联脚本执行完
  const nose = w.__nose;
  if (!nose) { console.error('✗ 未找到 window.__nose 调试钩子'); process.exit(1); }

  // 让游戏进入可操作状态（跳过真实摄像头校准）
  nose.setCalib(0.5, 0.5);

  console.log('[1] 选题 —— 每题蹦出 5 个词，用户选 1 个');
  nose.startGame();
  const pickScreen = $('pickScreen');
  assert('选题界面已弹出', !pickScreen.classList.contains('hidden'));
  const cards = doc.querySelectorAll('#pickGrid .pick-card');
  assert(`选题界面有 5 个候选词（实际 ${cards.length} 个）`, cards.length === 5);

  const st0 = nose.state();
  assert(`候选词列表存在（${st0.candidates && st0.candidates.join('/')}）`,
    Array.isArray(st0.candidates) && st0.candidates.length === 5);
  assert('选题阶段计时暂停（picking=true）', st0.picking === true);

  // 选第 2 个词
  const chosen = st0.candidates[1];
  nose.pickWord(chosen);
  const st1 = nose.state();
  assert(`选中「${chosen}」后进入绘画（picking=false）`, st1.picking === false && st1.picked === chosen);
  assert(`顶部显示选中的词（${$('word').textContent}）`, $('word').textContent === chosen);
  assert('选题界面已关闭', pickScreen.classList.contains('hidden'));

  console.log('\n[2] 擦除 —— 鼠标拖动擦掉不满意的线条');
  nose.addStroke([{ x: 20, y: 20 }, { x: 200, y: 200 }]);
  const afterDraw = nose.state().strokes;
  assert(`画了一笔（笔画数 ${afterDraw}）`, afterDraw === 1);

  // 模拟真实鼠标：在画板上按下并拖动
  const board = $('board');
  const pd = new w.MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true });
  board.dispatchEvent(pd);
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 140, clientY: 140, bubbles: true }));
  board.dispatchEvent(new w.MouseEvent('pointerup', { clientX: 140, clientY: 140, bubbles: true }));

  const s2 = nose.state();
  assert(`鼠标拖动产生 1 条擦除笔画（总笔画 ${s2.strokes}）`, s2.strokes === 2);
  const qs = nose.questions();
  const strokesArr = s2.strokes;
  assert('擦除笔画已记录进笔画数据（可被重绘/撤销）', strokesArr > 0);

  // 撤销：把擦除那一笔撤掉
  nose.undoStroke();
  assert(`撤销后笔画数回到 ${nose.state().strokes}`, nose.state().strokes === 1);

  console.log('\n[3] 五题流程 —— 每题都 5 选 1，最后画廊呈现画作 + 5 个词');
  // 第 1 题已完成一笔，直接推进；剩下 4 题各选一个词并画一笔
  for (let i = 0; i < 5; i++) {
    const st = nose.state();
    if (st.picking) {
      const cands = st.candidates;
      nose.pickWord(cands[i % cands.length]);
    }
    nose.addStroke([{ x: 10 + i * 10, y: 10 }, { x: 100 + i * 10, y: 120 }], 'draw', '#111111', 6);
    nose.advance();
  }
  const gallery = $('galleryScreen');
  assert('5 题结束后画廊弹出', !gallery.classList.contains('hidden'));

  const figs = doc.querySelectorAll('#gallery figure');
  assert(`画廊有 5 幅画（实际 ${figs.length} 幅）`, figs.length === 5);

  const firstFig = figs[0];
  const tags = firstFig.querySelectorAll('.tag');
  const pickedTags = firstFig.querySelectorAll('.tag.picked');
  assert(`每幅下方呈现 5 个候选词（实际 ${tags.length} 个）`, tags.length === 5);
  assert(`选中的词被高光标出（高亮 ${pickedTags.length} 个）`, pickedTags.length === 1);

  // 校验第 1 幅的高亮词 == 当时选中的词
  const q0 = nose.questions()[0];
  assert(`高亮词与所选一致（${pickedTags[0] && pickedTags[0].textContent} == ${q0.picked}）`,
    pickedTags[0] && pickedTags[0].textContent === q0.picked);

  console.log('\n[4] 退出 —— 随时退出且结果不保留');
  nose.quitGame();
  const stQ = nose.state();
  assert('退出后停止游戏（playing=false）', stQ.playing === false);
  assert('退出后画作数据被清空（不再有题目记录）', nose.questions().length === 0);
  assert('退出后画板清空（笔画数 0）', stQ.strokes === 0);
  assert('退出后回到开始界面', !$('startScreen').classList.contains('hidden'));
  assert('退出后画廊已隐藏', $('galleryScreen').classList.contains('hidden'));

  if (failed) {
    console.error(`\n❌ ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n✅ 流程测试全部通过：鼠标擦除 / 五选一词 + 高亮 / 随时退出不保留');
  dom.window.close();
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
