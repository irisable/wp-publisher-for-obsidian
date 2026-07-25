import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'main.js',
      'node_modules/',
      'dist/',
      'wordpress-companion/**/*.zip'
    ]
  },
  {
    files: [ 'src/**/*.ts' ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': [ 'error', { allow: [ 'warn', 'error' ] } ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [ 'error', { args: 'none' } ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-prototype-builtins': 'off'
    }
  }
];
