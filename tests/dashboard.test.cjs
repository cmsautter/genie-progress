const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const {createHash,webcrypto}=require('node:crypto');

// A small DOM fixture exercises the shipped app's async behavior, without a browser.
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this._value='';this.hidden=false;this.disabled=false;this.replacements=0;this.style={setProperty(){}};this.classList={toggle(){}};}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}
  append(...items){this.children.push(...items);if(this.tag==='select'&&!this._value)this._value=this.options[0]?.value||'';}
  replaceChildren(...items){this.replacements++;this.children=[];this._text='';if(this.tag==='select')this._value='';this.append(...items);}
  get options(){return this.children.flatMap(c=>c.tag==='optgroup'?c.children:[c]);}
  set value(value){this._value=String(value);}
  get value(){return this._value;}
  add(option){this.append(option);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){this['on'+name]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function Option(text,value){const n=new Element('option');n.textContent=text;n.value=value;return n;}
const summary=(n,checked)=>({total:5604,finished:n,counts:{complete_checked:checked,unsupported:n-checked},measurable:n,median_ticks:90,median_percent:.16,histogram:[],ticks_histogram:[],blockers:[]});
function run(id,n,checked,extra={}){
  return {id,sha:id==='baseline'?'a963f5f3035d876fe90c5609030789cd532468b2':'bc3e0fef9fa2af697ef46232dee1e4772f3c98ed',status:'running',created:'2026-10-19T17:36:00Z',finished:null,pilot:false,imported:false,architecture:'x86_64',fixed:summary(n,checked),growing:summary(n,checked),comparison:{comparable:0},...extra};
}
const active=run('active',4000,7,{continuation:{run_id:'before-upgrade',preserved_results:1648}});
const archived=run('before-upgrade',1201,3,{status:'continued',finished:'2026-10-19T18:16:00Z'});
const baseline=run('baseline',5604,9,{status:'complete',imported:true,finished:'2026-10-19T13:10:00Z'});
const pilot=run('pilot',12,1,{status:'complete',pilot:true});
function manifest(runs=[active,archived,pilot,baseline],generated='2026-10-19T18:51:00Z'){
  return {generated,heartbeat:generated,reference_count:5604,catalog_count:7900,runs:structuredClone(runs)};
}
function payload(r){return {run:structuredClone(r),identity:{engine_sha:r.sha},rows:[{match_id:r.id==='baseline'?'100':'200',fixed:true,status:'complete',completed_ticks:100,total_ticks:100,checkpoints_passed:1,total_checkpoints:1}]};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

const rawJSON=Symbol('source JSON bytes');
function fileJSON(filename){const text=fs.readFileSync(filename,'utf8');const value=JSON.parse(text);Object.defineProperty(value,rawJSON,{value:text});return value;}
function jsonResponse(value){
  const text=value?.[rawJSON]||JSON.stringify(value);return {ok:true,json:async()=>JSON.parse(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer};
}
async function app(initial=manifest(),options={}){
  const nodes=new Map();const document={activeElement:null,getElementById(id){
    if(!nodes.has(id))nodes.set(id,new Element(['run-select','sort','status-filter','chart-outcome','chart-scale','command-standard','command-filter','changes-filter','changes-sort'].includes(id)?'select':'div'));
    return nodes.get(id);
  },createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>new Element(tag),createTextNode:text=>({textContent:text})};
  document.documentElement={dataset:{theme:options.theme||'dark'}};
  document.body={dataset:options.trendPage?{page:'trends'}:{}};
  const $=id=>document.getElementById(id);
  $('sort').value='progress-desc';$('status-filter').value='all';$('search').value='';
  $('command-standard').value='reviewed';$('command-filter').value='gaps';
  $('changes-filter').value='all';$('changes-sort').value='ticks-absolute';$('changes-search').value='';
  const calls=[],coverageCalls=[],changesCalls=[];let latest=initial;
  function fetch(url,requestOptions={}){
    if(url==='manifest.json'||url.startsWith('manifest.json?'))return Promise.resolve(jsonResponse(latest));
    if(url==='checkpoint-checks.json')return Promise.resolve({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../site/checkpoint-checks.json'),'utf8'))});
    if(url.startsWith('changes/')){
      const id=decodeURIComponent(url.split('/').pop().split('.json')[0]);
      if(!options.deferChanges){
        changesCalls.push({id,url});
        return Promise.resolve(options.changes?.[id]?jsonResponse(options.changes[id]):{ok:false,status:404});
      }
      return new Promise(resolve=>changesCalls.push({id,url,done:false,resolve:value=>resolve(jsonResponse(value))}));
    }
    if(url.startsWith('coverage/')){
      const id=decodeURIComponent(url.split('/').pop().split('.json')[0]);
      if(!options.deferCoverage){
        coverageCalls.push({id,url});
        return Promise.resolve(options.coverage?.[id]?jsonResponse(options.coverage[id]):{ok:false,status:404});
      }
      return new Promise(resolve=>coverageCalls.push({id,url,done:false,resolve:value=>resolve(jsonResponse(value))}));
    }
    let resolve;const promise=new Promise(r=>{resolve=r;});
    const id=decodeURIComponent(url.split('/').pop().split('.json')[0]);
    calls.push({id,url,options:requestOptions,done:false,resolve:value=>resolve(jsonResponse(value))});
    // Intentionally ignore AbortSignal: late responses must also be rejected by identity.
    return promise;
  }
  const events={};
  const context=vm.createContext({document,Option,URLSearchParams,location:{search:options.search||''},fetch,AbortController,console,setInterval(){},Date,Map,Set,crypto:options.noNativeCrypto?{}:webcrypto,TextDecoder,Uint8Array,sessionStorage:options.storage,localStorage:options.themeStorage,addEventListener(name,fn){events[name]=fn;}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../site/sha256.min.js'),'utf8'),context);
  const source=fs.readFileSync(process.env.APP_JS||path.join(__dirname,'../site/app.js'),'utf8');
  vm.runInContext(source,context);await settle();
  function resolve(id,value){const call=calls.find(c=>c.id===id&&!c.done);assert.ok(call,'pending request for '+id);call.done=true;call.resolve(value);}
  function resolveCoverage(id,value){const call=coverageCalls.find(c=>c.id===id&&!c.done);assert.ok(call,'pending coverage for '+id);call.done=true;call.resolve(value);}
  function resolveChanges(id,value){const call=changesCalls.find(c=>c.id===id&&!c.done);assert.ok(call,'pending changes for '+id);call.done=true;call.resolve(value);}
  async function choose(id){$('run-select').value=id;$('run-select').onchange({currentTarget:$('run-select')});await settle();}
  return {$,document,context,events,calls,coverageCalls,changesCalls,resolve,resolveCoverage,resolveChanges,choose,setManifest:value=>{latest=value;},refresh:()=>context.refresh()};
}

test('snapshot summary switches immediately while recording details are pending',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  assert.equal(a.$('measured').textContent,'4,000');
  await a.choose('baseline');
  assert.equal(a.$('measured').textContent,'5,604');
  assert.equal(a.$('checked').textContent,'9');
  assert.equal(a.$('rows').children.length,0);
  assert.match(a.$('table-state').textContent,/Loading.*Historical baseline/);
  a.resolve('baseline',payload(baseline));await settle();
  assert.equal(a.$('checked').textContent,'9');assert.equal(a.$('rows').children.length,1);
});

test('all initial results can be present while timeout retries are still running',async()=>{
  const retry=run('retry',5604,9,{execution:{phase:'retrying',retry_finished:25,retry_total:233,active_sessions:8,retry_seconds:600}});
  const a=await app(manifest([retry,baseline]));a.resolve('retry',payload(retry));await settle();
  assert.match(a.$('run-state').textContent,/Timeout retries 25 \/ 233.*8 active/);
  assert.match(a.$('measured-sub').textContent,/initial results; timeout retries still running/);
  assert.match(a.$('outcome-note').textContent,/208 timeout retries remaining.*600s each/);
  assert.equal(a.$('run-progress').style.width,'100%');
  assert.match(a.$('run-select').options[0].textContent,/Retrying timeouts/);
});

test('slow-update timeouts show their failed update and retained progress',async()=>{
  const retry=run('retry',5604,9,{execution:{phase:'retrying',retry_finished:26,retry_total:233,active_sessions:10,retry_seconds:300,retry_tick_seconds:10}});
  const a=await app(manifest([retry,baseline]));const report=payload(retry);
  report.rows=[{match_id:'200',fixed:true,status:'timeout',timeout_kind:'simulation_step',reason:'A simulation update exceeded its time limit',step_tick:8,step_limit_seconds:10,completed_ticks:7,total_ticks:100}];
  a.resolve('retry',report);await settle();
  assert.match(a.$('outcome-note').textContent,/300s each.*10s per update/);
  assert.match(a.$('rows').textContent,/Update 8 exceeded 10s. 7 completed updates retained/);
});

test('manual baseline selection survives automatic refresh and a newer run',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  await a.choose('baseline');a.resolve('baseline',payload(baseline));await settle();
  const newer=run('newest',1,0);a.setManifest(manifest([newer,active,archived,pilot,baseline],'2026-10-19T19:00:00Z'));
  await a.refresh();assert.equal(a.$('run-select').value,'baseline');assert.equal(a.$('measured').textContent,'5,604');
  assert.equal(a.calls.filter(c=>c.id==='baseline').length,1);
  assert.equal(a.calls.filter(c=>c.id==='newest').length,0);
});

test('late current-run response cannot overwrite a selected baseline',async()=>{
  const a=await app();await a.choose('baseline');a.resolve('baseline',payload(baseline));await settle();
  a.resolve('active',payload(active));await settle();
  assert.equal(a.$('run-select').value,'baseline');assert.equal(a.$('measured').textContent,'5,604');assert.equal(a.$('checked').textContent,'9');
});

test('continued predecessor is folded into the current run with an archive link',async()=>{
  const a=await app();
  const ids=a.$('run-select').options.map(o=>o.value);
  assert.deepEqual(ids,['active','baseline']);
  assert.equal(a.$('prior-worker').hidden,false);assert.equal(a.$('prior-worker').href,'data/before-upgrade.json');
  assert.match(a.$('run-time').textContent,/1,648 results retained/);
});

test('refresh preserves a native menu choice before its change event',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  const select=a.$('run-select'),before=select.replacements;a.document.activeElement=select;select.value='baseline';
  a.setManifest(manifest(undefined,'2026-10-19T19:00:00Z'));const refreshing=a.refresh();await settle();
  assert.equal(select.value,'baseline');assert.equal(select.replacements,before);
  await a.choose('baseline');a.resolve('baseline',payload(baseline));await settle();
  a.resolve('active',payload(active));await refreshing;
  assert.equal(a.$('measured').textContent,'5,604');
});

test('historical details are cached across repeated snapshot switching',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  await a.choose('baseline');a.resolve('baseline',payload(baseline));await settle();
  for(let i=0;i<3;i++){await a.choose('active');await a.choose('baseline');}
  assert.equal(a.calls.filter(c=>c.id==='baseline').length,1);assert.equal(a.calls.filter(c=>c.id==='active').length,1);
});

test('wrong snapshot response is rejected and details can be retried',async()=>{
  const a=await app();await a.choose('baseline');a.resolve('baseline',payload(active));await settle();
  assert.equal(a.$('measured').textContent,'5,604');assert.match(a.$('error').textContent,/different snapshot/);
  assert.equal(a.$('retry-details').hidden,false);assert.equal(a.$('rows').children.length,0);
  a.$('retry-details').onclick();a.resolve('baseline',payload(baseline));await settle();
  assert.equal(a.$('error').hidden,true);assert.equal(a.$('rows').children.length,1);
});

test('unchanged selector options are retained when active progress refreshes',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  const count=a.$('run-select').replacements;const next=run('active',4200,8,{continuation:active.continuation});
  a.setManifest(manifest([next,archived,pilot,baseline],'2026-10-19T19:00:00Z'));
  const refreshing=a.refresh();await settle();assert.equal(a.$('measured').textContent,'4,200');
  assert.equal(a.$('run-select').replacements,count);
  a.resolve('active',payload(next));await refreshing;assert.equal(a.$('checked').textContent,'8');
});

test('adapter preparation failures are distinct from compiler failures',async()=>{
  const failed=run('failed',0,0,{status:'build_failed',error:'A sanitized old error',failure:{stage:'adapter',code:'workspace_layout',message:'The adapter needs an update before compilation.',details:'Package genie-oracle moved to crates/tools.'}});
  const a=await app(manifest([failed,baseline]));
  assert.equal(a.$('run-state').textContent,'● Adapter update needed');
  assert.match(a.$('run-select').options[0].textContent,/Adapter update needed/);
  assert.equal(a.$('error').textContent,failed.failure.message);
  assert.equal(a.$('failure-diagnostics').hidden,false);
  assert.match(a.$('failure-diagnostic-text').textContent,/Stage: adapter/);
  assert.match(a.$('outcome-note').textContent,/5,604 not run/);
  a.resolve('failed',{run:failed,identity:{},rows:[]});await settle();
  assert.match(a.$('table-state').textContent,/No replay tests were started/);
  assert.equal(a.$('table-state').hidden,false);
  await a.choose('baseline');
  assert.equal(a.$('failure-diagnostics').hidden,true);
  assert.equal(a.$('error').hidden,true);
});

test('compiler failures show a readable status and separate diagnostics',async()=>{
  const failed=run('failed',0,0,{status:'build_failed',failure:{stage:'compilation',code:'compiler_error',message:'Rust compilation failed.',details:'error[E0001]: incompatible API'}});
  const a=await app(manifest([failed,baseline]));
  assert.equal(a.$('run-state').textContent,'● Build failed');
  assert.equal(a.$('error').textContent,'Rust compilation failed.');
  assert.match(a.$('failure-diagnostic-text').textContent,/error\[E0001\]/);
});

test('run summary identifies the actual build profile and process ceiling',async()=>{
  const release=run('release',100,1,{build_profile:'release',case_workers:16});
  const a=await app(manifest([release,baseline]));
  assert.match(a.$('run-time').textContent,/release · up to 16 processes/);
});

test('curated TTL recordings display their names without invented online match links',async()=>{
  const a=await app();
  const numeric=a.context.recordingLink({match_id:'426048731'});
  assert.equal(numeric.tag,'a');assert.equal(numeric.href,'https://www.aoe2insights.com/match/426048731/');
  const ttl=a.context.recordingLink({match_id:'ttl:Anakin_vs_Combito_G1:e8cfa7889f95'});
  assert.equal(ttl.tag,'span');assert.equal(ttl.textContent,'TTL · Anakin vs Combito G1');
  assert.equal(ttl.href,undefined);
});

test('selector keeps the four requested snapshots and archives superseded attempts',async()=>{
  const release=run('release',4000,7,{sha:'e'.repeat(40),created:'2026-10-19T20:32:00Z',build_profile:'release'});
  const profiling=run('profiling',5604,9,{sha:release.sha,status:'complete',created:'2026-10-19T20:28:00Z',build_profile:'forced'});
  const duplicate={...profiling,id:'old-complete',created:'2026-10-19T19:49:00Z'};
  const failed={...profiling,id:'failed',status:'build_failed',created:'2026-10-19T19:44:00Z'};
  const previous=run('previous',5604,9,{status:'complete',created:'2026-10-19T18:16:00Z',build_profile:'forced'});
  const a=await app(manifest([release,profiling,duplicate,failed,previous,pilot,baseline]));
  assert.deepEqual(a.$('run-select').options.map(o=>o.value),['release','profiling','previous','baseline']);
  assert.match(a.$('run-select').options[0].textContent,/Release.*In progress/);
  assert.match(a.$('run-select').options[1].textContent,/Profiling.*Complete/);
  assert.equal(a.$('archived-count').textContent,'3');
  assert.equal(a.$('archived-list').children.length,3);
  assert.ok(a.$('archived-list').children.some(li=>li.children[0].href==='index.html?run=old-complete&cohort=fixed'));
  assert.ok(a.$('archived-list').children.some(li=>li.children[2].href==='data/old-complete.json'));
});

test('a new unresolved failure stays visible and a growing rerun replaces the previous same-profile entry',async()=>{
  const previous=run('previous',5604,9,{status:'complete',build_profile:'release',created:'2026-10-19T18:00:00Z'});
  const current={...previous,id:'current',status:'running',created:'2026-10-19T19:00:00Z'};
  const failed={...current,id:'new-failure',sha:'f'.repeat(40),status:'build_failed',created:'2026-10-19T20:00:00Z'};
  const a=await app(manifest([failed,current,previous,baseline]));
  assert.deepEqual(a.$('run-select').options.map(o=>o.value),['new-failure','current','baseline']);
  assert.match(a.$('run-select').options[0].textContent,/Build failed/);
});

test('checkpoint mismatches show named checks and recorded versus simulated values',async()=>{
  const a=await app(),p=payload(active);
  p.rows=[{match_id:'425780724',fixed:true,build:158041,status:'checkpoint_mismatch',
    total_ticks:96388,completed_ticks:499,first_failure_tick:499,total_checkpoints:192,
    checkpoints_passed:0,last_matching_checkpoint_tick:0,differences:[
      {player:1,word:7,recorded:76436,simulated:76636},
      {player:2,word:7,recorded:1,simulated:2},
      {player:2,word:9,recorded:4294967295,simulated:123}]}];
  a.resolve('active',p);await settle();
  const details=a.$('rows').children[0].children[7].children[0];
  assert.equal(details.tag,'details');
  assert.match(details.children[0].textContent,/Mismatch at update 499.*Object positions.*Actions and unit AI/);
  assert.match(details.textContent,/Player 1/);
  assert.match(details.textContent,/76,436/);assert.match(details.textContent,/76,636/);
  assert.match(details.textContent,/4,294,967,295/);
  assert.match(details.textContent,/not a particular object/);
  const groups=a.$('checkpoint-groups').children;
  assert.equal(groups.length,2);assert.equal(a.$('checkpoint-count').textContent,'1 recording');
  assert.equal(groups[0].children[0].children[1].textContent,'1');
  details.open=true;details.ontoggle();a.context.renderTable();
  assert.equal(a.$('rows').children[0].children[7].children[0].open,true);
});

test('selecting a checkpoint category filters affected recordings',async()=>{
  const current=structuredClone(active);current.fixed.counts={checkpoint_mismatch:2};current.growing.counts={checkpoint_mismatch:3};
  const a=await app(manifest([current,baseline])),p=payload(current);
  p.rows=[
    {match_id:'1',fixed:true,build:158041,status:'checkpoint_mismatch',differences:[{player:1,word:7,recorded:1,simulated:2}]},
    {match_id:'2',fixed:true,build:158041,status:'checkpoint_mismatch',differences:[{player:1,word:1,recorded:3,simulated:4}]},
    {match_id:'3',fixed:false,build:158041,status:'checkpoint_mismatch',differences:[{player:1,word:7,recorded:5,simulated:6}]},
  ];
  a.resolve('active',p);await settle();
  const group=a.$('checkpoint-groups').children.find(g=>g.children[0].children[0].textContent==='Object positions');
  group.children[0].onclick();
  assert.equal(a.$('status-filter').value,'checkpoint_mismatch');
  assert.equal(a.$('search').value,'Object positions');
  assert.equal(a.$('rows').children.length,1);
  assert.equal(a.$('rows').children[0].children[0].textContent,'1');
  a.$('growing').onclick();assert.equal(a.$('rows').children.length,2);
  const positions=a.$('checkpoint-groups').children.find(g=>g.children[0].children[0].textContent==='Object positions');
  assert.equal(positions.children[0].children[1].textContent,'2');
});

test('unmapped checkpoint words, other builds and missing differences stay explicit',async()=>{
  const a=await app(),p=payload(active);
  p.rows=[
    {match_id:'1',fixed:true,build:158041,status:'checkpoint_mismatch',differences:[{player:0,word:42,recorded:0,simulated:1}]},
    {match_id:'2',fixed:true,build:160062,status:'checkpoint_mismatch',differences:[{player:1,word:7,recorded:1,simulated:2}]},
    {match_id:'3',fixed:true,status:'checkpoint_mismatch'},
  ];
  a.resolve('active',p);await settle();
  const text=a.$('rows').textContent;
  assert.match(text,/Checkpoint word 42/);assert.match(text,/Checkpoint word 7/);
  assert.doesNotMatch(text,/Object positions/);assert.match(text,/check details unavailable/);
  assert.match(text,/Gaia \(0\)/);
});

function histogramGroups(a,id='percent-chart'){
  return a.$(id).children[0].children.filter(n=>n.tag==='g');
}
function histogramBars(group){return group.children.filter(n=>n.tag==='rect'&&n.class==='histogram-bar');}

test('histograms keep category slots fixed and all bars share a baseline',async()=>{
  const current=structuredClone(active);
  current.fixed.histogram=[
    {label:'0–1%',counts:{unsupported:100,checkpoint_mismatch:5}},
    {label:'1–2%',counts:{checkpoint_mismatch:5,unsupported:1}},
    {label:'2–3%',counts:{checkpoint_mismatch:1}},
  ];
  const a=await app(manifest([current,baseline])),groups=histogramGroups(a);
  const first=histogramBars(groups[0]),second=histogramBars(groups[1]),third=histogramBars(groups[2]);
  assert.deepEqual(first.map(n=>n['data-outcome']),['unsupported','checkpoint_mismatch']);
  assert.deepEqual(second.map(n=>n['data-outcome']),['unsupported','checkpoint_mismatch']);
  assert.equal(third[0]['data-outcome'],'checkpoint_mismatch');
  for(const bars of [first,second,third])for(const bar of bars)assert.ok(Math.abs(Number(bar.y)+Number(bar.height)-215)<1e-9);
  assert.equal(first[1].height,second[1].height,'same count has the same height irrespective of its neighbours');
  assert.ok(first[1].x>first[0].x);assert.ok(second[1].x>second[0].x);
  const step=second[1].x-first[1].x;
  assert.ok(Math.abs(third[0].x-second[1].x-step)<1e-9,'missing series keep their empty slot');
});

test('linear histogram heights are proportional and scale changes preserve counts',async()=>{
  const current=structuredClone(active);current.fixed.histogram=[{label:'0–1%',counts:{unsupported:100,checkpoint_mismatch:50}}];
  const a=await app(manifest([current,baseline]));
  a.$('chart-scale').value='linear';a.$('chart-scale').onchange({currentTarget:a.$('chart-scale')});
  const bars=histogramBars(histogramGroups(a)[0]);
  assert.equal(bars[0].height/bars[1].height,2);
  assert.equal(a.$('percent-scale-label').textContent,'Linear count axis');
  assert.match(a.$('chart-scale-note').textContent,/proportional/);
  const axis=a.context.countAxis(100,'linear',200);assert.equal(axis.scale(0),0);assert.equal(axis.scale(100),200);
  const log=a.context.countAxis(100,'log',200);assert.equal(log.scale(0),0);assert.equal(log.scale(100),200);
});

test('histogram buckets expose exact totals on pointer hover and keyboard focus',async()=>{
  const current=structuredClone(active);current.fixed.histogram=[{label:'3–4%',counts:{checkpoint_mismatch:45,unsupported:99}}];
  const a=await app(manifest([current,baseline])),g=histogramGroups(a)[0];
  assert.equal(g.tabindex,0);
  g.onpointerenter();assert.match(a.$('percent-chart-readout').textContent,/Checkpoint mismatch: 45/);
  assert.match(a.$('percent-chart-readout').textContent,/Unsupported update: 99/);
  assert.match(a.$('percent-chart-readout').textContent,/Total: 144/);
  a.$('percent-chart-readout').textContent='';g.onfocus();assert.match(a.$('percent-chart-readout').textContent,/Total: 144/);
});

test('histogram outcome selection filters both charts and survives refresh',async()=>{
  const current=structuredClone(active);
  current.fixed.histogram=[{label:'0–1%',counts:{unsupported:100,checkpoint_mismatch:5}}];
  current.fixed.ticks_histogram=[{label:'0–500',counts:{checkpoint_mismatch:5,unsupported:100}}];
  const a=await app(manifest([current,baseline]));a.resolve('active',payload(current));await settle();
  const select=a.$('chart-outcome');select.value='checkpoint_mismatch';select.onchange({currentTarget:select});
  for(const id of ['percent-chart','ticks-chart']){
    const bars=histogramBars(histogramGroups(a,id)[0]);assert.equal(bars.length,1);
    assert.equal(bars[0]['data-outcome'],'checkpoint_mismatch');assert.equal(bars[0]['data-count'],5);
  }
  const count=select.replacements;await a.refresh();
  assert.equal(select.value,'checkpoint_mismatch');assert.equal(select.replacements,count);
  const svg=a.$('percent-chart').children[0];select.onblur();
  assert.equal(a.$('percent-chart').children[0],svg,'leaving the menu preserves the next keyboard-focus target');
});

test('empty histogram selections render finite axes and an explicit empty state',async()=>{
  const a=await app();assert.match(a.$('percent-chart').textContent,/No recordings for this selection/);
  for(const scale of ['linear','log']){
    const axis=a.context.countAxis(0,scale,200);assert.ok(Number.isFinite(axis.scale(0)));
    assert.ok(axis.ticks.every(Number.isFinite));
  }
});

function coverage(r){
  const group=()=>({total_recordings:r.fixed.total,scanned_recordings:100,pending_recordings:5503,unreadable_recordings:1,horizon_recordings:90,
    observed_types:4,command_occurrences:1000,type_counts:{implemented:1,partial:1,unsupported:1,unknown:1},
    occurrence_counts:{implemented:100,partial:700,unsupported:150,unknown:50},
    implemented_types_percent:25,implemented_occurrences_percent:10,handler_types_percent:50,handler_occurrences_percent:80,
    rows:[['move','Move','partial',700],['farm','Build farm','unsupported',150],['toggle','Queue toggle','implemented',100],['raw','Unknown','unknown',50]].map(([key,label,status,occurrences])=>({key,label,status,occurrences,recordings:20,after_stop_occurrences:status==='unknown'?null:10,horizon_recordings:10,reason:'Review detail',source:'https://github.com/librematch/genie/blob/'+r.sha+'/source.rs'}))});
  const fixed=group(),growing=group();growing.command_occurrences=2000;growing.scanned_recordings=200;growing.implemented_occurrences_percent=5;
  return {schema:1,run:{id:r.id,sha:r.sha},generated:'2026-10-20T03:00:00Z',parser:{key:'a'.repeat(64)},classification:{available:true},fixed,growing};
}

test('command census shows strict coverage and full-body occurrence rankings',async()=>{
  const a=await app(manifest(),{coverage:{active:coverage(active)}});
  assert.equal(a.$('command-coverage-content').hidden,false);
  assert.equal(a.$('command-types-percent').textContent,'25.0%');
  assert.equal(a.$('command-occurrences-percent').textContent,'10.0%');
  assert.match(a.$('command-types-count').textContent,/1 of 4/);
  assert.match(a.$('command-census-note').textContent,/entire recording.*Unknown packets stay in the denominator/);
  assert.match(a.$('command-coverage-state').textContent,/1 unreadable bodies excluded/);
  assert.equal(a.$('command-rows').children.length,3,'reviewed handlers excluded from the default gap ranking');
  assert.match(a.$('command-rows').children[0].textContent,/Move/);
  assert.match(a.$('command-rows').children[2].textContent,/—/);
  assert.equal(a.$('command-download').href,'coverage/active.json');
  a.$('growing').onclick();
  assert.equal(a.$('command-occurrences-percent').textContent,'5.0%');
  assert.match(a.$('command-occurrences-count').textContent,/2,000 commands/);
});

test('unavailable classification keeps frequency counts without claiming zero implementation',async()=>{
  const value=coverage(active);value.classification.available=false;
  const a=await app(manifest(),{coverage:{active:value}});
  assert.equal(a.$('command-types-percent').textContent,'—');
  assert.equal(a.$('command-occurrences-percent').textContent,'—');
  assert.match(a.$('command-types-count').textContent,/Assessment unavailable.*4 observed variants/);
  assert.match(a.$('command-occurrences-count').textContent,/1,000 commands counted/);
  assert.ok(a.$('command-rows').children.length>0);
});

test('coverage identifies the assessed engine and actual benchmark build and completion',async()=>{
  const r={...active,build_profile:'release',status:'complete',finished:'2026-10-23T15:29:49Z'};
  const value=coverage(r);value.benchmark={game_build:158041};
  const a=await app(manifest([r]),{coverage:{active:value}});
  const note=a.$('command-census-note').textContent;
  assert.match(note,/Automatically assessed from this exact engine source/);
  assert.ok(note.includes('engine '+r.sha.slice(0,12)));
  assert.match(note,/Game build 158041.*release.*benchmark completed/);
});

test('structured errors expose pinned source and repeated context and filter by kind',async()=>{
  const a=await app(),value=payload(active);
  const error={schema:2,kind:'unreachable',phase:'update',location:{repository_path:'crates/engine/genie-core/src/turn/unit.rs',line:347,column:2},context:[{key:'object',value:'12'},{key:'object',value:'34'}]};
  value.rows=[{match_id:'200',fixed:true,status:'unsupported',completed_ticks:10,total_ticks:100,unsupported:[{reason:'Invariant failed',engine_error:error}]},
    {match_id:'201',fixed:true,status:'unsupported',completed_ticks:9,total_ticks:100,unsupported:[{reason:'Legacy stop'}]}];
  a.resolve('active',value);await settle();
  const detail=a.$('rows').children[0].children[7];
  assert.match(detail.textContent,/Engine invariant.*update.*object: 12.*object: 34/);
  const all=node=>[node,...(node.children||[]).flatMap(all)];
  const link=all(detail).find(n=>n.tag==='a');
  assert.equal(link.href,'https://github.com/librematch/genie/blob/'+active.sha+'/crates/engine/genie-core/src/turn/unit.rs#L347');
  a.$('engine-kind-filter').value='unreachable';a.$('engine-kind-filter').onchange();
  assert.match(a.$('row-count').textContent,/1 matching recording/);
});

test('structured error source links reject paths outside the engine repository',async()=>{
  const a=await app(),value=payload(active);
  value.rows=[{match_id:'200',fixed:true,status:'parse_error',reason:'Invalid input',engine_error:{schema:2,kind:'invalid_input',phase:'parse',location:{repository_path:'crates/../../private.rs',line:1},context:[]}}];
  a.resolve('active',value);await settle();
  const detail=a.$('rows').children[0].children[7];
  const all=node=>[node,...(node.children||[]).flatMap(all)];
  assert.ok(!all(detail).some(n=>n.tag==='a'));
  assert.match(detail.textContent,/Invalid input.*parse/);
});

test('locally injected adapter sites do not link to nonexistent upstream source',async()=>{
  const a=await app(),value=payload(active);
  value.rows=[{match_id:'200',fixed:true,status:'parse_error',reason:'Invalid input',engine_error:{schema:2,kind:'invalid_input',phase:'parse',location:{repository_path:'crates/tools/genie-oracle/src/progress.rs',line:47},context:[]}}];
  a.resolve('active',value);await settle();
  const detail=a.$('rows').children[0].children[7];
  assert.match(detail.textContent,/Benchmark adapter at/);
  const all=node=>[node,...(node.children||[]).flatMap(all)];
  assert.ok(!all(detail).some(n=>n.tag==='a'));
});

test('handler-presence mode explicitly includes partial handlers and gap filters stay distinct',async()=>{
  const a=await app(manifest(),{coverage:{active:coverage(active)}});
  a.$('command-standard').value='presence';a.$('command-standard').onchange({currentTarget:a.$('command-standard')});
  assert.equal(a.$('command-types-percent').textContent,'50.0%');
  assert.equal(a.$('command-occurrences-percent').textContent,'80.0%');
  assert.match(a.$('command-definition').textContent,/execution can still fail/);
  a.$('command-filter').value='unsupported';a.$('command-filter').onchange();
  assert.equal(a.$('command-rows').children.length,1);
  assert.match(a.$('command-rows').children[0].textContent,/Build farm/);
});

test('late census response cannot overwrite the selected snapshot',async()=>{
  const a=await app(manifest(),{deferCoverage:true});
  await a.choose('baseline');a.resolveCoverage('baseline',coverage(baseline));await settle();
  a.resolveCoverage('active',coverage(active));await settle();
  assert.equal(a.$('command-download').href,'coverage/baseline.json');
  assert.equal(a.$('run-select').value,'baseline');
});

test('missing or mismatched census never impersonates another benchmark run',async()=>{
  const absent=await app();
  assert.equal(absent.$('command-coverage-content').hidden,true);
  assert.match(absent.$('command-coverage-state').textContent,/not available/);
  const wrong=await app(manifest(),{coverage:{active:coverage(baseline)}});
  assert.equal(wrong.$('command-coverage-content').hidden,true);
  assert.match(wrong.$('command-coverage-state').textContent,/different benchmark snapshot/);
});

function replayChanges(r){
  const stop=(label,status='unsupported')=>({label,status,reasons:status==='complete'?[]:['Missing '+label],checks:[]});
  const entry=(id,kind,oldTicks,newTicks,oldCp,newCp,fixed=true)=>({match_id:id,sha256:'a'.repeat(64),fixed,kind,
    ticks_delta:newTicks-oldTicks,checkpoints_delta:newCp-oldCp,stop_changed:true,diagnostics_changed:false,
    new_eof:kind==='advanced',lost_eof:kind==='regressed',fields_changed:['completed_ticks','checkpoints_passed'],
    before:{match_id:id,completed_ticks:oldTicks,checkpoints_passed:oldCp,total_checkpoints:4,stop:stop('Research')},
    after:{match_id:id,completed_ticks:newTicks,checkpoints_passed:newCp,total_checkpoints:4,stop:stop(kind==='advanced'?'Reached EOF':'Movement',kind==='advanced'?'complete':'unsupported')}});
  const summary={total_recordings:r.fixed.total,compared_recordings:2,changed_recordings:2,unchanged_recordings:0,
    unpaired_recordings:1,pending_recordings:5601,advanced:1,regressed:1,mixed:0,changed:0,measurement:0,new_eof:1,lost_eof:1};
  return {schema:1,available:true,run:{id:r.id,sha:r.sha},baseline:{id:'previous',sha:'f'.repeat(40),finished:'2026-10-19T12:00:00Z'},warnings:[],
    fixed:summary,growing:{...summary,compared_recordings:3,changed_recordings:3,mixed:1},
    rows:[entry('1','advanced',100,1000,0,2),entry('2','regressed',900,100,2,0),entry('3','mixed',500,600,1,0,false)]};
}

test('replay comparison shows signed ticks, checkpoint deltas and both stopping reasons',async()=>{
  const a=await app(manifest(),{changes:{active:replayChanges(active)}});
  assert.equal(a.$('changes-content').hidden,false);
  assert.equal(a.$('changes-total').textContent,'2');assert.equal(a.$('changes-advanced').textContent,'1');
  assert.equal(a.$('changes-regressed').textContent,'1');
  const rows=a.$('changes-rows').children;
  assert.equal(rows.length,2);assert.match(rows[0].children[2].textContent,/100 → 1,000\+900/);
  assert.match(rows[0].children[3].textContent,/0 → 2\+2/);
  assert.match(rows[0].children[4].textContent,/Research/);assert.match(rows[0].children[5].textContent,/Reached EOF/);
  assert.match(rows[1].children[2].textContent,/-800/);
  assert.match(a.$('changes-scope').textContent,/1 measured recordings without a unique previous hash match/);
  a.$('growing').onclick();assert.equal(a.$('changes-total').textContent,'3');assert.equal(a.$('changes-rows').children.length,3);
});

test('comparison filters, sorting and unknown numeric deltas are preserved honestly',async()=>{
  const value=replayChanges(active);value.rows[1].ticks_delta=null;value.rows[1].before.completed_ticks=null;
  const a=await app(manifest(),{changes:{active:value}});
  a.$('changes-filter').value='regressed';a.$('changes-filter').oninput();
  assert.equal(a.$('changes-rows').children.length,1);assert.match(a.$('changes-rows').textContent,/— → 100/);
  assert.doesNotMatch(a.$('changes-rows').textContent,/-800/);
  a.$('changes-filter').value='new-eof';a.$('changes-filter').oninput();
  assert.match(a.$('changes-rows').children[0].textContent,/New EOF/);
  a.$('changes-search').value='no-such-match';a.$('changes-search').oninput();
  assert.equal(a.$('changes-rows').children.length,0);assert.match(a.$('changes-row-count').textContent,/no changes for this selection/);
});

test('late replay comparison responses cannot overwrite another selected snapshot',async()=>{
  const a=await app(manifest(),{deferChanges:true});await a.choose('baseline');
  a.resolveChanges('baseline',{schema:1,available:false,run:{id:baseline.id,sha:baseline.sha},baseline:null,rows:[],reason:'No earlier completed revision.'});await settle();
  a.resolveChanges('active',replayChanges(active));await settle();
  assert.equal(a.$('changes-content').hidden,true);assert.match(a.$('changes-state').textContent,/No earlier/);
});

test('comparison caches completed snapshots and rejects wrong run identities',async()=>{
  const a=await app(manifest(),{changes:{active:replayChanges(active),baseline:replayChanges(baseline)}});
  await a.choose('baseline');await a.choose('active');await a.choose('baseline');
  assert.equal(a.changesCalls.filter(c=>c.id==='baseline').length,1);
  const wrong=await app(manifest(),{changes:{active:replayChanges(baseline)}});
  assert.match(wrong.$('changes-state').textContent,/different benchmark snapshot/);
  assert.equal(wrong.$('changes-content').hidden,true);
});

test('actual full-size reports render, including a historical baseline when retained',{skip:!process.env.REAL_REPORT_DIRECTORY},async()=>{
  const directory=process.env.REAL_REPORT_DIRECTORY;
  const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  const current=m.runs.find(r=>!r.pilot&&r.status!=='continued'&&r.fixed.finished>=30);
  assert.ok(current,'a retained snapshot with recording results');
  const scope=current.growing.total>1000||!current.combined1000?'fixed':'combined1000';
  const allScope=current.growing.total>1000||!current.combined1000?'growing':'combined1000';
  const scoped=row=>scope==='fixed'?row.fixed:row.cohorts?.includes(scope);
  const historical=m.runs.find(r=>r.imported);
  const available={};
  for(const r of m.runs){const file=path.join(directory,'coverage',r.id+'.json');if(fs.existsSync(file))available[r.id]=fileJSON(file);}
  const changes={};
  for(const r of m.runs){const file=path.join(directory,'changes',r.id+'.json');if(fs.existsSync(file))changes[r.id]=fileJSON(file);}
  const a=await app(m,{coverage:available,changes});
  const firstVisibleID=()=>{const cell=a.$('rows').children[0].children[0];return cell.children[0]?.title||cell.textContent;};
  if(a.$('run-select').value!==current.id)await a.choose(current.id);
  a.$(scope).onclick();
  a.resolve(current.id,fileJSON(path.join(directory,'data',current.id+'.json')));await until(()=>a.$('rows').children.length===30||!a.$('error').hidden);
  assert.equal(a.$('measured').textContent,current[scope].finished.toLocaleString('en-US'));
  if(changes[current.id]?.available){
    assert.equal(a.$('changes-content').hidden,false);
    assert.equal(a.$('changes-total').textContent,changes[current.id][scope].changed_recordings.toLocaleString('en-US'));
  }
  assert.equal(a.$('error').hidden,true);assert.equal(a.$('rows').children.length,30);
  if(current[scope].timing){
    const precise=fileJSON(path.join(directory,'data',current.id+'.json'));
    const timers=precise.rows.filter(r=>scoped(r)&&typeof r.runtime_seconds==='number'&&Number.isFinite(r.runtime_seconds)&&r.runtime_seconds>=0).sort((a,b)=>b.runtime_seconds-a.runtime_seconds||a.match_id.localeCompare(b.match_id));
    a.$('sort').value='time-desc';a.$('sort').oninput();
    if(timers.length)assert.equal(firstVisibleID(),timers[0].match_id);
    assert.notEqual(a.$('replay-mean').textContent,'—');
    assert.notEqual(a.$('run-duration').textContent,'—');
    const speeds=precise.rows.filter(r=>scoped(r)&&Number.isFinite(r.completed_ticks)&&r.completed_ticks>=0&&Number.isFinite(r.runtime_seconds)&&r.runtime_seconds>0);
    for(const [sort,direction] of [['tps-asc',1],['tps-desc',-1]]){
      speeds.sort((a,b)=>direction*(a.completed_ticks/a.runtime_seconds-b.completed_ticks/b.runtime_seconds)||a.match_id.localeCompare(b.match_id));
      a.$('sort').value=sort;a.$('sort').oninput();
      if(speeds.length)assert.equal(firstVisibleID(),speeds[0].match_id);
    }
  }
  const mismatchLabel=count=>count.toLocaleString('en-US')+' recording'+(count===1?'':'s');
  assert.equal(a.$('checkpoint-count').textContent,mismatchLabel(current[scope].counts.checkpoint_mismatch));
  a.$(allScope).onclick();
  assert.equal(a.$('checkpoint-count').textContent,mismatchLabel(current[allScope].counts.checkpoint_mismatch));
  if(available[current.id]){
    await until(()=>a.$('command-coverage-content').hidden===false);
    assert.equal(a.$('command-coverage-content').hidden,false);
    assert.match(a.$('command-occurrences-count').textContent,new RegExp(available[current.id][allScope].command_occurrences.toLocaleString('en-US')));
    assert.equal(a.$('command-rows').children.length,12);
  }
  a.$('fixed').onclick();
  if(!historical)return; // Older runs can be absent from the rolling export.
  await a.choose(historical.id);
  a.$('fixed').onclick();
  assert.equal(a.$('measured').textContent,'5,604');assert.equal(a.$('checked').textContent,'9');
  a.resolve(historical.id,fileJSON(path.join(directory,'data',historical.id+'.json')));await until(()=>a.$('rows').children.length===30||!a.$('error').hidden);
  assert.equal(a.$('error').hidden,true);assert.equal(a.$('rows').children.length,30);
  assert.match(a.$('row-count').textContent,/5,604/);
});

function replayTiming(extra={}){
  const distribution=(n,mean,median)=>({sample_count:n,mean_seconds:mean,median_seconds:median});
  return {sample_count:3,missing_count:1,mean_seconds:34,median_seconds:2,
    measured:distribution(2,1.25,1.25),retained:distribution(1,100,100),historical:distribution(0,null,null),...extra};
}
test('run wall time and replay averages appear before the large recording download',async()=>{
  const r=structuredClone(active);r.timing={wall_seconds:3662.24};r.fixed.timing=replayTiming();
  r.growing.timing=replayTiming({measured:{sample_count:4,mean_seconds:12.24,median_seconds:2.36}});
  const a=await app(manifest([r,baseline]));
  assert.equal(a.$('run-duration').textContent,'1h 1m 2.2s');
  assert.equal(a.$('replay-mean').textContent,'1.3s');assert.equal(a.$('replay-median').textContent,'1.3s');
  assert.match(a.$('timing-note').textContent,/1 retained timings are excluded/);
  assert.match(a.$('timing-note').textContent,/1 measured recordings have no timer/);
  a.resolve('active',payload(r));await settle();a.$('growing').onclick();
  assert.equal(a.$('replay-mean').textContent,'12.2s');assert.equal(a.$('replay-median').textContent,'2.4s');
  assert.match(a.$('replay-mean-sub').textContent,/4 timed in this run/);
});
test('furthest progress uses ticks reached as its second sort key',async()=>{
  const a=await app();const value=payload(active);
  value.rows=[
    {match_id:'a-short',fixed:true,status:'complete',completed_ticks:100,total_ticks:100},
    {match_id:'z-long',fixed:true,status:'complete',completed_ticks:10000,total_ticks:10000},
    {match_id:'m-long',fixed:true,status:'complete',completed_ticks:10000,total_ticks:10000},
    {match_id:'almost',fixed:true,status:'unsupported',completed_ticks:19999,total_ticks:20000},
    {match_id:'half',fixed:true,status:'unsupported',completed_ticks:50000,total_ticks:100000}
  ];
  a.resolve('active',value);await settle();
  const ids=()=>a.$('rows').children.map(row=>row.children[0].textContent);
  assert.deepEqual(ids(),['m-long','z-long','a-short','almost','half']);
  a.$('sort').value='progress-asc';a.$('sort').oninput();
  assert.deepEqual(ids(),['half','almost','a-short','m-long','z-long']);
});
test('ticks reached sorting ignores percentage and keeps missing counters last',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
  assert.match(html,/<option value="ticks-desc">Most ticks reached first<\/option>/);
  const a=await app();const value=payload(active);
  value.rows=[
    {match_id:'short',fixed:true,status:'complete',completed_ticks:100,total_ticks:100},
    {match_id:'long',fixed:true,status:'unsupported',completed_ticks:3000,total_ticks:6000},
    {match_id:'tied',fixed:true,status:'unsupported',completed_ticks:3000,total_ticks:9000},
    {match_id:'medium',fixed:true,status:'complete',completed_ticks:200,total_ticks:200},
    {match_id:'growing',fixed:false,status:'unsupported',completed_ticks:10000,total_ticks:100000},
    {match_id:'missing',fixed:true,status:'parse_error'},
    {match_id:'zero',fixed:true,status:'initialization_unsupported',completed_ticks:0,total_ticks:100}
  ];
  a.resolve('active',value);await settle();a.$('sort').value='ticks-desc';a.$('sort').oninput();
  const ids=()=>a.$('rows').children.map(row=>row.children[0].textContent);
  assert.deepEqual(ids(),['long','tied','medium','short','zero','missing']);
  a.$('growing').onclick();assert.equal(ids()[0],'growing');
  a.$('status-filter').value='unsupported';a.$('status-filter').oninput();
  assert.deepEqual(ids(),['growing','long','tied']);
});
test('recording elapsed time is one decimal and slowest sorting keeps unknown timers last',async()=>{
  const a=await app();const value=payload(active);
  value.rows=[
    {match_id:'missing',fixed:true,status:'parse_error'},
    {match_id:'fast',fixed:true,status:'unsupported',runtime_seconds:0},
    {match_id:'slow',fixed:true,status:'checkpoint_mismatch',runtime_seconds:12.24},
    {match_id:'cached',fixed:true,status:'complete',runtime_seconds:2.34,runtime_source:'retained'},
    {match_id:'growing',fixed:false,status:'complete',runtime_seconds:99.95},
    {match_id:'invalid',fixed:true,status:'parse_error',runtime_seconds:-1}
  ];
  a.resolve('active',value);await settle();a.$('sort').value='time-desc';a.$('sort').oninput();
  const ids=()=>a.$('rows').children.map(row=>row.children[0].textContent);
  assert.deepEqual(ids(),['slow','cached','fast','invalid','missing']);
  assert.equal(a.$('rows').children[0].children[5].textContent,'12.2s');
  assert.equal(a.$('rows').children[1].children[5].textContent,'2.3sRetained');
  assert.equal(a.$('rows').children[2].children[5].textContent,'0.0s');
  assert.equal(a.$('rows').children[3].children[5].textContent,'—');
  a.$('sort').value='time-asc';a.$('sort').oninput();assert.deepEqual(ids(),['fast','cached','slow','invalid','missing']);
  a.$('sort').value='time-desc';a.$('sort').oninput();a.$('growing').onclick();
  assert.equal(ids()[0],'growing');a.$('status-filter').value='complete_unchecked';a.$('status-filter').oninput();
  assert.deepEqual(ids(),['growing','cached']);
});
test('average simulation TPS sorts numerically in both directions with unavailable speeds last',async()=>{
  const a=await app();const value=payload(active);
  value.rows=[
    {match_id:'missing-time',fixed:true,status:'unsupported',completed_ticks:10},
    {match_id:'missing-ticks',fixed:true,status:'parse_error',runtime_seconds:1},
    {match_id:'zero-time',fixed:true,status:'unsupported',completed_ticks:10,runtime_seconds:0},
    {match_id:'fast',fixed:true,status:'complete',completed_ticks:1000,runtime_seconds:.8,runtime_source:'retained'},
    {match_id:'slow',fixed:true,status:'timeout',completed_ticks:10,runtime_seconds:100},
    {match_id:'zero-progress',fixed:true,status:'initialization_unsupported',completed_ticks:0,runtime_seconds:2},
    {match_id:'growing',fixed:false,status:'complete',completed_ticks:2000,runtime_seconds:1},
    // Both display as 1.234; sorting must retain the unrounded numeric values.
    {match_id:'a-higher',fixed:true,status:'unsupported',completed_ticks:1,runtime_seconds:1/1.23442},
    {match_id:'z-lower',fixed:true,status:'unsupported',completed_ticks:1,runtime_seconds:1/1.23441}
  ];
  a.resolve('active',value);await settle();
  const ids=()=>a.$('rows').children.map(row=>row.children[0].textContent);
  a.$('sort').value='tps-asc';a.$('sort').oninput();
  assert.deepEqual(ids(),['zero-progress','slow','z-lower','a-higher','fast','missing-ticks','missing-time','zero-time']);
  const speeds=()=>a.$('rows').children.map(row=>row.children[6].textContent);
  assert.deepEqual(speeds(),['0','0.1','1.234','1.234','1,250','—','—','—']);
  assert.match(a.$('rows').children[4].children[6].title,/Completed simulation ticks divided by recorded wall time/);
  a.$('sort').value='tps-desc';a.$('sort').oninput();
  assert.deepEqual(ids(),['fast','a-higher','z-lower','slow','zero-progress','missing-ticks','missing-time','zero-time']);
  a.$('growing').onclick();assert.equal(ids()[0],'growing');
  a.$('status-filter').value='timeout';a.$('status-filter').oninput();assert.deepEqual(ids(),['slow']);
});
test('average simulation TPS rejects invalid measurements and preserves very slow nonzero speeds',async()=>{
  const a=await app();const speed=vm.runInContext('averageTPS',a.context);
  for(const runtime_seconds of [undefined,null,0,-1,NaN,Infinity,'10',true])
    assert.equal(speed({completed_ticks:10,runtime_seconds}),null);
  for(const completed_ticks of [undefined,null,-1,NaN,Infinity,'10',true])
    assert.equal(speed({completed_ticks,runtime_seconds:10}),null);
  assert.equal(speed({completed_ticks:1,runtime_seconds:Number.MIN_VALUE}),null);
  const value=payload(active);value.rows=[{match_id:'slow',fixed:true,status:'timeout',completed_ticks:1,runtime_seconds:300}];
  a.resolve('active',value);await settle();
  assert.equal(a.$('rows').children[0].children[6].textContent,'0.003333');
});
test('fully cached and historical snapshots label retained timing instead of claiming new work',async()=>{
  const r=structuredClone(active);r.status='complete';r.finished='2026-10-19T19:00:00Z';
  r.timing={wall_seconds:60};r.fixed.timing=replayTiming({measured:{sample_count:0},sample_count:3});
  const a=await app(manifest([r,baseline]));a.resolve('active',payload(r));await settle();
  assert.equal(a.$('replay-mean').textContent,'34.0s');assert.match(a.$('replay-mean-sub').textContent,/retained timings/);
  assert.match(a.$('timing-note').textContent,/No fresh timed measurements yet/);
  assert.match(a.$('run-duration-sub').textContent,/Creation to finish/);
  await a.choose('baseline');assert.equal(a.$('replay-mean').textContent,'—');assert.equal(a.$('run-duration').textContent,'—');
  a.resolve('baseline',payload(baseline));await settle();assert.equal(a.$('replay-median').textContent,'—');
});
test('runtime formatting rejects invalid values and carries rounded seconds into minutes',async()=>{
  const a=await app();
  const replayTime=vm.runInContext('replayTime',a.context);
  for(const value of [undefined,null,-1,NaN,Infinity,'12.2',true])assert.equal(replayTime(value),'—');
  assert.equal(replayTime(12.24),'12.2s');assert.equal(replayTime(0),'0.0s');
  assert.equal(a.context.runDuration(59.98),'1m 0.0s');assert.equal(a.context.runDuration(3599.98),'1h 0m 0.0s');
});

function published(runs,created){const value=manifest(runs,created);value.publication={schema:1,created,id:created};return value;}
function versionFile(kind,r,value){const text=JSON.stringify(value);return {url:kind+'/'+r.id+'.json',sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};}

function frozenFixture(){
  const sized=(total,checked=0)=>({...summary(total,checked),total});
  const r=run('frozen',3,1,{fixed:sized(1),growing:sized(3,1),core500:sized(2),extension500:sized(1,1),combined1000:sized(3,1),
    workflow:{kind:'baseline',full_corpus_requested:false,daily_sweeps:[]},
    scheduling:{stages:[{id:'core500',total:2,finished:2},{id:'extension500',total:1,finished:1}]}});
  const m=manifest([r]);m.cohorts={core500:{count:2},extension500:{count:1},combined1000:{count:3}};
  m.workflow={daily_time:'04:00',timezone:'Europe/Berlin'};
  const value=payload(r);value.rows=[
    {match_id:'200',fixed:false,cohorts:['core500','combined1000'],status:'unsupported',completed_ticks:20,total_ticks:100},
    {match_id:'201',fixed:true,cohorts:['core500','combined1000'],status:'unsupported',completed_ticks:10,total_ticks:100},
    {match_id:'202',fixed:false,cohorts:['extension500','combined1000'],status:'complete',completed_ticks:100,total_ticks:100,checkpoints_passed:1}];
  return {r,m,value};
}
test('frozen core is the default and each bucket filters independently of legacy fixed flags',async()=>{
  const {m,value}=frozenFixture(),a=await app(m);
  assert.equal(a.$('measured').textContent,'2');
  assert.equal(a.$('core500').hidden,false);
  assert.match(a.$('scheduling-note').textContent,/Core: 2 \/ 2.*Additional: 1 \/ 1/);
  assert.doesNotMatch(a.$('scheduling-note').textContent,/04:00|daily/i);
  a.resolve('frozen',value);await settle();
  assert.match(a.$('row-count').textContent,/2 matching recordings/);
  a.$('extension500').onclick();assert.equal(a.$('measured').textContent,'1');
  assert.equal(a.$('rows').children[0].children[0].textContent,'202');
  a.$('combined1000').onclick();assert.equal(a.$('measured').textContent,'3');
  assert.match(a.$('row-count').textContent,/3 matching recordings/);
  assert.equal(a.$('fixed').hidden,true);assert.equal(a.$('growing').hidden,true);
});
test('hash-pinned details reject inconsistent cohort membership',async()=>{
  const {r,m,value}=frozenFixture();value.rows[0].cohorts=[];
  r.files={details:versionFile('data',r,value)};m.runs=[r];
  const a=await app(m);a.resolve('frozen',value);await until(()=>!a.$('error').hidden);
  assert.match(a.$('error').textContent,/do not match/);
  assert.equal(a.$('rows').children.length,0);
});
test('aborted runs label unmeasured cases without implying they are queued',async()=>{
  const r=run('aborted',20,0,{status:'aborted',finished:'2026-10-19T19:00:00Z'});
  const a=await app(manifest([r]));
  assert.equal(a.$('run-state').textContent,'● Aborted');
  assert.match(a.$('outcome-note').textContent,/unmeasured/);
});
async function until(predicate){const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end,'async state reached before timeout');await new Promise(resolve=>setTimeout(resolve,5));}}

