import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision, scoreDecision } from '../../site/core.mjs';
import { analyzeSelectedUncertainty } from '../../site/features/uncertainty-workbench.mjs';
import { analyzeJointUncertainty } from '../../site/features/joint-weight-rating.mjs';

function example(){
  const d=createEmptyDecision();
  d.title='联合数学测试';
  d.factors.forEach((f,i)=>{
    f.weight=[4,2,3,1][i];
    f.ratings={A:[9,5,7,3][i],B:[4,8,6,5][i]};
  });
  return d;
}
const sel=(factorId,side)=>({factorId,side});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('原兼容：不选择权重时，所有 V2 区间结果和见证保持一致',()=>{
  const d=example();
  for (const picks of [[],[sel('f1','A')],[sel('f1','B'),sel('f3','A')]]) {
    const v2=analyzeSelectedUncertainty(d,picks,2);
    const v3=analyzeJointUncertainty(d,picks,2,[],1);
    assert.deepEqual(v3.status,v2.status);
    assert.deepEqual(v3.interval,v2.interval);
    assert.deepEqual(v3.witness?.changes,v2.witness?.changes);
    assert.equal(v3.weightCount,0);
  }
});

test('仅权重上下浮动时，可发现此前固定评分下无法发现的反转',()=>{
  const d=example();
  const r=analyzeJointUncertainty(d,[],1,['f1','f2','f4'],2);
  assert.equal(r.activeCount,0);
  assert.equal(r.weightCount,3);
  assert.equal(r.weightCornersEvaluated,8);
  assert.ok(r.interval.maxDelta>=r.interval.minDelta);
  assert.ok(r.interval.minDelta<=scoreDecision(d).difference+1e-9);
  assert.ok(r.interval.maxDelta>=scoreDecision(d).difference-1e-9);
  close(r.witness.difference,r.point.winner==='B'?r.interval.maxDelta:r.interval.minDelta);
  assert.ok(r.witness.weightChanges.length>0);
  assert.equal(r.witness.changes.length,0);
});

test('评分和权重一起变化，端点严格满足各自区间，且原评分公式可重算',()=>{
  const d=example();
  const original=JSON.stringify(d);
  const r=analyzeJointUncertainty(d,[sel('f1','A'),sel('f2','B')],1,['f1','f2'],2);
  assert.equal(r.activeCount,2);
  assert.equal(r.weightCount,2);
  assert.equal(r.weightCornersEvaluated,4);
  for(const c of r.witness.changes) assert.ok(Math.abs(c.after-c.before)<=1);
  for(const c of r.witness.weightChanges) assert.ok(Math.abs(c.after-c.before)<=2);
  assert.equal(JSON.stringify(d),original,'分析不得改写原模型');
  const modified=structuredClone(d);
  for(const c of r.witness.changes) modified.factors.find(f=>f.id===c.factorId).ratings[c.side]=c.after;
  for(const c of r.witness.weightChanges) modified.factors.find(f=>f.id===c.factorId).weight=c.after;
  close(scoreDecision(modified).difference,r.witness.difference);
});

test('0 权重角点必须跳过，无效的全零状态永不能作为端点见证',()=>{
  const d=example();d.factors.forEach(f=>f.weight=0.5);
  const r=analyzeJointUncertainty(d,[],1,d.factors.map(f=>f.id),1);
  assert.equal(r.weightCount,4);
  assert.equal(r.weightCornersEvaluated,15);
  assert.ok(Number.isFinite(r.interval.minDelta));
  assert.ok(Number.isFinite(r.interval.maxDelta));
  assert.ok(r.witness.weightChanges.length>0);
});

test('初始权重为零时可以被选中变为正数，端点仍有效',()=>{
  const d=example();d.factors[3].weight=0;
  const r=analyzeJointUncertainty(d,[],1,['f4'],2);
  assert.equal(r.weightCornersEvaluated,2);
  assert.deepEqual(r.weightRanges[3],{factorId:'f4',label:d.factors[3].label,lo:0,hi:2});
});

test('最大合法权重遇到正半径也不能超过核心上限',()=>{
  const d=example();d.factors[0].weight=1e6;
  const r=analyzeJointUncertainty(d,[],1,['f1'],2);
  assert.equal(r.weightRanges[0].hi,1e6);
});

