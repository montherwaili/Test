/**
 * The home screen, laid out like a game's: the sections down one side
 * (lessons, free drive, practice with the examiner, the test, settings),
 * and what is in the chosen one beside them - the lessons in order, the
 * maps to drive, the practice grounds, the two parts of the test.
 */
import type { LessonDef } from '../learning/lesson';
import type { ProgressData } from '../learning/progress';
import type { GameMode } from './hud';
import { getLang, onLangChange, setLang, t, type StringKey } from './i18n';
import { icon, type IconName } from './icons';

/** A map offered in the menu, with a drawing of its roads. */
export interface MenuMap {
  mode: GameMode;
  title: StringKey;
  note: StringKey;
  /** Short facts ("16 junctions · 60 km/h"). */
  facts: StringKey;
  thumb: () => Element;
}

export interface MainMenuActions {
  onMode: (mode: GameMode) => void;
  onLesson: (id: string) => void;
  onAllLessons: () => void;
  onSettings: () => void;
  /** Close the menu and carry on with what is running. */
  onClose: () => void;
  /** Label of the close button ("carry on free driving", or just "back"). */
  closeLabel: StringKey;
  /** Free-drive maps, practice grounds and test parts, each with its picture. */
  driveMaps: MenuMap[];
  practiceMaps: MenuMap[];
  testParts: MenuMap[];
}

/** Lessons count as learned once they have been completed (one star or more). */
export function lessonsDone(p: ProgressData, lessons: LessonDef[]): number {
  return lessons.filter((l) => (p.stars[l.id] ?? 0) > 0).length;
}

/** The first lesson not yet completed, in course order (null once all are done). */
export function nextLesson(p: ProgressData, lessons: LessonDef[]): LessonDef | null {
  return lessons.find((l) => (p.stars[l.id] ?? 0) === 0) ?? null;
}

/**
 * Which step to point the player at: lessons until most are done, then
 * practice is optional and the test is next.
 */
export function suggestedStep(p: ProgressData, lessons: LessonDef[]): 1 | 2 | 3 {
  const done = lessonsDone(p, lessons);
  if (done < Math.min(lessons.length, 5)) return 1;
  return 3;
}

type Section = 'lessons' | 'drive' | 'practise' | 'test';

/**
 * The start screen's picture: a desert road at dusk running to the
 * mountains, drawn in a few flat layers.
 */
