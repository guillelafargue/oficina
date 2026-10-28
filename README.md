# Oficina

Una empresa virtual en tu móvil y tu ordenador: una planta de oficina con 15 agentes de IA, cada uno en su puesto y especializado en un departamento. Les das órdenes, Dirección las reparte, o dejas que el equipo trabaje solo.

## Departamentos y agentes

| Departamento | Agente | Especialidad |
|---|---|---|
| Dirección General | Elena | CEO: planifica, reparte el trabajo y escribe el informe ejecutivo |
| Producto y Estrategia | Marco | Product manager |
| Ingeniería | Kai, Iván | Full-stack · DevOps y QA |
| Diseño | Lucía | Producto y marca |
| Vídeo y Audiovisual | Dani | Edición profesional, color, sonido, guion |
| Redes Sociales | Sofía | Social media manager |
| Marketing y Ventas | Álex | CMO y ventas |
| Contenidos y Copy | Bruno | Copywriter |
| SEO y Analítica | Irene | SEO y datos |
| I+D e IA | Hugo | Agentes y automatización |
| Finanzas | Tomás | CFO |
| Legal | Carmen | Asesora legal |
| Personas y Cultura | Pablo | RR. HH. |
| Atención al Cliente | Lola | Soporte |

Cada agente tiene su lista de herramientas (DaVinci Resolve, Figma, Meta Ads, GA4…) y skills, que se le pasan en cada tarea. La plantilla vive en `AGENTS` y `DEPTS` dentro de `src/app.html`: añadir un agente es añadir un objeto.

## Cómo funciona

- **Orden a la empresa**: Elena devuelve un plan (JSON) con 2–5 tareas, las ejecutan los agentes (dos a la vez) y Elena cierra con un informe.
- **Orden directa**: toca un avatar y encarga algo solo a ese agente.
- **Ronda autónoma**: Elena decide qué es lo más útil a continuación según el proyecto y lo ya entregado.
- Todos leen la descripción del proyecto y las últimas entregas del equipo, así trabajan de forma coherente.

## Dónde se ejecuta

- **Dentro de Claude** (artifact): usa tu cuenta de Claude, sin claves. Las entregas se guardan en la base de datos privada del artifact.
- **Como PWA independiente** (`public/`): sirve la carpeta en cualquier hosting estático (GitHub Pages, Vercel, Netlify), ábrela en el móvil y "Añadir a pantalla de inicio". Pide tu clave de API de Anthropic en *Proyecto y ajustes*; se guarda solo en tu navegador.

## Desarrollo

```bash
python3 build.py          # regenera public/index.html desde src/app.html
python3 -m http.server -d public 8080
```
