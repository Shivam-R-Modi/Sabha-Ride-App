/** @type {import('tailwindcss').Config} */
// Colour is NOT defined here. Every value below resolves to a semantic token in
// theme.css, which is the single place a colour is chosen and the mechanism the
// day/night switch works through. See the header of that file.
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
      spacing: {
        // Clearance for the fixed bottom nav, including the home-indicator
        // inset. --bottom-nav-h is declared in claymorphism.css next to the
        // nav itself so the two cannot drift apart.
        'safe-nav': 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))',
      },
      // Every brand colour is a view onto a semantic token in theme.css, so
      // `text-coffee` and `bg-cream` follow the day/night switch with no `dark:`
      // variant anywhere in the codebase. The ramps and their meanings are
      // unchanged — the LIGHT values resolve to exactly the hexes that used to
      // be written here, which is what makes Phase 1 a pure refactor.
      //
      // `<alpha-value>` is what lets `bg-cream/50` still work. It only works
      // because the tokens are space-separated RGB channels rather than hex;
      // see the format note at the top of theme.css.
      //
      // Contrast ratios below are for LIGHT mode, measured on cream #FAF9F6.
      // The dark equivalents are held to the same AA floor in theme.css.
      /**
       * Tailwind's preflight paints EVERY element `border-color: #e5e7eb` at zero
       * width. That fixed light grey is invisible in light mode and bright on a
       * dark panel, and it becomes visible the moment anything animates a border.
       *
       * That is exactly what happened in the sidebar: the selected nav item adds
       * `border border-hairline/10` while the unselected one has no border
       * utility, so with `transition-all` a click animated width 0 -> 1px AND
       * colour #e5e7eb -> 10% white. For 150ms both the clicked item and the
       * previously selected one drew a near-opaque light line on a 46 40 34 panel
       * — reported as "a white border blinking in sequence", and invisible in
       * light mode because #e5e7eb on cream is nothing.
       *
       * `transparent` is the right default for a themed app: a border nobody
       * coloured should not appear, rather than appear in a colour that cannot
       * follow the theme. Verified before changing it that NO element in
       * components/ sets a border width without also setting a colour, so nothing
       * relied on the grey.
       */
      borderColor: { DEFAULT: 'transparent' },
      colors: {
        saffron: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          dark: 'rgb(var(--accent-mid) / <alpha-value>)',
          light: 'rgb(var(--accent-light) / <alpha-value>)',
          300: 'rgb(var(--accent-light) / <alpha-value>)',
          500: 'rgb(var(--accent) / <alpha-value>)',      // 2.84:1 — fills only
          600: 'rgb(var(--accent-dark) / <alpha-value>)', // 3.42:1 — large text / filled buttons
          700: 'rgb(var(--accent-deep) / <alpha-value>)', // 3.94:1
          800: 'rgb(var(--accent-text) / <alpha-value>)', // 5.18:1 — AA for all text sizes
        },
        cream: {
          DEFAULT: 'rgb(var(--canvas) / <alpha-value>)',
          dark: 'rgb(var(--canvas-soft) / <alpha-value>)',
          100: 'rgb(var(--canvas) / <alpha-value>)',
          200: 'rgb(var(--canvas-mid) / <alpha-value>)',
          300: 'rgb(var(--canvas-deep) / <alpha-value>)',
          400: 'rgb(var(--sunken) / <alpha-value>)',
        },
        gold: {
          DEFAULT: 'rgb(var(--gold) / <alpha-value>)',
          500: 'rgb(var(--gold) / <alpha-value>)',      // 2.00:1 — decorative only, never text
          700: 'rgb(var(--gold-text) / <alpha-value>)', // 5.68:1 on canvas, 4.55 on --sunken — AA everywhere
        },
        coffee: {
          DEFAULT: 'rgb(var(--text-strong) / <alpha-value>)',
          900: 'rgb(var(--text-strong) / <alpha-value>)', // 13.07:1 — primary text
          700: 'rgb(var(--text) / <alpha-value>)',        //  8.10:1 — secondary text
          500: 'rgb(var(--text-soft) / <alpha-value>)',   //  5.76:1 on canvas, 4.62 on the
          //  worst neutral surface (--sunken). Raised from 4.89 on 2026-08-25: the old value
          //  passed against the canvas and failed on every chip and card.
          400: 'rgb(var(--text-faint) / <alpha-value>)',  //  3.87:1 — non-text only
        },
        mocha: 'rgb(var(--mocha) / <alpha-value>)',

        // Theme-aware neutrals. These are the migration target for the ~200
        // hardcoded `bg-white` / `text-gray-*` utilities still scattered through
        // components — each phase converts the screens it touches.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          mid: 'rgb(var(--surface-mid) / <alpha-value>)',
          deep: 'rgb(var(--surface-deep) / <alpha-value>)',
          sunken: 'rgb(var(--sunken) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text-strong) / <alpha-value>)',
          soft: 'rgb(var(--text) / <alpha-value>)',
          muted: 'rgb(var(--text-soft) / <alpha-value>)',
        },
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
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
      // Stacking ladder. These seven are the only values that should be used.
      // The numeric z-0…z-50 utilities still exist but are being migrated off;
      // today the codebase holds 11 competing values including a bare 9999.
      //   base 0 · raised 10 · sticky 100 · chrome 200
      //   · dropdown 1000 · modal 1100 · toast 1200
      //
      // `chrome` exists because `sticky` was doing two different jobs. The app
      // header and the sidebar are chrome — they frame the page. An in-page
      // sticky column header (RequestTable, ActiveRide, AssignmentPreview) is
      // page content that happens to pin. Both sat on `sticky`, and a header
      // that is `position: sticky` with a z-index CREATES A STACKING CONTEXT —
      // so `z-dropdown` on the role menu inside it was capped at 100, not 1000,
      // and every in-page sticky later in the DOM painted straight over it.
      //
      // Anything opened FROM chrome must therefore outrank page content, which
      // is what this rung buys. modal and toast stay above chrome on purpose:
      // a modal covers the header, it does not slide under it.
      //
      // tests/quality/z-index.test.ts asserts the ordering and that the header
      // and sidebar stay on this rung.
      zIndex: {
        base: '0',
        raised: '10',
        sticky: '100',
        chrome: '200',
        dropdown: '1000',
        modal: '1100',
        toast: '1200',
      },
      // Elevation scale. Geometry and alphas lifted verbatim from the
      // claymorphism classes so one card treatment can be reused without
      // re-typing a 3-layer shadow. Only the COLOUR is themed — on dark,
      // --shadow-glow stops being white, which is what keeps these inset
      // highlights from becoming a glare. Use a border OR a shadow to separate
      // a surface, never both.
      boxShadow: {
        'clay-raised': '8px 8px 24px 0 rgb(var(--shadow-cast) / 0.15), inset 8px 8px 16px 0 rgb(var(--shadow-glow) / 0.8), inset -4px -4px 12px 0 rgb(var(--shadow-cast) / 0.08)',
        'clay-hover': '12px 12px 32px 0 rgb(var(--shadow-cast) / 0.18), inset 8px 8px 16px 0 rgb(var(--shadow-glow) / 0.9), inset -4px -4px 12px 0 rgb(var(--shadow-cast) / 0.1)',
        'clay-inset': 'inset 4px 4px 8px 0 rgb(var(--shadow-cast) / 0.08), inset -2px -2px 6px 0 rgb(var(--shadow-glow) / 0.9)',
        'clay-overlay': '20px 20px 48px 0 rgb(var(--shadow-cast) / 0.2), inset 8px 8px 16px 0 rgb(var(--shadow-glow) / 0.8), inset -4px -4px 12px 0 rgb(var(--shadow-cast) / 0.05)',
      },
    },
  },
  plugins: [],
};
