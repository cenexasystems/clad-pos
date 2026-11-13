/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // The theme colour chosen in Settings > Appearance. Values come from CSS variables, so
        // opacity variants such as bg-accent/30 keep working.
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          dark:    'rgb(var(--accent-dark-rgb) / <alpha-value>)',
          light:   'rgb(var(--accent-light-rgb) / <alpha-value>)',
          soft:    'rgb(var(--accent-soft-rgb) / <alpha-value>)',
          hover:   'rgb(var(--accent-hover-rgb) / <alpha-value>)',
        },
        bgMain:    '#FBFAF6', // Warm luxury linen surface
        cardBg:    '#FFFFFF',
        brand: {
          black:      '#0A0A0A',
          dark:       '#141414',
          gold:       '#D4AF37',
          goldHover:  '#C5A059',
          goldLight:  '#FBF6E9',
          goldBorder: '#E8D399',
        },
        gold: {
          DEFAULT: '#D4AF37',
          dark:    '#B48811',
          light:   '#FBF6E9',
          border:  '#E8D399',
        },
        maroon: {
          DEFAULT: '#D4AF37', // Remapped to luxury Gold
          dark:    '#0A0A0A', // Remapped to luxury Black
          light:   '#FBF6E9',
        },
        textMain:  '#111111',
        textMuted: '#6B7280',
        borderLight: '#E5E7EB', // Neutral clean border
      },
      fontFamily: {
        sans:      ['"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'system-ui', '-apple-system', 'sans-serif'],
        dmsans:    ['"DM Sans"', 'sans-serif'],
        'dm-sans': ['"DM Sans"', 'sans-serif'],
        outfit:    ['"Outfit"', 'sans-serif'],
        brand:     ['"Cinzel"', '"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'serif'],
        headline:  ['"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'sans-serif'],
      },
      boxShadow: {
        soft:   '0 1px 3px rgba(0,0,0,0.05)',
        gold:   '0 4px 20px -2px rgba(212, 175, 55, 0.25)',
      },
      borderRadius: {
        'card': '12px',
        'btn': '10px',
        'input': '10px',
        'table': '12px',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
        'floatDelay': 'float 4s ease-in-out 1.5s infinite',
        'slideUp': 'slideUp 0.6s ease forwards',
        'fadeIn': 'fadeIn 0.5s ease forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
