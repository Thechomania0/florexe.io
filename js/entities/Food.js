import { FOOD_CONFIG } from '../config.js';
import { drawPolygon, getRarityColor, drawRoundedHealthBar } from '../utils.js';
import { darkenColor } from '../utils.js';  

export class Food {
  constructor(x, y, rarity, natural = false, id = null) {
    const config = FOOD_CONFIG[rarity];
    this.id = id;
    this.x = x;
    this.y = y;
    this.rarity = rarity;
    this.natural = natural; // true = natural spawn; false = /spawn or other
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.damage = config.damage;
    this.sides = config.sides;
    this.size = config.size;
    this.weight = config.weight ?? 1;
    this.vx = 0;
    this.vy = 0;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.005;
  }

  update(dt) {
    this.rotation += this.rotationSpeed * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const friction = 0.992;
    this.vx *= Math.pow(friction, dt);
    this.vy *= Math.pow(friction, dt);
  }

  draw(ctx, scale, cam, playerLevel) {
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
    ctx.fillStyle = color;
    ctx.strokeStyle = darkenColor(color, 60);
    ctx.lineWidth = 2.5 / scale;

    drawPolygon(ctx, 0, 0, this.sides, s, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // ===== Health bar only for triangles and squares, first 10 levels; no name, no rarity =====
    const isSmallFood = this.sides <= 4; // triangle (3) or square (4)
    const showSmallFoodBar = playerLevel < 10 && isSmallFood;

    if (showSmallFoodBar) {
      const barW = s * 2;
      const barH = Math.max(3, 5 / scale);
      const barY = this.y + s + 6;
      const barX = this.x - barW / 2;
      drawRoundedHealthBar(ctx, barX, barY, barW, barH, this.hp / this.maxHp, {
        fillColor: '#81c784',
        outlineColor: 'rgba(0,0,0,0.8)',
        lineWidth: Math.max(1, 2.5 / scale),
      });
    } else if (!isSmallFood && this.maxHp >= 100) {
      // Larger shapes (pentagon+): keep existing bar + name + rarity when maxHp >= 100
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

      const shapeName = (FOOD_CONFIG[this.rarity].shape || 'shape').replace(/^./, (c) => c.toUpperCase());
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
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      const rSpacing = letterSpacing;
      let rx = textX;
      for (let i = rarityLabel.length - 1; i >= 0; i--) {
        const char = rarityLabel[i];
        rx -= ctx.measureText(char).width;
        ctx.textAlign = 'left';
        ctx.strokeText(char, rx, textY);
        ctx.fillStyle = getRarityColor(this.rarity);
        ctx.fillText(char, rx, textY);
        rx -= rSpacing;
      }
      ctx.textAlign = 'right';
    }
  }
}