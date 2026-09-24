// Adaptive coaching: aggregate recurring mistake patterns across games and turn
// them into concrete training recommendations built from the user's own positions.
import type { GameRecord, MoveAnalysis, Tag } from './types';
import { isCritical } from './report';
import { gameAccuracy } from './evaluation';

export interface Theme {
  id: string;
  name: string;
  tags: Tag[];
  advice: string;
  drill: string;
}

export const THEMES: Theme[] = [
  {
    id: 'hanging',
    name: 'Hanging pieces',
    tags: ['hanging-piece', 'material-loss', 'losing-exchange', 'overloaded-defender'],
    advice: 'Before every move, list which of your pieces are attacked and whether they are defended enough.',
    drill: 'Solve positions from your games where a piece was left undefended; name every loose piece before moving.',
  },
  {
    id: 'tactical-blindness',
    name: 'Opponent tactics (forks, pins, skewers)',
    tags: ['fork', 'pin', 'skewer', 'discovered-attack', 'double-attack', 'removal-of-defender'],
    advice: "Ask 'what is my opponent threatening?' after every one of their moves — especially checks and double attacks.",
    drill: 'Practice defensive tactics: find the threat first, then the move that parries it.',
  },
  {
    id: 'missed-tactics',
    name: 'Missed tactical opportunities',
    tags: ['missed-fork', 'missed-pin', 'missed-skewer', 'missed-discovered-attack', 'missed-material', 'missed-promotion'],
    advice: 'Scan checks, captures and threats for yourself every move — the opponent makes mistakes too.',
    drill: 'Solve tactic puzzles from your own games where you had a winning shot.',
  },
  {
    id: 'mates',
    name: 'Checkmate patterns',
    tags: ['missed-mate', 'allowed-mate', 'back-rank', 'mate-threat'],
    advice: 'Learn the basic mating patterns (back rank, smothered, queen + bishop) and always look at every check.',
    drill: 'Mate-in-1 and mate-in-2 drills; back-rank mate patterns.',
  },
  {
    id: 'king-safety',
    name: 'King safety',
    tags: ['king-safety', 'weakening-pawn-move', 'back-rank'],
    advice: 'Castle early and avoid pushing the pawns in front of your castled king without a concrete reason.',
    drill: 'Review games where your king came under attack and find the weakening move.',
  },
  {
    id: 'opening',
    name: 'Opening development',
    tags: ['opening-development', 'repeated-piece-move', 'early-queen'],
    advice: 'Develop knights and bishops first, castle, and move each piece once in the opening.',
    drill: 'Play training games focusing on having all minor pieces developed and castled by move 10.',
  },
  {
    id: 'endgame',
    name: 'Endgame technique',
    tags: ['endgame-technique', 'king-activity', 'promotion', 'passed-pawn', 'missed-simplification'],
    advice: 'Activate your king, create and push passed pawns, and calculate pawn races.',
    drill: 'King-and-pawn endgames: opposition, the square of the pawn, and rook endgame basics.',
  },
  {
    id: 'positional',
    name: 'Piece activity & structure',
    tags: ['piece-activity', 'pawn-structure'],
    advice: 'Improve your worst piece and avoid creating pawn weaknesses without compensation.',
    drill: 'In quiet positions, ask which of your pieces is doing the least and find it a better square.',
  },
  {
    id: 'time',
    name: 'Time management',
    tags: ['time-trouble', 'rushed-move'],
    advice: 'Spend more time on critical moments (captures, checks, big decisions) and less on obvious moves.',
    drill: 'Play a longer time control and pause for a blunder check before each capture or check.',
  },
];

export interface ThemeStat {
  theme: Theme;
  count: number;
  gamesAffected: number;
  perGame: number;
  trend: 'improving' | 'worsening' | 'steady';
  byTag: Partial<Record<Tag, number>>;
}

export interface Exercise {
  gameId: string;
  ply: number;
  fen: string;
  solutionUci: string;
  solutionSan: string;
  prompt: string;
  themeId: string;
  classification: MoveAnalysis['classification'];
  headline: string;
}

export interface CoachingProfile {
  gamesAnalysed: number;
  averageAccuracy: number | null;
  recentAccuracy: number | null;
  themes: ThemeStat[];
  recommendations: string[];
  exercises: Exercise[];
}

/** Analysed moves including mistakes that were retried in learning mode. */
function allMistakes(g: GameRecord): MoveAnalysis[] {
  return [...g.analyses, ...(g.trainingMistakes ?? [])];
}

