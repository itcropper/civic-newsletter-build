# City branding overrides

Each subfolder here corresponds to a city's `subdomain` value in the `cities` table.
Files dropped here override the auto-fetched values stored in `cities.branding_json`.

## What goes in a city folder

- `colors.json` — `{ "primary": "#HEX", "secondary": "#HEX" }`. Either or both keys.
- `hero.jpg` (or `.jpeg`, `.png`, `.webp`) — the hero image that sits behind the site title.
  The first matching extension wins.

## Adding a new override

1. `mkdir web/branding/<subdomain>`
2. Drop a `colors.json` and/or `hero.{jpg,png}` in that folder.
3. Redeploy. Override is read at request time / build time and takes precedence over `branding_json`.

## Picking colors

For civic content, dark cool primaries (navy, slate, deep teal) paired with
warm secondaries (gold, brick, tan) read as serious and trustworthy without
looking corporate. Avoid neon, gradients, and high-saturation primaries.
