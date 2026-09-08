"""
OCR по иконкам: ищет читаемый текст и сверяет его с названием игры.

Помечает две вещи:
  has_text   — на иконке найден читаемый текст (любой);
  name_shown — этот текст похож на название игры (тогда иконка спойлерит ответ).

Результат — scripts/.cache/ocr.json со списком иконок и распознанным текстом,
чтобы потом просмотреть глазами и решить, какие убрать.

Запуск: python scripts/ocr-icons.py
"""
import json
import os
import re
import sys
import difflib
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS_DIR = os.path.join(ROOT, "public", "img", "icons")
DATA = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(ROOT, "scripts", ".cache")

STOP = {"the", "of", "and", "a", "for", "to", "in", "on", "vr", "hd", "go", "ii", "iii", "iv"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def name_tokens(name):
    toks = re.findall(r"[A-Za-z0-9]+", name.lower())
    return [t for t in toks if len(t) >= 4 and t not in STOP]


def main():
    with open(os.path.join(DATA, "games.json"), encoding="utf-8") as f:
        games = {g["id"]: g for g in json.load(f)["games"]}
    with open(os.path.join(DATA, "icons.json"), encoding="utf-8") as f:
        icons = json.load(f)["icons"]

    engine = RapidOCR()
    out = []
    n_text = 0
    n_name = 0

    for i, it in enumerate(icons):
        path = os.path.join(ICONS_DIR, it["file"])
        if not os.path.exists(path):
            continue
        game = games.get(it["gameId"], {})
        name = game.get("name", it["gameId"])

        try:
            res, _ = engine(path)
        except Exception as e:
            res = None

        words = []
        if res:
            for _box, text, score in res:
                if score is None or score < 0.5:
                    continue
                # только латиница/кириллица/цифры, отсекаем случайные иероглифы
                if re.search(r"[A-Za-zА-Яа-я]{2,}", text):
                    words.append(text.strip())

        ocr_text = " ".join(words)
        blob = norm(ocr_text)
        has_text = len(blob) >= 3

        # Сверка с названием: токен названия целиком встречается в OCR-тексте,
        # либо близок по difflib к одному из распознанных слов (OCR часто путает
        # буквы на стилизованных шрифтах).
        ntoks = name_tokens(name)
        owords = [norm(w) for w in words]
        name_shown = False
        for t in ntoks:
            if t in blob:
                name_shown = True
                break
            for ow in owords:
                if ow and difflib.SequenceMatcher(None, t, ow).ratio() >= 0.8:
                    name_shown = True
                    break
            if name_shown:
                break

        if has_text:
            n_text += 1
        if name_shown:
            n_name += 1

        out.append({
            "file": it["file"],
            "gameId": it["gameId"],
            "name": name,
            "tier": game.get("tier"),
            "ocr": ocr_text,
            "has_text": has_text,
            "name_shown": name_shown,
        })

        if (i + 1) % 25 == 0:
            sys.stdout.buffer.write(
                f"[ocr] {i + 1}/{len(icons)}  с текстом: {n_text}  с названием: {n_name}\n".encode("utf-8")
            )
            sys.stdout.flush()

    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "ocr.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    sys.stdout.buffer.write(
        f"\n[ocr] готово: {len(out)} иконок, с текстом {n_text}, с названием {n_name}\n".encode("utf-8")
    )


if __name__ == "__main__":
    main()
