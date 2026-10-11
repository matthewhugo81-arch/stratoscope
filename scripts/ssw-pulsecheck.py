"""Render a dated, offline pulsecheck from verified adapter receipts only."""
import argparse
from datetime import datetime,timezone
from html import escape
import json
from pathlib import Path
import numpy as np
from ssw_sources import MODELS, require, digest, stamp
from ssw_diagnostics import summary


def validate_product(data):
    model=data['model'];count=MODELS[model]['count']
    require(data['version']==1 and data['product']=='ssw_precursors_research' and data['sourceClass']==MODELS[model]['kind'], 'Wrong source class/product')
    require(data['count']==count and data['memberIds']==list(range(count)) and data['completeRequestedLeads'] is True, 'Incomplete members')
    require([p['hour'] for p in data['points']]==data['requestedHours'] and len(set(data['requestedHours']))==len(data['requestedHours']), 'Incomplete/duplicate timeline')
    run=datetime.fromisoformat(data['run'].replace('Z','+00:00'))
    for point in data['points']:
        require(point['evidence']['decoded'] is True, 'Inventory alone cannot support a pulsecheck')
        expected={(m,l,k) for m in range(count) for l in MODELS[model]['levels'] for k in (['height'] if l==500 else ['temperature','height','u','v'])}
        identities=[]
        for receipt in point['evidence']['fields']:
            identity=receipt['decoded']
            require(identity['run']==data['run'] and identity['leadHours']==point['hour'] and identity['validTime']==point['validTime'], 'Receipt time mismatch')
            require(len(receipt['sha256'])==64 and len(receipt['indexSha256'])==64 and receipt['url'].startswith('https://'), 'Missing provenance')
            key={'gh':'height','z':'height','t':'temperature','u':'u','v':'v','pres':'pressure'}[identity['shortName']]
            identities.append((identity['member'],identity['level'],key))
        require(len(identities)==len(set(identities)) and expected<=set(identities), 'Incomplete/duplicate decoded fields')
        require(len(point['diagnostics']['heatFlux']['100']['total'])==count, 'Incomplete diagnostic member array')
        if model!='icon': require(len(point['diagnostics']['wind10hpa60N']['members'])==count, 'Incomplete wind members')
        valid=datetime.fromisoformat(point['validTime'].replace('Z','+00:00'))
        require((valid-run).total_seconds()==point['hour']*3600, 'Valid time/lead mismatch')
    return data


