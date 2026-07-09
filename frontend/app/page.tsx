"use client";

import { useCallback, useMemo, useState } from "react";
import Pitch from "@/components/Pitch";
import PlayerCard from "@/components/PlayerCard";
import CoachAvatar, { CoachEmotion } from "@/components/CoachAvatar";
import VerdictHero, { RoundState } from "@/components/coach/VerdictHero";
import MatchupChip from "@/components/coach/MatchupChip";
import ActivityTicker from "@/components/coach/ActivityTicker";
import MatchReportDrawer from "@/components/coach/MatchReportDrawer";
import { FeedMsg, POSTURE_LABEL } from "@/components/coach/theme";
import { abstract, deriveHeadline } from "@/components/coach/derive";
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
  MatchupDetail,
} from "@/lib/api";

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

  // Glance-panel state (see docs/BRIEFING-glance-ui.md) - `round` is only
  // written once a full ask (opponent + coach-feedback) has resolved, so the
  // hero never renders a stale verdict while `busy` is true.
  const [round, setRound] = useState<RoundState>(null);
  const [activeMatchup, setActiveMatchup] = useState<MatchupDetail | null>(null);
  const [recurringWeakness, setRecurringWeakness] = useState<MatchupDetail | null>(null);
  const [lastToolCalls, setLastToolCalls] = useState<string[]>([]);
  const [idleWarning, setIdleWarning] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastSeenFeedId, setLastSeenFeedId] = useState(0);
  const lastFeedId = feed.length ? feed[feed.length - 1].id : 0;
  const hasUnread = !drawerOpen && lastFeedId > lastSeenFeedId;

  const openDrawer = () => {
    setDrawerOpen(true);
    setLastSeenFeedId(lastFeedId);
  };

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
    setRound(null);
    setActiveMatchup(null);
    setRecurringWeakness(null);
    setLastToolCalls([]);
    setIdleWarning(null);
  };

  const newDrill = async () => {
    if (busy) return;
    setDrillLoading(true);
    setEmotion("explaining");
    setIdleWarning(null);
    setRound(null);
    setRecurringWeakness(null);
    // A new drill starts a new match report - carrying over the previous
    // drill's transcript into the drawer would read as stale/confusing.
    setFeed([]);
    setLastSeenFeedId(0);

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
      setActiveMatchup(focus);
      setLastToolCalls(res.tool_calls);
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
      // The drill's own scenario prose used to also get pushed here as a
      // duplicate COACH feed message - the drawer's pinned dossier is now
      // the only place it's shown (briefing §3/§4 step 2).
      setFeed((prev) => [...prev, ...toolCallMsgs(res.tool_calls, Date.now())]);
    } catch (err) {
      console.error("Drill API failed:", err);
      setIdleWarning("Drill service unreachable — free play mode");
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
    const matchupDetail: MatchupDetail | null = verdict.matchup
      ? {
          attacker_id: verdict.matchup.attacker.id,
          attacker: verdict.matchup.attacker.name,
          defender_id: verdict.matchup.defender.id,
          defender: verdict.matchup.defender.name,
          reasons: verdict.matchup.reasons,
        }
      : null;
    setHighlightIds(matchupDetail ? [matchupDetail.attacker_id, matchupDetail.defender_id] : []);
    setActiveMatchup(matchupDetail);
    setEmotion(verdict.emotion);
    setLastToolCalls([]);
    // Client engine's severity stands in for a graded verdict here - the
    // hero must never silently show stale state after an API failure
    // (briefing §4 step 5).
    const mappedVerdict: CoachVerdict =
      verdict.emotion === "celebrating" ? "SOLVED" : verdict.emotion === "explaining" ? "PARTIAL" : "EXPOSED";
    setRound({
      verdict: mappedVerdict,
      emotion: null,
      // The literal "⚠ OFFLINE READ" label must survive at glance level -
      // it's one of the two non-negotiable degraded labels (briefing §1/§7).
      headline: `⚠ OFFLINE READ — ${deriveHeadline(mappedVerdict, matchupDetail)}`,
      degraded: true,
    });
  };

  const askCoach = async () => {
    if (busy || !drill) return;
    setThinking(true);
    setEmotion("explaining");
    // Clear any previous verdict so the hero falls back to the drill-active
    // (or idle) branch rather than showing a stale grade while busy
    // (briefing gotcha #3).
    setRound(null);

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
      // Opponent's target_matchup wins the matchup-chip source of truth once
      // it lands - it's the live threat, even if it differs from the drill's
      // original focus (briefing gotcha #4).
      const liveMatchup = hasMatchup(opp.target_matchup)
        ? opp.target_matchup
        : hasMatchup(drillContext?.focus_matchup ?? null)
          ? (drillContext!.focus_matchup as MatchupDetail)
          : null;
      setHighlightIds(liveMatchup ? [liveMatchup.attacker_id, liveMatchup.defender_id] : []);
      setActiveMatchup(liveMatchup);
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
      setLastToolCalls([...opp.tool_calls, ...coach.tool_calls]);
      // The verdict is graded after the /opponent emotion already landed -
      // let it win the avatar on SOLVED rather than the earlier read.
      if (coach.verdict === "SOLVED") setEmotion("celebrating");
      setRound({
        verdict: coach.verdict,
        emotion: opp.emotion,
        headline: coach.verdict ? deriveHeadline(coach.verdict, liveMatchup) : abstract(coach.coach_feedback),
        degraded: opp.degraded || coach.degraded,
      });

      if (opp.recurring_weakness) {
        const rw = opp.recurring_weakness;
        setRecurringWeakness(rw);
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

            <CoachAvatar emotion={busy ? "explaining" : emotion} />

            <VerdictHero
              drillActive={!!drill}
              coachingGoal={drill ? abstract(drill.coaching_goal) : null}
              round={round}
              idleWarning={idleWarning}
            />

            <MatchupChip
              matchup={activeMatchup}
              recurringWeakness={recurringWeakness}
              onClick={() => activeMatchup && setHighlightIds([activeMatchup.attacker_id, activeMatchup.defender_id])}
            />

            {drill && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.9)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  🎯 {abstract(drill.coaching_goal)}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span
                    className="display ital"
                    style={{
                      fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em",
                      padding: "1px 6px", border: "1px solid var(--cyan)", color: "var(--cyan)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {POSTURE_LABEL[drill.user_posture]}
                  </span>
                  {drill.degraded && (
                    <span
                      className="display ital"
                      style={{
                        fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em",
                        padding: "1px 6px", border: "1px solid var(--magenta)", color: "#ff7a88",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⚠ SCRIPTED DRILL
                    </span>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={askCoach}
                disabled={busy || !drill}
                title={!drill ? "Start a drill first" : undefined}
                className="display ital"
                style={{
                  fontSize: 15, fontWeight: 800, letterSpacing: "0.04em",
                  padding: "12px 0", flex: 1,
                  cursor: busy ? "wait" : !drill ? "not-allowed" : "pointer",
                  background: "var(--lime)", color: "var(--lime-dark)",
                  border: "none",
                  clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
                  transition: "filter 0.2s",
                  filter: busy || !drill ? "saturate(0.5) brightness(0.85)" : "none",
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

            <ActivityTicker toolCalls={lastToolCalls} busy={busy} />

            <button
              onClick={openDrawer}
              className="display ital"
              style={{
                fontSize: 13, fontWeight: 800, letterSpacing: "0.05em",
                padding: "9px 0",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: "rgba(10,9,20,0.55)",
                color: "var(--text)",
                border: "1px solid rgba(255,255,255,0.25)",
                clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
                cursor: "pointer",
              }}
            >
              MATCH REPORT
              {hasUnread && (
                <span
                  style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: "var(--lime)", boxShadow: "0 0 6px var(--lime)",
                  }}
                />
              )}
            </button>
          </aside>
        </div>

        <MatchReportDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} drill={drill} feed={feed} />

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
