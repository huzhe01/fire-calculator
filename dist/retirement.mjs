import {clamp} from './model.mjs';
import {RETIREMENT_DEFAULTS,RETIREMENT_BOUNDS,validateRetirement,retirementRates,simulateRetirement} from './retirement-model.mjs';
import {drawRetirementChart} from './retirement-chart.mjs';

const $=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const settings={...RETIREMENT_DEFAULTS};
let rateHistory=[],rates=retirementRates(settings),projection,view='dashboard',selectedYear=0,selectedRateYear=1,flowMode='annual',frame=0,rateDrag=null,rateGeometry;
const presets={alternate:'好年份、低收益年份交替',fixed:'每年固定收益',periodic:'每 5 年出现一次回调',early:'最初两年回调',late:'观察期最后两年回调',retirementCrash:'退休最初两年回调',custom:'自定义逐年收益'};
const meta={
  usdInitial:['美元账户本金','万美元',0,200,.5],usdAnnual:['美元每年新增','万美元',0,50,.5],
  cnyInitial:['人民币账户本金','万元',0,1000,5],cnyAnnual:['人民币每年新增','万元',0,100,1],
  years:['观察年数','年',1,60,1],retireAfter:['距离退休','年',0,60,1],
  monthlySpending:['月生活费 · 今天购买力','万元',0,10,.1],withdrawalRate:['退休起点支取率','%',0,10,.1],
  inflation:['生活费年通胀','%',0,10,.1],cnyReturn:['人民币账户年收益','%',-10,15,.1],
  usdGood:['美元好年份收益','%',0,30,.1],usdLow:['美元低收益年份','%',-10,15,.1],usdDownturn:['美元回调年份收益','%',-60,0,.5],
  fx:['初始汇率 · 1 美元兑换','元人民币',4,10,.01],fxDrift:['汇率每年变化','%',-10,10,.1],
  reserveMinYears:['储备低于多少年生活费触发','年',0,10,.25],reserveTargetYears:['补充到多少年生活费','年',0,15,.25],
  batchUSD:['每次最多转出','万美元',0,10,.1],annualTransferCapUSD:['每年最多转出','万美元',0,30,.5],
  fixedAnnualCNY:['每年计划补充人民币净额','万元',0,100,1],transferCost:['换汇与转账成本','%',0,5,.1]
};
function field(key,prefix='plan'){
  const [label,unit,min,max,step]=meta[key],[boundMin,boundMax]=RETIREMENT_BOUNDS[key],id=`${prefix}-${key}`;
  return `<div class="fire-field" data-field="${key}"><div class="fire-field-row"><label for="${id}">${label}</label><div class="fire-number"><input id="${id}" type="number" data-number="${key}" min="${boundMin}" max="${boundMax}" step="${step}" value="${settings[key]}"><span>${unit}</span></div></div><input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" aria-label="${label}滑块（${unit}）"></div>`;
}
function select(key,label,options){return `<div class="fire-select"><label for="fire-${key}">${label}</label><select id="fire-${key}" data-select="${key}">${Object.entries(options).map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></div>`;}
function balanceLegend(){return `<div class="legend"><span><i class="legend-line" style="border-color:#233966"></i>合计资产</span><span><i class="legend-line dynamic"></i>美元账户 · 折合人民币</span><span><i class="legend-line" style="border-color:#11816f"></i>人民币账户</span></div>`;}
function metrics(prefix){return `<div class="fire-metrics">
  <section class="metric metric-primary"><h2>合计资产 <span>万元人民币</span></h2><p class="metric-value" id="${prefix}-total">—</p><p class="metric-detail" id="${prefix}-real">—</p></section>
  <section class="metric"><h2>美元账户 <span>万美元</span></h2><p class="metric-value usd-value" id="${prefix}-usd">—</p><p class="metric-detail" id="${prefix}-usd-detail">—</p></section>
  <section class="metric"><h2>人民币账户 <span>万元</span></h2><p class="metric-value cny-value" id="${prefix}-cny">—</p><p class="metric-detail" id="${prefix}-cny-detail">—</p></section>
  <section class="metric"><h2>累计生活费支取 <span>万元</span></h2><p class="metric-value" id="${prefix}-paid">—</p><p class="metric-detail" id="${prefix}-paid-detail">—</p></section>
  </div>`;}
function status(id){return `<div class="fire-status" id="${id}" role="status"></div>`;}
function footer(){return `<div class="fire-footnote"><p>金额与收益均为情景假设。按月计算；两边年新增在退休前按月末等额投入，退休后停止。美元账户与人民币账户之间的转移只计一次资产。</p><p>初始汇率、账户收益率及成本为可修改假设，未接入实时账户或行情。仅模拟现金流；不测算资本利得税，转账额度与到账时间需以实际安排为准。</p></div>`;}

