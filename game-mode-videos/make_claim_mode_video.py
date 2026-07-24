from PIL import Image, ImageDraw, ImageFont
import imageio.v2 as imageio
import numpy as np
import math, os, subprocess
import imageio_ffmpeg

W,H=1080,1920; FPS=30; DUR=31
OUT='pics and videos/exports/claim-mode-video.mp4'
TMP='pics and videos/exports/claim-mode-video-silent.mp4'
PREVIEW='pics and videos/exports/claim-mode-preview.png'
AUDIO='pics and videos/exports/wow-bgm-slower-no-whistle-24s.wav'
os.makedirs(os.path.dirname(OUT),exist_ok=True)
FONT_CANDIDATES=['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc','/Library/Fonts/Arial.ttf','/System/Library/Fonts/SFNS.ttf']
FONT_BOLD_CANDIDATES=['/System/Library/Fonts/Supplemental/Arial Bold.ttf','/System/Library/Fonts/Helvetica.ttc','/Library/Fonts/SFNS.ttf']
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
ACC=(246,195,39); GREEN=(106,173,80); RED=(202,71,84); BLUE=(78,156,255); PURPLE=(177,128,255); ORANGE=(242,127,36)
PLAYERS=[('Harshit',ACC),('Maya',BLUE),('Dev',GREEN),('Riya',PURPLE)]

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
    chars='CLAIMMODEWORDSOFWORD'
    for i in range(20):
        x=(i*199)%W-70; y=(i*287)%H+math.sin(t*.68+i)*24
        text(d,chars[i%len(chars)],(x,y),82+(i%5)*22,SUB,font_obj=fb(82+(i%5)*22),alpha=.045)
    d.line((70,146,1010,146),fill=rgba(SUB,.35),width=1)
    text(d,'words of word',(70,98),26,SUB,alpha=.85)
    text(d,'claim mode',(1010,98),26,ACC,alpha=.95,anchor='rt')

def player_row(d,x,y,name,color,typed,status,a,score=0):
    outline=GREEN if status=='claimed' else (RED if status=='blocked' else PANEL2)
    fill=(24,38,28) if status=='claimed' else ((42,22,27) if status=='blocked' else PANEL)
    rr(d,(x,y,x+850,y+92),16,fill,outline=outline,width=2,alpha=.96*a)
    d.ellipse((x+24,y+24,x+68,y+68),fill=rgba(color,a))
    text(d,name,(x+88,y+35),30,TEXT,font_obj=fb(30),alpha=a)
    rr(d,(x+280,y+22,x+530,y+70),10,PANEL2,alpha=.75*a)
    text(d,typed or 'typing...',(x+305,y+46),25,TEXT if typed else SUB,font_obj=fm(25),alpha=a,anchor='lm')
    if status=='claimed':
        text(d,'CLAIMED',(x+675,y+46),24,GREEN,font_obj=fb(24),alpha=a,anchor='mm')
    elif status=='blocked':
        text(d,'TAKEN',(x+650,y+46),22,RED,font_obj=fb(22),alpha=a,anchor='mm')
    else:
        text(d,'waiting',(x+675,y+46),22,SUB,font_obj=fb(22),alpha=a,anchor='mm')
    text(d,f'{score} pts',(x+815,y+46),24,ACC,font_obj=fb(24),alpha=a,anchor='rm')

def claimed_board(d,items,a):
    rr(d,(120,1230,960,1495),18,PANEL,outline=PANEL2,width=2,alpha=.9*a)
    text(d,'claimed words',(160,1280),28,SUB,font_obj=fb(28),alpha=a)
    x=160; y=1345
    for word,owner,color in items:
        label=f'{word} · {owner}'
        fo=fb(23); cw=min(ts(d,label,fo)[0]+40,760)
        if x+cw>920: x=160; y+=62
        rr(d,(x,y,x+cw,y+50),11,color,outline=color,width=2,alpha=.13*a)
        text(d,label,(x+20,y+26),23,color,font_obj=fo,alpha=a,anchor='lm')
        x+=cw+12

