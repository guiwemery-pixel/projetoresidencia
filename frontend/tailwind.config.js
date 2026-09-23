/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface)',
        subtle: 'var(--subtle)',
        line: 'var(--border)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-wash': 'var(--accent-wash)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        serious: 'var(--serious)',
        crit: 'var(--crit)',
        'good-wash': 'var(--good-wash)',
        'warn-wash': 'var(--warn-wash)',
        'serious-wash': 'var(--serious-wash)',
        'crit-wash': 'var(--crit-wash)',
        'good-text': 'var(--good-text)',
        'crit-text': 'var(--crit-text)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 3px rgba(11,11,11,0.04)',
        pop: '0 12px 32px rgba(11,11,11,0.16)',
      },
    },
  },
  plugins: [],
};
