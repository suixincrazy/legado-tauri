// Port of LegadoTeam/legado ContentHelp.kt at 330e606c, GPL-3.0.
const END='？。！?!~',END_P='.'+END,MID='.，、,—…',SAY='问说喊唱叫骂道着答',BEFORE='，：,:',QUOTE='"“”';
const has=(marks:string,char:string|undefined)=>char!==undefined&&marks.includes(char);
const asciiSpace='[ \\t\\n\\x0b\\f\\r]';
function seekIndexes(text:string,marks:string,from:number,to:number,forward=true) {
  const indexes:number[]=[];if(text.length-from<1)return indexes;
  for(let index=Math.max(0,from);index<(to>0?Math.min(text.length,to):text.length);index++)if(has(marks,text[forward?index:text.length-index-1])){if(indexes.length&&index-indexes[indexes.length-1]===1)indexes[indexes.length-1]=index;else indexes.push(index);}
  return indexes;
}
function seekLast(text:string,marks:string,from:number,to:number) {
  if(text.length-from<1)return -1;let index=text.length-1;if(from<index&&index>0)index=from;
  for(;index>Math.max(0,to);index--)if(has(marks,text[index]))return index;return -1;
}
function seekIndex(text:string,marks:string,from:number,to:number,forward:boolean) {
  if(text.length-from<1)return -1;
  for(let index=Math.max(0,from);index<(to>0?Math.min(text.length,to):text.length);index++)if(has(marks,text[forward?index:text.length-index-1]))return index;return -1;
}
function forceSplit(text:string,offset:number,minimum:number,gain:number,trigger:number,random:()=>number) {
  const result:number[]=[],ends=seekIndexes(text,END_P,0,text.length-2),middles=seekIndexes(text,MID,0,text.length-2);
  if(ends.length<trigger&&middles.length<trigger*3)return result;let cursor=0;
  for(let index=minimum;index<ends.length;index++){let count=0;while(cursor<middles.length){if(middles[cursor]<ends[index])count++;cursor++;}if(random()*gain<.8+count/2.5){result.push(ends[index]+offset);index=Math.max(index+minimum,index);}}
  return result;
}
function makeDict(text:string) {
  const seen=new Set<string>(),dict=new Set<string>();
  for(const match of text.matchAll(/["'”“]([^\n\p{P}]{1,16})(?=["'”“])/gu)){if(seen.has(match[1]))dict.add(match[1]);else seen.add(match[1]);}return dict;
}
function findNewLines(text:string,dict:Set<string>,random:()=>number):string {
  const chars=text.split(''),quotes:number[]=[],modes=new Array<number>(text.length).fill(0);let lines:number[]=[],waitClose=false;
  for(let index=0;index<text.length;index++) {
    if(!has(QUOTE,text[index]))continue;const size=quotes.length;
    if(size>0&&index-quotes[size-1]===2&&has(waitClose?',，、/':',，、/和与或',text[index-1])){chars[index]='“';chars[index-2]='”';quotes.pop();modes[size-1]=1;modes[size]=-1;continue;}
    quotes.push(index);
    if(index>1){const before=text[index-1];let previous='\0';if(has(BEFORE,before)){
      if(quotes.length>1){const lastQuote=quotes[quotes.length-2];let position=0;if(has(',，',before)&&quotes.length>2){position=quotes[quotes.length-3];if(position>0)previous=text[position-1];}if(has(END_P,previous))lines.push(position-1);else if(previous!=='的'){const lastEnd=seekLast(text,END,index,lastQuote);lines.push(lastEnd>0?lastEnd:lastQuote);}}
      waitClose=true;modes[size]=1;if(size>0){modes[size-1]=-1;if(size>1)modes[size-2]=1;}
    }else if(waitClose){waitClose=false;lines.push(index);}}
  }
  const size=quotes.length;let opened=false;
  if(size>0){
    for(let index=0;index<size;index++){if(modes[index]>0)opened=true;else if(modes[index]<0){if(!opened&&index>0)modes[index]=3;opened=false;}else{opened=!opened;modes[index]=opened?2:-2;}}
    if(opened){if(quotes[size-1]-chars.length>-3){if(size>1)modes[size-2]=4;modes[size-1]=-4;}else if(!has(SAY,chars[chars.length-2]))chars.push('”');}
    let previous=-1,index=0;if(quotes[0]-1<0){index=1;previous=0;}for(;index<size;index++){const position=quotes[index]-1,current=modes[index];if(previous<0&&current>0&&has(END,chars[position]))lines.push(position);previous=current;}
  }
  lines=lines.filter(index=>{if(!has('"\'”“',chars[index]))return true;const start=seekLast(text,'"\'”“',index-1,index-16);return !(start>0&&(dict.has(text.slice(start+1,index))||has('的地得',text[start])));});
  lines=[...new Set(lines)].sort((a,b)=>a-b);
  let cursor=0,progress=0,next=lines[0]??-1,gain=3,minimum=0,trigger=2;
  for(const quote of quotes){
    gain=quote>0?4:3;minimum=quote>0?2:0;trigger=quote>0?4:2;
    while(cursor<lines.length){if(next>=quote)break;next=lines[cursor];if(progress<next){lines.push(...forceSplit(chars.slice(progress,next).join(''),progress,minimum,gain,trigger,random));progress=next+1;}cursor++;}
    if(progress<quote){lines.push(...forceSplit(chars.slice(progress,quote+1).join(''),progress,minimum,gain,trigger,random));progress=quote+1;}
  }
  while(cursor<lines.length){next=lines[cursor];if(progress<next){lines.push(...forceSplit(chars.slice(progress,next).join(''),progress,minimum,gain,trigger,random));progress=next+1;}cursor++;}
  if(progress<chars.length)lines.push(...forceSplit(chars.slice(progress).join(''),progress,minimum,gain,trigger,random));
  const insertQuote=new Array<boolean>(size).fill(false);opened=false;
  quotes.forEach((position,index)=>{if(modes[index]>0){chars[position]='“';if(opened)insertQuote[index]=true;opened=true;}else if(modes[index]<0){chars[position]='”';opened=false;}else{opened=!opened;chars[position]=opened?'“':'”';}});
  lines=[...new Set(lines)].sort((a,b)=>a-b);let buffer='';cursor=0;progress=0;next=lines[0]??-1;
  quotes.forEach((quote,index)=>{while(cursor<lines.length){if(next>=quote)break;next=lines[cursor];buffer+=chars.slice(progress,next+1).join('')+'\n';progress=next+1;cursor++;}if(progress<quote){buffer+=chars.slice(progress,quote+1).join('');progress=quote+1;}if(insertQuote[index]&&buffer.length>2)buffer=buffer.endsWith('\n')?buffer+'“':buffer.slice(0,-1)+'”\n'+buffer.slice(-1);});
  while(cursor<lines.length){next=lines[cursor];if(progress<=next){buffer+=chars.slice(progress,next+1).join('')+'\n';progress=next+1;}cursor++;}
  if(progress<chars.length)buffer+=chars.slice(progress).join('');return buffer;
}
function splitQuote(text:string):string {
  if(text.length<3)return text;
  if(has(QUOTE,text[0])){const index=seekIndex(text,QUOTE,1,text.length-2,true)+1;if(index>1&&!has(BEFORE,text[index-1]))return text.slice(0,index)+'\n'+text.slice(index);}
  else if(has(QUOTE,text[text.length-1])){const index=text.length-1-seekIndex(text,QUOTE,1,text.length-2,false);if(index>1&&!has(BEFORE,text[index-1]))return text.slice(0,index)+'\n'+text.slice(index);}
  return text;
}
function reduceLength(text:string) {
  const paragraphs=text.split('\n'),dialogues=paragraphs.map(text=>/^["”“][^"”“]+["”“]$/.test(text));let dialogue=0;
  paragraphs.forEach((text,index)=>{if(dialogues[index]){if(dialogue<0)dialogue=1;else if(dialogue<2)dialogue++;}else if(dialogue>1){paragraphs[index]=splitQuote(text);dialogue--;}else if(dialogue>0&&index<paragraphs.length-2&&dialogues[index+1])paragraphs[index]=splitQuote(text);});
  return '\n'+paragraphs.join('\n');
}
export function resegmentContent(content:string,title:string,random:()=>number=Math.random):string {
  const dict=makeDict(content),space=new RegExp(asciiSpace+'*','g');
  let parts=content.replace(/&quot;/g,'“').replace(/[:：]['"‘”“]+/g,'：“').replace(new RegExp('["”“]+'+asciiSpace+'*["”“]['+ ' \\t\\n\\x0b\\f\\r"”“]*','g'),'”\n“').split(new RegExp('\n'+asciiSpace+'*'));
  let buffer='  ';if(title.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'')!==parts[0].replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,''))buffer+=parts[0].replace(/[\u3000 \t\n\x0b\f\r]+/g,'');
  for(const part of parts.slice(1)){if(has(END,buffer[buffer.length-1])||(has('"”',buffer[buffer.length-1])&&has(END,buffer[buffer.length-2])))buffer+='\n';buffer+=part.replace(/[\u3000 \t\n\x0b\f\r]/g,'');}
  parts=buffer.replace(new RegExp('["”“]+'+space.source+'["”“]+','g'),'”\n“').replace(/["”“]+(？。！?!~)["”“]+/g,'”$1\n“').replace(/["”“]+(？。！?!~)([^"”“])/g,'”$1\n$2').replace(/([问说喊唱叫骂道着答])[.。]/g,'$1。\n').split('\n');
  buffer=reduceLength(parts.map(part=>'\n'+findNewLines(part,dict,random)).join(''));
  return buffer.replace(new RegExp('^'+asciiSpace+'+'),'').replace(new RegExp(asciiSpace+'*["”“]+'+asciiSpace+'*["”“][ \\t\\n\\x0b\\f\\r"”“]*','g'),'”\n“').replace(/[:：][”“" \t\n\x0b\f\r]+/g,'：“').replace(/\n["“”]([^\n"“”]+)([,:，：]["”“])([^\n"“”]+)/g,'\n$1：“$3').replace(new RegExp('\n'+asciiSpace+'*','g'),'\n');
}