def report(inputs,history_path,output):
    products={}
    receipts=[]
    for model in MODELS:
        path=inputs/(model+'.json')
        products[model]=validate_product(json.loads(path.read_text()))
        receipts.append(dict(model=model,file=path.name,sha256=digest(path.read_bytes())))
    history=json.loads(history_path.read_text())
    require(history['complete'] is True and len(history['analyses'])==7 and history['sourceClass']=='operational_analysis', 'Not a complete analysis week')
    dates=[datetime.fromisoformat(p['validTime'].replace('Z','+00:00')) for p in history['analyses']]
    require(all((b-a).total_seconds()==86400 for a,b in zip(dates,dates[1:])), 'Analysis dates are not consecutive')
    for p in history['analyses']:
        require(p['evidence']['decoded'] is True and p['sourceClass']=='operational_analysis', 'Unverified history')
    common=set.intersection(*[{p['validTime'] for p in data['points']} for data in products.values()])
    require(len(common)>0, 'No matched valid times across models')
    comparisons=[]
    for valid in sorted(common):
        values={}
        for model,data in products.items():
            point=next(p for p in data['points'] if p['validTime']==valid)
            d=point['diagnostics'];flux=d['heatFlux']['100']
            wind=d['wind10hpa60N']
            values[model]=dict(run=data['run'],leadHours=point['hour'],count=data['count'],
                wind=wind.get('statistics'),temperature10K=summary(d['polarCapTemperatureK']['10']) if '10' in d['polarCapTemperatureK'] else None,
                heatFlux100={k:summary(flux[k]) for k in ['total','wave1','wave2','residual']},
                h500=point['h500']['ensembleMeanSectors'])
        # Display model-specific means and their range, never a pooled probability.
        wind_means=[v['wind']['mean'] for v in values.values() if v['wind']]
        comparisons.append(dict(validTime=valid,models=values,rangeOfModelMeanWindsMps=[min(wind_means),max(wind_means)],
                                note='Models are dependent; deterministic IFS duplicates IFS ENS control'))
    now=datetime.now(timezone.utc)
    ages={m:(now-datetime.fromisoformat(p['run'].replace('Z','+00:00'))).total_seconds()/3600 for m,p in products.items()}
    require(all(age>=0 for age in ages.values()), 'A future initialization cannot be a retrieved current run')
    result=dict(version=1,issuedAt=stamp(now),status='limited_operational_data_example' if max(ages.values())<=36 else 'historical_example_stale_for_current_use',runAgeHours=ages,
        scope='Verified initial/day-five snapshots; not a complete forecast timeline or calibrated early-warning system',
        comparisons=comparisons,sourceFiles=receipts,historySha256=digest(history_path.read_bytes()),
        runChanges={m:{k:v for k,v in p['runChanges'].items() if k!='evidence'} for m,p in products.items() if 'runChanges' in p},
        watchStage='insufficient_evidence',sswDeclared=False,
        limits=['Independent ERA5/ERA5T verification has not been included',
                'No validated/persistent cyclonic or anticyclonic breaking event diagnosis',
                'No EP-flux propagation or seasonal calibration verified',
                'Raw member fractions refer only to stated instantaneous valid times',
                'EC46 official chart is separate extended-range context; seasonal suites remain separate',
                'Only the explicitly dated cycles and fields below are verified; this report does not discover the latest provider cycles'])
    output.mkdir(parents=True,exist_ok=True)
    (output/'pulsecheck.json').write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    table=[]
    def num(x):return 'unavailable' if x is None else f'{x:+.2f}'
    for c in comparisons:
        rows=[]
        for model,v in c['models'].items():
            wind=v['wind'];fraction=f'{wind["easterlyMembers"]}/{v["count"]}' if wind and 'easterlyMembers' in wind else '—'
            flux=v['heatFlux100']
            rows.append(f'<tr><th>{escape(model.upper().replace("_"," "))}</th><td>{escape(v["run"].replace("T"," ").replace(":00:00Z","Z"))} / +{v["leadHours"]}h</td><td>{v["count"]}</td><td>{num(wind["mean"] if wind else None)}</td><td>{fraction}</td><td>{num(v["temperature10K"]["mean"]-273.15 if v["temperature10K"] else None)}</td><td>{num(flux["total"]["mean"])}</td><td>{num(flux["wave1"]["mean"])}</td><td>{num(flux["wave2"]["mean"])}</td></tr>')
        valid_label=datetime.fromisoformat(c['validTime'].replace('Z','+00:00')).strftime('%d %B %Y, %H UTC')
        table.append(f'<h2>Valid {valid_label}</h2><div class="scroll"><table><thead><tr><th>Model</th><th>Run UTC / lead</th><th>Members</th><th>U10 / 60N<br>m/s</th><th>Easterly<br>members</th><th>T10 cap<br>°C</th><th>100 hPa flux</th><th>Wave 1</th><th>Wave 2</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
    regions=['northAtlantic','europe','asia','northPacific','northAmerica','polarCap']
    history_rows=''.join('<tr><th>'+p['validTime'][:10]+'</th>'+''.join(f'<td>{p["h500"]["ensembleMeanSectors"][s]:+.1f}</td>' for s in regions)+'</tr>' for p in history['analyses'])
    trend=[]
    for model,change in result['runChanges'].items():
        for p in change['points']:
            trend.append(f'<li>{escape(model.upper())}: {escape(p["validTime"])} — mean U10 change {p["meanChange"]:+.2f} m/s from {escape(change["previousRun"])}; matched valid time.</li>')
    source_links=[]
    for model,data in products.items():
        url=data['points'][0]['evidence']['indexes'][0]['url']
        source_links.append(f'<li><a href="{escape(url)}">{escape(model)} native inventory</a> · run {escape(data["run"])} · every required member decoded; full URL/range/hash receipts in evidence files.</li>')
    html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stratoscope verified precursor pulsecheck</title><style>
    :root{color-scheme:dark}body{background:#091421;color:#e8f1f8;font:16px/1.6 system-ui,sans-serif;margin:0}main{max-width:1250px;margin:auto;padding:38px 28px}h1{font-size:36px;letter-spacing:-1px;line-height:1.15}h2{margin-top:34px;font-size:22px}.eyebrow{color:#6ce0d3;letter-spacing:.15em;font-size:12px}.notice{padding:20px;border-left:4px solid #efb55e;background:#152638}.muted{color:#a9bfce}a{color:#7fcec9}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}th,td{padding:11px 9px;border-bottom:1px solid #2b4053;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}thead{color:#9edbd7;background:#102232}details{margin-top:25px;padding:16px;background:#112231}li{margin:.45em 0}footer{margin-top:40px;color:#9cb2c2;font-size:13px}@media(max-width:600px){main{padding:22px 15px}h1{font-size:29px}}
    </style><main><p class="eyebrow">STRATOSCOPE / RESEARCH PREVIEW</p><h1>Verified SSW precursor pulsecheck</h1>'''
    html+=f'<p class="muted">Issued {now:%d %B %Y, %H:%M UTC} · {escape(result["status"].replace("_"," "))}</p><div class="notice"><strong>Watch status: insufficient evidence for an automated precursor alert.</strong><br>All values below come from retrieved, decoded model fields. These snapshots support a limited comparison, not a complete medium-range forecast or an SSW declaration.</div>'
    if all(c['models'][m]['wind']['minimum']>0 for c in comparisons for m in ('gefs','ifs_ens','aifs_ens')):
        html+='<p>Every member of GEFS, IFS ENS and AIFS ENS remains westerly at the sampled valid times shown below. Evolution between these snapshots has not been evaluated by this research run.</p>'
    html+=''.join(table)
    html+='<p class="muted">Wind is the signed native-grid longitude mean. Temperature is the area-weighted 60–90N cap on a 1° grid. Flux is member-wise v′T′ over 45–75N, in K m/s; negative flux is retained. The wave-1/2 terms need not sum to total because higher waves remain. Raw easterly-member fractions are not SSW probabilities.</p>'
    html+=f'<h2>Seven-day H500 analysis history</h2><p>GFS operational analyses, 00 UTC {dates[0]:%d %B %Y} to {dates[-1]:%d %B %Y}. Metres relative to the NCEP/NCAR R1 1991–2020 daily climatology; these are analyses, not observations or ERA5 verification. Snapshot-minus-daily-mean anomalies contain sampling and model biases.</p><div class="scroll"><table><tr><th>Date</th><th>N Atlantic</th><th>Europe</th><th>Asia</th><th>N Pacific</th><th>N America</th><th>Polar cap</th></tr>'+history_rows+'</table></div>'
    html+='<p>The same seven days have verified +2-PVU theta and flow fields. Theta on a PV surface is distinct from PV on an isentrope. No wave-breaking event is classified from this daily history.</p>'
    html+='<h2>Measured run changes</h2><ul>'+(''.join(trend) or '<li>No independent previous-run comparison retrieved.</li>')+'</ul>'
    html+='<h2>Uncertainty and separate outlooks</h2><ul>'+''.join('<li>'+escape(s)+'</li>' for s in result['limits'])+'</ul>'
    html+='<p><a href="https://charts.ecmwf.int/products/extended-zonal-mean-zonal-wind?area=nh">ECMWF EC46 official extended-range chart</a> · existing seasonal suites are monthly/seasonal context and have not been pooled with medium-range ensembles.</p>'
    html+='<details><summary>Source provenance</summary><ul>'+''.join(source_links)+'</ul><p>Companion pulsecheck.json records the exact input hashes. Evidence files retain every native GRIB URL, byte range, decoded identity, and retrieval timestamp.</p></details><footer>Review artifact only. The existing Stratoscope Pages app and forecast publishing schedules are unchanged.</footer></main></html>'
    (output/'pulsecheck.html').write_text(html,encoding='utf-8')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--inputs',type=Path,required=True);p.add_argument('--history',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();report(a.inputs,a.history,a.output)
