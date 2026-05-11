/**
 * Procedural level generator — The Boulder King.
 *
 * Guarantees:
 *  - Every hold in the beta sequence is reachable from the previous anchor
 *  - All holds are separated by at least MIN_HOLD_DIST (no clumping)
 *  - Holds always progress UPWARD along the wall
 *  - TOP hold is reachable from the last hand positions
 *  - Left limb holds bias left, right limb holds bias right (readable route)
 *
 * Coordinate system: xr = x/W, yr = y/H (stored)
 * Distances computed in H-units: dist_h = sqrt((Δxr*aspect)² + Δyr²)
 */

// ── Seeded RNG ─────────────────────────────────────────────────────────────────

function rng32(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

export function getSessionSeed() {
  // Fresh random seed every call — different layout each play/retry
  return (Date.now() ^ (Math.random() * 0x7FFFFFFF | 0)) >>> 0;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_HOLD_DIST = 0.10; // minimum separation between any two holds (H-units)
const HOLD_COLORS_L = [0xA855F7, 0xEF4444, 0x3B82F6];
const HOLD_COLORS_R = [0xEF4444, 0xA855F7, 0xF97316];

// ── Grade parameters ────────────────────────────────────────────────────────────

// ARM_LENGTH and FOOT_LENGTH in px at cs=1 (720p baseline) — must match GameScene constants
const ARM_PX  = 145;
const FOOT_PX = 115;
// Generator uses a 22% margin above physical length so the route stays solvable
// even when the player's torso deviates from the simulated position.
const ARM_REACH  = ARM_PX  * 1.22 / 720;  // ~0.246H
const FOOT_REACH = FOOT_PX * 1.22 / 720;  // ~0.195H

export const GRADE_PARAMS = {
  V0: {
    grade:'V0', name:'Warm-Up', tagline:'Big holds, chill vibes.',
    difficulty:'🟢 Easy', color:0x22C55E, holdScale:1.00,
    pumpRate:4,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    // How far left/right holds can go (H-units each side) — must stay within armReach
    sideRange:0.11,
    // Minimum vertical step per hand hold (H-units)
    minVertStep:0.08,
    sequence:['handL','footL','handR','footR','handL','footL','handR'],
    gameoverMsgs:['PUMPED OUT!','THAT WAS A V0, BY THE WAY...','HAVE YOU TRIED USING YOUR FEET?','YOUR FOREARMS HAVE LEFT THE CHAT','GRAVITY: 1 — YOU: 0'],
    winMsg:"The bar is low and you cleared it.\nBut hey — it counts.",
  },
  V2: {
    grade:'V2', name:'Getting Serious', tagline:'Some crossing, some swearing.',
    difficulty:'🟡 Medium', color:0xF59E0B, holdScale:0.85,
    pumpRate:6,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    sideRange:0.12, minVertStep:0.08,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!',"BETA SPRAY DIDN'T HELP, HUH?",'TRY THE SEQUENCE AGAIN. SLOWLY.','YOUR FOREARMS FILED FOR DIVORCE','THE WALL IS LAUGHING. I CAN HEAR IT.'],
    winMsg:"Now you're climbing.\nSomeone call Chris Sharma.",
  },
  V4: {
    grade:'V4', name:'Pain Cave', tagline:'Your forearms will hate you.',
    difficulty:'🔴 Hard', color:0xEF4444, holdScale:0.72,
    pumpRate:8.5,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    sideRange:0.13, minVertStep:0.07,
    sequence:['handL','footL','handR','footR','handL','handR','footL','handR','footR'],
    gameoverMsgs:['PUMPED OUT!','HONESTLY, RESPECT FOR TRYING.','THE DYNO SAID NO.','FOREARMS = COOKED. WELL DONE.',"HAVE YOU CONSIDERED YOGA INSTEAD?"],
    winMsg:"ABSOLUTE UNIT. 💪\nThe boulder bows to you.",
  },
  V6: {
    grade:'V6', name:'The Project', tagline:"You've been staring at this for weeks.",
    difficulty:'🟠 Very Hard', color:0xF97316, holdScale:0.62,
    pumpRate:12,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    sideRange:0.13, minVertStep:0.07,
    sequence:['handL','footL','handR','footR','handL','footL','handR','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!','EVEN THE HOLDS ARE JUDGING YOU.','THIS IS YOUR PROJECT NOW. FOREVER.','SPAGHETTI ARMS DETECTED.','THE SEQUENCE WAS RIGHT THERE...'],
    winMsg:"PROJECT SENT.\nYou may now talk about this at every dinner.",
  },
  V8: {
    grade:'V8', name:'Crimpers Only', tagline:'Your tendons just cried a little.',
    difficulty:'🔴 Extreme', color:0xDC2626, holdScale:0.54,
    pumpRate:15,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    sideRange:0.14, minVertStep:0.07,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','footL','handR','handR'],
    gameoverMsgs:['PUMPED OUT!','YOUR TENDONS HAVE FILED A COMPLAINT.','DOCTORS HATE THIS ROUTE.','THAT WAS ACTUALLY IMPRESSIVE. STILL FELL THOUGH.','MINIMUM 2 YEARS TRAINING REQUIRED.'],
    winMsg:"V8?! WHO ARE YOU?!\nSeriously, who are you.",
  },
  V10: {
    grade:'V10', name:'The Dream', tagline:'Bold of you to try.',
    difficulty:'⚫ Legendary', color:0x7C3AED, holdScale:0.46,
    pumpRate:20,
    armReach:ARM_REACH, footReach:FOOT_REACH,
    sideRange:0.14, minVertStep:0.06,
    sequence:['handL','footL','handR','footR','handL','footL','handR','footR','handL','footL','handR','footR','handL','handR'],
    gameoverMsgs:['PUMPED OUT!','THIS IS A V10. WHAT DID YOU EXPECT.','BOLD STRATEGY. ZERO EXECUTION.','RESPECT. ALSO: LOL.','THE WALL SENDS ITS CONDOLENCES.'],
    winMsg:"YOU ARE THE BOULDER KING.\n👑 Bow. Everyone bow. 👑",
  },
};

export const LEVEL_ORDER = ['V0','V2','V4','V6','V8','V10'];

// ── Physics helpers (match GameScene formulas exactly) ────────────────────────

function simTorso(state, aspect) {
  const hx = (state.handL.xr + state.handR.xr) / 2;
  const hy = (state.handL.yr + state.handR.yr) / 2;
  const fx = (state.footL.xr + state.footR.xr) / 2;
  const fy = (state.footL.yr + state.footR.yr) / 2;
  return {
    xr: hx * 0.50 + fx * 0.50,
    yr: (hy + 0.072) * 0.50 + (fy - 0.108) * 0.50,
  };
}

function limbAnchor(torso, key, aspect) {
  const sh = 0.048, sw = 0.016 * aspect;
  const hh = 0.038, hw = 0.011 * aspect;
  return {
    handL: { xr: torso.xr - sw, yr: torso.yr - sh },
    handR: { xr: torso.xr + sw, yr: torso.yr - sh },
    footL: { xr: torso.xr - hw, yr: torso.yr + hh },
    footR: { xr: torso.xr + hw, yr: torso.yr + hh },
  }[key];
}

function distH(a, b, aspect) {
  const dx = (a.xr - b.xr) * aspect;
  const dy = a.yr - b.yr;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Hold placement ─────────────────────────────────────────────────────────────

function clearOfAllHolds(candidate, holds, footHolds, aspect) {
  for (const h of holds)     { if (distH({ xr:h.xr, yr:h.yr }, candidate, aspect) < MIN_HOLD_DIST) return false; }
  for (const h of footHolds) { if (distH({ xr:h.xr, yr:h.yr }, candidate, aspect) < MIN_HOLD_DIST) return false; }
  return true;
}

function sampleHold(anc, reach, prevPos, params, isLeft, isHand, rng, aspect, holds, footHolds) {
  const MAX_TRIES = 80;
  const sideSign = isLeft ? -1 : 1;  // declared here so fallback can use it

  for (let t = 0; t < MAX_TRIES; t++) {
    // Preferred angle: biased toward upper-left (left limbs) or upper-right (right limbs)
    const preferredAngle = -Math.PI / 2 + sideSign * (params.sideRange * 0.8 + (t / MAX_TRIES) * 0.3);
    const jitter = (rng() - 0.5) * Math.PI * 0.5; // ±45° jitter
    let angle = preferredAngle + jitter;
    // Clamp strictly to upward hemisphere
    angle = Math.max(-Math.PI + 0.05, Math.min(-0.05, angle));

    // Distance: 65–90% of reach
    const d = reach * (0.65 + rng() * 0.25);

    const candidate = {
      xr: anc.xr + (Math.cos(angle) * d) / aspect,
      yr: anc.yr + Math.sin(angle) * d,   // sin is negative in upward angles → yr decreases
    };

    // ── Constraints ──────────────────────────────────────────────────────────

    // 1. Must be strictly above previous hold for this limb
    if (candidate.yr >= prevPos.yr - params.minVertStep) continue;

    // 2. Wall bounds
    if (candidate.xr < 0.08 || candidate.xr > 0.92) continue;
    if (candidate.yr < 0.06 || candidate.yr > 0.78) continue;

    // 3. Actual anchor distance within reach
    if (distH(anc, candidate, aspect) > reach * 1.02) continue;

    // 4. Minimum distance from ALL existing holds
    if (!clearOfAllHolds(candidate, holds, footHolds, aspect)) continue;

    return candidate;
  }

  // Fallback: straight above anchor, relaxed distance check
  const fallback = {
    xr: Math.max(0.09, Math.min(0.91, anc.xr + sideSign * 0.08)),
    yr: Math.max(0.07, prevPos.yr - reach * 0.70),
  };
  return fallback;
}

function placeTop(state, params, rng, aspect, holds, footHolds) {
  const torso  = simTorso(state, aspect);
  const ancL   = limbAnchor(torso, 'handL', aspect);
  const ancR   = limbAnchor(torso, 'handR', aspect);
  // Higher shoulder = lower yr
  const higherAnc = ancL.yr <= ancR.yr ? ancL : ancR;

  // Place TOP within 70% of arm reach above the higher shoulder
  const topY = Math.max(0.04, higherAnc.yr - params.armReach * 0.70);
  let   topX = 0.45 + rng() * 0.10;

  // Shift until clear of all existing holds
  for (let i = 0; i < 30; i++) {
    if (clearOfAllHolds({ xr:topX, yr:topY }, holds, footHolds, aspect)) break;
    topX = 0.42 + rng() * 0.16;
  }

  const id = `h${holds.length}`;
  return { id, xr: topX, yr: topY, color: 0xF59E0B, label: 'TOP' };
}

// ── Reserve holds ──────────────────────────────────────────────────────────────
// Scatter a few extra holds in the gaps between beta holds.
// These are NOT part of the solution path, but give the player backtracking options
// and alternative routes when they take a wrong turn.

function addReserveHolds(holds, footHolds, rng, aspect) {
  const EXTRA_COLORS = [0xA855F7, 0xEF4444, 0x3B82F6, 0xF97316, 0x22C55E];
  // Route holds (exclude START labels and placeholder top — added after this call)
  const route = holds.filter(h => !h.label);
  if (route.length < 2) return;

  const sorted = [...route].sort((a, b) => b.yr - a.yr); // bottom → top

  let added = 0;
  const maxExtra = Math.min(4, Math.floor(sorted.length / 2));

  for (let attempt = 0; attempt < 30 && added < maxExtra; attempt++) {
    const idx = Math.floor(rng() * (sorted.length - 1));
    const h1  = sorted[idx];
    const h2  = sorted[idx + 1];

    // Place a hold roughly between h1 and h2 with slight random offset
    const candidate = {
      xr: (h1.xr + h2.xr) / 2 + (rng() - 0.5) * 0.10,
      yr: (h1.yr + h2.yr) / 2 + (rng() - 0.5) * 0.06,
    };

    if (candidate.xr < 0.09 || candidate.xr > 0.91) continue;
    if (candidate.yr < 0.08 || candidate.yr > 0.78) continue;
    if (!clearOfAllHolds(candidate, holds, footHolds, aspect)) continue;

    holds.push({
      id:    `hr${added}`,
      xr:    candidate.xr,
      yr:    candidate.yr,
      color: EXTRA_COLORS[added % EXTRA_COLORS.length],
    });
    added++;
  }
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generateLevel(grade, aspect, seed) {
  const p   = GRADE_PARAMS[grade];
  const rng = rng32(seed ^ (grade.charCodeAt(0) * 2654435761));

  const holds     = [];
  const footHolds = [];
  const beta      = { handL:[], handR:[], footL:[], footR:[] };

  // ── Start holds ──────────────────────────────────────────────────────────────
  const sx = 0.50, sy = 0.82;
  const spread = 0.055 + rng() * 0.025;

  holds.push({ id:'h0', xr:sx-spread, yr:sy,       color:0x22C55E, label:'START' });
  holds.push({ id:'h1', xr:sx+spread, yr:sy,       color:0x22C55E, label:'START' });
  footHolds.push({ id:'f0', xr:sx-spread*0.7, yr:sy+0.055, color:0x6B7280 });
  footHolds.push({ id:'f1', xr:sx+spread*0.7, yr:sy+0.055, color:0x6B7280 });

  beta.handL.push('h0'); beta.handR.push('h1');
  beta.footL.push('f0'); beta.footR.push('f1');

  const state = {
    handL: { xr:holds[0].xr,     yr:holds[0].yr     },
    handR: { xr:holds[1].xr,     yr:holds[1].yr     },
    footL: { xr:footHolds[0].xr, yr:footHolds[0].yr },
    footR: { xr:footHolds[1].xr, yr:footHolds[1].yr },
  };

  let colorIdxL = 0, colorIdxR = 0;

  // ── Sequence ─────────────────────────────────────────────────────────────────
  for (const move of p.sequence) {
    const isHand = move.startsWith('hand');
    const isLeft = move.endsWith('L');
    const reach  = isHand ? p.armReach : p.footReach;

    const torso = simTorso(state, aspect);
    const anc   = limbAnchor(torso, move, aspect);

    const pos = sampleHold(anc, reach, state[move], p, isLeft, isHand, rng, aspect, holds, footHolds);

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

  // ── Extra "reserve" holds (not in beta, but reachable shortcuts / backtrack options)
  addReserveHolds(holds, footHolds, rng, aspect);

  // ── TOP ───────────────────────────────────────────────────────────────────────
  const top = placeTop(state, p, rng, aspect, holds, footHolds);
  holds.push(top);
  beta.handL.push(top.id);
  beta.handR.push(top.id);

  return { holds, footHolds, beta };
}
