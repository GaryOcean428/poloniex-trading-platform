/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      neutral: {
        50: '#fafafa',
        100: '#f5f5f5',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#404040',
        800: '#262626',
        900: '#171717',
      },
      red: {
        600: '#dc2626',
        700: '#b91c1c',
      },
      blue: {
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
      },
      green: {
        500: '#10b981',
        600: '#059669',
        700: '#047857',
      },
      yellow: {
        500: '#f59e0b',
        600: '#d97706',
      },
      purple: {
        500: '#8b5cf6',
        600: '#7c3aed',
      }
    },
  },
  plugins: [],
};