/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        clinical: {
          bg: '#0b1220',
          panel: '#111a2e',
          border: '#1e2a44',
          accent: '#5eead4',
          danger: '#f87171',
          warn: '#fbbf24',
          ok: '#34d399',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