$('dashboard-view').innerHTML=`
  <div class="fire-view-heading"><div><h2>双账户资产总览</h2><p>人民币负责生活储备，美元保留投资空间。</p></div><span id="dash-time" class="time-pill">当前资产</span></div>
  ${metrics('dash')}
  <section class="panel fire-chart-panel"><div class="chart-heading"><div><h2>人民币 ＋ 美元，放在同一条时间线上</h2><p>统一按各时点汇率折合人民币；点击曲线或拖动下方年份查看余额。</p></div><span class="soft-badge" id="dash-horizon"></span></div>${balanceLegend()}<div id="dashboard-chart" class="fire-chart"></div>
    <div class="fire-scrubber"><div><label for="dashboard-year">查看时点</label><output id="dashboard-year-label" for="dashboard-year">当前</output></div><input id="dashboard-year" type="range" min="0" max="50" step="1" value="0"><div class="fire-scrubber-scale"><span>现在</span><span id="dashboard-end-label">第 50 年末</span></div></div>
  </section>
  <div class="retirement-milestone" id="dashboard-milestone"></div>
  ${status('dashboard-status')}
  <div class="fire-accounts-grid">
    <section class="panel fire-control-card"><div class="account-heading"><span class="currency-token usd-token">USD</span><div><h2>美元投资账户</h2><p>各笔金额独立于人民币新增预算</p></div></div>${field('usdInitial','dash')}${field('usdAnnual','dash')}</section>
    <section class="panel fire-control-card"><div class="account-heading"><span class="currency-token cny-token">CNY</span><div><h2>人民币生活账户</h2><p>年新增默认 40 万，可调整至 30–50 万或其他金额</p></div></div>${field('cnyInitial','dash')}${field('cnyAnnual','dash')}</section>
  </div>
  <section class="panel fire-quick-plan"><div>${field('years','dash')}${field('retireAfter','dash')}</div><div>${field('monthlySpending','dash')}${field('fx','dash')}</div><p>本金、年新增、年份和月支出都支持拖动。收益率、通胀与美元补充规则在「退休支取」中调整，两页即时同步。</p></section>
  ${footer()}`;

