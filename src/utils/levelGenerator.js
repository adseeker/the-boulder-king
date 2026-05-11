/**
 * Procedural level generator for The Boulder King.
 *
 * Each call with the same (grade, seed, aspectRatio) returns the same level.
 * Different seeds = different hold positions, identical difficulty characteristics.
 *
 * Physics model (all distances in "H-units", where 1 unit = 1px of screen height):
 *   position.x_h = xr * (W/H) = xr * aspect
 *   position.y_h = yr
 *   distance_h   = sqrt((Δxr * aspect)² + (Δyr)²)
 *
 * ARM_REACH and FOOT_REACH are fractions of H. At any screen size:
 *   arm_px = ARM_REACH * H  (proportional arm length, matches character scale)
 */

// ── Seeded RNG (Mulberry32) ────────────────────────────────────────────────────

function rng32(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

export function getSessionSeed() {
  let s = sessionStorage.getItem('bk_seed');
  if (!s) {
    s = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
    sessionStorage.setItem('bk_seed', s);
  }
  return parseInt(s);
}

// ── Grade parameters ────────────────────────────────────────────────────────────
// armReach, footReach: fraction of screen height
// sequence: ordered limb moves (handL/handR/footL/footR)
// sideRange: max horizontal spread for generated holds (in xr units each side)
// vertStep:  preferred vertical step size between hand holds (in yr units)

const HOLD_COLORS_L = [0xA855F7, 0xEF4444, 0x3B82F6];
const HOLD_COLORS_R = [0xEF4444, 0xA855F7, 0xF97316];

export const GRADE_PARAMS = {
  V0: {
    grade:'V0', name:'Warm-Up', tagline:'Big holds, chill vibes.',
    difficulty:'🟢 Easy', color:0x22C55E, holdScale:1.00,
    pumpRate:4,
    armReach:0.34, footReach:0.24,
    sideRange:0.13, vertStep:0.15,
    sequence:['handL','footL','handR','footR','handL','footL','handR'],
    gameoverMsgs:['PUMPED OUT!','THAT WAS A V0, BY THE WAY...','HAVE YOU TRIED USING YOUR FEET?','YOUR FOREARMS HAVE LEFT THE CHAT','GRAVITY: 1 — YOU: 0'],
    winMsg:"The bar is low and you cleared it.\nBut hey — it counts.",
  },
  V2: {
    grade:'V2', name:'Getting Serious', tagline:'Some crossing, some swearing.',
    difficulty:'🟡 Medium', color:0xF59E0B, holdScale:0.85,
    pumpRate:6,
    armReach:0.33, footReach:0.23,
    sideRange:0.17, vertStep:0.14,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!',"BETA SPRAY DIDN'T HELP, HUH?",'TRY THE SEQUENCE AGAIN. SLOWLY.','YOUR FOREARMS FILED FOR DIVORCE','THE WALL IS LAUGHING. I CAN HEAR IT.'],
    winMsg:"Now you're climbing.\nSomeone call Chris Sharma.",
  },
  V4: {
    grade:'V4', name:'Pain Cave', tagline:'Your forearms will hate you.',
    difficulty:'🔴 Hard', color:0xEF4444, holdScale:0.72,
    pumpRate:8.5,
    armReach:0.32, footReach:0.22,
    sideRange:0.20, vertStep:0.13,
    sequence:['handL','footL','handR','footR','handL','handR','footL','handR','footR'],
    gameoverMsgs:['PUMPED OUT!','HONESTLY, RESPECT FOR TRYING.','THE DYNO SAID NO.','FOREARMS = COOKED. WELL DONE.',"HAVE YOU CONSIDERED YOGA INSTEAD?"],
    winMsg:"ABSOLUTE UNIT. 💪\nThe boulder bows to you.",
  },
  V6: {
    grade:'V6', name:'The Project', tagline:"You've been staring at this for weeks.",
    difficulty:'🟠 Very Hard', color:0xF97316, holdScale:0.62,
    pumpRate:12,
    armReach:0.31, footReach:0.22,
    sideRange:0.22, vertStep:0.12,
    sequence:['handL','footL','handR','footR','handL','footL','handR','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!','EVEN THE HOLDS ARE JUDGING YOU.','THIS IS YOUR PROJECT NOW. FOREVER.','SPAGHETTI ARMS DETECTED.','THE SEQUENCE WAS RIGHT THERE...'],
    winMsg:"PROJECT SENT.\nYou may now talk about this at every dinner.",
  },
  V8: {
    grade:'V8', name:'Crimpers Only', tagline:'Your tendons just cried a little.',
    difficulty:'🔴 Extreme', color:0xDC2626, holdScale:0.54,
    pumpRate:15,
    armReach:0.30, footReach:0.21,
    sideRange:0.24, vertStep:0.11,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','footL','handR','handR'],
    gameoverMsgs:['PUMPED OUT!','YOUR TENDONS HAVE FILED A COMPLAINT.','DOCTORS HATE THIS ROUTE.','THAT WAS ACTUALLY IMPRESSIVE. STILL FELL THOUGH.','MINIMUM 2 YEARS TRAINING REQUIRED.'],
    winMsg:"V8?! WHO ARE YOU?!\nSeriously, who are you.",
  },
  V10: {
    grade:'V10', name:'The Dream', tagline:'Bold of you to try.',
    difficulty:'⚫ Legendary', color:0x7C3AED, holdScale:0.46,
    pumpRate:20,
    armReach:0.29, footReach:0.20,
    sideRange:0.26, vertStep:0.10,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','footL','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!','THIS IS A V10. WHAT DID YOU EXPECT.','BOLD STRATEGY. ZERO EXECUTION.','RESPECT. ALSO: LOL.','THE WALL SENDS ITS CONDOLENCES.'],
    winMsg:"YOU ARE THE BOULDER KING.\n👑 Bow. Everyone bow. 👑",
  },
};

export const LEVEL_ORDER = ['V0','V2','V4','V6','V8','V10'];

// ── Torso simulation (must match GameScene.updateTorsoTarget) ─────────────────

function simTorso(state, aspect) {
  const hands = ['handL','handR'].map(k => state[k]);
  const feet  = ['footL','footR'].map(k => state[k]);
  const hx = (hands[0].xr + hands[1].xr) / 2;
  const hy = (hands[0].yr + hands[1].yr) / 2;
  const fx = (feet[0].xr  + feet[1].xr)  / 2;
  const fy = (feet[0].yr  + feet[1].yr)  / 2;
  // 50/50 hand/foot influence (matches updated GameScene formula)
  return {
    xr: hx * 0.50 + fx * 0.50,
    yr: (hy + 0.072) * 0.50 + (fy - 0.108) * 0.50,
  };
}

// Shoulder/hip anchor in xr/yr space (must match GameScene.getLimbAnchor)
function anchor(torso, key, aspect) {
  const sh = 0.048, sw = 0.016 * aspect; // same fractions as GameScene
  const hh = 0.038, hw = 0.011 * aspect;
  return {
    handL: { xr: torso.xr - sw, yr: torso.yr - sh },
    handR: { xr: torso.xr + sw, yr: torso.yr - sh },
    footL: { xr: torso.xr - hw, yr: torso.yr + hh },
    footR: { xr: torso.xr + hw, yr: torso.yr + hh },
  }[key];
}

// Distance in H-units between two (xr,yr) positions
function dist_h(a, b, aspect) {
  const dx = (a.xr - b.xr) * aspect;
  const dy = (a.yr - b.yr);
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Position sampler ───────────────────────────────────────────────────────────

function samplePosition(anc, reach_h, prevPos, sideRange, isLeft, rng, aspect) {
  const MAX_TRIES = 40;

  for (let t = 0; t < MAX_TRIES; t++) {
    // Random angle biased upward (toward -π/2 on unit circle = "up on screen")
    const rawAngle  = rng() * Math.PI * 2;
    const upBias    = 0.72 + (t / MAX_TRIES) * 0.20; // increase bias on retry
    const angle     = rawAngle * (1 - upBias) + (-Math.PI / 2) * upBias;

    // Distance: 55–92% of reach
    const d = reach_h * (0.55 + rng() * 0.37);

    // Horizontal spread bias: left limbs prefer left, right prefer right
    const sideBonus = (isLeft ? -1 : 1) * sideRange * rng() * 0.5;

    const candidate = {
      xr: anc.xr + (Math.cos(angle) * d) / aspect + sideBonus,
      yr: anc.yr + Math.sin(angle) * d,  // negative sin = up on screen
    };

    // Must be above previous hold for this limb
    if (candidate.yr >= prevPos.yr - 0.03) continue;

    // Must be within wall bounds
    if (candidate.xr < 0.07 || candidate.xr > 0.93) continue;
    if (candidate.yr < 0.06 || candidate.yr > 0.80) continue;

    // Verify actual distance from anchor (primary constraint)
    if (dist_h(anc, candidate, aspect) > reach_h * 1.05) continue;

    return candidate;
  }

  // Fallback: place directly above anchor within safe distance
  return {
    xr: Math.max(0.10, Math.min(0.90, anc.xr + (isLeft ? -1 : 1) * sideRange * 0.3)),
    yr: Math.max(0.08, anc.yr - reach_h * 0.65),
  };
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generateLevel(grade, aspect, seed) {
  const p   = GRADE_PARAMS[grade];
  const rng = rng32(seed ^ (grade.charCodeAt(0) * 31));

  const holds     = [];
  const footHolds = [];
  const beta      = { handL:[], handR:[], footL:[], footR:[] };

  // ── Start holds (center, bottom) ────────────────────────────────────────────
  const sx = 0.50, sy = 0.82;
  const spread = 0.06 + rng() * 0.03; // slight variation in start spread

  holds.push({ id:'h0', xr:sx-spread, yr:sy,      color:0x22C55E, label:'START' });
  holds.push({ id:'h1', xr:sx+spread, yr:sy,      color:0x22C55E, label:'START' });
  footHolds.push({ id:'f0', xr:sx-spread*0.7, yr:sy+0.06, color:0x6B7280 });
  footHolds.push({ id:'f1', xr:sx+spread*0.7, yr:sy+0.06, color:0x6B7280 });

  beta.handL.push('h0'); beta.handR.push('h1');
  beta.footL.push('f0'); beta.footR.push('f1');

  const state = {
    handL: { xr:holds[0].xr,     yr:holds[0].yr     },
    handR: { xr:holds[1].xr,     yr:holds[1].yr     },
    footL: { xr:footHolds[0].xr, yr:footHolds[0].yr },
    footR: { xr:footHolds[1].xr, yr:footHolds[1].yr },
  };

  // ── Generate each move ───────────────────────────────────────────────────────
  let colorIdxL = 0, colorIdxR = 0;

  for (const move of p.sequence) {
    const isHand = move.startsWith('hand');
    const isLeft = move.endsWith('L');
    const reach  = isHand ? p.armReach : p.footReach;

    const torso  = simTorso(state, aspect);
    const anc    = anchor(torso, move, aspect);
    const prevPos = state[move];

    const pos = samplePosition(anc, reach, prevPos, p.sideRange, isLeft, rng, aspect);

    if (isHand) {
      const id    = `h${holds.length}`;
      const color = isLeft ? HOLD_COLORS_L[colorIdxL++ % 3] : HOLD_COLORS_R[colorIdxR++ % 3];
      holds.push({ id, xr:pos.xr, yr:pos.yr, color });
      beta[move].push(id);
    } else {
      const id = `f${footHolds.length}`;
      footHolds.push({ id, xr:pos.xr, yr:pos.yr, color:0x6B7280 });
      beta[move].push(id);
    }

    state[move] = pos;
  }

  // ── TOP hold ─────────────────────────────────────────────────────────────────
  // Place above the highest current hand hold, centered
  const highestY = Math.min(...holds.map(h => h.yr));
  const topId = `h${holds.length}`;
  holds.push({
    id: topId,
    xr: 0.48 + rng() * 0.04,
    yr: Math.max(0.04, highestY - 0.05 - rng() * 0.03),
    color: 0xF59E0B,
    label: 'TOP',
  });

  // Both hands route ends at TOP — first one to grab it wins
  beta.handL.push(topId);
  beta.handR.push(topId);

  return { holds, footHolds, beta };
}
