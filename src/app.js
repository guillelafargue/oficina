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
  const base = AGENTS.flatMap(a => a.skills.map(([k, name, desc, method, src]) => ({ id: a.id + "." + k, agentId: a.id, name, desc, method, src: src || "", custom: false })));
  return base.concat(state.customSkills.map(s => ({ ...s, custom: true })));
}
const skillById = id => allSkills().find(s => s.id === id);
const skillsOf = agentId => allSkills().filter(s => s.agentId === agentId);

/* ---------- IA: Claude dentro de claude.ai, o API propia fuera ---------- */
const AI = { sample: null, mode: "none", images: false, tools: false };
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

async function ask(prompt, { onText, signal, json = false, image = null, quick = false, tools = null } = {}) {
  if (AI.mode === "sample") {
    const opts = { signal };
    if (tools?.length && AI.tools) opts.tools = tools; else opts.cache = false;
    if (quick) opts.modelTier = "quick";
    if (image && AI.images) opts.images = [image];
    if (json) return AI.sample.json(prompt, opts);
    let r = await AI.sample(prompt, { ...opts, onText }), text = r.text;
    // Si la respuesta se corta por longitud, se pide que siga donde lo dejó (hasta 3 veces).
    for (let i = 0; r.truncated && i < 3; i++) {
      const before = text;
      r = await AI.sample([{ role: "user", content: prompt }, { role: "assistant", content: text }, { role: "user", content: "Tu respuesta se ha cortado por longitud. Continúa exactamente desde el último carácter que escribiste, sin repetir nada y sin comentarios. Si estabas dentro de un bloque de código, sigue dentro de él." }],
        { signal, cache: false, onText: ({ text: more }) => onText?.({ text: before + more, delta: "" }) });
      text = before + r.text;
    }
    return text;
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
    throw { code: res.status === 401 ? "bad_key" : res.status === 429 ? "rate_limited" : res.status === 529 ? "overloaded" : "upstream_error", message: data?.error?.message || ("HTTP " + res.status) };
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
    prompt_too_large: "El encargo es demasiado largo; divídelo.", overloaded: "Claude está saturado ahora mismo. Prueba en unos minutos.", empty_completion: "Claude no devolvió texto. Vuelve a intentarlo." })[e?.code]
    || (/\b(529|overloaded)\b/i.test(e?.message || "") ? "Claude está saturado ahora mismo. Prueba en unos minutos." : /\b(5\d\d)\b/.test(e?.message || "") ? "El servicio de Claude ha fallado un momento. Vuelve a intentarlo." : "No se pudo completar: " + (e?.message || "error desconocido"));
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
${a.kit ? `CÓMO TRABAJAS CON TU STACK (lo más puntero de hoy en tu sector):\n${a.kit}\n` : ""}Tus métodos: ${skillsOf(a.id).map(s => s.name).join(", ")}.
${canonBlock(a)}${memoryBlock(a)}
PROYECTO DE LA EMPRESA:
${state.brief}

TRABAJO RECIENTE DEL EQUIPO (para ser coherente y no repetir):
${recentWork(6)}`;
}
// Conocimiento a fondo de los referentes del puesto: obras y principios concretos, no solo el nombre.
function canonBlock(a) {
  if (!a.refs?.length) return "";
  const list = a.refs.map(([n, i]) => {
    const c = CANON[n];
    return c ? `### ${n}: ${c[0]}\n${c[1].map(p => "- " + p).join("\n")}` : `### ${n}\n- ${i}`;
  }).join("\n\n");
  return `\nCONOCIMIENTO DE TUS REFERENTES. Lo dominas como si fueras su mejor discípulo y lo aplicas en cada entrega. Estas son las claves de su obra; además, usa todo lo que sabes de sus libros, charlas y casos, y cita el marco que aplicas cuando aporte:\n\n${list}\n`;
}
function canonChecks(a) {
  return (a.refs || []).flatMap(([n]) => (CANON[n]?.[1] || []).slice(0, 2).map(p => `- ${n}: ${p}`)).join("\n");
}
const RULES = (a) => `Cómo entregar:
- En español, en Markdown, con la calidad de un profesional senior de primer nivel en tu área. Nada genérico: concreto y aplicable a este proyecto.
- Estructura SIEMPRE así: empieza con «## Resumen» (de 3 a 5 viñetas cortas: qué entregas, tu recomendación o la decisión clave, y qué necesitas del propietario). Después, el trabajo en secciones «## …» con subtítulos «### …». Si te han dado un plan de pasos, cada paso es una sección «## 1. …», «## 2. …». Cierra con «## Entrega final»: el resultado consolidado y listo para usar.
- Si das opciones o propuestas, cada una en «### Opción A: título» (B, C…) con **Qué**, **Por qué**, **Esfuerzo** e **Impacto**; después, una tabla comparativa y tu recomendación.
- Números, comparativas y calendarios, en tablas. Plannings y cronogramas: tabla con fechas y responsables y además un diagrama \`\`\`mermaid gantt. Procesos, flujos o arquitectura: \`\`\`mermaid flowchart. Mermaid sencillo, con etiquetas sin paréntesis ni comillas.
- Bocetos de páginas web, pantallas de la app, landings o piezas visuales: un bloque \`\`\`html completo y autocontenido (CSS en <style>, sin imágenes ni scripts externos, con textos y datos realistas). La oficina lo muestra en vivo y lo descarga.
- Si es código, el código completo sin omitir partes; si es un guion, entero y con tiempos.
- Si el encargo implica cambiar el código de una app, añade antes de la entrega final «## Cambios para Claude Code»: objetivo, archivos y qué cambia en cada uno, cómo probarlo y criterios de aceptación. El propietario lo enviará con un botón a Claude Code, que hará el cambio y abrirá la PR.
- Si el trabajo se ejecuta en una herramienta externa (por ejemplo ${a.tools[0]}), indica exactamente qué hacer en ella paso a paso.
- Si te falta un dato, asume algo razonable, dilo en una línea y sigue.`;
function planStepsPrompt(a, order, skill) {
  return `${persona(a)}

ENCARGO (de ${"{from}"}):
${order}
${skill ? `\nMÉTODO A SEGUIR, skill «${skill.name}»:\n${skill.method}\n` : ""}
TU REPERTORIO DE SKILLS:
${skillsOf(a.id).map(s => `- ${s.id}: ${s.name}. ${s.desc}`).join("\n")}

Antes de trabajar, planifica. Elige de tu repertorio las skills (de 1 a 3) que más mejoran este encargo${skill ? ", además de la indicada" : ""}, y divide el trabajo en 3 a 6 pasos concretos y ordenados, como lo haría un experto de tu área aplicando esos métodos.
Responde SOLO con JSON: {"skills": ["id de skill", "..."], "pasos": ["título corto del paso 1", "..."]}`;
}
function execPrompt(a, t, skill) {
  const plan = t.steps.length ? `\nPLAN DE TRABAJO (síguelo en orden):\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nTras «## Resumen», una sección por paso titulada exactamente «## 1. …», «## 2. …», etc. Termina con «## Entrega final»: el resultado consolidado, listo para usar.` : "";
  const ctx = ctxFor(`${t.order} ${skill?.name || ""} ${a.role}`, 24000);
  return `${persona(a)}
${ctx ? "\n" + ctx + "\n" : CTX.projectFiles ? "" : "\nNO HAY ARCHIVOS DE CONTEXTO CARGADOS. Si el encargo trata sobre el código, los documentos o los datos de la app del propietario, dilo en la primera línea («No tengo cargado el código de la app: súbelo en Contexto») y trabaja solo con el briefing, sin inventar archivos.\n"}${t.extra ? "\nCONTEXTO DEL ENCARGO:\n" + t.extra + "\n" : ""}
ENCARGO (de ${t.from}):
${t.order}
${methodsBlock(a, t, skill)}${t.hasImage ? "\nSe adjunta una imagen de referencia: analízala y úsala en el trabajo.\n" : ""}${plan}

${RULES(a)}
- Si el contexto del propietario incluye su código, documentos o datos, trabaja sobre ellos: cita archivos y secciones concretas, respeta lo que ya existe y propone cambios exactos.${t.useTools ? "\n- Tienes herramientas para buscar y leer el contexto completo (y los archivos del proyecto si están activados). Úsalas antes de escribir si los fragmentos no bastan; no inventes contenido de archivos que no has leído." : ""}
- Cierra con una línea «Siguiente paso sugerido: …».`;
}
// Todas las skills del puesto entran en cada encargo: las elegidas como método principal y el resto como repertorio a aplicar si encaja.
function methodsBlock(a, t, skill) {
  const main = [skill, ...(t.autoSkills || []).map(skillById)].filter(Boolean);
  const rest = skillsOf(a.id).filter(s => !main.includes(s));
  return (main.length ? `\nMÉTODOS PRINCIPALES DE ESTE ENCARGO (aplícalos a fondo):\n${main.map(s => `«${s.name}»${s.src ? ` (basado en ${s.src})` : ""}: ${s.method}`).join("\n")}\n` : "")
    + `\nRESTO DE TU REPERTORIO (aplica también cualquier método que mejore el resultado):\n${rest.map(s => `«${s.name}»: ${s.method}`).join("\n")}\n`
    + `Al final, en una línea, indica qué métodos has aplicado.\n`;
}
function companyPlanPrompt(order, kind) {
  const intro = kind === "auto"
    ? "Nadie te ha dado una orden nueva. Decide qué es lo más valioso que puede hacer el equipo AHORA para avanzar el proyecto, teniendo en cuenta lo ya entregado. No repitas trabajo hecho."
    : `El propietario de la empresa te da este encargo:\n«${order}»`;
  return `Eres la Dirección general de «${state.company}». Diriges una oficina de agentes especializados.

PROYECTO:
${state.brief}
${ctxFor(order || state.brief, 8000)}

EQUIPO (usa exactamente estos identificadores de agente y de skill):
${roster()}

TRABAJO YA ENTREGADO:
${recentWork(8)}
${BRAIN.facts.length ? `\nLO QUE YA SABE LA EMPRESA:\n${BRAIN.facts.map(x => "- " + x.text).join("\n")}\n` : ""}${(() => { const weak = state.tasks.filter(t => t.status === "done" && (t.feedback === "down" || (typeof t.score === "number" && (t.finalScore ?? t.score) < 7))).slice(-6); return weak.length ? `\nENTREGAS QUE EL PROPIETARIO O SU AUTOR CONSIDERAN MEJORABLES (candidatas a rehacer):\n${weak.map(t => `- ${byId[t.agentId].name}: ${t.order}${t.faults?.length ? " (fallos: " + t.faults.join("; ") + ")" : ""}`).join("\n")}\n` : ""; })()}

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

Escribe en español, en Markdown, un informe ejecutivo breve para el propietario. Empieza con «## Resumen» (3-5 viñetas) y sigue con secciones «## …»: qué se ha hecho (tabla con puesto, entrega y estado), decisiones clave, qué necesita aprobar o aportar él, incoherencias entre entregas si las hay y los 3 siguientes pasos con su responsable (tabla). Cierra con «Siguiente paso sugerido: …».`;
}

