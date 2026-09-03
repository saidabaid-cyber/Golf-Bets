import { buildRulesPdfIndex } from "./rules-pdf-index.mjs";

buildRulesPdfIndex().then(({ entries, report }) => {
  console.log(`Índice generado: ${entries.length} páginas buscables.`);
  console.log(`Cobertura: ${report.totals.indexedPages}/${report.totals.totalPages} (${report.totals.coveragePercent}%).`);
}).catch((error) => {
  console.error(`No fue posible generar el índice PDF: ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exitCode = 1;
});
