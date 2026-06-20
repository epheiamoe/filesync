/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#faf9f5',
        'canvas-soft': '#f5f0e8',
        'canvas-card': '#efe9de',
        primary: {
          DEFAULT: '#cc785c',
          active: '#a9583e',
          disabled: '#e6dfd8',
        },
        ink: '#141413',
        body: {
          DEFAULT: '#3d3d3a',
          strong: '#252523',
        },
        muted: {
          DEFAULT: '#6c6a64',
          soft: '#8e8b82',
        },
        hairline: {
          DEFAULT: '#e6dfd8',
          soft: '#ebe6df',
        },
        surface: {
          dark: '#181715',
          'dark-elevated': '#252320',
          'dark-soft': '#1f1e1b',
        },
        'on-primary': '#ffffff',
        'on-dark': '#faf9f5',
        'on-dark-soft': '#a09d96',
        success: '#5db872',
        warning: '#d4a017',
        error: '#c64545',
        'accent-teal': '#5db8a6',
        'accent-amber': '#e8a55a',
      },
      fontFamily: {
        display: ["'Cormorant Garamond'", "'Times New Roman'", 'serif'],
        body: ["'Inter'", '-apple-system', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'monospace'],
      },
      borderRadius: {
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '9999px',
      },
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        xxl: '48px',
        section: '96px',
      },
      fontSize: {
        'display-lg': ['48px', { lineHeight: '1.1', letterSpacing: '-1px', fontWeight: '400' }],
        'display-md': ['36px', { lineHeight: '1.15', letterSpacing: '-0.5px', fontWeight: '400' }],
        'display-sm': ['28px', { lineHeight: '1.2', letterSpacing: '-0.3px', fontWeight: '400' }],
        'title-lg': ['22px', { lineHeight: '1.3', fontWeight: '500' }],
        'title-md': ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        'title-sm': ['16px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      animation: {
        'shake': 'shake 0.5s ease-in-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
