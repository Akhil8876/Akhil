/**
 * One Euro filter — low-latency jitter smoothing for noisy pose signals.
 *
 * Casiez, Roussel & Vogel (CHI 2012). The cutoff frequency rises with the
 * observed speed of the signal, so a still body is smoothed hard (no shimmer)
 * while a fast movement is barely smoothed at all (no rubber-banding).
 *
 * Everything here is a worklet: it runs on the VisionCamera frame-processor
 * thread, not the JS thread.
 */

export interface OneEuroConfig {
  /** Minimum cutoff in Hz. Lower = steadier when still, more lag. */
  minCutoff: number;
  /** Speed coefficient. Higher = reacts faster to fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate, in Hz. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = {
  // Tuned against hand-held phone footage: shoulders read as rock-steady
  // while the wearer is browsing, and still track a turn without lag.
  minCutoff: 1.2,
  beta: 0.02,
  dCutoff: 1.0,
};

export interface OneEuroState {
  hasPrev: boolean;
  xPrev: number;
  dxPrev: number;
  tPrev: number;
}

export function createOneEuroState(): OneEuroState {
  'worklet';
  return { hasPrev: false, xPrev: 0, dxPrev: 0, tPrev: 0 };
}

function alpha(cutoff: number, dt: number): number {
  'worklet';
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Filters one scalar sample.
 *
 * @param state mutated in place, so each filtered signal needs its own state
 * @param value raw sample
 * @param timestampMs monotonic timestamp of the sample
 */
export function filterOneEuro(
  state: OneEuroState,
  value: number,
  timestampMs: number,
  config: OneEuroConfig = DEFAULT_ONE_EURO,
): number {
  'worklet';
  if (!state.hasPrev) {
    state.hasPrev = true;
    state.xPrev = value;
    state.dxPrev = 0;
    state.tPrev = timestampMs;
    return value;
  }

  // Guard against a zero or backwards dt: duplicated frame timestamps would
  // otherwise divide by zero and poison the filter with NaN forever.
  let dt = (timestampMs - state.tPrev) / 1000;
  if (!(dt > 0) || dt > 1) dt = 1 / 30;

  const dx = (value - state.xPrev) / dt;
  const dxHat = state.dxPrev + alpha(config.dCutoff, dt) * (dx - state.dxPrev);

  const cutoff = config.minCutoff + config.beta * Math.abs(dxHat);
  const xHat = state.xPrev + alpha(cutoff, dt) * (value - state.xPrev);

  state.xPrev = xHat;
  state.dxPrev = dxHat;
  state.tPrev = timestampMs;
  return xHat;
}
