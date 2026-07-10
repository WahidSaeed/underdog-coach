"use client";

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 84, height: 84, borderRadius: "50%",
          border: "3px solid #fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "riseIn 0.5s ease-out",
        }}
      >
        <span className="display ital" style={{ fontSize: 34, fontWeight: 800, color: "#fff" }}>UC</span>
      </div>

      <span
        className="display ital"
        style={{
          fontSize: 34, fontWeight: 800, letterSpacing: "0.03em", color: "#fff",
          animation: "riseIn 0.6s ease-out",
        }}
      >
        UNDERDOG <span style={{ color: "var(--lime)" }}>COACH</span>
      </span>

      <button
        onClick={onLogin}
        className="display ital"
        style={{
          marginTop: 14,
          fontSize: 15, fontWeight: 800, letterSpacing: "0.06em",
          padding: "13px 34px",
          background: "var(--lime)", color: "var(--lime-dark)",
          border: "none", cursor: "pointer",
          clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
          animation: "riseIn 0.7s ease-out",
        }}
      >
        CLICK TO LOGIN
      </button>
    </div>
  );
}
