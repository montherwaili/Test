/** The result screen at the end of a test: verdict, faults with tips, and a map of where they happened. */
import type { Severity, Text } from '../examiner/rules';
import type { Verdict, VerdictReason } from '../examiner/verdict';
import { getLang, onLangChange, t, type StringKey } from './i18n';

export interface ResultFault {
  n: number;
  severity: Severity;
  /** Seconds from the start of the test. */
  time: number;
  /** Simulation time of the fault (where the replay jumps to). */
  at: number;
  x: number;
  z: number;
  title: Text;
  tip: Text;
}

export interface ResultData {
  kind: 'road' | 'yard' | 'lesson';
  /** Lessons: its name and the stars earned (0..3). */
  lesson?: { title: Text; stars: number; completed: boolean };
  verdict: Verdict;
  durationS: number;
  distanceM: number;
  counts: { minor: number; serious: number; fail: number };
  faults: ResultFault[];
  /** Yard exercises: ok = passed, false = done with faults, null = not done. */
  manoeuvres: { title: Text; ok: boolean | null }[];
  /** Where the car went, sampled. */
  path: { x: number; z: number }[];
  /** Background lines for the map (lane centre lines, bays). */
  lines: { x: number; z: number }[][];
}

export interface ResultActions {
  onRetry: () => void;
  onFreeDrive: () => void;
  /** Watch the replay, from the start or from just before a fault. Absent when there is no recording. */
  onReplay?: (at?: number) => void;
  /** Lessons: go on to the next one, or back to the list. */
  onNextLesson?: () => void;
  onLessons?: () => void;
}

const REASON_KEYS: Record<VerdictReason, StringKey> = {
  failFault: 'reasonFailFault',
  tooManySerious: 'reasonTooManySerious',
  tooManyMinor: 'reasonTooManyMinor',
  incomplete: 'reasonIncomplete',
};

const SEVERITY_KEYS: Record<Severity, StringKey> = { minor: 'sevMinor', serious: 'sevSerious', fail: 'sevFail' };

