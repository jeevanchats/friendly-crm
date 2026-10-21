import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          teal: {
            DEFAULT: '#167D79',
            light: '#1F9893',
            dark: '#115E5B',
            50: '#E8F5F5',
            100: '#D1EBEA',
            500: '#167D79',
            600: '#136F6B',
            700: '#105B58',
          },
          gold: {
            DEFAULT: '#F4B860',
            light: '#F7C882',
            dark: '#D89A3E',
            50: '#FEF8EE',
            100: '#FDF1DD',
            500: '#F4B860',
            600: '#E29E37',
          },
          white: {
            DEFAULT: '#F6F8F7',
            soft: '#F6F8F7',
          },
          slate: {
            DEFAULT: '#243B40',
            light: '#314F55',
            dark: '#1A2B2E',
            50: '#F0F3F4',
            100: '#E0E7E8',
            800: '#243B40',
            900: '#17272A',
          },
        },
      },
      fontFamily: {
        sans: [
          'Inter',
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
        'soft-teal': '0 4px 20px -2px rgba(22, 125, 121, 0.15)',
        'soft-gold': '0 4px 20px -2px rgba(244, 184, 96, 0.2)',
      },
    },
  },
  plugins: [],
};
export default config;
