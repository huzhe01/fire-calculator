const number=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
const short=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1,notation:Math.abs(n)>=1000000?'compact':'standard'}).format(n);
function ticksFor(max){
  if(max<=0)return [0,1,2,3,4];
  const raw=max/4,unit=10**Math.floor(Math.log10(raw)),step=([1,2,2.5,5,10].find(v=>v>=raw/unit)||10)*unit;
  return Array.from({length:Math.ceil(max/step)+1},(_,i)=>i*step);
}
export function drawRetirementChart(host,{rows,series,years,retireAfter,selectedYear=null,title,unit='万元人民币',height=330,tooltip,onSelect}){
  if(!host||!host.clientWidth)return;
  const width=Math.max(280,host.clientWidth),left=width<500?49:66,right=width-18,top=42,bottom=height-33;
  const ticks=ticksFor(Math.max(0,...rows.flatMap(row=>series.map(s=>s.value(row))))*1.08),max=ticks.at(-1);
  const x=n=>left+n/years*(right-left),y=n=>bottom-n/max*(bottom-top);
  const interval=Math.max(1,Math.ceil(years/(width<500?4:8)));
  const xTicks=[...new Set([0,...Array.from({length:years},(_,i)=>i+1).filter(n=>n%interval===0),years])];
  const path=s=>rows.map((row,i)=>`${i?'L':'M'}${x(row.year)},${y(s.value(row))}`).join(' ');
  const retirementVisible=retireAfter<years;
  host.innerHTML=`<svg width="${width}" height="${height}" role="img" aria-label="${title}">
    ${retirementVisible?`<rect x="${x(retireAfter)}" y="${top}" width="${right-x(retireAfter)}" height="${bottom-top}" fill="#f4f7fd"/>`:''}
    <text x="${left}" y="17" class="chart-axis">${unit}</text>
    ${ticks.map(v=>`<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis">${short(v)}</text>`).join('')}
    ${retirementVisible?`<line x1="${x(retireAfter)}" x2="${x(retireAfter)}" y1="${top-8}" y2="${bottom}" stroke="#8497b7" stroke-dasharray="5 4"/><text x="${Math.min(right-75,x(retireAfter)+6)}" y="31" class="chart-axis">退休开始</text>`:''}
    ${series.map(s=>`<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.width??2.5}" stroke-dasharray="${s.dash??''}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${xTicks.map(n=>`<text x="${x(n)}" y="${bottom+23}" text-anchor="middle" class="chart-axis">${n}</text>`).join('')}
    ${selectedYear!==null?`<line x1="${x(selectedYear)}" x2="${x(selectedYear)}" y1="${top}" y2="${bottom}" stroke="#6b7da0" stroke-dasharray="3 3"/>${series.map(s=>`<circle cx="${x(selectedYear)}" cy="${y(s.value(rows[selectedYear]))}" r="4.5" fill="white" stroke="${s.color}" stroke-width="2"/>`).join('')}`:''}
    <line class="hover-crosshair" data-cross y1="${top}" y2="${bottom}" visibility="hidden"/>
    <rect data-hover x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" fill="transparent"/>
  </svg><div class="chart-tooltip" data-tooltip hidden></div>`;
  const hit=host.querySelector('[data-hover]'),tip=host.querySelector('[data-tooltip]'),cross=host.querySelector('[data-cross]');
  const getYear=event=>Math.max(0,Math.min(years,Math.round((event.clientX-host.getBoundingClientRect().left-left)/(right-left)*years)));
  hit.addEventListener('pointermove',event=>{
    const year=getYear(event),row=rows[year],bounds=host.getBoundingClientRect();
    tip.innerHTML=`<strong>${year===0?'当前资产':`第 ${year} 年末`}</strong>${tooltip?tooltip(row):series.map(s=>`<div class="tooltip-line"><span>${s.label}</span><span>${number.format(s.value(row))}</span></div>`).join('')}`;
    tip.hidden=false;tip.style.left=`${Math.max(0,Math.min(width-tip.offsetWidth,event.clientX-bounds.left+12))}px`;
    tip.style.top=`${Math.max(0,Math.min(height-tip.offsetHeight,event.clientY-bounds.top-45))}px`;
    cross.setAttribute('x1',x(year));cross.setAttribute('x2',x(year));cross.setAttribute('visibility','visible');
  });
  hit.addEventListener('pointerleave',()=>{tip.hidden=true;cross.setAttribute('visibility','hidden');});
  if(onSelect)hit.addEventListener('click',event=>onSelect(getYear(event)));
}
