import { GRADE_PARAMS as LEVELS, LEVEL_ORDER } from '../utils/levelGenerator.js';
import { OUTFITS, OUTFIT_ORDER }     from '../config/outfits.js';
import { load, setOutfit, levelState, isOutfitUnlocked } from '../utils/storage.js';

const hex = n => '#' + n.toString(16).padStart(6, '0');

export default class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.W = W; this.H = H;
    this.save = load();

    this.drawWall(W, H);
    this.drawTitle(W, H);
    this.drawCharacter(W, H);
    this.drawOutfitSelector(W, H);
    this.drawLevelGrid(W, H);
    this.drawFooter(W, H);
  }

  // ── Wall ─────────────────────────────────────────────────────────────────────

  drawWall(W, H) {
    const g = this.add.graphics();
    g.fillStyle(0xECE0CC); g.fillRect(0, 0, W, H);
    g.lineStyle(1, 0xD4C4A8, 0.28);
    for (let x = 0; x <= W; x += 80) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,H); g.strokePath(); }
    for (let y = 0; y <= H; y += 80) { g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.strokePath(); }
    g.fillStyle(0x3B82F6); g.fillRect(0, H-48, W, 48);
    g.fillStyle(0x2563EB); g.fillRect(0, H-48, W, 8);
  }

  // ── Title ─────────────────────────────────────────────────────────────────────

  drawTitle(W, H) {
    this.add.rectangle(W/2, 0, W, 54, 0x000000, 0.55).setOrigin(0.5, 0);
    this.add.text(W/2, 14, '👑  THE BOULDER KING  👑', {
      fontSize: '30px', fontFamily: 'Arial Black', color: '#FF6B35',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5, 0);
    this.add.text(W/2, 48, '"How hard can it be?"', {
      fontSize: '13px', fontFamily: 'Arial', color: '#9CA3AF', fontStyle: 'italic',
    }).setOrigin(0.5, 0);
  }

  // ── Character (victory pose) ──────────────────────────────────────────────────

  drawCharacter(W, H) {
    const g   = this.add.graphics();
    const outfit = OUTFITS[this.save.selectedOutfit] || OUTFITS.default;
    const tx = W * 0.50;
    const ty = H * 0.34;

    const handL = { x: tx - W*0.17, y: ty - 58 };
    const handR = { x: tx + W*0.17, y: ty - 52 };
    const footL = { x: tx - 28, y: ty + 70 };
    const footR = { x: tx + 32, y: ty + 66 };

    const headCY=ty-62, neckY=ty-38, shldrY=ty-28;
    const shldrLX=tx-20, shldrRX=tx+20, hipY=ty+28, hipLX=tx-14, hipRX=tx+14;
    const SKIN=0xC8845A, LW=15;

    // Back arm + leg
    this.drawLimb(g, shldrRX, shldrY, handR.x, handR.y, SKIN, LW-1, 1);
    g.fillStyle(SKIN); g.fillCircle(handR.x, handR.y, 8);
    this.drawLimb(g, hipRX, hipY, footR.x, footR.y, SKIN, LW+1, -1);
    this.drawShoe(g, footR.x, footR.y, outfit.shoe, outfit.sole);

    // Shirt
    g.fillStyle(outfit.shirt);
    g.fillRoundedRect(tx-22, shldrY, 44, hipY-shldrY+6, { tl:10, tr:10, bl:4, br:4 });
    // Shorts
    g.fillStyle(0x1E293B); g.fillRoundedRect(tx-20, hipY-2, 40, 26, { tl:4, tr:4, bl:8, br:8 });

    // Front arm + leg
    this.drawLimb(g, hipLX, hipY, footL.x, footL.y, SKIN, LW+1, 1);
    this.drawShoe(g, footL.x, footL.y, outfit.shoe, outfit.sole);
    this.drawLimb(g, shldrLX, shldrY, handL.x, handL.y, SKIN, LW-1, -1);
    g.fillStyle(SKIN); g.fillCircle(handL.x, handL.y, 8);

    // Neck + head
    g.fillStyle(SKIN); g.fillRoundedRect(tx-7, neckY, 14, 18, 4);
    g.fillCircle(tx, headCY, 24);
    g.fillStyle(0x1C0A00); g.fillEllipse(tx, headCY-10, 44, 26);
    g.fillCircle(tx-20, headCY-2, 9); g.fillCircle(tx+20, headCY-2, 9);
    g.fillStyle(SKIN); g.fillCircle(tx-23, headCY+4, 7); g.fillCircle(tx+23, headCY+4, 7);
    // Happy eyes + smile
    g.fillStyle(0x1C0A00); g.fillEllipse(tx-8, headCY+3, 11, 6); g.fillEllipse(tx+8, headCY+3, 11, 6);
    g.lineStyle(3, 0x7C3010); g.beginPath(); g.arc(tx, headCY+6, 12, 0.1, Math.PI-0.1); g.strokePath();
    g.lineStyle(3, 0x1C0A00);
    g.beginPath(); g.moveTo(tx-13,headCY-9); g.lineTo(tx-3,headCY-7); g.strokePath();
    g.beginPath(); g.moveTo(tx+13,headCY-9); g.lineTo(tx+3,headCY-7); g.strokePath();

    // Decorative holds
    this.drawMenuHold(g, handL.x, handL.y, 0xA855F7);
    this.drawMenuHold(g, handR.x, handR.y, 0xF59E0B);
  }

  drawMenuHold(g, x, y, color) {
    g.fillStyle(0x000000, 0.15); g.fillEllipse(x+3, y+4, 40, 24);
    g.fillStyle(color); g.fillEllipse(x, y, 40, 24);
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).lighten(22).color);
    g.fillEllipse(x+4, y-5, 16, 10);
    g.fillStyle(0xFFFFFF, 0.4); g.fillEllipse(x-2, y-6, 8, 6);
  }

  // ── Outfit selector ───────────────────────────────────────────────────────────

  drawOutfitSelector(W, H) {
    const selected = this.save.selectedOutfit || 'default';
    const y = H * 0.56;
    const swatchR = 16;
    const gap     = 44;
    const totalW  = OUTFIT_ORDER.length * gap;
    const startX  = W/2 - totalW/2 + gap/2;

    this.add.text(W/2, y - 26, 'OUTFIT', {
      fontSize: '11px', fontFamily: 'Arial Black', color: '#6B7280',
    }).setOrigin(0.5);

    OUTFIT_ORDER.forEach((id, i) => {
      const outfit   = OUTFITS[id];
      const unlocked = isOutfitUnlocked(id);
      const isActive = id === selected;
      const cx       = startX + i * gap;
      const g        = this.add.graphics();

      if (isActive) {
        g.lineStyle(3, 0xFFFFFF, 1); g.strokeCircle(cx, y, swatchR + 4);
      }

      g.fillStyle(unlocked ? outfit.shirt : 0x374151);
      g.fillCircle(cx, y, swatchR);

      if (!unlocked) {
        this.add.text(cx, y, '🔒', { fontSize: '14px' }).setOrigin(0.5);
      } else if (isActive) {
        this.add.text(cx, y, '✓', {
          fontSize: '13px', fontFamily: 'Arial Black', color: '#FFFFFF',
        }).setOrigin(0.5);
      } else {
        // Shoe dot preview
        const dg = this.add.graphics();
        dg.fillStyle(outfit.shoe); dg.fillCircle(cx + 8, y + 8, 7);
      }

      if (unlocked) {
        const hit = this.add.circle(cx, y, swatchR + 6, 0x000000, 0)
          .setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
          setOutfit(id); this.scene.restart();
        });
        hit.on('pointerover', () => { g.setAlpha(0.8); });
        hit.on('pointerout',  () => { g.setAlpha(1.0); });
      }

      // Tooltip name
      if (unlocked) {
        this.add.text(cx, y + swatchR + 8, outfit.name, {
          fontSize: '9px', fontFamily: 'Arial', color: '#6B7280',
        }).setOrigin(0.5, 0);
      }
    });
  }

  // ── Level grid (2 rows × 3) ───────────────────────────────────────────────────

  drawLevelGrid(W, H) {
    const cardW  = Math.min(190, W * 0.27);
    const cardH  = 105;
    const gapX   = Math.min(22, W * 0.02);
    const gapY   = 10;
    const totalW = cardW * 3 + gapX * 2;
    const startX = (W - totalW) / 2;
    const row1Y  = H * 0.63;
    const row2Y  = row1Y + cardH + gapY;

    LEVEL_ORDER.forEach((key, i) => {
      const col  = i % 3;
      const row  = Math.floor(i / 3);
      const x    = startX + col * (cardW + gapX);
      const y    = row === 0 ? row1Y : row2Y;
      this.drawCard(x, y, cardW, cardH, LEVELS[key], levelState(key));
    });
  }

  drawCard(x, y, w, h, lv, state) {
    const g       = this.add.graphics();
    const locked  = state === 'locked';
    const done    = state === 'completed';
    const cardCol = locked ? 0x374151 : 0x111827;
    const rimCol  = locked ? 0x4B5563 : lv.color;

    g.fillStyle(cardCol, 0.9); g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(2, rimCol, locked ? 0.35 : 0.85); g.strokeRoundedRect(x, y, w, h, 10);

    if (!locked) {
      g.fillStyle(lv.color, 0.18); g.fillRoundedRect(x, y, w, 36, { tl:10, tr:10, bl:0, br:0 });
    }

    const cx = x + w/2;

    // Grade
    this.add.text(cx, y + 18, lv.grade, {
      fontSize: '24px', fontFamily: 'Arial Black',
      color: locked ? '#4B5563' : hex(lv.color),
    }).setOrigin(0.5);

    // Name
    this.add.text(cx, y + 42, lv.name, {
      fontSize: '11px', fontFamily: 'Arial Black',
      color: locked ? '#374151' : '#FFFFFF',
    }).setOrigin(0.5);

    if (locked) {
      // Show which level unlocks this
      const idx = LEVEL_ORDER.indexOf(lv.grade);
      this.add.text(cx, y + 60, `🔒 Complete ${LEVEL_ORDER[idx-1]}`, {
        fontSize: '10px', fontFamily: 'Arial', color: '#4B5563',
      }).setOrigin(0.5);
      return;
    }

    if (done) {
      // Best score + stars
      const best  = load().bestScores[lv.grade] || 0;
      const stars = best >= 800 ? '⭐⭐⭐' : best >= 500 ? '⭐⭐' : '⭐';
      this.add.text(cx, y + 58, stars, { fontSize: '16px' }).setOrigin(0.5);
      this.add.text(cx, y + 76, `Best: ${best}`, {
        fontSize: '10px', fontFamily: 'Arial', color: '#9CA3AF',
      }).setOrigin(0.5);

      // Small "REPLAY" button
      const btn = this.add.rectangle(cx, y + h - 14, w - 28, 22, lv.color, 0.75)
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      this.add.text(cx, y + h - 14, 'REPLAY', {
        fontSize: '11px', fontFamily: 'Arial Black', color: '#FFFFFF',
      }).setOrigin(0.5);
      btn.on('pointerdown', () => this.scene.start('GameScene', { level: lv.grade }));
      btn.on('pointerover', () => btn.setAlpha(1));
      btn.on('pointerout',  () => btn.setAlpha(0.75));
    } else {
      // PLAY button
      const btn = this.add.rectangle(cx, y + h - 18, w - 24, 30, lv.color)
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      const txt = this.add.text(cx, y + h - 18, 'PLAY', {
        fontSize: '14px', fontFamily: 'Arial Black', color: '#FFFFFF',
      }).setOrigin(0.5);
      btn.on('pointerover', () => {
        btn.setFillStyle(Phaser.Display.Color.IntegerToColor(lv.color).lighten(18).color);
        txt.setScale(1.05);
      });
      btn.on('pointerout',  () => { btn.setFillStyle(lv.color); txt.setScale(1); });
      btn.on('pointerdown', () => this.scene.start('GameScene', { level: lv.grade }));
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────

  drawFooter(W, H) {
    this.add.text(W/2, H - 14, 'Q · E · Z · X  — move your limbs wisely', {
      fontSize: '11px', fontFamily: 'Arial', color: '#6B7280',
    }).setOrigin(0.5, 1);
  }

  // ── Helpers shared with GameScene ─────────────────────────────────────────────

  drawLimb(g, x1, y1, x2, y2, color, width, bendDir) {
    const mx=(x1+x2)/2, my=(y1+y2)/2, dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
    const jx=mx+(-dy/len)*22*bendDir, jy=my+(dx/len)*22*bendDir;
    g.lineStyle(width, color, 1);
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(jx,jy); g.strokePath();
    g.beginPath(); g.moveTo(jx,jy); g.lineTo(x2,y2); g.strokePath();
    g.fillStyle(color); g.fillCircle(jx, jy, width/2);
  }

  drawShoe(g, x, y, color, sole) {
    g.fillStyle(sole); g.fillEllipse(x+2, y+8, 28, 10);
    g.fillStyle(color); g.fillEllipse(x, y+2, 26, 14);
    g.fillRoundedRect(x-13, y-4, 26, 12, 4);
    g.fillStyle(0xFFFFFF, 0.3); g.fillEllipse(x-4, y-2, 10, 6);
  }
}
