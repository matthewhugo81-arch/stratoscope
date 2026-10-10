import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
test('diagnostic and seasonal chart dimensions do not match nested Save SVGs',()=>{
 assert.doesNotMatch(css,/\.nh-diagnostic-chart\s+svg/);
 assert.doesNotMatch(css,/\.native-seasonal-chart\s+svg/);
 assert.match(css,/\.nh-diagnostic-chart>svg\{display:block;width:100%;height:auto/);
 assert.match(css,/\.nh-diagnostic-chart>svg\{min-width:580px/);
 assert.match(css,/\.native-seasonal-chart \.seasonal-plot>svg/);
});
test('Save and busy spinner have explicitly bounded CSS dimensions',()=>{
 const rule=css.match(/button\.image-save>svg\{([^}]+)\}/)?.[1];
 assert.ok(rule,'Save SVG dimension rule is required');
 for(const property of ['width','min-width','max-width','height','min-height','max-height']){
  assert.ok(rule.includes(property+':13px'),property+' must be explicitly bounded');
 }
 assert.ok(rule.includes('flex:0 0 13px'));
});
test('Save label stays visible in mobile 3D controls',()=>{
 assert.match(css,/button\.image-save>span\{[^}]*display:inline/);
});
