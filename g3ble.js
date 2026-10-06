/* Max G3 Saving — lettura Bluetooth del monopattino. */
// ---- Encryption2 (Segway-Ninebot) — port of ha-ninebot crypto_v2.py ----
const NB = (() => {
  const subtle = globalThis.crypto.subtle;
  const FW_DATA = hexToBytes("97CFB802844143DE56002B3B34780A5D");
  const ZEROS16 = new Uint8Array(16);

  function hexToBytes(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function toHex(b) {
    return Array.from(b, x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  function concat(...parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function pad16(b) { const o = new Uint8Array(16); o.set(b.subarray(0, 16)); return o; }
  function xor(a, b) { const o = new Uint8Array(Math.min(a.length, b.length)); for (let i = 0; i < o.length; i++) o[i] = a[i] ^ b[i]; return o; }
  function u32be(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }

  // AES-128-ECB on one block: first block of CBC with a zero IV.
  const keyCache = new Map();
  async function aesKey(raw) {
    const id = toHex(raw);
    if (!keyCache.has(id)) keyCache.set(id, await subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["encrypt"]));
    return keyCache.get(id);
  }
  async function ecb(raw, block) {
    const k = await aesKey(raw);
    const out = await subtle.encrypt({ name: "AES-CBC", iv: ZEROS16 }, k, block);
    return new Uint8Array(out).slice(0, 16);
  }

  async function deriveKey(key1, key2) {
    const k1 = pad16(key1);
    const k2 = key2 ? pad16(key2) : ZEROS16;
    const h = await subtle.digest("SHA-1", concat(k1, k2));
    return new Uint8Array(h).slice(0, 16);
  }
  function buildNonce(counter, auth) {
    return concat(u32be(counter), pad16(auth).subarray(0, 8), new Uint8Array([0]));
  }

  class Session {
    constructor(gen2 = false) {
      this.aesKey = null;
      this.auth = ZEROS16;
      this.ecbInput = gen2 ? FW_DATA : ZEROS16;
      this.counter = 0;
      this.snMode = false;
      this.lastRx = -1;
    }
    async setKey(k1, k2) { this.aesKey = await deriveKey(k1, k2); }
    setAuth(a) { this.auth = a; }
    resetSn() { this.counter = 0; this.snMode = false; this.lastRx = -1; }
    startSn() { this.counter = 1; this.snMode = true; }

    async cbcMac(plain, nonce) {
      const payload = plain.subarray(3);
      let x = await ecb(this.aesKey, concat(new Uint8Array([0x59]), nonce, new Uint8Array([0, payload.length & 255])));
      x = await ecb(this.aesKey, xor(x, pad16(plain.subarray(0, 3))));
      for (let o = 0; o < payload.length; o += 16) x = await ecb(this.aesKey, xor(x, pad16(payload.subarray(o, o + 16))));
      return x.slice(0, 4);
    }
    async ctr(payload, nonce) {
      const out = new Uint8Array(payload.length);
      for (let o = 0, i = 1; o < payload.length; o += 16, i++) {
        const ks = await ecb(this.aesKey, concat(new Uint8Array([1]), nonce, new Uint8Array([0, i & 255])));
        out.set(xor(payload.subarray(o, o + 16), ks), o);
      }
      return out;
    }
    async staticXor(payload) {
      const ks = await ecb(this.aesKey, this.ecbInput);
      const out = new Uint8Array(payload.length);
      for (let o = 0; o < payload.length; o += 16) out.set(xor(payload.subarray(o, o + 16), ks), o);
      return out;
    }
    async encrypt(plain) {
      const payload = plain.subarray(3);
      if (!this.snMode) {
        let s = 0; for (const b of payload) s += b;
        const ck = (~s) & 0xffff;
        return concat(plain.subarray(0, 3), await this.staticXor(payload), new Uint8Array([0, 0, ck & 255, ck >> 8, 0, 0]));
      }
      this.counter += 1;
      const c = this.counter;
      const nonce = buildNonce(c, this.auth);
      const tag = await this.cbcMac(plain, nonce);
      const ct = await this.ctr(payload, nonce);
      const a0 = await ecb(this.aesKey, concat(new Uint8Array([1]), nonce, new Uint8Array([0, 0])));
      return concat(plain.subarray(0, 3), ct, xor(tag, a0), new Uint8Array([(c >> 8) & 255, c & 255]));
    }
    // returns {plain, status}: 0 ok, -2 auth error, -3 replay
    async decrypt(data) {
      if (data.length < 9) return { plain: null, status: -2 };
      const header = data.subarray(0, 3);
      const c = (data[data.length - 2] << 8) | data[data.length - 1];
      const tagRx = data.subarray(data.length - 6, data.length - 2);
      const payload = data.subarray(3, data.length - 6);
      if (c === 0) return { plain: concat(header, await this.staticXor(payload)), status: 0 };
      if (c <= this.lastRx) return { plain: null, status: -3 };
      const nonce = buildNonce(c, this.auth);
      const plain = concat(header, await this.ctr(payload, nonce));
      const a0 = await ecb(this.aesKey, concat(new Uint8Array([1]), nonce, new Uint8Array([0, 0])));
      const expected = xor(tagRx, a0);
      const mac = await this.cbcMac(plain, nonce);
      if (toHex(mac) !== toHex(expected.slice(0, 4))) return { plain: null, status: -2 };
      this.lastRx = c;
      return { plain, status: 0 };
    }
  }

  return { Session, FW_DATA, hexToBytes, toHex, concat };
})();


// ---- Lettura Bluetooth del Ninebot Max G3 (sola lettura) ----
// Protocollo: documentazione aperta Segway-Ninebot BLE + integrazione ha-ninebot.
// Invia solo riconoscimento, abbinamento (su richiesta esplicita), autenticazione e letture.
const G3BLE = (() => {
  const SVC_NB = "6e400001-0000-0000-006e-696e65626f74";
  const SVC_NORDIC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const GENS = {
    gen3: { sync2: 0xB5, gen2ks: false, wr: "6e400002-0000-0000-006e-696e65626f74" },
    gen2: { sync2: 0xA5, gen2ks: true, wr: "6e400002-b5a3-f393-e0a9-e50e24dcca9e" },
  };
  const BT_ID = 0x3E, BOARD_BLE = 0x04, BOARD_VCU = 0x16;
  const CMD_READ = 0x01, CMD_READ_RESP = 0x04, CMD_PRE_COMM = 0x5B, CMD_SET_PWD = 0x5C, CMD_AUTH = 0x5D;
  const BMS_BOARDS = [0x22, 0x07, 0x23], K_BMS = "rotaia_g3_bms_v1";
  const K_KEY = "rotaia_g3_key_v1", K_PENDING = "rotaia_g3_pending_v1", K_GEN = "rotaia_g3_gen_v1", K_DEV = "rotaia_g3_device_v1";
  const enc = new TextEncoder();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const st = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const log = [];
  function L(s) { log.push(new Date().toLocaleTimeString("it-IT", { hour12: false }) + "  " + s); if (log.length > 300) log.shift(); }
  function err(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }
  function withTimeout(p, ms, what) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(err("timeout", "Tempo scaduto: " + what)), ms))]); }

  function parseKey(raw) {
    if (!raw) return null;
    const [serial, hex] = raw.split(":");
    if (!serial || !/^[0-9A-Fa-f]{32}$/.test(hex || "")) return null;
    return { serial, hex: hex.toUpperCase() };
  }

  class Client {
    constructor(device) {
      this.device = device; this.name = device.name || ""; this.chars = []; this.writeChars = new Map();
      this.rx = new Uint8Array(0); this.waiters = []; this.chain = Promise.resolve(); this.undecryptable = 0; this.pairOk = false;
      this.onNotify = ev => { const v = new Uint8Array(ev.target.value.buffer.slice(0)); this.chain = this.chain.then(() => this.ingest(v)).catch(e => L("RX: " + e.message)); };
    }
    get connected() { return !!(this.device.gatt && this.device.gatt.connected); }
    async connect() {
      L("Connessione a " + this.name);
      const server = await withTimeout(this.device.gatt.connect(), 15000, "connessione Bluetooth");
      const services = [];
      for (const u of [SVC_NB, SVC_NORDIC]) { try { services.push(await server.getPrimaryService(u)); } catch (e) {} }
      if (!services.length) throw err("not_scooter", "Il dispositivo scelto non sembra il monopattino.");
      for (const s of services) for (const c of await s.getCharacteristics()) {
        const p = c.properties;
        if (p.notify || p.indicate) { try { await c.startNotifications(); c.addEventListener("characteristicvaluechanged", this.onNotify); this.chars.push(c); } catch (e) {} }
        if (p.write || p.writeWithoutResponse) this.writeChars.set(c.uuid.toLowerCase(), c);
      }
      await sleep(250);
      try {
        const ga = await server.getPrimaryService("generic_access");
        const n = new TextDecoder().decode(await (await ga.getCharacteristic("gap.device_name")).readValue()).replace(/\0/g, "").trim();
        if (n) this.name = n;
      } catch (e) {}
    }
    async disconnect() {
      for (const c of this.chars) { try { c.removeEventListener("characteristicvaluechanged", this.onNotify); await c.stopNotifications(); } catch (e) {} }
      try { if (this.connected) this.device.gatt.disconnect(); } catch (e) {}
      L("Disconnesso");
    }
    async ingest(chunk) {
      const b = new Uint8Array(this.rx.length + chunk.length); b.set(this.rx); b.set(chunk, this.rx.length); this.rx = b;
      for (;;) {
        let s = -1;
        for (let i = 0; i + 1 < this.rx.length; i++) if (this.rx[i] === 0x5A && (this.rx[i + 1] === 0xA5 || this.rx[i + 1] === 0xB5)) { s = i; break; }
        if (s < 0) { this.rx = this.rx.slice(-1); return; }
        if (s) this.rx = this.rx.slice(s);
        if (this.rx.length < 3) return;
        const total = this.rx[2] + 13;
        if (this.rx.length < total) return;
        const raw = this.rx.slice(0, total); this.rx = this.rx.slice(total);
        if (!this.sess) continue;
        const { plain, status } = await this.sess.decrypt(raw);
        if (status !== 0) { this.undecryptable++; continue; }
        if (plain.length < 7) continue;
        const f = { cmd: plain[5], index: plain[6], payload: plain.slice(7, 7 + plain[2]) };
        const w = this.waiters.findIndex(x => x.cmd === f.cmd);
        if (w >= 0) { const [x] = this.waiters.splice(w, 1); clearTimeout(x.t); x.res(f); }
        else if (f.cmd === CMD_SET_PWD && f.index === 1) { this.pairOk = true; L("Conferma abbinamento fuori sequenza"); }
      }
    }
    async request(target, cmd, index, payload, expect, timeout) {
      const wait = new Promise((res, rej) => {
        const x = { cmd: expect, res, t: setTimeout(() => { const i = this.waiters.indexOf(x); if (i >= 0) this.waiters.splice(i, 1); rej(err("timeout", "nessuna risposta al comando 0x" + cmd.toString(16))); }, timeout || 3000) };
        this.waiters.push(x);
      });
      const data = await this.sess.encrypt(NB.concat(new Uint8Array([0x5A, this.sync2, payload.length, BT_ID, target, cmd, index]), payload));
      try { if (this.withResp) await this.wrChar.writeValueWithResponse(data); else await this.wrChar.writeValueWithoutResponse(data); }
      catch (e) { wait.catch(() => {}); throw e; }
      return wait;
    }
    async hello() {
      const pref = st.get(K_GEN);
      const order = pref && GENS[pref] ? [pref, ...Object.keys(GENS).filter(g => g !== pref)] : ["gen2", "gen3"];
      for (const g of order) {
        const spec = GENS[g], ch = this.writeChars.get(spec.wr);
        if (!ch) continue;
        const modes = []; if (ch.properties.writeWithoutResponse) modes.push(false); if (ch.properties.write) modes.push(true);
        for (const wr of modes) {
          this.sync2 = spec.sync2; this.wrChar = ch; this.withResp = wr;
          this.sess = new NB.Session(spec.gen2ks); this.sess.resetSn();
          await this.sess.setKey(enc.encode(this.name), spec.gen2ks ? NB.FW_DATA : null);
          try {
            const r = await this.request(BOARD_BLE, CMD_PRE_COMM, 0, new Uint8Array(0), CMD_PRE_COMM, 2500);
            if (r.payload.length < 30) continue;
            this.authParam = r.payload.slice(0, 16);
            this.serial = new TextDecoder().decode(r.payload.slice(16, 30)).replace(/\0/g, "").trim();
            this.hasStoredPwd = r.index !== 0;
            st.set(K_GEN, g);
            L("Riconosciuto " + this.serial + " (" + g + ")");
            this.sess.setAuth(this.authParam); this.sess.startSn(); this.rx = new Uint8Array(0);
            return;
          } catch (e) { L("PRE_COMM " + g + ": " + e.message); }
        }
      }
      throw err("no_answer", "Il monopattino non risponde. Controlla che sia acceso, vicino, e che SHU sia chiusa.");
    }
    async auth(pwd) {
      await this.sess.setKey(pwd, this.authParam);
      const sn = new Uint8Array(14); sn.set(enc.encode(this.serial || "").slice(0, 14));
      const r = await this.request(BOARD_BLE, CMD_AUTH, 0, sn, CMD_AUTH, 4000);
      if (r.index !== 1) throw err("auth_refused", "Chiave rifiutata.");
    }
    async pair(onPrompt) {
      const pwd = crypto.getRandomValues(new Uint8Array(16));
      st.set(K_PENDING, this.serial + ":" + NB.toHex(pwd));
      await this.sess.setKey(enc.encode(this.name), this.authParam);
      this.undecryptable = 0; this.pairOk = false;
      const end = Date.now() + 90000; let prompted = false, pending = 0;
      while (Date.now() < end) {
        if (this.pairOk) return pwd;
        if (!this.connected) throw err("pair_dropped", "Il monopattino ha chiuso la connessione durante l'abbinamento.");
        try {
          const r = await this.request(BOARD_BLE, CMD_SET_PWD, 0, pwd, CMD_SET_PWD, 2500);
          if (r.index === 1) return pwd;
          pending++;
        } catch (e) {
          if (this.undecryptable) throw err("pair_refused", "Il monopattino rifiuta un nuovo abbinamento.");
        }
        if (!prompted) { prompted = true; onPrompt && onPrompt(); }
        await sleep(1500);
      }
      if (this.pairOk) return pwd;
      throw err("pair_timeout", pending ? "Conferma non ricevuta: premi una volta il pulsante di accensione quando richiesto." : "Il monopattino non ha risposto alla richiesta di abbinamento.");
    }
    async read(board, index, len) {
      const r = await this.request(board, CMD_READ, index, new Uint8Array([len]), CMD_READ_RESP, 2500);
      return r.payload.slice(0, len);
    }
  }

  let device = null;
  async function pickDevice() {
    if (device) return device;
    const saved = st.get(K_DEV);
    if (saved && navigator.bluetooth.getDevices) {
      try { const list = await navigator.bluetooth.getDevices(); device = list.find(d => d.id === saved) || null; } catch (e) {}
      if (device) { L("Monopattino ricordato: " + device.name); return device; }
    }
    const opts = { acceptAllDevices: true, optionalServices: [SVC_NB, SVC_NORDIC, "generic_access"] };
    try { device = await navigator.bluetooth.requestDevice(opts); }
    catch (e) {
      if (e.name === "TypeError" || e.name === "SecurityError") { opts.optionalServices = [SVC_NB, SVC_NORDIC]; device = await navigator.bluetooth.requestDevice(opts); }
      else throw e;
    }
    st.set(K_DEV, device.id);
    return device;
  }

  const u16 = d => d[0] | (d[1] << 8);
  const u32 = d => (d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0;

  // mode: "read" (fallisce con code "needs_pair" se serve abbinare) oppure "pair"
  async function readScooter(mode, onStatus, onPrompt) {
    const say = s => { onStatus && onStatus(s); };
    let c = null;
    try {
      const dev = await pickDevice();
      say("Mi collego al monopattino…");
      c = new Client(dev);
      try { await c.connect(); }
      catch (e) { if (e.code === "not_scooter") { device = null; st.del(K_DEV); } throw e; }
      await c.hello();
      let authed = false;
      const key = parseKey(st.get(K_KEY)), pend = parseKey(st.get(K_PENDING));
      if (key && key.serial === c.serial) {
        say("Autenticazione…");
        try { await c.auth(NB.hexToBytes(key.hex)); authed = true; }
        catch (e) { L("Chiave salvata non valida: " + e.message); }
      }
      if (!authed && pend && pend.serial === c.serial) {
        try { await c.auth(NB.hexToBytes(pend.hex)); authed = true; st.set(K_KEY, pend.serial + ":" + pend.hex); st.del(K_PENDING); }
        catch (e) { L("Chiave in sospeso non valida"); }
      }
      if (!authed) {
        if (mode !== "pair") throw err("needs_pair", "Serve abbinare l'app al monopattino.", { stored: c.hasStoredPwd, keyInvalid: !!(key && key.serial === c.serial) });
        say("Abbinamento in corso…");
        const pwd = await c.pair(onPrompt);
        await c.auth(pwd);
        st.set(K_KEY, c.serial + ":" + NB.toHex(pwd)); st.del(K_PENDING);
      }
      if (mode === "diag") {
        // Diagnostica: SOLA LETTURA. Nessuna scrittura, nessuna modifica di impostazioni.
        const hex = d => Array.from(d, x => x.toString(16).padStart(2, "0")).join(" ");
        const lines = ["Max G3 diagnostica " + new Date().toISOString(), "seriale " + c.serial];
        const knownB = parseInt(st.get(K_BMS) || "7", 16);
        const targets = [[BOARD_VCU, "VCU"], [isFinite(knownB) ? knownB : 7, "BMS"]];
        for (const [board, name] of targets) {
          let fails = 0, got = 0;
          for (let idx = 0x10; idx < 0xE0 && fails < 4; idx += 8) { // indice = parola da 2 byte: 8 parole = 16 byte
            say("Diagnostica " + name + " 0x" + board.toString(16) + " @0x" + idx.toString(16) + "…");
            try { const d = await c.read(board, idx, 16); lines.push(name + " 0x" + board.toString(16) + " @0x" + idx.toString(16) + ": " + hex(d)); got++; fails = 0; }
            catch (e) { fails++; lines.push(name + " 0x" + board.toString(16) + " @0x" + idx.toString(16) + ": --"); }
          }
          if (!got) lines.push(name + " 0x" + board.toString(16) + ": nessuna risposta");
        }
        // Controllo incrociato: i registri che l'app già usa, letti qui nello stesso momento, in piccolo e in blocco.
        lines.push("--- registri noti ---");
        const probe = async (board, idx, len) => {
          try { const d = await c.read(board, idx, len); lines.push("0x" + board.toString(16) + " @0x" + idx.toString(16) + " len" + len + ": " + hex(d)); }
          catch (e) { lines.push("0x" + board.toString(16) + " @0x" + idx.toString(16) + " len" + len + ": --"); }
        };
        say("Controllo registri noti…");
        for (const [i, l] of [[0x62, 4], [0x55, 2], [0x1F, 2], [0x1C, 2]]) await probe(BOARD_VCU, i, l);
        const bb = parseInt(st.get(K_BMS) || "7", 16);
        for (const [i, l] of [[0x8C, 2], [0x5B, 2], [0x13, 2]]) await probe(bb, i, l);
        L("Diagnostica completata");
        return { diag: lines.join("\n") };
      }
      say("Lettura…");
      const kmRaw = await c.read(BOARD_VCU, 0x62, 4);
      const out = { serial: c.serial, km: Math.round(u32(kmRaw)) / 10, soc: null, plugged: null, charging: null, mAh: null, fullmAh: null, volt: null };
      const opt = async (board, idx, len) => { try { const d = await c.read(board, idx, len); return d.length >= len ? d : null; } catch (e) { return null; } };
      let d;
      if ((d = await opt(BOARD_VCU, 0x55, 2))) out.soc = u16(d);
      if ((d = await opt(BOARD_VCU, 0x1F, 2))) out.plugged = !!((d[0] >> 6) & 1);
      if ((d = await opt(BOARD_VCU, 0x1C, 2))) out.charging = !!((d[0] >> 2) & 1);
      if ((d = await opt(BOARD_VCU, 0x66, 4))) out.rideS = u32(d); // secondi totali di guida
      // Scheda batteria: l'indirizzo dipende dal modello, si prova una breve lista e si ricorda quello giusto.
      const known = parseInt(st.get(K_BMS) || "", 16);
      const boards = isFinite(known) ? [known, ...BMS_BOARDS.filter(b => b !== known)] : BMS_BOARDS;
      for (const b of boards) {
        const v = await opt(b, 0x8C, 2);
        if (!v || !(v[0] || v[1])) continue;
        st.set(K_BMS, b.toString(16));
        out.volt = u16(v) / 100;
        if ((d = await opt(b, 0x5B, 2))) out.mAh = u16(d) * 10;
        if ((d = await opt(b, 0x13, 2))) out.fullmAh = u16(d) * 10;
        // Dettagli di salute (registri verificati sul Max G3; indici in parole da 2 byte)
        const s16 = x => (x & 0x8000) ? x - 0x10000 : x;
        if ((d = await opt(b, 0x8D, 4))) { out.cur = s16(u16(d)) / 100; out.soh = u16(d.slice(2)); }
        if ((d = await opt(b, 0x91, 2))) out.remFine = u16(d); // mAh residui con risoluzione fine
        if ((d = await opt(b, 0x96, 14))) { out.temps = []; for (let i = 0; i + 1 < d.length; i += 2) { const t = u16(d.slice(i)); if (t > 0 && t < 120) out.temps.push(t); } }
        const cells = [];
        for (const [ci, cl] of [[0xA0, 16], [0xA8, 10]]) { if ((d = await opt(b, ci, cl))) for (let i = 0; i + 1 < d.length; i += 2) { const v = u16(d.slice(i)); if (v > 2000 && v < 4500) cells.push(v); } }
        if (cells.length) out.cells = cells;
        if ((d = await opt(b, 0x59, 2))) out.cycA = u16(d);
        if ((d = await opt(b, 0x92, 2))) out.cycB = u16(d);
        break;
      }
      L("Letti: " + out.km + " km, " + out.soc + "%, " + out.mAh + " mAh, " + out.volt + " V, caricatore " + out.plugged + ", in carica " + out.charging);
      return out;
    } catch (e) {
      if (e && e.name === "NotFoundError") throw err("cancelled", "Nessun dispositivo scelto.");
      L("Errore: " + (e && e.message));
      throw e;
    } finally {
      if (c) await c.disconnect();
    }
  }

  return {
    supported: () => !!(navigator.bluetooth && window.isSecureContext),
    readScooter,
    getKey: () => parseKey(st.get(K_KEY)),
    setKey: raw => { const k = parseKey((raw || "").trim()); if (!k) return false; return st.set(K_KEY, k.serial + ":" + k.hex); },
    forgetKey: () => { st.del(K_KEY); st.del(K_PENDING); st.del(K_DEV); device = null; },
    log: () => log.join("\n"),
  };
})();
