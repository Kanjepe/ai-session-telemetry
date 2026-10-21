import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'archive/', 'docs/', '.playwright-mcp/'] },
  js.configs.recommended,
  {
    files: ['server.js', 'lib/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
