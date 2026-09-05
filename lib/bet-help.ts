import type { SupplementalBet } from "./types";

export type BetHelpKind = SupplementalBet["type"] | "personal" | "personal_group" | "manual" | "rabbits" | "skins" | "units" | "foursome" | "ball_friend" | "monkey" | "polla" | "mini_polla" | "vipers" | "camels" | "fish" | "loba";

export type BetHelpSection = string | readonly string[];
export type BetHelpCopy = {
  title: string;
  what: BetHelpSection;
  how: BetHelpSection;
  rules: BetHelpSection;
  example: BetHelpSection;
};

export const BET_HELP: Record<BetHelpKind, BetHelpCopy> = {
  personal_group: {
    title: "↔ Personales",
    what: "Bloque de apuestas directas contra uno o más contrincantes, separado del Resumen General.",
    how: ["Agrupa Nassau individual, Dollar a Stroke y Presiones individuales.", "Cada modalidad conserva sus participantes, ventaja y valor pactados, y calcula su propio importe."],
    rules: ["Solo se atribuye un resultado a quien participa en esa apuesta.", "Los balances personales no se suman al Resumen General; sí aparecen en la liquidación completa."],
    example: "Contra Jugador B: Nassau +$200, Dollar a Stroke −$50 y Presiones +$100. Balance personal: +$250.",
  },
  personal: {
    title: "🏌️ Nassau individual",
    what: "Apuesta directa entre dos jugadores con componentes Match y Medal.",
    how: ["Compara primera vuelta, segunda vuelta y total de 18 hoyos según los componentes activados.", "Match cuenta hoyos ganados; Medal compara la suma de golpes ajustados."],
    rules: ["Usa únicamente la ventaja pactada entre esos dos jugadores; no añade el HCP general de la ronda.", "Cada componente se liquida por separado. El carry de un empate solo pasa al mismo tipo de componente."],
    example: "Jugador A gana Match de la primera vuelta y cobra el monto pactado; Medal puede terminar empatado y pagar $0.",
  },
  individual_nassau: {
    title: "🏌️ Nassau individual",
    what: "Apuesta directa entre Jugador A y Jugador B con componentes Match y Medal.",
    how: ["Compara primera vuelta, segunda vuelta y total de 18 hoyos según los componentes activados.", "Match cuenta hoyos ganados; Medal compara la suma de golpes ajustados."],
    rules: ["Usa la ventaja pactada entre la pareja y la distribuye por índice de ventaja.", "Cada componente se liquida por separado; el carry no mezcla Match con Medal."],
    example: "Jugador A gana Match de la primera vuelta por 2 hoyos y cobra el valor de ese componente a Jugador B.",
  },
  dollar_stroke: {
    title: "💵 Dollar a Stroke",
    what: "Apuesta entre dos jugadores donde cada golpe de diferencia ajustada vale una cantidad pactada.",
    how: ["Suma los scores de ambos jugadores y aplica únicamente la ventaja pactada entre ellos.", "Multiplica la diferencia final por el valor por golpe."],
    rules: ["No usa una ventaja automática ni añade el HCP general de la ronda.", "Solo participan la pareja configurada y el resultado es cero-sum."],
    example: "Jugador A 70, Jugador B 95 y 5 golpes para B: 70 contra 90. A $10 por golpe, A gana $200 y B pierde $200.",
  },
  individual_pressures: {
    title: "⚡ Presiones individuales",
    what: "Serie de enfrentamientos hoyo a hoyo entre cada pareja de participantes.",
    how: ["La presión abre en un hoyo y permanece abierta mientras empatan.", "Cuando uno obtiene mejor score neto, cierra esa presión y la siguiente comienza en el próximo hoyo."],
    rules: ["Aplica las ventajas y el porcentaje HCP configurado.", "El carry decide si una presión abierta continúa al cambiar de vuelta. El Match Play adicional, si se activa, se liquida aparte."],
    example: "Jugador A y B empatan H1; A gana H2. La presión H1–H2 paga el valor configurado a A y otra comienza en H3.",
  },
  team_pressures: {
    title: "🤝 Presiones por parejas",
    what: "Presiones entre equipos comparando Low Ball, High Ball o ambos.",
    how: ["Primero calcula el score neto de cada participante con su HCP configurado.", "La comparación elegida cierra una presión cuando un equipo supera al otro y abre la siguiente en el próximo hoyo."],
    rules: ["En 2 vs 2 cada integrante recibe o paga una participación.", "Con tres jugadores, Mudo aporta Par y Yo-Yo copia el score neto de su pareja. Los abandonos usan el score máximo configurado."],
    example: "Equipo A gana Low Ball en H3: cierra esa presión y cada integrante cobra el valor correspondiente.",
  },
  chicago: {
    title: "🌆 Chicago",
    what: "Apuesta individual que compara los puntos logrados contra una cuota personal.",
    how: ["Birdie o mejor, Par, Bogey y doble Bogey o peor otorgan los puntos configurados.", "La cuota es la base configurada menos el HCP del jugador después de aplicar el porcentaje HCP. Luego se comparan los balances contra cuota."],
    rules: ["El porcentaje HCP ajusta la cuota; no altera la tabla de puntos por score bruto.", "Cada diferencia contra otro participante se multiplica por el valor por punto y se liquida en suma cero."],
    example: "Jugador A queda +3 contra su cuota y Jugador B −2. La diferencia es 5; a $10 por punto, A gana $50 a B.",
  },
  vegas: {
    title: "🎲 Vegas",
    what: "Apuesta de parejas que forma un número de dos cifras con los scores netos de cada equipo.",
    how: ["Aplica ventajas y HCP %, ordena el score menor primero y concatena ambos: 4 y 5 forman 45.", "La diferencia entre los números son unidades y cada cruce ganador-perdedor paga el valor por unidad."],
    rules: ["Requiere exactamente cuatro participantes.", "Las parejas pueden ser fijas, rotar cada hoyo o por bloques. La penalidad birdie contra bogey, si está activa, invierte el número del equipo penalizado."],
    example: "Equipo A forma 45 y Equipo B 56: Equipo A gana 11 unidades.",
  },
  minimum_putts: {
    title: "⛳ Mínimo de Putts",
    what: "Pozo entre participantes que premia el menor total de putts brutos.",
    how: ["Suma los putts capturados en los 9 o 18 hoyos configurados.", "Cada perdedor aporta el ante y, si hay varios ganadores, ellos dividen el pozo."],
    rules: ["No utiliza HCP.", "Si todos terminan empatados, nadie paga."],
    example: "Tres perdedores aportan $50: el ganador con menos putts recibe un pozo de $150.",
  },
  manual: {
    title: "✍️ Apuestas Manuales",
    what: "Registro directo de una apuesta cuyo cálculo no está automatizado.",
    how: ["Escribe el importe positivo, negativo o cero de cada jugador.", "La app incorpora esos importes al resultado únicamente cuando la suma cierra en $0."],
    rules: ["No aplica HCP ni inventa un reparto.", "Debe haber cargos y abonos equivalentes para mantener una liquidación cero-sum."],
    example: "Jugador A +$300 y Jugador B −$300: la apuesta es válida y entra a la liquidación.",
  },
  rabbits: {
    title: "🐇 Conejos",
    what: "Apuesta de score neto donde un conejo se agarra, se defiende y finalmente se gana.",
    how: ["Un ganador neto único puede agarrar un conejo libre. Si vuelve a ser el único mejor, lo gana; si empata como mejor, lo conserva; si alguien lo supera, queda libre.", "En el tercer hoyo de la oportunidad, quien lo conserva entre los mejores lo gana; si estaba libre, lo gana el mejor neto único."],
    rules: ["Aplica las ventajas y el porcentaje HCP configurado.", "Conejos continuos inicia otro después de ganar y puede acumular una oportunidad sin ganador.", "6 Conejos usa los bloques H1–H3, H4–H6, H7–H9, H10–H12, H13–H15 y H16–H18: máximo uno por bloque y nada pasa al siguiente."],
    example: "En 6 Conejos, Jugador A gana el del bloque H1–H3 en H1. H2 y H3 ya no abren otro; el siguiente comienza en H4.",
  },
  skins: {
    title: "⛳ Skins",
    what: "Apuesta por hoyo donde el mejor score neto único gana el skin.",
    how: ["Aplica las ventajas y el porcentaje HCP configurado y compara a los participantes del hoyo.", "Acumulables pasa el valor de un empate al siguiente hoyo; No acumulables elimina ese skin y el siguiente vuelve a valer uno."],
    rules: ["Un empate no inventa ganador.", "Cada skin ganado cobra su valor a cada rival participante. En modo no acumulable, cada hoyo entrega como máximo un skin."],
    example: "H1 y H2 empatan; Jugador A gana H3. Recibe 3 skins en Acumulables o 1 en No acumulables.",
  },
  units: {
    title: "📏 Unidades / Copas",
    what: "Apuesta individual por eventos positivos y negativos acumulados durante la ronda.",
    how: ["La app detecta Birdie (+1), Eagle (+2), Albatros o HIO (+3) y suma las unidades manuales.", "Las Copas y otros eventos negativos se restan. Después compara el neto de cada pareja de jugadores."],
    rules: ["No utiliza HCP: los eventos automáticos se basan en el score bruto contra Par.", "Cada diferencia de unidades se multiplica por su valor; una Copa puede tener un valor distinto."],
    example: "Jugador A tiene 4 positivas y 1 negativa: su neto es +3. Ese neto se compara con el de cada rival.",
  },
  foursome: {
    title: "🤝 Foursome",
    what: "Apuesta por parejas que compara Low Ball y High Ball de cada hoyo.",
    how: ["Aplica las ventajas y HCP % a cada jugador, ordena los dos netos de cada pareja y compara el menor y el mayor.", "Cada comparación ganada vale un punto; un hoyo puede terminar de −2 a +2 para la pareja base."],
    rules: ["Las parejas pueden cambiar por tramos.", "La modalidad puede pagar un fijo por tramo, puntos/patada o ambos. La presión configurada multiplica únicamente la vuelta física elegida."],
    example: "Equipo A gana Low y empata High: suma +1 punto en ese hoyo.",
  },
  ball_friend: {
    title: "⚪🤝 Bola Amiga",
    what: "Apuesta entre dos parejas que forma un número con los dos scores netos de cada equipo.",
    how: ["Se eligen las parejas antes de capturar y se aplican las ventajas y HCP %.", "El score menor va primero; la diferencia entre ambos números produce los puntos del hoyo."],
    rules: ["Con cinco participantes, quien descansa queda fuera del cálculo de ese hoyo.", "Un birdie o mejor bruto voltea el número del equipo contrario. El score neto se limita al máximo configurado."],
    example: "Equipo A forma 45 y Equipo B 56: Equipo A obtiene 11 puntos, multiplicados por el valor por punto.",
  },
  monkey: {
    title: "🐒 Monkey",
    what: "Apuesta individual para 3 jugadores en la que cada hoyo reparte exactamente 6 puntos según el resultado neto de los tres jugadores.",
    how: ["En cada hoyo se comparan los scores después de aplicar las ventajas y el porcentaje de HCP configurado.", "Los 6 puntos se reparten según la posición: ganador claro y dos empatados, 4 / 1 / 1; tres posiciones diferentes, 4 / 2 / 0; los tres empatados, 2 / 2 / 2; dos empatados en primer lugar, 3 / 3 / 0.", "Al final se suman todos los puntos obtenidos durante la ronda."],
    rules: ["Siempre deben repartirse exactamente 6 puntos por hoyo.", "Se juega exclusivamente entre 3 jugadores.", "Los scores utilizados son netos, aplicando las ventajas y porcentaje HCP configurados."],
    example: "Said hace Par. Daniel Bogey. Pedro Doble Bogey. Resultado: Said 4 puntos, Daniel 2 puntos y Pedro 0 puntos.",
  },
  polla: {
    title: "🏆 Pollas",
    what: "Pozo Medal que premia el menor total neto del tramo configurado.",
    how: ["Aplica las ventajas y HCP % y suma los scores netos de los participantes.", "Cada jugador aporta el valor; quien tenga el total más bajo recibe el pozo."],
    rules: ["Polla H1–9, Polla H10–18 y Polla 18 hoyos son componentes independientes.", "Si hay empate en el mejor total, los ganadores dividen el pozo."],
    example: "Cuatro jugadores aportan $100. Jugador A tiene el menor neto y recibe $400: su balance neto es +$300.",
  },
  mini_polla: {
    title: "⚡ Mini Polla",
    what: "Pozo Medal de los últimos tres hoyos realmente jugados.",
    how: ["Aplica las ventajas y HCP % en esos tres hoyos y suma el score neto.", "Cada participante aporta el valor y el mejor total recibe el pozo."],
    rules: ["Usa el orden real de salida; si la ronda inicia en H10, los últimos tres jugados son H7–H9.", "Un empate divide el pozo."],
    example: "Jugador A termina los últimos tres hoyos con neto 11 y Jugador B con 12: A gana el pozo.",
  },
  vipers: {
    title: "🐍 Víboras",
    what: "Apuesta de putting en la que cada 3-putt o más genera una Víbora que se acumula durante la ronda.",
    how: ["Cada vez que un jugador hace 3 putts o más en un hoyo se agrega una Víbora a la bolsa.", "Todas las Víboras permanecen acumuladas hasta terminar la ronda."],
    rules: ["Se queda con todas las Víboras el jugador que haga el último 3-putt o más de la ronda.", "Si varios jugadores generan Víbora en ese mismo último hoyo, se las queda quien deje su último putt más cerca del hoyo.", "Quien se queda con las Víboras paga a cada rival el valor total acumulado."],
    example: "Se acumularon 3 Víboras de $100. Pedro hace la última. Pedro se queda con las 3 y paga $300 a cada uno de los demás jugadores.",
  },
  camels: {
    title: "🐫 Camellos",
    what: "Apuesta de bunker en la que cada Camello registrado se agrega a una bolsa acumulada.",
    how: ["Cada vez que ocurre la condición de Camello se suma uno.", "Los Camellos continúan acumulándose durante toda la ronda."],
    rules: ["El último jugador que genera un Camello se queda con todos los acumulados.", "Quien se queda con los Camellos paga a cada uno de los demás jugadores el valor total acumulado."],
    example: "Hay 4 Camellos de $100 acumulados. Daniel genera el último Camello de la ronda. Daniel se queda con los 4 y paga $400 a cada uno de los demás participantes.",
  },
  fish: {
    title: "🐟 Peces",
    what: "Apuesta relacionada con agua en la que cada Pez registrado se agrega a una bolsa acumulada.",
    how: ["Cada vez que ocurre la condición de Pez se suma uno.", "Todos los Peces permanecen acumulados durante la ronda."],
    rules: ["El último jugador que genera un Pez se queda con todos los Peces acumulados.", "Quien se los queda paga a cada uno de los demás jugadores el valor total acumulado."],
    example: "Se acumularon 2 Peces de $100. Said genera el último. Said se queda con los Peces y paga $200 a cada uno de los demás participantes.",
  },
  loba: {
    title: "🐺 Loba",
    what: "Apuesta por hoyo donde la Loba elige pareja o juega sola contra el resto.",
    how: ["Aplica las ventajas y HCP % y compara el mejor score neto del equipo de la Loba con el mejor de los contrarios.", "Con pareja vale 1x, sola 2x y sola anticipada 3x; el multiplicador de fuego aumenta el valor base del hoyo."],
    rules: ["La Loba, modalidad y pareja cuando corresponda se eligen antes de guardar el hoyo.", "Las unidades naturales y manuales se liquidan aparte; el fuego no las multiplica."],
    example: "La Loba juega sola por $100 y gana: a 2x cobra $200 a cada rival. Con 🔥3x cobraría $600 a cada rival.",
  },
};
