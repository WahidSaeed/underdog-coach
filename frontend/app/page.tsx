"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Pitch from "@/components/Pitch";
import PlayerCard from "@/components/PlayerCard";
import CoachAvatar, { CoachEmotion } from "@/components/CoachAvatar";
import VerdictHero, { RoundState } from "@/components/coach/VerdictHero";
import MatchupChip from "@/components/coach/MatchupChip";
import ActivityTicker from "@/components/coach/ActivityTicker";
import Scoreboard from "@/components/coach/Scoreboard";
import Bench from "@/components/coach/Bench";
import MatchReportDrawer, { MatchDossier } from "@/components/coach/MatchReportDrawer";
import MatchEndModal from "@/components/coach/MatchEndModal";
import { FeedMsg, MATCH_STATUS_LABEL } from "@/components/coach/theme";
import { abstract, deriveHeadline } from "@/components/coach/derive";
import { Arrow, buildOpponentArrows, FormationCode, Pawn, toPawns } from "@/lib/engine";
import { Player, TeamId, TEAMS, overallRating } from "@/lib/data";
import { logout } from "@/lib/auth";
import {
  askCoachFeedback,
  askMatchStart,
  askOpponent,
  askRoster,
  askTurn,
  BenchStatus,
  CoachVerdict,
  FormationStatus,
  getSessionId,
  hasMatchup,
  MatchStatus,
  MatchupDetail,
  MoveOut,
  ScoreState,
  StrategyOption,
  SuggestedFix,
} from "@/lib/api";

const ALL_FORMATIONS: FormationCode[] = [
  "442", "433", "352", "532",
  "41212", "4231", "4321", "4222", "3421", "3241", "460",
];

// Mirrors backend/tools/player_data.STARTING_XI_SIZE: the first 11 roster
// players are the starting XI, the rest are bench.
const BENCH_PLAYERS = TEAMS.blue.players.slice(11);

// Small grey "tool call" lines in the feed - makes the agent's tool use
// (scout_matchup, get_player_traits, ...) visible, not just its prose.
function toolCallMsgs(toolCalls: string[], seed: number): FeedMsg[] {
  return toolCalls.map((name, i) => ({
    who: "META",
    text: `🔍 scouted via ${name}(...)`,
    id: seed + i,
  }));
}

