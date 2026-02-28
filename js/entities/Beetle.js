import { BEETLE_CONFIG, BEETLE_VISION } from '../config.js';
import { drawPolygon, getRarityColor, drawRoundedHealthBar } from '../utils.js';
import { darkenColor } from '../utils.js';

/** Beetle mob: hostile enemy that chases the player when in vision. Uses BEETLE_CONFIG for stats. */
export class Beetle {
  constructor(x, y, rarity, natural = false) {
    const config = BEETLE_CONFIG[rarity];
    this.x = x;
    this.y = y;
    this.rarity = rarity;
    this.mobType = 'beetle';
    this.natural = natural;
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.damage = config.damage;
    this.size = config.size;
    /** Oval hitbox matching body: semi-axes in world units (from body rect 25.5×19.5 in 64 viewBox). */
    this.semiMajor = this.size * (25.5 / 64);
    this.semiMinor = this.size * (19.5 / 64);
    /** @deprecated Use ellipse overlap methods instead. Kept for wall collision margin. */
    this.collisionRadius = Math.max(this.semiMajor, this.semiMinor);
    this.weight = config.weight ?? 1;
    this.vision = config.vision ?? BEETLE_VISION;
    this.vx = 0;
    this.vy = 0;
    /** Facing direction (radians) for drawing; updated when chasing so beetle faces the player. */
    this.facingAngle = 0;
    /** True when player is in vision (used for pincer animation). */
    this.playerInVision = false;
    /** Phase for pincer open/close animation (radians), advances when playerInVision. */
    this.pincerPhase = 0;
    /** Idle state when no player in vision: 'rotate' | 'wait_after_rotate' | 'move' | 'wait_after_move'. */
    this.idlePhase = 'rotate';
    this.idleTimer = 0;
    this.idleTargetAngle = Math.random() * Math.PI * 2;
    this.idleMoveRemaining = 0;
  }

  /** Radius of the oval hitbox in a given direction (angle in radians, in beetle-local space: 0 = along semiMajor). */
  ellipseRadiusInDirection(localAngle) {
    const a = this.semiMajor;
    const b = this.semiMinor;
    const c = Math.cos(localAngle);
    const s = Math.sin(localAngle);
    return (a * b) / Math.sqrt((b * c) * (b * c) + (a * s) * (a * s));
  }

  /** True if a circle at (ox, oy) with radius r overlaps this beetle's oval hitbox. */
  ellipseOverlapsCircle(ox, oy, r) {
    const dx = ox - this.x;
    const dy = oy - this.y;
    const cos = Math.cos(-this.facingAngle);
    const sin = Math.sin(-this.facingAngle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const a = this.semiMajor + r;
    const b = this.semiMinor + r;
    return (localX / a) * (localX / a) + (localY / b) * (localY / b) <= 1;
  }

  /** Overlap amount for push resolution: other circle at (ox, oy) with radius otherRadius. Returns 0 if no overlap. */
  getEllipseOverlap(ox, oy, otherRadius) {
    const d = Math.hypot(ox - this.x, oy - this.y);
    const localAngle = Math.atan2(oy - this.y, ox - this.x) - this.facingAngle;
    const rBeetle = this.ellipseRadiusInDirection(localAngle);
    const overlap = otherRadius + rBeetle - d;
    return overlap > 0 ? overlap : 0;
  }

  /**
   * Beetle-only update: chase the player when in vision; otherwise idle (rotate, wait, move, wait, repeat).
   * Applies velocity from bullet impacts first, then either chase or idle.
   */
  update(dt, game) {
    const dtSec = dt / 1000;
    const friction = 0.992;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(friction, dt);
    this.vy *= Math.pow(friction, dt);

    const player = game?.player;
    const inVision = player && !player.dead && player.adminMode !== true && this.vision > 0 &&
      (() => {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.hypot(dx, dy);
        return dist <= this.vision && dist >= 1e-6;
      })();

    if (inVision) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.hypot(dx, dy);
      this.playerInVision = true;
      this.pincerPhase += dt * 0.003;
      const speed = 120;
      const move = speed * dtSec;
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
      this.facingAngle = Math.atan2(dy, dx);
      return;
    }

    this.playerInVision = false;

    // Idle: rotate to random angle (slow) → wait 1–2s → move forward 30–60% of base distance → wait 1–2s → repeat
    const IDLE_ROTATE_SPEED = 0.5; // radians per second
    const IDLE_MOVE_BASE = 50;
    const IDLE_MOVE_MIN = 0.3;
    const IDLE_MOVE_MAX = 0.6;
    const IDLE_SPEED = 40; // world units per second when moving forward in idle

    if (this.idlePhase === 'rotate') {
      let diff = this.idleTargetAngle - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = IDLE_ROTATE_SPEED * dtSec;
      if (Math.abs(diff) <= maxTurn) {
        this.facingAngle = this.idleTargetAngle;
        this.idlePhase = 'wait_after_rotate';
        this.idleTimer = 1000 + Math.random() * 1000;
      } else {
        this.facingAngle += Math.sign(diff) * maxTurn;
      }
      return;
    }

    if (this.idlePhase === 'wait_after_rotate') {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idlePhase = 'move';
        const pct = IDLE_MOVE_MIN + Math.random() * (IDLE_MOVE_MAX - IDLE_MOVE_MIN);
        this.idleMoveRemaining = IDLE_MOVE_BASE * pct;
      }
      return;
    }