/* ---------- Ejecución de tareas ---------- */
function newTask(o) {
  const t = { id: uid(), agentId: o.agentId, order: o.order, from: o.from || "Tú", skillId: o.skillId || null, mode: o.mode || "pro", runId: o.runId || null,
    extra: o.extra || "", steps: [], step: 0, phase: "cola", result: "", status: "work", createdAt: Date.now(), hasImage: !!o.image, v: 0, ...(o.version > 1 ? { version: o.version } : {}) };
  projPush("tasks", t, o.project || projOfRun(o.runId) || PROJ.cur); o._onCreate?.(t); return t;
}
function setAgent(agentId) {
  const mine = projAll("tasks").filter(t => t.agentId === agentId && t.status === "work");
  const active = mine.find(t => t.phase !== "cola");
  state.status[agentId] = active ? "work" : mine.length ? "queue" : "idle";
  if (active) state.bubble[agentId] = active.phase === "plan" ? "Planificando" : active.phase === "review" ? "Autoevaluando" : active.phase === "revise" ? "Mejorando su trabajo" : active.steps.length && active.step ? `Paso ${active.step}/${active.steps.length}` : "Trabajando";
  else delete state.bubble[agentId];
}
// Cada encargo tiene su propio interruptor: se puede detener solo o caer con el encargo de empresa que lo contiene.
const CTL = new Map();
function stopTask(t) { if (t.cloud && stopCloud(t)) return; const c = CTL.get(t.id); if (c) { t.stopped = true; c.abort(); } }
async function runTask(o) {
  if (!o.local && !o.runId && !o.image && cloudReady()) return runCloud(o);
  const a = byId[o.agentId], t = newTask(o), skill = t.skillId ? skillById(t.skillId) : null;
  const ctl = new AbortController(); CTL.set(t.id, ctl);
  if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener("abort", () => ctl.abort(), { once: true }); }
  o = { ...o, signal: ctl.signal };
  setAgent(a.id); bump(t);
  try {
    await acquire(o.signal);
    try {
      if (t.mode === "pro") {
        t.phase = "plan"; setAgent(a.id); bump(t);
        const raw = await ask(planStepsPrompt(a, t.order, skill).replace("{from}", t.from), { json: true, signal: o.signal, quick: true });
        t.steps = (Array.isArray(raw?.pasos) ? raw.pasos : []).map(String).filter(Boolean).slice(0, 6);
        const mine = new Set(skillsOf(a.id).map(s => s.id));
        t.autoSkills = (Array.isArray(raw?.skills) ? raw.skills : []).map(String).filter(id => mine.has(id) && id !== t.skillId).slice(0, 3);
      }
      t.phase = "exec"; setAgent(a.id); bump(t);
      let lastPaint = 0;
      const tools = AI.mode === "sample" && AI.tools ? ctxTools(a.id) : [];
      t.useTools = tools.length > 0;
      t.result = await ask(execPrompt(a, t, skill), { signal: o.signal, image: o.image || null, tools, onText: ({ text }) => {
        t.result = text;
        if (t.steps.length) {
          let m, k = 0; const re = /^##\s*(\d+)[.)]/gm; while ((m = re.exec(text))) k = Math.max(k, +m[1]);
          if (/^##\s*Entrega final/im.test(text)) k = t.steps.length;
          if (k !== t.step) { t.step = Math.min(k, t.steps.length); setAgent(a.id); }
        }
        const now = Date.now(); if (now - lastPaint > 300) { lastPaint = now; bump(t); }
      } });
      t.step = t.steps.length;
      await selfReview(a, t, skill, o.signal);
      t.status = "done";
    } finally { release(); }
  } catch (e) {
    t.status = "error"; t.result = (e?.text || t.result ? (e?.text || t.result) + "\n\n" : "") + "> " + (ctl.signal.aborted ? "Detenido a mano." : errText(e));
  }
  CTL.delete(t.id);
  t.phase = "fin"; setAgent(a.id); bump(t); await store.saveTask(t);
  if (t.status === "done") maybeLearnSkill(a);
  return t;
}

