/* ---------- Trabajo en la nube: los encargos siguen aunque se cierre la oficina ---------- */
// Cada encargo se lanza en una sesión de Claude Code en la nube (conector Claude Code Remote).
// La sesión hace el trabajo y escribe la entrega en la base de datos de este artifact (herramienta ArtifactData),
// en el mismo documento del encargo. La oficina, al abrirse o mientras está abierta, recoge lo que ha llegado.
const ART_URL = "https://claude.ai/artifact/6Y83Rf3U27ywyEWRxeEUNM";
const TASKS_COL = "data/users/me/office/tasks";
const CLOUD = { on: true, trigger: null, round: false, every: 4, roundTrigger: null, last: 0 };
function cloudLoad() { try { Object.assign(CLOUD, JSON.parse(localStorage.getItem("oficina.cloud") || "{}")); } catch {} }
function cloudSave() { try { localStorage.setItem("oficina.cloud", JSON.stringify({ on: CLOUD.on, trigger: CLOUD.trigger, round: CLOUD.round, every: CLOUD.every, roundTrigger: CLOUD.roundTrigger })); } catch {} }
cloudLoad();
// Solo dentro de Claude: fuera no hay conector ni base de datos compartida.
function cloudReady() { return CLOUD.on && !!window.claude?.use && !!store.db; }

const CLOUD_PROMPT = `Te lanza la Oficina de agentes del propietario para hacer UN encargo en la nube, aunque él tenga la oficina cerrada. El mensaje que sigue trae el enlace del artifact de la Oficina, la colección y el id del encargo, y las instrucciones completas del puesto que lo hace.
Haz esto, sin preguntar:
1. Con la herramienta ArtifactData (actúas como el propietario) lee el encargo: action "get", el url del artifact, la colección y el doc_id indicados. Anota su version.
2. Haz el trabajo como ese puesto, siguiendo sus instrucciones al pie de la letra: idioma, formato, secciones y calidad. Puedes buscar en la web y, si el encargo trata del código de un repositorio, añadirlo con add_repo y leerlo. No cambies código, no abras PR y no escribas fuera de ese documento.
3. Guarda la entrega: escribe un archivo JSON con {"result": "<tu entrega completa en Markdown>", "status": "done", "phase": "fin", "finishedAt": <milisegundos de ahora>, "cloud": {"state": "done"}} y llama a ArtifactData "update" con ese file_path, la misma colección y doc_id, e if_version. Si falla por versión, vuelve a leer y repite.
4. Si no puedes terminarlo, guarda lo mismo con "status": "error" y en "result" lo que tengas más una última línea «> Motivo: …».
5. Termina con una sola línea: qué has entregado.`;

function cloudPrompt(a, t, skill) {
  const ctx = ctxFor(`${t.order} ${skill?.name || ""} ${a.role}`, 14000);
  const main = [skill, ...(t.autoSkills || []).map(skillById)].filter(Boolean);
  return `${persona(a)}
${ctx ? "\n" + ctx + "\n" : "\nNo hay archivos de contexto cargados en la oficina. Si el encargo trata del código de una app y conoces su repositorio, léelo.\n"}
ENCARGO (de ${t.from}):
${t.order}
${t.extra ? "\n" + t.extra.slice(0, 6000) + "\n" : ""}${main.length ? `\nMÉTODOS PRINCIPALES:\n${main.map(s => `«${s.name}»: ${s.method}`).join("\n")}\n` : ""}
Tu repertorio, por si encaja: ${skillsOf(a.id).map(s => s.name).join(", ")}.

${RULES(a)}
- Las herramientas de archivos que pueda mencionar la oficina no existen aquí: usa el contexto incluido, la web y los repositorios.
- Cierra con una línea «Siguiente paso sugerido: …».`;
}
function cloudText(t, prompt) {
  const head = `Artifact: ${ART_URL}\nColección: ${TASKS_COL}\nEncargo (doc_id): ${t.id}\nPuesto: ${byId[t.agentId].role}\n\n--- Instrucciones del puesto ---\n`;
  let body = prompt;
  const enc = new TextEncoder(), max = 60000;
  while (enc.encode(head + body).length > max) body = body.slice(0, Math.floor(body.length * 0.9));
  return head + body;
}

