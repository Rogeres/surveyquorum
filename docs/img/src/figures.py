# README figures and the problem animation, typeset like GitHub renders Markdown (no captions inside the images: captions are text in the README):
# system font stack, 16 px body, GitHub light palette. Width 880 px = the README column.
# Usage: python3 figures.py <outdir>   → writes two-places.ru.svg, four-levels.ru.svg and frames/ for the GIF.
import html, json, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
W = 880
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
INK, SUB, MUTE, LINE, SUBTLE, BLUE, BLUE_BG, BLUE_LINE, RED, RED_BG = '#1f2328', '#59636e', '#6e7781', '#d0d7de', '#f6f8fa', '#0969da', '#ddf4ff', '#b6e3ff', '#cf222e', '#ffebe9'
def svg(h, body): return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" viewBox="0 0 {W} {h}" font-family="{FONT}"><rect width="{W}" height="{h}" fill="#ffffff"/>{body}</svg>'
def t(x, y, s, size=16, fill=INK, weight=400, anchor='start', extra=''):
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{html.escape(s)}</text>'
def ov(x, y, s, fill=MUTE): return t(x, y, s, 12, fill, 600, extra='letter-spacing=".06em"')
def box(x, y, w, h, fill='#ffffff', stroke=LINE, sw=1, r=6): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def arrow_v(x, y1, y2): return f'<path d="M{x} {y1} V{y2}" stroke="{LINE}" stroke-width="1.5" fill="none"/><path d="M{x-5} {y2-6} L{x} {y2} L{x+5} {y2-6}" stroke="{LINE}" stroke-width="1.5" fill="none"/>'

def two_places():
    b = []
    b.append(f'<line x1="40" y1="78" x2="840" y2="78" stroke="{LINE}" stroke-width="2"/>')
    for cx, lab, hd, sub, on in ((170, 'ДО ПОЛЯ', 'Скрининг и анкета', 'кто попадёт в выборку', True), (440, 'ПОЛЕ', 'Сбор ответов', 'анкета уже не меняется', False), (710, 'ПОСЛЕ ПОЛЯ', 'Ответы', 'что останется в данных', True)):
        b.append(f'<circle cx="{cx}" cy="78" r="8" fill="{BLUE if on else "#ffffff"}" stroke="{BLUE if on else LINE}" stroke-width="2"/>')
        b.append(ov(cx, 44, lab, MUTE if not on else BLUE, ) .replace('text-anchor="start"', 'text-anchor="middle"'))
        b.append(t(cx, 116, hd, 18, INK if on else MUTE, 600, 'middle'))
        b.append(t(cx, 140, sub, 16, SUB if on else MUTE, 400, 'middle'))
    for cx, name, sub in ((170, 'скилл screener-design', 'каталог из 25 ошибок'), (710, 'движок Quorum', '10 проверок, вердикт кворумом')):
        b.append(f'<line x1="{cx}" y1="152" x2="{cx}" y2="180" stroke="{BLUE_LINE}" stroke-width="2"/>')
        b.append(box(cx-130, 180, 260, 70, BLUE_BG, BLUE_LINE))
        b.append(t(cx, 208, name, 16, BLUE, 600, 'middle'))
        b.append(t(cx, 234, sub, 16, SUB, 400, 'middle'))
    return svg(274, ''.join(b))

