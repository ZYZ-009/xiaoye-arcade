/* ============================================================
 * input.js — 键盘与触摸输入（适配桌面端与移动端）
 * 桌面端（WASD 控制，非自动跑）：
 *   D/→ 向右移动   A/← 向左移动  （不按 / 同时按 A+D = 静止，无惯性）
 *   W/↑ 跳跃（第一级）   空格 二段跳（地面按=起跳，空中再按=二段跳）
 *   S/↓ 下蹲（穿过低矮障碍，可长按保持）
 *   P 暂停  R 重开  M 静音
 * 移动端：点击跳跃（空中点击=二段跳），向下滑动下蹲
 * 说明：窗口失焦 / 切到后台时会强制清空所有按键，避免"松手仍在跑"
 * ============================================================ */
'use strict';

const Input = (() => {
  const state = {
    jumpQueued: false,     // W：地面跳跃（一帧有效）
    doubleJumpQueued: false, // 空格：二段跳（空中有效）
    slideQueued: false,    // S：下蹲触发
    slideHeld: false,      // 下蹲按住
    leftHeld: false,       // A 按住
    rightHeld: false,      // D 按住
    pauseQueued: false,
    restartQueued: false,
    isTouch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
  };

  let touchStartY = null;
  let touchStartX = null;
  let touchActive = false;
  let keyboardPause = true;   // 是否允许键盘 P/Esc 触发暂停（体感版设为 false → 暂停只用鼠标）

  // 按键匹配：优先用物理键位 code，兼容 key（大小写 / 输入法 / 布局差异）
  function isDown(e, codes, keys) {
    if (e.code && codes.indexOf(e.code) >= 0) return true;
    const k = String(e.key || '');
    return keys.indexOf(k) >= 0 || keys.indexOf(k.toLowerCase()) >= 0 || keys.indexOf(k.toUpperCase()) >= 0;
  }

  function init(callbacks) {
    // ---- 键盘 ----
    window.addEventListener('keydown', (e) => {
      const k = e.key;
      const code = e.code;
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyP', 'KeyR', 'KeyM'].includes(k) || code === 'Space') {
        if (k !== 'F5' && k !== 'F12' && k !== 'F11') e.preventDefault();
      }
      if (isDown(e, ['KeyW', 'ArrowUp'], ['w', 'ArrowUp'])) {
        if (!e.repeat) state.jumpQueued = true;
      } else if (isDown(e, ['Space'], [' ', 'k'])) {
        // 空格：地面起跳 / 空中二段跳
        if (!e.repeat) state.doubleJumpQueued = true;
      } else if (isDown(e, ['KeyS', 'ArrowDown'], ['s', 'ArrowDown', 'j'])) {
        if (!e.repeat) state.slideQueued = true;
        state.slideHeld = true;
      } else if (isDown(e, ['KeyA', 'ArrowLeft'], ['a', 'ArrowLeft'])) {
        // 注意：不再清空 rightHeld —— A+D 同按 = 静止（由 Player 判定时抵消）
        state.leftHeld = true;
      } else if (isDown(e, ['KeyD', 'ArrowRight'], ['d', 'ArrowRight'])) {
        state.rightHeld = true;
      } else if (isDown(e, ['KeyP', 'Escape'], ['p', 'Escape'])) {
        if (!e.repeat && keyboardPause) state.pauseQueued = true;
      } else if (isDown(e, ['KeyR'], ['r'])) {
        if (!e.repeat) state.restartQueued = true;
      } else if (isDown(e, ['KeyM'], ['m'])) {
        if (!e.repeat) callbacks.onMute && callbacks.onMute();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (isDown(e, ['KeyS', 'ArrowDown'], ['s', 'ArrowDown', 'j'])) {
        state.slideHeld = false;
      } else if (isDown(e, ['KeyA', 'ArrowLeft'], ['a', 'ArrowLeft'])) {
        state.leftHeld = false;
      } else if (isDown(e, ['KeyD', 'ArrowRight'], ['d', 'ArrowRight'])) {
        state.rightHeld = false;
      }
    });

    // ---- 失焦保护：切窗口 / 切标签 / 最小化时清空按键，防止"松手还在跑" ----
    const releaseAll = () => { clear(); };
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    }

    // ---- 触摸 / 鼠标 ----
    const zone = document.getElementById('touch-zone');
    if (!zone) return;

    const onDown = (e) => {
      e.preventDefault();
      const t = e.touches ? e.touches[0] : e;
      touchStartY = t.clientY;
      touchStartX = t.clientX;
      touchActive = true;
      callbacks.onTouchStart && callbacks.onTouchStart();
    };
    const onMove = (e) => {
      if (!touchActive || !e.touches) return;
      const t = e.touches[0];
      const dy = t.clientY - touchStartY;
      if (dy > 42) {
        state.slideQueued = true;
        state.slideHeld = true;
        touchStartY = t.clientY;
        callbacks.onSlide && callbacks.onSlide();
      }
    };
    const onUp = (e) => {
      if (!touchActive) return;
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      touchActive = false;
      if (Math.abs(dy) < 42 && Math.abs(dx) < 60) {
        // 轻点：地面跳跃 / 空中二段跳
        state.jumpQueued = true;
        state.doubleJumpQueued = true;
        callbacks.onTap && callbacks.onTap();
      }
      state.slideHeld = false;
    };

    zone.addEventListener('touchstart', onDown, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onUp, { passive: false });
    zone.addEventListener('touchcancel', onUp, { passive: false });
    // 鼠标兼容（桌面调试）
    zone.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', (e) => {
      if (!touchActive) return;
      const dy = e.clientY - touchStartY;
      if (dy > 42) {
        state.slideQueued = true;
        state.slideHeld = true;
        touchStartY = e.clientY;
        callbacks.onSlide && callbacks.onSlide();
      }
    });
  }

  function consume() {
    const s = {
      jump: state.jumpQueued,
      doubleJump: state.doubleJumpQueued,
      slide: state.slideQueued,
      slideHeld: state.slideHeld,
      left: state.leftHeld,
      right: state.rightHeld,
      pause: state.pauseQueued,
      restart: state.restartQueued,
    };
    state.jumpQueued = false;
    state.doubleJumpQueued = false;
    state.slideQueued = false;
    state.pauseQueued = false;
    state.restartQueued = false;
    return s;
  }

  function clear() {
    state.jumpQueued = false;
    state.doubleJumpQueued = false;
    state.slideQueued = false;
    state.pauseQueued = false;
    state.restartQueued = false;
    state.slideHeld = false;
    state.leftHeld = false;
    state.rightHeld = false;
    injectedSlide = false;
  }

  // ---- 体感注入（motion.js 每帧调用）：把动作状态写入输入通道 ----
  // 体感模式开启时以体感为准；键盘/触摸仍可用作兜底。
  let injectedSlide = false;
  function inject(act) {
    if (!act) return;
    if (act.left !== undefined) state.leftHeld = !!act.left;
    if (act.right !== undefined) state.rightHeld = !!act.right;
    if (act.slide !== undefined) {
      const s = !!act.slide;
      if (s && !injectedSlide) state.slideQueued = true;   // 下蹲上升沿 → 触发一次滑铲启动
      state.slideHeld = s;
      injectedSlide = s;
    }
    if (act.jump) state.jumpQueued = true;
    if (act.doubleJump) state.doubleJumpQueued = true;
    if (act.pause) state.pauseQueued = true;
    if (act.restart) state.restartQueued = true;
  }

  return { init, consume, clear, inject, isTouch: () => state.isTouch, setKeyboardPause: (v) => { keyboardPause = !!v; } };
})();
