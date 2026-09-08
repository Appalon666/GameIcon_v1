"""
Ищет на скриншотах текст с названием игры и записывает область блюра в
shots.json (движок закрасит её, как названия на иконках). Блюрит только текст,
совпавший с названием игры, — прочий UI не трогает.

Запуск: python scripts/ocr-shots-names.py
"""
import json
import os
import re
import sys
import difflib
import cv2
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS_DIR = os.path.join(ROOT, "public", "img", "shots")
DATA = os.path.join(ROOT, "public", "data")
STOP = {"the", "of", "and", "a", "for", "to", "in", "on", "vr", "hd", "go", "ii", "iii", "iv"}

MARGIN = 0.02   # запас вокруг текста, доли кадра
MAX_AREA = 0.55  # если блюр закрыл бы больше — кадр в брак (нечего угадывать)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def name_tokens(name):
    return [t for t in re.findall(r"[A-Za-z0-9]+", name.lower()) if len(t) >= 4 and t not in STOP]


def is_name(text, ntoks):
    t = norm(text)
    if not t:
        return False
    for tok in ntoks:
        if tok in t or t in tok:
            return True
        if difflib.SequenceMatcher(None, tok, t).ratio() >= 0.8:
            return True
    return False


def bbox(points, W, H):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x = max(0.0, min(xs) / W - MARGIN)
    y = max(0.0, min(ys) / H - MARGIN)
    w = min(1.0 - x, (max(xs) - min(xs)) / W + 2 * MARGIN)
    h = min(1.0 - y, (max(ys) - min(ys)) / H + 2 * MARGIN)
    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}


def main():
    with open(os.path.join(DATA, "games.json"), encoding="utf-8") as f:
        games = {g["id"]: g for g in json.load(f)["games"]}
    with open(os.path.join(DATA, "shots.json"), encoding="utf-8") as f:
        doc = json.load(f)

    engine = RapidOCR()
    blurred = 0
    skipped = 0
    for i, it in enumerate(doc["shots"]):
        path = os.path.join(SHOTS_DIR, it["file"])
        if not os.path.exists(path):
            continue
        name = games.get(it["gameId"], {}).get("name", it["gameId"])
        ntoks = name_tokens(name)

        regions = []
        if ntoks:
            try:
                res, _ = engine(path)
            except Exception:
                res = None
            if res:
                img = cv2.imread(path)
                if img is not None:
                    H, W = img.shape[:2]
                    for box, text, score in res:
                        if score and score >= 0.5 and is_name(text, ntoks):
                            regions.append(bbox(box, W, H))

        # Сбрасываем прежние авто-значения и проставляем новые (ручных правок
        # по скринам ещё нет).
        area = sum(r["w"] * r["h"] for r in regions)
        if regions and area <= MAX_AREA:
            it["blur"] = regions
            it["clean"] = False
            it["skip"] = it.get("skip", False)
            blurred += 1
        elif regions:
            # Название занимает пол-кадра — угадывать нечего, в брак.
            it["blur"] = []
            it["clean"] = False
            it["skip"] = True
            skipped += 1
        else:
            it["blur"] = []
            it["clean"] = True
            it["skip"] = it.get("skip", False)
        it["needsReview"] = False

        if (i + 1) % 50 == 0:
            sys.stdout.buffer.write(
                f"[shots-ocr] {i + 1}/{len(doc['shots'])}  заблюрено {blurred}  в брак {skipped}\n".encode("utf-8")
            )
            sys.stdout.flush()

    with open(os.path.join(DATA, "shots.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    sys.stdout.buffer.write(
        f"\n[shots-ocr] готово: заблюрено названий на {blurred} скринах, в брак {skipped}\n".encode("utf-8")
    )


if __name__ == "__main__":
    main()
