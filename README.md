# Oficina

Una empresa virtual en tu móvil y tu ordenador: una planta de oficina con 16 agentes de IA, cada uno en su puesto y especializado en un departamento. Les das órdenes, Dirección las reparte, o dejas que el equipo trabaje solo.

## Qué hay dentro

- **4 salas pixel-art** (Dirección, Estudio creativo, Ingeniería y datos, Comercial) dibujadas por código en un canvas: los agentes se sientan en su puesto, se levantan a por café, pasean y, cuando trabajan, la pantalla se enciende y aparece un bocadillo con el paso en el que van.
- **Interfaz sobria**: tema claro (y oscuro automático), pestañas de texto arriba, listas con líneas finas. El único color fuerte es la sala.
- **16 puestos**, cada uno con el nombre de su especialidad: Dirección, Producto, Finanzas, Legal, Personas, Vídeo, Diseño, Redes, Copy, Desarrollo, DevOps, SEO, IA, Marketing, Ventas y Soporte.
- **183 skills**: métodos profesionales reales (ecuación de valor de Hormozi, StoryBrand, PAS/AIDA, JTBD, RICE, OKR, SPIN, MEDDICC, Chris Voss, HEARD, WCAG, SRE, TDD…). Muchas se inspiran en las bibliotecas públicas de skills más usadas (anthropics/skills, obra/superpowers, coreyhaines31/marketingskills) y cada una indica en qué se basa. Puedes crear las tuyas.
- **Referentes por puesto**: cada puesto trabaja con el criterio de 5-6 referentes mundiales de su especialidad (Walter Murch y MrBeast en vídeo, Dieter Rams en diseño, Ogilvy y Schwartz en copy, Kent Beck y Fowler en desarrollo…). Están en `src/expert.js`.
- **Contexto**: sube la carpeta de tu app, archivos sueltos, texto pegado o un repositorio público de GitHub. En cada encargo el puesto recibe los fragmentos más relevantes y, dentro de Claude, puede buscar y abrir cualquier archivo con herramientas. También puede leer los archivos del proyecto de Claude si lo activas.
- **Encargos por pasos**: en modo *Por pasos* el agente planifica 3-6 pasos y los ejecuta en orden; el panel *En marcha* muestra «Paso 3 de 5».
- **Orden a la empresa**: Dirección organiza fases (las tareas de una fase van en paralelo y las siguientes usan lo anterior) y cierra con un informe ejecutivo.
- **Ronda autónoma**, **traspasos** entre agentes («pasar a Vídeo el guion de Copy»), **revisar y mejorar**, imágenes de referencia, copiar y descargar en Markdown.

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
```
