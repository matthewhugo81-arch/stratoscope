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

export const temperatureGradient = `linear-gradient(to right, ${temperatureStops
  .map(stop => `rgb(${stop.rgb.join(',')}) ${temperaturePosition(stop.value)}%`)
  .join(', ')})`;

export function temperatureColor(value: number): number[] {
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

const glslRgb = (rgb: readonly number[]) => `vec3(${rgb.map(v => v.toFixed(1)).join(',')})`;
// Generate shader segments from the same anchors, avoiding separate GPU/CPU scales.
export const temperaturePaletteGlsl = `vec3 temperaturePalette(float value) {
  if (value <= ${first.value.toFixed(1)}) return ${glslRgb(first.rgb)} / 255.;
  ${temperatureStops.slice(1).map((upper, i) => {
    const lower = temperatureStops[i];
    return `if (value <= ${upper.value.toFixed(1)}) return mix(${glslRgb(lower.rgb)}, ${glslRgb(upper.rgb)}, (value - (${lower.value.toFixed(1)})) / ${(upper.value - lower.value).toFixed(1)}) / 255.;`;
  }).join('\n  ')}
  return ${glslRgb(last.rgb)} / 255.;
}`;
