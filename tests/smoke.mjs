// Prueba de humo: abre la app compilada con un Claude simulado y recorre lo básico.
// Uso: python3 build.py && node tests/smoke.mjs [archivo.html]
// Falla (código 1) si hay errores de página o si falta algo esencial.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import path from "node:path";

const file = path.resolve(process.argv[2] || "build/oficina.html");
const now = Date.now();
const doc = "## Resumen\n- Tres propuestas; recomiendo la B.\n\n## Propuestas\n\n### Opción A: corta\n**Qué:** algo.\n\n### Opción B: mejor (recomendada)\n**Qué:** otra cosa.\n\n| Paso | Coste |\n|---|---|\n| 1 | bajo |\n\n## Entrega final\nHaz la B.\n\n## Cambios para Claude Code\n- Cambia el texto del botón.\n\nSiguiente paso sugerido: probarla.";
const tasks = [
  { id: "t1", agentId: "elena", order: "Propuestas de prueba", from: "Tú", status: "done", createdAt: now - 36e5, steps: [], result: doc, score: 9, mode: "rapido" },
  { id: "t3", agentId: "elena", order: "Encargo cortado", from: "Tú", status: "work", createdAt: now - 6e5, steps: [], result: "Llevaba la mitad." },
  { id: "t2", agentId: "elena", order: "Encargo con error", from: "Tú", status: "error", createdAt: now - 864e5, steps: [], result: "> Se cortó." },
];

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log((ok ? "ok   " : "FALLA") + " " + msg); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
// Sin red: las librerías externas (marked, mermaid, pdfmake…) no cargan y la app debe aguantar.
await ctx.route(/^https?:/, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.addInitScript(tasks => {
  const snap = (id, d) => ({ id, exists: !!d, data: () => JSON.parse(JSON.stringify(d)) });
  const stores = { tasks: Object.fromEntries(tasks.map(t => [t.id, t])) };
  const col = n => { const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => ({ docs: Object.entries(stores[n] || {}).map(([k, v]) => snap(k, v)) }), doc: id => ({ set: async v => { (stores[n] ||= {})[id] = v; }, delete: async () => { delete (stores[n] || {})[id]; }, get: async () => snap(id, (stores[n] || {})[id]) }) }; return q; };
  let meta = { company: "Prueba" };
  const base = { get: async () => snap("office", meta), set: async v => { meta = JSON.parse(JSON.stringify(v)); window.__meta = meta; }, collection: col };
  const s = async (q, o = {}) => { const t = "## Resumen\n- Hecho.\n\n## Entrega final\nListo."; o.onText?.({ text: t }); return { text: t }; };
  s.json = async q => (q.includes('"nota"') ? { nota: 9, fallos: [], aprendizajes: [], hechos: [] } : { skills: [], pasos: ["Paso"] });
  s.limits = async () => ({ images: false, tools: true });
  window.__stores = stores;
  window.claude = { use: async n => ({ sample: s, db: { doc: () => base }, user: { id: async () => "u1" } })[n] || null };
}, tasks);
await p.goto("file://" + file);
await p.waitForTimeout(1500);

check((await p.locator("[data-room]").count()) >= 5, "las 5 salas aparecen (incluido el Taller)");
check(await p.locator('[data-room="taller"]').count() === 1, "existe la sala Taller de producto");

await p.click('[data-view="encargos"]');
await p.waitForTimeout(300);
check(await p.locator('[data-task="t1"]').count() > 0, "Encargos lista las tareas");

await p.click('[data-view="entregables"]');
await p.waitForTimeout(300);
await p.locator('[data-task="t1"]:visible').first().click();
await p.waitForTimeout(800);
check(await p.locator("#reader").isVisible(), "el lector se abre");
check(((await p.textContent("#rDoc")) || "").includes("Opción B"), "el lector muestra el documento");
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
check(!(await p.locator("#reader").isVisible()), "Escape cierra el lector");

await p.click('[data-view="encargos"]');
await p.waitForTimeout(300);
check(((await p.textContent("#taskList")) || "").includes("se cortó"), "avisa de los encargos que se cortaron al cerrar");
await p.click('.notice [data-clean=\"resume\"]');
await p.waitForTimeout(600);
check(await p.evaluate(() => !state.tasks.some(t => t.id === "t3") && state.tasks.some(t => t.order === "Encargo cortado" && t.extra.includes("Llevaba la mitad"))), "«Retomarlos» los relanza desde lo que llevaban");
await p.evaluate(() => deleteTasks(["t2"]));
await p.waitForTimeout(300);
check(!(await p.evaluate(() => "t2" in window.__stores.tasks)), "borrar quita la tarea de la base");

// Proyectos: uno nuevo empieza vacío, sus encargos quedan aparte y se puede volver al primero.
await p.click(".proj > summary");
await p.click("[data-projnew]");
await p.fill("#nName", "Tienda");
await p.fill("#nBrief", "Tienda online de ropa.");
await p.click('#projDlg button[value="save"]');
await p.waitForTimeout(400);
check(((await p.textContent("#projName")) || "") === "Tienda", "se crea y se abre un proyecto nuevo");
check(await p.locator('[data-task="t1"]:visible').count() === 0, "el proyecto nuevo empieza sin encargos");
const pid = await p.evaluate(() => PROJ.cur);
await p.evaluate(() => { newTask({ agentId: "elena", order: "Encargo de la tienda" }).status = "done"; paintAll(); });
check(await p.evaluate(() => state.tasks.length === 1 && state.tasks[0].project === PROJ.cur), "un encargo nuevo es del proyecto abierto");
check(await p.evaluate(() => (window.__meta?.projects || []).length === 2), "la lista de proyectos se guarda");
await p.click(".proj > summary");
await p.click('[data-proj]:not([aria-current])');
await p.waitForTimeout(400);
check(await p.evaluate(pid => PROJ.cur !== pid && state.tasks.some(t => t.id === "t1") && !state.tasks.some(t => t.project === pid), pid), "al volver al primero están sus encargos y no los de la tienda");
await p.evaluate(pid => projDelete(pid), pid);
await p.waitForTimeout(300);
check(await p.evaluate(() => PROJ.list.length === 1 && !Object.values(window.__stores.tasks).some(t => t.order === "Encargo de la tienda")), "borrar un proyecto borra sus encargos");

check(errs.length === 0, "sin errores de página" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (fails.length) { console.log(`\n${fails.length} comprobaciones fallidas`); process.exit(1); }
console.log("\nTodo bien");
