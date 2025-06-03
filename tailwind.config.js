/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      gray: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
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
