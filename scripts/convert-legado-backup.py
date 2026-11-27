"""Convert a verified, extracted Android Legado backup without contacting sources.

Usage: python convert-legado-backup.py BACKUP_DIRECTORY OUTPUT_JSON
The directory contains extracted/, local-books/manifest-private.json and,
optionally, original-device-id-private.json. All output contains private data.
"""
import argparse
import base64
import hashlib
import json
import re
import sqlite3
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def parsed(value, fallback=None):
    if not isinstance(value, str):
        return value if value is not None else fallback
    try:
        return json.loads(value)
    except ValueError:
        return fallback


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def md5short(value):
    return hashlib.md5(value.encode()).hexdigest()[8:24]


def preferences(directory):
    result = {}
    for path in directory.glob('*.xml'):
        items = {}
        for element in ET.parse(path).getroot():
            value = element.get('value', element.text or '')
            if element.tag == 'boolean':
                value = value == 'true'
            elif element.tag in ('int', 'long', 'float'):
                value = float(value) if element.tag == 'float' else int(value)
            elif element.tag == 'set':
                value = [child.text or '' for child in element]
            items[element.get('name')] = value
        result[path.name] = items
    return result


def convert(directory):
    root = directory / 'extracted/data/user/0/com.legado.app.release'
    database = sqlite3.connect((root / 'databases/legado.db').resolve().as_uri() + '?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    if database.execute('pragma quick_check').fetchone()[0] != 'ok':
        raise ValueError('Original database failed quick_check')
    tables = {}
    for (table,) in database.execute("select name from sqlite_master where type='table'"):
        if table.startswith(('sqlite_', 'room_', 'android_')):
            continue
        tables[table] = [dict(row) for row in database.execute('select * from "' + table.replace('"', '""') + '"')]
    database.close()
    original_counts = {key: len(value) for key, value in tables.items()}
    prefs = preferences(root / 'shared_prefs')
    app_prefs = prefs.get('com.legado.app.release_preferences.xml', {})
    files = {p.name: json.loads(p.read_text(encoding='utf-8')) for p in (root / 'files').glob('*.json')}
    configs = files.get('readConfig.json', [])
    config_index = max(0, min(int(app_prefs.get('readStyleSelect', 0)), len(configs) - 1))
    config = configs[config_index] if configs else {}
    indent = len(config.get('paragraphIndent', '\u3000\u3000').encode('utf-16-le')) // 2
    title_visible = config.get('titleMode', 0) != 2
    groups = [{'id': 'legado-group-' + str(g['groupId']), 'name': g['groupName'], 'order': g['order'],
               'show': bool(g['show']), 'enableRefresh': bool(g['enableRefresh']), 'legacy': g}
              for g in tables.get('book_groups', [])]
    by_book = {}
    for row in tables.get('chapters', []):
        by_book.setdefault(row['bookUrl'], []).append(row)
    cache_root = directory / 'extracted/sdcard/Android/data/com.legado.app.release/files/book_cache'
    cache_folders = {p.name[-16:]: p for p in cache_root.iterdir() if p.is_dir()} if cache_root.exists() else {}
    local_manifest = directory / 'local-books/manifest-private.json'
    local_files = {row['url']: row for row in json.loads(local_manifest.read_text(encoding='utf-8'))} if local_manifest.exists() else {}
    books, issues = [], []
    cached_chapters = local_chapters = 0
    for row in tables.get('books', []):
        local = bool(row['type'] & 256)
        config_book = parsed(row.get('readConfig'), {}) or {}
        original_chapters = sorted(by_book.get(row['bookUrl'], []), key=lambda c: c['index'])
        folder = cache_folders.get(md5short(row['bookUrl']))
        local_entry = local_files.get(row['bookUrl'])
        raw = (directory / 'local-books' / local_entry['file']).read_bytes() if local_entry and local_entry['copied'] else None
        charset = row.get('charset') or 'utf-8'
        chapters = []
        for chapter in original_chapters:
            converted = {**chapter, 'variables': parsed(chapter.get('variable'), {}),
                         'isVolume': bool(chapter['isVolume']), 'isVip': bool(chapter['isVip']), 'isPay': bool(chapter['isPay'])}
            cached = folder / f"{chapter['index']:05d}-{md5short(chapter['title'])}.nb" if folder else None
            if cached and cached.exists():
                converted['content'] = cached.read_text(encoding='utf-8')
                cached_chapters += 1
            elif raw is not None and chapter.get('start') is not None and chapter.get('end') is not None:
                start, end = chapter['start'], chapter['end']
                if not 0 <= start <= end <= len(raw):
                    raise ValueError('Local chapter byte range is outside its original file')
                try:
                    local_text = raw[start:end].decode(charset)
                except UnicodeDecodeError:
                    # Kotlin String(byte[], charset) also substitutes malformed byte sequences.
                    local_text = raw[start:end].decode(charset, errors='replace')
                    issues.append({'bookId': 'legado-' + digest(row['bookUrl']), 'chapter': chapter['index'], 'reason': 'original-byte-boundary-replacement'})
                converted['content'] = re.sub(r'^[\n\s]+', '\u3000\u3000', local_text)
                local_chapters += 1
            chapters.append(converted)
        old_index = row['durChapterIndex']
        index = next((i for i, c in enumerate(chapters) if c['index'] == old_index), min(max(0, old_index), max(0, len(chapters) - 1)))
        book = {'id': 'legado-' + digest(row['bookUrl']), 'name': row['name'], 'author': row['author'],
                'intro': row.get('customIntro') or row.get('intro') or '', 'cover': row.get('customCoverUrl') or row.get('coverUrl') or '',
                'kind': 'txt' if local else 'online', 'sourceUrl': row['origin'], 'url': row['bookUrl'], 'tocUrl': row['tocUrl'],
                'variables': parsed(row.get('variable'), {}), 'chapters': chapters, 'chapter': index, 'offset': 0,
                'added': row['durChapterTime'], 'lastRead': row['durChapterTime'], 'finished': False,
                'note': row.get('customTag') or '', 'bookmarks': [], 'highlights': [], 'canUpdate': bool(row['canUpdate']),
                'order': row['order'], 'latestChapterTime': row['latestChapterTime'],
                'groups': [g['id'] for g in groups if g['legacy']['groupId'] > 0 and row['group'] & g['legacy']['groupId']],
                'reSegment': bool(config_book.get('reSegment', False)),
                'tocExpanded': config_book['tocExpanded'] if config_book.get('tocExpanded') is not None else True,
                'useReplaceRule': config_book.get('useReplaceRule') if config_book.get('useReplaceRule') is not None else bool(app_prefs.get('replaceEnableDefault', True)) and not bool(row['type'] & 64),
                'legacyPosition': {'chapter': old_index, 'position': max(0, row['durChapterPos']), 'indent': indent, 'titleVisible': title_visible},
                'legacy': row}
        if raw is not None:
            book['rawText'] = raw.decode(charset)
        if local and raw is None:
            issues.append({'bookId': book['id'], 'reason': 'local-original-unavailable'})
        if row['type'] & 64:
            issues.append({'bookId': book['id'], 'reason': 'image-reader-not-equivalent'})
        if old_index != (chapters[index]['index'] if chapters else 0):
            issues.append({'bookId': book['id'], 'reason': 'original-index-outside-toc', 'originalIndex': old_index})
        books.append(book)
    bookmark_groups = {}
    for mark in tables.get('bookmarks', []):
        bookmark_groups.setdefault((mark['bookName'], mark['bookAuthor']), []).append(mark)
    matched_bookmarks = set()
    for book in books:
        key = (book['name'], book['author'])
        book['bookmarks'] = [{
            **mark, 'chapter': mark['chapterIndex'], 'offset': 0,
            'title': mark['chapterName'], 'created': mark['time'],
            'positionLayout': {'indent': indent, 'titleVisible': title_visible}
        } for mark in bookmark_groups.get(key, [])]
        matched_bookmarks.add(key)
    detached_bookmarks = [{'record': mark, 'positionLayout': {'indent': indent, 'titleVisible': title_visible}}
                          for key, marks in bookmark_groups.items() if key not in matched_bookmarks for mark in marks]
    sources = []
    for row in tables.get('book_sources', []):
        source = dict(row)
        for key in ['ruleExplore', 'ruleSearch', 'ruleBookInfo', 'ruleToc', 'ruleContent', 'ruleReview']:
            if source.get(key):
                source[key] = json.loads(source[key])
        for key in ['enabled', 'enabledExplore', 'enabledCookieJar']:
            source[key] = bool(source.get(key, True))
        sources.append(source)
    state, shared = {}, {}
    identity_file = directory / 'original-device-id-private.json'
    identity = json.loads(identity_file.read_text(encoding='utf-8')).get('androidId') if identity_file.exists() else None
    caches = {entry['key']: entry for entry in tables.get('caches', [])}
    for entry in caches.values():
        shared['cache:' + entry['key']] = {'value': entry['value'], 'expires': entry['deadline']}
    for entry in tables.get('cookies', []):
        shared['cookie:' + entry['url']] = {'value': entry['cookie']}
    decrypted = 0
    for source in sources:
        key = source['bookSourceUrl']
        target = {}
        if identity:
            target['source:deviceId'] = {'value': identity}
        for prefix, name in [('sourceVariable_', 'variable'), ('loginHeader_', 'loginHeader'), ('userInfo_', 'loginInfo')]:
            entry = caches.get(prefix + key)
            if not entry:
                continue
            value = entry['value']
            if prefix == 'userInfo_':
                try:
                    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
                    from cryptography.hazmat.primitives.padding import PKCS7
                    cipher = Cipher(algorithms.AES(identity.encode()[:16]), modes.ECB()).decryptor()
                    plain = cipher.update(base64.b64decode(value)) + cipher.finalize()
                    unpad = PKCS7(128).unpadder()
                    value = (unpad.update(plain) + unpad.finalize()).decode('utf-8')
                    json.loads(value)
                    decrypted += 1
                except Exception:
                    issues.append({'sourceId': digest(key), 'reason': 'login-info-needs-original-device-id'})
                    continue
            target['source:' + name] = {'value': value, 'expires': entry['deadline']}
        state[key] = target
    records = []
    for row in tables.get('readRecord', []):
        book = next((b for b in books if b['name'] == row['bookName'] and b['author'] == row['author']), None)
        records.append({'id': 'legado-record-' + digest(json.dumps([row['deviceId'], row['bookName'], row['author']], ensure_ascii=False)),
                        'bookId': book['id'] if book else '', 'bookName': row['bookName'], 'chapter': row.get('lastChapterTitle') or '',
                        'started': row['lastRead'], 'seconds': max(0, row['readTime']) / 1000, 'legacy': row})
    rules = []
    for row in tables.get('replace_rules', []):
        rule = {**row, 'order': row.get('sortOrder', 0)}
        for key in ['scopeTitle', 'scopeContent', 'scopeSource', 'isEnabled', 'isRegex']:
            rule[key] = bool(rule[key])
        rules.append(rule)
    txt_rules = [{**r, 'enable': bool(r['enable'])} for r in tables.get('txtTocRules', [])]
    dict_rules = [{**r, 'enabled': bool(r['enabled'])} for r in tables.get('dictRules', [])]
    settings = {'fontSize': config.get('textSize', 20), 'readBold': config.get('textBold', 0) == 1, 'readThin': config.get('textBold', 0) == 2,
                'letterSpacing': config.get('letterSpacing', .1), 'textIndent': indent,
                'paragraphSpace': config.get('paragraphSpacing', 2) / 10,
                'titleAlign': {0: 'left', 1: 'center', 2: 'hidden', 3: 'right'}.get(config.get('titleMode', 0), 'left'),
                'twoPage': bool(app_prefs.get('doubleHorizontalPage', True)),
                'tocCountWords': bool(app_prefs.get('tocCountWords', True)),
                'showBrightnessView': bool(app_prefs.get('showBrightnessView', True)),
                'progressBarBehavior': app_prefs.get('progressBarBehavior', 'page')}
    for edge in ['Top', 'Bottom', 'Left', 'Right']:
        if 'padding' + edge in config:
            settings['readerPadding' + edge] = config['padding' + edge]
    menu = parsed(app_prefs.get('readerMenuConfig'))
    extras = {key: rows for key, rows in tables.items() if key not in ['books', 'chapters', 'book_sources']}
    migration = {'format': 'legado-android-sqlite', 'version': 1, 'originalCounts': original_counts,
                 'tables': extras, 'preferences': prefs, 'configFiles': files, 'issues': issues}
    manager = {'bookGroups': groups, 'replaceRules': rules, 'txtTocRules': txt_rules, 'dictRules': dict_rules,
               'legacyMigration': migration, 'legacySourceState': {'sources': [s['bookSourceUrl'] for s in sources], 'state': shared}}
    if 'ruleSubs' in tables:
        manager['sourceSubscriptions'] = [
            {**row, 'id': str(row['id']) if abs(row['id']) > 2**53 - 1 else row['id']}
            for row in sorted(tables['ruleSubs'], key=lambda row: row.get('customOrder', 0))]
        manager['sourceSubscriptionsVersion'] = 1
    if detached_bookmarks:
        manager['detachedBookmarks'] = detached_bookmarks
    if menu:
        manager['readerMenuConfig'] = menu
    data = {'format': 'legado-tauri', 'version': 1, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'books': books, 'sources': sources, 'records': records, 'feeds': [], 'settings': settings,
            'sourceState': state, 'managerPreferences': manager}
    report = {'books': len(books), 'chapters': sum(len(b['chapters']) for b in books), 'sources': len(sources),
              'cachedChapters': cached_chapters, 'localChapters': local_chapters, 'localBooks': sum(b['kind'] == 'txt' for b in books),
              'groups': len(groups), 'records': len(records), 'loginInfoDecrypted': decrypted,
              'issues': {reason: sum(i['reason'] == reason for i in issues) for reason in sorted({i['reason'] for i in issues})}}
    return data, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup_directory', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    payload, report = convert(args.backup_directory)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report['bytes'] = args.output.stat().st_size
    report['sha256'] = hashlib.sha256(args.output.read_bytes()).hexdigest()
    archive = args.output.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        package.write(args.output, 'legado-tauri.json')
    report['zipBytes'] = archive.stat().st_size
    report['zipSha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
    args.output.with_suffix('.manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
