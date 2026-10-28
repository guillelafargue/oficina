"use strict";
/* ---------- Estado ---------- */
const byId = Object.fromEntries(AGENTS.map(a => [a.id, a]));
const roomById = Object.fromEntries(ROOMS.map(r => [r.id, r]));
const state = {
  company: "Mi empresa",
  brief: "Somos una empresa nueva. Describe tu proyecto en «Ajustes»: qué vendéis, a quién, objetivos, tono de marca y presupuesto.",
  tasks: [], runs: [], customSkills: [],
  status: {}, bubble: {},
  room: "central", view: "oficina", open: null,
  comp: { target: "empresa", mode: "pro", skill: null, image: null },
  dComp: { skill: null, mode: "pro" },
  fTasks: "todos", fSkills: "todos", fDel: "todos",
  run: null,
};
AGENTS.forEach(a => { state.status[a.id] = "idle"; });
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtDate = ts => new Date(ts).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
function md(s) { try { return DOMPurify.sanitize(marked.parse(s || "")); } catch { return "<pre>" + esc(s) + "</pre>"; } }
const P = a => Office.portrait(a);

/* ---------- Skills ---------- */
function allSkills() {
  const base = AGENTS.flatMap(a => a.skills.map(([k, name, desc, method]) => ({ id: a.id + "." + k, agentId: a.id, name, desc, method, custom: false })));
  return base.concat(state.customSkills.map(s => ({ ...s, custom: true })));
}
const skillById = id => allSkills().find(s => s.id === id);
const skillsOf = agentId => allSkills().filter(s => s.agentId === agentId);

/* ---------- IA: Claude dentro de claude.ai, o API propia fuera ---------- */
const AI = { sample: null, mode: "none", images: false };
function settingsLocal() { try { return JSON.parse(localStorage.getItem("oficina.settings") || "{}"); } catch { return {}; } }
function saveSettingsLocal(s) { try { localStorage.setItem("oficina.settings", JSON.stringify(s)); } catch {} }
function aiReady() { return AI.mode === "sample" || !!settingsLocal().key; }
function parseJSONLoose(text) {
  try { return JSON.parse(text); } catch {}
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(text.slice(i, j + 1)); } catch {} }
  throw { code: "invalid_json", message: "Respuesta sin JSON" };
}
const fileToB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });

async function ask(prompt, { onText, signal, json = false, image = null, quick = false } = {}) {
  if (AI.mode === "sample") {
    const opts = { signal, cache: false };
    if (quick) opts.modelTier = "quick";
    if (image && AI.images) opts.images = [image];
    if (json) return AI.sample.json(prompt, opts);
    const r = await AI.sample(prompt, { ...opts, onText });
    return r.text;
  }
  const s = settingsLocal();
  if (!s.key) throw { code: "no_ai" };
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.type || "image/png", data: await fileToB64(image) } });
  content.push({ type: "text", text: prompt });
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": s.key, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true", "anthropic-beta": "server-side-fallback-2026-07-01" },
      body: JSON.stringify({ model: s.model || "claude-opus-5-5", max_tokens: 32000, stream: true, fallbacks: "default",
        output_config: { effort: quick ? "low" : "medium" }, messages: [{ role: "user", content }] }),
    });
  } catch (e) { throw { code: e?.name === "AbortError" ? "cancelled" : "upstream_error", message: String(e?.message || e) }; }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { code: res.status === 401 ? "bad_key" : res.status === 429 ? "rate_limited" : "upstream_error", message: data?.error?.message || ("HTTP " + res.status) };
  }
  // Lectura del flujo SSE: acumula los fragmentos de texto y comprueba el motivo de parada.
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", stop = null;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find(l => l.startsWith("data:")); if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; if (!json) onText?.({ text, delta: ev.delta.text }); }
        else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === "error") throw { code: "upstream_error", message: ev.error?.message || "Error del servicio", text };
      }
    }
  } catch (e) { if (e?.name === "AbortError") throw { code: "cancelled", text }; throw e?.code ? e : { code: "upstream_error", message: String(e?.message || e), text }; }
  if (stop === "refusal") throw { code: "refused" };
  if (!text.trim()) throw { code: "empty_completion" };
  return json ? parseJSONLoose(text) : text;
}
function errText(e) {
  return ({ not_granted: "No se ha permitido usar Claude en esta página.", rate_limited: "Demasiadas peticiones seguidas. Prueba en un rato.",
    refused: "Claude ha declinado esta tarea. Reformúlala.", no_ai: "Falta conectar la IA: añade tu clave en Ajustes.",
    bad_key: "La clave de API no es válida.", invalid_json: "No se pudo leer el plan. Vuelve a intentarlo.",
    sampling_disabled: "Claude no está disponible en esta cuenta.", cancelled: "Detenido.", image_rejected: "La imagen no es válida; prueba con otra.",
    prompt_too_large: "El encargo es demasiado largo; divídelo." })[e?.code] || ("No se pudo completar: " + (e?.message || "error desconocido"));
}

/* ---------- Cola: máximo 3 agentes llamando a la IA a la vez ---------- */
const slots = { max: 3, used: 0, q: [] };
function acquire(signal) {
  return new Promise((res, rej) => {
    const go = () => { slots.used++; res(); };
    if (slots.used < slots.max) return go();
    const item = { go };
    slots.q.push(item);
    signal?.addEventListener("abort", () => { const i = slots.q.indexOf(item); if (i >= 0) { slots.q.splice(i, 1); rej({ code: "cancelled" }); } }, { once: true });
  });
}
function release() { slots.used--; const n = slots.q.shift(); if (n) n.go(); }

