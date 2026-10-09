/* ============================================================
 * game.js — 脖子碰碰车：3D 场景、主循环、比赛流程、UI
 * 依赖：THREE(CDN) / track.js / vehicle.js / face-control.js
 * 美术：全部用 Three.js 程序化生成的低多边形模型（无第三方素材，可商用）
 * ============================================================ */
'use strict';

const Game = (() => {

  const TOTAL_LAPS = 3;
  const CAR_COUNT = 5;                 // 玩家 1 + AI 4
  const CAR_COLORS = [0xff5c7a, 0x58a6ff, 0x7ee787, 0xffd75e, 0xb388ff];
  const CAR_NAMES = ['你', '蓝闪电', '绿旋风', '黄蜂号', '紫电'];

  let renderer, scene, camera, trackObj;
  let cars = [], carMeshes = [], shields = [];
  let state = 'menu';                  // menu | countdown | racing | finished
  let countdown = 3, raceTime = 0, lastTs = 0;
  let minimap, mctx, trackPath2D = null;
  let ui = {};
  const keys = { up: false, down: false, left: false, right: false, brake: false };

  // ---------- 初始化 ----------
  function init() {
    cacheUI();
    Track.init();
    initThree();
    buildCars();
    initMinimap();
    bindKeys();
    bindButtons();
    setMsg('点「开启摄像头并开始」→ 允许权限 → 平视镜头校准 2 秒', 'info');
    loop(performance.now());
  }

  function cacheUI() {
    ['hud-lap', 'hud-rank', 'hud-speed', 'hud-shield', 'hud-msg', 'cam-video', 'cam-overlay',
     'pitch-fill', 'yaw-fill', 'countdown', 'start-screen', 'result-screen', 'result-list',
     'minimap', 'btn-start', 'btn-restart', 'btn-calib', 'sel-sens', 'chk-invert', 'cam-wrap', 'hud']
      .forEach(id => { ui[id] = document.getElementById(id); });
  }

  function initThree() {
    const canvas = document.getElementById('scene');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b8e8);
    scene.fog = new THREE.Fog(0x87b8e8, 180, 420);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 900);

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x3a5a3a, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 0.95);
    sun.position.set(80, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
    scene.add(sun);

    trackObj = Track.build3D(THREE, scene);
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- 车辆 3D 模型（程序化低多边形碰碰车） ----------
  function buildCarMesh(color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.45 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.4, roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.75 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 3.7), bodyMat);
    body.position.y = 0.72; body.castShadow = true;
    g.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.6, 1.7), glassMat);
    cabin.position.set(0, 1.32, -0.15);
    g.add(cabin);

    // 碰碰车橡胶保险圈
    const ringGeo = new THREE.TorusGeometry(1.55, 0.28, 8, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, darkMat);
    ring.position.y = 0.5; ring.scale.set(1, 1, 1.25);
    g.add(ring);

    // 车轮
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.36, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 });
    [[-1.05, 1.2], [1.05, 1.2], [-1.05, -1.25], [1.05, -1.25]].forEach(([x, z]) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.46, z);
      g.add(w);
    });

    // 前灯
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    [-0.6, 0.6].forEach(x => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), lampMat);
      l.position.set(x, 0.78, 1.88);
      g.add(l);
    });

    // 顶部号码牌（区分车辆）
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    plate.position.set(0, 1.05, -1.9);
    g.add(plate);

    return g;
  }

  function buildShieldMesh() {
    const geo = new THREE.SphereGeometry(2.5, 18, 14);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5ce1ff, transparent: true, opacity: 0.22,
      emissive: 0x1d9e75, emissiveIntensity: 0.6, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.9;
    return m;
  }

  function buildCars() {
    cars = [];
    carMeshes = [];
    shields = [];
    const START = Track.START_LINE_T;
    for (let i = 0; i < CAR_COUNT; i++) {
      const isPlayer = i === 0;
      const car = new Vehicle({
        name: CAR_NAMES[i],
        color: CAR_COLORS[i],
        isPlayer: isPlayer,
        startT: START - 0.007 * (i + 1),                 // 起跑格排在起跑线之前（位于长直道）
        lateral: (i % 2 === 0 ? -3.4 : 3.4) * (i === 0 ? 0 : 1),
        aiSkill: isPlayer ? 1 : 0.78 + Math.random() * 0.18
      });
      car.placeOnTrack(Track, car.startT, car.lateral);
      car.progress = -(START - car.startT);              // 还差一点到起跑线
      cars.push(car);

      const mesh = buildCarMesh(CAR_COLORS[i]);
      scene.add(mesh);
      carMeshes.push(mesh);

      const sh = buildShieldMesh();
      scene.add(sh);
      shields.push(sh);
    }
  }

  // ---------- 小地图 ----------
  function initMinimap() {
    minimap = ui['minimap'];
    if (!minimap) return;
    mctx = minimap.getContext('2d');
    const s = Track.getSamples();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of s.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    trackPath2D = { minX, maxX, minZ, maxZ };
  }
  function drawMinimap() {
    if (!mctx || !trackPath2D) return;
    const w = minimap.width, h = minimap.height;
    const { minX, maxX, minZ, maxZ } = trackPath2D;
    const pad = 8;
    const sx = (w - pad * 2) / (maxX - minX), sz = (h - pad * 2) / (maxZ - minZ);
    const sc = Math.min(sx, sz);
    const ox = pad + ((w - pad * 2) - (maxX - minX) * sc) / 2;
    const oz = pad + ((h - pad * 2) - (maxZ - minZ) * sc) / 2;
    const map = p => ({ x: ox + (p.x - minX) * sc, y: oz + (p.z - minZ) * sc });

    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = 'rgba(13,15,22,0.72)';
    mctx.fillRect(0, 0, w, h);
    mctx.strokeStyle = 'rgba(255,255,255,0.35)';
    mctx.lineWidth = 7;
    mctx.beginPath();
    Track.getSamples().pts.forEach((p, i) => {
      const m = map(p);
      i ? mctx.lineTo(m.x, m.y) : mctx.moveTo(m.x, m.y);
    });
    mctx.closePath();
    mctx.stroke();
    cars.forEach((c, i) => {
      const m = map({ x: c.x, z: c.z });
      mctx.fillStyle = '#' + CAR_COLORS[i].toString(16).padStart(6, '0');
      mctx.beginPath();
      mctx.arc(m.x, m.y, c.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      mctx.fill();
      if (c.isPlayer) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.stroke(); }
    });
  }

  // ---------- 输入 ----------
  function bindKeys() {
    const set = (e, v) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.up = v; break;
        case 'KeyS': case 'ArrowDown': keys.down = v; break;
        case 'KeyA': case 'ArrowLeft': keys.left = v; break;
        case 'KeyD': case 'ArrowRight': keys.right = v; break;
        case 'Space': keys.brake = v; break;
      }
    };
    window.addEventListener('keydown', e => { set(e, true); if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup', e => set(e, false));
  }

  function gatherInput(dt) {
    const face = FaceControl.read(dt);
    let throttle = 0, steer = 0, brake = false;

    // 键盘优先（没按键时才用头部）
    if (keys.up) throttle = 1;
    else if (keys.down) throttle = -1;
    else if (face.ready && face.hasFace && !face.calibrating) { throttle = face.throttle; }

    if (keys.left) steer = -1;
    else if (keys.right) steer = 1;
    else if (face.ready && face.hasFace && !face.calibrating) { steer = face.steer; }

    brake = keys.brake || (!keys.up && !keys.down && face.ready && face.hasFace && face.brake);
    if (throttle !== 0) brake = false;
    return { throttle, steer, brake, face };
  }

  // ---------- 主循环 ----------
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;

    if (state === 'countdown') {
      countdown -= dt;
      showCountdown(Math.ceil(countdown));
      if (countdown <= 0) { state = 'racing'; ui['countdown'].classList.add('hidden'); }
    }

    if (state === 'racing' || state === 'finished') {
      stepCars(dt);
    }
    syncMeshes();
    updateCamera();
    updateHUD();
    drawMinimap();
    drawCamOverlay();
    renderer.render(scene, camera);
  }

  function stepCars(dt) {
    if (state === 'racing') raceTime += dt;
    const input = gatherInput(dt);
    cars.forEach((car, i) => {
      const ctrl = car.isPlayer
        ? { throttle: input.throttle, steer: input.steer, brake: input.brake }
        : car.aiControl(Track, cars, dt);
      car.update(dt, ctrl, Track);
      if (car.lastWallEvent) {
        if (car.isPlayer) {
          if (car.lastWallEvent === 'shield') {
            setMsg(`护盾 -1！还能扛 ${car.shield} 次`, 'warn');
          } else {
            setMsg('护盾耗尽！回到起始位置，本圈重跑', 'danger');
          }
        }
      }
      if (!car.finished && car.progress >= TOTAL_LAPS) {
        car.finished = true;
        car.finishTime = raceTime;
        if (car.isPlayer) finishRace();
      }
    });

    // 车车碰撞
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) resolveCollision(cars[i], cars[j]);
    }

    computeRanks(cars);
    // 所有 AI 都跑完也结束（玩家可能还在跑）
    if (state === 'racing' && cars.every(c => c.finished)) finishRace();
  }

  function syncMeshes() {
    cars.forEach((c, i) => {
      const m = carMeshes[i];
      m.position.set(c.x, 0, c.z);
      m.rotation.y = c.heading;
      // 护盾：有层数才显示，层数越低越红
      const sh = shields[i];
      if (c.shield > 0) {
        sh.visible = true;
        const col = c.shield === 3 ? 0x5ce1ff : c.shield === 2 ? 0xffd75e : 0xff7b72;
        sh.material.color.setHex(col);
        sh.material.opacity = 0.16 + 0.06 * c.shield + (c.invuln > 0 ? Math.abs(Math.sin(raceTime * 18)) * 0.25 : 0);
        sh.position.set(c.x, 0.9, c.z);
      } else {
        sh.visible = false;
      }
    });
  }

  function updateCamera() {
    const c = cars[0];
    if (!c) return;
    const dirX = Math.sin(c.heading), dirZ = Math.cos(c.heading);
    const dist = 10 + Math.abs(c.speed) * 0.12;
    const tx = c.x - dirX * dist, tz = c.z - dirZ * dist;
    camera.position.x += (tx - camera.position.x) * 0.12;
    camera.position.y += ((4.6 + Math.abs(c.speed) * 0.05) - camera.position.y) * 0.12;
    camera.position.z += (tz - camera.position.z) * 0.12;
    camera.lookAt(c.x + dirX * 4, 1.2, c.z + dirZ * 4);
  }

  // ---------- UI ----------
  function updateHUD() {
    const me = cars[0];
    if (!me) return;
    const lapNow = Math.min(TOTAL_LAPS, Math.max(1, Math.floor(me.progress) + 1));
    setText('hud-lap', `${lapNow} / ${TOTAL_LAPS}`);
    setText('hud-rank', `${me.rank} / ${CAR_COUNT}`);
    setText('hud-speed', Math.round(Math.abs(me.speed) * 3.6));

    const sh = ui['hud-shield'];
    if (sh) {
      let s = '';
      for (let i = 0; i < VehicleConst.SHIELD_MAX; i++) {
        s += i < me.shield ? '<span class="sh on">🛡</span>' : '<span class="sh">🛡</span>';
      }
      if (sh.innerHTML !== s) sh.innerHTML = s;
    }

    // 姿态指示条
    const fc = FaceControl.getConfig();
    const pose = FaceControl.read(0);
    if (pose && pose.pitch != null) {
      const base = FaceControl.getCalib();
      if (base) {
        const dp = (base.pitch - pose.pitch);           // 正=抬头
        const dy = (pose.yaw - base.yaw) * (fc.invertYaw ? -1 : 1);
        setBar('pitch-fill', 0.5 - clamp(dp / (fc.pitchFull * 1.6), -0.5, 0.5));
        setBar('yaw-fill', 0.5 + clamp(dy / (fc.yawFull * 1.6), -0.5, 0.5));
      }
    }
  }

  function setText(id, v) { const el = ui[id]; if (el && el.textContent !== String(v)) el.textContent = v; }
  function setBar(id, v) { const el = ui[id]; if (el) el.style.left = (clamp(v, 0, 1) * 100) + '%'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  let msgTimer = 0;
  function setMsg(text, kind) {
    const el = ui['hud-msg'];
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + (kind || 'info');
    msgTimer = 2.6;
  }

  // 摄像头小窗：画脸部关键点 + 鼻尖
  function drawCamOverlay() {
    const cv = ui['cam-overlay'];
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const lm = FaceControl.getLastFace() && FaceControl.getLastFace().multiFaceLandmarks
      && FaceControl.getLastFace().multiFaceLandmarks[0];
    if (!lm) return;
    const P = i => ({ x: (1 - lm[i].x) * w, y: lm[i].y * h });
    // 脸轮廓点
    ctx.fillStyle = '#58a6ff';
    for (const i of [1, 33, 263, 152, 10, 234, 454]) {
      const p = P(i);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // 眼线 + 鼻尖
    const a = P(33), b = P(263), n = P(1);
    ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  function showCountdown(n) {
    const el = ui['countdown'];
    if (!el) return;
    el.classList.remove('hidden');
    const t = n > 0 ? String(n) : 'GO!';
    if (el.textContent !== t) el.textContent = t;
  }

  // ---------- 流程 ----------
  function bindButtons() {
    if (ui['btn-start']) ui['btn-start'].addEventListener('click', startRace);
    if (ui['btn-restart']) ui['btn-restart'].addEventListener('click', () => {
      ui['result-screen'].classList.add('hidden');
      resetRace();
      startRace();
    });
    if (ui['btn-calib']) ui['btn-calib'].addEventListener('click', () => FaceControl.startCalib());
    if (ui['sel-sens']) ui['sel-sens'].addEventListener('change', () => {
      FaceControl.setConfig({ smooth: parseFloat(ui['sel-sens'].value) || 0.45 });
    });
    if (ui['chk-invert']) ui['chk-invert'].addEventListener('change', () => {
      FaceControl.setConfig({ invertYaw: ui['chk-invert'].checked });
    });
  }

  async function startRace() {
    FaceControl.setCallbacks({
      onCalib: phase => {
        if (phase === 'capturing') setMsg('校准中：请平视镜头，保持不动 2 秒…', 'info');
        else if (phase === 'done') { setMsg('校准完成！抬起下巴 = 加速', 'ok'); startCountdown(); }
        else if (phase === 'failed') setMsg('未检测到人脸，请调整光线/位置后点「重新校准」', 'danger');
        else if (phase === 'error') setMsg('摄像头启动失败（需要 http:// 或 https://）', 'danger');
      }
    });
    if (ui['cam-wrap']) ui['cam-wrap'].classList.remove('hidden');
    const ok = await FaceControl.start({ video: ui['cam-video'] });
    ui['start-screen'].classList.add('hidden');
    ui['hud'].classList.remove('hidden');
    if (!ok) setMsg('摄像头不可用 — 可用 W/S/A/D 或方向键驱动', 'warn');
  }

  function startCountdown() {
    countdown = 3.2;
    state = 'countdown';
    showCountdown(3);
  }

  function resetRace() {
    raceTime = 0;
    const START = Track.START_LINE_T;
    cars.forEach((c) => {
      c.finished = false; c.finishTime = 0; c.hits = 0;
      c.shield = VehicleConst.SHIELD_MAX; c.invuln = 0;
      c.placeOnTrack(Track, c.startT, c.lateral);
      c.progress = -(START - c.startT);
    });
    computeRanks(cars);
  }

  function finishRace() {
    if (state === 'finished') return;
    state = 'finished';
    const ranked = computeRanks(cars);
    const list = ui['result-list'];
    if (list) {
      list.innerHTML = '';
      ranked.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'rrow' + (c.isPlayer ? ' me' : '');
        const laps = Math.min(TOTAL_LAPS, Math.max(0, Math.floor(c.progress)));
        const time = c.finished ? c.finishTime.toFixed(1) + 's' : `第 ${laps + 1} 圈`;
        row.innerHTML = `<span class="rk">${i + 1}</span>
          <span class="dot" style="background:#${CAR_COLORS[cars.indexOf(c)].toString(16).padStart(6, '0')}"></span>
          <span class="nm">${c.name}</span><span class="tm">${time}</span>`;
        list.appendChild(row);
      });
    }
    ui['result-screen'].classList.remove('hidden');
    const me = cars[0];
    setMsg(`比赛结束！你的名次：第 ${me.rank} 名`, me.rank === 1 ? 'ok' : 'warn');
  }

  // 暴露给测试/调试
  return {
    init, startRace, startCountdown, resetRace, finishRace,
    getState: () => state,
    getCars: () => cars,
    setMsg
  };
})();

window.addEventListener('DOMContentLoaded', () => Game.init());
if (typeof window !== 'undefined') window.__game = Game;
