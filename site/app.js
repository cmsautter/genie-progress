'use strict';
const $ = id => document.getElementById(id);
const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US',{maximumFractionDigits:1}) : '—';
const names = {unsupported:'Unsupported update',initialization_unsupported:'Initialization',checkpoint_mismatch:'Checkpoint mismatch',complete_checked:'End reached · checkpoints match',complete_unchecked:'End reached · no checkpoints',parse_error:'Parse error',multiple_chapters:'Multiple chapters',timeout:'Time limit',process_failure:'Process failure',input_changed:'Input changed',worker_error:'Worker error',invalid_result:'Invalid result',version_mismatch:'Wrong version',empty:'Empty recording',pending:'Not measured yet'};
const colors = {unsupported:'#f0b17b',initialization_unsupported:'#d29279',checkpoint_mismatch:'#8da2ff',complete_checked:'#5ce0c0',complete_unchecked:'#e1d184',parse_error:'#dc8cab',multiple_chapters:'#a98cba',timeout:'#a8afbf',pending:'#25344b'};
const color = k => colors[k] || '#8391a9';
const outcome = r => r.status === 'complete' ? (r.checkpoints_passed ? 'complete_checked':'complete_unchecked') : r.status;
let manifest, data, mode = 'fixed', page = 0, selected = '', request = 0, followLatest = true;
function el(tag, text, cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function date(value){return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'In progress';}
async function refresh(){
  try {
    const response=await fetch('manifest.json',{cache:'no-store'});if(!response.ok)throw Error('The result manifest is not available yet.');manifest=await response.json();
    const age=manifest.heartbeat ? Date.now()-new Date(manifest.heartbeat).getTime():Infinity;
    $('health').textContent=age<180000?'Worker reporting':age<7200000?'Report updated '+Math.round(age/60000)+'m ago':'Worker report stale';$('health').className='health '+(age<180000?'alive':age>=7200000?'stale':'');
    $('reference-count').textContent=fmt(manifest.reference_count);$('catalog-count').textContent=fmt(manifest.catalog_count);
    const select=$('run-select');select.replaceChildren();
    for(const r of manifest.runs){const option=el('option',(r.imported?'Historical baseline':r.pilot?'Pilot':r.sha.slice(0,8))+' · '+r.status+' · '+date(r.created));option.value=r.id;select.append(option);}
    if(!manifest.runs.length)throw Error('No benchmark runs have been exported yet.');
    if(followLatest || !selected || !manifest.runs.some(r=>r.id===selected))selected=(manifest.runs.find(r=>!r.pilot)||manifest.runs[0]).id;
    select.value=selected;await load();
  } catch(error){$('error').hidden=false;$('error').textContent=error.message;}
}
async function load(){
  const current=++request;
  const response=await fetch('data/'+encodeURIComponent(selected)+'.json',{cache:'no-store'});if(!response.ok)throw Error('Selected run could not be loaded.');
  const value=await response.json();if(current!==request)return;data=value;render();
}
function render(){
  if(!data)return;const r=data.run,s=r[mode];
  $('fixed').classList.toggle('active',mode==='fixed');$('growing').classList.toggle('active',mode==='growing');
  $('fixed').setAttribute('aria-pressed',mode==='fixed');$('growing').setAttribute('aria-pressed',mode==='growing');
  $('scope-note').textContent=mode==='fixed'?'The frozen 5,604-match cohort. Its membership stays constant across full runs.':'All eligible matches frozen at the start of this run. New discoveries enter the next run.';
  if(r.pilot)$('scope-note').textContent+=' This is a limited pilot; it does not cover the full cohort.';
  $('run-state').textContent=r.status==='running'?'● Measuring recordings':r.status==='building'?'● Building engine':r.status==='complete'?'● Run complete':r.status;
  const commit=el('a',r.sha.slice(0,12));commit.href='https://github.com/librematch/genie/commit/'+r.sha;commit.target='_blank';commit.rel='noopener';$('commit').replaceChildren(commit);
  $('run-time').textContent=(r.imported?'Imported historical scan · ':'')+r.architecture+' · '+date(r.finished||r.created);
  $('run-progress').style.width=(100*s.finished/Math.max(1,s.total))+'%';
  $('measured').textContent=fmt(s.finished);$('measured-sub').textContent='of '+fmt(s.total)+' in this snapshot';
  $('checked').textContent=fmt(s.counts.complete_checked||0);
  $('checked-sub').textContent=fmt(s.counts.complete_unchecked||0)+' end reached without usable checkpoints';
  $('median').textContent=s.median_percent===null?'—':s.median_percent.toFixed(s.median_percent<1?3:1)+'%';
  $('median-sub').textContent=fmt(s.median_ticks)+' updates · '+fmt(s.measurable)+' measurable cases';
  const c=r.comparison;$('advanced').textContent=c.comparable?'+'+fmt(c.improved):'Baseline';
  $('advanced-sub').textContent=c.comparable?fmt(c.regressed)+' earlier stops · '+fmt(c.comparable)+' comparable matches':'Reference for subsequent snapshots';
  $('outcome-note').textContent=fmt(s.total-s.finished)+' pending';
  $('outcome-bar').replaceChildren();$('outcome-legend').replaceChildren();
  const counts={...s.counts};if(s.total>s.finished)counts.pending=s.total-s.finished;
  for(const [key,count] of Object.entries(counts)){const bar=el('div');bar.style.width=100*count/Math.max(1,s.total)+'%';bar.style.background=color(key);bar.title=(names[key]||key)+': '+fmt(count);$('outcome-bar').append(bar);const label=el('span');const swatch=el('i');swatch.style.background=color(key);label.append(swatch,document.createTextNode(names[key]||key),el('b',fmt(count)));$('outcome-legend').append(label);}
  chart('percent-chart',s.histogram);chart('ticks-chart',s.ticks_histogram);
  $('blockers').replaceChildren();for(const b of s.blockers.slice(0,7)){const item=el('div'),line=el('div',undefined,'blocker-label'),label=el('span',b.reason);label.title=b.reason;line.append(label,el('strong',fmt(b.count)));const track=el('div',undefined,'blocker-track'),fill=el('div');fill.style.width=100*b.count/Math.max(1,s.blockers[0].count)+'%';track.append(fill);item.append(line,track);$('blockers').append(item);}
  if(!s.blockers.length)$('blockers').append(el('p','No unsupported-condition results reported in this snapshot.','chart-note'));
  $('error').hidden=!r.error;$('error').textContent=r.error||'';
  $('identity').textContent=JSON.stringify({run_id:r.id,...data.identity,comparison_note:'Progress changes compare the same recording hashes in the fixed cohort; historical and current instrumentation are identified separately.'},null,2);
  $('download').href='data/'+r.id+'.json';
  const filter=$('status-filter'),keep=filter.value;filter.replaceChildren(new Option('All outcomes','all'));for(const key of Object.keys(s.counts))filter.add(new Option(names[key]||key,key));filter.value=Object.hasOwn(s.counts,keep)?keep:'all';
  renderTable();
}
function chart(id,buckets){
  const W=620,H=id==='ticks-chart'?200:265,L=35,R=10,T=14,B=52,plotH=H-T-B,plotW=W-L-R;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const totals=buckets.map(b=>Object.values(b.counts).reduce((a,n)=>a+n,0)),max=Math.max(1,...totals),scale=n=>Math.log10(n+1)/Math.log10(max+1)*plotH;
  function node(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;}
  for(let tick=1;tick<=max;tick*=10){const y=T+plotH-scale(tick);node('line',{x1:L,y1:y,x2:W-R,y2:y,stroke:'#243148','stroke-dasharray':'3 4'});node('text',{x:L-7,y:y+3,'text-anchor':'end'},fmt(tick));}
  const step=plotW/Math.max(1,buckets.length);
  buckets.forEach((bucket,i)=>{let cumulative=0;const total=totals[i];for(const [key,count]of Object.entries(bucket.counts)){const bottom=scale(cumulative),top=scale(cumulative+count);const rect=node('rect',{x:L+i*step+2,y:T+plotH-top,width:Math.max(1,step-4),height:top-bottom,fill:color(key),rx:1});const title=document.createElementNS(ns,'title');title.textContent=bucket.label+' · '+(names[key]||key)+': '+count;rect.append(title);cumulative+=count;}if(total)node('text',{x:L+(i+.5)*step,y:T+plotH-scale(total)-5,'text-anchor':'middle','font-size':8},fmt(total));if(buckets.length<35||i%Math.ceil(buckets.length/25)===0){const x=L+(i+.5)*step;node('text',{x,y:H-36,transform:`rotate(-52 ${x} ${H-36})`,'text-anchor':'end'},bucket.label);}});
  $(id).replaceChildren(svg);
}
function renderTable(){
  if(!data)return;let rows=data.rows.filter(r=>mode==='growing'||r.fixed);const term=$('search').value.toLowerCase(),filter=$('status-filter').value;
  rows=rows.filter(r=>(filter==='all'||outcome(r)===filter)&&(!term||r.match_id.includes(term)||JSON.stringify(r.unsupported||r.reason||r.differences||'').toLowerCase().includes(term)));
  const progress=r=>r.total_ticks?100*(r.completed_ticks||0)/r.total_ticks:-1;
  rows.sort((a,b)=>$('sort').value==='id'?a.match_id.localeCompare(b.match_id):($('sort').value==='progress-asc'?1:-1)*(progress(a)-progress(b))||a.match_id.localeCompare(b.match_id));
  const pages=Math.max(1,Math.ceil(rows.length/30));page=Math.max(0,Math.min(page,pages-1));$('rows').replaceChildren();
  for(const r of rows.slice(page*30,(page+1)*30)){const tr=el('tr'),link=el('a',r.match_id);link.href='https://www.aoe2insights.com/match/'+r.match_id+'/';link.target='_blank';link.rel='noopener';const first=el('td');first.append(link);const status=el('td'),badge=el('span',names[outcome(r)]||r.status,'badge');badge.style.setProperty('--badge',color(outcome(r)));status.append(badge);const ticks=el('td',r.total_ticks===undefined?'—':fmt(r.completed_ticks||0)+' / '+fmt(r.total_ticks));const percent=el('td');const meter=el('span',progress(r)<0?'—':progress(r).toFixed(2)+'%','micro-progress');meter.style.setProperty('--percent',Math.max(0,progress(r))+'%');percent.append(meter);const checkpoint=el('td',r.total_checkpoints===undefined?'—':fmt(r.checkpoints_passed||0)+' / '+fmt(r.total_checkpoints));if(r.ignored_commands_to_stop)checkpoint.title=r.ignored_commands_to_stop+' ignored command packets before stop';let reason=r.unsupported?.map(v=>v.reason).join('; ')||r.reason||'';if(r.status==='checkpoint_mismatch')reason='Mismatch after update '+fmt(r.first_failure_tick)+' · words '+[...new Set((r.differences||[]).map(d=>d.word))].join(', ');if(r.status==='complete')reason=r.checkpoints_passed?'All usable recorded checkpoints matched.':'No usable recorded checkpoints.';if(r.ignored_commands_to_stop)reason+=' '+fmt(r.ignored_commands_to_stop)+' ignored command packets.';tr.append(first,status,ticks,percent,checkpoint,el('td',reason));$('rows').append(tr);}
  $('row-count').textContent=fmt(rows.length)+' matching recordings';$('page-number').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
}
for(const key of ['fixed','growing'])$(key).onclick=()=>{mode=key;page=0;render();};
$('run-select').onchange=()=>{followLatest=false;selected=$('run-select').value;page=0;load().catch(e=>{$('error').hidden=false;$('error').textContent=e.message;});};
for(const id of ['search','status-filter','sort'])$(id).addEventListener('input',()=>{page=0;renderTable();});
$('previous').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('provenance').onclick=()=>$('method').showModal();$('close-method').onclick=()=>$('method').close();
refresh();setInterval(refresh,60000);
