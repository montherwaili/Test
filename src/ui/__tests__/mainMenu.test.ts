import { describe, expect, it } from 'vitest';
import { lessonsDone, nextLesson, suggestedStep } from '../mainMenu';
import { emptyProgress } from '../../learning/progress';
import type { LessonDef } from '../../learning/lesson';

const lessons = ['controls', 'movingOff', 'gears', 'roundabouts', 'hillStart', 'parking', 'fullRoute'].map((id) => ({ id }) as LessonDef);

describe('home screen guidance', () => {
  it('sends a new player to the first lesson', () => {
    const p = emptyProgress();
    expect(lessonsDone(p, lessons)).toBe(0);
    expect(nextLesson(p, lessons)?.id).toBe('controls');
    expect(suggestedStep(p, lessons)).toBe(1);
  });

  it('moves on lesson by lesson, in course order', () => {
    const p = emptyProgress();
    p.stars = { controls: 3, movingOff: 1, roundabouts: 2 };
    expect(lessonsDone(p, lessons)).toBe(3);
    expect(nextLesson(p, lessons)?.id).toBe('gears');
    expect(suggestedStep(p, lessons)).toBe(1);
  });

  it('points to the test once most lessons are done', () => {
    const p = emptyProgress();
    for (const l of lessons.slice(0, 5)) p.stars[l.id] = 1;
    expect(suggestedStep(p, lessons)).toBe(3);
    for (const l of lessons) p.stars[l.id] = 2;
    expect(nextLesson(p, lessons)).toBeNull();
  });
});