const TAG_LABEL: Partial<Record<Tag, string>> = {
  'missed-fork': 'missed forks',
  'missed-pin': 'missed pins',
  'missed-mate': 'missed mates',
  'missed-material': 'missed chances to win material',
  'hanging-piece': 'hung pieces',
  fork: 'forks against you',
  pin: 'pins against you',
  'allowed-mate': 'allowed mates',
  'repeated-piece-move': 'repeated opening moves',
  'time-trouble': 'time-trouble errors',
};

export function buildCoachingProfile(games: GameRecord[], window = 10): CoachingProfile {
  const recent = [...games].sort((a, b) => b.startedAt - a.startedAt).filter((g) => allMistakes(g).length > 0).slice(0, window);
  const half = Math.ceil(recent.length / 2);
  const newer = recent.slice(0, half);
  const older = recent.slice(half);

  const countTags = (gs: GameRecord[], tags: Tag[]) =>
    gs.reduce((n, g) => n + allMistakes(g).filter((a) => isCritical(a) && a.tags.some((t) => tags.includes(t))).length, 0);

  const themes: ThemeStat[] = THEMES.map((theme) => {
    const byTag: Partial<Record<Tag, number>> = {};
    let gamesAffected = 0;
    let count = 0;
    for (const g of recent) {
      let inGame = 0;
      for (const a of allMistakes(g)) {
        if (!isCritical(a)) continue;
        const hit = a.tags.filter((t) => theme.tags.includes(t));
        if (hit.length) {
          inGame++;
          hit.forEach((t) => (byTag[t] = (byTag[t] ?? 0) + 1));
        }
      }
      count += inGame;
      if (inGame) gamesAffected++;
    }
    const rateNew = newer.length ? countTags(newer, theme.tags) / newer.length : 0;
    const rateOld = older.length ? countTags(older, theme.tags) / older.length : rateNew;
    const trend: ThemeStat['trend'] = rateNew < rateOld * 0.7 ? 'improving' : rateNew > rateOld * 1.3 && rateNew - rateOld >= 0.5 ? 'worsening' : 'steady';
    return { theme, count, gamesAffected, perGame: recent.length ? count / recent.length : 0, trend, byTag };
  })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const recommendations: string[] = [];
  for (const t of themes.slice(0, 3)) {
    const [topTag, topN] = (Object.entries(t.byTag) as [Tag, number][]).sort((a, b) => b[1] - a[1])[0] ?? [];
    const label = topTag ? TAG_LABEL[topTag] : undefined;
    const lead = label
      ? `Your last ${recent.length} game${recent.length > 1 ? 's' : ''} contained ${topN} ${label}.`
      : `${t.theme.name} came up ${t.count} time${t.count > 1 ? 's' : ''} in your last ${recent.length} game${recent.length > 1 ? 's' : ''}.`;
    recommendations.push(`${lead} ${t.theme.advice} Training: ${t.theme.drill}${t.trend === 'improving' ? ' (You are improving here!)' : ''}`);
  }
  if (recommendations.length === 0 && recent.length > 0) recommendations.push('No recurring weaknesses detected yet. Increase the opponent strength to find new challenges.');

  const accs = recent.map((g) => {
    const mine = g.analyses;
    return mine.length ? gameAccuracy(mine.map((a) => a.evaluationLoss)) : null;
  }).filter((x): x is number => x !== null);

  return {
    gamesAnalysed: recent.length,
    averageAccuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
    recentAccuracy: accs[0] ?? null,
    themes,
    recommendations,
    exercises: buildExercises(recent),
  };
}

/** Training positions from the user's own mistakes: "find the move you missed". */
export function buildExercises(games: GameRecord[], themeId?: string): Exercise[] {
  const out: Exercise[] = [];
  for (const g of games) {
    for (const a of allMistakes(g)) {
      if (!isCritical(a) || !a.bestUci || !a.bestMove) continue;
      if (a.classification === 'inaccuracy' && !a.missedOpportunity) continue;
      const theme = THEMES.find((t) => a.tags.some((tag) => t.tags.includes(tag)));
      if (themeId && theme?.id !== themeId) continue;
      out.push({
        gameId: g.id,
        ply: a.ply,
        fen: a.fenBefore,
        solutionUci: a.bestUci,
        solutionSan: a.bestMove,
        prompt: a.missedOpportunity ? 'You missed something here. Find the strongest move.' : `You played ${a.playedMove} here. Find a better move.`,
        themeId: theme?.id ?? 'general',
        classification: a.classification,
        headline: a.explanation.headline,
      });
    }
  }
  return out.slice(0, 50);
}