test('an older cached manifest cannot revert newer progress or replace the displayed rows',async()=>{
  const old=run('active',3000,5),fresh=run('active',4200,9);
  const a=await app(published([old,baseline],'2026-10-20T14:00:00Z'));
  a.resolve('active',payload(old));await settle();
  a.setManifest(published([fresh,baseline],'2026-10-20T14:05:00Z'));const newer=a.refresh();await settle();
  const current=payload(fresh);current.rows[0].match_id='new-evidence';a.resolve('active',current);await newer;
  assert.equal(a.$('measured').textContent,'4,200');
  const calls=a.calls.length;
  a.setManifest(published([old,baseline],'2026-10-20T14:00:00Z'));const stale=a.refresh();await settle();
  assert.equal(a.$('measured').textContent,'4,200');assert.equal(a.$('checked').textContent,'9');
  assert.match(a.$('rows').textContent,/new-evidence/);assert.equal(a.calls.length,calls);
  assert.match(a.$('refresh-note').textContent,/older cached update was ignored/);
  await stale;
  a.setManifest(published([fresh,baseline],'2026-10-20T14:06:00Z'));const next=a.refresh();await settle();
  if(a.calls.length>calls)a.resolve('active',current);await next;
  assert.equal(a.$('refresh-note').hidden,true);
});
test('same-run progress cannot shrink even if an older body has a newer envelope timestamp',async()=>{
  const a=await app(published([active,baseline],'2026-10-20T14:05:00Z'));
  a.resolve('active',payload(active));await settle();
  a.setManifest(published([run('active',100,1),baseline],'2026-10-20T14:10:00Z'));const stale=a.refresh();await settle();
  assert.equal(a.$('measured').textContent,'4,000');assert.equal(a.$('checked').textContent,'7');
  await stale;
});
test('publication freshness keeps a new engine snapshot from disappearing but permits genuine new-run resets',async()=>{
  const newer=run('newer',10,0,{sha:'d'.repeat(40),created:'2026-10-20T14:00:00Z'});
  const a=await app(published([active,baseline],'2026-10-20T14:05:00Z'));a.resolve('active',payload(active));await settle();
  a.setManifest(published([newer,active,baseline],'2026-10-20T14:10:00Z'));const pending=a.refresh();await settle();
  assert.equal(a.$('run-select').value,'newer');assert.equal(a.$('measured').textContent,'10');
  a.resolve('newer',payload(newer));await pending;
  a.setManifest(published([active,baseline],'2026-10-20T14:05:00Z'));const stale=a.refresh();await settle();
  assert.equal(a.$('run-select').value,'newer');assert.equal(a.$('measured').textContent,'10');
  await stale;
});
test('manual historical selection is preserved while stale refreshes are ignored',async()=>{
  const a=await app(published([active,baseline],'2026-10-20T14:05:00Z'));a.resolve('active',payload(active));await settle();
  await a.choose('baseline');a.resolve('baseline',payload(baseline));await settle();
  a.setManifest(published([run('active',2000,1),baseline],'2026-10-20T14:00:00Z'));const stale=a.refresh();await settle();
  assert.equal(a.$('run-select').value,'baseline');assert.equal(a.$('measured').textContent,'5,604');
  assert.equal(a.$('refresh-note').hidden,false);await stale;
});
test('session reload retains the freshest accepted manifest instead of trusting an older cache',async()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)};
  const fresh=published([active,baseline],'2026-10-20T14:05:00Z');
  const a=await app(fresh,{storage});a.resolve('active',payload(active));await settle();
  const b=await app(published([run('active',100,1),baseline],'2026-10-20T14:00:00Z'),{storage});
  assert.equal(b.$('measured').textContent,'4,000');assert.equal(b.$('refresh-note').hidden,false);
});
test('same-ID report from an older publication is rejected instead of being cached as current',async()=>{
  const a=await app();a.resolve('active',payload(active));await settle();
  const next=run('active',4500,9);a.setManifest(manifest([next,baseline],'2026-10-20T14:10:00Z'));const pending=a.refresh();await settle();
  a.resolve('active',payload(run('active',2000,2)));await pending;
  assert.equal(a.$('measured').textContent,'4,500');
  assert.match(a.$('error').textContent,/do not match the selected report version/);
  assert.equal(a.$('rows').children.length,1,'last good rows are kept');
});
test('hash-pinned report retries mixed cache bytes before accepting the advertised publication',async()=>{
  const r=run('active',1,1),one=payload(r);one.rows[0].checkpoints_passed=1;
  r.files={details:versionFile('data',r,one)};
  const a=await app(published([r,baseline],'2026-10-20T14:05:00Z'));
  a.resolve('active',one);await until(()=>a.$('rows').children.length===1);
  const next=structuredClone(r),two=payload(next);two.rows[0].checkpoints_passed=2;two.rows[0].total_checkpoints=2;
  next.files.details=versionFile('data',next,two);
  a.setManifest(published([next,baseline],'2026-10-20T14:10:00Z'));const pending=a.refresh();await settle();
  a.resolve('active',one);await until(()=>a.calls.length===3);
  assert.match(a.calls[2].url,/retry=/);assert.equal(a.$('rows').children[0].children[4].textContent,'1 / 1');
  a.resolve('active',two);await until(()=>a.$('rows').children[0].children[4].textContent==='2 / 2');
  await pending;
  assert.equal(a.$('error').hidden,true);
});
test('repeated mismatched hashes preserve good results and never poison the cache',async()=>{
  const r=run('active',1,1),one=payload(r);r.files={details:versionFile('data',r,one)};
  const a=await app(published([r,baseline],'2026-10-20T14:05:00Z'));a.resolve('active',one);await until(()=>a.$('rows').children.length===1);
  const next=structuredClone(r),two=payload(next);two.rows[0].checkpoints_passed=9;next.files.details=versionFile('data',next,two);
  a.setManifest(published([next,baseline],'2026-10-20T14:10:00Z'));const pending=a.refresh();await settle();
  a.resolve('active',one);await until(()=>a.calls.length===3);a.resolve('active',one);
  await until(()=>!a.$('error').hidden);
  assert.match(a.$('error').textContent,/different report version/);
  assert.equal(a.$('rows').children[0].children[4].textContent,'1 / 1');
  await pending;
  const retry=a.refresh();await settle();assert.equal(a.calls.length,4,'failed verification is not stored as the requested version');
  a.resolve('active',two);await until(()=>a.$('rows').children[0].children[4].textContent==='9 / 1');
  await retry;
});
test('temporary census 404 keeps the last verified coverage visible',async()=>{
  const options={coverage:{active:coverage(active)}};
  const a=await app(manifest(),options);a.resolve('active',payload(active));await settle();
  assert.equal(a.$('command-coverage-content').hidden,false);
  delete options.coverage.active;
  a.setManifest(manifest(undefined,'2026-10-20T14:10:00Z'));const pending=a.refresh();await settle();a.resolve('active',payload(active));await pending;
  assert.equal(a.$('command-coverage-content').hidden,false);
  assert.match(a.$('command-coverage-state').textContent,/keeping the last verified census/);
});

