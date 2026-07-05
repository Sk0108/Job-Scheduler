import { motion } from "framer-motion";
import { AnimatedNumber } from "./AnimatedNumber";

export function StatTile({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return (
    <motion.div
      className="stat-tile"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      style={accent ? { borderColor: accent } : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{typeof value === "number" ? <AnimatedNumber value={value} /> : value}</div>
      {hint && (
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          {hint}
        </div>
      )}
    </motion.div>
  );
}
