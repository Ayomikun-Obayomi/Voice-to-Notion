# Peter update: setup steps

You do these once. Claude Code can run the terminal parts for you; the website parts (Cloudflare, Notion, Anthropic) need you to click through.

## 1. Anthropic spend limit (2 min)
1. In the Anthropic Console, open **Limits** and set a monthly spend limit (for example $10).
2. Create an API key for Peter. You'll paste it into Cloudflare in step 2, not into the app.

## 2. Deploy the Peter Worker (10 min)
From the `worker/` folder:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler prints your URL, like `https://peter-api.yourname.workers.dev`. Then:

```bash
npx wrangler secret put ANTHROPIC_API_KEY      # paste your Anthropic key
npx wrangler secret put PETER_APP_TOKEN        # paste any long random string (save it for step 4)
```

You'll add `NOTION_CLIENT_SECRET` in step 3.

## 3. Make the Notion integration public (15 min)
1. **Make Peter's template page.** In your own Notion, create a page called **Peter** with a line like "Peter saves your day and week plans here." Click **Share → Publish**, and turn on **Allow duplicate as template**. Copy the public link.
2. **Make the privacy and terms pages.** Notion asks for these. Two simple public Notion pages are fine for testing.
3. Go to Notion's integrations page (notion.so/profile/integrations), open your integration, or create a new one, and set its type to **Public**.
4. Fill in:
   - **Redirect URI:** `https://peter-api.yourname.workers.dev/notion/callback`
   - **Notion URL for optional template:** the Peter page link from step 1
   - **Capabilities:** Read content, Update content, Insert content
   - Website, privacy policy, terms: your links from step 2
5. Copy the **OAuth client ID** and **OAuth client secret**.
6. Put them into the Worker:
   - Edit `worker/wrangler.toml`: set `NOTION_CLIENT_ID` and `NOTION_REDIRECT_URI`.
   - Run `npx wrangler secret put NOTION_CLIENT_SECRET` and paste the secret.
   - Run `npx wrangler deploy` again.

## 4. Point the app at the Worker
Copy `public/peter-constants.example.js` to `public/peter-constants.js` (it is gitignored), then edit it:
- `WORKER_URL`: your Worker URL, with no trailing slash
- `PETER_APP_TOKEN`: the same random string from step 2

## 5. Test
1. Run `npm start` and click **Connect Notion**. Notion opens in your browser; pick **Use a template provided by the developer**. Peter reopens and says it's connected.
2. Click **Plan my week**, talk or type a few tasks, review them, and save. A "Week · …" page appears under Peter in Notion.
3. Click **Plan my day**. Peter should say you already have tasks planned for today from your week plan, and that you can add, remove, or reorder.

## Good to know
- `PETER_APP_TOKEN` keeps random people off your Worker, but it ships inside the app, so the spend limit from step 1 is your real safety net.
- For this test round, the Notion token reaches the app through a `peter://` link. That's fine for testers; tighten it before a public launch.
- In dev mode, `peter://` links open the app only if it's running. In the built `.dmg`, they always work.
