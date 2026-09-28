export const MEXICO_COURSE_COVERAGE_COLUMNS = [
  "facility",
  "course",
  "city",
  "state",
  "layout",
  "tee",
  "gender",
  "par",
  "rating",
  "slope",
  "length",
  "hole-by-hole_available",
  "coordinates_available",
  "source",
  "provenance",
  "verified_at",
  "status",
];

const STATUS_VALUES = new Set([
  "COMPLETE",
  "PARTIAL",
  "MISSING_RATING",
  "MISSING_SLOPE",
  "MISSING_TEES",
  "MISSING_HOLES",
  "MISSING_LOCATION",
  "NEEDS_VERIFICATION",
]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function finite(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function bool(value) {
  return value === true || value === "true" || value === "t" || value === 1 || value === "1";
}

function coverageStatus(row) {
  if (bool(row.needs_verification)) return "NEEDS_VERIFICATION";
  if (!text(row.tee)) return "MISSING_TEES";
  if (finite(row.rating) === null) return "MISSING_RATING";
  if (finite(row.slope) === null) return "MISSING_SLOPE";
  if (!bool(row.hole_by_hole_available)) return "MISSING_HOLES";
  if (!bool(row.coordinates_available)) return "MISSING_LOCATION";
  if (finite(row.par) === null || !text(row.length) || !text(row.gender)) return "PARTIAL";
  return "COMPLETE";
}

function provenance(row) {
  return [
    ["origin", row.origin],
    ["facility_id", row.source_facility_id],
    ["layout_id", row.source_course_id],
    ["tee_id", row.source_tee_id],
    ["rating_rights", row.rating_rights],
    ["source_url", row.source_url],
  ].flatMap(([key, value]) => text(value) ? [`${key}=${text(value)}`] : []).join(";");
}

/**
 * Builds the public audit inventory from a read-only QA snapshot. Restricted
 * rating values must already be redacted by the source query. Existing seed
 * metadata may fill blank locality fields, but never overwrites observed DB
 * values and never supplies Rating/Slope/Hole facts.
 */
export function buildMexicoCourseCoverageRows(input, seed = {}) {
  if (!Array.isArray(input)) throw new Error("MEXICO_COVERAGE_INPUT_REQUIRED");
  const clubs = Array.isArray(seed.clubs) ? seed.clubs : [];
  const clubById = new Map(clubs.map((club) => [text(club?.id), object(club)]).filter(([id, club]) => id && club));
  return input.map((raw, index) => {
    const row = object(raw);
    if (!row) throw new Error(`MEXICO_COVERAGE_ROW_${index}_INVALID`);
    const seedClub = clubById.get(text(row.facility_id));
    const normalized = {
      facility: text(row.facility),
      course: text(row.course),
      city: text(row.city) || text(seedClub?.city),
      state: text(row.state) || text(seedClub?.stateRegion),
      layout: text(row.layout),
      tee: text(row.tee),
      gender: text(row.gender),
      par: finite(row.par),
      rating: finite(row.rating),
      slope: finite(row.slope),
      length: text(row.length),
      "hole-by-hole_available": bool(row.hole_by_hole_available) ? "YES" : "NO",
      coordinates_available: bool(row.coordinates_available) ? "YES" : "NO",
      source: text(row.source),
      provenance: provenance(row),
      verified_at: text(row.verified_at),
      status: coverageStatus(row),
    };
    if (!normalized.facility || !normalized.course || !normalized.layout || !normalized.source) {
      throw new Error(`MEXICO_COVERAGE_ROW_${index}_IDENTITY_INCOMPLETE`);
    }
    if (!STATUS_VALUES.has(normalized.status)) throw new Error(`MEXICO_COVERAGE_ROW_${index}_STATUS_INVALID`);
    return normalized;
  }).sort((left, right) => left.state.localeCompare(right.state, "es-MX")
    || left.city.localeCompare(right.city, "es-MX")
    || left.facility.localeCompare(right.facility, "es-MX")
    || left.layout.localeCompare(right.layout, "es-MX")
    || left.tee.localeCompare(right.tee, "es-MX"));
}

function csvValue(value) {
  const rendered = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered;
}

export function mexicoCourseCoverageCsv(rows) {
  return [
    MEXICO_COURSE_COVERAGE_COLUMNS.join(","),
    ...rows.map((row) => MEXICO_COURSE_COVERAGE_COLUMNS.map((column) => csvValue(row[column])).join(",")),
  ].join("\n") + "\n";
}

export function parseMexicoCourseCoverageCsv(value) {
  if (typeof value !== "string") throw new Error("MEXICO_COVERAGE_CSV_REQUIRED");
  const parseLine = (line) => {
    const values = []; let current = ""; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === "," && !quoted) { values.push(current); current = ""; }
      else current += character;
    }
    if (quoted) throw new Error("MEXICO_COVERAGE_CSV_UNCLOSED_QUOTE");
    values.push(current); return values;
  };
  const lines = value.replaceAll("\r\n", "\n").trimEnd().split("\n");
  const header = parseLine(lines.shift() ?? "");
  if (header.join("\u0000") !== MEXICO_COURSE_COVERAGE_COLUMNS.join("\u0000")) throw new Error("MEXICO_COVERAGE_CSV_COLUMNS_INVALID");
  return lines.map((line, index) => {
    const values = parseLine(line);
    if (values.length !== header.length) throw new Error(`MEXICO_COVERAGE_CSV_ROW_${index}_INVALID`);
    return Object.fromEntries(header.map((column, columnIndex) => [column, values[columnIndex]]));
  });
}

export function summarizeMexicoCourseCoverage(rows) {
  const byStatus = Object.fromEntries([...STATUS_VALUES].map((status) => [status, rows.filter((row) => row.status === status).length]));
  const unique = (field) => new Set(rows.map((row) => row[field]).filter(Boolean)).size;
  const uniqueComposite = (...fields) => new Set(rows.map((row) => fields.map((field) => row[field]).join("\u0000"))).size;
  const rated = rows.filter((row) => finite(row.rating) !== null && finite(row.slope) !== null).length;
  const holes = rows.filter((row) => row["hole-by-hole_available"] === "YES").length;
  const coordinates = rows.filter((row) => row.coordinates_available === "YES").length;
  return {
    rows: rows.length,
    facilities: unique("facility"),
    courses: uniqueComposite("facility", "course"),
    layouts: uniqueComposite("facility", "course", "layout"),
    tees: rows.filter((row) => row.tee).length,
    ratedTees: rated,
    ratingSlopePercent: rows.length ? Number((rated * 100 / rows.length).toFixed(2)) : 0,
    holeByHolePercent: rows.length ? Number((holes * 100 / rows.length).toFixed(2)) : 0,
    coordinatesPercent: rows.length ? Number((coordinates * 100 / rows.length).toFixed(2)) : 0,
    byStatus,
  };
}
