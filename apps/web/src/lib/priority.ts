/**
 * Priority (0-100) is bucketed into the same fixed, never-themed severity ramp
 * used for status indication elsewhere (good -> warning -> serious -> critical)
 * since priority is an urgency/severity signal, not a categorical identity.
 * Colors never carry meaning alone — every usage pairs the color with the label.
 */
export type PriorityBand = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface PriorityBandInfo {
  band: PriorityBand;
  label: string;
  color: string;
  bg: string;
}

const BANDS: Record<PriorityBand, { label: string; color: string }> = {
  LOW: { label: "Low", color: "#0ca30c" },
  NORMAL: { label: "Normal", color: "#fab219" },
  HIGH: { label: "High", color: "#ec835a" },
  CRITICAL: { label: "Critical", color: "#d03b3b" },
};

export function getPriorityBand(priority: number): PriorityBand {
  if (priority < 25) return "LOW";
  if (priority < 50) return "NORMAL";
  if (priority < 75) return "HIGH";
  return "CRITICAL";
}

export function getPriorityInfo(priority: number): PriorityBandInfo {
  const band = getPriorityBand(priority);
  const { label, color } = BANDS[band];
  return { band, label, color, bg: `color-mix(in srgb, ${color} 18%, transparent)` };
}

export const PRIORITY_BAND_ORDER: PriorityBand[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

export function priorityBandLabel(band: PriorityBand): string {
  return BANDS[band].label;
}

export function priorityBandColor(band: PriorityBand): string {
  return BANDS[band].color;
}
