/* ============================================================
 * vehicle.js — 车辆：物理、碰撞、护盾、圈数进度、AI 驾驶
 * 全部为纯逻辑（不依赖 THREE），可在 node 中单测；3D 模型由 game.js 负责。
 * 规则（按需求）：
 *   - 每辆车都有防护盾，可承受撞"钉子铜墙铁壁" 3 次（第 1/2/3 次安然无恙）
 *   - 3 次之后护罩消失，第 4 次撞墙 → 回到起始位置（本圈重跑），护盾恢复
 *   - 车与车可以互相碰撞
 * ============================================================ */
'use strict';

const VehicleConst = {
  MAX_SPEED: 40,        // 最高前进速度（米/秒）
  MAX_REVERSE: 12,      // 最高倒车速度
  ACCEL: 30,            // 加速度
  BRAKE: 55,            // 刹车减速度
  DRAG: 9,              // 松油门时的自然阻力
  TURN_RATE: 2.6,       // 满舵转向角速度（弧度/秒）
  CAR_R: 1.7,           // 碰撞半径
  CAR_HALF_W: 1.1,      // 车半宽（用于撞墙判定）
  SHIELD_MAX: 3,        // 护盾可承受撞墙次数
  INVULN: 1.1,          // 撞墙后的无敌时间（秒）
  PUSH_DECAY: 4.0       // 碰撞冲量衰减
};

class Vehicle {
  constructor(opts) {
    const C = VehicleConst;
    this.name = opts.name || 'CAR';
    this.color = opts.color || 0xff5c7a;
    this.isPlayer = !!opts.isPlayer;
    this.startT = opts.startT || 0;      // 起跑格所在的赛道参数
    this.lateral = opts.lateral || 0;    // 起跑格左右偏移

    this.x = 0; this.z = 0;
    this.heading = 0;                     // 弧度：0 = +Z 方向
    this.speed = 0;                       // 沿 heading 的速度（可为负=倒车）
    this.pushVx = 0; this.pushVz = 0;     // 碰撞冲量（附加位移速度）

    this.shield = C.SHIELD_MAX;           // 剩余护盾层数
    this.hits = 0;                        // 累计撞墙次数
    this.invuln = 0;                      // 无敌倒计时
    this.respawnFlash = 0;                // 回起点后的提示计时

    this.progress = 0;                    // 累计圈进度（1.0 = 跑完一圈）
    this.lastT = 0;
    this.hint = 0;                        // 最近点索引提示
    this.finished = false;
    this.finishTime = 0;
    this.rank = 1;
    this.lastWallEvent = null;            // 'shield' | 'respawn'

    // AI 个性
    this.aiSkill = opts.aiSkill !== undefined ? opts.aiSkill : 0.85;
    this.aiWander = Math.random() * Math.PI * 2;
  }

  // 放到赛道上的某个位置（起跑格）
  placeOnTrack(track, t, lateral) {
    const p = track.pointAt(t), tan = track.tangentAt(t);
    const nx = -tan.z, nz = tan.x;
    this.x = p.x + nx * (lateral || 0);
    this.z = p.z + nz * (lateral || 0);
    this.heading = Math.atan2(tan.x, tan.z);
    this.speed = 0;
    this.pushVx = this.pushVz = 0;
    const near = track.nearest(this.x, this.z, null);
    this.hint = near.idx;
    this.lastT = near.t;
  }

  resetToStart(track) {
    // 护盾耗尽后再撞墙 → 回到起始位置，本圈重跑，护盾恢复
    this.progress = Math.floor(this.progress);   // 退到本圈开头
    this.placeOnTrack(track, this.startT, this.lateral);
    this.speed = 0;
    this.shield = VehicleConst.SHIELD_MAX;
    this.invuln = VehicleConst.INVULN;
    this.respawnFlash = 1.6;
    this.lastWallEvent = 'respawn';
  }

  // input: { throttle: -1..1, steer: -1..1, brake: bool }
  update(dt, input, track) {
    const C = VehicleConst;
    this.lastWallEvent = null;
    if (this.finished) { this.speed *= (1 - Math.min(1, dt * 2)); }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.respawnFlash > 0) this.respawnFlash -= dt;

    const thr = input.throttle || 0;
    const steer = input.steer || 0;

