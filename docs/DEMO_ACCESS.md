# LokPulse demo access

Branch: `integration/final-lokpulse`

After pulling, confirm the current final commit with:

```
git log -1 --oneline
```

The presentation lock commit message is:

`feat: finalize lokpulse demo experience and access`

## Teammate workflow

```
git clone https://github.com/Kashif2310-bot/sih2026.git
cd sih2026
git checkout integration/final-lokpulse
npm install
npm run demo:lan
```

Then open the **Network** URL printed by Vite. It looks like:

```
http://192.168.x.x:5173/
```

Use the same Wi-Fi / LAN as the machine running Vite. `localhost` on a phone is that phone, not the demo host.

## Commands

| Purpose | Command |
| --- | --- |
| Local only | `npm run dev` |
| LAN / friends | `npm run demo:lan` |

`demo:lan` is `vite --host 0.0.0.0`.

## Windows / firewall

On Windows, allow Node.js / Vite through the firewall for **Private** networks the first time the LAN bind is used. If a teammate cannot load the Network URL, check that:

- both devices are on the same Wi-Fi
- the host machine is on a private/home network profile
- Windows Firewall is not blocking inbound port `5173`

## Environment variables

The core citizen → analysis → apply → review → approval → tracking demo does **not** require secrets.

Optional values are documented in `.env.example`. Do not share secret environment values, service-role keys, Gemini API keys, or personal access tokens.

Never put a long-lived Gemini API secret in frontend code or in a `VITE_*` variable.

Ollama (`http://localhost:11434`) is an optional local LLM on the developer machine. LAN visitors are not sent to their own loopback Ollama; the text assistant still works.

## Public hosting

LAN access is the mandatory teammate path. A Netlify/Vercel public URL is optional and is not required for this presentation lock.

If a public URL is published later, record it here without embedding secrets.
