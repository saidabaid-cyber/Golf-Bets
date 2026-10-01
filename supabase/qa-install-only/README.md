# Variantes QA aprobadas — instalación sin reconciliación

Estas tres variantes fueron aprobadas expresamente y aplicadas exclusivamente a
`ADMIN MODE V2 QA` (`gvzeymebltssgjkvksxt`). No se ejecutaron funciones de cierre,
eliminación, anonimización, purge ni limpieza de cuentas.

Conservan funciones, estructura, triggers y controles. Omiten el bloque de
reconciliación histórica de round players, los dos backfills y la eliminación de
GHIN self-attested, y la limpieza de identidades huérfanas del dominio posterior.
El manifiesto identifica los originales por SHA-256 y los bloques omitidos.
Los originales del repositorio no se modificaron.

Estos archivos se guardan fuera de `supabase/migrations` deliberadamente. El
historial remoto de QA tiene versiones asignadas por MCP; no corresponde
directamente a los timestamps de archivos locales. Verificar equivalencias por
nombre, contenido y manifiesto antes de instalar en una nueva DB aislada.
No ejecutar un `db push` indiscriminado ni reaplicar los originales sustituidos.
No aplicar ninguna de estas variantes en DEV o Production.

La instalación de funciones no autoriza su ejecución destructiva. Esta fase
terminó con cero estados y cero jobs de account lifecycle en QA.
