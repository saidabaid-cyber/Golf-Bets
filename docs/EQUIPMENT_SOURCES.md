# Fuentes del catálogo de equipo

El catálogo es multi-source y se importa a snapshots versionados. La app no hace scraping ni descarga una fuente externa por cada usuario.

## Backyard Equipment Master 2010–2026

- Paquete recibido: `backyard_equipment_catalog_package_2010_2026.zip`
- SHA-256 del paquete: `570D46614DB1213E71EF126710C736A7B3876EBFB28B95523F0AC59AD3D1BD36`
- Snapshot canónico generado: `data/backyard-equipment-master-2010-2026.snapshot.json`
- Pipeline reproducible: `scripts/import-equipment-master-2010-2026.mjs`
- Registros fuente aceptados: 1,202 familias de bastones y 285 generaciones de bolas; cero filas rechazadas.
- Cobertura: 2010–2026, incluidos modelos actuales y anteriores que siguen siendo utilizables en Mi Bolsa o en históricos.
- Licencias/términos: se conservan por registro según `source_type`, `source_url` y `license`. `OPEN_DATA_CC_BY_4_0` conserva CC BY 4.0; las fichas OEM y archivos secundarios se mantienen como evidencia/procedencia y no reciben una licencia abierta inventada.
- Limitación importante: 21 bolas venían marcadas para fitting sin ningún atributo técnico comparable. Permanecen `bagEligible`, pero el importador las deja fuera de Ball Fit. Sólo 53 registros del master alcanzan cobertura técnica mínima trazable.

Actualizar el snapshot desde una copia local verificada del paquete:

```text
node scripts/import-equipment-master-2010-2026.mjs <directorio-del-paquete> data/backyard-equipment-master-2010-2026.snapshot.json
```

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

La identidad canónica de bastones es categoría + marca normalizada + modelo normalizado + año/generación; la de bolas es marca + modelo + año/generación. La normalización conserva diferencias funcionales como Plus, Max, LS/LST, SFT, HD, Tour, Pro, X, Triple Diamond y Sub Zero. Los datos internos verificados tienen prioridad y el merge campo-por-campo no reemplaza un dato existente con `null`. Las fuentes equivalentes quedan reunidas en `provenance` y sus IDs anteriores se conservan como aliases.

## Proveedores futuros

La UI consume `EquipmentCatalogProvider`, por lo que un catálogo en Supabase o una API licenciada debe implementar búsqueda/paginación y entregar el mismo modelo normalizado. Un proveedor nuevo no puede quitar la captura manual `Mi bastón no aparece` ni convertir campos ausentes en datos inferidos.
