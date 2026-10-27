# Max G3 Saving — note di passaggio per una nuova chat

Aggiornato: 27 ottobre 2026. Leggere questo file prima di toccare il codice.

App personale (PWA, pagina unica) che confronta spostamenti in monopattino (Ninebot Max G3) e in auto, calcola il risparmio e legge i dati del monopattino via Bluetooth. Un solo utente, nessun server, nessun account.

- Repository: `fabriziodavi80/Rotaia` (il vecchio nome `rotaia` reindirizza; il push funziona).
- Online: https://fabriziodavi80.github.io/Rotaia/
- Lingua dell'interfaccia e della chat: italiano.

---

## 1. Stato attuale dell'app

### File
| File | Ruolo |
|---|---|
| `index.html` | Tutta l'app (HTML, CSS, JS in un unico `<script>` finale, circa 2340 righe) |
| `g3ble.js` | Comunicazione Bluetooth con il Max G3 (cifratura, abbinamento, lettura registri) |
| `sw.js` | Service worker. `CACHE_NAME` attuale: `rotaia-cache-v23` |
| `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | PWA |

### Funzioni principali
- **Dashboard:** risparmio netto e lordo, ammortamento del monopattino con data stimata di pareggio, proiezione annua, CO2, serie di giorni consecutivi, obiettivo mensile, promemoria "nulla registrato oggi".
- **Spostamenti:** inserimento manuale o da tragitti salvati (chip), modifica, storico per mese, import/export CSV.
- **Batteria e ricariche:** scheda "Batteria monopattino" con km dall'ultima ricarica, autonomia reale, km stimati alla prossima ricarica, barra di carica. Ricariche registrate coi km totali del contachilometri.
- **Bluetooth:** lettura di km totali, % batteria, cavo collegato, in carica, tensione, mAh residui e pieni. Un pulsante in Aggiungi compila i km dell'uscita (differenza rispetto all'ultima lettura meno i km già inseriti a mano). Alla prima lettura in assoluto imposta solo il riferimento, senza registrare km.
- **Scheda "Stato batteria"** (dopo ogni lettura): salute del BMS, capacità piena (con "reale" e usura % se un registro candidato scende), carica residua, tensione, scarto tra le 13 celle in mV, temperatura, ore di guida e velocità media, cicli di carica ("da confermare" finché non salgono a cavallo di una ricarica).
- **Storia e allarmi batteria:** ogni lettura salva `cellD` (scarto celle) e `tMax`; grafico SVG dello scarto nel tempo (una lettura al giorno, ultime 60) con soglia tratteggiata. Avviso in scheda e toast dopo la lettura se scarto > 50 mV o temperatura ≥ 45 °C (`SOGLIA_CELLE_MV`, `SOGLIA_TEMP_C`).
- **Lettura diagnostica** (Parametri, sola lettura): scarica blocchi di registri grezzi per la mappatura. Utile solo se serve scoprire nuovi registri.
- **Backup:** esportazione completa JSON (spostamenti, ricariche, tragitti, parametri, letture, riferimento km), condivisione, import, CSV. Promemoria in Dashboard se non fai backup. Richiesta di archiviazione persistente al browser e avviso se il salvataggio fallisce.
- **Prezzi bloccati:** ogni spostamento memorizza `pb` (benzina) e `pe` (elettricità) del momento. Pulsante in Parametri per riapplicare i prezzi attuali a tutto lo storico.
- **Guida rapida** in Parametri, mantenuta aggiornata a ogni funzione.

### Come si calcola il risparmio
- `tripSaving = costo alternativa − costo mezzo usato`: positivo per il monopattino, negativo per l'auto. Netto = somma di tutti, lordo = solo i km in monopattino.
- Costo al km monopattino = `capacitaBatteria / autonomiaReale * prezzoElettrico + manutenzione/km`. Costo al km auto = `consumoAuto/100 * prezzoBenzina`.
- Prezzi: dallo spostamento (`pb`, `pe`). Consumo e autonomia: sempre i parametri attuali, quindi correggerli cambia anche il passato (voluto).
- Parametri oggi di rilievo: capacità batteria 0,597 kWh, autonomia reale 36 km.

### Autonomia: quale numero vince
1. Se c'è almeno 5 km di consumo misurato dalla batteria via Bluetooth, l'autonomia è `capacità / Wh al km` (oggi circa 17 Wh/km, circa 35 km). Il pulsante "Aggiorna parametro autonomia" dai cicli viene nascosto.
2. Altrimenti si usa la media dei cicli di ricarica.
3. Altrimenti il valore dei Parametri.

La barra e i "km alla prossima ricarica" usano la % letta oggi solo se non è stata registrata una ricarica dopo quella lettura (confronto sull'istante di creazione contenuto nell'id della ricarica).

### Registri Bluetooth verificati (indici in parole da 2 byte)
Board VCU `0x16`, BMS `0x07` (sul tuo G3). Gli indici sono parole da 2 byte: un blocco da 16 byte da `N` copre le parole `N`..`N+7`.

| Dato | Board | Indice | Note |
|---|---|---|---|
| Km totali | VCU | `0x62` | u32, diviso 10 |
| % batteria | VCU | `0x55` | u16 |
| Cavo collegato / in carica | VCU | `0x1F` bit 6 / `0x1C` bit 2 | |
| Ore di guida (secondi) | VCU | `0x66` | u32; `0x64` è il tempo di accensione |
| Tensione pacco | BMS | `0x8C` | u16 / 100 |
| Corrente, salute | BMS | `0x8D`, `0x8E` | corrente con segno / 100; salute oggi sempre 100 |
| Capacità piena | BMS | `0x13` (e `0x5A`) | u16 × 10 mAh, 12.750 |
| mAh residui | BMS | `0x5B`, preciso `0x91` | `0x5B` × 10, `0x91` in mAh |
| Temperature | BMS | `0x96`..`0x9C` | gradi diretti; 255 = sensore assente |
| Celle (13) | BMS | `0xA0`..`0xAC` | mV |
| Cicli di ricarica | BMS | `0x59` (`cycA`) | quasi certo: fermo a 6 dal 7 al 19/10, nessuna ricarica in mezzo. Conferma automatica in app (`cicliInfo`) |
| Stato BMS (non cicli) | BMS | `0x92` (`cycB`) | oscilla 1-2 senza ricariche, 4 col cavo collegato: non è un contatore |
| Capacità reale? | BMS | `0x5A` (`cap5A`), `0x8A` (`cap8A`) | letti e salvati dal 21/10; se scendono sotto `0x13` = usura (`capacitaReale`) |

Nel BMS i valori `0x15`..`0x1E` formano una tabella tensione/carica, non celle.

### Chiavi `localStorage`
`rotaia_trips_v1`, `rotaia_params_v2`, `rotaia_routes_v1`, `rotaia_charges_v1`, `rotaia_theme_v1`, `rotaia_last_backup_v1`, `rotaia_backup_snooze_v1`, `rotaia_odo_v1`, `rotaia_g3soc_v1`, `rotaia_g3reads_v1`, `rotaia_g3health_v1`, `rotaia_snap_v1` (flag migrazione prezzi). Bluetooth: `rotaia_g3_key_v1` (chiave di abbinamento, mai nel backup), `rotaia_g3_pending_v1`, `rotaia_g3_gen_v1`, `rotaia_g3_device_v1`, `rotaia_g3_bms_v1`.

---

## 2. Decisioni e vincoli

### Decisioni prese
- **Sola lettura sul monopattino.** L'app non scrive nessun registro, non cambia impostazioni né firmware. Qualunque nuova funzione Bluetooth deve restare in lettura.
- **Un solo file HTML, nessuna dipendenza.** Niente framework né build. JavaScript semplice (`var`, funzioni), niente moduli.
- **Netto vs lordo** e segno negativo per l'auto: il netto è il numero principale. Dal 27/10 un viaggio in auto è negativo solo se evitabile (`autoEvitabile`): campo facoltativo `fatt` (true/false) scelto dall'utente, altrimenti automatico se `km <= autonomiaReale`. Non evitabile = risparmio e CO2 a 0.
- **Prezzi bloccati per spostamento; consumo e autonomia retroattivi.** Il pulsante "Applica i prezzi attuali a tutto lo storico" è l'unico modo di cambiare i prezzi del passato.
- **Km annui per la manutenzione:** con almeno 365 giorni dal primo spostamento in monopattino si usano i km reali in monopattino degli ultimi 365 giorni (`kmAnnuiReali`, minimo 100 km), altrimenti `params.kmAnnui`. Retroattivo come consumo e autonomia. Motivo: l'uso è stagionale (meno da novembre, di più da marzo), quindi il ritmo di un mese non vale come media annua. Cache invalidata da `tripsRev` in `saveJSON`.
- **Il consumo misurato dalla batteria batte la media dei cicli** per l'autonomia (vedi sopra).
- **Importazione prudente:** gli id validi si conservano, quelli non validi si rigenerano; nomi dei tragitti ripuliti (`cleanLabel`) e protetti nel rendering (`escHtml`); parametri validati uno a uno; la chiave Bluetooth non entra nel backup.
- **Giorno dei km letti via Bluetooth:** se l'ultima lettura (`ref.date` in `rotaia_odo_v1`) è di un giorno precedente, l'app preseleziona il giorno più probabile (`giornoProbabile`: prima delle 12 «Ieri», poi «Oggi») e mostra i pulsanti Oggi/Ieri/… (fino a 7 giorni) per cambiarlo; nessun blocco al salvataggio (l'utente non voleva un blocco). Il monopattino non ha un registro con i km per giorno.
- **Rilevamento "km già inseriti a mano":** l'istante di creazione è nell'id (`Date.now()-xxxxx`) e serve per sottrarre i km manuali dalla proposta Bluetooth.
- **"Stato batteria":** per ora solo ultima lettura; nessuna storia dei valori e nessun grafico.

### Vincoli
- **Data locale:** usare sempre `todayStr()` (data locale), mai `toISOString()`. Un bug UTC vicino alla mezzanotte in Italia è già stato corretto una volta.
- **Service worker e versione:** a ogni modifica ai file dell'app incrementare `CACHE_NAME` in `sw.js` e allineare `APP_VERSION` e `APP_DATE` in `index.html` (la riga "Versione NN" in fondo a Parametri). Pagina e script `.js` usano rete prima, cache poi.
- **Web Bluetooth:** funziona solo in Chrome/Android (vivo X300 Ultra) su connessione sicura (HTTPS). Non funziona su iPhone. Per l'abbinamento serve premere una volta il pulsante di accensione.
- **SHU / app Segway:** il monopattino può essere abbinato a un'altra app; con SHU l'abbinamento dell'app può decadere e va rifatto. Velocità e regione non cambiano.
- **Firmware:** non aggiornare il monopattino senza prima verificare che la lettura funzioni ancora dopo.
- **Privacy:** tutto resta sul telefono. Non aggiungere account, server o statistiche.
- **Il sandbox non raggiunge il monopattino:** i registri si scoprono solo tramite la lettura diagnostica fatta dall'utente.

### Dati reali al 21 ottobre (dal backup)
- Consumo misurato 17,4 Wh/km su 46 km (autonomia ≈ 34 km); dalla % batteria ≈ 35 km ogni 100%. Coerente: il parametro 36 km è leggermente ottimista.
- Il consumo ora esclude anche le coppie di letture con cavo collegato o con una ricarica registrata in mezzo.
- Corretto: l'importazione del backup scartava `soh`, `cycA`, `cycB`, `rideS` delle letture; ora conserva tutti i campi numerici facoltativi.

### Metodo di lavoro che funziona
1. L'utente chiede "altre criticità/suggerimenti?", si elenca una proposta ordinata, risponde "Procedi".
2. Si implementa, si controlla la sintassi (`node --check` sullo script estratto), si eseguono i test, si fa commit e push, si risponde in italiano in modo breve.
3. Test: harness Node con DOM simulato, fuori dal repository (sparisce tra sessioni; npm/jsdom non raggiungibili). Per ricrearlo: estrarre il `<script>` finale di `index.html`, sostituire il `})();` finale con un `window.__t={...}` che esporta le funzioni da provare, eseguirlo con `vm` simulando `document.getElementById` (oggetti creati al volo), `localStorage` (caricato da un backup JSON dell'utente) e `G3BLE`.
4. Messaggio di commit con la riga `Co-Authored-By` e il link di sessione indicati dalle istruzioni della sessione corrente.
5. Più sessioni possono lavorare sullo stesso repository: fare `git pull --rebase origin main` prima del push.

---

## 3. Prossimi passi

0. **Orologio nel monopattino: escluso (24/10).** Nella diagnostica del 24/10 (VCU e BMS, parole `0x10`..`0xDF`) nessun valore u16/u32 corrisponde all'ora attuale come secondi, minuti, ore o giorni dal 1970, 2000 o 2020 (tolleranza 3 giorni), né date in byte. VCU `0x10`..`0x16` e `0x20`..`0x27` sono testo (seriale `1CGIF2527C0369` e un secondo codice). Non rileggere per questo: la data dei km resta proposta dall'app (`giornoProbabile`). Non lette in blocco: BMS `0x38`, `0x48`..`0x5F`, `0xA0`..`0xAF`, `0xC8`.
1. **Confermare i cicli:** alla prossima lettura dopo la ricarica del 19/10, `cycA` dovrebbe passare da 6 a 7 e la scheda mostrerà il numero senza "(da confermare)". Se dopo 3 ricariche non sale mai, la riga sparisce da sola: allora cercare con la lettura diagnostica nella zona `0xC0`..`0xDF` del BMS.
2. **Capacità reale:** controllare nei backup futuri se `cap5A` o `cap8A` scendono sotto `fullmAh`. Finché coincidono la scheda non mostra nulla di più.
3. **Autonomia:** il consumo misurato (≈ 34 km) è già usato per la barra; valutare con l'utente se allineare il parametro (36 km), che pesa sul costo al km anche del passato.
4. **Idee non ancora proposte all'utente:** promemoria "leggi dal monopattino" a fine giornata, confronto tra mesi, esportazione/condivisione del grafico mensile.
5. **Pulizia (bassa priorità):** la lettura diagnostica in Parametri si può nascondere dietro un tocco prolungato quando la mappa dei registri sarà considerata chiusa.

### Avvio rapido per la nuova chat
- Clonare `fabriziodavi80/Rotaia`, leggere questo file e `index.html` (cercare `renderBattery`, `renderHealth`, `consumoMisurato`, `importFullBackup`).
- Prima di cambiare qualcosa che tocca date, prezzi o ricariche, rieseguire i controlli con un harness.
- Per novità Bluetooth: prima la lettura diagnostica, poi solo registri in sola lettura.
