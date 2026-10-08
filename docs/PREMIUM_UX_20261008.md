# Corrección limitada de Feed, notificaciones y Scorecard

Base DEV: `fbaac2e13cd8d0d5ea85a59c97a9d47715e5bc0a`.
Checkpoint: `checkpoint/premium-ux-20261008`.
Trabajo aislado: `fix/premium-ux-20261008`; integración normal tras validación.

Las notificaciones sociales anteriores no conservaban el actor. Mongas tenía
desactivados el control general y los avisos sociales desde el 5 de octubre.
Se preservan sus elecciones. No se fabrican eventos retroactivos de reacciones
recibidas mientras los avisos estaban desactivados. La migración aditiva conserva
el historial y recupera metadatos sólo mediante coincidencias exactas y únicas.
El destinatario mantiene RLS y únicamente puede modificar `read_at`.

La retirada de «Continuar ronda» afecta sólo al render de Inicio/Feed.
PLAY, recuperación, almacenamiento y sincronización permanecen intactos.

## Pendiente futuro de PLAY (fuera de esta implementación)

Al iniciar con una ronda activa, ofrecer Continuar / Nueva ronda / Cancelar,
conservando la ronda existente. No se añade aquí ningún modal, ruta o lógica.

La demo usa la Scorecard y el editor existentes, exclusivamente en memoria.
No publica, sincroniza, crea historial ni modifica índices. La ruta remota se
restringe en servidor a DEV y cuentas QA autorizadas, sin acceso en Production.