async function ccEnv(mcp, ccPay) {
  if (CC.env) return CC.env;
  const envs = ccPay(await mcp.callTool(CC_SERVER, "list_environments", {}))?.environments || [];
  const env = envs.find(e => e.state === "active" && /trusted/i.test(e.description || "")) || envs.find(e => e.state === "active") || envs[0];
  if (!env) throw { message: "No tienes ningún entorno de Claude Code. Crea uno en claude.ai/code." };
  CC.env = env.environment_id; ccSave(); return CC.env;
}
function ccSession(res) {
  const vals = []; (function walk(v) { if (typeof v === "string") vals.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); })(res);
  const session = vals.map(v => /\bsession_[A-Za-z0-9]{8,}/.exec(v)?.[0]).find(Boolean) || null;
  const url = vals.map(v => /https:\/\/claude\.ai\/code\/[^\s"']+/.exec(v)?.[0]).find(Boolean) || (session ? "https://claude.ai/code/" + session : "https://claude.ai/code");
  return { session, url };
}
const ccPay = r => r?.payload ?? r;
async function cloudTrigger(mcp, fresh) {
  if (CLOUD.trigger && !fresh) return CLOUD.trigger;
  const env = await ccEnv(mcp, ccPay);
  const r = ccPay(await mcp.callTool(CC_SERVER, "create_trigger", { name: "Oficina: encargos en la nube", prompt: CLOUD_PROMPT, create_new_session_on_fire: true, environment_id: env, initiation: "human_request", notifications: { push: true } }));
  CLOUD.trigger = r?.trigger?.id || /"(trig_[A-Za-z0-9]{6,})"/.exec(JSON.stringify(r || {}))?.[1] || null;
  if (!CLOUD.trigger) throw { message: "Claude Code no devolvió la tarea creada." };
  cloudSave(); return CLOUD.trigger;
}

// Lanza el encargo en la nube. Si no se puede (sin permiso, sin conector…), se hace aquí como siempre.
async function runCloud(o) {
  const a = byId[o.agentId], t = newTask(o), skill = t.skillId ? skillById(t.skillId) : null;
  t.phase = "cloud"; t.cloud = { state: "sending", at: Date.now() }; setAgent(a.id); bump(t);
  try {
    await store.saveTask(t);
    const mcp = await ccMcp(); if (!mcp) throw { code: "server_not_connected" };
    const text = cloudText(t, cloudPrompt(a, t, skill));
    let res;
    try { res = ccPay(await mcp.callTool(CC_SERVER, "fire_trigger", { trigger_id: await cloudTrigger(mcp), text })); }
    catch (e) { if (e?.code !== "tool_error") throw e; res = ccPay(await mcp.callTool(CC_SERVER, "fire_trigger", { trigger_id: await cloudTrigger(mcp, true), text })); }
    Object.assign(t.cloud, ccSession(res), { state: "working" });
    bump(t); await store.saveTask(t);
    // A partir de aquí escribe la sesión: la oficina ya no guarda este encargo hasta que vuelva.
    t._lock = true;
    toast("En marcha en la nube: sigue aunque cierres la oficina.");
    cloudWatch();
    return t;
  } catch (e) {
    await deleteTasks([t.id]);
    toast(ccErr(e) + " Lo hago aquí, con la oficina abierta.");
    return runTask({ ...o, local: true });
  }
}

// Recoge lo que han entregado las sesiones en la nube (y lo que han creado las rondas programadas).
async function cloudSync(quiet) {
  if (!store.db) return;
  let docs = [];
  try { docs = (await store.base.collection("tasks").orderBy("createdAt", "desc").limit(80).get()).docs.map(thaw); } catch { return; }
  const all = new Map(projAll("tasks").map(t => [t.id, t]));
  let got = 0, fresh = 0;
  for (const d of docs) {
    if (!d?.id || !byId[d.agentId]) continue;
    const t = all.get(d.id);
    if (!t) { if (d.cloud) { const n = { steps: [], ...d, v: 0 }; delete n._lock; projPush("tasks", n, PROJ.list.some(p => p.id === d.project) ? d.project : projDef()); fresh++; } continue; }
    if (t.cloud && t.status === "work" && d.status && d.status !== "work") { Object.assign(t, d, { v: (t.v || 0) + 1 }); delete t._lock; got++; if (!quiet) toast(`Ha llegado de la nube: «${t.order.slice(0, 60)}».`); }
  }
  if (got || fresh) { AGENTS.forEach(a => setAgent(a.id)); paintAll(); }
  await cloudCheckSessions();
}
// Si una sesión ha terminado o fallado sin guardar la entrega, se avisa con el enlace para verla.
async function cloudCheckSessions() {
  const list = projAll("tasks").filter(t => t.cloud?.state === "working" && t.status === "work" && t.cloud.session && Date.now() - (t.cloud.at || 0) > 3 * 60e3);
  if (!list.length) return;
  const mcp = await ccMcp(); if (!mcp) return;
  for (const t of list.slice(0, 5)) {
    try {
      const r = ccPay(await mcp.callTool(CC_SERVER, "get_session", { session_id: t.cloud.session }, { cache: false })) || {};
      const b = r.status_bucket || r.session?.status_bucket;
      if (b === "failed" || ((b === "completed" || b === "review_ready") && (t.cloud.endSeen = (t.cloud.endSeen || 0) + 1) > 1)) {
        t._lock = false; t.status = "error"; t.phase = "fin"; t.cloud.state = b;
        t.result = (t.result || "") + `\n\n> La sesión en la nube ${b === "failed" ? "falló" : "terminó"} sin guardar la entrega aquí. Ábrela en Claude Code para ver qué hizo: ${t.cloud.url}`;
        bump(t); await store.saveTask(t);
      }
    } catch {}
  }
  AGENTS.forEach(a => setAgent(a.id)); paintAll();
}
function cloudWatch() {
  if (cloudWatch.id) return;
  cloudWatch.id = setInterval(() => {
    if (document.hidden) return;
    const pending = projAll("tasks").some(t => t.cloud && t.status === "work");
    if (pending || (CLOUD.round && Date.now() - CLOUD.last > 10 * 60e3)) { CLOUD.last = Date.now(); cloudSync(); }
  }, 60e3);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && store.db) cloudSync(); });
