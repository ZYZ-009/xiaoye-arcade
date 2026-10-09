/* ============================================================
 * ui.js — 界面管理（主菜单 / 暂停 / 结算 / HUD）
 * ============================================================ */
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  const els = {};

  function init(onAction) {
    els.menu = $('screen-menu');
    els.pause = $('screen-pause');
    els.over = $('screen-over');
    els.hud = $('hud');
    els.dist = $('hud-dist');
    els.coins = $('hud-coins');
    els.hearts = $('hud-hearts');
    els.finalDist = $('final-dist');
    els.finalCoins = $('final-coins');
    els.finalBest = $('final-best');
    els.newRecord = $('new-record');
    els.powerupHud = $('powerup-hud');
    els.touchZone = $('touch-zone');
    els.slideHint = $('slide-hint');
    els.rotateHint = $('rotate-hint');
    els.chkSound = $('chk-sound');

    $('btn-play').addEventListener('click', () => { Sound.sfx.click(); onAction('play'); });
    $('btn-resume').addEventListener('click', () => { Sound.sfx.click(); onAction('resume'); });
    $('btn-restart').addEventListener('click', () => { Sound.sfx.click(); onAction('restart'); });
    $('btn-quit').addEventListener('click', () => { Sound.sfx.click(); onAction('quit'); });
    $('btn-retry').addEventListener('click', () => { Sound.sfx.click(); onAction('retry'); });
    $('btn-menu').addEventListener('click', () => { Sound.sfx.click(); onAction('quit'); });
    $('btn-pause').addEventListener('click', () => { Sound.sfx.click(); onAction('pause'); });

    els.chkSound.addEventListener('change', () => {
      Sound.setEnabled(els.chkSound.checked);
      Sound.musicOn = els.chkSound.checked;
      Sound.sfx.click();
    });
  }

  function show(screen) {
    els.menu.classList.toggle('hidden', screen !== 'menu');
    els.pause.classList.toggle('hidden', screen !== 'pause');
    els.over.classList.toggle('hidden', screen !== 'over');
    els.hud.classList.toggle('hidden', screen !== 'game');
    els.touchZone.classList.toggle('hidden', screen !== 'game');
  }

  function hud(dist, coins, hp, maxHp) {
    els.dist.textContent = Math.floor(dist);
    els.coins.textContent = coins;
    // 血量红心（红心道具可让血量超过上限，超出部分用 +N 标记）
    if (els.hearts && hp !== undefined) {
      const max = maxHp || 5;
      let h = '';
      for (let i = 0; i < max; i++) h += i < hp ? '❤️' : '🖤';
      const over = Math.max(0, hp - max);
      const html = h + (over ? `<span class="hp-over">+${over}</span>` : '');
      if (els.hearts.innerHTML !== html) els.hearts.innerHTML = html;
    }
  }

  function powerups(p) {
    els.powerupHud.innerHTML = '';
    const badges = [];
    if (p.shield) badges.push({ ic: '🛡️', t: '护盾' });
    if (p.magnet > 0) badges.push({ ic: '🧲', t: `磁铁 ${p.magnet.toFixed(0)}s` });
    if (p.multT > 0) badges.push({ ic: '⭐', t: `双倍 ${p.multT.toFixed(0)}s` });
    for (const b of badges) {
      const el = document.createElement('div');
      el.className = 'powerup-badge';
      el.innerHTML = `<span>${b.ic}</span><span>${b.t}</span>`;
      els.powerupHud.appendChild(el);
    }
  }

  function gameOver(dist, coins, best, isRecord) {
    els.finalDist.textContent = Math.floor(dist);
    els.finalCoins.textContent = coins;
    els.finalBest.textContent = Math.floor(best);
    els.newRecord.classList.toggle('hidden', !isRecord);
  }

  function showSlideHint(on) {
    els.slideHint.classList.toggle('hidden', !on);
  }

  // 竖屏触屏设备提示横屏（短暂显示，非阻塞）
  function showRotateHint(on) {
    if (els.rotateHint) els.rotateHint.classList.toggle('hidden', !on);
  }

  return { init, show, hud, powerups, gameOver, showSlideHint, showRotateHint };
})();