/* ---------- Prompts ---------- */
function roster() { return AGENTS.map(a => `- ${a.id}: ${a.role} (${DEPTS[a.dept]}). Skills: ${skillsOf(a.id).map(s => s.id + " «" + s.name + "»").join(", ")}`).join("\n"); }
function recentWork(limit = 6, exclude) {
  const done = state.tasks.filter(t => t.status === "done" && t.id !== exclude).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  if (!done.length) return "Todavía no hay trabajo entregado.";
  return done.map(t => `• ${byId[t.agentId].role}, «${t.order}»:\n${finalPart(t.result).slice(0, 800)}${t.result.length > 800 ? "…" : ""}`).join("\n\n");
}
function finalPart(text) { const m = /^##\s*Entrega final[^\n]*\n?/im.exec(text || ""); return m ? text.slice(m.index + m[0].length) : (text || ""); }
function persona(a) {
  return `Eres el agente especialista en ${a.role} (${DEPTS[a.dept]}) de la empresa «${state.company}». Trabajas en una oficina con otros agentes especializados de primer nivel.
Tu perfil: ${a.bio}
Herramientas que dominas: ${a.tools.join(", ")}.
Tus métodos: ${skillsOf(a.id).map(s => s.name).join(", ")}.

PROYECTO DE LA EMPRESA:
${state.brief}

TRABAJO RECIENTE DEL EQUIPO (para ser coherente y no repetir):
${recentWork(6)}`;
}
const RULES = (a) => `Cómo entregar:
- En español, en Markdown, con la calidad de un profesional senior de primer nivel en tu área. Nada genérico: concreto y aplicable a este proyecto.
- Si es código, el código completo sin omitir partes; si es un guion, entero y con tiempos; si es un plan, con fases, fechas y responsables; si son números, en tablas.
- Si el trabajo se ejecuta en una herramienta externa (por ejemplo ${a.tools[0]}), indica exactamente qué hacer en ella paso a paso, porque no puedes manejarla tú directamente.
- Si te falta un dato, asume algo razonable, dilo en una línea y sigue.`;
function planStepsPrompt(a, order, skill) {
  return `${persona(a)}

ENCARGO (de ${"{from}"}):
${order}
${skill ? `\nMÉTODO A SEGUIR, skill «${skill.name}»:\n${skill.method}\n` : ""}
Antes de trabajar, planifica. Divide el encargo en 3 a 6 pasos de trabajo concretos y ordenados, como lo haría un experto de tu área${skill ? " siguiendo el método indicado" : ""}.
Responde SOLO con JSON: {"pasos": ["título corto del paso 1", "..."]}`;
}
function execPrompt(a, t, skill) {
  const plan = t.steps.length ? `\nPLAN DE TRABAJO (síguelo en orden):\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nEstructura la respuesta con una sección por paso, titulada exactamente «## 1. …», «## 2. …», etc. Termina con «## Entrega final»: el resultado consolidado, listo para usar.` : "";
  return `${persona(a)}
${t.extra ? "\nCONTEXTO:\n" + t.extra + "\n" : ""}
ENCARGO (de ${t.from}):
${t.order}
${skill ? `\nMÉTODO A SEGUIR, skill «${skill.name}»:\n${skill.method}\n` : ""}${t.hasImage ? "\nSe adjunta una imagen de referencia: analízala y úsala en el trabajo.\n" : ""}${plan}

${RULES(a)}
- Cierra con una línea «Siguiente paso sugerido: …».`;
}
function companyPlanPrompt(order, kind) {
  const intro = kind === "auto"
    ? "Nadie te ha dado una orden nueva. Decide qué es lo más valioso que puede hacer el equipo AHORA para avanzar el proyecto, teniendo en cuenta lo ya entregado. No repitas trabajo hecho."
    : `El propietario de la empresa te da este encargo:\n«${order}»`;
  return `Eres la Dirección general de «${state.company}». Diriges una oficina de agentes especializados.

PROYECTO:
${state.brief}

EQUIPO (usa exactamente estos identificadores de agente y de skill):
${roster()}

TRABAJO YA ENTREGADO:
${recentWork(8)}

${intro}

Organiza el trabajo en 1 a 3 fases. Las tareas de una misma fase se hacen en paralelo; cada fase puede apoyarse en lo entregado en las anteriores (por ejemplo: primero estrategia y oferta, después contenidos, al final piezas y anuncios). Entre 2 y 7 tareas en total, asignadas a los agentes más adecuados, cada una concreta, entregable de una vez y autosuficiente. Si una skill del agente encaja, indícala.
Responde SOLO con JSON:
{"resumen": "una frase con el enfoque", "fases": [{"nombre": "Fase 1: …", "tareas": [{"agente": "id", "tarea": "instrucción concreta", "skill": "id de skill o vacío"}]}]}`;
}
function reportPrompt(run, results) {
  return `Eres la Dirección general de «${state.company}». Tu equipo acaba de terminar ${run.kind === "auto" ? "una ronda de trabajo autónoma" : "este encargo: «" + run.order + "»"}.
Enfoque: ${run.resumen}

ENTREGAS:
${results.map(r => `### ${byId[r.agentId].role}: ${r.order}\n${finalPart(r.result).slice(0, 2200)}`).join("\n\n")}

Escribe en español, en Markdown, un informe ejecutivo breve para el propietario: qué se ha hecho, decisiones clave, qué necesita aprobar o aportar él, incoherencias entre entregas si las hay, y los 3 siguientes pasos con su responsable.`;
}

/* ---------- Ejecución de tareas ---------- */
function newTask(o) {
  const t = { id: uid(), agentId: o.agentId, order: o.order, from: o.from || "Tú", skillId: o.skillId || null, mode: o.mode || "pro", runId: o.runId || null,
    extra: o.extra || "", steps: [], step: 0, phase: "cola", result: "", status: "work", createdAt: Date.now(), hasImage: !!o.image, v: 0 };
  state.tasks.push(t); return t;
}
function setAgent(agentId) {
  const mine = state.tasks.filter(t => t.agentId === agentId && t.status === "work");
  const active = mine.find(t => t.phase !== "cola");
  state.status[agentId] = active ? "work" : mine.length ? "queue" : "idle";
  if (active) state.bubble[agentId] = active.phase === "plan" ? "Planificando" : active.steps.length && active.step ? `Paso ${active.step}/${active.steps.length}` : "Trabajando";
  else delete state.bubble[agentId];
}
async function runTask(o) {
  const a = byId[o.agentId], t = newTask(o), skill = t.skillId ? skillById(t.skillId) : null;
  setAgent(a.id); bump(t);
  try {
    await acquire(o.signal);
    try {
      if (t.mode === "pro") {
        t.phase = "plan"; setAgent(a.id); bump(t);
        const raw = await ask(planStepsPrompt(a, t.order, skill).replace("{from}", t.from), { json: true, signal: o.signal, quick: true });
        t.steps = (Array.isArray(raw?.pasos) ? raw.pasos : []).map(String).filter(Boolean).slice(0, 6);
      }
      t.phase = "exec"; setAgent(a.id); bump(t);
      let lastPaint = 0;
      t.result = await ask(execPrompt(a, t, skill), { signal: o.signal, image: o.image || null, onText: ({ text }) => {
        t.result = text;
        if (t.steps.length) {
          let m, k = 0; const re = /^##\s*(\d+)[.)]/gm; while ((m = re.exec(text))) k = Math.max(k, +m[1]);
          if (/^##\s*Entrega final/im.test(text)) k = t.steps.length;
          if (k !== t.step) { t.step = Math.min(k, t.steps.length); setAgent(a.id); }
        }
        const now = Date.now(); if (now - lastPaint > 300) { lastPaint = now; bump(t); }
      } });
      t.status = "done"; t.step = t.steps.length;
    } finally { release(); }
  } catch (e) {
    t.status = "error"; t.result = (e?.text ? e.text + "\n\n" : "") + "> " + errText(e);
  }
  t.phase = "fin"; setAgent(a.id); bump(t); await store.saveTask(t);
  return t;
}

async function runCompany(order, kind) {
  if (!aiReady()) { toast(errText({ code: "no_ai" })); openSettings(); return; }
  if (state.run) { toast("La empresa ya está con un encargo. Puedes detenerlo o esperar."); return; }
  const ctl = new AbortController();
  const run = { id: uid(), kind, order, resumen: "Dirección está preparando el plan…", fases: [], status: "work", createdAt: Date.now(), ctl };
  state.run = run; state.runs.push(run);
  state.status.elena = "work"; state.bubble.elena = kind === "auto" ? "Decidiendo" : "Repartiendo";
  paintAll();
  try {
    await acquire(ctl.signal);
    let raw; try { raw = await ask(companyPlanPrompt(order, kind), { json: true, signal: ctl.signal }); } finally { release(); }
    const fases = (Array.isArray(raw?.fases) ? raw.fases : []).map((f, i) => ({
      nombre: String(f?.nombre || `Fase ${i + 1}`),
      tareas: (Array.isArray(f?.tareas) ? f.tareas : []).filter(x => byId[x?.agente] && x?.tarea)
        .map(x => ({ agente: String(x.agente), tarea: String(x.tarea), skill: skillById(String(x.skill || ""))?.agentId === x.agente ? String(x.skill) : null, estado: "pend", taskId: null })),
    })).filter(f => f.tareas.length).slice(0, 3);
    if (!fases.length) throw { code: "invalid_json" };
    run.resumen = String(raw.resumen || ""); run.fases = fases;
    state.status.elena = "idle"; delete state.bubble.elena; paintAll();
    const extra = `Encargo general: ${kind === "auto" ? "ronda autónoma decidida por Dirección" : order}\nEnfoque de Dirección: ${run.resumen}\nReparto completo: ${fases.map(f => f.nombre + ": " + f.tareas.map(x => byId[x.agente].name + " → " + x.tarea).join(" | ")).join(" // ")}`;
    const results = [];
    for (const f of fases) {
      if (ctl.signal.aborted) break;
      await Promise.all(f.tareas.map(async x => {
        x.estado = "work"; paintAll();
        const t = await runTask({ agentId: x.agente, order: x.tarea, from: kind === "auto" ? "Ronda autónoma" : "Dirección", skillId: x.skill, mode: "pro", runId: run.id, extra, signal: ctl.signal,
          _onCreate: null });
        x.taskId = t.id; x.estado = t.status; results.push(t); paintAll();
      }));
    }
    const ok = results.filter(r => r.status === "done");
    if (ok.length && !ctl.signal.aborted) {
      const rep = await runTaskRaw("elena", kind === "auto" ? "Informe de la ronda autónoma" : "Informe: " + order, reportPrompt(run, ok), run.id, ctl.signal);
      run.reportId = rep.id;
    }
    run.status = ctl.signal.aborted ? "error" : "done";
    toast(ctl.signal.aborted ? "Encargo detenido." : "El equipo ha terminado. Tienes el informe de Dirección.");
  } catch (e) {
    run.status = "error"; run.resumen = errText(e); toast(errText(e));
  } finally {
    delete run.ctl; state.run = null;
    state.status.elena = "idle"; delete state.bubble.elena;
    AGENTS.forEach(a => setAgent(a.id));
    await store.saveRun(run); paintAll();
  }
}
async function runTaskRaw(agentId, order, prompt, runId, signal) {
  const t = newTask({ agentId, order, from: "Dirección", mode: "rapido", runId }); t.phase = "exec";
  setAgent(agentId); state.bubble[agentId] = "Redactando informe"; bump(t);
  try { await acquire(signal); try { t.result = await ask(prompt, { signal, onText: ({ text }) => { t.result = text; bump(t); } }); t.status = "done"; } finally { release(); } }
  catch (e) { t.status = "error"; t.result = "> " + errText(e); }
  t.phase = "fin"; setAgent(agentId); bump(t); await store.saveTask(t); return t;
}

/* ---------- Pintado ---------- */
let paintQueued = false;
const changed = new Set();
function bump(t) { t.v = (t.v || 0) + 1; changed.add(t.id); schedule(); }
function schedule() { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintAll(); }); }
function paintAll() {
  paintCounts(); paintTeam(); paintLive(); paintRun();
  if (state.view === "encargos") paintTasks();
  if (state.view === "entregables") paintDeliverables();
  if (state.open) refreshDrawerTasks();
  changed.clear();
}
function paintCounts() {
  const work = AGENTS.filter(a => state.status[a.id] !== "idle").length;
  $("#sIdle").textContent = AGENTS.length - work; $("#sWork").textContent = work;
  $("#nWork").textContent = work || "";
  $("#nTasks").textContent = state.tasks.length || "";
  $("#nDone").textContent = state.tasks.filter(t => t.status === "done").length || "";
  $("#nSkills").textContent = allSkills().length;
  for (const r of ROOMS) {
    const n = AGENTS.filter(a => a.room === r.id && state.status[a.id] !== "idle").length;
    const total = AGENTS.filter(a => a.room === r.id).length;
    document.querySelectorAll(`[data-room-n="${r.id}"]`).forEach(el => { el.textContent = n ? `${n}/${total}` : String(total); el.classList.toggle("on", !!n); });
  }
  $("#btnAuto").textContent = state.run ? "Detener ronda" : "Ronda autónoma";
  $("#btnAuto").classList.toggle("stop", !!state.run);
}
function statusDot(id) { const s = state.status[id]; return `<span class="dot ${s === "work" ? "work" : s === "queue" ? "queue" : ""}"></span>`; }
function statusText(id) { const s = state.status[id]; return s === "work" ? (state.bubble[id] || "Trabajando") : s === "queue" ? "En cola" : "Disponible"; }
function paintTeam() {
  $("#team").innerHTML = AGENTS.filter(a => a.room === state.room).map(a => `<button class="mate" type="button" data-agent="${a.id}">
    <img class="px" src="${P(a)}" alt=""><div style="min-width:0"><b>${esc(a.name)}${statusDot(a.id)}</b><span>${state.status[a.id] === "idle" ? esc(a.role) : esc(statusText(a.id))}</span></div></button>`).join("");
}
function progressOf(t) {
  if (t.status !== "work") return { pct: 100, ind: false, txt: t.status === "done" ? "Terminado" : "Error" };
  if (t.phase === "cola") return { pct: 0, ind: false, txt: "En cola" };
  if (t.phase === "plan") return { pct: 8, ind: true, txt: "Planificando" };
  if (t.steps.length) { const k = Math.max(1, t.step || 1); return { pct: Math.round((k - (t.step >= t.steps.length ? 0 : .5)) / t.steps.length * 100), ind: false, txt: `Paso ${k} de ${t.steps.length}`, step: t.steps[k - 1] || "" }; }
  return { pct: 40, ind: true, txt: t.result ? "Escribiendo" : "Pensando" };
}
function statusLabel(t) { return t.status === "work" ? progressOf(t).txt : t.status === "done" ? "Terminado" : "Error"; }
function jobHTML(t) {
  const a = byId[t.agentId], p = progressOf(t);
  return `<button class="job" type="button" data-task="${t.id}"><div class="t">${esc(t.order)}</div>
    <div class="m"><b>${esc(a.name)}</b><span>·</span><span class="st ${t.status}">${esc(p.txt)}</span>${t.status !== "work" ? `<span>·</span><span>${fmtDate(t.createdAt)}</span>` : ""}</div>
    ${t.status === "work" ? `<div class="bar ${p.ind ? "ind" : ""}"><i style="width:${p.pct}%"></i></div>` : ""}</button>`;
}
function paintLive() {
  const live = state.tasks.filter(t => t.status === "work").sort((a, b) => a.createdAt - b.createdAt);
  $("#liveCount").textContent = live.length;
  $("#liveList").innerHTML = live.length ? live.map(jobHTML).join("") : `<p class="empty">Nadie está trabajando ahora. Haz un encargo o lanza una ronda autónoma.</p>`;
  const recent = state.tasks.filter(t => t.status !== "work").sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  $("#recentList").innerHTML = recent.length ? recent.map(jobHTML).join("") : `<p class="empty">Aquí verás lo último que se ha entregado.</p>`;
}
function paintRun() {
  const box = $("#runBox"), r = state.run || state.runs.filter(x => Date.now() - x.createdAt < 36e5).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  const lbl = { pend: "Pendiente", work: "En curso", done: "Hecho", error: "Error" };
  box.innerHTML = `<h3 class="h3">${r.kind === "auto" ? "Ronda autónoma" : "Plan de Dirección"} <span class="st ${r.status}">${lbl[r.status]}</span></h3>
    <p>${esc(r.resumen)}</p>
    ${(r.fases || []).map(f => `<div class="ph">${esc(f.nombre)}</div><ol>${f.tareas.map(x => `<li><b>${esc(byId[x.agente]?.name)}</b>: ${esc(x.tarea)} <span class="st ${x.estado}">${lbl[x.estado] ? "· " + lbl[x.estado].toLowerCase() : ""}</span></li>`).join("")}</ol>`).join("")}
    ${r.reportId ? `<div class="row" style="justify-content:flex-start;margin-top:12px"><button class="btn sm" type="button" data-task="${r.reportId}">Leer el informe</button></div>` : ""}`;
}
function taskRowHTML(t) {
  const a = byId[t.agentId], sk = t.skillId ? skillById(t.skillId) : null;
  return `<button class="trow" type="button" data-task="${t.id}">
    <div style="min-width:0"><div class="t">${esc(t.order)}</div><div class="m">${fmtDate(t.createdAt)} · pedido por ${esc(t.from)}${sk ? " · " + esc(sk.name) : ""}</div></div>
    <span class="who">${esc(a.name)}</span><span class="st ${t.status}">${esc(statusLabel(t))}</span></button>`;
}
function filterChips(el, key, opts) {
  el.innerHTML = opts.map(([v, l]) => `<button class="f" type="button" data-f="${key}" data-v="${v}" aria-pressed="${state[key] === v}">${esc(l)}</button>`).join("");
}
function paintTasks() {
  filterChips($("#taskFilters"), "fTasks", [["todos", "Todos"], ["work", "En marcha"], ["done", "Terminados"], ["error", "Con error"], ...ROOMS.map(r => ["room:" + r.id, r.name])]);
  const f = state.fTasks;
  const list = state.tasks.filter(t => f === "todos" || t.status === f || (f.startsWith("room:") && byId[t.agentId].room === f.slice(5))).sort((a, b) => b.createdAt - a.createdAt);
  $("#taskList").innerHTML = list.length ? `<div class="thead"><span>Encargo</span><span>Puesto</span><span>Estado</span></div>` + list.map(taskRowHTML).join("") : `<p class="empty">No hay encargos con este filtro.</p>`;
}
const EXAMPLES = [
  { agentId: "dani", order: "Reel de lanzamiento de 30 s", result: "0:00-0:03 Plano detalle del producto con luz dura lateral, golpe de bajo en el corte. 0:03-0:08 Tres planos rápidos de uso real…" },
  { agentId: "sofia", order: "Calendario de 4 semanas para Instagram y TikTok", result: "Lunes, TikTok: reel «3 errores que…», CTA guardar. Miércoles, Instagram: carrusel comparativo…" },
  { agentId: "alex", order: "Oferta con el método Hormozi", result: "Resultado soñado, plazo, esfuerzo y riesgo. Bonus por orden de valor percibido. Garantía de 30 días…" },
];
const thumbs = {};
function paintDeliverables() {
  filterChips($("#delFilters"), "fDel", [["todos", "Todo"], ...ROOMS.map(r => [r.id, r.name])]);
  const done = state.tasks.filter(t => t.status === "done" && (state.fDel === "todos" || byId[t.agentId].room === state.fDel)).sort((a, b) => b.createdAt - a.createdAt);
  const anyDone = state.tasks.some(t => t.status === "done");
  const list = done.length ? done : anyDone ? [] : EXAMPLES.map(x => ({ ...x, example: true, createdAt: Date.now() }));
  const cards = list.map(t => {
    const a = byId[t.agentId];
    const plain = finalPart(t.result).replace(/[#*|`>_-]+/g, " ").replace(/\s+/g, " ").trim();
    return `<button class="del" type="button" ${t.example ? "disabled style=\"cursor:default\"" : `data-task="${t.id}"`}>
      <div class="who"><img class="px" src="${P(a)}" alt=""><b>${esc(a.name)}</b></div>
      <div class="t">${esc(t.order)}</div><div class="x">${esc(plain.slice(0, 260))}</div>
      <div class="d">${t.example ? '<span class="st ex">Ejemplo</span>' : fmtDate(t.createdAt)}</div></button>`;
  }).join("");
  $("#delGrid").innerHTML = (!done.length && list.length ? `<p class="intro">Todavía no hay nada terminado. Así se verá cuando el equipo entregue su primer trabajo:</p>` : "")
    + (list.length ? `<div class="gallery">${cards}</div>` : `<p class="empty">Todavía no hay entregables en esta sala.</p>`);
}
function paintSkills() {
  filterChips($("#skillFilters"), "fSkills", [["todos", "Todas"], ["custom", "Creadas por ti"], ...ROOMS.map(r => [r.id, r.name])]);
  const f = state.fSkills;
  const list = allSkills().filter(s => f === "todos" || (f === "custom" ? s.custom : byId[s.agentId].room === f));
  const groups = AGENTS.map(a => [a, list.filter(s => s.agentId === a.id)]).filter(([, l]) => l.length);
  $("#skillGrid").innerHTML = groups.map(([a, l]) => `<section class="skgroup"><h2><img class="px" src="${P(a)}" alt="">${esc(a.name)} <span>${esc(a.role)}</span></h2>
    ${l.map(s => `<article class="sk"><h4>${esc(s.name)}${s.custom ? "<em>tuya</em>" : ""}</h4>
      <div><p>${esc(s.desc)}</p><details><summary>Cómo lo hace</summary><p style="margin-top:6px">${esc(s.method)}</p></details></div>
      <div class="acts"><button class="btn ghost sm" type="button" data-use="${s.id}">Usar</button>${s.custom ? `<button class="btn ghost sm" type="button" data-delskill="${s.id}">Borrar</button>` : ""}</div></article>`).join("")}</section>`).join("")
    || `<p class="empty">Aún no has creado skills propias.</p>`;
}