def four_levels():
    b = []
    y = 24
    b.append(box(40, y, 800, 72)); b.append(ov(60, y+28, 'ДО ОПРОСА')); b.append(t(60, y+54, 'Отпечаток устройства', 18, INK, 600)); b.append(t(340, y+54, 'повторные входы и дубли респондентов', 16, SUB))
    b.append(arrow_v(440, y+72, y+96)); y += 96
    b.append(box(40, y, 800, 222)); b.append(ov(60, y+28, 'УРОВЕНЬ 1 · ДЕТЕКТОРЫ')); b.append(t(60, y+56, 'Проверки внутри опроса', 18, INK, 600))
    rows = [('Открытые ответы', True), ('Согласованность ответов', True), ('Темп по вопросам', False), ('Матрицы и массовый выбор', False), ('Прототип, сайт, сортировка', False), ('Дубли ответов, тексты из ИИ', False)]
    for i, (label, llm) in enumerate(rows):
        cx = 60 + (i % 2) * 392; cy = y + 72 + (i // 2) * 42
        b.append(box(cx, cy, 376, 34, SUBTLE, SUBTLE)); b.append(t(cx+12, cy+22, label, 16, INK))
        if llm: b.append(box(cx+312, cy+8, 52, 18, BLUE_BG, BLUE_BG, r=4) + t(cx+338, cy+21, 'LLM', 11, BLUE, 600, 'middle'))
    b.append(t(60, y+204, 'Детектор отдаёт сигнал с силой, не вердикт', 16, SUB))
    b.append(arrow_v(440, y+222, y+246)); y += 246
    b.append(box(40, y, 800, 236, '#ffffff', BLUE, 1.5)); b.append(ov(60, y+28, 'УРОВЕНЬ 2 · КВОРУМ', BLUE)); b.append(t(60, y+56, 'Сводная оценка', 18, INK, 600)); b.append(t(230, y+56, 'вероятность брака по совокупности сигналов', 16, SUB))
    for i, (bg, dot, label) in enumerate(((RED_BG, RED, 'block · совокупность сигналов с высокой вероятностью предсказывает брак'), (SUBTLE, BLUE, 'review · сигналы есть, но уверенности нет: смотрит человек'), (SUBTLE, MUTE, 'keep · сигналов нет: ответ не трогаем'))):
        cy = y + 72 + i * 44
        b.append(box(60, cy, 760, 36, bg, bg)); b.append(f'<circle cx="78" cy="{cy+18}" r="4" fill="{dot}"/>'); b.append(t(92, cy+23, label, 16, INK))
    b.append(t(60, y+218, 'Веса сигналов измерены на большой размеченной выборке; у вердикта есть улики', 16, SUB))
    b.append(arrow_v(440, y+236, y+260)); y += 260
    b.append(box(40, y, 800, 60)); b.append(ov(60, y+36, 'ЕСЛИ НУЖНО')); b.append(t(230, y+38, 'Ручная проверка', 18, INK, 600)); b.append(t(420, y+38, 'только очередь review, с уликами', 16, SUB)); y += 60
    return svg(y+24, ''.join(b))

# ---------- problem animation: four scenes, entrance order and delays copied from the deck's slide XML ----------
FPS = 10; FADE = 0.5; RISE = 22; HOLD = 2.0; SH = 440   # scene height
def ease(t0, t):  # 0..1 progress of a float-in that started at t0
    return max(0.0, min(1.0, (t - t0) / FADE))
def floating(x, y, p, inner):  # inner drawn at (x,y) with group transform; p = progress
    dy = RISE * (1 - p)
    return f'<g transform="translate({x:.1f},{y+dy:.1f})" opacity="{p:.3f}">{inner}</g>'
def title(s): return t(40, 44, s, 20, INK, 600)
def wrap(s, maxc):
    words, lines, cur = s.split(' '), [], ''
    for w_ in words:
        if cur and len(cur) + 1 + len(w_) > maxc: lines.append(cur); cur = w_
        else: cur = (cur + ' ' + w_).strip()
    if cur: lines.append(cur)
    return lines
def card_text(w, h, s, size=16, pad=14, rot=0):
    lines = wrap(s, int((w - 2*pad) / (size*0.52)))
    h = max(h, 20 + len(lines)*22)
    inner = box(0, 0, w, h) + ''.join(t(pad, 30 + i*22 - (size*0.36 if len(lines)==1 and h==44 else 0) + (2 if len(lines)>1 else 0), ln, size, INK) for i, ln in enumerate(lines))
    return f'<g transform="rotate({rot} {w/2} {h/2})">{inner}</g>' if rot else inner

def scene_open_answers():
    # deck slide 4: positions from the slide XML, scaled 1920→880 and shifted up; texts transcribed, blurred spans as […]
    K = 880/1920; OY = 100
    q = (405, 256, 1110, 212, 200)
    cards = [(165,476,463,150,1300,'пывадлж ловлыо рпорьб',-2),(709,471,154,126,1850,'123',3),(1074,513,418,134,2400,'ОТВЕТ ОТВЕТ ОТВЕТ',-2),(230,615,635,142,2950,'Расскажите о первом впечатлении',2),(925,635,180,132,3500,'норм',-3),(1305,610,189,132,4050,'ХЗ ХЗ',2),(411,734,740,197,4600,'подписка это хорошо. а я щас кстати слушаю […]',-2),(1140,743,587,158,5150,"I don't get what you want from me",3),(198,862,552,154,5700,'засуньте себе свою подписку',-2),(1039,886,212,136,6250,'Клокок',3),(1338,840,470,219,6800,'первое впечатление что вы […] и ваш опрос […]',2)]
    total = 6.8 + FADE + HOLD
    frames = []
    for i in range(int(total*FPS)):
        tm = i / FPS; b = [title('Что реально приходит в данных')]
        p = ease(q[4]/1000, tm)
        if p > 0:
            w, h = q[2]*K, 86
            b.append(floating(q[0]*K, (q[1]-OY)*K, p, box(0,0,w,h) + ov(16, 30, 'ОТКРЫТЫЙ ВОПРОС', BLUE) + t(16, 62, '«Как вы поняли, что такое подписка X?»', 18, INK, 600)))
        for (x,y,w,h,d,s,rot) in cards:
            p = ease(d/1000, tm)
            if p > 0:
                cw = w*K if len(s) > 30 else max(w*K, len(s)*8.4+28); ch = 44
                b.append(floating(x*K, (y-OY)*K, p, card_text(cw, ch, s, 16, 14, rot)))
        frames.append(svg(SH, ''.join(b)))
    return frames

def scene_coherence():
    K = 880/1920; OY = 60
    def qa(w, qid, q, a):
        h = 128; ls = wrap(q, int((w-32)/7.8))
        return box(0,0,w,h) + ov(16, 30, qid) + ''.join(t(16, 56 + i*20, ln, 15, SUB) for i, ln in enumerate(ls)) + t(16, 108, f'«{a}»', 22, INK, 700)
    def note(w, s): return box(0,0,w,30,RED_BG,RED_BG,r=15) + f'<circle cx="16" cy="15" r="3" fill="{RED}"/>' + t(28, 20, s, 14, RED, 600)
    items = [(111,213,822,'k1a',400),(949,213,860,'k1x',1300),(635,520,650,'k1b',2100),(112,636,820,'k2a',3100),(949,633,860,'k2x',4000),(548,939,824,'k2b',4800)]
    content = {'k1a': lambda w: qa(w,'Q3','Сколько человек проживают вместе с вами, включая вас?','Один'),
               'k1x': lambda w: qa(w,'Q4','Сколько среди них детей до 18?','Два'),
               'k1b': lambda w: note(w,'Живёт один — но среди него двое детей'),
               'k2a': lambda w: qa(w,'Q2','Сколько сотрудников в вашей организации?','От 50 до 100'),
               'k2x': lambda w: qa(w,'Q11','Сколько сотрудников в организации используют CRM?','Более 250'),
               'k2b': lambda w: note(w,'CRM-пользователей больше, чем людей в компании')}
    total = 4.8 + FADE + HOLD; frames = []
    for i in range(int(total*FPS)):
        tm = i / FPS; b = [title('…и логические противоречия')]
        for (x,y,w,name,d) in items:
            p = ease(d/1000, tm)
            if p > 0: b.append(floating(x*K, (y-OY)*K, p, content[name](w*K)))
        if ease(1.3, tm) >= 1: b.append(t(440, 141, '✕', 18, RED, 700, 'middle'))
        if ease(4.0, tm) >= 1: b.append(t(440, 335, '✕', 18, RED, 700, 'middle'))
        frames.append(svg(SH, ''.join(b)))
    return frames

def scene_cardsort():
    b = [title('…и халтура в карточной сортировке')]
    b.append(box(120, 64, 640, 70) + ov(136, 90, 'ЗАДАНИЕ', BLUE) + t(136, 118, '«Разложите продукты по группам и назовите каждую»', 17, INK, 600))
    groups = [['Молоко','Хлеб','Яблоки','Порошок'],['Сыр','Зубная паста','Курица','Бананы'],['Мыло','Йогурт','Макароны','Кофе']]
    for g, items in enumerate(groups):
        x = 60 + g*260
        b.append(box(x, 156, 240, 236, SUBTLE, LINE) + t(x+16, 184, str(g+1), 18, INK, 700))
        for k, s in enumerate(items): b.append(box(x+16, 196+k*46, 208, 36) + t(x+30, 220+k*46, s, 16, INK))
    return [svg(SH, ''.join(b))] * int(3.5*FPS)

def scene_prototype_bg():
    b = [title('…и сдаётся в Figma-прототипе')]
    b.append(box(40, 64, 500, 312))   # the video is overlaid here by ffmpeg (x=44,y=68,w=492)
    for k, (big, small) in enumerate((('0 кликов', 'по прототипу'), ('2 секунды', 'на всё задание'), ('5 из 5', '«просто выполнить задание»'))):
        y = 64 + k*106
        b.append(box(572, y, 268, 94) + t(588, y+40, big, 22, RED, 700) + t(588, y+68, small, 15, SUB))
    return svg(SH, ''.join(b))

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    open(f'{OUT}/two-places.ru.svg','w').write(two_places())
    open(f'{OUT}/four-levels.ru.svg','w').write(four_levels())
    fr = f'{OUT}/frames'; os.makedirs(fr, exist_ok=True)
    for name, frames in (('a', scene_open_answers()), ('b', scene_coherence()), ('c', scene_cardsort())):
        for i, f in enumerate(frames): open(f'{fr}/{name}{i:03d}.svg','w').write(f)
        print(name, len(frames))
    open(f'{fr}/d000.svg','w').write(scene_prototype_bg())
    print('figures written to', OUT)
