import { parseLegacyManualAvatarUrl, type LegacyManualAvatarConfig } from "./manual-avatar-legacy";

/** Locally rendered character creator. No network, provider or user text enters the SVG. */
export const MANUAL_AVATAR_VERSION = 3 as const;
export const MANUAL_AVATAR_OPTIONS = {
  rostro: ["ovalado", "redondo", "cuadrado", "corazon", "alargado", "diamante"],
  mandibula: ["suave", "definida", "angular"],
  mejillas: ["suaves", "marcadas", "llenas"],
  orejas: ["pequenas", "medias", "grandes"],
  piel: ["porcelana", "clara", "mediaClara", "media", "morena", "oscura", "profunda"],
  pelo: ["sinPelo", "rapado", "corto", "medio", "peinado", "ondulado", "rizado", "afro", "largo", "coleta", "entradas"],
  colorPelo: ["negro", "cafeOscuro", "cafe", "castano", "rubio", "pelirrojo", "gris", "blanco"],
  cejas: ["finas", "suaves", "marcadas", "arqueadas", "rectas"],
  ojos: ["redondos", "almendrados", "profundos", "sonrientes", "serenos"],
  colorOjos: ["cafeOscuro", "cafe", "avellana", "verde", "azul", "gris"],
  nariz: ["pequena", "recta", "ancha", "respingada", "aguileña"],
  boca: ["sonrisa", "neutra", "amplia", "suave", "seria"],
  barba: ["ninguna", "sombra", "corta", "media", "completa", "candado", "bigote", "barbaBigote"],
  colorBarba: ["negro", "cafeOscuro", "cafe", "castano", "rubio", "pelirrojo", "gris", "blanco"],
  lentes: ["ninguno", "redondos", "rectangulares", "aviador", "sol"],
  sombrero: ["ninguno", "gorra", "gorraGolf", "visera", "bucket"],
  ropa: ["polo", "playera", "chamarra", "quarterZip"],
  colorRopa: ["backyard", "navy", "marfil", "arcilla", "azul", "salvia"],
  accesorio: ["ninguno", "arete", "aretes", "pañuelo"],
  fondo: ["neutro", "green", "campo", "backyard"],
} as const;

export type ManualAvatarConfig = { version: 3 } & { [K in keyof typeof MANUAL_AVATAR_OPTIONS]: (typeof MANUAL_AVATAR_OPTIONS)[K][number] };
export const DEFAULT_MANUAL_AVATAR: ManualAvatarConfig = {
  version: 3, rostro: "ovalado", mandibula: "definida", mejillas: "suaves", orejas: "medias", piel: "media",
  pelo: "corto", colorPelo: "castano", cejas: "suaves", ojos: "almendrados", colorOjos: "cafe", nariz: "recta", boca: "sonrisa",
  barba: "ninguna", colorBarba: "castano", lentes: "ninguno", sombrero: "ninguno", ropa: "polo", colorRopa: "backyard",
  accesorio: "ninguno", fondo: "campo",
};

const KEYS = Object.keys(MANUAL_AVATAR_OPTIONS) as (keyof typeof MANUAL_AVATAR_OPTIONS)[];
const SKIN = { porcelana: "#f8dfcb", clara: "#edc7a8", mediaClara: "#dfb18b", media: "#c99068", morena: "#a96c4b", oscura: "#754735", profunda: "#4d302a" };
const HAIR = { negro: "#1e2224", cafeOscuro: "#332822", cafe: "#654531", castano: "#4f372d", rubio: "#b68b4c", pelirrojo: "#9a4931", gris: "#7d878b", blanco: "#e5e7e1" };
const IRIS = { cafeOscuro: "#382a25", cafe: "#654435", avellana: "#8a7045", verde: "#3f6e59", azul: "#3f6c91", gris: "#6d7d80" };
const CLOTHES = { backyard: "#0e5a3b", navy: "#18344a", marfil: "#ece8db", arcilla: "#9b5e4b", azul: "#356986", salvia: "#6e8c78" };
const BACKGROUND = { neutro: "#e9ece7", green: "#cfe2d3", campo: "#bad0bd", backyard: "#0d5438" };
export const MANUAL_AVATAR_SWATCHES = { piel: SKIN, colorPelo: HAIR, colorBarba: HAIR, colorOjos: IRIS, colorRopa: CLOTHES, fondo: BACKGROUND } as const;

