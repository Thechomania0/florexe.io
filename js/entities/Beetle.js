import { BEETLE_CONFIG, BEETLE_VISION } from '../config.js';
import { drawPolygon, getRarityColor, drawRoundedHealthBar } from '../utils.js';
import { darkenColor } from '../utils.js';

/** Beetle mob: same rarities and spawn logic as food; uses BEETLE_CONFIG for stats. */
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
    this.weight = config.weight ?? 1;
    this.vision = BEETLE_VISION;
    this.vx = 0;
    this.vy = 0;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.005;
  }

  update(dt, game) {
    const player = game?.player;
    const beetleSpeed = 0.175 * 0.65; // 65% of player base speed (units per second)
    const moveThisFrame = beetleSpeed * (dt / 1000); // units to move this frame

    if (player && !player.dead && this.vision > 0) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= this.vision && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.x += nx * moveThisFrame;
        this.y += ny * moveThisFrame;
      }
    }

    this.rotation += this.rotationSpeed * dt;
  }

  draw(ctx, scale, cam, playerLevel, beetleImage) {
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
    ctx.rotate(this.rotation);

    const color = getRarityColor(this.rarity);
    if (beetleImage && beetleImage.complete && beetleImage.naturalWidth > 0) {
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