/* ---------- Sala ---------- */
let scene = null;
function paintRooms() {
  $("#roomTabs").innerHTML = ROOMS.map(r => `<button class="rt" type="button" data-room="${r.id}" aria-pressed="${state.room === r.id}">${esc(r.name)} <span class="n" data-room-n="${r.id}"></span></button>`).join("");
  $("#stageName").textContent = roomById[state.room].name;
  paintCounts();
}
function centerStage() { const w = $(".canvaswrap"); if (w && w.scrollWidth > w.clientWidth) w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2; }
function setRoom(id) { state.room = id; scene?.setRoom(roomById[id]); paintRooms(); paintTeam(); }

/* ---------- Navegación ---------- */
const VIEWS = ["oficina", "encargos", "skills", "entregables"];
function go(view) {
  if (!VIEWS.includes(view)) view = "oficina";
  state.view = view;
  VIEWS.forEach(v => { $("#v-" + v).hidden = v !== view; });
  document.querySelectorAll(".tab[data-view]").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === view)));
  if (view === "oficina") scene?.start(); else scene?.stop();
  if (view === "encargos") paintTasks();
  if (view === "skills") paintSkills();
  if (view === "entregables") paintDeliverables();
  paintRooms();
  if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", () => go(location.hash.slice(1)));

