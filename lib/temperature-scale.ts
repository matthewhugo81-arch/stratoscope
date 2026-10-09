// Celsius anchors shared by the globe renderers and the legend.
export const temperatureStops = [
  {value: -90, rgb: [43, 24, 79]},
  {value: -75, rgb: [58, 52, 144]},
  {value: -60, rgb: [57, 99, 197]},
  {value: -45, rgb: [61, 165, 192]},
  {value: -30, rgb: [141, 205, 196]},
  {value: -25, rgb: [234, 205, 127]},
  {value: -20, rgb: [237, 155, 80]},
  {value: -15, rgb: [236, 112, 76]},
  {value: 0, rgb: [205, 59, 52]},
  {value: 10, rgb: [167, 31, 50]},
  {value: 20, rgb: [110, 16, 38]},
] as const;

export const temperatureTicks = [-90, -60, -30, -15, 0, 20];
const first = temperatureStops[0];
const last = temperatureStops[temperatureStops.length - 1];
export const temperaturePosition = (value: number) =>
  (value - first.value) / (last.value - first.value) * 100;

export const temperatureBandWidth = 5;

function smoothTemperatureColor(value: number): number[] {
  if (value <= first.value) return [...first.rgb];
  for (let i = 1; i < temperatureStops.length; i++) {
    const upper = temperatureStops[i], lower = temperatureStops[i - 1];
    if (value <= upper.value) {
      const fraction = (value - lower.value) / (upper.value - lower.value);
      return lower.rgb.map((channel, c) => channel + (upper.rgb[c] - channel) * fraction);
    }
  }
  return [...last.rgb];
}

// Quantise colours after spatial interpolation, preserving smooth geographic boundaries.
export const temperatureBands = Array.from({length: (last.value - first.value) / temperatureBandWidth}, (_, i) => {
  const lower = first.value + i * temperatureBandWidth;
  return {lower, upper: lower + temperatureBandWidth, rgb: smoothTemperatureColor(lower + temperatureBandWidth / 2)};
});
export function temperatureColor(value: number): number[] {
  const index = Math.max(0, Math.min(temperatureBands.length - 1, Math.floor((value - first.value) / temperatureBandWidth)));
  return [...temperatureBands[index].rgb];
}
export const temperatureGradient = `linear-gradient(to right, ${temperatureBands.map(b =>
  `rgb(${b.rgb.join(',')}) ${temperaturePosition(b.lower)}% ${temperaturePosition(b.upper)}%`).join(', ')})`;
const glslRgb = (rgb: readonly number[]) => `vec3(${rgb.map(v => v.toFixed(6)).join(',')})`;
// Both renderers and the legend use the exact same 5°C bands.
export const temperaturePaletteGlsl = `vec3 temperaturePalette(float value) {
  ${temperatureBands.map(b => `if (value < ${b.upper.toFixed(1)}) return ${glslRgb(b.rgb)} / 255.;`).join('\n  ')}
  return ${glslRgb(temperatureBands[temperatureBands.length - 1].rgb)} / 255.;
}`;
