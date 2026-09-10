# Catálogo de equipo de The Backyard

La UI consume `EquipmentCatalogProvider`; no importa archivos seed directamente. El proveedor actual usa datos internos versionados y puede sustituirse después por Supabase o una API comercial sin cambiar los editores.

## Archivos

- `data/golf-club-catalog.seed.json`, `data/golf-shaft-catalog.seed.json` y `data/golf-ball-catalog.seed.json`: catálogo base.
- `data/golf-equipment-catalog.expansion.seed.json`: expansión verificada de Beta.
- `data/forgiving-golf-equipment.snapshot.json`: snapshot importado con licencia y procedencia por registro.
- `scripts/import-equipment-source.mjs`: importador validado, normalizador y deduplicable de fuentes externas autorizadas.
- `lib/golf-equipment-catalog.ts`: normalización y proyección idempotente.
- `lib/equipment-catalog-provider.ts`: contrato de búsqueda, paginación y alcance del Ball Fit.
- `/api/catalog/equipment`: endpoint de lectura para los selectores.

La matriz de licencias, cobertura y actualización está en `docs/EQUIPMENT_SOURCES.md`.

## Agregar un bastón, varilla o bola

1. Confirma el modelo en el sitio oficial del fabricante. Usa un distribuidor autorizado sólo si la ficha oficial no existe.
2. Crea un `id` slug estable y no lo reutilices.
3. Guarda marca, modelo, categoría/generación y únicamente especificaciones publicadas.
4. Para cualquier dato no verificable usa `null`; nunca deduzcas compresión, torque, peso o rendimiento.
5. Guarda `officialUrl`, `sourceName`, `verifiedAt`, `createdAt` y `updatedAt`.
6. Para bolas con compresión numérica, conserva además la fuente específica de esa cifra. Si sólo existe un rango, no lo conviertas en un número promedio.
7. Ejecuta los tests de normalización, fuentes, filtros y proyección antes de publicar.

## Reglas de UX

Los selectores siguen Categoría → Marca → Modelo → Varilla. Siempre ofrecen “No sé”, “Mi bastón no aparece” y “Omitir”. Para sets de fierros se conservan paquetes rápidos y una composición libre de 3 a LW, incluidos wedges por grados.

Las tarjetas de bola muestran sólo atributos verificados y dicen “Sin dato verificado” cuando falta evidencia. El Ball Fit evalúa el catálogo activo completo en servidor; nunca rankea silenciosamente una primera página incompleta.

## Cambio de proveedor

Implementa `EquipmentCatalogProvider.search()` y `loadBallFitCatalog()`. Mantén:

- paginación y límite acotado;
- búsqueda normalizada;
- IDs guardados resolubles aunque queden archivados;
- procedencia por registro;
- snapshot inmutable en el perfil y el histórico;
- fallo cerrado si el Ball Fit no recibió el universo completo de candidatos.
