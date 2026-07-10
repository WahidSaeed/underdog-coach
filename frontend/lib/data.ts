export type Stats = {
  pace: number;
  shooting: number;
  passing: number;
  defending: number;
  physicality: number;
  composure: number;
};

export type Player = {
  id: string;
  num: number;
  name: string;
  position: string;
  stats: Stats;
  strengths: string[];
  weaknesses: string[];
};

export type TeamId = "blue" | "red";

export const TRAITS: Record<"strengths" | "weaknesses", Record<string, string>> = {
  strengths: {
    clinical_finisher: "Rarely misses clear-cut chances",
    electric_pace: "Outruns most defenders in open play",
    press_resistant: "Keeps the ball under close pressure",
    aerial_threat: "Wins headers, dangerous at set pieces",
    vision_playmaker: "Picks out incisive through balls",
    tackling_specialist: "Wins clean one-on-one duels",
    leader: "Lifts teammates in tight games",
    long_range_shooter: "Threatens from outside the box",
    overlap_specialist: "Provides width and end product from fullback",
    composed_finisher: "Stays calm one-on-one with the keeper",
    box_to_box_engine: "Covers ground, contributes both ends",
    quick_release_gk: "Distributes fast to start counters",
  },
  weaknesses: {
    poor_tracking_back: "Doesn't recover defensively",
    weak_foot_only: "Heavily reliant on one foot",
    wilts_under_high_press: "Loses composure vs aggressive pressing",
    weak_in_the_air: "Loses aerial duels",
    slow_turning: "Struggles against pace in behind",
    rash_tackler: "Prone to fouls under pressure",
    indecisive_in_box: "Hesitates on clear chances",
    poor_positioning: "Often out of position defensively",
    injury_prone: "Fitness risk over a match",
    poor_distribution: "Gives possession away under pressure",
    short_fuse: "Discipline risk, easily provoked",
    static_in_transition: "Slow to react when possession changes",
  },
};