/* ---------- Compositor ---------- */
function paintTargets() {
  $("#target").innerHTML = `<option value="empresa">Toda la empresa (Dirección reparte)</option>` + ROOMS.map(r =>
    `<optgroup label="${esc(r.name)}">${AGENTS.filter(a => a.room === r.id).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</optgroup>`).join("");
  $("#target").value = state.comp.target;
}
function paintComposer() {
  const c = state.comp;
  document.querySelectorAll("#composer [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === c.mode)));
  const slot = $("#skillSlot");
  if (c.target === "empresa") slot.innerHTML = "";
  else {
    const list = skillsOf(c.target);
    slot.innerHTML = `<label for="skillSel" hidden>Skill</label><select id="skillSel"><option value="">Sin skill concreta</option>${list.map(s => `<option value="${s.id}" ${c.skill === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
  }
  $("#btnAttach").hidden = !(AI.images || AI.mode === "none") || !!c.image;
  $("#imgSlot").innerHTML = c.image ? `<span class="chip-img"><img src="${URL.createObjectURL(c.image)}" alt="">${esc(c.image.name.slice(0, 20))}<button type="button" id="rmImg" aria-label="Quitar imagen">Quitar</button></span>` : "";
  const sk = c.skill ? skillById(c.skill) : null;
  $("#cmd").placeholder = c.target === "empresa" ? "Describe el encargo. Dirección lo repartirá entre los puestos."
    : sk ? `Con «${sk.name}»: ${sk.desc} Añade los detalles.` : `Encargo para ${byId[c.target].name}: describe lo que necesitas`;
}
$("#target").addEventListener("change", e => { state.comp.target = e.target.value; state.comp.skill = null; paintComposer(); });
$("#skillSlot").addEventListener("change", e => { if (e.target.id === "skillSel") { state.comp.skill = e.target.value || null; paintComposer(); } });
$("#btnAttach").addEventListener("click", () => $("#fileIn").click());
$("#fileIn").addEventListener("change", e => { const f = e.target.files?.[0]; if (f) { state.comp.image = f; paintComposer(); } e.target.value = ""; });
$("#composer").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#cmd").value.trim(), c = state.comp;
  if (!v && !c.skill) { $("#cmd").focus(); return; }
  if (!aiReady()) { toast(errText({ code: "no_ai" })); openSettings(); return; }
  const order = v || skillById(c.skill).name;
  $("#cmd").value = ""; autosize();
  if (c.target === "empresa") runCompany(order, "order");
  else {
    const a = byId[c.target];
    if (a.room !== state.room) setRoom(a.room);
    runTask({ agentId: c.target, order, from: "Tú", skillId: c.skill, mode: c.mode, image: c.image });
    toast(`Encargo enviado a ${a.name}.`);
  }
  c.image = null; paintComposer();
});
function autosize() { const t = $("#cmd"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; }
$("#cmd").addEventListener("input", autosize);
$("#cmd").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("#composer").requestSubmit(); } });
$("#btnAuto").addEventListener("click", () => { if (state.run) { state.run.ctl?.abort(); return; } runCompany("", "auto"); });

