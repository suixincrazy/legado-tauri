import { contentSearch } from './content-processing';
self.onmessage=event=>{try{self.postMessage({matches:contentSearch(event.data.text,event.data.query,event.data.regex,event.data.matchCase)});}catch(error){self.postMessage({error:String(error)});}};