export function parseManualAvatarConfig(value: unknown): ManualAvatarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 3 || Object.keys(source).length !== KEYS.length + 1) return null;
  for (const key of KEYS) if (!(MANUAL_AVATAR_OPTIONS[key] as readonly string[]).includes(source[key] as string)) return null;
  return { version: 3, ...Object.fromEntries(KEYS.map((key) => [key, source[key]])) } as ManualAvatarConfig;
}

export function randomManualAvatarConfig(random: () => number = Math.random, base: ManualAvatarConfig = DEFAULT_MANUAL_AVATAR): ManualAvatarConfig {
  const selection = Object.fromEntries(KEYS.map((key) => {
    if (key === "piel") return [key, base.piel];
    const values = MANUAL_AVATAR_OPTIONS[key];
    const sample = random();
    const index = Number.isFinite(sample) ? Math.min(values.length - 1, Math.max(0, Math.floor(sample * values.length))) : 0;
    return [key, values[index]];
  }));
  return { version: 3, ...selection } as ManualAvatarConfig;
}

function backgroundSvg(c: ManualAvatarConfig) {
  if (c.fondo === "campo") return `<rect width="256" height="256" fill="url(#sky)"/><g filter="url(#soft)"><path d="M0 112Q56 75 112 107Q172 74 256 110V256H0Z" fill="#789b78"/><path d="M0 151Q71 118 139 150Q196 121 256 142V256H0Z" fill="#4e7d59"/><path d="M91 256Q111 166 166 128Q149 198 151 256Z" fill="#a7c494"/><circle cx="205" cy="78" r="25" fill="#e6e1bd" opacity=".8"/></g>`;
  if (c.fondo === "green") return `<rect width="256" height="256" fill="url(#greenBg)"/><path d="M0 205Q73 167 138 198Q196 167 256 187V256H0Z" fill="#7eaa7c" opacity=".72"/><path d="M216 54V139M216 56l27 13-27 11" fill="none" stroke="#f3f1e6" stroke-width="4"/>`;
  if (c.fondo === "backyard") return `<rect width="256" height="256" fill="url(#backyardBg)"/><circle cx="207" cy="49" r="30" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/><path d="M183 49h48M207 25v48M190 32q17 17 34 0M190 66q17-17 34 0" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>`;
  return `<rect width="256" height="256" fill="url(#neutralBg)"/><circle cx="128" cy="102" r="99" fill="#fff" opacity=".35"/>`;
}

function facePath(c: ManualAvatarConfig) {
  const paths = {
    ovalado: "M70 103Q70 58 128 58Q186 58 186 103L183 161Q179 207 128 219Q77 207 73 161Z",
    redondo: "M67 108Q67 61 128 61Q189 61 189 108L187 160Q184 204 128 207Q72 204 69 160Z",
    cuadrado: "M69 104Q70 61 128 61Q186 61 187 104L183 184Q175 213 128 213Q81 213 73 184Z",
    corazon: "M67 105Q69 58 128 63Q187 58 189 105L181 165Q174 203 128 222Q82 203 75 165Z",
    alargado: "M73 99Q74 52 128 53Q182 52 183 99L181 166Q176 219 128 230Q80 219 75 166Z",
    diamante: "M80 91Q91 57 128 55Q165 57 176 91L190 145L170 192Q151 218 128 225Q105 218 86 192L66 145Z",
  } as const;
  return paths[c.rostro];
}

