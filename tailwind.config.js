/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6F2C91',
        deep: '#54206F',
        soft: '#8B5AA8',
        teal: '#00A6A6',
        navy: '#17233C',
        bg: '#F7F7FA',
        card: '#FFFFFF',
        softbg: '#F3EDF7',
        border: '#E8E3EC',
        shortage: '#D64545',
        balanced: '#2E9B68',
        surplus: '#00A6A6',
        attention: '#E6A23C',
      },
      boxShadow: {
        soft: '0 1px 3px rgba(23, 35, 60, 0.06), 0 1px 2px rgba(23, 35, 60, 0.04)',
        card: '0 2px 8px rgba(23, 35, 60, 0.06)',
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
