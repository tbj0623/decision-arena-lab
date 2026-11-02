import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision, scoreDecision } from '../../site/core.mjs';
import { enumerateFixedSumWeightVertices } from '../../site/features/fixed-sum-weights.mjs';
import { analyzeJointUncertainty } from '../../site/features/joint-weight-rating.mjs';

const close=(a,b,msg='')=>assert.ok(Math.abs(a-b)<1e-7,msg+` ${a} != ${b}`);
function example(){
  const d=createEmptyDecision();
  d.title='固定总权重测试';
  d.factors.forEach((f,i)=>{
    f.weight=[4,2,3,1][i];
    f.ratings={A:[9,4,7,8][i],B:[5,8,7,6][i]};
  });
  return d;
}

test('只选一个权重且总和固定：没有任何自由度，不谎报权重变化',()=>{
  const d=example(), r=analyzeJointUncertainty(d,[],1,['f1'],2,'fixed-total');
  close(r.interval.minDelta,scoreDecision(d).difference);
  close(r.interval.maxDelta,scoreDecision(d).difference);
  assert.equal(r.weightCornersEvaluated,1);
  assert.equal(r.witness.weightChanges.length,0);
  assert.equal(r.mode,'fixed-total');
  close(r.weightRanges[0].hi,6);
});

test('两个权重只能此消彼长，所有可行边界保持原始总和',()=>{
  const d=example();
  const r=analyzeJointUncertainty(d,[],1,['f1','f2'],2,'fixed-total');
  const free=analyzeJointUncertainty(d,[],1,['f1','f2'],2,'independent');
  const total=d.factors.reduce((s,f)=>s+f.weight,0);
  close(total,10);
  assert.ok(r.weightCornersEvaluated>=2);
  assert.ok(r.interval.minDelta >= free.interval.minDelta - 1e-8);
  assert.ok(r.interval.maxDelta <= free.interval.maxDelta + 1e-8);
  const tested=structuredClone(d);
  for (const c of r.witness.weightChanges) tested.factors.find(f=>f.id===c.factorId).weight=c.after;
  close(tested.factors.reduce((sum,f)=>sum+f.weight,0),total);
  close(scoreDecision(tested).difference,r.witness.difference);
});

test('评分与固定总权重同时变化，边界情景仍为原核心算法的真实见证',()=>{
  const d=example(), original=JSON.stringify(d);
  const r=analyzeJointUncertainty(
    d,[{factorId:'f1',side:'A'},{factorId:'f2',side:'B'}],1,
    ['f1','f2','f3','f4'],2,'fixed-total');
  const candidate=structuredClone(d);
  for(const c of r.witness.weightChanges) candidate.factors.find(f=>f.id===c.factorId).weight=c.after;
  for(const c of r.witness.changes) candidate.factors.find(f=>f.id===c.factorId).ratings[c.side]=c.after;
  close(candidate.factors.reduce((sum,f)=>sum+f.weight,0),10);
  close(scoreDecision(candidate).difference,r.witness.difference);
  close(r.witness.difference,
    r.point.winner==='B'?r.interval.maxDelta:r.interval.minDelta);
  assert.equal(JSON.stringify(d),original);
});

test('当全部权重盒下界为零时，固定总和禁止非法全零组合',()=>{
  const d=example();d.factors.forEach(f=>f.weight=0.5);
  const r=analyzeJointUncertainty(d,[],1,d.factors.map(f=>f.id),1,'fixed-total');
  assert.ok(r.weightCornersEvaluated>0);
  assert.ok(r.weightCornersEvaluated<=32);
  assert.ok(Number.isFinite(r.interval.minDelta));
  assert.ok(Number.isFinite(r.interval.maxDelta));
  close(r.witness.weightChanges.reduce((sum,c)=>sum+c.after-c.before,0),0);
});

test('V3 未选择新模式仍完整保持旧独立盒范围',()=>{
  const d=example(), chosen=['f1','f2','f3'];
  const a=analyzeJointUncertainty(d,[],1,chosen,2);
  const b=analyzeJointUncertainty(d,[],1,chosen,2,'independent');
  assert.deepEqual(a,b);
});

