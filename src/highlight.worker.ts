import { matchHighlightRule } from './highlight-engine';
self.onmessage=event=>{try{self.postMessage({ranges:matchHighlightRule(event.data.text,event.data.rule,event.data.titleLength)});}catch(error){self.postMessage({error:String(error)});}};
