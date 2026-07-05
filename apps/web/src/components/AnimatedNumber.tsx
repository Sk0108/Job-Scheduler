import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, motion } from "framer-motion";

/** Animates a numeric stat tile value counting up/down to its new value whenever it changes. */
export function AnimatedNumber({ value }: { value: number }) {
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (v) => Math.round(v).toLocaleString());
  const prevValue = useRef(value);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: prevValue.current === value ? 0 : 0.6,
      ease: [0.16, 1, 0.3, 1],
    });
    prevValue.current = value;
    return controls.stop;
  }, [value, motionValue]);

  return <motion.span>{rounded}</motion.span>;
}
