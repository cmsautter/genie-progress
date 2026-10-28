'use strict';
const $ = id => document.getElementById(id);
const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US',{maximumFractionDigits:1}) : '—';
const elapsedSeconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const replayTime = value => elapsedSeconds(value) === null ? '—' : value.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'s';
function averageTPS(row){
  const seconds=elapsedSeconds(row.runtime_seconds),ticks=row.completed_ticks;
  if(seconds===null||seconds===0||!Number.isFinite(ticks)||ticks<0)return null;
  const speed=ticks/seconds;
  return Number.isFinite(speed)?speed:null;
}
function runDuration(value){
  if(elapsedSeconds(value)===null)return '—';
  const tenths=Math.round(value*10),hours=Math.floor(tenths/36000),minutes=Math.floor(tenths%36000/600),seconds=(tenths%600/10).toFixed(1);
  return (hours?hours+'h ':'')+(minutes||hours?minutes+'m ':'')+seconds+'s';
}
const names = {unsupported:'Unsupported update',initialization_unsupported:'Initialization',checkpoint_mismatch:'Checkpoint mismatch',complete_checked:'End reached · checkpoints match',complete_unchecked:'End reached · no checkpoints',parse_error:'Parse error',multiple_chapters:'Multiple chapters',timeout:'Time limit',process_failure:'Process failure',input_changed:'Input changed',worker_error:'Worker error',invalid_result:'Invalid result',version_mismatch:'Wrong version',empty:'Empty recording',pending:'Not measured yet'};
const colored = new Set(['initialization_unsupported','unsupported','checkpoint_mismatch','complete_unchecked','complete_checked','parse_error','multiple_chapters','timeout','pending']);
const color = k => colored.has(k) ? `var(--outcome-${k})` : 'var(--outcome-other)';
const outcomeOrder=['initialization_unsupported','unsupported','checkpoint_mismatch','complete_unchecked','complete_checked','parse_error','multiple_chapters','timeout','process_failure','input_changed','worker_error','invalid_result','version_mismatch','empty','pending'];
function orderedOutcomes(keys){
  const rank=key=>{const i=outcomeOrder.indexOf(key);return i<0?outcomeOrder.length:i;};
  return [...new Set(keys)].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
}
function chartLegend(id,items){
  $(id).replaceChildren(...items.map(({label,fill,line=false})=>{
    const item=el('span'),swatch=el('i',undefined,line?'legend-line':undefined);
    swatch.style.background=fill;swatch.setAttribute('aria-hidden','true');
    item.append(swatch,document.createTextNode(label));return item;
  }));
}
const outcomeLegend=keys=>keys.map(key=>({label:names[key]||key,fill:color(key)}));
const outcome = r => r.status === 'complete' ? (r.checkpoints_passed ? 'complete_checked':'complete_unchecked') : r.status;
let manifest, data, mode = 'fixed', page = 0, selected = '', request = 0, followLatest = true;
const cohortScopes=['core500','extension500','combined1000'];
const corpusScopes=[...cohortScopes,'growing','fixed'];
let modeChosen=false;
const trendPage=document.body?.dataset?.page==='trends';
const pageQuery=new URLSearchParams(globalThis.location?.search||'');
const requestedScope=pageQuery.get('cohort');
if((trendPage?cohortScopes:corpusScopes).includes(requestedScope)){mode=requestedScope;modeChosen=true;}
const requestedRun=pageQuery.get('run');
if(!trendPage&&/^[A-Za-z0-9_-]+$/.test(requestedRun||'')){selected=requestedRun;followLatest=false;}
const inScope=(row,scope=mode)=>scope==='growing'||(scope==='fixed'?!!row.fixed:row.cohorts?.includes(scope));
let manifestRequest=0, detailsReady=false, detailsLoading=false, detailsError='', pendingKey='', detailsController;
let selectorKey='';
let chartScale='log',chartOutcome='all',chartSelectorKey='';
const progressBucketChoices=new Map();
const progressBucketView=()=>data?.run.id+':'+mode;
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
    const raw=await response.arrayBuffer();
    const hash=await reportSHA256(raw);
    if(hash===file.sha256&&(file.bytes===undefined||file.bytes===raw.byteLength))return JSON.parse(new TextDecoder().decode(raw));
  }
  throw Error('A cache returned a different report version. Keeping the previous verified results and retrying on the next refresh.');
}
async function reportSHA256(raw){
  if(globalThis.crypto?.subtle)
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  // Native Web Crypto is unavailable on plain HTTP LAN origins. Keep the same
  // byte verification there using the bundled, pinned browser implementation.
  if(typeof globalThis.sha256==='function')return globalThis.sha256(new Uint8Array(raw));
  throw Error('This browser cannot verify report versions.');
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
  chartLegend('checkpoint-legend',rows.length?outcomeLegend(['checkpoint_mismatch']):[]);
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
    if((r.pilot||r.status==='continued')&&r.id!==selected)return false;
    const series=r.workflow?.kind==='one_off_full'?'one-off':r.growing.total>1000?'full-corpus':'baseline';
    const key=r.imported?'historical:'+r.id:r.sha+':'+(r.build_profile||'legacy')+':'+series;
    if(seen.has(key)&&!(r.id===selected&&r.status==='complete'))return false;
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
  const corpus=r.workflow?.kind==='one_off_full'?' · One-off '+fmt(r.growing.total):r.growing.total>1000&&!r.imported?' · Corpus '+fmt(r.growing.total):'';
  return runName(r)+(profile?' · '+profile:'')+corpus+' · '+runStatus(r)+' · '+date(r.created);
}
function renderArchive(runs,visible){
  const shown=new Set(visible.map(r=>r.id)),archived=runs.filter(r=>!shown.has(r.id));
  $('archived-runs').hidden=!archived.length;
  $('archived-count').textContent=fmt(archived.length);
  $('archived-list').replaceChildren();
  for(const r of archived){
    const item=el('li'),link=el('a',runLabel(r));
    link.href=snapshotURL(r.id,r.growing.total>1000?'fixed':'combined1000');
    const download=el('a','JSON ↓');download.href='data/'+encodeURIComponent(r.id)+'.json';download.download='';
    item.append(link,document.createTextNode(' · '),download);$('archived-list').append(item);
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
    if(!modeChosen)mode=trendPage?'combined1000':manifest.cohorts?'core500':'fixed';
    const age=manifest.heartbeat ? Date.now()-new Date(manifest.heartbeat).getTime():Infinity;
    $('health').textContent=age<180000?'Worker reporting':age<7200000?'Report updated '+Math.round(age/60000)+'m ago':'Worker report stale';$('health').className='health '+(age<180000?'alive':age>=7200000?'stale':'');
    if(trendPage){renderTrendPage();return;}
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
  const run=manifest.runs.find(r=>r.id===id);if(!run)return;
  followLatest=false;selected=id;page=0;syncSelector(visibleRuns(manifest.runs),true);return loadDetails(run);
}
function render(){
  if(!data)return;const r=data.run;
  const largeCorpus=r.growing.total>1000||!r.combined1000;
  if(!r[mode]||(!largeCorpus&&['fixed','growing'].includes(mode)))mode=r.core500?'core500':'fixed';
  if(!modeChosen&&largeCorpus)mode='fixed';
  const s=r[mode];
  $('trend-link').href=trendURL(mode);
  for(const scope of corpusScopes){$(scope).classList.toggle('active',mode===scope);$(scope).setAttribute('aria-pressed',mode===scope);if(cohortScopes.includes(scope)){$(scope).hidden=!r[scope];if(r[scope])$(scope+'-count').textContent=fmt(r[scope].total);}}
  for(const scope of ['fixed','growing'])$(scope).hidden=!largeCorpus;
  $('reference-count').textContent=fmt(r.fixed.total);$('catalog-count').textContent=fmt(r.growing.total);
  const scopeText={core500:'The frozen core of 500 recordings, selected for engine-feature and failure coverage.',extension500:'The frozen 500 additional recordings, disjoint from the core.',combined1000:'The frozen 1,000-recording baseline: core 500 plus 500 additional recordings.'};
  $('scope-note').textContent=scopeText[mode]|| (mode==='fixed'?'Members of the original 5,604-recording reference scheduled in this snapshot. The legacy membership stays unchanged.':r.workflow&&r.growing.total===1000?'The 1,000 scheduled baseline recordings.':'All recordings scheduled in this run.');
  if(cohortScopes.includes(mode))$('scope-note').textContent+=' IDs and recording hashes stay fixed. This failure-focused set does not estimate whole-corpus success rates.';
  if(s.not_scheduled)$('scope-note').textContent+=' '+fmt(s.not_scheduled)+' members were not scheduled in this historical snapshot.';
  if(r.pilot)$('scope-note').textContent+=' This is a limited pilot; it does not cover the full cohort.';
  const retry=r.status==='running'&&r.execution?.phase==='retrying'?r.execution:null;
  const oneOff=r.workflow?.kind==='one_off_full',direct=r.status==='running'&&oneOff?r.execution:null;
  $('run-state').textContent='● '+(direct?'One-off corpus · '+(direct.stage==='corpus_tail'?'Remaining corpus':'Reference first')+' · '+fmt(direct.active_sessions)+' active':retry?'Timeout retries '+fmt(retry.retry_finished)+' / '+fmt(retry.retry_total)+' · '+fmt(retry.active_sessions)+' active':r.status==='running'&&r.execution?.phase==='finalizing'?'Finalizing results':r.status==='running'?'Measuring recordings':r.status==='complete'?'Run complete':runStatus(r));
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
  for(const key of orderedOutcomes(Object.keys(counts))){const count=counts[key],labelText=key==='pending'?waiting:names[key]||key;const bar=el('div');bar.style.width=100*count/Math.max(1,s.total)+'%';bar.style.background=color(key);bar.title=labelText+': '+fmt(count);$('outcome-bar').append(bar);const label=el('span');const swatch=el('i');swatch.style.background=color(key);label.append(swatch,document.createTextNode(labelText),el('b',fmt(count)),el('small',(100*count/Math.max(1,s.total)).toFixed(count&&count<s.total/1000?2:1)+'%'));$('outcome-legend').append(label);}
  renderCharts(s);
  $('blockers').replaceChildren();for(const b of s.blockers.slice(0,7)){const item=el('div'),line=el('div',undefined,'blocker-label'),label=el('span',b.reason);label.title=b.reason;line.append(label,el('strong',fmt(b.count)));const track=el('div',undefined,'blocker-track'),fill=el('div');fill.style.width=100*b.count/Math.max(1,s.blockers[0].count)+'%';track.append(fill);item.append(line,track);$('blockers').append(item);}
  if(!s.blockers.length)$('blockers').append(el('p','No unsupported-condition results reported in this snapshot.','chart-note'));
  chartLegend('blockers-legend',s.blockers.length?outcomeLegend(['unsupported']):[]);
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
  const c=stats?{comparable:stats.compared_recordings||0,improved:stats.advanced||0,regressed:stats.regressed||0}:cohortScopes.includes(mode)||mode==='growing'?null:run.comparison;
  $('advanced').textContent=c?.comparable?'+'+fmt(c.improved):'Baseline';
  $('advanced-sub').textContent=c?.comparable?fmt(c.regressed)+' regressions · '+fmt(c.comparable)+' comparable matches':'Reference for subsequent snapshots';
}
function renderSchedule(run){
  const note=$('scheduling-note');
  const oneOff=run.workflow?.kind==='one_off_full';
  const direct=run.workflow?.measurement_policy?.mode==='single_pass';
  const stages=(run.scheduling?.stages||[]).filter(s=>s.total&&(oneOff?['reference5604','corpus_tail']:['core500','extension500']).includes(s.id));
  note.hidden=!stages.length&&!direct;
  const phaseNames={core500:'Core',extension500:'Additional',reference5604:'Reference',corpus_tail:'Remaining corpus'};
  let text=stages.map(s=>(phaseNames[s.id]||s.label)+': '+fmt(s.finished)+' / '+fmt(s.total)).join(' · ');
  if(oneOff){const p=run.workflow.measurement_policy;text+=(text?' · ':'')+'One-off sweep: '+fmt(p.replay_seconds)+'s per replay, '+fmt(p.step_seconds)+'s per update, up to '+fmt(p.maximum_workers)+' workers. No timeout retries. Automatic testing stays disabled after completion.';}
  else if(direct){const p=run.workflow.measurement_policy;text+=(text?' · ':'')+'Single pass: '+fmt(p.replay_seconds)+'s per replay, '+fmt(p.step_seconds)+'s per update, up to '+fmt(p.maximum_workers)+' workers. No timeout retries.';}
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
function progressBuckets(buckets,fine){
  if(fine)return buckets;
  const merged=Array.from({length:20},(_,i)=>({label:i*5+'–'+(i+1)*5+'%',counts:{}}));
  for(const bucket of buckets){
    const range=/^(\d+)–(\d+)%$/.exec(bucket.label);
    if(!range)return buckets;
    const lo=Number(range[1]),hi=Number(range[2]),index=Math.floor(lo/5);
    // Only merge whole existing intervals; never estimate a split from counts.
    if(index<0||index>=20||hi<=lo||hi>(index+1)*5)return buckets;
    for(const [key,count] of Object.entries(bucket.counts))
      merged[index].counts[key]=(merged[index].counts[key]||0)+count;
  }
  return merged;
}
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
  const view=progressBucketView(),fine=progressBucketChoices.has(view)?progressBucketChoices.get(view):!(Number.isFinite(summary.median_percent)&&summary.median_percent>10);
  $('percent-fine-buckets').checked=fine;
  $('percent-bucket-note').textContent=(fine?'1% buckets through 10%, then 5% buckets.':'5% buckets throughout (0–5%, 5–10%, …, 95–100%).')+' Each bucket has equal display width. The default uses this view’s median simulation progress; your choice is kept for this snapshot and cohort.';
  chart('percent-chart',progressBuckets(summary.histogram,fine));chart('ticks-chart',summary.ticks_histogram);
}
function svgCanvas(W,H){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const node=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n;};
  return {svg,node};
}
// One completed run per engine commit for the selected immutable cohort.
function trendURL(scope=mode){return 'trends.html?'+new URLSearchParams({cohort:cohortScopes.includes(scope)?scope:'combined1000'});}
function snapshotURL(id,scope=mode){return 'index.html?'+new URLSearchParams({run:id,cohort:scope});}
function openSnapshot(id){if(trendPage){globalThis.location.href=snapshotURL(id);return;}const pending=selectSnapshot(id);if(pending)pending.catch(showLoadError);}
const trendLabels={core500:'Core 500',extension500:'Additional 500',combined1000:'Combined 1,000'};
function renderTrendPage(){
  for(const scope of cohortScopes){$(scope).classList.toggle('active',mode===scope);$(scope).setAttribute('aria-pressed',mode===scope);$(scope).disabled=!manifest.cohorts?.[scope];}
  $('scope-note').textContent='Compare the same '+(mode==='combined1000'?'1,000':'500')+' frozen recordings across completed engine measurements.';
  renderTrend();
}
function trendRuns(){
  if(!cohortScopes.includes(mode))return [];
  const membership=manifest?.cohorts?.[mode]?.membership_sha256,total=mode==='combined1000'?1000:500;
  if(!/^[a-f0-9]{64}$/.test(membership||''))return [];
  const best=new Map();
  for(const r of [...manifest.runs].sort((a,b)=>Date.parse(b.created)-Date.parse(a.created))){
    const scope=r[mode];
    if(r.pilot||r.status!=='complete'||!scope||scope.total!==total||scope.finished!==total||scope.membership_sha256!==membership)continue;
    const key=r.sha,prior=best.get(key);
    if(!prior||(prior.build_profile!=='release'&&r.build_profile==='release'))best.set(key,r);
  }
  return [...best.values()].sort((a,b)=>Date.parse(a.created)-Date.parse(b.created));
}
function trendComparison(r){
  const c=r.changes,s=c?.summary?.[mode],scope=r[mode];
  if(!c?.available||!c.baseline_sha||!s||s.total_recordings!==scope.total||s.membership_sha256!==scope.membership_sha256
      ||!Number.isFinite(s.compared_recordings)||s.compared_recordings<=0||!Number.isFinite(s.advanced)||!Number.isFinite(s.regressed))return null;
  return {...s,previous_sha:c.baseline_sha,warnings:c.warnings||[]};
}
function trendDescription(r){
  const f=r[mode],c=trendComparison(r);
  return r.sha+' · '+trendLabels[mode]+' · '+(r.build_profile||'historical')+' · '+date(r.finished||r.created)+' · median '+fmt(f.median_ticks)+' ticks · '+orderedOutcomes(Object.keys(f.counts)).map(k=>(names[k]||k)+': '+fmt(f.counts[k])).join(' · ')+(c?' · advanced '+fmt(c.advanced)+', regressed '+fmt(c.regressed)+' · '+fmt(c.compared_recordings)+' / '+fmt(f.total)+' matched vs '+c.previous_sha.slice(0,8):' · Scoped comparison unavailable');
}
function trendDateLabels(runs,L,step){
  const dated=runs.map(r=>new Date(r.finished||r.created)),years=new Set(dated.map(d=>d.getFullYear()));
  const groups=[];
  dated.forEach((d,i)=>{
    const day=[d.getFullYear(),d.getMonth(),d.getDate()].join('-'),last=groups.at(-1);
    if(last?.day===day){last.end=i;return;}
    const label=String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+(years.size>1?'.'+String(d.getFullYear()).slice(-2):'');
    groups.push({day,label,start:i,end:i});
  });
  const candidates=groups.map(g=>({...g,x:L+((g.start+g.end)/2+.5)*step})),labels=[],gap=years.size>1?80:58;
  for(let i=0;i<candidates.length;i++){
    const c=candidates[i],last=candidates.at(-1);
    if(i===0||i===candidates.length-1||c.x-labels.at(-1).x>=gap&&last.x-c.x>=gap)labels.push(c);
  }
  return labels;
}
function trendColumns(id,runs,draw){
  const W=Math.max(320,$(id).clientWidth||640),H=252,L=48,R=14,T=20,B=42,plotW=W-L-R,plotH=H-T-B,baseline=T+plotH,step=plotW/runs.length;
  const {svg,node}=svgCanvas(W,H),readout=$('trend-readout');
  draw({node,L,T,W,step,plotH,baseline});
  runs.forEach((r,i)=>{
    const x=L+i*step,description=trendDescription(r);
    const group=node('g',{'class':'trend-column'+(r.id===selected?' selected':''),'data-run-id':r.id,tabindex:0,role:'button','aria-label':'Open snapshot: '+description});
    node('title',{},description,group);
    node('rect',{x,y:T,width:step,height:plotH,fill:'transparent','class':'trend-hitbox'},undefined,group);
    draw({node,group,r,i,x,step,L,T,W,plotH,baseline});
    const inspect=()=>{readout.textContent=description;};group.addEventListener('pointerenter',inspect);group.addEventListener('focus',inspect);
    group.addEventListener('click',()=>openSnapshot(r.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openSnapshot(r.id);}});
  });
  for(const label of trendDateLabels(runs,L,step))node('text',{x:label.x,y:baseline+23,'text-anchor':'middle','class':'trend-date-label'},label.label);
  $(id).replaceChildren(svg);
}
function renderTrend(){
  const runs=trendRuns();$('trend').hidden=runs.length<2;$('trend-empty').hidden=runs.length>=2;
  if(runs.length<2){$('trend-empty').textContent='At least two completed full measurements of this frozen cohort are needed to show a trend.';return;}
  const total=runs[runs.length-1][mode].total,series=orderedOutcomes(runs.flatMap(r=>Object.keys(r[mode].counts)));
  $('trend-title').textContent=trendLabels[mode]+' across engine commits';
  $('trend-note').textContent=fmt(runs.length)+' engine commits · '+fmt(total)+' frozen recordings';
  $('trend-outcomes').setAttribute('aria-label',trendLabels[mode]+' outcome shares for each engine commit');
  $('trend-ticks').setAttribute('aria-label',trendLabels[mode]+' median simulation ticks reached for each engine commit');
  $('trend-readout').textContent='Hover or focus a column to inspect it. Select it to open that snapshot.';
  trendColumns('trend-outcomes',runs,({node,group,r,x,step,L,W,plotH,baseline})=>{
    if(!group){for(const share of [0,.25,.5,.75,1]){const y=baseline-share*plotH;node('line',{x1:L,y1:y,x2:W-14,y2:y,style:'stroke:var(--line-soft)','stroke-dasharray':share?'3 4':'none'});node('text',{x:L-7,y:y+3,'text-anchor':'end'},share*100+'%');}return;}
    const width=Math.min(46,step*.62);let top=baseline;
    for(const key of series){
      const count=r[mode].counts[key]||0;if(!count)continue;
      const height=count/r[mode].total*plotH;top-=height;
      node('rect',{x:x+(step-width)/2,y:top,width,height:Math.max(0,height-1),style:'fill:'+color(key)},undefined,group);
    }
  });
  const ticks=runs.map(r=>Number.isFinite(r[mode].median_ticks)&&r[mode].median_ticks>=0?r[mode].median_ticks:null),axis=countAxis(Math.max(0,...ticks.filter(v=>v!==null)),'linear',170);
  trendColumns('trend-ticks',runs,({node,group,i,x,step,L,W,plotH,baseline})=>{
    const y=v=>baseline-v/axis.upper*plotH;
    if(!group){
      for(const tick of axis.ticks){node('line',{x1:L,y1:y(tick),x2:W-14,y2:y(tick),style:'stroke:var(--line-soft)','stroke-dasharray':tick?'3 4':'none'});node('text',{x:L-7,y:y(tick)+3,'text-anchor':'end'},fmt(tick));}
      ticks.forEach((v,j)=>{if(j&&v!==null&&ticks[j-1]!==null)node('line',{x1:L+(j-.5)*step,y1:y(ticks[j-1]),x2:L+(j+.5)*step,y2:y(v),style:'stroke:var(--link)','stroke-width':2});});return;
    }
    if(ticks[i]===null)return;
    node('circle',{cx:x+step/2,cy:y(ticks[i]),r:4,style:'fill:var(--link);stroke:var(--panel)','stroke-width':2},undefined,group);
    if(i===0||i===runs.length-1)node('text',{x:x+step/2,y:y(ticks[i])-10,'text-anchor':'middle','class':'trend-value'},fmt(ticks[i]),group);
  });
  chartLegend('trend-legend',outcomeLegend(series.filter(k=>runs.some(r=>r[mode].counts[k]>0))));
  chartLegend('trend-ticks-legend',[{label:'Median simulation ticks reached',fill:'var(--link)',line:true}]);
  const rows=[];
  for(const r of [...runs].reverse()){
    const tr=el('tr'),c=trendComparison(r),f=r[mode],open=el('a',runName(r),'trend-open');open.href=snapshotURL(r.id);
    const commit=el('td');commit.append(open,el('small',r.build_profile||'Historical'));
    const compared=c?el('td'):el('td','—');
    if(c){compared.append(el('span',signed(c.advanced),c.advanced?'positive':'trend-neutral'),el('span',' / ','trend-neutral'),el('span',c.regressed?'−'+fmt(c.regressed):'0',c.regressed?'negative':'trend-neutral'),el('small',fmt(c.compared_recordings)+' / '+fmt(f.total)+' matched · vs '+c.previous_sha.slice(0,8)));if(c.warnings.length){compared.append(el('small','Comparison caveat'));compared.title=c.warnings.join('\n');}}
    const rest=Object.entries(f.counts).filter(([key])=>!['complete_checked','unsupported','checkpoint_mismatch'].includes(key));
    const other=el('td',fmt(rest.reduce((sum,[,count])=>sum+count,0)));
    other.title=rest.filter(([,count])=>count).map(([key,count])=>(names[key]||key)+': '+fmt(count)).join('\n')||'No other outcomes';
    tr.append(commit,el('td',date(r.finished||r.created)),compared,el('td',fmt(f.counts.complete_checked||0)),el('td',fmt(f.counts.unsupported||0)),el('td',fmt(f.counts.checkpoint_mismatch||0)),other,el('td',fmt(f.median_ticks)));
    rows.push(tr);
  }
  $('trend-rows').replaceChildren(...rows);
}
function chart(id,buckets){
  const W=Math.max(320,Math.round($(id).clientWidth)||640),H=id==='ticks-chart'?235:280,L=44,R=12,T=16,B=65,plotH=H-T-B,plotW=W-L-R;
  const {svg,node}=svgCanvas(W,H);
  const series=chartOutcome==='all'?orderedOutcomes(buckets.flatMap(b=>Object.keys(b.counts))):[chartOutcome];
  const maximum=Math.max(0,...buckets.flatMap(b=>series.map(k=>b.counts[k]||0))),axis=countAxis(maximum,chartScale,plotH),baseline=T+plotH;
  node('desc',{},'Recording counts by progress bucket. Separate bars have a common zero baseline, in a fixed outcome order. '+(chartScale==='log'?'Count axis uses log base 10 of count plus one.':'Count axis is linear.'));
  for(const tick of axis.ticks){
    const y=baseline-axis.scale(tick);
    node('line',{x1:L,y1:y,x2:W-R,y2:y,style:'stroke:var(--line-soft)','stroke-dasharray':tick?'3 4':'none'});
    node('text',{x:L-7,y:y+3,'text-anchor':'end'},fmt(tick));
  }
  const readout=$(id+'-readout');readout.textContent='Hover or focus a bucket to inspect its counts.';
  const step=plotW/Math.max(1,buckets.length),gutter=Math.min(5,step*.2),slot=(step-gutter)/Math.max(1,series.length),gap=Math.min(1,slot*.2);
  const labelCount=Math.min(buckets.length,Math.max(2,Math.floor(plotW/50)));
  const labeled=new Set(Array.from({length:labelCount},(_,i)=>Math.round(i*(buckets.length-1)/Math.max(1,labelCount-1))));
  buckets.forEach((bucket,i)=>{
    const total=series.reduce((sum,k)=>sum+(bucket.counts[k]||0),0);
    const description=bucket.label+' · '+series.map(k=>(names[k]||k)+': '+fmt(bucket.counts[k]||0)).join(' · ')+(series.length>1?' · Total: '+fmt(total):'');
    const group=node('g',{'class':'histogram-bucket','data-bucket':bucket.label,tabindex:0,role:'img','aria-label':description});
    node('title',{},description,group);
    node('rect',{x:L+i*step,y:T,width:step,height:plotH,fill:'transparent','class':'histogram-hitbox'},undefined,group);
    for(let j=0;j<series.length;j++){
      const key=series[j],count=bucket.counts[key]||0;if(!count)continue;
      const height=axis.scale(count),x=L+i*step+gutter/2+j*slot+gap/2;
      node('rect',{x,y:baseline-height,width:Math.max(.2,slot-gap),height,style:'fill:'+color(key),rx:.6,'class':'histogram-bar','data-outcome':key,'data-count':count},undefined,group);
      if(series.length===1&&step>=26)node('text',{x:x+(slot-gap)/2,y:baseline-height-5,'text-anchor':'middle','font-size':8},fmt(count),group);
    }
    const inspect=()=>{readout.textContent=description;};group.addEventListener('pointerenter',inspect);group.addEventListener('focus',inspect);
    if(labeled.has(i)){const x=L+(i+.5)*step;node('text',{x,y:baseline+13,transform:`rotate(-52 ${x} ${baseline+13})`,'text-anchor':'end','class':'histogram-label'},bucket.label);}
  });
  if(!maximum)node('text',{x:L+plotW/2,y:T+plotH/2,'text-anchor':'middle'},'No recordings for this selection');
  $(id).replaceChildren(svg);
  chartLegend(id+'-legend',outcomeLegend(series.filter(key=>chartOutcome!=='all'||buckets.some(b=>b.counts[key]>0))));
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
    }else if(sort==='tps-asc'||sort==='tps-desc'){
      const left=averageTPS(a),right=averageTPS(b);
      order=left===null?(right===null?0:1):right===null?-1:(sort==='tps-asc'?1:-1)*(left-right);
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
    const meter=el('span',progress(r)<0?'—':progress(r).toFixed(2)+'%','micro-progress');meter.style.setProperty('--percent',Math.max(0,progress(r))+'%');meter.style.setProperty('--badge',color(outcome(r)));percent.append(meter);
    const checkpoint=el('td',r.total_checkpoints===undefined?'—':fmt(r.checkpoints_passed||0)+' / '+fmt(r.total_checkpoints));
    if(r.ignored_commands_to_stop)checkpoint.title=r.ignored_commands_to_stop+' ignored command packets before stop';
    const runtime=el('td',undefined,'recording-elapsed');runtime.append(el('span',replayTime(r.runtime_seconds)));
    runtime.title=elapsedSeconds(r.runtime_seconds)===null?'No recorded timer.':'Wall time including parsing and simulation until the first stop or EOF. Shared session startup is excluded; historical and fallback processes may include startup.';
    if(elapsedSeconds(r.runtime_seconds)!==null&&(r.runtime_source==='retained'||r.runtime_source==='historical'))
      runtime.append(el('small',r.runtime_source==='retained'?'Retained':'Historical'));
    const tps=averageTPS(r),speed=el('td',tps===null?'—':tps.toLocaleString('en-US',{maximumSignificantDigits:4}),'recording-speed');
    speed.title=tps===null?'Average speed unavailable: requires a completed-tick counter and positive recorded wall time.':'Completed simulation ticks divided by recorded wall time in seconds. Includes parsing and any startup counted by that timer.';
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
    tr.append(first,status,ticks,percent,checkpoint,runtime,speed,diagnostic);$('rows').append(tr);
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
const showLoadError=error=>{$('error').hidden=false;$('error').textContent=error.message;};
function showTheme(){const light=document.documentElement.dataset.theme==='light';$('theme-toggle').textContent=light?'Dark theme':'Light theme';}
$('theme-toggle').onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;try{localStorage.setItem('genie-theme',next);}catch{}showTheme();};showTheme();
globalThis.addEventListener?.('resize',()=>{if(trendPage&&manifest)renderTrend();else if(data)renderCharts(data.run[mode]);});
if(trendPage){
  for(const scope of cohortScopes)$(scope).onclick=()=>{mode=scope;modeChosen=true;renderTrendPage();try{globalThis.history?.replaceState(null,'',trendURL());}catch{}};
}else{
for(const key of corpusScopes)$(key).onclick=()=>{mode=key;modeChosen=true;page=0;changesPage=0;render();};
$('engine-kind-filter').onchange=()=>{page=0;renderTable();};
$('run-select').onchange=event=>{const pending=selectSnapshot(event.currentTarget.value);if(pending)pending.catch(showLoadError);};
$('run-select').onblur=()=>{if(manifest)syncSelector(visibleRuns(manifest.runs),true);};
$('retry-details').onclick=()=>{detailsCache.delete(selected);loadDetails(manifest.runs.find(r=>r.id===selected)).catch(showLoadError);};
for(const id of ['search','status-filter','sort'])$(id).addEventListener('input',()=>{page=0;renderTable();});
$('previous').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('provenance').onclick=()=>$('method').showModal();$('close-method').onclick=()=>$('method').close();
$('chart-scale').onchange=event=>{chartScale=event.currentTarget.value;if(data)renderCharts(data.run[mode]);};
$('percent-fine-buckets').onchange=event=>{if(data){progressBucketChoices.set(progressBucketView(),event.currentTarget.checked);renderCharts(data.run[mode]);}};
$('chart-outcome').onchange=event=>{chartOutcome=event.currentTarget.value;if(data)renderCharts(data.run[mode]);};
$('chart-outcome').onblur=()=>{if(data&&chartSelectorKey!==JSON.stringify(histogramOutcomes(data.run[mode])))renderCharts(data.run[mode]);};
$('command-standard').onchange=event=>{commandStandard=event.currentTarget.value;renderCommandCoverage();};
$('command-filter').onchange=()=>{commandShowAll=false;renderCommandCoverage();};
$('command-show-all').onclick=()=>{commandShowAll=!commandShowAll;renderCommandCoverage();};
for(const id of ['changes-search','changes-filter','changes-sort'])$(id).addEventListener('input',()=>{changesPage=0;renderReplayChanges();});
$('changes-previous').onclick=()=>{changesPage--;renderReplayChanges();};
$('changes-next').onclick=()=>{changesPage++;renderReplayChanges();};
loadCheckpointDefinitions();
}
refresh();setInterval(refresh,60000);
