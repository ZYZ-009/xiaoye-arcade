/* ============================================================
 * audio.js — WebAudio 程序化音效与背景音乐（无需外部音频文件）
 * ============================================================ */
'use strict';

const Sound = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let enabled = true;
  let musicOn = true;
  let musicTimer = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.9;
      masterGain.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.7;
      sfxGain.connect(masterGain);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = 'square', vol = 0.3, when = 0, slideTo = null, dest = null) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.25, when = 0, dest = null) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(dest || sfxGain);
    src.start(t0);
  }

  const sfx = {
    jump() { tone(300, 0.18, 'square', 0.22, 0, 620); },
    doubleJump() { tone(420, 0.2, 'square', 0.22, 0, 900); },
    slide() { noise(0.15, 0.18); },
    land() { noise(0.08, 0.14); },
    coin() { tone(880, 0.09, 'square', 0.2); tone(1320, 0.14, 'square', 0.16, 0.06); },
    gem() { tone(990, 0.1, 'square', 0.2); tone(1480, 0.1, 'square', 0.18, 0.07); tone(1980, 0.16, 'square', 0.16, 0.14); },
    power() { tone(523, 0.1, 'triangle', 0.3); tone(659, 0.1, 'triangle', 0.3, 0.08); tone(784, 0.1, 'triangle', 0.3, 0.16); tone(1046, 0.22, 'triangle', 0.3, 0.24); },
    hit() { noise(0.25, 0.4); tone(160, 0.28, 'sawtooth', 0.3, 0, 60); },
    death() { tone(392, 0.2, 'sawtooth', 0.26, 0, 300); tone(262, 0.3, 'sawtooth', 0.26, 0.18, 180); tone(131, 0.6, 'sawtooth', 0.3, 0.42, 60); },
    shieldBreak() { noise(0.3, 0.35); tone(600, 0.2, 'square', 0.2, 0, 150); },
    whoosh() { noise(0.12, 0.12); },
    click() { tone(660, 0.06, 'square', 0.18); },
    levelup() { tone(523, 0.09, 'triangle', 0.28); tone(659, 0.09, 'triangle', 0.28, 0.08); tone(784, 0.09, 'triangle', 0.28, 0.16); tone(1046, 0.2, 'triangle', 0.28, 0.24); },
  };

  // ---- 背景音乐：中世纪风小调旋律循环（竖琴拨弦风格） ----
  // D 小调五声音阶 + 低音持续
  const MELODY = [
    587, 0, 440, 523, 587, 0, 440, 392,
    440, 523, 587, 698, 587, 523, 440, 0,
    587, 0, 440, 523, 587, 0, 659, 587,
    523, 440, 392, 440, 523, 0, 0, 0,
  ];
  const BASS = [146.8, 0, 0, 0, 130.8, 0, 0, 0, 146.8, 0, 0, 0, 98, 0, 0, 0];

  function startMusic() {
    const c = ensure();
    if (!c || !musicOn) return;
    stopMusic();
    let step = 0;
    const stepDur = 0.16;
    const playStep = () => {
      if (!musicOn || !ctx) return;
      const i = step % MELODY.length;
      const f = MELODY[i];
      if (f) tone(f, 0.22, 'triangle', 0.16, 0, null, musicGain);
      const b = BASS[Math.floor(step / 2) % BASS.length];
      if (b && step % 2 === 0) tone(b, 0.5, 'sine', 0.5, 0, null, musicGain);
      step++;
    };
    playStep();
    musicTimer = setInterval(playStep, stepDur * 1000);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) { stopMusic(); }
    else if (ctx) { if (musicOn) startMusic(); }
  }
  function setMuted(v) {
    muted = v;
    if (ctx) masterGain.gain.value = v ? 0 : 0.9;
  }
  function unlock() {
    ensure();
    if (enabled && musicOn) startMusic();
  }

  return {
    ensure, unlock,
    sfx,
    startMusic, stopMusic,
    setEnabled, setMuted,
    get enabled() { return enabled; },
    get musicOn() { return musicOn; },
    set musicOn(v) {
      musicOn = v;
      if (v && enabled) startMusic(); else stopMusic();
    },
  };
})();