function hairSvg(c: ManualAvatarConfig, color: string) {
  switch (c.pelo) {
    case "sinPelo": return "";
    case "rapado": return `<path d="M72 104Q71 55 128 55Q185 55 184 104" fill="none" stroke="${color}" stroke-width="10" opacity=".9"/>`;
    case "medio": return `<path d="M63 120Q51 48 126 42Q199 42 195 120L187 164L174 154L176 102Q128 81 78 103L81 154L65 164Z" fill="${color}"/>`;
    case "peinado": return `<path d="M65 106Q57 53 105 43Q157 25 193 79L192 111Q172 80 153 82Q108 79 72 103Z" fill="${color}"/><path d="M103 49Q141 33 178 59" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="6"/>`;
    case "ondulado": return `<path d="M61 112Q48 67 79 55Q91 35 112 47Q137 31 155 47Q184 40 197 83L191 121Q178 99 167 94Q151 85 136 95Q121 80 106 94Q87 79 69 110Z" fill="${color}"/>`;
    case "rizado": return `<g fill="${color}"><circle cx="72" cy="90" r="23"/><circle cx="89" cy="62" r="22"/><circle cx="118" cy="50" r="23"/><circle cx="148" cy="51" r="24"/><circle cx="177" cy="67" r="22"/><circle cx="190" cy="94" r="21"/></g>`;
    case "afro": return `<g fill="${color}"><circle cx="65" cy="89" r="28"/><circle cx="82" cy="52" r="29"/><circle cx="115" cy="37" r="31"/><circle cx="151" cy="39" r="31"/><circle cx="183" cy="59" r="28"/><circle cx="197" cy="94" r="25"/></g>`;
    case "largo": return `<path d="M59 112Q51 38 127 39Q203 37 197 112L204 210L176 224L173 99Q128 80 80 99L80 224L51 209Z" fill="${color}"/>`;
    case "coleta": return `<path d="M63 111Q55 45 128 43Q199 43 193 111Q174 82 151 81Q107 80 73 104Z" fill="${color}"/><path d="M190 91Q218 112 195 180Q182 165 186 118Z" fill="${color}"/>`;
    case "entradas": return `<path d="M69 102Q70 54 108 49L128 69L148 49Q187 54 187 102Q169 79 153 77L128 91L103 77Q86 79 69 102Z" fill="${color}"/>`;
    default: return `<path d="M63 110Q57 45 126 42Q197 39 193 110Q172 80 151 80Q108 80 74 103Z" fill="${color}"/>`;
  }
}

function beardSvg(c: ManualAvatarConfig, color: string) {
  const mustache = `<path d="M126 174Q113 168 105 178Q117 186 128 179Q139 186 151 178Q143 168 130 174Z" fill="${color}"/>`;
  if (c.barba === "sombra") return `<path d="M86 173Q87 204 128 213Q169 204 170 173Q153 204 128 208Q103 204 86 173Z" fill="${color}" opacity=".28"/>`;
  if (c.barba === "corta") return `<path d="M83 171Q84 210 128 221Q172 210 173 171Q156 201 128 208Q100 201 83 171Z" fill="${color}" opacity=".88"/>`;
  if (c.barba === "media") return `<path d="M81 165Q81 216 128 229Q175 216 175 165L163 199Q145 221 128 221Q111 221 93 199Z" fill="${color}"/>`;
  if (c.barba === "completa" || c.barba === "barbaBigote") return `<path d="M78 154Q76 222 128 236Q180 222 178 154L168 193Q149 221 128 227Q107 221 88 193Z" fill="${color}"/>${c.barba === "barbaBigote" ? mustache : ""}`;
  if (c.barba === "candado") return `<path d="M109 186Q128 194 147 186L143 221Q128 232 113 221Z" fill="${color}"/>${mustache}`;
  return c.barba === "bigote" ? mustache : "";
}

