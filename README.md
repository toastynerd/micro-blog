# THM Paints

A tiny, low-cost website to showcase paintings. A single chronological feed;
each post is one image + a short blurb (location / what you're doing) + a date.
Upload from your phone after signing in with Google. Clean social link previews.
No comments, no accounts for visitors.

The public site is **100% static** (CloudFront + S3), so reads cost essentially
nothing. The only running code is one small Lambda that fires when *you* upload.
Expected cost at low traffic: **~$0.50–$2/month** (mostly the Route 53 zone).

## Architecture

```
Visitors ─► CloudFront ─► S3 (private, OAC)        # static feed, images, OG pages
You ──────► CloudFront /api/* ─► Lambda (Google-authed)
                                   • presigned S3 upload URLs
                                   • updates data/posts.json
                                   • renders p/<slug>/index.html (Open Graph)
                                   • invalidates CloudFront
```

- `web/` — Vite + React SPA (`/` feed, `/p/<slug>/` post, `/admin` upload)
- `lambda/` — TypeScript admin function (`create` / `finalize` / `delete`)
- `infra/` — AWS CDK stack (S3, CloudFront, ACM, Route 53, Lambda)

## Repo layout

| Path | What |
| --- | --- |
| `web/src/pages/` | `Feed.tsx`, `PostPage.tsx`, `Admin.tsx` |
| `web/src/lib/` | `api.ts`, `googleAuth.ts`, `imageResize.ts`, `config.ts`, `router.ts` |
| `lambda/src/` | `handler.ts`, `verifyGoogle.ts`, `ogTemplate.ts` |
| `infra/lib/site-stack.ts` | the whole AWS stack |
| `scripts/preflight.sh` | verify the active AWS account before deploy |

---

## One-time setup

### 0. Prerequisites
- Node 20+, the AWS CLI, and AWS credentials for your **personal** account.
- `npm install` at the repo root.

### 1. Create `config.json`
```bash
cp config.example.json config.json
```
Fill in:
- `awsAccountId` — your **personal** AWS account id (used as a deploy guard).
- `awsRegion` — must be `us-east-1` (CloudFront certs live there).
- `domainName` — your apex domain, e.g. `example.com`.
- `siteHost` — `"apex"` (serve at `example.com`) or `"www"`.
- `ownerEmail` — the Google account allowed to upload.
- `googleClientId` — from step 2.
- `siteTitle`, `siteDescription`.

`config.json` is gitignored.

### 2. Google OAuth client id
1. Google Cloud Console → **APIs & Services → Credentials**.
2. Configure the OAuth consent screen (External; add yourself as a test user is fine).
3. **Create credentials → OAuth client ID → Web application**.
4. **Authorized JavaScript origins**: add `https://<your-domain>` and, for local
   dev, `http://localhost:5173`.
5. Copy the **Client ID** into `config.json` → `googleClientId`.

The same client id is used by the browser (to sign in) and the Lambda (as the
token audience it verifies). No client secret is needed.

---

## Deploy

> ⚠️ **Account safety.** This project deploys personal infra. Always confirm the
> active account first. The CDK also refuses to deploy if the active account
> doesn't match `config.json`.

```bash
# 1. Confirm you're on your personal AWS account
./scripts/preflight.sh

# 2. First time only: bootstrap CDK in the account/region
(cd infra && npx cdk bootstrap aws://<awsAccountId>/us-east-1)

# 3. Build everything and deploy
npm run deploy
```

`npm run deploy` builds `lambda/` and `web/`, then runs `cdk deploy`. On success
it prints outputs including **NameServers**, **SiteUrl**, and **BucketName**.

### Point your domain at Route 53 (Namecheap → Route 53)
The stack creates a Route 53 **hosted zone** for your domain. After the first
deploy, take the four `NameServers` from the CDK output and, in **Namecheap →
Domain → Nameservers**, choose **Custom DNS** and paste them in.

Once DNS propagates (minutes to a couple hours), the ACM certificate validates
automatically (CDK added the validation record in Route 53) and the site goes
live at your domain over HTTPS.

> If `cdk deploy` appears to hang on the certificate the very first time, it's
> waiting for DNS validation — finish the Namecheap nameserver change and it
> will complete. (You can also do an initial deploy, set nameservers, then
> re-run `npm run deploy`.)

### Redeploys
Just `npm run deploy` again. The site deployment uses `prune: false`, so your
uploaded images, `data/posts.json`, and per-post pages are **never** deleted by
a redeploy. `index.html`/`assets/*`/`site-config.json` are re-uploaded and
their caches invalidated.

---

## See it running locally (no AWS, with sample data)

A small mock backend (`scripts/dev-server.mjs`) stands in for the Lambda + S3 so
you can run the whole site offline. It seeds three sample paintings on first run
and stores everything under `.dev-data/` (gitignored). The `/admin` page offers
a "Continue (dev)" bypass instead of Google sign-in.

```bash
# terminal 1 — mock backend (api + image storage)
npm run mock

# terminal 2 — the site, proxied to the mock
npm run dev:local
```
Then open **http://localhost:5173** — browse the feed and post pages, and go to
**/admin** → *Continue (dev)* to upload a photo and watch it appear in the feed.
To reset the demo data: `rm -rf .dev-data`.

## Local development

```bash
# Optional: enable the /admin page locally by proxying /api to the deployed Lambda
export VITE_API_PROXY="https://<lambda-function-url>"   # from AWS console, or skip

# Provide the Google client id for local sign-in
cp web/site-config.example.json web/public/site-config.json
# edit it to set your googleClientId

npm run dev   # http://localhost:5173
```
The feed reads `/data/posts.json`; with no backend it just shows "no paintings
yet". To exercise uploads locally you need `VITE_API_PROXY` pointed at the real
Function URL and `http://localhost:5173` added to the OAuth origins.

---

## How posting works

1. `/admin` → **Sign in with Google** (must be `ownerEmail`).
2. Pick a photo, add a blurb + location; date defaults to today.
3. The browser resizes the photo to a web JPEG + thumbnail (HEIC works on iOS
   Safari), then uploads directly to S3 via presigned URLs.
4. The Lambda writes the post into `data/posts.json`, renders
   `p/<slug>/index.html` with Open Graph tags, and invalidates the CDN.
5. You get a **Copy link** button — that URL previews nicely on social.

Delete is available via the API (`/api/delete` with a post id); a UI button can
be added later.

---

## Cost guardrail
Set an AWS Budgets alert (e.g. $5/mo) so any surprise is caught early:
**Billing → Budgets → Create budget → Cost budget → $5 monthly → email alert.**

## Security notes
- The S3 bucket is private; only CloudFront can read it (Origin Access Control).
- Every `/api/*` call requires a valid Google ID token whose verified email
  equals `ownerEmail`; anything else gets 401/403.
- The Lambda Function URL is reachable only through CloudFront (Lambda OAC,
  `AWS_IAM` auth).
- The bucket has `RemovalPolicy.RETAIN` so your art survives a stack deletion.