test('theme button names the next action and persists the selected theme',async()=>{
  const saved=[];
  const a=await app(manifest(),{themeStorage:{setItem:(...args)=>saved.push(args)}});
  assert.equal(a.$('theme-toggle').textContent,'Light theme');
  a.$('theme-toggle').onclick();
  assert.equal(a.document.documentElement.dataset.theme,'light');
  assert.equal(a.$('theme-toggle').textContent,'Dark theme');
  assert.equal(a.$('theme-toggle')['aria-pressed'],undefined);
  a.$('theme-toggle').onclick();
  assert.equal(a.document.documentElement.dataset.theme,'dark');
  assert.deepEqual(saved,[['genie-theme','light'],['genie-theme','dark']]);
  const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
  assert.doesNotMatch(html.match(/<button id="theme-toggle"[^>]*>/)[0],/aria-pressed/);
});

test('theme selection still works when browser storage is blocked',async()=>{
  const a=await app(manifest(),{theme:'light',themeStorage:{setItem(){throw new Error('blocked');}}});
  assert.equal(a.$('theme-toggle').textContent,'Dark theme');
  assert.doesNotThrow(()=>a.$('theme-toggle').onclick());
  assert.equal(a.document.documentElement.dataset.theme,'dark');
  assert.equal(a.$('theme-toggle').textContent,'Light theme');
});

