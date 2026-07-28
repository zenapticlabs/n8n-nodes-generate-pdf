/**
 * n8n community-node verification linter (SC-001).
 *
 * `eslint-plugin-n8n-nodes-base` is the ruleset the n8n team runs to verify a
 * community node before it is listed. Passing it clean IS the "verification-
 * ready" bar. The three configs cover the three surfaces:
 *   - community  → package.json shape (keywords, n8n block)
 *   - credentials → the ICredentialType class
 *   - nodes       → the INodeType class
 *
 * Type-aware linting (`parserOptions.project`) is intentionally NOT enabled:
 * the n8n rules are AST-based and need no TypeChecker, so omitting it keeps the
 * lint fast and free of "file not in project" coupling.
 */
module.exports = {
  root: true,
  env: { es6: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020,
    extraFileExtensions: ['.json'],
  },
  ignorePatterns: ['.eslintrc.js', '.eslintrc.prepublish.js', 'gulpfile.js', '**/*.js', 'dist/**', 'node_modules/**'],
  overrides: [
    {
      files: ['package.json'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/community'],
      rules: {
        // Turned back on in .eslintrc.prepublish.js at M5 publish time.
        'n8n-nodes-base/community-package-json-name-still-default': 'off',
      },
    },
    {
      files: ['./credentials/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/credentials'],
      rules: {
        // The shared `credentials` config bundles three mutually-exclusive
        // documentationUrl rules. `-miscased` demands a camelCase slug and its
        // own docs say it is "Only applicable to nodes in the main repository";
        // `-not-http-url` demands a real HTTP URL and is "Only applicable to
        // community credentials". A community package cannot satisfy both. As a
        // community package we keep the community rule (a real HTTPS URL) and
        // disable the main-repo-only rule it conflicts with.
        'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
      },
    },
    {
      files: ['./nodes/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/nodes'],
    },
  ],
};