const TITLE_ART = `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="ta-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1020"/><stop offset=".45" stop-color="#2a2a44"/><stop offset=".72" stop-color="#b8643a"/><stop offset=".8" stop-color="#e9a23b"/>
    </linearGradient>
    <radialGradient id="ta-sun" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffe2a8"/><stop offset=".35" stop-color="#ffc066" stop-opacity=".9"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ta-road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2630"/><stop offset="1" stop-color="#0e0d12"/>
    </linearGradient>
    <linearGradient id="ta-fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#07080b" stop-opacity="0"/><stop offset=".55" stop-color="#07080b" stop-opacity=".35"/><stop offset="1" stop-color="#07080b" stop-opacity=".9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#ta-sky)"/>
  <circle cx="560" cy="640" r="260" fill="url(#ta-sun)"/>
  <circle cx="560" cy="650" r="58" fill="#ffd38a"/>
  <path d="M0 640 L120 590 L230 615 L360 548 L470 600 L600 560 L700 598 L820 540 L940 585 L1060 530 L1190 590 L1320 545 L1460 600 L1600 570 V720 H0Z" fill="#3a2a3a"/>
  <path d="M0 690 Q200 640 420 668 T860 660 T1300 650 T1600 664 V900 H0Z" fill="#6a4232"/>
  <path d="M0 740 Q260 690 520 716 T1040 706 T1600 720 V900 H0Z" fill="#8a5636"/>
  <path d="M520 664 L590 664 L1180 900 L-80 900 Z" fill="url(#ta-road)"/>
  <path d="M553 666 L557 666 L560 690 L552 690 Z M550 705 L560 705 L566 745 L545 745 Z M543 775 L564 775 L576 840 L532 840 Z" fill="#e9c37a" opacity=".85"/>
  <path d="M524 664 L516 664 L-110 900 L-60 900 Z M586 664 L594 664 L1230 900 L1180 900 Z" fill="#d9c49a" opacity=".55"/>
  <g fill="#1c1218">
    <path d="M1060 712 l4 -120 l6 0 l-2 120z"/><path d="M1066 596 q-60 -10 -90 22 q46 -22 90 -14z M1068 596 q60 -12 92 20 q-48 -20 -92 -12z M1067 594 q-30 -40 -78 -44 q40 16 76 50z M1068 594 q32 -42 80 -42 q-42 14 -78 48z M1067 595 q-4 -46 -24 -70 q16 30 22 70z"/>
    <path d="M1180 728 l3 -96 l5 0 l-2 96z"/><path d="M1184 636 q-48 -8 -72 18 q36 -18 72 -12z M1186 636 q48 -10 74 16 q-38 -16 -74 -10z M1185 634 q-24 -32 -62 -36 q32 12 60 40z M1186 634 q26 -34 64 -34 q-34 12 -62 38z"/>
  </g>
  <rect width="1600" height="900" fill="url(#ta-fade)"/>
</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export class MainMenu {
  readonly root: HTMLElement;
  private section: Section | null = null;

  constructor(
    parent: HTMLElement,
    private readonly lessons: LessonDef[],
    private readonly progress: () => ProgressData,
    private readonly actions: MainMenuActions,
  ) {
    this.root = el('div', 'main-menu', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    onLangChange(() => this.open && this.render());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * Open the menu. `title`: as the game's own start screen, over its own
   * picture instead of the game behind it.
   */
  show(title = false): void {
    this.root.classList.toggle('title-screen', title);
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove('title-screen');
  }

  private render(): void {
    const p = this.progress();
    const step = suggestedStep(p, this.lessons);
    this.section ??= step === 1 ? 'lessons' : 'test';
    this.root.replaceChildren();
    if (this.root.classList.contains('title-screen')) {
      const art = el('div', 'menu-art', this.root);
      art.innerHTML = TITLE_ART;
    }
    const shell = el('div', 'menu-shell', this.root);

    // --- the sections ---
    const nav = el('nav', 'menu-nav', shell);
    const brand = el('div', 'menu-brand', nav);
    el('div', 'menu-kicker', brand, t('menuKicker'));
    el('h1', '', brand, t('title'));
    const list = el('div', 'menu-sections', nav);
    const done = lessonsDone(p, this.lessons);
    const item = (key: Section | 'settings', name: IconName, label: StringKey, sub?: string) => {
      const b = el('button', `menu-section${key === this.section ? ' on' : ''}`, list);
      b.type = 'button';
      b.append(icon(name));
      el('span', 'section-label', b, t(label));
      if (sub) el('span', 'section-sub', b, sub);
      b.addEventListener('click', () => {
        if (key === 'settings') this.actions.onSettings();
        else {
          this.section = key;
          this.render();
        }
      });
    };
    item('lessons', 'book', 'navLessons', `${done}/${this.lessons.length}`);
    item('drive', 'wheel', 'navDrive');
    item('practise', 'cone', 'navPractise');
    item('test', 'flag', 'navTest', p.tests.taken > 0 ? `${p.tests.passed}/${p.tests.taken}` : undefined);
    item('settings', 'settings', 'settings');
    const foot = el('div', 'menu-foot', nav);
    const lang = el('button', 'menu-link', foot);
    lang.type = 'button';
    lang.append(icon('globe'));
    el('span', '', lang, t('language'));
    lang.addEventListener('click', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));
    const close = el('button', 'menu-link menu-close', foot);
    close.type = 'button';
    el('span', '', close, t(this.actions.closeLabel));
    close.addEventListener('click', this.actions.onClose);

    // --- what is in the chosen section ---
    const pane = el('section', 'menu-pane', shell);
    if (this.section === 'lessons') this.renderLessons(pane, p);
    else if (this.section === 'drive') this.renderMaps(pane, 'navDrive', 'driveLead', this.actions.driveMaps);
    else if (this.section === 'practise') this.renderMaps(pane, 'navPractise', 'practiseLead', this.actions.practiceMaps);
    else this.renderMaps(pane, 'navTest', 'testLead', this.actions.testParts, p.tests.taken > 0 ? t('testsTaken', { n: String(p.tests.taken), p: String(p.tests.passed) }) : undefined);
    el('p', 'menu-note', pane, t('menuUnofficial'));
  }

  private paneHead(pane: HTMLElement, title: StringKey, lead: StringKey, extra?: string): void {
    const head = el('header', 'pane-head', pane);
    el('h2', '', head, t(title));
    el('p', 'pane-lead', head, t(lead));
    if (extra) el('p', 'pane-extra', head, extra);
  }

  private renderLessons(pane: HTMLElement, p: ProgressData): void {
    const lang = getLang();
    const done = lessonsDone(p, this.lessons);
    this.paneHead(pane, 'navLessons', 'lessonsLead');
    const bar = el('div', 'lesson-progress', pane);
    const fill = el('div', 'lesson-progress-fill', bar);
    fill.style.width = `${(done / this.lessons.length) * 100}%`;
    el('span', 'lesson-progress-text', pane, t('menuLessonsDone', { n: String(done), total: String(this.lessons.length) }));
    const next = nextLesson(p, this.lessons);
    const rows = el('div', 'lesson-rows', pane);
    this.lessons.forEach((l, i) => {
      const stars = p.stars[l.id] ?? 0;
      const row = el('button', `lesson-row${l === next ? ' next' : ''}${stars > 0 ? ' done' : ''}`, rows);
      row.type = 'button';
      el('span', 'lesson-num', row, String(i + 1).padStart(2, '0'));
      const words = el('span', 'lesson-words', row);
      el('span', 'lesson-title', words, l.title[lang]);
      el('span', 'lesson-intro', words, l.intro[lang]);
      const st = el('span', 'lesson-stars', row);
      for (let k = 0; k < 3; k++) st.append(icon('star', k < stars ? 'won' : ''));
      if (l === next) el('span', 'lesson-go', row, t('startLesson'));
      row.addEventListener('click', () => this.actions.onLesson(l.id));
    });
  }

  private renderMaps(pane: HTMLElement, title: StringKey, lead: StringKey, maps: MenuMap[], extra?: string): void {
    this.paneHead(pane, title, lead, extra);
    const grid = el('div', 'map-tiles', pane);
    for (const m of maps) {
      const tile = el('button', 'map-tile', grid);
      tile.type = 'button';
      const pic = el('div', 'map-pic', tile);
      pic.append(m.thumb());
      const words = el('div', 'map-words', tile);
      el('span', 'map-title', words, t(m.title));
      el('span', 'map-facts', words, t(m.facts));
      el('span', 'map-note', words, t(m.note));
      const go = el('span', 'map-go', tile);
      el('span', '', go, t('drive'));
      go.append(icon('chevron'));
      tile.addEventListener('click', () => this.actions.onMode(m.mode));
    }
  }
}
