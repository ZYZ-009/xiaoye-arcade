/* ============================================================
 * track.js — 赛道：中心线曲线、进度/圈数判定、3D 路面与"钉子铜墙铁壁"
 * 纯几何部分（采样 / 最近点 / 进度）不依赖 THREE，可在 node 中单测；
 * build3D() 依赖 THREE，负责生成路面、护墙、钉子、起跑线。
 * 赛道形状：不规则闭环，直道总长约 480、弯道约 330 → 直道居多。
 * ============================================================ */
'use strict';

const Track = (() => {

  // 中心线控制点（俯视 XZ 平面，单位：米）
  const CONTROL = [
    [45, -120], [45, -60], [45, 0], [45, 60], [45, 120],   // 右侧长直道（起跑直道）
    [40, 160], [15, 185], [-20, 190],                       // 右上弯
    [-60, 185], [-95, 180],                                 // 上方直道
    [-120, 155], [-130, 120],                               // 左上弯
    [-130, 60], [-128, -10],                                // 左侧直道
    [-115, -70], [-85, -110],                               // 左下 S 弯
    [-40, -130], [5, -135], [30, -132]                      // 下方直道 → 回到起点
  ];
  const HALF_W = 8;          // 赛道半宽
  const SAMPLES = 720;       // 中心线采样点数
  const WALL_H = 2.2;        // 护墙高度
  const START_LINE_T = 0.04; // 起跑线所在的赛道参数（设在长直道开头，避免一起步就撞弯）

  // ---------- Catmull-Rom（uniform，闭合） ----------
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  let samples = null;        // { pts, tans, n }

  function buildSamples(n) {
    n = n || SAMPLES;
    const N = CONTROL.length, pts = [];
    for (let i = 0; i < n; i++) {
      const u = (i / n) * N;
      const seg = Math.floor(u) % N, t = u - Math.floor(u);
      const p0 = CONTROL[(seg - 1 + N) % N], p1 = CONTROL[seg],
            p2 = CONTROL[(seg + 1) % N], p3 = CONTROL[(seg + 2) % N];
      pts.push({
        x: cr(p0[0], p1[0], p2[0], p3[0], t),
        z: cr(p0[1], p1[1], p2[1], p3[1], t)
      });
    }
    const tans = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      return { x: dx / L, z: dz / L };
    });
    return { pts, tans, n };
  }

  function init() { samples = buildSamples(SAMPLES); return samples; }
  function getSamples() { return samples || init(); }

  // ---------- 最近点（带上一帧索引提示，避免全量搜索） ----------
  function nearest(x, z, hint) {
    const s = getSamples();
    let best = -1, bestD = Infinity;
    const scan = (from, to) => {
      for (let i = from; i <= to; i++) {
        const k = (i % s.n + s.n) % s.n;
        const dx = s.pts[k].x - x, dz = s.pts[k].z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = k; }
      }
    };
    if (hint != null) {
      scan(hint - 45, hint + 45);
      if (bestD < 1600) return { idx: best, dist: Math.sqrt(bestD), t: best / s.n };
    }
    bestD = Infinity; best = -1;
    scan(0, s.n - 1);
    return { idx: best, dist: Math.sqrt(bestD), t: best / s.n };
  }

  function pointAt(t) {
    const s = getSamples();
    const i = Math.round(((t % 1) + 1) % 1 * s.n) % s.n;
    return s.pts[i];
  }
  function tangentAt(t) {
    const s = getSamples();
    const i = Math.round(((t % 1) + 1) % 1 * s.n) % s.n;
    return s.tans[i];
  }

  // ---------- 进度 / 圈数（纯逻辑，可单测） ----------
  // progress 为累计圈进度（浮点）：0.0 = 起点，1.0 = 跑完 1 圈，3.0 = 跑完 3 圈
  function progressDelta(prevT, t) {
    let d = t - prevT;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    return d;
  }
  function lapOf(progress) {
    return Math.max(1, Math.floor(progress) + 1);
  }
  function lapFraction(progress) {
    const f = progress - Math.floor(progress);
    return f < 0 ? f + 1 : f;
  }

  // ---------- 3D 构建（依赖 THREE） ----------
  function build3D(THREE, scene) {
    const s = getSamples();
    const group = new THREE.Group();

    // --- 地面（草地） ---
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshLambertMaterial({ color: 0x2f4a2b })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    group.add(ground);

    // --- 路面（沿采样点三角化） ---
    const n = s.n, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, p = s.pts[k], tan = s.tans[k];
      const nx = -tan.z, nz = tan.x;
      const lx = p.x + nx * HALF_W, lz = p.z + nz * HALF_W;
      const rx = p.x - nx * HALF_W, rz = p.z - nz * HALF_W;
      pos.push(lx, 0, lz, rx, 0.02, rz);
      uv.push(0, i / n * 40, 1, i / n * 40);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, c, b, b, c, d);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    roadGeo.setIndex(idx);
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(roadGeo, new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
    road.receiveShadow = true;
    group.add(road);

    // --- 中心虚线 ---
    const dashGeo = new THREE.PlaneGeometry(0.35, 3);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    const dashStep = 14;
    const dashCount = Math.floor(n / dashStep);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < dashCount; i++) {
      const k = (i * dashStep) % n, p = s.pts[k], tan = s.tans[k];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tan.x, tan.z));
      v3.set(p.x, 0.05, p.z); sc.set(1, 1, 1);
      m4.compose(v3, q, sc);
      dashes.setMatrixAt(i, m4);
    }
    dashes.instanceMatrix.needsUpdate = true;
    group.add(dashes);

    // --- 两侧"铜墙铁壁" ---
    const step = 5;
    const segCount = Math.floor(n / step);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.75, roughness: 0.35 });
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, segCount * 2);
    let wi = 0;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < segCount; i++) {
        const k = (i * step) % n, k2 = ((i + 1) * step) % n;
        const p = s.pts[k], p2 = s.pts[k2], tan = s.tans[k];
        const nx = -tan.z, nz = tan.x;
        const sgn = side === 0 ? 1 : -1;
        const cx = (p.x + p2.x) / 2 + nx * HALF_W * sgn;
        const cz = (p.z + p2.z) / 2 + nz * HALF_W * sgn;
        const len = Math.hypot(p2.x - p.x, p2.z - p.z) * 1.08;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tan.x, tan.z));
        v3.set(cx, WALL_H / 2, cz); sc.set(0.7, WALL_H, len);
        m4.compose(v3, q, sc);
        walls.setMatrixAt(wi++, m4);
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    walls.castShadow = true;
    group.add(walls);

    // --- 钉子（墙内侧的钢刺） ---
    const spikeStep = 10;
    const spikeCount = Math.floor(n / spikeStep) * 2;
    const spikeGeo = new THREE.ConeGeometry(0.28, 1.1, 6);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc9d1d9, metalness: 0.9, roughness: 0.25 });
    const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, spikeCount);
    let si = 0;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < Math.floor(n / spikeStep); i++) {
        const k = (i * spikeStep) % n, p = s.pts[k], tan = s.tans[k];
        const nx = -tan.z, nz = tan.x;
        const sgn = side === 0 ? 1 : -1;
        // 钉子横着指向赛道内侧
        const px = p.x + nx * (HALF_W - 0.55) * sgn;
        const pz = p.z + nz * (HALF_W - 0.55) * sgn;
        const ang = Math.atan2(-nx * sgn, -nz * sgn);
        const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
        const rot2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        q.copy(rot2).multiply(rot);
        v3.set(px, 0.85, pz); sc.set(1, 1, 1);
        m4.compose(v3, q, sc);
        spikes.setMatrixAt(si++, m4);
      }
    }
    spikes.instanceMatrix.needsUpdate = true;
    group.add(spikes);

    // --- 起跑 / 终点线（画在长直道开头） ---
    const sIdx = Math.round(START_LINE_T * s.n) % n;
    const startP = s.pts[sIdx], startT = s.tans[sIdx];
    const lineGeo = new THREE.PlaneGeometry(HALF_W * 2, 2.4);
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 16;
    const c2d = canvas.getContext('2d');
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 8; j++) {
        c2d.fillStyle = ((i + j) % 2) ? '#ffffff' : '#1a1a1a';
        c2d.fillRect(i * 8, j * 2, 8, 2);
      }
    }
    const lineTex = new THREE.CanvasTexture(canvas);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ map: lineTex }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(startT.x, startT.z);
    line.position.set(startP.x, 0.06, startP.z);
    group.add(line);

    scene.add(group);
    return { group, wallHeight: WALL_H };
  }

  return {
    CONTROL, HALF_W, WALL_H, SAMPLES, START_LINE_T,
    init, getSamples, buildSamples,
    nearest, pointAt, tangentAt,
    progressDelta, lapOf, lapFraction,
    build3D
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Track;
