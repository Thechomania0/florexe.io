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
    this.vision = BEETLE_VISION;
    this.vx = 0;
    this.vy = 0;
    /** Facing direction (radians) for drawing; updated when chasing so beetle faces the player. */
    this.facingAngle = 0;
    /** True when player is in vision (used for pincer animation). */
    this.playerInVision = false;
    /** Phase for pincer open/close animation (radians), advances when playerInVision. */
    this.pincerPhase = 0;
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
   * Beetle-only update: chase the player when in vision. No spinning or food-like behavior.
   * Applies velocity from bullet impacts, then moves toward player if in range.
   */
  update(dt, game) {
    const dtSec = dt / 1000;
    const friction = 0.992;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(friction, dt);
    this.vy *= Math.pow(friction, dt);

    const player = game?.player;
    if (!player || player.dead || player.adminMode === true || this.vision <= 0) {
      this.playerInVision = false;
      return;
    }

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.vision || dist < 1e-6) {
      this.playerInVision = false;
      return;
    }

    this.playerInVision = true;
    this.pincerPhase += dt * 0.003; // animate pincers when player in vision

    const speed = 120; // world units per second
    const move = speed * dtSec;
    const nx = dx / dist;
    const ny = dy / dist;
    this.x += nx * move;
    this.y += ny * move;
    this.facingAngle = Math.atan2(ny, nx);
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
