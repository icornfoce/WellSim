/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Medical-grade blue palette
        medical: {
          50:  '#EEF5FF',
          100: '#D9E8FF',
          200: '#BCD5FF',
          300: '#8EBBFF',
          400: '#5996FF',
          500: '#336FFF',
          600: '#1A4FF5',
          700: '#133CE1',
          800: '#1633B6',
          900: '#18308F',
          950: '#141F57',
        },
        // Accent colors for status indicators
        vitals: {
          green:  '#10B981',
          red:    '#EF4444',
          amber:  '#F59E0B',
          blue:   '#3B82F6',
          purple: '#8B5CF6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.5s ease-out forwards',
        'slide-up':   'slideUp 0.5s ease-out forwards',
        'glow':       'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glow: {
          '0%':   { boxShadow: '0 0 5px rgba(51, 111, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(51, 111, 255, 0.4)' },
        },
      },
      boxShadow: {
        'card':      '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 10px 25px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.04)',
        'medical':   '0 4px 14px rgba(51, 111, 255, 0.12)',
      },
    },
  },
  plugins: [],
};
