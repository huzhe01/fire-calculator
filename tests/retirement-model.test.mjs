import assert from 'node:assert/strict';
import {RETIREMENT_DEFAULTS,simulateRetirement,validateRetirement} from '../dist/retirement-model.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const base={...RETIREMENT_DEFAULTS,years:3,retireAfter:0,usdInitial:20,usdAnnual:0,cnyInitial:100,cnyAnnual:0,usdPreset:'fixed',usdGood:0,cnyReturn:0,fx:7,fxDrift:0,inflation:0,monthlySpending:1,transferMode:'none',transferCost:0};
const run=patch=>simulateRetirement({...base,...patch});

// Two accounts stay separate when automatic transfers are off.
let p=run({});near(p.finalUSD,20);near(p.finalCNY,64);near(p.cumulativePaid,36);near(p.cumulativeTransferUSD,0);assert.equal(p.firstShortfall,null);
p=run({cnyInitial:2});near(p.finalUSD,20);near(p.finalCNY,0);near(p.cumulativePaid,2);near(p.cumulativeShortfall,34);assert.equal(p.firstShortfall.month,3);near(p.firstShortfall.usdRemaining,20);

// Monthly contributions match the independent annuity formula and stop at retirement.
p=run({years:2,retireAfter:1,cnyInitial:150,cnyAnnual:40,cnyReturn:2,monthlySpending:0,usdAnnual:10});
const g=1.02**(1/12);near(p.rows[1].cny,150*1.02+(40/12)*(g**12-1)/(g-1));near(p.rows[1].usd,30);near(p.rows[2].usd,30);near(p.rows[2].cny,p.rows[1].cny*1.02);near(p.rows[2].cnyContribution,0);

// Transfers conserve wealth except for paid expenses and explicitly modeled costs.
p=run({years:1,usdInitial:10,cnyInitial:0,transferMode:'reserve',reserveMinYears:0,reserveTargetYears:0,batchUSD:100,annualTransferCapUSD:100,transferCost:1});
near(p.cumulativePaid,12);near(p.finalCNY,0);near(p.cumulativeTransferUSD,12/(7*.99));near(p.cumulativeFees,12*.01/.99);near(p.finalTotal,70-12-p.cumulativeFees);

// A batch limit causes a visible shortfall rather than unlimited transfer or overdraft.
p=run({years:1,usdInitial:10,cnyInitial:0,transferMode:'reserve',reserveMinYears:0,reserveTargetYears:0,batchUSD:.05,annualTransferCapUSD:.6});
near(p.cumulativeTransferUSD,.6);near(p.cumulativePaid,4.2);near(p.cumulativeShortfall,7.8);near(p.finalUSD,9.4);assert.equal(p.firstShortfall.month,1);

// Once triggered, replenishment continues in batches until reaching the target reserve.
p=run({years:1,usdInitial:100,cnyInitial:11,fx:1,transferMode:'reserve',reserveMinYears:1,reserveTargetYears:3,batchUSD:10,annualTransferCapUSD:100});
near(p.months[0].transferUSD,10);near(p.months[1].transferUSD,10);near(p.months[2].transferUSD,7);near(p.months[3].transferUSD,0);

// Fixed transfers are split by cadence, and annual USD caps reset each simulation year.
p=run({years:2,usdInitial:100,cnyInitial:100,fx:1,monthlySpending:0,transferMode:'fixed',fixedAnnualCNY:24,transferFrequency:3,batchUSD:100,annualTransferCapUSD:100});
near(p.rows[1].transferCNY,24);near(p.rows[2].transferCNY,24);assert.deepEqual(p.months.filter(m=>m.transferUSD>0).map(m=>m.month),[1,4,7,10,13,16,19,22]);near(p.finalTotal,200);
p=run({years:2,usdInitial:100,fx:1,monthlySpending:0,transferMode:'fixed',fixedAnnualCNY:24,transferFrequency:1,batchUSD:2,annualTransferCapUSD:3});near(p.rows[1].transferUSD,3);near(p.rows[2].transferUSD,3);

// FX changes CNY valuation without changing native USD balances.
p=run({years:1,usdInitial:10,cnyInitial:0,fxDrift:10,monthlySpending:0});near(p.finalUSD,10);near(p.finalFx,7.7);near(p.finalTotal,77);near(p.rows[1].fxGain,7);

// Budget inflation starts today; percentage withdrawals are anchored once at retirement.
p=run({years:3,retireAfter:2,cnyInitial:1000,usdInitial:0,inflation:2});near(p.months[24].requested,1.02**2);near(p.rows[3].requested,12*1.02**2);
p=run({years:2,cnyInitial:100,usdInitial:0,inflation:3,withdrawalMode:'initialRate',withdrawalRate:4});near(p.rows[1].requested,4);near(p.rows[2].requested,4.12);near(p.finalCNY,91.88);
p=run({years:1,retireAfter:2});assert.equal(p.retirement,null);near(p.cumulativePaid,0);

// Complete losses cannot create negative balances, NaN or fabricated payments.
p=run({years:1,usdGood:-100,cnyReturn:-100});near(p.finalUSD,0);near(p.finalCNY,0);near(p.cumulativePaid,1);near(p.cumulativeShortfall,11);
assert.throws(()=>validateRetirement({...base,reserveMinYears:4,reserveTargetYears:2}));assert.throws(()=>validateRetirement({...base,fx:0}));assert.throws(()=>validateRetirement({...base,unknown:1}));

// Reconcile every monthly balance sheet across varied returns, FX, fees and cash-flow rules.
let seed=78361;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
for(let i=0;i<30;i++){
  const s={...RETIREMENT_DEFAULTS,years:20,retireAfter:i%8,usdInitial:random()*100,cnyInitial:random()*1000,usdAnnual:random()*20,cnyAnnual:random()*60,usdPreset:'fixed',usdGood:-30+random()*60,cnyReturn:-5+random()*10,fx:4+random()*5,fxDrift:-5+random()*10,inflation:random()*5,transferCost:random()*2,transferMode:['none','fixed','reserve'][i%3],monthlySpending:random()*4};
  const r=simulateRetirement(s);
  for(const m of r.months){near(m.total,m.startTotal+m.contributionsCNY+m.investmentGain+m.fxGain-m.fees-m.paid);near(m.transferCNY+m.fees,m.transferUSD*m.fxStart);near(m.paid+m.shortfall,m.requested);assert.ok(m.usd>=0&&m.cny>=0&&Number.isFinite(m.total));}
  near(r.cumulativeRequested,r.cumulativePaid+r.cumulativeShortfall);
  for(const row of r.rows)assert.ok(row.transferUSD<=s.annualTransferCapUSD+1e-8);
}
console.log('PASS: 30 monthly balance-sheet scenarios; account isolation; annuity contributions; retirement boundary; inflation; fixed initial withdrawal; replenishment; batch and annual caps; FX; fees; shortfalls; full losses.');
