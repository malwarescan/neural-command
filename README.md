# Neural Command — AI Agent SaaS Platform

## Deploy to Railway

### 1. Create a new GitHub repo
```bash
git init
git add .
git commit -m "Initial Neural Command deployment"
git remote add origin https://github.com/YOUR_USERNAME/neural-command.git
git push -u origin main
```

### 2. Connect to Railway
1. Go to [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `neural-command` repo
4. Railway will auto-detect the Python project and deploy

### 3. Set Environment Variables in Railway
Go to your service → **Variables** tab and add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_ANON_KEY` | `YOUR_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `YOUR_SUPABASE_SERVICE_ROLE_KEY` |
| `OPENAI_API_KEY` | `YOUR_OPENAI_API_KEY` |
| `STRIPE_SECRET_KEY` | `YOUR_STRIPE_SECRET_KEY` |
| `STRIPE_PUBLISHABLE_KEY` | `YOUR_STRIPE_PUBLISHABLE_KEY` |

### 4. Generate a public domain
In Railway → **Settings** → **Networking** → **Generate Domain**

This gives you a URL like `neural-command-production.up.railway.app`

### 5. Point Croutons.ai to Railway
Add a CNAME record in your DNS:
- `app.croutons.ai` → `your-railway-domain.up.railway.app`

### Test Account
- Email: `demo@croutons.ai`
- Password: `Demo1234!`

## Architecture
- **Backend:** FastAPI (Python) — serves API + static frontend
- **Database:** Supabase (PostgreSQL with RLS)
- **Auth:** Supabase Auth (email/password)
- **AI:** OpenAI GPT-4o (proxied through platform)
- **Billing:** Stripe (Pro $29/mo, Enterprise $99/mo)
- **7 Agent Templates:** SEO, Social, Sales, Support, Content, Analytics, Custom
