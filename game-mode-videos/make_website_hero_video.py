from PIL import Image, ImageDraw, ImageFont
import imageio.v2 as imageio
import numpy as np
import math, os, subprocess
import imageio_ffmpeg

W,H=1920,1080; FPS=30; DUR=28
OUT='pics and videos/exports/website-hero-gameplay-video.mp4'
TMP='pics and videos/exports/website-hero-gameplay-video-silent.mp4'
PREVIEW='pics and videos/exports/website-hero-gameplay-preview.png'
AUDIO='pics and videos/exports/wow-bgm-slower-no-whistle-24s.wav'
os.makedirs(os.path.dirname(OUT),exist_ok=True)
FONTS=['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc','/Library/Fonts/Arial.ttf']
BOLDS=['/System/Library/Fonts/Supplemental/Arial Bold.ttf','/System/Library/Fonts/Helvetica.ttc','/Library/Fonts/Arial Bold.ttf']
MONOS=['/System/Library/Fonts/SFNSMono.ttf','/System/Library/Fonts/Menlo.ttc']
def first(xs):
    for x in xs:
        if os.path.exists(x): return x
    return None
FONT=first(FONTS); BOLD=first(BOLDS) or FONT; MONO=first(MONOS) or FONT
def font(p,s): return ImageFont.truetype(p,s) if p else ImageFont.load_default()
def f(s): return font(FONT,s)
def fb(s): return font(BOLD,s)
def fm(s): return font(MONO,s)
BG=(17,17,17); PANEL=(26,26,26); PANEL2=(35,35,35); TEXT=(229,226,211); SUB=(130,133,138)
ACC=(246,195,39); GREEN=(106,173,80); RED=(202,71,84); BLUE=(78,156,255); PURPLE=(177,128,255)

def ease(x): x=max(0,min(1,x)); return 1-(1-x)**3
def alpha(t,s,e,fade=.45):
    a=ease((t-s)/fade); b=1-ease((t-(e-fade))/fade); return max(0,min(1,min(a,b)))
def rgba(c,a=1): return (*c,int(255*a))
def ts(d,s,fo):
    b=d.textbbox((0,0),s,font=fo); return b[2]-b[0],b[3]-b[1]
def text(d,s,xy,size,color=TEXT,font_obj=None,a=1,anchor='lt',align='left'):
    d.text(xy,s,font=font_obj or f(size),fill=rgba(color,a),anchor=anchor,align=align)
def center(d,s,y,size,color=TEXT,bold=False,a=1,max_width=1500):
    fo=fb(size) if bold else f(size); lines=[]
    for raw in s.split('\n'):
        line=''
        for w in raw.split(' '):
            test=(line+' '+w).strip()
            if line and ts(d,test,fo)[0]>max_width: lines.append(line); line=w
            else: line=test
        if line: lines.append(line)
    total=sum(ts(d,l,fo)[1] for l in lines)+max(0,len(lines)-1)*14; cy=y-total/2
    for l in lines:
        d.text((W/2,cy),l,font=fo,fill=rgba(color,a),anchor='mt',align='center'); cy+=ts(d,l,fo)[1]+14
def rr(d,box,r,fill,outline=None,width=2,a=1):
    d.rounded_rectangle(box,radius=r,fill=rgba(fill,a))
    if outline: d.rounded_rectangle(box,radius=r,outline=rgba(outline,a),width=width)
def bg(d,t):
    d.rectangle((0,0,W,H),fill=BG)
    for i,ch in enumerate('WORDSOFWORDGAMEPLAY'):
        x=(i*181)%W-60; y=(i*137)%H+math.sin(t*.6+i)*18
        text(d,ch,(x,y),80+(i%4)*24,SUB,font_obj=fb(80+(i%4)*24),a=.04)
    d.line((90,92,W-90,92),fill=rgba(SUB,.3),width=1)
    text(d,'words of word',(90,52),26,SUB,a=.9)
    text(d,'official game hub',(W-90,52),26,ACC,a=.9,anchor='rt')

def chip(d,label,x,y,color,a):
    fo=fb(24); cw=min(ts(d,label,fo)[0]+38,360)
    rr(d,(x,y,x+cw,y+46),11,color,outline=color,width=2,a=.14*a)
    text(d,label,(x+19,y+23),24,color,font_obj=fo,a=a,anchor='lm')
    return cw