test('initial theme follows saved choice, then system preference, before paint',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
  const source=html.match(/<script>(.*?)<\/script>/s)[1];
  assert.ok(html.indexOf('<script>')<html.indexOf('rel="stylesheet"'));
  for(const [saved,system,expected] of [['dark',true,'dark'],['light',false,'light'],[null,true,'light'],[null,false,'dark'],['invalid',true,'light']]){
    const document={documentElement:{dataset:{}}};
    vm.runInNewContext(source,{document,localStorage:{getItem:()=>saved},matchMedia:()=>({matches:system})});
    assert.equal(document.documentElement.dataset.theme,expected);
  }
});

test('charts use available phone width and redraw at desktop width after resize',async()=>{
  const r=structuredClone(active);
  r.fixed.ticks_histogram=Array.from({length:50},(_,i)=>({label:'bucket '+i,counts:{unsupported:1}}));
  const a=await app(manifest([r,baseline]));a.resolve('active',payload(r));await settle();
  a.$('ticks-chart').clientWidth=324;a.$('percent-chart').clientWidth=324;
  a.events.resize();
  assert.equal(a.$('ticks-chart').children[0].viewBox,'0 0 324 235');
  assert.equal(a.$('percent-chart').children[0].viewBox,'0 0 324 280');
  const labels=()=>a.$('ticks-chart').children[0].children.filter(n=>n['class']==='histogram-label');
  const phoneLabels=labels().map(n=>n.textContent);
  assert.ok(phoneLabels.length>=2&&phoneLabels.length<12);
  assert.equal(phoneLabels[0],'bucket 0');assert.equal(phoneLabels.at(-1),'bucket 49');
  assert.equal(a.$('ticks-chart').children[0].children.filter(n=>n['class']==='histogram-bucket').length,50);
  a.$('ticks-chart').clientWidth=1184;a.events.resize();
  assert.equal(a.$('ticks-chart').children[0].viewBox,'0 0 1184 235');
  assert.ok(labels().length>phoneLabels.length);
});

