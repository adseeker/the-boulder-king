import { LEVELS, LEVEL_ORDER }                          from '../config/levels.js';
import { OUTFITS }                                       from '../config/outfits.js';
import { getOutfit, markComplete, checkOutfitUnlock }   from '../utils/storage.js';
import { playGrab, playRelease, playFall, playSplat,
         playWin, playHeartbeat }                        from '../utils/sounds.js';

const hex = n => '#' + n.toString(16).padStart(6, '0');

const BETA_SPRAY = [
  'TRUST THE FEET!',
  'USE THE SIDEPULL!',
  "IT'S ALL IN THE HIPS",
  'JUST DYNO IT',
  "THAT BETA DOESN'T WORK",
  'I FLASHED THIS IN APPROACH SHOES',
  'KEEP YOUR HIPS IN!',
  "YOU'RE BARN DOORING!",
  'BREATHE!!',
  'MATCH THAT HOLD!',
  'HEEL HOOK!',
  'DROP KNEE!',
  'SMEAR IT!',
  'COMMIT TO THE MOVE!',
];
const BETA_FALL   = ["OHHHH!", 'SEND IT... oh.', 'CLASSIC.', "THAT'S A TAKE"];
const BETA_LAND   = ['YOU ALMOST HAD IT', 'GOOD ATTEMPT', 'SHAKE IT OUT', 'REST AND TRY AGAIN'];
const BETA_WIN    = ['YEEAAHHH!!!', 'SEND IT!!!', 'ABSOLUTELY SENT!', 'KING! 👑'];

