/* ---------- Proyectos: cada uno con su contexto, encargos, entregables y hechos; el equipo es el mismo ---------- */
// Lo que se ve (state.tasks, state.runs, CTX.items, BRAIN.facts) es el cajón del proyecto abierto.
// Los demás cajones siguen en memoria: un encargo que se lanza en un proyecto termina en ese proyecto aunque cambies.
const PROJ = { list: [], cur: null, b: {}, facts: {}, del: "" };
const BRIEF0 = "Describe este proyecto en «Ajustes»: qué es, para quién, objetivos, tono de marca y presupuesto.";
function projCur() { return PROJ.list.find(p => p.id === PROJ.cur) || PROJ.list[0]; }
function projDef() { return PROJ.list[0]?.id || "p1"; }
function projBox(pid) { return (PROJ.b[pid] ||= { tasks: [], runs: [], ctx: [], facts: [] }); }
// Devuelve al cajón lo visible (algunas funciones sustituyen el array en vez de modificarlo).
function projSync() { if (!PROJ.cur) return; const b = projBox(PROJ.cur); b.tasks = state.tasks; b.runs = state.runs; b.ctx = CTX.items; b.facts = BRAIN.facts; }
function projAll(key) { projSync(); return PROJ.list.flatMap(p => PROJ.b[p.id]?.[key] || []); }
function projPush(key, x, pid) { projSync(); x.project = pid || PROJ.cur; projBox(x.project)[key].push(x); }
function projOfRun(runId) { return runId ? projAll("runs").find(r => r.id === runId)?.project : null; }
function factsDoc(pid) { return pid === projDef() ? "facts" : "facts-" + pid; }
function ctxReportKey(pid = PROJ.cur) { return "oficina.ctxreport" + (pid === projDef() ? "" : "." + pid); }