$('retirement-view').innerHTML=`
  <div class="fire-view-heading"><div><h2>退休支取模拟</h2><p>人民币先支付生活费，美元按你选择的规则补充。</p></div><span class="soft-badge" id="plan-period"></span></div>
  <div class="account-flow"><span class="flow-usd">美元账户</span><span id="transfer-flow-label">默认不转入</span><span class="flow-cny">人民币账户</span><span>→</span><span>退休生活费</span></div>
  <div class="fire-settings-grid">
    <section class="panel fire-control-card"><div class="section-title"><h2>退休时间与生活费</h2><span>01</span></div>${field('retireAfter')}${field('years')}${select('withdrawalMode','生活费计算方式',{budget:'按今天的人民币月生活费，随通胀增长',initialRate:'按退休起点总资产的一定比例，随通胀增长'})}${field('monthlySpending')}${field('withdrawalRate')}${field('inflation')}<p class="field-note" id="budget-note"></p></section>
    <section class="panel fire-control-card"><div class="section-title"><h2>美元补充人民币</h2><span>02</span></div>${select('transferMode','补充规则',{none:'不自动转入 · 两个账户独立运行',reserve:'人民币储备不足时，分批补到目标',fixed:'按固定年度金额分批补充'})}${select('transferFrequency','检查与补充频率',{1:'每月',3:'每季度',12:'每年'})}${field('reserveMinYears')}${field('reserveTargetYears')}${field('fixedAnnualCNY')}${field('batchUSD')}${field('annualTransferCapUSD')}${field('transferCost')}<p class="field-note" id="transfer-note"></p></section>
    <section class="panel fire-control-card"><div class="section-title"><h2>两个账户的积累</h2><span>03</span></div>${field('usdInitial')}${field('usdAnnual')}${field('cnyInitial')}${field('cnyAnnual')}<p class="field-note">两边“每年新增”分别计入外部本金，按月末平均投入；退休后同时停止。不会把美元转入人民币再算作新增本金。</p></section>
    <section class="panel fire-control-card"><div class="section-title"><h2>收益与汇率假设</h2><span>04</span></div>${field('cnyReturn')}${select('usdPreset','美元收益情景',presets)}${field('usdGood')}${field('usdLow')}${field('usdDownturn')}${field('fx')}${field('fxDrift')}<p class="field-note">汇率为“1 美元兑换多少人民币”；年变化为正表示美元相对人民币升值。年度收益和汇率变化按复利均匀分摊到各月。</p></section>
  </div>
  <div class="fire-section-row"><h2>观察期末余额与累计支取</h2><span id="plan-horizon-text"></span></div>
  ${metrics('plan')}${status('plan-status')}
  <section class="panel fire-chart-panel"><div class="chart-heading"><div><h2>退休前后资产余额</h2><p>灰色背景为退休阶段；支取与换汇成本已从余额扣除。</p></div></div>${balanceLegend()}<div class="fire-chart" id="retirement-balance-chart"></div></section>
  <section class="panel fire-chart-panel"><div class="chart-heading"><div><h2>生活费支取与美元补充</h2><p>补充是账户之间的转移；生活费是实际花掉的金额。</p></div><div class="flow-toggle" role="group" aria-label="现金流展示方式"><button type="button" data-flow="annual" aria-pressed="true">每年</button><button type="button" data-flow="cumulative" aria-pressed="false">累计</button></div></div><div class="legend"><span><i class="legend-line" style="border-color:#11816f"></i>实际支取生活费</span><span><i class="legend-line" style="border-color:#c58922"></i>美元补充 · 人民币净到账</span><span><i class="legend-line" style="border-color:#9b667d;border-top-style:dashed"></i>计划生活费</span></div><div class="fire-chart" id="retirement-flow-chart"></div><div class="comparison-strip" id="flow-summary"></div></section>
  <section class="panel fire-chart-panel"><div class="chart-heading"><div><h2>美元逐年收益率 · 可拖动</h2><p>试着把退休最初几年的圆点拖到零以下，观察两个账户能否继续支持生活费。</p></div><span class="soft-badge" id="fire-rate-scenario"></span></div><div id="fire-rate-chart" class="rate-chart"></div><div class="fire-rate-selection"><div><label for="fire-rate-year">选择年份</label><select id="fire-rate-year"></select></div><div><label for="fire-rate-value">该年美元收益率</label><div class="rate-input-row"><input id="fire-rate-slider" type="range" min="-100" max="100" step="0.1" aria-label="该年美元收益率滑块"><div class="number-wrap small"><input id="fire-rate-value" type="number" min="-100" max="100" step="0.1"><span>%</span></div></div></div></div></section>
  <details class="panel fire-ledger" id="fire-ledger"><summary>逐年余额与现金流明细<span>＋</span></summary><p>两类账户余额保留原币；生活费、净转入、成本与合计资产均为万元人民币。</p><div class="table-scroll"><table><thead><tr><th>年份</th><th>阶段</th><th>美元余额<br>万美元</th><th>人民币余额<br>万元</th><th>期末汇率</th><th>合计资产<br>万元人民币</th><th>实际生活费<br>万元</th><th>生活费缺口<br>万元</th><th>转出美元<br>万美元</th><th>人民币净转入<br>万元</th><th>换汇成本<br>万元</th><th>美元新增<br>万美元</th><th>人民币新增<br>万元</th></tr></thead><tbody id="fire-ledger-body"></tbody></table></div></details>
  <details class="panel fire-method"><summary>模型口径与公式<span>＋</span></summary><div><p>每个月按顺序计算：检查补充规则 → 美元换汇进入人民币账户 → 人民币账户支付当月生活费 → 两边各自获得当月收益 → 未退休时新增本金。退休时间为“距离退休”的完整年数结束后，例如 10 年后退休，第 11 年第 1 月开始支取。</p><p>设月初美元为 U、人民币为 C，汇率为 e，转出美元为 T，成本比例为 f，生活费为 W：换汇后美元为 U − T，人民币为 C + eT(1 − f)；支付生活费后，两个账户分别复利。合计资产始终按 U × e + C 计算，换汇本金本身不会创造收益。</p><p>生活费模式使用今天的月支出，从现在起按通胀增长；起点比例模式在退休开始时按两账户折合人民币的总资产确定第一年月预算，以后只按通胀调整金额。两种模式均每年按通胀调整一次生活费，年内按相同月预算支取。</p><p>储备模式在人民币余额不足触发储备时启动补充，按所选频率分批补到目标储备；每次和每年上限均按转出的美元本金计算。固定金额模式把年度人民币净额按频率分摊。所有自动补充从退休开始执行。若上限或美元余额不足，则只转可用金额。</p><p>人民币不足时只支付实际可用余额，其余记为生活费缺口；不透支，也不把缺口自动变成未来债务。默认不自动转入时，即使美元账户仍有资产，也可能出现人民币生活费不足。</p><p>“今天购买力”把当时合计资产按生活费通胀折现；汇率按设定的年度变化率逐月复利。以上为指定路径的情景测算，不代表统计成功率或未来收益保证。</p></div></details>
  ${footer()}`;

