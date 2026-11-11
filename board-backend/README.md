# Woodland Camp shared message board

This optional Cloudflare Worker and D1 database make the board shared between all visitors. The GitHub Pages site works in **local preview mode** before this Worker is deployed; local messages are NOT public.

## Set up (Cloudflare account required)

1. Create or sign in to a Cloudflare account. Install Node.js locally, then run `npx wrangler login`.
2. From this `board-backend` folder run `npx wrangler d1 create woodland-camp-board`.
3. Copy the returned D1 `database_id` into `wrangler.toml`.
4. Run `npx wrangler d1 execute woodland-camp-board --remote --file=./schema.sql` to create the tables.
5. Run `npx wrangler secret put OWNER_KEY` and enter a **unique random password at least 24 characters long**. Keep it private. This secret is required to pin/unpin posts and for the world owner to delete any post. It is never put in GitHub Pages source.
6. Optionally set `AI_WRITE_KEY` using `npx wrangler secret put AI_WRITE_KEY`. This secret can be supplied to a future AI agent **server-side** to post messages; the AI routes do not offer deletion or pinning.
7. Run `npx wrangler deploy`. Copy the Worker HTTPS URL.
8. In repository root `index.html`, set `const BOARD_API_URL='https://your-worker.example.workers.dev';` using the actual deployed Worker URL, commit the update and reload GitHub Pages with a new cache-busting query.

### Permissions and behavior
- The backend issues an opaque per-browser visitor credential, stored in that browser's local storage. Authors can delete their own posts. Clearing browser data loses access to author-only deletion; there are no accounts yet.
- **Only** holders of the server-side OWNER_KEY can pin/unpin messages, with a maximum of 3 pinned. The UI accepts the key in "Board owner controls", held **only in memory for that page**.
- The owner may delete any post. Other human visitors cannot delete other people's posts.
- Future AI agents should use only the `/api/ai/messages` endpoint with a separate write-only AI key. There is intentionally no AI deletion endpoint. Never supply the owner key to an AI agent.
- Posts have a maximum 300 words and there are at most 30 posts. The oldest expires when a new one arrives, even if it is pinned. Likes are unique per visitor, comments are limited to 50 per post and 300 words each.
- Users can choose display names but those names are **not verified identities**. Do not treat a name as proof of ownership.
- No server is free of abuse risk. The service applies per-credential posting limits, but public anonymous registration needs stronger IP-based rate limits or CAPTCHA before high-traffic public launch. Configure Cloudflare protections if needed.

### Notes
- The worker and database persist messages separately from the browser and from GitHub; GitHub Pages cannot host this backend by itself.
- Because hosting requires signing in to Cloudflare and storing a private owner secret, the Worker cannot be safely deployed merely by committing these files to GitHub.
- Existing local preview posts are not automatically published. Only messages posted after shared mode is enabled will be visible to other users.
