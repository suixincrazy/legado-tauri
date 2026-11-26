import type { CoverConfig,Settings,ThemeConfig } from './model';
import defaults from './default-themes.json';
export const defaultThemes=defaults as ThemeConfig[];
export const dayTheme:ThemeConfig=defaultThemes[0];
export const nightTheme:ThemeConfig={themeName:'默认夜间',isNightTheme:true,primaryColor:'#546e7a',accentColor:'#d84315',backgroundColor:'#212121',bottomBackground:'#303030'};
export const defaultCover:CoverConfig={useDefault:false,horizontal:false,adaptive:true,keepPunctuation:false,showName:true,showAuthor:true,showNameDark:true,showAuthorDark:true,image:'',imageDark:'',fontData:'',fontName:'',customSize:false,titleLarge:100,titleSmall:100,authorLarge:100,authorSmall:100};
export function cssColor(value:string):string {return /^#[\da-f]{8}$/i.test(value)?'#'+value.slice(3)+value.slice(1,3):value;}
export function readerMode(prefs:Settings):'day'|'night'|'eink' {return prefs.readerColors?prefs.themeMode==='system'?(prefs.dark?'night':'day'):prefs.themeMode||(prefs.dark||prefs.readerTheme==='night'?'night':'day'):prefs.readerTheme==='night'?'night':'day';}
export function readerColors(prefs:Settings) {return {...prefs,...prefs.readerColors?.[readerMode(prefs)]};}
export function themeColors(prefs:Settings):ThemeConfig {return prefs.themeMode==='eink'?{...dayTheme,primaryColor:'#ffffff',accentColor:'#000000',backgroundColor:'#ffffff',bottomBackground:'#ffffff'}:prefs.dark?prefs.themeNight||nightTheme:prefs.themeDay||dayTheme;}
export function parseThemes(text:string):ThemeConfig[] {
  const value=JSON.parse(text),items=Array.isArray(value)?value:[value];
  if(!items.length)throw new Error('没有主题');
  return items.map(item=>{
    if(!item||typeof item.themeName!=='string'||!item.themeName.trim())throw new Error('主题缺少名称');
    for(const key of ['primaryColor','accentColor','backgroundColor','bottomBackground'])if(typeof item[key]!=='string'||!/^#([\da-f]{6}|[\da-f]{8})$/i.test(item[key]))throw new Error('主题颜色格式不正确');
    return {...item,isNightTheme:!!item.isNightTheme};
  });
}
export function contrastText(color:string):string {
  const hex=cssColor(color).slice(1,7),rgb=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.35?'#212121':'#ffffff';
}
