# Civic Newsletter Landing Pages

Three standalone HTML subscribe/landing pages for city-specific civic newsletters. Built with Tailwind CSS (CDN), Google Fonts (Inter), and zero dependencies.

## Files

| File | City | Accent Color |
|------|------|-------------|
| `birmingham-al.html` | Birmingham, AL | Civic Red (#B22234) + Gold |
| `savannah-ga.html` | Savannah, GA | Navy (#1B3A5C) + Gold |
| `topeka-ks.html` | Topeka, KS | Green (#2E6B3E) + Amber Gold |

Colors are derived from each city's flag/official branding.

---

## Deployment Options

### Option A: Beehiiv Custom Pages (Recommended)

1. Log in to Beehiiv and navigate to your publication for the relevant city.
2. Go to **Website > Custom Pages** and click **Add Page**.
3. Open the relevant `.html` file in a text editor.
4. Copy the entire `<body>` content (everything between `<body>` and `</body>`).
5. Paste into Beehiiv's HTML editor block.
6. Update the form `action` attribute: replace `action="#"` with the Beehiiv embed URL for that publication (found under **Grow > Forms > Embed**).
7. Publish the page.

> **Note:** Beehiiv's custom page builder may strip some `<script>` tags including the Tailwind config block. If styles break, switch to the **Full HTML** mode and paste the entire file including `<head>`.

### Option B: Static Hosting (Simplest standalone option)

These files are fully self-contained and can be hosted on any static host:

- **Netlify Drop**: Go to [app.netlify.com/drop](https://app.netlify.com/drop), drag the `landing-pages/` folder in.
- **GitHub Pages**: Push to a repo, enable Pages in Settings, point to the folder.
- **Cloudflare Pages**: Connect to a GitHub repo or use the CLI: `wrangler pages publish landing-pages/`
- **Amazon S3 + CloudFront**: Upload files, enable Static Website Hosting, set `index.html` as default.

### Option C: Embed as iFrame

If you're using a CMS or page builder that doesn't support raw HTML, host the files on any static host (Option B above) and embed via iFrame:

```html
<iframe src="https://your-host.com/birmingham-al.html" width="100%" height="800" frameborder="0"></iframe>
```

---

## Connecting the Subscribe Form

Each form currently has `action="#"` and `onsubmit="return false;"` as a placeholder. To activate:

1. In Beehiiv, go to **Grow > Forms** for each publication.
2. Copy the **Embed URL** (a POST endpoint like `https://embeds.beehiiv.com/...`).
3. In the HTML file, replace `action="#"` with that URL.
4. Remove `onsubmit="return false;"` from the `<form>` tag.
5. Optionally add `method="POST"` if not already present (it is).

Each city's publication will have a different embed URL — make sure to match the right URL to the right city page.

---

## Customization Notes

- **Headline / tagline**: Edit the `<h1>` and `<p>` in the hero section.
- **Colors**: Tailwind custom colors are defined in the `<script>` block in each file's `<head>`. Modify the hex values there.
- **Send day**: Currently says "every Tuesday/Wednesday morning" — update to match your actual send schedule once confirmed.
- **Footer disclaimer**: Can be updated once you have a legal entity name for the business.
