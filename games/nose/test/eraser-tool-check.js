/* ============================================================
 * test/eraser-tool-check.js — 「橡皮擦工具」开关专项测试
 * 验证：点工具栏「🧽 橡皮擦」后，鼠标在画板上移动（无需按住）
 *       即可擦除线条；再点一次关闭恢复原状。
 * 运行：node test/eraser-tool-check.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

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

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    const ctx2d = () => new Proxy({}, {
      get(t, p) {
        if (p === 'canvas') return { width: 640, height: 480 };
        if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
        if (p === 'measureText') return () => ({ width: 10 });
        if (typeof t[p] === 'undefined') return () => {};
        return t[p];
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    window.HTMLCanvasElement.prototype.getContext = ctx2d;
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,MOCKSNAPSHOT';
    window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480 });
    window.FaceMesh = class { constructor() {} setOptions() {} onResults() {} async send() { return {}; } close() {} };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    });
    window.confirm = () => true;
  },
});

const w = dom.window;
const doc = w.document;
const $ = id => doc.getElementById(id);

(async function main() {
  await new Promise(r => setTimeout(r, 60));
  const nose = w.__nose;
  if (!nose) { console.error('✗ 未找到 window.__nose 调试钩子'); process.exit(1); }
  nose.setCalib(0.5, 0.5);
  nose.startGame();
  // 选第一个词进入绘画状态
  const q = nose.state();
  nose.pickWord(q.candidates[0]);
  const board = $('board');
  const btnEraser = $('btnEraser');
  const tipEraser = $('tipEraser');

  console.log('[1] 开关初始状态');
  assert('「橡皮擦」按钮存在', !!btnEraser);
  assert('工具默认关闭（按钮无 active 态）', !btnEraser.classList.contains('active'));

  console.log('\n[2] 关闭状态下，悬停（不按鼠标）不会擦除');
  nose.addStroke([{ x: 20, y: 20 }, { x: 200, y: 200 }]);
  assert(`画了一笔（笔画数 ${nose.state().strokes}）`, nose.state().strokes === 1);
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 140, clientY: 140, bubbles: true }));
  assert('未开启工具时悬停不产生擦除笔画（仍为 1）', nose.state().strokes === 1);

  console.log('\n[3] 开启工具后，悬停即擦除');
  btnEraser.click();
  assert('点击后按钮进入 active 态', btnEraser.classList.contains('active'));
  assert('提示文字已更新', /橡皮擦已开启/.test(tipEraser.textContent));
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 140, clientY: 140, bubbles: true }));
  assert(`开启后悬停即产生擦除笔画（总笔画 ${nose.state().strokes}）`, nose.state().strokes === 2);

  console.log('\n[4] 关闭工具后恢复原状');
  btnEraser.click();
  assert('再次点击后取消 active 态', !btnEraser.classList.contains('active'));
  const before = nose.state().strokes;
  board.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 150, clientY: 150, bubbles: true }));
  assert('关闭后悬停不再擦除（笔画数不变）', nose.state().strokes === before);

  console.log('\n[5] 撤销能撤销工具的擦除笔画');
  nose.undoStroke();   // 撤掉第 4 步? 不，上面关闭后没有新增；这里撤掉工具产生的擦除笔画
  assert(`撤销一次后回到画的那一笔（笔画数 ${nose.state().strokes}）`, nose.state().strokes === 1);

  if (failed) {
    console.error(`\n❌ ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n✅ 橡皮擦工具开关测试全部通过：开启=悬停即擦，关闭=恢复，可撤销');
  dom.window.close();
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
