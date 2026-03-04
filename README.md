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
| `SUPABASE_URL` | `https://jhtxerijupjkuxxzklpf.supabase.co` |
| `SUPABASE_ANON_KEY` | your key |
| `SUPABASE_SERVICE_ROLE_KEY` | your key |
| `OPENAI_API_KEY` | your key |
| `STRIPE_SECRET_KEY` | your key |
| `STRIPE_PUBLISHABLE_KEY` | your key |

### 4. Generate a public domain
In Railway → **Settings** → **Networking** → **Generate Domain**

This gives you a URL like `neural-command-production.up.railway.app`

## Architecture
- **Backend:** FastAPI (Python) — serves API + static frontend
- **Database:** Supabase (PostgreSQL with RLS)
- **Auth:** Supabase Auth (email/password)
- **AI:** OpenAI GPT-4o (proxied through platform)
- **Billing:** Stripe (Pro $29/mo, Enterprise $99/mo)
- **7 Agent Templates:** SEO, Social, Sales, Support, Content, Analytics, Custom
