/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1a1d27',
          elevated: '#242836',
          overlay: '#2a2e3d'
        },
        background: '#0f1117',
        accent: {
          blue: '#3b82f6',
          violet: '#8b5cf6',
          pink: '#ec4899',
          emerald: '#10b981',
          amber: '#f59e0b',
          orange: '#f97316',
          red: '#ef4444',
          slate: '#64748b'
        }
      }
    }
  },
  plugins: []
}
