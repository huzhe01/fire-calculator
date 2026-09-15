import {clamp,makeRates} from './model.mjs';

// Monetary units: USD accounts use USD 10,000; CNY accounts use CNY 10,000.
// FX is CNY per USD, so usd * fx is CNY 10,000.
export const RETIREMENT_DEFAULTS=Object.freeze({
  years:50,retireAfter:10,usdInitial:20,usdAnnual:10,cnyInitial:150,cnyAnnual:40,
  usdPreset:'alternate',usdGood:15,usdLow:2.5,usdDownturn:-20,cnyReturn:2,
  fx:7,fxDrift:0,inflation:2,withdrawalMode:'budget',monthlySpending:1.5,withdrawalRate:4,
  transferMode:'none',reserveMinYears:2,reserveTargetYears:3,
  transferFrequency:1,batchUSD:1,annualTransferCapUSD:12,fixedAnnualCNY:18,transferCost:0.3
});
export const RETIREMENT_BOUNDS=Object.freeze({
  years:[1,60],retireAfter:[0,60],usdInitial:[0,100000],usdAnnual:[0,100000],
  cnyInitial:[0,100000],cnyAnnual:[0,100000],usdGood:[-100,100],usdLow:[-100,100],
  usdDownturn:[-100,100],cnyReturn:[-100,100],fx:[0.1,100],fxDrift:[-20,20],
  inflation:[-5,20],monthlySpending:[0,10000],withdrawalRate:[0,20],
  reserveMinYears:[0,10],reserveTargetYears:[0,15],batchUSD:[0,10000],
  annualTransferCapUSD:[0,100000],fixedAnnualCNY:[0,100000],transferCost:[0,20]
});
const ENUMS={usdPreset:['alternate','fixed','periodic','early','late','retirementCrash','custom'],withdrawalMode:['budget','initialRate'],transferMode:['reserve','fixed','none'],transferFrequency:[1,3,12]};

export function validateRetirement(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请输入退休模拟参数。');
  for(const key of Object.keys(input))if(!Object.hasOwn(RETIREMENT_DEFAULTS,key))throw new Error(`不支持的参数：${key}`);
  const next={...RETIREMENT_DEFAULTS,...input};
  for(const [key,[min,max]] of Object.entries(RETIREMENT_BOUNDS))if(typeof next[key]!=='number'||!Number.isFinite(next[key])||next[key]<min||next[key]>max)throw new Error(`${key} 必须在 ${min} 至 ${max} 之间。`);
  if(!Number.isInteger(next.years)||!Number.isInteger(next.retireAfter))throw new Error('年数必须是整数。');
  for(const [key,values] of Object.entries(ENUMS))if(!values.includes(next[key]))throw new Error(`${key} 选项无效。`);
  if(next.reserveTargetYears<next.reserveMinYears)throw new Error('补充目标不能低于触发储备。');
  return next;
}

export function retirementRates(settings,history=[]){
  if(settings.usdPreset==='custom')return Array.from({length:settings.years},(_,i)=>history[i]??settings.usdGood);
  if(settings.usdPreset==='retirementCrash')return Array.from({length:settings.years},(_,i)=>i>=settings.retireAfter&&i<settings.retireAfter+2?settings.usdDownturn:settings.usdGood);
  return makeRates({years:settings.years,preset:settings.usdPreset,good:settings.usdGood,low:settings.usdLow,downturn:settings.usdDownturn});
}

