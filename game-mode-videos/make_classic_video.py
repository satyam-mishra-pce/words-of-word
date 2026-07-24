from PIL import Image, ImageDraw, ImageFont
import imageio.v2 as imageio
import numpy as np
import math, os, subprocess
import imageio_ffmpeg

W,H=1080,1920; FPS=30; DUR=28
OUT='pics and videos/exports/classic-mode-video.mp4'
TMP='pics and videos/exports/classic-mode-video-silent.mp4'
PREVIEW='pics and videos/exports/classic-mode-preview.png'
AUDIO='pics and videos/exports/wow-bgm-slower-no-whistle-24s.wav'
os.makedirs(os.path.dirname(OUT),exist_ok=True)
FONT_CANDIDATES=['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc','/Library/Fonts/Arial.ttf','/System/Library/Fonts/SFNS.ttf']
FONT_BOLD_CANDIDATES=['/System/Library/Fonts/Supplemental/Arial Bold.ttf','/System/Library/Fonts/Helvetica.ttc','/System/Library/Fonts/SFNS.ttf']
MONO_CANDIDATES=['/System/Library/Fonts/SFNSMono.ttf','/System/Library/Fonts/Menlo.ttc']
def first(paths):
    for p in paths:
        if os.path.exists(p): return p
    return None
FONT=first(FONT_CANDIDATES); FONT_BOLD=first(FONT_BOLD_CANDIDATES) or FONT; FONT_MONO=first(MONO_CANDIDATES) or FONT
def font(p,s): return ImageFont.truetype(p,s) if p else ImageFont.load_default()
def f(s): return font(FONT,s)
def fb(s): return font(FONT_BOLD,s)
def fm(s): return font(FONT_MONO,s)
BG=(17,17,17); PANEL=(26,26,26); PANEL2=(35,35,35); TEXT=(229,226,211); SUB=(130,133,138)
ACC=(246,195,39); GREEN=(106,173,80); RED=(202,71,84); BLUE=(78,156,255); PURPLE=(177,128,255)

def ease(x): x=max(0,min(1,x)); return 1-(1-x)**3
def alpha_for(t,s,e,fade=.4):
    a=ease((t-s)/fade); b=1-ease((t-(e-fade))/fade); return max(0,min(1,min(a,b)))
def rgba(c,a=1): return (*c,int(255*a))
def ts(d,s,fo):
    b=d.textbbox((0,0),s,font=fo); return b[2]-b[0],b[3]-b[1]
def text(d,s,xy,size,color=TEXT,font_obj=None,alpha=1,anchor='lt',align='left',spacing=8):
    d.text(xy,s,font=font_obj or f(size),fill=rgba(color,alpha),anchor=anchor,align=align,spacing=spacing)
def centered(d,s,y,size,color=TEXT,bold=False,alpha=1,max_width=940,line_spacing=10):
    fo=fb(size) if bold else f(size); lines=[]
    for raw in s.split('\n'):
        line=''
        for w in raw.split(' '):
            test=(line+' '+w).strip()
            if line and ts(d,test,fo)[0]>max_width: lines.append(line); line=w
            else: line=test
        if line: lines.append(line)
    total=sum(ts(d,l,fo)[1] for l in lines)+max(0,len(lines)-1)*line_spacing; cy=y-total/2
    for l in lines:
        d.text((W/2,cy),l,font=fo,fill=rgba(color,alpha),anchor='mt',align='center'); cy+=ts(d,l,fo)[1]+line_spacing
def rr(d,box,r,fill,outline=None,width=2,alpha=1):
    d.rounded_rectangle(box,radius=r,fill=rgba(fill,alpha))
    if outline: d.rounded_rectangle(box,radius=r,outline=rgba(outline,alpha),width=width)
def bg(d,t):
    d.rectangle((0,0,W,H),fill=BG)
    chars='CLASSICWORDSOFWORD'
    for i in range(20):
        x=(i*197)%W-70; y=(i*283)%H+math.sin(t*.65+i)*24
        text(d,chars[i%len(chars)],(x,y),82+(i%5)*22,SUB,font_obj=fb(82+(i%5)*22),alpha=.045)
    d.line((70,146,1010,146),fill=rgba(SUB,.35),width=1)
    text(d,'words of word',(70,98),26,SUB,alpha=.85)
    text(d,'classic',(1010,98),26,ACC,alpha=.95,anchor='rt')

