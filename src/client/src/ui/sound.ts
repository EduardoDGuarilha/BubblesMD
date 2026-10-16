let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === audio.sampleRate) return noise;
  const length = Math.floor(audio.sampleRate * 0.06);
  noise = audio.createBuffer(1, length, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/**
 * A short soap-bubble pop, synthesized: a sharp broadband burst (the film tearing), band-passed high and decaying
 * in ~25 ms, plus a faint, very fast falling "plip" from the air release. No sustained tone, no audio files.
 * Slightly randomized so repeated pops do not sound identical.
 */
export function playPop() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    const jitter = 0.85 + Math.random() * 0.3;

    const burst = ctx.createBufferSource();
    burst.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(3200 * jitter, t);
    band.frequency.exponentialRampToValueAtTime(1800 * jitter, t + 0.03);
    band.Q.value = 0.9;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 700;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.0001, t);
    burstGain.gain.exponentialRampToValueAtTime(0.55, t + 0.0015);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    burst.connect(band).connect(high).connect(burstGain).connect(ctx.destination);
    burst.start(t);
    burst.stop(t + 0.05);

    const plip = ctx.createOscillator();
    plip.type = 'sine';
    plip.frequency.setValueAtTime(1500 * jitter, t);
    plip.frequency.exponentialRampToValueAtTime(420 * jitter, t + 0.022);
    const plipGain = ctx.createGain();
    plipGain.gain.setValueAtTime(0.0001, t);
    plipGain.gain.exponentialRampToValueAtTime(0.08, t + 0.002);
    plipGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    plip.connect(plipGain).connect(ctx.destination);
    plip.start(t);
    plip.stop(t + 0.04);
  } catch {
    /* audio unavailable: silent */
  }
}