test('pending light-theme swatches contrast with panel and outcome-bar background',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../site/style.css'),'utf8');
  const light=css.match(/\[data-theme="light"\]\{([^}]+)\}/)[1];
  const variable=name=>light.match(new RegExp('--'+name+':(#[0-9a-f]{6})(?:;|$)'))[1];
  const luminance=hex=>{
    const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  };
  for(const background of ['panel','line']){
    const [a,b]=[luminance(variable('outcome-pending')),luminance(variable(background))].sort((a,b)=>b-a);
    assert.ok((a+.05)/(b+.05)>=3,'pending must contrast with '+background);
  }
});

function trendRun(id,index=0,extra={}){
  const scoped=(total,hash,checked,ticks)=>({...summary(total,checked),total,finished:total,median_ticks:ticks,membership_sha256:hash.repeat(64)});
  const r=run(id,404,1,{sha:(index+1).toString(16).padStart(40,'0'),status:'complete',build_profile:'release',
    created:new Date(Date.UTC(2026,9,20,0,index)).toISOString(),finished:new Date(Date.UTC(2026,9,20,0,index,30)).toISOString(),
    fixed:{...summary(404,1),total:404},growing:{...summary(1000,2),total:1000},
    core500:scoped(500,'c',index+1,100+index),extension500:scoped(500,'d',index+10,500+index),combined1000:scoped(1000,'e',index+11,300+index),
    comparison:{comparable:404,improved:99999,regressed:88888,previous_sha:'f'.repeat(40)},...extra});
  r.changes={available:true,baseline_sha:'f'.repeat(40),warnings:[],summary:Object.fromEntries(['core500','extension500','combined1000'].map((scope,i)=>[scope,{
    total_recordings:r[scope].total,membership_sha256:r[scope].membership_sha256,compared_recordings:r[scope].total,
    advanced:index+i+2,regressed:1,unpaired_recordings:0}]))};
  return r;
}
function trendManifest(runs){return {...manifest(runs),cohorts:{core500:{count:500,membership_sha256:'c'.repeat(64)},extension500:{count:500,membership_sha256:'d'.repeat(64)},combined1000:{count:1000,membership_sha256:'e'.repeat(64)}}};}
function trendApp(m,options={}){return app(m,{trendPage:true,search:'?cohort=core500',...options});}

