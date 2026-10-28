"""Stage: subset the font to the characters the film shows -> app/public/fonts/.

The film is set in the game's typeface, 汉仪润圆 65W (assets/fonts/, supplied by the user). Character set:
data/lyrics.json, data/chapters.json, pipeline/ui_strings.txt (display strings hard-coded in scenes), script_src.py
(every narration line), plus ASCII and CJK punctuation. A CFF (OTF) source would be converted to TrueType quadratics
(cu2qu, 1 unit) after subsetting, as opentype.js reads CID-keyed CFF unreliably.

usage:  uv run python pipeline/fonts.py
"""
import json

from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

from paths import DATA, FONTS, FONTS_OUT, PIPE
from script_src import all_lines

TARGETS = {
    'HYRunYuan.ttf': 'runyuan',
}


def charset() -> str:
    s = set(chr(c) for c in range(0x20, 0x7F))
    s |= set('，。、！？：；“”‘’（）《》〈〉【】…—～·「」『』　–×→←↑↓∞')
    s |= set((PIPE / 'ui_strings.txt').read_text(encoding='utf-8'))
    for p in (DATA / 'lyrics.json', DATA / 'chapters.json'):
        s |= set(p.read_text(encoding='utf-8'))
    for _, _, l in all_lines():
        s |= set(l.text)
    return ''.join(sorted(c for c in s if c.isprintable() or c == '　'))


def cff_to_glyf(font: TTFont):
    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    font['glyf'] = glyf
    font['loca'] = newTable('loca')
    del font['CFF ']
    if 'VORG' in font:
        del font['VORG']
    maxp = font['maxp']
    maxp.tableVersion = 0x00010000
    for k in ('maxZones', 'maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs',
              'maxStackElements', 'maxSizeOfInstructions', 'maxComponentElements'):
        setattr(maxp, k, 0)
    maxp.maxZones = 1
    font['head'].indexToLocFormat = 0
    font['head'].glyphDataFormat = 0
    font['post'].formatType = 2.0
    font['post'].extraNames = []
    font['post'].mapping = {}
    font.sfntVersion = '\x00\x01\x00\x00'


def cut(src, text: str, out):
    font = TTFont(src)
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    if 'CFF ' in font:
        cff_to_glyf(font)
    font.save(out)
    print(f'{out.name}: {out.stat().st_size // 1024} KB')


def main():
    text = charset()
    print(len(text), 'characters')
    for out, key in TARGETS.items():
        cut(FONTS[key], text, FONTS_OUT / out)


if __name__ == '__main__':
    main()
