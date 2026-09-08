"""
Пакует папку в zip с ПРЯМЫМИ слэшами в путях (POSIX-разделители), как требует
формат zip. Нужен, потому что PowerShell Compress-Archive в Windows PowerShell
5.1 пишет пути с обратными слэшами (css\\style.css), и строгие распаковщики
(в т.ч. на стороне площадки) такой архив читают неверно.

Использование: python zipdir.py <папка-источник> <файл.zip>
Пути в архиве — относительно папки-источника, поэтому index.html оказывается
в корне архива.
"""
import os
import sys
import zipfile

root, out = sys.argv[1], sys.argv[2]
count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            z.write(full, rel)
            count += 1
print(f"zipdir: {count} файлов -> {out}")
