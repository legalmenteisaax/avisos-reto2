// Vigila el repositorio del equipo y avisa por Telegram (y Discord, si se configura)
// cada vez que alguien sube cambios. Lo corre GitHub Actions cada 30 minutos.
//
// Modos:
//   node vigilar.mjs cambios   -> busca commits nuevos desde la última revisión
//   node vigilar.mjs semana    -> resumen de los últimos 7 días
//   PRUEBA=1 ...               -> no envía nada, solo imprime
import fs from "node:fs";

const REPO = process.env.REPO_EQUIPO || "lilangel-stack/Control-de-mal-parqueo-e-invasi-n-del-espacio-p-blico-en-Santa-Marta";
const RAMA = process.env.RAMA || "main";
const ESTADO = process.env.ARCHIVO_ESTADO || "estado/ultimo-commit.txt";
const MODO = process.argv[2] || "cambios";
const PRUEBA = process.env.PRUEBA === "1";
const URL_REPO = `https://github.com/${REPO}`;

// ---------- GitHub ----------
async function gh(ruta) {
  const r = await fetch(`${process.env.GITHUB_API || "https://api.github.com"}/repos/${REPO}${ruta}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "avisos-reto2",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}`);
  return r.json();
}

// La lista del equipo vive en el repo del equipo, para que ellos mismos puedan editarla.
async function cargarEquipo() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${RAMA}/.github/avisos/equipo.json`);
    if (r.ok) return await r.json();
  } catch {}
  return { integrantes: [], contexto: "" };
}
const equipo = await cargarEquipo();

function persona(nombre, correo, login) {
  const clave = (correo || "").toLowerCase();
  const p = equipo.integrantes.find(
    (i) => (i.correos || []).some((c) => c.toLowerCase() === clave) || (i.alias || []).includes(nombre) || (i.alias || []).includes(login),
  );
  return p?.nombre || nombre || login || "Alguien";
}

// ---------- Qué es cada archivo, en palabras simples ----------
const PARTES = [
  [/^datos\/reportes\.json$/, "los registros de campo", "Analista de campo"],
  [/^datos\/vias\.json$/, "las cuadras de la zona y su tipo de vía", "Analista de campo"],
  [/^fotos\//, "las fotos pixeladas", "Analista de campo"],
  [/^datos\/criterios\.json$/, "los pesos y niveles de la criticidad", "Ingeniero de lógica"],
  [/^criticidad\.js$/, "el cálculo de la criticidad", "Ingeniero de lógica"],
  [/^cuadras\.js$/, "cómo se asigna la cuadra a cada reporte", "Ingeniero de lógica"],
  [/^filtros\.js$/, "los filtros del tablero", "Ingeniero de lógica"],
  [/^resumen\.js$/, "el resumen operativo (top 5 de cuadras y recomendaciones)", "Ingeniero de lógica"],
  [/^mapa\.js$/, "el mapa y el mapa de calor", "Integrador del mapa"],
  [/^captura\.js$/, "el formulario de reporte y el tablero", "Diseñador de interfaz"],
  [/^index\.html$/, "la estructura de las pantallas", "Diseñador de interfaz"],
  [/^styles\.css$/, "los colores y el diseño", "Diseñador de interfaz"],
  [/^README\.md$/, "el README", "Documentador"],
  [/^documentos\//, "los documentos de entrega", "Documentador"],
  [/^\.github\//, "los avisos automáticos del equipo", "Apoyo técnico"],
];

function describirArchivos(archivos) {
  const partes = new Map();
  for (const archivo of archivos) {
    const [, que, rol] = PARTES.find(([patron]) => patron.test(archivo)) ?? [null, archivo, "Sin rol"];
    if (!partes.has(que)) partes.set(que, rol);
  }
  return [...partes.entries()].map(([que, rol]) => `• ${que} (${rol})`).join("\n");
}

// ---------- IA opcional (cualquier servicio compatible con OpenAI) ----------
async function explicarConIA(instruccion, contenido) {
  const { IA_URL, IA_KEY, IA_MODELO } = process.env;
  if (!IA_URL || !IA_KEY || !IA_MODELO) return null;
  try {
    const r = await fetch(IA_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${IA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IA_MODELO,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: (equipo.contexto || "") + "\n\n" + instruccion },
          { role: "user", content: contenido },
        ],
      }),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 120)}`);
    return JSON.parse(texto).choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.log(`La IA no respondió, se usa el aviso sin IA. ${error.message}`);
    return null;
  }
}

// ---------- Envío ----------
const escaparHTML = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Etiquetas: cada persona de etiquetas.json recibe una mención en el aviso de Telegram.
function etiquetasTelegram() {
  let lista = [];
  try {
    lista = JSON.parse(fs.readFileSync(new URL("./etiquetas.json", import.meta.url), "utf8")).telegram || [];
  } catch {}
  return lista
    .map((p) =>
      p.usuario
        ? `@${String(p.usuario).replace(/^@/, "")}`
        : p.id
          ? `<a href="tg://user?id=${Number(p.id)}">${escaparHTML(p.nombre || "integrante")}</a>`
          : "",
    )
    .filter(Boolean)
    .join(" ");
}

