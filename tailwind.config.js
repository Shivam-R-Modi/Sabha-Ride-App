/** @type {import('tailwindcss').Config} */
// Theme copied verbatim from the former inline `tailwind.config` in index.html.
// Token normalisation is deliberately NOT part of this commit.
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        saffron: {
          DEFAULT: '#FF6B35',
          dark: '#F4722B',
          light: '#FF8C5A',
        },
        cream: {
          DEFAULT: '#FAF9F6',
          dark: '#F2EFE9',
        },
        gold: '#D4AF37',
        coffee: '#3D2914',
        mocha: '#5C4033',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        header: ['Poppins', 'sans-serif'],
        cursive: ['"Great Vibes"', 'cursive'],
        gujarati: ['"Noto Sans Gujarati"', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 3s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
    },
  },
  plugins: [],
};
