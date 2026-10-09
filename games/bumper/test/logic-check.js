/* ============================================================
 * test/logic-check.js — 脖子碰碰车 核心逻辑单测（node，无需浏览器/THREE）
 * 覆盖：赛道几何与圈数、车辆物理与护盾规则、头部姿态 → 控制映射
 * 运行：node test/logic-check.js
 * ============================================================ */
'use strict';
const path = require('path');
const Track = require(path.join(__dirname, '..', 'js', 'track.js'));
const { Vehicle, VehicleConst, resolveCollision, computeRanks } =
  require(path.join(__dirname, '..', 'js', 'vehicle.js'));
const FaceControl = require(path.join(__dirname, '..', 'js', 'face-control.js'));

let failed = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${extra !== undefined ? ' → ' + extra : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

// ============================================================
console.log('[赛道] 几何与圈数');
Track.init();
const s = Track.getSamples();
{
  assert(`采样点生成（${s.n} 个）`, s.n === Track.SAMPLES);
  const d = Math.hypot(s.pts[0].x - s.pts[s.n - 1].x, s.pts[0].z - s.pts[s.n - 1].z);
  assert(`赛道闭合（首尾间距 ${d.toFixed(2)}m < 6m）`, d < 6);

  // 中心线上的点，到中心线距离应≈0
  const p = s.pts[100];
  const n1 = Track.nearest(p.x, p.z, null);
  assert(`中心线上的点距离≈0（${n1.dist.toFixed(3)}m）`, n1.dist < 0.6);

  // 赛道外的点距离应大于半宽
  const tan = s.tans[100], nx = -tan.z, nz = tan.x;
  const far = Track.nearest(p.x + nx * 20, p.z + nz * 20, null);
  assert(`赛道外 20m 的点距离 > 半宽（${far.dist.toFixed(1)}m）`, far.dist > Track.HALF_W);

  // 进度增量：跨越 0/1 边界
  assert(`进度增量 0.98→0.02 = +0.04`, near(Track.progressDelta(0.98, 0.02), 0.04, 1e-9));
  assert(`进度增量 0.02→0.98 = -0.04（倒退）`, near(Track.progressDelta(0.02, 0.98), -0.04, 1e-9));
  assert(`进度增量 0.40→0.45 = +0.05`, near(Track.progressDelta(0.40, 0.45), 0.05, 1e-9));

  // 圈数
  assert(`progress 0.5 → 第 1 圈`, Track.lapOf(0.5) === 1);
  assert(`progress 1.2 → 第 2 圈`, Track.lapOf(1.2) === 2);
  assert(`progress 2.9 → 第 3 圈`, Track.lapOf(2.9) === 3);
  assert(`progress -0.01（起跑格）→ 第 1 圈`, Track.lapOf(-0.01) === 1);

  // 直道 vs 弯道占比（需求：直道居多）
  let straight = 0, curved = 0;
  for (let i = 0; i < s.n; i++) {
    const a = s.tans[i], b = s.tans[(i + 1) % s.n];
    const cross = a.x * b.z - a.z * b.x;             // 切线转角（正弦）
    const seg = Math.hypot(s.pts[(i + 1) % s.n].x - s.pts[i].x, s.pts[(i + 1) % s.n].z - s.pts[i].z);
    if (Math.abs(cross) < 0.012) straight += seg; else curved += seg;
  }
  const ratio = straight / (straight + curved);
  assert(`直道占比 ${(ratio * 100).toFixed(0)}% > 50%（直道 ${straight.toFixed(0)}m / 弯道 ${curved.toFixed(0)}m）`,
    ratio > 0.5);
}

// ============================================================
console.log('\n[车辆] 物理与控制');
function mkCar(opts) {
  // 起跑格位于长直道上（与游戏内一致），直行不会立刻撞弯
  const c = new Vehicle(Object.assign({
    name: 'T', startT: Track.START_LINE_T - 0.007, lateral: 0
  }, opts || {}));
  c.placeOnTrack(Track, c.startT, c.lateral);
  return c;
}
{
  // 加速
  const c = mkCar();
  for (let i = 0; i < 120; i++) c.update(1 / 60, { throttle: 1, steer: 0, brake: false }, Track);
  assert(`全油门 2 秒后加速到 ${c.speed.toFixed(1)} m/s（应接近上限 ${VehicleConst.MAX_SPEED}）`,
    c.speed > VehicleConst.MAX_SPEED * 0.85);

  // 刹车
  const c2 = mkCar();
  for (let i = 0; i < 60; i++) c2.update(1 / 60, { throttle: 1, steer: 0, brake: false }, Track);
  const before = c2.speed;
  for (let i = 0; i < 60; i++) c2.update(1 / 60, { throttle: 0, steer: 0, brake: true }, Track);
  assert(`刹车生效（${before.toFixed(1)} → ${c2.speed.toFixed(1)} m/s）`, c2.speed < 1);

  // 后退
  const c3 = mkCar();
  for (let i = 0; i < 90; i++) c3.update(1 / 60, { throttle: -1, steer: 0, brake: false }, Track);
  assert(`后退生效（速度 ${c3.speed.toFixed(1)} m/s，应为负）`, c3.speed < -3);

  // 转向
  const c4 = mkCar();
  for (let i = 0; i < 60; i++) c4.update(1 / 60, { throttle: 1, steer: 1, brake: false }, Track);
  assert(`右转使朝向角增大（heading=${c4.heading.toFixed(2)}）`, c4.heading > 0.3);
  const c5 = mkCar();
  for (let i = 0; i < 60; i++) c5.update(1 / 60, { throttle: 1, steer: -1, brake: false }, Track);
  assert(`左转使朝向角减小（heading=${c5.heading.toFixed(2)}）`, c5.heading < -0.3);
}

// ============================================================
console.log('\n[护盾] 撞墙 3 次安然无恙，第 4 次回起点');
{
  const c = mkCar();
  // 强行把车推到赛道外，制造撞墙
  function slam(car) {
    const p = Track.pointAt(car.lastT), tan = Track.tangentAt(car.lastT);
    const nx = -tan.z, nz = tan.x;
    car.x = p.x + nx * (Track.HALF_W + 3);
    car.z = p.z + nz * (Track.HALF_W + 3);
    car.invuln = 0;
    car.update(1 / 60, { throttle: 0, steer: 0, brake: false }, Track);
    return car.lastWallEvent;
  }

  assert(`初始护盾 ${VehicleConst.SHIELD_MAX} 层`, c.shield === 3);
  const e1 = slam(c);
  assert(`第 1 次撞墙：消耗护盾（剩 ${c.shield}）`, e1 === 'shield' && c.shield === 2);
  const e2 = slam(c);
  assert(`第 2 次撞墙：消耗护盾（剩 ${c.shield}）`, e2 === 'shield' && c.shield === 1);
  const e3 = slam(c);
  assert(`第 3 次撞墙：消耗护盾（剩 ${c.shield}，护罩消失）`, e3 === 'shield' && c.shield === 0);

  // 先攒一点进度，再撞第 4 次
  c.progress = 1.4;
  const e4 = slam(c);
  const startP = Track.pointAt(c.startT);
  const distToStart = Math.hypot(c.x - startP.x, c.z - startP.z);
  assert(`第 4 次撞墙：回到起始位置（事件=${e4}）`, e4 === 'respawn');
  assert(`回起点后护盾恢复 ${c.shield} 层`, c.shield === VehicleConst.SHIELD_MAX);
  assert(`位置已回到起点附近（距离 ${distToStart.toFixed(2)}m）`, distToStart < 6);
  assert(`本圈重跑：进度退到本圈开头（progress=${c.progress.toFixed(2)}）`, Math.abs(c.progress - 1) < 1e-9);
}

// ============================================================
console.log('\n[比赛] 圈数进度与排名');
{
  // 沿赛道跑一整圈，progress 应增加约 1
  const c = mkCar();
  c.progress = 0;
  const startProg = c.progress;
  for (let i = 0; i < 4000; i++) {
    const ctrl = c.aiControl(Track, [c], 1 / 60);
    c.update(1 / 60, ctrl, Track);
    if (c.progress >= 1) break;
  }
  assert(`AI 能沿赛道跑完 1 圈（progress=${c.progress.toFixed(2)}）`, c.progress >= 1);
  assert(`AI 跑圈过程中没有被卡在墙外（离中心线 ${c.distToCenter.toFixed(1)}m < ${Track.HALF_W}）`,
    c.distToCenter < Track.HALF_W);

  // 排名
  const a = mkCar(), b = mkCar(), d = mkCar();
  a.progress = 0.5; b.progress = 1.8; d.progress = 0.2;
  const ranked = computeRanks([a, b, d]);
  assert(`排名按累计进度降序（${ranked.map(r => r.progress).join(' > ')}）`,
    ranked[0] === b && ranked[1] === a && ranked[2] === d);
  assert(`排名编号正确（${ranked.map(r => r.rank).join(',')}）`,
    ranked[0].rank === 1 && ranked[1].rank === 2 && ranked[2].rank === 3);

  // 完赛者优先
  const e = mkCar(); e.progress = 0.1; e.finished = true; e.finishTime = 30;
  const f = mkCar(); f.progress = 2.9;
  const r2 = computeRanks([f, e]);
  assert(`已完赛的车排在未完赛之前`, r2[0] === e);

  // 车车碰撞
  const p = mkCar(), q = mkCar();
  p.x = 0; p.z = 0; q.x = 1.0; q.z = 0;    // 重叠（半径 1.7 ×2 = 3.4）
  const hit = resolveCollision(p, q);
  assert(`重叠车辆发生碰撞并分离（间距 ${Math.hypot(q.x - p.x, q.z - p.z).toFixed(2)}m ≥ ${(VehicleConst.CAR_R * 2).toFixed(1)}）`,
    hit && Math.hypot(q.x - p.x, q.z - p.z) >= VehicleConst.CAR_R * 2 - 1e-6);
}

// ============================================================
console.log('\n[头部姿态] 下巴/转头 → 油门与转向');
{
  // 构造 468 点：只需设置用到的关键点
  function face(noseX, noseY) {
    const lm = [];
    for (let i = 0; i < 468; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 });
    lm[33] = { x: 0.44, y: 0.38, z: 0, visibility: 0.9 };    // 右眼外角
    lm[263] = { x: 0.56, y: 0.38, z: 0, visibility: 0.9 };   // 左眼外角
    lm[1] = { x: noseX, y: noseY, z: 0, visibility: 0.9 };   // 鼻尖
    lm[152] = { x: 0.5, y: 0.62, z: 0, visibility: 0.9 };    // 下巴
    lm[10] = { x: 0.5, y: 0.30, z: 0, visibility: 0.9 };     // 额头
    return lm;
  }
  // 平视：鼻尖在双眼下方约 0.6 个眼距（眼距 0.12）
  const base = FaceControl.computePose(face(0.5, 0.38 + 0.072));
  assert(`平视姿态可计算（pitch=${base.pitch.toFixed(2)}, yaw=${base.yaw.toFixed(2)}）`,
    base && near(base.pitch, 0.6, 0.05) && near(base.yaw, 0, 1e-6));

  const cfg = FaceControl.getConfig();
  const B = { pitch: base.pitch, yaw: base.yaw };

  // 抬头（鼻尖上移 → pitch 变小）
  const up = FaceControl.computePose(face(0.5, 0.38 + 0.02));
  const ctlUp = FaceControl.poseToControl(up.pitch, up.yaw, B, cfg);
  assert(`下巴抬起 → 加速前进（throttle=${ctlUp.throttle.toFixed(2)}）`, ctlUp.throttle > 0.3);

  // 低头（鼻尖下移 → pitch 变大）
  const down = FaceControl.computePose(face(0.5, 0.38 + 0.13));
  const ctlDown = FaceControl.poseToControl(down.pitch, down.yaw, B, cfg);
  assert(`下巴向下 → 后退（throttle=${ctlDown.throttle.toFixed(2)}）`, ctlDown.throttle < -0.3);

  // 中间
  const mid = FaceControl.computePose(face(0.5, 0.38 + 0.072));
  const ctlMid = FaceControl.poseToControl(mid.pitch, mid.yaw, B, cfg);
  assert(`中间位置 → 刹车（brake=${ctlMid.brake}）`, ctlMid.brake === true && ctlMid.throttle === 0);

  // 转头：镜像坐标下，鼻尖 raw x 变小 = 画面向右偏 = 头右转
  const right = FaceControl.computePose(face(0.46, 0.38 + 0.072));
  const ctlRight = FaceControl.poseToControl(right.pitch, right.yaw, B, cfg);
  assert(`头转向右 → 车子右转（steer=${ctlRight.steer.toFixed(2)} > 0）`, ctlRight.steer > 0.2);

  const left = FaceControl.computePose(face(0.54, 0.38 + 0.072));
  const ctlLeft = FaceControl.poseToControl(left.pitch, left.yaw, B, cfg);
  assert(`头转向左 → 车子左转（steer=${ctlLeft.steer.toFixed(2)} < 0）`, ctlLeft.steer < -0.2);

  // 反转开关
  const inv = Object.assign({}, cfg, { invertYaw: true });
  const ctlInv = FaceControl.poseToControl(right.pitch, right.yaw, B, inv);
  assert(`勾选"转向反了"后方向翻转（steer=${ctlInv.steer.toFixed(2)}）`, ctlInv.steer < -0.2);

  // 死区
  const tiny = FaceControl.poseToControl(B.pitch + 0.02, B.yaw + 0.01, B, cfg);
  assert(`死区内不误触发（brake=${tiny.brake}, steer=${tiny.steer}）`, tiny.brake === true && tiny.steer === 0);

  // 未校准时不输出控制
  const noCal = FaceControl.poseToControl(0.3, 0.2, null, cfg);
  assert(`未校准时不出控制（ready=${noCal.ready}）`, noCal.ready === false);
}

if (failed) {
  console.error(`\n❌ ${failed} 项未通过`);
  process.exit(1);
}
console.log('\n✅ 全部通过：赛道几何 / 圈数 / 车辆物理 / 护盾三振规则 / 头部姿态映射');
