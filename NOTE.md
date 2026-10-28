# Max G3 Saving — note di passaggio per una nuova chat

Aggiornato: 28 ottobre 2026, versione 30 (`rotaia-cache-v30`). Leggere tutto prima di toccare il codice.

App personale (PWA, pagina unica) che confronta gli spostamenti in monopattino (Ninebot Max G3) con quelli in auto, calcola il risparmio e legge i dati del monopattino via Bluetooth. Un solo utente, nessun server, nessun account. Interfaccia e chat in italiano.

- Repository: `fabriziodavi80/Rotaia` (il vecchio nome `rotaia` reindirizza; il push funziona, il messaggio "repository moved" si può ignorare).
- Online: https://fabriziodavi80.github.io/Rotaia/
- Telefono dell'utente: vivo X300 Ultra, Chrome Android.

---

## 1. Stato attuale dell'app

### File
| File | Ruolo |
|---|---|
| `index.html` | Tutta l'app: HTML, CSS e JS in un unico `<script>` finale (circa 2.900 righe) |
| `g3ble.js` | Bluetooth col Max G3: cifratura, abbinamento, lettura registri, lettura diagnostica |
| `sw.js` | Service worker. `CACHE_NAME = "rotaia-cache-v30"` |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | PWA |
| `NOTE.md` | Questo file |

### Schermate
- **Dashboard:** risparmio netto (numero principale), riga spese di manutenzione già tolte, lordo, barra di ammortamento, data di pareggio, proiezione annua, km per mezzo, % d'uso, CO2, serie di giorni, obiettivo mensile, grafici mensile e cumulato, promemoria (nulla registrato oggi, backup). Schede **Stato batteria** e **Batteria monopattino** (barra, km dall'ultima ricarica, autonomia, km alla prossima ricarica, ultima % letta, consumo misurato, Registra ricarica, Storico ricariche).
- **Aggiungi:** data, mezzo, km, «Leggi km dal monopattino» (Bluetooth), spunta «Recupero di km passati», per l'auto «Si poteva fare in monopattino?» (Automatico/Sì/No), tragitti salvati.
- **Storico:** filtri mese e mezzo con **riquadro dei totali** quando un filtro è attivo, elenco modificabile, scheda **Spese di manutenzione**, backup (JSON completo, condivisione, CSV, import).
- **Parametri:** prezzi, consumo auto, batteria, autonomia, costo d'acquisto, costi fissi annui, km annui, distanza massima in monopattino, obiettivo mensile; prezzi attuali su tutto lo storico; Bluetooth (chiave, lettura diagnostica); **Guida rapida** (aggiornata al 28/10); riga **«Versione NN · data»** in fondo.

### Come si calcola il risparmio
- Per spostamento: `tripSaving = costo dell'alternativa − costo del mezzo usato`.
  - Monopattino: positivo.
  - Auto: negativo **solo se evitabile** (`autoEvitabile`): scelta esplicita `fatt` true/false, altrimenti automatico se `km <= min(distanzaMax, autonomiaReale)`. Non evitabile = 0 € e 0 CO2.