// Se llama al arrancar, con todo lo cargado mezclado: lo reparte por proyecto (lo antiguo va al primero).
function projSetup(meta) {
  let list = Array.isArray(meta?.projects) ? meta.projects.filter(p => p?.id && p.name) : [];
  if (!list.length) list = [{ id: "p1", name: state.company === "FuelIron" ? "Fueliron" : state.company, brief: state.brief, repo: /fuel/i.test(state.company) ? "guillelafargue/ai-fitness-pwa" : TALLER.repo, createdAt: Date.now() }];
  PROJ.list = list; PROJ.b = {};
  const ids = new Set(list.map(p => p.id)), def = list[0].id, home = x => (ids.has(x.project) ? x.project : def);
  for (const p of list) projBox(p.id).facts = PROJ.facts[p.id] || (p.id === def ? BRAIN.facts : []);
  for (const t of state.tasks) { t.project = home(t); projBox(t.project).tasks.push(t); }
  for (const r of state.runs) { r.project = home(r); projBox(r.project).runs.push(r); }
  for (const x of CTX.items) { x.project = home(x); projBox(x.project).ctx.push(x); }
  let cur = meta?.cur; try { cur = localStorage.getItem("oficina.proj") || cur; } catch {}
  PROJ.cur = ids.has(cur) ? cur : def;
  projApply();
}
function projApply() {
  const p = projCur(), b = projBox(p.id);
  state.tasks = b.tasks; state.runs = b.runs; CTX.items = b.ctx; BRAIN.facts = b.facts;
  state.company = p.name; state.brief = p.brief || BRIEF0;
  try { CTX.report = JSON.parse(localStorage.getItem(ctxReportKey()) || "null"); } catch { CTX.report = null; }
  if (p.repo) { TALLER.repo = p.repo; if (!CC.repos.includes(p.repo)) CC.repos.push(p.repo); CC.repo = p.repo; }
  state.sel?.clear?.(); CTX.ver++;
}
function projSwitch(id) {
  if (id === PROJ.cur || !PROJ.list.some(p => p.id === id)) return;
  projSync(); if (READER.id) closeReader(); if (state.open) closeAgent();
  PROJ.cur = id; try { localStorage.setItem("oficina.proj", id); } catch {}
  projApply(); paintHeader(); paintAll(); paintComposer(); paintContext(); paintCounts();
  store.saveMeta(); toast(`Ahora trabajáis en «${state.company}».`);
}
function projMenuHTML() {
  projSync();
  const rows = PROJ.list.map(p => {
    const b = PROJ.b[p.id] || {}, n = (b.tasks || []).filter(t => !t.archived).length, w = (b.tasks || []).filter(t => t.status === "work").length;
    return `<button type="button" data-proj="${p.id}" ${p.id === PROJ.cur ? 'aria-current="true"' : ""}><b>${esc(p.name)}</b><span>${n} ${n === 1 ? "encargo" : "encargos"}${w ? ` · ${w} en marcha` : ""}${p.repo ? " · " + esc(p.repo) : ""}</span></button>`;
  }).join("");
  return `${rows}<hr><button type="button" data-projnew><b>Nuevo proyecto</b><span>Su propio contexto, encargos y entregables, con el mismo equipo</span></button><button type="button" data-settings><b>Ajustes de «${esc(state.company)}»</b></button>`;
}
function paintProjects() { const m = $("#projPop"); if (m) m.innerHTML = projMenuHTML(); const s = $("#projName"); if (s) s.textContent = state.company; }
function projNew() { ["nName", "nBrief", "nRepo"].forEach(i => $("#" + i).value = ""); $("#projDlg").showModal(); }
$("#projDlg").addEventListener("close", () => {
  if ($("#projDlg").returnValue !== "save") return;
  const name = $("#nName").value.trim();
  if (!name) { toast("El proyecto necesita un nombre."); return; }
  const repo = $("#nRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
  const p = { id: "p" + uid(), name, brief: $("#nBrief").value.trim() || BRIEF0, repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : "", createdAt: Date.now() };
  PROJ.list.push(p); projBox(p.id); projSwitch(p.id);
});
// Borrar un proyecto borra sus encargos, rondas, contexto y hechos. El equipo, sus skills y lo que han aprendido se quedan.
async function projDelete(id) {
  if (PROJ.list.length < 2) { toast("Tiene que quedar al menos un proyecto."); return; }
  projSync(); const b = projBox(id), wasDef = id === projDef();
  for (const t of b.tasks) if (t.status === "work") stopTask(t);
  await Promise.all([...b.tasks.map(t => store.deleteTask(t.id)), ...b.runs.map(r => store.del("runs", r.id)), ...b.ctx.map(x => store.deleteCtx(x.id))]);
  if (store.db) store.base.collection("brain").doc(factsDoc(id)).delete().catch(() => {});
  try { localStorage.removeItem(ctxReportKey(id)); } catch {}
  PROJ.list = PROJ.list.filter(p => p.id !== id); delete PROJ.b[id];
  // Si se borra el primero, los hechos del nuevo primero pasan al documento «facts».
  if (wasDef) { PROJ.cur = projDef(); projApply(); store.saveBrain("facts"); if (store.db) store.base.collection("brain").doc("facts-" + PROJ.cur).delete().catch(() => {}); }
  PROJ.cur = null; projSwitch(projDef()); paintProjects();
}
// Lo que se edita en Ajustes (nombre y descripción) vive en el proyecto abierto.
function projKeep() { const p = projCur(); if (!p) return; p.name = state.company; p.brief = state.brief; }
function paintProjDel() {
  const b = $("#projDel"); if (!b) return;
  const n = projBox(PROJ.cur).tasks.length;
  b.hidden = PROJ.list.length < 2;
  b.textContent = PROJ.del === PROJ.cur ? `Sí, borrar «${state.company}» y sus ${n} encargos` : "Borrar este proyecto";
  b.classList.toggle("bad", PROJ.del === PROJ.cur);
}
