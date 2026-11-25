"""Build a reproducible inventory; presence is never treated as feature parity."""
import argparse
import csv
import io
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--legado', default='../upstream/legado')
parser.add_argument('--md3', default='../evidence/comprehensive-audit-20261125/md3-pinned')
parser.add_argument('--releases', default='../evidence/comprehensive-audit-20261125')
args = parser.parse_args()
OUT = Path('docs/audit')
OUT.mkdir(parents=True, exist_ok=True)
A = '{http://schemas.android.com/apk/res/android}'
APP = '{http://schemas.android.com/apk/res-auto}'
rows, layouts, methods, compose, settings_keys = [], [], [], [], []
vm = Path('src/source-vm.js').read_text(encoding='utf-8')
for repo, root in [('legado', Path(args.legado)), ('md3', Path(args.md3))]:
    res = root / 'app/src/main/res'
    strings = {}
    for dirname in ['values', 'values-zh', 'values-zh-rCN']:
        for file in sorted((res/dirname).glob('*.xml')):
            for el in ET.parse(file).getroot().findall('string'):
                strings[el.get('name')] = ''.join(el.itertext()).replace('\n', ' ')
    def resolve(text):
        return strings.get(text.removeprefix('@string/'), text) if text else ''
    for kind, folder, pattern in [('menu','menu','*.xml'),('preference','xml','pref*.xml')]:
        for file in sorted((res/folder).glob(pattern)):
            for el in ET.parse(file).getroot().iter():
                key = el.get(A+'id') if kind == 'menu' else el.get(A+'key')
                if not key:
                    continue
                rows.append({'upstream':repo,'kind':kind,'file':str(file.relative_to(root)).replace('\\','/'),'key':key.removeprefix('@+id/'),'title':resolve(el.get(A+'title')),'summary':resolve(el.get(A+'summary')),'default':el.get(A+'defaultValue',''),'action':el.get(APP+'showAsAction',''),'status':'未逐项验收','implementation':'','evidence':''})
    for file in sorted((res/'layout').glob('*.xml')):
        tree=ET.parse(file).getroot()
        layouts.append({'upstream':repo,'file':str(file.relative_to(root)).replace('\\','/'),'root':tree.tag,'controls':sum(1 for _ in tree.iter()),'status':'未逐页验收'})
    java = root/'app/src/main/java/io/legado/app'
    for file in sorted([*(java/'ui').rglob('*.kt'), *(java/'feature').rglob('*.kt')]):
        text = file.read_text(encoding='utf-8')
        if '@Composable' in text:
            for match in re.finditer(r'@Composable[\s\S]{0,400}?\bfun\s+(\w+)\s*\(', text):
                compose.append({'upstream':repo,'file':str(file.relative_to(root)).replace('\\','/'),'line':text[:match.start()].count('\n')+1,'component':match.group(1),'status':'未逐页验收'})
        if any(part in file.name for part in ['Settings', 'Config', 'Preference']):
            for i,line in enumerate(text.splitlines(),1):
                for key in re.findall(r'PreferKey\.(\w+)',line):
                    settings_keys.append({'upstream':repo,'file':str(file.relative_to(root)).replace('\\','/'),'line':i,'key':key,'status':'未逐项验收'})
    for relative in ['help/JsExtensions.kt','help/JsEncodeUtils.kt','model/analyzeRule/AnalyzeRule.kt','model/analyzeRule/RuleData.kt','model/analyzeRule/RuleDataInterface.kt','ui/login/SourceLoginJsExtensions.kt','help/webView/WebJsExtensions.kt']:
        file = java/relative
        if not file.exists():
            continue
        for i,line in enumerate(file.read_text(encoding='utf-8').splitlines(),1):
            match=re.search(r'^\s*(?:(?:override|suspend|open|public)\s+)*fun\s+(\w+)\s*\(',line)
            if match:
                name=match.group(1)
                present=bool(re.search(r'\b'+re.escape(name)+r'\s*(?:\(|:|=)',vm))
                methods.append({'upstream':repo,'file':'app/src/main/java/io/legado/app/'+relative,'line':i,'method':name,'signature':line.strip(),'status':'存在同名入口，语义待验证' if present else '未发现兼容入口','evidence':'src/source-vm.js' if present else ''})

def write_csv(name,data):
    with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(data[0]));writer.writeheader();writer.writerows(data)
write_csv('menus-settings.csv',rows)
write_csv('layouts.csv',layouts)
write_csv('script-api.csv',methods)
if compose: write_csv('compose-ui.csv',compose)
if settings_keys: write_csv('settings-key-usage.csv',settings_keys)
release_rows=[]
for repo in ['legado','md3']:
    pages=json.loads((Path(args.releases)/(repo+'-releases.json')).read_text(encoding='utf-8-sig'))
    for release in [r for page in pages for r in page]:
        for line in (release.get('body') or '').splitlines():
            line=line.strip()
            if line and not line.startswith(('<','[!','![')):
                release_rows.append({'upstream':repo,'tag':release['tag_name'],'name':release['name'],'prerelease':release['prerelease'],'release':release['html_url'],'change':line,'status':'未逐项验证'})
write_csv('release-changes.csv',release_rows)
summary={'baselines':{'legado':'330e606c4d57e08adc056ff8ab7a4132c784da9a','md3':'222978c5d00aec0f285610e6f3ed0d0936596743'},'menusAndPreferences':len(rows),'layouts':len(layouts),'composeComponents':len(compose),'settingsKeyUsages':len(settings_keys),'scriptSignatures':len(methods),'releaseLines':len(release_rows),'note':'Inventory only. File/name presence is not functional or visual parity. See COVERAGE.md for reviewed feature domains.'}
(OUT/'inventory.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=True))
