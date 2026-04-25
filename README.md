# SOLIX PnL Image API

Production-ready PnL image generator API for crypto trading Discord bots. The service renders a premium 1200x630 card in HTML/CSS and converts it to PNG with Puppeteer-compatible Chromium.

## Features

- Discord-ready `image/png` output at `1200x630`
- GET query params and POST JSON support
- Flexible parsing for:
  - `entry`: `2.5` or `2,5`
  - `startmc` / `endmc`: `2`, `2k`, `1000k`, `1m`, `1.25m`
  - `gas`: numeric input
- Automatic calculations:
  - `multiplier = endmc / startmc`
  - `profit = entry * (multiplier - 1)`
  - `netPnL = profit`
- Optional `theme=blue|green`
- Vercel-friendly runtime using `puppeteer-core` and `@sparticuz/chromium-min`

## API

### GET

`/api/pnl-image.png?project=SOLIX&entry=2.5&startmc=2&endmc=26.5&gas=0.12&theme=blue`

### POST

```bash
curl -X POST http://localhost:3000/api/pnl-image.png \
  -H "Content-Type: application/json" \
  --data "{\"project\":\"SOLIX\",\"entry\":\"2.5\",\"startmc\":\"2\",\"endmc\":\"26.5\",\"gas\":0.12,\"theme\":\"green\"}" \
  --output pnl.png
```

### Supported fields

- `project`: optional, defaults to `SOLIX`
- `entry`: required
- `startmc`: required
- `endmc`: required
- `gas`: optional, defaults to `0`
- `theme`: optional, `blue` or `green`
- `timestamp` or `datetime`: optional ISO date string

## Local run

Local development uses `puppeteer-core`, so you need a local Chrome or Edge binary.

1. Install dependencies:

```bash
npm install
```

2. If the server cannot find Chrome automatically, set `CHROMIUM_LOCAL_EXEC_PATH`.

Windows examples:

```powershell
$env:CHROMIUM_LOCAL_EXEC_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

```powershell
$env:CHROMIUM_LOCAL_EXEC_PATH="C:\Program Files\Microsoft\Edge\Application\msedge.exe"
```

3. Start the API:

```bash
npm start
```

## Vercel deploy

This project is now structured for Vercel:

- Static landing page: `/`
- API endpoint: `/api/pnl-image`
- Discord-friendly alias: `/api/pnl-image.png`

### Deploy steps

1. Push the project to GitHub.
2. Create a free Hobby account on Vercel.
3. Import the GitHub repo in the Vercel dashboard.
4. Leave the framework as `Other`.
5. Deploy.

### Optional environment variables

- `CHROMIUM_REMOTE_EXEC_PATH`

If you want to override the default remote Chromium pack URL, set this in Vercel project settings. The code already includes a default GitHub-hosted Chromium pack URL, so this is usually not required.

## BotGhost usage

Use the deployed URL directly in your embed image field or Media Gallery:

```text
https://your-project.vercel.app/api/pnl-image.png?project=SOLIX&entry={option_entry}&startmc={option_startmc}&endmc={option_endmc}&gas={option_gas}&theme=blue
```

## Notes

- The gas fee is displayed but not subtracted from the final `Net PnL`, per spec.
- Vercel Hobby functions are time-limited, so keep the card render lightweight.
- First request after a cold start may be slower than warm requests.
