/** A locally rendered, editable avatar. No network, image provider or user text enters SVG. */
export const MANUAL_AVATAR_VERSION = 1 as const;
export const MANUAL_AVATAR_OPTIONS = {
  persona: ["golfista", "clasico", "deportivo"],
  rostro: ["ovalado", "redondo", "cuadrado"],
  piel: ["clara", "media", "morena", "oscura", "profunda"],
  pelo: ["sinPelo", "rapado", "corto", "medio", "peinado", "ondulado", "rizado", "largo"],
  colorPelo: ["negro", "cafeOscuro", "cafe", "castano", "rubio", "pelirrojo", "gris", "blanco"],
  ojos: ["redondos", "almendrados", "sonrientes"],
  colorOjos: ["cafe", "verde", "azul"],
  cejas: ["suaves", "marcadas", "arqueadas"],
  nariz: ["pequena", "recta", "ancha"],
  boca: ["sonrisa", "neutra", "amplia"],
  barba: ["ninguna", "sombra", "corta", "media", "completa", "perilla", "bigote", "barbaBigote"],
  accesorio: ["ninguno", "lentes", "lentesSol", "visera", "gorra", "gorraGolf", "aretes"],
} as const;

export type ManualAvatarConfig = { version: 1 } & {
  [K in keyof typeof MANUAL_AVATAR_OPTIONS]: (typeof MANUAL_AVATAR_OPTIONS)[K][number]
};

export const DEFAULT_MANUAL_AVATAR: ManualAvatarConfig = {
  version: 1, persona: "golfista", rostro: "ovalado", piel: "media", pelo: "corto", colorPelo: "castano",
  ojos: "almendrados", colorOjos: "cafe", cejas: "suaves", nariz: "recta", boca: "sonrisa",
  barba: "ninguna", accesorio: "ninguno",
};

const KEYS = Object.keys(MANUAL_AVATAR_OPTIONS) as (keyof typeof MANUAL_AVATAR_OPTIONS)[];
const SKIN = { clara: "#f5d7bd", media: "#dbaa80", morena: "#ad704d", oscura: "#784935", profunda: "#4e312c" };
const HAIR = { negro: "#24272b", cafeOscuro: "#342924", cafe: "#704e39", castano: "#533b30", rubio: "#b48a4e", pelirrojo: "#a44d32", gris: "#8d979b", blanco: "#e6e8e3" };
const IRIS = { cafe: "#533b30", verde: "#416e5c", azul: "#426c93" };
export const MANUAL_AVATAR_SWATCHES = { piel: SKIN, colorPelo: HAIR, colorOjos: IRIS } as const;

export function parseManualAvatarConfig(value: unknown): ManualAvatarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== MANUAL_AVATAR_VERSION || Object.keys(source).length !== KEYS.length + 1) return null;
  for (const key of KEYS) if (!(MANUAL_AVATAR_OPTIONS[key] as readonly string[]).includes(source[key] as string)) return null;
  return { version: 1, ...Object.fromEntries(KEYS.map((key) => [key, source[key]])) } as ManualAvatarConfig;
}

export function randomManualAvatarConfig(random: () => number = Math.random): ManualAvatarConfig {
  const selection = Object.fromEntries(KEYS.map((key) => {
    const values = MANUAL_AVATAR_OPTIONS[key];
    const sample = random();
    const index = Number.isFinite(sample) ? Math.min(values.length - 1, Math.max(0, Math.floor(sample * values.length))) : 0;
    return [key, values[index]];
  }));
  return { version: 1, ...selection } as ManualAvatarConfig;
}

