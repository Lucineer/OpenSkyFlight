import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: 'error',
      'no-alert': 'warn',
    },
  },
  {
    // scripts/ is Node, not browser. It was previously outside the lint scope
    // entirely, which meant it was the only real code in the repo with no gate
    // at all. Linting it as browser code was the reason it was left out:
    // `process` and `Buffer` are legitimately undefined in a browser.
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['vendor/**', 'cache/**', 'node_modules/**'],
  },
];
