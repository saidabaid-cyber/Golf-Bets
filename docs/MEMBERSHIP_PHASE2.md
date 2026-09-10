# Membresías — contrato preparado para Phase 2

Esta documentación no activa pagos, límites, paywalls ni precios. Durante Beta todos los testers se consideran `BETA_PRO` y conservan acceso completo.

## Identificadores estables

- `FREE`: futura experiencia gratuita.
- `PRO`: futura experiencia ampliada.
- `BETA_PRO`: acceso completo durante Beta, sin cobro.

El contrato vive en `lib/membership-entitlements.ts`. Phase 1 no lo usa para bloquear funciones.

## Presentación futura

La comparación podrá usar secciones colapsables con columnas Free y Pro. La referencia es el patrón de lectura, no el diseño de otro producto.

### Scoring & Stats

Free incluye scoring, estadísticas básicas y scores de amigos. Pro podrá incluir estadísticas avanzadas, insights y analítica ampliada.

### Games

Free podrá ofrecer una selección de juegos básicos y leaderboards básicos. Pro podrá incluir el catálogo completo, juegos simultáneos, presiones y configuraciones avanzadas.

### AI

Free podrá incluir una asignación mensual y pruebas limitadas de Card AI. Pro podrá ampliar ese uso bajo una política de uso justo e incluir personalización.

### Equipment

Mi Bolsa permanece en Free. Ball Fit, Launch Monitor AI y recomendaciones avanzadas podrán pertenecer a Pro.

### GPS y Handicap

La información básica de campos, índice manual y Course Handicap permanecen disponibles. Mapas avanzados e integraciones autorizadas podrán pertenecer a Pro cuando existan acuerdos. Nunca se hará scraping de GHIN/USGA ni se presentará un índice interno como oficial.

## Reglas antes de activarlo

1. Definir producto y precio fuera del código.
2. Diseñar grace periods, restauración de compra y estados de fallo.
3. Añadir telemetría sin PII innecesaria.
4. Mantener score, datos, exportación y documentos legales accesibles.
5. Probar que un entitlement nunca modifica el motor determinístico ni resultados históricos.
