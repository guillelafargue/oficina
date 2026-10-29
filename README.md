# Oficina

Una empresa virtual en tu móvil y tu ordenador: una planta de oficina con 20 agentes de IA, cada uno en su puesto y especializado en un departamento. Les das órdenes, Dirección las reparte, o dejas que el equipo trabaje solo.

## Qué hay dentro

- **5 salas pixel-art** (Dirección, Estudio creativo, Ingeniería y datos, Comercial y Taller de producto) dibujadas por código en un canvas: los agentes se sientan en su puesto, se levantan a por café, pasean y, cuando trabajan, la pantalla se enciende y aparece un bocadillo con el paso en el que van.
- **Interfaz sobria**: tema claro (y oscuro automático), pestañas de texto arriba, listas con líneas finas. El único color fuerte es la sala.
- **20 puestos**, cada uno con el nombre de su especialidad: Dirección, Producto, Finanzas, Legal, Personas, Vídeo, Diseño, Redes, Copy, Desarrollo, DevOps, SEO, IA, Marketing, Ventas, Soporte, Auditoría, Interfaz, Implementación y Calidad.
- **265 skills**: métodos profesionales reales (ecuación de valor de Hormozi, StoryBrand, PAS/AIDA, JTBD, RICE, OKR, SPIN, MEDDICC, Chris Voss, HEARD, WCAG, SRE, TDD…). Muchas se inspiran en las bibliotecas públicas de skills más usadas (anthropics/skills, obra/superpowers, coreyhaines31/marketingskills) y cada una indica en qué se basa. Puedes crear las tuyas.
- **Referentes por puesto**: cada puesto trabaja con el criterio de 5-6 referentes mundiales de su especialidad (Walter Murch y MrBeast en vídeo, Dieter Rams en diseño, Ogilvy y Schwartz en copy, Kent Beck y Fowler en desarrollo…). Están en `src/expert.js` y sus obras y principios en `src/canon.js`.
- **Stack puntero de 2026** (`src/stack.js`): cada puesto domina las herramientas de primera línea de su sector y sabe entregar para ellas. Vídeo trabaja con HyperFrames, Remotion, GSAP, Veo, Kling, Seedance, ElevenLabs o DaVinci; Diseño con Figma, Rive, Jitter, GPT Image, Nano Banana o Recraft; Redes con TikTok Creative Center, Edits, Opus Clip o ManyChat; Desarrollo con Next.js 16, React Compiler, Supabase, Expo o Capacitor; SEO también cubre ASO y visibilidad en respuestas de IA.
- **Vista en vivo**: cuando una entrega trae una composición HyperFrames o un prototipo en HTML, el botón «Ver en vivo» la reproduce dentro de la oficina y «Descargar MP4» la graba fotograma a fotograma en el propio navegador (WebCodecs + mp4-muxer, H.264, sin audio); «Descargar HTML» la deja lista para `npx hyperframes render` si se quiere un render con audio.
- **Contexto**: sube la carpeta de tu app, archivos sueltos, texto pegado o un repositorio público de GitHub. En cada encargo el puesto recibe los fragmentos más relevantes y, dentro de Claude, puede buscar y abrir cualquier archivo con herramientas. También puede leer los archivos del proyecto de Claude si lo activas.
- **Aprenden solos**:
  - Tras cada entrega, el puesto se autoevalúa con el criterio de sus referentes. Si no llega a 8, rehace el trabajo él solo.
  - Guarda lecciones en su memoria y la empresa acumula los hechos y decisiones del proyecto.
  - Tus valoraciones («Útil» o «Mejorable») se convierten en reglas prioritarias.
  - Cada 5 encargos, el puesto crea una skill propia a partir de su experiencia.
  - Las lecciones se consolidan solas cuando pasan de 24.
- **Trabajo autónomo continuo** (en Ajustes): mientras la app está abierta, Dirección lanza rondas cada 15-120 minutos y prioriza rehacer lo que salió flojo.
- **Encargos por pasos**: en modo *Por pasos* el agente planifica 3-6 pasos y los ejecuta en orden; el panel *En marcha* muestra «Paso 3 de 5».
- **Orden a la empresa**: Dirección organiza fases (las tareas de una fase van en paralelo y las siguientes usan lo anterior) y cierra con un informe ejecutivo.
- **Proyectos separados**: arriba, junto a «Oficina», eliges el proyecto. Cada uno tiene su descripción, su repositorio, su contexto, sus encargos, sus entregables y los hechos que la empresa aprende de él; el equipo, sus skills y lo que aprenden de su oficio son los mismos en todos. Un encargo lanzado en un proyecto termina en ese proyecto aunque cambies a otro.
- **Taller de producto**: Auditoría, Interfaz, Implementación y Calidad revisan la app (FuelIron o la propia oficina), encuentran lo que falta o se puede mejorar y lo dejan listo para aplicar. Con el modo continuo (Ajustes › Taller de producto) hacen rondas solas y, si lo permites, mandan los cambios a Claude Code, que abre el PR y lo fusiona (con un tope al día). «Revisar la app ahora» lanza una ronda a mano.
- **Lector de entregas**: cada entrega se abre como un documento ordenado: resumen arriba, propuestas en tarjetas (la recomendada marcada), tablas, diagramas y plannings dibujados, bocetos web que se ven dentro, índice a un lado y el proceso plegado al final.
- **Descargar en PDF, Word o Markdown** una entrega o varias juntas, con índice y anexo de cómo se ha trabajado.
- **Aplicar en la app**: las entregas con «Cambios para Claude Code» se mandan a una sesión de Claude Code en el repositorio que elijas; el estado se ve en el propio lector.
- **Gestión de encargos**: buscar, seleccionar varios, archivar, borrar en bloque, limpiar errores y archivar lo terminado; detener un encargo en marcha; el progreso se guarda y lo interrumpido se puede retomar.
- **Ronda autónoma**, **traspasos** entre agentes («pasar a Vídeo el guion de Copy»), **revisar y mejorar**, imágenes de referencia, copiar y descargar en Markdown, y **exportar** desde Entregables todo junto, por sala o por puesto en un solo archivo con índice.

La plantilla vive en `src/data.js` (salas, agentes, skills) y el motor pixel-art en `src/office.js`.

## Cómo usarla como app

- **En el móvil o el ordenador, dentro de Claude**: abre el enlace del artifact en la app de Claude. Funciona sin claves y guarda todo en tu cuenta.
- **Instalada como app (PWA)**: cada cambio en `main` se publica solo en GitHub Pages (`.github/workflows/pages.yml`), en https://guillelafargue.github.io/oficina/. Ábrela en el móvil y elige «Añadir a pantalla de inicio» (en el ordenador, el icono de instalar de la barra de direcciones). La primera vez pide tu clave de API de Anthropic en *Ajustes*.

## Dónde se ejecuta

- **Dentro de Claude** (artifact): usa tu cuenta de Claude, sin claves. Las entregas se guardan en la base de datos privada del artifact.
- **Como PWA independiente** (`public/`): sirve la carpeta en cualquier hosting estático (GitHub Pages, Vercel, Netlify), ábrela en el móvil y "Añadir a pantalla de inicio". Pide tu clave de API de Anthropic en *Ajustes*; se guarda solo en tu navegador.

## Desarrollo

```bash
python3 build.py          # genera build/oficina.html (artifact) y public/index.html (PWA)
python3 -m http.server -d public 8080
node tests/smoke.mjs     # prueba de humo (Playwright); también corre en cada PR
```
