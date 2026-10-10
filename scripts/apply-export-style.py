from pathlib import Path
p=Path('app/globals.css');source=p.read_text();assert '.chart-save-wrap .chart-save' not in source
source+='''
/* Small local image exports: visible to touch/keyboard users, quiet at rest. */
.chart-save-wrap{position:relative;display:inline-flex;align-items:center;align-self:center;flex:0 0 auto;pointer-events:auto}
.chart-save-wrap .chart-save{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:28px;width:auto;margin:0;padding:4px 8px;border:1px solid #3a566180;border-radius:4px;background:transparent;color:#a3bdc9;font:11px/1.2 Arial,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:none;text-transform:none}
.chart-save-wrap .chart-save:hover:not(:disabled){color:#d3eee7;border-color:#789f9c;background:#18323b}
.chart-save-wrap .chart-save:focus-visible{outline:2px solid #b5efdd;outline-offset:3px}
.chart-save-wrap .chart-save:disabled{opacity:.45;cursor:default}
.chart-save-wrap .chart-save span{display:inline;background:transparent;padding:0;margin:0;color:inherit;font:inherit}
.chart-save-wrap .chart-save-feedback{position:absolute;display:block;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.chart-save-wrap .chart-save-error{position:absolute;display:block;right:0;top:calc(100% + 6px);z-index:1010;width:min(310px,80vw);padding:10px;border:1px solid #ad8054;border-radius:4px;background:#132934;color:#efc281;font:12px/1.5 Arial,sans-serif;white-space:normal;text-transform:none;box-shadow:0 3px 14px #0005}
.chart-save-error a{text-decoration:underline;color:#c5ece4}
.chart-export-heading{display:flex;align-items:center;justify-content:space-between;gap:8px 14px;flex-wrap:wrap}
.chart-export-heading h3{margin:0}.seasonal-issue>.chart-save-wrap{margin-left:auto}
.vortex-stage .vortex-view-controls>.chart-save-wrap{display:inline-flex;background:transparent;padding:0;margin:0;pointer-events:auto}
.zonal-card .chart-export-heading{gap:6px}.zonal-card .chart-save-wrap .chart-save{font-size:10px;padding:3px 6px;min-height:26px}
@media(max-width:750px){.chart-save-wrap .chart-save{min-height:32px}.stamps-heading{flex-wrap:wrap;gap:6px}.vortex-view-controls .chart-save-wrap .chart-save{min-height:32px}}
'''
p.write_text(source)
# Legend definitions are copied too: no mutable live objects survive encoding.
p=Path('lib/chart-export.ts');source=p.read_text();old=' const layout=imageLayout(input,plots),size='
new=" const snapshot={...input,legend:input.legend?.map(v=>({...v})),gradients:input.gradients?.map(v=>({...v,stops:v.stops.map(s=>({...s})),ticks:v.ticks.map(t=>({...t}))}))};\n const layout=imageLayout(snapshot,plots),size="
assert source.count(old)==1;p.write_text(source.replace(old,new))