def match_scene(d,t,a):
    local=max(0,t-9.8)
    claimed=[]
    # timeline
    h_status='waiting'; m_status='waiting'; dev_status='waiting'; r_status='waiting'
    h_typed=''; m_typed=''; dev_typed=''; r_typed=''
    scores=[0,0,0,0]
    if local>0.6:
        h_typed='stone'[:min(5,int((local-.6)/.18)+1)]
    if local>1.8:
        h_typed='stone'; h_status='claimed'; claimed.append(('stone','Harshit',ACC)); scores[0]=3
    if local>2.4:
        m_typed='stone'[:min(5,int((local-2.4)/.18)+1)]
    if local>3.5:
        m_typed='stone'; m_status='blocked'
    if local>4.4:
        dev_typed='tones'[:min(5,int((local-4.4)/.18)+1)]
    if local>5.5:
        dev_typed='tones'; dev_status='claimed'; claimed.append(('tones','Dev',GREEN)); scores[2]=3
    if local>6.2:
        r_typed='note'[:min(4,int((local-6.2)/.18)+1)]
    if local>7.1:
        r_typed='note'; r_status='claimed'; claimed.append(('note','Riya',PURPLE)); scores[3]=3
    if local>7.8:
        h_typed='nest'; h_status='claimed'; claimed.append(('nest','Harshit',ACC)); scores[0]=6

    centered(d,'source word: stonework',295,44,TEXT,bold=True,alpha=a)
    centered(d,'one word can be claimed only once',380,34,ACC,bold=True,alpha=a)
    y=500
    player_row(d,115,y,'Harshit',ACC,h_typed,h_status,a,scores[0]); y+=112
    player_row(d,115,y,'Maya',BLUE,m_typed,m_status,a,scores[1]); y+=112
    player_row(d,115,y,'Dev',GREEN,dev_typed,dev_status,a,scores[2]); y+=112
    player_row(d,115,y,'Riya',PURPLE,r_typed,r_status,a,scores[3])
    if m_status=='blocked':
        blink=.55+.45*abs(math.sin(t*8))
        rr(d,(160,1000,920,1110),16,RED,outline=RED,width=3,alpha=.16*a*blink)
        centered(d,'stone is already claimed by Harshit',1055,34,RED,bold=True,alpha=a,max_width=720)
    claimed_board(d,claimed,a)

def frame(t):
    im=Image.new('RGB',(W,H),BG); ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov); bg(d,t)
    a=alpha_for(t,0,4.2)
    if a:
        centered(d,'claim mode',410-ease(t)*24,88,ACC,bold=True,alpha=a)
        centered(d,'Every word is first-come, first-served.',600,50,TEXT,bold=True,alpha=a)
        centered(d,'If someone claims a word, nobody else can use it.',715,42,ACC,bold=True,alpha=a,max_width=900)
        centered(d,'Steal the obvious words before your friends do.',835,34,SUB,alpha=a)
    a=alpha_for(t,4.7,9.2)
    if a:
        centered(d,'the rule',310,48,ACC,bold=True,alpha=a)
        rr(d,(135,480,945,690),22,PANEL,outline=ACC,width=2,alpha=.96*a)
        centered(d,'Harshit submits: stone',555,44,TEXT,bold=True,alpha=a)
        centered(d,'stone is now claimed',640,38,GREEN,bold=True,alpha=a)
        rr(d,(135,800,945,1010),22,PANEL,outline=RED,width=2,alpha=.96*a)
        centered(d,'Maya submits: stone',875,44,TEXT,bold=True,alpha=a)
        centered(d,'blocked: already claimed by Harshit',960,34,RED,bold=True,alpha=a,max_width=760)
    a=alpha_for(t,9.7,22.8,fade=.55)
    if a: match_scene(d,t,a)
    a=alpha_for(t,23.2,27.2)
    if a:
        centered(d,'why it feels different',330,48,ACC,bold=True,alpha=a)
        centered(d,'Common words disappear fast.',520,44,TEXT,bold=True,alpha=a)
        centered(d,'You need speed, but also backup words.',625,42,TEXT,bold=True,alpha=a)
        rr(d,(165,835,915,1055),22,PANEL,outline=ACC,width=2,alpha=.96*a)
        centered(d,'Claim obvious words early.',915,42,ACC,bold=True,alpha=a)
        centered(d,'Switch quickly when a word is already taken.',1000,34,SUB,alpha=a,max_width=690)
    a=alpha_for(t,27.65,31,fade=.55)
    if a:
        centered(d,'claim mode',475,78,ACC,bold=True,alpha=a)
        centered(d,'one word · one player',605,42,TEXT,bold=True,alpha=a)
        centered(d,'first to submit owns it · duplicates are blocked',700,34,SUB,alpha=a,max_width=900)
        rr(d,(250,900,830,996),14,ACC,alpha=a)
        d.text((540,948),'try claim mode',font=fb(38),fill=rgba(BG,a),anchor='mm')
        centered(d,'Words of Word',1160,36,SUB,alpha=a)
    return Image.alpha_composite(im.convert('RGBA'),ov).convert('RGB')

frame(15.0).save(PREVIEW)
writer=imageio.get_writer(TMP,fps=FPS,codec='libx264',quality=8,macro_block_size=None)
for i in range(int(DUR*FPS)): writer.append_data(np.asarray(frame(i/FPS)))
writer.close()
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
if os.path.exists(AUDIO):
    subprocess.run([ffmpeg,'-y','-i',TMP,'-stream_loop','-1','-i',AUDIO,'-t',str(DUR),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-shortest',OUT],check=True); os.remove(TMP)
else: os.replace(TMP,OUT)
print(OUT); print(PREVIEW)
