from PIL import Image, ImageDraw
from pathlib import Path
image=Image.new('RGBA',(256,256),(0,0,0,0))
draw=ImageDraw.Draw(image)
draw.rounded_rectangle((0,0,255,255),radius=54,fill='#047857')
draw.rounded_rectangle((65,56,191,207),radius=8,outline='white',width=11)
for y,end in [(93,164),(128,164),(163,130)]:
    draw.line((91,y,end,y),fill='white',width=10)
image.save(Path(__file__).resolve().parent.parent/'assets/icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