export default function Home() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [userStrategy, setUserStrategy] = useState<StrategyOption | null>(null);
  const [opponentStrategy, setOpponentStrategy] = useState<StrategyOption | null>(null);
  const [bluePawns, setBluePawns] = useState<Pawn[]>([]);
  const [redPawns, setRedPawns] = useState<Pawn[]>([]);
  const [dossier, setDossier] = useState<MatchDossier | null>(null);
  const [score, setScore] = useState<ScoreState | null>(null);
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const [feed, setFeed] = useState<FeedMsg[]>([]);
  const [emotion, setEmotion] = useState<CoachEmotion>("neutral");
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ player: Player; team: TeamId } | null>(null);
  const [stagedSwap, setStagedSwap] = useState<{ a: string; b: string } | null>(null);
  const [stagedFormationChange, setStagedFormationChange] = useState<FormationCode | null>(null);
  const [stagedSubstitution, setStagedSubstitution] = useState<{ out: string; in: string } | null>(null);
  const [selectedBenchId, setSelectedBenchId] = useState<string | null>(null);
  const [formationStatus, setFormationStatus] = useState<FormationStatus | null>(null);
  const [benchStatus, setBenchStatus] = useState<BenchStatus | null>(null);
  const [suggestedFix, setSuggestedFix] = useState<SuggestedFix | null>(null);
  // player_id -> photo URL, fetched once from the DB-backed roster (see
  // backend/db/seed.py) - independent of match state, so it's loaded
  // alongside the first match rather than re-fetched every turn.
  const [photoByPlayerId, setPhotoByPlayerId] = useState<Record<string, string>>({});

  const [starting, setStarting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = starting || thinking;

  const [round, setRound] = useState<RoundState>(null);
  const [activeMatchup, setActiveMatchup] = useState<MatchupDetail | null>(null);
  const [recurringWeakness, setRecurringWeakness] = useState<MatchupDetail | null>(null);
  const [lastToolCalls, setLastToolCalls] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastSeenFeedId, setLastSeenFeedId] = useState(0);
  // Verdict tally across the whole match, for the end-of-match summary
  // (MatchEndModal) - separate from `score`, which is rule-finding-point
  // totals, not a per-turn verdict count.
  const [verdictCounts, setVerdictCounts] = useState<Record<CoachVerdict, number>>({ SOLVED: 0, PARTIAL: 0, EXPOSED: 0 });
  const [matchEndModalOpen, setMatchEndModalOpen] = useState(false);
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

  const formationCode = (formationStatus?.current ?? userStrategy?.formation_code ?? "442") as FormationCode;

  // A staged swap is applied to the rendered board immediately (chess-move
  // preview) - the raw move pair is only sent to the server on END TURN.
  const displayedBluePawns = useMemo(() => {
    if (!stagedSwap) return bluePawns;
    const a = bluePawns.find((p) => p.player.id === stagedSwap.a);
    const b = bluePawns.find((p) => p.player.id === stagedSwap.b);
    if (!a || !b) return bluePawns;
    return bluePawns.map((p) => {
      if (p.player.id === a.player.id) return { ...p, x: b.x, y: b.y, line: b.line, slot: b.slot };
      if (p.player.id === b.player.id) return { ...p, x: a.x, y: a.y, line: a.line, slot: a.slot };
      return p;
    });
  }, [bluePawns, stagedSwap]);

  const startMatch = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    setThinking(false);
    setStagedSwap(null);
    setStagedFormationChange(null);
    setStagedSubstitution(null);
    setSelectedBenchId(null);
    setSuggestedFix(null);
    setRound(null);
    setActiveMatchup(null);
    setRecurringWeakness(null);
    setVerdictCounts({ SOLVED: 0, PARTIAL: 0, EXPOSED: 0 });
    setMatchEndModalOpen(false);
    setHighlightIds([]);
    setArrows([]);
    setEmotion("explaining");
    setFeed([]);
    setLastSeenFeedId(0);

    try {
      const sessionId = getSessionId();
      const res = await askMatchStart({ session_id: sessionId, user_team: "blue", opponent_team: "red" });
      setMatchId(res.match_id);
      setUserStrategy(res.user_strategy);
      setOpponentStrategy(res.opponent_strategy);
      setBluePawns(toPawns(res.blue_board, "blue"));
      setRedPawns(toPawns(res.red_board, "red"));
      setDossier({ scenario: res.scenario, coaching_goal: res.coaching_goal, focus_note: res.focus_note, degraded: res.degraded });
      setScore({ good: 0, bad: 0, neutral: 0, total: 0, turns_taken: 0, target_score: res.target_score, max_turns: res.max_turns });
      setMatchStatus("active");
      setFormationStatus(res.formation_status);
      setBenchStatus(res.bench_status);
      const focus = hasMatchup(res.focus_matchup) ? res.focus_matchup : null;
      setHighlightIds(focus ? [focus.attacker_id, focus.defender_id] : []);
      setActiveMatchup(focus);
      setLastToolCalls(res.tool_calls);
      setFeed([
        {
          who: "COACH",
          text: `New match: ${res.user_strategy.label} vs their ${res.opponent_strategy.label}. Select a player, then drag them onto a teammate to swap positions, then END TURN.`,
          id: 0,
        },
        ...toolCallMsgs(res.tool_calls, 1),
      ]);
      setEmotion("neutral");
    } catch (err) {
      console.error("match/start failed:", err);
      setError("Couldn't start a match - is the backend running? Try again.");
    } finally {
      setStarting(false);
    }
  }, [starting]);

  useEffect(() => {
    startMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.all([askRoster("blue"), askRoster("red")])
      .then(([blue, red]) => {
        const map: Record<string, string> = {};
        for (const p of [...blue, ...red]) {
          if (p.photo_url) map[p.id] = p.photo_url;
        }
        setPhotoByPlayerId(map);
      })
      .catch((err) => console.error("roster photo fetch failed:", err));
  }, []);

  const proposeSwap = useCallback(
    (fromPlayerId: string, toPlayerId: string) => {
      if (busy || matchStatus !== "active") return;
      setStagedFormationChange(null);
      setStagedSubstitution(null);
      setSelectedBenchId(null);
      setStagedSwap({ a: fromPlayerId, b: toPlayerId });
    },
    [busy, matchStatus]
  );

  const selectFormationChange = useCallback(
    (code: FormationCode) => {
      if (busy || matchStatus !== "active" || !formationStatus?.available || code === formationCode) return;
      setStagedSwap(null);
      setStagedSubstitution(null);
      setSelectedBenchId(null);
      setStagedFormationChange((prev) => (prev === code ? null : code));
    },
    [busy, matchStatus, formationStatus, formationCode]
  );

  const selectBenchPlayer = useCallback(
    (playerId: string) => {
      if (busy || matchStatus !== "active") return;
      setStagedSwap(null);
      setStagedFormationChange(null);
      setSelectedBenchId((prev) => (prev === playerId ? null : playerId));
    },
    [busy, matchStatus]
  );

  // Selecting a bench player then a pitch player stages a substitution
  // instead of opening that player's card (agent_instruction.md follow-up:
  // "replace any on-field player with the one on bench").
  const handlePitchSelect = useCallback(
    (player: Player, team: TeamId) => {
      if (selectedBenchId && team === "blue") {
        setStagedSwap(null);
        setStagedFormationChange(null);
        setStagedSubstitution({ out: player.id, in: selectedBenchId });
        setSelectedBenchId(null);
        return;
      }
      setSelected({ player, team });
    },
    [selectedBenchId]
  );

  const endTurn = async () => {
    if (busy || !matchId || matchStatus !== "active") return;
    // A bench player alone isn't a complete substitution - pairing it
    // with the on-field player it replaces is what actually stages
    // stagedSubstitution (see handlePitchSelect). Ending the turn here
    // would otherwise silently submit an empty turn (no moves, no
    // substitution) and burn it for nothing, with no visible feedback.
    if (selectedBenchId && !stagedSubstitution) {
      setError("Pick the on-field player to bring that substitute on for, then END TURN.");
      return;
    }
    setThinking(true);
    setError(null);
    setEmotion("explaining");
    setRound(null);

    try {
      let moves: MoveOut[] = [];
      if (stagedSwap) {
        const a = bluePawns.find((p) => p.player.id === stagedSwap.a);
        const b = bluePawns.find((p) => p.player.id === stagedSwap.b);
        if (a && b) {
          moves = [
            { player_id: a.player.id, to_line: b.line, to_slot: b.slot },
            { player_id: b.player.id, to_line: a.line, to_slot: a.slot },
          ];
        }
      }
      const formationChange = stagedFormationChange;
      const substitution = stagedSubstitution ? { player_id_out: stagedSubstitution.out, player_id_in: stagedSubstitution.in } : null;
      setStagedSwap(null);
      setStagedFormationChange(null);
      setStagedSubstitution(null);

      const turnRes = await askTurn({ match_id: matchId, moves, formation_change: formationChange, substitution });
      setBluePawns(toPawns(turnRes.blue_board, "blue"));
      setFormationStatus(turnRes.formation_status);
      setBenchStatus(turnRes.bench_status);
      if (formationChange) {
        setFeed((prev) => [...prev, { who: "META", text: `🔁 formation changed to ${formationChange.split("").join("-")}`, id: Date.now() }]);
      }
      if (substitution) {
        const outName = TEAMS.blue.players.find((p) => p.id === substitution.player_id_out)?.name ?? substitution.player_id_out;
        const inName = TEAMS.blue.players.find((p) => p.id === substitution.player_id_in)?.name ?? substitution.player_id_in;
        setFeed((prev) => [...prev, { who: "META", text: `🔄 substitution: ${outName} off, ${inName} on`, id: Date.now() }]);
      }
      if (turnRes.rejected_moves.length) {
        setFeed((prev) => [
          ...prev,
          { who: "META", text: `⚠ move rejected: ${turnRes.rejected_moves.map((r) => r.reason).join(", ")}`, id: Date.now() },
        ]);
      }

      const previousRedPawns = redPawns;
      const oppRes = await askOpponent({ match_id: matchId });
      const newRedPawns = toPawns(oppRes.red_board, "red");
      setRedPawns(newRedPawns);

      const redMoves = newRedPawns
        .map((np) => {
          const old = previousRedPawns.find((p) => p.player.id === np.player.id);
          if (!old || (old.x === np.x && old.y === np.y)) return null;
          return { player_id: np.player.id, from: { x: old.x, y: old.y }, to: { x: np.x, y: np.y } };
        })
        .filter((m): m is { player_id: string; from: { x: number; y: number }; to: { x: number; y: number } } => m !== null);

      const liveMatchup = hasMatchup(oppRes.target_matchup) ? oppRes.target_matchup : null;
      setArrows(buildOpponentArrows(redMoves, liveMatchup, newRedPawns, turnRes.blue_board.length ? toPawns(turnRes.blue_board, "blue") : bluePawns));
      setEmotion(oppRes.emotion);
      setHighlightIds(liveMatchup ? [liveMatchup.attacker_id, liveMatchup.defender_id] : []);
      setActiveMatchup(liveMatchup);
      setFeed((prev) => [
        ...prev,
        ...toolCallMsgs(oppRes.tool_calls, Date.now() + 10),
        { who: "OPPONENT", text: oppRes.opponent.narrative, id: Date.now() + 20 },
      ]);

      const coachRes = await askCoachFeedback({ match_id: matchId });
      setFeed((prev) => [
        ...prev,
        ...toolCallMsgs(coachRes.tool_calls, Date.now() + 30),
        { who: "COACH", text: coachRes.short_feedback, detailed: coachRes.detailed_feedback, id: Date.now() + 40, verdict: coachRes.verdict },
      ]);
      setLastToolCalls([...oppRes.tool_calls, ...coachRes.tool_calls]);
      // The verdict is graded from the full rule_findings list (broader
      // than the pre-grading emotion calc in backend/main.py's
      // _compute_emotion, which only looks at the one focus matchup) -
      // once it lands, it must win the avatar's mood too, or the avatar
      // can read "celebrating" while the badge says EXPOSED.
      if (coachRes.verdict === "SOLVED") setEmotion("celebrating");
      else if (coachRes.verdict === "PARTIAL") setEmotion("worried");
      else if (coachRes.verdict === "EXPOSED") setEmotion("angry");
      if (coachRes.verdict) {
        setVerdictCounts((prev) => ({ ...prev, [coachRes.verdict!]: prev[coachRes.verdict!] + 1 }));
      }

      setRound({
        verdict: coachRes.verdict,
        emotion: oppRes.emotion,
        headline: coachRes.verdict ? deriveHeadline(coachRes.verdict, liveMatchup) : abstract(coachRes.short_feedback),
        degraded: oppRes.degraded || coachRes.degraded,
      });
      setScore(coachRes.score);
      setMatchStatus(coachRes.match_status);
      setFormationStatus(coachRes.formation_status);
      setBenchStatus(coachRes.bench_status);
      setSuggestedFix(coachRes.suggested_fix);

      if (oppRes.recurring_weakness) {
        const rw = oppRes.recurring_weakness;
        setRecurringWeakness(rw);
        setFeed((prev) => [
          ...prev,
          { who: "COACH", text: `That's twice now — ${rw.defender} keeps getting exposed there. Worth a permanent fix.`, id: Date.now() + 50 },
        ]);
      }

      if (coachRes.match_status !== "active") {
        setFeed((prev) => [
          ...prev,
          { who: "COACH", text: `Match complete - final score ${coachRes.score.total}/${coachRes.score.target_score}. Start a new match to keep training.`, id: Date.now() + 60 },
        ]);
        setMatchEndModalOpen(true);
      }
    } catch (err) {
      console.error("end turn failed:", err);
      setError("The coach couldn't be reached mid-turn - try END TURN again.");
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <div className="stage" aria-hidden="true">
        <div className="beam-wrap" style={{ left: "6%", transform: "rotate(14deg)" }}>
          <div className="beam" style={{ animationDuration: "9s", animationDelay: "0s" }} />
        </div>
        <div className="beam-wrap" style={{ left: "26%", transform: "rotate(7deg)", opacity: 0.6 }}>
          <div className="beam" style={{ animationDuration: "7s", animationDelay: "-2.5s" }} />
        </div>
        <div className="beam-wrap" style={{ right: "10%", transform: "rotate(-13deg)" }}>
          <div className="beam" style={{ animationDuration: "10s", animationDelay: "-5s" }} />
        </div>
        <div className="beam-wrap" style={{ right: "30%", transform: "rotate(-6deg)", opacity: 0.55 }}>
          <div className="beam" style={{ animationDuration: "8s", animationDelay: "-1s" }} />
        </div>
        <div className="clouds">
          <div className="cloud cloud--a" />
          <div className="cloud cloud--b" />
          <div className="cloud cloud--c" />
          <div className="cloud cloud--d" />
        </div>
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
          <Link
            href="/roster"
            className="display ital"
            style={{
              marginLeft: "auto", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.04em",
              padding: "6px 12px", color: "var(--text)", border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.05)", textDecoration: "none",
            }}
          >
            ROSTER MANAGER
          </Link>
          <button
            onClick={logout}
            className="display ital"
            style={{
              fontSize: 12.5, fontWeight: 800, letterSpacing: "0.04em",
              padding: "6px 12px", color: "#ff7a88", border: "1px solid rgba(232,52,124,0.4)",
              background: "rgba(232,52,124,0.1)", cursor: "pointer",
            }}
          >
            LOGOUT
          </button>
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
          {userStrategy && opponentStrategy && (
            <div className="chev">
              <span className="display ital" style={{ fontSize: 13, fontWeight: 800, color: "var(--cyan)" }}>
                {userStrategy.label} vs {opponentStrategy.label}
              </span>
            </div>
          )}
          {matchStatus && matchStatus !== "active" && (
            <div className="chev" style={{ borderColor: "rgba(216,239,61,0.55)" }}>
              <span className="display ital" style={{ fontSize: 14, fontWeight: 800, color: "var(--lime)" }}>
                {MATCH_STATUS_LABEL[matchStatus]}
              </span>
            </div>
          )}
          <div className="chev" style={{ marginLeft: "auto" }}>
            <span className="display" style={{ fontSize: 13, fontWeight: 700, color: "var(--cyan)" }}>
              SQUAD {squadRating}
            </span>
          </div>
        </div>

        {error && (
          <div
            className="display"
            style={{
              marginTop: 12, padding: "8px 12px", fontSize: 12.5, fontWeight: 600,
              color: "#ff7a88", border: "1px solid rgba(232,52,124,0.55)", background: "rgba(232,52,124,0.1)",
            }}
          >
            ⚠ {error}
          </div>
        )}

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
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {stagedFormationChange
                  ? `formation change to ${stagedFormationChange.split("").join("-")} staged — press END TURN to commit`
                  : stagedSubstitution
                    ? "substitution staged — press END TURN to commit"
                    : selectedBenchId
                      ? "now click the on-field player to replace"
                      : stagedSwap
                        ? "swap staged — press END TURN to commit"
                        : "drag a player onto a teammate to propose a swap, or select a bench player below"}
              </span>
            </div>
            <Pitch
              bluePawns={displayedBluePawns}
              redPawns={redPawns}
              highlightIds={highlightIds}
              formationLabel={formationCode.split("").join("-")}
              formationCode={formationCode}
              arrows={arrows}
              photoByPlayerId={photoByPlayerId}
              onProposeSwap={proposeSwap}
              onSelect={handlePitchSelect}
            />

            {/* rare/costly formation change - agent_instruction.md item 1 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap", rowGap: 6 }}>
              <span className="display" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
                SYSTEM CHANGE
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ALL_FORMATIONS.map((code) => {
                  const isCurrent = code === formationCode;
                  const isStaged = code === stagedFormationChange;
                  const disabled = isCurrent || !formationStatus?.available || busy || matchStatus !== "active";
                  return (
                    <button
                      key={code}
                      onClick={() => selectFormationChange(code)}
                      disabled={disabled}
                      title={
                        isCurrent
                          ? "Current formation"
                          : !formationStatus?.available
                            ? `Available again at turn ${formationStatus?.available_at_turn ?? "?"}`
                            : "Reshapes your whole team - costs the turn and a small score penalty"
                      }
                      className="display ital"
                      style={{
                        fontSize: 12.5, fontWeight: 800, letterSpacing: "0.03em",
                        padding: "5px 10px",
                        cursor: disabled ? (isCurrent ? "default" : "not-allowed") : "pointer",
                        background: isStaged ? "var(--lime)" : isCurrent ? "rgba(216,239,61,0.18)" : "rgba(10,9,20,0.6)",
                        color: isStaged ? "var(--lime-dark)" : isCurrent ? "var(--lime)" : "var(--text)",
                        border: `1px solid ${isCurrent ? "var(--lime)" : "var(--line)"}`,
                        opacity: disabled && !isCurrent ? 0.45 : 1,
                      }}
                    >
                      {code.split("").join("-")}
                    </button>
                  );
                })}
              </div>
              {formationStatus && !formationStatus.available && (
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  available again at turn {formationStatus.available_at_turn}
                </span>
              )}
            </div>

            <Bench
              players={BENCH_PLAYERS}
              status={benchStatus}
              selectedId={selectedBenchId}
              onSelect={selectBenchPlayer}
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
              drillActive={!!matchId}
              coachingGoal={dossier ? abstract(dossier.coaching_goal) : null}
              round={round}
              idleWarning={error}
            />

            <Scoreboard score={score} />

            <MatchupChip
              matchup={activeMatchup}
              recurringWeakness={recurringWeakness}
              onClick={() => activeMatchup && setHighlightIds([activeMatchup.attacker_id, activeMatchup.defender_id])}
            />

            {suggestedFix && matchStatus === "active" && (
              <div
                style={{
                  background: "rgba(216,239,61,0.12)",
                  border: "1px solid rgba(216,239,61,0.5)",
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 12, lineHeight: 1.4 }}>
                  💡 Swap <b>{suggestedFix.player_a_name}</b> and <b>{suggestedFix.player_b_name}</b> next turn to
                  improve your cover.
                </span>
                <button
                  onClick={() => proposeSwap(suggestedFix.player_id_a, suggestedFix.player_id_b)}
                  disabled={busy}
                  className="display ital"
                  style={{
                    alignSelf: "flex-start",
                    fontSize: 11.5, fontWeight: 800, letterSpacing: "0.04em",
                    padding: "4px 10px",
                    cursor: busy ? "wait" : "pointer",
                    background: "var(--lime)", color: "var(--lime-dark)",
                    border: "none",
                  }}
                >
                  APPLY SUGGESTION
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={endTurn}
                disabled={busy || !matchId || matchStatus !== "active"}
                title={matchStatus !== "active" ? "Start a new match" : undefined}
                className="display ital"
                style={{
                  fontSize: 15, fontWeight: 800, letterSpacing: "0.04em",
                  padding: "12px 0", flex: 1,
                  cursor: busy ? "wait" : matchStatus !== "active" ? "not-allowed" : "pointer",
                  background: "var(--lime)", color: "var(--lime-dark)",
                  border: "none",
                  clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)",
                  transition: "filter 0.2s",
                  filter: busy || matchStatus !== "active" ? "saturate(0.5) brightness(0.85)" : "none",
                }}
              >
                {thinking ? "PLAYING TURN…" : "END TURN"}
              </button>
              <button
                onClick={startMatch}
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
                {starting ? "STARTING…" : "NEW MATCH"}
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

        <MatchReportDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} dossier={dossier} feed={feed} />

        <MatchEndModal
          open={matchEndModalOpen}
          matchStatus={matchStatus && matchStatus !== "active" ? matchStatus : null}
          score={score}
          verdictCounts={verdictCounts}
          onClose={() => setMatchEndModalOpen(false)}
          onNewMatch={() => {
            setMatchEndModalOpen(false);
            startMatch();
          }}
        />

        {/* controller hints footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 2px 4px", fontSize: 11.5, color: "var(--text-dim)" }}>
          <span><span className="hint-key">✕</span>Select player</span>
          <span><span className="hint-key">◆</span>Drag onto a teammate to swap</span>
          <span><span className="hint-key">▲</span>End turn</span>
          <span style={{ marginLeft: "auto", fontSize: 11 }}>
            Live: Strands agents on Amazon Bedrock + AgentCore Runtime, Postgres-backed match state
          </span>
        </div>
      </main>

      {selected && <PlayerCard player={selected.player} teamId={selected.team} onClose={() => setSelected(null)} />}
    </>
  );
}
