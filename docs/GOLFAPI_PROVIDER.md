# Proveedor GolfAPI para campos

La app consume el contrato `CourseCatalogProvider` de `lib/course-catalog-provider.ts`. El proveedor interno actual permanece operativo. El adaptador GolfAPI normaliza clubes, campos, tees, hoyos, par, stroke index, yardas, rating, slope y coordenadas sin acoplar la UI al formato externo.

## Estado de Phase 1

El adaptador está probado con fixtures e inyección de transporte. Falla cerrado con `not_configured` cuando no existe una credencial autorizada: no muestra resultados ficticios ni sustituye el catálogo local.

## Activación controlada

1. Contratar o confirmar una licencia que cubra el uso previsto y el almacenamiento permitido.
2. Guardar la API key sólo como secreto del entorno servidor correspondiente.
3. Implementar el transporte HTTP en la capa de servidor e inyectarlo en `createGolfApiCourseCatalogProvider`.
4. Respetar límites, atribución, caché y restricciones de redistribución del contrato vigente.
5. Importar o cachear en un entorno aislado antes de habilitarlo para Beta.
6. Ejecutar los tests del normalizador y validar manualmente club → campo → tee.

No se debe ejecutar scraping de GHIN/USGA ni exponer la credencial al navegador. Activar el proveedor sin acceso/licencia real sigue clasificado como `BLOCKED_EXTERNAL_GOLF_API`.
