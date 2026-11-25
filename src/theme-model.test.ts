import {expect,it} from 'vitest';
import {cssColor,contrastText,parseThemes,themeColors,dayTheme,nightTheme} from './theme-model';
import {DEFAULT_SETTINGS} from './model';

it('imports upstream Android colors without confusing alpha position and respects day/night overrides',()=>{
  const [theme]=parseThemes(JSON.stringify({...dayTheme,primaryColor:'#80795548'}));
  expect(cssColor(theme.primaryColor)).toBe('#79554880');
  expect(themeColors({...DEFAULT_SETTINGS,dark:true})).toEqual(nightTheme);
  expect(themeColors({...DEFAULT_SETTINGS,themeDay:theme})).toEqual(theme);
  expect(contrastText('#ffffff')).toBe('#212121');expect(contrastText('#000000')).toBe('#ffffff');
  expect(()=>parseThemes(JSON.stringify({...dayTheme,accentColor:'invalid'}))).toThrow('颜色');
});
