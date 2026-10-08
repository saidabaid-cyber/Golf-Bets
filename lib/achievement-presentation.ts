/** Display labels only. Stable evidence IDs and persisted names stay unchanged. */
export function achievementDisplayName(slug: string, fallback: string) {
  return ({"low-round":"Mejor ronda","birdie-club":"Club de birdies","par-master":"Dominio del par","consistency":"Constancia","top-finish":"Podio","win-streak":"Racha de victorias","ace-club":"Hoyo en uno"} as Record<string,string>)[slug] ?? fallback;
}
