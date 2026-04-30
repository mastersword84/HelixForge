// ============================================================
// HELIXFORGE — CLIENT-SIDE AUDIO ANALYSIS
// Runs in the browser via Web Audio API + Goertzel algorithm.
// No external libraries. Analyzes frequency content per section
// to give Claude real spectral data instead of guessing.
// ============================================================

export interface SectionAnalysis {
  index: number;
  startTime: string;   // "0:32"
  endSec: number;
  startSec: number;
  durationSec: number;
  energyLevel: "quiet" | "moderate" | "loud" | "very loud";
  estimatedDrive: "clean" | "light OD" | "moderate OD" | "heavy OD" | "high gain";
  brightness: "dark/warm" | "neutral" | "bright" | "very bright";
  lowPct: number;      // % of spectral energy in bass/low-mid
  midPct: number;      // % in mids
  highPct: number;     // % in presence/highs/air
  harmonicRatio: number; // high/low — proxy for distortion
  toneDescription: string; // human-readable summary
}

export interface AudioAnalysisResult {
  durationSec: number;
  sections: SectionAnalysis[];
  summary: string; // paragraph for Claude prompt
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Goertzel algorithm — energy at a single target frequency.
// Much lighter than FFT for targeted band analysis.
function goertzel(samples: Float32Array, sampleRate: number, targetHz: number): number {
  const k = (targetHz * samples.length) / sampleRate;
  const omega = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  // Magnitude squared
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// Average Goertzel magnitude across several frequencies in a band
function bandEnergy(samples: Float32Array, sr: number, freqs: number[]): number {
  return freqs.reduce((s, f) => s + goertzel(samples, sr, f), 0) / freqs.length;
}

function computeSpectralBands(chunk: Float32Array, sr: number) {
  return {
    bass:     bandEnergy(chunk, sr, [80, 120, 160, 200]),
    lowMid:   bandEnergy(chunk, sr, [250, 350, 500, 650]),
    mid:      bandEnergy(chunk, sr, [800, 1000, 1200, 1500]),
    highMid:  bandEnergy(chunk, sr, [2000, 2500, 3000, 4000]),
    presence: bandEnergy(chunk, sr, [5000, 6000, 8000]),
    air:      bandEnergy(chunk, sr, [10000, 12000]),
  };
}

function describeDrive(harmonicRatio: number): SectionAnalysis["estimatedDrive"] {
  if (harmonicRatio > 2.2) return "high gain";
  if (harmonicRatio > 1.4) return "heavy OD";
  if (harmonicRatio > 0.8) return "moderate OD";
  if (harmonicRatio > 0.4) return "light OD";
  return "clean";
}

function describeBrightness(highPct: number): SectionAnalysis["brightness"] {
  if (highPct > 45) return "very bright";
  if (highPct > 30) return "bright";
  if (highPct > 18) return "neutral";
  return "dark/warm";
}

function describeEnergy(rms: number, maxRms: number): SectionAnalysis["energyLevel"] {
  const ratio = rms / (maxRms + 1e-6);
  if (ratio > 0.7) return "very loud";
  if (ratio > 0.4) return "loud";
  if (ratio > 0.18) return "moderate";
  return "quiet";
}

export async function analyzeAudioFile(file: File): Promise<AudioAnalysisResult> {
  // Decode at a lower sample rate to keep analysis fast
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Mix down to mono
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mono[i] = right ? (left[i] + right[i]) * 0.5 : left[i];
  }

  const sr = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const STEP_SEC = 1; // 1-second energy windows
  const STEP = Math.floor(sr * STEP_SEC);

  // ── Step 1: RMS energy timeline ──────────────────────────────
  const energyTimeline: number[] = [];
  for (let i = 0; i + STEP < mono.length; i += STEP) {
    let sum = 0;
    for (let j = i; j < i + STEP; j++) sum += mono[j] * mono[j];
    energyTimeline.push(Math.sqrt(sum / STEP));
  }

  // Smooth with a 5-point moving average
  const smooth = energyTimeline.map((_, i) => {
    const w = energyTimeline.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((s, x) => s + x, 0) / w.length;
  });

  const maxE = Math.max(...smooth, 1e-6);

  // ── Step 2: Detect boundaries from energy changes ────────────
  // We look for local energy transitions and keep the most significant,
  // enforcing a minimum section gap to avoid too many tiny sections.
  const MIN_GAP_SEC = 10;
  const CHANGE_THRESHOLD = 0.10; // 10% of max RMS change

  const rawBoundaries: number[] = [0]; // in timeline indices

  for (let i = 3; i < smooth.length - 3; i++) {
    const before = (smooth[i - 3] + smooth[i - 2] + smooth[i - 1]) / 3;
    const after  = (smooth[i] + smooth[i + 1] + smooth[i + 2]) / 3;
    const relChange = Math.abs(after - before) / maxE;

    const lastIdx = rawBoundaries[rawBoundaries.length - 1];
    if (relChange > CHANGE_THRESHOLD && i - lastIdx >= MIN_GAP_SEC) {
      rawBoundaries.push(i);
    }
  }
  rawBoundaries.push(smooth.length); // sentinel

  // Cap at 8 sections (Helix snapshot limit)
  // If we got too many, keep the ones with the largest energy transitions
  let boundaries = rawBoundaries;
  if (rawBoundaries.length - 1 > 8) {
    const scored: { idx: number; score: number }[] = [];
    for (let k = 1; k < rawBoundaries.length - 1; k++) {
      const i = rawBoundaries[k];
      const before = smooth.slice(Math.max(0, i - 3), i).reduce((s, x) => s + x, 0) / 3;
      const after  = smooth.slice(i, i + 3).reduce((s, x) => s + x, 0) / 3;
      scored.push({ idx: i, score: Math.abs(after - before) });
    }
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, 7).map((s) => s.idx).sort((a, b) => a - b);
    boundaries = [0, ...kept, smooth.length];
  }

