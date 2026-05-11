import { GRADE_PARAMS, LEVEL_ORDER, generateLevel, getSessionSeed } from '../utils/levelGenerator.js';
import { OUTFITS }                                       from '../config/outfits.js';
import { getOutfit, markComplete, checkOutfitUnlock }   from '../utils/storage.js';
import { playGrab, playRelease, playFall, playSplat,
         playWin, playHeartbeat }                        from '../utils/sounds.js';

// Keep LEVELS alias for MainMenuScene compat (storage.js uses LEVEL_ORDER only)
const LEVELS = GRADE_PARAMS;

// ── Fixed limb lengths (px at cs=1 / 720p baseline) ──────────────────────────
// These are PHYSICAL constants — arms/legs never stretch beyond these.
// Reach radius in gameplay = same value (physics matches visuals exactly).
const ARM_LENGTH  = 145;
const FOOT_LENGTH = 115;

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
    try { this._create(); }
    catch (err) {
      console.error('GameScene.create() ERROR:', err);
      this.add.text(this.scale.width/2, this.scale.height/2,
        'ERROR: ' + err.message, { fontSize: '18px', color: '#EF4444', wordWrap: { width: this.scale.width - 40 } }
      ).setOrigin(0.5);
    }
  }

  _create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.W = W; this.H = H;

    this.levelConfig = GRADE_PARAMS[this.scene.settings.data?.level || 'V0'];
    this.outfit      = getOutfit();
    // Character scale — everything proportional to screen height
    this.cs = Math.min(W, H) / 720;

    // Initialise before ANY Phaser callback can fire (update runs same frame as create)
    this.limbTargets       = {};
    this.limbTargetInReach = {};
    this.allReachable      = {}; // all holds each limb can reach (for visual rings)

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
    this.setupTargetLabels();
    this.updateTorsoTarget();
    this.recalcTargets();
    this.drawHoldOverlays();
    this.updateTargetLabels();
    this.drawClimber();
    this.startBetaSprayTimer();
    this.showStartHints();
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

    // ── Animate limbs ──────────────────────────────────────────────────────────
    const REACH_DUR  = 320;  // ms for a reach animation
    const RETURN_DUR = 180;
    Object.entries(this.climber.limbs).forEach(([key, limb]) => {
      if (limb.phase === 'reaching') {
        limb.t = Math.min(1, limb.t + delta / REACH_DUR);
        const ease = 1 - Math.pow(1 - limb.t, 2); // ease-out quad
        limb.x = limb.startX + (limb.targetX - limb.startX) * ease;
        limb.y = limb.startY + (limb.targetY - limb.startY) * ease;
        if (limb.t >= 1) {
          // Arrived — grab hold and recover a bit
          limb.grabbed = true;
          limb.holdId  = limb.targetHoldId;
          limb.phase   = 'idle';
          limb.t       = 0;
          this.pump    = Math.max(0, this.pump - this.levelConfig.pumpRate * 0.18);
          this.moves++;
          playGrab(this.sound.context);
          this.chalkPuff(limb.x, limb.y);
          this.showGrabText(limb.x, limb.y, key.startsWith('hand'));
          this.updateTorsoTarget();
          this.recalcTargets();
        }
      } else if (limb.phase === 'floating') {
        // Dangle toward natural hang position
        const fp = this.getFreePos(key);
        limb.x = Phaser.Math.Linear(limb.x, fp.x, 0.12);
        limb.y = Phaser.Math.Linear(limb.y, fp.y, 0.12);
      }
    });

    const pumpRate = this.computePumpRate();
    this.pump  = Math.min(100, Math.max(0, this.pump + pumpRate * dt));
    this.shakeX = this.pump > 65 ? Math.sin(Date.now() / 55) * ((this.pump - 65) / 12) : 0;

    if (!this.pumpNotif70 && this.pump > 70) { this.pumpNotif70 = true; this.showNotif('GETTING PUMPED...', '#F59E0B'); }
    if (!this.pumpNotif90 && this.pump > 90) { this.pumpNotif90 = true; this.showNotif('HOLD ON!!!', '#EF4444'); }

    if (!this.heartbeatCooldown && this.pump > 90) {
      this.heartbeatCooldown = true;
      playHeartbeat(this.sound.context);
      this.time.delayedCall(750, () => { this.heartbeatCooldown = false; });
    }

    if (this.pump >= 100) { this.startFall(); return; }
    if (this.checkWin())  { this.startWin();  return; }

    this.recalcTargets();
    this.drawHoldOverlays();
    this.updateTargetLabels();
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
    // Win = any hand grabs the TOP hold (last in holds array)
    const topId = this.holds[this.holds.length - 1]?.id;
    if (!topId) return false;
    return ['handL','handR'].some(k =>
      this.climber.limbs[k].grabbed && this.climber.limbs[k].holdId === topId
    );
  }

  startFall() {
    this.state     = 'falling';
    this.fallTimer = 0; this.fallVel = 0; this.fallPhase = 0; this.hasLanded = false;
    Object.values(this.climber.limbs).forEach(l => { l.grabbed = false; l.holdId = null; l.phase = 'floating'; });
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

    const lv       = this.levelConfig;
    const s        = Math.floor(this.elapsed);
    const optMoves = (lv.sequence?.length || 7) + 1;

    // Three components, each 0–100 — total 0–300
    const pumpScore = Math.round((1 - this.pump / 100) * 100);
    const moveScore = Math.max(0, 100 - Math.max(0, this.moves - optMoves) * 10);
    const timeScore = Math.max(0, 100 - s * 2);
    const totalScore = pumpScore + moveScore + timeScore;
    const score = Math.round(totalScore / 300 * 1000);

    // Check outfit unlock BEFORE marking complete (markComplete changes state)
    const newOutfitId = checkOutfitUnlock(lv.grade);
    markComplete(lv.grade, score);

    if (newOutfitId) {
      const delay = 400;
      this.time.delayedCall(delay, () => {
        this.showNotif(`✨ ${OUTFITS[newOutfitId].name} UNLOCKED!`, '#F59E0B');
      });
    }

    this.time.delayedCall(newOutfitId ? 1800 : 200, () => this.showWin(score, totalScore));
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

  showWin(score = 500, totalScore = 150) {
    const W = this.W; const H = this.H;
    const lv    = this.levelConfig;
    const s     = Math.floor(this.elapsed);
    const mm    = String(Math.floor(s/60)).padStart(2,'0');
    const ss    = String(s%60).padStart(2,'0');

    // Stars from combined score (pump 0–100 + moves 0–100 + time 0–100 = 0–300)
    const stars = totalScore >= 240 ? '⭐⭐⭐' : totalScore >= 160 ? '⭐⭐' : '⭐';

    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.72).setOrigin(0.5);
    this.add.text(W/2, H*0.11, '👑', { fontSize: '72px' }).setOrigin(0.5);
    this.add.text(W/2, H*0.24, 'SEND IT!!!', {
      fontSize: '52px', fontFamily: 'Arial Black', color: '#FF6B35',
      stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.36, lv.winMsg, {
      fontSize: '16px', fontFamily: 'Arial', color: '#9CA3AF', align: 'center',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.47, `SCORE: ${score}`, {
      fontSize: '30px', fontFamily: 'Arial Black', color: '#FFFFFF',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.55, `${lv.grade}  •  ${mm}:${ss}  •  ${this.moves} moves`, {
      fontSize: '14px', fontFamily: 'Arial', color: '#9CA3AF',
    }).setOrigin(0.5);
    this.add.text(W/2, H*0.62, stars, { fontSize: '34px' }).setOrigin(0.5);
    this.add.text(W/2, H*0.69,
      totalScore >= 240 ? 'Clean send!' : totalScore >= 160 ? 'Solid effort' : 'Barely made it!',
      { fontSize: '13px', fontFamily: 'Arial', color: '#6B7280' }).setOrigin(0.5);

    // Row 1: RETRY + NEXT or MAIN MENU
    const nextKey = LEVEL_ORDER[LEVEL_ORDER.indexOf(lv.grade) + 1];
    this.makeButton(W/2 - 92, H*0.78, 'RETRY', '#FF6B35', () => this.scene.restart());
    if (nextKey) {
      this.makeButton(W/2 + 92, H*0.78, `NEXT: ${nextKey}`, hex(LEVELS[nextKey].color),
        () => this.scene.start('GameScene', { level: nextKey }));
    } else {
      this.makeButton(W/2 + 92, H*0.78, 'MAIN MENU', '#6B7280',
        () => this.scene.start('MainMenuScene'));
    }

    // Row 2: MAIN MENU (if there's a next) + SHARE
    if (nextKey) {
      this.makeButton(W/2 - 92, H*0.88, 'MAIN MENU', '#6B7280',
        () => this.scene.start('MainMenuScene'));
    }
    this.makeButton(nextKey ? W/2 + 92 : W/2, H*0.88, '📤 SHARE', '#22C55E',
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
      ? 'https://the-boulder-king.vercel.app'  // update after deploy
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
    this.input.keyboard.on('keydown-Q',      () => this.moveLimb('handL'));
    this.input.keyboard.on('keydown-E',      () => this.moveLimb('handR'));
    this.input.keyboard.on('keydown-Z',      () => this.moveLimb('footL'));
    this.input.keyboard.on('keydown-X',      () => this.moveLimb('footR'));
    this.input.keyboard.on('keydown-H',      () => this.triggerHint());
    this.input.keyboard.on('keydown-ESC',    () => this.showMenuConfirm());
  }

  showMenuConfirm() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    const W = this.W, H = this.H;

    const el = [
      this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.76).setOrigin(0.5),
      this.add.text(W/2, H*0.38, 'ABANDON ATTEMPT?', {
        fontSize: '32px', fontFamily: 'Arial Black', color: '#FFFFFF',
        stroke: '#000', strokeThickness: 5,
      }).setOrigin(0.5),
      this.add.text(W/2, H*0.50, 'Progress and time will be lost', {
        fontSize: '14px', fontFamily: 'Arial', color: '#6B7280',
      }).setOrigin(0.5),
    ];

    const resume = () => { el.forEach(e => e.destroy()); this.state = 'playing'; };

    const cont = this.add.text(W/2 + 90, H*0.63, '[ CONTINUE ]', {
      fontSize: '18px', fontFamily: 'Arial Black', color: '#22C55E',
      backgroundColor: '#111827', padding: { x:14, y:8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    cont.on('pointerover', () => cont.setColor('#FFFFFF'));
    cont.on('pointerout',  () => cont.setColor('#22C55E'));
    cont.on('pointerdown', resume);
    el.push(cont);

    const quit = this.add.text(W/2 - 90, H*0.63, '[ QUIT ]', {
      fontSize: '18px', fontFamily: 'Arial Black', color: '#EF4444',
      backgroundColor: '#111827', padding: { x:14, y:8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    quit.on('pointerover', () => quit.setColor('#FFFFFF'));
    quit.on('pointerout',  () => quit.setColor('#EF4444'));
    quit.on('pointerdown', () => this.scene.start('MainMenuScene'));
    el.push(quit);

    this.add.text(W/2, H*0.74, 'or press  ESC  to resume', {
      fontSize: '12px', fontFamily: 'Arial', color: '#374151',
    }).setOrigin(0.5);
    this.input.keyboard.once('keydown-ESC', resume);
  }

  triggerHint() { /* removed — animation is the hint */ }

  moveLimb(key) {
    if (this.state !== 'playing') return;
    const limb   = this.climber.limbs[key];
    const isHand = key.startsWith('hand');
    const ctx    = this.sound.context;
    // Can't start a new move while already reaching
    if (limb.phase === 'reaching') return;

    const target = this.getBestTarget(key);
    if (!target) {
      // Nothing reachable — nudge the limb visually + tell player to reposition
      this.cameras.main.shake(100, 0.004);
      this.pump = Math.min(100, this.pump + this.levelConfig.pumpRate * 0.15);

      // Check if ALL limbs have no target (completely stuck)
      const allStuck = ['handL','handR','footL','footR'].every(k => !this.getBestTarget(k));
      const msg = allStuck ? 'MOVE FEET UP FIRST' : 'OUT OF REACH';
      const tx = limb.x, ty = limb.y;
      const hint = this.add.text(tx, ty - 24, msg, {
        fontSize: '13px', fontFamily: 'Arial Black',
        color: allStuck ? '#EF4444' : '#FB923C',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5);
      this.tweens.add({ targets: hint, y: ty - 52, alpha: 0, duration: 700, onComplete: () => hint.destroy() });
      return;
    }

    // Release current hold and begin animated reach
    limb.grabbed       = false;
    limb.holdId        = null;
    limb.phase         = 'reaching';
    limb.t             = 0;
    limb.startX        = limb.x;
    limb.startY        = limb.y;
    limb.targetX       = target.x;
    limb.targetY       = target.y;
    limb.targetHoldId  = target.id;
    // Pump cost for the attempt (effort of releasing and reaching)
    this.pump = Math.min(100, this.pump + this.levelConfig.pumpRate * 0.25);
    playRelease(ctx);
    this.updateTorsoTarget();
    this.recalcTargets();
    this.chalkPuff(target.x, target.y);
    this.showGrabText(target.x, target.y, isHand);
    this.updateTorsoTarget();
    this.recalcTargets();
  }

  // Best reachable hold for this limb — closest unoccupied hold above current position
  getBestTarget(key) {
    const limb    = this.climber.limbs[key];
    const isHand  = key.startsWith('hand');
    // Reach = physical limb length × character scale. Matches drawClimber clamping exactly.
    const reach   = (isHand ? ARM_LENGTH : FOOT_LENGTH) * this.cs;
    const anchor  = this.getLimbAnchor(key);
    const occupied = Object.entries(this.climber.limbs)
      .filter(([k, l]) => k !== key && (l.grabbed || l.phase === 'reaching'))
      .map(([, l]) => l.holdId ?? l.targetHoldId);

    const currentY = limb.y;
    const candidates = this.allHolds
      .filter(h => !occupied.includes(h.id) && h.id !== limb.holdId)
      .filter(h => Phaser.Math.Distance.Between(anchor.x, anchor.y, h.x, h.y) <= reach);

    if (!candidates.length) return null;

    // Primary: holds above OR at same level (up to 40px below = allows lateral/back moves)
    // Fallback: any direction — enables full backtracking when player needs to reroute
    const preferredPool = candidates.filter(h => h.y < currentY + 40);
    const pool = preferredPool.length ? preferredPool : candidates;
    return pool.sort((a, b) =>
      Phaser.Math.Distance.Between(anchor.x, anchor.y, a.x, a.y) -
      Phaser.Math.Distance.Between(anchor.x, anchor.y, b.x, b.y)
    )[0];
  }

  updateTorsoTarget() {
    const L     = this.climber.limbs;
    const hands = ['handL','handR'].filter(k => L[k].grabbed).map(k => L[k]);
    const feet  = ['footL','footR'].filter(k => L[k].grabbed).map(k => L[k]);
    if (!hands.length && !feet.length) return;

    let tx, ty;
    if (hands.length) {
      const hx = hands.reduce((s,h) => s+h.x,0) / hands.length;
      const hy = hands.reduce((s,h) => s+h.y,0) / hands.length;
      if (feet.length) {
        const fx = feet.reduce((s,f) => s+f.x,0) / feet.length;
        const fy = feet.reduce((s,f) => s+f.y,0) / feet.length;
        // 50/50 — feet are load-bearing, they constrain the torso
        tx = hx * 0.50 + fx * 0.50;
        ty = (hy + 0.072 * this.H) * 0.50 + (fy - 0.108 * this.H) * 0.50;
      } else {
        tx = hx;
        ty = hy + 0.072 * this.H;
      }
    } else {
      tx = feet.reduce((s,f) => s+f.x,0) / feet.length;
      ty = feet.reduce((s,f) => s+f.y,0) / feet.length - 0.108 * this.H;
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

  // ── Pump rate (per second) ─────────────────────────────────────────────────
  // Simple state-based model — three foot conditions, danger zone for no hands
  computePumpRate() {
    const L  = this.climber.limbs;
    const pr = this.levelConfig.pumpRate;
    const handsGrabbed  = ['handL','handR'].filter(k => L[k].grabbed).length;
    const feetGrabbed   = ['footL','footR'].filter(k => L[k].grabbed).length;
    const handsReaching = ['handL','handR'].filter(k => L[k].phase === 'reaching').length;

    if (handsGrabbed + handsReaching === 0) return pr * 2.0; // no hands = danger

    // base rate by foot position
    const base = pr * (0.20 + (2 - feetGrabbed) * 0.20);
    // extra strain while arm is extended mid-reach
    const reachStrain = handsReaching * pr * 0.55;
    return base + reachStrain;
  }

  // Shoulder/hip anchor — proportional so it works at any screen size
  getLimbAnchor(key) {
    const tx = this.climber.torso.x, ty = this.climber.torso.y;
    // Anchor offsets match generator (0.048H, 0.016*aspect, etc.) — scale with cs
    const sh = this.H * 0.048, sw = this.W * 0.016;
    const hh = this.H * 0.038, hw = this.W * 0.011;
    return {
      handL: { x: tx - sw, y: ty - sh },
      handR: { x: tx + sw, y: ty - sh },
      footL: { x: tx - hw, y: ty + hh },
      footR: { x: tx + hw, y: ty + hh },
    }[key];
  }

  // Recalculate best targets for idle/floating limbs (used only for updateTargetLabels)
  recalcTargets() {
    if (this.state !== 'playing') return;
    this.limbTargets = {};
    Object.keys(this.climber.limbs).forEach(key => {
      const limb = this.climber.limbs[key];
      if (limb.phase === 'idle' || limb.phase === 'floating') {
        this.limbTargets[key] = this.getBestTarget(key);
      }
    });
  }

  // Floating key-badge labels that hover above the target hold
  setupTargetLabels() {
    const cfgs = [
      { key:'handL', label:'Q', color:'#60A5FA' },
      { key:'handR', label:'E', color:'#60A5FA' },
      { key:'footL', label:'Z', color:'#FB923C' },
      { key:'footR', label:'X', color:'#FB923C' },
    ];
    this.targetLabels = {};
    cfgs.forEach(({ key, label, color }) => {
      this.targetLabels[key] = this.add.text(-999, -999, label, {
        fontSize: '13px', fontFamily: 'Arial Black', color,
        backgroundColor: 'rgba(0,0,0,0.72)',
        padding: { x: 6, y: 4 },
      }).setOrigin(0.5).setDepth(10);
    });
  }

  updateTargetLabels() {
    // No labels — physical animation is the feedback
    Object.values(this.targetLabels || {}).forEach(l => l.setVisible(false));
  }

  // First-play tutorial hints (V0 only, shown once)
  showStartHints() {
    if (this.levelConfig.grade !== 'V0') return;
    if (localStorage.getItem('bk_hints_done')) return;
    localStorage.setItem('bk_hints_done', '1');

    const W = this.W, H = this.H;
    const style = { fontFamily: 'Arial Black', stroke: '#000', strokeThickness: 4 };

    const hints = [
      this.add.text(W/2, H*0.28,
        'Colored rings show where each limb will go',
        { ...style, fontSize:'18px', color:'#FFFFFF' }).setOrigin(0.5).setAlpha(0).setDepth(20),
      this.add.text(W/2, H*0.35,
        'Q / E = hands  •  Z / X = feet',
        { ...style, fontSize:'16px', color:'#60A5FA' }).setOrigin(0.5).setAlpha(0).setDepth(20),
      this.add.text(W/2, H*0.42,
        'Keep at least 3 limbs on holds or you\'ll pump out!',
        { ...style, fontSize:'14px', color:'#F59E0B' }).setOrigin(0.5).setAlpha(0).setDepth(20),
    ];

    hints.forEach((t, i) => {
      this.tweens.add({ targets: t, alpha: 1, duration: 400, delay: i * 600 });
    });
    // Fade out after 5s or on first key press
    const fade = () => hints.forEach(t => this.tweens.add({ targets: t, alpha: 0, duration: 500, onComplete: () => t.destroy() }));
    this.time.delayedCall(5000, fade);
    this.input.keyboard.once('keydown', fade);
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
  }

  setupHolds(W, H) {
    const seed = getSessionSeed();
    const gen  = generateLevel(this.levelConfig.grade, W / H, seed);
    // Inject generated beta and holds back into levelConfig (for checkWin etc.)
    this.levelConfig = { ...this.levelConfig, ...gen, beta: gen.beta };

    this.holds     = gen.holds.map(h => ({...h, x:h.xr*W, y:h.yr*H}));
    this.footHolds = gen.footHolds.map(h => ({...h, x:h.xr*W, y:h.yr*H}));
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
    const limbs = this.climber.limbs;

    // Always show white rings on currently grabbed holds
    Object.values(limbs).filter(l => l.grabbed).forEach(limb => {
      const hold = this.allHolds.find(h => h.id === limb.holdId);
      if (!hold) return;
      g.lineStyle(3, 0xFFFFFF, 0.9); g.strokeEllipse(hold.x, hold.y, 56, 38);
      g.lineStyle(2, 0xFFFFFF, 0.3); g.strokeEllipse(hold.x, hold.y, 66, 46);
    });

    // No overlay rings — the animated limb itself IS the visual feedback
  }

  // ── Climber ─────────────────────────────────────────────────────────────────

  createClimber(W, H) {
    const sl = this.holds[0]; const sr = this.holds[1];
    const fl = this.footHolds[0]; const fr = this.footHolds[1];
    const mkLimb = (h) => ({
      x: h.x, y: h.y, grabbed: true, holdId: h.id,
      // animation state
      phase: 'idle',       // idle | reaching | returning | floating
      startX: h.x, startY: h.y,
      targetX: h.x, targetY: h.y,
      targetHoldId: null,
      t: 0,                // 0→1 animation progress
    });
    this.climber = {
      torso: { x:(sl.x+sr.x)/2, y:(sl.y+fl.y)/2-10 },
      torsoTarget: null,
      limbs: {
        handL: mkLimb(sl), handR: mkLimb(sr),
        footL: mkLimb(fl), footR: mkLimb(fr),
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

    const cs  = this.cs;
    const headCY = sy-58*cs, neckY=sy-36*cs, shldrY=sy-26*cs;
    const shldrLX=sx-20*cs, shldrRX=sx+20*cs, hipY=sy+26*cs, hipLX=sx-14*cs, hipRX=sx+14*cs;
    const SKIN=0xC8845A, SHIRT=this.outfit.shirt, SHORT=0x1E293B, SHOE=this.outfit.shoe, SOLE=this.outfit.sole, LW=15*cs;

    // ── Clamp limb endpoints to fixed physical length ────────────────────────
    // Arms and legs NEVER stretch beyond ARM_LENGTH / FOOT_LENGTH.
    // This is the core physics constraint: reach is determined by body position.
    const AL = ARM_LENGTH  * cs;
    const FL = FOOT_LENGTH * cs;
    const clamp = (ax, ay, bx, by, maxLen) => {
      const dx = bx-ax, dy = by-ay;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      if (d <= maxLen) return { x: bx, y: by };
      const r = maxLen / d;
      return { x: ax + dx*r, y: ay + dy*r };
    };
    const HR = clamp(shldrRX, shldrY, limbs.handR.x, limbs.handR.y, AL);
    const HL = clamp(shldrLX, shldrY, limbs.handL.x, limbs.handL.y, AL);
    const FR = clamp(hipRX, hipY, limbs.footR.x, limbs.footR.y, FL);
    const FL2= clamp(hipLX, hipY, limbs.footL.x, limbs.footL.y, FL);

    this.drawLimb(g, shldrRX, shldrY, HR.x, HR.y, SKIN, LW-cs,  1);
    g.fillStyle(SKIN); g.fillCircle(HR.x, HR.y, 8*cs);
    this.drawLimb(g, hipRX, hipY, FR.x, FR.y, SKIN, LW+cs, -1);
    this.drawShoe(g, FR.x, FR.y, SHOE, SOLE, cs);

    g.fillStyle(SHIRT); g.fillRoundedRect(sx-22*cs, shldrY, 44*cs, hipY-shldrY+6*cs, {tl:10*cs,tr:10*cs,bl:4*cs,br:4*cs});
    g.fillStyle(0x000000,0.08); g.fillEllipse(sx, shldrY+4*cs, 28*cs, 10*cs);
    g.fillStyle(SHORT); g.fillRoundedRect(sx-20*cs, hipY-2*cs, 40*cs, 26*cs, {tl:4*cs,tr:4*cs,bl:8*cs,br:8*cs});
    g.lineStyle(2, 0x0F172A, 0.5); g.beginPath(); g.moveTo(sx-20*cs,hipY-2*cs); g.lineTo(sx+20*cs,hipY-2*cs); g.strokePath();

    this.drawLimb(g, hipLX, hipY, FL2.x, FL2.y, SKIN, LW+cs, 1);
    this.drawShoe(g, FL2.x, FL2.y, SHOE, SOLE, cs);
    this.drawLimb(g, shldrLX, shldrY, HL.x, HL.y, SKIN, LW-cs, -1);
    g.fillStyle(SKIN); g.fillCircle(HL.x, HL.y, 8*cs);

    g.fillStyle(0xF1F5F9); g.fillEllipse(sx+26*cs, sy+10*cs, 18*cs, 22*cs);
    g.lineStyle(2,0xCBD5E1); g.strokeEllipse(sx+26*cs, sy+10*cs, 18*cs, 22*cs);
    g.fillStyle(0xFFFFFF,0.6); g.fillCircle(sx+26*cs, sy+2*cs, 5*cs);

    g.fillStyle(SKIN); g.fillRoundedRect(sx-7*cs, neckY, 14*cs, 18*cs, 4*cs); g.fillCircle(sx, headCY, 24*cs);
    g.fillStyle(0x1C0A00); g.fillEllipse(sx, headCY-10*cs, 44*cs, 26*cs); g.fillCircle(sx-20*cs, headCY-2*cs, 9*cs); g.fillCircle(sx+20*cs, headCY-2*cs, 9*cs);
    g.fillStyle(SKIN); g.fillCircle(sx-23*cs, headCY+4*cs, 7*cs); g.fillCircle(sx+23*cs, headCY+4*cs, 7*cs);

    if (this.pump > 60 && this.state === 'playing') {
      const a = Math.min(1, (this.pump-60)/35);
      g.fillStyle(0x93C5FD, a); g.fillEllipse(sx+30*cs, headCY+8*cs, 7*cs, 10*cs);
      g.fillTriangle(sx+27*cs, headCY+3*cs, sx+33*cs, headCY+3*cs, sx+30*cs, headCY+15*cs);
    }

    this.drawFace(g, sx, headCY, this.getFaceMode(), cs);
  }

  drawFace(g, tx, cy, mode, cs = 1) {
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

  drawShoe(g, x, y, color, sole, cs = 1) {
    g.fillStyle(sole); g.fillEllipse(x+2*cs, y+8*cs, 28*cs, 10*cs);
    g.fillStyle(color); g.fillEllipse(x, y+2*cs, 26*cs, 14*cs);
    g.fillRoundedRect(x-13*cs, y-4*cs, 26*cs, 12*cs, 4*cs);
    g.fillStyle(0xFFFFFF,0.3); g.fillEllipse(x-4*cs, y-2*cs, 10*cs, 6*cs);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  setupHUD(W, H) {
    const lv = this.levelConfig;
    // ≡ menu button — top left
    const menuBtn = this.add.text(16, 22, '≡', {
      fontSize: '22px', fontFamily: 'Arial Black', color: '#6B7280',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    menuBtn.on('pointerover', () => menuBtn.setColor('#FFFFFF'));
    menuBtn.on('pointerout',  () => menuBtn.setColor('#6B7280'));
    menuBtn.on('pointerdown', () => this.showMenuConfirm());

    this.timerText = this.add.text(46, 22, '⏱ 0:00', { fontSize:'15px', fontFamily:'Arial', color:'#9CA3AF' }).setOrigin(0,0.5);
    this.add.text(W-20, 22, lv.grade, { fontSize:'22px', fontFamily:'Arial Black', color:hex(lv.color) }).setOrigin(1,0.5);

    this.add.rectangle(0, H, W, 44, 0x000000, 0.55).setOrigin(0,1);
    [{ key:'Q',label:'Hand L',col:'#60A5FA' },{ key:'E',label:'Hand R',col:'#60A5FA' },
     { key:'Z',label:'Foot L',col:'#FB923C' },{ key:'X',label:'Foot R',col:'#FB923C' }]
    .forEach((c,i) => this.add.text(W/2-200+i*122, H-22, `[${c.key}] ${c.label}`, {
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
