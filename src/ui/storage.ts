/** Saving progress in the browser. Storage can be missing or refuse (private windows): the game carries on without it. */
import { emptyProgress, parseProgress, type ProgressData } from '../learning/progress';

const KEY = 'odts.progress';

export function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseProgress(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: ProgressData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not saved; nothing else to do.
  }
}