function glassesSvg(c: ManualAvatarConfig) {
  if (c.lentes === "ninguno") return "";
  if (c.lentes === "redondos") return `<g fill="none" stroke="#263b36" stroke-width="3.5"><circle cx="99" cy="140" r="17"/><circle cx="157" cy="140" r="17"/><path d="M116 137Q128 133 140 137M82 137L69 133M174 137L187 133"/></g>`;
  if (c.lentes === "aviador") return `<g fill="#8ca39c" fill-opacity=".4" stroke="#263b36" stroke-width="3"><path d="M80 127Q99 120 119 127L115 149Q101 160 87 149Z"/><path d="M137 127Q157 120 176 127L169 149Q155 160 141 149Z"/><path d="M118 133Q128 128 138 133" fill="none"/></g>`;
  if (c.lentes === "sol") return `<g fill="#253833" stroke="#13261f" stroke-width="3"><rect x="80" y="126" width="39" height="28" rx="9"/><rect x="137" y="126" width="39" height="28" rx="9"/><path d="M119 135Q128 131 137 135" fill="none"/></g>`;
  return `<g fill="none" stroke="#263b36" stroke-width="4"><rect x="80" y="126" width="39" height="28" rx="7"/><rect x="137" y="126" width="39" height="28" rx="7"/><path d="M119 135Q128 132 137 135"/></g>`;
}

function hatSvg(c: ManualAvatarConfig) {
  if (c.sombrero === "visera") return `<path d="M65 94Q127 82 191 94L192 105Q128 96 64 106Z" fill="#f1efe4"/><path d="M73 102Q128 95 184 102Q176 117 128 116Q90 115 73 102Z" fill="#0e5a3b"/>`;
  if (c.sombrero === "gorra" || c.sombrero === "gorraGolf") return `<path d="M63 94Q74 46 128 48Q183 46 194 94L199 104Q128 88 59 106Z" fill="${c.sombrero === "gorraGolf" ? "#f1efe4" : "#173b31"}"/><path d="M78 98Q128 87 188 98Q176 119 128 115Q91 116 78 98Z" fill="${c.sombrero === "gorraGolf" ? "#d9ded5" : "#0e5a3b"}"/>${c.sombrero === "gorraGolf" ? `<path d="M127 57v28M114 71h26" stroke="#0e5a3b" stroke-width="3"/>` : ""}`;
  if (c.sombrero === "bucket") return `<path d="M71 92Q77 48 128 49Q179 48 185 92L203 112Q128 125 53 112Z" fill="#ddd8c7"/><path d="M80 91Q128 82 176 91" fill="none" stroke="#0e5a3b" stroke-width="5"/>`;
  return "";
}

