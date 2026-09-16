export const colors = {
  background: '#0B0B0D',
  surface: '#17171B',
  surfaceRaised: '#232329',
  border: '#2E2E36',
  text: '#F4F4F5',
  textMuted: '#9A9AA5',
  accent: '#E8D5B7',
  accentText: '#1A1A1E',
  success: '#5FBF8B',
  warning: '#E0A458',
  danger: '#D96B63',
  overlay: 'rgba(11,11,13,0.72)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textMuted },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.textMuted },
} as const;
