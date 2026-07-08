"use client";

import React from "react";

export type CoachEmotion =
  | "neutral"
  | "explaining"
  | "happy"
  | "worried"
  | "angry"
  | "celebrating";

const EMOTION_LABEL: Record<CoachEmotion, string> = {
  neutral: "Watching the shape",
  explaining: "Making a point",
  happy: "Likes what he sees",
  worried: "Seeing a problem",
  angry: "That channel is wide open!",
  celebrating: "Great setup!",
};

type Face = {
  browL: string;
  browR: string;
  eyeL: React.ReactNode;
  eyeR: React.ReactNode;
  mouth: string;
  cheeks?: boolean;
  sweat?: boolean;
};

function faceFor(emotion: CoachEmotion): Face {
  const dotEye = (cx: number) => <circle cx={cx} cy={57} r={2.6} fill="#1c1c28" />;
  const wideEye = (cx: number) => (
    <>
      <circle cx={cx} cy={57} r={4.4} fill="#fff" />
      <circle cx={cx} cy={57} r={2.4} fill="#1c1c28" />
    </>
  );
  const happyEye = (cx: number) => (
    <path d={`M ${cx - 4} 58 Q ${cx} 53 ${cx + 4} 58`} stroke="#1c1c28" strokeWidth={2.2} fill="none" strokeLinecap="round" />
  );

  switch (emotion) {
    case "happy":
      return { browL: "M 44 48 Q 49 45 54 47", browR: "M 66 47 Q 71 45 76 48", eyeL: happyEye(50), eyeR: happyEye(70), mouth: "M 50 70 Q 60 79 70 70", cheeks: true };
    case "celebrating":
      return { browL: "M 44 46 Q 49 42 54 45", browR: "M 66 45 Q 71 42 76 46", eyeL: happyEye(50), eyeR: happyEye(70), mouth: "M 48 68 Q 60 82 72 68", cheeks: true };
    case "worried":
      return { browL: "M 44 46 Q 50 49 55 51", browR: "M 65 51 Q 70 49 76 46", eyeL: wideEye(50), eyeR: wideEye(70), mouth: "M 52 74 Q 60 70 68 74", sweat: true };
    case "angry":
      return { browL: "M 44 50 Q 50 46 55 52", browR: "M 65 52 Q 70 46 76 50", eyeL: dotEye(50), eyeR: dotEye(70), mouth: "M 51 76 Q 60 71 69 76" };
    case "explaining":
      return { browL: "M 44 47 Q 49 44 54 46", browR: "M 66 48 Q 71 46 76 49", eyeL: dotEye(50), eyeR: dotEye(70), mouth: "M 52 71 Q 60 75 68 71" };
    default:
      return { browL: "M 44 48 Q 49 46 54 47", browR: "M 66 47 Q 71 46 76 48", eyeL: dotEye(50), eyeR: dotEye(70), mouth: "M 53 72 Q 60 74 67 72" };
  }
}

export default function CoachAvatar({ emotion }: { emotion: CoachEmotion }) {
  const face = faceFor(emotion);

  const bodyAnim =
    emotion === "celebrating"
      ? "jump 0.9s ease-in-out infinite"
      : emotion === "angry"
      ? "headShake 0.7s ease-in-out infinite"
      : "breathe 3.2s ease-in-out infinite";

  const rightArmAnim =
    emotion === "explaining" || emotion === "celebrating" || emotion === "angry"
      ? "armWave 1.1s ease-in-out infinite"
      : undefined;

  const auraColor =
    emotion === "angry" || emotion === "worried"
      ? "rgba(232,52,124,0.5)"
      : "rgba(216,239,61,0.45)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "50%",
          background: "radial-gradient(circle at 50% 35%, #2a2340, #171225)",
          border: `2.5px solid ${emotion === "angry" || emotion === "worried" ? "var(--magenta)" : "var(--lime)"}`,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          overflow: "hidden",
          boxShadow: `0 0 26px ${auraColor}`,
          transition: "border-color 0.4s, box-shadow 0.4s",
        }}
      >
        <svg width="118" height="120" viewBox="0 0 120 122" style={{ animation: bodyAnim, transformOrigin: "60px 100px" }} role="img" aria-label={`Coach avatar, ${emotion}`}>
          {/* torso: tracksuit */}
          <path d="M 32 122 L 34 96 Q 36 84 48 82 L 72 82 Q 84 84 86 96 L 88 122 Z" fill="#20263f" stroke="#2e3557" strokeWidth="2" />
          <path d="M 57 82 L 60 122 L 63 82 Z" fill="#12162a" />
          <path d="M 48 82 L 60 94 L 72 82 L 68 80 L 60 87 L 52 80 Z" fill="var(--lime)" opacity="0.9" />
          {/* left arm (viewer left) */}
          <path d="M 36 90 Q 26 100 28 112" stroke="#20263f" strokeWidth="9" fill="none" strokeLinecap="round" />
          {/* right arm - waves when explaining/celebrating/angry */}
          <g style={rightArmAnim ? { animation: rightArmAnim, transformOrigin: "82px 90px" } : undefined}>
            <path d="M 84 90 Q 96 96 98 84" stroke="#20263f" strokeWidth="9" fill="none" strokeLinecap="round" />
            <circle cx="99" cy="82" r="5" fill="#e8b48c" />
          </g>
          {/* neck + head */}
          <rect x="54" y="72" width="12" height="10" fill="#e8b48c" />
          <circle cx="60" cy="58" r="22" fill="#f0c098" />
          {/* hair + headset */}
          <path d="M 38 54 Q 40 34 60 34 Q 80 34 82 54 Q 74 42 60 42 Q 46 42 38 54 Z" fill="#3a3f5c" />
          <path d="M 38 56 Q 36 50 39 46" stroke="#12162a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="38" cy="58" r="3.4" fill="#12162a" />
          <path d="M 38 61 Q 42 70 50 72" stroke="#12162a" strokeWidth="2" fill="none" />
          {/* face */}
          <path d={face.browL} stroke="#2b2b3a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d={face.browR} stroke="#2b2b3a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          {face.eyeL}
          {face.eyeR}
          <path d={face.mouth} stroke="#1c1c28" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          {face.cheeks && (
            <>
              <circle cx="44" cy="66" r="3.4" fill="#f2937c" opacity="0.55" />
              <circle cx="76" cy="66" r="3.4" fill="#f2937c" opacity="0.55" />
            </>
          )}
          {face.sweat && (
            <path d="M 82 46 Q 84 50 82 53 Q 80 50 82 46 Z" fill="var(--cyan)" style={{ animation: "sweatDrop 1.4s ease-in infinite" }} />
          )}
        </svg>
      </div>
      <div
        className="display"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: emotion === "angry" || emotion === "worried" ? "var(--magenta)" : "var(--lime)",
          transition: "color 0.4s",
          textAlign: "center",
          minHeight: 18,
        }}
      >
        {EMOTION_LABEL[emotion]}
      </div>
    </div>
  );
}
