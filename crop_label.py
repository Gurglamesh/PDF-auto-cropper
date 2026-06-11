"""
PDF shipment label auto-cropper.

Detects the content bounding box on each page and outputs a new PDF
sized to 95x178mm (standard shipment label).

Usage:
    python crop_label.py <file.pdf>
    python crop_label.py <folder>          # processes all PDFs in folder
    python crop_label.py a.pdf b.pdf ...
"""

import sys
import fitz  # PyMuPDF
import numpy as np
from pathlib import Path

MM_TO_PT = 72 / 25.4
TARGET_W = 95 * MM_TO_PT   # ~269.3 pt
TARGET_H = 178 * MM_TO_PT  # ~504.1 pt
RENDER_DPI = 300
WHITE_THRESHOLD = 245  # pixels >= this value are treated as background


def find_content_rect(page: fitz.Page) -> fitz.Rect | None:
    """Render the page and return a fitz.Rect enclosing all non-white content."""
    mat = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

    mask = arr < WHITE_THRESHOLD
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)

    if not rows.any():
        return None

    row_min, row_max = np.where(rows)[0][[0, -1]]
    col_min, col_max = np.where(cols)[0][[0, -1]]

    scale = 72 / RENDER_DPI
    return fitz.Rect(
        col_min * scale,
        row_min * scale,
        (col_max + 1) * scale,
        (row_max + 1) * scale,
    )


def crop_to_label(src: Path, dst: Path) -> None:
    doc = fitz.open(src)
    out = fitz.open()

    for page in doc:
        content_rect = find_content_rect(page)

        if content_rect is None:
            print(f"  Page {page.number + 1}: no content detected, skipping")
            continue

        # 2 mm padding so the label doesn't sit flush against the cut edge
        pad = 2 * MM_TO_PT
        clip = fitz.Rect(
            max(0, content_rect.x0 - pad),
            max(0, content_rect.y0 - pad),
            min(page.rect.width,  content_rect.x1 + pad),
            min(page.rect.height, content_rect.y1 + pad),
        )

        new_page = out.new_page(width=TARGET_W, height=TARGET_H)
        new_page.show_pdf_page(new_page.rect, doc, page.number, clip=clip)

    out.save(dst, garbage=4, deflate=True)
    out.close()
    doc.close()


def process(paths: list[str]) -> None:
    for raw in paths:
        path = Path(raw)

        if path.is_dir():
            pdfs = sorted(path.glob("*.pdf")) + sorted(path.glob("*.PDF"))
            if not pdfs:
                print(f"No PDF files found in {path}")
                continue
            for pdf in pdfs:
                dst = pdf.with_name(pdf.stem + "_cropped.pdf")
                print(f"{pdf.name}  ->  {dst.name}")
                crop_to_label(pdf, dst)

        elif path.suffix.lower() == ".pdf":
            dst = path.with_name(path.stem + "_cropped.pdf")
            print(f"{path.name}  ->  {dst.name}")
            crop_to_label(path, dst)

        else:
            print(f"Skipping {path}: not a PDF file or directory")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    process(sys.argv[1:])