test('trend follows each frozen cohort using scoped outcomes, medians and comparisons',async()=>{
  const old=trendRun('old'),latest=trendRun('latest',1);
  const a=await trendApp(trendManifest([latest,old]));
  assert.equal(a.$('trend-title').textContent,'Core 500 across engine commits');
  let row=a.$('trend-rows').children[0];
  assert.match(row.children[2].textContent,/\+3 \/ −1.*500 \/ 500 matched/);
  assert.equal(row.children[3].textContent,'2');assert.equal(row.children[7].textContent,'101');
  a.$('extension500').onclick();row=a.$('trend-rows').children[0];
  assert.equal(a.$('trend-title').textContent,'Additional 500 across engine commits');
  assert.match(row.children[2].textContent,/\+4 \/ −1/);
  assert.equal(row.children[3].textContent,'11');assert.equal(row.children[7].textContent,'501');
  a.$('combined1000').onclick();row=a.$('trend-rows').children[0];
  assert.equal(a.$('trend-title').textContent,'Combined 1,000 across engine commits');
  assert.match(row.children[2].textContent,/\+5 \/ −1.*1,000 \/ 1,000 matched/);
  assert.equal(row.children[3].textContent,'12');assert.equal(row.children[7].textContent,'301');
  assert.doesNotMatch(a.$('trend-rows').textContent,/99,999|88,888/);
});

test('trend excludes changed membership, partial cohorts, pilots and legacy-only runs',async()=>{
  const old=trendRun('old'),latest=trendRun('latest',1),wrong=trendRun('wrong',2),partial=trendRun('partial',3),pilot=trendRun('pilot',4,{pilot:true});
  wrong.core500.membership_sha256='f'.repeat(64);partial.core500.finished=499;
  const legacy=run('legacy',5604,3,{status:'complete',sha:'9'.repeat(40)});
  const a=await trendApp(trendManifest([latest,old,wrong,partial,pilot,legacy]));
  // Membership comes from the manifest's frozen definition, independent of an engine selection.
  assert.deepEqual(Array.from(a.context.trendRuns(),r=>r.id),['old','latest']);
});

test('unfinished retries do not hide completed releases and trend clicks keep them selectable',async()=>{
  const old=trendRun('old'),complete=trendRun('release',1),retry=trendRun('retry',2,{sha:complete.sha,status:'running'}),profiling=trendRun('profiling',1,{sha:complete.sha,build_profile:'forced'});
  const a=await trendApp(trendManifest([retry,complete,profiling,old]));
  assert.deepEqual(Array.from(a.context.trendRuns(),r=>r.id),['old','release']);
  const link=a.$('trend-rows').children[0].children[0].children[0];
  assert.equal(link.href,'index.html?run=release&cohort=core500');
  a.context.openSnapshot('release');assert.equal(a.context.location.href,link.href);
  const selected=await app(trendManifest([retry,complete,profiling,old]),{search:'?run=release&cohort=core500'});
  assert.equal(selected.$('run-select').value,'release');
  assert.ok(selected.$('run-select').options.some(o=>o.value==='release'));
  selected.resolve('release',payload(complete));await settle();await selected.refresh();
  assert.equal(selected.$('run-select').value,'release');
});

