export type GroupPlayer = { id: string; name: string; handicap: number | null };
export type GroupTarget = 3 | 4 | 5;

function compositions(total: number, min = 3, max = 5): number[][] {
  if (total === 0) return [[]];
  const result: number[][] = [];
  for (let size = min; size <= max; size += 1) {
    if (size > total) continue;
    for (const rest of compositions(total - size, size, max)) result.push([size, ...rest]);
  }
  return result;
}

export function groupSizes(total: number, target: GroupTarget): number[] {
  if (total < 3) return [];
  const options = compositions(total);
  if (!options.length) return [];
  return options.sort((a, b) => {
    const exactA = a.filter((size) => size === target).length;
    const exactB = b.filter((size) => size === target).length;
    if (exactA !== exactB) return exactB - exactA;
    const distanceA = a.reduce((sum, size) => sum + Math.abs(size - target), 0);
    const distanceB = b.reduce((sum, size) => sum + Math.abs(size - target), 0);
    if (distanceA !== distanceB) return distanceA - distanceB;
    if (a.length !== b.length) return a.length - b.length;
    return b.join("").localeCompare(a.join(""));
  })[0].sort((a, b) => b - a);
}

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function shufflePlayers(players: GroupPlayer[], seed = Date.now()) {
  const shuffled = [...players];
  const random = seededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function fillBySizes(players: GroupPlayer[], sizes: number[]) {
  const groups: GroupPlayer[][] = [];
  let offset = 0;
  for (const size of sizes) {
    groups.push(players.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}

export function generateRandomGroups(players: GroupPlayer[], target: GroupTarget, seed = Date.now()) {
  const sizes = groupSizes(players.length, target);
  return sizes.length ? fillBySizes(shufflePlayers(players, seed), sizes) : [];
}

export function generateBalancedGroups(players: GroupPlayer[], target: GroupTarget, seed = 1) {
  if (players.some((player) => typeof player.handicap !== "number" || !Number.isFinite(player.handicap))) return [];
  const sizes = groupSizes(players.length, target);
  if (!sizes.length) return [];

  type BalanceScore = [spread: number, variance: number];
  const score = (groups: GroupPlayer[][]): BalanceScore => {
    const averages = groups.map((group) => group.reduce((sum, player) => sum + player.handicap!, 0) / group.length);
    const mean = players.reduce((sum, player) => sum + player.handicap!, 0) / players.length;
    const spread = Math.max(...averages) - Math.min(...averages);
    const variance = averages.reduce((sum, average) => sum + ((average - mean) ** 2), 0);
    return [spread, variance];
  };
  const compareScore = (a: BalanceScore, b: BalanceScore) => {
    const spread = a[0] - b[0];
    if (Math.abs(spread) > 1e-9) return spread;
    const variance = a[1] - b[1];
    return Math.abs(variance) > 1e-9 ? variance : 0;
  };

  // Start from several seeded layouts and improve each one with pair swaps. Using
  // group averages (rather than the smallest raw sum) keeps plus handicaps and
  // unequal group sizes balanced as well. The seed remains meaningful for a
  // redraw while a repeated seed is fully deterministic for tests/replays.
  const random = seededRandom(seed);
  let bestGroups: GroupPlayer[][] | null = null;
  let bestScore: BalanceScore | null = null;
  const starts = Math.max(12, Math.min(36, players.length * 2));

  for (let start = 0; start < starts; start += 1) {
    const layoutSeed = Math.floor(random() * 0x1_0000_0000) >>> 0;
    const groups = fillBySizes(shufflePlayers(players, layoutSeed), sizes);
    let currentScore = score(groups);

    for (let pass = 0; pass < players.length * 2; pass += 1) {
      let bestSwap: [number, number, number, number] | null = null;
      let bestSwapScore = currentScore;
      for (let firstGroup = 0; firstGroup < groups.length; firstGroup += 1) {
        for (let secondGroup = firstGroup + 1; secondGroup < groups.length; secondGroup += 1) {
          for (let first = 0; first < groups[firstGroup].length; first += 1) {
            for (let second = 0; second < groups[secondGroup].length; second += 1) {
              [groups[firstGroup][first], groups[secondGroup][second]] = [groups[secondGroup][second], groups[firstGroup][first]];
              const candidateScore = score(groups);
              [groups[firstGroup][first], groups[secondGroup][second]] = [groups[secondGroup][second], groups[firstGroup][first]];
              if (compareScore(candidateScore, bestSwapScore) < 0) {
                bestSwap = [firstGroup, first, secondGroup, second];
                bestSwapScore = candidateScore;
              }
            }
          }
        }
      }
      if (!bestSwap) break;
      const [firstGroup, first, secondGroup, second] = bestSwap;
      [groups[firstGroup][first], groups[secondGroup][second]] = [groups[secondGroup][second], groups[firstGroup][first]];
      currentScore = bestSwapScore;
    }

    if (!bestScore || compareScore(currentScore, bestScore) < 0) {
      bestGroups = groups.map((group) => [...group]);
      bestScore = currentScore;
    }
  }

  return bestGroups || [];
}

export function validateGroups(groups: GroupPlayer[][], source: GroupPlayer[]) {
  const ids = groups.flat().map((player) => player.id);
  return groups.every((group) => group.length >= 3 && group.length <= 5)
    && ids.length === source.length
    && new Set(ids).size === source.length
    && source.every((player) => ids.includes(player.id));
}

export function normalizePlayerName(name: string) {
  return name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

export function appendUniquePlayer(players: GroupPlayer[], next: GroupPlayer) {
  const normalized = normalizePlayerName(next.name);
  if (!normalized || players.some((player) => normalizePlayerName(player.name) === normalized)) return players;
  return [...players, { ...next, name: next.name.trim() }];
}

export function hasDuplicatePlayerNames(players: GroupPlayer[]) {
  const names = players.map((player) => normalizePlayerName(player.name)).filter(Boolean);
  return new Set(names).size !== names.length;
}

export function moveGroupPlayer(groups: GroupPlayer[][], playerId: string, destinationIndex: number) {
  const next = groups.map((group) => [...group]);
  const sourceIndex = next.findIndex((group) => group.some((player) => player.id === playerId));
  if (sourceIndex < 0 || sourceIndex === destinationIndex || !next[destinationIndex] || next[destinationIndex].length >= 5 || next[sourceIndex].length <= 3) return groups;
  const playerIndex = next[sourceIndex].findIndex((player) => player.id === playerId);
  const [player] = next[sourceIndex].splice(playerIndex, 1);
  next[destinationIndex].push(player);
  return next;
}

export function swapGroupPlayers(groups: GroupPlayer[][], firstId: string, secondId: string) {
  if (!firstId || !secondId || firstId === secondId) return groups;
  const next = groups.map((group) => [...group]);
  const firstGroup = next.findIndex((group) => group.some((player) => player.id === firstId));
  const secondGroup = next.findIndex((group) => group.some((player) => player.id === secondId));
  if (firstGroup < 0 || secondGroup < 0 || firstGroup === secondGroup) return groups;
  const firstIndex = next[firstGroup].findIndex((player) => player.id === firstId);
  const secondIndex = next[secondGroup].findIndex((player) => player.id === secondId);
  [next[firstGroup][firstIndex], next[secondGroup][secondIndex]] = [next[secondGroup][secondIndex], next[firstGroup][firstIndex]];
  return next;
}

export function groupsShareText(groups: GroupPlayer[][]) {
  return ["THE BACKYARD", "Golf · Grupos", "", ...groups.flatMap((group, index) => [
    `Grupo ${index + 1}`,
    ...group.map((player) => `• ${player.name}`),
    "",
  ])].join("\n").trim();
}