export function manualAvatarSvg(config: ManualAvatarConfig): string {
  const c = parseManualAvatarConfig(config);
  if (!c) throw new Error("Configuracion de avatar invalida");
  const skin = SKIN[c.piel], hair = HAIR[c.colorPelo], beard = HAIR[c.colorBarba], iris = IRIS[c.colorOjos], shirt = CLOTHES[c.colorRopa];
  const earRx = c.orejas === "pequenas" ? 7 : c.orejas === "grandes" ? 11 : 9, earRy = c.orejas === "pequenas" ? 13 : c.orejas === "grandes" ? 20 : 17;
  const eyeRy = c.ojos === "redondos" ? 9 : c.ojos === "profundos" ? 5 : 6;
  const eyeY = c.ojos === "serenos" ? 141 : 138;
  const eyes = c.ojos === "sonrientes" ? `<path d="M87 143Q99 132 112 143M144 143Q157 132 169 143" fill="none" stroke="${iris}" stroke-width="4" stroke-linecap="round"/>` : `<g fill="#fff"><ellipse cx="99" cy="${eyeY}" rx="12" ry="${eyeRy}"/><ellipse cx="157" cy="${eyeY}" rx="12" ry="${eyeRy}"/></g><g fill="${iris}"><circle cx="100" cy="${eyeY}" r="5.4"/><circle cx="158" cy="${eyeY}" r="5.4"/></g><g fill="#1c2422"><circle cx="100" cy="${eyeY}" r="2.2"/><circle cx="158" cy="${eyeY}" r="2.2"/></g><g fill="#fff"><circle cx="102" cy="${eyeY - 2}" r="1.3"/><circle cx="160" cy="${eyeY - 2}" r="1.3"/></g>`;
  const brows = c.cejas === "arqueadas" ? "M86 119Q99 106 113 119M143 119Q157 106 171 119" : c.cejas === "marcadas" ? "M86 119L113 115M143 115L171 119" : c.cejas === "rectas" ? "M87 117L112 117M144 117L169 117" : c.cejas === "finas" ? "M88 120Q100 116 112 119M144 119Q157 116 169 120" : "M87 119Q100 114 112 118M144 118Q157 114 170 119";
  const nose = c.nariz === "pequena" ? "M127 147L124 163L132 165" : c.nariz === "ancha" ? "M126 145L120 164Q128 171 137 164" : c.nariz === "respingada" ? "M126 145L124 162Q129 158 136 164" : c.nariz === "aguileña" ? "M127 143Q136 156 128 166L135 167" : "M127 144L125 165L134 167";
  const mouth = c.boca === "neutra" ? "M112 184Q128 185 144 184" : c.boca === "amplia" ? "M104 179Q128 203 152 179" : c.boca === "suave" ? "M110 183Q128 190 146 183" : c.boca === "seria" ? "M111 188Q128 181 145 188" : "M109 181Q128 196 147 181";
  const face = facePath(c), jawWidth = c.mandibula === "angular" ? 4 : c.mandibula === "definida" ? 2.5 : 1.5;
  const cheeks = c.mejillas === "llenas" ? `<ellipse cx="91" cy="169" rx="19" ry="12" fill="#c77267" opacity=".12"/><ellipse cx="165" cy="169" rx="19" ry="12" fill="#c77267" opacity=".12"/>` : c.mejillas === "marcadas" ? `<path d="M78 166Q95 176 110 168M146 168Q161 176 178 166" fill="none" stroke="#70483d" stroke-opacity=".18" stroke-width="3"/>` : "";
  const shirtShape = c.ropa === "chamarra" ? "M18 266Q23 219 83 211L128 239L173 211Q233 219 238 266Z" : "M22 266Q29 221 84 214L128 237L172 214Q227 221 234 266Z";
  const collar = c.ropa === "polo" ? `<path d="M91 217L128 240L108 254L82 220M165 217L128 240L148 254L174 220" fill="#fff" opacity=".9"/>` : c.ropa === "quarterZip" ? `<path d="M128 222V256" stroke="#e9eee9" stroke-width="5"/><circle cx="128" cy="242" r="3" fill="#173b31"/>` : c.ropa === "chamarra" ? `<path d="M128 222V256M91 218Q105 238 128 242Q151 238 165 218" fill="none" stroke="#d6dfd8" stroke-width="4"/>` : "";
  const accessory = c.accesorio === "arete" ? `<circle cx="188" cy="166" r="5" fill="#d6ac54"/>` : c.accesorio === "aretes" ? `<g fill="#d6ac54"><circle cx="68" cy="166" r="5"/><circle cx="188" cy="166" r="5"/></g>` : c.accesorio === "pañuelo" ? `<path d="M98 219Q128 232 158 219L151 239Q128 248 105 239Z" fill="#d7b15f"/>` : "";
  const metadata = btoa(JSON.stringify(c));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Avatar Backyard"><metadata id="backyard-avatar-config">${metadata}</metadata><defs><clipPath id="portrait"><circle cx="128" cy="128" r="128"/></clipPath><linearGradient id="neutralBg" x2="0" y2="1"><stop stop-color="#f5f4ee"/><stop offset="1" stop-color="#d6ded8"/></linearGradient><linearGradient id="greenBg" x2="1" y2="1"><stop stop-color="#e5f0e7"/><stop offset="1" stop-color="#8eb594"/></linearGradient><linearGradient id="backyardBg" x2="0" y2="1"><stop stop-color="#176447"/><stop offset="1" stop-color="#083b28"/></linearGradient><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#dce8df"/><stop offset="1" stop-color="#a9c3ae"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="4"/></filter><filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".2"/></filter></defs><g clip-path="url(#portrait)">${backgroundSvg(c)}<g filter="url(#shadow)"><path d="${shirtShape}" fill="${shirt}"/><path d="M111 199L111 226Q128 244 145 226L145 199Z" fill="${skin}"/>${collar}${c.pelo === "largo" || c.pelo === "coleta" ? hairSvg(c, hair) : ""}<ellipse cx="69" cy="153" rx="${earRx}" ry="${earRy}" fill="${skin}"/><ellipse cx="187" cy="153" rx="${earRx}" ry="${earRy}" fill="${skin}"/><path d="${face}" fill="${skin}" stroke="#503d36" stroke-opacity=".2" stroke-width="${jawWidth}"/>${cheeks}${hairSvg(c, hair)}<path d="${brows}" fill="none" stroke="${hair}" stroke-width="${c.cejas === "marcadas" ? 5 : c.cejas === "finas" ? 2 : 3.5}" stroke-linecap="round"/>${eyes}<path d="${nose}" fill="none" stroke="#754c3e" stroke-opacity=".52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${beardSvg(c, beard)}<path d="${mouth}" fill="none" stroke="#8a4c4a" stroke-width="3" stroke-linecap="round"/>${glassesSvg(c)}${accessory}${hatSvg(c)}</g></g></svg>`;
}

