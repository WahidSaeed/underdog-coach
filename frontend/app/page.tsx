"use client";

import { useCallback, useMemo, useState } from "react";
import Pitch from "@/components/Pitch";
import PlayerCard from "@/components/PlayerCard";
import CoachAvatar, { CoachEmotion } from "@/components/CoachAvatar";
import { boardGeometry, buildFormation, evaluateBoard, FormationCode, Pawn, stageDrillBoard } from "@/lib/engine";
import { Player, TeamId, TEAMS, overallRating } from "@/lib/data";
import {
  askCoachFeedback,
  askDrill,
  askOpponent,
  CoachVerdict,
  DrillApiResponse,
  getSessionId,
  hasMatchup,
  Posture,
} from "@/lib/api";

type FeedMsg = { who: "OPPONENT" | "COACH" | "META"; text: string; id: number; verdict?: CoachVerdict | null };

const VERDICT_COLOR: Record<CoachVerdict, string> = {
  SOLVED: "var(--lime)",
  PARTIAL: "#f0b83c",
  EXPOSED: "#ff7a88",
};

// Small grey "tool call" lines in the feed - makes the agent's tool use
// (scout_matchup, get_player_traits, ...) visible, not just its prose.
function toolCallMsgs(toolCalls: string[], seed: number): FeedMsg[] {
  return toolCalls.map((name, i) => ({
    who: "META",
    text: `🔍 scouted via ${name}(...)`,
    id: seed + i,
  }));
}

const FORMATIONS: FormationCode[] = ["442", "433", "352", "532"];

const POSTURE_LABEL: Record<Posture, string> = {
  chasing: "CHASING",
  protecting_lead: "PROTECTING LEAD",
  pinned_back: "PINNED BACK",
  balanced: "BALANCED",
};

