/**
 * Minimal Jest setup for the PuanLab pure business rules.
 *
 * `jest-expo` is Expo's own Jest preset for SDK 58: it wires the Metro/Babel
 * transform and resolves the `@/*` TypeScript path aliases from `tsconfig.json`,
 * so tests can import the same modules the app does. No `babel.config.js` is
 * required — the preset falls back to Expo's Babel preset.
 */
module.exports = {
  preset: 'jest-expo',
};
