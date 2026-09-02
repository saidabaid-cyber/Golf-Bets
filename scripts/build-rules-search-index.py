"""Build the local, server-side Rules search index from the three private source PDFs.

The PDFs remain ignored by Git. Only normalized searchable text, page references and
official source identifiers are written to the generated JSON file.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import pypdfium2 as pdfium


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "rules-sources"
OUTPUT = ROOT / "lib" / "rules-search-index.generated.json"

SOURCES = (
    ("official-guide-part-1", "2023 Guia Oficial Golf pt1.pdf", "Guía Oficial / Reglas de Golf — Parte 1"),
    ("committee-procedures-part-2", "2023 Guia Oficial Golf pt2.pdf", "Procedimientos del Comité / Parte 2"),
    ("clarifications-july-2026", "Additional Clarifications of the 2023 Rules of Golf - 1 July 2026 - 2.pdf", "Aclaraciones vigentes — Julio 2026"),
)


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value).replace("\ufffd", " ")
    value = "".join(character for character in value if unicodedata.category(character) != "Mn")
    return re.sub(r"\s+", " ", value).strip().lower()


def rule_number(text: str) -> str:
    match = re.search(r"\b(?:Regla|Rule)\s+(\d{1,2}(?:\.\d+[a-z]?(?:\(\d+\))?)?)", text[:1800], re.IGNORECASE)
    return match.group(1) if match else ""


def build() -> None:
    entries: list[dict[str, object]] = []
    for source_id, filename, source_title in SOURCES:
        document = pdfium.PdfDocument(str(SOURCE_DIR / filename))
        for page_index in range(len(document)):
            page = document[page_index]
            text_page = page.get_textpage()
            raw = text_page.get_text_range()
            searchable = normalize(raw)
            text_page.close()
            page.close()
            if not searchable:
                continue
            entries.append({
                "id": f"{source_id}-p{page_index + 1}",
                "sourceId": source_id,
                "source": source_title,
                "page": page_index + 1,
                "rule": rule_number(raw),
                "searchText": searchable,
            })
        document.close()
    OUTPUT.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Generated {len(entries)} searchable Rules pages at {OUTPUT}")


if __name__ == "__main__":
    build()
