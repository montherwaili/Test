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

  show(): void {
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const p = this.progress();
    const step = suggestedStep(p, this.lessons);
    this.section ??= step === 1 ? 'lessons' : 'test';
    this.root.replaceChildren();
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
