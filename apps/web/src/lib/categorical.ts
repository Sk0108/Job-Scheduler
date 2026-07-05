/**
 * Fixed categorical hue order (never cycled/reassigned by rank) for multi-series
 * charts where color identifies an entity — e.g. one color per queue. Assign by
 * a stable key (queue id), not by array index that can shift when filters change.
 */
const CATEGORICAL_HUES = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
];

const assigned = new Map<string, string>();

export function getCategoricalColor(key: string): string {
  if (assigned.has(key)) return assigned.get(key)!;
  const color = CATEGORICAL_HUES[assigned.size % CATEGORICAL_HUES.length];
  assigned.set(key, color);
  return color;
}
