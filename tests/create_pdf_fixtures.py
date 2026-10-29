"""Create disposable, non-user PDFs for browser and engine regression checks."""
from pathlib import Path
import io
import sys

import fitz
from PIL import Image, ImageDraw


def main(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    font_path = folder / "DroidSansFallback.ttf"
    font_path.write_bytes(fitz.Font("korea").buffer)

    doc = fitz.open()
    for number in range(1, 4):
        page = doc.new_page(width=595, height=842)
        page.insert_font(fontname="SunriseKorean", fontfile=str(font_path))
        page.insert_text((50, 70), f"환경영향평가 시험 문서 {number}쪽", fontname="SunriseKorean", fontsize=16)
        page.insert_text((50, 105), f"Synthetic page {number}", fontsize=11)
        page.draw_rect(fitz.Rect(45, 120, 545, 190), color=(0.1, 0.35, 0.55))
    doc.set_metadata({"title": "합성 한글 PDF", "author": "Sunrise Test"})
    doc.save(folder / "korean_multipage.pdf", deflate=True)
    doc.close()

    image = Image.new("RGB", (720, 900), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 670, 180), fill="#d6e9f3", outline="#1f6f9f", width=3)
    draw.text((75, 95), "SCANNED FIXTURE - image only", fill="#183c54")
    img_bytes = io.BytesIO()
    image.save(img_bytes, format="PNG")
    doc = fitz.open()
    page = doc.new_page(width=480, height=600)
    page.insert_image(page.rect, stream=img_bytes.getvalue())
    doc.save(folder / "scanned_image.pdf", deflate=True)
    doc.close()

    doc = fitz.open()
    for rotation in (90, 270):
        page = doc.new_page(width=400, height=600)
        page.insert_text((40, 50), f"Rotation {rotation}", fontsize=16)
        page.set_rotation(rotation)
    doc.save(folder / "rotated_pages.pdf", deflate=True)
    doc.close()

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Form and attachment fixture")
    widget = fitz.Widget()
    widget.field_name = "sample_name"
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_value = "original value"
    widget.rect = fitz.Rect(50, 80, 240, 110)
    page.add_widget(widget)
    page.add_text_annot((50, 140), "original annotation")
    doc.embfile_add("sample.txt", b"test attachment", filename="sample.txt")
    doc.save(folder / "form_attachment.pdf", deflate=True)
    doc.close()

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Encrypted synthetic fixture")
    doc.save(folder / "encrypted.pdf", encryption=fitz.PDF_ENCRYPT_AES_256,
             owner_pw="synthetic-owner", user_pw="synthetic-open")
    doc.close()
    (folder / "broken.pdf").write_bytes(b"%PDF-1.7\ntruncated synthetic file")
    print("Created six disposable PDF fixtures in", folder)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