def score_example(d,word,x,y,a,color=ACC):
    rr(d,(x,y,x+760,y+96),16,PANEL,outline=PANEL2,width=2,alpha=.96*a)
    text(d,word,(x+35,y+48),38,TEXT,font_obj=fm(38),alpha=a,anchor='lm')
    text(d,f'{len(word)} letters',(x+360,y+48),24,SUB,font_obj=fb(24),alpha=a,anchor='lm')
    rr(d,(x+575,y+22,x+720,y+74),12,color,outline=color,width=2,alpha=.15*a)
    text(d,'+3 pts',(x+648,y+48),28,color,font_obj=fb(28),alpha=a,anchor='mm')

def match_screen(d,t,a):
    local=max(0,t-12.0)
    words=['coin','action','motion','nation']
    submitted=max(0,min(len(words),int(local/1.35)))
    active_index=min(submitted,len(words)-1)
    total=submitted*3
    centered(d,'source word: communication',300,42,TEXT,bold=True,alpha=a)
    centered(d,'every valid word gives exactly 3 points',380,34,ACC,bold=True,alpha=a)
    rr(d,(120,500,960,620),18,PANEL,outline=ACC,width=2,alpha=.96*a)
    typed=words[active_index] if submitted < len(words) else words[-1]
    progress=(local%1.35)/1.35
    chars=len(typed) if submitted >= len(words) else min(len(typed),int(progress*(len(typed)+1)))
    text(d,(typed[:chars]+'_') if submitted < len(words) else typed,(160,560),44,TEXT,font_obj=fm(44),alpha=a,anchor='lm')
    text(d,'submit word',(905,560),24,SUB,font_obj=fb(24),alpha=a,anchor='rm')
    rr(d,(120,730,960,1060),18,PANEL,outline=PANEL2,width=2,alpha=.82*a)
    text(d,'accepted words',(160,785),27,SUB,font_obj=fb(27),alpha=a)
    x=160; y=850
    for w in words[:submitted]:
        label=f'{w}  +3'
        fo=fb(25); cw=min(ts(d,label,fo)[0]+42,740)
        if x+cw>920: x=160; y+=62
        rr(d,(x,y,x+cw,y+52),11,ACC,outline=ACC,width=2,alpha=.14*a)
        text(d,label,(x+21,y+27),25,ACC,font_obj=fo,alpha=a,anchor='lm')
        x+=cw+12
    rr(d,(250,1190,830,1310),18,ACC,outline=ACC,width=2,alpha=.13*a)
    text(d,f'total score: {total} pts',(540,1250),42,ACC,font_obj=fb(42),alpha=a,anchor='mm')

def frame(t):
    im=Image.new('RGB',(W,H),BG); ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov); bg(d,t)
    a=alpha_for(t,0,4.2)
    if a:
        centered(d,'classic mode',410-ease(t)*24,88,ACC,bold=True,alpha=a)
        centered(d,'Simple scoring.',600,54,TEXT,bold=True,alpha=a)
        centered(d,'Every accepted word = 3 points.',715,48,ACC,bold=True,alpha=a)
        centered(d,'Word length does not change the score.',835,34,SUB,alpha=a)
    a=alpha_for(t,4.7,11.3)
    if a:
        centered(d,'same points for every word',290,46,ACC,bold=True,alpha=a)
        score_example(d,'cat',160,455,a)
        score_example(d,'stone',160,590,a)
        score_example(d,'algorithm',160,725,a)
        score_example(d,'communication',160,860,a)
        centered(d,'Short word or long word — both are +3 in Classic.',1120,38,TEXT,bold=True,alpha=a,max_width=860)
    a=alpha_for(t,11.8,22.5,fade=.55)
    if a: match_screen(d,t,a)
    a=alpha_for(t,23.0,28,fade=.55)
    if a:
        centered(d,'classic mode',475,78,ACC,bold=True,alpha=a)
        centered(d,'find valid words fast',605,42,TEXT,bold=True,alpha=a)
        centered(d,'each accepted word adds +3 · clean and beginner friendly',700,34,SUB,alpha=a,max_width=900)
        rr(d,(250,900,830,996),14,ACC,alpha=a)
        d.text((540,948),'try classic',font=fb(38),fill=rgba(BG,a),anchor='mm')
        centered(d,'Words of Word',1160,36,SUB,alpha=a)
    return Image.alpha_composite(im.convert('RGBA'),ov).convert('RGB')

frame(6.5).save(PREVIEW)
writer=imageio.get_writer(TMP,fps=FPS,codec='libx264',quality=8,macro_block_size=None)
for i in range(int(DUR*FPS)): writer.append_data(np.asarray(frame(i/FPS)))
writer.close()
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
if os.path.exists(AUDIO):
    subprocess.run([ffmpeg,'-y','-i',TMP,'-stream_loop','-1','-i',AUDIO,'-t',str(DUR),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-shortest',OUT],check=True); os.remove(TMP)
else: os.replace(TMP,OUT)
print(OUT); print(PREVIEW)