async function runCompany(order, kind) {
  if (!aiReady()) { toast(errText({ code: "no_ai" })); openSettings(); return; }
  if (state.run) { toast("La empresa ya está con un encargo. Puedes detenerlo o esperar."); return; }
  const ctl = new AbortController();
  const run = { id: uid(), kind, order, resumen: "Dirección está preparando el plan…", fases: [], status: "work", createdAt: Date.now(), ctl };
  state.run = run; projPush("runs", run);
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

/* ---------- Cerebro: memoria, autoevaluación y aprendizaje continuo ---------- */
// Cada puesto acumula lecciones de su experiencia; la empresa acumula hechos compartidos.
// Tras cada entrega el puesto se evalúa, rehace el trabajo si no llega al nivel y guarda lo aprendido.
const BRAIN = { mem: {}, facts: [], review: true, auto: { on: false, every: 30, next: 0, rounds: 0 } };
const MEM_MAX = 24, FACTS_MAX = 40, REVIEW_BELOW = 8, LEARNED_MAX = 5, AUTO_MAX_ROUNDS = 12;
const memOf = id => (BRAIN.mem[id] ||= []);
const similar = (a, b) => { const x = norm(a).replace(/\W+/g, " ").trim(), y = norm(b).replace(/\W+/g, " ").trim(); return x === y || x.includes(y.slice(0, 40)) || y.includes(x.slice(0, 40)); };
function addLessons(id, list, src = "auto", from = "") {
  const m = memOf(id); let n = 0;
  for (const raw of list || []) {
    const text = String(raw || "").trim().slice(0, 300); if (text.length < 8) continue;
    const dup = m.find(x => similar(x.text, text));
    if (dup) { dup.hits = (dup.hits || 1) + 1; if (src === "tu") dup.src = "tu"; continue; }
    m.push({ id: uid(), text, src, from: from.slice(0, 80), at: Date.now(), hits: 1 }); n++;
  }
  if (n) store.saveBrain(id);
  if (m.length > MEM_MAX) consolidate(id);
  return n;
}
function addFacts(list) {
  let n = 0;
  for (const raw of list || []) {
    const text = String(raw || "").trim().slice(0, 300); if (text.length < 8 || BRAIN.facts.some(x => similar(x.text, text))) continue;
    BRAIN.facts.push({ id: uid(), text, at: Date.now() }); n++;
  }
  if (BRAIN.facts.length > FACTS_MAX) BRAIN.facts = BRAIN.facts.slice(-FACTS_MAX);
  if (n) store.saveBrain("facts");
}
function memoryBlock(a) {
  const m = memOf(a.id).slice().sort((x, y) => (y.src === "tu") - (x.src === "tu") || (y.hits || 1) - (x.hits || 1));
  let s = "";
  if (m.length) s += `\nLO QUE HAS APRENDIDO CON LA EXPERIENCIA (aplícalo siempre; lo marcado [Propietario] viene de sus valoraciones y tiene prioridad):\n${m.map(x => `- ${x.src === "tu" ? "[Propietario] " : ""}${x.text}`).join("\n")}\n`;
  if (BRAIN.facts.length) s += `\nLO QUE YA SABE LA EMPRESA (decisiones y datos establecidos; respétalos):\n${BRAIN.facts.map(x => "- " + x.text).join("\n")}\n`;
  return s;
}
function statsOf(id) {
  const done = state.tasks.filter(t => t.agentId === id && t.status === "done");
  const scored = done.filter(t => typeof t.score === "number");
  const avg = scored.length ? scored.reduce((n, t) => n + (t.finalScore ?? t.score), 0) / scored.length : null;
  const up = done.filter(t => t.feedback === "up").length, down = done.filter(t => t.feedback === "down").length;
  return { done: done.length, avg, up, down, lessons: memOf(id).length, learned: state.customSkills.filter(s => s.agentId === id && s.learned).length };
}
function evalPrompt(a, t, skill) {
  const body = t.result.length > 14000 ? t.result.slice(0, 7000) + "\n[…]\n" + t.result.slice(-7000) : t.result;
  return `Eres el puesto de ${a.role} de «${state.company}». Acabas de entregar el trabajo de abajo. Evalúalo sin piedad, con el nivel de exigencia de ${(a.refs || []).slice(0, 3).map(r => r[0]).join(", ") || "los mejores de tu especialidad"} y del cliente más exigente.

ENCARGO: ${t.order}${skill ? `\nMÉTODO PEDIDO: ${skill.name}` : ""}

ENTREGA:
${body}

PRINCIPIOS DE TUS REFERENTES CON LOS QUE DEBES MEDIRLA (¿los aplica donde tocaba?):
${canonChecks(a) || "(ninguno)"}

LO QUE YA HABÍAS APRENDIDO:
${memOf(a.id).map(x => "- " + x.text).join("\n") || "(nada todavía)"}

Responde SOLO con JSON:
{"nota": número del 1 al 10 (10 = nivel de referente mundial; 7 = profesional correcto pero mejorable),
 "fallos": ["fallo concreto y corregible", "..."] (máximo 4, vacío si no hay),
 "aprendizajes": ["lección general y reutilizable en futuros encargos, en imperativo, máximo 25 palabras", "..."] (de 0 a 3, solo si son nuevas),
 "hechos": ["dato o decisión explícita sobre la empresa o el proyecto que el resto del equipo debe conocer", "..."] (de 0 a 3)}`;
}
// Autoevaluación tras entregar: nota, revisión automática si no llega al nivel y aprendizaje.
async function selfReview(a, t, skill, signal) {
  t.phase = "review"; state.bubble[a.id] = "Autoevaluando"; bump(t);
  let ev; try { ev = await ask(evalPrompt(a, t, skill), { json: true, quick: true, signal }); } catch (e) { if (e?.code === "cancelled") throw e; return; }
  const nota = Math.max(1, Math.min(10, Number(ev?.nota) || 0)); if (!nota) return;
  t.score = nota; t.faults = (Array.isArray(ev?.fallos) ? ev.fallos : []).map(String).slice(0, 4);
  try { addLessons(a.id, ev?.aprendizajes, "auto", t.order); addFacts(ev?.hechos); } catch (e) { console.warn("No se pudo guardar el aprendizaje", e); }
  if (BRAIN.review && nota < REVIEW_BELOW && t.faults.length && !t.revised) {
    t.phase = "revise"; state.bubble[a.id] = "Mejorando su trabajo"; bump(t);
    const first = t.result;
    try {
      let lastPaint = 0;
      t.result = await ask(`${execPrompt(a, t, skill)}

TU PRIMERA VERSIÓN:
${first.slice(0, 14000)}

Tu autoevaluación le puso ${nota}/10 por estos fallos:
${t.faults.map(f => "- " + f).join("\n")}

Reescribe la entrega completa corrigiendo todo eso y llévala al nivel de los mejores de tu especialidad. Mantén la misma estructura de secciones. No expliques los cambios: entrega solo la versión mejorada.`, { signal, onText: ({ text }) => { t.result = text; const now = Date.now(); if (now - lastPaint > 300) { lastPaint = now; bump(t); } } });
      t.revised = true; t.firstResult = first.slice(0, 20000);
    } catch (e) { if (e?.code === "cancelled") throw e; t.result = first; }
  }
}
async function consolidate(id) {
  const a = byId[id], m = memOf(id); if (m._busy) return; m._busy = true;
  try {
    await acquire();
    try {
      const raw = await ask(`Eres el puesto de ${a.role}. Estas son tus lecciones acumuladas con la experiencia:\n${m.map(x => `- ${x.src === "tu" ? "[Propietario] " : ""}${x.text}`).join("\n")}\n\nConsolídalas en un máximo de 15 principios de trabajo: fusiona las repetidas, quita las contradichas por otras más recientes, conserva siempre el sentido de las marcadas [Propietario]. Responde SOLO con JSON: {"principios": [{"texto": "…", "propietario": true|false}]}`, { json: true, quick: true });
      const list = (Array.isArray(raw?.principios) ? raw.principios : []).filter(x => x?.texto).slice(0, 15);
      if (list.length >= 5) { BRAIN.mem[id] = list.map(x => ({ id: uid(), text: String(x.texto).slice(0, 300), src: x.propietario ? "tu" : "auto", at: Date.now(), hits: 2 })); store.saveBrain(id); }
    } finally { release(); }
  } catch {} finally { delete m._busy; if (state.open === id) refreshDrawerTasks(); }
}
// Cada 5 encargos terminados, el puesto convierte su experiencia en una skill propia.
async function maybeLearnSkill(a) {
  const n = state.tasks.filter(t => t.agentId === a.id && t.status === "done").length;
  if (!n || n % 5) return;
  const recent = state.tasks.filter(t => t.agentId === a.id && t.status === "done").sort((x, y) => y.createdAt - x.createdAt).slice(0, 5);
  try {
    await acquire();
    let raw;
    try {
      raw = await ask(`Eres el puesto de ${a.role} de «${state.company}». Con tu experiencia reciente, crea UNA skill nueva: un método de trabajo propio, mejor que los que ya tienes, para el tipo de encargo que más te piden en esta empresa.

TUS ÚLTIMOS ENCARGOS:
${recent.map(t => `- ${t.order}${typeof t.score === "number" ? ` (autoevaluación ${t.score}/10)` : ""}${t.feedback ? ` (propietario: ${t.feedback === "up" ? "útil" : "mejorable"})` : ""}`).join("\n")}

LO QUE HAS APRENDIDO:
${memOf(a.id).map(x => "- " + x.text).join("\n") || "(nada)"}

SKILLS QUE YA TIENES: ${skillsOf(a.id).map(s => s.name).join(", ")}

Responde SOLO con JSON: {"crear": true|false, "nombre": "máximo 5 palabras", "desc": "para qué sirve en una frase", "metodo": "instrucciones paso a paso, concretas, de 80 a 160 palabras"}. Si no aporta nada nuevo, "crear": false.`, { json: true, quick: true });
    } finally { release(); }
    if (!raw?.crear || !raw.nombre || !raw.metodo || skillsOf(a.id).some(s => similar(s.name, raw.nombre))) return;
    const learned = state.customSkills.filter(s => s.agentId === a.id && s.learned).sort((x, y) => x.createdAt - y.createdAt);
    if (learned.length >= LEARNED_MAX) { const old = learned[0]; state.customSkills = state.customSkills.filter(s => s.id !== old.id); store.deleteSkill(old.id); }
    const s = { id: "c." + uid(), agentId: a.id, name: String(raw.nombre).slice(0, 60), desc: String(raw.desc || raw.nombre).slice(0, 160), method: String(raw.metodo).slice(0, 3000), learned: true, src: "su propia experiencia", createdAt: Date.now() };
    state.customSkills.push(s); await store.saveSkill(s); paintCounts();
    toast(`${a.name} ha creado una skill nueva: «${s.name}».`);
  } catch {}
}
async function giveFeedback(t, kind, comment) {
  const a = byId[t.agentId]; t.feedback = kind; t.v++; bump(t); store.saveTask(t);
  if (kind === "down") {
    const c = comment.trim();
    if (c) addLessons(a.id, [`En encargos como «${t.order.slice(0, 60)}», el propietario pidió: ${c}`], "tu", t.order);
    runTask({ agentId: a.id, order: t.order.replace(/ \(v\d+\)$/, "") + ` (v${(t.version || 1) + 1})`, version: (t.version || 1) + 1, from: "Tú", mode: "rapido", skillId: t.skillId,
      extra: `Tu entrega anterior:\n${t.result.slice(0, 12000)}\n\nEl propietario la ha marcado como mejorable${c ? `: «${c}»` : "."} Entrega la versión mejorada completa, corrigiendo exactamente eso.` });
    toast(c ? "Anotado. Lo tendrá en cuenta siempre y ya está rehaciéndolo." : "Anotado. Ya está rehaciéndolo.");
    return;
  }
  toast("Anotado. Repetirá lo que ha funcionado.");
  try {
    await acquire();
    try {
      const raw = await ask(`Eres el puesto de ${a.role}. El propietario ha valorado como muy útil esta entrega tuya:\nENCARGO: ${t.order}\nENTREGA:\n${t.result.slice(0, 8000)}\n\nExtrae de 1 a 2 lecciones concretas sobre qué hiciste bien y debes repetir siempre. Responde SOLO con JSON: {"aprendizajes": ["…"]}`, { json: true, quick: true });
      addLessons(a.id, raw?.aprendizajes, "tu", t.order);
    } finally { release(); }
  } catch {}
  if (state.open === a.id) openAgent(a.id);
}
// Trabajo autónomo continuo: Dirección lanza rondas solas mientras la app está abierta.
// La primera ronda espera 5 minutos: si se abre la oficina un momento y se cierra, no deja encargos cortados.
const AUTO_WARMUP = 5 * 60e3;
function autoTick() {
  const au = BRAIN.auto;
  if (TALLER.on && !au.on && aiReady() && Date.now() >= (TALLER.next ||= Date.now() + 120e3)) { TALLER.next = Date.now() + 60 * 60e3; runTallerRound(); }
  if (!au.on || state.run || !aiReady() || au.rounds >= AUTO_MAX_ROUNDS) return paintAuto();
  // Con la oficina en segundo plano (otra app, pantalla bloqueada) el navegador la congela y lo que empiece se corta.
  if (document.hidden) { au.next = Math.max(au.next || 0, Date.now() + AUTO_WARMUP); return; }
  if (!au.next) au.next = Date.now() + AUTO_WARMUP;
  if (Date.now() >= au.next) { au.rounds++; au.next = Date.now() + au.every * 60e3; if (TALLER.on && au.rounds % 2 === 0) runTallerRound(); else runCompany("", "auto"); }
  paintAuto();
}
function paintAuto() {
  const el = $("#autoLine"); if (!el) return;
  const au = BRAIN.auto;
  if (!au.on) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = au.rounds >= AUTO_MAX_ROUNDS ? `Modo autónomo en pausa: ${AUTO_MAX_ROUNDS} rondas hechas en esta sesión` : state.run ? "Modo autónomo: el equipo está trabajando" : `Modo autónomo: próxima ronda a las ${new Date(au.next || Date.now() + 60e3).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------- Pintado ---------- */
let paintQueued = false;
const changed = new Set();
function bump(t) { t.v = (t.v || 0) + 1; changed.add(t.id); schedule(); if (t.status === "work") saveSoon(t); }
// Mientras trabaja, el encargo se guarda como mucho cada 8 s: si se cierra la oficina, queda «Interrumpido» con lo que llevaba.
const saveTimers = new Map();
function saveSoon(t) { if (saveTimers.has(t.id)) return; saveTimers.set(t.id, setTimeout(() => { saveTimers.delete(t.id); if (state.tasks.includes(t) && t.status === "work") store.saveTask(t); }, saveTimers.size ? 8000 : 1500)); }
function schedule() { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintAll(); }); }
function paintAll() {
  paintCounts(); paintTeam(); paintLive(); paintRun();
  if (state.view === "encargos") paintTasks();
  if (state.view === "entregables") paintDeliverables();
  if (state.open) refreshDrawerTasks();
  refreshReader();
  changed.clear();
}
function paintCounts() {
  const work = AGENTS.filter(a => state.status[a.id] !== "idle").length;
  $("#sIdle").textContent = AGENTS.length - work; $("#sWork").textContent = work;
  $("#nWork").textContent = work || "";
  $("#nTasks").textContent = state.tasks.filter(t => !t.archived).length || "";
  $("#nDone").textContent = state.tasks.filter(t => t.status === "done" && !t.archived).length || "";
  $("#nSkills").textContent = allSkills().length;
  $("#nCtx").textContent = ctxFiles(CTX.items) || "";
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
  if (t.status !== "work") return { pct: 100, ind: false, txt: statusLabel(t) };
  if (t.phase === "cola") return { pct: 0, ind: false, txt: "En cola" };
  if (t.phase === "cloud") return { pct: 50, ind: true, txt: t.cloud?.state === "sending" ? "Enviando a la nube" : "En la nube" };
  if (t.phase === "plan") return { pct: 8, ind: true, txt: "Planificando" };
  if (t.phase === "review") return { pct: 92, ind: true, txt: "Autoevaluando" };
  if (t.phase === "revise") return { pct: 95, ind: true, txt: `Mejorando (se puso un ${t.score})` };
  if (t.steps.length) { const k = Math.max(1, t.step || 1); return { pct: Math.round((k - (t.step >= t.steps.length ? 0 : .5)) / t.steps.length * 100), ind: false, txt: `Paso ${k} de ${t.steps.length}`, step: t.steps[k - 1] || "" }; }
  return { pct: 40, ind: true, txt: t.result ? "Escribiendo" : "Pensando" };
}
function statusLabel(t) { return t.status === "work" ? progressOf(t).txt : t.status === "done" ? "Terminado" : t.stopped ? "Detenido" : t.interrupted ? "Interrumpido" : "Error"; }
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
  const recent = state.tasks.filter(t => t.status !== "work" && !t.archived).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  $("#recentList").innerHTML = recent.length ? recent.map(jobHTML).join("") : `<p class="empty">Aquí verás lo último que se ha entregado.</p>`;
}
function paintRun() {
  const box = $("#runBox"), r = (state.run?.project === PROJ.cur ? state.run : null) || state.runs.filter(x => Date.now() - x.createdAt < 36e5).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  const lbl = { pend: "Pendiente", work: "En curso", done: "Hecho", error: "Error" };
  box.innerHTML = `<h3 class="h3">${r.kind === "auto" ? "Ronda autónoma" : "Plan de Dirección"} <span class="st ${r.status}">${lbl[r.status]}</span></h3>
    <p>${esc(r.resumen)}</p>
    ${(r.fases || []).map(f => `<div class="ph">${esc(f.nombre)}</div><ol>${f.tareas.map(x => `<li><b>${esc(byId[x.agente]?.name)}</b>: ${esc(x.tarea)} <span class="st ${x.estado}">${lbl[x.estado] ? "· " + lbl[x.estado].toLowerCase() : ""}</span></li>`).join("")}</ol>`).join("")}
    ${r.reportId ? `<div class="row" style="justify-content:flex-start;margin-top:12px"><button class="btn sm" type="button" data-task="${r.reportId}">Leer el informe</button></div>` : ""}`;
}
function filterChips(el, key, opts) {
  el.innerHTML = opts.map(([v, l]) => `<button class="f" type="button" data-f="${key}" data-v="${v}" aria-pressed="${state[key] === v}">${esc(l)}</button>`).join("");
}
/* Exportar entregables: todo, por sala o por puesto, en un solo Markdown con índice. */
function exportGroups() {
  const done = state.tasks.filter(t => t.status === "done");
  const n = f => done.filter(f).length;
  return [["todos", `Todo (${done.length})`, () => true],
    ...ROOMS.map(r => ["room:" + r.id, `${r.name} (${n(t => byId[t.agentId].room === r.id)})`, t => byId[t.agentId].room === r.id]),
    ...AGENTS.map(a => ["agent:" + a.id, `${a.name} (${n(t => t.agentId === a.id)})`, t => t.agentId === a.id])];
}
function paintExport() {
  const sel = $("#expSel"); if (!sel) return;
  const cur = sel.value || "todos", g = exportGroups();
  sel.innerHTML = `<option value="todos">${esc(g[0][1])}</option><optgroup label="Por sala">${g.filter(x => x[0].startsWith("room:")).map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join("")}</optgroup><optgroup label="Por puesto">${g.filter(x => x[0].startsWith("agent:")).map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join("")}</optgroup>`;
  sel.value = cur;
  $("#expBtn").disabled = !state.tasks.some(t => t.status === "done");
}
function taskMarkdown(t) {
  const a = byId[t.agentId], skills = [t.skillId, ...(t.autoSkills || [])].filter(Boolean).map(skillById).filter(Boolean).map(s => s.name);
  const meta = [`Puesto: ${a.name} (${a.role})`, `Sala: ${ROOMS.find(r => r.id === a.room)?.name || a.room}`, `Fecha: ${new Date(t.createdAt).toLocaleString("es-ES")}`, `Pedido por: ${t.from}`,
    skills.length ? `Métodos: ${skills.join(", ")}` : "", typeof t.score === "number" ? `Autoevaluación: ${t.score}/10${t.revised ? " (revisada y mejorada)" : ""}` : "",
    t.feedback === "up" ? "Tu valoración: útil" : t.feedback === "down" ? "Tu valoración: mejorable" : ""].filter(Boolean);
  return `## ${t.order}\n\n${meta.map(m => "- " + m).join("\n")}\n\n${t.result}\n`;
}
function paintSkills() {
  filterChips($("#skillFilters"), "fSkills", [["todos", "Todas"], ["custom", "Creadas por ti"], ...ROOMS.map(r => [r.id, r.name])]);
  const f = state.fSkills;
  const list = allSkills().filter(s => f === "todos" || (f === "custom" ? s.custom : byId[s.agentId].room === f));
  const groups = AGENTS.map(a => [a, list.filter(s => s.agentId === a.id)]).filter(([, l]) => l.length);
  $("#skillGrid").innerHTML = groups.map(([a, l]) => `<section class="skgroup"><h2><img class="px" src="${P(a)}" alt="">${esc(a.name)} <span>${esc(a.role)}</span></h2>
    ${l.map(s => `<article class="sk"><h4>${esc(s.name)}${s.custom ? "<em>tuya</em>" : ""}</h4>
      <div><p>${esc(s.desc)}${s.src ? ` <span class="src">Basada en ${esc(s.src)}</span>` : ""}</p><details><summary>Cómo lo hace</summary><p style="margin-top:6px">${esc(s.method)}</p></details></div>
      <div class="acts"><button class="btn ghost sm" type="button" data-use="${s.id}">Usar</button>${s.custom ? `<button class="btn ghost sm" type="button" data-delskill="${s.id}">Borrar</button>` : ""}</div></article>`).join("")}</section>`).join("")
    || `<p class="empty">Aún no has creado skills propias.</p>`;
}

function paintContext() {
  const box = $("#ctxList"); if (!box) return;
  const srcs = ctxSources(), act = ctxActive();
  $("#ctxSummary").textContent = CTX.items.length ? `${ctxFiles(act)} de ${ctxFiles(CTX.items)} archivos activos · ${fmtSize(ctxChars(act))} caracteres` : "";
  $("#ctxBusy").textContent = CTX.busy; $("#ctxBusy").hidden = !CTX.busy;
  const rep = CTX.report && CTX.items.some(x => x.source === CTX.report.source) ? CTX.report : null;
  $("#ctxReport").hidden = !rep;
  if (rep) $("#ctxReport").innerHTML = `<b>De «${esc(rep.source)}» faltan ${rep.missing.length} de ${rep.files} archivos</b> porque ${esc(rep.why)}. Han entrado primero CLAUDE.md, README, la configuración y el código; lo que falta es lo menos importante. Puedes desactivar o quitar otros contextos y volver a subir la carpeta.<details><summary>Ver los que faltan</summary><ul class="ctxfiles">${rep.missing.slice(0, 400).map(n => `<li><span class="num">${esc(n)}</span></li>`).join("")}</ul></details>`;
  const pf = $("#ctxProject");
  pf.hidden = !(window.claude?.use);
  pf.querySelector("input").checked = CTX.projectFiles;
  box.innerHTML = srcs.length ? srcs.map(g => {
    const on = g.items.filter(x => x.active).length, kind = { github: "Repositorio de GitHub", carpeta: "Carpeta", archivos: "Archivos", texto: "Texto" }[g.kind] || "Contexto";
    const one = g.items.length === 1;
    return `<section class="ctxg"><div class="ctxg-h">
        <label class="chk"><input type="checkbox" data-ctxsrc="${esc(g.source)}" ${on ? "checked" : ""}><span><b>${esc(g.source)}</b><span>${kind} · ${ctxFiles(g.items)} ${ctxFiles(g.items) === 1 ? "archivo" : "archivos"} · ${fmtSize(ctxChars(g.items))} · ${fmtDate(g.createdAt)}</span></span></label>
        <button class="btn ghost sm" type="button" data-ctxdel="${esc(g.source)}">Quitar</button></div>
      ${one ? `<p class="ctx-prev">${esc(g.items[0].text.slice(0, 220))}${g.items[0].text.length > 220 ? "…" : ""}</p>` : `<details><summary>Ver archivos</summary><ul class="ctxfiles">${g.items.map(x => `<li><label class="chk"><input type="checkbox" data-ctxone="${x.id}" ${x.active ? "checked" : ""}><span class="num">${esc(x.name)}</span></label><span class="num">${fmtSize(x.text.length)}</span></li>`).join("")}</ul></details>`}
    </section>`;
  }).join("") : `<p class="empty">Todavía no hay contexto. Sube tu código, documentos o datos y el equipo trabajará sobre ellos.</p>`;
}

/* ---------- Sala ---------- */
let scene = null;
function paintRooms() {
  $("#roomTabs").innerHTML = ROOMS.map(r => `<button class="rt" type="button" data-room="${r.id}" aria-pressed="${state.room === r.id}">${esc(r.name)} <span class="n" data-room-n="${r.id}"></span></button>`).join("");
  $("#stageName").textContent = roomById[state.room].name;
  $("#btnTaller").hidden = state.room !== "taller";
  paintCounts();
}
function centerStage() { const w = $(".canvaswrap"); if (w && w.scrollWidth > w.clientWidth) w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2; }
function setRoom(id) { state.room = id; scene?.setRoom(roomById[id]); paintRooms(); paintTeam(); }

/* ---------- Navegación ---------- */
const VIEWS = ["oficina", "encargos", "entregables", "contexto", "skills"];
function go(view) {
  if (!VIEWS.includes(view)) view = "oficina";
  state.view = view;
  VIEWS.forEach(v => { $("#v-" + v).hidden = v !== view; });
  document.querySelectorAll(".tab[data-view]").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === view)));
  if (view === "oficina") scene?.start(); else scene?.stop();
  if (view === "encargos") paintTasks();
  if (view === "skills") paintSkills();
  if (view === "entregables") paintDeliverables();
  if (view === "contexto") paintContext();
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
  const na = ctxFiles(ctxActive());
  const srcs = [...new Set(ctxActive().map(x => x.source))], srcTxt = srcs.length > 2 ? `${srcs.slice(0, 2).join(", ")} y ${srcs.length - 2} más` : srcs.join(", ");
  $("#ctxSlot").innerHTML = na ? `<button type="button" class="attach" data-go="contexto" title="${esc(srcs.join(", "))}">Contexto: ${esc(srcTxt)} (${na} ${na === 1 ? "archivo" : "archivos"})</button>` : `<button type="button" class="attach" data-go="contexto">Sin contexto: añadir tu app</button>`;
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
  const tasks = state.tasks.filter(t => t.agentId === id && !t.archived).sort((x, y) => y.createdAt - x.createdAt);
  $("#drawer").innerHTML = `
    <div class="d-head"><img class="px" src="${P(a)}" alt="">
      <div style="min-width:0"><h2 id="dName">${esc(a.name)}</h2><p>${esc(a.role)} · ${esc(r.name)}</p>
      <p class="d-status" id="dStatus"></p></div>
      <button class="btn ghost sm x" type="button" id="dClose">Cerrar</button></div>
    <div class="d-body">
      <p class="d-bio">${esc(a.bio)} <span>Trabaja con ${esc(a.tools.join(", "))}.</span></p>
      ${brainHTML(a)}
      ${a.refs?.length ? `<div><p class="lbl">Referentes que aplica</p><ul class="refs">${a.refs.map(([n, i]) => { const c = CANON[n]; return c ? `<li><details><summary><b>${esc(n)}</b> ${esc(i)}</summary><p class="note">${esc(c[0])}</p><ul>${c[1].map(p => `<li>${esc(p)}</li>`).join("")}</ul></details></li>` : `<li><b>${esc(n)}</b> ${esc(i)}</li>`; }).join("")}</ul></div>` : ""}
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
  setTimeout(() => $("#dClose")?.focus(), 0);
}
function brainHTML(a) {
  const st = statsOf(a.id), mem = memOf(a.id), learned = state.customSkills.filter(s => s.agentId === a.id && s.learned);
  const facts = [st.done ? `${st.done} ${st.done === 1 ? "encargo" : "encargos"}` : "Sin experiencia todavía", st.avg != null ? `nota media ${st.avg.toFixed(1).replace(".", ",")}` : "", st.up ? `${st.up} útiles` : "", st.lessons ? `${st.lessons} aprendizajes` : "", st.learned ? `${st.learned} skills propias` : ""].filter(Boolean).join(" · ");
  return `<div><p class="lbl">Experiencia</p><p class="d-exp">${esc(facts)}</p>
    ${mem.length ? `<details class="mem"><summary>Lo que ha aprendido (${mem.length})</summary><ul class="refs">${mem.map(x => `<li><span>${x.src === "tu" ? "<b>Tuyo</b> " : ""}${esc(x.text)}</span><button class="linkbtn" type="button" data-memdel="${x.id}" aria-label="Olvidar">Olvidar</button></li>`).join("")}</ul></details>` : `<p class="note">Aprende de cada encargo: se autoevalúa, guarda lecciones y recuerda tus valoraciones.</p>`}
    ${learned.length ? `<p class="note" style="margin-top:6px">Skills creadas por su experiencia: ${learned.map(s => esc(s.name)).join(", ")}</p>` : ""}</div>`;
}
function paintDStatus() { const el = $("#dStatus"); if (!el || !state.open) return; el.innerHTML = `${statusDot(state.open)} ${esc(statusText(state.open))}`; }
function drawerTaskHTML(t) {
  const p = progressOf(t), k = kindOf(t), sum = t.status === "done" ? summaryOf(t, 2) : [];
  return `<article class="dtask" data-tid="${t.id}" data-v="${t.v}">
    <button class="dt-main" type="button" data-task="${t.id}"><span class="dt-k">${esc(k.label)} · ${fmtDate(t.createdAt)}</span><span class="dt-t">${esc(t.order)}</span>
      ${sum.length ? `<span class="dt-x">${esc(sum.join(" · "))}</span>` : ""}</button>
    <span class="st ${t.status}">${esc(statusLabel(t))}</span>
    ${t.status === "work" ? `<div class="bar ${p.ind ? "ind" : ""}"><i style="width:${p.pct}%"></i></div>` : ""}</article>`;
}
function refreshDrawerTasks() {
  paintDStatus();
  const box = $("#dTasks"); if (!box) return;
  const tasks = state.tasks.filter(t => t.agentId === state.open && !t.archived).sort((x, y) => y.createdAt - x.createdAt);
  const ids = [...box.querySelectorAll("[data-tid]")].map(e => e.dataset.tid);
  if (ids.join() !== tasks.map(t => t.id).join()) { box.innerHTML = tasks.length ? tasks.map(drawerTaskHTML).join("") : `<p class="empty">Todavía no le has encargado nada.</p>`; return; }
  for (const t of tasks) if (changed.has(t.id)) { const el = box.querySelector(`[data-tid="${t.id}"]`); if (el && el.dataset.v !== String(t.v)) el.outerHTML = drawerTaskHTML(t); }
}
function closeAgent() { state.open = null; scene?.select(null); $("#drawer").hidden = true; $("#scrim").hidden = true; }
document.addEventListener("submit", e => {
  if (e.target.dataset.fbform) { e.preventDefault(); const t = state.tasks.find(x => x.id === e.target.dataset.fbform); if (t) giveFeedback(t, "down", e.target.querySelector("input").value); return; }
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
  if ((b = el("[data-task]"))) return openReader(b.dataset.task);
  if (!el("details.menu")) document.querySelectorAll("details.menu[open]").forEach(d => d.open = false);
  if ((b = el("[data-proj], [data-projnew], #projPop [data-settings]"))) b.closest("details")?.removeAttribute("open");
  if ((b = el("[data-proj]"))) return projSwitch(b.dataset.proj);
  if (el("[data-projnew]")) return projNew();
  if (el("#projDel")) { e.preventDefault(); if (PROJ.del === PROJ.cur) { $("#settings").close("cancel"); await projDelete(PROJ.cur); toast("Proyecto borrado."); } else { PROJ.del = PROJ.cur; paintProjDel(); } return; }
  if (el("#rBack")) return closeReader();
  if ((b = el("[data-stop]"))) { const t = state.tasks.find(x => x.id === b.dataset.stop); if (t) { stopTask(t); toast("Detenido."); } return; }
  if ((b = el("[data-archive]"))) { const t = state.tasks.find(x => x.id === b.dataset.archive); if (t) { const on = !t.archived; await archiveTasks([t.id], on); toast(on ? "Archivado. Lo tienes en «Archivados»." : "Vuelve a estar en las listas."); paintAll(); if (READER.id === t.id) paintReader(); } return; }
  if ((b = el("[data-export]"))) { const t = state.tasks.find(x => x.id === b.dataset.eid); b.closest("details")?.removeAttribute("open"); if (t) exportTasks([t], b.dataset.export); return; }
  if ((b = el("[data-apply]"))) { const t = state.tasks.find(x => x.id === b.dataset.apply); if (t) openApply(t); return; }
  if ((b = el("[data-execcheck]"))) { const t = state.tasks.find(x => x.id === b.dataset.execcheck); if (t) ccCheck(t, b.dataset.sess); return; }
  if ((b = el("[data-sketch]"))) { const t = state.tasks.find(x => x.id === READER.id); if (t) openLive(t, READER.blocks[+b.dataset.sketch]); return; }
  if ((b = el("[data-sketchcode]"))) { const fig = b.closest("figure"), src = READER.blocks[+b.dataset.sketchcode]; let pre = fig.querySelector("pre"); if (pre) { pre.remove(); b.textContent = "Código"; } else { pre = document.createElement("pre"); pre.className = "code"; pre.textContent = src; fig.appendChild(pre); b.textContent = "Ocultar código"; } return; }
  if ((b = el("[data-copycode]"))) { try { await navigator.clipboard.writeText(b.parentElement.querySelector("code")?.textContent || ""); b.textContent = "Copiado"; setTimeout(() => b.textContent = "Copiar", 1500); } catch { toast("No se pudo copiar."); } return; }
  if ((b = el("[data-next]"))) { const t = state.tasks.find(x => x.id === b.dataset.next), n = docParts(t).next; runTask({ agentId: t.agentId, order: n, from: "Tú", mode: "pro", extra: `Viene de tu entrega «${t.order}»:\n${finalPart(t.result).slice(0, 10000)}` }); toast(`Encargado a ${byId[t.agentId].name}.`); return; }
  if ((b = el("[data-toc]"))) { e.preventDefault(); $("#" + b.dataset.toc)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if ((b = el("[data-pick]"))) { const id = b.dataset.pick; if (b.checked) state.sel.add(id); else state.sel.delete(id); return paintTasks(); }
  if (el("#pickAll")) { const on = $("#pickAll").checked; document.querySelectorAll("[data-pick]").forEach(x => on ? state.sel.add(x.dataset.pick) : state.sel.delete(x.dataset.pick)); return paintTasks(); }
  if ((b = el("[data-bulk]"))) {
    const ids = [...state.sel], k = b.dataset.bulk;
    if (k === "none") { state.sel.clear(); return paintTasks(); }
    if (k === "delete") { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = `¿Borrar ${ids.length}?`; return; } await deleteTasks(ids); toast(`${ids.length} borrados.`); return; }
    if (k === "retry") { const l = state.tasks.filter(t => state.sel.has(t.id) && t.status === "error"); state.sel.clear(); await retryTasks(l); toast(l.length ? `${l.length} de nuevo en marcha.` : "Ninguno de los seleccionados tenía error."); return; }
    if (k === "export") return exportTasks(state.tasks.filter(t => state.sel.has(t.id) && t.status === "done").sort((a, b) => a.createdAt - b.createdAt), "pdf", "la selección");
    await archiveTasks(ids, k === "archive"); state.sel.clear(); toast(k === "archive" ? "Archivados." : "Desarchivados."); return paintAll();
  }
  if ((b = el("[data-clean]"))) {
    const c = cleanupCounts(), k = b.dataset.clean; b.closest("details")?.removeAttribute("open");
    if (k === "resume") { await retryTasks(c.cut); toast(`${c.cut.length} encargos de nuevo en marcha.`); return; }
    if (k === "errors") { await deleteTasks(c.errs.map(t => t.id)); toast(`${c.errs.length} encargos con error borrados.`); }
    if (k === "old") { await archiveTasks(c.old.map(t => t.id)); toast(`${c.old.length} archivados.`); paintAll(); }
    if (k === "archived") { if (b.dataset.confirm !== "1") { b.closest("details").open = true; b.dataset.confirm = "1"; b.querySelector("b").textContent = `¿Borrar ${c.archived.length} para siempre?`; return; } await deleteTasks(c.archived.map(t => t.id)); toast("Archivados borrados."); }
    return;
  }
  if (el("#btnTaller")) return runTallerRound(true);
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
  if (el("#expBtn")) return exportDeliverables();
  if ((b = el("[data-live]"))) return openLive(state.tasks.find(x => x.id === b.dataset.live));
  if ((b = el("[data-dev]"))) { $("#liveFrame").dataset.dev = b.dataset.dev; document.querySelectorAll("[data-dev]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); return; }
  if (el("#liveDl")) return downloadLive();
  if (el("#liveMp4")) return recordLive();
  if ((b = el("[data-improve]"))) {
    const t = state.tasks.find(x => x.id === b.dataset.improve);
    runTask({ agentId: t.agentId, order: t.order.replace(/^(Revisar y mejorar|Mejorar): /, "") + ` (v${(t.version || 1) + 1})`.replace(/ \(v\d+\) \(v/, " (v"), version: (t.version || 1) + 1, from: "Tú", mode: "rapido", skillId: t.skillId,
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
  if ((b = el("[data-fb]"))) {
    const t = state.tasks.find(x => x.id === b.dataset.fbid); if (!t) return;
    if (b.dataset.fb === "up") return giveFeedback(t, "up", "");
    const f = $(`[data-fbform="${t.id}"]`); if (f) { f.hidden = false; f.querySelector("input").focus(); } return;
  }
  if ((b = el("[data-memdel]"))) { const id = state.open, m = memOf(id); BRAIN.mem[id] = m.filter(x => x.id !== b.dataset.memdel); store.saveBrain(id); b.closest("li").remove(); return; }
  if ((b = el("[data-ctxdel]"))) {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro?"; return; }
    const gone = CTX.items.filter(x => x.source === b.dataset.ctxdel); CTX.items = CTX.items.filter(x => x.source !== b.dataset.ctxdel); CTX.ver++;
    paintContext(); paintCounts(); paintComposer(); for (const x of gone) await store.deleteCtx(x.id); return;
  }
  if (el("#ctxPasteBtn")) { $("#pName").value = ""; $("#pText").value = ""; $("#pasteDlg").showModal(); return; }
  if (el("#ctxFilesBtn")) return $("#ctxFiles").click();
  if (el("#ctxDirBtn")) return $("#ctxDir").click();
  if ((b = el("[data-retry]"))) { const t = state.tasks.find(x => x.id === b.dataset.retry); if (!t) return; await retryTasks([t], READER.id === t.id); toast("De nuevo en marcha."); return; }
  if ((b = el("[data-del]"))) {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "¿Seguro?"; return; }
    await deleteTasks([b.dataset.del]); toast("Borrado."); return;
  }
});
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (document.querySelector("dialog[open]")) return; if (document.querySelector("details.menu[open]")) { document.querySelectorAll("details.menu[open]").forEach(d => d.open = false); return; } if (READER.id) closeReader(); else if (state.open) closeAgent(); });
document.addEventListener("input", e => {
  if (e.target.id === "taskQ") { state.q = e.target.value; paintTasks.focus = true; paintTasks(); }
  if (e.target.id === "delQ") { state.qDel = e.target.value; paintDeliverables(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.ctxsrc != null) { const list = CTX.items.filter(x => x.source === t.dataset.ctxsrc); list.forEach(x => x.active = t.checked); CTX.ver++; paintContext(); paintComposer(); for (const x of list) await store.saveCtx(x).catch(() => {}); }
  else if (t.dataset.ctxone) { const x = CTX.items.find(y => y.id === t.dataset.ctxone); if (x) { x.active = t.checked; CTX.ver++; paintContext(); paintComposer(); await store.saveCtx(x).catch(() => {}); } }
  else if (t.id === "ctxFiles" || t.id === "ctxDir") { await importFiles(t.files, t.id === "ctxDir"); t.value = ""; }
  else if (t.id === "ctxProjectChk") { if (t.checked) await enableProjectFiles(true); else { CTX.projectFiles = false; paintContext(); } store.saveMeta(); }
});
$("#ctxGh").addEventListener("submit", e => { e.preventDefault(); const u = $("#ghUrl").value; if (u.trim()) { importGitHub(u); $("#ghUrl").value = ""; } });
$("#pasteDlg").addEventListener("close", () => {
  if ($("#pasteDlg").returnValue !== "save") return;
  const text = $("#pText").value.trim(); if (!text) return;
  const name = $("#pName").value.trim() || text.split("\n")[0].slice(0, 60);
  addCtx([{ name, text }], name, "texto");
});

/* Vista en vivo de composiciones HTML (HyperFrames, prototipos de interfaz y animaciones). */
function liveHTML(text) {
  const src = text || "";
  const blocks = [...src.matchAll(/```html[^\n]*\n([\s\S]*?)```/gi)].map(m => m[1]);
  // Un bloque sin cerrar (respuesta cortada) también se puede ver: se toma hasta el final.
  const open = /```html[^\n]*\n([\s\S]*)$/i.exec(src.replace(/```html[^\n]*\n[\s\S]*?```/gi, ""));
  if (open) blocks.push(open[1]);
  return blocks.sort((x, y) => y.length - x.length)[0] || "";
}
// Se ejecuta dentro del iframe aislado: reproduce la composición y, si se le pide, la graba a MP4 fotograma a fotograma.
function livePlayer() {
  var stage = document.querySelector("[data-composition-id]"); if (!stage) return;
  var W = (+stage.dataset.width || 1920) & ~1, H = (+stage.dataset.height || 1080) & ~1;
  document.documentElement.style.cssText = "margin:0;height:100%;background:#111;overflow:hidden";
  document.body.style.cssText = "margin:0;height:100%;overflow:hidden";
  stage.style.width = W + "px"; stage.style.height = H + "px"; stage.style.position = "absolute"; stage.style.left = "50%"; stage.style.top = "50%"; stage.style.overflow = "hidden";
  function fit() { var k = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = "translate(-50%,-50%) scale(" + k + ")"; }
  fit(); addEventListener("resize", fit);
  var clips = [].slice.call(stage.querySelectorAll("[data-start]")).filter(function (e) { return e !== stage; });
  var end = clips.reduce(function (m, e) { return Math.max(m, (+e.dataset.start || 0) + (+e.dataset.duration || 0)); }, 0);
  function duration() { var tls = window.__timelines || {}, d = end; Object.keys(tls).forEach(function (k) { d = Math.max(d, tls[k].duration()); }); return Math.min(d || 5, 180); }
  function render(t, media) {
    var tls = window.__timelines || {};
    clips.forEach(function (e) {
      var s = +e.dataset.start || 0, d = +e.dataset.duration || 1e9, on = t >= s && t < s + d; e.style.visibility = on ? "" : "hidden";
      if (media && (e.tagName === "VIDEO" || e.tagName === "AUDIO")) { if (on && e.paused) { e.currentTime = t - s; e.play && e.play().catch(function () {}); } if (!on && !e.paused) e.pause(); }
    });
    Object.keys(tls).forEach(function (k) { tls[k].seek(t, false); });
  }
  var t0 = performance.now(), recording = false;
  function frame(now) { if (!recording) render(((now - t0) / 1000) % duration(), true); requestAnimationFrame(frame); }
  addEventListener("load", function () { requestAnimationFrame(frame); parent.postMessage({ live: "ready", dur: duration() }, "*"); });
  function say(m) { parent.postMessage(Object.assign({ live: "rec" }, m), "*"); }
  function loadMuxer() {
    return window.Mp4Muxer ? Promise.resolve() : new Promise(function (ok, ko) {
      var s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js"; s.onload = ok; s.onerror = function () { ko(new Error("No se pudo cargar el codificador de vídeo.")); }; document.head.appendChild(s);
    });
  }
  async function record(fps) {
    if (!window.VideoEncoder || !window.VideoFrame) throw new Error("Este navegador no puede crear vídeo. Usa Chrome o Safari actualizados.");
    await loadMuxer();
    var codec = null, list = ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.640033"];
    for (var i = 0; i < list.length && !codec; i++) { var c = { codec: list[i], width: W, height: H, bitrate: 8e6, framerate: fps }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) codec = c; } catch (e) {} }
    if (!codec) throw new Error("Este navegador no puede codificar MP4 a " + W + "x" + H + ".");
    var target = new Mp4Muxer.ArrayBufferTarget(), mux = new Mp4Muxer.Muxer({ target: target, video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
    var fail = null, enc = new VideoEncoder({ output: function (ch, meta) { mux.addVideoChunk(ch, meta); }, error: function (e) { fail = e; } });
    enc.configure(codec);
    var css = [].map.call(document.querySelectorAll("style"), function (s) { return s.textContent; }).join("\n");
    var canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; var ctx = canvas.getContext("2d");
    var bg = getComputedStyle(stage).backgroundColor || "#000", total = Math.round(duration() * fps), ser = new XMLSerializer();
    recording = true;
    try {
      for (var f = 0; f < total; f++) {
        if (fail) throw fail;
        render(f / fps, false);
        var clone = stage.cloneNode(true); clone.querySelectorAll("script").forEach(function (s) { s.remove(); });
        clone.style.transform = "none"; clone.style.left = "0"; clone.style.top = "0"; clone.style.position = "relative";
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:' + W + "px;height:" + H + 'px"><style>' + css.replace(/<\/style/gi, "") + "</style>" + ser.serializeToString(clone) + "</div></foreignObject></svg>";
        var img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode();
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
        var vf = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
        while (enc.encodeQueueSize > 8) await new Promise(function (r) { setTimeout(r, 5); });
        if (f % 5 === 0) say({ p: f / total });
      }
      await enc.flush(); mux.finalize();
      var buf = target.buffer; parent.postMessage({ live: "rec", done: true, buf: buf }, "*", [buf]);
    } finally { recording = false; t0 = performance.now(); try { enc.close(); } catch (e) {} }
  }
  addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.live !== "record") return;
    record(e.data.fps || 30).catch(function (err) { say({ error: err && err.name === "SecurityError" ? "Este navegador no deja grabar la vista en vivo. Abre la oficina en Chrome para descargar el MP4, o descarga el HTML y usa «npx hyperframes render»." : "No se pudo crear el MP4: " + String(err && err.message || err) }); });
  });
}
const LIVE_PLAYER = `<script>(${livePlayer.toString()})();<\/script>`;
let liveTask = null, liveBusy = false;
function liveName(t, ext) { return `${byId[t.agentId].name}-${t.order.slice(0, 40)}`.replace(/[^\p{L}\p{N}]+/gu, "-") + ext; }
function openLive(t, block) {
  const html = block || liveHTML(t?.result); if (!html) return;
  liveTask = t; liveTask._block = html; liveBusy = false;
  const doc = /<html[\s>]/i.test(html) ? (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, LIVE_PLAYER + "</body>") : html + LIVE_PLAYER)
    : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}${LIVE_PLAYER}</body></html>`;
  const isComp = /data-composition-id/.test(html);
  $("#liveTitle").textContent = t.order;
  $("#liveMp4").hidden = !isComp; $("#liveMp4").disabled = false; $("#liveMp4").textContent = "Descargar MP4";
  $("#liveDev").hidden = isComp; $("#liveFrame").dataset.dev = isComp ? "" : "desk"; document.querySelectorAll("[data-dev]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.dev === "desk")));
  $("#liveNote").textContent = isComp ? "Así se ve la pieza. «Descargar MP4» la graba fotograma a fotograma en este navegador (tarda unos segundos por cada segundo de vídeo, sin sonido)." : "Así se ve el boceto. Cambia entre móvil y escritorio, o descárgalo para abrirlo en el navegador.";
  $("#liveFrame").srcdoc = doc;
  $("#liveDlg").showModal();
}
function recordLive() {
  if (liveBusy || !$("#liveFrame").contentWindow) return;
  liveBusy = true; $("#liveMp4").disabled = true; $("#liveMp4").textContent = "Preparando…";
  $("#liveFrame").contentWindow.postMessage({ live: "record", fps: 30 }, "*");
}
window.addEventListener("message", async e => {
  if (!e.data || e.data.live !== "rec" || e.source !== $("#liveFrame").contentWindow) return;
  const b = $("#liveMp4");
  if (e.data.error) { liveBusy = false; b.disabled = false; b.textContent = "Descargar MP4"; toast(e.data.error); return; }
  if (!e.data.done) { b.textContent = `Grabando ${Math.round(e.data.p * 100)} %`; return; }
  liveBusy = false; b.disabled = false; b.textContent = "Descargar MP4";
  const data = new Blob([e.data.buf], { type: "video/mp4" }), filename = liveName(liveTask, ".mp4");
  const dls = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (dls) { try { await dls.save({ filename, data }); } catch { toast("Descarga cancelada."); } return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
async function downloadLive() {
  if (!liveTask) return;
  const html = liveTask._block || liveHTML(liveTask.result), filename = liveName(liveTask, ".html");
  const data = /<html[\s>]/i.test(html) ? html : `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${html}\n</body></html>\n`;
  const dls = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (dls) { try { await dls.save({ filename, data }); } catch { toast("Descarga cancelada."); } return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "text/html" })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#liveDlg").addEventListener("close", () => { $("#liveFrame").srcdoc = ""; liveBusy = false; });

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
  $("#fReview").checked = BRAIN.review; $("#fAuto").checked = BRAIN.auto.on; $("#fEvery").value = String(BRAIN.auto.every);
  $("#fTallerOn").checked = TALLER.on; $("#fTallerApply").checked = TALLER.apply; $("#fTallerRepo").value = TALLER.repo; $("#fTallerDay").value = String(TALLER.perDay);
  $("#fRepos").value = CC.repos.join("\n");
  $("#fCloudOn").checked = CLOUD.on; $("#fCloudRound").checked = CLOUD.round; $("#fCloudEvery").value = String(CLOUD.every);
  const inClaude = !!window.claude?.use; ["fCloudOn", "fCloudRound", "fCloudEvery"].forEach(i => $("#" + i).disabled = !inClaude);
  $("#cloudNote").textContent = inClaude ? "" : "Solo funciona abriendo la oficina dentro de Claude.";
  $("#fTallerRepo").value = projCur()?.repo || ""; PROJ.del = ""; paintProjDel();
  $("#settings").showModal();
}
$("#settings").addEventListener("close", async () => {
  if ($("#settings").returnValue !== "save") return;
  state.company = $("#fCompany").value.trim() || state.company;
  state.brief = $("#fBrief").value.trim() || state.brief;
  if (AI.mode !== "sample") saveSettingsLocal({ key: $("#fKey").value.trim(), model: $("#fModel").value });
  BRAIN.review = $("#fReview").checked;
  const wasOn = BRAIN.auto.on; BRAIN.auto.on = $("#fAuto").checked; BRAIN.auto.every = +$("#fEvery").value || 30;
  if (BRAIN.auto.on && !wasOn) { BRAIN.auto.next = Date.now() + AUTO_WARMUP; BRAIN.auto.rounds = 0; }
  const repoOk = r => /^[\w.-]+\/[\w.-]+$/.test(r), clean = r => r.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
  const tOn = TALLER.on; TALLER.on = $("#fTallerOn").checked; TALLER.apply = $("#fTallerApply").checked; TALLER.perDay = +$("#fTallerDay").value || 3;
  const tr = clean($("#fTallerRepo").value); if (repoOk(tr)) { TALLER.repo = tr; projCur().repo = tr; if (!CC.repos.includes(tr)) CC.repos.push(tr); CC.repo = tr; ccSave(); } else if (!tr) projCur().repo = "";
  if (TALLER.on && !tOn) TALLER.next = Date.now() + 120e3;
  tallerSave();
  CLOUD.on = $("#fCloudOn").checked;
  const rWas = [CLOUD.round, CLOUD.every].join(); CLOUD.round = $("#fCloudRound").checked; CLOUD.every = +$("#fCloudEvery").value || 4; cloudSave();
  if (window.claude?.use && [CLOUD.round, CLOUD.every].join() !== rWas) cloudRoundApply().then(() => toast(CLOUD.round ? "Rondas en la nube programadas." : "Rondas en la nube desactivadas.")).catch(e => { toast(ccErr(e)); if (CLOUD.round && !CLOUD.roundTrigger) { CLOUD.round = false; cloudSave(); } });
  const repos = $("#fRepos").value.split("\n").map(clean).filter(repoOk); if (repos.length) { CC.repos = [...new Set(repos)]; if (!CC.repos.includes(CC.repo)) CC.repo = CC.repos[0]; ccSave(); }
  paintAuto();
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
  paintProjects();
  $("#coTitle").textContent = state.company;
  $("#briefLine").textContent = state.brief.length > 160 ? state.brief.slice(0, 160) + "…" : state.brief;
}
function updateBanner() {
  const b = $("#aiBanner");
  if (aiReady()) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = AI.mode === "pending" ? "Conectando con Claude…" : `Para que el equipo trabaje, abre esta app dentro de Claude o añade tu clave de API en <b>Ajustes</b>.`;
}

/* ---------- Contexto: documentos y código del propietario que leen todos los puestos ---------- */
const CTX = { items: [], ver: 0, projectFiles: false, fileTools: null, busy: "", report: null };
const TEXT_EXT = /\.(txt|md|mdx|markdown|csv|tsv|json|jsonc|jsonl|ya?ml|toml|ini|cfg|conf|xml|svg|html?|css|scss|sass|less|js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|ipynb|rb|php|java|kt|kts|swift|go|rs|c|h|cc|cpp|hpp|cs|fs|sql|sh|bash|zsh|ps1|dart|lua|r|ex|exs|erl|scala|clj|gradle|prisma|graphql|gql|proto|tf|hcl|rst|tex|srt|vtt|env\.example|gitignore|dockerignore|editorconfig)$/i;
const TEXT_NAME = /(^|\/)(Dockerfile|Makefile|Procfile|Gemfile|README|LICENSE|CHANGELOG|AGENTS|CLAUDE)(\.[a-z]+)?$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|\.svn|dist|build|\.next|\.nuxt|out|coverage|vendor|\.venv|venv|__pycache__|\.cache|\.idea|\.vscode|Pods|DerivedData|\.gradle|target|bin|obj)(\/|$)/;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.lock|Cargo\.lock|poetry\.lock|\.min\.(js|css)|\.map|\.DS_Store)$/i;
// Cada documento del almacén admite 256 KiB: los archivos grandes se guardan en partes en vez de recortarse.
const CTX_PART = 100000, CTX_MAX_TOTAL = 24e6, CTX_MAX_FILES = 4000;
// Si no cabe todo, entra primero lo que más ayuda a entender la app.
function ctxRank(name) {
  const n = name.toLowerCase(), base = n.split("/").pop();
  if (/^(claude|agents|readme|architecture|contributing)(\.[a-z]+)?$/.test(base) || /^(package\.json|tsconfig\.json|next\.config\.[a-z]+|capacitor\.config\.[a-z]+|app\.json)$/.test(base)) return 0;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|swift|kt|dart|go|rs|vue|svelte|astro|prisma|graphql|gql|rb|php|java|cs)$/.test(n) || /\.(md|mdx)$/.test(n)) return /(^|\/)(test|tests|__tests__|e2e|fixtures|mocks?|generated)(\/|$)|\.(test|spec|d)\.[a-z]+$/.test(n) ? 2 : 1;
  if (/\.(sql|css|scss|html?|ya?ml|toml|sh)$/.test(n)) return 2;
  return 3;
}
const STOP = new Set("para como esto esta este estos estas pero porque sobre entre desde hasta donde cuando quien cual cuales todo todos todas tiene tienen hacer hace sera seran puede pueden debe deben tambien mucho muchos poco cada otro otra otros otras nuestro nuestra vuestro their with that this from have will what which when where your about into than then them they were been more most some such only also just like make need quiero necesito favor".split(" "));
const ctxActive = () => CTX.items.filter(x => x.active);
const ctxChars = (list = CTX.items) => list.reduce((n, x) => n + (x.text?.length || 0), 0);
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const terms = s => [...new Set(norm(s).match(/[a-z0-9_]{4,}/g) || [])].filter(w => !STOP.has(w));
const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + " M" : n > 1e3 ? Math.round(n / 1e3) + " k" : String(n);
let chunkCache = { ver: -1, list: [] };
function ctxChunks() {
  if (chunkCache.ver === CTX.ver) return chunkCache.list;
  const list = [];
  for (const it of ctxActive()) {
    const lines = it.text.split("\n"); let buf = "", part = 0;
    const flush = () => { if (buf.trim()) list.push({ it, part: part++, text: buf, low: norm(buf), name: norm(it.name) }); buf = ""; };
    for (const l of lines) { if (buf.length + l.length > 2200) flush(); buf += l + "\n"; }
    flush();
  }
  chunkCache = { ver: CTX.ver, list }; return list;
}
// Elige los fragmentos más relevantes para el encargo; si todo cabe, lo manda entero.
function ctxFor(query, budget = 24000) {
  const act = ctxActive(); if (!act.length) return "";
  const index = `ARCHIVOS DEL CONTEXTO DEL PROPIETARIO (${act.length}):\n` + act.slice(0, 250).map(x => `- ${x.name} (${fmtSize(x.text.length)})`).join("\n") + (act.length > 250 ? `\n- … y ${act.length - 250} más` : "");
  const all = ctxChars(act);
  let picked;
  if (all + index.length <= budget) picked = ctxChunks();
  else {
    const q = terms(query + " " + state.brief.slice(0, 300));
    const chunks = ctxChunks(), N = chunks.length;
    const idf = Object.fromEntries(q.map(w => [w, Math.log(1 + N / (1 + chunks.filter(c => c.low.includes(w) || c.name.includes(w)).length))]));
    const scored = chunks.map(c => {
      let sc = 0; for (const w of q) { if (c.low.includes(w)) sc += idf[w] * (1 + Math.min(3, c.low.split(w).length - 2) * .3); if (c.name.includes(w)) sc += 2 * idf[w]; }
      if (/readme|claude\.md|agents\.md|brief|resumen|overview/.test(c.name) && c.part === 0) sc += 1.5;
      return { c, sc };
    }).sort((x, y) => y.sc - x.sc);
    picked = []; let used = index.length;
    for (const { c } of scored) { if (used + c.text.length > budget) continue; picked.push(c); used += c.text.length + 60; }
    picked.sort((x, y) => act.indexOf(x.it) - act.indexOf(y.it) || x.part - y.part);
  }
  return `${index}\n\nCONTENIDO${all + index.length > budget ? " (fragmentos más relevantes para este encargo)" : ""}:\n` +
    picked.map(c => `### ${c.it.name}${c.part ? ` (parte ${c.part + 1})` : ""}\n${c.text}`).join("\n");
}
function ctxTools(agent) {
  const t = [];
  if (ctxActive().length) t.push(
    { name: "buscar_contexto", description: "Busca en los documentos y el código que el propietario ha cargado como contexto de su empresa o su aplicación. Devuelve los fragmentos más relevantes para la consulta.",
      inputSchema: { type: "object", properties: { consulta: { type: "string", description: "Palabras clave o pregunta" } }, required: ["consulta"] },
      execute: ({ consulta }) => ctxFor(String(consulta || ""), 7000) },
    { name: "leer_archivo_contexto", description: "Lee un archivo del contexto por su ruta tal como aparece en la lista. Devuelve hasta 10.000 caracteres a partir de 'desde'.",
      inputSchema: { type: "object", properties: { ruta: { type: "string" }, desde: { type: "number" } }, required: ["ruta"] },
      execute: ({ ruta, desde = 0 }) => {
        const act = ctxActive(), r = String(ruta || "").replace(/ \[parte \d+ de \d+\]$/, ""), file = x => x.name.replace(/ \[parte \d+ de \d+\]$/, "");
        const hit = act.find(x => file(x) === r) || act.find(x => file(x).endsWith(r));
        if (!hit) throw new Error("No hay ningún archivo con esa ruta en el contexto.");
        const text = act.filter(x => x.source === hit.source && file(x) === file(hit)).sort((a, b) => (+(/\[parte (\d+)/.exec(a.name)?.[1]) || 0) - (+(/\[parte (\d+)/.exec(b.name)?.[1]) || 0)).map(x => x.text).join(""), from = Math.max(0, +desde || 0);
        return { ruta: file(hit), caracteres_totales: text.length, desde: from, texto: text.slice(from, from + 10000) };
      } });
  if (CTX.projectFiles && CTX.fileTools) t.push(...(agent && byId[agent]?.room === "taller" && /\/oficina$/i.test(TALLER.repo) && CTX.rawFileTools ? CTX.rawFileTools : CTX.fileTools));
  return t;
}
const ctxFiles = list => new Set(list.map(x => x.name.replace(/ \[parte \d+ de \d+\]$/, ""))).size;
function ctxSources() {
  const m = new Map();
  for (const x of CTX.items) { const g = m.get(x.source) || { source: x.source, kind: x.kind, items: [], createdAt: x.createdAt }; g.items.push(x); m.set(x.source, g); }
  return [...m.values()].sort((a, b) => b.createdAt - a.createdAt);
}
async function addCtx(entries, source, kind) {
  // entries: [{name, text}]. Los archivos grandes se parten; si no cabe todo, se avisa de forma permanente.
  const parts = [];
  for (const e of [...entries].sort((a, b) => ctxRank(a.name) - ctxRank(b.name) || a.name.localeCompare(b.name))) {
    const n = Math.ceil(e.text.length / CTX_PART);
    for (let k = 0; k < n; k++) parts.push({ name: n > 1 ? `${e.name} [parte ${k + 1} de ${n}]` : e.name, file: e.name, text: e.text.slice(k * CTX_PART, (k + 1) * CTX_PART) });
  }
  const keep = CTX.items.filter(x => x.source !== source);
  let added = 0, total = ctxChars(keep), full = "";
  const missing = new Set(), now = Date.now();
  for (const e of parts) {
    if (full || keep.length + added >= CTX_MAX_FILES || total + e.text.length > CTX_MAX_TOTAL) { missing.add(e.file); continue; }
    const old = CTX.items.find(x => x.source === source && x.name === e.name);
    const x = { id: old?.id || "x" + uid(), project: PROJ.cur, source, kind, name: e.name, text: e.text, active: true, createdAt: old?.createdAt || now };
    try { await store.saveCtx(x); } catch (err) { full = err?.code === "quota_exceeded" ? "store" : "error"; missing.add(e.file); continue; }
    if (old) Object.assign(old, x); else CTX.items.push(x);
    total += x.text.length; added++;
    if (added % 10 === 0) { CTX.busy = `Guardando ${added} de ${parts.length}…`; paintContext(); }
  }
  CTX.report = missing.size ? { source, files: entries.length, missing: [...missing], why: full === "store" ? "el almacén de la oficina se ha llenado" : full ? "hubo un error al guardar" : "se ha llegado al límite de contexto (24 M de caracteres)" } : null;
  try { localStorage.setItem(ctxReportKey(), JSON.stringify(CTX.report)); } catch {}
  CTX.busy = ""; CTX.ver++; paintContext(); paintCounts(); paintComposer();
  toast(missing.size ? `${entries.length - missing.size} de ${entries.length} archivos cargados. Faltan ${missing.size}: mira el aviso en Contexto.` : `${entries.length} ${entries.length === 1 ? "archivo añadido" : "archivos añadidos"} al contexto, completos.`);
}
const isTextPath = p => (TEXT_EXT.test(p) || TEXT_NAME.test(p)) && !SKIP_PATH.test(p) && !SKIP_FILE.test(p);
async function readFiles(fileList) {
  const out = []; let ignored = 0;
  for (const f of fileList) {
    const name = f.webkitRelativePath || f.name;
    if (!isTextPath(name) || f.size > 2e6) { ignored++; continue; }
    const text = await f.text().catch(() => "");
    if (!text || text.includes("\u0000")) { ignored++; continue; }
    out.push({ name, text });
  }
  return { out, ignored };
}
async function importFiles(fileList, folder) {
  if (!fileList?.length) return;
  CTX.busy = "Leyendo archivos…"; paintContext();
  const { out, ignored } = await readFiles([...fileList]);
  if (!out.length) { CTX.busy = ""; paintContext(); toast("No hay archivos de texto o código que se puedan leer. Los PDF y Word aún no se leen: pega su texto."); return; }
  const source = folder ? (out[0].name.split("/")[0] || "Carpeta") : out.length === 1 ? out[0].name : "Archivos sueltos";
  if (ignored) toast(`Se ignoran ${ignored} archivos que no son texto ni código.`);
  await addCtx(out, source, folder ? "carpeta" : "archivos");
}
async function importGitHub(url) {
  const m = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+)(?:\/([^?#]*))?)?\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!m) { toast("Pega la dirección de un repositorio, por ejemplo https://github.com/usuario/proyecto"); return; }
  const [, owner, repo, branchIn, sub] = m;
  CTX.busy = `Leyendo ${owner}/${repo}…`; paintContext();
  try {
    const gh = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status === 404 ? "No encuentro el repositorio o es privado." : r.status === 403 ? "GitHub limita las descargas: prueba en un rato." : "HTTP " + r.status); return r.json(); };
    const branch = branchIn || (await gh(`https://api.github.com/repos/${owner}/${repo}`)).default_branch;
    const tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const files = (tree.tree || []).filter(x => x.type === "blob" && isTextPath(x.path) && (x.size || 0) < 4e5 && (!sub || x.path.startsWith(sub)))
      .sort((a, b) => (/readme/i.test(b.path) - /readme/i.test(a.path)) || a.path.split("/").length - b.path.split("/").length).slice(0, 400);
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < files.length) {
        const f = files[i++];
        try { const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${f.path.split("/").map(encodeURIComponent).join("/")}`); if (r.ok) { const text = await r.text(); if (!text.includes("\u0000")) out.push({ name: f.path, text }); } } catch {}
        if (out.length % 20 === 0) { CTX.busy = `Leyendo ${owner}/${repo}: ${out.length} de ${files.length}…`; paintContext(); }
      }
    }));
    if (!out.length) throw new Error("No he encontrado archivos de texto o código.");
    out.sort((a, b) => a.name.localeCompare(b.name));
    await addCtx(out, `${owner}/${repo}`, "github");
  } catch (e) {
    CTX.busy = ""; paintContext();
    toast(AI.mode === "sample" && /fetch|network|Failed/i.test(String(e?.message)) ? "Dentro de Claude no puedo descargar de GitHub. Usa «Subir carpeta» con el proyecto descargado." : "No se pudo importar: " + (e?.message || e));
  }
}
// La carpeta oficina/ del proyecto es el código de esta misma app: los puestos no deben confundirla con la del propietario.
const OWN_DIR = /^\/?oficina(\/|$)/;
function hideOwnFiles(tools) {
  const strip = v => Array.isArray(v) ? v.filter(e => !OWN_DIR.test(typeof e === "string" ? e : e?.path || "")).map(strip)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)])) : v;
  return (tools || []).map(tool => ({ ...tool, async execute(input, ...rest) {
    if (Object.values(input || {}).some(x => typeof x === "string" && OWN_DIR.test(x))) throw new Error("Esa carpeta es el código de la propia oficina, no la app del propietario.");
    return strip(await tool.execute(input, ...rest));
  } }));
}
async function enableProjectFiles(ask = true) {
  const f = window.claude?.use ? await window.claude.use("files").catch(() => null) : null;
  if (!f || !AI.tools) { CTX.projectFiles = false; if (ask) toast("Los archivos del proyecto solo están disponibles al abrir la app dentro de Claude."); paintContext(); return; }
  try { CTX.rawFileTools = await f.asSampleTools(); CTX.fileTools = hideOwnFiles(CTX.rawFileTools); CTX.projectFiles = true; }
  catch (e) { CTX.projectFiles = false; if (ask) toast(e?.code === "not_granted" ? "No se ha permitido leer los archivos del proyecto." : "No se pudieron abrir los archivos del proyecto."); }
  paintContext();
}
// Almacén local del contexto fuera de Claude (IndexedDB, porque puede ocupar varios MB)
const idb = {
  _db: null,
  open() { if (this._db) return this._db; this._db = new Promise((res, rej) => { const r = indexedDB.open("oficina", 1); r.onupgradeneeded = () => r.result.createObjectStore("context", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this._db; },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("context", mode), st = t.objectStore("context"), r = fn(st); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); },
  async all() { try { return (await this.tx("readonly", st => st.getAll())) || []; } catch { return []; } },
  put(x) { return this.tx("readwrite", st => st.put(x)).catch(() => {}); },
  del(id) { return this.tx("readwrite", st => st.delete(id)).catch(() => {}); },
};

/* ---------- Almacenamiento: base de datos del artifact o este navegador ---------- */
// Los documentos que devuelve la base de datos llegan congelados: se copian para poder modificarlos.
const thaw = d => { const v = d.data(); try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); } };
const store = {
  db: null, base: null,
  async init() {
    let meta = null;
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
        if (s.exists) { const d = thaw(s); meta = d; state.company = d.company || state.company; state.brief = d.brief || state.brief; CTX.projectFiles = !!d.projectFiles; loadBrainMeta(d); }
        const [tq, rq, sq] = await Promise.all([
          this.base.collection("tasks").orderBy("createdAt", "desc").limit(1000).get(),
          this.base.collection("runs").orderBy("createdAt", "desc").limit(50).get(),
          this.base.collection("skills").get()]);
        try { const bq = await this.base.collection("brain").get(); for (const d of bq.docs) { const x = thaw(d); if (d.id === "facts") BRAIN.facts = x.items || []; else if (d.id.startsWith("facts-")) PROJ.facts[d.id.slice(6)] = x.items || []; else if (byId[d.id]) BRAIN.mem[d.id] = x.items || []; } } catch {}
        try {
          const col = this.base.collection("context"), items = []; let last = "";
          for (let i = 0; i < 10; i++) {
            const q = await (last ? col.where("id", ">", last) : col).orderBy("id").limit(1000).get();
            items.push(...q.docs.map(thaw).filter(x => x?.id));
            if (q.docs.length < 1000) break; last = items[items.length - 1].id;
          }
          CTX.items = items.sort((a, b) => a.createdAt - b.createdAt);
        } catch { try { const cq = await this.base.collection("context").limit(1000).get(); CTX.items = cq.docs.map(thaw).filter(x => x?.id); } catch {} }
        mergeTasks(tq.docs.map(thaw)); mergeRuns(rq.docs.map(thaw)); state.customSkills = sq.docs.map(thaw).filter(s => byId[s.agentId]);
      } catch { this.db = null; meta = null; }
    }
    if (!this.db) {
      try { const s = JSON.parse(localStorage.getItem("oficina.v2") || "null");
        if (s) { meta = s; state.company = s.company || state.company; state.brief = s.brief || state.brief; mergeTasks(s.tasks || []); mergeRuns(s.runs || []); state.customSkills = s.skills || []; } } catch {}
      CTX.items = await idb.all();
      try { const b = JSON.parse(localStorage.getItem("oficina.brain") || "null"); if (b) { BRAIN.mem = b.mem || {}; BRAIN.facts = b.facts || []; Object.assign(PROJ.facts, b.factsBy || {}); loadBrainMeta(b); } } catch {}
    }
    projSetup(meta);
    if (this.db) { cloudWatch(); setTimeout(() => cloudSync(true), 4000); }
    CTX.ver++; if (CTX.projectFiles) enableProjectFiles(false);
    quietOnce();
    paintHeader(); paintAll(); paintComposer(); if (state.view !== "oficina") go(state.view);
  },
  async put(col, rec) { if (this.db) { try { await this.base.collection(col).doc(rec.id).set(rec); return; } catch (e) { if (e?.code === "quota_exceeded") toast("El almacén está lleno: borra entregas antiguas."); } } this.local(); },
  async del(col, id) { if (this.db) { try { await this.base.collection(col).doc(id).delete(); return; } catch {} } this.local(); },
  saveMeta() { projKeep(); if (this.db) return this.base.set({ company: state.company, brief: state.brief, projects: PROJ.list, cur: PROJ.cur, projectFiles: CTX.projectFiles, review: BRAIN.review, autoOn: BRAIN.auto.on, autoEvery: BRAIN.auto.every }).catch(() => this.local()); this.local(); },
  saveBrain(key) {
    if (this.db) { const items = key === "facts" ? BRAIN.facts : memOf(key); return this.base.collection("brain").doc(key === "facts" ? factsDoc(PROJ.cur) : key).set({ items: items.map(({ _busy, ...x }) => x) }).catch(() => {}); }
    projSync(); const factsBy = Object.fromEntries(PROJ.list.map(p => [p.id, PROJ.b[p.id]?.facts || []]));
    try { localStorage.setItem("oficina.brain", JSON.stringify({ mem: BRAIN.mem, facts: PROJ.b[projDef()]?.facts || BRAIN.facts, factsBy, review: BRAIN.review, autoOn: BRAIN.auto.on, autoEvery: BRAIN.auto.every })); } catch {}
  },
  async saveCtx(x) { if (this.db) { try { await this.base.collection("context").doc(x.id).set(x); return; } catch (e) { if (e?.code === "quota_exceeded") { toast("El almacén está lleno: quita contexto o entregas antiguas."); throw e; } } } await idb.put(x); },
  async deleteCtx(id) { if (this.db) { try { await this.base.collection("context").doc(id).delete(); return; } catch {} } await idb.del(id); },
  saveTask(t) { if (t._lock && t.status === "work") return Promise.resolve(); const { v, _lock, ...rec } = t; rec.result = (rec.result || "").slice(0, 150000); rec.extra = (rec.extra || "").slice(0, 2000); if (rec.firstResult) rec.firstResult = rec.firstResult.slice(0, 8000); return this.put("tasks", rec); },
  deleteTask(id) { return this.del("tasks", id); },
  saveRun(r) { const { ctl, ...rec } = r; return this.put("runs", JSON.parse(JSON.stringify(rec))); },
  saveSkill(s) { return this.put("skills", s); },
  deleteSkill(id) { return this.del("skills", id); },
  local() {
    projKeep();
    try { localStorage.setItem("oficina.v2", JSON.stringify({ company: state.company, brief: state.brief, projects: PROJ.list, cur: PROJ.cur,
      tasks: projAll("tasks").filter(t => t.status !== "work").sort((a, b) => a.createdAt - b.createdAt).slice(-300).map(({ v, ...r }) => r), runs: projAll("runs").filter(r => r.status !== "work").slice(-30).map(({ ctl, ...r }) => r), skills: state.customSkills })); } catch {}
    if (!this.db) this.saveBrain("facts");
  },
};
// El propietario pidió (29-oct-2026) que la oficina solo trabaje cuando él da una orden: se apaga una vez todo lo autónomo.
// Si después lo vuelve a encender en Ajustes, se respeta.
function quietOnce() {
  try { if (localStorage.getItem("oficina.quiet1")) return; localStorage.setItem("oficina.quiet1", "1"); } catch { return; }
  BRAIN.auto.on = false; TALLER.on = false; TALLER.apply = false; tallerSave();
  if (CLOUD.round) { CLOUD.round = false; cloudSave(); if (CLOUD.roundTrigger) cloudRoundApply().catch(() => {}); }
  store.saveMeta(); paintAuto();
}
function loadBrainMeta(d) { if (typeof d.review === "boolean") BRAIN.review = d.review; BRAIN.auto.on = !!d.autoOn; BRAIN.auto.every = d.autoEvery || 30; if (BRAIN.auto.on) BRAIN.auto.next = Date.now() + AUTO_WARMUP; }
function mergeTasks(list) {
  const have = new Set(state.tasks.map(t => t.id));
  for (const t of list) if (t?.id && byId[t.agentId] && !have.has(t.id)) state.tasks.push({ steps: [], ...t, ...(t.status === "work" && t.cloud?.state === "working" ? { _lock: true } : t.status === "work" ? { status: "error", interrupted: true, result: (t.result ? t.result + "\n\n" : "") + "> Se interrumpió al cerrar la oficina. Pulsa «Seguir» para retomarlo." } : {}), v: 0 });
}
function mergeRuns(list) { const have = new Set(state.runs.map(r => r.id)); for (const r of list) if (r?.id && !have.has(r.id)) state.runs.push({ ...r, status: r.status === "work" ? "error" : r.status }); }

/*__WORK__*/

/*__PROJECTS__*/

/*__CLOUD__*/

/* ---------- Arranque ---------- */
function tick() { $("#clock").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
async function boot() {
  try { await Promise.race([document.fonts.load('8px "Silkscreen"'), new Promise(r => setTimeout(r, 1500))]); } catch {}
  scene = Office.create($("#scene"), { agents: AGENTS, onPick: id => openAgent(id), getState: () => state });
  paintTargets(); paintComposer(); paintHeader();
  setRoom(state.room);
  go(location.hash.slice(1) || "oficina");
  centerStage();
  tick(); setInterval(tick, 30000); setInterval(autoTick, 15000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) scene.stop(); else if (state.view === "oficina") scene.start(); });
  AI.mode = window.claude?.use ? "pending" : "none"; updateBanner();
  if (window.claude?.use) {
    const s = await window.claude.use("sample").catch(() => null);
    if (s) { AI.sample = s; AI.mode = "sample"; try { const l = await s.limits(); AI.images = !!l?.images; AI.tools = !!l?.tools; } catch {} } else AI.mode = "none";
  }
  if (AI.mode === "none") AI.images = true; // con clave propia la API acepta imágenes
  updateBanner(); paintComposer();
  store.init();
}
boot();
