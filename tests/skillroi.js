/* 學習系統投資報酬量測（一次性分析工具，不進 test:ui）
   目的：回答「學技能到底划不划算」——每個技能的進場率、被學率、學費、兌現金額、錯過成本。
   重要限制：跑的是「電腦玩家」的行為（npcSkillCap 上限 3 個技能、決定論式的學習判斷），
   所以這是基準線不是最佳解；真人可以學更多、也可以挑更準。報告要照這樣寫。
   用法：node tests/extract.py 之後  node tests/skillroi.js [局數] */
const fs=require('fs'), path=require('path'); const D=__dirname;
eval(fs.readFileSync(path.join(D,'test_engine.js'),'utf8'));
const raw=JSON.parse(fs.readFileSync(path.join(D,'test_content.json'),'utf8'));
ns.configRegistry=JSON.parse(raw['config-default']);
ns.loadContent(id=>raw[id]?JSON.parse(raw[id]):null);
const cfg=ns.buildConfig(ns.configRegistry);
const GAMES=+(process.argv[2]||500);
const OVER=process.argv[3]?JSON.parse(process.argv[3]):{};
Object.keys(OVER).forEach(k=>cfg[k]=OVER[k]);
const MODS=['M1','M2','M3','M4','M6','M8'];
const LINEUP=['NPC_SAFE','NPC_LEVER','NPC_VC','NPC_SAFE'];

const E=ns.engine, util=ns.util;
const SK={}; (ns.content.cards&&0); 
Object.values(ns.content.byId).forEach(c=>{ if(c&&c.kind==='SKILL') SK[c.id]=c; });
const acc={}; Object.keys(SK).forEach(id=>acc[id]={
  sampled:0, started:0, completed:0, decayed:0, fee:0, monthlyPaid:0,
  gateHave:0, gateMiss:0, gainGate:0, lostGate:0, applied:0, gainApplied:0,
  careerSwitch:0, careerSide:0, careerKept:0});
let games=0, invalid=0, learnedPerGame=[], anyGate=0;

const origEv=E.ev;
let bucket=[];
E.ev=function(t,d){ const r=origEv(t,d); if(/^SKILL|^CAREER_SWITCHED|^SECOND_CAREER/.test(t)) bucket.push(r); return r; };

for(let g=0; g<GAMES; g++){
  bucket=[];
  const S=ns.sim.playOne(cfg, MODS, (4242+g*7919)>>>0, LINEUP);
  if(S.simStatus && !S.simStatus.valid){ invalid++; continue; }
  games++;
  (S.skillSample||[]).forEach(id=>{ if(acc[id]) acc[id].sampled++; });
  let learned=0;
  bucket.forEach(e=>{
    const id=e.skillId||e.requires;
    if(e.type==='SKILL_STARTED' && acc[e.skillId]){ acc[e.skillId].started++; acc[e.skillId].fee+=(e.price||0); }
    if(e.type==='SKILL_COMPLETED' && acc[e.skillId]){ acc[e.skillId].completed++; learned++; }
    if(e.type==='SKILL_DECAYED' && acc[e.skillId]) acc[e.skillId].decayed++;
    if(e.type==='SKILL_APPLIED' && acc[e.skillId]){ acc[e.skillId].applied++; acc[e.skillId].gainApplied+=(e.saved||0); }
    if(e.type==='SKILL_GATE_RESOLVED'){
      anyGate++;
      const req=e.requires||'';
      const ids = req.indexOf('family:')===0
        ? Object.keys(SK).filter(k=>SK[k].family===req.slice(7)) : [req];
      ids.forEach(k=>{ if(!acc[k]) return;
        if(e.have){ acc[k].gateHave++; acc[k].gainGate+=Math.max(0,e.gap||0); }
        else { acc[k].gateMiss++; acc[k].lostGate+=Math.max(0,e.gap||0); } });
    }
    if(e.type==='CAREER_SWITCHED') { const c=Object.keys(SK).find(k=>SK[k].secondCareer&&SK[k].secondCareer.professionId===e.to); if(c) acc[c].careerSwitch++; }
    if(e.type==='SECOND_CAREER_KEPT'){ const c=e.cardId; if(acc[c]) acc[c].careerKept++; }
  });
  learnedPerGame.push(learned);
}
// 每月費用：以「學成後平均還剩半局」粗估，只用來提醒有月費的技能真實成本更高
const med=a=>{const b=a.slice().sort((x,y)=>x-y);return b[Math.floor(b.length/2)]||0;};
const rows=Object.keys(SK).map(id=>{
  const a=acc[id], c=SK[id];
  const avgFee=a.started? a.fee/a.started : 0;
  const gain=a.gainGate+a.gainApplied;
  return { id, title:c.title, tier:c.tier, family:c.family, cost:c.cost, mo:c.recurringMonthly||0, turns:c.turns,
    進場率:+(a.sampled/games*100).toFixed(1), 學成率:+(a.completed/games/LINEUP.length*100).toFixed(1),
    平均學費:+avgFee.toFixed(1), 學成次數:a.completed, 過時:a.decayed,
    情境卡命中:a.gateHave, 情境卡錯過:a.gateMiss,
    有技能賺到:+a.gainGate.toFixed(0), 沒技能損失:+a.lostGate.toFixed(0),
    引擎折抵次數:a.applied, 引擎折抵金額:+a.gainApplied.toFixed(0),
    每次學成回收:a.completed? +(gain/a.completed).toFixed(1) : null,
    轉職:a.careerSwitch, 副業或保留:a.careerKept };
});
console.log(JSON.stringify({局數:games, 無效局:invalid, 每局平均學成技能數:+(learnedPerGame.reduce((s,x)=>s+x,0)/Math.max(1,games)).toFixed(2),
  每局技能情境卡觸發數:+(anyGate/Math.max(1,games)).toFixed(2), npcSkillCap:cfg.npcSkillCap, skillPerGame:cfg.skillPerGame, skillGatePerGame:cfg.skillGatePerGame}, null, 1));
console.log('');
const pad=(s,n)=>String(s===null?'-':s).padEnd(n);
console.log(pad('技能',16)+pad('級',6)+pad('學費',5)+pad('月',3)+pad('輪',3)+pad('進場%',7)+pad('學成%',7)+pad('命中',5)+pad('錯過',5)+pad('有技能賺',9)+pad('沒技能虧',9)+pad('引擎折抵',9)+pad('轉職',5)+pad('每次學成回收',12));
rows.sort((a,b)=>(b.每次學成回收||-1)-(a.每次學成回收||-1)).forEach(r=>{
  console.log(pad(r.id,16)+pad(r.tier,6)+pad(r.cost,5)+pad(r.mo,3)+pad(r.turns,3)+pad(r.進場率,7)+pad(r.學成率,7)+pad(r.情境卡命中,5)+pad(r.情境卡錯過,5)+pad(r.有技能賺到,9)+pad(r.沒技能損失,9)+pad(r.引擎折抵金額,9)+pad(r.轉職,5)+pad(r.每次學成回收,12));
});
