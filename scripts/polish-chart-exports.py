from pathlib import Path

def replace(path,old,new):
 p=Path(path);source=p.read_text()
 assert source.count(old)==1, (path,old)
 p.write_text(source.replace(old,new))

# A chart header now also contains a small SVG download icon. Select only the
# forecast SVG, never the icon; preserve the source viewBox aspect ratio.
replace('components/northern-diagnostics.tsx',
        '`[data-export-plot="${key}"] svg`',
        '`[data-export-plot="${key}"] > svg[role="img"]`')
replace('components/vortex-view.tsx',
        "'rgba('+heightAnomalyColour(-300+i*10).slice(0,3).join(',')+',1)'",
        "(()=>{const c=heightAnomalyColour(-300+i*10);return `rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`})()")

# Route a genuine failed image fetch while leaving its existing <img> visible.
# Mocked fulfill responses do not consistently enforce CORS in every engine.
replace('tests/export_browser_support.py',
        'def ec_route(route,cors=True):\n',
        "def ec_route(route,cors=True):\n if not cors and route.request.resource_type in ['fetch','xhr'] and '/opencharts-api/' not in route.request.url:\n  route.abort('accessdenied');return\n")
replace('tests/export_browser_support.py',
        "   region=rgba.crop((int(box['x']),int(box['y']),int(box['x']+box['w']),int(box['y']+box['h']))).convert('RGB')",
        "   bounds=(int(box['x']),int(box['y']),int(box['x']+box['w']),int(box['y']+box['h']))\n   region=rgba.crop(bounds).convert('RGB')")
replace('tests/browser_chart_exports.py',
        " details=page.evaluate('window.__png');size=verify_png(path,details)",
        " details=page.evaluate('window.__png');size=verify_png(path,details)\n if label.startswith('10 hPa') or label=='northern diagnostic comparison':\n  assert all(abs(b['h']/b['w']-.28)<.001 for b in details['images']), 'Selected an icon rather than the forecast SVG'")

p=Path('app/globals.css')
p.write_text(p.read_text()+'''\n.glosea-heading>.chart-save-wrap,.member-maps-dialog>header>.chart-save-wrap{margin-left:auto}\n''')
p=Path('tests/chart-export.test.mjs')
p.write_text(p.read_text()+'''\ntest('northern export selects forecast SVGs rather than the download-button icon',async()=>{\n const source=await readFile(new URL('../components/northern-diagnostics.tsx',import.meta.url),'utf8');\n assert.ok(source.includes('> svg[role="img"]'));\n});\n''')
