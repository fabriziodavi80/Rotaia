// Harness di test per Max G3 Saving: esegue lo script di index.html in Node con un DOM simulato.
// Nessuna dipendenza (niente npm). Uso: node test/run.js
//
// load({ storage, now, g3 }) restituisce { t, el, store }:
//  - t: tutte le funzioni dichiarate al primo livello dello script (renderDashboard, tripSaving, …)
//       più i getter trips, charges, params, spese;
//  - el(id): l'elemento simulato con quell'id (textContent, style.display, innerHTML…);
//  - store: il localStorage simulato (oggetto chiave → stringa).
// storage: oggetto chiave → valore (gli oggetti vengono serializzati in JSON).
// now: istante simulato (ms o stringa "AAAA-MM-GGTHH:MM" in ora locale); new Date() e Date.now() lo usano.
// g3: sostituisce l'oggetto G3BLE (di default: supportato, readScooter restituisce opts.lettura).
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function estraiScript(){
  var re = /<script>([\s\S]*?)<\/script>/g, m, last = null;
  while((m = re.exec(HTML))) last = m[1];
  if(!last) throw new Error("script non trovato in index.html");
  var nomi = [], rf = /^  function (\w+)\(/gm, f;
  while((f = rf.exec(last))) if(nomi.indexOf(f[1]) < 0) nomi.push(f[1]);
  var exp = "window.__t = {" + nomi.map(function(n){ return n + ":" + n; }).join(",")
    + ", get trips(){ return trips; }, get charges(){ return charges; }, get params(){ return params; }, get spese(){ return spese; } };\n";
  var fine = last.lastIndexOf("})();");
  if(fine < 0) throw new Error("chiusura })(); non trovata");
  return last.slice(0, fine) + exp + last.slice(fine);
}
var SCRIPT = estraiScript();

function creaElemento(id){
  var listeners = {}, cache = {}, attrs = {}, classi = {};
  var e = {
    id: id || "", tagName: "DIV", textContent: "", innerHTML: "", value: "", checked: false, disabled: false,
    style: {}, dataset: {}, children: [],
    classList: {
      add: function(c){ classi[c] = true; }, remove: function(c){ delete classi[c]; },
      contains: function(c){ return !!classi[c]; },
      toggle: function(c, on){ if(on === undefined) on = !classi[c]; if(on) classi[c] = true; else delete classi[c]; return on; }
    },
    addEventListener: function(tipo, fn){ (listeners[tipo] = listeners[tipo] || []).push(fn); },
    dispatch: function(tipo, ev){ (listeners[tipo] || []).forEach(function(fn){ fn.call(e, ev || { preventDefault: function(){}, target: e }); }); },
    click: function(){ if(!e.disabled) e.dispatch("click"); },
    querySelector: function(sel){ return cache[sel] || (cache[sel] = creaElemento()); },
    querySelectorAll: function(){ return []; },
    appendChild: function(c){ e.children.push(c); return c; },
    insertAdjacentElement: function(){}, remove: function(){}, focus: function(){}, select: function(){},
    setSelectionRange: function(){}, scrollIntoView: function(){},
    setAttribute: function(k, v){ attrs[k] = String(v); }, getAttribute: function(k){ return k in attrs ? attrs[k] : null; },
    removeAttribute: function(k){ delete attrs[k]; },
    getContext: function(){ return null; }
  };
  return e;
}

function load(opts){
  opts = opts || {};
  var RealDate = Date;
  var now = typeof opts.now === "string" ? new RealDate(opts.now).getTime() : (opts.now || RealDate.now());
  function FakeDate(){
    var a = Array.prototype.slice.call(arguments);
    if(!(this instanceof FakeDate)) return new RealDate(now).toString();
    if(a.length === 0) return new RealDate(now);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(a)))();
  }
  FakeDate.now = function(){ return now; };
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;

  var store = {};
  Object.keys(opts.storage || {}).forEach(function(k){
    var v = opts.storage[k];
    store[k] = typeof v === "string" ? v : JSON.stringify(v);
  });
  var localStorage = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v){ store[k] = String(v); },
    removeItem: function(k){ delete store[k]; }
  };

  var elems = {};
  function el(id){ return elems[id] || (elems[id] = creaElemento(id)); }
  var docListeners = {};
  var document = {
    getElementById: el,
    querySelector: function(sel){
      var m = /^#([\w-]+)\s+(.+)$/.exec(sel);
      if(m) return el(m[1]).querySelector(m[2]);
      if(/^#[\w-]+$/.test(sel)) return el(sel.slice(1));
      return null;
    },
    querySelectorAll: function(){ return []; },
    createElement: function(tag){ var e = creaElemento(); e.tagName = String(tag).toUpperCase(); return e; },
    documentElement: creaElemento("html"),
    body: creaElemento("body"),
    visibilityState: "visible",
    addEventListener: function(tipo, fn){ (docListeners[tipo] = docListeners[tipo] || []).push(fn); },
    dispatch: function(tipo){ (docListeners[tipo] || []).forEach(function(fn){ fn(); }); },
    execCommand: function(){ return true; }
  };

  var letture = [];
  var g3 = opts.g3 || {
    supported: function(){ return true; },
    getKey: function(){ return null; }, setKey: function(){ return true; }, forgetKey: function(){},
    log: function(){ return ""; },
    readScooter: function(mode){ letture.push(mode); return Promise.resolve(opts.lettura || { km: 0, soc: 50, plugged: false }); }
  };

  var toasts = [];
  var window = {
    location: { search: "", reload: function(){} },
    addEventListener: function(){},
    matchMedia: function(){ return { matches: false, addEventListener: function(){}, addListener: function(){} }; }
  };
  var ctx = {
    window: window, document: document, localStorage: localStorage, G3BLE: g3,
    navigator: {}, console: console, Date: FakeDate, Math: Math, JSON: JSON, Promise: Promise,
    setTimeout: function(fn){ return 0; }, clearTimeout: function(){}, setInterval: function(){ return 0; }, clearInterval: function(){},
    URLSearchParams: URLSearchParams, confirm: function(){ return true; }, alert: function(){},
    getComputedStyle: function(){ return { getPropertyValue: function(){ return ""; } }; },
    Blob: function(){}, URL: { createObjectURL: function(){ return "blob:"; }, revokeObjectURL: function(){} },
    parseInt: parseInt, parseFloat: parseFloat, isFinite: isFinite, isNaN: isNaN, String: String, Number: Number,
    Array: Array, Object: Object, RegExp: RegExp, Error: Error, Infinity: Infinity
  };
  window.window = window; window.document = document; window.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext("var self = window; (function(){ var w = window; for(var k in w){ if(!(k in this)) this[k] = w[k]; } })();", ctx);
  vm.runInContext(SCRIPT, ctx, { filename: "index.html<script>" });
  var t = ctx.window.__t;
  // i toast si leggono dall'elemento "toast"
  return { t: t, el: el, store: store, document: document, ctx: ctx, letture: letture, toasts: toasts,
    setNow: function(ms){ now = typeof ms === "string" ? new RealDate(ms).getTime() : ms; } };
}

module.exports = { load: load };
