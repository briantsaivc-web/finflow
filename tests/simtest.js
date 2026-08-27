var tags = require('./test_content.json');
global.document={getElementById:function(id){return tags[id]!==undefined?{textContent:tags[id]}:null;}};
global.window={}; global.location={search:""};
global.localStorage={_d:{},getItem:function(){return null;},setItem:function(){},removeItem:function(){}};
var ns=require('./test_engine.js');
ns.configRegistry=JSON.parse(tags['config-default']);
ns.loadContent(function(id){return tags[id]?JSON.parse(tags[id]):null;});
var mods=["M1","M2","M3","M4","M6"];
var sweep=process.argv[2]?process.argv[2].split(",").map(Number):[1.0];
// 第二參數 rotate：座位輪換模式。
// 原因：sim.pickProfession(座位序) 依座位跨薪資帶取樣，而固定 lineup 會讓同一人格永遠坐同一個
// 座位、永遠拿到同一薪資帶的職業——人格間的自由率因此摻入職業偏誤。rotate 讓每個人格輪過四個
// 座位再合併，才是「人格」本身的效果。預設模式維持原樣，以便與歷史基準值比較。
var ROTATE = (process.argv[3]||"").indexOf("rotate")>=0;
var FIXED=[["NPC_SAFE","NPC_LEVER","NPC_VC","NPC_SAFE"]];
var ROT=[["NPC_SAFE","NPC_LEVER","NPC_VC","NPC_SAFE"],
         ["NPC_LEVER","NPC_VC","NPC_SAFE","NPC_LEVER"],
         ["NPC_VC","NPC_SAFE","NPC_LEVER","NPC_VC"],
         ["NPC_SAFE","NPC_VC","NPC_LEVER","NPC_SAFE"]];
sweep.forEach(function(mult){
  var cfg=ns.buildConfig(ns.configRegistry); cfg.assetIncomeMult=mult;
  var lineups = ROTATE?ROT:FIXED, per = ROTATE?100:200;
  var turns=[], acc={};
  var lastOuter=null, oxAgg={dur:[],grads:0,ff:0,fp:0,pp:0,byCat:{}};
  lineups.forEach(function(lu,li){
    var r=ns.sim.run({games:per,config:cfg,modules:mods,seedBase:1+li*131,lineup:lu});
    if(r.outerStats){ lastOuter=lastOuter||{}; var o=r.outerStats;
      oxAgg.grads+=o.grads; oxAgg.ff+=o.freefallRate*o.grads;
      // 以逐局彙整近似：僅單 lineup 時 lastOuter 即該結果；多 lineup 時取加權
      lastOuter=o; }
    r.rows.forEach(function(x){ turns.push(x.turns); });
    r.summary.forEach(function(s){
      var a=acc[s.personality]=acc[s.personality]||{games:0,free:0,bank:0,ft:[],nw:[]};
      a.games+=s.games; a.free+=s.freeRate*s.games; a.bank+=s.bankruptRate*s.games;
      if(s.medianFreeTurn) a.ft.push(s.medianFreeTurn);
      if(s.medianNetWorth) a.nw.push(s.medianNetWorth);
    });
  });
  turns.sort(function(a,b){return a-b;});
  var medTurn=turns[Math.floor(turns.length/2)];
  console.log("=== assetIncomeMult="+mult+"　全局中位局長="+medTurn+" 輪"+(ROTATE?"　[座位輪換]":"　[固定座位]")+" ===");
  if(lastOuter){ var o=lastOuter;
    console.log("  外圈：耗時中位 "+o.outerMedian+" 輪（P90 "+o.outerP90+"）　圓夢局 "+o.wins+"　畢業人次 "+o.grads+
      "　跌落率 "+(o.freefallRate*100).toFixed(0)+"%　免費點占比 "+(o.freeShare*100).toFixed(0)+"%　四類中位 "+JSON.stringify(o.catMedian)); }
  Object.keys(acc).forEach(function(k){ var a=acc[k];
    var med=function(arr){ if(!arr.length) return "—"; var b=arr.slice().sort(function(x,y){return x-y;}); return Math.round(b[Math.floor(b.length/2)]); };
    console.log("  "+k+": 自由率 "+(a.free/a.games*100).toFixed(0)+"%  中位達成輪 "+med(a.ft)+
      "  破產率 "+(a.bank/a.games*100).toFixed(0)+"%  淨值中位 "+med(a.nw)+"　（n="+a.games+"）");
  });
});
