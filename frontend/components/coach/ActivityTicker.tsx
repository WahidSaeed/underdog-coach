"use client";

import { shortToolLabel } from "./derive";

type Props = { toolCalls: string[]; busy: boolean };

// Compact row of "✓ SCOUT" style chips replacing the old inline META feed
// lines. Never fabricates progress steps before a response lands - while
// busy it shows one generic pulsing chip, nothing more.
export default function ActivityTicker({ toolCalls, busy }: Props) {
  if (busy) {
    return (
      <span
        className="display ital"
        style={{
          alignSelf: "flex-start",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--cyan)",
          border: "1px solid rgba(69,224,224,0.4)",
          padding: "2px 8px",
          animation: "breathe 1.1s ease-in-out infinite",
        }}
      >
        ● READING…
      </span>
    );
  }

  if (toolCalls.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {toolCalls.map((name, i) => {
        const { label, accent } = shortToolLabel(name);
        return (
          <span
            key={`${name}-${i}`}
            className="display ital"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.03em",
              color: accent ? "var(--cyan)" : "rgba(255,255,255,0.75)",
              border: `1px solid ${accent ? "rgba(69,224,224,0.5)" : "var(--line)"}`,
              padding: "2px 7px",
              whiteSpace: "nowrap",
            }}
          >
            {label} ✓
          </span>
        );
      })}
    </div>
  );
}
