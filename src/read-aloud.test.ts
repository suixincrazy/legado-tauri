import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedSpeechQueue, sentenceStart, speechChunks, speechCommand } from './read-aloud';
import { newBook } from './model';

afterEach(async()=>{await speechCommand('stop');vi.useRealTimers();vi.unstubAllGlobals();});
function speechHarness(){
  const spoken:Record<string,any>[]=[];
  vi.stubGlobal('SpeechSynthesisUtterance',class { constructor(public text:string){} });
  vi.stubGlobal('speechSynthesis',{cancel:vi.fn(),getVoices:()=>[],speak:(utterance:Record<string,any>)=>spoken.push(utterance)});
  return spoken;
}
describe('read aloud positions and transport',()=>{
  it('starts at the selected occurrence and keeps UTF-16 positions for native callbacks',()=>{
    speechHarness();const text='章\n重复文字\n重复文字😀结束';const start=text.lastIndexOf('重复');
    expect(speechChunks(text,2,'章',start,start+6)).toEqual([{text:'重复文字😀',chapter:2,title:'章',start,end:start+6}]);
    const long='甲'.repeat(1499)+'😀乙';const chunks=speechChunks(long,0,'章');
    expect(chunks.map(chunk=>chunk.text).join('')).toBe(long);expect(chunks.every(chunk=>chunk.text.length<=1500)).toBe(true);expect(chunks[0].text).toHaveLength(1499);
  });
  it('continues through cached chapters and stops at the first uncached chapter',()=>{
    speechHarness();const book=newBook('测试','online',[{title:'一',content:'甲'},{title:'卷',isVolume:true},{title:'二',content:'乙'},{title:'三'},{title:'四',content:'丁'}]);
    expect(cachedSpeechQueue(book,'一\n甲',0,true).map(chunk=>[chunk.chapter,chunk.text])).toEqual([[0,'甲'],[2,'乙']]);
  });
  it('rewinds only automatic starts to a sentence boundary',()=>{
    speechHarness();expect(sentenceStart('标题\n第一句。第二句。',10)).toBe(7);expect(sentenceStart('标题\n正文开头',5)).toBe(3);
  });
  it('ignores stale completion after pause and resumes from the reported word',async()=>{
    const spoken=speechHarness();await speechCommand('start',{bookId:'test',chunks:speechChunks('甲乙丙\n丁戊',0,'章')});
    spoken[0].onboundary({charIndex:1});await speechCommand('pause');spoken[0].onend();
    expect(await speechCommand('status')).toMatchObject({state:'paused',index:0,position:1});
    await speechCommand('resume');expect(spoken[1].text).toBe('乙丙');spoken[1].onend();expect(spoken[2].text).toBe('丁戊');
  });
  it('pauses when the timer expires and at a chapter boundary',async()=>{
    vi.useFakeTimers();const spoken=speechHarness();await speechCommand('start',{bookId:'test',chunks:[...speechChunks('甲',0,'一'),...speechChunks('乙',1,'二')]});
    await speechCommand('timer',{chapters:1});spoken[0].onend();expect(await speechCommand('status')).toMatchObject({state:'paused',index:1});
    await speechCommand('resume');expect(spoken[1].text).toBe('乙');await speechCommand('timer',{minutes:1});vi.advanceTimersByTime(60000);
    expect(await speechCommand('status')).toMatchObject({state:'paused',index:1,remaining:0});
  });
  it('applies a timer selected before starting playback',async()=>{
    vi.useFakeTimers();const spoken=speechHarness();await speechCommand('start',{bookId:'test',chunks:[...speechChunks('甲',0,'一'),...speechChunks('乙',1,'二')],timer:{chapters:1,minutes:0}});spoken[0].onend();
    expect(await speechCommand('status')).toMatchObject({state:'paused',index:1,chapterStop:0});
  });
});
