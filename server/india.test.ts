import { describe, expect, it } from 'vitest';
import { indiaSearchPartitions, parseIndiaBbox, validSearchQuery } from './india';

describe('India discovery partitioning', () => {
  it('covers India with bounded cells suitable for deliberate searches', () => {
    const cells = indiaSearchPartitions();
    expect(cells.length).toBe(36);
    expect(cells.every(([s,w,n,e]) => n > s && e > w && n-s <= 5 && e-w <= 5 && (n-s)*(e-w) <= 25)).toBe(true);
  });
  it('validates ICAO24 and callsign search terms', () => {
    expect(validSearchQuery('abc123')).toEqual({query:'ABC123',kind:'icao24'});
    expect(validSearchQuery('ai 123')).toEqual({query:'AI123',kind:'callsign'});
    expect(validSearchQuery('x')).toBeNull();
    expect(validSearchQuery('!@#')).toBeNull();
  });
  it('keeps regional bbox validation separate from search cells', () => {
    expect(parseIndiaBbox('27,76,29,79')).toEqual([27,76,29,79]);
    expect(parseIndiaBbox('0,0,80,90')).toBeNull();
  });
});
