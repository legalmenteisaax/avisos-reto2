# Avisos del Reto 2

Revisa cada 30 minutos el repositorio del equipo y avisa por Telegram (y Discord, si se configura) cada cambio que alguien sube, explicado en palabras simples. Los domingos en la noche manda el resumen de la semana.

## Configuración

En **Settings → Secrets and variables → Actions** de este repositorio:

| Secreto | Qué es |
| --- | --- |
| `TELEGRAM_TOKEN` | Token del bot, de @BotFather |
| `TELEGRAM_CHAT_ID` | ID del grupo (número negativo) |
| `DISCORD_WEBHOOK` | Opcional: URL del webhook del canal |
| `IA_URL`, `IA_KEY`, `IA_MODELO` | Opcional: servicio de IA compatible con OpenAI para explicar los cambios |

Los nombres de los integrantes se leen de `.github/avisos/equipo.json` en el repositorio del equipo.