/* ---------- Panel del agente ---------- */
function openAgent(id, focusTask) {
  state.open = id; scene?.select(id);
  const a = byId[id], r = roomById[a.room], dc = state.dComp;
  if (dc.agent !== id) { dc.agent = id; dc.skill = null; }
  const tasks = state.tasks.filter(t => t.agentId === id).sort((x, y) => y.createdAt - x.createdAt);
  $("#drawer").innerHTML = `
    <div class="d-head"><img class="px" src="${P(a)}" alt="">
      <div style="min-width:0"><h2 id="dName">${esc(a.name)}</h2><p>${esc(a.role)} · ${esc(r.name)}</p>
      <p class="d-status" id="dStatus"></p></div>
      <button class="btn ghost sm x" type="button" id="dClose">Cerrar</button></div>
    <div class="d-body">
      <p class="d-bio">${esc(a.bio)} <span>Trabaja con ${esc(a.tools.join(", "))}.</span></p>
      <form class="dorder" id="dOrder"><p class="lbl" style="margin:0">Nuevo encargo</p>
        <label for="dText" hidden>Encargo</label>
        <textarea id="dText" placeholder="${dc.skill ? esc("Con «" + skillById(dc.skill).name + "». Añade los detalles.") : "Describe lo que necesitas"}"></textarea>
        <div class="crow"><div class="seg" role="group" aria-label="Profundidad"><button type="button" data-dmode="rapido" aria-pressed="${dc.mode === "rapido"}">Rápido</button><button type="button" data-dmode="pro" aria-pressed="${dc.mode === "pro"}">Por pasos</button></div>
        <span class="grow"></span><button class="btn" type="submit">Encargar</button></div></form>
      <div><p class="lbl">Método (opcional)</p><div class="minisk">${skillsOf(id).map(s => `<button type="button" data-dskill="${s.id}" aria-pressed="${dc.skill === s.id}"><span><b>${esc(s.name)}</b>${esc(s.desc)}</span></button>`).join("")}</div></div>
      <div><p class="lbl">Trabajo <span class="num">${tasks.length || ""}</span></p><div id="dTasks">${tasks.length ? tasks.map(drawerTaskHTML).join("") : `<p class="empty">Todavía no le has encargado nada.</p>`}</div></div>
    </div>`;
  paintDStatus();
  $("#drawer").hidden = false; $("#scrim").hidden = false;
  if (focusTask) $("#drawer").querySelector(`[data-tid="${focusTask}"]`)?.scrollIntoView({ block: "start" });
}
function paintDStatus() { const el = $("#dStatus"); if (!el || !state.open) return; el.innerHTML = `${statusDot(state.open)} ${esc(statusText(state.open))}`; }
function drawerTaskHTML(t) {
  const sk = t.skillId ? skillById(t.skillId) : null, p = progressOf(t);
  const cur = i => i + 1 === (t.step || 1) && t.status === "work" && t.phase === "exec", done = i => i + 1 < (t.step || 0) || t.status === "done";
  const steps = t.steps.length ? `<div class="steps">${t.steps.map((s, i) => `<div class="s ${done(i) ? "done" : cur(i) ? "cur" : ""}"><i>${i + 1}</i><span>${esc(s)}</span></div>`).join("")}</div>` : "";
  const body = t.status === "work" && !t.result ? `<div class="thinking">${esc(p.txt)}…</div>` : `<div class="md">${md(t.result)}</div>`;
  const others = AGENTS.filter(x => x.id !== t.agentId);
  const acts = t.status === "done" ? `<div class="task-acts">
      <button class="btn ghost sm" type="button" data-copy="${t.id}">Copiar</button><button class="btn ghost sm" type="button" data-dl="${t.id}">Descargar</button>
      <button class="btn ghost sm" type="button" data-improve="${t.id}">Revisar y mejorar</button>
      <button class="btn ghost sm" type="button" data-del="${t.id}">Borrar</button>
      <span class="sep"></span>
      <label for="ho-${t.id}" hidden>Pasar a</label><select id="ho-${t.id}"><option value="">Pasar a otro puesto…</option>${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>
      <label for="hi-${t.id}" hidden>Instrucción</label><input id="hi-${t.id}" placeholder="Qué debe hacer con esto">
      <button class="btn sm" type="button" data-handoff="${t.id}">Pasar</button></div>`
    : t.status === "error" ? `<div class="task-acts"><button class="btn ghost sm" type="button" data-retry="${t.id}">Reintentar</button><button class="btn ghost sm" type="button" data-del="${t.id}">Borrar</button></div>` : "";
  return `<article class="task" data-tid="${t.id}" data-v="${t.v}">
    <div class="task-h"><span class="o">${esc(t.order)}</span><span class="st ${t.status}">${esc(statusLabel(t))}</span><span class="meta">${fmtDate(t.createdAt)} · pedido por ${esc(t.from)}${sk ? " · " + esc(sk.name) : ""}</span></div>
    ${steps}${body}${acts}</article>`;
}
function refreshDrawerTasks() {
  paintDStatus();
  const box = $("#dTasks"); if (!box) return;
  const tasks = state.tasks.filter(t => t.agentId === state.open).sort((x, y) => y.createdAt - x.createdAt);
  const ids = [...box.querySelectorAll("[data-tid]")].map(e => e.dataset.tid);
  if (ids.join() !== tasks.map(t => t.id).join()) { box.innerHTML = tasks.length ? tasks.map(drawerTaskHTML).join("") : `<p class="empty">Todavía no le has encargado nada.</p>`; return; }
  for (const t of tasks) if (changed.has(t.id)) { const el = box.querySelector(`[data-tid="${t.id}"]`); if (el && el.dataset.v !== String(t.v)) el.outerHTML = drawerTaskHTML(t); }
}
function closeAgent() { state.open = null; scene?.select(null); $("#drawer").hidden = true; $("#scrim").hidden = true; }
document.addEventListener("submit", e => {
  if (e.target.id !== "dOrder") return;
  e.preventDefault();
  const id = state.open, v = $("#dText").value.trim(), dc = state.dComp;
  if (!v && !dc.skill) { $("#dText").focus(); return; }
  if (!aiReady()) { toast(errText({ code: "no_ai" })); openSettings(); return; }
  runTask({ agentId: id, order: v || skillById(dc.skill).name, from: "Tú", skillId: dc.skill, mode: dc.mode });
  dc.skill = null; openAgent(id);
});

