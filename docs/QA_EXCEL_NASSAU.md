# QA Excel / Nassau — codex-dev

Base comprobada limpia: `3e6da095c798b1b5de6623d0f85da936707ff07c`.

Cambios acotados: referencia técnica del libro, Nassau cronológico con carry independiente y aditivo, bruto/neto auditable, migración de borradores, restauración del snapshot HCP del rival externo, Monkey según fórmulas originales, valor de Copa separado y carry visible correcto en resumen de hoyo.

La suite anterior no se tomó como fuente de verdad: primero se escribieron los casos reales, se observaron4 fallos (tres rivales y agregado), después se corrigió el motor. Se conservan pruebas anteriores salvo actualización explícita de la expectativa incorrecta de presión física Personal.

Fuente y límites: `EXCEL_BETTING_REFERENCE.md`. Las diferencias abiertas allí enumeradas NO están certificadas como equivalencia1:1.

Prueba de navegador real: UI móvil390/430, ronda completa5 jugadores/90 scores, cuatro Personales,9 matches Foursome, Monkey, recarga, cierre/reapertura, Cómo Vamos, Resultados, histórico. Total transferencias0 y datos previos de QA conservados. El storage del usuario enlocalhost3000 no fue modificado por la prueba. Agent-browser CLI no está instalado; se utilizó el navegador conectado con DOM, capturas y logs.

Validación final local: `npm run lint` aprobado sin avisos; `npm test` **244/244 aprobados,0 fallidos**; `npm run build` aprobado (Next16.3.4, TypeScript y17 páginas estáticas). Sin dependencias nuevas ni cambios de Auth, Supabase, Reglas o Polla Live.

Revisión previa a publicación: `.env.local`, `rules-source/` y extracción privada ignorados; ningún XLSX trackeado; sin claves privadas detectadas por los patrones revisados. Producción sigue en `09de83f69ad80116fda83abb4abd1e0a08660ef1`/main. Solo se autoriza push explícito de `codex-dev:codex-dev`, nunca main.

El Preview y SHA final se reportan en la conversación tras verificarse READY; no se promociona a producción. Las diferencias pendientes del documento de referencia siguen abiertas: este resultado no es una certificación total de todas las configuraciones del Excel.
