// All sounds generated via Web Audio API — zero assets needed.
// Every function is a no-op if ctx is null (audio blocked/unavailable).

function osc(ctx, type, freq0, freq1, duration, vol = 0.25, startDelay = 0) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.type = type;
  const t0 = ctx.currentTime + startDelay;
  o.frequency.setValueAtTime(freq0, t0);
  if (freq1 !== freq0) o.frequency.exponentialRampToValueAtTime(freq1, t0 + duration);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  o.start(t0); o.stop(t0 + duration);
}

export function playGrab(ctx) {
  if (!ctx) return;
  osc(ctx, 'sine',    200, 60,  0.08, 0.28);
  osc(ctx, 'square',  300, 80,  0.05, 0.10);
}

export function playRelease(ctx) {
  if (!ctx) return;
  osc(ctx, 'sine', 120, 40, 0.12, 0.14);
}

export function playFall(ctx) {
  if (!ctx) return;
  osc(ctx, 'sawtooth', 480, 80, 0.65, 0.30);
  osc(ctx, 'sine',     300, 50, 0.50, 0.12);
}

export function playSplat(ctx) {
  if (!ctx) return;
  // White noise burst
  const samples = Math.floor(ctx.sampleRate * 0.18);
  const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random()*2-1) * (1 - i/samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  src.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0.7, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  src.start(ctx.currentTime);
  // Low thud underneath
  osc(ctx, 'sine', 80, 30, 0.22, 0.35);
}

export function playWin(ctx) {
  if (!ctx) return;
  // C5 E5 G5 C6 arpeggio
  [523, 659, 784, 1047].forEach((freq, i) => {
    osc(ctx, 'square', freq, freq, 0.30, 0.14, i * 0.13);
    osc(ctx, 'sine',   freq, freq, 0.40, 0.06, i * 0.13);
  });
}

export function playHeartbeat(ctx) {
  if (!ctx) return;
  [0, 0.20].forEach(delay => {
    osc(ctx, 'sine', 90, 50, 0.14, 0.32, delay);
  });
}
