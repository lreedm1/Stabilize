const DEFAULT_VOLUME = 0.36;
const UINT32_SCALE = 1 / 0x1_0000_0000;

export function clampNatureVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, number));
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state * UINT32_SCALE;
  };
}

function makeNoiseBuffer(context, { brown = false, seed = 1 } = {}) {
  const duration = 6;
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  const random = createRandom(seed);
  let previous = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const white = random() * 2 - 1;
    previous = brown ? previous * 0.985 + white * 0.035 : white;
    samples[index] = brown ? Math.max(-1, Math.min(1, previous * 2.1)) : white;
  }

  return buffer;
}

function startNoiseLayer(
  context,
  destination,
  { seed, brown, highpass, lowpass, gain, pulseRate, pulseDepth },
) {
  const source = context.createBufferSource();
  const highFilter = context.createBiquadFilter();
  const lowFilter = context.createBiquadFilter();
  const layerGain = context.createGain();
  const pulse = context.createOscillator();
  const pulseGain = context.createGain();

  source.buffer = makeNoiseBuffer(context, { brown, seed });
  source.loop = true;
  highFilter.type = "highpass";
  highFilter.frequency.value = highpass;
  lowFilter.type = "lowpass";
  lowFilter.frequency.value = lowpass;
  layerGain.gain.value = gain;
  pulse.type = "sine";
  pulse.frequency.value = pulseRate;
  pulseGain.gain.value = pulseDepth;

  source
    .connect(highFilter)
    .connect(lowFilter)
    .connect(layerGain)
    .connect(destination);
  pulse.connect(pulseGain).connect(layerGain.gain);
  source.start();
  pulse.start();
}

export function createNatureSoundscape({
  initialVolume = DEFAULT_VOLUME,
  onStateChange = () => {},
} = {}) {
  const AudioContextClass =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  let available = typeof AudioContextClass === "function";
  const randomSeed = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomSeed);
  } else {
    randomSeed[0] = Date.now() >>> 0;
  }
  const random = createRandom(randomSeed[0] || 0x51a7e5ed);

  let context = null;
  let master = null;
  let enabled = false;
  let volume = clampNatureVolume(initialVolume);
  let birdTimer = 0;
  let suspendTimer = 0;

  function publish() {
    onStateChange({ available, enabled, volume });
  }

  function buildSoundscape() {
    if (context || !available) return;
    try {
      context = new AudioContextClass({ latencyHint: "playback" });
    } catch {
      available = false;
      enabled = false;
      publish();
      return;
    }
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    startNoiseLayer(context, master, {
      seed: 0x73c4a11,
      brown: true,
      highpass: 34,
      lowpass: 520,
      gain: 0.15,
      pulseRate: 0.07,
      pulseDepth: 0.035,
    });
    startNoiseLayer(context, master, {
      seed: 0x19b7e25,
      brown: false,
      highpass: 280,
      lowpass: 2_200,
      gain: 0.095,
      pulseRate: 0.13,
      pulseDepth: 0.024,
    });
    startNoiseLayer(context, master, {
      seed: 0xa02e14f,
      brown: false,
      highpass: 900,
      lowpass: 4_600,
      gain: 0.026,
      pulseRate: 0.23,
      pulseDepth: 0.009,
    });
  }

  function playBirdCall() {
    if (!enabled || !context || !master || document.hidden) return;
    const start = context.currentTime + 0.03;
    const notes = random() > 0.58 ? 3 : 2;

    for (let note = 0; note < notes; note += 1) {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      const base = 1_700 + random() * 1_100;
      const noteStart = start + note * (0.13 + random() * 0.05);
      const duration = 0.14 + random() * 0.08;

      oscillator.type = note % 2 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(base, noteStart);
      oscillator.frequency.exponentialRampToValueAtTime(
        base * (1.28 + random() * 0.18),
        noteStart + duration * 0.44,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        base * 0.92,
        noteStart + duration,
      );
      noteGain.gain.setValueAtTime(0.0001, noteStart);
      noteGain.gain.exponentialRampToValueAtTime(
        0.022 + random() * 0.014,
        noteStart + 0.025,
      );
      noteGain.gain.exponentialRampToValueAtTime(
        0.0001,
        noteStart + duration,
      );
      oscillator.connect(noteGain).connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.02);
    }
  }

  function scheduleBirds() {
    if (birdTimer) window.clearTimeout(birdTimer);
    if (!enabled) return;
    const delay = 4_800 + random() * 8_500;
    birdTimer = window.setTimeout(() => {
      birdTimer = 0;
      playBirdCall();
      scheduleBirds();
    }, delay);
  }

  async function setEnabled(nextValue) {
    if (!available) {
      publish();
      return false;
    }

    enabled = Boolean(nextValue);
    buildSoundscape();
    if (!context || !master) {
      enabled = false;
      publish();
      return false;
    }

    if (suspendTimer) {
      window.clearTimeout(suspendTimer);
      suspendTimer = 0;
    }

    if (enabled) {
      try {
        await context.resume();
      } catch {
        available = false;
        enabled = false;
        publish();
        return false;
      }
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, volume),
        now + 0.7,
      );
      scheduleBirds();
    } else {
      if (birdTimer) window.clearTimeout(birdTimer);
      birdTimer = 0;
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      suspendTimer = window.setTimeout(() => {
        suspendTimer = 0;
        if (!enabled) void context?.suspend().catch(() => {});
      }, 340);
    }

    publish();
    return enabled;
  }

  function setVolume(nextValue) {
    volume = clampNatureVolume(nextValue);
    if (context && master && enabled) {
      const now = context.currentTime;
      const current = Math.max(0.0001, master.gain.value);
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(current, now);
      master.gain.setTargetAtTime(
        Math.max(0.0001, volume),
        now,
        0.08,
      );
    }
    publish();
    return volume;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!context || !enabled) return;
      if (document.hidden) {
        if (birdTimer) window.clearTimeout(birdTimer);
        birdTimer = 0;
        void context.suspend().catch(() => {});
      } else {
        void context.resume().catch(() => {});
        scheduleBirds();
      }
    });
  }

  publish();
  return {
    toggle: () => setEnabled(!enabled),
    setEnabled,
    setVolume,
  };
}