test('failed retries preserve completed candidates and release preference',async()=>{
  const old=trendRun('old'),complete=trendRun('release',1),failed=trendRun('failed',2,{sha:complete.sha,status:'build_failed'}),profiling=trendRun('profiling',1,{sha:complete.sha,build_profile:'forced'});
  const a=await trendApp(trendManifest([failed,complete,profiling,old]));
  assert.deepEqual(Array.from(a.context.trendRuns(),r=>r.id),['old','release']);
});

test('main page links to cohort trends without embedding engine-independent history',async()=>{
  const old=trendRun('old'),latest=trendRun('latest',1);
  const a=await app(trendManifest([latest,old]));
  assert.equal(a.$('trend-rows').children.length,0);
  assert.equal(a.$('trend-link').href,'trends.html?cohort=core500');
  a.$('extension500').onclick();assert.equal(a.$('trend-link').href,'trends.html?cohort=extension500');
  a.$('combined1000').onclick();assert.equal(a.$('trend-link').href,'trends.html?cohort=combined1000');
  const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
  assert.doesNotMatch(html,/<section id="trend"/);
  const trends=fs.readFileSync(path.join(__dirname,'../site/trends.html'),'utf8');
  assert.doesNotMatch(trends,/id="run-select"/);
});

test('missing scoped comparison stays unavailable rather than using legacy counts',async()=>{
  const old=trendRun('old'),latest=trendRun('latest',1);delete latest.changes.summary;
  const a=await trendApp(trendManifest([latest,old]));
  assert.equal(a.$('trend-rows').children[0].children[2].textContent,'—');
  assert.equal(a.changesCalls.length,0);assert.equal(a.coverageCalls.length,0);assert.equal(a.calls.length,0,'the trend page needs only the manifest');
});

test('missing median is a gap while a genuine zero median remains a plotted point',async()=>{
  const old=trendRun('zero'),latest=trendRun('missing',1);old.core500.median_ticks=0;latest.core500.median_ticks=null;
  const a=await trendApp(trendManifest([latest,old]));
  const svg=a.$('trend-ticks').children[0],groups=svg.children.filter(n=>n['class']?.startsWith('trend-column'));
  assert.equal(groups[0].children.filter(n=>n.tag==='circle').length,1);
  assert.equal(groups[1].children.filter(n=>n.tag==='circle').length,0);
  assert.equal(a.$('trend-rows').children[0].children[7].textContent,'—');
});

test('all eligible measurements remain displayed without new aggregation or paging',async()=>{
  const runs=Array.from({length:60},(_,i)=>trendRun('run-'+i,i));
  const a=await trendApp(trendManifest(runs));
  assert.equal(a.context.trendRuns().length,60);assert.equal(a.$('trend-rows').children.length,60);
  assert.equal(a.$('trend-outcomes').children[0].children.filter(n=>n['class']?.startsWith('trend-column')).length,60);
});

test('standalone history defaults to the full frozen baseline without loading an engine snapshot',async()=>{
  const a=await trendApp(trendManifest([trendRun('old'),trendRun('latest',1)]),{search:''});
  assert.equal(a.$('trend-title').textContent,'Combined 1,000 across engine commits');
  assert.equal(a.calls.length,0);assert.equal(a.coverageCalls.length,0);assert.equal(a.changesCalls.length,0);
});

test('trend date labels are grouped and spaced while every engine remains available on focus',async()=>{
  const runs=Array.from({length:120},(_,i)=>trendRun('run-'+i,i,{finished:new Date(Date.UTC(2026,9,20+Math.floor(i/24),12)).toISOString()}));
  const a=await trendApp(trendManifest(runs));
  a.$('trend-outcomes').clientWidth=324;a.events.resize();
  const labels=a.context.trendDateLabels(runs,48,(324-48-14)/runs.length);
  assert.ok(labels.length>=2&&labels.length<=5);
  for(let i=1;i<labels.length;i++)assert.ok(labels[i].x-labels[i-1].x>=58);
  assert.equal(labels[0].label,'20.10');assert.equal(labels.at(-1).label,'24.10');
  const svg=a.$('trend-outcomes').children[0],groups=svg.children.filter(n=>n['class']?.startsWith('trend-column'));
  assert.equal(groups.length,120);assert.ok(groups[0]['aria-label'].includes(runs[0].sha));
  const years=a.context.trendDateLabels([{finished:'2026-12-31T12:00:00Z'},{finished:'2027-01-01T12:00:00Z'}],48,100);
  assert.deepEqual(Array.from(years,x=>x.label),['31.12.26','01.01.27']);
});

test('trend gains and losses have separate colours and outcome columns partition the cohort',async()=>{
  const old=trendRun('old'),latest=trendRun('latest',1);
  latest.core500.counts={complete_checked:5,unsupported:300,checkpoint_mismatch:170,complete_unchecked:2,parse_error:10,multiple_chapters:7,timeout:6};
  const a=await trendApp(trendManifest([latest,old])),cells=a.$('trend-rows').children[0].children;
  assert.equal(cells[2].children[0].className,'positive');assert.equal(cells[2].children[2].className,'negative');
  assert.deepEqual(cells.slice(3,7).map(n=>n.textContent),['5','300','170','25']);
  assert.match(cells[6].title,/Parse error: 10/);assert.match(cells[6].title,/Multiple chapters: 7/);
  const html=fs.readFileSync(path.join(__dirname,'../site/trends.html'),'utf8');
  assert.doesNotMatch(html,/<th>Unsupported initialization/);
  assert.match(html,/<th>Unsupported update<\/th><th>Checkpoint mismatch<\/th>/);
});

test('one-off large corpus shows reference and full tabs, stage progress, limits and no restart',async()=>{
  const full=run('full',5604,8,{workflow:{kind:'one_off_full',measurement_policy:{replay_seconds:300,step_seconds:10,maximum_workers:16,timeout_retries:0}},execution:{stage:'corpus_tail',active_sessions:12},scheduling:{stages:[{id:'reference5604',finished:5604,total:5604},{id:'corpus_tail',finished:44,total:8183}]}});
  full.growing={...full.growing,total:13787,finished:5648};
  const a=await app(manifest([full]),{search:'?run=full&cohort=growing'});
  assert.equal(a.$('fixed').hidden,false);assert.equal(a.$('growing').hidden,false);
  assert.equal(a.$('measured').textContent,'5,648');
  assert.match(a.$('run-state').textContent,/One-off corpus.*Remaining corpus.*12 active/);
  assert.match(a.$('scheduling-note').textContent,/Reference: 5,604 \/ 5,604.*Remaining corpus: 44 \/ 8,183/);
  assert.match(a.$('scheduling-note').textContent,/300s per replay, 10s per update, up to 16 workers.*No timeout retries.*stays disabled/);
  a.$('fixed').onclick();assert.equal(a.$('measured').textContent,'5,604');
  assert.equal(a.$('reference-count').textContent,'5,604');
  assert.equal(a.$('catalog-count').textContent,'13,787');
});

test('baseline and one-off on the same engine remain separately selectable',async()=>{
  const {r,m}=frozenFixture();
  const full=run('same-engine-full',5604,8,{sha:r.sha,created:'2026-10-26T06:00:00Z',workflow:{kind:'one_off_full',measurement_policy:{replay_seconds:300,step_seconds:10,maximum_workers:16}}});
  full.growing={...full.growing,total:13787};m.runs.push(full);
  const a=await app(m);
  assert.deepEqual(a.$('run-select').options.map(o=>o.value),['same-engine-full','frozen']);
  assert.equal(a.$('fixed')['aria-pressed'],true);
  await a.choose('frozen');
  assert.equal(a.$('fixed').hidden,true);assert.equal(a.$('core500')['aria-pressed'],true);
});

test('plain HTTP checksum fallback matches native SHA-256 across binary block boundaries',async()=>{
  const a=await app(manifest(),{noNativeCrypto:true});
  for(const length of [0,3,55,56,63,64,65,1000,65537]){
    const bytes=Uint8Array.from({length},(_,i)=>(i*197+83)&255);
    assert.equal(await a.context.reportSHA256(bytes.buffer),createHash('sha256').update(bytes).digest('hex'));
  }
  const unicode=new TextEncoder().encode('Recording ✓ / 中文 / 🦀');
  assert.equal(await a.context.reportSHA256(unicode.buffer),createHash('sha256').update(unicode).digest('hex'));
});

test('plain HTTP verifies pinned reports and rejects mismatched bytes before accepting a retry',async()=>{
  const r=run('active',1,1),good=payload(r);r.files={details:versionFile('data',r,good)};
  const a=await app(published([r,baseline],'2026-10-20T14:05:00Z'),{noNativeCrypto:true});
  const wrong=structuredClone(good);wrong.rows[0].checkpoints_passed=9;
  a.resolve('active',wrong);await until(()=>a.calls.length===2);
  assert.equal(a.$('rows').children.length,0);
  a.resolve('active',good);await until(()=>a.$('rows').children.length===1);
  assert.equal(a.$('error').hidden,true);
  assert.equal(a.$('rows').children[0].children[4].textContent,'1 / 1');
});

test('unavailable hashing still fails closed instead of displaying unverified reports',async()=>{
  const r=run('active',1,1),good=payload(r);r.files={details:versionFile('data',r,good)};
  const a=await app(published([r,baseline],'2026-10-20T14:05:00Z'),{noNativeCrypto:true});
  a.context.sha256=undefined;
  a.resolve('active',good);await until(()=>!a.$('error').hidden);
  assert.match(a.$('error').textContent,/cannot verify report versions/);
  assert.equal(a.$('rows').children.length,0);
});

test('automatic single-pass baseline shows direct limits without one-off stop messaging',async()=>{
  const {r,m}=frozenFixture();
  r.workflow.measurement_policy={mode:'single_pass',replay_seconds:300,step_seconds:10,maximum_workers:16,timeout_retries:0};
  m.runs=[r];
  const a=await app(m);
  assert.match(a.$('scheduling-note').textContent,/Core: 2 \/ 2.*Additional: 1 \/ 1.*Single pass: 300s per replay, 10s per update, up to 16 workers.*No timeout retries/);
  assert.doesNotMatch(a.$('scheduling-note').textContent,/One-off|stays disabled/);
});

test('progress buckets default to five percent only above a ten percent median',async()=>{
  for(const [median,fine] of [[10,true],[10.0001,false],[0,true],[null,true],[NaN,true]]){
    const r=structuredClone(active);r.fixed.median_percent=median;
    r.fixed.histogram=[{label:'0–1%',counts:{unsupported:2}},{label:'5–6%',counts:{checkpoint_mismatch:3}},{label:'95–100%',counts:{complete_checked:1}}];
    const a=await app(manifest([r]));
    assert.equal(a.$('percent-fine-buckets').checked,fine,'median '+median);
    assert.equal(histogramGroups(a).length,fine?3:20);
    assert.match(a.$('percent-bucket-note').textContent,fine?/1% buckets through 10%/:/5% buckets throughout/);
  }
});