const PREFIX = "data:image/svg+xml;base64,";
export function manualAvatarUrl(config: ManualAvatarConfig): string { return PREFIX + btoa(manualAvatarSvg(config)); }

function upgradeLegacy(c: LegacyManualAvatarConfig): ManualAvatarConfig {
  const accessory = c.accesorio;
  return {
    ...DEFAULT_MANUAL_AVATAR,
    rostro: c.rostro,
    piel: c.piel === "profunda" ? "profunda" : c.piel === "oscura" ? "oscura" : c.piel === "morena" ? "morena" : c.piel === "clara" ? "clara" : "media",
    pelo: c.pelo, colorPelo: c.colorPelo, cejas: c.cejas, ojos: c.ojos, colorOjos: c.colorOjos === "cafe" ? "cafe" : c.colorOjos,
    nariz: c.nariz, boca: c.boca, barba: c.barba === "perilla" ? "candado" : c.barba, colorBarba: c.colorPelo,
    lentes: accessory === "lentes" ? "redondos" : accessory === "lentesSol" ? "sol" : "ninguno",
    sombrero: accessory === "visera" || accessory === "gorra" || accessory === "gorraGolf" ? accessory : "ninguno",
    ropa: c.persona === "clasico" ? "chamarra" : c.persona === "deportivo" ? "quarterZip" : "polo",
    colorRopa: c.persona === "clasico" ? "arcilla" : c.persona === "deportivo" ? "navy" : "backyard",
    accesorio: accessory === "aretes" ? "aretes" : "ninguno",
    fondo: c.fondo === "sage" ? "green" : c.fondo === "sky" ? "campo" : "neutro",
  };
}

/** Exact canonical re-render is the acceptance gate: arbitrary SVG is never trusted. */
export function parseManualAvatarUrl(value: unknown): ManualAvatarConfig | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX) || value.length > 30_000 || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const svg = atob(value.slice(PREFIX.length));
    const match = svg.match(/<metadata id="backyard-avatar-config">([A-Za-z0-9+/]+={0,2})<\/metadata>/);
    if (match) {
      const current = parseManualAvatarConfig(JSON.parse(atob(match[1])));
      if (current && manualAvatarUrl(current) === value) return current;
    }
  } catch { return null; }
  const legacy = parseLegacyManualAvatarUrl(value);
  return legacy ? upgradeLegacy(legacy) : null;
}