// ─────────────────────────────────────────────────────────────────────────────

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.W = W; this.H = H;

    this.levelConfig = LEVELS[this.scene.settings.data?.level || 'V0'];
    this.outfit      = getOutfit();

    this.state            = 'playing';
    this.pump             = 0;
    this.elapsed          = 0;
    this.moves            = 0;
    this.fallVel          = 0;
    this.fallPhase        = 0;
    this.fallTimer        = 0;
    this.shakeX           = 0;
    this.pumpNotif70      = false;
    this.pumpNotif90      = false;
    this.heartbeatCooldown = false;
    this.hasLanded        = false;
    this.npcBubbleActive  = false;

    this.drawWall(W, H);
    this.setupHolds(W, H);
    this.holdBaseGfx    = this.add.graphics(); this.drawAllHolds();
    this.setupNPCs(W, H);                       // draw NPCs before dynamic layers
    this.holdOverlayGfx = this.add.graphics();
    this.createClimber(W, H);
    this.climberGfx     = this.add.graphics();

    this.setupInput();
    this.setupHUD(W, H);
    this.updateTorsoTarget();
    this.drawHoldOverlays();
    this.drawClimber();
    this.startBetaSprayTimer();
  }

  update(_, delta) {
    if      (this.state === 'playing') this.updatePlaying(delta);
    else if (this.state === 'falling') this.updateFalling(delta);
  }

  // ── State: PLAYING ──────────────────────────────────────────────────────────

  updatePlaying(delta) {
    const dt = delta / 1000;
    this.elapsed += dt;

    if (this.climber.torsoTarget) {
      this.climber.torso.x = Phaser.Math.Linear(this.climber.torso.x, this.climber.torsoTarget.x, 0.11);
      this.climber.torso.y = Phaser.Math.Linear(this.climber.torso.y, this.climber.torsoTarget.y, 0.11);
    }
    Object.entries(this.climber.limbs).forEach(([key, limb]) => {
      if (!limb.grabbed) {
        const fp = this.getFreePos(key);
        limb.x = Phaser.Math.Linear(limb.x, fp.x, 0.14);
        limb.y = Phaser.Math.Linear(limb.y, fp.y, 0.14);
      }
    });

    const grabbed = Object.values(this.climber.limbs).filter(l => l.grabbed).length;
    this.pump     = Math.min(100, this.pump + this.levelConfig.pumpRates[grabbed] * dt);
    this.shakeX   = this.pump > 65 ? Math.sin(Date.now() / 55) * ((this.pump - 65) / 12) : 0;

    if (!this.pumpNotif70 && this.pump > 70) { this.pumpNotif70 = true; this.showNotif('GETTING PUMPED...', '#F59E0B'); }
    if (!this.pumpNotif90 && this.pump > 90) { this.pumpNotif90 = true; this.showNotif('HOLD ON!!!', '#EF4444'); }

    if (!this.heartbeatCooldown && this.pump > 90) {
      this.heartbeatCooldown = true;
      playHeartbeat(this.sound.context);
      this.time.delayedCall(750, () => { this.heartbeatCooldown = false; });
    }

    if (this.pump >= 100) { this.startFall(); return; }
    if (this.checkWin())  { this.startWin();  return; }

    this.drawHoldOverlays();
    this.drawClimber();
    this.updateHUD();
  }

  // ── State: FALLING ──────────────────────────────────────────────────────────

  updateFalling(delta) {
    this.fallTimer += delta;
    this.fallPhase += delta * 0.013;

    this.fallVel += 1400 * (delta / 1000);
    this.climber.torso.y += this.fallVel * (delta / 1000);

    if (this.climber.torso.y > this.H - 38 && !this.hasLanded) {
      this.hasLanded = true;
      this.climber.torso.y = this.H - 38;
      this.fallVel = 0;
      this.onLand();
    }

    const phases = { handL: 0, handR: Math.PI, footL: 0.9, footR: 2.3 };
    Object.entries(this.climber.limbs).forEach(([key, limb]) => {
      const fp = this.getFreePos(key);
      const p  = phases[key];
      limb.x   = fp.x + Math.sin(this.fallPhase * 4 + p) * 50;
      limb.y   = fp.y + Math.cos(this.fallPhase * 3 + p) * 35;
    });

    this.drawHoldOverlays();
    this.drawClimber();
    if (this.fallTimer > 1900) this.showGameOver();
  }

  // ── Win / Fall triggers ─────────────────────────────────────────────────────

  checkWin() {
    const { handL, handR } = this.climber.limbs;
    const topId = this.levelConfig.holds.at(-1).id;
    return (handL.grabbed && handL.holdId === topId) || (handR.grabbed && handR.holdId === topId);
  }

  startFall() {
    this.state     = 'falling';
    this.fallTimer = 0; this.fallVel = 0; this.fallPhase = 0; this.hasLanded = false;
    Object.values(this.climber.limbs).forEach(l => { l.grabbed = false; l.holdId = null; });
    this.climber.torsoTarget = null;
    playFall(this.sound.context);
    this.showFallScream();
    this.npcReact('fall');
  }

  onLand() {
    playSplat(this.sound.context);
    this.showSplat(this.climber.torso.x, this.H - 40);
    this.time.delayedCall(600, () => this.npcReact('landing'));
  }

  startWin() {
    this.state = 'won';
    this.shakeX = 0;
    this.drawClimber();
    playWin(this.sound.context);
    this.npcReact('win');

    const lv    = this.levelConfig;
    const s     = Math.floor(this.elapsed);
    const score = Math.max(100, 1000 - s*4 - this.moves*8 + (this.pump < 50 ? 300 : this.pump < 75 ? 120 : 0));

    // Check outfit unlock BEFORE marking complete (markComplete changes state)
    const newOutfitId = checkOutfitUnlock(lv.grade);
    markComplete(lv.grade, score);

    if (newOutfitId) {
      const delay = 400;
      this.time.delayedCall(delay, () => {
        this.showNotif(`✨ ${OUTFITS[newOutfitId].name} UNLOCKED!`, '#F59E0B');
      });
    }

    this.time.delayedCall(newOutfitId ? 1800 : 200, () => this.showWin(score));
  }

  // ── Overlays: game over / win ───────────────────────────────────────────────

  showGameOver() {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    const W = this.W; const H = this.H;
    const msgs = this.levelConfig.gameoverMsgs;
    const msg  = msgs[Math.floor(Math.random() * msgs.length)];

    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.72).setOrigin(0.5);
    this.add.text(W/2, H*0.22, '💥', { fontSize: '72px' }).setOrigin(0.5);
    this.add.text(W/2, H*0.38, msg, {
      fontSize: '36px', fontFamily: 'Arial Black', color: '#EF4444',
      stroke: '#000000', strokeThickness: 6,
      wordWrap: { width: W*0.78 }, align: 'center',
    }).setOrigin(0.5);

    const s  = Math.floor(this.elapsed);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    this.add.text(W/2, H*0.55, `${this.levelConfig.grade}  •  Time: ${mm}:${ss}  •  Moves: ${this.moves}`, {
      fontSize: '16px', fontFamily: 'Arial', color: '#9CA3AF',
    }).setOrigin(0.5);

    this.makeButton(W/2 - 92, H*0.68, 'TRY AGAIN', '#FF6B35', () => this.scene.restart());
    this.makeButton(W/2 + 92, H*0.68, 'MAIN MENU', '#6B7280', () => this.scene.start('MainMenuScene'));
    this.add.text(W/2, H*0.78, 'or press  R', { fontSize: '12px', fontFamily: 'Arial', color: '#4B5563' }).setOrigin(0.5);
    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  showWin(score = 500) {
    const W = this.W; const H = this.H;
    const lv    = this.levelConfig;
    const s     = Math.floor(this.elapsed);
    const mm    = String(Math.floor(s/60)).padStart(2,'0');
    const ss    = String(s%60).padStart(2,'0');
    const stars = score >= 800 ? '⭐⭐⭐' : score >= 500 ? '⭐⭐' : '⭐';

    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.72).setOrigin(0.5);
    this.add.text(W/2, H*0.12, '👑', { fontSize: '72px' }).setOrigin(0.5);
    this.add.text(W/2, H*0.26, 'SEND IT!!!', {
      fontSize: '52px', fontFamily: 'Arial Black', color: '#FF6B35',
      stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.38, lv.winMsg, {
      fontSize: '16px', fontFamily: 'Arial', color: '#9CA3AF', align: 'center',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.50, `SCORE: ${score}`, {
      fontSize: '30px', fontFamily: 'Arial Black', color: '#FFFFFF',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.58, `${lv.grade}  •  ${mm}:${ss}  •  ${this.moves} moves`, {
      fontSize: '14px', fontFamily: 'Arial', color: '#9CA3AF',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.65, stars, { fontSize: '34px' }).setOrigin(0.5);

    const nextKey = LEVEL_ORDER[LEVEL_ORDER.indexOf(lv.grade) + 1];
    if (nextKey) {
      this.makeButton(W/2 - 92, H*0.75, `NEXT: ${nextKey}`, hex(LEVELS[nextKey].color),
        () => this.scene.start('GameScene', { level: nextKey }));
    }
    this.makeButton(nextKey ? W/2 + 92 : W/2 - 92, H*0.75, 'MAIN MENU', '#6B7280',
      () => this.scene.start('MainMenuScene'));

    // Share button
    this.makeButton(W/2 + (nextKey ? 0 : 92), H*0.86, '📤 SHARE', '#22C55E',
      () => this.doShare(lv.grade, score, stars));

    this.input.keyboard.once('keydown-R', () => this.scene.restart());
  }

  doShare(grade, score, stars) {
    const gradeLines = {
      V0:  `I just survived a V0 on The Boulder King. ${stars}\nIt was harder than it sounds.`,
      V2:  `V2 sent on The Boulder King! ${stars}\nMy forearms are no longer my friends.`,
      V4:  `V4 SENT. ${stars}\nThe Boulder King tried to break me. I won. Barely.`,
      V6:  `V6 PROJECT SENT! ${stars}\nThis is the best day of my life.`,
      V8:  `V8 on The Boulder King. ${stars}\nI don't know how but I SENT IT.`,
      V10: `V10. I AM THE BOULDER KING. ${stars}\nSomeone please check on me. 👑`,
    };
    const gameUrl = window.location.hostname === 'localhost'
      ? 'https://the-boulder-king.vercel.app'
      : window.location.origin;

    const text = `🧗 THE BOULDER KING\n${gradeLines[grade] || `${grade} sent! ${stars}`}\nScore: ${score}\nPlay: ${gameUrl}\n#BoulderKing #Climbing #Bouldering`;

    if (navigator.share) {
      navigator.share({ title: 'The Boulder King', text, url: gameUrl })
        .catch(() => this.copyText(text));
    } else {
      this.copyText(text);
    }
  }

  copyText(text) {
    navigator.clipboard.writeText(text)
      .then(() => this.showNotif('COPIED! 📋 Go flex on the group chat', '#22C55E'))
      .catch(() => this.showNotif('SHARE: open the console for text', '#6B7280'));
  }

  makeButton(x, y, label, color, onClick) {
    const bg = this.add.rectangle(x, y, 164, 44, 0x1F2937).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const txt = this.add.text(x, y, label, { fontSize: '15px', fontFamily: 'Arial Black', color }).setOrigin(0.5);
    bg.on('pointerover', () => { bg.setFillStyle(0x374151); txt.setScale(1.05); });
    bg.on('pointerout',  () => { bg.setFillStyle(0x1F2937); txt.setScale(1.0); });
    bg.on('pointerdown', onClick);
  }

  // ── Effects & gags ──────────────────────────────────────────────────────────

  chalkPuff(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const dist  = 14 + Math.random() * 18;
      const r     = 3 + Math.random() * 4;
      const g     = this.add.graphics();
      g.x = x; g.y = y;
      g.fillStyle(0xFFFFFF, 0.75 + Math.random() * 0.2);
      g.fillCircle(0, 0, r);
      this.tweens.add({
        targets: g,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scaleX: 2.5, scaleY: 2.5,
        duration: 280 + Math.random() * 180,
        ease: 'Power2',
        onComplete: () => g.destroy(),
      });
    }
  }

  showGrabText(x, y, isHand) {
    const words = isHand ? ['SLAP!', 'CRIMP!', 'GRIP!'] : ['SMEAR!', 'HEEL!', 'TOE!'];
    const word  = words[Math.floor(Math.random() * words.length)];
    const color = isHand ? '#93C5FD' : '#FCD34D';
    const t = this.add.text(x, y - 18, word, {
      fontSize: '14px', fontFamily: 'Arial Black', color,
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 52, alpha: 0, duration: 550, ease: 'Power2', onComplete: () => t.destroy() });
  }

  showFallScream() {
    const t = this.add.text(
      this.climber.torso.x, this.climber.torso.y - 50,
      'AAAAHHH!!',
      { fontSize: '30px', fontFamily: 'Arial Black', color: '#EF4444', stroke: '#000', strokeThickness: 5 }
    ).setOrigin(0.5);
    this.tweens.add({ targets: t, y: t.y - 90, alpha: 0, duration: 1000, ease: 'Power1', onComplete: () => t.destroy() });
  }

  showSplat(x, y) {
    const g = this.add.graphics();
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      g.fillStyle(0x3B82F6, 0.7);
      const bx = x + Math.cos(a) * 4;
      const by = y + Math.sin(a) * 4;
      g.fillTriangle(bx, by,
        x + Math.cos(a - 0.25) * 38, y + Math.sin(a - 0.25) * 20,
        x + Math.cos(a + 0.25) * 38, y + Math.sin(a + 0.25) * 20);
    }
    this.tweens.add({ targets: g, alpha: 0, scaleX: 1.6, scaleY: 1.6, duration: 550, ease: 'Power2', onComplete: () => g.destroy() });

    const txt = this.add.text(x, y - 22, 'SPLAT!', {
      fontSize: '32px', fontFamily: 'Arial Black', color: '#FFFFFF', stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5);
    this.tweens.add({ targets: txt, y: txt.y - 36, alpha: 0, duration: 800, ease: 'Power2', onComplete: () => txt.destroy() });
  }

  showNotif(text, color = '#FF6B35') {
    const t = this.add.text(this.W/2, this.H/2 - 100, text, {
      fontSize: '30px', fontFamily: 'Arial Black', color,
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: this.H/2 - 120, duration: 250, ease: 'Back.Out', yoyo: true, hold: 900, onComplete: () => t.destroy() });
  }

  // ── NPC beta sprayers ───────────────────────────────────────────────────────

  setupNPCs(W, H) {
    this.npcPositions = [
      { x: W * 0.09, y: H - 8 },
      { x: W * 0.91, y: H - 8 },
    ];
    const g = this.add.graphics();
    this.drawNPC(g, this.npcPositions[0].x, this.npcPositions[0].y, 'arms_crossed');
    this.drawNPC(g, this.npcPositions[1].x, this.npcPositions[1].y, 'hands_hips');
  }

  drawNPC(g, x, y, pose) {
    const col = 0x374151;
    // Head
    g.fillStyle(col); g.fillCircle(x, y - 52, 10);
    // Body
    g.fillRoundedRect(x - 8, y - 42, 16, 24, 4);
    g.lineStyle(5, col);
    if (pose === 'arms_crossed') {
      g.beginPath(); g.moveTo(x - 8, y - 34); g.lineTo(x + 14, y - 28); g.strokePath();
      g.beginPath(); g.moveTo(x + 8, y - 34); g.lineTo(x - 14, y - 28); g.strokePath();
    } else {
      g.beginPath(); g.moveTo(x - 8, y - 34); g.lineTo(x - 16, y - 22); g.strokePath();
      g.beginPath(); g.moveTo(x + 8, y - 34); g.lineTo(x + 16, y - 22); g.strokePath();
    }
    // Legs
    g.lineStyle(6, col);
    g.beginPath(); g.moveTo(x - 3, y - 18); g.lineTo(x - 7, y - 2); g.strokePath();
    g.beginPath(); g.moveTo(x + 3, y - 18); g.lineTo(x + 7, y - 2); g.strokePath();
  }

  showBubble(npcIdx, text) {
    if (this.npcBubbleActive) return;
    this.npcBubbleActive = true;

    const npc  = this.npcPositions[npcIdx];
    const maxW = 180;
    const pad  = 10;

    // Measure text width
    const tmp = this.add.text(0, -9999, text, { fontSize: '12px', fontFamily: 'Arial Black', wordWrap: { width: maxW } });
    const tw = Math.min(tmp.width + pad*2, maxW + pad*2);
    const th = tmp.height + pad*2;
    tmp.destroy();

    // Position bubble above NPC
    const bx = Phaser.Math.Clamp(npc.x - tw/2, 4, this.W - tw - 4);
    const by = npc.y - 58 - th;

    const bg = this.add.graphics();
    bg.fillStyle(0xFFFFFF, 0.95);
    bg.fillRoundedRect(bx, by, tw, th, 8);
    // Tail
    const tailX = Phaser.Math.Clamp(npc.x, bx + 12, bx + tw - 12);
    bg.fillTriangle(tailX - 7, by + th, tailX + 7, by + th, tailX, by + th + 10);

    const txt = this.add.text(bx + pad, by + pad, text, {
      fontSize: '12px', fontFamily: 'Arial Black', color: '#1F2937',
      wordWrap: { width: maxW },
    });

    const duration = 2800;
    this.time.delayedCall(duration, () => {
      this.tweens.add({
        targets: [bg, txt], alpha: 0, duration: 380,
        onComplete: () => { bg.destroy(); txt.destroy(); this.npcBubbleActive = false; },
      });
    });
  }

  npcReact(event) {
    let pool;
    if (event === 'fall')    pool = BETA_FALL;
    else if (event === 'landing') pool = BETA_LAND;
    else if (event === 'win')     pool = BETA_WIN;
    else return;
    const idx  = Math.floor(Math.random() * this.npcPositions.length);
    const text = pool[Math.floor(Math.random() * pool.length)];
    this.time.delayedCall(300, () => this.showBubble(idx, text));
  }

  startBetaSprayTimer() {
    const fire = () => {
      if (this.state !== 'playing') return;
      const idx  = Math.floor(Math.random() * this.npcPositions.length);
      const text = BETA_SPRAY[Math.floor(Math.random() * BETA_SPRAY.length)];
      this.showBubble(idx, text);
      this.time.delayedCall(9000 + Math.random() * 8000, fire);
    };
    this.time.delayedCall(7000 + Math.random() * 5000, fire);
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  setupInput() {
    this.input.keyboard.on('keydown-Q', () => this.moveLimb('handL'));
    this.input.keyboard.on('keydown-E', () => this.moveLimb('handR'));
    this.input.keyboard.on('keydown-Z', () => this.moveLimb('footL'));
    this.input.keyboard.on('keydown-X', () => this.moveLimb('footR'));
  }

  moveLimb(key) {
    if (this.state !== 'playing') return;
    const limb   = this.climber.limbs[key];
    const isHand = key.startsWith('hand');
    const ctx    = this.sound.context;

    if (limb.grabbed) {
      limb.grabbed = false; limb.holdId = null;
      playRelease(ctx);
    } else {
      const reach    = isHand ? 200 : 165;
      const occupied = Object.entries(this.climber.limbs)
        .filter(([k, l]) => k !== key && l.grabbed)
        .map(([, l]) => l.holdId);

      const reachable = this.allHolds
        .filter(h => {
          if (occupied.includes(h.id)) return false;
          return Phaser.Math.Distance.Between(this.climber.torso.x, this.climber.torso.y, h.x, h.y) <= reach;
        })
        .sort((a, b) =>
          Phaser.Math.Distance.Between(this.climber.torso.x, this.climber.torso.y, a.x, a.y) -
          Phaser.Math.Distance.Between(this.climber.torso.x, this.climber.torso.y, b.x, b.y)
        );

      if (!reachable.length) return;
      const t = reachable[0];
      limb.x = t.x; limb.y = t.y;
      limb.grabbed = true; limb.holdId = t.id;
      this.moves++;
      playGrab(ctx);
      this.chalkPuff(t.x, t.y);
      this.showGrabText(t.x, t.y, isHand);
    }
    this.updateTorsoTarget();
  }

  updateTorsoTarget() {
    const L     = this.climber.limbs;
    const hands = ['handL','handR'].filter(k => L[k].grabbed).map(k => L[k]);
    const feet  = ['footL','footR'].filter(k => L[k].grabbed).map(k => L[k]);
    if (!hands.length && !feet.length) return;

    let tx, ty;
    if (hands.length) {
      tx = hands.reduce((s,h) => s+h.x,0) / hands.length;
      ty = hands.reduce((s,h) => s+h.y,0) / hands.length + 68;
      if (feet.length) {
        tx = tx*0.65 + feet.reduce((s,f) => s+f.x,0)/feet.length*0.35;
        ty = ty*0.60 + (feet.reduce((s,f) => s+f.y,0)/feet.length - 78)*0.40;
      }
    } else {
      tx = feet.reduce((s,f) => s+f.x,0) / feet.length;
      ty = feet.reduce((s,f) => s+f.y,0) / feet.length - 80;
    }
    this.climber.torsoTarget = {
      x: Phaser.Math.Clamp(tx, 40, this.W-40),
      y: Phaser.Math.Clamp(ty, 60, this.H-80),
    };
  }

  getFreePos(key) {
    const tx = this.climber.torso.x; const ty = this.climber.torso.y;
    return { handL:{x:tx-48,y:ty+12}, handR:{x:tx+48,y:ty+12}, footL:{x:tx-22,y:ty+68}, footR:{x:tx+22,y:ty+68} }[key];
  }

  // ── Wall & holds ────────────────────────────────────────────────────────────

  drawWall(W, H) {
    const g = this.add.graphics();
    const wallColors   = { V0:0xECE0CC, V2:0xE0D8CF, V4:0xCEC8BE, V6:0xC0BAB2, V8:0xB0AAA2, V10:0xA09A96 };
    const overhangAlph = { V4:0.12, V6:0.18, V8:0.26, V10:0.38 };
    const wc = wallColors[this.levelConfig.grade] || 0xECE0CC;

    g.fillStyle(wc); g.fillRect(0,0,W,H);
    g.lineStyle(1, 0xD4C4A8, 0.26);
    for (let x = 0; x <= W; x += 80) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,H); g.strokePath(); }
    for (let y = 0; y <= H; y += 80) { g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.strokePath(); }

    const oa = overhangAlph[this.levelConfig.grade];
    if (oa) { g.fillStyle(0x000000, oa); g.fillRect(0, 0, W, H * 0.50); }

    g.fillStyle(0x3B82F6); g.fillRect(0, H-48, W, 48);
    g.fillStyle(0x2563EB); g.fillRect(0, H-48, W, 8);
    g.fillStyle(0xFF6B35); g.fillRect(0, 0, W, 10);
  }

  setupHolds(W, H) {
    const lv = this.levelConfig;
    this.holds     = lv.holds.map(h => ({...h, x:h.xr*W, y:h.yr*H}));
    this.footHolds = lv.footHolds.map(h => ({...h, x:h.xr*W, y:h.yr*H}));
    this.allHolds  = [...this.holds, ...this.footHolds];
  }

  drawAllHolds() {
    const g  = this.holdBaseGfx;
    const sc = this.levelConfig.holdScale;
    this.holds.forEach(h => this.drawHold(g, h.x, h.y, h.color, sc, h.label));
    this.footHolds.forEach(h => this.drawHold(g, h.x, h.y, h.color, sc*0.62));
  }

  drawHold(g, x, y, color, sc = 1.0, label = null) {
    const W = 48*sc; const H = 30*sc;
    g.fillStyle(0x000000, 0.18); g.fillEllipse(x+4, y+5, W*1.05, H*0.9);
    g.fillStyle(color); g.fillEllipse(x, y, W, H);
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(14).color); g.fillEllipse(x-W*0.18, y+H*0.08, W*0.55, H*0.6);
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).lighten(22).color); g.fillEllipse(x+W*0.10, y-H*0.20, W*0.42, H*0.32);
    g.fillStyle(0xFFFFFF, 0.4); g.fillEllipse(x-W*0.04, y-H*0.25, W*0.18, H*0.16);
    if (label) this.add.text(x, y+H*0.72, label, {
      fontSize: `${Math.round(10*sc)}px`, fontFamily: 'Arial Black', color: '#444444',
    }).setOrigin(0.5, 0);
  }

  drawHoldOverlays() {
    const g = this.holdOverlayGfx; g.clear();
    const limbs    = this.climber.limbs;
    const occupied = Object.values(limbs).filter(l => l.grabbed).map(l => l.holdId);

    Object.values(limbs).filter(l => l.grabbed).forEach(limb => {
      const hold = this.allHolds.find(h => h.id === limb.holdId);
      if (!hold) return;
      g.lineStyle(3, 0xFFFFFF, 0.9); g.strokeEllipse(hold.x, hold.y, 56, 38);
      g.lineStyle(2, 0xFFFFFF, 0.3); g.strokeEllipse(hold.x, hold.y, 66, 46);
    });

    if (this.state !== 'playing') return;
    const reach = { handL:200, handR:200, footL:165, footR:165 };
    Object.entries(limbs).filter(([,l]) => !l.grabbed).forEach(([key]) => {
      this.allHolds.filter(h => {
        if (occupied.includes(h.id)) return false;
        return Phaser.Math.Distance.Between(this.climber.torso.x, this.climber.torso.y, h.x, h.y) <= reach[key];
      }).forEach(h => {
        g.lineStyle(2, 0xFFFFFF, 0.35); g.strokeEllipse(h.x, h.y, 52, 34);
      });
    });
  }

  // ── Climber ─────────────────────────────────────────────────────────────────

  createClimber(W, H) {
    const sl = this.holds[0]; const sr = this.holds[1];
    const fl = this.footHolds[0]; const fr = this.footHolds[1];
    this.climber = {
      torso: { x:(sl.x+sr.x)/2, y:(sl.y+fl.y)/2-10 },
      torsoTarget: null,
      limbs: {
        handL:{ x:sl.x, y:sl.y, grabbed:true, holdId:sl.id },
        handR:{ x:sr.x, y:sr.y, grabbed:true, holdId:sr.id },
        footL:{ x:fl.x, y:fl.y, grabbed:true, holdId:fl.id },
        footR:{ x:fr.x, y:fr.y, grabbed:true, holdId:fr.id },
      },
    };
  }

  getFaceMode() {
    if (this.state === 'falling') return 'scream';
    if (this.state === 'won')    return 'happy';
    if (this.pump > 82)          return 'terrified';
    if (this.pump > 58)          return 'worried';
    return 'focused';
  }

  drawClimber() {
    const g = this.climberGfx; g.clear();
    const { torso, limbs } = this.climber;
    const sx = torso.x + this.shakeX; const sy = torso.y;

    const headCY = sy-58, neckY=sy-36, shldrY=sy-26;
    const shldrLX=sx-20, shldrRX=sx+20, hipY=sy+26, hipLX=sx-14, hipRX=sx+14;
    const SKIN=0xC8845A, SHIRT=this.outfit.shirt, SHORT=0x1E293B, SHOE=this.outfit.shoe, SOLE=this.outfit.sole, LW=15;

    this.drawLimb(g, shldrRX, shldrY, limbs.handR.x, limbs.handR.y, SKIN, LW-1,  1);
    g.fillStyle(SKIN); g.fillCircle(limbs.handR.x, limbs.handR.y, 8);
    this.drawLimb(g, hipRX, hipY, limbs.footR.x, limbs.footR.y, SKIN, LW+1, -1);
    this.drawShoe(g, limbs.footR.x, limbs.footR.y, SHOE, SOLE);

    g.fillStyle(SHIRT); g.fillRoundedRect(sx-22, shldrY, 44, hipY-shldrY+6, {tl:10,tr:10,bl:4,br:4});
    g.fillStyle(0x000000,0.08); g.fillEllipse(sx, shldrY+4, 28, 10);
    g.fillStyle(SHORT); g.fillRoundedRect(sx-20, hipY-2, 40, 26, {tl:4,tr:4,bl:8,br:8});
    g.lineStyle(2, 0x0F172A, 0.5); g.beginPath(); g.moveTo(sx-20,hipY-2); g.lineTo(sx+20,hipY-2); g.strokePath();

    this.drawLimb(g, hipLX, hipY, limbs.footL.x, limbs.footL.y, SKIN, LW+1, 1);
    this.drawShoe(g, limbs.footL.x, limbs.footL.y, SHOE, SOLE);
    this.drawLimb(g, shldrLX, shldrY, limbs.handL.x, limbs.handL.y, SKIN, LW-1, -1);
    g.fillStyle(SKIN); g.fillCircle(limbs.handL.x, limbs.handL.y, 8);

    g.fillStyle(0xF1F5F9); g.fillEllipse(sx+26, sy+10, 18, 22);
    g.lineStyle(2,0xCBD5E1); g.strokeEllipse(sx+26, sy+10, 18, 22);
    g.fillStyle(0xFFFFFF,0.6); g.fillCircle(sx+26, sy+2, 5);

    g.fillStyle(SKIN); g.fillRoundedRect(sx-7, neckY, 14, 18, 4); g.fillCircle(sx, headCY, 24);
    g.fillStyle(0x1C0A00); g.fillEllipse(sx, headCY-10, 44, 26); g.fillCircle(sx-20, headCY-2, 9); g.fillCircle(sx+20, headCY-2, 9);
    g.fillStyle(SKIN); g.fillCircle(sx-23, headCY+4, 7); g.fillCircle(sx+23, headCY+4, 7);

    if (this.pump > 60 && this.state === 'playing') {
      const a = Math.min(1, (this.pump-60)/35);
      g.fillStyle(0x93C5FD, a); g.fillEllipse(sx+30, headCY+8, 7, 10);
      g.fillTriangle(sx+27, headCY+3, sx+33, headCY+3, sx+30, headCY+15);
    }

    this.drawFace(g, sx, headCY, this.getFaceMode());
  }

  drawFace(g, tx, cy, mode) {
    if (mode === 'scream' || mode === 'terrified') {
      g.fillStyle(0xFFFFFF); g.fillEllipse(tx-8,cy+1,13,16); g.fillEllipse(tx+8,cy+1,13,16);
      g.fillStyle(0x1C1C1C); g.fillCircle(tx-8,cy+3,5); g.fillCircle(tx+8,cy+3,5);
    } else if (mode === 'happy') {
      g.fillStyle(0x1C0A00); g.fillEllipse(tx-8,cy+3,11,6); g.fillEllipse(tx+8,cy+3,11,6);
    } else {
      g.fillStyle(0xFFFFFF); g.fillEllipse(tx-8,cy+2,11,13); g.fillEllipse(tx+8,cy+2,11,13);
      g.fillStyle(0x1C1C1C); g.fillCircle(tx-8,cy+3,4); g.fillCircle(tx+8,cy+3,4);
      g.fillStyle(0xFFFFFF); g.fillCircle(tx-6,cy+1,1.5); g.fillCircle(tx+10,cy+1,1.5);
    }

    g.lineStyle(3, 0x1C0A00);
    if (mode === 'focused') {
      g.beginPath(); g.moveTo(tx-13,cy-6);  g.lineTo(tx-3,cy-8);  g.strokePath();
      g.beginPath(); g.moveTo(tx+13,cy-6);  g.lineTo(tx+3,cy-8);  g.strokePath();
    } else if (mode === 'worried') {
      g.beginPath(); g.moveTo(tx-13,cy-8);  g.lineTo(tx-3,cy-5);  g.strokePath();
      g.beginPath(); g.moveTo(tx+13,cy-8);  g.lineTo(tx+3,cy-5);  g.strokePath();
    } else {
      g.beginPath(); g.moveTo(tx-13,cy-10); g.lineTo(tx-3,cy-7);  g.strokePath();
      g.beginPath(); g.moveTo(tx+13,cy-10); g.lineTo(tx+3,cy-7);  g.strokePath();
    }

    if (mode === 'scream') {
      g.fillStyle(0x7C3010); g.fillEllipse(tx,cy+11,14,12);
      g.fillStyle(0x1C0A00); g.fillEllipse(tx,cy+12,10,8);
    } else if (mode === 'happy') {
      g.lineStyle(3,0x7C3010); g.beginPath(); g.arc(tx,cy+6,12,0.1,Math.PI-0.1); g.strokePath();
    } else if (mode === 'worried') {
      g.lineStyle(2,0x7C3010); g.beginPath(); g.arc(tx,cy+14,6,Math.PI+0.3,-0.3); g.strokePath();
    } else {
      g.lineStyle(2,0x7C3010); g.beginPath(); g.moveTo(tx-6,cy+10); g.lineTo(tx+6,cy+10); g.strokePath();
    }
  }

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
    g.fillStyle(0xFFFFFF,0.3); g.fillEllipse(x-4, y-2, 10, 6);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  setupHUD(W, H) {
    const lv = this.levelConfig;
    this.add.rectangle(W/2, 0, W, 44, 0x000000, 0.55).setOrigin(0.5,0);
    this.add.text(W/2, 22, 'THE BOULDER KING', { fontSize:'20px', fontFamily:'Arial Black', color:'#FF6B35' }).setOrigin(0.5);
    this.timerText = this.add.text(20, 22, '⏱ 0:00', { fontSize:'16px', fontFamily:'Arial', color:'#ffffff' }).setOrigin(0,0.5);
    this.add.text(W-20, 22, lv.grade, { fontSize:'22px', fontFamily:'Arial Black', color:hex(lv.color) }).setOrigin(1,0.5);

    this.add.rectangle(0, H, W, 44, 0x000000, 0.55).setOrigin(0,1);
    [{ key:'Q',label:'Hand L',col:'#60A5FA' },{ key:'E',label:'Hand R',col:'#60A5FA' },
     { key:'Z',label:'Foot L',col:'#FB923C' },{ key:'X',label:'Foot R',col:'#FB923C' }]
    .forEach((c,i) => this.add.text(W/2-185+i*122, H-22, `[${c.key}] ${c.label}`, {
      fontSize:'13px', fontFamily:'Arial Black', color:c.col,
    }).setOrigin(0,0.5));

    this.add.text(W-120, H-30, 'PUMP', { fontSize:'10px', fontFamily:'Arial Black', color:'#FF6B35' }).setOrigin(0,0.5);
    this.add.rectangle(W-120, H-16, 104, 10, 0x333333).setOrigin(0,0.5);
    this.pumpFill = this.add.rectangle(W-119, H-16, 2, 8, 0x22C55E).setOrigin(0,0.5);
  }

  updateHUD() {
    const s = Math.floor(this.elapsed);
    this.timerText.setText(`⏱ ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`);
    this.pumpFill.width = Math.max(2, this.pump * 1.02);
    this.pumpFill.setFillStyle(this.pump < 50 ? 0x22C55E : this.pump < 80 ? 0xF59E0B : 0xEF4444);
  }
}
