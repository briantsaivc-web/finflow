// DOM stub for Node
var tags = require('./test_content.json');
global.document = {
  getElementById: function(id){ return tags[id]!==undefined ? {textContent:tags[id]} : null; },
  createElement: function(){ var e={style:{},dataset:{},classList:{add:function(){},remove:function(){},toggle:function(){}},
    appendChild:function(c){return c;},remove:function(){},setAttribute:function(){},addEventListener:function(){},
    querySelectorAll:function(){return [];},cloneNode:function(){return this;},getBoundingClientRect:function(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};},select:function(){}};
    Object.defineProperty(e,'innerHTML',{set:function(){},get:function(){return "";}});
    Object.defineProperty(e,'textContent',{set:function(){},get:function(){return "";}}); return e; },
  addEventListener:function(){}, readyState:"complete", body:{innerHTML:""}
};
global.window = {}; global.location={search:""};
global.localStorage={ _d:{}, getItem:function(k){return this._d[k]||null;}, setItem:function(k,v){this._d[k]=v;}, removeItem:function(k){delete this._d[k];} };
var ns = require('./test_engine.js');
ns.configRegistry = JSON.parse(tags['config-default']);
ns.loadContent(function(id){ return tags[id]?JSON.parse(tags[id]):null; });
var r = ns.selftest.run(false);
process.exit(r.pass===r.total?0:1);
