/* ============================================================
 * face-control.js — 摄像头 + MediaPipe FaceMesh → 头部姿态 → 车辆控制
 * 控制映射（按需求）：
 *   下巴抬起        → 加速前进
 *   中间位置        → 刹车
 *   下巴向下        → 后退
 *   头转向左侧      → 车子左转
 *   头转向右侧      → 车子右转
 * 姿态算法（不需求解 PnP，轻量稳健）：
 *   pitch = (鼻尖.y - 双眼中点.y) / 眼距      —— 抬头时鼻尖相对上移 → pitch 变小
 *   yaw   = (鼻尖.x - 双眼中点.x) / 眼距      —— 头右转时鼻尖右移 → yaw 变大（已按镜像画面取 1-x）
 * 开局自动校准：记录你平视时的 pitch/yaw 作为中立基准，之后都按"相对基准的偏移"控制。
 * ============================================================ */
'use strict';

const FaceControl = (() => {

  const DEFAULTS = {
    pitchDead: 0.10,     // 俯仰死区（相对基准）
    pitchFull: 0.32,     // 俯仰到满舵所需的偏移
    yawDead: 0.07,       // 偏航死区
    yawFull: 0.30,       // 偏航到满舵所需的偏移
    smooth: 0.45,        // 姿态平滑系数（0~1，越大越灵敏）
    calibSeconds: 2,     // 校准采样时长
    invertYaw: false,    // 转向反了就设为 true
  };

  let cfg = Object.assign({}, DEFAULTS);
  let video = null, fm = null;
  let running = false, busy = false, rafId = 0;
  let lastFace = null, mediaStream = null;
  let calib = null, calibSamples = [], calibrating = false, calibUntil = 0;
  let smoothPitch = null, smoothYaw = null;
  let callbacks = {};

  // ---------- 纯计算：landmarks → 姿态（可单测） ----------
  function pt(lm, i) {
    const p = lm[i];
    if (!p || (p.visibility !== undefined && p.visibility < 0.5)) return null;
    return { x: 1 - p.x, y: p.y };       // 镜像：画面里往右 = x 变大
  }
  function computePose(lm) {
    if (!lm || lm.length < 468) return null;
    const nose = pt(lm, 1);
    const eyeA = pt(lm, 33), eyeB = pt(lm, 263);     // 两眼外角
    const chin = pt(lm, 152), brow = pt(lm, 10);
    if (!nose || !eyeA || !eyeB) return null;
    const eyeMid = { x: (eyeA.x + eyeB.x) / 2, y: (eyeA.y + eyeB.y) / 2 };
    const eyeW = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y) || 0.12;
    return {
      pitch: (nose.y - eyeMid.y) / eyeW,     // 平视≈0.6；抬头→变小；低头→变大
      yaw: (nose.x - eyeMid.x) / eyeW,       // 正视≈0；头右转→变大
      nose, eyeMid, eyeW, chin, brow
    };
  }

  // ---------- 姿态 → 控制量（纯逻辑，可单测） ----------
  function poseToControl(pitch, yaw, base, cfgIn) {
    const c = cfgIn || cfg;
    if (!base) return { throttle: 0, steer: 0, brake: true, ready: false };
    const dp = base.pitch - pitch;          // 正数 = 抬头（下巴抬起）
    const dy = (yaw - base.yaw) * (c.invertYaw ? -1 : 1);

    let throttle = 0, brake = false;
    if (dp > c.pitchDead) {
      throttle = Math.min(1, (dp - c.pitchDead) / c.pitchFull);      // 抬头 → 前进
    } else if (dp < -c.pitchDead) {
      throttle = -Math.min(1, (-dp - c.pitchDead) / c.pitchFull);    // 低头 → 后退
    } else {
      brake = true;                                                   // 中间 → 刹车
    }

    let steer = 0;
    if (Math.abs(dy) > c.yawDead) {
      const s = (Math.abs(dy) - c.yawDead) / c.yawFull;
      steer = Math.max(-1, Math.min(1, Math.sign(dy) * s));           // 右偏 → 右转
    }
    return { throttle, steer, brake, ready: true };
  }

  // ---------- 每帧读取 ----------
  function read(dt) {
    const out = { throttle: 0, steer: 0, brake: true, hasFace: false, pitch: null, yaw: null, calibrating: calibrating, ready: !!calib };
    if (!running) return out;

    if (calibrating) {
      const pose = lastFace && lastFace.multiFaceLandmarks && lastFace.multiFaceLandmarks[0]
        ? computePose(lastFace.multiFaceLandmarks[0]) : null;
      if (pose) calibSamples.push({ pitch: pose.pitch, yaw: pose.yaw });
      if (performance.now() >= calibUntil) finishCalib();
    }

    const lm = lastFace && lastFace.multiFaceLandmarks && lastFace.multiFaceLandmarks[0];
    const pose = lm ? computePose(lm) : null;
    if (!pose) { smoothPitch = smoothYaw = null; return out; }

    if (smoothPitch == null) { smoothPitch = pose.pitch; smoothYaw = pose.yaw; }
    else {
      const a = Math.min(1, Math.max(0.05, cfg.smooth));
      smoothPitch += (pose.pitch - smoothPitch) * a;
      smoothYaw += (pose.yaw - smoothYaw) * a;
    }
    out.hasFace = true;
    out.pitch = smoothPitch;
    out.yaw = smoothYaw;

    const ctl = poseToControl(smoothPitch, smoothYaw, calib, cfg);
    out.throttle = ctl.throttle;
    out.steer = ctl.steer;
    out.brake = ctl.brake;
    return out;
  }

  // ---------- 校准 ----------
  function startCalib() {
    calibrating = true;
    calibSamples = [];
    calibUntil = performance.now() + cfg.calibSeconds * 1000;
    calib = null;
    smoothPitch = smoothYaw = null;
    if (callbacks.onCalib) callbacks.onCalib('capturing');
  }
  function finishCalib() {
    calibrating = false;
    if (!calibSamples.length) {
      if (callbacks.onCalib) callbacks.onCalib('failed');
      return;
    }
    const ps = calibSamples.map(s => s.pitch).sort((a, b) => a - b);
    const ys = calibSamples.map(s => s.yaw).sort((a, b) => a - b);
    calib = {
      pitch: ps[Math.floor(ps.length / 2)],
      yaw: ys[Math.floor(ys.length / 2)]
    };
    if (callbacks.onCalib) callbacks.onCalib('done');
  }

  // ---------- 摄像头 / 模型 ----------
  function createFaceMesh() {
    const F = window.FaceMesh;
    const inst = new F({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}` });
    inst.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    inst.onResults(r => { lastFace = r; });
    return inst;
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState >= 2 && fm && !busy) {
      busy = true;
      fm.send({ image: video }).catch(e => console.error('[FaceMesh]', e)).finally(() => { busy = false; });
    }
    if (callbacks.onFrame) callbacks.onFrame(lastFace);
  }

  async function start(opts) {
    if (running) return true;
    try {
      video = (opts && opts.video) || document.getElementById('cam-video');
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false
      });
      video.srcObject = mediaStream;
      await new Promise(r => { video.onloadedmetadata = () => r(); });
      await video.play().catch(() => {});
      if (!fm) fm = createFaceMesh();
      const sc = document.createElement('canvas'); sc.width = sc.height = 1;
      await fm.send({ image: sc }).catch(() => {});      // 预热模型
      running = true;
      rafId = requestAnimationFrame(loop);
      startCalib();
      return true;
    } catch (e) {
      console.error('摄像头启动失败:', e);
      if (callbacks.onCalib) callbacks.onCalib('error');
      return false;
    }
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (fm) { try { fm.close(); } catch (e) {} fm = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (video) video.srcObject = null;
    lastFace = null; calib = null;
    smoothPitch = smoothYaw = null;
  }

  function setCallbacks(cb) { callbacks = cb || {}; }
  function setConfig(o) { Object.assign(cfg, o || {}); }
  function getConfig() { return cfg; }

  return {
    computePose, poseToControl,
    start, stop, read, startCalib, setCallbacks, setConfig, getConfig,
    isRunning: () => running,
    hasCalib: () => !!calib,
    getCalib: () => calib,
    getLastFace: () => lastFace
  };
})();

if (typeof window !== 'undefined') window.FaceControl = FaceControl;
if (typeof module !== 'undefined' && module.exports) module.exports = FaceControl;