function hairSvg(c: ManualAvatarConfig, fill: string) {
  switch (c.pelo) {
    case "sinPelo": return "";
    case "rapado": return `<path d="M67 103Q67 48 128 49Q189 48 189 103" fill="none" stroke="${fill}" stroke-width="9"/>`;
    case "medio": return `<path d="M61 118Q53 47 127 43Q199 44 195 117L187 162L173 153L176 105Q128 83 77 105L80 153L66 161Z" fill="${fill}"/>`;
    case "peinado": return `<path d="M64 108Q55 50 109 43Q160 30 191 83L192 111Q174 83 156 84Q109 84 72 105Z" fill="${fill}"/>`;
    case "ondulado": return `<path d="M61 111Q48 67 79 57Q91 38 111 49Q135 34 154 49Q183 42 196 86L192 123Q179 101 168 95Q151 87 137 96Q121 82 108 95Q88 80 69 111Z" fill="${fill}"/>`;
    case "rizado": return `<path d="M65 113Q49 65 81 57Q91 33 114 44Q144 29 158 48Q190 43 193 82Q204 105 187 115Q172 83 151 80Q104 78 72 109Z" fill="${fill}"/><g fill="${fill}"><circle cx="75" cy="75" r="18"/><circle cx="102" cy="55" r="17"/><circle cx="134" cy="52" r="18"/><circle cx="163" cy="63" r="18"/><circle cx="185" cy="83" r="15"/></g>`;
    case "largo": return `<path d="M62 110Q54 41 127 43Q200 42 194 110L201 200L177 211L175 100Q128 85 78 100L76 211L54 199Z" fill="${fill}"/>`;
    default: return `<path d="M63 112Q54 46 125 43Q198 39 193 111Q172 83 151 82Q109 82 75 105Z" fill="${fill}"/>`;
  }
}

