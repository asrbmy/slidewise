import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { friendlyError } from './friendlyError.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const Boom = ({ msg }) => { throw new Error(msg); };
const mount = async (el) => { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); await act(async () => { root.render(el); }); return host; };

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page, with reload and technical details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await mount(<ErrorBoundary><Boom msg="kaboom" /></ErrorBoundary>);
    expect(host.querySelector('[role=alert] h1').textContent).toBe('Something went wrong');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);
    expect(host.querySelector('details pre').textContent).toContain('kaboom'); spy.mockRestore();
  });
  it('explains a stale lazy chunk after an update', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await mount(<ErrorBoundary><Boom msg="Failed to fetch dynamically imported module: x.js" /></ErrorBoundary>);
    expect(host.querySelector('h1').textContent).toBe('Slidewise was updated'); spy.mockRestore();
  });
  it('renders children untouched when nothing fails', async () => {
    const host = await mount(<ErrorBoundary><p id="ok">fine</p></ErrorBoundary>); expect(host.querySelector('#ok').textContent).toBe('fine');
  });
});

describe('friendlyError', () => {
  it('maps quota, blocked-storage and closed-connection errors to actionable text', () => {
    expect(friendlyError({ name: 'QuotaExceededError', message: 'x' })).toMatch(/storage is full/);
    expect(friendlyError({ name: 'SecurityError', message: 'x' })).toMatch(/blocked storage/);
    expect(friendlyError({ name: 'InvalidStateError', message: 'x' })).toMatch(/Reload/);
    expect(friendlyError(new Error('plain'))).toBe('plain'); expect(friendlyError(null, 'fb')).toBe('fb');
  });
});
