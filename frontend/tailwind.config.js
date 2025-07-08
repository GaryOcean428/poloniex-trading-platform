/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      'xs': '475px',    // Extra small devices
      'sm': '640px',    // Small devices
      'md': '768px',    // Medium devices  
      'lg': '1024px',   // Large devices
      'xl': '1280px',   // Extra large devices
      '2xl': '1536px',  // 2X large devices
      // Custom responsive breakpoints
      'mobile': {'max': '767px'},        // Mobile-first breakpoint
      'tablet': {'min': '768px', 'max': '1023px'},  // Tablet range
      'desktop': {'min': '1024px'},      // Desktop and up
    },
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
    extend: {
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      maxWidth: {
        '8xl': '88rem',
        '9xl': '96rem',
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
      },
      gridTemplateColumns: {
        'responsive': 'repeat(auto-fit, minmax(300px, 1fr))',
        'card-grid': 'repeat(auto-fill, minmax(280px, 1fr))',
      },
    },
  },
  plugins: [],
};