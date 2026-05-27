import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        cream: 'rgb(var(--color-cream) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        bone: 'rgb(var(--color-bone) / <alpha-value>)',
        coral: 'rgb(var(--color-coral) / <alpha-value>)',
        yellow: 'rgb(var(--color-yellow) / <alpha-value>)',
        mauve: 'rgb(var(--color-mauve) / <alpha-value>)',
        sage: 'rgb(var(--color-sage) / <alpha-value>)',
        teal: 'rgb(var(--color-teal) / <alpha-value>)'
      },
      fontFamily: {
        brand: ['DynaPuff', 'Noto Sans', 'system-ui', 'sans-serif'],
        sans: ['Noto Sans', 'system-ui', 'sans-serif'],
        accent: ['Delius', 'Noto Sans', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        eh: '6px'
      },
      boxShadow: {
        hard: '0 0 0 1px rgb(var(--color-bone) / 0.2)'
      }
    }
  },
  plugins: []
} satisfies Config;
