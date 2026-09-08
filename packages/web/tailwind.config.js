/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // Champagne gold — the luxury accent (active states, brand, highlights).
        gold: {
          50: '#faf7f0',
          100: '#f3ecdb',
          200: '#e7d8b4',
          300: '#d9c189',
          400: '#cbb06a',
          500: '#c6a664',
          600: '#b08d4a',
          700: '#8f6f3a',
          800: '#6f5730',
          900: '#4d3d24',
        },
        // Onyx / deep navy — luxury dark surfaces (sidebar, banners).
        ink: {
          50: '#f4f6fb',
          100: '#e7ebf4',
          200: '#c9d2e6',
          300: '#a2b0cf',
          400: '#7889b0',
          500: '#5a6a92',
          600: '#455277',
          700: '#363f5e',
          800: '#232a41',
          900: '#141929',
          950: '#0a0d18',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Marcellus', '"Plus Jakarta Sans"', 'Georgia', 'serif'],
      },
      boxShadow: {
        'luxe-sm': '0 2px 12px -4px rgba(16, 22, 40, 0.18)',
        luxe: '0 12px 40px -14px rgba(16, 22, 40, 0.28)',
        gold: '0 8px 30px -10px rgba(198, 166, 100, 0.55)',
      },
      letterSpacing: {
        luxe: '0.14em',
      },
    },
  },
  plugins: [],
};
