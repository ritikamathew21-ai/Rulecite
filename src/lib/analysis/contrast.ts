const channel = (value: number) => {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

// WCAG 2 contrast ratio between two #RRGGBB colours.
export function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
