"""Parse MandarinBean "New HSK Vocabulary" PDFs into CSV word lists.

Each PDF page holds a ruled table with columns NO. / WORD / PINYIN /
PART OF SPEECH / (TRANSLATION). pdfplumber's line-based table detector
misses rows here because most row dividers aren't drawn, so this script
clusters words by x/y position instead: header row gives column x-offsets,
words are bucketed into columns by nearest offset and into rows by top
position, and rows whose NO. cell is blank are merged into the previous
entry (an English translation or Chinese POS tag that wrapped to a second
line).

Usage:
    python src/pdf_to_csv.py -i data/pdf/hsk_level_01.pdf -o vocab/hsk_level_01.csv
    python src/pdf_to_csv.py -i data/pdf -o vocab --mode dir
"""

import argparse
import csv
import sys
import unicodedata
from pathlib import Path

import pdfplumber

HEADER_LABELS = {"NO.": "no", "WORD": "word", "PINYIN": "pinyin", "PART": "pos"}
FOOTER_MARGIN = 45  # px reserved for the "mandarinbean.com / Page N / Level N" footer
ROW_TOLERANCE = 4  # px; words within this many px of top are the same table row


def _column_bounds(words):
    """Return [(column_name, x0), ...] from a header row, or None if absent."""
    if not any(w["text"] == "NO." for w in words):
        return None
    bounds = [(name, next(w["x0"] for w in words if w["text"] == label)) for label, name in HEADER_LABELS.items()]
    trans_x = next((w["x0"] for w in words if w["text"] == "TRANSLATION"), None)
    if trans_x is not None:
        bounds.append(("trans", trans_x))
    return sorted(bounds, key=lambda b: b[1])


def _column_for(x0, bounds):
    column = bounds[0][0]
    for name, bound_x0 in bounds:
        if x0 >= bound_x0 - 5:
            column = name
    return column


def _cluster_rows(words):
    rows = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(word["top"] - rows[-1][0]) < ROW_TOLERANCE:
            rows[-1][1].append(word)
        else:
            rows.append([word["top"], [word]])
    return rows


def extract_entries(pdf_path):
    """Return a list of {no, word, pinyin, pos, trans} dicts for one PDF."""
    entries = []
    bounds = None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            words = [w for w in words if w["top"] < page.height - FOOTER_MARGIN]
            if not words:
                continue

            header_bounds = _column_bounds(words)
            if header_bounds is not None:
                bounds = header_bounds
                header_top = next(w["top"] for w in words if w["text"] == "NO.")
                body_words = [w for w in words if w["top"] > header_top + 1]
            elif bounds is not None:
                body_words = words
            else:
                continue  # cover page, seen before any table header

            for _, row_words in _cluster_rows(body_words):
                cells = {"no": "", "word": "", "pinyin": "", "pos": "", "trans": ""}
                for word in sorted(row_words, key=lambda w: w["x0"]):
                    column = _column_for(word["x0"], bounds)
                    cells[column] = (cells[column] + " " + word["text"]).strip()

                if cells["no"].isdigit():
                    entries.append(cells)
                elif entries:
                    prev = entries[-1]
                    for key in ("word", "pinyin", "pos", "trans"):
                        if cells[key]:
                            prev[key] = f"{prev[key]} {cells[key]}".strip()
    return entries


def entries_to_rows(entries):
    return [
        [unicodedata.normalize("NFKC", e[k]) for k in ("word", "pinyin", "pos", "trans")]
        for e in entries
    ]


def write_csv(rows, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Word", "Pinyin", "POS", "Translation"])
        writer.writerows(rows)


def convert_file(pdf_path, out_path):
    rows = entries_to_rows(extract_entries(pdf_path))
    write_csv(rows, out_path)
    print(f"{pdf_path.name}: wrote {len(rows)} entries -> {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-i", "--input", required=True, help="source PDF file or directory")
    parser.add_argument("-o", "--output", required=True, help="destination CSV file or directory")
    parser.add_argument("--mode", choices=["file", "dir"], default="file", help="input is a single PDF or a directory of PDFs")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if args.mode == "file":
        convert_file(input_path, output_path)
        return

    if not input_path.is_dir():
        sys.exit(f"error: {input_path} is not a directory (use --mode file for a single PDF)")
    pdf_files = sorted(input_path.glob("*.pdf"))
    if not pdf_files:
        sys.exit(f"error: no PDF files found in {input_path}")
    for pdf_path in pdf_files:
        convert_file(pdf_path, output_path / f"{pdf_path.stem}.csv")


if __name__ == "__main__":
    main()
