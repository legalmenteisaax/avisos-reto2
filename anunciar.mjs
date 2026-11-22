// Publica en el grupo de Telegram los anuncios de anuncios/<id>.json y, si se pide, los fija.
// Formato: { "texto": "mensaje en HTML de Telegram", "fijar": true }
// Uso: node anunciar.mjs anuncios/<id>.json [...]   (PRUEBA=1 solo imprime)
import fs from "node:fs";

const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const PRUEBA = process.env.PRUEBA === "1";

async function telegram(metodo, datos) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const j = await r.json();
  console.log(`Telegram ${metodo}: ${r.status}${j.ok ? "" : " " + (j.description || "")}`);
  return j;
}

for (const archivo of process.argv.slice(2)) {
  const anuncio = JSON.parse(fs.readFileSync(archivo, "utf8"));
  if (PRUEBA || !TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`---- ${archivo} ----\n${anuncio.texto}`);
    continue;
  }
  const enviado = await telegram("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: anuncio.texto,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!enviado.ok) process.exitCode = 1;
  else if (anuncio.fijar) {
    // Fijar necesita que el bot sea admin del grupo; si no lo es, el anuncio igual queda enviado.
    await telegram("pinChatMessage", { chat_id: TELEGRAM_CHAT_ID, message_id: enviado.result.message_id, disable_notification: true });
  }
}