export function simulateRetirement(input,yearlyUsdReturns){
  const s=validateRetirement(input),rates=yearlyUsdReturns??retirementRates(s);
  if(!Array.isArray(rates)||rates.length!==s.years||rates.some(r=>typeof r!=='number'||!Number.isFinite(r)||r<-100||r>100))throw new Error('美元逐年收益率必须与观察年数一致，范围 -100% 至 100%。');
  let usd=s.usdInitial,cny=s.cnyInitial,retirement=null,refillActive=false,annualTransferredUSD=0;
  let cumulativePaid=0,cumulativeRequested=0,cumulativeShortfall=0,cumulativeTransferCNY=0,cumulativeTransferUSD=0,cumulativeFees=0,cumulativeContributions=0;
  let firstShortfall=null,limitedTransfers=0;
  const initialTotal=usd*s.fx+cny;
  const rows=[{year:0,month:0,usd,cny,fx:s.fx,usdCNY:usd*s.fx,total:initialTotal,realTotal:initialTotal,
    paid:0,requested:0,shortfall:0,transferUSD:0,transferCNY:0,fees:0,usdContribution:0,cnyContribution:0,contributionsCNY:0,investmentGain:0,fxGain:0,
    cumulativePaid:0,cumulativeRequested:0,cumulativeShortfall:0,cumulativeTransferCNY:0,cumulativeTransferUSD:0,cumulativeFees:0,cumulativeContributions:0,annualBudget:0,retiredMonths:0}];
  const months=[];
  let yearTotals={};
  const flowKeys=['paid','requested','shortfall','transferUSD','transferCNY','fees','usdContribution','cnyContribution','contributionsCNY','investmentGain','fxGain','retiredMonths'];
  const fxAt=month=>s.fx*Math.pow(1+s.fxDrift/100,month/12);
  const inflationAt=month=>Math.pow(1+s.inflation/100,month/12);
  for(let index=0;index<s.years*12;index++){
    if(index%12===0){annualTransferredUSD=0;yearTotals=Object.fromEntries(flowKeys.map(key=>[key,0]));}
    const year=Math.floor(index/12)+1,fxStart=fxAt(index),fxEnd=fxAt(index+1),retired=index>=s.retireAfter*12;
    const startUSD=usd,startCNY=cny,startTotal=usd*fxStart+cny;
    if(retired&&!retirement){
      const total=usd*fxStart+cny;
      const annualBudget=s.withdrawalMode==='budget'?s.monthlySpending*12*inflationAt(index):total*s.withdrawalRate/100;
      retirement={afterYears:s.retireAfter,firstYear:year,usd,cny,fx:fxStart,total,annualBudget,monthlyBudget:annualBudget/12,initialWithdrawalRate:total>0?annualBudget/total*100:null};
    }
    const retirementMonth=index-s.retireAfter*12;
    // Set one budget for each retirement year, then pay it in 12 equal months.
    const annualBudget=retired?(s.withdrawalMode==='budget'?s.monthlySpending*12*Math.pow(1+s.inflation/100,Math.floor(index/12)):retirement.annualBudget*Math.pow(1+s.inflation/100,Math.floor(retirementMonth/12))):0;
    const requested=annualBudget/12;
    let desiredCNY=0,transferUSD=0,transferCNY=0,fees=0;
    const eligible=retired&&retirementMonth%s.transferFrequency===0;
    if(retired&&s.transferMode==='reserve'){
      const trigger=Math.max(s.reserveMinYears*annualBudget,requested),target=Math.max(s.reserveTargetYears*annualBudget,requested);
      if(cny+1e-10<trigger)refillActive=true;
      if(eligible&&refillActive)desiredCNY=Math.max(0,target-cny);
      if(cny>=target-1e-10)refillActive=false;
    }else if(eligible&&s.transferMode==='fixed'){
      desiredCNY=s.fixedAnnualCNY*s.transferFrequency/12;
    }
    if(desiredCNY>0){
      const wantedUSD=desiredCNY/(fxStart*(1-s.transferCost/100));
      transferUSD=Math.max(0,Math.min(wantedUSD,usd,s.batchUSD,s.annualTransferCapUSD-annualTransferredUSD));
      if(transferUSD+1e-9<wantedUSD)limitedTransfers++;
      fees=transferUSD*fxStart*s.transferCost/100;
      transferCNY=transferUSD*fxStart-fees;
      usd=Math.max(0,usd-transferUSD);cny+=transferCNY;annualTransferredUSD+=transferUSD;
      if(s.transferMode==='reserve'&&cny>=Math.max(s.reserveTargetYears*annualBudget,requested)-1e-9)refillActive=false;
    }
    const paid=Math.min(cny,requested),shortfall=Math.max(0,requested-paid);
    cny=Math.max(0,cny-paid);
    if(shortfall>1e-8&&!firstShortfall)firstShortfall={year,month:index%12+1,elapsedMonth:index+1,retirementMonth:retirementMonth+1,amount:shortfall,usdRemaining:usd,cnyRemaining:cny};
    const usdFactor=Math.pow(1+rates[year-1]/100,1/12),cnyFactor=Math.pow(1+s.cnyReturn/100,1/12);
    const usdGain=usd*(usdFactor-1),cnyGain=cny*(cnyFactor-1);
    usd=Math.max(0,usd+usdGain);cny=Math.max(0,cny+cnyGain);
    const fxGain=usd*(fxEnd-fxStart),investmentGain=usdGain*fxStart+cnyGain;
    const usdContribution=retired?0:s.usdAnnual/12,cnyContribution=retired?0:s.cnyAnnual/12;
    usd+=usdContribution;cny+=cnyContribution;
    const contributionsCNY=usdContribution*fxEnd+cnyContribution,total=usd*fxEnd+cny;
    cumulativePaid+=paid;cumulativeRequested+=requested;cumulativeShortfall+=shortfall;
    cumulativeTransferCNY+=transferCNY;cumulativeTransferUSD+=transferUSD;cumulativeFees+=fees;cumulativeContributions+=contributionsCNY;
    const row={year,month:index+1,monthInYear:index%12+1,retired,startUSD,startCNY,startTotal,fxStart,fx:fxEnd,
      usd,cny,usdCNY:usd*fxEnd,total,realTotal:total/inflationAt(index+1),paid,requested,shortfall,transferUSD,transferCNY,fees,
      usdContribution,cnyContribution,contributionsCNY,investmentGain,fxGain,annualBudget,retiredMonths:retired?1:0,
      cumulativePaid,cumulativeRequested,cumulativeShortfall,cumulativeTransferCNY,cumulativeTransferUSD,cumulativeFees,cumulativeContributions};
    months.push(row);
    for(const key of flowKeys)yearTotals[key]+=row[key];
    if(index%12===11)rows.push({...row,...yearTotals});
  }
  const last=rows.at(-1),retiredMonths=Math.max(0,(s.years-s.retireAfter)*12);
  const nextAnnualBudget=retirement?(s.withdrawalMode==='budget'?s.monthlySpending*12*inflationAt(s.years*12):retirement.annualBudget*Math.pow(1+s.inflation/100,s.years-s.retireAfter)):0;
  return {settings:s,rates:[...rates],rows,months,initialTotal,retirement,firstShortfall,limitedTransfers,retiredMonths,
    finalUSD:usd,finalCNY:cny,finalTotal:last.total,finalRealTotal:last.realTotal,finalFx:last.fx,
    cumulativePaid,cumulativeRequested,cumulativeShortfall,cumulativeTransferCNY,cumulativeTransferUSD,cumulativeFees,cumulativeContributions,
    cnyCoverageMonths:nextAnnualBudget>0?cny/(nextAnnualBudget/12):null,
    allSpendingFunded:retiredMonths>0&&cumulativeShortfall<1e-8};
}
