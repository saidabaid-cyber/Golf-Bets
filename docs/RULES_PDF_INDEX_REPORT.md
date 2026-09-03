# Cobertura del índice PDF de Reglas

El índice se genera fuera del iPhone. Primero usa la capa de texto; las páginas sin texto útil se renderizan y pasan por OCR Tesseract.js (`spa+eng`).

| Documento | Páginas | Texto normal | OCR procesadas | OCR indexadas | Total indexadas | Sin texto final | Cobertura |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Guía Oficial / Reglas de Golf — Parte 1 | 410 | 408 | 6 | 0 | 408 | 2 | 99.51% |
| Procedimientos del Comité / Parte 2 | 172 | 171 | 7 | 0 | 171 | 1 | 99.42% |
| Aclaraciones vigentes — Julio 2026 | 13 | 13 | 0 | 0 | 13 | 0 | 100% |

**Total:** 592/595 páginas indexadas (99.5%).

## Páginas sin texto final

- Guía Oficial / Reglas de Golf — Parte 1: páginas 22, 356 no contienen texto visible ni después de OCR.
- Procedimientos del Comité / Parte 2: páginas 2 no contienen texto visible ni después de OCR.

Las páginas sin texto final permanecen auditadas en el reporte JSON; no se inventa contenido para páginas realmente vacías.
