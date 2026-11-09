import { resolveColorScheme } from '../resolveTheme';

/**
 * `resolveColorScheme` is the single place where the saved preference turns
 * into a rendered scheme. It is pure, so the rules are asserted directly.
 */
describe('resolveColorScheme', () => {
  it('resolves the system preference to the device light scheme', () => {
    expect(resolveColorScheme('system', 'light')).toBe('light');
  });

  it('resolves the system preference to the device dark scheme', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
  });

  it('falls back to light for the system preference when the device scheme is unknown', () => {
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', undefined)).toBe('light');
  });

  it('lets the light override ignore a dark device scheme', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
  });

  it('lets the dark override ignore a light device scheme', () => {
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });
});