function fillRange(input){const min=+input.min,max=+input.max;input.style.setProperty('--fill',`${max>min?(+input.value-min)/(max-min)*100:0}%`);}
function sync(){
  document.querySelectorAll('[data-number]').forEach(input=>{if(document.activeElement!==input)input.value=settings[input.dataset.number];});
  document.querySelectorAll('[data-range]').forEach(input=>{const key=input.dataset.range;input.min=Math.min(meta[key][2],settings[key]);input.max=Math.max(meta[key][3],settings[key]);input.value=settings[key];fillRange(input);});
  document.querySelectorAll('[data-select]').forEach(input=>input.value=settings[input.dataset.select]);
  const inactive=new Set();
  if(settings.withdrawalMode==='budget')inactive.add('withdrawalRate');else inactive.add('monthlySpending');
  if(settings.transferMode!=='reserve'){inactive.add('reserveMinYears');inactive.add('reserveTargetYears');}
  if(settings.transferMode!=='fixed')inactive.add('fixedAnnualCNY');
  if(settings.transferMode==='none')for(const key of ['batchUSD','annualTransferCapUSD','transferCost','transferFrequency'])inactive.add(key);
  document.querySelectorAll('[data-number],[data-range],[data-select]').forEach(input=>{const key=input.dataset.number??input.dataset.range??input.dataset.select;input.disabled=inactive.has(key);input.closest('.fire-field,.fire-select')?.classList.toggle('inactive',inactive.has(key));});
  $('dashboard-year').max=settings.years;$('dashboard-year').value=selectedYear;fillRange($('dashboard-year'));
  const time=selectedYear===0?'当前资产':`第 ${selectedYear} 年末`;
  $('dashboard-year-label').textContent=time;$('dash-time').textContent=time;$('dashboard-end-label').textContent=`第 ${settings.years} 年末`;
  $('dash-horizon').textContent=`观察 ${settings.years} 年`;$('plan-horizon-text').textContent=`第 ${settings.years} 年末`;
  $('plan-period').textContent=settings.retireAfter<settings.years?`积累 ${settings.retireAfter} 年 · 支取 ${settings.years-settings.retireAfter} 年`:'观察期内尚未退休';
  $('budget-note').textContent=settings.withdrawalMode==='budget'?`月生活费按今天购买力输入，从现在起随通胀增长；${settings.retireAfter===0?'即刻':`${settings.retireAfter} 年后`}开始支取。`:'在退休开始时确定第一年支取金额，之后随通胀增长；不是每年重新提取账户余额的固定比例。';
  $('transfer-note').textContent=settings.transferMode==='none'?'当前两个账户独立运行。人民币生活费不足时显示缺口，美元账户继续按收益路径运行。':settings.transferMode==='reserve'?'按人民币生活费储备触发，分批补到目标；单次、年度上限与美元可用余额共同约束实际补充。':'年度净转入目标按所选频率分摊；单次、年度上限或美元不足时，实际转入会低于目标。';
  $('transfer-flow-label').textContent=settings.transferMode==='none'?'不自动转入':settings.transferMode==='reserve'?'→ 储备不足时分批补充 →':'→ 定期定额补充 →';
}
function setSetting(key,value){
  const oldPreset=settings.usdPreset;
  if(key in RETIREMENT_BOUNDS){if(!Number.isFinite(value))return;value=clamp(value,...RETIREMENT_BOUNDS[key]);if(['years','retireAfter'].includes(key))value=Math.round(value);}
  settings[key]=value;
  if(key==='reserveMinYears'&&settings.reserveTargetYears<value)settings.reserveTargetYears=value;
  if(key==='reserveTargetYears'&&settings.reserveMinYears>value)settings.reserveMinYears=value;
  if(key==='usdPreset'&&oldPreset!==value){if(value==='custom')rateHistory=rates.slice();else rateHistory=[];}
  rates=retirementRates(settings,rateHistory);selectedYear=Math.min(selectedYear,settings.years);selectedRateYear=Math.min(selectedRateYear,settings.years);update();
}
document.querySelectorAll('[data-number]').forEach(input=>{input.addEventListener('input',()=>{if(input.value!=='')setSetting(input.dataset.number,+input.value);});input.addEventListener('blur',()=>input.value=settings[input.dataset.number]);});
document.querySelectorAll('[data-range]').forEach(input=>input.addEventListener('input',()=>setSetting(input.dataset.range,+input.value)));
document.querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>setSetting(input.dataset.select,input.dataset.select==='transferFrequency'?+input.value:input.value)));
function renderMetrics(prefix,row){
  $(`${prefix}-total`).textContent=fmt(row.total);$(`${prefix}-real`).textContent=`今天购买力 ${fmt(row.realTotal)} 万元`;
  $(`${prefix}-usd`).textContent=fmt(row.usd);$(`${prefix}-usd-detail`).textContent=`折合 ${fmt(row.usdCNY)} 万元人民币`;
  $(`${prefix}-cny`).textContent=fmt(row.cny);$(`${prefix}-cny-detail`).textContent=`当时汇率 1 美元 = ${row.fx.toFixed(2)} 元`;
  $(`${prefix}-paid`).textContent=fmt(row.cumulativePaid);$(`${prefix}-paid-detail`).textContent=row.cumulativeShortfall>1e-8?`未满足生活费 ${fmt(row.cumulativeShortfall)} 万元`:'生活费均从人民币账户支取';
}
function renderStatus(){
  const p=projection;let text,kind='ok';
  if(!p.retirement){text=`观察期内尚未退休。退休设在 ${settings.retireAfter} 年后，可增加观察年数查看支取阶段。`;kind='neutral';}
  else if(p.retirement.annualBudget===0){text='当前计划生活费为 0，尚未模拟实际养老支出。可调整月生活费或退休起点支取率。';kind='neutral';}
  else if(p.firstShortfall){const f=p.firstShortfall;text=`第 ${f.year} 年第 ${f.month} 月首次出现生活费不足；观察期累计缺口 ${fmt(p.cumulativeShortfall)} 万元。${settings.transferMode==='none'?'当前未启用美元补充，美元余额不自动用于生活费。':'人民币不足时也不会透支；可调整补充规则、额度或生活费。'}`;kind='warning';}
  else text=`当前假设路径中，退休后的 ${p.retiredMonths/12} 年生活费均得到满足。期末人民币余额 ${fmt(p.finalCNY)} 万元${p.cnyCoverageMonths!==null?`，约合届时 ${fmt(p.cnyCoverageMonths/12)} 年生活费`:''}。`;
  for(const id of ['dashboard-status','plan-status']){$(id).textContent=text;$(id).dataset.kind=kind;}
  const milestone=$('dashboard-milestone');
  if(p.retirement)milestone.innerHTML=`<div><span>退休起点 · ${settings.retireAfter===0?'现在':`${settings.retireAfter} 年后`}</span><strong>${fmt(p.retirement.total)} <small>万元人民币</small></strong></div><div><span>退休首月计划生活费</span><strong>${fmt(p.retirement.monthlyBudget)} <small>万元</small></strong></div><div><span>首年计划支取 ÷ 起点总资产</span><strong>${p.retirement.initialWithdrawalRate===null?'—':p.retirement.initialWithdrawalRate.toFixed(2)+'%'}</strong></div>`;
  else milestone.innerHTML=`<p>将观察年数增加到 ${settings.retireAfter+1} 年或之后，可显示退休起点资产与生活费。</p>`;
  $('flow-summary').innerHTML=`实际支取 <strong>${fmt(p.cumulativePaid)} 万元</strong>；美元累计转出 <strong>${fmt(p.cumulativeTransferUSD)} 万美元</strong>，人民币净到账 <strong>${fmt(p.cumulativeTransferCNY)} 万元</strong>；换汇成本 <strong>${fmt(p.cumulativeFees)} 万元</strong>。`;
}
const assetSeries=[{label:'合计资产',value:r=>r.total,color:'#233966',width:3},{label:'美元账户折合人民币',value:r=>r.usdCNY,color:'#1556d5'},{label:'人民币账户',value:r=>r.cny,color:'#11816f'}];
function tooltip(row){return `<div class="tooltip-line"><span>美元账户</span><span>${fmt(row.usd)} 万美元</span></div><div class="tooltip-line"><span>人民币账户</span><span>${fmt(row.cny)} 万元</span></div><div class="tooltip-line"><span>合计折合人民币</span><span>${fmt(row.total)} 万元</span></div><div class="tooltip-line"><span>累计生活费</span><span>${fmt(row.cumulativePaid)} 万元</span></div><div>汇率 ${row.fx.toFixed(2)} · ${row.year===0?'当前':row.year<=settings.retireAfter?'积累阶段':'退休阶段'}</div>`;}
function renderCharts(){
  const options={rows:projection.rows,years:settings.years,retireAfter:settings.retireAfter,title:'双账户资产余额',series:assetSeries,tooltip};
  if(view==='dashboard')drawRetirementChart($('dashboard-chart'),{...options,selectedYear,onSelect:year=>{selectedYear=year;renderDashboard();}});
  if(view==='retirement'){
    drawRetirementChart($('retirement-balance-chart'),options);
    const cumulative=flowMode==='cumulative';
    drawRetirementChart($('retirement-flow-chart'),{rows:projection.rows,years:settings.years,retireAfter:settings.retireAfter,title:cumulative?'累计生活费与美元补充':'每年生活费与美元补充',series:[
      {label:'实际生活费',value:r=>cumulative?r.cumulativePaid:r.paid,color:'#11816f',width:3},
      {label:'美元补充净到账',value:r=>cumulative?r.cumulativeTransferCNY:r.transferCNY,color:'#c58922'},
      {label:'计划生活费',value:r=>cumulative?r.cumulativeRequested:r.requested,color:'#9b667d',dash:'5 4'}]});
    renderRateEditor();
  }
}
function renderDashboard(){sync();renderMetrics('dash',projection.rows[selectedYear]);renderCharts();}
function renderLedger(){if(!$('fire-ledger').open)return;$('fire-ledger-body').innerHTML=projection.rows.map(r=>`<tr><td>${r.year===0?'当前':`第 ${r.year} 年`}</td><td>${r.year===0?'当前':r.year<=settings.retireAfter?'积累':'退休'}</td><td>${fmt(r.usd)}</td><td>${fmt(r.cny)}</td><td>${r.fx.toFixed(2)}</td><td>${fmt(r.total)}</td><td>${fmt(r.paid)}</td><td class="${r.shortfall>1e-8?'negative':''}">${fmt(r.shortfall)}</td><td>${fmt(r.transferUSD)}</td><td>${fmt(r.transferCNY)}</td><td>${fmt(r.fees)}</td><td>${fmt(r.usdContribution)}</td><td>${fmt(r.cnyContribution)}</td></tr>`).join('');}
function update(){projection=simulateRetirement(settings,rates);sync();renderMetrics('dash',projection.rows[selectedYear]);renderMetrics('plan',projection.rows.at(-1));renderStatus();renderCharts();renderLedger();}

