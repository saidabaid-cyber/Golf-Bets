import { readFileSync } from "node:fs";

const pending = JSON.parse(readFileSync(new URL("../data/course-locations-pending.json", import.meta.url), "utf8")).clubs;
const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b(club|de|del|el|la|los|las|country|golf|campo|resort|and|spa)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

if (process.argv.includes("--nominatim")) {
  for (const club of pending) {
    const q = [club.club, club.city, club.state, "México"].filter(Boolean).join(", ");
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ format: "jsonv2", countrycodes: "mx", limit: "3", q }).toString();
    const lookup = await fetch(url, { headers: { "User-Agent": "TheBackyardCourseAudit/1.0 QA-research" } });
    if (!lookup.ok) throw new Error(`Nominatim ${lookup.status}`);
    const results = await lookup.json();
    console.log(JSON.stringify({ pending: club, results: results.map(({ place_id, osm_type, osm_id, lat, lon, category, type, importance, display_name }) => ({ place_id, osm_type, osm_id, lat, lon, category, type, importance, display_name })) }));
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  process.exit(0);
}

const query = `[out:json][timeout:90];(nwr["leisure"="golf_course"](14,-118,33,-86);nwr["golf"="course"](14,-118,33,-86););out center tags;`;
const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "TheBackyardCourseAudit/1.0 QA-research" },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) throw new Error(`Overpass ${response.status}`);
const payload = await response.json();
const features = payload.elements.map((element) => ({
  type: element.type,
  id: element.id,
  name: element.tags?.name ?? element.tags?.["name:es"] ?? "",
  latitude: element.lat ?? element.center?.lat ?? null,
  longitude: element.lon ?? element.center?.lon ?? null,
  tags: element.tags ?? {},
})).filter((feature) => feature.name && Number.isFinite(feature.latitude) && Number.isFinite(feature.longitude));

for (const club of pending) {
  const wanted = new Set(normalize(club.club).split(/\s+/).filter((token) => token.length > 2));
  const matches = features.map((feature) => {
    const actual = new Set(normalize(feature.name).split(/\s+/).filter((token) => token.length > 2));
    const overlap = [...wanted].filter((token) => actual.has(token)).length;
    const score = overlap / Math.max(1, Math.min(wanted.size, actual.size));
    return { score, ...feature };
  }).filter((match) => match.score >= 0.5).sort((left, right) => right.score - left.score).slice(0, 5);
  if (matches.length) console.log(JSON.stringify({ pending: club, matches }));
}

console.error(JSON.stringify({ fetched: features.length, pending: pending.length }));