test('five percent buckets merge exact outcome counts and retain the final completion bucket',async()=>{
  const r=structuredClone(active);r.fixed.median_percent=15;
  r.fixed.histogram=[
    {label:'0–1%',counts:{unsupported:2,checkpoint_mismatch:1}},
    {label:'4–5%',counts:{unsupported:3}},
    {label:'5–6%',counts:{checkpoint_mismatch:4}},
    {label:'9–10%',counts:{unsupported:7}},
    {label:'10–15%',counts:{unsupported:11}},
    {label:'95–100%',counts:{complete_checked:2,complete_unchecked:1}}];
  r.fixed.ticks_histogram=[{label:'0–500',counts:{unsupported:23,checkpoint_mismatch:5}}];
  const before=JSON.stringify(r.fixed.histogram),a=await app(manifest([r]));
  const groups=histogramGroups(a);
  assert.equal(groups.length,20);assert.equal(groups[0]['data-bucket'],'0–5%');assert.equal(groups[1]['data-bucket'],'5–10%');assert.equal(groups[19]['data-bucket'],'95–100%');
  const counts=g=>Object.fromEntries(histogramBars(g).map(b=>[b['data-outcome'],b['data-count']]));
  assert.deepEqual(counts(groups[0]),{unsupported:5,checkpoint_mismatch:1});
  assert.deepEqual(counts(groups[1]),{unsupported:7,checkpoint_mismatch:4});
  assert.deepEqual(counts(groups[2]),{unsupported:11});
  assert.deepEqual(counts(groups[19]),{complete_unchecked:1,complete_checked:2});
  groups[0].onfocus();assert.match(a.$('percent-chart-readout').textContent,/0–5%.*Unsupported update: 5.*Checkpoint mismatch: 1.*Total: 6/);
  assert.equal(histogramGroups(a,'ticks-chart')[0]['data-bucket'],'0–500');
  assert.equal(JSON.stringify(r.fixed.histogram),before);
  a.$('percent-fine-buckets').checked=true;a.$('percent-fine-buckets').onchange({currentTarget:a.$('percent-fine-buckets')});
  assert.equal(histogramGroups(a).length,6);assert.equal(histogramGroups(a)[0]['data-bucket'],'0–1%');
  assert.equal(histogramGroups(a,'ticks-chart').length,1);
});

test('manual bucket choices survive live updates and stay specific to each snapshot and cohort',async()=>{
  const {r,m,value}=frozenFixture();r.core500.median_percent=15;r.extension500.median_percent=5;m.runs=[r];
  const a=await app(m);assert.equal(a.$('percent-fine-buckets').checked,false);
  a.resolve(r.id,{...value,run:r});await settle();
  a.$('percent-fine-buckets').checked=true;a.$('percent-fine-buckets').onchange({currentTarget:a.$('percent-fine-buckets')});
  a.$('extension500').onclick();assert.equal(a.$('percent-fine-buckets').checked,true);
  a.$('percent-fine-buckets').checked=false;a.$('percent-fine-buckets').onchange({currentTarget:a.$('percent-fine-buckets')});
  a.$('core500').onclick();assert.equal(a.$('percent-fine-buckets').checked,true);
  a.events.resize();assert.equal(a.$('percent-fine-buckets').checked,true);
  const newer=structuredClone(m);newer.generated='2026-10-20T20:00:00Z';newer.runs[0].core500.median_percent=25;
  a.setManifest(newer);const refreshing=a.refresh();await settle();a.resolve(r.id,{...value,run:newer.runs[0]});await refreshing;assert.equal(a.$('percent-fine-buckets').checked,true);
  a.$('extension500').onclick();assert.equal(a.$('percent-fine-buckets').checked,false);
  const other={...r,id:'another-snapshot',created:'2026-10-21T20:00:00Z'};other.extension500={...r.extension500,median_percent:5};
  newer.runs.push(other);newer.generated='2026-10-21T20:00:00Z';a.setManifest(newer);const switching=a.refresh();await settle();a.resolve(other.id,{...value,run:other});await switching;
  assert.equal(a.$('percent-fine-buckets').checked,true,'a new snapshot uses its own default');
});

test('unmodified default follows median updates and outcome filtering preserves the chosen grouping',async()=>{
  const r=structuredClone(active);r.fixed.median_percent=9;r.fixed.histogram=[{label:'0–1%',counts:{unsupported:3,checkpoint_mismatch:2}}];
  const a=await app(manifest([r]));assert.equal(a.$('percent-fine-buckets').checked,true);
  a.resolve(r.id,payload(r));await settle();
  const updated=structuredClone(r);updated.fixed.median_percent=11;
  a.setManifest(manifest([updated],'2026-10-20T20:00:00Z'));const refreshing=a.refresh();await settle();a.resolve(r.id,payload(updated));await refreshing;assert.equal(a.$('percent-fine-buckets').checked,false);
  a.$('chart-outcome').value='checkpoint_mismatch';a.$('chart-outcome').onchange({currentTarget:a.$('chart-outcome')});
  assert.equal(histogramGroups(a).length,20);
  assert.equal(histogramBars(histogramGroups(a)[0])[0]['data-count'],2);
  a.$('chart-scale').value='linear';a.$('chart-scale').onchange({currentTarget:a.$('chart-scale')});
  assert.equal(a.$('percent-fine-buckets').checked,false);
});

test('each histogram legend follows its own visible outcomes and the outcome selection',async()=>{
  const r=structuredClone(active);
  r.fixed.histogram=[{label:'0–1%',counts:{unsupported:3,checkpoint_mismatch:2,parse_error:0}}];
  r.fixed.ticks_histogram=[{label:'0–500',counts:{complete_checked:1,timeout:4}}];
  r.fixed.blockers=[{reason:'Unmodelled update',count:3}];
  const a=await app(manifest([r]));
  const entries=id=>a.$(id).children.map(n=>({label:n.textContent,fill:n.children[0].style.background}));
  assert.deepEqual(entries('percent-chart-legend'),[
    {label:'Unsupported update',fill:'var(--outcome-unsupported)'},
    {label:'Checkpoint mismatch',fill:'var(--outcome-checkpoint_mismatch)'}]);
  assert.deepEqual(entries('ticks-chart-legend'),[
    {label:'End reached · checkpoints match',fill:'var(--outcome-complete_checked)'},
    {label:'Time limit',fill:'var(--outcome-timeout)'}]);
  assert.equal(a.$('blockers-legend').textContent,'Unsupported update');
  a.$('chart-outcome').value='checkpoint_mismatch';a.$('chart-outcome').onchange({currentTarget:a.$('chart-outcome')});
  for(const id of ['percent-chart-legend','ticks-chart-legend'])assert.deepEqual(entries(id),[{label:'Checkpoint mismatch',fill:'var(--outcome-checkpoint_mismatch)'}]);
  a.$('chart-outcome').value='all';a.$('chart-outcome').onchange({currentTarget:a.$('chart-outcome')});
  assert.equal(entries('ticks-chart-legend').length,2);
});

test('trend legends distinguish outcome colors from the median line',async()=>{
  const a=await trendApp(trendManifest([trendRun('old'),trendRun('new',1)]));
  assert.match(a.$('trend-legend').textContent,/Unsupported update/);
  assert.match(a.$('trend-legend').textContent,/End reached · checkpoints match/);
  assert.equal(a.$('trend-ticks-legend').textContent,'Median simulation ticks reached');
  const swatch=a.$('trend-ticks-legend').children[0].children[0];
  assert.equal(swatch.style.background,'var(--link)');assert.equal(swatch.className,'legend-line');
});

test('engine-and-match URL opens the exact change without adding visible permalink controls',async()=>{
  const value=replayChanges(active);value.rows[1].fields_changed.push('first_failure_tick');
  const a=await app(manifest(),{search:'?engine='+active.sha.slice(0,12)+'&match=2',changes:{active:value}});
  assert.equal(a.$('run-select').value,active.id);
  assert.equal(a.$('changes-rows').children.length,1);
  const row=a.$('changes-rows').children[0];assert.equal(row['data-linked-change'],'true');
  assert.match(row.children[2].textContent,/900 → 100/);assert.match(row.textContent,/Regressed/);
  assert.equal(row.children[1].children.find(n=>n.tag==='details').open,true);
  assert.equal(row.children[4].children[0].open,true);assert.equal(row.children[5].children[0].open,true);
  assert.equal(a.$('changes-search').value,'2');assert.match(a.$('changes-row-count').textContent,/Linked recording 2/);
  assert.equal(row.children[0].children.filter(n=>n.tag==='a').length,1,'only the existing replay link is visible');
  a.$('changes-search').value='';a.$('changes-search').oninput();assert.equal(a.$('changes-rows').children.length,3);
});

test('match links resolve recording filenames and do not silently choose ambiguous matches',async()=>{
  for(const query of ['2.aoe2record','Match_2.aoe2record.gz']){
    const a=await app(manifest(),{search:'?run=active&match='+encodeURIComponent(query),changes:{active:replayChanges(active)}});
    assert.equal(a.$('changes-rows').children.length,1);assert.equal(a.$('changes-search').value,'2');
  }
  const a=await app(manifest(),{search:'?run=active&match=Match_1_2.aoe2record',changes:{active:replayChanges(active)}});
  assert.equal(a.$('changes-rows').children.length,0);assert.match(a.$('changes-row-count').textContent,/multiple recordings/);
});

test('missing snapshot or ambiguous engine prefix never substitutes another engine',async()=>{
  const missing=await app(manifest(),{search:'?engine=0123456789ab&match=2'});
  assert.match(missing.$('error').textContent,/No retained engine snapshot/);assert.equal(missing.calls.length,0);
  const b={...baseline,sha:active.sha.slice(0,8)+'f'.repeat(32)};
  const ambiguous=await app(manifest([active,b]),{search:'?engine='+active.sha.slice(0,8)+'&match=2'});
  assert.match(ambiguous.$('error').textContent,/ambiguous/);assert.equal(ambiguous.calls.length,0);
  const wrong=await app(manifest(),{search:'?run=active&engine=01234567&match=2'});
  assert.match(wrong.$('error').textContent,/do not match/);assert.equal(wrong.calls.length,0);
});

test('exact run links keep that attempt while engine links prefer its completed measurement',async()=>{
  const complete={...active,id:'completed',status:'complete',build_profile:'release',finished:'2026-10-20T00:00:00Z'};
  const retry={...active,id:'retry',created:'2026-10-21T00:00:00Z'};
  const m=manifest([retry,complete]);
  const engine=await app(m,{search:'?engine='+active.sha.slice(0,8)+'&match=2',changes:{completed:replayChanges(complete)}});
  assert.equal(engine.$('run-select').value,'completed');assert.equal(engine.$('changes-rows').children.length,1);
  const exact=await app(m,{search:'?run=retry&match=2',changes:{retry:replayChanges(retry)}});
  assert.equal(exact.$('run-select').value,'retry');
});

test('missing linked changes report their absence and late responses preserve the target',async()=>{
  const a=await app(manifest(),{search:'?run=active&match=2',deferChanges:true});
  assert.equal(a.$('changes-rows').children.length,0);assert.match(a.$('changes-state').textContent,/Loading/);
  a.resolveChanges('active',replayChanges(active));await settle();assert.equal(a.$('changes-search').value,'2');
  const missing=await app(manifest(),{search:'?run=active&match=99999',changes:{active:replayChanges(active)}});
  assert.equal(missing.$('changes-rows').children.length,0);assert.match(missing.$('changes-row-count').textContent,/No compared change found/);
});

test('linked changes default to the combined cohort and respect an explicitly narrower cohort',async()=>{
  const r=trendRun('cohort-run');delete r.changes;const value=replayChanges(r);value.growing.total_recordings=r.growing.total;
  for(const scope of ['core500','extension500','combined1000'])value[scope]={...value.fixed};
  value.rows[0].cohorts=['core500','combined1000'];value.rows[1].cohorts=['extension500','combined1000'];value.rows[2].cohorts=['core500','combined1000'];
  const m=trendManifest([r]);
  const a=await app(m,{search:'?engine='+r.sha+'&match=2',changes:{[r.id]:value}});
  assert.equal(a.$('combined1000')['aria-pressed'],true);assert.equal(a.$('changes-rows').children.length,1);
  const core=await app(m,{search:'?engine='+r.sha+'&cohort=core500&match=2',changes:{[r.id]:value}});
  assert.equal(core.$('changes-rows').children.length,0);assert.match(core.$('changes-row-count').textContent,/outside this cohort/);
});
