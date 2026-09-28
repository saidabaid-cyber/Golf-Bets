import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES } from "./local-rules";
import { findNavigableRule } from "./rules-navigation";
import { expandedRulesSearchTerms, normalizeRulesSearch, rulesSearchContains } from "./rules-search-normalization";
import { searchRulesCorpus } from "./rules-search";
import type { LocalRule } from "./types";

export type RulesEvidence = {
  id: string;
  rule: string;
  title: string;
  excerpt: string;
  source: string;
  sourceId: string;
  sourceUrl?: string;
  page?: number;
  local: boolean;
};

export type RulesEvidenceResult = {
  evidence: RulesEvidence[];
  sufficient: boolean;
};

export function isLaVistaRulesContext(courseName: string, question: string) {
  const activeCourse = courseName.trim();
  if (activeCourse) return isLaVistaCourse(activeCourse);
  return /\bla\s+vista(?:\s+temporal)?\b/i.test(question);
}

function canonicalEvidenceExcerpt(entry: { rule: string; explanation: string }) {
  const ruleReference = /^\d{1,2}(?:\.\d+){0,2}[a-z]?(?:\(\d+\))?$/i.test(entry.rule.trim())
    ? findNavigableRule(entry.rule)
    : undefined;
  const fragments = [
    entry.explanation,
    ruleReference?.section?.summary ? `PROCEDIMIENTO: ${ruleReference.section.summary}` : undefined,
    ruleReference?.section?.penalty ? `PENALIDAD: ${ruleReference.section.penalty}` : undefined,
    ruleReference?.chapter.summary ? `RESUMEN: ${ruleReference.chapter.summary}` : undefined,
    ruleReference?.chapter.allows ? `PERMITIDO: ${ruleReference.chapter.allows}` : undefined,
    ruleReference?.chapter.forbids ? `NO PERMITIDO: ${ruleReference.chapter.forbids}` : undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  return fragments.filter((value, index) => fragments.indexOf(value) === index).join(" ");
}

function localRuleEvidence(question: string, localRules?: LocalRule[]): RulesEvidence[] {
  const normalizedQuestion = normalizeRulesSearch(question);
  const terms = expandedRulesSearchTerms(question);
  const requestedHoles = Array.from(question.matchAll(/\b(?:hoyo|h)\s*(1[0-8]|[1-9])\b/gi), match => Number(match[1]));
  const rules = activeLocalRules(Array.isArray(localRules) ? localRules : LA_VISTA_LOCAL_RULES);
  return rules
    .map(rule => {
      const haystack = normalizeRulesSearch([rule.title, rule.text, rule.hole ? `hoyo ${rule.hole}` : ""].join(" "));
      const score = (normalizedQuestion && rulesSearchContains(haystack, normalizedQuestion) ? 20 : 0)
        + terms.reduce((sum, term) => sum + (rulesSearchContains(haystack, term) ? 3 : 0), 0)
        + (rule.hole && requestedHoles.includes(rule.hole) ? 30 : 0);
      return { rule, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ rule }) => ({
      id: `local-${rule.id}`,
      rule: rule.hole ? `Regla Local · Hoyo ${rule.hole}` : "Regla Local",
      title: rule.title,
      excerpt: rule.text,
      source: "Reglas Locales · La Vista",
      sourceId: "la-vista-local",
      local: true,
    } satisfies RulesEvidence));
}

export function retrieveRulesEvidence({
  question,
  courseName,
  localRules,
  limit = 10,
}: {
  question: string;
  courseName: string;
  localRules?: LocalRule[];
  limit?: number;
}): RulesEvidenceResult {
  const evidenceTerms = expandedRulesSearchTerms(question).filter(term => term.length > 2 || /^\d+(?:\.\d+)*$/.test(term));
  const general = searchRulesCorpus(question, Math.max(limit * 2, 12))
    .filter(entry => {
      const haystack = normalizeRulesSearch([entry.rule, entry.title, entry.explanation, entry.source].join(" "));
      return evidenceTerms.some(term => rulesSearchContains(haystack, term));
    })
    .map(entry => ({
      id: entry.id,
      rule: entry.rule,
      title: entry.title,
      // The compact navigation corpus carries canonical procedure/penalty
      // summaries that are not always repeated in a search-result synopsis.
      // Include them in the evidence sent to the provider and validator so a
      // penalty cannot be accepted merely because the chapter number matches.
      excerpt: canonicalEvidenceExcerpt(entry),
      source: entry.source,
      sourceId: entry.sourceId,
      sourceUrl: entry.sourceUrl,
      page: entry.page,
      local: false,
    } satisfies RulesEvidence));
  const local = isLaVistaRulesContext(courseName, question) ? localRuleEvidence(question, localRules) : [];
  const seen = new Set<string>();
  const evidence = [...local, ...general].filter(entry => {
    const identity = `${entry.sourceId}:${entry.page || ""}:${entry.rule}:${entry.title}:${entry.excerpt}`;
    if (!entry.excerpt.trim() || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, Math.max(1, limit));
  return { evidence, sufficient: evidence.length > 0 };
}

export function formatRulesEvidence(evidence: RulesEvidence[]) {
  return evidence.map((entry, index) => [
    `[E${index + 1}]`,
    `FUENTE: ${entry.source}`,
    `REGLA: ${entry.rule || "Referencia general"}`,
    entry.page ? `PÁGINA: ${entry.page}` : "",
    entry.sourceUrl ? `ENLACE: ${entry.sourceUrl}` : "",
    `TÍTULO: ${entry.title}`,
    `FRAGMENTO: ${entry.excerpt.slice(0, 1600)}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}
