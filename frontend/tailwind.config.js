/** @type {import('tailwindcss').Config} */
/**
 * WellSim Design System v3 — "Instrument"
 * Editorial-clinical: paper & ink, hairline rules, a single medical
 * green accent, IBM Plex type. No gradients, no glow, no decoration
 * that doesn't carry information.
 */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,jsx,ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Light surfaces
        paper:   '#F6F6F4', // page background — warm grey, not blue
        surface: '#FFFFFF', // cards
        ink:     '#15181B', // primary text / primary buttons
        muted:   '#6A716E', // secondary text
        hairline: {
          DEFAULT: '#E4E6E2',
          strong:  '#C9CDC8',
        },
        // Dark surfaces (charcoal, slightly green-cast)
        coal: {
          950: '#0B0D0C',
          900: '#101312',
          850: '#141817',
          800: '#1A1F1D',
          700: '#252B28',
          600: '#343B38',
        },
        chalk: {
          DEFAULT: '#E8EBE9', // primary text on dark
          muted:   '#96A09B', // secondary text on dark
        },
        // Single accent — clinical green
        med: {
          100: '#DEF0EB',
          300: '#5FC7B2',
          400: '#35AD94',
          500: '#129077',
          600: '#0E7C66',
          700: '#0A5F4E',
          950: '#0A2620',
        },
        // Risk semantics (muted, print-like)
        risk: {
          high:  '#C4453C',
          highd: '#E06A5F',
          mod:   '#A97B22',
          modd:  '#D9A44A',
          low:   '#2F7D5F',
          lowd:  '#57A886',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'IBM Plex Sans Thai', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        micro: ['10px', { letterSpacing: '0.14em', lineHeight: '1.2' }],
      },
      animation: {
        'fade-in':  'fadeIn 0.4s ease-out forwards',
        'fade-up':  'fadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'sweep':    'sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'blink':    'blink 2.4s ease-in-out infinite',
        'ecg':      'ecgDash 4s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        sweep: {
          '0%':   { left: '-30%' },
          '100%': { left: '100%' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.3' },
        },
        ecgDash: {
          '0%':   { strokeDashoffset: '520' },
          '100%': { strokeDashoffset: '0' },
        },
      },
    },
  },
  plugins: [],
};
