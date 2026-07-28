/**
 * Stricter lint pass for M5 publish (`pnpm run lint:prepublish`).
 *
 * Re-enables the rules that are relaxed during development but MUST hold before
 * the package is published to npm / submitted to the n8n gallery. Publishing is
 * M5 — this config exists so that gate is a one-command check, not a scramble.
 */
const baseConfig = require('./.eslintrc.js');

module.exports = {
  ...baseConfig,
  overrides: [
    {
      ...baseConfig.overrides[0],
      rules: {
        'n8n-nodes-base/community-package-json-name-still-default': 'error',
      },
    },
    ...baseConfig.overrides.slice(1),
  ],
};
