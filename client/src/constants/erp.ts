import { Platform } from 'react-native';

// Old-school ERP look: flat, square, 1px borders, no shadows/gradients/animation.
export const ERP = {
  navy: '#14284B',
  navyText: '#FFFFFF',
  pageBg: '#E6E6E6',
  panelBg: '#F4F4F4',
  white: '#FFFFFF',
  border: '#9A9A9A',
  borderLight: '#C8C8C8',
  text: '#111111',
  textMuted: '#555555',
  activeBg: '#CFDCEE',
  danger: '#A00000',
  fontSize: 13,
  topBarHeight: 36,
  sidebarWidth: 176,
  mobileBreakpoint: 768,
  font: Platform.select({
    web: 'Arial, Helvetica, "Segoe UI", sans-serif',
    ios: 'Helvetica',
    default: 'sans-serif',
  }) as string,
} as const;
