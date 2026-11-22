import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#090A0F',
        surface: '#11131C',
        surfaceElevated: '#171A26',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        accentGlow: 'rgb(var(--accent-glow-rgb) / <alpha-value>)'
      },
      fontFamily: {
        sans: [
          'Inter',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: '0 0 28px -6px rgb(var(--accent-rgb) / 0.45)',
        'glow-soft': '0 0 40px -12px rgb(var(--accent-glow-rgb) / 0.35)'
      }
    }
  },
  plugins: []
}

export default config
