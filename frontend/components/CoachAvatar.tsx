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

const EMOTION_IMAGE: Record<CoachEmotion, string> = {
  neutral: "/img/Neutral.jpg",
  explaining: "/img/Explaining.jpg",
  happy: "/img/Happy.jpg",
  worried: "/img/Worried.jpg",
  angry: "/img/Angry.jpg",
  celebrating: "/img/Celebrating.jpg",
};

export default function CoachAvatar({ emotion }: { emotion: CoachEmotion }) {
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
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          boxShadow: `0 0 26px ${auraColor}`,
          transition: "border-color 0.4s, box-shadow 0.4s",
        }}
      >
        <img
          src={EMOTION_IMAGE[emotion]}
          alt={`Coach avatar displaying ${emotion} emotion`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
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