"""Import the pinned Legado visual resources without changing their paths."""
from pathlib import Path
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT.parent / 'upstream/legado/app/src/main/res'
OUT = ROOT / 'public/legado'
OUT.mkdir(parents=True, exist_ok=True)
A = '{http://schemas.android.com/apk/res/android}'
ATTR = '{http://schemas.android.com/aapt}attr'

def color(value):
    if value.startswith('#') and len(value) == 9:
        return '#' + value[3:] + value[1:3]
    return value

def vector(path, tint=False):
    root = ET.parse(path).getroot()
    defs, seq = [], [0]
    def render(el):
        if el.tag == 'group':
            x, y = el.get(A+'pivotX', '0'), el.get(A+'pivotY', '0')
            transform = f"translate({el.get(A+'translateX','0')} {el.get(A+'translateY','0')}) translate({x} {y}) rotate({el.get(A+'rotation','0')}) scale({el.get(A+'scaleX','1')} {el.get(A+'scaleY','1')}) translate({-float(x)} {-float(y)})"
            return '<g transform="'+transform+'">'+''.join(render(c) for c in el)+'</g>'
        if el.tag != 'path':
            return ''
        fill = 'currentColor' if tint and el.get(A+'fillColor') else color(el.get(A+'fillColor', 'none'))
        stroke = 'currentColor' if tint and el.get(A+'strokeColor') else color(el.get(A+'strokeColor', 'none'))
        gradient = el.find(f'{ATTR}/gradient')
        if gradient is not None:
            seq[0] += 1
            gid = path.stem + str(seq[0])
            stops = ''.join(f'<stop offset="{s.get(A+"offset")}" stop-color="{color(s.get(A+"color"))}"/>' for s in gradient)
            defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{gradient.get(A+"startX")}" y1="{gradient.get(A+"startY")}" x2="{gradient.get(A+"endX")}" y2="{gradient.get(A+"endY")}">{stops}</linearGradient>')
            fill = f'url(#{gid})'
        return f'<path d="{el.get(A+"pathData")}" fill="{fill}" fill-opacity="{el.get(A+"fillAlpha","1")}" fill-rule="{el.get(A+"fillType","nonzero")}" stroke="{stroke}" stroke-width="{el.get(A+"strokeWidth","0")}" stroke-linecap="{el.get(A+"strokeLineCap","butt")}" stroke-linejoin="{el.get(A+"strokeLineJoin","miter")}"/>'
    body = ''.join(render(c) for c in root)
    return root.get(A+'viewportWidth'), root.get(A+'viewportHeight'), ''.join(defs), body

names = ['ic_bottom_'+part+'_'+state for part in ['books','explore','rss_feed','person'] for state in ['e','s']]
names += ['ic_search','ic_more_vert','ic_edit','ic_add','ic_cfg_source','ic_cfg_replace','ic_cfg_theme','ic_cfg_backup','ic_cfg_other','ic_cfg_about','ic_bookmark','ic_history','ic_folder_outline','ic_download','ic_exit','ic_translate','ic_auto_page','ic_cfg_web','ic_refresh_black_24dp']
names += ['ic_sort','ic_groups','ic_author','ic_web_outline','ic_book_last','ic_search_hint']
names += ['ic_toc','ic_read_aloud','ic_interface_setting','ic_settings','ic_brightness','ic_auto_page']
manifest = []
for name in names:
    source = UPSTREAM / 'drawable' / (name+'.xml')
    w, h, defs, body = vector(source, True)
    (OUT / (name+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>\n', encoding='utf-8')
    manifest.append({'source':str(source.relative_to(UPSTREAM)).replace('\\','/'),'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
for name in ['icon_read_book.png','image_cover_default.jpg']:
    source = UPSTREAM / 'drawable' / name
    shutil.copyfile(source, OUT / name)
    manifest.append({'source':'drawable/'+name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})

layers = [vector(UPSTREAM/'drawable'/f'ic_launcher1{suffix}.xml') for suffix in ['_b','']]
defs = ''.join(v[2] for v in layers)
body = ''.join(v[3] for v in layers)
# The Android adaptive icon's visible viewport is the central 72 x 72 dp.
icon = f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="18 18 72 72"><defs>{defs}</defs>{body}</svg>\n'
(ROOT/'app-icon.svg').write_text(icon, encoding='utf-8')
(OUT/'app-icon.svg').write_text(icon, encoding='utf-8')
native = ROOT/'mobile/android/res'
for name in ['ic_launcher1.xml','ic_launcher1_b.xml','ic_launcher4.xml']:
    (native/'drawable').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(UPSTREAM/'drawable'/name, native/'drawable'/name)
for density in ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi']:
    dest = native/('mipmap-'+density)
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(UPSTREAM/('mipmap-'+density)/'ic_launcher.png', dest/'ic_launcher.png')
    shutil.copyfile(UPSTREAM/('mipmap-'+density)/'ic_launcher.png', dest/'ic_launcher_round.png')
(native/'mipmap-anydpi-v26').mkdir(parents=True, exist_ok=True)
for name in ['ic_launcher.xml','ic_launcher_round.xml']:
    shutil.copyfile(UPSTREAM/'mipmap-anydpi-v26/ic_launcher.xml', native/'mipmap-anydpi-v26'/name)
(OUT/'resources.json').write_text(json.dumps({'repository':'https://github.com/LegadoTeam/legado','commit':'330e606c4d57e08adc056ff8ab7a4132c784da9a','license':'GPL-3.0','resources':manifest},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Imported {len(manifest)} visual resources and the original adaptive launcher layers.')
