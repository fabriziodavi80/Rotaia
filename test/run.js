// Test di Max G3 Saving con dati sintetici (nessun dato personale). Uso: node test/run.js
// Per un caso reale: caricare un backup JSON dell'utente con dati(backup.data) (vedi in fondo).
"use strict";
process.env.TZ = "Europe/Rome";   // le date dell'app sono locali
var load = require("./harness").load;

var ok = 0, ko = 0, sezione = "";
function gruppo(n){ sezione = n; console.log("\n# " + n); }
function check(cond, nome, extra){
  if(cond){ ok++; console.log("  ✓ " + nome); }
  else { ko++; console.log("  ✗ " + nome + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
function vicino(a, b, eps){ return typeof a === "number" && Math.abs(a - b) < (eps || 0.01); }
function ts(s){ return new Date(s).getTime(); }
function id(s){ return ts(s) + "-test" + Math.floor(Math.random()*1000); }

var PARAMS = { prezzoBenzina: 2, consumoAuto: 10, prezzoElettrico: 0.3, capacitaBatteria: 0.6, autonomiaReale: 30,
  costoIniziale: 700, manutenzioneAnnua: 90, kmAnnui: 1500, distanzaMax: 18, obiettivoMensile: 20 };
function trip(date, mezzo, km, extra){
  var t = { id: id(date + "T12:00"), date: date, mezzo: mezzo, km: km, pb: 2, pe: 0.3 };
  for(var k in extra || {}) t[k] = extra[k];
  return t;
}
function read(s, km, soc, extra){
  var r = { ts: ts(s), date: s.slice(0,10), km: km, soc: soc, mAh: Math.round(12750 * soc / 100), fullmAh: 12750, volt: 46 + soc / 20, plugged: false };
  for(var k in extra || {}) r[k] = extra[k];
  return r;
}
// Dati base: un recupero storico a settembre, uso normale tra settembre e ottobre, ricarica il 26/10
function dati(o){
  o = o || {};
  var st = {
    rotaia_params_v2: PARAMS,
    rotaia_trips_v1: o.trips || [
      trip("2026-09-20", "monopattino", 50, { rec: true }),
      trip("2026-09-21", "monopattino", 10),
      trip("2026-09-25", "auto", 5),
      trip("2026-10-05", "monopattino", 12),
      trip("2026-10-26", "monopattino", 14),
      trip("2026-10-27", "monopattino", 15),
      trip("2026-10-27", "auto", 100)
    ],
    rotaia_charges_v1: o.charges || [{ id: id("2026-10-26T19:00"), date: "2026-10-26", km: 300 }],
    rotaia_g3reads_v1: o.reads || [
      read("2026-10-26T18:55", 300, 20, { plugged: false, cycA: 7 }),
      read("2026-10-27T18:30", 315, 52, { cycA: 8 })
    ],
    rotaia_odo_v1: o.odo !== undefined ? o.odo : { km: 315, date: "2026-10-27", ts: ts("2026-10-27T18:30") },
    rotaia_snap_v1: "1", rotaia_rec_mig_v1: "1", rotaia_manut_mig_v1: "1"
  };
  if(o.spese) st.rotaia_spese_v1 = o.spese;
  if(o.soc) st.rotaia_g3soc_v1 = o.soc;
  for(var k in o.extra || {}) st[k] = o.extra[k];
  return st;
}
function avvia(o, now, lettura){ return load({ storage: dati(o), now: now, lettura: lettura }); }

// ---------------------------------------------------------------------------
gruppo("Promemoria lettura");
(function(){
  var a = avvia({}, "2026-10-28T20:00");
  var pr = a.t.promemoriaLettura();
  check(pr && pr.tipo === "sera", "sera senza letture di oggi: promemoria serale", pr);
  check(a.el("readReminder").style.display === "flex", "scheda visibile in Dashboard");
  check(a.el("reminderCard").style.display === "none", "il promemoria generico lascia il posto");
  check(a.el("readReminderSkip").textContent === "Oggi non l'ho usato", "pulsante «Oggi non l'ho usato»");

  a = avvia({}, "2026-10-28T17:00");
  check(a.t.promemoriaLettura() === null, "alle 17 con promemoria dalle 19: niente");
  a = avvia({ extra: { rotaia_readrem_v1: { ora: 17 } } }, "2026-10-28T17:30");
  check(a.t.promemoriaLettura() && a.t.promemoriaLettura().tipo === "sera", "ora impostata alle 17: compare alle 17:30");
  a = avvia({ extra: { rotaia_readrem_v1: { ora: 0 } } }, "2026-10-28T21:00");
  check(a.t.promemoriaLettura() === null, "promemoria spento: niente");

  var r2 = dati().rotaia_g3reads_v1.concat([read("2026-10-28T19:30", 330, 30)]);
  a = avvia({ reads: r2 }, "2026-10-28T20:00");
  check(a.t.promemoriaLettura() === null, "già letto oggi pomeriggio: niente");
  a = avvia({ reads: dati().rotaia_g3reads_v1.concat([read("2026-10-28T08:00", 315, 52)]) }, "2026-10-28T20:00");
  check(a.t.promemoriaLettura() && a.t.promemoriaLettura().tipo === "sera", "letto solo stamattina prima di uscire: promemoria serale");

  a = avvia({ odo: null }, "2026-10-28T20:00");
  check(a.t.promemoriaLettura() === null, "Bluetooth mai usato (nessun riferimento km): niente");
})();
(function(){
  // ultima lettura l'altro ieri: ieri non è stata letta
  var r0 = [read("2026-10-26T18:55", 300, 20)], o0 = { km: 300, date: "2026-10-26", ts: ts("2026-10-26T18:55") };
  var a = avvia({ reads: r0, odo: o0 }, "2026-10-28T08:00");
  var pr = a.t.promemoriaLettura();
  check(pr && pr.tipo === "mattina", "mattina, ieri nessuna lettura: promemoria del mattino", pr);
  a = avvia({ reads: r0.concat([read("2026-10-27T07:50", 300, 20)]), odo: o0 }, "2026-10-28T08:00");
  check(a.t.promemoriaLettura() && a.t.promemoriaLettura().tipo === "mattina", "ieri letto solo la mattina: promemoria del mattino");
  a = avvia({}, "2026-10-28T08:00");
  check(a.t.promemoriaLettura() === null, "mattina, letto ieri alle 18:30 (prima dell'ora del promemoria): niente");
  a = avvia({ reads: r0, odo: o0 }, "2026-10-28T08:00");
  check(a.el("readReminderSkip").textContent === "Ieri non l'ho usato", "pulsante «Ieri non l'ho usato»");
  var r2 = dati().rotaia_g3reads_v1.concat([read("2026-10-27T21:15", 318, 45)]);
  a = avvia({ reads: r2 }, "2026-10-28T08:00");
  check(a.t.promemoriaLettura() === null, "mattina, letto ieri sera alle 21:15: niente");
  a = avvia({}, "2026-10-28T13:00");
  check(a.t.promemoriaLettura() === null, "dalle 12 alle 19: niente");

  // Rimandare la sera spegne anche il promemoria della mattina dopo, non quello della sera dopo
  a = avvia({}, "2026-10-28T20:00");
  a.el("readReminderSkip").click();
  check(a.t.promemoriaLettura() === null && a.el("readReminder").style.display === "none", "«Oggi non l'ho usato» nasconde la scheda");
  var salvato = a.store.rotaia_readrem_skip_v1;
  a = avvia({ extra: { rotaia_readrem_skip_v1: salvato } }, "2026-10-29T08:00");
  check(a.t.promemoriaLettura() === null, "la mattina dopo: niente (la sera prima è stata rimandata)");
  a = avvia({ extra: { rotaia_readrem_skip_v1: salvato } }, "2026-10-29T20:00");
  check(a.t.promemoriaLettura() && a.t.promemoriaLettura().tipo === "sera", "la sera dopo: di nuovo il promemoria");

  // Pausa: monopattino fermo da più di 14 giorni
  a = avvia({}, "2026-11-12T20:00");
  check(a.t.promemoriaLettura() === null, "16 giorni senza letture né spostamenti: promemoria in pausa");
  a = avvia({ trips: dati().rotaia_trips_v1.concat([trip("2026-11-10", "monopattino", 5)]) }, "2026-11-12T20:00");
  check(a.t.promemoriaLettura() && a.t.promemoriaLettura().tipo === "sera", "uno spostamento in monopattino negli ultimi 14 giorni: promemoria attivo");

  // «Leggi ora» apre Aggiungi e avvia la lettura Bluetooth
  a = avvia({}, "2026-10-28T20:00", { km: 330, soc: 30, plugged: false });
  a.el("readReminderBtn").click();
  check(a.el("view-add").classList.contains("active"), "«Leggi ora» apre Aggiungi");
  check(a.letture.length === 1 && a.letture[0] === "read", "«Leggi ora» avvia la lettura dal monopattino", a.letture);

  // Tornando in primo piano la Dashboard si aggiorna
  a = avvia({}, "2026-10-28T17:00");
  check(a.el("readReminder").style.display === "none", "alle 17 la scheda è nascosta");
  a.setNow("2026-10-28T20:05");
  a.document.dispatch("visibilitychange");
  check(a.el("readReminder").style.display === "flex", "riaprendo l'app alle 20:05 la scheda compare");
})();

// ---------------------------------------------------------------------------
gruppo("Confronto tra mesi e stagioni");
(function(){
  var a = avvia({ spese: [{ id: id("2026-10-10T10:00"), date: "2026-10-10", desc: "Gomma", amount: 5 }] }, "2026-10-28T12:00");
  var t = a.t, rows = t.confrontoPeriodi("mese");
  check(rows.length === 2 && rows[0].nome === "Ottobre 2026" && rows[1].nome === "Settembre 2026", "mesi dal più recente", rows.map(function(r){ return r.nome; }));
  var tot = t.trips.reduce(function(s, x){ return s + t.tripSaving(x); }, 0) - 5;
  check(vicino(rows[0].netto + rows[1].netto, tot), "somma dei netti = netto totale (spese tolte)");
  check(rows[1].rec === true && rows[0].rec === false, "settembre segnato come recupero");
  var sep = rows[1];
  // settembre: dal primo spostamento normale (21/09) al 30/09 = 10 giorni, recupero escluso
  var normSep = t.trips.filter(function(x){ return x.date.slice(0,7) === "2026-09" && !x.rec; })
    .reduce(function(s, x){ return s + t.tripSaving(x); }, 0);
  check(sep.giorni === 10 && vicino(sep.alGiorno, normSep / 10), "€/giorno di settembre su 10 giorni, senza il recupero", sep);
  check(rows[0].giorni === 28 && rows[0].inCorso, "ottobre in corso: 28 giorni");
  check(rows[0].kmT === 41 && rows[0].kmR === 100, "km di ottobre per mezzo", [rows[0].kmT, rows[0].kmR]);
  check(rows[0].giorniT === 3, "giorni in monopattino di ottobre");
  check(rows[0].delta !== null, "variazione sul mese precedente calcolata");
  var st = t.confrontoPeriodi("stagione");
  check(st.length === 1 && st[0].nome === "Autunno 2026", "settembre e ottobre: Autunno 2026", st.map(function(r){ return r.nome; }));
  a = avvia({ trips: dati().rotaia_trips_v1.concat([trip("2026-12-03", "monopattino", 4), trip("2027-01-15", "monopattino", 6)]) }, "2027-01-20T12:00");
  st = a.t.confrontoPeriodi("stagione");
  check(st[0].nome === "Inverno 2026-27" && st[0].kmT === 10, "dicembre e gennaio nello stesso inverno", st[0]);
  // stesso mese dell'anno prima
  a = avvia({ trips: dati().rotaia_trips_v1.concat([trip("2027-10-02", "monopattino", 8)]) }, "2027-10-05T12:00");
  rows = a.t.confrontoPeriodi("mese");
  check(rows[0].nome === "Ottobre 2027" && rows[0].annoPrima !== null, "ottobre 2027 confrontato con ottobre 2026");
  a.t.renderConfronto();
  check(/Ottobre 2027/.test(a.el("cmpList").innerHTML) && /anno prima/.test(a.el("cmpList").innerHTML), "elenco disegnato");
})();

// ---------------------------------------------------------------------------
gruppo("Grafico mensile");
(function(){
  var a = avvia({}, "2026-10-28T12:00"), t = a.t;
  var b = t.monthlyBuckets();
  check(b.length === 6 && b[5].key === "2026-10" && b[0].key === "2026-05", "ultimi 6 mesi fino a ottobre");
  var ott = t.trips.filter(function(x){ return x.date.slice(0,7) === "2026-10"; }).reduce(function(s, x){ return s + t.tripSaving(x); }, 0);
  check(vicino(b[5].value, ott), "valore di ottobre");
  check(a.el("shareChartBtn").style.display === "block", "pulsante di condivisione visibile");
  a = avvia({ trips: [] }, "2026-10-28T12:00");
  check(a.el("shareChartBtn").style.display === "none", "senza spostamenti il pulsante è nascosto");
})();

// ---------------------------------------------------------------------------
gruppo("Batteria");
(function(){
  // lettura di oggi senza ricarica dopo: vale come carica attuale
  var reads = [read("2026-10-26T18:55", 300, 20), read("2026-10-27T18:30", 315, 52), read("2026-10-28T08:00", 315, 52), read("2026-10-28T18:00", 328, 31)];
  var a = avvia({ reads: reads, soc: { soc: 31, ts: ts("2026-10-28T18:00"), km: 328, plugged: false } }, "2026-10-28T19:00");
  var s = a.t.ultimaLetturaSoc();
  check(s && !s.superata && !s.plugged, "lettura di oggi valida", s);
  check(a.t.stimaKmDaBatteria() !== null, "stima km dalla batteria letta");

  // ricarica registrata dopo la lettura: superata
  var ch = [{ id: id("2026-10-26T19:00"), date: "2026-10-26", km: 300 }, { id: id("2026-10-28T18:10"), date: "2026-10-28", km: 328 }];
  a = avvia({ reads: reads, charges: ch, soc: { soc: 31, ts: ts("2026-10-28T18:00"), km: 328, plugged: false } }, "2026-10-28T19:00");
  check(a.t.ultimaLetturaSoc().superata && a.t.stimaKmDaBatteria() === null, "ricarica dopo la lettura: % superata");
  check(a.el("battBar").style.width === "100%", "barra piena dopo la ricarica", a.el("battBar").style.width);

  // lettura col caricatore collegato, salvata senza km (versione vecchia): km e caricatore dallo storico
  var r3 = reads.concat([read("2026-10-28T18:05", 328, 32, { plugged: true })]);
  ch = [{ id: id("2026-10-26T19:00"), date: "2026-10-26", km: 300 }, { id: id("2026-10-28T18:04"), date: "2026-10-28", km: 328 }];
  a = avvia({ reads: r3, charges: ch, soc: { soc: 32, ts: ts("2026-10-28T18:05") } }, "2026-10-28T19:00");
  s = a.t.ultimaLetturaSoc();
  check(s.plugged && s.km === 328 && s.superata, "lettura col caricatore: recuperati km e caricatore, superata", s);
  check(/all'attacco del caricatore/.test(a.el("battReal").textContent), "riga «all'attacco del caricatore»", a.el("battReal").textContent);
  check(a.el("battBar").style.width === "100%", "barra piena");

  // uscita dopo la ricarica (giorno dopo): km dall'ultima ricarica
  a = avvia({ reads: r3, charges: ch, soc: { soc: 32, ts: ts("2026-10-28T18:05") },
    trips: dati().rotaia_trips_v1.concat([trip("2026-10-29", "monopattino", 9)]) }, "2026-10-29T19:00");
  check(a.t.kmDaUltimaRicarica() === 9, "9 km dopo la ricarica");
  var m = a.t.consumoMisurato(), aut = m.enough ? a.t.params.capacitaBatteria * 1000 / m.whKm : a.t.params.autonomiaReale;
  var atteso = Math.round((1 - 9 / aut) * 100) + "%";
  check(a.el("battBar").style.width === atteso, "barra ridotta dei 9 km (" + atteso + " su " + Math.round(aut) + " km di autonomia)", a.el("battBar").style.width);

  // nessuna ricarica
  a = avvia({ charges: [] }, "2026-10-28T12:00");
  check(a.el("battBar").style.width === "0%" && /prima ricarica/.test(a.el("battNote").textContent), "senza ricariche: invito a registrarne una");
})();

// ---------------------------------------------------------------------------
gruppo("Cicli e km letti");
(function(){
  var reads = [read("2026-10-19T08:00", 280, 30, { cycA: 6 }), read("2026-10-22T08:00", 290, 60, { cycA: 7 })];
  var a = avvia({ reads: reads, charges: [{ id: id("2026-10-19T09:00"), date: "2026-10-19", km: 280 }] }, "2026-10-22T12:00");
  var c = a.t.cicliInfo();
  check(c.n === 7 && c.confermato, "cicli confermati quando salgono dopo una ricarica", c);

  var t = a.t;
  check(t.giornoProbabile("2026-10-21", "2026-10-22", 8) === "2026-10-21", "mattina: km su ieri");
  check(t.giornoProbabile("2026-10-21", "2026-10-22", 15) === "2026-10-22", "pomeriggio: km su oggi");
  a = avvia({}, "2026-10-28T20:00");
  var k = a.t.kmDaLettura({ km: 330.5 });
  check(k.tipo === "nuovi" && vicino(k.km, 15.5), "km letti: contachilometri − riferimento", k);
})();

console.log("\n" + ok + " superati, " + ko + " falliti");
process.exit(ko ? 1 : 0);
