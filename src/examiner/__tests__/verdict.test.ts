import { describe, expect, it } from 'vitest';
import type { ExamResult } from '../examiner';
import { verdict } from '../verdict';

const scoring = { maxMinor: 6, maxSerious: 0, verified: false };
const result = (minor: number, serious: number, fail: number): ExamResult => ({
  passed: false,
  minor,
  serious,
  fail,
  faults: [],
  manoeuvres: [],
});

describe('verdict', () => {
  it('passes a completed test within the limits', () => {
    expect(verdict(result(0, 0, 0), true, scoring)).toEqual({ passed: true, reasons: [] });
    expect(verdict(result(6, 0, 0), true, scoring)).toEqual({ passed: true, reasons: [] });
  });

  it('gives every reason that applies', () => {
    expect(verdict(result(7, 0, 0), true, scoring).reasons).toEqual(['tooManyMinor']);
    expect(verdict(result(0, 1, 0), true, scoring).reasons).toEqual(['tooManySerious']);
    expect(verdict(result(0, 0, 1), true, scoring).reasons).toEqual(['failFault']);
    expect(verdict(result(9, 2, 1), false, scoring).reasons).toEqual(['incomplete', 'failFault', 'tooManySerious', 'tooManyMinor']);
  });

  it('never passes an unfinished test, however clean', () => {
    expect(verdict(result(0, 0, 0), false, scoring)).toEqual({ passed: false, reasons: ['incomplete'] });
  });
});
