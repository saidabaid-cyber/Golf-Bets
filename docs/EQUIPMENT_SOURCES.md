# Fuentes del catálogo de equipo

El catálogo es multi-source y se importa a snapshots versionados. La app no hace scraping ni descarga una fuente externa por cada usuario.

## forgiving.golf

- Dataset: `https://forgiving.golf/api/v1/latest.json`
- Documentación y atribución: `https://forgiving.golf/data`
- Licencia declarada: CC BY 4.0
- Snapshot: `data/forgiving-golf-equipment.snapshot.json`
- Pipeline: `scripts/import-equipment-source.mjs`
- Cobertura: drivers, fairways, híbridos, sets de fierros y putters presentes en el dataset. Los complete sets se omiten porque el modelo canónico guarda cada bastón/set, no bolsas empaquetadas.
- Limitaciones: no es un catálogo histórico completo; algunos registros no publican mano, loft, varilla o flex. Esos registros/campos se omiten o quedan `null`, nunca se adivinan.

El snapshot conserva el ID externo, URL original del fabricante, fecha de verificación, fecha de importación y licencia. La atribución debe mantenerse al redistribuir el snapshot o sus derivados.

Actualizar desde red:

```text
node scripts/import-equipment-source.mjs
```

Validar un archivo descargado sin red:

```text
node scripts/import-equipment-source.mjs --input ruta/al/latest.json
```

## Seeds internos con fuente oficial

- `data/golf-club-catalog.seed.json`
- `data/golf-shaft-catalog.seed.json`
- `data/golf-ball-catalog.seed.json`
- `data/golf-equipment-catalog.expansion.seed.json`

Las entradas existentes usan ficha oficial del fabricante cuando está disponible. Un retailer autorizado sólo puede usarse cuando la ficha oficial no es utilizable. Los datos desconocidos permanecen `null`.

## Identidad y deduplicación

La identidad canónica actual es categoría + marca normalizada + modelo normalizado. Los seeds internos tienen prioridad sobre un import externo equivalente. El año/generación permanece en el registro y deberá incorporarse a la llave sólo cuando una misma categoría publique dos generaciones activas con el mismo nombre.

## Proveedores futuros

La UI consume `EquipmentCatalogProvider`, por lo que un catálogo en Supabase o una API licenciada debe implementar búsqueda/paginación y entregar el mismo modelo normalizado. Un proveedor nuevo no puede quitar la captura manual `Mi bastón no aparece` ni convertir campos ausentes en datos inferidos.
