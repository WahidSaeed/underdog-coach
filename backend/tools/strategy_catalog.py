"""
Fixed catalog of opening strategies (agent_instruction.md item 3: "Game
starts like a chess where opponent position is based on fixed options of
strategies from which it picks randomly, same for user as well").

Static rows that never change at runtime - kept as a Python constant
module, same convention as FORMATIONS/POS_BY_LINE being TS constants in
frontend/lib/engine.ts, not a DB table. Only the *chosen* strategy for a
given match is persisted (Match.user_formation_code etc, see db/models.py).

formation_code values must exist in tools/grid_movement.LINES.
"""

import random
from typing import Literal, TypedDict

FormationCode = Literal[
    "442", "433", "352", "532",
    "41212", "4231", "4321", "4222", "3421", "3241", "460",
]
TacticalStance = Literal["balanced", "high_press", "low_block", "possession", "direct"]


class StrategyOption(TypedDict):
    formation_code: FormationCode
    tactical_stance: TacticalStance
    label: str
    description: str


STRATEGIES: list[StrategyOption] = [
    {"formation_code": "442", "tactical_stance": "balanced",
     "label": "4-4-2 Balanced",
     "description": "Two banks of four, strikers up top. No obvious bias, hard to exploit early."},
    {"formation_code": "442", "tactical_stance": "high_press",
     "label": "4-4-2 High Press",
     "description": "Same shape, but the front two and midfield line push up to win the ball high."},
    {"formation_code": "433", "tactical_stance": "possession",
     "label": "4-3-3 Possession",
     "description": "Front three stretches the pitch, midfield three circulate the ball patiently."},
    {"formation_code": "433", "tactical_stance": "high_press",
     "label": "4-3-3 Gegenpress",
     "description": "Front three and midfield hunt the ball back the instant possession is lost."},
    {"formation_code": "352", "tactical_stance": "low_block",
     "label": "3-5-2 Low Block",
     "description": "Back three sits deep, five-man midfield screens in front of it."},
    {"formation_code": "352", "tactical_stance": "direct",
     "label": "3-5-2 Direct",
     "description": "Skips the midfield build-up, looks to get the ball to the front two quickly."},
    {"formation_code": "532", "tactical_stance": "low_block",
     "label": "5-3-2 Low Block",
     "description": "Five at the back, compact and hard to break down centrally."},
    {"formation_code": "532", "tactical_stance": "balanced",
     "label": "5-3-2 Balanced",
     "description": "Extra defensive cover without fully camping in its own third."},
    {"formation_code": "41212", "tactical_stance": "possession",
     "label": "4-1-2-1-2 Narrow Diamond",
     "description": "A holding mid screens the back four, a No.10 supports two strikers centrally."},
    {"formation_code": "4231", "tactical_stance": "high_press",
     "label": "4-2-3-1 Gegenpress",
     "description": "Double pivot protects the back four, three attacking mids press the ball high."},
    {"formation_code": "4321", "tactical_stance": "possession",
     "label": "4-3-2-1 Christmas Tree",
     "description": "Narrow and layered - three central mids feed two support strikers behind one striker."},
    {"formation_code": "4222", "tactical_stance": "balanced",
     "label": "4-2-2-2 Split Block",
     "description": "Double pivot behind two wide attacking mids and two strikers - box-shaped down the middle."},
    {"formation_code": "3421", "tactical_stance": "direct",
     "label": "3-4-2-1 Wing-Back Base",
     "description": "Back three with wing-backs providing width, two free roles support a lone striker."},
    {"formation_code": "3241", "tactical_stance": "high_press",
     "label": "3-2-4-1 All-Out Attack",
     "description": "Only two holding mids behind a four-man attacking line - high risk, high reward."},
    {"formation_code": "460", "tactical_stance": "possession",
     "label": "4-6-0 False Nine",
     "description": "No recognized striker at all - a six-man midfield rotates into the space up front."},
]


def random_strategy() -> StrategyOption:
    return random.choice(STRATEGIES)
