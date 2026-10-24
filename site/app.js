'use strict';
const $ = id => document.getElementById(id);
const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US',{maximumFractionDigits:1}) : '—';
const elapsedSeconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const replayTime = value => elapsedSeconds(value) === null ? '—' : value.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'s';
function runDuration(value){
  if(elapsedSeconds(value)===null)return '—';
  const tenths=Math.round(value*10),hours=Math.floor(tenths/36000),minutes=Math.floor(tenths%36000/600),seconds=(tenths%600/10).toFixed(1);
  return (hours?hours+'h ':'')+(minutes||hours?minutes+'m ':'')+seconds+'s';
}
const names = {unsupported:'Unsupported update',initialization_unsupported:'Initialization',checkpoint_mismatch:'Checkpoint mismatch',complete_checked:'End reached · checkpoints match',complete_unchecked:'End reached · no checkpoints',parse_error:'Parse error',multiple_chapters:'Multiple chapters',timeout:'Time limit',process_failure:'Process failure',input_changed:'Input changed',worker_error:'Worker error',invalid_result:'Invalid result',version_mismatch:'Wrong version',empty:'Empty recording',pending:'Not measured yet'};
const colors = {unsupported:'#f0b17b',initialization_unsupported:'#d29279',checkpoint_mismatch:'#8da2ff',complete_checked:'#5ce0c0',complete_unchecked:'#e1d184',parse_error:'#dc8cab',multiple_chapters:'#a98cba',timeout:'#a8afbf',pending:'#25344b'};
const color = k => colors[k] || '#8391a9';
const outcomeOrder=['initialization_unsupported','unsupported','checkpoint_mismatch','complete_unchecked','complete_checked','parse_error','multiple_chapters','timeout','process_failure','input_changed','worker_error','invalid_result','version_mismatch','empty','pending'];
function orderedOutcomes(keys){
  const rank=key=>{const i=outcomeOrder.indexOf(key);return i<0?outcomeOrder.length:i;};
  return [...new Set(keys)].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
}
const outcome = r => r.status === 'complete' ? (r.checkpoints_passed ? 'complete_checked':'complete_unchecked') : r.status;
let manifest, data, mode = 'fixed', page = 0, selected = '', request = 0, followLatest = true;
const cohortScopes=['core500','extension500','combined1000'];
const corpusScopes=[...cohortScopes,'growing','fixed'];
let modeChosen=false;
const inScope=(row,scope=mode)=>scope==='growing'||(scope==='fixed'?!!row.fixed:row.cohorts?.includes(scope));
let manifestRequest=0, detailsReady=false, detailsLoading=false, detailsError='', pendingKey='', detailsController;
let selectorKey='';
let chartScale='log',chartOutcome='all',chartSelectorKey='';
let commandCoverage,commandCoverageState='loading',commandCoverageError='',commandRequest=0,commandController,commandPendingKey='';
let commandStandard='reviewed',commandShowAll=false;
let replayChanges,changesError='',changesLoading=false,changesRequest=0,changesController,changesPendingKey='',changesPage=0;
const changesCache=new Map();
const detailsCache=new Map();
let checkpointDefinitions;
const openMismatches=new Set();
const manifestStorageKey='genie-replay-lab:latest-verified-manifest:v1';
const changesStorageKey='genie-replay-lab:latest-verified-changes:v1';
let fetchNonce=0;
function refreshNote(text){$('refresh-note').textContent=text;$('refresh-note').hidden=!text;}
function validManifest(value){
  return Array.isArray(value?.runs)&&Number.isFinite(Date.parse(value.generated))&&
    (!value.publication||Number.isFinite(Date.parse(value.publication.created)))&&value.runs.every(run=>
    run&&typeof run.id==='string'&&typeof run.sha==='string'&&Number.isFinite(Date.parse(run.created))&&
    ['fixed','growing'].every(scope=>typeof run[scope]?.finished==='number'&&typeof run[scope]?.total==='number'));
}
function storedManifest(){
  try{const value=JSON.parse(globalThis.sessionStorage?.getItem(manifestStorageKey)||'null');return validManifest(value)?value:null;}
  catch{return null;}
}
function rememberManifest(value){
  try{globalThis.sessionStorage?.setItem(manifestStorageKey,JSON.stringify(value));}catch{/* Storage is optional. */}
}
function validReplayChanges(value,run){
  return value?.schema===1&&value.run?.id===run.id&&value.run.sha===run.sha&&Array.isArray(value.rows)
    &&(!value.available||(value.fixed?.total_recordings===run.fixed.total&&value.growing?.total_recordings===run.growing.total))
    &&(!run.changes||value.baseline?.id===(run.changes.baseline_id||undefined));
}
function storedChanges(run){
  try{
    const entry=JSON.parse(globalThis.sessionStorage?.getItem(changesStorageKey)||'null');
    return entry?.runId===run.id&&typeof entry.version==='string'&&validReplayChanges(entry.value,run)?entry:null;
  }catch{return null;}
}
function rememberChanges(run,version,value){
  try{globalThis.sessionStorage?.setItem(changesStorageKey,JSON.stringify({runId:run.id,version,value}));}catch{/* Storage is optional. */}
}
function olderManifest(value,previous){
  // Request IDs protect against late network requests, not old bytes returned
  // by a cache for a newer request. Compare the publication itself as well.
  if(previous.publication&&!value.publication)return true;
  const stamp=m=>Date.parse(m.publication?.created||m.generated);
  if(Number.isFinite(stamp(value))&&Number.isFinite(stamp(previous))&&stamp(value)<stamp(previous))return true;
  const latest=m=>visibleRuns(m.runs)[0];
  if(latest(value)&&latest(previous)&&Date.parse(latest(value).created)<Date.parse(latest(previous).created))return true;
  const current=new Map(value.runs.map(run=>[run.id,run]));
  const rank={queued:0,building:1,running:2,complete:3,build_failed:3,continued:3,aborted:3};
  for(const old of previous.runs){
    const run=current.get(old.id);if(!run)continue;
    if(['fixed','growing'].some(scope=>run[scope].finished<old[scope].finished))return true;
    if(rank[run.status]<rank[old.status])return true;
  }
  return false;
}
function reportURL(file,fallback,version,retry=false){
  const path=file?.url||fallback;
  if(!/^(data|coverage|changes)\/[A-Za-z0-9_-]+\.json$/.test(path))throw Error('Invalid report URL.');
  return path+'?v='+encodeURIComponent(file?.sha256||version)+(retry?'&retry='+Date.now()+'-'+(++fetchNonce):'');
}
async function reportJSON(file,fallback,version,signal){
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(reportURL(file,fallback,version,attempt>0),{cache:'no-store',signal});
    if(!response.ok){if(attempt===0&&response.status===404&&file?.sha256)continue;const error=Error(response.status===404?'Report is not available in this published snapshot yet.':'Report could not be loaded.');error.status=response.status;throw error;}
    if(!file?.sha256)return response.json();
    if(!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid report version.');
    if(!globalThis.crypto?.subtle)throw Error('This browser cannot verify report versions.');
    const raw=await response.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash===file.sha256&&(file.bytes===undefined||file.bytes===raw.byteLength))return JSON.parse(new TextDecoder().decode(raw));
  }
  throw Error('A cache returned a different report version. Keeping the previous verified results and retrying on the next refresh.');
}
function el(tag, text, cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
async function loadCheckpointDefinitions(){
  try{
    const response=await fetch('checkpoint-checks.json',{cache:'no-cache'});
    if(!response.ok)return;
    const value=await response.json();
    if(value.build!==158041||value.word_index_base!==0||!Array.isArray(value.checks))return;
    checkpointDefinitions=value;
    if(detailsReady){renderCheckpointGroups();renderTable();}
  }catch{/* Raw word numbers remain available when the category file cannot be loaded. */}
}
function checkpointCheck(row,word){
  return (checkpointDefinitions&&row.build===checkpointDefinitions.build&&checkpointDefinitions.checks.find(check=>check.word===word))
    ||{word,label:'Checkpoint word '+word,description:'No verified category mapping is available for this build and word.'};
}
function checkpointCategories(row){
  return [...new Set((row.differences||[]).map(d=>d.word))].sort((a,b)=>a-b).map(word=>checkpointCheck(row,word));
}
function checkpointReason(row){
  const categories=checkpointCategories(row);
  return 'Mismatch at update '+fmt(row.first_failure_tick)+(categories.length?' · '+categories.map(check=>check.label).join('; '):' · check details unavailable');
}
function checkpointDetails(row){
  const details=el('details',undefined,'checkpoint-details'),key=data.run.id+':'+row.match_id;
  details.open=openMismatches.has(key);
  details.addEventListener('toggle',()=>{if(details.open)openMismatches.add(key);else openMismatches.delete(key);});
  details.append(el('summary',checkpointReason(row)));
  details.append(el('p',row.checkpoints_passed?'Last matching checkpoint: update '+fmt(row.last_matching_checkpoint_tick)+'.':'No earlier recorded checkpoint matched.','chart-note'));
  details.append(el('p','These are aggregate checks. They identify the differing category, not a particular object or the update where divergence began. Sums wrap at 32 bits.','chart-note'));
  if(row.differences?.length){
    const table=el('table',undefined,'checkpoint-values'),head=el('thead'),heading=el('tr');
    for(const text of ['Player','Check (zero-based word)','Recorded','Simulated'])heading.append(el('th',text));
    head.append(heading);table.append(head);const body=el('tbody');
    for(const difference of row.differences){
      const check=checkpointCheck(row,difference.word),tr=el('tr'),label=el('td',check.label+' ('+difference.word+')');
      label.title=check.description;
      tr.append(el('td',difference.player===0?'Gaia (0)':'Player '+difference.player),label,el('td',fmt(difference.recorded)),el('td',fmt(difference.simulated)));body.append(tr);
    }
    table.append(body);details.append(table);
  }
  if(row.ignored_commands_to_stop)details.append(el('p',fmt(row.ignored_commands_to_stop)+' ignored command packets before this checkpoint.','chart-note'));
  return details;
}
function renderCheckpointGroups(){
  const groups=new Map(),rows=detailsReady?data.rows.filter(r=>r.status==='checkpoint_mismatch'&&inScope(r)):[];
  for(const row of rows){
    const checks=checkpointCategories(row);
    for(const check of checks.length?checks:[{word:null,label:'Check details unavailable'}]){
      const group=groups.get(check.label)||{...check,ids:new Set()};group.ids.add(row.match_id);groups.set(check.label,group);
    }
  }
  $('checkpoint-panel').hidden=!detailsReady||!rows.length;
  $('checkpoint-count').textContent=fmt(rows.length)+(rows.length===1?' recording':' recordings');$('checkpoint-groups').replaceChildren();
  const ranked=[...groups.values()].sort((a,b)=>b.ids.size-a.ids.size||a.word-b.word);
  for(const group of ranked){
    const item=el('div'),button=el('button',undefined,'checkpoint-group'),track=el('div',undefined,'blocker-track'),fill=el('div');
    button.type='button';button.append(el('span',group.label),el('strong',fmt(group.ids.size)));button.title=group.description||group.label;
    button.onclick=()=>{$('status-filter').value='checkpoint_mismatch';$('search').value=group.word===null?'check details unavailable':group.label;page=0;renderTable();};
    fill.style.width=100*group.ids.size/Math.max(1,ranked[0].ids.size)+'%';track.append(fill);item.append(button,track);$('checkpoint-groups').append(item);
  }
}
function recordingLink(r){
  if(/^\d+$/.test(r.match_id)){
    const link=el('a',r.match_id);link.href='https://www.aoe2insights.com/match/'+r.match_id+'/';link.target='_blank';link.rel='noopener';return link;
  }
  const ttl=/^ttl:(.*):[0-9a-f]{12}$/.exec(r.match_id);
  const label=el('span',ttl?'TTL · '+ttl[1].replaceAll('_',' '):r.match_id);label.title=r.match_id;return label;
}
function date(value){return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'In progress';}
function visibleRuns(runs){
  const seen=new Set();
  return [...runs].sort((a,b)=>Date.parse(b.created)-Date.parse(a.created)).filter(r=>{
    if(r.pilot||r.status==='continued')return false;
    const key=r.imported?'historical:'+r.id:r.sha+':'+(r.build_profile||'legacy');
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
function runName(r){return r.imported?'Historical baseline':r.pilot?'Pilot '+r.sha.slice(0,8):r.sha.slice(0,8);}
function runStatus(r){
  if(r.status==='build_failed')return {adapter:'Adapter update needed',setup:'Worker setup failed',dependencies:'Dependency fetch failed',compilation:'Build failed',artifact:'Build output missing'}[r.failure?.stage]||'Build failed';
  if(r.status==='running'&&r.execution?.phase==='retrying')return 'Retrying timeouts';
  if(r.status==='running'&&r.execution?.phase==='finalizing')return 'Finalizing results';
  return {running:'In progress',queued:'Queued',building:'Preparing and building engine',complete:'Complete',continued:'Archived worker',aborted:'Aborted'}[r.status]||r.status;
}
function runLabel(r){
  const profile=r.imported?'':({release:'Release',forced:'Profiling'}[r.build_profile]||r.build_profile||'');
  return runName(r)+(profile?' · '+profile:'')+' · '+runStatus(r)+' · '+date(r.created);
}
function renderArchive(runs,visible){
  const shown=new Set(visible.map(r=>r.id)),archived=runs.filter(r=>!shown.has(r.id));
  $('archived-runs').hidden=!archived.length;
  $('archived-count').textContent=fmt(archived.length);
  $('archived-list').replaceChildren();
  for(const r of archived){
    const item=el('li'),link=el('a',runLabel(r));
    link.href='data/'+encodeURIComponent(r.id)+'.json';link.download='';item.append(link);$('archived-list').append(item);
  }
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
  if(r.files?.details)return r.files.details.sha256;
  const changing=['running','queued','building'].includes(r.status);
  return [r.id,r.status,r.finished||'',r.fixed.finished,r.growing.finished,changing?manifest.generated:''].join('|');
}
async function refresh(){
  const current=++manifestRequest;
  try {
    const response=await fetch('manifest.json?refresh='+Date.now()+'-'+(++fetchNonce),{cache:'no-store'});if(!response.ok)throw Error('The result manifest is not available yet.');
    let value=await response.json();if(current!==manifestRequest)return;
    if(!validManifest(value))throw Error('The result manifest is invalid.');
    const prior=manifest||storedManifest();
    if(prior&&olderManifest(value,prior)){
      refreshNote('An older cached update was ignored. Keeping the latest results already received.');
      if(manifest)return;
      value=prior;
    }else{refreshNote('');rememberManifest(value);}
    manifest=value;
    if(!modeChosen)mode=manifest.cohorts?'core500':'fixed';
    const age=manifest.heartbeat ? Date.now()-new Date(manifest.heartbeat).getTime():Infinity;
    $('health').textContent=age<180000?'Worker reporting':age<7200000?'Report updated '+Math.round(age/60000)+'m ago':'Worker report stale';$('health').className='health '+(age<180000?'alive':age>=7200000?'stale':'');
    $('reference-count').textContent=fmt(manifest.reference_count);$('catalog-count').textContent=fmt(manifest.catalog_count);
    const runs=visibleRuns(manifest.runs);
    renderArchive(manifest.runs,runs);
    if(!runs.length)throw Error('No benchmark runs have been exported yet.');
    if(!selected||!runs.some(r=>r.id===selected)||(followLatest&&document.activeElement!==$('run-select')))
      selected=(runs.find(r=>!r.pilot)||runs[0]).id;
    syncSelector(runs);await loadDetails(runs.find(r=>r.id===selected));
  } catch(error){$('error').hidden=false;$('error').textContent=error.message;}
}
async function loadDetails(run){
  loadCommandCoverage(run);
  loadReplayChanges(run);
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
    const value=await reportJSON(run.files?.details,'data/'+id+'.json',version,detailsController.signal);
    if(current!==request||selected!==id)return;
    if(value.run?.id!==id||value.run.sha!==run.sha||!Array.isArray(value.rows))throw Error('The server returned details for a different snapshot.');
    if(['fixed','growing',...cohortScopes.filter(scope=>run[scope])].some(scope=>value.run[scope]?.finished!==run[scope].finished||value.run[scope]?.total!==run[scope].total
          ||(run[scope].membership_sha256&&value.run[scope]?.membership_sha256!==run[scope].membership_sha256))
       ||value.run.status!==run.status
       ||(run.files?.details&&(value.rows.length!==run.growing.finished||value.rows.filter(row=>row.fixed).length!==run.fixed.finished
          ||cohortScopes.some(scope=>run[scope]&&value.rows.filter(row=>inScope(row,scope)).length!==run[scope].finished))))
      throw Error('Recording details do not match the selected report version. Keeping the previous verified results.');
    detailsCache.delete(id);detailsCache.set(id,{version,value});
    while(detailsCache.size>3)detailsCache.delete(detailsCache.keys().next().value);
    data={...value,run:manifest.runs.find(latest=>latest.id===id)||run};detailsReady=true;detailsLoading=false;pendingKey='';render();
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
  if(!data)return;const r=data.run;if(!r[mode])mode='fixed';const s=r[mode];
  for(const scope of corpusScopes){$(scope).classList.toggle('active',mode===scope);$(scope).setAttribute('aria-pressed',mode===scope);if(cohortScopes.includes(scope)){$(scope).hidden=!r[scope];if(r[scope])$(scope+'-count').textContent=fmt(r[scope].total);}}
  $('reference-count').textContent=fmt(r.fixed.total);$('catalog-count').textContent=fmt(r.growing.total);
  const scopeText={core500:'The frozen core of 500 recordings, selected for engine-feature and failure coverage.',extension500:'The frozen 500 additional recordings, disjoint from the core.',combined1000:'The frozen 1,000-recording baseline: core 500 plus 500 additional recordings.'};
  $('scope-note').textContent=scopeText[mode]|| (mode==='fixed'?'Members of the original 5,604-recording reference scheduled in this snapshot. The legacy membership stays unchanged.':r.workflow&&r.growing.total===1000?'The 1,000 scheduled baseline recordings.':'All recordings scheduled in this run.');
  if(cohortScopes.includes(mode))$('scope-note').textContent+=' IDs and recording hashes stay fixed. This failure-focused set does not estimate whole-corpus success rates.';
  if(s.not_scheduled)$('scope-note').textContent+=' '+fmt(s.not_scheduled)+' members were not scheduled in this historical snapshot.';
  if(r.pilot)$('scope-note').textContent+=' This is a limited pilot; it does not cover the full cohort.';
  const retry=r.status==='running'&&r.execution?.phase==='retrying'?r.execution:null;
  $('run-state').textContent='● '+(retry?'Timeout retries '+fmt(retry.retry_finished)+' / '+fmt(retry.retry_total)+' · '+fmt(retry.active_sessions)+' active':r.status==='running'&&r.execution?.phase==='finalizing'?'Finalizing results':r.status==='running'?'Measuring recordings':r.status==='complete'?'Run complete':runStatus(r));
  renderSchedule(r);
  $('run-state').setAttribute('data-state',r.status);
  const commit=el('a',r.sha.slice(0,12));commit.href='https://github.com/librematch/genie/commit/'+r.sha;commit.target='_blank';commit.rel='noopener';$('commit').replaceChildren(commit);
  $('run-time').textContent=(r.imported?'Imported historical scan · ':'')+r.architecture+' · '+date(r.finished||r.created);
  if(r.build_profile)$('run-time').textContent+=' · '+r.build_profile;
  if(r.case_workers)$('run-time').textContent+=' · up to '+fmt(retry?(retry.maximum_sessions||Math.min(r.case_workers,10)):r.case_workers)+' processes';
  if(r.continuation)$('run-time').textContent+=' · '+fmt(r.continuation.preserved_results)+' results retained from prior worker';
  $('run-progress').style.width=(100*s.finished/Math.max(1,s.total))+'%';
  $('measured').textContent=fmt(s.finished);$('measured-sub').textContent='of '+fmt(s.total)+' in this snapshot';
  if(retry)$('measured-sub').textContent+=' · initial results; timeout retries still running';
  $('checked').textContent=fmt(s.counts.complete_checked||0);
  $('checked-sub').textContent=fmt(s.counts.complete_unchecked||0)+' end reached without usable checkpoints';
  $('median').textContent=s.median_percent===null?'—':s.median_percent.toFixed(s.median_percent<1?3:1)+'%';
  $('median-sub').textContent=fmt(s.median_ticks)+' updates · '+fmt(s.measurable)+' measurable cases';
  renderTiming(r,s);
  renderChangeMetric(r);
  const waiting=r.status==='build_failed'?'Not run':r.status==='aborted'?'Not measured · run aborted':'Not measured yet';
  $('outcome-note').textContent=fmt(s.total-s.finished)+(r.status==='build_failed'?' not run':r.status==='aborted'?' unmeasured':' pending');
  if(retry)$('outcome-note').textContent=fmt(retry.retry_total-retry.retry_finished)+' timeout retries remaining across the run · up to '+fmt(retry.retry_seconds)+'s each'+(retry.retry_tick_seconds?' · '+fmt(retry.retry_tick_seconds)+'s per update':'');
  $('outcome-bar').replaceChildren();$('outcome-legend').replaceChildren();
  const counts={...s.counts};if(s.total>s.finished)counts.pending=s.total-s.finished;
  for(const key of orderedOutcomes(Object.keys(counts))){const count=counts[key],labelText=key==='pending'?waiting:names[key]||key;const bar=el('div');bar.style.width=100*count/Math.max(1,s.total)+'%';bar.style.background=color(key);bar.title=labelText+': '+fmt(count);$('outcome-bar').append(bar);const label=el('span');const swatch=el('i');swatch.style.background=color(key);label.append(swatch,document.createTextNode(labelText),el('b',fmt(count)));$('outcome-legend').append(label);}
  renderCharts(s);
  $('blockers').replaceChildren();for(const b of s.blockers.slice(0,7)){const item=el('div'),line=el('div',undefined,'blocker-label'),label=el('span',b.reason);label.title=b.reason;line.append(label,el('strong',fmt(b.count)));const track=el('div',undefined,'blocker-track'),fill=el('div');fill.style.width=100*b.count/Math.max(1,s.blockers[0].count)+'%';track.append(fill);item.append(line,track);$('blockers').append(item);}
  if(!s.blockers.length)$('blockers').append(el('p','No unsupported-condition results reported in this snapshot.','chart-note'));
    const error=detailsError||r.failure?.message||r.error;$('error').hidden=!error;$('error').textContent=error||'';
  $('failure-diagnostics').hidden=!r.failure;
  $('failure-diagnostic-text').textContent=r.failure?'Stage: '+r.failure.stage+'\nCode: '+r.failure.code+'\n\n'+(r.failure.details||r.failure.message):'';
  const untested=r.status==='build_failed'&&s.finished===0;
  $('table-state').hidden=!detailsLoading&&!detailsError&&!untested;
  $('table-state').textContent=detailsError?'Recording details unavailable.':untested?'No replay tests were started. This snapshot has no simulation results.':detailsReady?'Updating recording details…':'Loading recording details for '+runName(r)+'…';
  $('retry-details').hidden=!detailsError;
  for(const id of ['search','status-filter','engine-kind-filter','sort'])$(id).disabled=!detailsReady;
  $('identity').textContent=JSON.stringify({run_id:r.id,...(data.identity||{}),details_loaded:detailsReady,comparison_note:'Progress changes compare the same recording hashes in the fixed cohort; historical and current instrumentation are identified separately.'},null,2);
  const prior=$('prior-worker');prior.hidden=!r.continuation;
  if(r.continuation){prior.href='data/'+encodeURIComponent(r.continuation.run_id)+'.json';prior.textContent='Download the pre-upgrade worker snapshot ('+fmt(r.continuation.preserved_results)+' retained results)';}
  $('download').href=reportURL(r.files?.details,'data/'+r.id+'.json',detailsVersion(r));
  const filter=$('status-filter'),keep=filter.value;filter.replaceChildren(new Option('All outcomes','all'));for(const key of Object.keys(s.counts))filter.add(new Option(names[key]||key,key));filter.value=Object.hasOwn(s.counts,keep)?keep:'all';
  renderCheckpointGroups();renderCommandCoverage();renderReplayChanges();renderTable();
}
function renderChangeMetric(run){
  const stats=replayChanges?.run.id===run.id?replayChanges[mode]:null;
  const c=cohortScopes.includes(mode)?{comparable:stats?.compared_recordings||0,improved:stats?.advanced||0,regressed:stats?.regressed||0}:run.comparison;
  $('advanced').textContent=c?.comparable?'+'+fmt(c.improved):'Baseline';
  $('advanced-sub').textContent=c?.comparable?fmt(c.regressed)+' regressions · '+fmt(c.comparable)+' comparable matches':'Reference for subsequent snapshots';
}
function renderSchedule(run){
  const note=$('scheduling-note');
  const stages=(run.scheduling?.stages||[]).filter(s=>s.total&&['core500','extension500'].includes(s.id));
  note.hidden=!stages.length;
  const phaseNames={core500:'Core',extension500:'Additional'};
  let text=stages.map(s=>(phaseNames[s.id]||s.label)+': '+fmt(s.finished)+' / '+fmt(s.total)).join(' · ');
  note.textContent=text;
}
function renderTiming(run,scope){
  const timing=scope.timing,measured=timing?.measured;
  const fresh=measured?.sample_count>0,stats=fresh?measured:timing;
  $('run-duration').textContent=runDuration(run.timing?.wall_seconds);
  $('run-duration-sub').textContent=run.timing?(run.finished?'Creation to finish, including build and pauses':'Elapsed at the last report, including build and pauses'):'Timing metadata not available';
  $('replay-mean').textContent=replayTime(stats?.mean_seconds);
  $('replay-median').textContent=replayTime(stats?.median_seconds);
  const samples=stats?.sample_count||0,label=fresh?'timed in this run':run.imported?'historical timings':'retained timings';
  const note=samples?fmt(samples)+' '+label:'No recorded timings';
  $('replay-mean-sub').textContent=note;$('replay-median-sub').textContent=note;
  let text='Per-replay time includes parsing and simulation until the first failure or EOF. Average and median use each recording’s final stored attempt in the selected corpus; earlier retry attempts are excluded.';
  if(timing?.sample_count){
    const retained=timing.retained.sample_count,historical=timing.historical.sample_count;
    if(fresh&&retained)text+=' '+fmt(retained)+' retained timings are excluded from these current-run averages.';
    if(!fresh&&!run.imported)text+=' No fresh timed measurements yet; the figures show retained timings, not work performed in this run.';
    if(run.imported||historical)text+=' Historical timers use the original runner’s timing boundaries.';
    if(timing.missing_count)text+=' '+fmt(timing.missing_count)+' measured recordings have no timer and are excluded.';
  }else text+=' Missing timers are shown as unavailable, never as zero.';
  $('timing-note').textContent=text;
}
async function loadReplayChanges(run){
  const version=run.files?.changes?.sha256||run.changes?.version||detailsVersion(run),key=run.id+'|'+version;
  if(changesPendingKey===key)return;
  const current=++changesRequest;
  changesController?.abort();changesController=new AbortController();
  changesError='';
  if(replayChanges?.run.id!==run.id){replayChanges=undefined;changesPage=0;}
  const cached=changesCache.get(run.id);
  const persisted=storedChanges(run);
  const exact=[cached,persisted].find(entry=>entry?.version===version);
  if(exact){replayChanges=exact.value;changesLoading=false;changesPendingKey='';renderReplayChanges();return;}
  // A new manifest version can arrive before its comparison report is available
  // at the edge. Keep the last verified report for this run visible while retrying.
  if(!replayChanges)replayChanges=cached?.value||persisted?.value;
  changesLoading=true;changesPendingKey=key;renderReplayChanges();
  try{
    const value=await reportJSON(run.files?.changes,'changes/'+run.id+'.json',version,changesController.signal);
    if(current!==changesRequest||selected!==run.id)return;
    if(!validReplayChanges(value,run))throw Error('Replay comparison belongs to a different benchmark snapshot.');
    changesCache.delete(run.id);changesCache.set(run.id,{version,value});
    while(changesCache.size>3)changesCache.delete(changesCache.keys().next().value);
    replayChanges=value;rememberChanges(run,version,value);
  }catch(error){if(current===changesRequest&&error.name!=='AbortError')changesError=error.message;}
  finally{if(current===changesRequest){changesLoading=false;changesPendingKey='';renderReplayChanges();}}
}
function signed(n){return n===null||n===undefined?'—':(n>0?'+':'')+fmt(n);}
function changeStop(stop){
  const cell=el('td'),detail=el('details'),extra=[...stop.checks.map(c=>c.label),...stop.reasons];
  const title=stop.label+(extra.length?' · '+extra[0]:'')+(extra.length>1?' (+'+(extra.length-1)+' more)':'');
  detail.append(el('summary',title));
  for(const text of extra)detail.append(el('p',text,'change-reason'));
  if(!extra.length)detail.append(el('p',stop.status==='complete'?'Playback reached the end; checkpoint counts are shown separately.':'No additional stopping diagnostics were recorded.','change-reason'));
  cell.append(detail);return cell;
}
function renderReplayChanges(){
  if(data)renderChangeMetric(data.run);
  const value=replayChanges?.run.id===selected?replayChanges:undefined,s=value?.[mode];
  $('changes-content').hidden=!value?.available;
  $('changes-download').hidden=!value?.available;
  const state=$('changes-state');
  if(!value){state.textContent=changesError||'Loading changes against the previous completed engine snapshot…';return;}
  if(!value.available){state.textContent=value.reason+(changesLoading?' · updating…':'')+(changesError?' · '+changesError:'');return;}
  const link=el('a',value.baseline.sha.slice(0,12));link.href='https://github.com/librematch/genie/commit/'+value.baseline.sha;link.target='_blank';link.rel='noopener';
  state.replaceChildren(document.createTextNode('Compared with '),link,document.createTextNode(' · completed '+date(value.baseline.finished||value.baseline.created)+(changesLoading?' · updating…':'')+(changesError?' · '+changesError:'')));
  for(const [id,count] of [['changes-total',s.changed_recordings],['changes-advanced',s.advanced],['changes-regressed',s.regressed],['changes-other',s.mixed+s.changed+s.measurement]])$(id).textContent=fmt(count);
  $('changes-scope').textContent=fmt(s.compared_recordings)+' identical recordings compared · '+fmt(s.unchanged_recordings)+' unchanged · '+fmt(s.unpaired_recordings)+' measured recordings without a unique previous hash match · '+fmt(s.pending_recordings)+' not tested yet. '+fmt(s.new_eof)+' newly reached EOF · '+fmt(s.lost_eof)+' no longer reach EOF.';
  $('changes-warnings').textContent=value.warnings.join(' ');$('changes-warnings').hidden=!value.warnings.length;
  $('changes-download').href='changes/'+encodeURIComponent(value.run.id)+'.json';
  const term=$('changes-search').value.toLowerCase(),filter=$('changes-filter').value||'all',sort=$('changes-sort').value||'ticks-absolute';
  let rows=value.rows.filter(r=>inScope(r)&&(filter==='all'||r.kind===filter||(filter==='stops'&&r.stop_changed)||(filter==='new-eof'&&r.new_eof)||(filter==='lost-eof'&&r.lost_eof)));
  if(term)rows=rows.filter(r=>JSON.stringify([r.match_id,r.before.match_id,r.before.stop,r.after.stop]).toLowerCase().includes(term));
  const metric=r=>sort==='ticks-now'?(r.after.completed_ticks??-Infinity):sort==='ticks-gain'?(r.ticks_delta??-Infinity):sort==='ticks-loss'?-(r.ticks_delta??Infinity):sort==='checkpoints-gain'?(r.checkpoints_delta??-Infinity):sort==='checkpoints-loss'?-(r.checkpoints_delta??Infinity):Math.abs(r.ticks_delta||0);
  rows.sort((a,b)=>(sort==='id'?0:metric(b)-metric(a))||a.match_id.localeCompare(b.match_id));
  const pages=Math.max(1,Math.ceil(rows.length/25));changesPage=Math.max(0,Math.min(changesPage,pages-1));
  const labels={advanced:'Advanced',regressed:'Regressed',mixed:'Mixed',changed:'Other change',measurement:'Length metadata changed'};
  $('changes-rows').replaceChildren();
  for(const row of rows.slice(changesPage*25,(changesPage+1)*25)){
    const tr=el('tr'),match=el('td');match.append(recordingLink(row));match.title='SHA256 '+row.sha256;
    if(row.before.match_id!==row.match_id)match.append(el('small','Previously '+row.before.match_id));
    const kind=el('td');kind.append(el('span',labels[row.kind],'change-kind '+row.kind));
    if(row.new_eof||row.lost_eof)kind.append(el('small',row.new_eof?'New EOF':'Lost EOF'));
    if(row.diagnostics_changed&&!row.stop_changed)kind.append(el('small','Diagnostic values changed'));
    const ticks=el('td'),checkpoints=el('td');
    ticks.append(el('span',fmt(row.before.completed_ticks)+' → '+fmt(row.after.completed_ticks)),el('strong',signed(row.ticks_delta),'delta '+(row.ticks_delta>0?'positive':row.ticks_delta<0?'negative':'')));
    checkpoints.append(el('span',fmt(row.before.checkpoints_passed)+' → '+fmt(row.after.checkpoints_passed)),el('strong',signed(row.checkpoints_delta),'delta '+(row.checkpoints_delta>0?'positive':row.checkpoints_delta<0?'negative':'')));
    checkpoints.title='Matching checkpoints: '+fmt(row.before.checkpoints_passed)+' / '+fmt(row.before.total_checkpoints)+' previously; '+fmt(row.after.checkpoints_passed)+' / '+fmt(row.after.total_checkpoints)+' now.';
    const details=[];
    for(const [key,label] of [['first_failure_tick','Failure tick'],['last_matching_checkpoint_tick','Last matching checkpoint tick'],['ignored_commands_to_stop','Ignored commands'],['total_ticks','Recording ticks'],['total_checkpoints','Recorded checkpoints']])
      if(row.fields_changed.includes(key))details.push(label+': '+fmt(row.before[key])+' → '+fmt(row.after[key]));
    if(details.length){const extra=el('details',undefined,'change-extra');extra.append(el('summary','Progress details'));for(const line of details)extra.append(el('p',line));kind.append(extra);}
    tr.append(match,kind,ticks,checkpoints,changeStop(row.before.stop),changeStop(row.after.stop));$('changes-rows').append(tr);
  }
  $('changes-row-count').textContent=fmt(rows.length)+' changed recordings'+(!rows.length?' · no changes for this selection':'');
  $('changes-page').textContent=(changesPage+1)+' / '+pages;$('changes-previous').disabled=changesPage===0;$('changes-next').disabled=changesPage===pages-1;
}
async function loadCommandCoverage(run){
  const version=run.id+'|'+(run.files?.coverage?.sha256||manifest.generated);
  if(commandPendingKey===version)return;
  const current=++commandRequest;
  if(commandController)commandController.abort();commandController=new AbortController();commandPendingKey=version;
  const same=commandCoverage?.run.id===run.id;
  if(!same){commandCoverage=undefined;commandShowAll=false;commandCoverageState='loading';}
  commandCoverageError='';renderCommandCoverage();
  try{
    if(run.files&&!run.files.coverage){commandCoverageState='missing';renderCommandCoverage();return;}
    const value=await reportJSON(run.files?.coverage,'coverage/'+run.id+'.json',manifest.generated,commandController.signal);
    if(current!==commandRequest||selected!==run.id)return;
    if(value.schema!==1||value.run?.id!==run.id||value.run.sha!==run.sha||value.fixed?.total_recordings!==run.fixed.total||value.growing?.total_recordings!==run.growing.total||!Array.isArray(value.fixed.rows)||!Array.isArray(value.growing.rows))throw Error('Command coverage belongs to a different benchmark snapshot.');
    commandCoverage=value;commandCoverageState='ready';renderCommandCoverage();
  }catch(error){
    if(current!==commandRequest||error.name==='AbortError')return;
    commandCoverageState=error.status===404?'missing':'error';commandCoverageError=error.status===404?'':error.message;renderCommandCoverage();
  }finally{if(current===commandRequest)commandPendingKey='';}
}
function renderCommandCoverage(){
  const value=commandCoverage?.run.id===selected?commandCoverage:undefined,s=value?.[mode];
  const ready=!!s;$('command-coverage-content').hidden=!ready;
  const state=$('command-coverage-state');
  if(!ready){state.textContent=commandCoverageError||(commandCoverageState==='missing'?'Command census queued or not available for this snapshot.':'Loading the full-recording command census…');return;}
  state.textContent=fmt(s.scanned_recordings)+' / '+fmt(s.total_recordings)+' recordings scanned'+(s.pending_recordings?' · '+fmt(s.pending_recordings)+' pending':'')+(s.unreadable_recordings?' · '+fmt(s.unreadable_recordings)+' unreadable bodies excluded':'');
  if(s.not_scheduled_recordings)state.textContent+=' · '+fmt(s.not_scheduled_recordings)+' members not scheduled';
  if(commandCoverageState!=='ready')state.textContent+=' · keeping the last verified census'+(commandCoverageError?': '+commandCoverageError:' while the update is unavailable');
  const reviewed=commandStandard==='reviewed',types=s.type_counts.implemented+(reviewed?0:s.type_counts.partial),occurrences=s.occurrence_counts.implemented+(reviewed?0:s.occurrence_counts.partial);
  const assessed=value.classification.available;
  const percent=n=>n===null||n===undefined?'—':n.toFixed(n<1?2:1)+'%';
  $('command-types-label').textContent=reviewed?'VARIANTS WITH REVIEWED HANDLERS':'VARIANTS WITH A HANDLER';
  $('command-occurrences-label').textContent=reviewed?'OCCURRENCES OF REVIEWED VARIANTS':'OCCURRENCES WITH A HANDLER';
  $('command-types-percent').textContent=assessed?percent(reviewed?s.implemented_types_percent:s.handler_types_percent):'—';
  $('command-occurrences-percent').textContent=assessed?percent(reviewed?s.implemented_occurrences_percent:s.handler_occurrences_percent):'—';
  $('command-types-count').textContent=assessed?fmt(types)+' of '+fmt(s.observed_types)+' observed command variants':'Assessment unavailable · '+fmt(s.observed_types)+' observed variants';
  $('command-occurrences-count').textContent=assessed?fmt(occurrences)+' of '+fmt(s.command_occurrences)+' commands across complete recording bodies':fmt(s.command_occurrences)+' commands counted; implementation assessment unavailable';
  const label={implemented:'Reviewed handler',partial:'Partial / conditional',unsupported:'Unsupported',unknown:'Unknown'};
  $('command-breakdown').replaceChildren();
  for(const key of ['implemented','partial','unsupported','unknown']){
    const item=el('span',label[key]+': '+fmt(s.type_counts[key])+' variants · '+fmt(s.occurrence_counts[key])+' commands','command-state '+key);$('command-breakdown').append(item);
  }
  $('command-definition').textContent=reviewed?'Conservative implementation coverage: partial and conditional handlers are excluded. A reviewed handler does not certify later autonomous behaviour or checkpoint correctness.':'Handler presence includes partial and conditional implementations. This is a measure of implemented entry points; execution can still fail.';
  const benchmark=manifest.runs.find(r=>r.id===value.run.id),build=value.benchmark?.game_build||158041;
  $('command-census-note').textContent='Counts include the entire recording, including commands beyond the simulation stop. Unknown packets stay in the denominator; unreadable bodies are excluded. Camera, chat and internal unit/AI updates are excluded. '+(!assessed?'Engine capability source is unavailable, so implementation status is unknown. ':'Automatically assessed from this exact engine source. ')+'Game build '+build+' · engine '+value.run.sha.slice(0,12)+(benchmark?.build_profile?' · '+benchmark.build_profile:'')+' · benchmark '+(benchmark?.status==='complete'?'completed '+date(benchmark.finished):benchmark?.status||'status unavailable')+' · parser '+value.parser.key.slice(0,12)+' · assessment updated '+date(value.generated)+'.';
  const link=$('command-download');link.href='coverage/'+encodeURIComponent(value.run.id)+'.json';link.download='';
  const filter=$('command-filter').value||'gaps';
  const rows=s.rows.filter(r=>filter==='all'||filter==='gaps'&&r.status!=='implemented'||r.status===filter);
  $('command-rows').replaceChildren();
  for(const row of rows.slice(0,commandShowAll?rows.length:12)){
    const tr=el('tr'),name=el('td'),title=el('span',row.label);title.title=row.key;name.append(title);
    const note=el('small',row.reason,'command-reason');
    if(row.source){const source=el('a',' Source ↗');source.href=row.source;source.target='_blank';source.rel='noopener';note.append(source);}name.append(note);
    const status=el('td');status.append(el('span',label[row.status]||row.status,'command-state '+row.status));
    const tail=el('td',row.after_stop_occurrences===null?'—':fmt(row.after_stop_occurrences));
    tail.title='Known for '+fmt(row.horizon_recordings)+' of '+fmt(row.recordings)+' recordings containing this variant. Counts updates strictly after the first failing update.';
    tr.append(name,status,el('td',fmt(row.occurrences)),el('td',fmt(row.recordings)),tail);$('command-rows').append(tr);
  }
  $('command-row-count').textContent=fmt(rows.length)+' variants · sorted by total occurrences, including the unexecuted tail';
  $('command-show-all').hidden=rows.length<=12;$('command-show-all').textContent=commandShowAll?'Show top 12':'Show all '+fmt(rows.length);
  $('command-horizon-note').textContent='“After stop” counts commands in later updates for '+fmt(s.horizon_recordings)+' recordings with comparable simulation horizons. A dash means no comparable horizon is available. It does not predict whether those commands would execute successfully.';
}
function countAxis(maximum,scaleType,height){
  const max=Math.max(1,maximum);
  if(scaleType==='log'){
    const upper=10**Math.ceil(Math.log10(max)),ticks=[0];
    for(let n=1;n<=upper;n*=10)ticks.push(n);
    return {ticks,upper,scale:n=>Math.log10(n+1)/Math.log10(upper+1)*height};
  }
  const raw=max/5,power=10**Math.floor(Math.log10(raw)),fraction=raw/power;
  const step=Math.max(1,(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power),upper=Math.ceil(max/step)*step;
  const ticks=Array.from({length:Math.round(upper/step)+1},(_,i)=>i*step);
  return {ticks,upper,scale:n=>n/upper*height};
}
function histogramOutcomes(summary){return orderedOutcomes([...summary.histogram,...summary.ticks_histogram].flatMap(b=>Object.keys(b.counts)));}
function renderCharts(summary){
  const keys=histogramOutcomes(summary);
  const select=$('chart-outcome'),key=JSON.stringify(keys);
  if(key!==chartSelectorKey&&document.activeElement!==select){
    select.replaceChildren(new Option('All outcomes','all'));
    for(const k of keys)select.add(new Option(names[k]||k,k));
    if(chartOutcome!=='all'&&!keys.includes(chartOutcome))chartOutcome='all';
    chartSelectorKey=key;
  }
  select.value=chartOutcome;$('chart-scale').value=chartScale;
  const label=chartScale==='log'?'Log count axis':'Linear count axis';
  $('percent-scale-label').textContent=label;$('ticks-scale-label').textContent=label;
  $('chart-scale-note').textContent=chartScale==='log'?'Separate outcome bars share a baseline. Log mode uses log₁₀(count + 1), including zero. Hover or focus a bucket for exact counts.':'Separate outcome bars start at zero. Heights are proportional to counts. Hover or focus a bucket for exact counts.';
  chart('percent-chart',summary.histogram);chart('ticks-chart',summary.ticks_histogram);
}
function chart(id,buckets){
  const W=640,H=id==='ticks-chart'?235:280,L=44,R=12,T=16,B=65,plotH=H-T-B,plotW=W-L-R;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const series=chartOutcome==='all'?orderedOutcomes(buckets.flatMap(b=>Object.keys(b.counts))):[chartOutcome];
  const maximum=Math.max(0,...buckets.flatMap(b=>series.map(k=>b.counts[k]||0))),axis=countAxis(maximum,chartScale,plotH),baseline=T+plotH;
  function node(tag,attrs,text,parent=svg){const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n;}
  node('desc',{},'Recording counts by progress bucket. Separate bars have a common zero baseline, in a fixed outcome order. '+(chartScale==='log'?'Count axis uses log base 10 of count plus one.':'Count axis is linear.'));
  for(const tick of axis.ticks){
    const y=baseline-axis.scale(tick);
    node('line',{x1:L,y1:y,x2:W-R,y2:y,stroke:'#243148','stroke-dasharray':tick?'3 4':'none'});
    node('text',{x:L-7,y:y+3,'text-anchor':'end'},fmt(tick));
  }
  const readout=$(id+'-readout');readout.textContent='Hover or focus a bucket to inspect its counts.';
  const step=plotW/Math.max(1,buckets.length),gutter=Math.min(5,step*.2),slot=(step-gutter)/Math.max(1,series.length),gap=Math.min(1,slot*.2);
  buckets.forEach((bucket,i)=>{
    const total=series.reduce((sum,k)=>sum+(bucket.counts[k]||0),0);
    const description=bucket.label+' · '+series.map(k=>(names[k]||k)+': '+fmt(bucket.counts[k]||0)).join(' · ')+(series.length>1?' · Total: '+fmt(total):'');
    const group=node('g',{'class':'histogram-bucket','data-bucket':bucket.label,tabindex:0,role:'img','aria-label':description});
    node('title',{},description,group);
    node('rect',{x:L+i*step,y:T,width:step,height:plotH,fill:'transparent','class':'histogram-hitbox'},undefined,group);
    for(let j=0;j<series.length;j++){
      const key=series[j],count=bucket.counts[key]||0;if(!count)continue;
      const height=axis.scale(count),x=L+i*step+gutter/2+j*slot+gap/2;
      node('rect',{x,y:baseline-height,width:Math.max(.2,slot-gap),height,fill:color(key),rx:.6,'class':'histogram-bar','data-outcome':key,'data-count':count},undefined,group);
      if(series.length===1&&step>=26)node('text',{x:x+(slot-gap)/2,y:baseline-height-5,'text-anchor':'middle','font-size':8},fmt(count),group);
    }
    const inspect=()=>{readout.textContent=description;};group.addEventListener('pointerenter',inspect);group.addEventListener('focus',inspect);
    if(buckets.length<35||i%Math.ceil(buckets.length/25)===0){const x=L+(i+.5)*step;node('text',{x,y:baseline+13,transform:`rotate(-52 ${x} ${baseline+13})`,'text-anchor':'end'},bucket.label);}
  });
  if(!maximum)node('text',{x:L+plotW/2,y:T+plotH/2,'text-anchor':'middle'},'No recordings for this selection');
  $(id).replaceChildren(svg);
}
function renderTable(){
  if(!detailsReady){$('rows').replaceChildren();$('row-count').textContent=detailsError?'Recording details unavailable':'Loading recording details…';$('page-number').textContent='—';$('previous').disabled=true;$('next').disabled=true;return;}
  if(!data)return;let rows=data.rows.filter(r=>inScope(r));const term=$('search').value.toLowerCase(),filter=$('status-filter').value;
  const kind=$('engine-kind-filter').value||'all';
  rows=rows.filter(r=>(filter==='all'||outcome(r)===filter)&&(kind==='all'||engineErrors(r).some(e=>e.engine_error.kind===kind))&&(!term||r.match_id.toLowerCase().includes(term)||JSON.stringify([r.unsupported,r.reason,r.engine_error,r.differences,r.status==='checkpoint_mismatch'?checkpointReason(r):'']).toLowerCase().includes(term)));
  const progress=r=>r.total_ticks?100*(r.completed_ticks||0)/r.total_ticks:-1;
  const ticks=r=>Number.isFinite(r.completed_ticks)&&r.completed_ticks>=0?r.completed_ticks:-1;
  const sort=$('sort').value;
  rows.sort((a,b)=>{
    let order=0;
    if(sort==='time-desc'||sort==='time-asc'){
      const left=elapsedSeconds(a.runtime_seconds),right=elapsedSeconds(b.runtime_seconds);
      order=left===null?(right===null?0:1):right===null?-1:(sort==='time-asc'?1:-1)*(left-right);
    }else if(sort==='ticks-desc')order=ticks(b)-ticks(a);
    else if(sort!=='id'){
      order=(sort==='progress-asc'?1:-1)*(progress(a)-progress(b));
      if(sort==='progress-desc'&&!order)order=ticks(b)-ticks(a);
    }
    return order||a.match_id.localeCompare(b.match_id);
  });
  const pages=Math.max(1,Math.ceil(rows.length/30));page=Math.max(0,Math.min(page,pages-1));$('rows').replaceChildren();
  for(const r of rows.slice(page*30,(page+1)*30)){
    const tr=el('tr'),first=el('td');first.append(recordingLink(r));
    const status=el('td'),badge=el('span',names[outcome(r)]||r.status,'badge');badge.style.setProperty('--badge',color(outcome(r)));status.append(badge);
    const ticks=el('td',r.total_ticks===undefined?'—':fmt(r.completed_ticks||0)+' / '+fmt(r.total_ticks)),percent=el('td');
    const meter=el('span',progress(r)<0?'—':progress(r).toFixed(2)+'%','micro-progress');meter.style.setProperty('--percent',Math.max(0,progress(r))+'%');percent.append(meter);
    const checkpoint=el('td',r.total_checkpoints===undefined?'—':fmt(r.checkpoints_passed||0)+' / '+fmt(r.total_checkpoints));
    if(r.ignored_commands_to_stop)checkpoint.title=r.ignored_commands_to_stop+' ignored command packets before stop';
    const runtime=el('td',undefined,'recording-elapsed');runtime.append(el('span',replayTime(r.runtime_seconds)));
    runtime.title=elapsedSeconds(r.runtime_seconds)===null?'No recorded timer.':'Wall time including parsing and simulation until the first stop or EOF. Shared session startup is excluded; historical and fallback processes may include startup.';
    if(elapsedSeconds(r.runtime_seconds)!==null&&(r.runtime_source==='retained'||r.runtime_source==='historical'))
      runtime.append(el('small',r.runtime_source==='retained'?'Retained':'Historical'));
    const diagnostic=el('td');
    if(r.status==='checkpoint_mismatch')diagnostic.append(checkpointDetails(r));
    else{
      let reason=r.unsupported?.map(v=>v.reason).join('; ')||r.reason||'';
      if(r.status==='complete')reason=r.checkpoints_passed?'All usable recorded checkpoints matched.':'No usable recorded checkpoints.';
      if(r.ignored_commands_to_stop)reason+=' '+fmt(r.ignored_commands_to_stop)+' ignored command packets.';
      if(engineErrors(r).length)diagnostic.append(engineErrorDetails(r,reason,data.run.sha));
      else {
        diagnostic.textContent=reason;
        if(r.status==='timeout'&&r.timeout_kind==='simulation_step')
          diagnostic.append(el('p','Update '+fmt(r.step_tick)+' exceeded '+fmt(r.step_limit_seconds)+'s. '+fmt(r.completed_ticks)+' completed updates retained.','change-reason'));
      }
    }
    tr.append(first,status,ticks,percent,checkpoint,runtime,diagnostic);$('rows').append(tr);
  }
  $('row-count').textContent=fmt(rows.length)+' matching recordings';$('page-number').textContent=(page+1)+' / '+pages;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
}
const engineKindNames={unsupported:'Unsupported mechanic',unreachable:'Engine invariant',missing_data:'Missing data',invalid_input:'Invalid input',io:'I/O failure'};
function engineErrors(row){
  const items=(row.unsupported||[]).flatMap(item=>[item,...(item.freezes||[])]);
  if(row.engine_error)items.push(row);
  return items.filter(item=>item.engine_error?.schema===2);
}
function engineErrorDetails(row,reason,sha){
  const detail=el('details',undefined,'checkpoint-details');detail.append(el('summary',reason));
  const seen=new Set();
  for(const item of engineErrors(row)){
    const error=item.engine_error,key=JSON.stringify([item.reason,error]);if(seen.has(key))continue;seen.add(key);
    detail.append(el('p',(engineKindNames[error.kind]||error.kind)+' · '+error.phase+' · '+(item.reason||reason),'change-reason'));
    const at=error.location,path=at?.repository_path;
    const adapter=typeof path==='string'&&/\/genie-oracle\/src\/progress\.rs$/.test(path);
    if(adapter)detail.append(el('p','Benchmark adapter at '+path+':'+at.line,'change-reason'));
    if(!adapter&&typeof path==='string'&&/^crates\/[A-Za-z0-9_./-]+\.rs$/.test(path)&&!path.split('/').includes('..')&&Number.isInteger(at.line)&&at.line>0&&/^[0-9a-f]{40}$/.test(sha)){
      const link=el('a',path+':'+at.line);link.href='https://github.com/librematch/genie/blob/'+sha+'/'+path+'#L'+at.line;link.target='_blank';link.rel='noopener';detail.append(link);
    }
    for(const entry of error.context||[])detail.append(el('p',entry.key+': '+entry.value,'change-reason'));
    if(error.cause)detail.append(el('p','Cause: '+error.cause,'change-reason'));
  }
  return detail;
}
for(const key of corpusScopes)$(key).onclick=()=>{mode=key;modeChosen=true;page=0;changesPage=0;render();};
$('engine-kind-filter').onchange=()=>{page=0;renderTable();};
const showLoadError=error=>{$('error').hidden=false;$('error').textContent=error.message;};
$('run-select').onchange=event=>{const pending=selectSnapshot(event.currentTarget.value);if(pending)pending.catch(showLoadError);};
$('run-select').onblur=()=>{if(manifest)syncSelector(visibleRuns(manifest.runs),true);};
$('retry-details').onclick=()=>{detailsCache.delete(selected);loadDetails(manifest.runs.find(r=>r.id===selected)).catch(showLoadError);};
for(const id of ['search','status-filter','sort'])$(id).addEventListener('input',()=>{page=0;renderTable();});
$('previous').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('provenance').onclick=()=>$('method').showModal();$('close-method').onclick=()=>$('method').close();
$('chart-scale').onchange=event=>{chartScale=event.currentTarget.value;if(data)renderCharts(data.run[mode]);};
$('chart-outcome').onchange=event=>{chartOutcome=event.currentTarget.value;if(data)renderCharts(data.run[mode]);};
$('chart-outcome').onblur=()=>{if(data&&chartSelectorKey!==JSON.stringify(histogramOutcomes(data.run[mode])))renderCharts(data.run[mode]);};
$('command-standard').onchange=event=>{commandStandard=event.currentTarget.value;renderCommandCoverage();};
$('command-filter').onchange=()=>{commandShowAll=false;renderCommandCoverage();};
$('command-show-all').onclick=()=>{commandShowAll=!commandShowAll;renderCommandCoverage();};
for(const id of ['changes-search','changes-filter','changes-sort'])$(id).addEventListener('input',()=>{changesPage=0;renderReplayChanges();});
$('changes-previous').onclick=()=>{changesPage--;renderReplayChanges();};
$('changes-next').onclick=()=>{changesPage++;renderReplayChanges();};
loadCheckpointDefinitions();refresh();setInterval(refresh,60000);
