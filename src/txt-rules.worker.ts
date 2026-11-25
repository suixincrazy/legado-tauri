import { scanTxtHeadings } from './txt-rules-engine';
self.onmessage=event=>{
  try{self.postMessage({headings:scanTxtHeadings(event.data.text,event.data.pattern)});}
  catch(error){self.postMessage({error:String(error)});}
};
