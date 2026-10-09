/* ============================================================
 * motion.js — 体感输入层（FATFIGHT 体感版）
 * 摄像头 + MediaPipe(Pose+Hands) → parseMotion 纯逻辑 → Input.inject
 * 动作映射（身体即手柄）：
 *   躯干中心 x   → 左右移动（死区 + EMA 平滑；身体回中即静止）
 *   髋部快速上移 → 跳跃（瞬态；蹲姿期间抑制，防"蹲起误跳"）
 *   髋降 + 膝弯  → 下蹲（稳态保持 = 长按 S）
 *   空中拍手     → 二段跳（双腕距离 < clapDist；由游戏侧过滤"仅空中有效"）
 *   双手握拳 0.8s→ 暂停
 * 特性：开局 2 秒自动校准站立基线；事件锁存 180ms 防低帧率断触；
 *       人体丢失 0.5s 自动回静止；画中画显示摄像头 + 骨架；动作指示灯。
 * 运行环境：必须经 http:// 访问（getUserMedia 安全上下文要求）。
 * ============================================================ */
'use strict';

const Motion = (() => {

  // ---------- 默认配置 ----------
  const DEFAULTS = {
    deadzone: 0.10,       // 左右摇杆死区（|joy| < 死区 → 静止）
    sens: 1.0,            // 灵敏度（1=标准；0.7 迟钝；1.4 灵敏 → 实际缩放死区）
    enableLateral: false, // 自动向右跑：身体左右不控制移动（改 true 可重新开启左右控制）
    jumpVel: 0.35,        // 跳跃：髋部向上速度阈值（归一化坐标/秒）
    jumpFrames: 1,        // 连续达标帧数（1 帧即触发，降低反应延迟）
    squatHipDrop: 0.12,   // 下蹲：髋 y 低于校准基线
    squatKneeAngle: 110,  // 下蹲：膝角阈值（度，伸直≈180）
    clapDist: 0.15,       // 拍手：双腕归一化距离
    fistDist: 0.22,       // 握拳：指尖-腕平均距离
    fistHold: 0.8,        // 握拳保持秒数 → 触发暂停
    enableFistPause: false,// 体感版默认关闭"握拳暂停"——暂停/继续全用鼠标按钮（避免误触发 / 菜单态信号堆积）
    lockMs: 120,          // 脉冲事件锁存（防低帧率断触；120ms 减少重复跳/拍手的等待延迟）
    lostTimeout: 0.5,     // 人体丢失超过该时长 → 回静止
    calibSeconds: 2,      // 校准采样时长
    emaSmooth: 0.15,      // 躯干 x 平滑时间常数（秒）
    slideSuppressFrames: 4, // 蹲姿结束后抑制跳跃的帧数
  };

  // ---------- DOM 引用（bindUI 中填充） ----------
  let video = null, pipCv = null, pipCtx = null;
  let camBtn = null, calibBtn = null, sensSel = null, pipClose = null;
  const lights = { left: null, right: null, jump: null, slide: null, clap: null };

  // ---------- MediaPipe ----------
  let handsInst = null, poseInst = null;
  let handsBusy = false, poseBusy = false;   // 推理防重入
  let lastPose = null, lastHands = null;
  let mediaStream = null, running = false, rafId = 0, lastNow = 0;

  // ---------- 运行状态（parseMotion 的 st） ----------
  let cfg = Object.assign({}, DEFAULTS);
  let st = {
    now: 0, dt: 1 / 60,
    emaX: 0.5, emaInit: false,
    prevHipY: null, jumpCounter: 0,
    clapPrev: false, fistT: 0, lostT: 0,
    baseline: null,              // { hipY: 站立基线 }
    calibPhase: 'idle',          // idle | capturing | done
    calibSamples: [], calibUntil: 0,
    lockJumpUntil: 0, lockClapUntil: 0, lockPauseUntil: 0,
    slideSuppress: 0,
  };
  let callbacks = {};            // { onCalib(phase), onMotion(act) }

  // ============================================================
  // 纯逻辑：姿态 → 动作状态（可在 node 中注入假数据单测）
  // ============================================================
  function kneeAngle(hip, knee, ankle) {
    const ax = hip.x - knee.x, ay = hip.y - knee.y;
    const bx = ankle.x - knee.x, by = ankle.y - knee.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) return 180;
    const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    return Math.acos(c) * 180 / Math.PI;
  }

  // 解析一批动作：输入 33 点姿态 + 双手数据 → {left,right,jump,doubleJump,slide,pause,hasBody}
  function parseMotion(poseLM, hands, cfgIn, stIn) {
    const c = cfgIn || cfg;
    const s = stIn || st;
    const now = s.now || 0;
    const out = { left: false, right: false, jump: false, doubleJump: false, slide: false, pause: false, hasBody: false };

    // --- 人体可见性 ---
    const hipOk = !!(poseLM && poseLM.length >= 33 && poseLM[23] && poseLM[24] &&
      (poseLM[23].visibility || 0) > 0.25 && (poseLM[24].visibility || 0) > 0.25);
    if (!hipOk) {
      s.lostT = (s.lostT || 0) + (s.dt || 1 / 60);
      if (s.lostT > c.lostTimeout) { s.emaX = 0.5; s.jumpCounter = 0; s.clapPrev = false; s.prevHipY = null; }
      return out;
    }
    s.lostT = 0;
    out.hasBody = true;

    // 无基线（首次校准完成前）不出操作；重新校准期间沿用旧基线，操作不中断
    if (!s.baseline) return out;
    const bs = s.baseline;

    // --- 左右移动：躯干中心 x（肩+髋均值），EMA 平滑 + 死区 ---
    const torso = [11, 12, 23, 24]
      .filter(i => (poseLM[i].visibility || 0) > 0.3)
      .map(i => poseLM[i].x);
    if (torso.length) {
      const raw = torso.reduce((a, b) => a + b, 0) / torso.length;
      if (!s.emaInit) { s.emaX = raw; s.emaInit = true; }
      else {
        const alpha = 1 - Math.exp(-(s.dt || 1 / 60) / c.emaSmooth);
        s.emaX += alpha * (raw - s.emaX);
      }
      // 自动向右跑：身体左右不控制移动（可经 cfg.enableLateral 重新开启）
      if (c.enableLateral) {
        const joy = (s.emaX - 0.5) * 2;
        const dz = c.deadzone / Math.max(c.sens, 0.1);   // 灵敏度缩放死区
        if (joy > dz) out.right = true;
        else if (joy < -dz) out.left = true;
      }
    }

    const hipY = (poseLM[23].y + poseLM[24].y) / 2;

    // --- 下蹲：髋低于基线 + 膝弯（稳态） ---
    const kneeA = [
      [23, 25, 27], [24, 26, 28]
    ].map(([h, k, a]) =>
      (poseLM[h].visibility || 0) > 0.25 && (poseLM[k].visibility || 0) > 0.25 && (poseLM[a].visibility || 0) > 0.25
        ? kneeAngle(poseLM[h], poseLM[k], poseLM[a]) : 180);
    const kneeBent = Math.min.apply(null, kneeA) < c.squatKneeAngle;
    out.slide = (hipY - bs.hipY) > c.squatHipDrop && kneeBent;
    if (out.slide) s.slideSuppress = c.slideSuppressFrames;

    // --- 跳跃：髋部向上速度（瞬态），蹲姿期间+结束后短暂抑制 ---
    if (!out.slide && s.slideSuppress <= 0) {
      if (s.prevHipY != null) {
        const dt = Math.max(s.dt || 1 / 60, 0.001);
        const vy = (s.prevHipY - hipY) / dt;
        s.jumpCounter = vy > c.jumpVel ? (s.jumpCounter || 0) + 1 : 0;
        if (s.jumpCounter >= c.jumpFrames && now >= (s.lockJumpUntil || 0)) {
          out.jump = true;
          s.lockJumpUntil = now + c.lockMs;
          s.jumpCounter = 0;
        }
      }
    } else {
      s.jumpCounter = 0;
    }
    if (s.slideSuppress > 0) s.slideSuppress--;
    s.prevHipY = hipY;

    // --- 二段跳：拍手（双腕靠近，且在躯干上半） ---
    const lw = poseLM[15], rw = poseLM[16];
    if (lw && rw && (lw.visibility || 0) > 0.25 && (rw.visibility || 0) > 0.25) {
      const d = Math.hypot(lw.x - rw.x, lw.y - rw.y);
      const up = lw.y < hipY + 0.08 && rw.y < hipY + 0.08;
      const clap = d < c.clapDist && up;
      if (clap && !s.clapPrev && now >= (s.lockClapUntil || 0)) {
        out.doubleJump = true;
        s.lockClapUntil = now + c.lockMs;
      }
      s.clapPrev = clap;
    } else {
      s.clapPrev = false;
    }

    // --- 暂停：默认关闭（保持菜单时不被信号堆积误触发）。想用握拳暂停时改 cfg.enableFistPause = true ---
    if (c.enableFistPause) {
      const fists = (hands || []).filter(h => h && h.landmarks).map(h => {
        const lm = h.landmarks;
        if (!lm || lm.length < 21) return false;
        let td = 0;
        for (const i of [4, 8, 12, 16, 20]) td += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y);
        return (td / 5) < c.fistDist;
      });
      if (fists.indexOf(true) >= 0) {
        s.fistT = (s.fistT || 0) + (s.dt || 1 / 60);
        if (s.fistT > c.fistHold && now >= (s.lockPauseUntil || 0)) {
          out.pause = true;
          s.lockPauseUntil = now + c.lockMs;
        }
      } else {
        s.fistT = 0;
      }
    } else {
      s.fistT = 0;
      s.lockPauseUntil = 0;     // 关闭期间清掉残留锁，避免开启后立刻触发
    }

    return out;
  }

  // 校准样本 → 站立基线（取中位数抗噪声）
  function captureCalib(samples) {
    if (!samples || !samples.length) return null;
    const ys = samples.slice().sort((a, b) => a - b);
    return { hipY: ys[Math.floor(ys.length / 2)] };
  }

  // ============================================================
  // MediaPipe 实例（与 gesture_tracker.html 相同的双模型）
  // ============================================================
  function createHandsInstance() {
    const h = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}` });
    h.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    h.onResults(r => { lastHands = r; });
    return h;
  }
  function createPoseInstance() {
    const p = new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${f}` });
    p.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    p.onResults(r => { lastPose = r; });
    return p;
  }

  // ============================================================
  // 摄像头控制
  // ============================================================
  async function startCamera() {
    if (running) return true;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' }, audio: false });
      if (video) {
        video.srcObject = mediaStream;
        await new Promise(r => { video.onloadedmetadata = () => { if (pipCv) { pipCv.width = pipCv.clientWidth; pipCv.height = pipCv.clientHeight; } r(); }; });
        await video.play().catch(() => {});
      }
      if (!handsInst) handsInst = createHandsInstance();
      if (!poseInst) poseInst = createPoseInstance();
      // 预热：先用 1×1 画布触发一次推理，把模型权重加载完成（避免首帧 send 卡顿）
      if (poseInst || handsInst) {
        const sc = document.createElement('canvas'); sc.width = sc.height = 1;
        if (poseInst) await poseInst.send({ image: sc }).catch(() => {});
        if (handsInst) await handsInst.send({ image: sc }).catch(() => {});
      }
      running = true;
      lastNow = performance.now();
      rafId = requestAnimationFrame(pump);
      if (callbacks.onCalib) callbacks.onCalib('running');
      return true;
    } catch (e) {
      console.error('[Motion] 摄像头启动失败:', e);
      if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
      return false;
    }
  }

  function stopCamera() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (handsInst) { try { handsInst.close(); } catch (e) {} handsInst = null; }
    if (poseInst) { try { poseInst.close(); } catch (e) {} poseInst = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    lastPose = lastHands = null;
    st = resetState();
    if (video) video.srcObject = null;
    if (callbacks.onCalib) callbacks.onCalib('stopped');
  }

  function resetState() {
    return {
      now: 0, dt: 1 / 60, emaX: 0.5, emaInit: false, prevHipY: null, jumpCounter: 0,
      clapPrev: false, fistT: 0, lostT: 0, baseline: null, calibPhase: 'idle',
      calibSamples: [], calibUntil: 0, lockJumpUntil: 0, lockClapUntil: 0, lockPauseUntil: 0, slideSuppress: 0,
    };
  }

  // 重新校准（站立基线）：校准期间沿用旧基线，游戏操作不中断
  function startCalib() {
    st.calibPhase = 'capturing';
    st.calibSamples = [];
    st.calibUntil = performance.now() + cfg.calibSeconds * 1000;
    if (callbacks.onCalib) callbacks.onCalib('capturing');
  }

  function setSensitivity(v) {
    cfg.sens = v || 1;
  }

  // ============================================================
  // 主循环：把视频帧送入模型推理 → 动作 → 注入游戏输入
  // ============================================================
  function pump() {
    if (!running) return;
    const now = performance.now();
    st.dt = Math.min((now - lastNow) / 1000 || 1 / 60, 0.1);
    lastNow = now;
    st.now = now;

    // ★ 关键一步：把当前视频帧喂给 MediaPipe 模型做推理（Pose + Hands），
    //   推理结果经 onResults 异步写回 lastPose / lastHands。
    //   （原 gesture_tracker 的 animationLoop 中有此调用，融合时曾遗漏，
    //     导致画面能显示但永远没有关键点输出 → 角色不动）
    if (video && video.readyState >= 2) {
      if (!poseBusy && poseInst) {
        poseBusy = true;
        poseInst.send({ image: video }).catch(e => console.error('[Motion] Pose 推理失败:', e)).finally(() => { poseBusy = false; });
      }
      if (!handsBusy && handsInst) {
        handsBusy = true;
        handsInst.send({ image: video }).catch(e => console.error('[Motion] Hands 推理失败:', e)).finally(() => { handsBusy = false; });
      }
    }

    // 未完成校准时先用默认基线兜底（立即可玩，校准完成后再覆盖）
    if (!st.baseline && st.calibPhase !== 'capturing') st.baseline = { hipY: 0.5 };

    // 校准采样
    if (st.calibPhase === 'capturing') {
      if (lastPose && lastPose.poseLandmarks && lastPose.poseLandmarks[23] &&
          (lastPose.poseLandmarks[23].visibility || 0) > 0.25) {
        st.calibSamples.push((lastPose.poseLandmarks[23].y + lastPose.poseLandmarks[24].y) / 2);
      }
      if (now >= st.calibUntil) {
        const bs = captureCalib(st.calibSamples);
        if (bs) {
          st.baseline = bs;
          st.calibPhase = 'done';
          st.prevHipY = null;
          if (callbacks.onCalib) callbacks.onCalib('done');
        } else {
          st.calibPhase = 'idle';
          if (callbacks.onCalib) callbacks.onCalib('failed');
        }
      }
    }

    const poseLM = lastPose && lastPose.poseLandmarks;
    const handsArr = lastHands && lastHands.multiHandLandmarks
      ? lastHands.multiHandLandmarks.map((lm, i) => ({
          landmarks: lm,
          handedness: (lastHands.multiHandedness || [])[i] ? lastHands.multiHandedness[i].label : '',
        })) : [];
    const act = parseMotion(poseLM, handsArr, cfg, st);
    Input.inject(act);
    updateLights(act);
    drawPip(poseLM, handsArr);
    if (callbacks.onMotion) callbacks.onMotion(act);
    rafId = requestAnimationFrame(pump);
  }

  // ============================================================
  // 画中画：摄像头画面 + 骨架叠加
  // ============================================================
  function drawPip(poseLM, handsArr) {
    if (!pipCv || !pipCtx) return;
    const w = pipCv.width, h = pipCv.height;
    if (!w || !h) return;
    pipCtx.clearRect(0, 0, w, h);
    if (video && video.readyState >= 2) {
      try { pipCtx.drawImage(video, 0, 0, w, h); } catch (e) {}
    }
    pipCtx.save();
    pipCtx.globalAlpha = 0.85;
    pipCtx.lineWidth = 3; pipCtx.lineCap = 'round';
    const arm = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12]];
    const leg = [[23, 25], [24, 26], [25, 27], [26, 28], [23, 24], [11, 23], [12, 24]];
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    if (poseLM) {
      for (const [s, e] of arm) {
        if ((poseLM[s].visibility || 0) < 0.3 || (poseLM[e].visibility || 0) < 0.3) continue;
        pipCtx.strokeStyle = '#00e5ff';
        pipCtx.beginPath();
        pipCtx.moveTo((1 - poseLM[s].x) * w, poseLM[s].y * h);
        pipCtx.lineTo((1 - poseLM[e].x) * w, poseLM[e].y * h);
        pipCtx.stroke();
      }
      pipCtx.strokeStyle = '#76ff03';
      for (const [s, e] of leg) {
        if ((poseLM[s].visibility || 0) < 0.3 || (poseLM[e].visibility || 0) < 0.3) continue;
        pipCtx.beginPath();
        pipCtx.moveTo((1 - poseLM[s].x) * w, poseLM[s].y * h);
        pipCtx.lineTo((1 - poseLM[e].x) * w, poseLM[e].y * h);
        pipCtx.stroke();
      }
      for (const i of joints) {
        if ((poseLM[i].visibility || 0) < 0.3) continue;
        pipCtx.fillStyle = i <= 16 ? '#ffd75e' : '#b2ff59';
        pipCtx.beginPath();
        pipCtx.arc((1 - poseLM[i].x) * w, poseLM[i].y * h, 4, 0, Math.PI * 2);
        pipCtx.fill();
      }
    }
    if (handsArr) {
      pipCtx.lineWidth = 2; pipCtx.strokeStyle = '#58a6ff';
      for (const hd of handsArr) {
        const lm = hd.landmarks;
        for (let j = 0; j < lm.length; j++) {
          pipCtx.fillStyle = '#58a6ff';
          pipCtx.beginPath();
          pipCtx.arc((1 - lm[j].x) * w, lm[j].y * h, 2.5, 0, Math.PI * 2);
          pipCtx.fill();
        }
      }
    }
    pipCtx.restore();

    // 状态角标：绿色 = 模型已识别到人体（动作判定在工作）；灰色 = 未检测到
    pipCtx.globalAlpha = 0.9;
    const hasBody = !!(poseLM && poseLM[23] && (poseLM[23].visibility || 0) > 0.25);
    pipCtx.fillStyle = hasBody ? '#3fb950' : '#484f58';
    pipCtx.beginPath();
    pipCtx.arc(12, 12, 5, 0, Math.PI * 2);
    pipCtx.fill();
    pipCtx.fillStyle = '#fff';
    pipCtx.font = 'bold 10px sans-serif';
    pipCtx.fillText(hasBody ? '人体' : '未检测', 22, 15);
    pipCtx.globalAlpha = 1;
  }

  // 动作指示灯（HUD 下排）
  function updateLights(act) {
    if (!act) return;
    const map = { left: 'left', right: 'right', jump: 'jump', slide: 'slide', clap: 'clap' };
    for (const k in map) {
      const el = lights[map[k]];
      if (!el) continue;
      const on = k === 'clap' ? act.doubleJump : !!act[k];
      el.classList.toggle('on', on);
    }
  }

  // ============================================================
  // UI 绑定
  // ============================================================
  function bindUI() {
    const $ = id => document.getElementById(id);
    video = $('pip-video');
    pipCv = $('pip-canvas');
    if (pipCv) pipCtx = pipCv.getContext('2d');
    camBtn = $('btn-cam');
    calibBtn = $('btn-calib');
    sensSel = $('sel-sens');
    pipClose = $('btn-pip-close');
    for (const k of ['left', 'right', 'jump', 'slide', 'clap']) lights[k] = $('light-' + k);

    if (camBtn) camBtn.addEventListener('click', async () => {
      const ok = await startCamera();
      if (ok && camBtn.dataset.toggled !== '1') {
        camBtn.dataset.toggled = '1';
        camBtn.textContent = '关闭体感';
        calibBtn.disabled = false;
        if (pipCv) { const p = pipCv.parentElement; if (p) p.classList.remove('hidden'); }
        // 开启后自动校准
        setTimeout(() => { if (running) startCalib(); }, 400);
      } else {
        stopCamera();
        camBtn.dataset.toggled = '0';
        camBtn.textContent = '开启体感';
        calibBtn.disabled = true;
        if (pipCv) { const p = pipCv.parentElement; if (p) p.classList.add('hidden'); }
      }
    });
    if (calibBtn) calibBtn.addEventListener('click', () => { if (running) startCalib(); });
    if (sensSel) sensSel.addEventListener('change', () => setSensitivity(parseFloat(sensSel.value) || 1));
    if (pipClose) pipClose.addEventListener('click', () => { const p = pipCv && pipCv.parentElement; if (p) p.classList.add('hidden'); });

    // 校准状态提示
    const hint = $('calib-hint');
    callbacks.onCalib = (phase) => {
      if (!hint) return;
      if (phase === 'capturing') { hint.textContent = '🧍 请站到画面中央，保持自然站姿 2 秒…'; hint.classList.remove('hidden'); }
      else if (phase === 'done') { hint.textContent = '✓ 校准完成！向左挪一步试试'; hint.classList.remove('hidden'); setTimeout(() => hint.classList.add('hidden'), 2200); }
      else if (phase === 'failed') { hint.textContent = '⚠ 未检测到人体，请调整位置重试'; hint.classList.remove('hidden'); setTimeout(() => hint.classList.add('hidden'), 2200); }
      else if (phase === 'running') { hint.textContent = '体感已开启，点击「重新校准」可随时重校'; hint.classList.remove('hidden'); setTimeout(() => hint.classList.add('hidden'), 3000); }
      else if (phase === 'stopped') { hint.classList.add('hidden'); }
    };
  }

  window.addEventListener('DOMContentLoaded', bindUI);

  return {
    parseMotion, captureCalib,
    startCamera, stopCamera, startCalib, setSensitivity,
    isRunning: () => running,
    getState: () => st,
  };
})();

if (typeof window !== 'undefined') window.Motion = Motion;