    if (this.idlePhase === 'move') {
      const step = Math.min(this.idleMoveRemaining, IDLE_SPEED * dtSec);
      this.x += Math.cos(this.facingAngle) * step;
      this.y += Math.sin(this.facingAngle) * step;
      this.idleMoveRemaining -= step;
      if (this.idleMoveRemaining <= 0) {
        this.idlePhase = 'wait_after_move';
        this.idleTimer = 1000 + Math.random() * 1000;
      }
      return;
    }

    if (this.idlePhase === 'wait_after_move') {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idlePhase = 'rotate';
        this.idleTargetAngle = Math.random() * Math.PI * 2;
      }
    }
  }

  draw(ctx, scale, cam, playerLevel, beetleImage, beetleBodyImage, beetlePincerLeftImage, beetlePincerRightImage) {
    const s = this.size;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const halfW = cw / (2 * scale) + 50;
    const halfH = ch / (2 * scale) + 50;

    if (
      this.x < cam.x - halfW || this.x > cam.x + halfW ||
      this.y < cam.y - halfH || this.y > cam.y + halfH
    ) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facingAngle);

    const color = getRarityColor(this.rarity);
    const useSplitImages = beetleBodyImage?.complete && beetleBodyImage?.naturalWidth > 0 &&
      beetlePincerLeftImage?.complete && beetlePincerLeftImage?.naturalWidth > 0 &&
      beetlePincerRightImage?.complete && beetlePincerRightImage?.naturalWidth > 0;

    if (useSplitImages) {
      const pincerAngleDeg = 20 * Math.sin(this.pincerPhase);
      const pincerAngleRad = (pincerAngleDeg * Math.PI) / 180;
      // Attachment at the other end of the body. Backwards 10% more: 0.331 - 0.1 = 0.231*s.
      const hingeX = 0.231 * s;
      const hingeLeftX = hingeX;
      const hingeLeftY = -0.225 * s;
      const hingeRightX = hingeX;
      const hingeRightY = 0.0875 * s;
      const pincerW = 0.84 * s;
      const pincerH = 0.4 * s;
      const pivotFracX = 3 / 21;
      const pivotLeftFracY = 5 / 10;
      const pivotRightFracY = 2 / 10;
      ctx.save();
      ctx.translate(hingeLeftX, hingeLeftY);
      ctx.rotate(pincerAngleRad);
      ctx.drawImage(beetlePincerLeftImage, -pivotFracX * pincerW, -pivotLeftFracY * pincerH, pincerW, pincerH);
      ctx.restore();
      ctx.save();
      ctx.translate(hingeRightX, hingeRightY);
      ctx.rotate(-pincerAngleRad);
      ctx.drawImage(beetlePincerRightImage, -pivotFracX * pincerW, -pivotRightFracY * pincerH, pincerW, pincerH);
      ctx.restore();
      ctx.drawImage(beetleBodyImage, -s, -s, s * 2, s * 2);
    } else if (beetleImage && beetleImage.complete && beetleImage.naturalWidth > 0) {
      ctx.drawImage(beetleImage, -s, -s, s * 2, s * 2);
    } else {
      ctx.fillStyle = color;
      ctx.strokeStyle = darkenColor(color, 60);
      ctx.lineWidth = 2.5 / scale;
      drawPolygon(ctx, 0, 0, 8, s, 0);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    const showNameAndRarity = this.rarity !== 'common' && this.rarity !== 'uncommon';
    if (!showNameAndRarity) {
      const barW = s * 2;
      const barH = Math.max(3, 5 / scale);
      const barY = this.y + s + 6;
      const barX = this.x - barW / 2;
      drawRoundedHealthBar(ctx, barX, barY, barW, barH, this.hp / this.maxHp, {
        fillColor: '#81c784',
        outlineColor: 'rgba(0,0,0,0.8)',
        lineWidth: Math.max(1, 2.5 / scale),
      });
    } else {
      const barW = s * 2;
      const barH = Math.max(3, 5 / scale);
      const fontSize = Math.max(14, 16 / scale);
      const nameGap = 6;
      const nameY = this.y + s + nameGap;
      const barY = nameY + fontSize + 2;
      const barX = this.x - barW / 2;
      const shopFont = `700 ${fontSize}px Rajdhani, sans-serif`;
      const shopOutlineWidth = 2;
      const letterSpacing = 1;
      const shapeName = 'Beetle';
      ctx.font = shopFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = shopOutlineWidth;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      let x = barX;
      for (const char of shapeName) {
        ctx.strokeText(char, x, nameY);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(char, x, nameY);
        x += ctx.measureText(char).width + letterSpacing;
      }
      drawRoundedHealthBar(ctx, barX, barY, barW, barH, this.hp / this.maxHp, {
        fillColor: '#81c784',
        outlineColor: 'rgba(0,0,0,0.8)',
        lineWidth: Math.max(1, 2.5 / scale),
      });
      const rarityLabel = this.rarity.charAt(0).toUpperCase() + this.rarity.slice(1);
      const textY = barY + barH + 2;
      const textX = barX + barW;
      ctx.font = shopFont;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = shopOutlineWidth;
      let rx = textX;
      for (let i = rarityLabel.length - 1; i >= 0; i--) {
        const char = rarityLabel[i];
        rx -= ctx.measureText(char).width;
        ctx.textAlign = 'left';
        ctx.strokeText(char, rx, textY);
        ctx.fillStyle = getRarityColor(this.rarity);
        ctx.fillText(char, rx, textY);
        rx -= letterSpacing;
      }
      ctx.textAlign = 'right';
    }
  }
}
