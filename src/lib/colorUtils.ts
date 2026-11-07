const DARK_TEXT_LUMINANCE_THRESHOLD = 0.44;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * `#rgb`, `#rrggbb` or `#rrggbbaa` (the custom picker saves the last) as lowercase `#rrggbb`, else null.
 * ponytail: alpha is dropped, so a translucent hex reads as its opaque colour for ink and contrast, as a shape's opacity does — upgrade: composite it over the backdrop.
 */
export function normalizeHex(hex: string): string | null {
  const normalized = hex.trim().replace('#', '');
  if (/^[\da-fA-F]{3}$/.test(normalized)) {
    return `#${normalized
      .split('')
      .map((char) => char + char)
      .join('')}`.toLowerCase();
  }
  if (/^[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(normalized)) {
    return `#${normalized.slice(0, 6)}`.toLowerCase();
  }
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function mixHex(colorA: string, colorB: string, ratio: number): string {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  if (!a || !b) return colorA;
  return rgbToHex(
    a.r * (1 - ratio) + b.r * ratio,
    a.g * (1 - ratio) + b.g * ratio,
    a.b * (1 - ratio) + b.b * ratio
  );
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours, 1 (none) to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [getLuminance(a), getLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The label ink, slate-900 or white, with the higher contrast on `fill` (white wins only where it reads better). */
export function readableTextOn(fill: string): '#0f172a' | '#ffffff' {
  return contrastRatio(fill, '#0f172a') >= contrastRatio(fill, '#ffffff') ? '#0f172a' : '#ffffff';
}

export function getContrastText(hex: string): '#0f172a' | '#ffffff' {
  return getLuminance(hex) > DARK_TEXT_LUMINANCE_THRESHOLD ? '#0f172a' : '#ffffff';
}