def gameplay(d,t,a):
    local=max(0,t-7.2)
    rr(d,(90,132,1830,965),28,PANEL,outline=PANEL2,width=2,a=.95*a)
    # left players
    rr(d,(125,180,425,890),22,BG,outline=PANEL2,a=.9*a)
    text(d,'players',(160,225),24,SUB,font_obj=fb(24),a=a)
    players=[('Harshit',ACC,18),('Maya',BLUE,15),('Dev',GREEN,12),('Riya',PURPLE,9)]
    for i,(name,color,score) in enumerate(players):
        y=280+i*120
        rr(d,(155,y,395,y+80),14,PANEL,outline=color if i==0 else PANEL2,a=.95*a)
        d.ellipse((175,y+22,211,y+58),fill=rgba(color,a))
        text(d,name,(230,y+28),24,TEXT,font_obj=fb(24),a=a)
        text(d,f'{score}',(365,y+50),28,ACC,font_obj=fb(28),a=a,anchor='rm')
    # main word
    text(d,'source word',(960,230),25,SUB,font_obj=fb(25),a=a,anchor='mm')
    text(d,'communication',(960,330),72,ACC,font_obj=fm(72),a=a,anchor='mm')
    # input
    words=['coin','action','motion','nation','count','mount']
    submitted=max(0,min(len(words),int(local/1.1)))
    active=min(submitted,len(words)-1)
    typed=words[active]
    progress=(local%1.1)/1.1
    chars=len(typed) if submitted>=len(words) else min(len(typed),int(progress*(len(typed)+1)))
    rr(d,(535,430,1385,510),16,BG,outline=ACC,width=2,a=.95*a)
    text(d,(typed[:chars]+'_') if submitted<len(words) else typed,(575,470),38,TEXT,font_obj=fm(38),a=a,anchor='lm')
    text(d,'submit',(1345,470),24,SUB,font_obj=fb(24),a=a,anchor='rm')
    # accepted words contained
    rr(d,(535,585,1385,820),18,BG,outline=PANEL2,a=.85*a)
    text(d,'accepted words',(575,630),24,SUB,font_obj=fb(24),a=a)
    x=575; y=680
    for w in words[:submitted]:
        cw=chip(d,f'{w} +3',x,y,ACC,a)
        x+=cw+12
        if x>1300: x=575; y+=58
    # right rules
    rr(d,(1490,180,1795,890),22,BG,outline=PANEL2,a=.9*a)
    text(d,'modes',(1530,225),24,SUB,font_obj=fb(24),a=a)
    modes=['classic','score attack','word sprint','knockout','blind type','theme','claim']
    for i,m in enumerate(modes):
        c=ACC if i==0 else SUB
        y=270+i*72
        rr(d,(1515,y,1770,y+50),12,PANEL,outline=c if i==0 else PANEL2,a=.92*a)
        size=20 if len(m)>10 else 22
        text(d,m,(1642,y+25),size,c,font_obj=fb(size),a=a,anchor='mm')

def frame(t):
    im=Image.new('RGB',(W,H),BG); ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov); bg(d,t)
    a=alpha(t,0,4.4)
    if a:
        center(d,'Words of Word',405,98,ACC,True,a)
        center(d,'Find hidden words inside one big word.',560,48,TEXT,True,a)
        center(d,'Fast, social, competitive vocabulary battles.',650,34,SUB,False,a)
    a=alpha(t,4.8,7.0)
    if a:
        center(d,'one source word',360,68,ACC,True,a)
        center(d,'everyone races to discover valid smaller words',500,44,TEXT,True,a)
        center(d,'play multiplayer or take the daily challenge',610,34,SUB,False,a)
    a=alpha(t,7.2,20.4,.55)
    if a: gameplay(d,t,a)
    a=alpha(t,20.8,24.1)
    if a:
        center(d,'multiple ways to play',330,68,ACC,True,a)
        names=['Classic','Score Attack','Word Sprint','Knockout','Blind Type','Theme Challenge','Claim Mode']
        x=250; y=500
        for name in names:
            cw=chip(d,name,x,y,ACC,a)
            x+=cw+18
            if x>1480: x=250; y+=70
        center(d,'Each mode changes the pressure, strategy, and chaos.',770,40,TEXT,True,a)
    a=alpha(t,24.5,28,.55)
    if a:
        center(d,'play words of word',390,78,ACC,True,a)
        center(d,'create a room · invite friends · race the clock',525,40,TEXT,True,a)
        rr(d,(660,650,1260,745),16,ACC,a=a)
        text(d,'jump into a match',(960,698),34,BG,font_obj=fb(34),a=a,anchor='mm')
        center(d,'words-of-word.onrender.com',835,30,SUB,False,a)
    return Image.alpha_composite(im.convert('RGBA'),ov).convert('RGB')

frame(11).save(PREVIEW)
writer=imageio.get_writer(TMP,fps=FPS,codec='libx264',quality=8,macro_block_size=None)
for i in range(int(DUR*FPS)): writer.append_data(np.asarray(frame(i/FPS)))
writer.close()
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
if os.path.exists(AUDIO):
    subprocess.run([ffmpeg,'-y','-i',TMP,'-stream_loop','-1','-i',AUDIO,'-t',str(DUR),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-shortest',OUT],check=True); os.remove(TMP)
else: os.replace(TMP,OUT)
print(OUT); print(PREVIEW)
