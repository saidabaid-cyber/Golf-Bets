# The Backyard brand assets

Assets de producción derivados exclusivamente del PDF maestro local de `brand-source/`:

- `the-backyard-logo.svg`: primera opción, conservando los paths vectoriales del PDF.
- `the-backyard-logo.png`: fallback RGBA con fondo transparente.

El maestro se mantiene local e ignorado por Git. Para regenerar ambos assets usa
`scripts/export-brand-logo.py` con el runtime de Python del workspace.