  // ── Step 3: Spectral analysis per section ───────────────────
  const ANALYSIS_CHUNK_SEC = 2; // analyze 2s from the middle of each section
  const ANALYSIS_CHUNK = Math.floor(sr * ANALYSIS_CHUNK_SEC);

  const sectionResults: SectionAnalysis[] = [];

  for (let s = 0; s < boundaries.length - 1; s++) {
    const startIdx = boundaries[s];     // timeline index (1 per second)
    const endIdx   = boundaries[s + 1];
    const startSec = startIdx * STEP_SEC;
    const endSec   = Math.min(endIdx * STEP_SEC, duration);
    const midSec   = (startSec + endSec) / 2;

    // Pull a chunk from the middle of the section for spectral analysis
    const chunkStart = Math.floor(midSec * sr);
    const chunkEnd   = Math.min(chunkStart + ANALYSIS_CHUNK, mono.length);
    const chunk      = mono.slice(chunkStart, chunkEnd);

    // Section RMS
    const sectionSmooth = smooth.slice(startIdx, endIdx);
    const sectionRms    = sectionSmooth.reduce((s, x) => s + x, 0) / (sectionSmooth.length || 1);

    // Spectral bands
    const bands = computeSpectralBands(chunk, sr);
    const total  = bands.bass + bands.lowMid + bands.mid + bands.highMid + bands.presence + bands.air + 1e-9;
    const lowPct  = Math.round(((bands.bass + bands.lowMid) / total) * 100);
    const midPct  = Math.round((bands.mid / total) * 100);
    const highPct = Math.round(((bands.highMid + bands.presence + bands.air) / total) * 100);

    // Harmonic ratio: high-freq content vs bass content
    // Higher = more overtones = more driven/distorted
    const harmonicRatio = (bands.highMid + bands.presence) / (bands.bass + bands.lowMid + 1e-9);

    const energyLevel    = describeEnergy(sectionRms, maxE);
    const estimatedDrive = describeDrive(harmonicRatio);
    const brightness     = describeBrightness(highPct);

    const toneDescription = [
      `${brightness} tone`,
      `${estimatedDrive}`,
      `${energyLevel} dynamics`,
      `low:${lowPct}% mid:${midPct}% high:${highPct}%`,
    ].join(", ");

    sectionResults.push({
      index: s,
      startSec,
      endSec,
      startTime: formatTime(startSec),
      durationSec: Math.round(endSec - startSec),
      energyLevel,
      estimatedDrive,
      brightness,
      lowPct,
      midPct,
      highPct,
      harmonicRatio: Math.round(harmonicRatio * 100) / 100,
      toneDescription,
    });
  }

  // ── Step 4: Build Claude prompt summary ─────────────────────
  const summary = buildAnalysisSummary(sectionResults, duration);

  return { durationSec: duration, sections: sectionResults, summary };
}

function buildAnalysisSummary(sections: SectionAnalysis[], duration: number): string {
  const lines: string[] = [
    `REAL AUDIO ANALYSIS (from uploaded file, duration: ${formatTime(duration)}):`,
    `Detected ${sections.length} distinct sections by energy transitions.`,
    `Use this measured data to calibrate each snapshot's tone — do not guess.`,
    ``,
  ];

  for (const s of sections) {
    lines.push(
      `  Detected Section ${s.index + 1} [${s.startTime} – ${formatTime(s.endSec)}] (${s.durationSec}s):`
    );
    lines.push(`    Energy:        ${s.energyLevel}`);
    lines.push(`    Drive:         ${s.estimatedDrive}`);
    lines.push(`    Brightness:    ${s.brightness}`);
    lines.push(`    Freq balance:  low ${s.lowPct}%  mid ${s.midPct}%  high ${s.highPct}%`);
    lines.push(`    Harmonic ratio: ${s.harmonicRatio}  (>1.0 = significant distortion/harmonics)`);
    lines.push(``);
  }

  lines.push(
    `Map these detected sections to song structure sections (Intro/Verse/Chorus/etc.) using your`,
    `knowledge of the song. Each snapshot's amp drive, EQ, and effects should reflect the measured`,
    `tonal character above. High harmonic ratio = more amp gain. High % = brighter EQ or cab mic.`,
  );

  return lines.join("\n");
}
