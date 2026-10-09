/* ============================================================
 * player.js — 骑士角色
 * 移动规则（FATFIGHT 版，硬性约束）：
 *   只有 A / D 能产生水平位移 —— 按住 D 右移、按住 A 左移；
 *   松开按键 / 同时按下 A+D / 其它任何情况（含受击）一律静止。
 *   无惯性、无滑行、无自动跑、无击退位移。
 * 跳跃：W = 地面起跳（第一级）；空格 = 地面起跳 + 空中二段跳（更高）
 * 下蹲：S（可长按保持），空中不可蹲
 * 血量系统：基础 5 点，受击 -1，无敌帧 1.5s；药水回血（不超上限），
 *   红心回血 +1 或 +2 且可超过上限，最高 OVERHEAL_CAP
 * ============================================================ */
'use strict';

// 空格是否也能在地面触发第一级跳（true = 空格连按即可完成"跳 + 二段跳"）
const SPACE_CAN_GROUND_JUMP = true;
// 水平移动速度（px/s）：只有 A/D 生效，其它情况恒为 0（慢节奏，便于精调站位）
const MOVE_VX = 280;
// 红心超量回血的硬上限（基础 5 血，最多再叠 5 点）
const OVERHEAL_CAP = 10;

class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0;            // 逻辑坐标（初始屏幕左 ~30%，可自由移动）
    this.y = 0;            // 脚底 Y
    this.w = 26;           // 碰撞盒宽
    this.h = 44;           // 碰撞盒高（站立）
    this.slideH = 22;      // 下蹲高度
    this.vx = 0;           // 水平速度（相对屏幕）
    this.vy = 0;
    this.onGround = true;
    this.jumps = 0;        // 已用跳跃次数
    this.maxJumps = 2;     // 二段跳
    this.sliding = false;
    this.slideTimer = 0;
    this.animT = 0;
    this.faceLeft = false;
    this.invincible = 0;   // 无敌时间（受击后 1.5s）
    this.shield = false;   // 护盾（免费挡 1 次）
    this.magnet = 0;       // 磁铁时间
    this.scoreMult = 1;    // 双倍积分
    this.multT = 0;
    this.hp = 5;           // 血量
    this.maxHp = 5;
    this.dead = false;
    this.alive = true;
    this.deathT = 0;
    this.deathVy = 0;
    this.deathRot = 0;
    this.squash = 0;       // 落地挤压动画
    this.lastJumpKind = 0; // 0 无 / 1 一级跳 / 2 二段跳（供 UI 与测试读取）
  }

  get hitbox() {
    const w = this.sliding ? this.w + 12 : this.w;
    const h = this.sliding ? this.slideH : this.h;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  update(dt, input, groundY, gravity, bounds) {
    if (this.dead) {
      // 死亡飞出动画
      this.deathT += dt;
      this.vy += gravity * 0.7 * dt;
      this.y += this.vy * dt;
      this.deathRot += dt * 6;
      return;
    }
    if (this.invincible > 0) this.invincible -= dt;
    if (this.magnet > 0) this.magnet -= dt;
    if (this.multT > 0) { this.multT -= dt; if (this.multT <= 0) this.scoreMult = 1; }

    // ---- 水平移动：严格 A/D ----
    // 只有按住 D（右）/ A（左）才移动；松开、同时按 A+D、其它任何情况 → vx = 0（静止）
    if (input.right && !input.left) this.vx = MOVE_VX;
    else if (input.left && !input.right) this.vx = -MOVE_VX;
    else this.vx = 0;
    this.x += this.vx * dt;
    // 边界限制（屏幕内）
    if (bounds) {
      if (this.x < bounds[0]) { this.x = bounds[0]; this.vx = 0; }
      if (this.x > bounds[1]) { this.x = bounds[1]; this.vx = 0; }
    }
    if (this.vx < 0) this.faceLeft = true;
    else if (this.vx > 0) this.faceLeft = false;

    // ---- 跳跃 ----
    // W/↑   ：地面起跳（第一级）
    // 空格  ：地面起跳（第一级）+ 空中二段跳（第二级，更高）
    let jumpedThisFrame = false;
    const canFirstJump = this.onGround && !this.sliding;
    const doFirstJump = () => {
      this.vy = -620;
      this.onGround = false;
      this.jumps = 1;
      this.sliding = false;
      this.lastJumpKind = 1;
      jumpedThisFrame = true;
      Sound.sfx.jump();
      Game.effects.dust(this.x, this.y, 5);
    };

    if (input.jump && canFirstJump) {
      doFirstJump();
    } else if (input.doubleJump && SPACE_CAN_GROUND_JUMP && canFirstJump) {
      doFirstJump(); // 空格在地面 = 第一级跳（再按一次即二段跳）
    }
    // 二段跳：空中按空格（同帧内已起跳则忽略，避免触摸一次点击连吃两级）
    if (input.doubleJump && !jumpedThisFrame && !this.onGround &&
        this.jumps >= 1 && this.jumps < this.maxJumps && !this.sliding) {
      this.vy = -760; // 二段跳更高
      this.jumps = 2;
      this.lastJumpKind = 2;
      Sound.sfx.doubleJump();
      Game.effects.doubleJump(this.x, this.y - this.h);
    }

    // ---- 下蹲（S）----
    if (input.slide && !this.sliding && this.onGround) {
      this.sliding = true;
      this.slideTimer = 0.5;
      Sound.sfx.slide();
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 && !input.slideHeld) this.sliding = false;
    }
    if (!this.onGround && this.sliding) this.sliding = false; // 空中不可蹲

    // ---- 重力 ----
    if (!this.onGround) {
      this.vy += gravity * dt;
      if (this.vy > 900) this.vy = 900;
      this.y += this.vy * dt;
      if (this.y >= groundY) {
        this.y = groundY;
        this.onGround = true;
        this.jumps = 0;
        this.lastJumpKind = 0;
        this.vy = 0;
        this.squash = 1;
        Game.effects.dust(this.x, this.y, 3);
      }
    }

    // 动画
    this.animT += dt * (this.onGround ? 11 : 4);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 4);
  }

  // 受击：返回 'shield'（护盾挡）/ 'hit'（扣血）/ 'died'（死亡）/ 'block'（无敌中）
  damage() {
    if (this.dead || this.invincible > 0) return 'block';
    if (this.shield) {
      this.shield = false;
      this.invincible = 1.2;
      return 'shield';
    }
    this.hp -= 1;
    if (this.hp <= 0) {
      this.dead = true;
      this.alive = false;
      this.deathVy = -420;
      this.vy = this.deathVy;
      Sound.sfx.death();
      return 'died';
    }
    this.invincible = 1.5; // 无敌帧
    Sound.sfx.hit();
    return 'hit';
  }

  // 回血：allowOver = true 时可超过 maxHp（红心专用），最高 OVERHEAL_CAP
  heal(n, allowOver) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(allowOver ? OVERHEAL_CAP : this.maxHp, this.hp + n);
    return this.hp - before;
  }

  hurtVisual() {
    // 受击闪烁
    if (this.invincible > 0) return Math.floor(this.invincible * 20) % 2 === 0;
    return false;
  }

  draw(ctx, sprites, scale) {
    const S = sprites;
    const useAsset = !!(S.characters && S.characters.playerRun);
    // 素材帧：Kenney 绿骑士（24px，缩放 1.85≈44px）；兜底：程序化像素
    const assetScale = 1.85;
    const effScale = useAsset ? assetScale : scale;

    ctx.save();
    ctx.translate(this.x, this.y);

    // 朝向（移动时翻转）
    if (this.faceLeft) ctx.scale(-1, 1);

    if (this.squash > 0) {
      ctx.scale(1 + this.squash * 0.18, 1 - this.squash * 0.22);
    }

    let img;
    if (this.dead) {
      ctx.rotate(this.deathRot);
      img = useAsset ? S.characters.playerJump : S.knight.jump;
    } else if (this.sliding) {
      if (useAsset) {
        img = S.characters.playerSlideBase;
        ctx.scale(1.4, 0.62); // 下蹲压扁
      } else {
        img = S.knight.slide;
      }
    } else if (!this.onGround) {
      img = useAsset
        ? (this.vy < 0 ? S.characters.playerJump : S.characters.playerRun[3])
        : (this.vy < 0 ? S.knight.jump : S.knight.jumpM);
    } else {
      img = useAsset
        ? S.characters.playerRun[Math.floor(this.animT) % 4]
        : [S.knight.runA, S.knight.runB, S.knight.runAM, S.knight.runBM][Math.floor(this.animT) % 4];
    }

    if (this.invincible > 0 && this.hurtVisual() && !this.shield) {
      ctx.globalAlpha = 0.45;
    }
    // 护盾光环
    if (this.shield) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(performance.now() / 90);
      ctx.strokeStyle = '#6fe8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -this.h / 2, this.h * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const dw = img.width * effScale, dh = img.height * effScale;
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }
}
