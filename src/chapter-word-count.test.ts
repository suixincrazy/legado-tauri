import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import {chapterInfoWordCount,formatChapterWordCount,withChapterContent} from './chapter-word-count';
import {DEFAULT_SETTINGS,newBook,type Book,type Chapter,type Source} from './model';
import {chaptersFromHeadings,scanTxtHeadings} from './txt-rules-engine';
import {updatedBook} from './book-update';
import * as storage from './storage';
import {createBackupArchive,readBackupArchive,defaultContent} from './backup-archive';
import {loadSourceToc,loadOnlineBook} from './sources';
import {fetchText} from './network';

vi.mock('./network',()=>({fetchText:vi.fn()}));
beforeEach(async()=>{
  vi.clearAllMocks();
  for(const book of await storage.all<Book>('books'))await storage.remove('books',book.id);
  for(const key of ['reader','legacyBackupFiles','legacyMigration','detachedBookmarks'])await storage.remove('settings',key);
});
it('uses UTF-16 lengths, an exclusive ten-thousand threshold and Java half-even decimal ties',()=>{
  expect([0,1,9999,10000,10001,12500,17500,22500,27500,100000].map(formatChapterWordCount)).toEqual(['','1字','9999字','10000字','1万字','1.2万字','1.8万字','2.2万字','2.8万字','10万字']);
  const source={title:'Title excluded',content:'Previous',wordCount:'来源 7千字'};
  expect(withChapterContent(source,'中𠮷 e\u0301\n',true)).toEqual({...source,content:'中𠮷 e\u0301\n',wordCount:'7字'});
  expect(withChapterContent(source,'',true).wordCount).toBe('');
  expect(withChapterContent(source,'New',false).wordCount).toBe('来源 7千字');
  expect(withChapterContent({title:'Volume',isVolume:true},'text',true).wordCount).toBeUndefined();
  expect(source.content).toBe('Previous');
});
it('counts normalized TXT source ranges before trimming without changing the stored content',()=>{
  const text='Intro\nSection 1\n中𠮷 \nSection 2\n';
  const result=chaptersFromHeadings(text,scanTxtHeadings(text,'^Section [0-9]+$'));
  expect(result).toEqual([{title:'前言',content:'Intro',wordCount:'6字'},{title:'Section 1',content:'中𠮷',wordCount:'6字'},{title:'Section 2',content:'',wordCount:'1字'}]);
  expect(chaptersFromHeadings(' A𠮷\n',[])).toEqual([{title:'正文',content:'A𠮷',wordCount:'5字'}]);
});
it('recognizes original chapter-info strings while retaining their spelling',()=>{
  expect(['1.2万字','昨天 字数：3000字','更新 3千字','字数、0字','x300字','1234567字','昨天\u00a0300字','字数:1.20万字'].map(chapterInfoWordCount)).toEqual(['1.2万字','3000字','3千字','0字',undefined,undefined,undefined,'1.20万字']);
});
it('retains old counts for the same chapter and source, but never carries them to another source',()=>{
  const old={...newBook('Public','online',[{title:'A',url:'/a',content:'A',wordCount:'来源原值'},{title:'B',url:'/b',wordCount:''}]),sourceUrl:'https://one.test',chapter:0,offset:.4,bookmarks:[{chapter:0,offset:0,title:'mark',created:1}]};
  const fresh={...newBook('Public','online',[{title:'B',url:'/b',wordCount:'新值'},{title:'A',url:'/a',wordCount:'12字'},{title:'C',url:'/c'}]),sourceUrl:old.sourceUrl};
  const merged=updatedBook(old,fresh);
  expect(merged.chapters.map(c=>c.wordCount)).toEqual(['','来源原值',undefined]);
  expect(merged.chapter).toBe(1);expect(merged.offset).toBe(.4);expect(merged.bookmarks[0].chapter).toBe(1);
  expect(updatedBook(old,{...fresh,sourceUrl:'https://two.test'}).chapters.map(c=>c.wordCount)).toEqual(['新值','12字',undefined]);
});
it('reads counts from chapter information only while enabled, omitting volume counts and content downloads',async()=>{
  const source:Source={bookSourceUrl:'https://counts.test',bookSourceName:'Public counts',ruleToc:{chapterList:'li',chapterName:'.name@text',chapterUrl:'a@href',updateTime:'.info@text',isVolume:'.volume@text'}};
  const body='<ul><li><b class="name">Volume</b><i class="volume">true</i><i class="info">100字</i></li><li><a href="/one" class="name">One</a><i class="info">更新 字数：1.20万字</i></li><li><a href="/two" class="name">Two</a><i class="info">unknown</i></li></ul>';
  vi.mocked(fetchText).mockResolvedValue({body,status:200,headers:{},url:'https://counts.test/toc'});
  const book={...newBook('Public','online',[]),url:'https://counts.test/toc'};
  const enabled=await loadSourceToc(book,source);
  expect(enabled.chapters.map(c=>[c.title,c.wordCount])).toEqual([['Volume',undefined],['One','1.20万字'],['Two',undefined]]);
  expect(enabled.chapters[0].isVolume).toBe(true);expect(enabled.chapters.every(c=>c.content===undefined)).toBe(true);
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocCountWords:false});
  expect((await loadSourceToc(book,source)).chapters.every(c=>c.wordCount===undefined)).toBe(true);
  expect(fetchText).toHaveBeenCalledTimes(2);
});
it('retains string counts from JS chapters without confusing book totals with missing chapter counts',async()=>{
  const source:Source={bookSourceUrl:'https://js-counts.test',bookSourceName:'Public JS',mainJs:"function getChapters(){return [{title:'With',url:'/a',wordCount:'来源 2千字'},{title:'Without',url:'/b'},{title:'Invalid',url:'/c',wordCount:33}];}"};
  const book=await loadOnlineBook({name:'Public',author:'Author',url:source.bookSourceUrl,sourceName:source.bookSourceName,sourceUrl:source.bookSourceUrl,wordCount:'100万字'},source);
  expect(book.chapters.map(c=>c.wordCount)).toEqual(['来源 2千字',undefined,undefined]);expect(fetchText).not.toHaveBeenCalled();
});
it('round-trips count metadata and the global choice, synchronizing only its original configuration entry',async()=>{
  const book={...newBook('Public','txt',[{title:'Metadata',wordCount:'来源 1.20万字'},{title:'Missing'},{title:'Empty',wordCount:''},{title:'Null',wordCount:null}]),bookmarks:[{chapter:0,offset:0,title:'mark',created:1}]};
  await storage.put('books',book.id,book);
  const original=zipSync({'config.xml':strToU8('<map><string name="future">kept</string><boolean name="tocCountWords" value="true"/></map>')});
  await storage.restore(JSON.stringify(await readBackupArchive(original)));
  await storage.put('settings','reader',{...await storage.settings(),tocCountWords:false});
  const archive=await createBackupArchive(),files=unzipSync(archive),snapshot=await readBackupArchive(archive);
  expect(snapshot.books[0]).toEqual(book);expect(snapshot.settings.tocCountWords).toBe(false);
  const xml=strFromU8(files['config.xml']);expect(xml).not.toContain('name="future"');expect(xml).toContain('name="tocCountWords" value="false"');
  expect((await readBackupArchive(zipSync({'config.xml':files['config.xml']}))).settings.tocCountWords).toBe(false);
  const envelope=JSON.parse(strFromU8(unzipSync(await createBackupArchive(defaultContent,'public-test-key'))['legado-encrypted.json']));
  const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const material=await crypto.subtle.importKey('raw',strToU8('public-test-key') as BufferSource,'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(envelope.salt),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.data));
  const protectedXml=strFromU8(unzipSync(new Uint8Array(plain))['config.xml']);
  expect(protectedXml).toContain('name="future">kept');expect(protectedXml).toContain('name="tocCountWords" value="false"');
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocCountWords:true});
  await storage.restore(JSON.stringify(snapshot),['reader']);expect((await storage.settings()).tocCountWords).toBe(true);
  await storage.restore(JSON.stringify(snapshot));expect((await storage.settings()).tocCountWords).toBe(false);
  const excluded=await createBackupArchive({...defaultContent,settings:false});
  expect(unzipSync(excluded)['config.xml']).toBeUndefined();
  await storage.put('settings','reader',{...DEFAULT_SETTINGS,tocCountWords:true});
  await storage.restore(JSON.stringify(await readBackupArchive(excluded)));expect((await storage.settings()).tocCountWords).toBe(true);
  expect((await storage.all<Book>('books'))[0]).toEqual(book);
});
it('rejects malformed counts and preferences before restoring, allowing original null counts and old defaults',async()=>{
  const book=newBook('Kept','txt',[{title:'A',content:'Original'}]);await storage.put('books',book.id,book);
  const data=JSON.parse(await storage.backup());
  for(const value of [true,123,{}]){
    const invalid=structuredClone(data);invalid.books[0].chapters[0].wordCount=value;
    await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('章节字数');expect((await storage.all<Book>('books'))[0]).toEqual(book);
  }
  for(const value of [null,'false',0]){
    const invalid=structuredClone(data);invalid.settings.tocCountWords=value;
    await expect(storage.restore(JSON.stringify(invalid))).rejects.toThrow('目录字数');
  }
  data.books[0].chapters[0].wordCount=null;delete data.settings.tocCountWords;
  await storage.restore(JSON.stringify(data));expect((await storage.settings()).tocCountWords).toBe(true);
});
it('preserves chapter counts and the original global choice from an actual SQLite conversion',()=>{
  const code=`import importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('fixture','scripts/convert-legado-backup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);app=root/'extracted/data/user/0/com.legado.app.release';(app/'databases').mkdir(parents=True);(app/'shared_prefs').mkdir()
 (app/'shared_prefs/com.legado.app.release_preferences.xml').write_text('<map><boolean name="tocCountWords" value="false"/></map>')
 db=sqlite3.connect(app/'databases/legado.db')
 db.execute('create table books (bookUrl text,name text,author text,type integer,origin text,tocUrl text,durChapterIndex integer,durChapterPos integer,durChapterTime integer,canUpdate integer,"order" integer,latestChapterTime integer,"group" integer)')
 db.execute('insert into books values (?,?,?,?,?,?,?,?,?,?,?,?,?)',('https://counts.test/book','Public','Author',0,'https://counts.test','',0,0,0,1,0,0,0))
 db.execute('create table chapters (bookUrl text,url text,title text,"index" integer,isVolume integer,isVip integer,isPay integer,wordCount text)')
 for i,count in enumerate(['1.20万字','',None]):db.execute('insert into chapters values (?,?,?,?,?,?,?,?)',('https://counts.test/book',str(i),'Public '+str(i),i,0,0,0,count))
 db.commit();db.close();data,_=m.convert(root);print(json.dumps(data))`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-X','utf8','-B','-c',code],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);const data=JSON.parse(result.stdout);storage.validateBackup(data);
  expect(data.books[0].chapters.map((c:Chapter)=>c.wordCount)).toEqual(['1.20万字','',null]);expect(data.settings.tocCountWords).toBe(false);
});
