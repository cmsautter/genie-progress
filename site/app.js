'use strict';
const $ = id => document.getElementById(id);
const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US',{maximumFractionDigits:1}) : '—';
const names = {unsupported:'Unsupported update',initialization_unsupported:'Initialization',checkpoint_mismatch:'Checkpoint mismatch',complete_checked:'End reached · checkpoints match',complete_unchecked:'End reached · no checkpoints',parse_error:'Parse error',multiple_chapters:'Multiple chapters',timeout:'Time limit',process_failure:'Process failure',input_changed:'Input changed',worker_error:'Worker error',invalid_result:'Invalid result',version_mismatch:'Wrong version',empty:'Empty recording',pending:'Not measured yet'};
const colors = {unsupported:'#f0b17b',initialization_unsupported:'#d29279',checkpoint_mismatch:'#8da2ff',complete_checked:'#5ce0c0',complete_unchecked:'#e1d184',parse_error:'#dc8cab',multiple_chapters:'#a98cba',timeout:'#a8afbf',pending:'#25344b'};
const color = k => colors[k] || '#8391a9';
const outcome = r => r.status === 'complete' ? (r.checkpoints_passed ? 'complete_checked':'complete_unchecked') : r.status;
let manifest, data, mode = 'fixed', page = 0, selected = '', request = 0, followLatest = true;
let manifestRequest=0, detailsReady=false, detailsLoading=false, detailsError='', pendingKey='', detailsController;
let selectorKey='';
const detailsCache=new Map();
function el(tag, text, cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function recordingLink(r){
  if(/^\d+$/.test(r.match_id)){
    const link=el('a',r.match_id);link.href='https://www.aoe2insights.com/match/'+r.match_id+'/';link.target='_blank';link.rel='noopener';return link;
  }
  const ttl=/^ttl:(.*):[0-9a-f]{12}$/.exec(r.match_id);
  const label=el('span',ttl?'TTL · '+ttl[1].replaceAll('_',' '):r.match_id);label.title=r.match_id;return label;
}
function date(value){return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'In progress';}
function visibleRuns(runs){
  const predecessors=new Set(runs.map(r=>r.continuation?.run_id).filter(Boolean));
  return runs.filter(r=>!(r.status==='continued'&&predecessors.has(r.id)));
}
function runName(r){return r.imported?'Historical baseline':r.pilot?'Pilot '+r.sha.slice(0,8):r.sha.slice(0,8);}
function runStatus(r){
  if(r.status==='build_failed')return {adapter:'Adapter update needed',setup:'Worker setup failed',dependencies:'Dependency fetch failed',compilation:'Build failed',artifact:'Build output missing'}[r.failure?.stage]||'Build failed';
  return {running:'In progress',queued:'Queued',building:'Preparing and building engine',complete:'Complete',continued:'Archived worker'}[r.status]||r.status;
}
function runLabel(r){
  return runName(r)+' · '+runStatus(r)+' · '+date(r.created);
}
function syncSelector(runs,force=false){
  const select=$('run-select');
  // Rebuilding a focused native menu can discard a choice before change fires.
  if(!force&&document.activeElement===select)return;
  const key=JSON.stringify(runs.map(r=>[r.id,runLabel(r)]));
  if(key!==selectorKey){
    select.replaceChildren();
    for(const [label,items]of [['Benchmark runs',runs.filter(r=>!r.pilot)],['Diagnostic pilots',runs.filter(r=>r.pilot)]]){
      if(!items.length)continue;
      const group=el('optgroup');group.label=label;
      for(const r of items){const option=el('option',runLabel(r));option.value=r.id;group.append(option);}
      select.append(group);
    }
    selectorKey=key;
  }
  select.value=selected;
}
function detailsVersion(r){
  const changing=['running','queued','building'].includes(r.status);
  return [r.id,r.status,r.finished||'',r.fixed.finished,r.growing.finished,changing?manifest.generated:''].join('|');
}
async function refresh(){
  const current=++manifestRequest;
  try {
    const response=await fetch('manifest.json',{cache:'no-store'});if(!response.ok)throw Error('The result manifest is not available yet.');
    const value=await response.json();if(current!==manifestRequest)return;manifest=value;
    const age=manifest.heartbeat ? Date.now()-new Date(manifest.heartbeat).getTime():Infinity;
    $('health').textContent=age<180000?'Worker reporting':age<7200000?'Report updated '+Math.round(age/60000)+'m ago':'Worker report stale';$('health').className='health '+(age<180000?'alive':age>=7200000?'stale':'');
    $('reference-count').textContent=fmt(manifest.reference_count);$('catalog-count').textContent=fmt(manifest.catalog_count);
    const runs=visibleRuns(manifest.runs);
    if(!runs.length)throw Error('No benchmark runs have been exported yet.');
    if(!selected||!runs.some(r=>r.id===selected)||(followLatest&&document.activeElement!==$('run-select')))
      selected=(runs.find(r=>!r.pilot)||runs[0]).id;
    syncSelector(runs);await loadDetails(runs.find(r=>r.id===selected));
  } catch(error){$('error').hidden=false;$('error').textContent=error.message;}
}
async function loadDetails(run){
  const id=run.id,version=detailsVersion(run);
  if(pendingKey===version){data.run=run;render();return;}
  const current=++request;
  if(detailsController)detailsController.abort();
  detailsController=new AbortController();pendingKey='';detailsError='';
  const cached=detailsCache.get(id);
  if(cached?.version===version){
    data={...cached.value,run};detailsReady=true;detailsLoading=false;render();return;
  }
  const same=data?.run.id===id;
  if(same){data={...data,run};}else{data={run,rows:[],identity:null};detailsReady=false;page=0;}
  detailsLoading=true;pendingKey=version;
  // Summary data is already in the small manifest. Switch it before the large download.
  render();
  try{
    const response=await fetch('data/'+encodeURIComponent(id)+'.json?v='+encodeURIComponent(version),
                               {cache:'no-store',signal:detailsController.signal});
    if(!response.ok)throw Error('Recording details for '+runName(run)+' could not be loaded.');
    const value=await response.json();
    if(current!==request||selected!==id)return;
    if(value.run?.id!==id||!Array.isArray(value.rows))throw Error('The server returned details for a different snapshot.');
    detailsCache.delete(id);detailsCache.set(id,{version,value});
    while(detailsCache.size>3)detailsCache.delete(detailsCache.keys().next().value);
    data={...value,run};detailsReady=true;detailsLoading=false;pendingKey='';render();
  }catch(error){
    if(current!==request||error.name==='AbortError')return;
    detailsLoading=false;pendingKey='';detailsError=error.message;render();
  }
}
function selectSnapshot(id){
  const run=visibleRuns(manifest.runs).find(r=>r.id===id);if(!run)return;
  followLatest=false;selected=id;page=0;return loadDetails(run);
}
function render(){
  if(!data)return;const r=data.run,s=r[mode];
  $('fixed').classList.toggle('active',mode==='fixed');$('growing').classList.toggle('active',mode==='growing');
  $('fixed').setAttribute('aria-pressed',mode==='fixed');$('growing').setAttribute('aria-pressed',mode==='growing');
  $('scope-note').textContent=mode==='fixed'?'The frozen 5,604-match cohort. Its membership stays constant across full runs.':'All eligible matches frozen at the start of this run. New discoveries enter the next run.';
  if(r.pilot)$('scope-note').textContent+=' This is a limited pilot; it does not cover the full cohort.';
  $('run-state').textContent='● '+(r.status==='running'?'Measuring recordings':r.status==='complete'?'Run complete':runStatus(r));
  $('run-state').setAttribute('data-state',r.status);
  const commit=el('a',r.sha.slice(0,12));commit.href='https://github.com/librematch/genie/commit/'+r.sha;commit.target='_blank';commit.rel='noopener';$('commit').replaceChildren(commit);
  $('run-time').textContent=(r.imported?'Imported historical scan · ':'')+r.architecture+' · '+date(r.finished||r.created);
  if(r.build_profile)$('run-time').textContent+=' · '+r.build_profile;
  if(r.case_workers)$('run-time').textContent+=' · up to '+fmt(r.case_workers)+' processes';
  if(r.continuation)$('run-time').textContent+=' · '+fmt(r.continuation.preserved_results)+' results retained from prior worker';
  $('run-progress').style.width=(100*s.finished/Math.max(1,s.total))+'%';
  $('measured').textContent=fmt(s.finished);$('measured-sub').textContent='of '+fmt(s.total)+' in this snapshot';
  $('checked').textContent=fmt(s.counts.complete_checked||0);
  $('checked-sub').textContent=fmt(s.counts.complete_unchecked||0)+' end reached without usable checkpoints';
  $('median').textContent=s.median_percent===null?'—':s.median_percent.toFixed(s.median_percent<1?3:1)+'%';
  $('median-sub').textContent=fmt(s.median_ticks)+' updates · '+fmt(s.measurable)+' measurable cases';
  const c=r.comparison;$('advanced').textContent=c.comparable?'+'+fmt(c.improved):'Baseline';
  $('advanced-sub').textContent=c.comparable?fmt(c.regressed)+' earlier stops · '+fmt(c.comparable)+' comparable matches':'Reference for subsequent snapshots';
  const waiting=r.status==='build_failed'?'Not run':'Not measured yet';
  $('outcome-note').textContent=fmt(s.total-s.finished)+(r.status==='build_failed'?' not run':' pending');
  $('outcome-bar').replaceChildren();$('outcome-legend').replaceChildren();
  const counts={...s.counts};if(s.total>s.finished)counts.pending=s.total-s.finished;
  for(const [key,count] of Object.entries(counts)){const labelText=key==='pending'?waiting:names[key]||key;const bar=el('div');bar.style.width=100*count/Math.max(1,s.total)+'%';bar.style.background=color(key);bar.title=labelText+': '+fmt(count);$('outcome-bar').append(bar);const label=el('span');const swatch=el('i');swatch.style.background=color(key);label.append(swatch,document.createTextNode(labelText),el('b',fmt(count)));$('outcome-legend').append(label);}
  chart('percent-chart',s.histogram);chart('ticks-chart',s.ticks_histogram);
  $('blockers').replaceChildren();for(const b of s.blockers.slice(0,7)){const item=el('div'),line=el('div',undefined,'blocker-label'),label=el('span',b.reason);label.title=b.reason;line.append(label,el('strong',fmt(b.count)));const track=el('div',undefined,'blocker-track'),fill=el('div');fill.style.width=100*b.count/Math.max(1,s.blockers[0].count)+'%';track.append(fill);item.append(line,track);$('blockers').append(item);}
  if(!s.blockers.length)$('blockers').append(el('p','No unsupported-condition results reported in this snapshot.','chart-note'));
  const error=detailsError||r.failure?.message||r.error;$('error').hidden=!error;$('error').textContent=error||'';
  $('failure-diagnostics').hidden=!r.failure;
  $('failure-diagnostic-text').textContent=r.failure?'Stage: '+r.failure.stage+'\nCode: '+r.failure.code+'\n\n'+(r.failure.details||r.failure.message):'';
  const untested=r.status==='build_failed'&&s.finished===0;
  $('table-state').hidden=!detailsLoading&&!detailsError&&!untested;
  $('table-state').textContent=detailsError?'Recording details unavailable.':untested?'No replay tests were started. This snapshot has no simulation results.':detailsReady?'Updating recording details…':'Loading recording details for '+runName(r)+'…';
  $('retry-details').hidden=!detailsError;
  for(const id of ['search','status-filter','sort'])$(id).disabled=!detailsReady;
  $('identity').textContent=JSON.stringify({run_id:r.id,...(data.identity||{}),details_loaded:detailsReady,comparison_note:'Progress changes compare the same recording hashes in the fixed cohort; historical and current instrumentation are identified separately.'},null,2);
  const prior=$('prior-worker');prior.hidden=!r.continuation;
  if(r.continuation){prior.href='data/'+encodeURIComponent(r.continuation.run_id)+'.json';prior.textContent='Download the pre-upgrade worker snapshot ('+fmt(r.continuation.preserved_results)+' retained results)';}
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
  if(!detailsReady){$('rows').replaceChildren();$('row-count').textContent=detailsError?'Recording details unavailable':'Loading recording details…';$('page-number').textContent='—';$('previous').disabled=true;$('next').disabled=true;return;}
  if(!data)return;let rows=data.rows.filter(r=>mode==='growing'||r.fixed);const term=$('search').value.toLowerCase(),filter=$('status-filter').value;
  rows=rows.filter(r=>(filter==='all'||outcome(r)===filter)&&(!term||r.match_id.toLowerCase().includes(term)||JSON.stringify(r.unsupported||r.reason||r.differences||'').toLowerCase().includes(term)));
  const progress=r=>r.total_ticks?100*(r.completed_ticks||0)/r.total_ticks:-1;
  rows.sort((a,b)=>$('sort').value==='id'?a.match_id.localeCompare(b.match_id):($('sort').value==='progress-asc'?1:-1)*(progress(a)-progress(b))||a.match_id.localeCompare(b.match_id));
  const pages=Math.max(1,Math.ceil(rows.length/30));page=Math.max(0,Math.min(page,pages-1));$('rows').replaceChildren();
  for(const r of rows.slice(page*30,(page+1)*30)){const tr=el('tr'),link=recordingLink(r);const first=el('td');first.append(link);const status=el('td'),badge=el('span',names[outcome(r)]||r.status,'badge');badge.style.setProperty('--badge',color(outcome(r)));status.append(badge);const ticks=el('td',r.total_ticks===undefined?'—':fmt(r.completed_ticks||0)+' / '+fmt(r.total_ticks));const percent=el('td');const meter=el('span',progress(r)<0?'—':progress(r).toFixed(2)+'%','micro-progress');meter.style.setProperty('--percent',Math.max(0,progress(r))+'%');percent.append(meter);const checkpoint=el('td',r.total_checkpoints===undefined?'—':fmt(r.checkpoints_passed||0)+' / '+fmt(r.total_checkpoints));if(r.ignored_commands_to_stop)checkpoint.title=r.ignored_commands_to_stop+' ignored command packets before stop';let reason=r.unsupported?.map(v=>v.reason).join('; ')||r.reason||'';if(r.status==='checkpoint_mismatch')reason='Mismatch after update '+fmt(r.first_failure_tick)+' · words '+[...new Set((r.differences||[]).map(d=>d.word))].join(', ');if(r.status==='complete')reason=r.checkpoints_passed?'All usable recorded checkpoints matched.':'No usable recorded checkpoints.';if(r.ignored_commands_to_stop)reason+=' '+fmt(r.ignored_commands_to_stop)+' ignored command packets.';tr.append(first,status,ticks,percent,checkpoint,el('td',reason));$('rows').append(tr);}
  $('row-count').textContent=fmt(rows.length)+' matching recordings';$('page-number').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
}
for(const key of ['fixed','growing'])$(key).onclick=()=>{mode=key;page=0;render();};
const showLoadError=error=>{$('error').hidden=false;$('error').textContent=error.message;};
$('run-select').onchange=event=>{const pending=selectSnapshot(event.currentTarget.value);if(pending)pending.catch(showLoadError);};
$('run-select').onblur=()=>{if(manifest)syncSelector(visibleRuns(manifest.runs),true);};
$('retry-details').onclick=()=>{detailsCache.delete(selected);loadDetails(manifest.runs.find(r=>r.id===selected)).catch(showLoadError);};
for(const id of ['search','status-filter','sort'])$(id).addEventListener('input',()=>{page=0;renderTable();});
$('previous').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('provenance').onclick=()=>$('method').showModal();$('close-method').onclick=()=>$('method').close();
refresh();setInterval(refresh,60000);
