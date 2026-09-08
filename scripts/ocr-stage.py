"""
OCR по staging-иконкам кандидатов: помечает, на каких видно название игры.
Читает scripts/.cache/stage.json, пишет scripts/.cache/stage_ocr.json
с полем clean (True — названия не видно, годится в замену).

Запуск: python scripts/ocr-stage.py
"""
import json
import os
import re
import sys
import difflib
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE_DIR = os.path.join(ROOT, "public", "img", "icons_stage")
CACHE = os.path.join(ROOT, "scripts", ".cache")
STOP = {"the", "of", "and", "a", "for", "to", "in", "on", "vr", "hd", "go", "ii", "iii", "iv"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def name_tokens(name):
    toks = re.findall(r"[A-Za-z0-9]+", name.lower())
    return [t for t in toks if len(t) >= 4 and t not in STOP]


def name_shown(name, words):
    blob = norm(" ".join(words))
    owords = [norm(w) for w in words]
    for t in name_tokens(name):
        if t in blob:
            return True
        for ow in owords:
            if ow and difflib.SequenceMatcher(None, t, ow).ratio() >= 0.8:
                return True
    return False


def main():
    with open(os.path.join(CACHE, "stage.json"), encoding="utf-8") as f:
        stage = json.load(f)
    engine = RapidOCR()

    out = []
    clean = 0
    for i, s in enumerate(stage["staged"]):
        path = os.path.join(STAGE_DIR, s["file"])
        if not os.path.exists(path):
            continue
        try:
            res, _ = engine(path)
        except Exception:
            res = None
        words = []
        if res:
            for _b, text, score in res:
                if score and score >= 0.5 and re.search(r"[A-Za-zА-Яа-я]{2,}", text):
                    words.append(text.strip())
        shown = name_shown(s["name"], words)
        # Чистой считаем иконку без названия. Иконки с любым другим текстом
        # оставляем — на них нет ответа, только оформление.
        is_clean = not shown
        if is_clean:
            clean += 1
        out.append({"id": s["id"], "file": s["file"], "ocr": " ".join(words), "clean": is_clean})
        if (i + 1) % 25 == 0:
            sys.stdout.buffer.write(f"[ocr-stage] {i + 1}/{len(stage['staged'])}  чистых {clean}\n".encode("utf-8"))
            sys.stdout.flush()

    with open(os.path.join(CACHE, "stage_ocr.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    sys.stdout.buffer.write(f"\n[ocr-stage] готово: {clean}/{len(out)} чистых\n".encode("utf-8"))


if __name__ == "__main__":
    main()
