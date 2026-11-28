import 'fake-indexeddb/auto';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {BookDetails} from './BookDetails';
import {newBook} from './model';
import {shareBookDetails} from './book-share';
import {writeClipboardText} from './clipboard';
vi.mock('./book-share',()=>({shareBookDetails:vi.fn()}));
vi.mock('./clipboard',()=>({writeClipboardText:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>vi.resetAllMocks());

it('offers sharing for unshelved previews and copies only on request; Escape closes the preview first',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),save=vi.fn(),add=vi.fn(),close=vi.fn(),notify=vi.fn();
  const book=newBook('Public preview','txt',[{title:'First',content:'Body'}]);
  const props={book,sources:[],groups:[],inShelf:false,close,save,add,open:vi.fn(),remove:vi.fn(),cache:vi.fn(),login:vi.fn(),notify};
  const click=async(selector:string)=>act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());
  try{
    vi.mocked(shareBookDetails).mockResolvedValue({status:'preview',text:'#{"name":"Public preview"}'});
    await act(async()=>root.render(createElement(BookDetails,props)));await click('[aria-label="分享书籍"]');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="分享内容"]')!.value).toBe('#{"name":"Public preview"}');
    expect(writeClipboardText).not.toHaveBeenCalled();
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='复制分享内容')!.click());
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('#{"name":"Public preview"}');expect(save).not.toHaveBeenCalled();expect(add).not.toHaveBeenCalled();
    await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(host.querySelector('[aria-label="分享内容"]')).toBeNull();expect(close).not.toHaveBeenCalled();
    vi.mocked(shareBookDetails).mockResolvedValue({status:'cancelled',text:''});await click('[aria-label="分享书籍"]');
    expect(host.querySelector('[aria-label="分享内容"]')).toBeNull();expect(notify).toHaveBeenCalledTimes(1);
    vi.mocked(shareBookDetails).mockRejectedValue(new Error('Callback failed'));await click('[aria-label="分享书籍"]');
    expect(notify).toHaveBeenLastCalledWith('Error: Callback failed');expect(host.querySelector('[aria-label="分享内容"]')).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();}
});
it('prevents duplicate shares and ignores a late browser preview after details close',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  let finish!:(value:Awaited<ReturnType<typeof shareBookDetails>>)=>void;
  vi.mocked(shareBookDetails).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const props={book:newBook('Public','online',[]),sources:[],groups:[],inShelf:true,close:vi.fn(),save:vi.fn(),add:vi.fn(),open:vi.fn(),remove:vi.fn(),cache:vi.fn(),login:vi.fn(),notify:vi.fn()};
  try{
    await act(async()=>root.render(createElement(BookDetails,props)));
    const button=host.querySelector<HTMLButtonElement>('[aria-label="分享书籍"]')!;
    await act(async()=>{button.click();button.click();});expect(shareBookDetails).toHaveBeenCalledTimes(1);expect(button.disabled).toBe(true);
    await act(async()=>root.unmount());await act(async()=>finish({status:'preview',text:'late'}));expect(host.textContent).toBe('');
  }finally{host.remove();}
});
