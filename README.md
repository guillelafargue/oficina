# Oficina

Una empresa virtual en tu móvil y tu ordenador: una planta de oficina con 15 agentes de IA, cada uno en su puesto y especializado en un departamento. Les das órdenes, Dirección las reparte, o dejas que el equipo trabaje solo.

## Qué hay dentro

- **4 salas pixel-art** (Dirección, Estudio creativo, Ingeniería y datos, Comercial) dibujadas por código en un canvas: los agentes se sientan en su puesto, se levantan a por café, pasean y, cuando trabajan, la pantalla se enciende y aparece un bocadillo con el paso en el que van.
- **16 agentes**: Elena (CEO), Marco (producto), Tomás (finanzas), Carmen (legal), Pablo (personas), Dani (vídeo), Lucía (diseño), Sofía (redes), Bruno (copy), Kai (full-stack), Iván (DevOps/QA), Irene (SEO y datos), Hugo (IA y automatización), Álex (marketing), Rocío (ventas) y Lola (atención al cliente).
- **80 skills**: métodos profesionales reales (ecuación de valor de Hormozi, StoryBrand, PAS/AIDA, JTBD, RICE, OKR, SPIN, HEARD, heurísticas de Nielsen, árbol de nodos de DaVinci, OWASP…). Puedes crear las tuyas.
- **Encargos por pasos**: en modo *Profundo* el agente planifica 3-6 pasos y los ejecuta en orden; el panel *En marcha* muestra «Paso 3/5».
- **Orden a la empresa**: Elena organiza fases (las tareas de una fase van en paralelo y las siguientes usan lo anterior) y cierra con un informe ejecutivo.
- **Ronda autónoma**, **traspasos** entre agentes («pasar a Dani el guion de Bruno»), **revisar y mejorar**, imágenes de referencia, copiar y descargar en Markdown.

La plantilla vive en `src/data.js` (salas, agentes, skills) y el motor pixel-art en `src/office.js`.

## Dónde se ejecuta

- **Dentro de Claude** (artifact): usa tu cuenta de Claude, sin claves. Las entregas se guardan en la base de datos privada del artifact.
- **Como PWA independiente** (`public/`): sirve la carpeta en cualquier hosting estático (GitHub Pages, Vercel, Netlify), ábrela en el móvil y "Añadir a pantalla de inicio". Pide tu clave de API de Anthropic en *Proyecto y ajustes*; se guarda solo en tu navegador.

## Desarrollo

```bash
python3 build.py          # genera build/oficina.html (artifact) y public/index.html (PWA)
python3 -m http.server -d public 8080
```
