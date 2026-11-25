import { replacementPattern, replaceText } from './replacement-engine';
self.onmessage = async event => {
  try {
    const {text,rule,context}=event.data;
    if(rule.isRegex&&rule.replacement.startsWith('@js:')){
      const {expandScriptReplacement,scriptReplacements}=await import('./replacement-script');
      const matches=Array.from(text.matchAll(replacementPattern(rule.pattern))) as RegExpMatchArray[];
      const results=await scriptReplacements(matches.map(match=>match[0]),rule,context);
      let end=0,output='';
      matches.forEach((match,index)=>{output+=text.slice(end,match.index)+expandScriptReplacement(results[index],match);end=match.index!+match[0].length;});
      self.postMessage({text:output+text.slice(end)});
    }else self.postMessage({text:replaceText(text,rule)});
  }
  catch (error) { self.postMessage({ error: String(error) }); }
};
