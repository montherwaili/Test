/** Player settings, saved in the browser. */
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Steering = 'wheel' | 'tilt';

export interface Settings {
  sound: boolean;
  /** 0..1 */
  volume: number;
  vibration: boolean;
  quality: Quality;
  /** Touch screens: the on-screen wheel, or tilting the phone. */
  steering: Steering;
  /** Tilt needed for full lock, degrees. */
  tiltRange: number;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.7,
  vibration: true,
  quality: 'auto',
  steering: 'wheel',
  tiltRange: 35,
  showFps: false,
};

const KEY = 'odts.settings';

/** Keep only well-formed values; anything else falls back to the default. */
export function parseSettings(input: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof input !== 'object' || input === null) return s;
  const r = input as Record<string, unknown>;
  if (typeof r['sound'] === 'boolean') s.sound = r['sound'];
  if (typeof r['volume'] === 'number' && r['volume'] >= 0 && r['volume'] <= 1) s.volume = r['volume'];
  if (typeof r['vibration'] === 'boolean') s.vibration = r['vibration'];
  if (r['quality'] === 'auto' || r['quality'] === 'low' || r['quality'] === 'medium' || r['quality'] === 'high') s.quality = r['quality'];
  if (r['steering'] === 'wheel' || r['steering'] === 'tilt') s.steering = r['steering'];
  if (typeof r['tiltRange'] === 'number' && r['tiltRange'] >= 10 && r['tiltRange'] <= 80) s.tiltRange = r['tiltRange'];
  if (typeof r['showFps'] === 'boolean') s.showFps = r['showFps'];
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved.
  }
}
