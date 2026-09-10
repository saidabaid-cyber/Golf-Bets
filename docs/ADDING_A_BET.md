# Cómo agregar una apuesta a The Backyard

La regla principal es invariable: la IA interpreta, el dominio valida y el motor determinístico calcula. Una definición del registro no calcula dinero y nunca reemplaza a `lib/engine.ts`, `lib/side-bets.ts` ni `lib/supplemental-bets.ts`.

## 1. Definir la modalidad

Agrega una única entrada a `lib/bets/registry.ts` con:

- `id` y `version` estables;
- nombre, descripción e icono visibles;
- categoría y ruta de configuración;
- capacidades editables (monto, participantes, HCP, carry, presión, equipos o segmentos);
- requisitos de captura;
- nombre del adaptador del motor y presentador de resultados;
- aliases que la IA puede reconocer;
- `historyVersion`.

No reutilices un ID histórico para reglas diferentes. Si cambia la interpretación de resultados, incrementa la versión y agrega una migración de lectura compatible.

## 2. Configuración y validación

Extiende el tipo canónico de configuración existente. La UI debe componer los controles reutilizables (`MoneyField`, selector de participantes, base de handicap, carry, presión y segmentos) y permitir activar, desactivar, editar y quitar la modalidad sin perder el resto del draft.

La validación pertenece al dominio. Campos vacíos o borradores incompletos no pueden llegar al motor como ceros inventados.

## 3. Captura

Declara en `captureRequirements` únicamente hechos de golf:

- `requiresScore` siempre es verdadero;
- `requiresPutts` sólo cuando el juego realmente depende de putts;
- `optionalFacts` para bunker, área de penalidad, OB o unidades.

`lib/bets/capture-requirements.ts` combina las modalidades activas para cada jugador y hoyo. Los eventos opcionales sin tocar equivalen a cero; no se exige “confirmar cero”. Un hecho se captura una vez y se deriva para la apuesta (por ejemplo, bunkers → Camellos).

## 4. Motor y resultados

Conecta la definición a una función determinística existente o agrega una función testeada al motor apropiado. El adaptador recibe estructuras validadas y devuelve balances de suma cero. La IA no recibe autoridad para generar ganadores, balances o liquidaciones.

Agrega el presentador a resultados e histórico. Los snapshots deben conservar la versión y suficientes datos para que un cambio futuro de catálogo no altere rondas pasadas.

## 5. IA

Los aliases del registro son el catálogo semántico. No dupliques una lista de nombres en la UI. El parser puede proponer la modalidad, pero el validador canónico debe rechazar montos, participantes o reglas inexistentes.

## 6. Pruebas obligatorias

Antes de integrar:

1. ID único, aliases sin colisiones y `historyVersion` definido.
2. Configuración nueva, edición, desactivación y restauración.
3. Participantes, base de HCP y porcentaje cuando apliquen.
4. Captura mínima y hechos opcionales.
5. Cálculo determinístico, suma cero y liquidación.
6. Snapshot/histórico legacy y actual.
7. Interpretación AI sin autoridad monetaria.
8. Mobile: controles táctiles, regreso y ningún botón silencioso.

Finalmente ejecuta `npm test`, `npm run lint` y `npm run build`.