test('非法权重选择、幅度与决策明确拒绝',()=>{
  const d=example();
  for(const v of [-1,0,1.5,2.01,NaN,'1']) {
    assert.throws(()=>analyzeJointUncertainty(d,[],1,['f1'],v),RangeError);
  }
  assert.throws(()=>analyzeJointUncertainty(d,[],1,null),TypeError);
  assert.throws(()=>analyzeJointUncertainty(d,[],1,['missing'],1),RangeError);
  assert.throws(()=>analyzeJointUncertainty(d,[],1,[null],1),RangeError);
  assert.throws(()=>analyzeJointUncertainty({options:[],factors:[]},[],1,['f1'],1));
});

test('独立穷举权重+评分所有端点，V3 与原评分核对拍（4维样例）',()=>{
  const d=example();
  const ratingPicks=[sel('f1','A'),sel('f3','B'),sel('f4','A')];
  const weightPicks=['f1','f2','f3','f4'];
  const r=analyzeJointUncertainty(d,ratingPicks,1,weightPicks,2);
  const wRanges=r.weightRanges;
  const scores=[];
  for(let wm=0;wm<(1<<4);wm++) {
    for(let rm=0;rm<(1<<3);rm++) {
      const c=structuredClone(d);
      c.factors.forEach((f,i)=>{
        f.weight=wm&(1<<i)?wRanges[i].hi:wRanges[i].lo;
      });
      if(c.factors.every(f=>f.weight===0)) continue;
      for(let j=0;j<ratingPicks.length;j++){
        const {factorId,side}=ratingPicks[j];
        const f=c.factors.find(f=>f.id===factorId);
        const lo=Math.max(0,f.ratings[side]-1),hi=Math.min(10,f.ratings[side]+1);
        f.ratings[side]=rm&(1<<j)?hi:lo;
      }
      scores.push(scoreDecision(c).difference);
    }
  }
  close(Math.min(...scores),r.interval.minDelta);
  close(Math.max(...scores),r.interval.maxDelta);
});

test('确定性伪随机对拍：100 份不同原始权重和评分，包含 0、10 端点',()=>{
  let seed=7352;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let trial=0;trial<100;trial++){
    const d=example();
    for(const f of d.factors){
      f.weight=Math.round(rand()*4*2)/2;
      f.ratings.A=Math.round(rand()*10);
      f.ratings.B=Math.round(rand()*10);
    }
    if(d.factors.every(f=>f.weight===0)) d.factors[0].weight=1;
    const chosen=d.factors.filter(()=>rand()>.35).map(f=>f.id);
    const picks=d.factors.flatMap(f=>['A','B'].filter(()=>rand()>.65).map(side=>sel(f.id,side)));
    const result=analyzeJointUncertainty(d,picks,1,chosen,2);
    if(!chosen.length) continue;
    const wCorners=2**chosen.length;
    let mini=Infinity,maxi=-Infinity;
    for(let mask=0;mask<wCorners;mask++){
      const c=structuredClone(d);
      chosen.forEach((id,j)=>{
        const f=c.factors.find(f=>f.id===id);
        f.weight=mask&(1<<j)?Math.min(1e6,f.weight+2):Math.max(0,f.weight-2);
      });
      const total=c.factors.reduce((s,f)=>s+f.weight,0);
      if(total===0) continue;
      const minCase=structuredClone(c),maxCase=structuredClone(c);
      for(const {factorId,side} of picks){
        const f=minCase.factors.find(f=>f.id===factorId),g=maxCase.factors.find(f=>f.id===factorId);
        f.ratings[side]=side==='A'?Math.max(0,f.ratings[side]-1):Math.min(10,f.ratings[side]+1);
        g.ratings[side]=side==='A'?Math.min(10,g.ratings[side]+1):Math.max(0,g.ratings[side]-1);
      }
      mini=Math.min(mini,scoreDecision(minCase).difference);
      maxi=Math.max(maxi,scoreDecision(maxCase).difference);
    }
    close(result.interval.minDelta,mini);
    close(result.interval.maxDelta,maxi);
  }
});