export function manualAvatarSvg(config: ManualAvatarConfig): string {
  const c = parseManualAvatarConfig(config);
  if (!c) throw new Error("Configuracion de avatar invalida");
  const skin = SKIN[c.piel], hair = HAIR[c.colorPelo], iris = IRIS[c.colorOjos];
  const face = c.rostro === "redondo" ? "M67 110Q67 62 128 63Q189 62 189 110L189 155Q188 205 128 207Q68 205 67 155Z"
    : c.rostro === "cuadrado" ? "M69 107Q68 62 128 62Q188 62 187 107L183 184Q178 211 128 211Q78 211 73 184Z"
      : "M69 106Q69 61 128 61Q187 61 187 106L185 155Q181 205 128 216Q75 205 71 155Z";
  const shirt = c.persona === "deportivo" ? "#154955" : c.persona === "clasico" ? "#a07945" : "#176346";
  const eyeY = c.ojos === "sonrientes" ? 140 : 137;
  const eyes = c.ojos === "sonrientes"
    ? `<path d="M89 143Q100 132 111 143M145 143Q156 132 167 143" fill="none" stroke="${iris}" stroke-width="4" stroke-linecap="round"/>`
    : `<g fill="#fff"><ellipse cx="100" cy="${eyeY}" rx="11" ry="${c.ojos === "redondos" ? 9 : 6}"/><ellipse cx="156" cy="${eyeY}" rx="11" ry="${c.ojos === "redondos" ? 9 : 6}"/></g><g fill="${iris}"><circle cx="101" cy="${eyeY}" r="5"/><circle cx="157" cy="${eyeY}" r="5"/></g><g fill="#252b2a"><circle cx="101" cy="${eyeY}" r="2"/><circle cx="157" cy="${eyeY}" r="2"/></g>`;
  const brows = c.cejas === "arqueadas" ? "M88 119Q99 108 112 119M144 119Q157 108 169 119"
    : c.cejas === "marcadas" ? "M87 119L111 116M145 116L169 119" : "M88 119Q100 115 111 118M145 118Q157 115 168 119";
  const nose = c.nariz === "pequena" ? "M127 147L124 163L131 165" : c.nariz === "ancha" ? "M126 144L121 164Q128 169 136 164" : "M127 144L125 164L133 166";
  const mouth = c.boca === "neutra" ? "M112 183Q128 184 144 183" : c.boca === "amplia" ? "M105 178Q128 204 151 178" : "M110 181Q128 195 146 181";
  const mustache = `<path d="M126 173Q113 167 105 177Q117 185 128 178Q139 185 151 177Q143 167 130 173Z" fill="${hair}"/>`;
  const beard = c.barba === "sombra" ? `<path d="M85 174Q85 204 128 210Q171 204 171 174Q155 208 128 209Q101 208 85 174" fill="${hair}" opacity=".32"/>`
    : c.barba === "corta" ? `<path d="M84 174Q85 209 128 219Q171 209 172 174Q156 198 128 206Q100 198 84 174" fill="${hair}" opacity=".88"/>`
      : c.barba === "media" ? `<path d="M82 165Q82 216 128 226Q174 216 174 165L164 197Q145 220 128 218Q111 220 92 197Z" fill="${hair}"/>`
        : c.barba === "completa" || c.barba === "barbaBigote" ? `<path d="M78 154Q76 221 128 234Q180 221 178 154L169 191Q149 219 128 224Q107 219 87 191Z" fill="${hair}"/>${c.barba === "barbaBigote" ? mustache : ""}`
          : c.barba === "perilla" ? `<path d="M109 186Q128 192 147 186L143 217Q128 229 113 217Z" fill="${hair}"/>`
            : c.barba === "bigote" ? mustache : "";
  const accessory = c.accesorio === "lentes" ? `<g fill="none" stroke="#293b37" stroke-width="4"><circle cx="100" cy="139" r="17"/><circle cx="156" cy="139" r="17"/><path d="M117 136Q128 132 139 136M83 137L67 133M173 137L189 133"/></g>`
    : c.accesorio === "lentesSol" ? `<g fill="#293b37" stroke="#1b3028" stroke-width="3"><rect x="83" y="124" width="34" height="27" rx="9"/><rect x="139" y="124" width="34" height="27" rx="9"/><path d="M117 134Q128 130 139 134M83 134L66 130M173 134L190 130" fill="none"/></g>`
      : c.accesorio === "visera" ? `<path d="M66 95Q126 83 190 95L191 104Q128 97 65 105Z" fill="#1d744e"/><path d="M73 101Q127 95 183 101Q176 116 128 115Q90 114 73 101" fill="#11513b"/>`
    : c.accesorio === "gorra" ? `<path d="M64 94Q74 48 128 50Q182 48 193 94L198 104Q127 89 60 106Z" fill="#1d744e"/><path d="M80 99Q127 88 185 99Q176 118 128 114Q92 115 80 99" fill="#11513b"/>`
      : c.accesorio === "gorraGolf" ? `<path d="M64 94Q74 48 128 50Q182 48 193 94L198 104Q127 89 60 106Z" fill="#f1f0e5"/><path d="M78 96Q128 84 187 96L187 102Q128 91 78 102Z" fill="#176346"/><path d="M80 102Q127 94 185 102Q176 119 128 115Q92 115 80 102" fill="#deded1"/>`
      : c.accesorio === "aretes" ? `<g fill="#e3b55b"><circle cx="69" cy="164" r="5"/><circle cx="187" cy="164" r="5"/></g>` : "";
  const metadata = btoa(JSON.stringify(c));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Avatar Backyard"><metadata id="backyard-avatar-config">${metadata}</metadata><defs><clipPath id="circle"><circle cx="128" cy="128" r="128"/></clipPath></defs><g clip-path="url(#circle)"><rect width="256" height="256" fill="#dcece2"/><circle cx="128" cy="106" r="101" fill="#c6dfcf"/><path d="M25 266Q33 223 86 217L128 235L170 217Q223 223 231 266Z" fill="${shirt}"/><path d="M112 202L112 225Q128 244 144 225L144 202Z" fill="${skin}"/>${hairSvg(c, hair)}<path d="${face}" fill="${skin}" stroke="#503d36" stroke-opacity=".18" stroke-width="2"/><ellipse cx="70" cy="151" rx="9" ry="17" fill="${skin}"/><ellipse cx="186" cy="151" rx="9" ry="17" fill="${skin}"/>${hairSvg(c, hair)}<path d="${brows}" fill="none" stroke="${hair}" stroke-width="${c.cejas === "marcadas" ? 5 : 3}" stroke-linecap="round"/>${eyes}<path d="${nose}" fill="none" stroke="#754c3e" stroke-opacity=".52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${beard}<path d="${mouth}" fill="none" stroke="#884b48" stroke-width="3" stroke-linecap="round"/>${accessory}<path d="M117 234L128 249L139 234" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="3"/></g></svg>`;
}

const PREFIX = "data:image/svg+xml;base64,";
export function manualAvatarUrl(config: ManualAvatarConfig): string {
  return PREFIX + btoa(manualAvatarSvg(config));
}

/** Exact canonical re-render is the acceptance gate: arbitrary SVG is never trusted. */
export function parseManualAvatarUrl(value: unknown): ManualAvatarConfig | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX) || value.length > 30_000 || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const svg = atob(value.slice(PREFIX.length));
    const match = svg.match(/<metadata id="backyard-avatar-config">([A-Za-z0-9+/]+={0,2})<\/metadata>/);
    if (!match) return null;
    const config = parseManualAvatarConfig(JSON.parse(atob(match[1])));
    return config && manualAvatarUrl(config) === value ? config : null;
  } catch { return null; }
}
