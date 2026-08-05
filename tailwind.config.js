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
    // Breakpoints named for where this app's content actually breaks.
    // sm/md/lg/xl/2xl keep Tailwind's default values; `xs` is new and matches
    // the `@media (max-width: 480px)` rules already in claymorphism.css.
    //   xs  480  single-column card content stops fitting side by side
    //   sm  640  toolbars can go horizontal
    //   md  768  two-column dashboard grids
    //   lg 1024  desktop sidebar replaces the bottom nav
    //   xl 1280  tables can show every column
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Ramps are the existing brand hues, extended downwards so text has an
        // accessible step. Contrast measured against cream #FAF9F6.
        //   saffron 500 is the brand accent and is NOT safe for text (2.84:1) —
        //   use it for fills, icons and graphics; use 700/800 for text.
        saffron: {
          DEFAULT: '#FF6B35',
          dark: '#F4722B',
          light: '#FF8C5A',
          300: '#FF8C5A',
          500: '#FF6B35', // 2.84:1 — fills only
          600: '#E55A2B', // 3.42:1 — large text / filled buttons
          700: '#D4531F', // 3.94:1
          800: '#B84318', // 5.18:1 — AA for all text sizes
        },
        cream: {
          DEFAULT: '#FAF9F6',
          dark: '#F2EFE9',
          100: '#FAF9F6',
          200: '#F5F0E8',
          300: '#EDE8E0',
          400: '#E5E0D8',
        },
        gold: {
          DEFAULT: '#D4AF37',
          500: '#D4AF37', // 2.00:1 — decorative only, never text
          700: '#8A6A1F', // 4.79:1 — AA text
        },
        coffee: {
          DEFAULT: '#3D2914',
          900: '#3D2914', // 13.07:1 — primary text
          700: '#5D4930', //  8.10:1 — secondary text
          500: '#7A6B5A', //  4.89:1 — muted text, AA floor
          400: '#8C7B68', //  3.87:1 — non-text only
        },
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
      // Stacking ladder. These six are the only values that should be used.
      // The numeric z-0…z-50 utilities still exist but are being migrated off;
      // today the codebase holds 11 competing values including a bare 9999.
      //   base 0 · raised 10 · sticky 100 · dropdown 1000 · modal 1100 · toast 1200
      zIndex: {
        base: '0',
        raised: '10',
        sticky: '100',
        dropdown: '1000',
        modal: '1100',
        toast: '1200',
      },
      // Elevation scale. Values lifted verbatim from the claymorphism classes so
      // one card treatment can be reused without re-typing a 3-layer shadow.
      // Use a border OR a shadow to separate a surface, never both.
      boxShadow: {
        'clay-raised': '8px 8px 24px 0 rgba(61, 47, 20, 0.15), inset 8px 8px 16px 0 rgba(255, 255, 255, 0.8), inset -4px -4px 12px 0 rgba(61, 47, 20, 0.08)',
        'clay-hover': '12px 12px 32px 0 rgba(61, 47, 20, 0.18), inset 8px 8px 16px 0 rgba(255, 255, 255, 0.9), inset -4px -4px 12px 0 rgba(61, 47, 20, 0.1)',
        'clay-inset': 'inset 4px 4px 8px 0 rgba(61, 47, 20, 0.08), inset -2px -2px 6px 0 rgba(255, 255, 255, 0.9)',
        'clay-overlay': '20px 20px 48px 0 rgba(61, 47, 20, 0.2), inset 8px 8px 16px 0 rgba(255, 255, 255, 0.8), inset -4px -4px 12px 0 rgba(61, 47, 20, 0.05)',
      },
    },
  },
  plugins: [],
};
