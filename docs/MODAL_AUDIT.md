# Auditoría de salida de modales

Fecha: 2026-09-10. Rama: `phase2/full-platform`.

Regla: las 27 instancias declaradas con semántica de diálogo tienen una salida visible de 44 × 44 px dentro del safe area; `Escape` cierra cuando no existe una operación crítica en curso. Ball Fit conserva su borrador mediante el autosave existente y regresa al panel de Equipo que lo abrió.

Componentes auditados:

- Ball Fit y resultado guardado: `ModalCloseButton` compartido.
- Editor de bastón, bola y distancia: `ModalCloseButton` compartido.
- Vincular GHIN (informativo): `ModalShell` compartido.
- Consentimiento de procesamiento AI: `ModalCloseButton` compartido.
- Migración de datos de cuenta: `ModalCloseButton` compartido, deshabilitado sólo durante la escritura activa.
- Eliminación de cuenta: `ModalCloseButton` compartido, deshabilitado durante la eliminación.
- Guardado de grupos: `ModalCloseButton` compartido.
- Confirmaciones, validación, configuración de hoyo y editores de `app/page.tsx`: `ModalCloseButton` compartido.
- Visor PDF: `ModalCloseButton` compartido además del regreso contextual.
- Consentimiento financiero: X existente y `Escape`.
- Ayuda de apuestas: X existente y `Escape`.
- Resumen temporal de hoyo: X existente con semántica específica de cerrar/avanzar.

El componente canónico está en `app/components/modal-shell.tsx`; `app/globals.css` define tamaño táctil, foco y safe area.