test('输入校验：约束模式无效、不可行总额或非法区间会明确拒绝',()=>{
  const d=example();
  assert.throws(()=>analyzeJointUncertainty(d,[],1,['f1'],1,'bogus'),RangeError);
  assert.throws(()=>enumerateFixedSumWeightVertices([{lo:1,hi:2}],0,[0]),RangeError);
  assert.throws(()=>enumerateFixedSumWeightVertices([{lo:1,hi:2}],3,[0]),RangeError);
  assert.throws(()=>enumerateFixedSumWeightVertices([{lo:-1,hi:3}],2,[0]),RangeError);
  assert.throws(()=>enumerateFixedSumWeightVertices([{lo:1,hi:2}],1,[1]),RangeError);
});

test('固定总量顶点最多 n×2^(n−1)，总和与各自区间被逐个证明',()=>{
  for(let n=2;n<=6;n++){
    const ranges=Array.from({length:n},(_,i)=>({lo:0,hi:3}));
    const vertices=enumerateFixedSumWeightVertices(ranges,n,[...ranges.keys()]);
    assert.ok(vertices.length<=n*2**(n-1));
    for(const v of vertices){
      close(v.reduce((s,x)=>s+x,0),n);
      assert.ok(v.every(x=>x>=0&&x<=3));
      assert.ok(v.filter(x=>x!==0&&x!==3).length<=1);
    }
  }
});

test('60 组固定总和整数网格 oracle 与真实 scoreDecision 全角点独立对拍',()=>{
  let seed=112233;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let t=0;t<60;t++){
    const d=example();
    d.factors.forEach(f=>{
      f.weight=Math.floor(random()*4);
      f.ratings.A=Math.floor(random()*11);
      f.ratings.B=Math.floor(random()*11);
    });
    if(d.factors.every(f=>f.weight===0))d.factors[0].weight=1;
    const ids=d.factors.map(f=>f.id).filter(()=>random()<0.78);
    if(!ids.length)ids.push('f1');
    const radius=1;
    const selected=d.factors.flatMap(f=>['A','B'].flatMap(side=>
      random()<0.28?[{factorId:f.id,side}]:[]));
    const r=analyzeJointUncertainty(d,selected,1,ids,radius,'fixed-total');
    const total=d.factors.reduce((sum,f)=>sum+f.weight,0);
    let lo=Infinity,hi=-Infinity,count=0;
    const grid=d.factors.map(f=>{
      if(!ids.includes(f.id))return [f.weight];
      const out=[];for(let v=Math.max(0,f.weight-1);v<=Math.min(1e6,f.weight+1);v++)out.push(v);
      return out;
    });
    const visit=(i,weights)=>{
      if(i===grid.length){
        if(weights.reduce((s,v)=>s+v,0)!==total)return;
        count++;
        const low=structuredClone(d),high=structuredClone(d);
        for(let j=0;j<weights.length;j++){
          low.factors[j].weight=weights[j];high.factors[j].weight=weights[j];
        }
        for(const {factorId,side} of selected){
          const a=low.factors.find(f=>f.id===factorId);
          const b=high.factors.find(f=>f.id===factorId);
          a.ratings[side]=side==='A'?Math.max(0,a.ratings[side]-1):Math.min(10,a.ratings[side]+1);
          b.ratings[side]=side==='A'?Math.min(10,b.ratings[side]+1):Math.max(0,b.ratings[side]-1);
        }
        lo=Math.min(lo,scoreDecision(low).difference);
        hi=Math.max(hi,scoreDecision(high).difference);
        return;
      }
      for(const w of grid[i])visit(i+1,[...weights,w]);
    };
    visit(0,[]);
    assert.ok(count>0);
    close(lo,r.interval.minDelta,'trial '+t+' min');
    close(hi,r.interval.maxDelta,'trial '+t+' max');
  }
});