export default function Home() {
  const [formation, setFormation] = useState<FormationCode>("442");
  const [bluePawns, setBluePawns] = useState<Pawn[]>(() => buildFormation("442", "blue"));
  const [redPawns, setRedPawns] = useState<Pawn[]>(() => buildFormation("442", "red"));
  const [feed, setFeed] = useState<FeedMsg[]>([
    { who: "COACH", text: "Drag your players into shape, then ask me for a read. Select anyone to open their card.", id: 0 },
  ]);
  const [emotion, setEmotion] = useState<CoachEmotion>("neutral");
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ player: Player; team: TeamId } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [drill, setDrill] = useState<DrillApiResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const busy = thinking || drillLoading;

  const squadRating = useMemo(
    () => Math.round(TEAMS.blue.players.reduce((s, p) => s + overallRating(p.stats), 0) / TEAMS.blue.players.length),
    []
  );

  const movePawn = useCallback((team: TeamId, index: number, x: number, y: number) => {
    const setter = team === "blue" ? setBluePawns : setRedPawns;
    setter((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], x, y };
      return next;
    });
  }, []);

  const pickFormation = (code: FormationCode) => {
    setFormation(code);
    setBluePawns(buildFormation(code, "blue"));
    setHighlightIds([]);
  };

  const reset = () => {
    setFormation("442");
    setBluePawns(buildFormation("442", "blue"));
    setRedPawns(buildFormation("442", "red"));
    setHighlightIds([]);
    setEmotion("neutral");
    setDrill(null);
    setFeed([{ who: "COACH", text: "Board reset. Set your shape and ask again.", id: Date.now() }]);
  };

  const newDrill = async () => {
    if (busy) return;
    setDrillLoading(true);
    setEmotion("explaining");

    try {
      const sessionId = getSessionId();
      const res = await askDrill({
        session_id: sessionId,
        user_team: "blue",
        opponent_team: "red",
        difficulty: "medium",
      });
      setDrill(res);
      const focus = hasMatchup(res.focus_matchup) ? res.focus_matchup : null;
      setHighlightIds(focus ? [focus.attacker_id, focus.defender_id] : []);
      const oppFormation: FormationCode = (FORMATIONS as string[]).includes(res.opponent_formation_code)
        ? (res.opponent_formation_code as FormationCode)
        : "433";
      const { blue, red } = stageDrillBoard(
        { opponent_formation_code: oppFormation, user_posture: res.user_posture },
        focus,
        formation
      );
      setBluePawns(blue);
      setRedPawns(red);
      setEmotion("explaining");
      const prefix = res.degraded ? "⚠ SCRIPTED DRILL — " : "📋 New drill: ";
      setFeed((prev) => [
        ...prev,
        ...toolCallMsgs(res.tool_calls, Date.now()),
        { who: "COACH", text: `${prefix}${res.scenario} Your goal: ${res.coaching_goal}`, id: Date.now() + 10 },
      ]);
    } catch (err) {
      console.error("Drill API failed:", err);
      setFeed((prev) => [
        ...prev,
        { who: "COACH", text: "⚠ Drill service unreachable — free play mode", id: Date.now() },
      ]);
    } finally {
      setDrillLoading(false);
    }
  };

  const runOfflineFallback = (reason: unknown) => {
    console.error("Coach API failed, falling back to offline read:", reason);
    const verdict = evaluateBoard(bluePawns);
    setRedPawns(buildFormation(verdict.opponentFormation, "red"));
    setFeed((prev) => [
      ...prev,
      ...verdict.messages.map((m, i) => ({
        who: m.who,
        text: i === 0 ? `⚠ OFFLINE READ — ${m.text}` : m.text,
        id: Date.now() + i,
      })),
    ]);
    setHighlightIds(verdict.matchup ? [verdict.matchup.attacker.id, verdict.matchup.defender.id] : []);
    setEmotion(verdict.emotion);
  };

  const askCoach = async () => {
    if (busy) return;
    setThinking(true);
    setEmotion("explaining");

    try {
      const sessionId = getSessionId();
      const { widthSpread, avgDefLine } = boardGeometry(bluePawns);
      const drillContext = drill
        ? { scenario: drill.scenario, coaching_goal: drill.coaching_goal, focus_matchup: drill.focus_matchup }
        : null;
      const board = {
        blue: bluePawns.map((p) => ({ id: p.player.id, x: p.x, y: p.y })),
        red: redPawns.map((p) => ({ id: p.player.id, x: p.x, y: p.y })),
      };

      const opp = await askOpponent({
        session_id: sessionId,
        user_team: "blue",
        opponent_team: "red",
        formation_code: formation,
        width_spread: widthSpread,
        avg_def_line: avgDefLine,
        drill: drillContext,
        board,
      });

      const oppFormation: FormationCode = (FORMATIONS as string[]).includes(opp.opponent.formation_code)
        ? (opp.opponent.formation_code as FormationCode)
        : "433";
      setRedPawns(buildFormation(oppFormation, "red"));
      setEmotion(opp.emotion);
      setHighlightIds(hasMatchup(opp.target_matchup) ? [opp.target_matchup.attacker_id, opp.target_matchup.defender_id] : []);
      setFeed((prev) => [
        ...prev,
        ...toolCallMsgs(opp.tool_calls, Date.now()),
        { who: "OPPONENT", text: opp.opponent.narrative, id: Date.now() + 10 },
      ]);

      const coach = await askCoachFeedback({
        session_id: sessionId,
        user_team: "blue",
        opponent: opp.opponent,
        target_matchup: opp.target_matchup,
        drill: drillContext,
        metrics: opp.metrics,
      });
      setFeed((prev) => [
        ...prev,
        ...toolCallMsgs(coach.tool_calls, Date.now() + 20),
        { who: "COACH", text: coach.coach_feedback, id: Date.now() + 30, verdict: coach.verdict },
      ]);
      // The verdict is graded after the /opponent emotion already landed -
      // let it win the avatar on SOLVED rather than the earlier read.
      if (coach.verdict === "SOLVED") setEmotion("celebrating");

      if (opp.recurring_weakness) {
        const rw = opp.recurring_weakness;
        setFeed((prev) => [
          ...prev,
          {
            who: "COACH",
            text: `That's twice now — ${rw.defender} keeps getting exposed there. Worth a permanent fix.`,
            id: Date.now() + 2,
          },
        ]);
      }
    } catch (err) {
      runOfflineFallback(err);
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <div className="stage" aria-hidden="true">
        <div className="beam" style={{ left: "6%", transform: "rotate(14deg)" }} />
        <div className="beam" style={{ left: "26%", transform: "rotate(7deg)", opacity: 0.6 }} />
        <div className="beam" style={{ right: "10%", transform: "rotate(-13deg)" }} />
        <div className="beam" style={{ right: "30%", transform: "rotate(-6deg)", opacity: 0.55 }} />
        <div className="floor" />
      </div>

      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 26px 14px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* top bar: logo + breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, animation: "riseIn 0.35s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="display ital" style={{ fontSize: 15, fontWeight: 800 }}>UC</span>
            </div>
            <span className="display ital" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.03em" }}>
              UNDERDOG <span style={{ color: "var(--lime)" }}>COACH</span>
            </span>
          </div>
          <span className="display" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "0.12em" }}>
            HOME <span style={{ color: "var(--lime)" }}>›</span> TACTICS BOARD
          </span>
        </div>

        {/* chevron matchday strip */}
        <div style={{ display: "flex", gap: 5, marginTop: 16, animation: "riseIn 0.45s ease-out" }}>
          <div className="chev first hot">
            <span className="display ital" style={{ fontSize: 15, fontWeight: 800 }}>{TEAMS.blue.name}</span>
          </div>
          <div className="chev">
            <span className="display" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)" }}>VS</span>
          </div>
          <div className="chev">
            <span className="display ital" style={{ fontSize: 15, fontWeight: 800, color: "var(--red)" }}>{TEAMS.red.name}</span>
          </div>
          {drill && (
            <div
              className="chev"
              style={{ borderColor: drill.opponent_goals > drill.user_goals ? "rgba(232,52,124,0.55)" : "rgba(216,239,61,0.45)" }}
            >
              <span
                className="display ital"
                style={{
                  fontSize: 14, fontWeight: 800,
                  color: drill.opponent_goals > drill.user_goals ? "var(--magenta)" : "var(--lime)",
                }}
              >
                {TEAMS.blue.short} {drill.user_goals}–{drill.opponent_goals} {TEAMS.red.short} · {drill.minute}&apos;
              </span>
            </div>
          )}
          <div className="chev" style={{ marginLeft: "auto" }}>
            <span className="display" style={{ fontSize: 13, fontWeight: 700, color: "var(--cyan)" }}>
              SQUAD {squadRating} · CHEM 78
            </span>
          </div>
        </div>

        {/* main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 328px", gap: 20, marginTop: 16, flex: 1, alignItems: "stretch" }}>
          {/* pitch panel */}
          <section
            style={{
              background: "rgba(13,13,22,0.72)",
              border: "1px solid var(--line)",
              padding: 16,
              animation: "riseIn 0.5s ease-out",
              backdropFilter: "blur(3px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
              <span className="display ital" style={{ fontSize: 26, fontWeight: 800, color: "var(--lime)" }}>YOUR SQUAD</span>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>drag to reshape · select for details</span>
            </div>
            <Pitch
              bluePawns={bluePawns}
              redPawns={redPawns}
              highlightIds={highlightIds}
              formationLabel={formation.split("").join("-")}
              onMove={movePawn}
              onSelect={(player, team) => setSelected({ player, team })}
            />
          </section>

          {/* coach panel: FIFA promo-card style */}
          <aside
            style={{
              background: "linear-gradient(175deg, #7b23c9 0%, #8b2fd6 34%, #b13ba8 72%, #d0338c 100%)",
              border: "1px solid rgba(255,255,255,0.16)",
              padding: "18px 16px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              animation: "riseIn 0.6s ease-out",
            }}
          >
            <div className="display ital" style={{ fontSize: 22, fontWeight: 800, color: "var(--lime)", lineHeight: 1 }}>
              THE GAFFER
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.82)", marginTop: -6 }}>
              Reads your shape, reacts like it's matchday.
            </div>

            <CoachAvatar emotion={busy ? "explaining" : emotion} />

            {drill && (
              <div
                style={{
                  background: "rgba(10,9,20,0.82)",
                  border: `1px solid ${drill.degraded ? "rgba(232,52,124,0.55)" : "rgba(216,239,61,0.45)"}`,
                  padding: "9px 11px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <div
                    className="display ital"
                    style={{
                      fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em",
                      color: drill.degraded ? "#ff7a88" : "var(--lime)",
                    }}
                  >
                    {drill.degraded ? "⚠ SCRIPTED DRILL" : "MATCHDAY SITUATION"}
                  </div>
                  <span
                    className="display ital"
                    style={{
                      fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em",
                      padding: "1px 6px", border: "1px solid var(--cyan)", color: "var(--cyan)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    YOUR SHAPE: {POSTURE_LABEL[drill.user_posture]}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{drill.scenario}</div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>
                  Goal: {drill.coaching_goal}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontStyle: "italic", marginTop: 4 }}>
                  {drill.focus_note}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={askCoach}
                disabled={busy}
                className="display ital"
                style={{
                  fontSize: 15, fontWeight: 800, letterSpacing: "0.04em",
                  padding: "12px 0", flex: 1,
                  cursor: busy ? "wait" : "pointer",
                  background: "var(--lime)", color: "var(--lime-dark)",
                  border: "none",
                  clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
                  transition: "filter 0.2s",
                  filter: busy ? "saturate(0.5) brightness(0.85)" : "none",
                }}
              >
                {thinking ? "READING THE GAME…" : "ASK THE COACH"}
              </button>
              <button
                onClick={newDrill}
                disabled={busy}
                className="display ital"
                style={{
                  fontSize: 15, fontWeight: 800, letterSpacing: "0.04em",
                  padding: "12px 0", flex: 1,
                  cursor: busy ? "wait" : "pointer",
                  background: "var(--cyan)", color: "#062626",
                  border: "none",
                  clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
                  transition: "filter 0.2s",
                  filter: busy ? "saturate(0.5) brightness(0.85)" : "none",
                }}
              >
                {drillLoading ? "DESIGNING DRILL…" : "NEW DRILL"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7, overflowY: "auto", flex: 1, minHeight: 120, maxHeight: 260, paddingRight: 2 }}>
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
                    <span className="display ital" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", color: m.who === "OPPONENT" ? "#ff7a88" : "var(--cyan)" }}>
                      {m.who === "OPPONENT" ? "OPPONENT MANAGER" : "COACH"}
                    </span>
                    {m.verdict && (
                      <span
                        className="display ital"
                        style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
                          padding: "1px 6px", border: `1px solid ${VERDICT_COLOR[m.verdict]}`,
                          color: VERDICT_COLOR[m.verdict],
                        }}
                      >
                        {m.verdict}
                      </span>
                    )}
                  </span>
                  {m.text}
                </div>
                )
              )}
            </div>
          </aside>
        </div>

        {/* FIFA bottom nav: formation tiles */}
        <nav style={{ display: "flex", gap: 8, marginTop: 18, animation: "riseIn 0.7s ease-out" }}>
          {FORMATIONS.map((f) => (
            <button
              key={f}
              onClick={() => pickFormation(f)}
              className={`tile ${formation === f ? "active" : ""}`}
              style={{ flex: 1, padding: 0, textAlign: "left" }}
            >
              <span className="tile-ghost">{f.split("").join("-")}</span>
              <span className="tile-in" style={{ display: "block", padding: "16px 18px 14px" }}>
                <span className="tile-label" style={{ fontSize: 19 }}>{f.split("").join("-")}</span>
              </span>
            </button>
          ))}
          <button onClick={reset} className="tile" style={{ flex: "0 0 130px", padding: 0, textAlign: "left" }}>
            <span className="tile-in" style={{ display: "block", padding: "16px 18px 14px" }}>
              <span className="tile-label" style={{ fontSize: 19, color: "var(--text-dim)" }}>RESET</span>
            </span>
          </button>
        </nav>

        {/* controller hints footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 2px 4px", fontSize: 11.5, color: "var(--text-dim)" }}>
          <span><span className="hint-key">✕</span>Select player</span>
          <span><span className="hint-key">◆</span>Drag to move</span>
          <span><span className="hint-key">▲</span>Ask the coach</span>
          <span style={{ marginLeft: "auto", fontSize: 11 }}>
            Live: Strands agents on Amazon Bedrock + AgentCore Runtime — falls back to an offline read if the API is unreachable
          </span>
        </div>
      </main>

      {selected && <PlayerCard player={selected.player} teamId={selected.team} onClose={() => setSelected(null)} />}
    </>
  );
}
