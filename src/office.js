/* Motor de la oficina pixel-art: dibuja salas, muebles y agentes que caminan, se sientan y trabajan.
   Todo se dibuja con código en un canvas lógico de 448x256 px (mosaicos de 16 px) escalado sin suavizado. */
const Office = (() => {
  const T = 16, W = 28, H = 16, LW = W * T, LH = H * T, WALL = 4;
  const SKINS = ["#f6d2b3", "#e9b58f", "#c98d62", "#8d5a3b", "#5e3b25"];
  const PIX = '"Silkscreen", ui-monospace, monospace';

  // Distribución de cada sala: mesas (x, y, ancho en mosaicos, agente) y mobiliario.
  const LAYOUTS = {
    central: {
      wall: [["window", 2], ["window", 5], ["sign", 9], ["poster", 14, "#f2b84b"], ["clock", 17], ["shelf", 19], ["signsmall", 23, "COFFEE"]],
      desks: [{ x: 11, y: 6, w: 4, a: "elena", boss: true }, { x: 2, y: 8, w: 2, a: "marco" }, { x: 6, y: 8, w: 2, a: "tomas" }, { x: 2, y: 12, w: 2, a: "carmen" }, { x: 6, y: 12, w: 2, a: "pablo" }],
      items: [["counter", 21, 4, 6, 1], ["coffee", 23, 4], ["plant", 0, 4], ["plant", 27, 15], ["sofa", 17, 13, 3, 1], ["rug", 16, 11, 5, 4], ["table", 17, 11, 3, 1], ["cooler", 27, 5], ["plantsmall", 15, 6], ["meeting", 18, 7, 4, 2], ["printer", 9, 4], ["plant", 10, 15], ["plantsmall", 0, 15], ["beanbag", 23, 13]],
      pois: [[23, 5], [25, 5], [18, 12], [27, 6], [1, 5], [14, 10], [17, 9], [10, 5]],
    },
    estudio: {
      wall: [["sign", 2], ["frame", 7, "#ff8fb1"], ["frame", 9, "#7aa7ff"], ["frame", 11, "#4fd18b"], ["window", 15], ["shelf", 19], ["frame", 23, "#f2b84b"]],
      desks: [{ x: 2, y: 7, w: 2, a: "dani", rig: true }, { x: 7, y: 7, w: 2, a: "lucia" }, { x: 2, y: 11, w: 2, a: "sofia" }, { x: 7, y: 11, w: 2, a: "bruno" }],
      items: [["lightbox", 14, 8, 4, 2], ["easel", 20, 5], ["tripod", 23, 9], ["softbox", 25, 8], ["plant", 0, 4], ["plant", 27, 4], ["rug", 19, 11, 6, 4], ["sofa", 20, 13, 4, 1], ["plantsmall", 12, 14]],
      pois: [[16, 10], [21, 6], [22, 12], [24, 11], [13, 6]],
    },
    lab: {
      wall: [["sign", 2], ["board", 7], ["window", 13], ["window", 16], ["poster", 20, "#7aa7ff"], ["clock", 23]],
      desks: [{ x: 2, y: 7, w: 2, a: "kai", dual: true }, { x: 7, y: 7, w: 2, a: "ivan", dual: true }, { x: 2, y: 11, w: 2, a: "irene" }, { x: 7, y: 11, w: 2, a: "hugo" }],
      items: [["rack", 24, 4], ["rack", 25, 4], ["rack", 26, 4], ["beanbag", 15, 12], ["beanbag", 18, 13], ["rug", 14, 11, 6, 4], ["plant", 0, 4], ["plantsmall", 12, 6], ["cooler", 27, 9], ["printer", 21, 5]],
      pois: [[9, 5], [25, 7], [16, 11], [27, 10], [21, 7]],
    },
    ventas: {
      wall: [["sign", 2], ["chart", 7], ["window", 12], ["trophies", 16], ["window", 20], ["clock", 24]],
      desks: [{ x: 2, y: 7, w: 2, a: "alex" }, { x: 7, y: 7, w: 2, a: "rocio" }, { x: 2, y: 11, w: 2, a: "lola", headset: true }],
      items: [["meeting", 15, 8, 5, 2], ["plant", 0, 4], ["plant", 27, 4], ["plantsmall", 11, 13], ["sofa", 22, 13, 3, 1], ["rug", 21, 11, 5, 4], ["cooler", 27, 7], ["bell", 12, 6]],
      pois: [[14, 9], [20, 9], [17, 11], [23, 12], [27, 8], [12, 7]],
    },
    taller: {
      wall: [["sign", 2], ["board", 7], ["window", 12], ["chart", 16], ["window", 20], ["clock", 24]],
      desks: [{ x: 2, y: 7, w: 2, a: "audit" }, { x: 7, y: 7, w: 2, a: "uxui", dual: true }, { x: 2, y: 11, w: 2, a: "build", dual: true }, { x: 7, y: 11, w: 2, a: "qa" }],
      items: [["meeting", 14, 8, 4, 2], ["lightbox", 20, 7, 3, 2], ["rack", 26, 4], ["printer", 24, 5], ["plant", 0, 4], ["plant", 27, 15], ["rug", 15, 11, 6, 4], ["beanbag", 16, 13], ["beanbag", 19, 13], ["plantsmall", 12, 14]],
      pois: [[15, 10], [21, 9], [18, 12], [25, 7], [12, 7]],
    },
  };

  // ---------- utilidades ----------
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const k = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((k - r) * p + r); g = Math.round((k - g) * p + g); b = Math.round((k - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };
  const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

  // ---------- sprites de personaje ----------
  function drawPerson(ctx, a, x, y, o) {
    // x, y = pies en px lógicos. o: {dir, frame, sit, work, t}
    const [hs, hair, skinI, hue, pants] = a.look;
    const skin = SKINS[skinI], shirt = hsl(hue, 55, 52), shirtD = hsl(hue, 55, 40);
    const bx = Math.round(x) - 6, by = Math.round(y) - 22;
    const R = (dx, dy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(bx + dx, by + dy, w, h); };
    const back = o.dir === "up" || o.sit;
    const step = o.sit ? 0 : (o.frame % 4);
    const bob = o.sit ? 0 : (step === 1 || step === 3 ? -1 : 0);
    const ty = bob + (o.sit ? 3 : 0) + (o.sit && o.work && Math.floor(o.t * 6) % 2 ? 0 : 0);
    // sombra
    if (!o.sit) { ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(bx + 2, by + 21, 8, 2); }
    // piernas
    if (!o.sit) {
      const l = step === 1 ? 1 : 0, r = step === 3 ? 1 : 0;
      R(3, 16 - l + ty, 2, 4 + l, pants); R(7, 16 - r + ty, 2, 4 + r, pants);
      R(3, 20 + ty, 2, 1, "#1a1a1a"); R(7, 20 + ty, 2, 1, "#1a1a1a");
    }
    // cuerpo
    R(2, 10 + ty, 8, 7, shirt); R(2, 16 + ty, 8, 1, shirtD);
    // brazos
    const sw = o.sit ? 0 : (step === 1 ? 1 : step === 3 ? -1 : 0);
    if (o.sit && o.work) {
      const tp = Math.floor(o.t * 8) % 2;
      R(1, 11 + ty, 1, 4 - tp, shirtD); R(10, 11 + ty, 1, 3 + tp, shirtD);
    } else { R(1, 11 + ty + sw, 1, 5, shirtD); R(10, 11 + ty - sw, 1, 5, shirtD); R(1, 16 + ty + sw, 1, 1, skin); R(10, 16 + ty - sw, 1, 1, skin); }
    // cabeza
    R(3, 3 + ty, 6, 7, skin); R(2, 5 + ty, 1, 3, skin); R(9, 5 + ty, 1, 3, skin);
    // pelo
    if (back) {
      R(2, 2 + ty, 8, 7, hair);
      if (hs === 2) R(3, 9 + ty, 6, 3, hair);
      if (hs === 3) R(4, 0 + ty, 4, 2, hair);
    } else {
      R(3, 2 + ty, 6, 2, hair); R(2, 3 + ty, 1, 3, hair); R(9, 3 + ty, 1, 3, hair);
      if (hs === 1) { R(3, 4 + ty, 3, 1, hair); }
      if (hs === 2) { R(2, 3 + ty, 1, 7, hair); R(9, 3 + ty, 1, 7, hair); }
      if (hs === 3) { R(4, 0 + ty, 4, 2, hair); }
      if (hs === 4) { R(3, 1 + ty, 6, 1, hair); R(2, 2 + ty, 8, 1, shade(hair, .15)); }
      const ex = o.dir === "left" ? -1 : o.dir === "right" ? 1 : 0;
      const blink = Math.floor((o.t + a.blink) * 10) % 37 === 0;
      if (!blink) { R(4 + ex, 6 + ty, 1, 1, "#1b1b1b"); R(7 + ex, 6 + ty, 1, 1, "#1b1b1b"); }
      R(5 + ex, 8 + ty, 2, 1, shade(skin, -.25));
    }
    if (a.headset && o.sit) { R(2, 3 + ty, 1, 5, "#222"); R(9, 3 + ty, 1, 5, "#222"); R(2, 2 + ty, 8, 1, "#222"); }
  }

  // ---------- mobiliario ----------
  function drawWall(ctx, room, L, t) {
    const brick = room.brick;
    ctx.fillStyle = shade(brick, -.35); ctx.fillRect(0, 0, LW, WALL * T);
    for (let row = 0; row < (WALL * T) / 6; row++) {
      const off = row % 2 ? 0 : 6;
      for (let x = -12; x < LW; x += 12) {
        seed = (row * 131 + x * 7 + 17) | 0 || 1; const v = rnd();
        ctx.fillStyle = shade(brick, (v - .5) * .18);
        ctx.fillRect(x + off, row * 6, 11, 5);
      }
    }
    // zócalo y sombra
    ctx.fillStyle = shade(brick, -.55); ctx.fillRect(0, WALL * T - 4, LW, 4);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(0, WALL * T, LW, 3);
    // luces colgantes
    for (let x = 24; x < LW; x += 64) {
      ctx.fillStyle = "#222"; ctx.fillRect(x, 0, 1, 6);
      ctx.fillStyle = "#ffe9a8"; ctx.fillRect(x - 2, 6, 5, 3);
      ctx.fillStyle = "rgba(255,233,168,.07)"; ctx.beginPath(); ctx.moveTo(x - 2, 9); ctx.lineTo(x - 26, LH); ctx.lineTo(x + 28, LH); ctx.lineTo(x + 3, 9); ctx.fill();
    }
    for (const [type, tx, c] of L.wall) {
      const x = tx * T;
      if (type === "window") {
        ctx.fillStyle = "#3b2b20"; ctx.fillRect(x, 10, 34, 34);
        const sky = ctx.createLinearGradient(0, 12, 0, 42); sky.addColorStop(0, "#9fd3ff"); sky.addColorStop(1, "#dff1ff");
        ctx.fillStyle = sky; ctx.fillRect(x + 2, 12, 30, 30);
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillRect(x + 6 + ((t * 2) % 22), 18, 7, 2);
        ctx.fillStyle = "#3b2b20"; ctx.fillRect(x + 16, 12, 2, 30); ctx.fillRect(x + 2, 26, 30, 2);
        ctx.fillStyle = "#5a4533"; ctx.fillRect(x - 2, 43, 38, 3);
      } else if (type === "sign") {
        const txt = room.sign; ctx.font = `8px ${PIX}`; const w = ctx.measureText(txt).width + 14;
        ctx.fillStyle = "#1c1917"; ctx.fillRect(x, 16, w, 18); ctx.fillStyle = "#3a332c"; ctx.fillRect(x + 1, 17, w - 2, 16);
        ctx.fillStyle = room.accent; ctx.fillRect(x + 4, 30, w - 8, 1);
        ctx.fillStyle = "#f4efe6"; ctx.textBaseline = "top"; ctx.fillText(txt, x + 7, 20);
      } else if (type === "signsmall") {
        ctx.font = `8px ${PIX}`; const w = ctx.measureText(c).width + 10;
        ctx.fillStyle = "#2b2420"; ctx.fillRect(x, 10, w, 14);
        ctx.fillStyle = "#f4efe6"; ctx.textBaseline = "top"; ctx.fillText(c, x + 5, 13);
        ctx.fillStyle = "#f4efe6"; ctx.fillRect(x + w / 2 - 4, 26, 8, 6); ctx.fillRect(x + w / 2 + 4, 27, 2, 3);
        const s = Math.floor(t * 3) % 3; ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillRect(x + w / 2 - 2 + s, 23 - s, 1, 2);
      } else if (type === "poster") {
        ctx.fillStyle = "#1c1917"; ctx.fillRect(x, 12, 24, 30); ctx.fillStyle = c; ctx.fillRect(x + 2, 14, 20, 26);
        ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(x + 5, 18, 14, 2); ctx.fillRect(x + 5, 22, 10, 2);
        ctx.fillStyle = "#fff"; ctx.fillRect(x + 8, 28, 8, 8);
      } else if (type === "frame") {
        ctx.fillStyle = "#e9e2d6"; ctx.fillRect(x, 14, 22, 26); ctx.fillStyle = c; ctx.fillRect(x + 3, 17, 16, 20);
        ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x + 6, 21, 6, 6);
      } else if (type === "clock") {
        ctx.fillStyle = "#1c1917"; ctx.fillRect(x, 14, 16, 16); ctx.fillStyle = "#f4efe6"; ctx.fillRect(x + 2, 16, 12, 12);
        const d = new Date(), m = d.getMinutes() / 60 * Math.PI * 2, h = (d.getHours() % 12) / 12 * Math.PI * 2;
        ctx.strokeStyle = "#1c1917"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 8, 22); ctx.lineTo(x + 8 + Math.sin(m) * 5, 22 - Math.cos(m) * 5);
        ctx.moveTo(x + 8, 22); ctx.lineTo(x + 8 + Math.sin(h) * 3, 22 - Math.cos(h) * 3); ctx.stroke();
      } else if (type === "shelf") {
        ctx.fillStyle = "#5a4533"; ctx.fillRect(x, 26, 40, 3); ctx.fillRect(x, 42, 40, 3);
        const cols = ["#c0563f", "#3e6bb0", "#e2b04a", "#4c9a6a", "#8a5bb5", "#d9d2c3"];
        for (let i = 0; i < 9; i++) { ctx.fillStyle = cols[i % 6]; ctx.fillRect(x + 2 + i * 4, 17 + (i % 3), 3, 9 - (i % 3)); }
        ctx.fillStyle = "#4c9a6a"; ctx.fillRect(x + 6, 36, 6, 6); ctx.fillStyle = "#b07a4a"; ctx.fillRect(x + 7, 38, 4, 4);
        ctx.fillStyle = "#d9d2c3"; ctx.fillRect(x + 20, 34, 12, 8);
      } else if (type === "board") {
        ctx.fillStyle = "#9aa3ad"; ctx.fillRect(x, 10, 72, 36); ctx.fillStyle = "#f4f6f8"; ctx.fillRect(x + 2, 12, 68, 32);
        ctx.fillStyle = "#3e6bb0"; ctx.fillRect(x + 6, 16, 18, 2); ctx.fillRect(x + 6, 21, 26, 1); ctx.fillRect(x + 6, 25, 22, 1);
        ctx.fillStyle = "#c0563f"; ctx.fillRect(x + 40, 16, 10, 10); ctx.fillStyle = "#4c9a6a"; ctx.fillRect(x + 54, 20, 10, 10);
        ctx.strokeStyle = "#1c1917"; ctx.beginPath(); ctx.moveTo(x + 50, 21); ctx.lineTo(x + 54, 25); ctx.stroke();
        ctx.fillStyle = "#f2b84b"; ctx.fillRect(x + 8, 32, 8, 8); ctx.fillRect(x + 20, 33, 8, 8);
      } else if (type === "chart") {
        ctx.fillStyle = "#1c1917"; ctx.fillRect(x, 10, 56, 34); ctx.fillStyle = "#0f1a14"; ctx.fillRect(x + 2, 12, 52, 30);
        const pts = [30, 27, 28, 22, 23, 17, 15]; ctx.strokeStyle = "#4fd18b"; ctx.beginPath();
        pts.forEach((p, i) => i ? ctx.lineTo(x + 6 + i * 7, p + 6) : ctx.moveTo(x + 6, p + 6)); ctx.stroke();
        ctx.fillStyle = "#4fd18b"; ctx.fillRect(x + 47, 19 + (Math.floor(t * 2) % 2), 2, 2);
      } else if (type === "trophies") {
        ctx.fillStyle = "#5a4533"; ctx.fillRect(x, 38, 44, 3);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#cfd6dc" : "#f2b84b"; ctx.fillRect(x + 4 + i * 10, 28, 6, 6); ctx.fillRect(x + 6 + i * 10, 34, 2, 2); ctx.fillRect(x + 4 + i * 10, 36, 6, 2); }
      }
    }
  }

  function drawFloor(ctx, room) {
    const f = room.floor;
    for (let y = WALL * T; y < LH; y += 8) {
      const row = (y / 8) | 0;
      for (let x = 0, i = 0; x < LW; i++) {
        seed = row * 97 + i * 13 + 5; const len = 24 + Math.floor(rnd() * 28);
        ctx.fillStyle = shade(f, (rnd() - .5) * .12); ctx.fillRect(x, y, len, 7);
        ctx.fillStyle = shade(f, -.22); ctx.fillRect(x, y + 7, len, 1); ctx.fillRect(x + len - 1, y, 1, 7);
        x += len;
      }
    }
  }

  function furniture(L) {
    // Lista de piezas con su y de profundidad para ordenarlas junto a los personajes.
    const list = [];
    for (const it of L.items) {
      const [type, x, y, w = 1, h = 1] = it;
      list.push({ type, x, y, w, h, z: type === "rug" ? -1 : (y + h) * T - 1 });
    }
    for (const d of L.desks) list.push({ type: "desk", x: d.x, y: d.y, w: d.w, h: 1, d, z: (d.y + 1) * T - 1 });
    return list;
  }

  function drawItem(ctx, it, ctxInfo) {
    const x = it.x * T, y = it.y * T, w = it.w * T, h = it.h * T, t = ctxInfo.t;
    switch (it.type) {
      case "rug": ctx.fillStyle = "#3a4a6a"; ctx.fillRect(x, y, w, h); ctx.fillStyle = "#4c5f86"; ctx.fillRect(x + 3, y + 3, w - 6, h - 6); ctx.fillStyle = "#3a4a6a"; ctx.fillRect(x + 6, y + 6, w - 12, h - 12); break;
      case "desk": {
        const d = it.d, ag = ctxInfo.agents[d.a], working = ag && ag.state === "work";
        ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fillRect(x + 2, y + 12, w - 2, 4);
        ctx.fillStyle = d.boss ? "#6b4a2e" : "#b48a5a"; ctx.fillRect(x, y + 2, w, 10);
        ctx.fillStyle = d.boss ? "#7d583a" : "#c99d6b"; ctx.fillRect(x, y + 2, w, 3);
        ctx.fillStyle = d.boss ? "#4a321f" : "#8a6640"; ctx.fillRect(x + 1, y + 12, 2, 4); ctx.fillRect(x + w - 3, y + 12, 2, 4);
        const mons = d.dual ? [x + w / 2 - 13, x + w / 2 + 1] : [x + w / 2 - 7];
        for (const mx of mons) {
          ctx.fillStyle = "#1c1f26"; ctx.fillRect(mx, y - 8, 12 + (d.rig ? 4 : 0), 9); ctx.fillRect(mx + 5, y + 1, 2, 2);
          if (working) {
            ctx.fillStyle = ctxInfo.accent; ctx.fillRect(mx + 1, y - 7, 10 + (d.rig ? 4 : 0), 7);
            ctx.fillStyle = "rgba(10,16,32,.55)";
            for (let i = 0; i < 3; i++) ctx.fillRect(mx + 2, y - 6 + i * 2, 2 + ((Math.floor(t * 5) + i * 3) % 7), 1);
            ctx.fillStyle = ctxInfo.accent + "22"; ctx.fillRect(mx - 3, y - 10, 18 + (d.rig ? 4 : 0), 14);
          } else { ctx.fillStyle = "#2c3240"; ctx.fillRect(mx + 1, y - 7, 10 + (d.rig ? 4 : 0), 7); }
        }
        ctx.fillStyle = "#d9d9d9"; ctx.fillRect(x + w / 2 - 4, y + 6, 8, 2);
        ctx.fillStyle = "#f4efe6"; ctx.fillRect(x + 2, y + 5, 4, 3); ctx.fillStyle = "#b65f3a"; ctx.fillRect(x + w - 6, y + 4, 3, 4);
        if (d.boss) { ctx.fillStyle = "#3e7d4f"; ctx.fillRect(x + w - 8, y - 4, 4, 6); ctx.fillStyle = "#f2b84b"; ctx.fillRect(x + 4, y + 4, 6, 1); }
        // silla
        ctx.fillStyle = "#2b2f3a"; ctx.fillRect(x + w / 2 - 5, y + 18, 10, 9); ctx.fillStyle = "#3a4050"; ctx.fillRect(x + w / 2 - 5, y + 18, 10, 2);
        break;
      }
      case "counter": ctx.fillStyle = "#6b4a2e"; ctx.fillRect(x, y + 4, w, 12); ctx.fillStyle = "#e9e2d6"; ctx.fillRect(x, y + 2, w, 4);
        for (let i = 0; i < it.w; i++) { ctx.fillStyle = "#5a3d25"; ctx.fillRect(x + i * T + 2, y + 8, 12, 6); } break;
      case "coffee": ctx.fillStyle = "#2b2f3a"; ctx.fillRect(x + 2, y - 10, 12, 13); ctx.fillStyle = "#c0563f"; ctx.fillRect(x + 4, y - 8, 3, 2);
        ctx.fillStyle = "#f4efe6"; ctx.fillRect(x + 6, y, 4, 2);
        for (let i = 0; i < 3; i++) { const k = (t * 8 + i * 5) % 14; ctx.fillStyle = `rgba(255,255,255,${.5 - k / 30})`; ctx.fillRect(x + 7 + Math.round(Math.sin(t * 3 + i)), y - 2 - k, 1, 2); } break;
      case "plant": ctx.fillStyle = "#8a5a3a"; ctx.fillRect(x + 4, y + 8, 8, 7); ctx.fillStyle = "#2f7a4a"; ctx.fillRect(x + 2, y - 2, 12, 10); ctx.fillStyle = "#3f9a5e"; ctx.fillRect(x + 5, y - 6, 6, 8); ctx.fillRect(x, y + 2, 4, 4); ctx.fillRect(x + 12, y, 4, 4); break;
      case "plantsmall": ctx.fillStyle = "#c0563f"; ctx.fillRect(x + 5, y + 9, 6, 6); ctx.fillStyle = "#3f9a5e"; ctx.fillRect(x + 4, y + 3, 8, 6); ctx.fillRect(x + 6, y, 4, 4); break;
      case "sofa": ctx.fillStyle = "#4a5f8a"; ctx.fillRect(x, y - 4, w, 8); ctx.fillStyle = "#5b72a3"; ctx.fillRect(x, y + 4, w, 9); ctx.fillStyle = "#3e5077"; ctx.fillRect(x - 2, y, 3, 13); ctx.fillRect(x + w - 1, y, 3, 13); break;
      case "table": ctx.fillStyle = "#c99d6b"; ctx.fillRect(x, y + 2, w, 8); ctx.fillStyle = "#8a6640"; ctx.fillRect(x + 2, y + 10, 2, 4); ctx.fillRect(x + w - 4, y + 10, 2, 4);
        ctx.fillStyle = "#f4efe6"; ctx.fillRect(x + 10, y + 3, 4, 3); ctx.fillRect(x + 26, y + 4, 6, 4); break;
      case "cooler": ctx.fillStyle = "#cfe8ff"; ctx.fillRect(x + 4, y - 6, 8, 8); ctx.fillStyle = "#e9edf2"; ctx.fillRect(x + 3, y + 2, 10, 12); ctx.fillStyle = "#3e6bb0"; ctx.fillRect(x + 6, y + 5, 4, 2); break;
      case "lightbox": ctx.fillStyle = "#c99d6b"; ctx.fillRect(x, y + 2, w, h - 4); ctx.fillStyle = "#f7f3e8"; ctx.fillRect(x + 4, y + 5, w - 8, h - 12);
        ctx.fillStyle = "#ff8fb1"; ctx.fillRect(x + 10, y + 9, 10, 8); ctx.fillStyle = "#7aa7ff"; ctx.fillRect(x + 24, y + 11, 10, 10); ctx.fillStyle = "#4fd18b"; ctx.fillRect(x + 40, y + 8, 8, 12); break;
      case "easel": ctx.fillStyle = "#8a5a3a"; ctx.fillRect(x + 2, y + 2, 2, 14); ctx.fillRect(x + 12, y + 2, 2, 14); ctx.fillRect(x + 7, y - 4, 2, 20);
        ctx.fillStyle = "#f4efe6"; ctx.fillRect(x, y - 8, 16, 12); ctx.fillStyle = "#ff8fb1"; ctx.fillRect(x + 3, y - 5, 5, 5); ctx.fillStyle = "#7aa7ff"; ctx.fillRect(x + 8, y - 3, 5, 4); break;
      case "tripod": ctx.fillStyle = "#222"; ctx.fillRect(x + 7, y - 2, 2, 14); ctx.fillRect(x + 3, y + 12, 10, 2); ctx.fillStyle = "#1c1f26"; ctx.fillRect(x + 3, y - 8, 10, 7); ctx.fillStyle = "#c0563f"; ctx.fillRect(x + 11, y - 7, 1, 1); ctx.fillStyle = "#3e6bb0"; ctx.fillRect(x + 1, y - 6, 2, 3); break;
      case "softbox": ctx.fillStyle = "#222"; ctx.fillRect(x + 7, y - 2, 2, 16); ctx.fillStyle = "#f7f3e8"; ctx.fillRect(x + 1, y - 14, 14, 12); ctx.fillStyle = "rgba(255,248,220,.12)"; ctx.fillRect(x - 10, y - 16, 36, 30); break;
      case "rack": ctx.fillStyle = "#1c1f26"; ctx.fillRect(x + 1, y - 10, 14, 26); for (let i = 0; i < 6; i++) { ctx.fillStyle = "#2c3240"; ctx.fillRect(x + 3, y - 8 + i * 4, 10, 3);
        ctx.fillStyle = (Math.floor(t * 4 + i * 1.7 + x) % 3) ? "#4fd18b" : "#1d3b2a"; ctx.fillRect(x + 11, y - 7 + i * 4, 1, 1); ctx.fillStyle = (Math.floor(t * 3 + i) % 4) ? "#7aa7ff" : "#1d2b45"; ctx.fillRect(x + 9, y - 7 + i * 4, 1, 1); } break;
      case "beanbag": ctx.fillStyle = "#c0563f"; ctx.fillRect(x, y + 4, 16, 10); ctx.fillStyle = "#d86a50"; ctx.fillRect(x + 2, y + 2, 12, 6); break;
      case "printer": ctx.fillStyle = "#d9d9d9"; ctx.fillRect(x, y + 2, 16, 10); ctx.fillStyle = "#9aa3ad"; ctx.fillRect(x + 2, y + 4, 12, 2); ctx.fillStyle = "#fff"; ctx.fillRect(x + 4, y - 2, 8, 4); break;
      case "meeting": ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(x + 2, y + h - 2, w - 2, 4); ctx.fillStyle = "#e9e2d6"; ctx.fillRect(x, y + 2, w, h - 4); ctx.fillStyle = "#cfc6b6"; ctx.fillRect(x, y + h - 6, w, 4);
        for (let i = 0; i < it.w; i++) { ctx.fillStyle = "#2b2f3a"; ctx.fillRect(x + i * T + 3, y - 4, 10, 5); ctx.fillRect(x + i * T + 3, y + h - 1, 10, 5); }
        ctx.fillStyle = "#1c1f26"; ctx.fillRect(x + w / 2 - 8, y + 6, 16, 10); ctx.fillStyle = "#4fd18b"; ctx.fillRect(x + w / 2 - 6, y + 8, 12, 6); break;
      case "bell": ctx.fillStyle = "#5a4533"; ctx.fillRect(x + 2, y + 10, 12, 4); ctx.fillStyle = "#f2b84b"; ctx.fillRect(x + 4, y + 4, 8, 6); ctx.fillRect(x + 7, y + 2, 2, 2); break;
    }
  }

  // ---------- rejilla y caminos ----------
  function buildGrid(L) {
    const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, () => y < WALL));
    const block = (x, y, w = 1, h = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < W) g[j][i] = true; };
    for (const d of L.desks) block(d.x, d.y, d.w, 1);
    for (const [type, x, y, w = 1, h = 1] of L.items) if (type !== "rug") block(x, y, w, h);
    return g;
  }
  function path(g, sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    const key = (x, y) => y * W + x, prev = new Map([[key(sx, sy), -1]]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(k)) continue;
        if (g[ny][nx] && !(nx === tx && ny === ty)) continue;
        prev.set(k, key(x, y)); q.push([nx, ny]);
      }
    }
    if (!prev.has(key(tx, ty))) return null;
    const out = []; let k = key(tx, ty);
    while (k !== key(sx, sy)) { out.unshift([k % W, (k / W) | 0]); k = prev.get(k); }
    return out;
  }

  // ---------- escena ----------
  function create(canvas, { agents, onPick, getState }) {
    const ctx = canvas.getContext("2d");
    let room = null, L = null, grid = null, items = [], actors = {}, raf = 0, last = 0, running = false, hover = null, selected = null;
    const S = 3;
    canvas.width = LW * S; canvas.height = LH * S;
    agents.forEach((a, i) => { a.blink = i * 1.7; });

    function setRoom(r) {
      room = r; L = LAYOUTS[r.id]; grid = buildGrid(L); items = furniture(L); actors = {};
      for (const d of L.desks) {
        const a = agents.find(x => x.id === d.a); if (!a) continue;
        const seatX = (d.x + d.w / 2) * T, seatY = (d.y + 1) * T + 14;
        actors[a.id] = { a, d, seat: [seatX, seatY], seatTile: [Math.floor(d.x + d.w / 2 - .5), d.y + 1], x: seatX, y: seatY, tile: [Math.floor(d.x + d.w / 2 - .5), d.y + 1],
          mode: "sit", wait: 2 + Math.random() * 8, route: [], dir: "up", frame: 0, ft: 0, state: "idle" };
      }
    }
    function tileCenter([x, y]) { return [x * T + 8, y * T + 14]; }
    function goTo(ac, tile, then) {
      const p = path(grid, ac.tile[0], ac.tile[1], tile[0], tile[1]);
      if (!p) return false;
      ac.route = p; ac.mode = "walk"; ac.then = then; return true;
    }
    function update(dt, t) {
      const st = getState();
      for (const ac of Object.values(actors)) {
        const want = st.status[ac.a.id] || "idle";
        ac.state = want;
        if (want !== "idle" && ac.mode !== "sit" && ac.then !== "sit") {
          ac.route = []; goTo(ac, ac.seatTile, "sit") || Object.assign(ac, { mode: "sit", x: ac.seat[0], y: ac.seat[1] });
        }
        if (ac.mode === "sit") {
          ac.dir = "up"; ac.x = ac.seat[0]; ac.y = ac.seat[1];
          if (want === "idle") { ac.wait -= dt; if (ac.wait <= 0) {
            const free = L.pois.filter(p => !grid[p[1]][p[0]]);
            const target = free[Math.floor(Math.random() * free.length)];
            ac.tile = [...ac.seatTile];
            if (target && goTo(ac, target, "linger")) ac.mode = "walk"; else ac.wait = 6;
          } }
        } else if (ac.mode === "walk") {
          const next = ac.route[0];
          if (!next) {
            if (ac.then === "sit") { ac.mode = "sit"; ac.wait = 8 + Math.random() * 14; }
            else { ac.mode = "linger"; ac.wait = 3 + Math.random() * 5; ac.dir = "up"; }
            continue;
          }
          let [tx, ty] = tileCenter(next);
          if (ac.route.length === 1 && ac.then === "sit") [tx, ty] = ac.seat;
          const dx = tx - ac.x, dy = ty - ac.y, dist = Math.hypot(dx, dy), sp = 34 * dt;
          if (dist <= sp) { ac.x = tx; ac.y = ty; ac.tile = next; ac.route.shift(); }
          else { ac.x += dx / dist * sp; ac.y += dy / dist * sp; }
          ac.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
          ac.ft += dt; if (ac.ft > .12) { ac.ft = 0; ac.frame++; }
        } else if (ac.mode === "linger") {
          ac.frame = 0; ac.wait -= dt;
          if (ac.wait <= 0) { goTo(ac, ac.seatTile, "sit") || Object.assign(ac, { mode: "sit" }); }
        }
      }
    }
    function bubble(x, y, text, color) {
      ctx.font = `8px ${PIX}`; const w = Math.min(ctx.measureText(text).width + 8, 110);
      const bx = Math.round(Math.max(2, Math.min(LW - w - 2, x - w / 2))), by = Math.round(y);
      ctx.fillStyle = "rgba(20,20,18,.55)"; ctx.fillRect(bx, by + 1, w + 1, 12);
      ctx.fillStyle = "#fbfaf7"; ctx.fillRect(bx, by, w, 11); ctx.fillRect(Math.round(x) - 1, by + 11, 3, 2);
      ctx.fillStyle = color; ctx.fillRect(bx, by, 2, 11);
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, w, 11); ctx.clip();
      ctx.fillStyle = "#1d1d1b"; ctx.textBaseline = "top"; ctx.fillText(text, bx + 5, by + 2); ctx.restore();
    }
    function label(x, y, text, sel) {
      ctx.font = `8px ${PIX}`; const w = ctx.measureText(text).width + 6;
      const bx = Math.round(x - w / 2), by = Math.round(y);
      ctx.fillStyle = sel ? "#fbfaf7" : "rgba(24,24,22,.72)"; ctx.fillRect(bx, by, w, 10);
      ctx.fillStyle = sel ? "#1d1d1b" : "#f1efe9"; ctx.textBaseline = "top"; ctx.fillText(text, bx + 3, by + 1);
    }
    function draw(t) {
      ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = false;
      drawFloor(ctx, room); drawWall(ctx, room, L, t);
      const info = { t, agents: Object.fromEntries(Object.values(actors).map(ac => [ac.a.id, ac])), accent: room.accent };
      const drawables = items.map(it => ({ z: it.z, f: () => drawItem(ctx, it, info) }));
      for (const ac of Object.values(actors)) {
        const sit = ac.mode === "sit";
        drawables.push({ z: sit ? ac.y - 6 : ac.y, f: () => {
          if (selected === ac.a.id) { ctx.fillStyle = room.accent + "66"; ctx.fillRect(Math.round(ac.x) - 8, Math.round(ac.y) - 2, 16, 4); }
          drawPerson(ctx, ac.a, ac.x, ac.y, { dir: ac.dir, frame: ac.frame, sit, work: ac.state === "work", t });
        } });
      }
      drawables.sort((a, b) => a.z - b.z).forEach(d => d.f());
      // etiquetas y bocadillos encima de todo
      const st = getState();
      for (const ac of Object.values(actors)) {
        label(ac.x, ac.y + 2, ac.a.name, selected === ac.a.id || hover === ac.a.id);
        if (ac.state === "work") {
          const dots = ".".repeat(1 + Math.floor(t * 3) % 3);
          bubble(ac.x, ac.y - 40, (st.bubble[ac.a.id] || "Trabajando") + dots, room.accent);
        } else if (ac.state === "queue") bubble(ac.x, ac.y - 40, "En cola", "#9a968c");
      }
    }
    function loop(now) {
      if (!running) return;
      const t = now / 1000, dt = Math.min(.05, t - (last || t)); last = t;
      update(dt, t); draw(t);
      raf = requestAnimationFrame(loop);
    }
    function pick(ev) {
      const r = canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width * LW, y = (ev.clientY - r.top) / r.height * LH;
      let best = null, bd = 14;
      for (const ac of Object.values(actors)) { const d = Math.hypot(ac.x - x, ac.y - 10 - y); if (d < bd) { bd = d; best = ac.a.id; } }
      return best;
    }
    canvas.addEventListener("click", ev => { const id = pick(ev); if (id) onPick(id); });
    canvas.addEventListener("mousemove", ev => { hover = pick(ev); canvas.style.cursor = hover ? "pointer" : "default"; });
    canvas.addEventListener("mouseleave", () => { hover = null; });
    return {
      setRoom(r) { setRoom(r); if (!running) draw(performance.now() / 1000); },
      select(id) { selected = id; },
      start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      drawStill() { draw(performance.now() / 1000); },
    };
  }

  // Retrato pequeño de un agente como imagen (para listas y paneles).
  const portraitCache = {};
  function portrait(a) {
    if (portraitCache[a.id]) return portraitCache[a.id];
    const c = document.createElement("canvas"); c.width = 16 * 6; c.height = 16 * 6;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.setTransform(6, 0, 0, 6, 0, 0);
    drawPerson(x, a, 8, 22, { dir: "down", frame: 0, sit: false, work: false, t: 0.3 });
    return (portraitCache[a.id] = c.toDataURL());
  }
  function roomThumb(r) {
    const c = document.createElement("canvas"); c.width = LW; c.height = LH;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
    const L = LAYOUTS[r.id]; drawFloor(x, r); drawWall(x, r, L, 0);
    const info = { t: 0, agents: {}, accent: r.accent };
    furniture(L).sort((a, b) => a.z - b.z).forEach(it => drawItem(x, it, info));
    return c.toDataURL();
  }
  return { create, portrait, roomThumb, LAYOUTS };
})();
