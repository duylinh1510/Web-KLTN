/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#0f172a',
        panelAlt: '#111827',
        borderSubtle: '#1e293b',
      },
    },
  },
  plugins: [],
};