function selectView(next){
  view=next;document.body.dataset.view=view;
  for(const name of ['dashboard','retirement','compound']){$(`${name}-view`).hidden=name!==view;$(`tab-${name}`).setAttribute('aria-selected',String(name===view));$(`tab-${name}`).tabIndex=name===view?0:-1;}
  $('app-unit').textContent=view==='compound'?'美元 USD':'人民币 CNY · 美元 USD';$('app-subtitle').textContent=view==='compound'?'本金、定投与逐年收益':'双账户资产与退休支取';
  if(view!=='compound')renderCharts();
}
document.querySelectorAll('[data-view]').forEach(button=>{
  button.addEventListener('click',()=>selectView(button.dataset.view));
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const names=['dashboard','retirement','compound'],index=names.indexOf(view);const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;selectView(names[next]);$(`tab-${names[next]}`).focus();});
});
$('dashboard-year').addEventListener('input',event=>{selectedYear=+event.target.value;renderDashboard();});
$('reset').addEventListener('click',()=>{if(view==='compound')return;Object.assign(settings,RETIREMENT_DEFAULTS);rateHistory=[];rates=retirementRates(settings);selectedYear=0;selectedRateYear=1;update();$('announcement').textContent='已恢复美元 20 万、人民币 150 万、人民币年新增 40 万、月生活费 1.5 万，默认不自动转入。';});
document.querySelectorAll('[data-flow]').forEach(button=>button.addEventListener('click',()=>{flowMode=button.dataset.flow;document.querySelectorAll('[data-flow]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderCharts();}));
$('fire-ledger').addEventListener('toggle',renderLedger);

// The return editor retains point nodes during a drag to preserve pointer capture.
function renderRateEditor(){
  const host=$('fire-rate-chart');if(!host.clientWidth)return;
  const width=Math.max(280,host.clientWidth),height=242,left=49,right=width-20,top=36,bottom=height-31;
  const domain=rateDrag?.domain??[Math.max(-100,Math.min(-50,Math.floor(Math.min(...rates)/25)*25)),Math.min(100,Math.max(50,Math.ceil(Math.max(...rates)/25)*25))];
  const x=year=>settings.years===1?(left+right)/2:left+(year-1)/(settings.years-1)*(right-left),y=r=>top+(domain[1]-r)/(domain[1]-domain[0])*(bottom-top);
  rateGeometry={width,height,left,right,top,bottom,domain,x,y};
  if(host.dataset.width!==String(width)||host.dataset.years!==String(settings.years)){
    host.dataset.width=width;host.dataset.years=settings.years;
    host.innerHTML=`<svg width="${width}" height="${height}" aria-label="拖动圆点修改美元年度收益率"><g data-grid></g><path data-line fill="none" stroke="#1556d5" stroke-width="2"/><g>${rates.map((r,i)=>`<g class="rate-point" data-year="${i+1}" role="slider" tabindex="0" aria-label="第 ${i+1} 年美元收益率" aria-valuemin="-100" aria-valuemax="100" aria-orientation="vertical"><circle r="16" fill="transparent"/><circle data-halo r="10" fill="transparent"/><circle data-dot r="5"/></g>`).join('')}</g><text data-label class="chart-end-label"></text></svg>`;
    host.querySelectorAll('.rate-point').forEach(point=>{
      point.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();selectedRateYear=+point.dataset.year;point.focus({preventScroll:true});rateDrag={pointerId:event.pointerId,domain:[...rateGeometry.domain]};point.setPointerCapture(event.pointerId);renderRateEditor();});
      point.addEventListener('pointermove',event=>{if(!rateDrag||rateDrag.pointerId!==event.pointerId)return;const rect=host.querySelector('svg').getBoundingClientRect(),position=(event.clientY-rect.top)*height/rect.height;setRate(rateGeometry.domain[1]-(position-top)/(bottom-top)*(rateGeometry.domain[1]-rateGeometry.domain[0]));});
      const stop=event=>{if(!rateDrag||rateDrag.pointerId!==event.pointerId)return;rateDrag=null;if(point.hasPointerCapture(event.pointerId))point.releasePointerCapture(event.pointerId);renderRateEditor();};
      for(const name of ['pointerup','pointercancel','lostpointercapture'])point.addEventListener(name,stop);
      point.addEventListener('focus',()=>{selectedRateYear=+point.dataset.year;renderRateEditor();});
      point.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();selectedRateYear=+point.dataset.year;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){selectedRateYear=clamp(selectedRateYear+(event.key==='ArrowRight'?1:-1),1,settings.years);renderRateEditor();host.querySelector(`[data-year="${selectedRateYear}"]`).focus();}else setRate(event.key==='Home'?-100:event.key==='End'?100:rates[selectedRateYear-1]+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?5:.5));});
    });
  }
  const step=domain[1]-domain[0]>100?50:25,ticks=[];for(let r=Math.ceil(domain[0]/step)*step;r<=domain[1];r+=step)ticks.push(r);
  const every=Math.max(1,Math.ceil(settings.years/(width<500?4:8))),years=[...new Set([1,...rates.map((_,i)=>i+1).filter(n=>n%every===0),settings.years])];
  host.querySelector('[data-grid]').innerHTML=`<rect x="${left}" y="${y(0)}" width="${right-left}" height="${bottom-y(0)}" fill="#fff7f8"/>${ticks.map(r=>`<line x1="${left}" x2="${right}" y1="${y(r)}" y2="${y(r)}" stroke="${r===0?'#aeb9cb':'#edf0f5'}"/><text x="${left-8}" y="${y(r)+4}" text-anchor="end" class="chart-axis">${r}%</text>`).join('')}${years.map(n=>`<text x="${x(n)}" y="${bottom+23}" text-anchor="middle" class="chart-axis">${n}</text>`).join('')}<text x="${left}" y="17" class="chart-axis">年度收益率</text><text x="${right}" y="17" text-anchor="end" class="chart-axis">第 ${selectedRateYear} 年 · ${rates[selectedRateYear-1].toFixed(1)}%</text>`;
  host.querySelector('[data-line]').setAttribute('d',rates.map((r,i)=>`${i?'L':'M'}${x(i+1)},${y(r)}`).join(' '));
  host.querySelectorAll('.rate-point').forEach(point=>{const year=+point.dataset.year,r=rates[year-1];point.setAttribute('transform',`translate(${x(year)},${y(r)})`);point.setAttribute('aria-valuenow',r);point.setAttribute('aria-valuetext',`${r}%`);point.querySelector('[data-halo]').setAttribute('stroke',year===selectedRateYear?'#1556d5':'none');point.querySelector('[data-halo]').setAttribute('fill',year===selectedRateYear?'white':'transparent');point.querySelector('[data-dot]').setAttribute('fill',r<0?'#c84555':'#1556d5');point.querySelector('[data-dot]').setAttribute('r',year===selectedRateYear?6:settings.years>30?3.5:4.5);});
  const label=host.querySelector('[data-label]');label.setAttribute('x',x(selectedRateYear));label.setAttribute('y',Math.max(top+12,y(rates[selectedRateYear-1])-16));label.setAttribute('text-anchor',selectedRateYear===1?'start':selectedRateYear===settings.years?'end':'middle');label.setAttribute('fill','#1556d5');label.textContent=`${rates[selectedRateYear-1].toFixed(1)}%`;
  if($('fire-rate-year').options.length!==settings.years||$('fire-rate-year').dataset.retireAfter!==String(settings.retireAfter)){$('fire-rate-year').innerHTML=rates.map((_,i)=>`<option value="${i+1}">第 ${i+1} 年${i===settings.retireAfter?' · 退休首年':''}</option>`).join('');$('fire-rate-year').dataset.retireAfter=settings.retireAfter;}
  $('fire-rate-year').value=selectedRateYear;if(document.activeElement!==$('fire-rate-value'))$('fire-rate-value').value=rates[selectedRateYear-1];$('fire-rate-slider').value=rates[selectedRateYear-1];fillRange($('fire-rate-slider'));$('fire-rate-scenario').textContent=presets[settings.usdPreset];
}
function setRate(value){if(!Number.isFinite(value))return;if(settings.usdPreset!=='custom')rateHistory=rates.slice();rateHistory[selectedRateYear-1]=Math.round(clamp(value,-100,100)*10)/10;settings.usdPreset='custom';rates=retirementRates(settings,rateHistory);update();}
$('fire-rate-year').addEventListener('change',event=>{selectedRateYear=+event.target.value;renderRateEditor();});
$('fire-rate-slider').addEventListener('input',event=>setRate(+event.target.value));
$('fire-rate-value').addEventListener('input',event=>{if(event.target.value!=='')setRate(+event.target.value);});
$('fire-rate-value').addEventListener('blur',event=>event.target.value=rates[selectedRateYear-1]);
const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(projection)renderCharts();});});
for(const id of ['dashboard-chart','retirement-balance-chart'])observer.observe($(id));
update();selectView('dashboard');