    // --- 纵向 ---
    if (thr > 0) {
      this.speed += C.ACCEL * thr * dt;
      if (this.speed > C.MAX_SPEED * Math.max(0.35, thr)) this.speed = C.MAX_SPEED * Math.max(0.35, thr);
    } else if (thr < 0) {
      this.speed += C.ACCEL * thr * dt;
      if (this.speed < -C.MAX_REVERSE) this.speed = -C.MAX_REVERSE;
    } else if (input.brake) {
      const dec = C.BRAKE * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - dec);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + dec);
    } else {
      const dec = C.DRAG * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - dec);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + dec);
    }

    // --- 转向（速度越低转向越弱；倒车时方向相反） ---
    const spd = Math.abs(this.speed);
    const grip = Math.min(1, Math.max(0.25, spd / 12));
    const dirSign = this.speed >= 0 ? 1 : -1;
    this.heading += steer * C.TURN_RATE * grip * dirSign * dt;
    if (this.heading > Math.PI) this.heading -= Math.PI * 2;
    if (this.heading < -Math.PI) this.heading += Math.PI * 2;

    // --- 位移（含碰撞冲量） ---
    const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading);
    this.x += dirX * this.speed * dt + this.pushVx * dt;
    this.z += dirZ * this.speed * dt + this.pushVz * dt;
    const decay = Math.max(0, 1 - C.PUSH_DECAY * dt);
    this.pushVx *= decay; this.pushVz *= decay;

    // --- 赛道进度 / 圈数 ---
    const near = track.nearest(this.x, this.z, this.hint);
    this.hint = near.idx;
    this.progress += track.progressDelta(this.lastT, near.t);
    this.lastT = near.t;
    this.distToCenter = near.dist;

    // --- 撞墙 ---
    const limit = track.HALF_W - C.CAR_HALF_W;
    if (near.dist > limit) {
      this._hitWall(track, near, limit);
    }
  }

  _hitWall(track, near, limit) {
    const C = VehicleConst;
    // 推回赛道内
    const p = track.getSamples().pts[near.idx];
    const dx = this.x - p.x, dz = this.z - p.z;
    const L = Math.hypot(dx, dz) || 1;
    this.x = p.x + (dx / L) * limit;
    this.z = p.z + (dz / L) * limit;
    // 速度损失 + 反弹
    this.speed *= -0.25;
    this.pushVx = (dx / L) * 6; this.pushVz = (dz / L) * 6;

    if (this.invuln > 0) return;
    this.invuln = C.INVULN;
    this.hits++;
    if (this.shield > 0) {
      this.shield--;
      this.lastWallEvent = 'shield';
    } else {
      this.resetToStart(track);
    }
  }

  // ---------- AI 驾驶 ----------
  aiControl(track, others, dt) {
    if (this.finished) return { throttle: 0, steer: 0, brake: true };
    const s = track.getSamples();
    const n = s.n;
    // 目标点：赛道前方一段距离（速度越快看得越远）
    const look = Math.round(n * (0.012 + Math.abs(this.speed) / VehicleConst.MAX_SPEED * 0.02));
    const ti = (this.hint + Math.max(4, look)) % n;
    const tp = s.pts[ti];

    // 期望方向
    let want = Math.atan2(tp.x - this.x, tp.z - this.z);

    // 避让：前方近距离有车就侧移
    for (const o of others) {
      if (o === this) continue;
      const dx = o.x - this.x, dz = o.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 7 && d > 0.1) {
        const fwd = Math.sin(this.heading) * dx / d + Math.cos(this.heading) * dz / d;
        if (fwd > 0.5) {
          const side = Math.sin(this.heading) * (dz / d) - Math.cos(this.heading) * (dx / d);
          want += (side > 0 ? -0.35 : 0.35);      // 往旁边让一点
        }
      }
    }

    // 转向：朝目标方向的夹角
    let diff = want - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, diff * 2.2));

    // 油门：弯道（转角大）减速，直道全速；叠加个性
    const curve = Math.abs(diff);
    let target = VehicleConst.MAX_SPEED * this.aiSkill * (1 - Math.min(0.55, curve * 0.85));
    if (this.speed < target) return { throttle: 1, steer, brake: false };
    if (this.speed > target + 6) return { throttle: 0, steer, brake: true };
    return { throttle: 0.35, steer, brake: false };
  }
}

// ---------- 车与车碰撞（等质量弹性 + 分离） ----------
function resolveCollision(a, b) {
  const C = VehicleConst;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const minD = C.CAR_R * 2;
  if (d >= minD || d < 0.0001) return false;

  const nx = dx / d, nz = dz / d;
  const overlap = minD - d;
  a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
  b.x += nx * overlap / 2; b.z += nz * overlap / 2;

  const avx = Math.sin(a.heading) * a.speed, avz = Math.cos(a.heading) * a.speed;
  const bvx = Math.sin(b.heading) * b.speed, bvz = Math.cos(b.heading) * b.speed;
  const closing = (bvx - avx) * nx + (bvz - avz) * nz;
  if (closing < 0) {
    const j = -closing * 0.85;
    a.pushVx -= nx * j; a.pushVz -= nz * j;
    b.pushVx += nx * j; b.pushVz += nz * j;
    a.speed *= 0.82; b.speed *= 0.82;
  }
  return true;
}

// ---------- 排名（按累计进度降序） ----------
function computeRanks(cars) {
  const arr = cars.slice().sort((p, q) => {
    if (p.finished !== q.finished) return p.finished ? -1 : 1;
    if (p.finished && q.finished) return p.finishTime - q.finishTime;
    return q.progress - p.progress;
  });
  arr.forEach((c, i) => { c.rank = i + 1; });
  return arr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vehicle, VehicleConst, resolveCollision, computeRanks };
}
if (typeof window !== 'undefined') { window.Vehicle = Vehicle; window.VehicleConst = VehicleConst; }
