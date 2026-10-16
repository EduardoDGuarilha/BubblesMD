let ctx: AudioContext | null = null;
let recording: AudioBuffer | null = null;
let recordingOffset = 0;
let loading: Promise<void> | null = null;
let noise: AudioBuffer | null = null;

const POP_URL = '/sounds/bubble-pop.mp3';

function context(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Seconds of near-silence before the pop transient, so playback lines up with the rupture animation. */
function leadingSilence(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > 0.02) return Math.max(0, i / buffer.sampleRate - 0.002);
  return 0;
}

/** Decode the supplied bubble-pop recording once (the first user gesture is a good moment). */
export function preloadPop() {
  if (loading) return;
  try {
    const audio = context();
    loading = fetch(POP_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => audio.decodeAudioData(data))
      .then((buffer) => {
        recording = buffer;
        recordingOffset = leadingSilence(buffer);
      })
      .catch(() => {
        recording = null;
      });
  } catch {
    /* no audio */
  }
}

/** Whether the recorded pop has been decoded (inspection only). */
export function popRecordingReady(): boolean {
  return recording !== null;
}

/** One soap-bubble pop: the supplied recording, or a synthesized pop until/unless it can be decoded. */
export function playPop() {
  try {
    const audio = context();
    if (!recording) {
      preloadPop();
      synthesizedPop(audio);
      return;
    }
    const source = audio.createBufferSource();
    source.buffer = recording;
    const gain = audio.createGain();
    gain.gain.value = 0.8;
    source.connect(gain).connect(audio.destination);
    source.start(0, recordingOffset);
  } catch {
    /* audio unavailable: silent */
  }
}

function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === audio.sampleRate) return noise;
  const length = Math.floor(audio.sampleRate * 0.06);
  noise = audio.createBuffer(1, length, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** Fallback: a short filtered noise burst with a fast decay (no sustained tone). */
function synthesizedPop(audio: AudioContext) {
  const t = audio.currentTime + 0.005;
  const burst = audio.createBufferSource();
  burst.buffer = noiseBuffer(audio);
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(3200, t);
  band.frequency.exponentialRampToValueAtTime(1800, t + 0.03);
  band.Q.value = 0.9;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.5, t + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
  burst.connect(band).connect(gain).connect(audio.destination);
  burst.start(t);
  burst.stop(t + 0.05);
}
