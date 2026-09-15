import {DEFAULTS,MAX_YEARS,RATE_MIN,RATE_MAX,clamp,makeRates,simulate} from './model.mjs';
const $=id=>document.getElementById(id);
const money=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=n=>money.format(n);
const pct=n=>n===null?'—':`${Math.abs(n)<.0000001?'0.00':n.toFixed(2)}%`;
const short=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1,notation:n>=1000000?'compact':'standard'}).format(n);
const state={...DEFAULTS};
let rates=makeRates(state), selectedYear=1, result, chartFrame=0, dragState=null, rateGeometry=null;
let customRateHistory=[], contributionPlan={followHorizon:true,years:state.contributionYears};
const labels={alternate:'好坏年份交替',fixed:'每年固定收益',periodic:'每 5 年回调',early:'前两年回调',late:'最后两年回调',custom:'自定义收益路径'};
const notes={alternate:'第 1 年为好年份，随后与低收益年份交替。',fixed:'所有年份均采用“好年份收益”。',periodic:'第 5、10、15…年回调，其余采用好年份收益。',early:'最初两年采用回调收益，其余采用好年份收益。',late:'观察期的最后两年回调，其余采用好年份收益。',custom:'已逐年编辑。切换预设会重新生成整条收益路径。'};
const colors={dynamic:'#1556d5',fixed:'#c58922',invested:'#c16f99'};
function fillSlider(slider){const range=+slider.max-+slider.min;slider.style.setProperty('--fill',`${range?(+slider.value-+slider.min)/range*100:0}%`);}
function syncControls(){
  for(const key of ['principal','annual','years','contributionYears','good','low','downturn','baseline']){
    const number=$(key), slider=$(`${key}-slider`);
    if(key==='principal'||key==='annual') slider.max=Math.max(key==='principal'?200:100,state[key]);
    if(key==='contributionYears') number.max=slider.max=state.years;
    if(document.activeElement!==number)number.value=state[key];
    slider.value=state[key];fillSlider(slider);
  }
  $('timing').value=state.timing;$('preset').value=state.preset;
  $('preset-note').textContent=notes[state.preset];
  $('scenario-badge').textContent=labels[state.preset];
  $('chart-years-slider').value=state.years;fillSlider($('chart-years-slider'));
  $('chart-years-slider').setAttribute('aria-valuetext',`${state.years} 年`);
  $('chart-years-value').textContent=`${state.years} 年`;
}
function setNumber(key,value){
  if(!Number.isFinite(value))return;
  const min=key==='years'?1:['good','low','downturn','baseline'].includes(key)?RATE_MIN:0;
  const max=key==='years'?MAX_YEARS:key==='contributionYears'?state.years:['principal','annual'].includes(key)?100000:RATE_MAX;
  state[key]=clamp(['years','contributionYears'].includes(key)?Math.round(value):value,min,max);
  if(key==='contributionYears')contributionPlan={followHorizon:state.contributionYears===state.years,years:state.contributionYears};
  if(key==='years'){
    state.contributionYears=contributionPlan.followHorizon?state.years:Math.min(contributionPlan.years,state.years);
    selectedYear=Math.min(selectedYear,state.years);
    if(state.preset==='custom')rates=Array.from({length:state.years},(_,i)=>customRateHistory[i]??state.good);
    else rates=makeRates(state);
  }
  if(['good','low','downturn'].includes(key)&&state.preset!=='custom')rates=makeRates(state);
  update();
}
$('chart-years-slider').addEventListener('input',event=>setNumber('years',Number(event.target.value)));
$('chart-years-slider').addEventListener('change',()=>{$('announcement').textContent=`投资 ${state.years} 年，期末资产 ${fmt(result.assets)} 万美元，累计盈利 ${fmt(result.profit)} 万美元。`;});
for(const key of ['principal','annual','years','contributionYears','good','low','downturn','baseline']){
  $(key).addEventListener('input',event=>{if(event.target.value!=='')setNumber(key,Number(event.target.value));});
  $(key).addEventListener('blur',()=>{$(key).value=state[key];});
  $(`${key}-slider`).addEventListener('input',event=>{setNumber(key,Number(event.target.value));$(key).value=state[key];});
}
$('timing').addEventListener('change',event=>{state.timing=event.target.value;update();});
$('preset').addEventListener('change',event=>{state.preset=event.target.value;if(state.preset!=='custom')rates=makeRates(state);customRateHistory=rates.slice();update();});
$('reset').addEventListener('click',()=>{if(document.body.dataset.view!=='compound')return;Object.assign(state,DEFAULTS);rates=makeRates(state);customRateHistory=[];contributionPlan={followHorizon:true,years:state.contributionYears};selectedYear=1;update();$('announcement').textContent='已恢复 20 万美元本金、每年 10 万美元、10 年的默认情景。';});
function gridTicks(max,count=4){if(max<=0)return [0,1,2,3,4];const rough=max/count;const unit=10**Math.floor(Math.log10(rough));const fraction=rough/unit;const step=([1,2,2.5,5,10].find(x=>x>=fraction)||10)*unit;const ceiling=Math.ceil(max/step)*step;return Array.from({length:Math.round(ceiling/step)+1},(_,i)=>i*step);}
function linePath(rows,key,x,y){return rows.map((r,i)=>`${i?'L':'M'}${x(r.year).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' ');}
function renderGrowth(){
  const host=$('growth-chart'),width=Math.max(280,host.clientWidth),height=width<500?300:345;
  const margin={left:width<500?44:60,right:18,top:38,bottom:40};
  const right=width-margin.right,bottom=height-margin.bottom;
  const ticks=gridTicks(Math.max(...result.rows.flatMap(r=>[r.assets,r.fixed,r.invested]))*1.12);
  const max=ticks.at(-1),x=n=>margin.left+n/state.years*(right-margin.left),y=n=>bottom-n/max*(bottom-margin.top);
  const every=Math.max(1,Math.ceil(state.years/(width<500?4:8)));
  const years=[...new Set([0,...Array.from({length:state.years},(_,i)=>i+1).filter(n=>n%every===0),state.years])];
  const dynamic=linePath(result.rows,'assets',x,y);
  const endLabels=[{key:'dynamic',value:result.assets},{key:'fixed',value:result.fixed},{key:'invested',value:result.invested}].sort((a,b)=>y(a.value)-y(b.value));
  for(let i=0;i<endLabels.length;i++)endLabels[i].labelY=Math.max(margin.top+10,y(endLabels[i].value)-11,i?endLabels[i-1].labelY+19:0);
  const overflow=Math.max(0,endLabels.at(-1).labelY-(bottom-7));endLabels.forEach(label=>{label.labelY-=overflow;});
  host.innerHTML=`<svg width="${width}" height="${height}" role="img" aria-label="动态资产、固定收益对照和累计本金的 ${state.years} 年曲线"><defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1556d5" stop-opacity=".12"/><stop offset="100%" stop-color="#1556d5" stop-opacity=".01"/></linearGradient></defs><text x="${margin.left}" y="19" class="chart-axis">金额（万美元）</text>${ticks.map(v=>`<line x1="${margin.left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${margin.left-9}" y="${y(v)+4}" text-anchor="end" class="chart-axis">${short(v)}</text>`).join('')}<path d="${dynamic} L${right},${bottom} L${margin.left},${bottom} Z" fill="url(#area-fill)"/><path d="${linePath(result.rows,'fixed',x,y)}" fill="none" stroke="${colors.fixed}" stroke-width="2.2" stroke-dasharray="7 5"/><path d="${linePath(result.rows,'invested',x,y)}" fill="none" stroke="${colors.invested}" stroke-width="2.2" stroke-dasharray="2 5"/><path d="${dynamic}" fill="none" stroke="${colors.dynamic}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${years.map(v=>`<text x="${x(v)}" y="${bottom+22}" text-anchor="middle" class="chart-axis">${v}</text>`).join('')}<text x="${right}" y="${height-1}" text-anchor="end" class="chart-axis">投资年数</text><line id="growth-crosshair" x1="0" x2="0" y1="${margin.top}" y2="${bottom}" class="hover-crosshair" visibility="hidden"/><g id="growth-endpoints">${[['fixed',result.fixed],['invested',result.invested],['dynamic',result.assets]].map(([key,val])=>`<circle cx="${right}" cy="${y(val)}" r="4" fill="${colors[key]}"/>`).join('')}</g><rect id="growth-hover" x="${margin.left}" y="${margin.top}" width="${right-margin.left}" height="${bottom-margin.top}" fill="transparent"/></svg><div id="growth-tooltip" class="chart-tooltip" hidden></div>`;
  const tip=$('growth-tooltip'),cross=$('growth-crosshair');
  $('growth-hover').addEventListener('pointermove',event=>{
    const rect=host.getBoundingClientRect();const px=event.clientX-rect.left,py=event.clientY-rect.top;
    const year=clamp(Math.round((px-margin.left)/(right-margin.left)*state.years),0,state.years),row=result.rows[year];
    tip.innerHTML=`<strong>${year===0?'起点':`第 ${year} 年末`}</strong>${year?`<div>当年收益 ${pct(row.rate)}</div>`:''}<div class="tooltip-line"><span>动态资产</span><span>${fmt(row.assets)}</span></div><div class="tooltip-line"><span>固定对照</span><span>${fmt(row.fixed)}</span></div><div class="tooltip-line"><span>累计投入</span><span>${fmt(row.invested)}</span></div>`;
    tip.hidden=false;tip.style.left=`${Math.max(0,Math.min(width-tip.offsetWidth,px+15))}px`;tip.style.top=`${Math.max(0,Math.min(height-tip.offsetHeight,py-35))}px`;
    cross.setAttribute('x1',x(year));cross.setAttribute('x2',x(year));cross.setAttribute('visibility','visible');
  });
  $('growth-hover').addEventListener('pointerleave',()=>{tip.hidden=true;cross.setAttribute('visibility','hidden');});
  const svg=host.querySelector('svg'),ns='http://www.w3.org/2000/svg';
  for(const label of endLabels){
    const text=document.createElementNS(ns,'text');text.setAttribute('x',right-9);text.setAttribute('y',label.labelY);text.setAttribute('text-anchor','end');text.setAttribute('class','chart-end-label');text.setAttribute('fill',colors[label.key]);text.setAttribute('pointer-events','none');text.textContent=fmt(label.value);svg.append(text);
  }
}
function renderTable(){
  $('year-table').innerHTML=result.rows.map(row=>`<tr><td>${row.year===0?'起点':`第 ${row.year} 年`}</td><td class="${row.rate<0?'negative':''}">${pct(row.rate)}</td><td>${fmt(row.year?row.contribution:state.principal)}</td><td class="${row.gain<0?'negative':''}">${fmt(row.gain)}</td><td>${fmt(row.invested)}</td><td>${fmt(row.assets)}</td><td>${fmt(row.fixed)}</td></tr>`).join('');
}
function update(){
  result=simulate(state,rates);syncControls();
  $('total').textContent=fmt(result.assets);$('invested').textContent=fmt(result.invested);$('profit').textContent=fmt(result.profit);$('profit').classList.toggle('negative',result.profit<0);$('roi').textContent=pct(result.roi);$('cagr').textContent=pct(result.cagr);$('irr').textContent=pct(result.irr);
  $('horizon-badge').textContent=`${state.years} 年`;$('growth-caption').textContent=`${state.timing==='end'?'每年年底投入':'每年年初投入'} · 连续投入 ${state.contributionYears} 年`;$('baseline-legend').textContent=`固定 ${state.baseline}% 对照`;
  $('horizon-readout').innerHTML=`第 ${state.years} 年末 · 总资产 <strong>${fmt(result.assets)} 万美元</strong> · 累计盈利 <strong class="${result.profit<0?'negative':''}">${fmt(result.profit)} 万美元</strong>`;
  const difference=result.assets-result.fixed;
  $('comparison').innerHTML=`固定 ${state.baseline}% 情景的期末资产为 <strong>${fmt(result.fixed)} 万美元</strong>，当前路径${Math.abs(difference)<.005?'与其相同':`${difference>0?'多':'少'} <strong>${fmt(Math.abs(difference))} 万美元</strong>`}。`;
  renderGrowth();renderTable();renderEditor();
}
function renderEditor(){
  if($('selected-year').options.length!==state.years)$('selected-year').innerHTML=Array.from({length:state.years},(_,i)=>`<option value="${i+1}">第 ${i+1} 年</option>`).join('');
  $('selected-year').value=selectedYear;
  if(document.activeElement!==$('selected-rate'))$('selected-rate').value=rates[selectedYear-1];
  $('selected-rate-slider').value=rates[selectedYear-1];fillSlider($('selected-rate-slider'));
  renderRateChart();
}
function setSelectedRate(value){if(!Number.isFinite(value))return;if(state.preset!=='custom')customRateHistory=rates.slice();rates[selectedYear-1]=Math.round(clamp(value,RATE_MIN,RATE_MAX)*10)/10;customRateHistory[selectedYear-1]=rates[selectedYear-1];state.preset='custom';update();}
function renderRateChart(){
  const host=$('rate-chart'),width=Math.max(280,host.clientWidth),height=234;
  const margin={left:48,right:18,top:30,bottom:32},right=width-margin.right,bottom=height-margin.bottom;
  const domain=dragState?.domain??[Math.max(-100,Math.min(-50,Math.floor(Math.min(...rates)/25)*25)),Math.min(100,Math.max(50,Math.ceil(Math.max(...rates)/25)*25))];
  const x=year=>state.years===1?(margin.left+right)/2:margin.left+(year-1)/(state.years-1)*(right-margin.left);
  const y=rate=>margin.top+(domain[1]-rate)/(domain[1]-domain[0])*(bottom-margin.top);
  rateGeometry={width,height,margin,right,bottom,domain,x,y};
  if(host.dataset.width!==String(width)||host.dataset.years!==String(state.years)){
    host.dataset.width=width;host.dataset.years=state.years;
    host.innerHTML=`<svg width="${width}" height="${height}" aria-label="逐年收益率编辑器：拖动圆点，或用方向键调整收益率"><g id="rate-grid"></g><line id="rate-selection" stroke="#bed0ef" stroke-dasharray="3 4"/><path id="rate-path" fill="none" stroke="${colors.dynamic}" stroke-width="2" stroke-linejoin="round"/><g id="rate-points">${rates.map((r,i)=>`<g class="rate-point" data-year="${i+1}" role="slider" tabindex="0" aria-label="第 ${i+1} 年收益率" aria-valuemin="-100" aria-valuemax="100" aria-orientation="vertical"><circle class="point-hit" r="16" fill="transparent"/><circle class="point-halo" r="10" fill="white"/><circle class="point-dot" r="5"/><title>第 ${i+1} 年：上下拖动修改收益率</title></g>`).join('')}</g><text id="rate-value-label" class="chart-end-label"></text></svg>`;
    host.querySelectorAll('.rate-point').forEach(point=>{
      point.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        event.preventDefault();selectedYear=Number(point.dataset.year);point.focus({preventScroll:true});
        dragState={pointerId:event.pointerId,domain:[...rateGeometry.domain]};
        point.setPointerCapture(event.pointerId);renderEditor();
      });
      point.addEventListener('pointermove',event=>{
        if(!dragState||event.pointerId!==dragState.pointerId)return;
        event.preventDefault();
        const svg=host.querySelector('svg'),rect=svg.getBoundingClientRect(),position=(event.clientY-rect.top)*height/rect.height;
        const {domain,margin,bottom}=rateGeometry;
        setSelectedRate(domain[1]-(position-margin.top)/(bottom-margin.top)*(domain[1]-domain[0]));
      });
      const endDrag=event=>{
        if(!dragState||dragState.pointerId!==event.pointerId)return;
        dragState=null;
        if(point.hasPointerCapture(event.pointerId))point.releasePointerCapture(event.pointerId);
        renderEditor();$('announcement').textContent=`第 ${selectedYear} 年收益率 ${pct(rates[selectedYear-1])}，期末资产 ${fmt(result.assets)} 万美元。`;
      };
      point.addEventListener('pointerup',endDrag);point.addEventListener('pointercancel',endDrag);point.addEventListener('lostpointercapture',endDrag);
      point.addEventListener('focus',()=>{selectedYear=Number(point.dataset.year);renderEditor();});
      point.addEventListener('keydown',event=>{
        const key=event.key;
        if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(key))return;
        event.preventDefault();selectedYear=Number(point.dataset.year);
        if(key==='ArrowLeft'||key==='ArrowRight'){
          selectedYear=clamp(selectedYear+(key==='ArrowRight'?1:-1),1,state.years);renderEditor();
          host.querySelector(`[data-year="${selectedYear}"]`).focus({preventScroll:true});return;
        }
        const current=rates[selectedYear-1],step=event.shiftKey?5:.5;
        setSelectedRate(key==='Home'?RATE_MIN:key==='End'?RATE_MAX:current+(key==='ArrowUp'?step:-step));
      });
    });
  }
  const tickStep=(domain[1]-domain[0])>100?50:25;
  const ticks=[];for(let r=Math.ceil(domain[0]/tickStep)*tickStep;r<=domain[1];r+=tickStep)ticks.push(r);
  const every=Math.max(1,Math.ceil(state.years/(width<500?4:8)));
  const years=[...new Set([1,...Array.from({length:state.years},(_,i)=>i+1).filter(n=>n%every===0),state.years])];
  $('rate-grid').innerHTML=`<rect x="${margin.left}" y="${y(0)}" width="${right-margin.left}" height="${bottom-y(0)}" fill="#fff7f8"/>${ticks.map(r=>`<line x1="${margin.left}" x2="${right}" y1="${y(r)}" y2="${y(r)}" stroke="${r===0?'#aeb9cb':'#edf0f5'}"/><text x="${margin.left-9}" y="${y(r)+4}" text-anchor="end" class="chart-axis">${r}%</text>`).join('')}${years.map(year=>`<text x="${x(year)}" y="${bottom+23}" text-anchor="middle" class="chart-axis">${year}</text>`).join('')}<text x="${margin.left}" y="14" class="chart-axis">当年收益率</text><text x="${right}" y="14" text-anchor="end" class="chart-axis">第 ${selectedYear} 年 · ${rates[selectedYear-1].toFixed(1)}%</text>`;
  $('rate-path').setAttribute('d',rates.map((r,i)=>`${i?'L':'M'}${x(i+1)},${y(r)}`).join(' '));
  $('rate-selection').setAttribute('x1',x(selectedYear));$('rate-selection').setAttribute('x2',x(selectedYear));$('rate-selection').setAttribute('y1',margin.top);$('rate-selection').setAttribute('y2',bottom);
  host.querySelectorAll('.rate-point').forEach(point=>{
    const year=Number(point.dataset.year),rate=rates[year-1],active=year===selectedYear;
    point.setAttribute('transform',`translate(${x(year)},${y(rate)})`);
    point.setAttribute('aria-valuenow',rate);point.setAttribute('aria-valuetext',`${rate}%`);
    point.querySelector('.point-halo').setAttribute('fill',active?'white':'transparent');
    point.querySelector('.point-halo').setAttribute('stroke',active?colors.dynamic:'none');
    point.querySelector('.point-dot').setAttribute('r',active?6:state.years>30?3.5:4.5);
    point.querySelector('.point-dot').setAttribute('fill',rate<0?'#c84555':colors.dynamic);
  });
  const valueLabel=$('rate-value-label'),selectedRate=rates[selectedYear-1];
  valueLabel.setAttribute('x',x(selectedYear));valueLabel.setAttribute('y',Math.max(margin.top+12,y(selectedRate)-16));
  valueLabel.setAttribute('text-anchor',selectedYear===1?'start':selectedYear===state.years?'end':'middle');
  valueLabel.setAttribute('fill',selectedRate<0?'#c84555':colors.dynamic);valueLabel.textContent=`${selectedRate.toFixed(1)}%`;
}
$('selected-year').addEventListener('change',event=>{selectedYear=Number(event.target.value);renderEditor();});
$('selected-rate').addEventListener('input',event=>{if(event.target.value!=='')setSelectedRate(Number(event.target.value));});
$('selected-rate').addEventListener('blur',event=>{event.target.value=rates[selectedYear-1];});
$('selected-rate-slider').addEventListener('input',event=>setSelectedRate(Number(event.target.value)));
new ResizeObserver(()=>{cancelAnimationFrame(chartFrame);chartFrame=requestAnimationFrame(()=>{renderGrowth();renderEditor();});}).observe($('growth-chart'));
update();

