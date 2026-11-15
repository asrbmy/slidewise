import { describe, it, expect } from 'vitest';
import { parseHash, hrefFor } from './router.js';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseHash('#/')).toMatchObject({ name: 'home' });
    expect(parseHash('#/deck/abc-123')).toMatchObject({ name: 'editor', id: 'abc-123' });
    expect(parseHash('#/present/x1')).toMatchObject({ name: 'present', id: 'x1' });
    expect(parseHash('#/present/x1?s=4')).toMatchObject({ name: 'present', id: 'x1', query: { s: '4' } });
    expect(parseHash('#/presenter-view/x1')).toMatchObject({ name: 'presenterView', id: 'x1' });
  });
  it('falls back to home for unknown or empty', () => {
    expect(parseHash('')).toMatchObject({ name: 'home' });
    expect(parseHash('#/nope/1')).toMatchObject({ name: 'home' });
  });
  it('strips unsafe characters from ids', () => {
    expect(parseHash('#/deck/a%3Cb%3E')).toMatchObject({ name: 'editor', id: 'ab' });
  });
  it('builds hrefs', () => {
    expect(hrefFor('editor', 'z')).toBe('#/deck/z');
    expect(hrefFor('home')).toBe('#/');
  });
});
