/**
 * The home screen: the way through the game in three steps - learn the
 * controls and the manoeuvres in lessons, practise (freely, or with the
 * examiner's notes), then take the test, yard first and road second as at
 * the real test.
 */
import type { LessonDef } from '../learning/lesson';
import type { ProgressData } from '../learning/progress';
import type { GameMode } from './hud';
import { getLang, onLangChange, setLang, t, type StringKey } from './i18n';
import { icon } from './icons';

export interface MainMenuActions {
  onMode: (mode: GameMode) => void;
  onLesson: (id: string) => void;
  onAllLessons: () => void;
  onSettings: () => void;
  /** Close the menu and carry on with what is running. */
  onClose: () => void;
  /** Label of the close button ("carry on free driving", or just "back"). */
  closeLabel: StringKey;
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export class MainMenu {
  readonly root: HTMLElement;

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

  private button(parent: HTMLElement, text: string, onClick: () => void, primary = false, note?: string): HTMLButtonElement {
    const b = el('button', `menu-choice${primary ? ' primary' : ''}`, parent);
    b.type = 'button';
    const words = el('span', 'choice-words', b);
    el('span', 'choice-title', words, text);
    if (note) el('span', 'choice-note', words, note);
    b.append(icon('chevron', 'choice-go'));
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    const lang = getLang();
    const p = this.progress();
    const done = lessonsDone(p, this.lessons);
    const next = nextLesson(p, this.lessons);
    const step = suggestedStep(p, this.lessons);
    this.root.replaceChildren();
    const card = el('div', 'menu-card', this.root);

    // The title side: name, one line on how it works, and the next thing to do.
    const head = el('header', 'menu-head', card);
    el('div', 'menu-kicker', head, t('menuKicker'));
    el('h1', '', head, t('title'));
    el('p', 'menu-lead', head, t('menuLead'));
    const go = el('button', 'menu-cta', head);
    go.type = 'button';
    if (step === 1 && next) {
      el('span', '', go, `${t('menuNextLesson')}: ${next.title[lang]}`);
      go.addEventListener('click', () => this.actions.onLesson(next.id));
    } else {
      el('span', '', go, t('testYard'));
      go.addEventListener('click', () => this.actions.onMode('yardTest'));
    }
    go.append(icon('chevron'));
    const foot = el('div', 'menu-foot', head);

    const steps = el('div', 'menu-steps', card);
    const stepBox = (n: 1 | 2 | 3, title: StringKey, intro: StringKey) => {
      const box = el('section', `menu-step${n === step ? ' current' : ''}`, steps);
      const top = el('div', 'step-top', box);
      el('span', 'step-num', top, `0${n}`);
      el('h2', '', top, t(title));
      if (n === step) el('span', 'step-badge', top, t('menuStartHere'));
      el('p', 'step-intro', box, t(intro));
      return el('div', 'step-choices', box);
    };

    // 1. Learn
    const learn = stepBox(1, 'menuLearn', 'menuLearnIntro');
    el('p', 'step-progress', learn, t('menuLessonsDone', { n: String(done), total: String(this.lessons.length) }));
    if (next) {
      this.button(learn, `${t('menuNextLesson')}: ${next.title[lang]}`, () => this.actions.onLesson(next.id), step === 1, next.intro[lang]);
    }
    this.button(learn, t('menuAllLessons'), this.actions.onAllLessons);

    // 2. Practise
    const practise = stepBox(2, 'menuPractise', 'menuPractiseIntro');
    this.button(practise, t('freeDrive'), () => this.actions.onMode('free'), false, t('menuFreeNote'));
    this.button(practise, t('practiseTown'), () => this.actions.onMode('town'), false, t('menuTownNote'));
    this.button(practise, t('practiseYard'), () => this.actions.onMode('yard'), false, t('menuYardNote'));

    // 3. Test
    const test = stepBox(3, 'menuTest', 'menuTestIntro');
    this.button(test, `1 · ${t('testYard')}`, () => this.actions.onMode('yardTest'), step === 3, t('menuYardTestNote'));
    this.button(test, `2 · ${t('testRoad')}`, () => this.actions.onMode('roadTest'), false, t('menuRoadTestNote'));
    if (p.tests.taken > 0) el('p', 'step-progress', test, t('testsTaken', { n: String(p.tests.taken), p: String(p.tests.passed) }));

    const settings = el('button', 'menu-link', foot);
    settings.type = 'button';
    settings.append(icon('settings'));
    el('span', '', settings, t('settings'));
    settings.addEventListener('click', this.actions.onSettings);
    const lang2 = el('button', 'menu-link', foot);
    lang2.type = 'button';
    lang2.append(icon('globe'));
    el('span', '', lang2, t('language'));
    lang2.addEventListener('click', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));
    const close = el('button', 'menu-link menu-close', foot);
    close.type = 'button';
    el('span', '', close, t(this.actions.closeLabel));
    close.addEventListener('click', this.actions.onClose);
    el('p', 'menu-note', head, t('menuUnofficial'));
  }
}
