/** The list of lessons, with stars earned and the one suggested for practice. */
import type { LessonDef } from '../learning/lesson';
import { recommend, type ProgressData } from '../learning/progress';
import { getLang, onLangChange, t } from './i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export class LessonsMenu {
  readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly lessons: LessonDef[],
    private readonly progress: () => ProgressData,
    private readonly onStart: (lessonId: string) => void,
  ) {
    this.root = el('div', 'lessons-menu', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
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
    const lang = getLang();
    const p = this.progress();
    const suggested = recommend(p, this.lessons);
    this.root.replaceChildren();
    const card = el('div', 'lessons-card', this.root);
    el('h2', '', card, t('lessons'));
    el('p', 'lessons-stats', card, t('testsTaken', { n: String(p.tests.taken), p: String(p.tests.passed) }));
    const list = el('ol', 'lessons-list', card);
    for (const l of this.lessons) {
      const li = el('li', l.id === suggested ? 'suggested' : '', list);
      const info = el('div', 'info', li);
      const title = el('div', 'title', info, l.title[lang]);
      if (l.id === suggested) el('span', 'badge', title, t('recommended'));
      el('p', 'intro', info, l.intro[lang]);
      const stars = el('span', 'stars', li);
      stars.dir = 'ltr';
      const n = p.stars[l.id] ?? 0;
      stars.setAttribute('aria-label', `${n} / 3`);
      for (let i = 0; i < 3; i++) el('span', i < n ? 'on' : '', stars, '★');
      const go = el('button', 'hud-btn primary', li, t('lessonStart'));
      go.type = 'button';
      go.addEventListener('click', () => this.onStart(l.id));
    }
    const actions = el('div', 'lessons-actions', card);
    if (suggested) {
      const practise = el('button', 'hud-btn primary', actions, t('practiseWeakest'));
      practise.type = 'button';
      practise.addEventListener('click', () => this.onStart(suggested));
    }
    const close = el('button', 'hud-btn', actions, t('close2'));
    close.type = 'button';
    close.addEventListener('click', () => this.hide());
  }
}
