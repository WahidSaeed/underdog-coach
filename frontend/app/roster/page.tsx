"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  askRoster,
  askTraits,
  createPlayer,
  deletePlayer,
  PlayerStats,
  RosterPlayer,
  TraitMap,
  updatePlayer,
} from "@/lib/api";
import { TeamId, TEAMS, overallRating } from "@/lib/data";
import { logout } from "@/lib/auth";

// Client mirror of backend/main.py's VALID_POSITIONS - the server is
// authoritative (rejects anything else with a 400), this is only for
// building the <select> options.
const VALID_POSITIONS = ["GK", "CB", "RB", "LB", "CM", "RM", "LM", "ST"] as const;
const STAT_KEYS: (keyof PlayerStats)[] = ["pace", "shooting", "passing", "defending", "physicality", "composure"];

const EMPTY_STATS: PlayerStats = { pace: 50, shooting: 50, passing: 50, defending: 50, physicality: 50, composure: 50 };

type FormState = {
  num: string;
  name: string;
  position: string;
  stats: PlayerStats;
  strengths: string[];
  weaknesses: string[];
};

const EMPTY_FORM: FormState = { num: "", name: "", position: "CM", stats: EMPTY_STATS, strengths: [], weaknesses: [] };

function playerToForm(p: RosterPlayer): FormState {
  return {
    num: String(p.num), name: p.name, position: p.position,
    stats: p.stats, strengths: p.strengths, weaknesses: p.weaknesses,
  };
}

