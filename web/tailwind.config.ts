import type { Config } from 'tailwindcss';

/**
 * StudyMind design system — Cream & Mint.
 *
 * Warm cream surfaces with a fresh emerald/mint accent. The palette is anchored
 * on three neutrals (cream / paper / ink) and one mint accent that scales from
 * a barely-there 50 to a deep evergreen 900. Mastery colours stay
 * (red/amber/green) because they're semantic, not decorative.
 *
 * Tokens are also exposed as RGB triplets in globals.css so light and dark
 * themes stay in sync without touching every component.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Mint accent — emerald-leaning, with enough chroma to pop on cream.
        brand: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
        // Cream neutrals — used by the CSS variables in globals.css too.
        cream: {
          50: '#FFFCF3',
          100: '#FBF6E9',
          200: '#F5EED8',
          300: '#EDE2C2',
          400: '#E8DFC5',
          500: '#D9CBA1',
        },
        // Mastery states — unchanged because the user maps them to meaning.
        mastery: {
          weak: '#ef4444',
          developing: '#f59e0b',
          strong: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-display)', 'Georgia', 'ui-serif', 'serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        // Subtle cream-tinted shadow on light surfaces; lifts cards off the
        // cream background without darkening them.
        card: '0 1px 2px 0 rgba(120, 90, 30, 0.05), 0 4px 12px -4px rgba(120, 90, 30, 0.08)',
        lift: '0 14px 36px -16px rgba(6, 95, 70, 0.22)',
        // A faint mint halo for focus / hover.
        glow: '0 0 0 4px rgba(16, 185, 129, 0.18)',
      },
      backgroundImage: {
        // Cream-to-paper diagonal for hero panels.
        'cream-diagonal':
          'linear-gradient(135deg, #FBF6E9 0%, #F5EED8 55%, #E8DFC5 100%)',
        'mint-glow':
          'radial-gradient(ellipse at top, rgba(167, 243, 208, 0.45) 0%, rgba(251, 246, 233, 0) 60%)',
        'mint-fade':
          'linear-gradient(180deg, rgba(236, 253, 245, 0.0) 0%, rgba(236, 253, 245, 0.6) 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'breathe': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.6' },
          '50%': { transform: 'scale(1.04)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'breathe': 'breathe 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
