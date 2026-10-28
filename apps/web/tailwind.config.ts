import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: { relative: true, files: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ] },
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        action: 'rgb(var(--action) / <alpha-value>)',
        'on-action': 'rgb(var(--on-action) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'accent-text': 'rgb(var(--accent-text) / <alpha-value>)',
        slate: Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map(step => [step, `rgb(var(--slate-${step}) / <alpha-value>)`])),
        brand: {
          ink: 'rgb(var(--foreground) / <alpha-value>)',
          mint: 'rgb(var(--action) / <alpha-value>)',
          canvas: '#FFFFFF',
          teal: {
            DEFAULT: '#02937B',
            light: '#02937B',
            dark: 'rgb(var(--accent-text) / <alpha-value>)',
            50: 'rgb(var(--accent-soft) / <alpha-value>)',
            100: '#CBEDE6',
            500: '#02937B',
            600: '#01715F',
            700: '#015C4D',
          },
          gold: {
            DEFAULT: '#02937B',
            light: '#CBEDE6',
            dark: 'rgb(var(--accent-text) / <alpha-value>)',
            50: 'rgb(var(--accent-soft) / <alpha-value>)',
            100: '#CBEDE6',
            500: '#02937B',
            600: '#01715F',
          },
          white: {
            DEFAULT: '#FFFFFF',
            soft: '#FFFFFF',
          },
          slate: {
            DEFAULT: 'rgb(var(--foreground) / <alpha-value>)',
            light: 'rgb(var(--muted) / <alpha-value>)',
            dark: 'rgb(var(--accent-text) / <alpha-value>)',
            50: '#F0F3F4',
            100: '#E0E7E8',
            800: '#0F1417',
            900: '#0F1417',
          },
        },
      },
      fontFamily: {
        sans: [
          'var(--font-jakarta)',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Mukta Malar"',
          '"Noto Sans Tamil"',
          'sans-serif',
        ],
      },
      boxShadow: {
        'soft-teal': '0 4px 20px -2px rgba(15, 20, 23, 0.12)',
        'soft-gold': '0 4px 20px -2px rgba(15, 20, 23, 0.12)',
      },
    },
  },
  plugins: [],
};
export default config;
