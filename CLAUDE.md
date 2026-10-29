# Oficina: contexto para Claude

Oficina es una empresa virtual pixel-art con agentes de IA (artifact de Claude y PWA). El dueño es Guille, no es programador: háblale en español de España, claro y sin tecnicismos.

## Normas
- Los puestos se llaman por su especialidad (Dirección, Diseño, Auditoría…), nunca con nombres de persona.
- Diseño limpio que no parezca hecho por IA: sin neón sobre azul marino, sin pastillas por todas partes, sin fuentes pixel en la interfaz y sin emojis. El único color fuerte es la sala.
- Fusiona tú los PR (squash) cuando la prueba de humo pase; no hace falta pedir permiso.

## Estructura
- `src/data.js` salas, puestos y skills · `src/expert.js` referentes · `src/canon.js` obras y principios · `src/stack.js` herramientas · `src/taller.js` sala «Taller de producto» (Auditoría, Interfaz, Implementación, Calidad) · `src/office.js` motor pixel-art y planos · `src/app.html` y `src/app.js` interfaz · `src/work.js` lector de entregas, exportar PDF/Word/Markdown, gestión de encargos, «Aplicar en la app» (Claude Code) y rondas del Taller.
- `build.py` lo junta todo en `build/oficina.html` (artifact) y `public/index.html` (PWA, GitHub Pages).

## Comprobar un cambio
```bash
python3 build.py
node tests/smoke.mjs build/oficina.html   # necesita playwright (en CI: npm install --no-save playwright)
node tests/smoke.mjs public/index.html
```
La prueba simula `window.claude` sin red. Si añades algo importante, añade una comprobación.

## Publicar el artifact
Tras fusionar, vuelve a publicar `build/oficina.html` en https://claude.ai/artifact/6Y83Rf3U27ywyEWRxeEUNM con estas capacidades completas (si se publica con otras, se pierden):
```json
{
  "sample": { "images": true }, "db": {}, "user": {}, "downloads": true,
  "files": { "project": "chan_015TVUFLhe9PXKUosqCZa5MN" },
  "mcp": { "servers": [{ "server": "Claude Code Remote", "tools": ["list_environments", "create_trigger", "fire_trigger", "get_session"] }] }
}
```
Si no puedes publicar desde tu sesión, déjalo dicho en el PR.
