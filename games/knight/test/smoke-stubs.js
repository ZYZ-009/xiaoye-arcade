/* ============================================================
 * test/smoke-stubs.js — 共享测试桩（DOM/Canvas/音频/图片）
 * 供 smoke.js 与 fairness.js 复用
 * ============================================================ */
'use strict';

function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 960, height: 540 };
      return typeof p === 'string' ? (t[p] !== undefined ? t[p] : (() => {})) : undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeEl(id) {
  const listeners = {};
  return {
    id,
    style: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = []; },
    textContent: '',
    checked: true,
    width: 960,
    height: 540,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatch(ev, data) {
      (listeners[ev] || []).forEach(fn => fn({
        preventDefault() {}, clientX: 0, clientY: 0, key: ' ', code: 'Space', repeat: false, touches: null, changedTouches: null, ...data,
      }));
    },
    appendChild() {},
    getContext: () => makeCtx(),
  };
}

const elements = {};
function getEl(id) {
  if (!elements[id]) elements[id] = makeEl(id);
  return elements[id];
}
getEl('game');

const timers = [];
let rafCallback = null;
let now = 0;
const winListeners = {};

function fireWin(ev, data) {
  (winListeners[ev] || []).forEach(fn => fn({ preventDefault() {}, repeat: false, ...data }));
}

const sandbox = {
  console,
  Math, JSON, Object, Array, String, Number, Boolean, Date, Promise, Error, RegExp, parseInt, parseFloat, isNaN,
  performance: { now: () => now },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  setInterval: (fn) => { timers.push(fn); return timers.length; },
  clearInterval: () => {},
  requestAnimationFrame: (fn) => { rafCallback = fn; return 1; },
  cancelAnimationFrame: () => {},
  navigator: { maxTouchPoints: 0 },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } },
  AudioContext: class {
    constructor() {}
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
    get state() { return 'running'; }
    get currentTime() { return 0; }
    get sampleRate() { return 44100; }
    resume() {}
  },
  Image: class {
    constructor() { setTimeout(() => { this.onload && this.onload(); }, 0); }
  },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
};

sandbox.window = sandbox;
sandbox.window.addEventListener = (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); };
sandbox.window.removeEventListener = (ev, fn) => {
  const l = winListeners[ev]; if (!l) return;
  const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
};
sandbox.document = {
  getElementById: getEl,
  createElement(tag) {
    if (tag === 'canvas') return makeEl('c' + Math.random());
    return makeEl('e' + Math.random());
  },
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
};
sandbox.globalThis = sandbox;

function drainTimers() {
  while (timers.length) timers.shift()();
}

function step() {
  now += 1000 / 60;
  const cb = rafCallback;
  rafCallback = null;
  if (cb) cb(now);
}

module.exports = { sandbox, getEl, fireWin, step, drainTimers, getNow: () => now };
