// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'prebuilds/**',
      'node_modules/**',
      'src/proto/**',
      '**/*.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'samples/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