function snapshot(){return {settings:{...state},yearlyReturns:[...rates],amountUnit:'万美元',endingAssets:result.assets,totalContributed:result.invested,profit:result.profit,cumulativeProfitPercent:result.roi,pathAnnualizedPercent:result.cagr,moneyWeightedAnnualizedPercent:result.irr,fixedComparisonAssets:result.fixed};}
function configureScenario(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请输入参数对象。');
  const known=[...Object.keys(DEFAULTS),'yearlyReturns'];
  if(Object.keys(input).some(key=>!known.includes(key)))throw new Error('包含不支持的参数。');
  const next={...state,...input};delete next.yearlyReturns;
  const bounds={principal:[0,100000],annual:[0,100000],years:[1,60],contributionYears:[0,60],good:[-100,100],low:[-100,100],downturn:[-100,100],baseline:[-100,100]};
  for(const [key,[min,max]] of Object.entries(bounds)){
    if(typeof next[key]!=='number'||!Number.isFinite(next[key])||next[key]<min||next[key]>max)throw new Error(`${key} 超出允许范围。`);
  }
  if(!Number.isInteger(next.years)||!Number.isInteger(next.contributionYears))throw new Error('年数必须为整数。');
  if(!['start','end'].includes(next.timing)||!Object.keys(labels).includes(next.preset))throw new Error('投入时间或收益情景无效。');
  if(input.years!==undefined&&input.contributionYears===undefined)next.contributionYears=contributionPlan.followHorizon?next.years:Math.min(contributionPlan.years,next.years);
  if(next.contributionYears>next.years)throw new Error('持续投入年数不能超过观察期限。');
  let nextRates;
  if(input.yearlyReturns!==undefined){
    if(!Array.isArray(input.yearlyReturns)||input.yearlyReturns.length!==next.years||input.yearlyReturns.some(r=>typeof r!=='number'||!Number.isFinite(r)||r<-100||r>100))throw new Error('逐年收益数组必须匹配观察年数，各值在 -100 至 100 之间。');
    nextRates=input.yearlyReturns.map(r=>Math.round(r*10)/10);next.preset='custom';
  }else if(next.preset==='custom')nextRates=Array.from({length:next.years},(_,i)=>(state.preset==='custom'?customRateHistory[i]:rates[i])??next.good);
  else nextRates=makeRates(next);
  if(input.contributionYears!==undefined)contributionPlan={followHorizon:next.contributionYears===next.years,years:next.contributionYears};
  if(input.yearlyReturns!==undefined||next.preset!=='custom'||state.preset!=='custom')customRateHistory=nextRates.slice();
  Object.assign(state,next);rates=nextRates;selectedYear=Math.min(selectedYear,state.years);update();return snapshot();
}
const context=document.modelContext;
if(context?.registerTool){
  const lifecycle=new AbortController();
  const tools=[{
    name:'get_compound_scenario',title:'读取复利测算',description:'读取当前投入参数、逐年收益率与测算结果。金额单位为万美元，收益率单位为百分比。',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('该工具不接受参数。');return snapshot();}
  },{
    name:'configure_compound_scenario',title:'调整复利测算',description:'批量设置本金、定投、观察期限或逐年收益率并立即更新曲线。仅修改当前页面的情景，不保存或执行投资。金额单位万美元，百分比 15 表示 15%。',
    inputSchema:{type:'object',additionalProperties:false,properties:{principal:{type:'number',minimum:0,maximum:100000},annual:{type:'number',minimum:0,maximum:100000},years:{type:'integer',minimum:1,maximum:60},contributionYears:{type:'integer',minimum:0,maximum:60},timing:{type:'string',enum:['start','end']},preset:{type:'string',enum:Object.keys(labels)},good:{type:'number',minimum:-100,maximum:100},low:{type:'number',minimum:-100,maximum:100},downturn:{type:'number',minimum:-100,maximum:100},baseline:{type:'number',minimum:-100,maximum:100},yearlyReturns:{type:'array',items:{type:'number',minimum:-100,maximum:100},minItems:1,maxItems:60}}},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:configureScenario
  }];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(error=>console.warn('WebMCP tool registration failed:',error));}catch(error){console.warn('WebMCP unavailable:',error);}}
  window.addEventListener('pagehide',event=>{if(!event.persisted)lifecycle.abort();},{once:true});
}
