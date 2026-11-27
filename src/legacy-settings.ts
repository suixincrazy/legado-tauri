import type {ReaderColors,Settings} from './model';
import {cssColor} from './theme-model';

const builtinBackgrounds=import.meta.glob<string>('./assets/reader-backgrounds/*.jpg',{query:'?inline',import:'default',eager:true});
type Row=Record<string,any>;
type Files=Record<string,Uint8Array>;
const present=(row:Row,key:string)=>row[key]!==undefined&&row[key]!==null;
const number=(value:unknown,min:number,max:number)=>Math.max(min,Math.min(max,Number(value)));
export function legacyColor(value:unknown):string|undefined {
  if(typeof value==='number'&&Number.isInteger(value))return '#'+(value>>>0).toString(16).padStart(8,'0');
  if(typeof value==='string'&&/^#([\da-f]{6}|[\da-f]{8})$/i.test(value))return value;
}
function dataUri(bytes:Uint8Array,mime:string) {
  let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return `data:${mime};base64,${btoa(value)}`;
}
export function legacyMedia(path:unknown,files:Files,directory='',font=false):string|undefined {
  if(typeof path!=='string')return;
  if(path==='')return '';
  if(!font&&/^(https?:\/\/|data:image\/(png|jpeg|webp|gif|bmp);base64,)/i.test(path))return path;
  if(font&&/^data:font\/(ttf|otf|woff2?);base64,/i.test(path))return path;
  const normalized=path.replace(/^file:\/\//,'').replace(/\\/g,'/');
  if(normalized.includes('\0')||normalized.split('/').some(part=>part==='..'||part==='.'))return;
  let name=normalized;
  if(normalized.startsWith('/')){
    if(directory==='covers'&&/\/covers\/[^/]+$/.test(normalized))name='covers/'+normalized.split('/').pop();
    else if(directory&&normalized.includes(`/Android/data/`)&&normalized.includes(`/files/${directory}/`))name=directory+'/'+normalized.split(`/files/${directory}/`)[1];
    else return;
  }else if(directory&&!normalized.includes('/'))name=directory+'/'+normalized;
  const bytes=files[name];if(!bytes?.length)return;
  const head=String.fromCharCode(...bytes.subarray(0,12));
  const mime=font?(head.startsWith('OTTO')?'font/otf':head.startsWith('wOFF')?'font/woff':head.startsWith('wOF2')?'font/woff2':bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0?'font/ttf':''):
    head.startsWith('\x89PNG\r\n\x1a\n')?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':/^GIF8[79]a/.test(head)?'image/gif':head.startsWith('RIFF')&&head.slice(8)==='WEBP'?'image/webp':head.startsWith('BM')?'image/bmp':'';
  return mime?dataUri(bytes,mime):undefined;
}
export function legacyLayout(prefs:Row,configs:Row[],shared:Row) {
  const selected=configs[Math.max(0,Math.min(configs.length-1,Number(prefs.readStyleSelect)||0))]||{};
  return {selected,layout:prefs.shareLayout&&shared&&Object.keys(shared).length?shared:selected};
}
export function legacySettings(prefs:Row,configs:Row[],shared:Row,files:Files):Partial<Settings> {
  const {selected,layout}=legacyLayout(prefs,configs,shared),settings:Row={};
  const mapNumber=(row:Row,from:string,to:string,min:number,max:number,scale=1)=>{if(present(row,from)&&Number.isFinite(Number(row[from])))settings[to]=number(Number(row[from])*scale,min,max);};
  mapNumber(layout,'textSize','fontSize',5,100);mapNumber(layout,'letterSpacing','letterSpacing',-.5,.5);
  mapNumber(layout,'lineSpacingExtra','lineHeight',1,3,.1);mapNumber(layout,'paragraphSpacing','paragraphSpace',0,2,.1);
  if(present(layout,'textBold')){settings.readBold=Number(layout.textBold)===1;settings.readThin=Number(layout.textBold)===2;}
  if(typeof layout.paragraphIndent==='string')settings.textIndent=layout.paragraphIndent.length;
  if(present(layout,'titleMode'))settings.titleAlign=['left','center','hidden','right'][Number(layout.titleMode)]||'left';
  if(present(layout,'titleSize'))settings.titleSize=number((Number(layout.textSize)||20)+Number(layout.titleSize),5,100);
  for(const edge of ['Top','Bottom','Left','Right'])mapNumber(layout,'padding'+edge,'readerPadding'+edge,0,100);
  if(present(layout,'textFont')){
    const font=legacyMedia(layout.textFont,files,'',true);
    if(font!==undefined){settings.fontData=font;settings.fontName=font?layout.textFont.split(/[\\/]/).pop():'';}
  }
  for(const [from,to]of Object.entries({doubleHorizontalPage:'twoPage',showBrightnessView:'showBrightnessView',brightnessOnRight:'brightnessOnRight',barElevation:'barElevation',showUnread:'shelfUnread',showLastUpdateTime:'shelfUpdateTime',customWelcome:'customWelcome',welcomeShowText:'welcomeShowText',welcomeShowTextDark:'welcomeShowTextDark',welcomeShowIcon:'welcomeShowIcon',welcomeShowIconDark:'welcomeShowIconDark'}))if(present(prefs,from))settings[to]=!!prefs[from];
  mapNumber(prefs,'autoReadSpeed','autoPageSeconds',1,300);mapNumber(prefs,'bookshelfMargin','shelfMargin',0,100);mapNumber(prefs,'welcomeShowTime','welcomeShowTime',0,10000);
  if(['page','chapter'].includes(prefs.progressBarBehavior))settings.progressBarBehavior=prefs.progressBarBehavior;
  if(typeof prefs.pullToToggleBookmark==='boolean')settings.pullToToggleBookmark=prefs.pullToToggleBookmark;
  for(const key of ['tocCountWords','tocUiUseReplace','replaceEnableDefault'])if(typeof prefs[key]==='boolean')settings[key]=prefs[key];
  if(Number.isInteger(prefs.pullBookmarkDistance))settings.pullBookmarkDistance=Math.min(9999,Math.max(0,prefs.pullBookmarkDistance));
  if(present(prefs,'themeMode')){
    settings.themeMode=({0:'system',1:'day',2:'night',3:'eink'}as Row)[prefs.themeMode]||'system';
    settings.dark=settings.themeMode==='night';settings.readerTheme=settings.dark?'night':'paper';
  }
  const animation=layout[settings.themeMode==='eink'?'pageAnimEInk':'pageAnim'];
  if(present({animation},'animation')){settings.pageMode=Number(animation)===3?'scroll':'pages';settings.pageAnimation=['cover','slide','simulation','cover','none'][Number(animation)]||'cover';}
  if(present(prefs,'bookshelfLayout')){const value=number(prefs.bookshelfLayout,0,6);settings.layout=value===0?'list':value===1?'compact':'grid';if(value>=2)settings.shelfColumns=value;}
  if(present(prefs,'bookshelfSort'))settings.shelfSort=['recent','updated','name','manual','combined','author'][Number(prefs.bookshelfSort)]||'recent';
  if(present(prefs,'bookshelfReadProgressMode'))settings.shelfProgress=[0,2,4][Number(prefs.bookshelfReadProgressMode)]||0;
  else if(present(prefs,'showBookshelfReadProgress'))settings.shelfProgress=prefs.showBookshelfReadProgress?2:0;
  if(present(prefs,'showBooknameLayout'))settings.shelfName=['show','hide','overlay'][Number(prefs.showBooknameLayout)]||'show';
  if(present(prefs,'bookGroupStyle'))settings.shelfGroupStyle=Number(prefs.bookGroupStyle)===1?'folder':'tabs';
  const colors:Partial<Record<'day'|'night'|'eink',ReaderColors>>={};
  for(const [mode,suffix]of [['day',''],['night','Night'],['eink','EInk']]as const){
    const color:ReaderColors={},text=legacyColor(selected['textColor'+suffix]),background=selected['bgStr'+suffix],type=Number(selected['bgType'+suffix]||0);
    if(text)color.readerTextColor=cssColor(text);
    if(type===0){const value=legacyColor(background);if(value){color.readerBackgroundColor=cssColor(value);color.readerBackground='';}}
    else if(type===1&&typeof background==='string'){const value=builtinBackgrounds['./assets/reader-backgrounds/'+background.replace(/^bg\//,'')];if(value){color.readerBackground=value;color.readerBackgroundColor='';}}
    else if(type===2){const value=legacyMedia(background,files,'bg');if(value!==undefined){color.readerBackground=value;color.readerBackgroundColor='';}}
    if(Object.keys(color).length)colors[mode]=color;
  }
  if(Object.keys(colors).length)settings.readerColors=colors;
  for(const [suffix,key]of [['','themeDay'],['Night','themeNight']]as const){
    const theme:Row={};let changed=false;
    for(const [from,to]of Object.entries({colorPrimary:'primaryColor',colorAccent:'accentColor',colorBackground:'backgroundColor',colorBottomBackground:'bottomBackground'})){
      const color=legacyColor(prefs[from+suffix]);if(color){theme[to]=color;changed=true;}
    }
    for(const [from,to]of Object.entries({durThemeName:'themeName',transparentNavBar:'transparentNavBar'}))if(present(prefs,from+suffix)){theme[to]=prefs[from+suffix];changed=true;}
    const blur=prefs['backgroundImage'+suffix+'Blurring'];if(Number.isFinite(Number(blur))){theme.backgroundImgBlur=number(blur,0,25);changed=true;}
    const background=legacyMedia(prefs['backgroundImage'+suffix],files);if(background!==undefined){theme.backgroundImgPath=background;changed=true;}
    if(changed)settings[key]=theme;
  }
  const cover:Row={};let hasCover=false;
  for(const [from,to]of Object.entries({useDefaultCover:'useDefault',coverHorizontal:'horizontal',coverTitleAdaptive:'adaptive',coverKeepPunctuation:'keepPunctuation',coverShowName:'showName',coverShowAuthor:'showAuthor',coverShowNameN:'showNameDark',coverShowAuthorN:'showAuthorDark',coverCustomFontSize:'customSize'}))if(present(prefs,from)){cover[to]=!!prefs[from];hasCover=true;}
  for(const [from,to]of Object.entries({coverTitleLargeSize:'titleLarge',coverTitleSmallSize:'titleSmall',coverAuthorLargeSize:'authorLarge',coverAuthorSmallSize:'authorSmall'}))if(present(prefs,from)&&Number.isFinite(Number(prefs[from]))){cover[to]=number(prefs[from],50,200);hasCover=true;}
  for(const [from,to]of Object.entries({defaultCover:'image',defaultCoverDark:'imageDark'})){const value=legacyMedia(prefs[from],files,'covers');if(value!==undefined){cover[to]=value;hasCover=true;}}
  const coverFont=legacyMedia('coverFont.ttf',files,'',true);if(coverFont){cover.fontData=coverFont;cover.fontName='coverFont.ttf';hasCover=true;}
  if(hasCover)settings.coverConfig=cover;
  for(const [from,to]of Object.entries({welcomeImagePath:'welcomeImage',welcomeImagePathDark:'welcomeImageDark'})){const value=legacyMedia(prefs[from],files);if(value!==undefined)settings[to]=value;}
  return settings;
}
