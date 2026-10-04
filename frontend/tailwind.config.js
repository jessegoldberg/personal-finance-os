/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { 950: '#0b0f17', 900: '#111723', 850: '#151c2b', 800: '#1b2335', 700: '#26304a', 600: '#36415e' },
      },
    },
  },
  plugins: [],
}