export const TEAMS: Record<TeamId, { name: string; short: string; players: Player[] }> = {
  blue: {
    name: "Meridian FC",
    short: "MER",
    players: [
      { id: "b1", num: 1, name: "J. Alvarez", position: "GK", stats: { pace: 45, shooting: 20, passing: 68, defending: 74, physicality: 70, composure: 66 }, strengths: ["quick_release_gk"], weaknesses: ["poor_distribution"] },
      { id: "b2", num: 2, name: "R. Kade", position: "RB", stats: { pace: 80, shooting: 40, passing: 71, defending: 73, physicality: 68, composure: 64 }, strengths: ["overlap_specialist"], weaknesses: ["poor_tracking_back"] },
      { id: "b3", num: 3, name: "D. Okafor", position: "CB", stats: { pace: 66, shooting: 25, passing: 62, defending: 84, physicality: 82, composure: 79 }, strengths: ["aerial_threat", "leader"], weaknesses: ["slow_turning"] },
      { id: "b4", num: 4, name: "T. Marsh", position: "CB", stats: { pace: 60, shooting: 22, passing: 65, defending: 80, physicality: 77, composure: 70 }, strengths: ["tackling_specialist"], weaknesses: ["rash_tackler"] },
      { id: "b5", num: 5, name: "L. Fenwick", position: "LB", stats: { pace: 76, shooting: 35, passing: 69, defending: 71, physicality: 65, composure: 62 }, strengths: ["overlap_specialist"], weaknesses: ["weak_in_the_air"] },
      { id: "b6", num: 6, name: "S. Bianchi", position: "CM", stats: { pace: 63, shooting: 55, passing: 82, defending: 68, physicality: 66, composure: 75 }, strengths: ["vision_playmaker", "press_resistant"], weaknesses: ["poor_positioning"] },
      { id: "b7", num: 7, name: "M. Torres", position: "RM", stats: { pace: 88, shooting: 74, passing: 69, defending: 31, physicality: 55, composure: 62 }, strengths: ["electric_pace"], weaknesses: ["poor_tracking_back", "weak_foot_only"] },
      { id: "b8", num: 8, name: "P. Nkemdi", position: "CM", stats: { pace: 70, shooting: 58, passing: 74, defending: 65, physicality: 72, composure: 68 }, strengths: ["box_to_box_engine"], weaknesses: ["static_in_transition"] },
      { id: "b9", num: 11, name: "K. Solberg", position: "LM", stats: { pace: 82, shooting: 68, passing: 66, defending: 38, physicality: 58, composure: 60 }, strengths: ["electric_pace", "long_range_shooter"], weaknesses: ["wilts_under_high_press"] },
      { id: "b10", num: 9, name: "A. Vidal", position: "ST", stats: { pace: 74, shooting: 86, passing: 60, defending: 22, physicality: 71, composure: 80 }, strengths: ["clinical_finisher", "composed_finisher"], weaknesses: ["injury_prone"] },
      { id: "b11", num: 10, name: "E. Whitfield", position: "ST", stats: { pace: 79, shooting: 78, passing: 65, defending: 24, physicality: 60, composure: 63 }, strengths: ["clinical_finisher"], weaknesses: ["indecisive_in_box"] },
      { id: "b12", num: 12, name: "N. Prescott", position: "GK", stats: { pace: 40, shooting: 15, passing: 60, defending: 70, physicality: 68, composure: 60 }, strengths: ["quick_release_gk"], weaknesses: ["poor_positioning"] },
      { id: "b13", num: 13, name: "O. Danso", position: "CB", stats: { pace: 58, shooting: 18, passing: 60, defending: 78, physicality: 80, composure: 72 }, strengths: ["tackling_specialist"], weaknesses: ["slow_turning"] },
      { id: "b14", num: 14, name: "H. Sorensen", position: "LB", stats: { pace: 73, shooting: 30, passing: 66, defending: 69, physicality: 64, composure: 60 }, strengths: ["overlap_specialist"], weaknesses: ["poor_tracking_back"] },
      { id: "b15", num: 15, name: "C. Reyes", position: "CM", stats: { pace: 68, shooting: 52, passing: 77, defending: 60, physicality: 65, composure: 70 }, strengths: ["press_resistant"], weaknesses: ["static_in_transition"] },
      { id: "b16", num: 16, name: "D. Osei", position: "ST", stats: { pace: 81, shooting: 75, passing: 58, defending: 20, physicality: 66, composure: 58 }, strengths: ["electric_pace"], weaknesses: ["indecisive_in_box"] },
    ],
  },
  red: {
    name: "Solvane United",
    short: "SOL",
    players: [
      { id: "r1", num: 1, name: "H. Draskovic", position: "GK", stats: { pace: 42, shooting: 18, passing: 60, defending: 78, physicality: 74, composure: 75 }, strengths: ["quick_release_gk"], weaknesses: [] },
      { id: "r2", num: 2, name: "B. Osei", position: "RB", stats: { pace: 84, shooting: 38, passing: 66, defending: 70, physicality: 66, composure: 60 }, strengths: ["overlap_specialist", "electric_pace"], weaknesses: ["poor_tracking_back"] },
      { id: "r3", num: 3, name: "N. Larkin", position: "CB", stats: { pace: 58, shooting: 20, passing: 58, defending: 82, physicality: 85, composure: 72 }, strengths: ["aerial_threat"], weaknesses: ["slow_turning"] },
      { id: "r4", num: 4, name: "G. Pavlenko", position: "CB", stats: { pace: 55, shooting: 24, passing: 63, defending: 79, physicality: 80, composure: 68 }, strengths: ["leader", "tackling_specialist"], weaknesses: ["short_fuse"] },
      { id: "r5", num: 5, name: "C. Moutinho", position: "LB", stats: { pace: 71, shooting: 30, passing: 64, defending: 74, physicality: 69, composure: 66 }, strengths: ["tackling_specialist"], weaknesses: ["weak_foot_only"] },
      { id: "r6", num: 6, name: "F. Aubert", position: "CM", stats: { pace: 62, shooting: 50, passing: 79, defending: 70, physicality: 68, composure: 73 }, strengths: ["press_resistant"], weaknesses: ["static_in_transition"] },
      { id: "r7", num: 7, name: "Y. Tanaka", position: "RM", stats: { pace: 85, shooting: 70, passing: 72, defending: 34, physicality: 52, composure: 65 }, strengths: ["electric_pace", "vision_playmaker"], weaknesses: ["poor_tracking_back"] },
      { id: "r8", num: 8, name: "I. Kowalski", position: "CM", stats: { pace: 66, shooting: 60, passing: 76, defending: 62, physicality: 70, composure: 64 }, strengths: ["long_range_shooter"], weaknesses: ["rash_tackler"] },
      { id: "r9", num: 11, name: "S. Adeyemi", position: "LM", stats: { pace: 80, shooting: 66, passing: 68, defending: 36, physicality: 61, composure: 58 }, strengths: ["electric_pace"], weaknesses: ["wilts_under_high_press", "weak_foot_only"] },
      { id: "r10", num: 9, name: "V. Petrov", position: "ST", stats: { pace: 70, shooting: 84, passing: 58, defending: 20, physicality: 78, composure: 76 }, strengths: ["aerial_threat", "clinical_finisher"], weaknesses: ["injury_prone"] },
      { id: "r11", num: 10, name: "L. Ferreira", position: "ST", stats: { pace: 77, shooting: 80, passing: 63, defending: 22, physicality: 58, composure: 59 }, strengths: ["composed_finisher"], weaknesses: ["indecisive_in_box", "short_fuse"] },
      { id: "r12", num: 12, name: "M. Kowalczyk", position: "GK", stats: { pace: 40, shooting: 15, passing: 58, defending: 72, physicality: 70, composure: 65 }, strengths: ["quick_release_gk"], weaknesses: ["poor_distribution"] },
      { id: "r13", num: 13, name: "A. Diallo", position: "CB", stats: { pace: 56, shooting: 18, passing: 56, defending: 80, physicality: 83, composure: 70 }, strengths: ["aerial_threat"], weaknesses: ["rash_tackler"] },
      { id: "r14", num: 14, name: "P. Nowak", position: "LB", stats: { pace: 75, shooting: 28, passing: 62, defending: 68, physicality: 63, composure: 58 }, strengths: ["overlap_specialist"], weaknesses: ["weak_in_the_air"] },
      { id: "r15", num: 15, name: "T. Vukovic", position: "CM", stats: { pace: 64, shooting: 48, passing: 74, defending: 66, physicality: 71, composure: 68 }, strengths: ["box_to_box_engine"], weaknesses: ["poor_positioning"] },
      { id: "r16", num: 16, name: "K. Amaro", position: "ST", stats: { pace: 78, shooting: 79, passing: 55, defending: 18, physicality: 60, composure: 55 }, strengths: ["composed_finisher"], weaknesses: ["injury_prone"] },
    ],
  },
};

export function overallRating(s: Stats): number {
  return Math.round(
    (s.pace + s.shooting + s.passing + s.defending + s.physicality + s.composure) / 6
  );
}
