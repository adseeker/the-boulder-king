import { LEVEL_ORDER } from '../utils/levelGenerator.js';
import { OUTFITS, OUTFIT_ORDER } from '../config/outfits.js';

const KEY = 'boulder_king_v1';

const defaults = () => ({ completedLevels: [], bestScores: {}, selectedOutfit: 'default' });

export function load() {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaults(); }
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export function markComplete(grade, score) {
  const data = load();
  if (!data.completedLevels.includes(grade)) data.completedLevels.push(grade);
  if (!data.bestScores[grade] || score > data.bestScores[grade]) data.bestScores[grade] = score;
  save(data);
}

export function setOutfit(id) {
  const data = load(); data.selectedOutfit = id; save(data);
}

export function getOutfit() {
  return OUTFITS[load().selectedOutfit] || OUTFITS.default;
}

// Returns 'available' | 'locked' | 'completed'
export function levelState(grade) {
  const data = load();
  if (data.completedLevels.includes(grade)) return 'completed';
  const idx = LEVEL_ORDER.indexOf(grade);
  if (idx === 0) return 'available';
  return data.completedLevels.includes(LEVEL_ORDER[idx - 1]) ? 'available' : 'locked';
}

// Returns outfit id if newly unlocked by completing this grade, else null
export function checkOutfitUnlock(grade) {
  const data = load();
  const unlocked = OUTFIT_ORDER.find(id => {
    const o = OUTFITS[id];
    return o.unlockAt === grade && !data.completedLevels.includes(grade);
  });
  return unlocked || null;
}

export function isOutfitUnlocked(id) {
  const o = OUTFITS[id];
  if (!o.unlockAt) return true;
  return load().completedLevels.includes(o.unlockAt);
}