async function enviar({ titulo, cuerpo, enlace, textoEnlace }) {
  const etiquetas = etiquetasTelegram();
  const telegram =
    `<b>${escaparHTML(titulo)}</b>\n\n${escaparHTML(cuerpo)}` +
    (enlace ? `\n\n<a href="${enlace}">${escaparHTML(textoEnlace)}</a>` : "") +
    (etiquetas ? `\n\n👥 ${etiquetas}` : "");
  const discord = `**${titulo}**\n\n${cuerpo}` + (enlace ? `\n\n[${textoEnlace}](<${enlace}>)` : "");
  if (PRUEBA) {
    console.log("---- Telegram ----\n" + telegram + "\n");
    return;
  }
  const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, DISCORD_WEBHOOK } = process.env;
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: telegram.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    console.log(`Telegram: ${r.status}${r.ok ? "" : " " + (await r.text()).slice(0, 200)}`);
    if (!r.ok) process.exitCode = 1;
  }
  if (DISCORD_WEBHOOK) {
    const r = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Avisos del equipo", content: discord.slice(0, 1990) }),
    });
    console.log(`Discord: ${r.status}`);
    if (!r.ok) process.exitCode = 1;
  }
  if (!TELEGRAM_TOKEN && !DISCORD_WEBHOOK) {
    console.log("Faltan los secretos TELEGRAM_TOKEN y TELEGRAM_CHAT_ID. Mensaje que se habría enviado:\n" + discord);
  }
}

// ---------- Cambios nuevos ----------
async function revisarCambios() {
  const cabeza = (await gh(`/commits/${RAMA}`)).sha;
  const anterior = fs.existsSync(ESTADO) ? fs.readFileSync(ESTADO, "utf8").trim() : "";

  if (!anterior) {
    // Primera vez: se guarda el punto de partida y se avisa que quedó conectado, sin repetir el historial viejo.
    await enviar({
      titulo: "✅ Avisos del Reto 2 conectados",
      cuerpo: "Desde ahora, cada vez que alguien suba un cambio al proyecto, llega un aviso aquí. Los domingos en la noche llega el resumen de la semana.",
      enlace: `${URL_REPO}/commits/${RAMA}`,
      textoEnlace: "Ver el historial del proyecto",
    });
  } else if (anterior === cabeza) {
    console.log("Sin cambios nuevos.");
  } else {
    const comparacion = await gh(`/compare/${anterior}...${cabeza}`);
    const commits = comparacion.commits || [];
    // Un aviso por persona, con todos sus commits juntos
    const porPersona = new Map();
    for (const c of commits) {
      if ((c.parents || []).length > 1) continue; // merges
      const quien = persona(c.commit.author?.name, c.commit.author?.email, c.author?.login);
      if (!porPersona.has(quien)) porPersona.set(quien, []);
      porPersona.get(quien).push(c);
    }
    for (const [quien, lista] of porPersona) {
      const mensajes = lista.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
      // Archivos que tocó esta persona (cada commit trae su propia lista)
      const archivosPersona = new Map();
      for (const c of lista) {
        for (const f of (await gh(`/commits/${c.sha}`)).files || []) archivosPersona.set(f.filename, f.patch || "");
      }
      const archivos = [...archivosPersona.keys()];
      const parches = [...archivosPersona].map(([nombre, parche]) => `## ${nombre}\n${parche.slice(0, 3000)}`).join("\n").slice(0, 14000);
      const explicacion = await explicarConIA(
        `Explica este cambio para estudiantes de 16 a 19 años que no saben programar, en español de Colombia, en 2 a 4 frases cortas y sin palabras técnicas. Di qué cambió en la app o en los documentos y para qué sirve. Si afecta un requerimiento del reto, agrega una línea que empiece con "⚠️" diciendo cuál. Termina con "Rol: ..." con el rol al que le toca. No inventes nada.`,
        `Commits:\n${mensajes}\n\nCambios:\n${parches}`,
      );
      const plural = lista.length === 1 ? "un cambio" : `${lista.length} cambios`;
      await enviar({
        titulo: `🔔 ${quien} subió ${plural} al proyecto`,
        cuerpo: explicacion || `Lo que dice el cambio:\n${mensajes}\n\nPartes del proyecto que tocó:\n${describirArchivos(archivos) || "—"}`,
        enlace: `${URL_REPO}/compare/${anterior.slice(0, 7)}...${cabeza.slice(0, 7)}`,
        textoEnlace: "Ver el cambio en GitHub",
      });
    }
  }

  // Solo se guarda el avance cuando hay a dónde avisar; así el primer aviso real no se pierde.
  const hayCanal = (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.DISCORD_WEBHOOK;
  if (!PRUEBA && hayCanal && process.exitCode !== 1) {
    fs.mkdirSync(ESTADO.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    fs.writeFileSync(ESTADO, cabeza + "\n");
  }
}

// ---------- Resumen de la semana ----------
async function resumirSemana() {
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const commits = (await gh(`/commits?sha=${RAMA}&since=${desde}&per_page=100`)).filter((c) => (c.parents || []).length < 2);
  const porPersona = new Map();
  for (const c of commits) {
    const quien = persona(c.commit.author?.name, c.commit.author?.email, c.author?.login);
    porPersona.set(quien, (porPersona.get(quien) || 0) + 1);
  }
  const conteo = [...porPersona.entries()].map(([q, n]) => `• ${q}: ${n} cambio(s)`).join("\n");
  const sinAportes = equipo.integrantes.map((p) => p.nombre).filter((n) => !porPersona.has(n));
  const cuerpo = [
    commits.length ? conteo : "Esta semana nadie subió cambios al proyecto.",
    sinAportes.length ? `Sin cambios esta semana: ${sinAportes.join(", ")}. Recuerden que el profesor revisa el historial de cada uno.` : "",
  ].filter(Boolean).join("\n\n");
  await enviar({ titulo: "📋 Resumen de la semana", cuerpo, enlace: `${URL_REPO}/commits/${RAMA}`, textoEnlace: "Ver todo el historial" });
}

await (MODO === "semana" ? resumirSemana() : revisarCambios());