/* ---------- Clics ---------- */
document.addEventListener("click", async e => {
  const el = sel => e.target.closest(sel);
  let b;
  if ((b = el("[data-view]"))) return go(b.dataset.view);
  if ((b = el("[data-go]"))) return go(b.dataset.go);
  if ((b = el("[data-room]"))) { if (state.view !== "oficina") go("oficina"); return setRoom(b.dataset.room); }
  if ((b = el("[data-agent]"))) return openAgent(b.dataset.agent);
  if ((b = el("[data-task]"))) { const t = state.tasks.find(x => x.id === b.dataset.task); if (t) openAgent(t.agentId, t.id); return; }
  if (el("[data-settings]")) return openSettings();
  if (el("#dClose") || e.target === $("#scrim")) return closeAgent();
  if (el("#rmImg")) { state.comp.image = null; return paintComposer(); }
  if ((b = el("[data-mode]"))) { state.comp.mode = b.dataset.mode; return paintComposer(); }
  if ((b = el("[data-dmode]"))) { state.dComp.mode = b.dataset.dmode; document.querySelectorAll("[data-dmode]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); return; }
  if ((b = el("[data-dskill]"))) { const dc = state.dComp; dc.skill = dc.skill === b.dataset.dskill ? null : b.dataset.dskill; const txt = $("#dText").value, top = $(".d-body").scrollTop; openAgent(state.open); $("#dText").value = txt; $(".d-body").scrollTop = top; return; }
  if ((b = el("[data-f]"))) { state[b.dataset.f] = b.dataset.v; return b.dataset.f === "fSkills" ? paintSkills() : b.dataset.f === "fTasks" ? paintTasks() : paintDeliverables(); }
  if ((b = el("[data-use]"))) { const s = skillById(b.dataset.use); state.comp = { ...state.comp, target: s.agentId, skill: s.id }; go("oficina"); setRoom(byId[s.agentId].room); paintTargets(); paintComposer(); $("#cmd").focus(); return; }
  if ((b = el("[data-delskill]"))) { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro?"; return; } state.customSkills = state.customSkills.filter(s => s.id !== b.dataset.delskill); await store.deleteSkill(b.dataset.delskill); paintSkills(); paintCounts(); return; }
  if ((b = el("[data-copy]"))) { const t = state.tasks.find(x => x.id === b.dataset.copy); try { await navigator.clipboard.writeText(t.result); toast("Copiado."); } catch { toast("No se pudo copiar; selecciona el texto a mano."); } return; }
  if ((b = el("[data-dl]"))) return download(state.tasks.find(x => x.id === b.dataset.dl));
  if ((b = el("[data-improve]"))) {
    const t = state.tasks.find(x => x.id === b.dataset.improve);
    runTask({ agentId: t.agentId, order: "Revisar y mejorar: " + t.order, from: "Tú", mode: "rapido", skillId: t.skillId,
      extra: `Este es tu trabajo anterior:\n${t.result.slice(0, 12000)}\n\nRevísalo con ojo crítico de experto exigente: señala en 3-5 puntos qué falla o es mejorable y entrega la versión mejorada completa.` });
    toast("Revisión en marcha."); return;
  }
  if ((b = el("[data-handoff]"))) {
    const t = state.tasks.find(x => x.id === b.dataset.handoff), to = $("#ho-" + t.id).value, ins = $("#hi-" + t.id).value.trim();
    if (!to) { toast("Elige a qué puesto se lo pasas."); $("#ho-" + t.id).focus(); return; }
    runTask({ agentId: to, order: ins || `Continúa este trabajo de ${byId[t.agentId].name}: ${t.order}`, from: byId[t.agentId].name, mode: "pro",
      extra: `El puesto de ${byId[t.agentId].role} te pasa este trabajo para que lo uses como base:\n${t.result.slice(0, 12000)}` });
    toast(`Pasado a ${byId[to].name}.`); return;
  }
  if ((b = el("[data-retry]"))) { const t = state.tasks.find(x => x.id === b.dataset.retry); runTask({ agentId: t.agentId, order: t.order, from: t.from, skillId: t.skillId, mode: t.mode, extra: t.extra }); return; }
  if ((b = el("[data-del]"))) {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro?"; return; }
    const id = b.dataset.del; state.tasks = state.tasks.filter(x => x.id !== id); await store.deleteTask(id); paintAll(); return;
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && state.open) closeAgent(); });

async function download(t) {
  if (!t) return;
  const filename = `${byId[t.agentId].name}-${t.order.slice(0, 40)}`.replace(/[^\p{L}\p{N}]+/gu, "-") + ".md";
  const dls = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (dls) { try { await dls.save({ filename, data: t.result }); } catch { toast("Descarga cancelada."); } return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t.result], { type: "text/markdown" })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Ajustes y skills propias ---------- */
function openSettings() {
  $("#fCompany").value = state.company; $("#fBrief").value = state.brief;
  const s = settingsLocal(); $("#fKey").value = s.key || ""; $("#fModel").value = s.model || "claude-opus-5-5";
  $("#keyFields").hidden = AI.mode === "sample";
  $("#settings").showModal();
}
$("#settings").addEventListener("close", async () => {
  if ($("#settings").returnValue !== "save") return;
  state.company = $("#fCompany").value.trim() || "Mi empresa";
  state.brief = $("#fBrief").value.trim() || state.brief;
  if (AI.mode !== "sample") saveSettingsLocal({ key: $("#fKey").value.trim(), model: $("#fModel").value });
  paintHeader(); updateBanner(); await store.saveMeta(); toast("Guardado. El equipo ya conoce el proyecto.");
});
$("#btnNewSkill").addEventListener("click", () => {
  $("#kAgent").innerHTML = AGENTS.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  ["kName", "kDesc", "kMethod"].forEach(i => $("#" + i).value = "");
  $("#skillDlg").showModal();
});
$("#skillDlg").addEventListener("close", async () => {
  if ($("#skillDlg").returnValue !== "save") return;
  const name = $("#kName").value.trim(), method = $("#kMethod").value.trim();
  if (!name || !method) { toast("La skill necesita nombre y método."); return; }
  const s = { id: "c." + uid(), agentId: $("#kAgent").value, name, desc: $("#kDesc").value.trim() || name, method, createdAt: Date.now() };
  state.customSkills.push(s); await store.saveSkill(s); state.fSkills = "custom"; paintSkills(); paintCounts(); toast("Skill creada.");
});
function paintHeader() {
  $("#coName").textContent = state.company;
  $("#coTitle").textContent = state.company;
  $("#briefLine").textContent = state.brief.length > 160 ? state.brief.slice(0, 160) + "…" : state.brief;
}
function updateBanner() {
  const b = $("#aiBanner");
  if (aiReady()) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = AI.mode === "pending" ? "Conectando con Claude…" : `Para que el equipo trabaje, abre esta app dentro de Claude o añade tu clave de API en <b>Ajustes</b>.`;
}

/* ---------- Almacenamiento: base de datos del artifact o este navegador ---------- */
const store = {
  db: null, base: null,
  async init() {
    try {
      if (window.claude?.use) {
        const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
        const id = db && user ? await user.id() : null;
        if (db && id) { this.db = db; this.base = db.doc(`data/users/${id}/office`); }
      }
    } catch {}
    if (this.db) {
      try {
        const s = await this.base.get();
        if (s.exists) { const d = s.data(); state.company = d.company || state.company; state.brief = d.brief || state.brief; }
        const [tq, rq, sq] = await Promise.all([
          this.base.collection("tasks").orderBy("createdAt", "desc").limit(300).get(),
          this.base.collection("runs").orderBy("createdAt", "desc").limit(50).get(),
          this.base.collection("skills").get()]);
        mergeTasks(tq.docs.map(d => d.data())); mergeRuns(rq.docs.map(d => d.data())); state.customSkills = sq.docs.map(d => d.data()).filter(s => byId[s.agentId]);
      } catch { this.db = null; }
    }
    if (!this.db) {
      try { const s = JSON.parse(localStorage.getItem("oficina.v2") || "null");
        if (s) { state.company = s.company || state.company; state.brief = s.brief || state.brief; mergeTasks(s.tasks || []); mergeRuns(s.runs || []); state.customSkills = s.skills || []; } } catch {}
    }
    paintHeader(); paintAll(); if (state.view !== "oficina") go(state.view);
  },
  async put(col, rec) { if (this.db) { try { await this.base.collection(col).doc(rec.id).set(rec); return; } catch (e) { if (e?.code === "quota_exceeded") toast("El almacén está lleno: borra entregas antiguas."); } } this.local(); },
  async del(col, id) { if (this.db) { try { await this.base.collection(col).doc(id).delete(); return; } catch {} } this.local(); },
  saveMeta() { if (this.db) return this.base.set({ company: state.company, brief: state.brief }).catch(() => this.local()); this.local(); },
  saveTask(t) { const { v, ...rec } = t; rec.result = (rec.result || "").slice(0, 150000); rec.extra = (rec.extra || "").slice(0, 2000); return this.put("tasks", rec); },
  deleteTask(id) { return this.del("tasks", id); },
  saveRun(r) { const { ctl, ...rec } = r; return this.put("runs", JSON.parse(JSON.stringify(rec))); },
  saveSkill(s) { return this.put("skills", s); },
  deleteSkill(id) { return this.del("skills", id); },
  local() {
    try { localStorage.setItem("oficina.v2", JSON.stringify({ company: state.company, brief: state.brief,
      tasks: state.tasks.filter(t => t.status !== "work").slice(-150).map(({ v, ...r }) => r), runs: state.runs.filter(r => r.status !== "work").slice(-30).map(({ ctl, ...r }) => r), skills: state.customSkills })); } catch {}
  },
};
function mergeTasks(list) {
  const have = new Set(state.tasks.map(t => t.id));
  for (const t of list) if (t?.id && byId[t.agentId] && !have.has(t.id)) state.tasks.push({ steps: [], ...t, status: t.status === "work" ? "error" : t.status, v: 0 });
}
function mergeRuns(list) { const have = new Set(state.runs.map(r => r.id)); for (const r of list) if (r?.id && !have.has(r.id)) state.runs.push({ ...r, status: r.status === "work" ? "error" : r.status }); }

/* ---------- Arranque ---------- */
function tick() { $("#clock").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
async function boot() {
  try { await Promise.race([document.fonts.load('8px "Silkscreen"'), new Promise(r => setTimeout(r, 1500))]); } catch {}
  scene = Office.create($("#scene"), { agents: AGENTS, onPick: id => openAgent(id), getState: () => state });
  paintTargets(); paintComposer(); paintHeader();
  setRoom(state.room);
  go(location.hash.slice(1) || "oficina");
  centerStage();
  tick(); setInterval(tick, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) scene.stop(); else if (state.view === "oficina") scene.start(); });
  AI.mode = window.claude?.use ? "pending" : "none"; updateBanner();
  if (window.claude?.use) {
    const s = await window.claude.use("sample").catch(() => null);
    if (s) { AI.sample = s; AI.mode = "sample"; try { AI.images = !!(await s.limits())?.images; } catch {} } else AI.mode = "none";
  }
  if (AI.mode === "none") AI.images = true; // con clave propia la API acepta imágenes
  updateBanner(); paintComposer();
  store.init();
}
boot();