/** Marker colours on the map, by severity (also told apart by the number and the list). */
const MARKER: Record<Severity, string> = { minor: '#f0a51c', serious: '#ef6a3a', fail: '#e5383b' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class ResultsScreen {
  readonly root: HTMLElement;
  private data: ResultData | null = null;

  constructor(
    parent: HTMLElement,
    private readonly actions: ResultActions,
  ) {
    this.root = el('div', 'results', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    onLangChange(() => this.render());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(data: ResultData): void {
    this.data = data;
    this.render();
    this.root.hidden = false;
  }

  /** Step aside for the replay, and come back after it. */
  hide(): void {
    this.root.hidden = true;
  }

  reopen(): void {
    if (this.data) this.root.hidden = false;
  }

  private render(): void {
    const d = this.data;
    if (!d) return;
    const lang = getLang();
    this.root.replaceChildren();
    const card = el('div', 'results-card', this.root);

    const head = el('div', `results-head ${d.verdict.passed ? 'pass' : 'fail'}`, card);
    if (d.lesson) {
      el('div', 'results-kind', head, d.lesson.title[lang]);
      el('h2', 'results-verdict', head, t(d.lesson.completed ? 'lessonDone' : 'lessonNotDone'));
      const stars = el('div', 'results-stars', head);
      stars.dir = 'ltr';
      stars.setAttribute('aria-label', `${d.lesson.stars} / 3`);
      for (let i = 0; i < 3; i++) el('span', i < d.lesson.stars ? 'on' : '', stars, '★');
    } else {
      el('div', 'results-kind', head, t(d.kind === 'road' ? 'testRoad' : 'testYard'));
      el('h2', 'results-verdict', head, t(d.verdict.passed ? 'resPass' : 'resFail'));
    }
    if (d.verdict.reasons.length && !d.lesson) {
      const reasons = el('ul', 'results-reasons', head);
      for (const r of d.verdict.reasons) el('li', '', reasons, t(REASON_KEYS[r]));
    }

    const stats = el('dl', 'results-stats', card);
    const stat = (label: StringKey, value: string, cls = '') => {
      const box = el('div', cls, stats);
      el('dt', '', box, t(label));
      el('dd', '', box, value);
    };
    stat('resDuration', clock(d.durationS));
    stat('resDistance', d.distanceM >= 1000 ? `${(d.distanceM / 1000).toFixed(2)} ${t('unitKm')}` : `${Math.round(d.distanceM)} ${t('unitM')}`);
    stat('resMinor', String(d.counts.minor), 'sev-minor');
    stat('resSerious', String(d.counts.serious), 'sev-serious');
    stat('resFails', String(d.counts.fail), 'sev-fail');

    if (d.manoeuvres.length) {
      el('h3', '', card, t('resManoeuvres'));
      const list = el('ul', 'results-manoeuvres', card);
      for (const m of d.manoeuvres) {
        const li = el('li', m.ok === true ? 'ok' : m.ok === false ? 'bad' : 'skip', list);
        el('span', 'mark', li, m.ok === true ? '✓' : m.ok === false ? '✗' : '–');
        el('span', '', li, m.title[lang]);
        if (m.ok === null) el('span', 'note', li, t('resNotDone'));
      }
    }

    el('h3', '', card, t('resFaults'));
    if (d.faults.length === 0) {
      el('p', 'results-none', card, t('resNoFaults'));
    } else {
      const list = el('ol', 'results-faults', card);
      for (const f of d.faults) {
        const li = el('li', `sev-${f.severity}`, list);
        el('span', 'num', li, String(f.n));
        const body = el('div', 'body', li);
        const top = el('div', 'top', body);
        el('span', 'chip', top, t(SEVERITY_KEYS[f.severity]));
        el('strong', '', top, f.title[lang]);
        el('time', '', top, clock(f.time));
        el('p', 'tip', body, f.tip[lang]);
        const replay = this.actions.onReplay;
        if (replay) {
          const watch = el('button', 'hud-btn watch', li, '▶');
          watch.type = 'button';
          watch.title = t('replayHere');
          watch.setAttribute('aria-label', t('replayHere'));
          watch.addEventListener('click', () => replay(f.at));
        }
      }
    }

    if (d.path.length > 1) {
      el('h3', '', card, t('resMap'));
      const canvas = el('canvas', 'results-map', card);
      requestAnimationFrame(() => this.drawMap(canvas, d));
    }

    el('p', 'results-note', card, t('resUnverified'));

    const buttons = el('div', 'results-buttons', card);
    const replay = this.actions.onReplay;
    if (replay) {
      const watch = el('button', 'hud-btn primary', buttons, t('replayWatch'));
      watch.type = 'button';
      watch.addEventListener('click', () => replay());
    }
    if (this.actions.onNextLesson) {
      const next = el('button', 'hud-btn primary', buttons, t('lessonNext'));
      next.type = 'button';
      next.addEventListener('click', this.actions.onNextLesson);
    }
    if (this.actions.onLessons) {
      const list = el('button', 'hud-btn', buttons, t('lessonsMenu'));
      list.type = 'button';
      list.addEventListener('click', this.actions.onLessons);
    }
    const retry = el('button', 'hud-btn', buttons, t(d.lesson ? 'lessonRetry' : 'resTryAgain'));
    retry.type = 'button';
    retry.addEventListener('click', this.actions.onRetry);
    const free = el('button', 'hud-btn', buttons, t('resFreeDrive'));
    free.type = 'button';
    free.addEventListener('click', this.actions.onFreeDrive);
  }

  private drawMap(canvas: HTMLCanvasElement, d: ResultData): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of [...d.path, ...d.lines.flat()]) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const scale = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1), (h - 2 * pad) / Math.max(maxZ - minZ, 1));
    const ox = (w - (maxX - minX) * scale) / 2;
    const oz = (h - (maxZ - minZ) * scale) / 2;
    // North is up: -z is towards the top of the canvas.
    const X = (x: number) => ox + (x - minX) * scale;
    const Y = (z: number) => oz + (z - minZ) * scale;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (const line of d.lines) {
      ctx.beginPath();
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.z)) : ctx.lineTo(X(p.x), Y(p.z))));
      ctx.stroke();
    }

    ctx.strokeStyle = '#3d8bea';
    ctx.lineWidth = 3;
    ctx.beginPath();
    d.path.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.z)) : ctx.lineTo(X(p.x), Y(p.z))));
    ctx.stroke();

    // Start and end of the drive.
    const first = d.path[0]!;
    const last = d.path[d.path.length - 1]!;
    ctx.fillStyle = '#19b36a';
    ctx.beginPath();
    ctx.arc(X(first.x), Y(first.z), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f3ee';
    ctx.fillRect(X(last.x) - 4, Y(last.z) - 4, 8, 8);

    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of d.faults) {
      ctx.fillStyle = MARKER[f.severity];
      ctx.strokeStyle = '#16181d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(f.x), Y(f.z), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#16181d';
      ctx.fillText(String(f.n), X(f.x), Y(f.z) + 0.5);
    }
  }
}
