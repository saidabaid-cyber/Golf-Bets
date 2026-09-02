"""Export the approved The Backyard PDF artwork as production SVG and PNG assets.

The PDF was authored in Illustrator and contains outlined vector paths only. This
script preserves those paths for SVG and uses PDFium for the transparent PNG
fallback. The untracked PDF in brand-source remains the single source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CANDIDATES = (
    ROOT / "brand-source" / "the-backyard-logo.pdf",
    ROOT / "brand-source" / "Logo The Backyard Club.pdf",
)
OUTPUT_DIR = ROOT / "public" / "brand"
SVG_PATH = OUTPUT_DIR / "the-backyard-logo.svg"
PNG_PATH = OUTPUT_DIR / "the-backyard-logo.png"
RASTER_SCALE = 3
RASTER_PADDING = 24


@dataclass(frozen=True)
class GraphicsState:
    ctm: tuple[float, float, float, float, float, float] = (1, 0, 0, 1, 0, 0)
    fill: tuple[float, float, float] = (0, 0, 0)
    stroke: tuple[float, float, float] = (0, 0, 0)
    stroke_width: float = 1


def source_pdf() -> Path:
    for candidate in SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No se encontró el PDF oficial en brand-source/.")


def number(value: object) -> float:
    return float(value)


def concise(value: float) -> str:
    rendered = f"{value:.6f}".rstrip("0").rstrip(".")
    return rendered if rendered not in {"", "-0"} else "0"


def color(values: tuple[float, float, float]) -> str:
    channels = [max(0, min(255, round(value * 255))) for value in values]
    return f"rgb({channels[0]} {channels[1]} {channels[2]})"


def multiply(
    left: tuple[float, float, float, float, float, float],
    right: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return (
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l + e,
        b * k + d * l + f,
    )


def path_element(path: list[str], state: GraphicsState, operator: bytes) -> str | None:
    if not path:
        return None
    paint = operator.decode("ascii")
    fill = "none" if paint == "S" else color(state.fill)
    stroke = color(state.stroke) if paint in {"S", "B", "B*", "b", "b*"} else "none"
    fill_rule = ' fill-rule="evenodd"' if paint in {"f*", "B*", "b*"} else ""
    matrix = " ".join(concise(item) for item in state.ctm)
    return (
        f'<path d="{" ".join(path)}" transform="matrix({matrix})" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{concise(state.stroke_width)}"'
        f'{fill_rule}/>'
    )


def vector_paths(pdf_path: Path) -> tuple[float, float, list[str]]:
    reader = PdfReader(str(pdf_path))
    page = reader.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    stream = ContentStream(page.get_contents(), reader)
    state = GraphicsState()
    stack: list[GraphicsState] = []
    current_path: list[str] = []
    output: list[str] = []

    for operands, operator in stream.operations:
        if operator == b"q":
            stack.append(state)
        elif operator == b"Q":
            state = stack.pop()
        elif operator == b"cm":
            transform = tuple(number(item) for item in operands)
            state = replace(state, ctm=multiply(state.ctm, transform))
        elif operator == b"rg":
            state = replace(state, fill=tuple(number(item) for item in operands))
        elif operator == b"RG":
            state = replace(state, stroke=tuple(number(item) for item in operands))
        elif operator == b"w":
            state = replace(state, stroke_width=number(operands[0]))
        elif operator == b"m":
            current_path.append(f"M {concise(number(operands[0]))} {concise(number(operands[1]))}")
        elif operator == b"l":
            current_path.append(f"L {concise(number(operands[0]))} {concise(number(operands[1]))}")
        elif operator == b"c":
            coords = " ".join(concise(number(item)) for item in operands)
            current_path.append(f"C {coords}")
        elif operator == b"y":
            x1, y1, x3, y3 = (concise(number(item)) for item in operands)
            current_path.append(f"C {x1} {y1} {x3} {y3} {x3} {y3}")
        elif operator == b"re":
            x, y, rect_width, rect_height = (number(item) for item in operands)
            current_path.append(
                f"M {concise(x)} {concise(y)} h {concise(rect_width)} "
                f"v {concise(rect_height)} h {concise(-rect_width)} Z"
            )
        elif operator == b"h":
            current_path.append("Z")
        elif operator in {b"f", b"f*", b"F", b"S", b"B", b"B*", b"b", b"b*"}:
            element = path_element(current_path, state, b"f" if operator == b"F" else operator)
            if element:
                output.append(element)
            current_path = []
        elif operator == b"n":
            current_path = []

    return width, height, output


def render_transparent_png(pdf_path: Path) -> tuple[Image.Image, tuple[int, int, int, int]]:
    document = pdfium.PdfDocument(str(pdf_path))
    page = document[0]
    bitmap = page.render(scale=RASTER_SCALE, fill_color=(0, 0, 0, 0))
    image = bitmap.to_pil().convert("RGBA")
    alpha_bounds = image.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise RuntimeError("El PDF no produjo arte visible.")
    left, top, right, bottom = alpha_bounds
    crop = (
        max(0, left - RASTER_PADDING),
        max(0, top - RASTER_PADDING),
        min(image.width, right + RASTER_PADDING),
        min(image.height, bottom + RASTER_PADDING),
    )
    return image.crop(crop), crop


def write_svg(width: float, height: float, paths: Iterable[str], crop: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = crop
    view_left = left / RASTER_SCALE
    view_top = top / RASTER_SCALE
    view_width = (right - left) / RASTER_SCALE
    view_height = (bottom - top) / RASTER_SCALE
    body = "\n    ".join(paths)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{concise(view_left)} {concise(view_top)} {concise(view_width)} {concise(view_height)}" role="img" aria-labelledby="logo-title">
  <title id="logo-title">THE BACKYARD</title>
  <g transform="matrix(1 0 0 -1 0 {concise(height)})">
    {body}
  </g>
</svg>
'''
    SVG_PATH.write_text(svg, encoding="utf-8", newline="\n")


def main() -> None:
    pdf_path = source_pdf()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    width, height, paths = vector_paths(pdf_path)
    if not paths:
        raise RuntimeError("El PDF no contiene paths vectoriales exportables.")
    png, crop = render_transparent_png(pdf_path)
    png.save(PNG_PATH, format="PNG", optimize=True)
    write_svg(width, height, paths, crop)
    print(f"Fuente: {pdf_path.relative_to(ROOT)}")
    print(f"SVG: {SVG_PATH.relative_to(ROOT)} ({len(paths)} paths)")
    print(f"PNG: {PNG_PATH.relative_to(ROOT)} ({png.width}x{png.height}, RGBA)")
    print(f"Crop: {crop}; página: {concise(width)}x{concise(height)} pt")


if __name__ == "__main__":
    main()