export default function RosterManager() {
  const [rosters, setRosters] = useState<Record<TeamId, RosterPlayer[]> | null>(null);
  const [traits, setTraits] = useState<TraitMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which team's "add player" form (if any) is open, and which existing
  // player (if any) is being edited - mutually exclusive, one form panel
  // rendered at a time per team.
  const [addingTeam, setAddingTeam] = useState<TeamId | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [blue, red, traitMap] = await Promise.all([askRoster("blue"), askRoster("red"), askTraits()]);
      setRosters({ blue, red });
      setTraits(traitMap);
    } catch (err) {
      console.error("roster load failed:", err);
      setError("Couldn't load rosters - is the backend running with DATABASE_URL configured?");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startAdd = (team: TeamId) => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAddingTeam((prev) => (prev === team ? null : team));
  };

  const startEdit = (p: RosterPlayer) => {
    setAddingTeam(null);
    setForm(playerToForm(p));
    setEditingId((prev) => (prev === p.id ? null : p.id));
  };

  const cancelForm = () => {
    setAddingTeam(null);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const toggleTrait = (kind: "strengths" | "weaknesses", tag: string) => {
    setForm((f) => ({
      ...f,
      [kind]: f[kind].includes(tag) ? f[kind].filter((t) => t !== tag) : [...f[kind], tag],
    }));
  };

  const submitAdd = async (team: TeamId) => {
    const num = parseInt(form.num, 10);
    if (!form.name.trim() || Number.isNaN(num)) {
      setError("Name and shirt number are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createPlayer({
        team_id: team, num, name: form.name.trim(), position: form.position,
        stats: form.stats, strengths: form.strengths, weaknesses: form.weaknesses,
      });
      cancelForm();
      await load();
    } catch (err) {
      console.error("create player failed:", err);
      setError("Couldn't add that player.");
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (playerId: string) => {
    const num = parseInt(form.num, 10);
    if (!form.name.trim() || Number.isNaN(num)) {
      setError("Name and shirt number are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePlayer(playerId, {
        num, name: form.name.trim(), position: form.position,
        stats: form.stats, strengths: form.strengths, weaknesses: form.weaknesses,
      });
      cancelForm();
      await load();
    } catch (err) {
      console.error("update player failed:", err);
      setError("Couldn't save that player.");
    } finally {
      setBusy(false);
    }
  };

  const removePlayer = async (p: RosterPlayer) => {
    if (!window.confirm(`Remove ${p.name} from the roster? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deletePlayer(p.id);
      await load();
    } catch (err) {
      console.error("delete player failed:", err);
      setError("Couldn't remove that player.");
    } finally {
      setBusy(false);
    }
  };

  const renderForm = (mode: "add" | "edit", team: TeamId, playerId?: string) => (
    <div
      style={{
        background: "rgba(10,9,20,0.6)", border: "1px solid var(--line)",
        padding: 14, display: "flex", flexDirection: "column", gap: 10, marginTop: 8,
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)" }}>
          NUMBER
          <input
            type="number"
            value={form.num}
            onChange={(e) => setForm((f) => ({ ...f, num: e.target.value }))}
            style={{ width: 64, background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "var(--text)", padding: "6px 8px" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)", flex: 1, minWidth: 160 }}>
          NAME
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "var(--text)", padding: "6px 8px" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)" }}>
          POSITION
          <select
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "var(--text)", padding: "6px 8px" }}
          >
            {VALID_POSITIONS.map((pos) => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {STAT_KEYS.map((key) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--text-dim)", textTransform: "uppercase" }}>
            {key}
            <input
              type="number"
              min={0}
              max={99}
              value={form.stats[key]}
              onChange={(e) =>
                setForm((f) => ({ ...f, stats: { ...f.stats, [key]: Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)) } }))
              }
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--line)", color: "var(--text)", padding: "5px 8px" }}
            />
          </label>
        ))}
      </div>

      {(["strengths", "weaknesses"] as const).map((kind) => (
        <div key={kind}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 4 }}>{kind}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {Object.keys(traits?.[kind] ?? {}).map((tag) => {
              const active = form[kind].includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTrait(kind, tag)}
                  title={traits?.[kind]?.[tag]}
                  style={{
                    fontSize: 10.5, padding: "4px 8px", cursor: "pointer",
                    background: active ? "var(--lime)" : "rgba(255,255,255,0.05)",
                    color: active ? "var(--lime-dark)" : "var(--text-dim)",
                    border: `1px solid ${active ? "var(--lime)" : "var(--line)"}`,
                  }}
                >
                  {tag.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={() => (mode === "add" ? submitAdd(team) : submitEdit(playerId!))}
          disabled={busy}
          className="display ital"
          style={{
            fontSize: 12.5, fontWeight: 800, padding: "7px 14px",
            background: "var(--lime)", color: "var(--lime-dark)", border: "none",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {mode === "add" ? "ADD PLAYER" : "SAVE CHANGES"}
        </button>
        <button
          onClick={cancelForm}
          disabled={busy}
          className="display ital"
          style={{
            fontSize: 12.5, fontWeight: 800, padding: "7px 14px",
            background: "rgba(255,255,255,0.06)", color: "var(--text)", border: "1px solid var(--line)",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );

  const renderTeam = (team: TeamId) => {
    const accent = team === "blue" ? "var(--blue)" : "var(--red)";
    const players = rosters?.[team] ?? [];
    return (
      <section
        style={{
          background: "rgba(13,13,22,0.72)", border: "1px solid var(--line)",
          padding: 16, flex: 1, minWidth: 320,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span className="display ital" style={{ fontSize: 22, fontWeight: 800, color: accent }}>
            {TEAMS[team].name.toUpperCase()}
          </span>
          <button
            onClick={() => startAdd(team)}
            className="display ital"
            style={{
              fontSize: 12, fontWeight: 800, padding: "6px 12px",
              background: addingTeam === team ? "var(--lime)" : "rgba(255,255,255,0.06)",
              color: addingTeam === team ? "var(--lime-dark)" : "var(--text)",
              border: "1px solid var(--line)", cursor: "pointer",
            }}
          >
            + ADD PLAYER
          </button>
        </div>

        {addingTeam === team && renderForm("add", team)}

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          {players.map((p) => (
            <div key={p.id}>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", padding: "8px 10px",
                }}
              >
                {p.photo_url ? (
                  <img src={p.photo_url} alt={p.name} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: 6, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>#{p.num} · {p.position}</span>
                    <span style={{ fontSize: 11, color: accent, fontWeight: 700 }}>{overallRating(p.stats)} OVR</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[...p.strengths, ...p.weaknesses].map((t) => t.replace(/_/g, " ")).join(", ") || "no traits set"}
                  </div>
                </div>
                <button
                  onClick={() => startEdit(p)}
                  style={{
                    fontSize: 11, padding: "5px 10px", cursor: "pointer",
                    background: "rgba(255,255,255,0.06)", color: "var(--text)", border: "1px solid var(--line)",
                  }}
                >
                  EDIT
                </button>
                <button
                  onClick={() => removePlayer(p)}
                  disabled={busy}
                  style={{
                    fontSize: 11, padding: "5px 10px", cursor: busy ? "wait" : "pointer",
                    background: "rgba(232,52,124,0.12)", color: "#ff7a88", border: "1px solid rgba(232,52,124,0.4)",
                  }}
                >
                  DELETE
                </button>
              </div>
              {editingId === p.id && renderForm("edit", team, p.id)}
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 26px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <Link href="/" className="display ital" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dim)", textDecoration: "none" }}>
          ← BACK TO MATCH
        </Link>
        <span className="display ital" style={{ fontSize: 26, fontWeight: 800, color: "var(--lime)" }}>
          ROSTER MANAGER
        </span>
        <button
          onClick={logout}
          className="display ital"
          style={{
            marginLeft: "auto", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.04em",
            padding: "6px 12px", color: "#ff7a88", border: "1px solid rgba(232,52,124,0.4)",
            background: "rgba(232,52,124,0.1)", cursor: "pointer",
          }}
        >
          LOGOUT
        </button>
      </div>

      {error && (
        <div
          className="display"
          style={{
            marginBottom: 14, padding: "8px 12px", fontSize: 12.5, fontWeight: 600,
            color: "#ff7a88", border: "1px solid rgba(232,52,124,0.55)", background: "rgba(232,52,124,0.1)",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {!rosters ? (
        <div style={{ color: "var(--text-dim)" }}>Loading rosters…</div>
      ) : (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {renderTeam("blue")}
          {renderTeam("red")}
        </div>
      )}
    </main>
  );
}
