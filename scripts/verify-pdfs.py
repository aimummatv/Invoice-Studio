from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageDraw
import json
import subprocess
import re

root = Path(__file__).resolve().parent.parent
out = root / 'test-output'
poppler = Path(r'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe')
checks = []
for case in json.loads((out / 'pdf-evidence.json').read_text()):
    reader = PdfReader(case['file'])
    text = '\n'.join(page.extract_text() for page in reader.pages)
    result = dict(lines=case['count'], pages=len(reader.pages), all_lines=all(f'PDF-LINE-{i+1:03}' in text for i in range(case['count'])), total_on_final='Total amount' in reader.pages[-1].extract_text(), selectable_text=True)
    if case['count'] == 50:
        result['long_description_end'] = 'LONG-DESCRIPTION-END' in text
    assert result['all_lines'] and result['total_on_final']
    assert all(re.search(rf'\b{i+1}\s*/\s*{len(reader.pages)}\b', page.extract_text()) for i,page in enumerate(reader.pages)), 'Page counters are missing'
    if case['count'] == 20:
        assert all(label in text for label in ['Original for Recipient','Duplicate for Transporter','Triplicate for Supplier'])
    subprocess.run([str(poppler), '-scale-to', '900', '-png', case['file'], str(out / f"pdf-{case['count']}")], check=True, capture_output=True)
    checks.append(result)
(out / 'pdf-text-checks.json').write_text(json.dumps(checks, indent=2))

def montage(files, dest, width=1100):
    tiles=[]
    for file in files:
        image=Image.open(file).convert('RGB')
        image.thumbnail((width,450))
        tiles.append((file.name,image))
    height=sum(image.height+30 for _,image in tiles)
    result=Image.new('RGB',(width,height),'#e2e8f0')
    draw=ImageDraw.Draw(result)
    y=0
    for name,image in tiles:
        draw.text((8,y+6),name,fill='#172033')
        y+=30
        result.paste(image,(0,y))
        y+=image.height
    result.save(dest)
montage(sorted((root/'tmp/artifact/previews').glob('*.png')),out/'workbook-contact-sheet.png')
montage(sorted(out.glob('pdf-50-*.png')),out/'pdf-50-contact-sheet.png',650)
print(json.dumps(checks,indent=2))
