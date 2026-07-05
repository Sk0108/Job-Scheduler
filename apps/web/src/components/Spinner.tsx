import type { ReactNode } from "react";

export function Spinner() {
  return <div className="spinner" />;
}

export function LoadingBlock() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
      <Spinner />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