- Costo al km monopattino = `capacitaBatteria / autonomiaReale × pe + manutenzioneAnnua / kmAnnuiUsati`. Auto = `consumoAuto / 100 × pb`.
- `manutenzioneAnnua` = **solo costi fissi certi** (assicurazione 91 €/anno). `kmAnnuiUsati`: km reali in monopattino degli ultimi 365 giorni quando c'è almeno un anno di dati (dal 22/09/2027 circa), altrimenti `params.kmAnnui` (1.500).
- **Netto** = somma di `tripSaving` − spese di manutenzione registrate. **Lordo** = solo spostamenti in monopattino.
- **Proiezione annua** = risparmio degli spostamenti non-recupero / giorni di calendario dal primo spostamento non-recupero a oggi × 365. Le spese non entrano.
- **Pareggio** = oggi + (costo d'acquisto − netto) / media giornaliera.
- Prezzi `pb`/`pe` bloccati su ogni spostamento; consumo, autonomia e costi fissi al km si applicano anche al passato.

### Parametri dell'utente (28/10)
Benzina 2,13 €/l, auto 10,8 l/100 km, elettricità 0,30 €/kWh, batteria 0,597 kWh, autonomia 34 km (consumo misurato ≈ 18 Wh/km su ≈ 49 km → ≈ 33 km), costo d'acquisto 773,18 €, costi fissi 91 €/anno, km annui 1.500, distanza massima 18 km, obiettivo mensile 20 €.

### Batteria e letture Bluetooth
- **Autonomia, in ordine di priorità:** consumo misurato (≥ 5 km), poi media dei cicli di ricarica, poi parametro.
- **Consumo misurato** (`consumoMisurato`): coppie di letture consecutive con km in aumento ed energia in calo; scartate le coppie col caricatore collegato, con una ricarica registrata in mezzo o fuori scala (5-45 Wh/km).
- **% letta come carica attuale** (`ultimaLetturaSoc`, `stimaKmDaBatteria`): vale solo se è di oggi, non è stata fatta col caricatore collegato e non è **superata da una ricarica**. È superata se una ricarica è stata registrata dopo la lettura **oppure** se l'ultima ricarica ha km ≥ km della lettura (il monopattino non si è più mosso). Km e caricatore si recuperano dallo storico letture se mancano (letture vecchie). Altrimenti barra e stima partono dai km dall'ultima ricarica.
- **Leggi km (Aggiungi)** (`kmDaLettura`): km = contachilometri − riferimento (`rotaia_odo_v1`) − km inseriti a mano dopo il riferimento. Se il riferimento è di un giorno precedente, preseleziona il giorno più probabile (`giornoProbabile`: prima delle 12 «Ieri», poi «Oggi») con pulsanti per cambiarlo, senza bloccare il salvataggio.
- **Ricarica e km con una lettura:** da «Registra ricarica» compare «Registra anche N km in monopattino» (spuntato, col giorno): si salvano insieme. Da Aggiungi col caricatore collegato, il pulsante «salva i km e registra la ricarica» registra entrambi con un tocco.
- **Stato batteria:** salute BMS, capacità piena (più capacità reale e usura % se un registro candidato scende), carica residua, tensione, scarto tra le 13 celle, temperatura, ore di guida e velocità media, cicli («da confermare» finché non salgono a cavallo di una ricarica), grafico dello scarto nel tempo, avviso se scarto > 50 mV o temperatura ≥ 45 °C.

### Registri Bluetooth verificati (indici in parole da 2 byte)
VCU `0x16`, BMS `0x07`. Un blocco da 16 byte letto da `N` copre le parole `N`..`N+7`.

| Dato | Board | Indice | Note |
|---|---|---|---|
| Km totali | VCU | `0x62` | u32 / 10 |
| % batteria | VCU | `0x55` | u16 |
| Caricatore collegato / in carica | VCU | `0x1F` bit 6 / `0x1C` bit 2 | |
| Secondi di guida / di accensione | VCU | `0x66` / `0x64` | u32 |
| Seriale e secondo codice | VCU | `0x10`..`0x16`, `0x20`..`0x27` | testo ASCII |
| Tensione pacco | BMS | `0x8C` | u16 / 100 |
| Corrente, salute | BMS | `0x8D`, `0x8E` | corrente con segno / 100; salute sempre 100 |
| Capacità piena | BMS | `0x13` | u16 × 10 mAh = 12.750 |
| Capacità reale? | BMS | `0x5A`, `0x8A` | salvati come `cap5A`, `cap8A`; finora uguali a `0x13` |
| mAh residui | BMS | `0x5B` (× 10), `0x91` (preciso) | |
| Temperature | BMS | `0x96`..`0x9C` | °C; 255 = sensore assente |
| Celle (13) | BMS | `0xA0`..`0xAC` | mV |
| Cicli di carica | BMS | `0x59` (`cycA`) | quasi certo: 6 fisso dal 7 al 19/10 senza ricariche |
| Non è un contatore | BMS | `0x92` (`cycB`) | oscilla senza ricariche |
| Tabella tensione/carica | BMS | `0x15`..`0x1E` | non sono celle |

**Nessun orologio** nel monopattino (diagnostica del 24/10, nessun valore vicino all'ora attuale): la data dei km non si può ricavare dal monopattino.

### Dati salvati (`localStorage`)
- Dati: `rotaia_trips_v1` (spostamenti `{id,date,mezzo,km,pb,pe,fatt?,rec?}`), `rotaia_charges_v1` (`{id,date,km}`), `rotaia_spese_v1` (`{id,date,desc,amount}`), `rotaia_routes_v1`, `rotaia_params_v2`.
- Letture: `rotaia_g3reads_v1` (max 300, con `cellD`, `tMax`, `cycA`, `cycB`, `cap5A`, `cap8A`, `rideS`, `plugged`), `rotaia_g3health_v1` (ultima lettura dettagliata), `rotaia_g3soc_v1` (`{soc,ts,km,plugged}`), `rotaia_odo_v1` (riferimento km `{km,date,ts,skipId}`).
- Varie: `rotaia_theme_v1`, `rotaia_last_backup_v1`, `rotaia_backup_snooze_v1`; flag di migrazione `rotaia_snap_v1`, `rotaia_rec_mig_v1`, `rotaia_manut_mig_v1`.
- Bluetooth: `rotaia_g3_key_v1` (chiave di abbinamento, **mai nel backup**), `rotaia_g3_pending_v1`, `rotaia_g3_gen_v1`, `rotaia_g3_device_v1`, `rotaia_g3_bms_v1`.
- Backup completo JSON: `trips`, `charges`, `routes`, `params`, `spese`, `reads`, `odo`, `soc`.

---

## 2. Decisioni e vincoli

### Decisioni dell'utente
- **Sola lettura sul monopattino:** nessuna scrittura di registri, impostazioni o firmware. L'utente non usa l'app Segway; usa SHU 4.2.1 solo per i parametri e aggiorna il firmware solo se ampiamente testato.
- **Netto come numero principale**; l'auto pesa solo se il viaggio era evitabile (soglia 18 km: l'utente fa al massimo 15-18 km al giorno).
- **Costi fissi = solo assicurazione (91 €/anno).** Gomme, pastiglie ecc. si registrano come spese quando si pagano (probabilmente nulla il primo anno).
- **Uso stagionale:** meno da novembre, di più da marzo. Per questo i km annui si calcolano dai 12 mesi reali e la proiezione è «al ritmo attuale».
- **Recuperi storici:** monopattino in uso da fine agosto/inizio settembre 2026. I viaggi del 22/09 (109 km) e del 28/09 (37 km) sono recuperi di più giorni (`rec: true`): contano nel totale e nel pareggio, non in media, proiezione, serie e km annui.
- **Giorno dei km letti:** proposta automatica, non blocco (l'utente non voleva il blocco).
- **Prezzi bloccati per spostamento**; l'unico modo di cambiarli nel passato è il pulsante in Parametri.
- **Importazione prudente:** id validi conservati, altri rigenerati; testi ripuliti (`cleanLabel`, `escHtml`); parametri validati uno a uno; vecchio valore 141 dei costi fissi convertito in 91.

### Vincoli tecnici
- **Un solo file HTML, nessuna dipendenza:** niente framework, build o moduli; JS semplice (`var`, funzioni).
- **Date locali:** sempre `todayStr()`, `addDaysStr()`, `shiftDateStr()`, mai `toISOString()` (un bug UTC vicino alla mezzanotte è già capitato).
- **A ogni modifica:** incrementare `CACHE_NAME` in `sw.js` **e** `APP_VERSION`/`APP_DATE` in `index.html` con lo stesso numero; aggiornare la Guida rapida e questo file.
- **Web Bluetooth:** solo Chrome Android su HTTPS; non su iPhone. Abbinamento con una pressione del pulsante di accensione. Con SHU l'abbinamento può decadere e va rifatto.
- **Privacy:** tutto resta sul telefono; niente account, server o statistiche.
- **Il sandbox non raggiunge il monopattino:** i registri si scoprono solo dalla lettura diagnostica fatta dall'utente.
- **Migrazioni una tantum** sempre protette da un flag in `localStorage`.

### Metodo di lavoro
1. L'utente segnala un problema o chiede proposte; si propone in breve, lui risponde «Procedi» o «Sì».
2. Si implementa, si controlla la sintassi (`node --check` sullo script estratto), si eseguono i test, si fa commit e push, si risponde in italiano in modo breve, con i numeri reali quando servono.
3. **Test:** harness Node con DOM simulato, fuori dal repository (si perdono tra sessioni; npm/jsdom non raggiungibili). Per ricrearli: estrarre l'ultimo `<script>` di `index.html`, sostituire il `})();` finale con `window.__t={...}` per esportare le funzioni, eseguire con `vm` simulando `document.getElementById` (oggetti creati al volo), `localStorage` (caricato da un backup JSON dell'utente) e `G3BLE` (`readScooter` che restituisce una lettura finta). Quando si tocca la batteria, coprire: ricarica registrata prima/dopo la lettura, lettura col caricatore, uscita dopo la ricarica, nessuna ricarica.
4. Prima del push: `git fetch origin main && git rebase origin/main` (più sessioni possono lavorare sul repository).
5. Commit con le righe `Co-Authored-By` e `Claude-Session` indicate dalla sessione corrente.

---

## 3. Prossimi passi

1. **Verificare la versione 30 sul telefono:** con la ricarica del 28/10 la barra deve essere piena e la riga «Batteria letta» deve dire «14% · 17:39 (non aggiornata)». Se no, farsi mandare un backup JSON e riprodurre il caso con l'harness.
2. **Confermare i cicli:** alla prima lettura dopo una ricarica registrata, `cycA` dovrebbe salire (era 6 prima della ricarica del 19/10). La scheda toglie «da confermare» da sola; se dopo 3 ricariche non sale mai, la riga sparisce e si cerca nella zona BMS `0xC0`..`0xDF` con la diagnostica.
3. **Capacità reale:** nei backup futuri controllare se `cap5A` o `cap8A` scendono sotto 12.750 mAh.
4. **Autonomia:** il consumo misurato propone 33 km contro i 34 del parametro; d'inverno il consumo salirà. Ricontrollare a gennaio.
5. **Km annui:** dal 22/09/2027 l'app usa da sola i km reali; fino ad allora 1.500. Verificare a fine inverno che la stima resti sensata.
6. **Idee non ancora proposte:** promemoria «leggi dal monopattino» a fine giornata; confronto tra mesi o stagioni; condivisione del grafico mensile; salvare gli harness di test nel repository (cartella `test/`, senza dati personali) per non doverli ricreare.
7. **Pulizia (bassa priorità):** nascondere la lettura diagnostica dietro un tocco prolungato quando la mappa dei registri sarà chiusa.

### Avvio rapido per la nuova chat
- Clonare `fabriziodavi80/Rotaia`, leggere questo file, poi in `index.html` cercare `tripSaving`, `autoEvitabile`, `renderDashboard`, `renderBattery`, `ultimaLetturaSoc`, `kmDaLettura`, `consumoMisurato`, `importFullBackup`.
- Chiedere all'utente un backup JSON aggiornato se servono i dati reali.
- Per novità Bluetooth: prima la lettura diagnostica, poi solo registri in sola lettura.