function stopCloud(t) {
  if (!t.cloud?.session) return false;
  ccMcp().then(m => m?.callTool(CC_SERVER, "interrupt_session", { session_id: t.cloud.session })).catch(() => {});
  t._lock = false; t.stopped = true; t.status = "error"; t.phase = "fin"; t.result = (t.result || "") + "\n\n> Detenido a mano.";
  bump(t); store.saveTask(t); setAgent(t.agentId); return true;
}

/* Rondas programadas: Dirección trabaja sola cada pocas horas, aunque nadie abra la oficina. */
function roundPrompt() {
  return `Te lanza la Oficina de agentes del propietario para una RONDA AUTÓNOMA en la nube: él no tiene la oficina abierta. Trabajas como su Dirección general y como cada puesto del equipo.
Usa la herramienta ArtifactData (actúas como el propietario) sobre el artifact ${ART_URL}.
1. Lee el documento de la oficina: action "get", collection "data/users/me", doc_id "office". De ahí saca "projects" y "cur": trabajas en el proyecto cuyo id es "cur" (nombre y "brief"). Si no hay "projects", usa "company" y "brief" y el proyecto es "p1".
2. Lee los encargos recientes: action "query", collection "${TASKS_COL}", query {"order_by": {"field": "createdAt", "direction": "desc"}, "limit": 40}. Son de ese proyecto los que tienen "project" igual a "cur" (y, si "cur" es el primer proyecto de la lista, también los que no tienen "project"). Mira qué se ha hecho, qué salió con error y qué falta.
3. Como Dirección, elige de 1 a 3 encargos nuevos de máximo valor para el proyecto que no estén ya hechos (rehacer algo flojo vale). Para cada uno, el puesto que mejor lo hace de esta lista:
${AGENTS.map(a => `- ${a.id}: ${a.role}`).join("\n")}
4. Haz cada encargo tú mismo con el criterio de ese puesto. Puedes buscar en la web y leer repositorios con add_repo; no cambies código ni abras PR.
${RULES(byId.elena).replace(/\(por ejemplo [^)]*\)/, "")}
5. Guarda cada entrega como documento nuevo: action "set", collection "${TASKS_COL}", doc_id = "n" + milisegundos actuales en base 36 + 4 letras al azar, con data {"id": <el mismo doc_id>, "agentId": <id del puesto>, "order": <el encargo en una frase>, "from": "Ronda en la nube", "status": "done", "mode": "pro", "steps": [], "step": 0, "phase": "fin", "result": <la entrega en Markdown>, "createdAt": <milisegundos de ahora>, "project": <cur>, "cloud": {"state": "done", "round": true}}. Para entregas largas, escribe el JSON en un archivo y usa file_path.
6. Al final guarda igual un informe breve de Dirección (agentId "elena", order "Informe de la ronda en la nube") con qué se hizo, por qué y qué recomiendas después.
No escribas en ningún otro documento. Termina con una línea: cuántos encargos has entregado.`;
}
function roundCron(h) { return h >= 24 ? "CRON_TZ=Europe/Madrid 17 9 * * *" : `0 */${h} * * *`; }
async function cloudRoundApply() {
  const mcp = await ccMcp(); if (!mcp) throw { code: "server_not_connected" };
  if (!CLOUD.round) { if (CLOUD.roundTrigger) await mcp.callTool(CC_SERVER, "update_trigger", { trigger_id: CLOUD.roundTrigger, enabled: false }); return; }
  if (CLOUD.roundTrigger) {
    try { await mcp.callTool(CC_SERVER, "update_trigger", { trigger_id: CLOUD.roundTrigger, enabled: true, cron_expression: roundCron(CLOUD.every), prompt: roundPrompt() }); return; }
    catch (e) { if (e?.code !== "tool_error") throw e; CLOUD.roundTrigger = null; }
  }
  const env = await ccEnv(mcp, ccPay);
  const r = ccPay(await mcp.callTool(CC_SERVER, "create_trigger", { name: "Oficina: ronda en la nube", prompt: roundPrompt(), cron_expression: roundCron(CLOUD.every), create_new_session_on_fire: true, environment_id: env, initiation: "human_request", notifications: { push: true } }));
  CLOUD.roundTrigger = r?.trigger?.id || /"(trig_[A-Za-z0-9]{6,})"/.exec(JSON.stringify(r || {}))?.[1] || null;
  if (!CLOUD.roundTrigger) throw { message: "Claude Code no devolvió la tarea programada." };
  cloudSave();
}
