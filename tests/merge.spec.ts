import { mergeDeepObjectsOnly } from '../src/repositories/base.repository';

describe('mergeDeepObjectsOnly', () => {
  it('merges nested objects', () => {
    const result = mergeDeepObjectsOnly({ a: { b: 1, c: 2 } }, { a: { c: 99, d: 3 } });

    expect(result).toEqual({ a: { b: 1, c: 99, d: 3 } });
  });

  it('replaces arrays instead of concatenating', () => {
    const result = mergeDeepObjectsOnly({ list: [1, 2] }, { list: [3, 4] });

    expect(result).toEqual({ list: [3, 4] });
  });

  it('replaces Date values', () => {
    const earlier = new Date('2020-01-01');
    const later = new Date('2025-01-01');

    const result = mergeDeepObjectsOnly({ ts: earlier }, { ts: later });

    expect(result.ts).toBe(later);
  });

  it('deletes a key when the override is null', () => {
    const result = mergeDeepObjectsOnly({ a: 1, b: 2 }, { a: null });

    expect(result).toEqual({ b: 2 });
    expect('a' in result).toBe(false);
  });

  it('returns an empty object when given no arguments', () => {
    expect(mergeDeepObjectsOnly()).toEqual({});
  });

  it('overrides primitives with later values', () => {
    expect(mergeDeepObjectsOnly({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 3 });
  });
});
