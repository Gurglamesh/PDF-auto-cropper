"""
PDF Shipment Label Cropper
--------------------------
Opens a PDF, auto-detects the label area, crops to 95×178 mm, and prints.

Usage:
  - Launch the .exe directly → click "Open PDF"
  - Right-click a .pdf → Open with → LabelCropper.exe
  - Drag a .pdf onto the .exe
"""

import os
import sys
import subprocess
import tempfile
import tkinter as tk
from tkinter import filedialog, messagebox
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageTk

# ── constants ─────────────────────────────────────────────────────────────────
MM_TO_PT        = 72 / 25.4
TARGET_W        = 95  * MM_TO_PT   # ~269.3 pt
TARGET_H        = 178 * MM_TO_PT   # ~504.1 pt
DETECT_DPI      = 300
WHITE_THRESHOLD = 245
PREVIEW_H_PX    = 520              # canvas height in pixels
PREVIEW_W_PX    = int(PREVIEW_H_PX * 95 / 178)  # keep aspect ratio (~277 px)

# ── PDF processing ─────────────────────────────────────────────────────────────

def _find_content_rect(page: fitz.Page) -> fitz.Rect | None:
    mat = fitz.Matrix(DETECT_DPI / 72, DETECT_DPI / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    mask = arr < WHITE_THRESHOLD
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return None
    row_min, row_max = np.where(rows)[0][[0, -1]]
    col_min, col_max = np.where(cols)[0][[0, -1]]
    scale = 72 / DETECT_DPI
    return fitz.Rect(col_min * scale, row_min * scale,
                     (col_max + 1) * scale, (row_max + 1) * scale)


def crop_to_labels(src: fitz.Document) -> fitz.Document:
    out = fitz.open()
    pad = 2 * MM_TO_PT
    for page in src:
        rect = _find_content_rect(page)
        if rect is None:
            continue
        clip = fitz.Rect(
            max(0, rect.x0 - pad),
            max(0, rect.y0 - pad),
            min(page.rect.width,  rect.x1 + pad),
            min(page.rect.height, rect.y1 + pad),
        )
        new_page = out.new_page(width=TARGET_W, height=TARGET_H)
        new_page.show_pdf_page(new_page.rect, src, page.number, clip=clip)
    return out


def _render_preview(doc: fitz.Document, page_num: int) -> Image.Image:
    """Render one page at a resolution that fits the preview canvas."""
    dpi = int(PREVIEW_H_PX / (TARGET_H / 72))  # dpi so page fills canvas height
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = doc[page_num].get_pixmap(matrix=mat)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


# ── GUI ────────────────────────────────────────────────────────────────────────

BG_DARK   = "#2b2b2b"
BG_DARKER = "#1e1e1e"
BG_CANVAS = "#3c3c3c"
FG_TEXT   = "#dddddd"
FG_DIM    = "#888888"
BLUE      = "#4a90d9"
BLUE_HOV  = "#357abd"
GREEN     = "#27ae60"
GREEN_HOV = "#1e8449"


def _btn(parent, text, color, hover, command, width=11):
    b = tk.Button(
        parent, text=text, command=command, width=width,
        bg=color, fg="white", activebackground=hover, activeforeground="white",
        relief=tk.FLAT, bd=0, padx=10, pady=6,
        font=("Segoe UI", 9, "bold"), cursor="hand2",
    )
    b.bind("<Enter>", lambda e: b.config(bg=hover))
    b.bind("<Leave>", lambda e: b.config(bg=color))
    return b


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Label Cropper")
        self.configure(bg=BG_DARK)
        self.resizable(False, False)

        self._doc:      fitz.Document | None = None   # cropped in-memory doc
        self._src_name: str = ""
        self._page:     int = 0
        self._photo:    ImageTk.PhotoImage | None = None
        self._tmp:      str | None = None

        self._build_ui()

        # Support "Open with" and drag-onto-exe
        if len(sys.argv) > 1:
            self.after(80, lambda: self._load(sys.argv[1]))

    # ── layout ────────────────────────────────────────────────────────────────

    def _build_ui(self):
        PAD = 14

        # toolbar
        bar = tk.Frame(self, bg=BG_DARK)
        bar.pack(fill=tk.X, padx=PAD, pady=(PAD, 6))

        _btn(bar, "Open PDF", BLUE, BLUE_HOV, self._open_dialog).pack(side=tk.LEFT, padx=(0, 8))
        self._print_btn = _btn(bar, "Print", GREEN, GREEN_HOV, self._print)
        self._print_btn.config(state="disabled", bg="#3a3a3a", activebackground="#3a3a3a")
        self._print_btn.pack(side=tk.LEFT)

        # page navigation (hidden until needed)
        self._nav = tk.Frame(self, bg=BG_DARK)
        tk.Button(self._nav, text="◀", command=self._prev,
                  bg=BG_DARK, fg=FG_TEXT, relief=tk.FLAT, bd=0,
                  font=("Segoe UI", 10), cursor="hand2").pack(side=tk.LEFT)
        self._page_lbl = tk.Label(self._nav, bg=BG_DARK, fg=FG_TEXT,
                                  font=("Segoe UI", 9), width=8)
        self._page_lbl.pack(side=tk.LEFT)
        tk.Button(self._nav, text="▶", command=self._next,
                  bg=BG_DARK, fg=FG_TEXT, relief=tk.FLAT, bd=0,
                  font=("Segoe UI", 10), cursor="hand2").pack(side=tk.LEFT)

        # canvas
        frame = tk.Frame(self, bg="#111111", bd=1, relief=tk.FLAT)
        frame.pack(padx=PAD, pady=0)
        self._canvas = tk.Canvas(frame, bg=BG_CANVAS,
                                 width=PREVIEW_W_PX, height=PREVIEW_H_PX,
                                 highlightthickness=0, cursor="hand2")
        self._canvas.pack()
        self._canvas.bind("<Button-1>", lambda _e: self._open_dialog())
        self._draw_placeholder()

        # status bar
        self._status = tk.StringVar(value="Open a PDF to get started")
        tk.Label(self, textvariable=self._status,
                 bg=BG_DARKER, fg=FG_DIM,
                 font=("Segoe UI", 8), anchor="w", padx=PAD, pady=4
                 ).pack(fill=tk.X, side=tk.BOTTOM, pady=(6, 0))

    def _draw_placeholder(self):
        cx, cy = PREVIEW_W_PX // 2, PREVIEW_H_PX // 2
        emoji_font = "Apple Color Emoji" if sys.platform == "darwin" else "Segoe UI Emoji"
        body_font  = "Helvetica"         if sys.platform == "darwin" else "Segoe UI"
        self._canvas.create_text(cx, cy - 16, text="📄",
                                 font=(emoji_font, 28), fill=FG_DIM, tags="ph")
        self._canvas.create_text(cx, cy + 22, text="Click to open a PDF",
                                 font=(body_font, 10), fill=FG_DIM, tags="ph")

    # ── actions ───────────────────────────────────────────────────────────────

    def _open_dialog(self):
        path = filedialog.askopenfilename(
            title="Select a PDF label",
            filetypes=[("PDF files", "*.pdf *.PDF"), ("All files", "*.*")],
        )
        if path:
            self._load(path)

    def _load(self, path: str):
        name = Path(path).name
        self._status.set(f"Processing {name}…")
        self.update_idletasks()
        try:
            src = fitz.open(path)
            cropped = crop_to_labels(src)
            src.close()
        except Exception as exc:
            messagebox.showerror("Error", f"Could not open file:\n{exc}")
            self._status.set("Error — could not open file.")
            return

        if len(cropped) == 0:
            messagebox.showwarning("No content",
                                   "No label content could be detected in this PDF.\n"
                                   "The page may be blank or entirely white.")
            self._status.set("No content found.")
            return

        if self._doc:
            self._doc.close()
        self._doc       = cropped
        self._src_name  = name
        self._page      = 0

        self._refresh_preview()
        self._enable_print()

        n = len(cropped)
        suffix = f" — {n} pages" if n > 1 else ""
        self._status.set(f"{name}{suffix}  ·  cropped to 95×178 mm")

        if n > 1:
            self._nav.pack(pady=(4, 0), before=self._canvas.master)
        else:
            self._nav.pack_forget()

    def _refresh_preview(self):
        img = _render_preview(self._doc, self._page)
        img = img.resize((PREVIEW_W_PX, PREVIEW_H_PX), Image.LANCZOS)
        self._photo = ImageTk.PhotoImage(img)
        self._canvas.delete("all")
        self._canvas.create_image(0, 0, anchor=tk.NW, image=self._photo)

        n = len(self._doc)
        self._page_lbl.config(text=f"{self._page + 1} / {n}")

    def _prev(self):
        if self._page > 0:
            self._page -= 1
            self._refresh_preview()

    def _next(self):
        if self._doc and self._page < len(self._doc) - 1:
            self._page += 1
            self._refresh_preview()

    def _enable_print(self):
        self._print_btn.config(
            state="normal", bg=GREEN, activebackground=GREEN_HOV,
            cursor="hand2",
        )
        self._print_btn.bind("<Enter>", lambda e: self._print_btn.config(bg=GREEN_HOV))
        self._print_btn.bind("<Leave>", lambda e: self._print_btn.config(bg=GREEN))

    def _print(self):
        if self._doc is None:
            return
        # Clean up previous temp file
        if self._tmp and os.path.exists(self._tmp):
            try:
                os.unlink(self._tmp)
            except OSError:
                pass
        fd, tmp = tempfile.mkstemp(suffix=".pdf",
                                   prefix=Path(self._src_name).stem + "_label_")
        os.close(fd)
        self._doc.save(tmp, garbage=4, deflate=True)
        self._tmp = tmp
        self._status.set("Opening print dialog…")
        try:
            if sys.platform == "win32":
                os.startfile(tmp, "print")
            elif sys.platform == "darwin":
                subprocess.run(["open", tmp], check=True)   # opens in Preview → Cmd+P
            else:
                subprocess.run(["xdg-open", tmp], check=True)
        except Exception as exc:
            messagebox.showerror("Print error", str(exc))
            self._status.set("Print failed.")

    def destroy(self):
        if self._tmp and os.path.exists(self._tmp):
            try:
                os.unlink(self._tmp)
            except OSError:
                pass
        super().destroy()


if __name__ == "__main__":
    app = App()
    app.mainloop()
