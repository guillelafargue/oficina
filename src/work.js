/* ---------- Entregas como documentos: estructura, lector, exportación y ejecución ---------- */

// Partes de una entrega: resumen, pasos, entrega final, cambios para Claude Code y siguiente paso.
function splitSections(text) {
  const out = [], lines = String(text || "").split("\n");
  let cur = { title: "", body: [] }, fence = false;
  for (const ln of lines) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    const m = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(ln);
    if (m && !/^###/.test(ln)) { out.push(cur); cur = { title: m[1].trim(), body: [] }; } else cur.body.push(ln);
  }
  out.push(cur);
  return out.map(x => ({ title: x.title, body: x.body.join("\n").trim() })).filter(x => x.title || x.body);
}
const NEXT_RE = /^\s*\**\s*Siguiente paso sugerido\s*\**\s*:?\s*\**\s*(.+)$/im;
const METHODS_RE = /^\s*\**\s*(Métodos? (aplicados?|que he aplicado)|He aplicado)[^\n]*$/im;
function docParts(t) {
  const raw = t.result || "";
  const next = (NEXT_RE.exec(raw)?.[1] || "").replace(/\*+$/, "").trim().replace(/^./, c => c.toUpperCase());
  const methods = (METHODS_RE.exec(raw)?.[0] || "").replace(/\*/g, "").trim();
  const clean = raw.replace(NEXT_RE, "").replace(METHODS_RE, "").trim();
  const secs = splitSections(clean);
  const pick = re => secs.find(x => re.test(x.title));
  const resumen = pick(/^resumen/i), final = pick(/^entrega final/i), cc = pick(/^cambios para claude code/i);
  const steps = secs.filter(x => /^\d+\s*[.)]/.test(x.title));
  const rest = secs.filter(x => x !== resumen && x !== final && x !== cc && !steps.includes(x));
  const join = list => list.map(x => (x.title ? `## ${x.title}\n\n` : "") + x.body).join("\n\n");
  // Con «Entrega final», el documento es la entrega y el proceso queda plegado; sin ella, todo es documento.
  const main = final ? final.body : join([...rest, ...steps]);
  const process = final ? join([...steps, ...rest]) : "";
  return { resumen: resumen?.body || "", main, process, cc: cc?.body || "", next, methods, stepsN: steps.length };
}
function kindOf(t) {
  const r = t.result || "";
  if (/data-composition-id/.test(r)) return { id: "video", label: "Vídeo" };
  if (/```html/i.test(r)) return { id: "web", label: "Boceto" };
  if (/^##\s*Cambios para Claude Code/im.test(r)) return { id: "app", label: "Cambio en la app" };
  if (/^###\s*(Opción|Propuesta)/im.test(r)) return { id: "options", label: "Propuestas" };
  if (/```mermaid[\s\S]*?\bgantt\b/i.test(r)) return { id: "plan", label: "Planning" };
  if (/```(js|ts|tsx|jsx|css|sql|py|bash|json|swift|kotlin)/i.test(r)) return { id: "code", label: "Código" };
  if (t.agentId === "elena" && t.runId) return { id: "report", label: "Informe" };
  return { id: "doc", label: "Documento" };
}
function summaryOf(t, n = 3) {
  const p = docParts(t);
  const bullets = (p.resumen || "").split("\n").map(l => l.replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/[*_`#>]/g, "").trim()).filter(Boolean);
  if (bullets.length) return bullets.slice(0, n);
  const plain = (p.main || t.result || "").replace(/```[\s\S]*?```/g, " ").replace(/[#*|`>_-]+/g, " ").replace(/\s+/g, " ").trim();
  return plain ? [plain.slice(0, 240) + (plain.length > 240 ? "…" : "")] : [];
}

/* ---------- Lector ---------- */
const READER = { id: null, blocks: [], lastPaint: 0 };
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
function loadScript(src, test) {
  if (test()) return Promise.resolve();
  return (loadScript.p ||= {})[src] ||= new Promise((ok, ko) => {
    const s = document.createElement("script"); s.src = src; s.onload = () => test() ? ok() : ko(new Error("No se pudo cargar " + src));
    s.onerror = () => { delete loadScript.p[src]; ko(new Error("Sin conexión con la librería")); }; document.head.appendChild(s);
  });
}
const LIB = {
  mermaid: () => loadScript("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js", () => !!window.mermaid).then(() => {
    if (!LIB._mm) { window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "Geist, system-ui, sans-serif", flowchart: { htmlLabels: false, curve: "basis" }, gantt: { barHeight: 22, fontSize: 12 } }); LIB._mm = true; }
    return window.mermaid;
  }),
  pdf: () => loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js", () => !!window.pdfMake)
    .then(() => loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js", () => !!window.pdfMake?.vfs?.["Roboto-Regular.ttf"])).then(() => window.pdfMake),
  docx: () => loadScript("https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js", () => !!window.docx).then(() => window.docx),
};
let mmSeq = 0;
async function mermaidSvg(code) { const mm = await LIB.mermaid(); const { svg } = await mm.render("mm" + (++mmSeq), code.trim()); return svg; }
// Convierte un diagrama en PNG para los documentos (sin foreignObject para que el lienzo no se bloquee).
async function svgToPng(svg, maxW = 1400) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml"), el = doc.documentElement;
  const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  let w = vb.length === 4 && vb[2] ? vb[2] : parseFloat(el.getAttribute("width")) || 800, h = vb.length === 4 && vb[3] ? vb[3] : parseFloat(el.getAttribute("height")) || 400;
  el.setAttribute("width", w); el.setAttribute("height", h); el.style.maxWidth = "none";
  const k = Math.min(2, maxW / w), img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(el)); await img.decode();
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/png"), w, h };
}
// Mejora el HTML del Markdown: diagramas, bocetos en miniatura, tarjetas de opciones, tablas con scroll y copiar código.
function enhanceDoc(root, t, live) {
  root.querySelectorAll("pre > code").forEach(code => {
    const pre = code.parentElement, lang = (/language-(\S+)/.exec(code.className) || [])[1] || "", src = code.textContent;
    if (lang === "mermaid") {
      const box = document.createElement("figure"); box.className = "diagram"; box.dataset.mm = src; box.innerHTML = `<div class="dg-in note">${live ? "El diagrama se dibuja al terminar." : "Dibujando el diagrama…"}</div>`;
      pre.replaceWith(box); return;
    }
    if (lang === "html") {
      const i = READER.blocks.push(src) - 1, comp = /data-composition-id/.test(src);
      const card = document.createElement("figure"); card.className = "sketch";
      card.innerHTML = `<div class="sk-view"><iframe sandbox="allow-scripts" title="Boceto" loading="lazy" tabindex="-1"></iframe></div>
        <figcaption><span><b>${comp ? "Composición de vídeo" : "Boceto"}</b><span class="note">${comp ? "Se reproduce y se descarga en MP4." : "Se ve en vivo, en móvil y en escritorio."}</span></span>
        <span class="sk-acts"><button class="btn sm" type="button" data-sketch="${i}">${comp ? "Ver vídeo" : "Abrir boceto"}</button><button class="btn ghost sm" type="button" data-sketchcode="${i}">Código</button></span></figcaption>`;
      if (!live) card.querySelector("iframe").srcdoc = sketchDoc(src, true);
      pre.replaceWith(card); return;
    }
    const b = document.createElement("button"); b.type = "button"; b.className = "copycode"; b.textContent = "Copiar"; b.dataset.copycode = "1";
    pre.classList.add("code"); pre.appendChild(b);
  });
  root.querySelectorAll("table").forEach(tb => { if (tb.parentElement.classList.contains("tbl")) return; const w = document.createElement("div"); w.className = "tbl"; tb.replaceWith(w); w.appendChild(tb); });
  // Cada «Opción …» o «Propuesta …» con su contenido se agrupa en una tarjeta.
  [...root.querySelectorAll("h3")].filter(h => /^(opción|opcion|propuesta|alternativa|escenario)\b/i.test(h.textContent.trim())).forEach(h => {
    const card = document.createElement("section"); card.className = "opt"; h.before(card);
    let n = h; const take = [];
    while (n && !(n !== h && /^H[1-3]$/.test(n.tagName)) && !(n.tagName === "HR")) { take.push(n); n = n.nextElementSibling; }
    take.forEach(x => card.appendChild(x));
    if (/recomend/i.test(card.textContent.slice(0, 160))) card.classList.add("rec");
  });
  root.querySelectorAll("a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
  if (!live) drawDiagrams(root);
}
async function drawDiagrams(root) {
  for (const box of root.querySelectorAll("figure.diagram[data-mm]")) {
    const code = box.dataset.mm; delete box.dataset.mm;
    try { box.innerHTML = `<div class="dg-in">${await mermaidSvg(code)}</div>`; }
    catch { box.innerHTML = `<pre class="code">${esc(code)}</pre><p class="note">No se pudo dibujar este diagrama; se muestra su código.</p>`; }
  }
}
function sketchDoc(html, thumb) {
  const base = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  return thumb ? base.replace(/<head(\s[^>]*)?>/i, m => m + "<style>html,body{overflow:hidden!important}</style>") + (/data-composition-id/.test(html) ? LIVE_PLAYER : "") : base;
}
function tocHTML(root) {
  const hs = [...root.querySelectorAll(".r-main h2, .r-main h3, .r-main .opt > h3")].filter((h, i, a) => a.indexOf(h) === i);
  hs.forEach((h, i) => { h.id = "s" + i; });
  return hs.length > 1 ? `<p class="lbl">En este documento</p>${hs.map(h => `<a href="#${h.id}" class="${h.tagName === "H3" ? "sub" : ""}" data-toc="${h.id}">${esc(h.textContent)}</a>`).join("")}` : "";
}
function openReader(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  READER.id = id; closeAgent();
  $("#reader").hidden = false; document.body.classList.add("noscroll");
  paintReader(true);
  $("#reader .r-scroll").scrollTop = 0;
  if (location.hash !== "#e-" + id) history.pushState(null, "", "#e-" + id);
}
function closeReader() {
  if (!READER.id) return;
  READER.id = null; $("#reader").hidden = true; document.body.classList.remove("noscroll");
  if (location.hash.startsWith("#e-")) history.replaceState(null, "", "#" + state.view);
}
window.addEventListener("popstate", () => { const h = location.hash; if (h.startsWith("#e-")) openReader(h.slice(3)); else closeReader(); });
function paintReader(full) {
  const t = state.tasks.find(x => x.id === READER.id); if (!t) return closeReader();
  const a = byId[t.agentId], r = roomById[a.room], k = kindOf(t), p = docParts(t), live = t.status === "work";
  const prog = progressOf(t);
  READER.blocks = [];
  $("#rCrumb").innerHTML = `<img class="px" src="${P(a)}" alt=""><span><b>${esc(a.name)}</b> · ${esc(r.name)}</span>`;
  const html = !t.result && live ? "" : md(p.main || (live ? t.result : ""));
  const others = AGENTS.filter(x => x.id !== t.agentId);
  const sk = [t.skillId, ...(t.autoSkills || [])].filter(Boolean).map(skillById).filter(Boolean);
  const execs = (t.exec || []).slice().reverse();
  $("#rActs").innerHTML = live
    ? `<button class="btn ghost sm" type="button" data-stop="${t.id}">Detener</button>`
    : t.status === "error"
      ? `<button class="btn sm" type="button" data-retry="${t.id}">${t.interrupted || t.stopped ? "Seguir" : "Reintentar"}</button><button class="btn ghost sm" type="button" data-archive="${t.id}">${t.archived ? "Desarchivar" : "Archivar"}</button><button class="btn ghost sm" type="button" data-del="${t.id}">Borrar</button>`
      : `${READER_SKETCH(t)}<button class="btn ghost sm" type="button" data-apply="${t.id}">Aplicar en la app</button>
        <details class="menu"><summary class="btn sm">Descargar</summary><div class="menu-pop"><button type="button" data-export="pdf" data-eid="${t.id}"><b>PDF</b><span>Documento listo para leer o imprimir</span></button><button type="button" data-export="docx" data-eid="${t.id}"><b>Word</b><span>Para editarlo en Word, Pages o Google Docs</span></button><button type="button" data-export="md" data-eid="${t.id}"><b>Markdown</b><span>Texto con formato, para Notion o GitHub</span></button>${READER.blocksAny ? "" : ""}</div></details>
        <details class="menu"><summary class="btn ghost sm" aria-label="Más acciones">Más</summary><div class="menu-pop right"><button type="button" data-copy="${t.id}"><b>Copiar texto</b></button><button type="button" data-improve="${t.id}"><b>Revisar y mejorar</b><span>El puesto la critica y entrega otra versión</span></button><button type="button" data-archive="${t.id}"><b>${t.archived ? "Desarchivar" : "Archivar"}</b><span>La quita de las listas sin borrarla</span></button><button type="button" class="bad" data-del="${t.id}"><b>Borrar</b></button></div></details>`;
  const steps = t.steps?.length ? `<ol class="r-steps">${t.steps.map((s, i) => `<li class="${i + 1 < (t.step || 0) || t.status === "done" ? "done" : i + 1 === (t.step || 1) && live && t.phase === "exec" ? "cur" : ""}">${esc(s)}</li>`).join("")}</ol>` : "";
  const doc = `<header class="r-head"><p class="kicker">${esc(k.label)} · ${live ? esc(prog.txt) : t.status === "error" ? "Con error" : fmtDate(t.createdAt)}${t.archived ? " · Archivado" : ""}</p><h1 id="rTitle">${esc(t.order)}</h1></header>
    ${p.resumen ? `<section class="r-sum"><p class="lbl">Resumen</p>${md(p.resumen)}</section>` : ""}
    ${live && t.steps?.length ? `<section class="r-progress"><p class="lbl">${esc(prog.txt)}</p>${steps}</section>` : ""}
    <div class="r-main md2">${html || `<p class="thinking">${esc(prog.txt)}…</p>`}</div>
    ${p.cc ? `<section class="r-cc"><div class="r-cc-h"><p class="lbl">Cambios para la app</p>${live ? "" : `<button class="btn sm" type="button" data-apply="${t.id}">Enviar a Claude Code</button>`}</div><div class="md2">${md(p.cc)}</div></section>` : ""}
    ${p.process ? `<details class="r-proc"><summary>Cómo lo ha trabajado <span class="note">${p.stepsN ? p.stepsN + " pasos" : "detalle"}</span></summary><div class="md2">${md(p.process)}</div></details>` : ""}
    ${t.firstResult && t.revised ? `<details class="r-proc"><summary>Primera versión <span class="note">antes de su autoevaluación</span></summary><div class="md2">${md(t.firstResult)}</div></details>` : ""}`;
  const side = `<section><p class="lbl">Sobre esta entrega</p><dl class="facts">
      <dt>Puesto</dt><dd><button class="linkbtn" type="button" data-agent="${a.id}">${esc(a.name)}</button></dd>
      <dt>Pedido por</dt><dd>${esc(t.from)}</dd><dt>Fecha</dt><dd>${fmtDate(t.createdAt)}</dd>
      <dt>Modo</dt><dd>${t.mode === "pro" ? "Por pasos" : "Rápido"}</dd>
      ${sk.length ? `<dt>Métodos</dt><dd>${sk.map(s => esc(s.name)).join(", ")}</dd>` : ""}
      ${typeof t.score === "number" ? `<dt>Autoevaluación</dt><dd>${t.score}/10${t.revised ? ", revisada" : ""}</dd>` : ""}</dl>
      ${p.methods ? `<p class="note">${esc(p.methods)}</p>` : ""}</section>
    ${t.status === "done" ? `<section><p class="lbl">¿Te sirve?</p>${t.feedback === "up" ? `<p class="note">La marcaste como útil.</p>` : t.feedback === "down" ? `<p class="note">La marcaste como mejorable y se está rehaciendo.</p>` : `<div class="crow"><button class="btn ghost sm" type="button" data-fb="up" data-fbid="${t.id}">Útil</button><button class="btn ghost sm" type="button" data-fb="down" data-fbid="${t.id}">Mejorable</button></div>
      <form class="fbform" data-fbform="${t.id}" hidden><label for="fbt-${t.id}" hidden>Qué falló</label><input id="fbt-${t.id}" placeholder="Qué debería hacer distinto"><button class="btn sm" type="submit">Rehacer</button></form>`}</section>` : ""}
    ${p.next && t.status === "done" ? `<section class="r-next"><p class="lbl">Siguiente paso</p><p>${esc(p.next)}</p><button class="btn sm" type="button" data-next="${t.id}">Encargarlo</button></section>` : ""}
    ${execs.length ? `<section><p class="lbl">En la app</p>${execs.map(x => `<div class="exec"><span class="st ${x.state || ""}">${esc(EXEC_LABEL[x.state] || "Enviado")}</span> <b>${esc(x.repo)}</b><span class="note">${fmtDate(x.at)}${x.auto ? " · automático" : ""}</span>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">Abrir en Claude Code</a>` : ""}${x.error ? `<span class="note bad">${esc(x.error)}</span>` : ""}${x.session ? `<button class="linkbtn" type="button" data-execcheck="${t.id}" data-sess="${esc(x.session)}">Comprobar estado</button>` : ""}</div>`).join("")}</section>` : ""}
    ${t.status === "done" ? `<section><p class="lbl">Pasar a otro puesto</p><div class="handoff"><label for="ho-${t.id}" hidden>Pasar a</label><select id="ho-${t.id}"><option value="">Elige puesto…</option>${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>
      <label for="hi-${t.id}" hidden>Instrucción</label><input id="hi-${t.id}" placeholder="Qué debe hacer con esto"><button class="btn ghost sm" type="button" data-handoff="${t.id}">Pasar</button></div></section>` : ""}`;
  const docEl = $("#rDoc");
  docEl.innerHTML = doc; enhanceDoc(docEl, t, live);
  requestAnimationFrame(() => docEl.querySelectorAll(".sk-view").forEach(v => v.style.setProperty("--k", (v.clientWidth / 1280).toFixed(4))));
  $("#rSide").innerHTML = side;
  $("#rToc").innerHTML = tocHTML(docEl);
  READER.lastPaint = Date.now();
}
const READER_SKETCH = t => { const h = liveHTML(t.result); return h ? `<button class="btn ghost sm" type="button" data-live="${t.id}">${/data-composition-id/.test(h) ? "Ver vídeo" : "Ver boceto"}</button>` : ""; };
function refreshReader() {
  if (!READER.id || !changed.has(READER.id)) return;
  const t = state.tasks.find(x => x.id === READER.id); if (!t) return closeReader();
  if (t.status === "work" && Date.now() - READER.lastPaint < 700) return;
  const sc = $("#reader .r-scroll"), top = sc.scrollTop, atEnd = sc.scrollTop + sc.clientHeight > sc.scrollHeight - 40;
  paintReader(); sc.scrollTop = atEnd && t.status === "work" ? sc.scrollHeight : top;
}

/* ---------- Exportar: PDF, Word y Markdown ---------- */
const decodeEnt = s => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }[e]));
function docTitle(list, key) {
  if (list.length === 1) return list[0].order;
  return `${state.company}: entregables${key ? " de " + key : ""}`;
}
async function diagramImages(tokens) {
  const out = new Map();
  const walk = toks => { for (const tk of toks || []) { if (tk.type === "code" && /^mermaid/i.test(tk.lang || "")) out.set(tk, null); walk(tk.tokens); (tk.items || []).forEach(i => walk(i.tokens)); } };
  walk(tokens);
  for (const tk of out.keys()) { try { out.set(tk, await svgToPng(await mermaidSvg(tk.text))); } catch { out.set(tk, null); } }
  return out;
}
function exportPieces(t) {
  const p = docParts(t);
  return { resumen: p.resumen, body: [p.main, p.cc ? "## Cambios para la app\n\n" + p.cc : "", p.process ? "# Anexo: cómo se ha trabajado\n\n" + p.process : ""].filter(Boolean).join("\n\n"), next: p.next, meta: `${byId[t.agentId].name} · ${fmtDate(t.createdAt)}${typeof t.score === "number" ? " · autoevaluación " + t.score + "/10" : ""}` };
}
// pdfmake: del árbol de marked a bloques con estilos sobrios.
function pdfInline(tokens, st = {}) {
  const out = [];
  for (const tk of tokens || []) {
    if (tk.type === "strong") out.push(...pdfInline(tk.tokens, { ...st, bold: true }));
    else if (tk.type === "em") out.push(...pdfInline(tk.tokens, { ...st, italics: true }));
    else if (tk.type === "del") out.push(...pdfInline(tk.tokens, { ...st, decoration: "lineThrough" }));
    else if (tk.type === "codespan") out.push({ text: decodeEnt(tk.text), ...st, background: "#efede7", fontSize: 9.5 });
    else if (tk.type === "link") out.push(...pdfInline(tk.tokens, { ...st, link: tk.href, color: "#2f6b4f", decoration: "underline" }));
    else if (tk.type === "br") out.push({ text: "\n" });
    else if (tk.type === "image") out.push({ text: tk.text || "", ...st });
    else if (tk.tokens) out.push(...pdfInline(tk.tokens, st));
    else out.push({ text: decodeEnt(tk.type === "html" ? tk.text.replace(/<[^>]+>/g, "") : tk.text ?? tk.raw ?? ""), ...st });
  }
  return out;
}
function pdfBlocks(tokens, imgs, depth = 0) {
  const out = [];
  for (const tk of tokens || []) {
    if (tk.type === "heading") out.push({ text: pdfInline(tk.tokens), style: "h" + Math.min(tk.depth + 1, 4), tocItem: tk.depth <= 2 && depth === 0 });
    else if (tk.type === "paragraph" || tk.type === "text") out.push({ text: pdfInline(tk.tokens || [{ type: "text", text: tk.text }]), style: "p" });
    else if (tk.type === "list") out.push({ [tk.ordered ? "ol" : "ul"]: tk.items.map(it => { const b = pdfBlocks(it.tokens, imgs, depth + 1); if (it.task) b.unshift({ text: it.checked ? "[x] " : "[ ] " }); return b.length === 1 ? b[0] : { stack: b }; }), style: "list", start: tk.start || 1 });
    else if (tk.type === "table") out.push({ table: { headerRows: 1, widths: tk.header.map(() => "*"), body: [tk.header.map(c => ({ text: pdfInline(c.tokens), bold: true, fontSize: 9.5 })), ...tk.rows.map(r => r.map(c => ({ text: pdfInline(c.tokens), fontSize: 9.5 })))] }, layout: { hLineWidth: (i, n) => i === 1 ? 0.8 : 0.4, vLineWidth: () => 0, hLineColor: () => "#cfcbc1", paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 4, paddingRight: () => 6 }, margin: [0, 4, 0, 10] });
    else if (tk.type === "code") {
      const im = imgs.get(tk);
      if (im) out.push({ image: im.url, width: Math.min(515, im.w), margin: [0, 6, 0, 12] });
      else if (/^html/i.test(tk.lang || "")) out.push({ text: "Boceto en HTML: ábrelo o descárgalo desde la oficina para verlo en vivo.", italics: true, color: "#55534d", style: "p" });
      else out.push({ table: { widths: ["*"], body: [[{ text: tk.text, fontSize: 8.5, preserveLeadingSpaces: true, color: "#1d1d1b" }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => "#f3f2ee", paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 2, 0, 10] });
    }
    else if (tk.type === "blockquote") out.push({ table: { widths: [2, "*"], body: [[{ text: "", fillColor: "#cfcbc1" }, { stack: pdfBlocks(tk.tokens, imgs, depth + 1), margin: [6, 0, 0, 0] }]] }, layout: "noBorders", margin: [0, 2, 0, 10] });
    else if (tk.type === "hr") out.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#cfcbc1" }], margin: [0, 8, 0, 8] });
  }
  return out;
}
async function exportPDF(list, title) {
  const pdfMake = await LIB.pdf();
  const content = [];
  for (const [i, t] of list.entries()) {
    const x = exportPieces(t), toks = marked.lexer(x.body), imgs = await diagramImages(toks);
    if (list.length > 1) content.push({ text: `${i + 1}. ${t.order}`, style: "h1", tocItem: true, pageBreak: i ? "before" : undefined });
    else content.push({ text: t.order, style: "title" });
    content.push({ text: x.meta, style: "meta" });
    if (x.resumen) content.push({ table: { widths: [3, "*"], body: [[{ text: "", fillColor: "#2f6b4f" }, { stack: [{ text: "Resumen", bold: true, fontSize: 10, margin: [0, 0, 0, 4] }, ...pdfBlocks(marked.lexer(x.resumen), new Map())], margin: [10, 6, 6, 4] }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: (r, n, c) => c === 1 ? "#f3f2ee" : null }, margin: [0, 6, 0, 16] });
    content.push(...pdfBlocks(toks, imgs));
    if (x.next) content.push({ text: [{ text: "Siguiente paso: ", bold: true }, x.next], style: "p", margin: [0, 10, 0, 0] });
  }
  if (list.length > 1) content.unshift({ text: title, style: "title" }, { text: `Exportado el ${new Date().toLocaleString("es-ES")} · ${list.length} entregables`, style: "meta" }, { toc: { title: { text: "Índice", style: "h2" } }, margin: [0, 0, 0, 0] }, { text: "", pageBreak: "after" });
  const dd = {
    info: { title, author: state.company, creator: "Oficina" }, pageSize: "A4", pageMargins: [40, 48, 40, 52], content,
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3, color: "#1d1d1b" },
    styles: { title: { fontSize: 21, bold: true, margin: [0, 0, 0, 4], lineHeight: 1.15 }, meta: { fontSize: 9, color: "#8a877f", margin: [0, 0, 0, 12] },
      h1: { fontSize: 17, bold: true, margin: [0, 6, 0, 6] }, h2: { fontSize: 14.5, bold: true, margin: [0, 14, 0, 6] }, h3: { fontSize: 12, bold: true, margin: [0, 10, 0, 4] }, h4: { fontSize: 10.5, bold: true, margin: [0, 8, 0, 3] },
      p: { margin: [0, 0, 0, 7] }, list: { margin: [0, 0, 0, 8] } },
    footer: (cur, total) => ({ columns: [{ text: state.company, color: "#8a877f", fontSize: 8 }, { text: `${cur} / ${total}`, alignment: "right", color: "#8a877f", fontSize: 8 }], margin: [40, 18, 40, 0] }),
  };
  const blob = await new Promise((ok, ko) => { try { pdfMake.createPdf(dd).getBlob(ok); } catch (e) { ko(e); } });
  return { blob, ext: ".pdf" };
}
// docx: mismo recorrido, con estilos de Word para que se pueda seguir editando.
async function exportDOCX(list, title) {
  const D = await LIB.docx();
  const runs = (tokens, st = {}) => {
    const out = [];
    for (const tk of tokens || []) {
      if (tk.type === "strong") out.push(...runs(tk.tokens, { ...st, bold: true }));
      else if (tk.type === "em") out.push(...runs(tk.tokens, { ...st, italics: true }));
      else if (tk.type === "del") out.push(...runs(tk.tokens, { ...st, strike: true }));
      else if (tk.type === "codespan") out.push(new D.TextRun({ text: decodeEnt(tk.text), font: "Consolas", ...st }));
      else if (tk.type === "link") out.push(new D.ExternalHyperlink({ link: tk.href, children: runs(tk.tokens, { ...st, style: "Hyperlink" }) }));
      else if (tk.type === "br") out.push(new D.TextRun({ text: "", break: 1 }));
      else if (tk.tokens) out.push(...runs(tk.tokens, st));
      else out.push(new D.TextRun({ text: decodeEnt(tk.type === "html" ? tk.text.replace(/<[^>]+>/g, "") : tk.text ?? tk.raw ?? ""), ...st }));
    }
    return out;
  };
  let listN = 0;
  const blocks = (tokens, imgs, lvl = 0, list = null) => {
    const out = [];
    for (const tk of tokens || []) {
      const para = (children, extra = {}) => new D.Paragraph({ children, ...(list ? (list.ordered ? { numbering: { reference: "num", level: lvl, instance: list.inst } } : { bullet: { level: lvl } }) : {}), spacing: { after: 100 }, ...extra });
      if (tk.type === "heading") out.push(new D.Paragraph({ heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4][Math.min(tk.depth, 4) - 1], children: runs(tk.tokens) }));
      else if (tk.type === "paragraph" || tk.type === "text") out.push(para(runs(tk.tokens || [{ type: "text", text: tk.text }])));
      else if (tk.type === "list") { const L = { ordered: tk.ordered, inst: ++listN }; for (const it of tk.items) { const sub = it.tokens || []; const first = sub.find(s => s.type === "text" || s.type === "paragraph"); out.push(new D.Paragraph({ children: [...(it.task ? [new D.TextRun(it.checked ? "☑ " : "☐ ")] : []), ...runs(first?.tokens || [])], ...(L.ordered ? { numbering: { reference: "num", level: lvl, instance: L.inst } } : { bullet: { level: lvl } }), spacing: { after: 60 } })); out.push(...blocks(sub.filter(s => s !== first), imgs, lvl + 1, L)); } }
      else if (tk.type === "table") out.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: [tk.header, ...tk.rows].map((row, ri) => new D.TableRow({ tableHeader: ri === 0, children: row.map(c => new D.TableCell({ shading: ri === 0 ? { fill: "EFEDE7" } : undefined, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new D.Paragraph({ children: runs(c.tokens, ri === 0 ? { bold: true } : {}) })] })) })) }), new D.Paragraph({ text: "" }));
      else if (tk.type === "code") {
        const im = imgs.get(tk);
        if (im) { const bin = atob(im.url.split(",")[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const w = Math.min(600, im.w); out.push(new D.Paragraph({ children: [new D.ImageRun({ data: u8, transformation: { width: w, height: Math.round(im.h * w / im.w) } })] })); }
        else if (/^html/i.test(tk.lang || "")) out.push(new D.Paragraph({ children: [new D.TextRun({ text: "Boceto en HTML: ábrelo o descárgalo desde la oficina para verlo en vivo.", italics: true })] }));
        else out.push(...tk.text.split("\n").map(l => new D.Paragraph({ children: [new D.TextRun({ text: l || " ", font: "Consolas", size: 18 })], shading: { fill: "F3F2EE" }, spacing: { after: 0 } })), new D.Paragraph({ text: "" }));
      }
      else if (tk.type === "blockquote") out.push(...(tk.tokens || []).filter(x => x.tokens).map(x => new D.Paragraph({ children: runs(x.tokens, { italics: true }), indent: { left: 360 }, border: { left: { color: "CFCBC1", space: 8, style: D.BorderStyle.SINGLE, size: 12 } }, spacing: { after: 100 } })));
      else if (tk.type === "hr") out.push(new D.Paragraph({ border: { bottom: { color: "CFCBC1", space: 1, style: D.BorderStyle.SINGLE, size: 6 } } }));
    }
    return out;
  };
  const children = [];
  if (list.length > 1) children.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(title)] }), new D.Paragraph({ children: [new D.TextRun({ text: `Exportado el ${new Date().toLocaleString("es-ES")} · ${list.length} entregables`, color: "8A877F" })] }), ...list.map((t, i) => new D.Paragraph({ text: `${i + 1}. ${t.order}`, spacing: { after: 40 } })));
  for (const [i, t] of list.entries()) {
    const x = exportPieces(t), toks = marked.lexer(x.body), imgs = await diagramImages(toks);
    children.push(new D.Paragraph({ heading: list.length > 1 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.TITLE, children: [new D.TextRun(list.length > 1 ? `${i + 1}. ${t.order}` : t.order)], pageBreakBefore: list.length > 1 }));
    children.push(new D.Paragraph({ children: [new D.TextRun({ text: x.meta, color: "8A877F", size: 18 })], spacing: { after: 200 } }));
    if (x.resumen) { children.push(new D.Paragraph({ children: [new D.TextRun({ text: "Resumen", bold: true })], shading: { fill: "F3F2EE" }, border: { left: { color: "2F6B4F", space: 8, style: D.BorderStyle.SINGLE, size: 18 } } })); children.push(...blocks(marked.lexer(x.resumen), new Map())); }
    children.push(...blocks(toks, imgs));
    if (x.next) children.push(new D.Paragraph({ children: [new D.TextRun({ text: "Siguiente paso: ", bold: true }), new D.TextRun(x.next)], spacing: { before: 200 } }));
  }
  const lv = [0, 1, 2, 3].map(l => ({ level: l, format: D.LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 360 * (l + 1), hanging: 260 } } } }));
  const doc = new D.Document({ creator: "Oficina", title, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, numbering: { config: [{ reference: "num", levels: lv }] }, sections: [{ children }] });
  return { blob: await D.Packer.toBlob(doc), ext: ".docx" };
}
function exportMD(list, title) {
  const one = t => taskMarkdown(t);
  const data = list.length === 1 ? one(list[0]) : `# ${title}\n\nExportado el ${new Date().toLocaleString("es-ES")}. ${list.length} entregables.\n\n${list.map((t, i) => `${i + 1}. ${t.order} (${byId[t.agentId].name})`).join("\n")}\n\n---\n\n${list.map(one).join("\n---\n\n")}`;
  return { blob: new Blob([data], { type: "text/markdown" }), ext: ".md" };
}
const fileName = s => String(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "entrega";
async function saveFile(filename, data) {
  const dls = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (dls) { try { await dls.save({ filename, data }); return true; } catch { toast("Descarga cancelada."); return false; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true;
}
async function exportTasks(list, fmt, label) {
  if (!list.length) return toast("No hay entregables terminados en esa selección.");
  const title = list.length === 1 ? list[0].order : docTitle(list, label);
  toast(fmt === "md" ? "Preparando el archivo…" : `Preparando el ${fmt === "pdf" ? "PDF" : "documento de Word"}…`);
  try {
    const { blob, ext } = fmt === "pdf" ? await exportPDF(list, title) : fmt === "docx" ? await exportDOCX(list, title) : exportMD(list, title);
    await saveFile(fileName(list.length === 1 ? `${byId[list[0].agentId].name}-${title}` : title) + ext, blob);
  } catch (e) { toast("No se pudo crear el archivo: " + (e?.message || e)); }
}

/* ---------- Gestión de encargos: buscar, seleccionar, archivar, borrar y limpiar ---------- */
state.sel = new Set(); state.q = ""; state.qDel = "";
function matchQ(t, q) { if (!q) return true; const a = byId[t.agentId]; return (t.order + " " + a.name + " " + a.role + " " + (t.result || "").slice(0, 4000)).toLowerCase().includes(q.toLowerCase()); }
function taskFilter(t, f) {
  if (f === "archivados") return !!t.archived;
  if (t.archived) return false;
  return f === "todos" || t.status === f || (f.startsWith("room:") && byId[t.agentId].room === f.slice(5));
}
async function archiveTasks(ids, on = true) {
  for (const id of ids) { const t = state.tasks.find(x => x.id === id); if (!t || t.status === "work") continue; t.archived = on; bump(t); await store.saveTask(t); }
}
async function deleteTasks(ids) {
  const set = new Set(ids);
  for (const id of set) { const t = state.tasks.find(x => x.id === id); if (t?.status === "work") stopTask(t); }
  state.tasks = state.tasks.filter(x => !set.has(x.id));
  for (const r of state.runs) if (r.reportId && set.has(r.reportId)) r.reportId = null;
  set.forEach(id => state.sel.delete(id));
  if (READER.id && set.has(READER.id)) closeReader();
  paintAll();
  for (const id of set) await store.deleteTask(id);
}
const DAY = 864e5;
function cleanupCounts() {
  const errs = state.tasks.filter(t => t.status === "error" && !t.archived);
  const old = state.tasks.filter(t => t.status === "done" && !t.archived && Date.now() - t.createdAt > 7 * DAY);
  const archived = state.tasks.filter(t => t.archived);
  const cut = errs.filter(t => t.interrupted || t.stopped);
  return { errs, old, archived, cut };
}
// Vuelve a lanzar encargos con error. Si se cortaron a medias, el puesto sigue desde lo que llevaba.
// Van a la cola común: aunque sean muchos, trabajan unos pocos a la vez.
async function retryTasks(list, openFirst) {
  list = list.filter(t => t.status === "error"); if (!list.length) return;
  await deleteTasks(list.map(t => t.id));
  list.sort((a, b) => a.createdAt - b.createdAt).forEach((t, i) => {
    const part = (t.interrupted || t.stopped) ? (t.result || "").replace(/\n*> [^\n]*$/, "").trim() : "";
    runTask({ agentId: t.agentId, order: t.order, from: t.from, skillId: t.skillId, mode: t.mode, project: t.project, version: t.version,
      extra: (t.extra || "") + (part ? `\n\nYa llevabas esto hecho antes de que se interrumpiera. Úsalo y entrega el trabajo completo:\n${part.slice(0, 12000)}` : ""),
      _onCreate: n => { if (openFirst && !i) openReader(n.id); } });
  });
}
function taskRowHTML(t) {
  const a = byId[t.agentId], k = kindOf(t), sum = t.status === "done" ? summaryOf(t, 1)[0] || "" : t.status === "error" ? (t.result || "").split("\n").filter(Boolean).pop()?.replace(/^>\s*/, "") || "" : progressOf(t).txt;
  return `<div class="trow ${state.sel.has(t.id) ? "sel" : ""}" data-row="${t.id}">
    <label class="tcheck"><input type="checkbox" data-pick="${t.id}" ${state.sel.has(t.id) ? "checked" : ""} aria-label="Seleccionar"></label>
    <button class="tmain" type="button" data-task="${t.id}"><span class="t">${esc(t.order)}</span><span class="m">${esc(k.label)} · ${fmtDate(t.createdAt)} · ${esc(t.from)}${sum ? " · " + esc(sum) : ""}</span></button>
    <span class="who">${esc(a.name)}</span><span class="st ${t.status}">${esc(statusLabel(t))}${t.archived ? " · archivado" : ""}</span>
    <span class="racts">${t.status === "work" ? `<button class="linkbtn" type="button" data-stop="${t.id}">Detener</button>` : `<button class="linkbtn" type="button" data-archive="${t.id}">${t.archived ? "Desarchivar" : "Archivar"}</button><button class="linkbtn bad" type="button" data-del="${t.id}">Borrar</button>`}</span></div>`;
}
function paintTasks() {
  const all = state.tasks, cnt = f => all.filter(t => taskFilter(t, f)).length;
  filterChips($("#taskFilters"), "fTasks", [["todos", `Todos ${cnt("todos") || ""}`], ["work", `En marcha ${cnt("work") || ""}`], ["done", `Terminados ${cnt("done") || ""}`], ["error", `Con error ${cnt("error") || ""}`], ["archivados", `Archivados ${cnt("archivados") || ""}`], ...ROOMS.map(r => ["room:" + r.id, r.name])]);
  const list = all.filter(t => taskFilter(t, state.fTasks) && matchQ(t, state.q)).sort((a, b) => b.createdAt - a.createdAt);
  const visible = new Set(list.map(t => t.id)); [...state.sel].forEach(id => { if (!state.tasks.some(t => t.id === id)) state.sel.delete(id); });
  const n = state.sel.size, allOn = list.length && list.every(t => state.sel.has(t.id));
  const c = cleanupCounts();
  $("#taskTools").innerHTML = `<label class="search"><span hidden>Buscar</span><input type="search" id="taskQ" placeholder="Buscar en encargos y respuestas" value="${esc(state.q)}"></label>
    ${n ? `<div class="bulk"><b>${n} ${n === 1 ? "seleccionado" : "seleccionados"}</b><button class="btn ghost sm" type="button" data-bulk="archive">Archivar</button><button class="btn ghost sm" type="button" data-bulk="unarchive">Desarchivar</button><button class="btn ghost sm" type="button" data-bulk="retry">Reintentar</button><button class="btn ghost sm" type="button" data-bulk="export">Exportar PDF</button><button class="btn ghost sm bad" type="button" data-bulk="delete">Borrar</button><button class="linkbtn" type="button" data-bulk="none">Quitar selección</button></div>`
      : `<details class="menu"><summary class="btn ghost sm">Limpiar</summary><div class="menu-pop right"><button type="button" data-clean="resume" ${c.cut.length ? "" : "disabled"}><b>Retomar los interrumpidos (${c.cut.length})</b><span>Siguen desde lo que llevaban hecho</span></button><button type="button" data-clean="errors" ${c.errs.length ? "" : "disabled"}><b>Borrar los que tienen error (${c.errs.length})</b><span>Encargos fallidos o detenidos</span></button><button type="button" data-clean="old" ${c.old.length ? "" : "disabled"}><b>Archivar terminados de hace más de 7 días (${c.old.length})</b><span>Siguen guardados en «Archivados»</span></button><button type="button" class="bad" data-clean="archived" ${c.archived.length ? "" : "disabled"}><b>Vaciar archivados (${c.archived.length})</b><span>Los borra para siempre</span></button></div></details>`}`;
  const cutN = c.cut.filter(t => t.interrupted).length;
  $("#taskList").innerHTML = (cutN ? `<div class="notice"><p><b>${cutN} ${cutN === 1 ? "encargo se cortó" : "encargos se cortaron"} porque la oficina se cerró mientras trabajaba.</b> Los puestos solo trabajan con la oficina abierta y en pantalla: al salir de Claude o bloquear el móvil, se paran.</p><div class="row"><button class="btn sm" type="button" data-clean="resume">${cutN === 1 ? "Retomarlo" : "Retomarlos"}</button><button class="btn ghost sm" type="button" data-f="fTasks" data-v="error">${cutN === 1 ? "Verlo" : "Verlos"}</button></div></div>` : "") + (list.length ? `<div class="thead"><label class="tcheck"><input type="checkbox" id="pickAll" ${allOn ? "checked" : ""} aria-label="Seleccionar todos"></label><span>Encargo</span><span>Puesto</span><span>Estado</span><span></span></div>` + list.map(taskRowHTML).join("")
    : `<p class="empty">${state.q ? "Nada coincide con la búsqueda." : state.fTasks === "archivados" ? "No hay encargos archivados." : "No hay encargos con este filtro."}</p>`);
  const q = $("#taskQ"); if (q && paintTasks.focus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); paintTasks.focus = false; }
  void visible;
}
function paintDeliverables() {
  const f = state.fDel, done = state.tasks.filter(t => t.status === "done");
  filterChips($("#delFilters"), "fDel", [["todos", "Todo"], ...ROOMS.map(r => [r.id, r.name]), ["archivados", "Archivados"]]);
  const list = done.filter(t => (f === "archivados" ? t.archived : !t.archived && (f === "todos" || byId[t.agentId].room === f)) && matchQ(t, state.qDel)).sort((a, b) => b.createdAt - a.createdAt);
  const anyDone = done.length;
  paintExport();
  const card = t => {
    const a = byId[t.agentId], k = kindOf(t), sum = summaryOf(t, 3);
    return `<article class="del" data-kind="${k.id}"><button class="del-open" type="button" data-task="${t.id}" aria-label="Abrir ${esc(t.order)}"></button>
      <div class="del-h"><span class="kind">${esc(k.label)}</span><span class="d">${fmtDate(t.createdAt)}</span></div>
      <h3 class="t">${esc(t.order)}</h3>
      <ul class="x">${sum.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      <div class="del-f"><span class="who"><img class="px" src="${P(a)}" alt=""><b>${esc(a.name)}</b></span>
        <span class="del-acts"><button class="linkbtn" type="button" data-export="pdf" data-eid="${t.id}">PDF</button><button class="linkbtn" type="button" data-archive="${t.id}">${t.archived ? "Desarchivar" : "Archivar"}</button></span></div></article>`;
  };
  // Agrupado por fecha: hoy, esta semana y antes.
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const groups = [["Hoy", t => t.createdAt >= +start], ["Esta semana", t => t.createdAt < +start && t.createdAt >= +start - 6 * DAY], ["Antes", t => t.createdAt < +start - 6 * DAY]];
  const body = list.length ? groups.map(([g, fn]) => { const l = list.filter(fn); return l.length ? `<section class="dgroup"><h2 class="h3">${g} <span class="n">${l.length}</span></h2><div class="gallery">${l.map(card).join("")}</div></section>` : ""; }).join("")
    : !anyDone ? `<div class="emptybox"><p><b>Todavía no hay nada terminado.</b></p><p class="note">Cuando un puesto entregue, aquí tendrás cada trabajo como documento: con su resumen, el índice, los bocetos en vivo y la descarga en PDF o Word.</p><button class="btn sm" type="button" data-go="oficina">Hacer un encargo</button></div>`
    : `<p class="empty">${state.qDel ? "Nada coincide con la búsqueda." : f === "archivados" ? "No hay entregables archivados." : "Todavía no hay entregables en esta sala."}</p>`;
  $("#delGrid").innerHTML = body;
}
async function exportDeliverables() {
  const key = $("#expSel").value || "todos", g = exportGroups().find(x => x[0] === key) || exportGroups()[0];
  const list = state.tasks.filter(t => t.status === "done" && !t.archived && g[2](t)).sort((a, b) => a.createdAt - b.createdAt);
  await exportTasks(list, $("#expFmt").value || "pdf", key === "todos" ? "" : g[1].replace(/ \(\d+\)$/, ""));
}

/* ---------- Aplicar en la app: Claude Code hace el cambio y abre la PR ---------- */
const CC_SERVER = "Claude Code Remote";
const EXEC_LABEL = { sent: "Enviado", working: "Trabajando", blocked: "Necesita algo", review_ready: "Listo para revisar", completed: "Terminado", failed: "Falló", error: "No se pudo enviar" };
const CC = { trigger: null, env: null, repos: ["guillelafargue/ai-fitness-pwa", "guillelafargue/oficina"], repo: "guillelafargue/ai-fitness-pwa", merge: true };
function ccLoad() { try { Object.assign(CC, JSON.parse(localStorage.getItem("oficina.cc") || "{}")); } catch {} }
function ccSave() { try { localStorage.setItem("oficina.cc", JSON.stringify({ trigger: CC.trigger, env: CC.env, repos: CC.repos, repo: CC.repo, merge: CC.merge })); } catch {} store.saveMeta?.(); }
ccLoad();
const CC_PROMPT = `Te lanza la Oficina de agentes del propietario para aplicar un cambio en una de sus apps. El mensaje que sigue trae el repositorio, el encargo y si debes fusionar.
Haz esto, en orden y sin preguntar salvo que falte algo imprescindible:
1. Añade el repositorio indicado a la sesión (herramienta add_repo) si no lo está y trabaja en una rama nueva.
2. Lee CLAUDE.md, AGENTS.md y README del repositorio y respeta sus reglas y comprobaciones.
3. Implementa el cambio completo. Si el encargo es abierto («revisa y mejora»), revisa el código, elige el cambio de más impacto y menos riesgo y hazlo.
4. Pasa las comprobaciones del proyecto (tipos, lint, pruebas, build) y pruébalo si afecta a lo que se ve.
5. Abre una PR en español que explique qué cambia para el usuario.
6. Si el mensaje dice «Fusionar: sí» y todo pasa, fusiónala con squash: esa casilla marcada por el propietario en la Oficina es su aprobación. Si dice «Fusionar: no», déjala abierta.
7. Termina con un resumen breve en español: qué cambió, el enlace de la PR y si se fusionó.`;
async function ccMcp() { return window.claude?.use ? await window.claude.use("mcp").catch(() => null) : null; }
function ccErr(e) {
  return ({ server_not_connected: "Claude Code no está conectado a esta página. Ábrela dentro de Claude con tu cuenta.", needs_reauth: "Vuelve a conectar Claude Code en los ajustes de Claude.",
    not_in_manifest: "No has dado permiso a esta página para usar Claude Code.", approval_required: "Hace falta tu aprobación: vuelve a pulsar y acepta el aviso de Claude.",
    blocked_by_policy: "Tu organización no permite usar Claude Code desde aquí.", server_unavailable: "Claude Code no responde ahora mismo. Prueba en un momento." })[e?.code] || (e?.message ? "No se pudo enviar: " + String(e.message).slice(0, 220) : "No se pudo enviar.");
}
function ccText(t, repo, instr, merge) {
  const p = docParts(t);
  return `Repositorio: ${repo}
Fusionar: ${merge ? "sí" : "no"}
Encargo: ${instr || t.order}

Entregado en la Oficina por el puesto ${byId[t.agentId].name} (${byId[t.agentId].role}) para «${t.order}»:

${(p.cc ? "## Cambios para Claude Code\n" + p.cc + "\n\n" : "") + (p.main || t.result || "").slice(0, 40000)}`.slice(0, 60000);
}
async function ccSend(t, { repo, instr, merge, auto = false }) {
  const rec = { at: Date.now(), repo, state: "sent", auto };
  (t.exec ||= []).push(rec); bump(t);
  try {
    const mcp = await ccMcp(); if (!mcp) throw { code: "server_not_connected" };
    const pay = r => r?.payload ?? r;
    if (!CC.env) {
      const envs = pay(await mcp.callTool(CC_SERVER, "list_environments", {}))?.environments || [];
      const env = envs.find(e => e.state === "active" && /trusted/i.test(e.description || "")) || envs.find(e => e.state === "active") || envs[0];
      if (!env) throw { message: "No tienes ningún entorno de Claude Code. Crea uno en claude.ai/code." };
      CC.env = env.environment_id; ccSave();
    }
    const fire = async () => pay(await mcp.callTool(CC_SERVER, "fire_trigger", { trigger_id: CC.trigger, text: ccText(t, repo, instr, merge) }));
    if (!CC.trigger) await ccCreateTrigger(mcp, pay);
    let res;
    try { res = await fire(); }
    catch (e) { if (e?.code !== "tool_error") throw e; CC.trigger = null; await ccCreateTrigger(mcp, pay); res = await fire(); }
    const vals = []; (function walk(v) { if (typeof v === "string") vals.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); })(res);
    const sess = vals.map(v => /\bsession_[A-Za-z0-9]{8,}/.exec(v)?.[0]).find(Boolean), url = vals.map(v => /https:\/\/claude\.ai\/code\/[^\s"']+/.exec(v)?.[0]).find(Boolean);
    rec.session = sess || null; rec.url = url || (sess ? "https://claude.ai/code/" + sess : "https://claude.ai/code"); rec.state = "working";
    toast("Enviado a Claude Code. Te avisará al terminar.");
  } catch (e) { rec.state = "error"; rec.error = ccErr(e); toast(rec.error); }
  bump(t); await store.saveTask(t); return rec;
}
async function ccCreateTrigger(mcp, pay) {
  const r = pay(await mcp.callTool(CC_SERVER, "create_trigger", { name: "Oficina: aplicar cambios en la app", prompt: CC_PROMPT, create_new_session_on_fire: true, environment_id: CC.env, initiation: "human_request", notifications: { push: true } }));
  CC.trigger = r?.trigger?.id || /"(trig_[A-Za-z0-9]{6,})"/.exec(JSON.stringify(r || {}))?.[1] || null;
  if (!CC.trigger) throw { message: "Claude Code no devolvió la tarea creada." };
  ccSave();
}
async function ccCheck(t, sess) {
  const rec = (t.exec || []).find(x => x.session === sess); if (!rec) return;
  try {
    const mcp = await ccMcp(); if (!mcp) throw { code: "server_not_connected" };
    const r = (await mcp.callTool(CC_SERVER, "get_session", { session_id: sess }, { cache: false }))?.payload || {};
    const b = r.status_bucket || r.session?.status_bucket || r.status; if (b) rec.state = b;
    toast(EXEC_LABEL[rec.state] ? "Estado: " + EXEC_LABEL[rec.state].toLowerCase() + "." : "Estado actualizado.");
  } catch (e) { toast(ccErr(e)); }
  bump(t); store.saveTask(t);
}
function openApply(t) {
  const p = docParts(t);
  $("#ccTitle").textContent = t.order;
  $("#ccRepo").innerHTML = CC.repos.map(r => `<option ${r === CC.repo ? "selected" : ""}>${esc(r)}</option>`).join("") + `<option value="__otro">Otro repositorio…</option>`;
  $("#ccOther").hidden = true; $("#ccOther").value = "";
  $("#ccInstr").value = p.cc ? "Aplica los «Cambios para Claude Code» de esta entrega." : `Aplica en la app lo que propone esta entrega: ${t.order}`;
  $("#ccMerge").checked = CC.merge;
  $("#ccDlg").dataset.tid = t.id;
  $("#ccNote").textContent = window.claude?.use ? "Claude Code abre una sesión en tu cuenta, hace el cambio en una rama, pasa las comprobaciones del proyecto y abre la PR. Te llega un aviso al terminar." : "Fuera de Claude no se puede lanzar Claude Code: copia el encargo y pégalo en claude.ai/code.";
  $("#ccSend").textContent = window.claude?.use ? "Enviar a Claude Code" : "Copiar encargo";
  $("#ccDlg").showModal();
}
$("#ccRepo")?.addEventListener("change", e => { $("#ccOther").hidden = e.target.value !== "__otro"; if (!$("#ccOther").hidden) $("#ccOther").focus(); });
$("#ccDlg")?.addEventListener("close", async () => {
  const dlg = $("#ccDlg"); if (dlg.returnValue !== "send") return;
  const t = state.tasks.find(x => x.id === dlg.dataset.tid); if (!t) return;
  let repo = $("#ccRepo").value === "__otro" ? $("#ccOther").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "") : $("#ccRepo").value;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return toast("Escribe el repositorio como usuario/proyecto.");
  if (!CC.repos.includes(repo)) CC.repos.push(repo);
  CC.repo = repo; CC.merge = $("#ccMerge").checked; ccSave();
  const instr = $("#ccInstr").value.trim();
  if (!window.claude?.use) { try { await navigator.clipboard.writeText(ccText(t, repo, instr, CC.merge)); toast("Copiado. Pégalo en claude.ai/code."); } catch { toast("No se pudo copiar."); } return; }
  ccSend(t, { repo, instr, merge: CC.merge });
});

/* ---------- Taller: mejora continua de la app ---------- */
const TALLER = { on: false, apply: false, repo: "guillelafargue/oficina", perDay: 3, log: [], next: 0 };
function tallerLoad() { try { Object.assign(TALLER, JSON.parse(localStorage.getItem("oficina.taller") || "{}")); } catch {} }
function tallerSave() { try { localStorage.setItem("oficina.taller", JSON.stringify({ on: TALLER.on, apply: TALLER.apply, repo: TALLER.repo, perDay: TALLER.perDay, log: TALLER.log.slice(-40) })); } catch {} }
tallerLoad();
const appliedToday = () => TALLER.log.filter(x => x.applied && Date.now() - x.at < DAY).length;
async function runTallerRound(manual = false) {
  if (!aiReady()) { toast(errText({ code: "no_ai" })); openSettings(); return; }
  if (state.tasks.some(t => t.status === "work" && t.from === "Taller")) { if (manual) toast("El Taller ya está con una ronda."); return; }
  const done = TALLER.log.slice(-15).map(x => "- " + x.title).join("\n") || "- (nada todavía)";
  const order = `Ronda de mejora continua de ${TALLER.repo}: revisa la app y elige UNA mejora de alto impacto y bajo riesgo que no se haya hecho ya.`;
  const extra = `Repositorio de la app: ${TALLER.repo}.
Mejoras ya propuestas o aplicadas (no las repitas):
${done}
Trabaja con el código del contexto si lo tienes; si no, con lo que sabes de la app por las entregas anteriores, y deja que Claude Code revise el repositorio para concretar. Entrega obligatoriamente «## Cambios para Claude Code» con el objetivo, los archivos, cómo probarlo y los criterios de aceptación.`;
  if (manual) toast("El Taller empieza a revisar la app.");
  const t = await runTask({ agentId: "audit", order, from: "Taller", mode: "pro", skillId: "audit.backlog", extra, local: true });
  if (t.status !== "done") return;
  const title = (docParts(t).resumen.split("\n").find(l => l.trim()) || t.order).replace(/^\s*[-*]\s*/, "").replace(/[*_`]/g, "").slice(0, 160);
  const entry = { at: Date.now(), title, task: t.id, applied: false };
  TALLER.log.push(entry);
  if (TALLER.apply && appliedToday() < TALLER.perDay && window.claude?.use) {
    const rec = await ccSend(t, { repo: TALLER.repo, instr: "Aplica los «Cambios para Claude Code» de esta entrega.", merge: true, auto: true });
    entry.applied = rec.state !== "error";
  }
  tallerSave();
}
