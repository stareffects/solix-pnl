# SOLIX PnL Image API

Production-ready PnL image generator API for crypto trading Discord bots. The service renders a premium 1200x630 card in HTML/CSS and converts it to PNG with Puppeteer.

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
- Single shared Chromium instance for better stability under concurrent requests

## API

### GET

`/api/pnl-image.png?project=SOLIX&entry=2.5&startmc=2&endmc=26.5&gas=0.12&theme=blue`

### POST

```bash
curl -X POST http://localhost:3000/api/pnl-image \
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

1. Install dependencies:

```bash
npm install
```

2. Start the API:

```bash
npm start
```

3. Open:

```text
http://localhost:3000
```

## Deploy

### Railway

1. Create a new service from this repo.
2. Railway will detect Node automatically.
3. Set the start command to `npm start` if needed.
4. Deploy and use `/api/pnl-image` as the public image endpoint.

### Render

1. Create a new Web Service from the repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Instance type should allow Chromium execution.

### VPS

1. Install Node.js 20+.
2. Run `npm install`.
3. Start with `npm start` or use a process manager like `pm2`.
4. Put Nginx or Caddy in front if you want HTTPS and caching.

## Notes

- Puppeteer downloads a compatible Chromium during install.
- The app formats timestamps in UTC by default for consistent Discord output.
- The gas fee is displayed but not subtracted from the final `Net PnL`, per spec.
