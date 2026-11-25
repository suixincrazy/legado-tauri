import { resegmentContent } from './resegment';
self.onmessage=(event:MessageEvent<{content:string;title:string}>)=>{
  try{self.postMessage({text:resegmentContent(event.data.content,event.data.title)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