function snapshot(){return {settings:{...settings},yearlyUsdReturns:[...rates],selectedYear,selectedBalances:projection.rows[selectedYear],retirement:projection.retirement,firstShortfall:projection.firstShortfall,finalUSD:projection.finalUSD,finalCNY:projection.finalCNY,finalTotalCNY:projection.finalTotal,cumulativePaidCNY:projection.cumulativePaid,cumulativeShortfallCNY:projection.cumulativeShortfall,cumulativeTransferUSD:projection.cumulativeTransferUSD,cumulativeTransferCNY:projection.cumulativeTransferCNY};}
function configureRetirement(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请输入参数对象。');
  const patch={...input};delete patch.yearlyUsdReturns;const next=validateRetirement({...settings,...patch});
  let nextHistory=rateHistory,nextRates;
  if(input.yearlyUsdReturns!==undefined){if(!Array.isArray(input.yearlyUsdReturns)||input.yearlyUsdReturns.length!==next.years||input.yearlyUsdReturns.some(r=>typeof r!=='number'||!Number.isFinite(r)||r<-100||r>100))throw new Error('逐年收益率数组无效。');next.usdPreset='custom';nextHistory=input.yearlyUsdReturns.map(r=>Math.round(r*10)/10);}
  else if(next.usdPreset==='custom'&&settings.usdPreset!=='custom')nextHistory=rates.slice();
  nextRates=retirementRates(next,nextHistory);simulateRetirement(next,nextRates);
  Object.assign(settings,next);rates=nextRates;rateHistory=nextHistory;selectedYear=Math.min(selectedYear,settings.years);selectedRateYear=Math.min(selectedRateYear,settings.years);update();selectView('dashboard');return snapshot();
}
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController(),properties=Object.fromEntries(Object.entries(RETIREMENT_BOUNDS).map(([key,[minimum,maximum]])=>[key,{type:['years','retireAfter'].includes(key)?'integer':'number',minimum,maximum}]));
  Object.assign(properties,{usdPreset:{type:'string',enum:Object.keys(presets)},withdrawalMode:{type:'string',enum:['budget','initialRate']},transferMode:{type:'string',enum:['none','reserve','fixed']},transferFrequency:{type:'integer',enum:[1,3,12]},yearlyUsdReturns:{type:'array',items:{type:'number',minimum:-100,maximum:100},minItems:1,maxItems:60}});
  for(const tool of [{name:'get_retirement_scenario',title:'读取双账户退休测算',description:'读取人民币与美元账户的模拟参数、余额与生活费缺口；美元金额单位万美元，人民币金额单位万元。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('该工具不接受参数。');return snapshot();}},
    {name:'configure_retirement_scenario',title:'调整双账户退休测算',description:'设置双账户本金、新增资金、退休生活费、收益、汇率与模拟补充规则，更新 Dashboard。仅进行当前页面模拟，不连接账户或转账。金额单位分别为万美元与万元人民币。',inputSchema:{type:'object',properties,additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:configureRetirement}]){
    try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(error=>console.warn('Retirement WebMCP registration failed:',error));}catch(error){console.warn('Retirement WebMCP unavailable:',error);}
  }
  window.addEventListener('pagehide',event=>{if(!event.persisted)lifecycle.abort();},{once:true});
}
