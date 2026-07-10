"use client";

import { useEffect, useState } from "react";
import { FeedMsg, VERDICT_COLOR } from "./theme";

export type MatchDossier = {
  scenario: string;
  coaching_goal: string;
  focus_note: string;
  degraded: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  dossier: MatchDossier | null;
  feed: FeedMsg[];
};

// Layer 2 of the glance redesign: the full agent transcript, one click
// away. COACH bubbles with a `.detailed` field (agent_instruction.md item
// 6) get a toggle to reveal the technical breakdown on demand.
export default function MatchReportDrawer({ open, onClose, dossier, feed }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(6,5,12,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
          zIndex: 40,
        }}
      />
      <div
        role="dialog"
        aria-label="Match report"
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          maxWidth: "92vw",
          background: "linear-gradient(175deg, #1c1730 0%, #17121f 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.14)",
          transform: `translateX(${open ? "0" : "100%"})`,
          transition: "transform 0.3s ease-out",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span className="display ital" style={{ fontSize: 20, fontWeight: 800, color: "var(--lime)" }}>
            MATCH REPORT
          </span>
          <button
            onClick={onClose}
            aria-label="Close match report"
            style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {dossier && (
            <div
              style={{
                background: "rgba(10,9,20,0.82)",
                border: `1px solid ${dossier.degraded ? "rgba(232,52,124,0.55)" : "rgba(216,239,61,0.45)"}`,
                padding: "9px 11px",
              }}
            >
              <div
                className="display ital"
                style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  color: dossier.degraded ? "#ff7a88" : "var(--lime)",
                  marginBottom: 4,
                }}
              >
                {dossier.degraded ? "⚠ SCRIPTED DRILL" : "MATCHDAY SITUATION"}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{dossier.scenario}</div>
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>Goal: {dossier.coaching_goal}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontStyle: "italic", marginTop: 4 }}>
                {dossier.focus_note}
              </div>
            </div>
          )}

          {feed.map((m) =>
            m.who === "META" ? (
              <div key={m.id} style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", padding: "0 2px", fontStyle: "italic" }}>
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                style={{
                  background: "rgba(10,9,20,0.82)",
                  border: `1px solid ${m.who === "OPPONENT" ? "rgba(224,55,74,0.55)" : "rgba(255,255,255,0.12)"}`,
                  padding: "8px 11px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  animation: "slideRight 0.35s ease-out",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span
                    className="display ital"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: m.who === "OPPONENT" ? "#ff7a88" : "var(--cyan)",
                    }}
                  >
                    {m.who === "OPPONENT" ? "OPPONENT MANAGER" : "COACH"}
                  </span>
                  {m.verdict && (
                    <span
                      className="display ital"
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        padding: "1px 6px",
                        border: `1px solid ${VERDICT_COLOR[m.verdict]}`,
                        color: VERDICT_COLOR[m.verdict],
                      }}
                    >
                      {m.verdict}
                    </span>
                  )}
                </span>
                {m.text}
                {m.detailed && (
                  <>
                    <button
                      onClick={() => toggle(m.id)}
                      className="display ital"
                      style={{
                        display: "block",
                        marginTop: 6,
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontSize: 10.5,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        color: "var(--cyan)",
                        cursor: "pointer",
                      }}
                    >
                      {expanded.has(m.id) ? "HIDE TECHNICAL BREAKDOWN ▴" : "SHOW TECHNICAL BREAKDOWN ▾"}
                    </button>
                    {expanded.has(m.id) && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--line)", fontSize: 12, color: "rgba(255,255,255,0.82)" }}>
                        {m.detailed}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
