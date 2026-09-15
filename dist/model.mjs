export const RATE_MIN = -100;
export const RATE_MAX = 100;
export const MAX_YEARS = 60;
export const DEFAULTS = Object.freeze({principal:20, annual:10, years:10, contributionYears:10, timing:'end', preset:'alternate', good:15, low:2.5, downturn:-20, baseline:15});
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function makeRates(settings) {
  const {years, preset, good, low, downturn} = settings;
  return Array.from({length:years}, (_, i) => {
    if (preset === 'fixed') return good;
    if (preset === 'periodic') return (i+1)%5 === 0 ? downturn : good;
    if (preset === 'early') return i < Math.min(2,years) ? downturn : good;
    if (preset === 'late') return i >= Math.max(0,years-2) ? downturn : good;
    return i%2 === 0 ? good : low;
  });
}

export function pathAnnualized(rates) {
  if (!rates.length) return null;
  if (rates.some(r => r === -100)) return -100;
  return Math.expm1(rates.reduce((sum,r)=>sum+Math.log1p(r/100),0)/rates.length)*100;
}

// Solve the annual money-weighted return from actual contribution times.
export function moneyWeightedReturn(deposits, terminal, years) {
  const earlier = deposits.filter(d=>d.amount>0 && d.time<years);
  const atEnd = deposits.filter(d=>d.time===years).reduce((s,d)=>s+d.amount,0);
  if (!earlier.length) return null;
  const target = terminal-atEnd;
  if (target<=0) return -100;
  const futureValue=q=>earlier.reduce((s,d)=>s+d.amount*Math.exp(q*(years-d.time)),0);
  let lo=-40, hi=1;
  while(futureValue(hi)<target && hi<40) hi*=2;
  for(let i=0;i<140;i++) {
    const mid=(lo+hi)/2;
    if(futureValue(mid)<target) lo=mid; else hi=mid;
  }
  return Math.expm1((lo+hi)/2)*100;
}

export function simulate(settings, rates) {
  const {principal,annual,years,contributionYears,timing,baseline}=settings;
  if (rates.length!==years || !rates.every(r=>Number.isFinite(r)&&r>=RATE_MIN&&r<=RATE_MAX)) throw new Error('收益率序列无效');
  let assets=principal, fixed=principal, invested=principal;
  const deposits=[{time:0,amount:principal}];
  const rows=[{year:0,rate:null,contribution:0,assets,fixed,invested,gain:0}];
  for(let year=1;year<=years;year++) {
    const contribution=year<=contributionYears?annual:0;
    const before=assets;
    if(timing==='start') {
      assets=(assets+contribution)*(1+rates[year-1]/100);
      fixed=(fixed+contribution)*(1+baseline/100);
    } else {
      assets=assets*(1+rates[year-1]/100)+contribution;
      fixed=fixed*(1+baseline/100)+contribution;
    }
    invested+=contribution;
    deposits.push({time:timing==='start'?year-1:year,amount:contribution});
    rows.push({year,rate:rates[year-1],contribution,assets,fixed,invested,gain:assets-before-contribution});
  }
  return {rows,assets,fixed,invested,profit:assets-invested,roi:invested>0?(assets/invested-1)*100:null,cagr:pathAnnualized(rates),irr:moneyWeightedReturn(deposits,assets,years)};
}
