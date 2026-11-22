// Entrega paquetes de cambios por Telegram.
// Cada paquete vive en paquetes/<id>/ con:
//   paquete.json  -> para quién es, título, resumen, mensaje del commit y archivos
//   guia.md       -> explicación sencilla del cambio para la sustentación
//   archivos/     -> los archivos listos, con la misma ruta que tienen en el repo del equipo
// El bot arma un zip, lo manda al grupo mencionando a la persona y le explica cómo subirlo.
//
// Uso: node entregar.mjs paquetes/<id>/paquete.json [otro...]
//      PRUEBA=1 node entregar.mjs ...   -> arma el zip y muestra el mensaje sin enviar
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = process.env.REPO_EQUIPO || "lilangel-stack/Control-de-mal-parqueo-e-invasi-n-del-espacio-p-blico-en-Santa-Marta";
const RAMA = process.env.RAMA || "main";
const PRUEBA = process.env.PRUEBA === "1";
const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;

const personas = JSON.parse(fs.readFileSync(new URL("./etiquetas.json", import.meta.url), "utf8")).personas || [];
const escaparHTML = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function mencion(nombre) {
  const p = personas.find((i) => i.nombre.toLowerCase() === String(nombre).toLowerCase());
  return p?.telegram ? `${p.nombre} @${p.telegram.replace(/^@/, "")}` : nombre;
}

// ¿Alguien cambió estos archivos en el repo del equipo después de que se armó el paquete?
async function archivosCambiados(archivos) {
  const cambiados = [];
  for (const a of archivos) {
    if (!a.sha_base) continue; // archivo nuevo
    try {
      const r = await fetch(`${process.env.GITHUB_API || "https://api.github.com"}/repos/${REPO}/contents/${encodeURI(a.ruta)}?ref=${RAMA}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "avisos-reto2", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      });
      if (r.ok && (await r.json()).sha !== a.sha_base) cambiados.push(a.ruta);
    } catch {}
  }
  return cambiados;
}

function instrucciones(p) {
  return `CÓMO SUBIR ESTE CAMBIO (${p.titulo})
=====================================

1. Lee guia.md para entender qué hace el cambio. En la sustentación te pueden preguntar por él.

2. Abre el repositorio del equipo en el navegador del computador:
   https://github.com/${REPO}

3. Revisa que hayas iniciado sesión con TU cuenta de GitHub (tu foto arriba a la derecha).

4. Toca "Add file" -> "Upload files".

5. Abre la carpeta "archivos" de este zip, selecciona TODO lo que hay adentro
   y arrástralo a la página de GitHub. Las carpetas se arrastran completas.
   Archivos que vas a subir:
${p.archivos.map((a) => `     - ${a.ruta}`).join("\n")}

6. Abajo, en el cuadro del mensaje (Commit changes), pega exactamente esto:
   ${p.mensaje_commit}

7. Deja marcado "Commit directly to the main branch" y toca "Commit changes".

Listo. El bot avisará al grupo que subiste el cambio.
Si GitHub dice que hay un conflicto o algo se ve raro, no lo subas y avísale a Isaac.
`;
}

async function telegram(metodo, cuerpo) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`, { method: "POST", body: cuerpo });
  const texto = await r.text();
  console.log(`Telegram ${metodo}: ${r.status}${r.ok ? "" : " " + texto.slice(0, 200)}`);
  if (!r.ok) process.exitCode = 1;
}

for (const archivoJson of process.argv.slice(2)) {
  const dir = path.dirname(archivoJson);
  const id = path.basename(dir);
  const p = JSON.parse(fs.readFileSync(archivoJson, "utf8"));

  // Validar que los archivos existan
  for (const a of p.archivos) {
    if (!fs.existsSync(path.join(dir, "archivos", a.ruta))) throw new Error(`Falta ${a.ruta} en ${dir}/archivos`);
  }

  // Armar el zip: archivos/, guia.md e INSTRUCCIONES.txt
  fs.writeFileSync(path.join(dir, "INSTRUCCIONES.txt"), instrucciones(p));
  const zip = path.resolve(`${id}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "archivos", "guia.md", "INSTRUCCIONES.txt"], { cwd: dir });

  const cambiados = await archivosCambiados(p.archivos);
  const aviso = cambiados.length
    ? `\n\n⚠️ Ojo: alguien cambió ${cambiados.join(", ")} en el repo después de que se armó este paquete. No lo subas todavía; avísale a Isaac.`
    : "";

  const leyenda =
    `<b>📦 Cambio para ${escaparHTML(mencion(p.para))}</b>\n` +
    `<b>${escaparHTML(p.titulo)}</b>\n\n` +
    `${escaparHTML(p.resumen)}\n\n` +
    `Mensaje del commit:\n<code>${escaparHTML(p.mensaje_commit)}</code>\n\n` +
    `Descarga el zip y sigue INSTRUCCIONES.txt.${escaparHTML(aviso)}`;
  const guia = fs.readFileSync(path.join(dir, "guia.md"), "utf8");
  // Los títulos "# ..." de la guía se ven en negrita en Telegram
  const guiaHTML = escaparHTML(guia.slice(0, 3500)).replace(/^#+\s*(.+)$/gm, "<b>$1</b>");
  const mensajeGuia = `<b>📖 Guía: ${escaparHTML(p.titulo)}</b>\n<blockquote expandable>${guiaHTML}</blockquote>`;

  if (PRUEBA || !TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`---- ${id} (${fs.statSync(zip).size} bytes) ----\n${leyenda}\n\n${mensajeGuia.slice(0, 400)}...`);
    console.log(execFileSync("unzip", ["-l", zip], { encoding: "utf8" }));
    continue;
  }

  const datos = new FormData();
  datos.append("chat_id", TELEGRAM_CHAT_ID);
  datos.append("caption", leyenda.slice(0, 1024));
  datos.append("parse_mode", "HTML");
  datos.append("document", new Blob([fs.readFileSync(zip)], { type: "application/zip" }), `${id}.zip`);
  await telegram("sendDocument", datos);

  const datosGuia = new FormData();
  datosGuia.append("chat_id", TELEGRAM_CHAT_ID);
  datosGuia.append("text", mensajeGuia);
  datosGuia.append("parse_mode", "HTML");
  await telegram("sendMessage", datosGuia);
}
