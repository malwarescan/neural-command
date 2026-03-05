/* ═══════════════════════════════════════════════
   Croutons Agents — Production Frontend SPA
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── CONFIG (loaded from /api/config) ──────
  const API = '';
  let SUPABASE_URL = '';
  let SUPABASE_ANON_KEY = '';
  let STRIPE_PK = '';

  // ── SUPABASE CLIENT (initialized after config loads) ──
  let supabase = null;

  // ── IN-MEMORY STATE ────────────────────────
  let currentSession = null;
  let cachedProfile = null;
  let sidebarOpen = false;

  // Wizard state
  let wizardStep = 0;
  let wizardData = {
    template_id: null,
    templateObj: null,
    name: '',
    description: '',
    goals: [],
    connections: [],
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 1024,
    schedule: 'daily',
    rules: [],
  };

  // ── LOGO SVG ───────────────────────────────
  const LOGO_SVG = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAAADRklEQVR42q1Xv0o7QRD+Zu+id+eBbUolRXwBwcIm2ATEWiwEG9/DNxBstLMRfAkVK0F8AgURzk6LSPxDQi4zv0L22NvbvZzhN7Bks7c7Mzv7zTe7JL8CIgIA6L6IAEAx7hLfHFPfrDUkemSGmAt9BuYZD1279+3u5eUF9/f3eH19xXg8xmAwQBRFSNMUcRxjdXUVGxsbaLfbJV2mDlMvEQEiIswsdXJzcyO9Xk8ACBGVfgGIUqoYC8NQdnd35fn5uaTDZwP2B/M/M8v5+bkQUdG0UV/T81qtltze3lb02X24PJtOpyIi8vj4WOyubtdKKadzSZLI19eXMHNhkJkL/cws8HnGzHJwcOA0Xjdmfzs+Pi7ptKXIAhcYV1ZWkGUZ7ETp9XrY3t5Gp9NBq9XC09MTLi8v8fDwUEH61tYWrq6uatPLK0EQVELe7/e98zudTiUy3W7XiwMREVWX+8xcREX3+/2+lye63W4l1d7e3pDneTHPJDkAUHXEo5t5NMPhsGTEVJxlWSnvRQSDwQDMXHFMj4U+B1zkMYvhTk9PkWUZoiiCiCDPcywtLSEIgopjSqlfJsQfRIePmQsFZu3Y3Nz0Uq+PGVUTo6Zx0/uCTq3dmSG29ZjRJKLZDugFPoMaoHYl1U7WVU4RaR6BOjEjYmaOudalh4igZlXjuu92OLUzrnU+PcoOiW6maBSbIbaB5jtzX5nXEpoKTO/NidPpFEopMLMX4UopXF9f4+7uDnEcg4gwmUyQJAkODw8Rx7H7QlNHxWZ51dR6dHRUolRd2URE9vb2nGuGw6G3HCvf+fgQbO9ARw0A2u12JYJpmtaCUtWh376cahLysaSZpuaYjY9KLbALhJn7PhT78tqe9/n5WdJfAbLvViwiODs7KwAIAKPRCMvLy3h/f0eapiWDo9EICwsLEBFEUQRmBjMjjmPs7+9jcXHRTdPSQEzwXFxcOG9ERCQnJye1tx+XqKZFSMtkMqnUdd0fj8dOwNWyKP6DaEeCIEDDd878DvgMEBHyPG+887kcEBF8f397s+Lj4+PP0QubGDXPdW1tDTs7O0iSpOAEIsLPzw/W19crqTYrIo0fp77C8peX8dxH4Cq7LgJrepc05R/lAHQj/5htrwAAAABJRU5ErkJggg==" alt="Croutons" style="width:100%;height:100%;object-fit:contain;">`;

  // ── HELPERS ────────────────────────────────
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') e.className = v;
      else if (k === 'innerHTML') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    });
    children.forEach(c => {
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── TOAST ──────────────────────────────────
  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const t = el('div', { className: `toast toast-${type}` });
    const iconMap = { success: 'check-circle', error: 'alert-circle', info: 'info' };
    t.innerHTML = `<i data-lucide="${iconMap[type] || 'info'}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(t);
    lucide.createIcons({ nodes: [t] });
    setTimeout(() => {
      t.classList.add('toast-exit');
      setTimeout(() => t.remove(), 200);
    }, 4000);
  }

  // ── API FETCH HELPER ───────────────────────
  async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentSession?.access_token) {
      headers['Authorization'] = `Bearer ${currentSession.access_token}`;
    }
    const resp = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...options.headers } });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = data?.detail || `Request failed (${resp.status})`;
      throw new Error(msg);
    }
    return data;
  }

  // ── ROUTER ─────────────────────────────────
  function navigate(hash) {
    window.location.hash = hash;
  }

  function getRoute() {
    const hash = window.location.hash || '#/login';
    return hash;
  }

  function getRouteParams(pattern, hash) {
    // e.g., pattern = '#/agent/:id'
    const patParts = pattern.split('/');
    const hashParts = hash.split('/');
    if (patParts.length !== hashParts.length) return null;
    const params = {};
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(':')) {
        params[patParts[i].slice(1)] = hashParts[i];
      } else if (patParts[i] !== hashParts[i]) {
        return null;
      }
    }
    return params;
  }

  // ── RENDER ENGINE ──────────────────────────
  function render() {
    const route = getRoute();
    const app = document.getElementById('app');

    // Auth routes (no session needed)
    const authRoutes = ['#/login', '#/signup', '#/forgot'];
    const isAuthRoute = authRoutes.includes(route);

    if (!currentSession && !isAuthRoute) {
      navigate('#/login');
      return;
    }

    if (currentSession && isAuthRoute) {
      navigate('#/dashboard');
      return;
    }

    if (isAuthRoute) {
      renderAuthView(route, app);
    } else {
      renderAppShell(route, app);
    }

    // Initialize Lucide icons after render
    requestAnimationFrame(() => lucide.createIcons());
  }

  // ── AUTH VIEWS ─────────────────────────────
  function renderAuthView(route, container) {
    let html = '';
    if (route === '#/login') html = loginView();
    else if (route === '#/signup') html = signupView();
    else if (route === '#/forgot') html = forgotView();
    container.innerHTML = `<div class="auth-layout">${html}</div>`;
    bindAuthEvents(route);
  }

  function loginView() {
    return `
      <div class="auth-card">
        <div class="auth-logo">
          <div class="auth-logo-icon">${LOGO_SVG}</div>
          <div class="auth-logo-text">Croutons Agents</div>
        </div>
        <h1 class="auth-title">Welcome back</h1>
        <p class="auth-subtitle">Sign in to manage your AI agents</p>
        <div id="auth-error"></div>
        <form class="auth-form" id="login-form">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="login-email" placeholder="you@example.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="login-password" placeholder="Enter your password" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="login-btn">Sign In</button>
        </form>
        <div class="auth-links">
          <a href="#/forgot">Forgot password?</a><br>
          Don't have an account? <a href="#/signup">Sign up</a>
        </div>
      </div>`;
  }

  function signupView() {
    return `
      <div class="auth-card">
        <div class="auth-logo">
          <div class="auth-logo-icon">${LOGO_SVG}</div>
          <div class="auth-logo-text">Croutons Agents</div>
        </div>
        <h1 class="auth-title">Create your account</h1>
        <p class="auth-subtitle">Start deploying AI agents in minutes</p>
        <div id="auth-error"></div>
        <div id="auth-success"></div>
        <form class="auth-form" id="signup-form">
          <div class="form-group">
            <label class="form-label">Display Name</label>
            <input type="text" class="form-input" id="signup-name" placeholder="Your name">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="signup-email" placeholder="you@example.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="signup-password" placeholder="Min. 6 characters" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="signup-btn">Create Account</button>
        </form>
        <div class="auth-links">
          Already have an account? <a href="#/login">Sign in</a>
        </div>
      </div>`;
  }

  function forgotView() {
    return `
      <div class="auth-card">
        <div class="auth-logo">
          <div class="auth-logo-icon">${LOGO_SVG}</div>
          <div class="auth-logo-text">Croutons Agents</div>
        </div>
        <h1 class="auth-title">Reset your password</h1>
        <p class="auth-subtitle">Enter your email and we'll send a reset link</p>
        <div id="auth-error"></div>
        <div id="auth-success"></div>
        <form class="auth-form" id="forgot-form">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="forgot-email" placeholder="you@example.com" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="forgot-btn">Send Reset Link</button>
        </form>
        <div class="auth-links">
          <a href="#/login">Back to sign in</a>
        </div>
      </div>`;
  }

  function bindAuthEvents(route) {
    if (route === '#/login') {
      const form = document.getElementById('login-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('login-btn');
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        document.getElementById('auth-error').innerHTML = '';
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          // Session is set via onAuthStateChange
        } catch (err) {
          document.getElementById('auth-error').innerHTML = `<div class="auth-error">${escapeHtml(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
      });
    } else if (route === '#/signup') {
      const form = document.getElementById('signup-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('signup-btn');
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        btn.disabled = true;
        btn.textContent = 'Creating account...';
        document.getElementById('auth-error').innerHTML = '';
        document.getElementById('auth-success').innerHTML = '';
        try {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { display_name: name || email.split('@')[0] } }
          });
          if (error) throw error;
          // Check if auto-confirm is off (no session returned)
          if (!data.session) {
            document.getElementById('auth-success').innerHTML = `<div class="auth-success">Check your email to confirm your account before signing in.</div>`;
            btn.textContent = 'Account Created';
          }
        } catch (err) {
          document.getElementById('auth-error').innerHTML = `<div class="auth-error">${escapeHtml(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      });
    } else if (route === '#/forgot') {
      const form = document.getElementById('forgot-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('forgot-btn');
        const email = document.getElementById('forgot-email').value.trim();
        btn.disabled = true;
        btn.textContent = 'Sending...';
        document.getElementById('auth-error').innerHTML = '';
        document.getElementById('auth-success').innerHTML = '';
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(email);
          if (error) throw error;
          document.getElementById('auth-success').innerHTML = `<div class="auth-success">If that email exists, we've sent a reset link.</div>`;
          btn.textContent = 'Sent';
        } catch (err) {
          document.getElementById('auth-error').innerHTML = `<div class="auth-error">${escapeHtml(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Send Reset Link';
        }
      });
    }
  }

  // ── APP SHELL ──────────────────────────────
  function renderAppShell(route, container) {
    const navItems = [
      { icon: 'layout-dashboard', label: 'Dashboard', hash: '#/dashboard' },
      { icon: 'radar', label: 'Command Center', hash: '#/command-center' },
      { icon: 'bot', label: 'My Agents', hash: '#/agents' },
      { icon: 'plus-circle', label: 'Create Agent', hash: '#/wizard' },
      { icon: 'layers', label: 'Templates', hash: '#/templates' },
      { icon: 'plug', label: 'Connections', hash: '#/connections' },
      { icon: 'credit-card', label: 'Billing', hash: '#/billing' },
      { icon: 'settings', label: 'Settings', hash: '#/settings' },
    ];

    const activeHash = route.startsWith('#/agent/') ? '#/agents' : route.split('?')[0];
    const userName = cachedProfile?.display_name || currentSession?.user?.user_metadata?.display_name || 'User';
    const userEmail = cachedProfile?.email || currentSession?.user?.email || '';
    const userInitial = (userName[0] || 'U').toUpperCase();

    // Determine page title
    let pageTitle = 'Dashboard';
    if (route === '#/command-center') pageTitle = 'Command Center';
    else if (route === '#/agents') pageTitle = 'My Agents';
    else if (route === '#/wizard') pageTitle = 'Create Agent';
    else if (route === '#/templates') pageTitle = 'Templates';
    else if (route === '#/connections') pageTitle = 'Connections';
    else if (route === '#/billing') pageTitle = 'Billing';
    else if (route === '#/settings') pageTitle = 'Settings';
    else if (route.startsWith('#/agent/')) pageTitle = 'Agent Detail';

    container.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-brand-icon">${LOGO_SVG}</div>
            <div class="sidebar-brand-name">Croutons Agents</div>
          </div>
          <nav class="sidebar-nav">
            <div class="sidebar-section-label">Navigation</div>
            ${navItems.map(item => `
              <a href="${item.hash}" class="${activeHash === item.hash ? 'active' : ''}">
                <i data-lucide="${item.icon}"></i>
                <span>${item.label}</span>
              </a>
            `).join('')}
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-user">
              <div class="sidebar-user-avatar">${userInitial}</div>
              <div class="sidebar-user-info">
                <div class="sidebar-user-name">${escapeHtml(userName)}</div>
                <div class="sidebar-user-email">${escapeHtml(userEmail)}</div>
              </div>
            </div>
          </div>
        </aside>

        <header class="header">
          <div class="header-left">
            <button class="hamburger" id="hamburger-btn" onclick="window.NC.toggleSidebar()">
              <i data-lucide="menu"></i>
            </button>
            <span class="header-title">${escapeHtml(pageTitle)}</span>
          </div>
          <div class="header-right">
            <button class="btn btn-ghost btn-sm" id="logout-btn">
              <i data-lucide="log-out"></i>
              Sign Out
            </button>
          </div>
        </header>

        <main class="main-content app-bg" id="main-content">
          <div class="loading-center"><div class="loading-spinner"></div></div>
        </main>
      </div>`;

    // Bind logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      currentSession = null;
      cachedProfile = null;
      navigate('#/login');
    });

    // Fetch profile if needed, then render page content
    ensureProfile().then(() => {
      renderPageContent(route);
    });
  }

  async function ensureProfile() {
    if (cachedProfile) return;
    try {
      cachedProfile = await apiFetch('/api/profile');
    } catch (err) {
      // Profile might not exist yet for new users, that's ok
      cachedProfile = {
        email: currentSession?.user?.email || '',
        display_name: currentSession?.user?.user_metadata?.display_name || '',
        plan: 'free',
        api_calls_this_month: 0,
        api_calls_limit: 100,
      };
    }
  }

  // ── PAGE CONTENT ROUTER ────────────────────
  function renderPageContent(route) {
    const main = document.getElementById('main-content');
    if (!main) return;

    if (route === '#/dashboard') renderDashboard(main);
    else if (route === '#/command-center') renderCommandCenter(main);
    else if (route === '#/agents') renderAgents(main);
    else if (route === '#/wizard') renderWizard(main);
    else if (route === '#/templates') renderTemplates(main);
    else if (route === '#/connections') renderConnections(main);
    else if (route === '#/billing') renderBilling(main);
    else if (route === '#/settings') renderSettings(main);
    else if (route.startsWith('#/agent/')) {
      const params = getRouteParams('#/agent/:id', route);
      if (params) renderAgentDetail(main, params.id);
      else renderDashboard(main);
    }
    else renderDashboard(main);
  }

  // ── DASHBOARD VIEW ─────────────────────────
  async function renderDashboard(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const data = await apiFetch('/api/dashboard');
      const plan = data.current_plan || 'free';
      const callsPct = data.api_calls_limit > 0 ? Math.min((data.api_calls_this_month / data.api_calls_limit) * 100, 100) : 0;
      const pctClass = callsPct > 90 ? 'danger' : callsPct > 70 ? 'warning' : '';

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Overview of your AI agents and usage</p>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Total Agents</div>
            <div class="kpi-value">${data.total_agents}</div>
            <div class="kpi-meta">${data.active_agents} active</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Active Runs</div>
            <div class="kpi-value">${data.active_runs}</div>
            <div class="kpi-meta">Currently running</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">API Calls</div>
            <div class="kpi-value">${data.api_calls_this_month}<span style="font-size:14px;color:var(--color-text-muted)">/${data.api_calls_limit}</span></div>
            <div style="margin-top:8px">
              <div class="progress-bar"><div class="progress-bar-fill ${pctClass}" style="width:${callsPct}%"></div></div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Current Plan</div>
            <div class="kpi-value" style="font-size:22px;text-transform:capitalize">${plan}</div>
            <div class="kpi-meta"><span class="badge badge-${plan}">${plan}</span></div>
          </div>
        </div>

        ${data.total_agents === 0 ? `
          <div class="card" style="text-align:center;padding:48px 24px;margin-bottom:24px">
            <div class="empty-state-icon" style="margin:0 auto 16px"><i data-lucide="bot" style="width:28px;height:28px"></i></div>
            <h3 class="empty-state-title">Create Your First Agent</h3>
            <p class="empty-state-desc">Deploy an AI agent to automate your workflow. Choose from templates or build from scratch.</p>
            <a href="#/wizard" class="btn btn-primary btn-lg">Get Started</a>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Activity</h3>
          </div>
          ${data.recent_runs.length === 0
            ? `<p class="text-sm text-muted" style="padding:16px 0">No recent activity yet. Run an agent to see results here.</p>`
            : `<table class="runs-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Tokens</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.recent_runs.map(run => `
                    <tr>
                      <td><strong>${escapeHtml(run.agent_id?.substring(0, 8) || '—')}</strong></td>
                      <td><span class="badge badge-${run.status}">${run.status}</span></td>
                      <td>${run.total_tokens || '—'}</td>
                      <td>${timeAgo(run.started_at)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>
      `;
      lucide.createIcons();
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load dashboard</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p><button class="btn btn-primary" onclick="window.NC.render()">Retry</button></div>`;
      toast(err.message, 'error');
    }
  }

  // ── COMMAND CENTER ────────────────────────
  let ccActiveTab = 'overview';
  let ccCharts = {};

  async function renderCommandCenter(container) {
    const tabs = [
      { id: 'overview', label: 'Overview', icon: 'gauge' },
      { id: 'seo', label: 'SEO Metrics', icon: 'search' },
      { id: 'ai-visibility', label: 'AI Visibility', icon: 'eye' },
      { id: 'llm-conversions', label: 'LLM Conversions', icon: 'trending-up' },
      { id: 'competitors', label: 'Competitors', icon: 'swords' },
      { id: 'agent-ops', label: 'Agent Ops', icon: 'activity' },
    ];

    container.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#00c8ff 0%,#7c3aed 100%);display:flex;align-items:center;justify-content:center">
            <i data-lucide="radar" style="width:20px;height:20px;color:#fff"></i>
          </div>
          <div>
            <h1 class="page-title" style="margin:0">Command Center</h1>
            <p class="page-subtitle" style="margin:0">SEO, AEO, GEO &amp; Agent Intelligence</p>
          </div>
        </div>
      </div>
      <div class="cc-tabs">
        ${tabs.map(t => `
          <button class="cc-tab ${ccActiveTab === t.id ? 'cc-tab-active' : ''}" data-tab="${t.id}">
            <i data-lucide="${t.icon}" style="width:14px;height:14px"></i>
            <span>${t.label}</span>
          </button>
        `).join('')}
      </div>
      <div id="cc-content" class="cc-content"></div>
    `;

    // Bind tab clicks
    container.querySelectorAll('.cc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        ccActiveTab = btn.dataset.tab;
        // Destroy existing charts
        Object.values(ccCharts).forEach(c => { try { c.destroy(); } catch(e){} });
        ccCharts = {};
        renderCommandCenter(container);
      });
    });

    lucide.createIcons();
    const ccEl = document.getElementById('cc-content');
    if (!ccEl) return;

    if (ccActiveTab === 'overview') await renderCCOverview(ccEl);
    else if (ccActiveTab === 'seo') await renderCCSEO(ccEl);
    else if (ccActiveTab === 'ai-visibility') renderCCAIVisibility(ccEl);
    else if (ccActiveTab === 'llm-conversions') renderCCLLMConversions(ccEl);
    else if (ccActiveTab === 'competitors') renderCCCompetitors(ccEl);
    else if (ccActiveTab === 'agent-ops') await renderCCAgentOps(ccEl);
  }

  // ── CC: OVERVIEW TAB ──
  async function renderCCOverview(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const data = await apiFetch('/api/command-center/overview');
      el.innerHTML = `
        <div class="cc-kpi-grid">
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="plug" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${data.service_count}</div>
              <div class="cc-kpi-label">Connected Services</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="bot" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${data.agents.total}</div>
              <div class="cc-kpi-label">Agents <span class="badge badge-active">${data.agents.active} active</span></div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i data-lucide="zap" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${(data.agents.total_tokens || 0).toLocaleString()}</div>
              <div class="cc-kpi-label">Total Tokens</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b"><i data-lucide="dollar-sign" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">$${(data.cost_total_usd || 0).toFixed(4)}</div>
              <div class="cc-kpi-label">Total Cost (recent)</div>
            </div>
          </div>
        </div>

        <div class="cc-grid-2">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Connected Services</h3></div>
            <div class="cc-services-list">
              ${data.connected_services.length === 0
                ? '<p class="text-sm text-muted" style="padding:12px 0">No services connected. Go to <a href="#/connections">Connections</a> to set up.</p>'
                : data.connected_services.map(s => `
                    <div class="cc-service-item">
                      <span class="cc-service-dot cc-service-dot-active"></span>
                      <span>${escapeHtml(s.replace(/_/g, ' '))}</span>
                    </div>
                  `).join('')
              }
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Recent Activity</h3></div>
            ${data.recent_runs.length === 0
              ? '<p class="text-sm text-muted" style="padding:12px 0">No recent runs yet.</p>'
              : `<div class="cc-activity-list">
                  ${data.recent_runs.slice(0, 8).map(r => `
                    <div class="cc-activity-item">
                      <span class="badge badge-${r.status}" style="font-size:10px">${r.status}</span>
                      <span class="cc-activity-text">${escapeHtml(r.input_preview || '—')}</span>
                      <span class="cc-activity-meta">${r.total_tokens || 0} tok · ${timeAgo(r.started_at)}</span>
                    </div>
                  `).join('')}
                </div>`
            }
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Quick Navigation</h3></div>
          <div class="cc-quick-nav">
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=seo]').click()"><i data-lucide="search" style="width:16px;height:16px"></i>SEO Metrics</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=ai-visibility]').click()"><i data-lucide="eye" style="width:16px;height:16px"></i>AI Visibility</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=llm-conversions]').click()"><i data-lucide="trending-up" style="width:16px;height:16px"></i>LLM Conversions</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=competitors]').click()"><i data-lucide="swords" style="width:16px;height:16px"></i>Competitors</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=agent-ops]').click()"><i data-lucide="activity" style="width:16px;height:16px"></i>Agent Ops</button>
          </div>
        </div>
      `;
      lucide.createIcons();
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load overview</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ── CC: SEO METRICS TAB ──
  async function renderCCSEO(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const data = await apiFetch('/api/command-center/seo');
      if (!data.connected) {
        el.innerHTML = `
          <div class="cc-empty-card">
            <div class="cc-empty-icon"><i data-lucide="search" style="width:32px;height:32px"></i></div>
            <h3>Google Search Console Not Connected</h3>
            <p>Connect your GSC account to view SEO metrics, top queries, and page performance.</p>
            <a href="#/connections" class="btn btn-primary">Connect GSC</a>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      if (data.expired) {
        el.innerHTML = `
          <div class="cc-empty-card">
            <div class="cc-empty-icon" style="color:var(--color-warning)"><i data-lucide="alert-triangle" style="width:32px;height:32px"></i></div>
            <h3>Token Expired</h3>
            <p>${escapeHtml(data.message)}</p>
            <a href="#/connections" class="btn btn-primary">Reconnect GSC</a>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      const t = data.totals || {};
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge">GSC</span>
          <span class="text-sm text-muted">${escapeHtml(data.site_url || '')} · ${data.period?.start || ''} to ${data.period?.end || ''}</span>
        </div>

        <div class="cc-kpi-grid cc-kpi-grid-4">
          <div class="cc-kpi cc-kpi-compact">
            <div class="cc-kpi-value">${(t.clicks || 0).toLocaleString()}</div>
            <div class="cc-kpi-label">Clicks</div>
          </div>
          <div class="cc-kpi cc-kpi-compact">
            <div class="cc-kpi-value">${(t.impressions || 0).toLocaleString()}</div>
            <div class="cc-kpi-label">Impressions</div>
          </div>
          <div class="cc-kpi cc-kpi-compact">
            <div class="cc-kpi-value">${t.ctr || 0}%</div>
            <div class="cc-kpi-label">CTR</div>
          </div>
          <div class="cc-kpi cc-kpi-compact">
            <div class="cc-kpi-value">${t.position || 0}</div>
            <div class="cc-kpi-label">Avg Position</div>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Clicks &amp; Impressions (28d)</h3></div>
          <div style="padding:16px;height:280px">
            <canvas id="cc-seo-chart"></canvas>
          </div>
        </div>

        <div class="cc-grid-2" style="margin-top:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Top Queries</h3></div>
            <table class="cc-table">
              <thead><tr><th>Query</th><th>Clicks</th><th>Impr</th><th>CTR</th><th>Pos</th></tr></thead>
              <tbody>
                ${(data.top_queries || []).map(q => `
                  <tr>
                    <td class="cc-query-cell">${escapeHtml(q.query)}</td>
                    <td>${q.clicks}</td>
                    <td>${q.impressions}</td>
                    <td>${q.ctr}%</td>
                    <td>${q.position}</td>
                  </tr>
                `).join('')}
                ${(data.top_queries || []).length === 0 ? '<tr><td colspan="5" class="text-muted">No data</td></tr>' : ''}
              </tbody>
            </table>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Top Pages</h3></div>
            <table class="cc-table">
              <thead><tr><th>Page</th><th>Clicks</th><th>CTR</th><th>Pos</th></tr></thead>
              <tbody>
                ${(data.top_pages || []).map(p => {
                  const shortPage = p.page.replace(/^https?:\/\/[^/]+/, '');
                  return `
                    <tr>
                      <td class="cc-query-cell" title="${escapeHtml(p.page)}">${escapeHtml(shortPage || '/')}</td>
                      <td>${p.clicks}</td>
                      <td>${p.ctr}%</td>
                      <td>${p.position}</td>
                    </tr>
                  `;
                }).join('')}
                ${(data.top_pages || []).length === 0 ? '<tr><td colspan="4" class="text-muted">No data</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>
      `;
      lucide.createIcons();

      // Render Chart.js graph
      const daily = data.daily || [];
      if (daily.length > 0 && document.getElementById('cc-seo-chart')) {
        const ctx = document.getElementById('cc-seo-chart').getContext('2d');
        ccCharts['seo'] = new Chart(ctx, {
          type: 'line',
          data: {
            labels: daily.map(d => d.date.slice(5)),
            datasets: [
              {
                label: 'Clicks',
                data: daily.map(d => d.clicks),
                borderColor: '#00c8ff',
                backgroundColor: 'rgba(0,200,255,0.08)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
              },
              {
                label: 'Impressions',
                data: daily.map(d => d.impressions),
                borderColor: '#7c3aed',
                backgroundColor: 'rgba(124,58,237,0.06)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                yAxisID: 'y1',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              y: { position: 'left', grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 } } },
              y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 } } },
            },
          },
        });
      }
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load SEO data</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ── CC: AI VISIBILITY (AEO/GEO) ──
  function renderCCAIVisibility(el) {
    el.innerHTML = `
      <div class="cc-section-header">
        <span class="cc-section-badge cc-badge-purple">AEO / GEO</span>
        <span class="text-sm text-muted">Answer Engine &amp; Generative Engine Optimization &mdash; powered by Resoneo research</span>
      </div>

      <div class="cc-kpi-grid cc-kpi-grid-3">
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i data-lucide="eye" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">&mdash;</div>
            <div class="cc-kpi-label">AI Visibility Score</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="quote" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">&mdash;</div>
            <div class="cc-kpi-label">Citation Frequency</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="message-circle" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">&mdash;</div>
            <div class="cc-kpi-label">Brand Sentiment</div>
          </div>
        </div>
      </div>

      <div class="cc-grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title">How ChatGPT Cites Your Content</h3></div>
          <div style="padding:4px 0">
            <p class="text-sm" style="margin-bottom:12px">ChatGPT uses SerpAPI (scrapes Google) for web search, SearchAPI.io for Shopping, and Labrador/Bright for images. Understanding citation types is critical for visibility:</p>
            <div class="cc-activity-list">
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#10b981;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Citations [1][2][3] &mdash; HIGH visibility</span>
                  <span class="cc-activity-text">Numbered inline citations in the response text. Clickable links. Highest SEO value.</span>
                </div>
              </div>
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#f59e0b;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Other Sources / More &mdash; MEDIUM visibility</span>
                  <span class="cc-activity-text">Appears in Sources section at bottom. Less prominent but still drives referral traffic.</span>
                </div>
              </div>
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#ef4444;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Hidden Links (ref_type: academia) &mdash; NEVER shown</span>
                  <span class="cc-activity-text">Used for grounding but never displayed. Applies to Wikipedia, arXiv, and similar authority sources.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">AI Crawler Capabilities</h3></div>
          <div style="padding:4px 0">
            <table class="cc-table">
              <thead><tr><th>Crawler</th><th>JS Execution</th><th>Shadow DOM</th><th>iframes</th></tr></thead>
              <tbody>
                <tr><td>ChatGPT</td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td></tr>
                <tr><td>Claude</td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td></tr>
                <tr><td>Gemini</td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td></tr>
                <tr><td>Bing Copilot</td><td><span style="color:var(--color-success)">Yes (~53ms)</span></td><td>Open only</td><td><span style="color:var(--color-success)">Yes</span></td></tr>
                <tr><td>Grok</td><td><span style="color:var(--color-success)">Yes (1-2s)</span></td><td><span style="color:var(--color-error)">No</span></td><td><span style="color:var(--color-error)">No</span></td></tr>
              </tbody>
            </table>
            <p class="text-sm text-muted" style="margin-top:10px">Most AI crawlers do not execute JavaScript. Add <code>&lt;noscript&gt;</code> tags with full content &mdash; this is CRITICAL for AI indexing.</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">ChatGPT Search Architecture (Resoneo)</h3></div>
        <div style="padding:4px 0">
          <div class="cc-info-grid">
            <div class="cc-info-block">
              <h4 class="cc-info-title">Sonic Classifier &amp; Fan-Out</h4>
              <p class="text-sm">A lightweight classifier runs before response generation and determines if fresh web data is needed (search threshold: 65%). Standard mode fires 1-3 parallel search queries; Thinking/Deep Search mode fires 10-30+ recursive fan-outs via SerpAPI.</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Recency Bias &amp; Freshness</h4>
              <p class="text-sm">ChatGPT already has older content from training data. Web search only fills the gap with recent content. Results are filtered by date before feeding to the model. Freshness windows: 7 days (breaking), 30 days (news), 365 days (established). Always set <code>dateModified</code> in JSON-LD.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">AEO / GEO Key Recommendations</h3></div>
        <div style="padding:4px 0">
          <div class="cc-setup-steps">
            <div class="cc-setup-step"><span class="cc-step-num" style="background:#ef4444">!</span><strong style="color:var(--color-text)">Add &lt;noscript&gt; tags</strong> &mdash; CRITICAL. Most AI crawlers ignore JavaScript. Your content must exist in static HTML.</div>
            <div class="cc-setup-step"><span class="cc-step-num">1</span>Add <code>dateModified</code> to JSON-LD structured data to signal freshness to ChatGPT search.</div>
            <div class="cc-setup-step"><span class="cc-step-num">2</span>Use Q&amp;A format with FAQ schema. ChatGPT classifies queries into verticals and prefers structured answers.</div>
            <div class="cc-setup-step"><span class="cc-step-num">3</span>Create a brand facts page (e.g., about.your-site.com) to help AI systems understand your entity.</div>
            <div class="cc-setup-step"><span class="cc-step-num">4</span>Build a Wikipedia/Wikidata presence for entity disambiguation. If your brand isn't in the semantic knowledge graph, it may not exist for AI systems.</div>
            <div class="cc-setup-step"><span class="cc-step-num">5</span>Keep &gt;50% English content. Ensure meta descriptions are optimized (shown ~1/3 of the time by Google and used by ChatGPT/Perplexity).</div>
          </div>
          <a href="#/wizard" class="btn btn-primary btn-sm" style="margin-top:12px">Create AEO Monitoring Agent</a>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  // ── CC: LLM CONVERSIONS ──
  function renderCCLLMConversions(el) {
    el.innerHTML = `
      <div class="cc-section-header">
        <span class="cc-section-badge cc-badge-green">LLM Traffic</span>
        <span class="text-sm text-muted">Track conversions from AI chatbots &amp; answer engines</span>
      </div>

      <div class="cc-kpi-grid cc-kpi-grid-3">
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="trending-up" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">16%</div>
            <div class="cc-kpi-label">Avg LLM Conversion Rate</div>
            <div class="cc-kpi-delta cc-delta-up">+14.2% vs organic</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="globe" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">1.8%</div>
            <div class="cc-kpi-label">Avg Organic Conversion Rate</div>
            <div class="cc-kpi-delta cc-delta-neutral">Google baseline</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b"><i data-lucide="bar-chart-3" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value">~8.9x</div>
            <div class="cc-kpi-label">LLM vs Organic Multiplier</div>
            <div class="cc-kpi-delta cc-delta-up">Higher intent traffic</div>
          </div>
        </div>
      </div>

      <div class="cc-grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title">On-Demand Bots (Real Referral Traffic)</h3></div>
          <table class="cc-table">
            <thead><tr><th>Source</th><th>User-Agent</th><th>Domain Pattern</th><th>GA4 Regex</th></tr></thead>
            <tbody>
              <tr><td>ChatGPT</td><td><code style="font-size:11px">ChatGPT-User</code></td><td>chatgpt.com, chat.openai.com</td><td><code style="font-size:11px">chatgpt\\.com|chat\\.openai\\.com</code></td></tr>
              <tr><td>Claude</td><td><code style="font-size:11px">Claude-User</code></td><td>claude.ai</td><td><code style="font-size:11px">claude\\.ai</code></td></tr>
              <tr><td>Perplexity</td><td><code style="font-size:11px">Perplexity-User</code></td><td>perplexity.ai</td><td><code style="font-size:11px">perplexity\\.ai</code></td></tr>
              <tr><td>Gemini</td><td>&mdash;</td><td>gemini.google.com</td><td><code style="font-size:11px">gemini\\.google\\.com</code></td></tr>
              <tr><td>Copilot</td><td>&mdash;</td><td>copilot.microsoft.com</td><td><code style="font-size:11px">copilot\\.microsoft\\.com</code></td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Background Bots (No Referral Traffic)</h3></div>
          <div style="padding:4px 0">
            <p class="text-sm text-muted" style="margin-bottom:8px">These bots crawl your site but don't generate direct referral traffic. Block or allow via robots.txt.</p>
            <table class="cc-table">
              <thead><tr><th>Bot</th><th>Type</th><th>Traffic share</th></tr></thead>
              <tbody>
                <tr><td><code style="font-size:11px">GPTBot</code></td><td>Training</td><td>~80% of AI crawling</td></tr>
                <tr><td><code style="font-size:11px">CCBot</code></td><td>Training</td><td>~80% combined</td></tr>
                <tr><td><code style="font-size:11px">Meta-ExternalAgent</code></td><td>Training</td><td>~80% combined</td></tr>
                <tr><td><code style="font-size:11px">OAI-SearchBot</code></td><td>Index building</td><td>&mdash;</td></tr>
                <tr><td><code style="font-size:11px">PerplexityBot</code></td><td>Index building</td><td>&mdash;</td></tr>
                <tr><td><code style="font-size:11px">Claude-SearchBot</code></td><td>Index building</td><td>&mdash;</td></tr>
              </tbody>
            </table>
            <p class="text-sm" style="margin-top:8px;color:var(--color-warning)"><i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline"></i> Some bots use stealth User-Agents (fake Chrome/Firefox). ChatGPT has an 8% 404 rate vs Google's 0.4%.</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">GA4 Setup Guide &mdash; LLM Traffic Segment</h3></div>
        <div style="padding:4px 0">
          <div class="cc-setup-steps">
            <div class="cc-setup-step"><span class="cc-step-num">1</span>Open GA4 &gt; Admin &gt; Data Streams &gt; Configure tag settings</div>
            <div class="cc-setup-step"><span class="cc-step-num">2</span>Create a new Exploration or custom Segment in Reports</div>
            <div class="cc-setup-step"><span class="cc-step-num">3</span>Filter: <code>Session source</code> matches regex:<br><code class="cc-code">chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com</code></div>
            <div class="cc-setup-step"><span class="cc-step-num">4</span>Also check Cloudflare Analytics &gt; AI Crawl Control report for bot-level traffic data and 404 rates by source.</div>
            <div class="cc-setup-step"><span class="cc-step-num">5</span>Compare conversion rate, pages/session, and bounce rate vs organic Google traffic segment.</div>
          </div>
          <p class="text-sm text-muted" style="margin-top:12px">Industry data: ChatGPT traffic converts at ~16% vs Google Organic ~1.8% (Seer Interactive, 2024). Monitor crawl-to-publication window correlation to optimize freshness.</p>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  // ── CC: COMPETITORS & CITATION GAPS ──
  function renderCCCompetitors(el) {
    el.innerHTML = `
      <div class="cc-section-header">
        <span class="cc-section-badge cc-badge-orange">Competitive Intel</span>
        <span class="text-sm text-muted">Track competitor citations &amp; identify gaps</span>
      </div>

      <div class="cc-grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Citation Gap Analysis</h3></div>
          <div style="padding:16px 0">
            <p class="text-sm" style="margin-bottom:16px">Use your SEO agents to monitor which competitors appear in AI answers for your target queries.</p>
            <div class="cc-gap-example">
              <div class="cc-gap-row cc-gap-header">
                <span>Query</span><span>You</span><span>Competitor A</span><span>Competitor B</span>
              </div>
              <div class="cc-gap-row">
                <span class="cc-query-cell">best domain registrar</span>
                <span class="cc-gap-check">—</span>
                <span class="cc-gap-cited">Cited</span>
                <span class="cc-gap-cited">Cited</span>
              </div>
              <div class="cc-gap-row">
                <span class="cc-query-cell">cheap domain names</span>
                <span class="cc-gap-cited">Cited</span>
                <span class="cc-gap-cited">Cited</span>
                <span class="cc-gap-check">—</span>
              </div>
              <div class="cc-gap-row">
                <span class="cc-query-cell">domain privacy protection</span>
                <span class="cc-gap-check">—</span>
                <span class="cc-gap-check">—</span>
                <span class="cc-gap-cited">Cited</span>
              </div>
            </div>
            <p class="text-sm text-muted" style="margin-top:12px">Configure competitor tracking in your agent goals to populate this data.</p>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Share of AI Voice</h3></div>
          <div style="padding:16px 0">
            <p class="text-sm" style="margin-bottom:16px">Track how often your brand vs competitors are mentioned across AI platforms.</p>
            <div style="height:200px;display:flex;align-items:center;justify-content:center">
              <canvas id="cc-competitor-chart" style="max-height:200px"></canvas>
            </div>
            <p class="text-sm text-muted" style="margin-top:12px;text-align:center">Example data — connect agents to populate with real metrics.</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">Entity Recognition &amp; Knowledge Graph</h3></div>
        <div style="padding:4px 0">
          <div class="cc-info-grid">
            <div class="cc-info-block">
              <h4 class="cc-info-title">ChatGPT NER System</h4>
              <p class="text-sm">ChatGPT uses a proprietary Named Entity Recognition system with disambiguation. Entity format: <code>entity["category","name","disambiguation_string"]</code>. Categories include: people, company, place, and others. gpt-5-instant is used for entity sidebar generation. If your brand isn't properly structured and disambiguated in the semantic layer, it may not exist for ChatGPT.</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Improving Entity Disambiguation</h4>
              <p class="text-sm">To ensure AI systems correctly recognize your brand:</p>
              <ul style="margin-top:8px;padding-left:16px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-direction:column;gap:4px">
                <li>Create or claim a Wikipedia page and Wikidata entry</li>
                <li>Add <code>sameAs</code> properties in JSON-LD pointing to Wikipedia, Wikidata, and Crunchbase</li>
                <li>Use consistent brand name in all structured data</li>
                <li>Add Organization schema with <code>@id</code>, <code>name</code>, <code>description</code>, and <code>url</code></li>
                <li>Build a dedicated brand facts / about page with structured data</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">Competitor Monitoring Setup</h3></div>
        <div style="padding:4px 0">
          <div class="cc-setup-steps">
            <div class="cc-setup-step"><span class="cc-step-num">1</span>Create an SEO agent with competitor analysis goals</div>
            <div class="cc-setup-step"><span class="cc-step-num">2</span>Add target queries and competitor domains</div>
            <div class="cc-setup-step"><span class="cc-step-num">3</span>Agent will query each AI model daily and log citations</div>
            <div class="cc-setup-step"><span class="cc-step-num">4</span>Citation gaps and share-of-voice populate here</div>
          </div>
          <a href="#/wizard" class="btn btn-primary btn-sm" style="margin-top:12px">Create Competitor Agent</a>
        </div>
      </div>
    `;
    lucide.createIcons();

    // Example donut chart
    const chartEl = document.getElementById('cc-competitor-chart');
    if (chartEl) {
      ccCharts['competitor'] = new Chart(chartEl.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Your Brand', 'Competitor A', 'Competitor B', 'Others'],
          datasets: [{
            data: [30, 35, 20, 15],
            backgroundColor: ['#00c8ff', '#7c3aed', '#f59e0b', '#e5e0d5'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle', padding: 12 } },
          },
        },
      });
    }
  }

  // ── CC: AGENT OPS ──
  async function renderCCAgentOps(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const data = await apiFetch('/api/command-center/agents-activity');
      const agents = Object.entries(data.agents || {});
      const timeline = data.timeline || [];
      const dailyChart = data.daily_chart || [];

      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-blue">Agent Operations</span>
          <span class="text-sm text-muted">${agents.length} agents · ${timeline.length} recent interactions</span>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Daily Activity</h3></div>
          <div style="padding:16px;height:220px">
            <canvas id="cc-ops-chart"></canvas>
          </div>
        </div>

        <div class="cc-grid-2" style="margin-top:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Agent Summary</h3></div>
            <table class="cc-table">
              <thead><tr><th>Agent</th><th>Status</th><th>Runs</th><th>Tokens</th><th>Last Run</th></tr></thead>
              <tbody>
                ${agents.length === 0 ? '<tr><td colspan="5" class="text-muted">No agents yet</td></tr>' : ''}
                ${agents.map(([id, a]) => `
                  <tr>
                    <td><a href="#/agent/${id}" class="cc-agent-link">${escapeHtml(a.name || 'Unnamed')}</a></td>
                    <td><span class="badge badge-${a.status}">${a.status}</span></td>
                    <td>${a.total_runs || 0}</td>
                    <td>${(a.total_tokens || 0).toLocaleString()}</td>
                    <td>${a.last_run_at ? timeAgo(a.last_run_at) : 'Never'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Recent Interactions</h3></div>
            <div class="cc-activity-list cc-activity-list-tall">
              ${timeline.length === 0 ? '<p class="text-sm text-muted">No interactions yet</p>' : ''}
              ${timeline.slice(0, 12).map(t => `
                <div class="cc-activity-item">
                  <span class="badge badge-${t.status}" style="font-size:10px;min-width:56px;text-align:center">${t.status}</span>
                  <div class="cc-activity-detail">
                    <span class="cc-activity-agent">${escapeHtml(t.agent_name)}</span>
                    <span class="cc-activity-text">${escapeHtml(t.input_preview || '—')}</span>
                  </div>
                  <span class="cc-activity-meta">${t.tokens || 0} tok · ${timeAgo(t.started_at)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();

      // Daily chart
      if (dailyChart.length > 0 && document.getElementById('cc-ops-chart')) {
        const ctx = document.getElementById('cc-ops-chart').getContext('2d');
        ccCharts['ops'] = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: dailyChart.map(d => d.date.slice(5)),
            datasets: [{
              label: 'Runs',
              data: dailyChart.map(d => d.runs),
              backgroundColor: 'rgba(0,200,255,0.7)',
              borderRadius: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 }, stepSize: 1 } },
            },
          },
        });
      }
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load agent ops</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ── AGENTS VIEW ────────────────────────────
  async function renderAgents(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const agents = await apiFetch('/api/agents');

      if (agents.length === 0) {
        container.innerHTML = `
          <div class="page-header"><h1 class="page-title">My Agents</h1></div>
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="bot"></i></div>
            <h3 class="empty-state-title">No agents yet</h3>
            <p class="empty-state-desc">Create your first AI agent to automate tasks and get insights.</p>
            <a href="#/wizard" class="btn btn-primary btn-lg">Create Agent</a>
          </div>`;
        lucide.createIcons();
        return;
      }

      const templateIcons = { seo: '<i data-lucide="search" style="width:20px;height:20px"></i>', social: '<i data-lucide="share-2" style="width:20px;height:20px"></i>', sales: '<i data-lucide="briefcase" style="width:20px;height:20px"></i>', support: '<i data-lucide="headphones" style="width:20px;height:20px"></i>', content: '<i data-lucide="pen-tool" style="width:20px;height:20px"></i>', analytics: '<i data-lucide="bar-chart-3" style="width:20px;height:20px"></i>', custom: '<i data-lucide="settings" style="width:20px;height:20px"></i>' };

      container.innerHTML = `
        <div class="page-header flex justify-between items-center">
          <div>
            <h1 class="page-title">My Agents</h1>
            <p class="page-subtitle">${agents.length} agent${agents.length !== 1 ? 's' : ''}</p>
          </div>
          <a href="#/wizard" class="btn btn-primary"><i data-lucide="plus" style="width:16px;height:16px"></i> Create Agent</a>
        </div>
        <div class="grid-2" id="agents-grid">
          ${agents.map(agent => `
            <div class="agent-card" data-id="${agent.id}">
              <div class="agent-card-head">
                <div style="display:flex;align-items:center;gap:12px">
                  <div class="agent-card-icon">${templateIcons[agent.template_id] || '<i data-lucide="settings" style="width:20px;height:20px"></i>'}</div>
                  <div>
                    <div class="agent-card-name">${escapeHtml(agent.name)}</div>
                    <span class="badge badge-${agent.status}">${agent.status}</span>
                  </div>
                </div>
              </div>
              <div class="agent-card-desc">${escapeHtml(agent.description || 'No description')}</div>
              <div class="agent-card-meta">
                <span><i data-lucide="cpu" style="width:12px;height:12px;display:inline"></i> ${agent.model || 'gpt-4o-mini'}</span>
                <span>Last run: ${timeAgo(agent.last_run_at)}</span>
              </div>
              <div class="agent-card-actions">
                <button class="btn btn-primary btn-sm agent-run-btn" data-id="${agent.id}" data-name="${escapeHtml(agent.name)}">
                  <i data-lucide="play" style="width:12px;height:12px"></i> Run
                </button>
                <button class="btn btn-secondary btn-sm agent-toggle-btn" data-id="${agent.id}" data-status="${agent.status}">
                  ${agent.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <a href="#/agent/${agent.id}" class="btn btn-ghost btn-sm">Details</a>
                <button class="btn btn-ghost btn-sm agent-delete-btn" data-id="${agent.id}" data-name="${escapeHtml(agent.name)}" style="color:var(--color-error)">
                  <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>`;

      lucide.createIcons();
      bindAgentActions();
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load agents</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      toast(err.message, 'error');
    }
  }

  function bindAgentActions() {
    document.querySelectorAll('.agent-run-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate(`#/agent/${btn.dataset.id}`));
    });
    document.querySelectorAll('.agent-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.status === 'active' ? 'paused' : 'active';
        try {
          await apiFetch(`/api/agents/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus }),
          });
          toast(`Agent ${newStatus === 'active' ? 'resumed' : 'paused'}`, 'success');
          renderAgents(document.getElementById('main-content'));
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
    document.querySelectorAll('.agent-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => showDeleteModal(btn.dataset.id, btn.dataset.name));
    });
  }

  // ── DELETE MODAL ───────────────────────────
  function showDeleteModal(agentId, agentName) {
    const overlay = el('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3 class="modal-title">Delete Agent</h3>
          <button class="btn btn-ghost btn-icon close-modal"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px;color:var(--color-text-secondary)">Are you sure you want to delete <strong>${escapeHtml(agentName)}</strong>? This action cannot be undone. All run history will be lost.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary close-modal">Cancel</button>
          <button class="btn btn-danger" id="confirm-delete">Delete Agent</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });

    overlay.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#confirm-delete').addEventListener('click', async () => {
      try {
        await apiFetch(`/api/agents/${agentId}`, { method: 'DELETE' });
        overlay.remove();
        toast('Agent deleted', 'success');
        renderAgents(document.getElementById('main-content'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ── AGENT DETAIL VIEW (Tabbed Workspace) ──────────────────────
  async function renderAgentDetail(container, agentId) {
    const templateIcons = { seo: '<i data-lucide="search" style="width:20px;height:20px"></i>', social: '<i data-lucide="share-2" style="width:20px;height:20px"></i>', sales: '<i data-lucide="briefcase" style="width:20px;height:20px"></i>', support: '<i data-lucide="headphones" style="width:20px;height:20px"></i>', content: '<i data-lucide="pen-tool" style="width:20px;height:20px"></i>', analytics: '<i data-lucide="bar-chart-3" style="width:20px;height:20px"></i>', custom: '<i data-lucide="settings" style="width:20px;height:20px"></i>' };
    let activeTab = 'chat';
    let agent = null;

    // ── Render the full workspace skeleton ──
    function renderWorkspace() {
      const icon = templateIcons[agent.template_id] || '<i data-lucide="settings" style="width:20px;height:20px"></i>';
      container.innerHTML = `
        <div class="page-header flex justify-between items-center" style="margin-bottom:0;padding-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <a href="#/agents" class="btn btn-ghost btn-sm"><i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back</a>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px;line-height:1">${icon}</span>
              <div>
                <h1 class="page-title" style="margin:0;font-size:18px;line-height:1.2">${escapeHtml(agent.name)}</h1>
                <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
                  <span class="badge badge-${agent.status}">${agent.status}</span>
                  <span class="text-xs text-muted">${agent.model || 'gpt-4o-mini'}</span>
                </div>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" id="workspace-run-btn">
              <i data-lucide="message-square" style="width:14px;height:14px"></i> Chat
            </button>
          </div>
        </div>

        <div class="agent-tabs" id="agent-tab-bar">
          <button class="agent-tab ${activeTab === 'chat' ? 'active' : ''}" data-tab="chat">Chat</button>
          <button class="agent-tab ${activeTab === 'activity' ? 'active' : ''}" data-tab="activity">Activity</button>
          <button class="agent-tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
        </div>

        <div id="agent-tab-content" style="background:var(--color-surface);border:1px solid var(--color-border);border-top:none;border-radius:0 0 10px 10px;overflow:hidden">
          <div class="loading-center"><div class="loading-spinner"></div></div>
        </div>
      `;

      lucide.createIcons();

      // Tab click handlers
      container.querySelectorAll('.agent-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          activeTab = tab.dataset.tab;
          container.querySelectorAll('.agent-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
          renderTabContent();
        });
      });

      // Chat shortcut button focuses chat tab
      document.getElementById('workspace-run-btn')?.addEventListener('click', () => {
        if (activeTab !== 'chat') {
          activeTab = 'chat';
          container.querySelectorAll('.agent-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
        }
        renderTabContent();
        setTimeout(() => document.getElementById('chat-input')?.focus(), 100);
      });

      renderTabContent();
    }

    // ── Tab content dispatcher ──
    function renderTabContent() {
      const tabContent = document.getElementById('agent-tab-content');
      if (!tabContent) return;
      if (activeTab === 'chat') renderChatTab(tabContent);
      else if (activeTab === 'activity') renderActivityTab(tabContent);
      else if (activeTab === 'settings') renderSettingsTab(tabContent);
    }

    // ── TAB 1: CHAT ──
    function renderChatTab(tabContent) {
      tabContent.innerHTML = `
        <div class="chat-container">
          <div class="chat-header">
            <span class="text-xs text-muted">Conversation with ${escapeHtml(agent.name)}</span>
            <button class="btn btn-ghost btn-sm" id="clear-chat-btn" style="font-size:12px;color:var(--color-text-muted)">
              <i data-lucide="trash-2" style="width:12px;height:12px"></i> Clear chat
            </button>
          </div>
          <div class="chat-messages" id="chat-messages">
            <div class="chat-empty" id="chat-empty-state">
              <div class="chat-empty-icon"><i data-lucide="message-circle" style="width:32px;height:32px;color:var(--color-text-muted)"></i></div>
              <div style="font-size:14px;font-weight:500">Start a conversation</div>
              <div style="font-size:12px">Ask your agent anything to get started</div>
            </div>
          </div>
          <div class="chat-input-area">
            <textarea
              class="chat-input"
              id="chat-input"
              placeholder="Message ${escapeHtml(agent.name)}..."
              rows="1"
            ></textarea>
            <button class="chat-send-btn" id="chat-send-btn">
              <i data-lucide="send" style="width:14px;height:14px"></i>
            </button>
          </div>
        </div>
      `;
      lucide.createIcons({ nodes: [tabContent] });

      // Load existing messages
      loadMessages();

      // Auto-resize textarea
      const input = document.getElementById('chat-input');
      input?.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });

      // Enter to send (Shift+Enter for newline)
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      document.getElementById('chat-send-btn')?.addEventListener('click', sendMessage);

      document.getElementById('clear-chat-btn')?.addEventListener('click', async () => {
        if (!confirm('Clear all chat history with this agent?')) return;
        try {
          await apiFetch(`/api/agents/${agentId}/messages`, { method: 'DELETE' });
          toast('Chat cleared', 'success');
          const messagesEl = document.getElementById('chat-messages');
          if (messagesEl) {
            messagesEl.innerHTML = `
              <div class="chat-empty" id="chat-empty-state">
                <div class="chat-empty-icon"><i data-lucide="message-circle" style="width:32px;height:32px;color:var(--color-text-muted)"></i></div>
                <div style="font-size:14px;font-weight:500">Start a conversation</div>
                <div style="font-size:12px">Ask your agent anything to get started</div>
              </div>`;
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    async function loadMessages() {
      const messagesEl = document.getElementById('chat-messages');
      if (!messagesEl) return;
      try {
        const messages = await apiFetch(`/api/agents/${agentId}/messages`);
        if (messages && messages.length > 0) {
          messagesEl.innerHTML = '';
          messages.forEach(msg => appendMessage(msg.role, msg.content, msg.created_at, msg.tokens));
          scrollToBottom();
        }
      } catch (err) {
        // If messages endpoint doesn't exist or fails, just show empty state
        console.warn('Could not load messages:', err.message);
      }
    }

    function appendMessage(role, content, timestamp, tokens) {
      const messagesEl = document.getElementById('chat-messages');
      if (!messagesEl) return;

      // Remove empty state if present
      const emptyState = document.getElementById('chat-empty-state');
      if (emptyState) emptyState.remove();

      const isUser = role === 'user';
      const isError = role === 'error';
      const msgEl = document.createElement('div');

      let cssClass = 'chat-message ';
      if (isUser) cssClass += 'chat-message-user';
      else if (isError) cssClass += 'chat-message-error';
      else cssClass += 'chat-message-assistant';

      msgEl.className = cssClass;

      const metaParts = [];
      if (timestamp) metaParts.push(timeAgo(timestamp));
      if (!isUser && !isError && tokens) metaParts.push(`${tokens} tokens`);
      const metaHtml = metaParts.length > 0
        ? `<div class="chat-message-meta">${metaParts.join(' · ')}</div>`
        : '';

      msgEl.innerHTML = `<div>${escapeHtml(content)}</div>${metaHtml}`;
      messagesEl.appendChild(msgEl);
    }

    function appendTypingIndicator() {
      const messagesEl = document.getElementById('chat-messages');
      if (!messagesEl) return null;

      const typing = document.createElement('div');
      typing.className = 'chat-typing';
      typing.id = 'chat-typing-indicator';
      typing.innerHTML = `<div class="chat-typing-dots"><span></span><span></span><span></span></div>`;
      messagesEl.appendChild(typing);
      scrollToBottom();
      return typing;
    }

    function scrollToBottom() {
      const messagesEl = document.getElementById('chat-messages');
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('chat-send-btn');
      if (!input) return;

      const message = input.value.trim();
      if (!message) return;

      input.value = '';
      input.style.height = 'auto';
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';
      }

      appendMessage('user', message, new Date().toISOString());
      scrollToBottom();

      const typingEl = appendTypingIndicator();

      try {
        const result = await apiFetch(`/api/agents/${agentId}/chat`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        });
        if (typingEl) typingEl.remove();
        const response = result.response || result.output?.response || result.message || 'No response';
        const tokens = result.usage?.total_tokens || result.tokens || null;
        appendMessage('assistant', response, new Date().toISOString(), tokens);
        scrollToBottom();
      } catch (err) {
        if (typingEl) typingEl.remove();
        appendMessage('error', err.message, new Date().toISOString());
        scrollToBottom();
        toast(err.message, 'error');
      } finally {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<i data-lucide="send" style="width:14px;height:14px"></i>';
          lucide.createIcons({ nodes: [sendBtn] });
        }
        input.focus();
      }
    }

    // ── TAB 2: ACTIVITY ──
    async function renderActivityTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        let activity = [];
        try {
          activity = await apiFetch(`/api/agents/${agentId}/activity`);
        } catch (e) {
          // Fallback to runs endpoint
          try {
            activity = await apiFetch(`/api/agents/${agentId}/runs`);
            // Normalize runs to activity shape
            activity = activity.map(r => ({
              id: r.id,
              status: r.status,
              description: r.output_data?.response ? r.output_data.response.substring(0, 80) + (r.output_data.response.length > 80 ? '…' : '') : (r.error_message || 'Agent run'),
              created_at: r.started_at || r.created_at,
              tokens: r.total_tokens,
              cost_usd: r.cost_usd,
              duration_ms: r.duration_ms,
              model: r.model,
            }));
          } catch (e2) {
            activity = [];
          }
        }

        // Calculate KPIs from activity
        const totalRuns = activity.length;
        const totalTokens = activity.reduce((s, a) => s + (a.tokens || a.total_tokens || 0), 0);
        const totalCost = activity.reduce((s, a) => s + (a.cost_usd || 0), 0);

        const timelineHtml = activity.length === 0
          ? `<div class="empty-state" style="padding:32px 0">
              <div class="empty-state-icon"><i data-lucide="activity"></i></div>
              <h3 class="empty-state-title" style="font-size:15px">No activity yet</h3>
              <p class="empty-state-desc">Run the agent from the Chat tab to see results here.</p>
            </div>`
          : `<div class="activity-timeline">
              ${activity.map(item => {
                const status = item.status || 'completed';
                let iconClass = 'activity-icon-completed';
                let iconSvg = '<i data-lucide="check" style="width:14px;height:14px"></i>';
                if (status === 'failed' || status === 'error') {
                  iconClass = 'activity-icon-failed';
                  iconSvg = '<i data-lucide="x" style="width:14px;height:14px"></i>';
                } else if (status === 'running') {
                  iconClass = 'activity-icon-running';
                  iconSvg = '<div class="loading-spinner" style="width:12px;height:12px;border-width:2px"></div>';
                }
                const metaParts = [];
                if (item.tokens || item.total_tokens) metaParts.push(`${(item.tokens || item.total_tokens).toLocaleString()} tokens`);
                if (item.cost_usd) metaParts.push(`$${item.cost_usd.toFixed(6)}`);
                if (item.duration_ms) metaParts.push(`${item.duration_ms}ms`);
                if (item.model) metaParts.push(item.model);
                return `
                  <div class="activity-item">
                    <div class="activity-icon ${iconClass}">${iconSvg}</div>
                    <div class="activity-content">
                      <div class="activity-desc">${escapeHtml(item.description || item.output_data?.response?.substring(0, 80) || 'Agent run')}</div>
                      <div class="activity-time">${timeAgo(item.created_at || item.started_at)}</div>
                      ${metaParts.length > 0 ? `<div class="activity-meta">${metaParts.join(' · ')}</div>` : ''}
                    </div>
                    <div style="flex-shrink:0">
                      <span class="badge badge-${status}" style="font-size:10px">${status}</span>
                    </div>
                  </div>`;
              }).join('')}
            </div>`;

        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="kpi-grid" style="margin-bottom:20px">
              <div class="kpi-card">
                <div class="kpi-label">Total Runs</div>
                <div class="kpi-value">${totalRuns}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">Tokens Used</div>
                <div class="kpi-value">${totalTokens.toLocaleString()}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">Total Cost</div>
                <div class="kpi-value" style="font-size:20px">$${totalCost.toFixed(4)}</div>
              </div>
            </div>
            ${timelineHtml}
          </div>`;
        lucide.createIcons({ nodes: [tabContent] });
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load activity</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
        toast(err.message, 'error');
      }
    }

    // ── TAB 3: SETTINGS ──
    function renderSettingsTab(tabContent) {
      tabContent.innerHTML = `
        <div style="padding:20px">
          <!-- Config Form -->
          <div class="card mb-6">
            <div class="card-header">
              <h3 class="card-title">Configuration</h3>
              <button class="btn btn-ghost btn-sm" id="save-agent-config" style="display:none">
                <i data-lucide="save" style="width:14px;height:14px"></i> Save
              </button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="form-group">
                <label class="form-label">Name</label>
                <input type="text" class="form-input config-field" data-field="name" value="${escapeHtml(agent.name)}">
              </div>
              <div class="form-group">
                <label class="form-label">Model</label>
                <select class="form-select config-field" data-field="model">
                  <option value="gpt-4o" ${agent.model === 'gpt-4o' ? 'selected' : ''}>GPT-4o</option>
                  <option value="gpt-4o-mini" ${agent.model === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini</option>
                  <option value="gpt-3.5-turbo" ${agent.model === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Temperature: <span id="temp-val">${agent.temperature ?? 0.7}</span></label>
                <div class="range-group">
                  <input type="range" class="config-field" data-field="temperature" min="0" max="1" step="0.1" value="${agent.temperature ?? 0.7}">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Schedule</label>
                <select class="form-select config-field" data-field="schedule">
                  <option value="realtime" ${agent.schedule === 'realtime' ? 'selected' : ''}>Real-time</option>
                  <option value="hourly" ${agent.schedule === 'hourly' ? 'selected' : ''}>Hourly</option>
                  <option value="daily" ${agent.schedule === 'daily' || !agent.schedule ? 'selected' : ''}>Daily</option>
                  <option value="weekly" ${agent.schedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Goals</label>
              <div style="font-size:13px;color:var(--color-text-secondary)">
                ${(agent.goals && agent.goals.length > 0)
                  ? agent.goals.map(g => `<span class="tag" style="margin:2px">${escapeHtml(g)}</span>`).join('')
                  : '<span class="text-muted">No goals set</span>'}
              </div>
            </div>
          </div>

          <!-- Danger Zone -->
          <div class="danger-zone">
            <h3 class="danger-zone-title">Danger Zone</h3>
            <p class="danger-zone-desc">These actions are irreversible.</p>
            <div style="display:flex;gap:8px">
              <button class="btn btn-secondary btn-sm" id="detail-toggle-btn" data-id="${agent.id}" data-status="${agent.status}">
                ${agent.status === 'active' ? 'Pause Agent' : 'Resume Agent'}
              </button>
              <button class="btn btn-danger btn-sm" id="detail-delete-btn" data-id="${agent.id}">Delete Agent</button>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons({ nodes: [tabContent] });

      // Config changes — show save button
      const saveBtn = document.getElementById('save-agent-config');
      tabContent.querySelectorAll('.config-field').forEach(field => {
        field.addEventListener('change', () => {
          if (saveBtn) saveBtn.style.display = 'inline-flex';
          if (field.dataset.field === 'temperature') {
            const tempVal = document.getElementById('temp-val');
            if (tempVal) tempVal.textContent = field.value;
          }
        });
        field.addEventListener('input', () => {
          if (field.dataset.field === 'temperature') {
            const tempVal = document.getElementById('temp-val');
            if (tempVal) tempVal.textContent = field.value;
          }
        });
      });

      saveBtn?.addEventListener('click', async () => {
        const updateData = {};
        tabContent.querySelectorAll('.config-field').forEach(field => {
          const key = field.dataset.field;
          let val = field.value;
          if (key === 'temperature') val = parseFloat(val);
          updateData[key] = val;
        });
        const origHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Saving...';
        try {
          const updated = await apiFetch(`/api/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(updateData) });
          // Update local agent object
          Object.assign(agent, updateData);
          toast('Agent updated', 'success');
          saveBtn.style.display = 'none';
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
          lucide.createIcons({ nodes: [saveBtn] });
          // Refresh header badge
          const headerStatus = container.querySelector('.badge');
          if (headerStatus && updateData.name) {
            const headerTitle = container.querySelector('.page-title');
            if (headerTitle) headerTitle.textContent = updateData.name;
          }
        } catch (err) {
          toast(err.message, 'error');
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
          lucide.createIcons({ nodes: [saveBtn] });
        }
      });

      // Danger zone
      document.getElementById('detail-toggle-btn')?.addEventListener('click', async () => {
        const newStatus = agent.status === 'active' ? 'paused' : 'active';
        try {
          await apiFetch(`/api/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
          agent.status = newStatus;
          toast(`Agent ${newStatus === 'active' ? 'resumed' : 'paused'}`, 'success');
          // Refresh the whole detail view so status badge updates
          renderAgentDetail(container, agentId);
        } catch (err) { toast(err.message, 'error'); }
      });

      document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
        showDeleteModal(agentId, agent.name);
      });
    }

    // ── Boot: load agent then render ──
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      agent = await apiFetch(`/api/agents/${agentId}`);
      renderWorkspace();
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load agent</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p><a href="#/agents" class="btn btn-primary">Back to Agents</a></div>`;
      toast(err.message, 'error');
    }
  }

  // ── WIZARD VIEW ────────────────────────────
  let wizardTemplates = [];

  async function renderWizard(container) {
    // Fetch templates if not cached
    if (wizardTemplates.length === 0) {
      try {
        wizardTemplates = await apiFetch('/api/templates');
      } catch (err) {
        toast('Failed to load templates', 'error');
        wizardTemplates = [];
      }
    }

    const steps = ['Template', 'Name', 'Goals', 'Connect', 'AI Config', 'Schedule', 'Rules', 'Review'];

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Create Agent</h1>
      </div>
      <div class="wizard-progress">
        ${steps.map((s, i) => `
          <div class="wizard-step-indicator ${i < wizardStep ? 'completed' : i === wizardStep ? 'current' : ''}"></div>
        `).join('')}
      </div>
      <div class="wizard-step-label">Step ${wizardStep + 1} of ${steps.length}</div>
      <div id="wizard-content"></div>
      <div class="wizard-footer">
        <button class="btn btn-secondary" id="wizard-back" ${wizardStep === 0 ? 'style="visibility:hidden"' : ''}>
          <i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back
        </button>
        <button class="btn btn-primary" id="wizard-next">
          ${wizardStep === steps.length - 1 ? 'Deploy Agent' : 'Continue'} <i data-lucide="arrow-right" style="width:14px;height:14px"></i>
        </button>
      </div>
    `;

    renderWizardStep(document.getElementById('wizard-content'));
    lucide.createIcons();

    document.getElementById('wizard-back')?.addEventListener('click', () => {
      if (wizardStep > 0) { wizardStep--; renderWizard(container); }
    });
    document.getElementById('wizard-next')?.addEventListener('click', () => handleWizardNext(container));
  }

  function renderWizardStep(el) {
    switch (wizardStep) {
      case 0: renderWizardTemplate(el); break;
      case 1: renderWizardName(el); break;
      case 2: renderWizardGoals(el); break;
      case 3: renderWizardConnect(el); break;
      case 4: renderWizardAI(el); break;
      case 5: renderWizardSchedule(el); break;
      case 6: renderWizardRules(el); break;
      case 7: renderWizardReview(el); break;
    }
    lucide.createIcons();
  }

  function renderWizardTemplate(el) {
    el.innerHTML = `
      <h2 class="wizard-step-title">Choose a Template</h2>
      <div class="grid-3">
        ${wizardTemplates.map(t => `
          <div class="template-card ${wizardData.template_id === t.id ? 'selected' : ''}" data-id="${t.id}">
            <div class="template-card-icon">${t.icon}</div>
            <div class="template-card-name">${escapeHtml(t.name)}</div>
            <div class="template-card-desc">${escapeHtml(t.description)}</div>
            <div class="template-card-tags">
              ${t.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
          </div>
        `).join('')}`;

    el.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        el.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardData.template_id = card.dataset.id;
        wizardData.templateObj = wizardTemplates.find(t => t.id === card.dataset.id);
        // Pre-fill goals from template
        if (wizardData.templateObj) {
          wizardData.goals = [...wizardData.templateObj.default_goals];
        }
      });
    });
  }

  function renderWizardName(el) {
    el.innerHTML = `
      <h2 class="wizard-step-title">Name & Describe Your Agent</h2>
      <div class="card" style="max-width:600px">
        <div class="form-group">
          <label class="form-label">Agent Name</label>
          <input type="text" class="form-input" id="wizard-name" placeholder="e.g., SEO Optimizer, Lead Qualifier" value="${escapeHtml(wizardData.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-textarea" id="wizard-desc" placeholder="Describe what this agent should do...">${escapeHtml(wizardData.description)}</textarea>
        </div>
      </div>`;
  }

  function renderWizardGoals(el) {
    const defaultGoals = wizardData.templateObj?.default_goals || [];
    el.innerHTML = `
      <h2 class="wizard-step-title">Set Goals</h2>
      <div class="card" style="max-width:600px">
        <p class="text-sm text-muted mb-4">Select the goals for your agent:</p>
        <div class="checkbox-group" id="goals-checkboxes">
          ${defaultGoals.map((g, i) => `
            <label class="checkbox-item">
              <input type="checkbox" value="${escapeHtml(g)}" ${wizardData.goals.includes(g) ? 'checked' : ''}>
              ${escapeHtml(g)}
            </label>
          `).join('')}
        </div>
        <div style="margin-top:16px">
          <div class="form-group">
            <label class="form-label">Add Custom Goal</label>
            <div style="display:flex;gap:8px">
              <input type="text" class="form-input" id="custom-goal-input" placeholder="Enter a custom goal">
              <button class="btn btn-secondary btn-sm" id="add-custom-goal">Add</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('add-custom-goal')?.addEventListener('click', () => {
      const input = document.getElementById('custom-goal-input');
      const val = input.value.trim();
      if (val) {
        wizardData.goals.push(val);
        input.value = '';
        renderWizardGoals(el);
      }
    });
  }

  function renderWizardConnect(el) {
    const services = [
      { id: 'google_search_console', name: 'Google Search Console', icon: '<i data-lucide="search" style="width:20px;height:20px;color:#4285f4"></i>' },
      { id: 'google_analytics', name: 'Google Analytics', icon: '<i data-lucide="bar-chart-3" style="width:20px;height:20px;color:#e37400"></i>' },
      { id: 'social_media', name: 'Social Media', icon: '<i data-lucide="share-2" style="width:20px;height:20px;color:#1d9bf0"></i>' },
      { id: 'crm', name: 'CRM', icon: '<i data-lucide="briefcase" style="width:20px;height:20px;color:#7c3aed"></i>' },
      { id: 'email', name: 'Email', icon: '<i data-lucide="mail" style="width:20px;height:20px;color:#10b981"></i>' },
      { id: 'custom_api', name: 'Custom API', icon: '<i data-lucide="plug" style="width:20px;height:20px;color:#94a3b8"></i>' },
    ];

    el.innerHTML = `
      <h2 class="wizard-step-title">Connect Services</h2>
      <p class="text-sm text-muted mb-4">Optional: connect external services your agent can use.</p>
      <div class="grid-3">
        ${services.map(s => `
          <div class="connection-card">
            <div class="connection-icon">${s.icon}</div>
            <div class="connection-info">
              <div class="connection-name">${s.name}</div>
              <div class="connection-status">
                <span class="connection-status-dot"></span>
                <span>Not connected</span>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm connect-service-btn" data-service="${s.id}" data-name="${s.name}">Connect</button>
          </div>
        `).join('')}`;

    el.querySelectorAll('.connect-service-btn').forEach(btn => {
      btn.addEventListener('click', () => showApiKeyModal(btn.dataset.service, btn.dataset.name, [{key: 'api_key', label: 'API Key', placeholder: 'Enter your API key'}]));
    });
  }

  function showApiKeyModal(serviceId, serviceName, fields) {
    const overlay = el('div', { className: 'modal-overlay', id: 'apikey-modal' });
    const fieldInputs = fields.map((f, i) => `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input type="password" class="form-input" id="apikey-field-${i}" placeholder="${f.placeholder || ''}" required>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Connect ${escapeHtml(serviceName)}</h3>
          <button class="btn btn-ghost btn-icon" id="close-apikey-modal"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:16px">Enter your credentials to connect ${escapeHtml(serviceName)} to your agents.</p>
          ${fieldInputs}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-apikey">Cancel</button>
          <button class="btn btn-primary" id="save-apikey"><i data-lucide="check" style="width:14px;height:14px"></i> Connect</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });

    overlay.querySelector('#close-apikey-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cancel-apikey').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-apikey').addEventListener('click', async () => {
      const btn = overlay.querySelector('#save-apikey');
      const credentials = {};
      let allFilled = true;
      fields.forEach((f, i) => {
        const val = document.getElementById(`apikey-field-${i}`).value.trim();
        if (!val) allFilled = false;
        credentials[f.key] = val;
      });
      if (!allFilled) { toast('Please fill in all fields', 'error'); return; }
      
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      try {
        await apiFetch('/api/connections/apikey', {
          method: 'POST',
          body: JSON.stringify({ service: serviceId, ...credentials }),
        });
        toast(`${serviceName} connected`, 'success');
        overlay.remove();
        const main = document.getElementById('main-content');
        if (main) renderConnections(main);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    });
  }

  function renderWizardAI(el) {
    el.innerHTML = `
      <h2 class="wizard-step-title">Configure AI</h2>
      <div class="card" style="max-width:600px">
        <div class="form-group">
          <label class="form-label">Model</label>
          <select class="form-select" id="wizard-model">
            <option value="gpt-4o" ${wizardData.model === 'gpt-4o' ? 'selected' : ''}>GPT-4o (Most capable)</option>
            <option value="gpt-4o-mini" ${wizardData.model === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini (Fast & affordable)</option>
            <option value="gpt-3.5-turbo" ${wizardData.model === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo (Budget)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Temperature: <span id="wiz-temp-val">${wizardData.temperature}</span></label>
          <div class="range-group">
            <span class="text-xs text-muted">Precise</span>
            <input type="range" id="wizard-temp" min="0" max="1" step="0.1" value="${wizardData.temperature}">
            <span class="text-xs text-muted">Creative</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Max Tokens: <span id="wiz-tokens-val">${wizardData.max_tokens}</span></label>
          <div class="range-group">
            <span class="text-xs text-muted">100</span>
            <input type="range" id="wizard-tokens" min="100" max="4000" step="100" value="${wizardData.max_tokens}">
            <span class="text-xs text-muted">4000</span>
          </div>
        </div>
      </div>`;

    document.getElementById('wizard-temp')?.addEventListener('input', (e) => {
      document.getElementById('wiz-temp-val').textContent = e.target.value;
    });
    document.getElementById('wizard-tokens')?.addEventListener('input', (e) => {
      document.getElementById('wiz-tokens-val').textContent = e.target.value;
    });
  }

  function renderWizardSchedule(el) {
    const schedules = [
      { value: 'realtime', label: 'Real-time', desc: 'Responds instantly to triggers' },
      { value: 'hourly', label: 'Hourly', desc: 'Runs every hour' },
      { value: 'daily', label: 'Daily', desc: 'Runs once per day' },
      { value: 'weekly', label: 'Weekly', desc: 'Runs once per week' },
      { value: 'custom', label: 'Custom', desc: 'Set a custom cron schedule' },
    ];

    el.innerHTML = `
      <h2 class="wizard-step-title">Set Schedule</h2>
      <div class="card" style="max-width:600px">
        <div class="radio-group">
          ${schedules.map(s => `
            <label class="radio-item ${wizardData.schedule === s.value ? 'selected' : ''}">
              <input type="radio" name="schedule" value="${s.value}" ${wizardData.schedule === s.value ? 'checked' : ''}>
              <div>
                <div class="radio-label">${s.label}</div>
                <div class="radio-desc">${s.desc}</div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>`;

    el.querySelectorAll('input[name="schedule"]').forEach(radio => {
      radio.addEventListener('change', () => {
        wizardData.schedule = radio.value;
        el.querySelectorAll('.radio-item').forEach(ri => ri.classList.remove('selected'));
        radio.closest('.radio-item').classList.add('selected');
      });
    });
  }

  function renderWizardRules(el) {
    el.innerHTML = `
      <h2 class="wizard-step-title">Define Rules</h2>
      <div class="card" style="max-width:600px">
        <p class="text-sm text-muted mb-4">Set alert thresholds and action rules for your agent (optional).</p>
        <div id="rules-list">
          ${wizardData.rules.map((r, i) => `
            <div class="flex items-center gap-2 mb-4">
              <input type="text" class="form-input rule-input" data-idx="${i}" value="${escapeHtml(r)}" placeholder="e.g., Alert if bounce rate > 5%">
              <button class="btn btn-ghost btn-sm remove-rule-btn" data-idx="${i}" style="color:var(--color-error)"><i data-lucide="x" style="width:14px;height:14px"></i></button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" id="add-rule-btn"><i data-lucide="plus" style="width:14px;height:14px"></i> Add Rule</button>
      </div>`;

    document.getElementById('add-rule-btn')?.addEventListener('click', () => {
      wizardData.rules.push('');
      renderWizardRules(el);
    });

    el.querySelectorAll('.remove-rule-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wizardData.rules.splice(parseInt(btn.dataset.idx), 1);
        renderWizardRules(el);
      });
    });

    lucide.createIcons({ nodes: [el] });
  }

  function renderWizardReview(el) {
    const template = wizardData.templateObj || {};
    el.innerHTML = `
      <h2 class="wizard-step-title">Review & Deploy</h2>
      <div class="card" style="max-width:600px">
        <div style="display:grid;gap:16px">
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Template</div>
            <div class="font-semibold">${template.icon ? `<i data-lucide="${template.icon}" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>` : '<i data-lucide="settings" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>'} ${escapeHtml(template.name || wizardData.template_id || 'Custom')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Name</div>
            <div class="font-semibold">${escapeHtml(wizardData.name || 'Unnamed Agent')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Description</div>
            <div class="text-sm">${escapeHtml(wizardData.description || 'No description')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Goals</div>
            <div>${wizardData.goals.length > 0 ? wizardData.goals.map(g => `<span class="tag" style="margin:2px">${escapeHtml(g)}</span>`).join('') : '<span class="text-muted text-sm">None</span>'}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">AI Configuration</div>
            <div class="text-sm">Model: <strong>${wizardData.model}</strong> · Temperature: <strong>${wizardData.temperature}</strong> · Max Tokens: <strong>${wizardData.max_tokens}</strong></div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Schedule</div>
            <div class="text-sm font-medium" style="text-transform:capitalize">${wizardData.schedule}</div>
          </div>
          ${wizardData.rules.length > 0 ? `
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Rules</div>
            <div>${wizardData.rules.filter(r => r).map(r => `<div class="text-sm">• ${escapeHtml(r)}</div>`).join('')}</div>
          </div>` : ''}
        </div>
      </div>`;
  }

  async function handleWizardNext(container) {
    // Validate current step
    switch (wizardStep) {
      case 0:
        if (!wizardData.template_id) { toast('Please select a template', 'error'); return; }
        break;
      case 1:
        wizardData.name = document.getElementById('wizard-name')?.value.trim() || '';
        wizardData.description = document.getElementById('wizard-desc')?.value.trim() || '';
        if (!wizardData.name) { toast('Please enter an agent name', 'error'); return; }
        break;
      case 2:
        const checked = [];
        document.querySelectorAll('#goals-checkboxes input:checked').forEach(cb => checked.push(cb.value));
        wizardData.goals = checked;
        break;
      case 3:
        // Connections are optional, just continue
        break;
      case 4:
        wizardData.model = document.getElementById('wizard-model')?.value || 'gpt-4o-mini';
        wizardData.temperature = parseFloat(document.getElementById('wizard-temp')?.value) || 0.7;
        wizardData.max_tokens = parseInt(document.getElementById('wizard-tokens')?.value) || 1024;
        break;
      case 5:
        break;
      case 6:
        document.querySelectorAll('.rule-input').forEach(input => {
          wizardData.rules[parseInt(input.dataset.idx)] = input.value.trim();
        });
        wizardData.rules = wizardData.rules.filter(r => r);
        break;
      case 7:
        // DEPLOY
        const btn = document.getElementById('wizard-next');
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Deploying...';
        try {
          const agent = await apiFetch('/api/agents', {
            method: 'POST',
            body: JSON.stringify({
              name: wizardData.name,
              description: wizardData.description,
              template_id: wizardData.template_id,
              model: wizardData.model,
              temperature: wizardData.temperature,
              max_tokens: wizardData.max_tokens,
              goals: wizardData.goals,
              schedule: wizardData.schedule,
              rules: wizardData.rules,
            }),
          });
          // Success animation
          container.innerHTML = `
            <div class="success-anim">
              <div class="success-check"><i data-lucide="check" style="width:32px;height:32px"></i></div>
              <h2 class="success-title">Agent Deployed!</h2>
              <p class="success-desc">"${escapeHtml(wizardData.name)}" is now active and ready to run.</p>
              <div style="display:flex;gap:8px">
                <a href="#/agents" class="btn btn-primary">View My Agents</a>
                <button class="btn btn-secondary" onclick="window.NC.resetWizard()">Create Another</button>
              </div>
            </div>`;
          lucide.createIcons();
          toast('Agent deployed successfully!', 'success');
          // Reset wizard state
          wizardStep = 0;
          wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [] };
          return;
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = 'Deploy Agent <i data-lucide="arrow-right" style="width:14px;height:14px"></i>';
          lucide.createIcons({ nodes: [btn] });
          return;
        }
    }

    if (wizardStep < 7) {
      wizardStep++;
      renderWizard(container);
    }
  }

  // ── TEMPLATES VIEW ─────────────────────────
  async function renderTemplates(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const templates = await apiFetch('/api/templates');
      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Templates</h1>
          <p class="page-subtitle">Pre-built agent configurations to get started fast</p>
        </div>
        <div class="grid-3">
          ${templates.map(t => `
            <div class="template-card" data-id="${t.id}">
              <div class="template-card-icon">${t.icon}</div>
              <div class="template-card-name">${escapeHtml(t.name)}</div>
              <div class="template-card-desc">${escapeHtml(t.description)}</div>
              <div class="template-card-tags" style="margin-bottom:12px">
                ${t.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
              </div>
              <button class="btn btn-primary btn-sm use-template-btn" data-id="${t.id}">Use Template</button>
            </div>
          `).join('')}
        </div>`;

      lucide.createIcons();

      document.querySelectorAll('.use-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          wizardStep = 0;
          wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [] };
          wizardData.template_id = btn.dataset.id;
          wizardData.templateObj = templates.find(t => t.id === btn.dataset.id);
          if (wizardData.templateObj) {
            wizardData.goals = [...wizardData.templateObj.default_goals];
          }
          wizardStep = 1; // Skip template selection since we already chose
          navigate('#/wizard');
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load templates</h3></div>`;
      toast(err.message, 'error');
    }
  }

  // ── CONNECTIONS VIEW ───────────────────────
  async function renderConnections(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;

    const serviceCategories = [
      {
        label: 'Data Sources',
        description: 'Connect analytics and search platforms for your agents to read',
        services: [
          { id: 'google_search_console', name: 'Google Search Console', icon: '<i data-lucide="search" style="width:20px;height:20px;color:#4285f4"></i>', desc: 'Search performance, keywords, indexing status', auth: 'oauth' },
          { id: 'google_analytics', name: 'Google Analytics', icon: '<i data-lucide="bar-chart-3" style="width:20px;height:20px;color:#e37400"></i>', desc: 'Traffic, user behavior, conversions', auth: 'oauth' },
          { id: 'bing_webmaster', name: 'Bing Webmaster Tools', icon: '<i data-lucide="globe" style="width:20px;height:20px;color:#00809d"></i>', desc: 'Bing search data, crawl stats, SEO issues', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'From Bing Webmaster → Settings → API Access'}] },
          { id: 'microsoft_clarity', name: 'Microsoft Clarity', icon: '<i data-lucide="flame" style="width:20px;height:20px;color:#ff6f00"></i>', desc: 'Heatmaps, session recordings, user insights', auth: 'oauth' },
          { id: 'cloudflare', name: 'Cloudflare', icon: '<i data-lucide="cloud" style="width:20px;height:20px;color:#f38020"></i>', desc: 'DNS, caching, analytics, security', auth: 'apikey', fields: [{key: 'api_token', label: 'API Token', placeholder: 'Your Cloudflare API token'}] },
        ]
      },
      {
        label: 'AI Models',
        description: 'Configure AI model access for agent intelligence',
        services: [
          { id: 'openai', name: 'OpenAI', icon: '<i data-lucide="brain" style="width:20px;height:20px;color:#10a37f"></i>', desc: 'GPT-4o, GPT-4o-mini for text generation', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'sk-...'}], badge: 'Platform Default' },
          { id: 'google_gemini', name: 'Google Gemini', icon: '<i data-lucide="sparkles" style="width:20px;height:20px;color:#4285f4"></i>', desc: 'Gemini Pro, Gemini Flash models', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'Your Gemini API key'}] },
          { id: 'nano_banana', name: 'Nano Banana', icon: '<i data-lucide="image" style="width:20px;height:20px;color:#f5c842"></i>', desc: 'Image generation and creative AI', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'Your Nano Banana API key'}] },
        ]
      },
      {
        label: 'Deployment',
        description: 'Push code and manage infrastructure',
        services: [
          { id: 'github', name: 'GitHub', icon: '<i data-lucide="github" style="width:20px;height:20px;color:#24292f"></i>', desc: 'Push code, manage repos, deploy changes', auth: 'oauth' },
        ]
      },
      {
        label: 'Social Publishing',
        description: 'Post and schedule content across social platforms',
        services: [
          { id: 'twitter', name: 'X (Twitter)', icon: '<i data-lucide="at-sign" style="width:20px;height:20px;color:#1d9bf0"></i>', desc: 'Post tweets, threads, and media', auth: 'oauth' },
          { id: 'facebook', name: 'Facebook', icon: '<i data-lucide="thumbs-up" style="width:20px;height:20px;color:#1877f2"></i>', desc: 'Post to Pages, manage engagement', auth: 'oauth' },
          { id: 'instagram', name: 'Instagram', icon: '<i data-lucide="camera" style="width:20px;height:20px;color:#e4405f"></i>', desc: 'Publish posts and stories', auth: 'oauth' },
          { id: 'tiktok', name: 'TikTok', icon: '<i data-lucide="music" style="width:20px;height:20px;color:#25f4ee"></i>', desc: 'Upload videos and manage content', auth: 'oauth' },
        ]
      }
    ];

    try {
      const connections = await apiFetch('/api/connections');
      const connectedMap = {};
      connections.forEach(c => { connectedMap[c.service] = c; });

      let html = `
        <div class="page-header">
          <h1 class="page-title">Connections</h1>
          <p class="page-subtitle">Connect services for your agents to read data, think, and act</p>
        </div>`;

      serviceCategories.forEach(cat => {
        html += `
          <div class="connections-category" style="margin-bottom:var(--space-8)">
            <div style="margin-bottom:16px">
              <h2 style="font-size:18px;font-weight:700;margin:0 0 4px 0">${cat.label}</h2>
              <p class="text-sm text-muted" style="margin:0">${cat.description}</p>
            </div>
            <div class="grid-2">
              ${cat.services.map(s => {
                const conn = connectedMap[s.id];
                const isConnected = !!conn && conn.is_active;
                const testedAt = conn?.last_tested_at ? timeAgo(conn.last_tested_at) : null;
                const badgeHtml = s.badge ? `<span class="badge badge-active" style="font-size:10px;margin-left:6px">${s.badge}</span>` : '';
                return `
                <div class="connection-card ${isConnected ? 'connection-card-connected' : ''}">
                  <div class="connection-icon">${s.icon}</div>
                  <div class="connection-info">
                    <div class="connection-name">${s.name}${badgeHtml}</div>
                    <div class="connection-status">
                      <span class="connection-status-dot ${isConnected ? 'connected' : ''}"></span>
                      <span>${isConnected ? 'Connected' : 'Not connected'}</span>
                      ${testedAt ? `<span class="text-xs text-muted" style="margin-left:8px">Tested ${testedAt}</span>` : ''}
                    </div>
                    <div class="text-xs text-muted" style="margin-top:2px">${s.desc}</div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;margin-left:12px">
                    ${isConnected ? `
                      <button class="btn btn-ghost btn-sm test-conn-btn" data-service="${s.id}" data-name="${s.name}" title="Test connection">
                        <i data-lucide="activity" style="width:14px;height:14px"></i>
                      </button>
                      <button class="btn btn-secondary btn-sm disconnect-btn" data-service="${s.id}">Disconnect</button>
                    ` : `
                      <button class="btn btn-primary btn-sm connect-btn" data-service="${s.id}" data-name="${s.name}" data-auth="${s.auth}" data-fields='${s.fields ? JSON.stringify(s.fields) : ""}'>Connect</button>
                    `}
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>`;
      });

      container.innerHTML = html;
      lucide.createIcons();

      // Bind connect buttons
      document.querySelectorAll('.connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const auth = btn.dataset.auth;
          const service = btn.dataset.service;
          const name = btn.dataset.name;
          if (auth === 'oauth') {
            startOAuthFlow(service, name);
          } else {
            const fields = btn.dataset.fields ? JSON.parse(btn.dataset.fields) : [{key: 'api_key', label: 'API Key', placeholder: 'Enter your API key'}];
            showApiKeyModal(service, name, fields);
          }
        });
      });

      // Bind disconnect buttons
      document.querySelectorAll('.disconnect-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiFetch(`/api/connections/${btn.dataset.service}`, { method: 'DELETE' });
            toast('Disconnected', 'success');
            renderConnections(container);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });

      // Bind test buttons
      document.querySelectorAll('.test-conn-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const origHtml = btn.innerHTML;
          btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';
          btn.disabled = true;
          try {
            const result = await apiFetch(`/api/connections/${btn.dataset.service}/test`);
            toast(`${btn.dataset.name} connection verified`, 'success');
            renderConnections(container);
          } catch (err) {
            toast(`${btn.dataset.name}: ${err.message}`, 'error');
            btn.innerHTML = origHtml;
            btn.disabled = false;
          }
        });
      });

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load connections</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      toast(err.message, 'error');
    }
  }

  async function startOAuthFlow(service, serviceName) {
    try {
      const data = await apiFetch(`/api/oauth/start/${service}`);
      if (data.auth_url) {
        // Open OAuth popup
        const w = 600, h = 700;
        const left = (screen.width - w) / 2;
        const top = (screen.height - h) / 2;
        const popup = window.open(data.auth_url, `oauth_${service}`, `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
        
        // Listen for completion message from popup
        const handler = (event) => {
          if (event.data?.type === 'oauth_complete' && event.data?.service === service) {
            window.removeEventListener('message', handler);
            window.removeEventListener('storage', storageHandler);
            toast(`${serviceName} connected successfully`, 'success');
            const main = document.getElementById('main-content');
            if (main) renderConnections(main);
          }
        };
        window.addEventListener('message', handler);

        // Also listen for localStorage signal (fallback when postMessage fails)
        const storageHandler = (event) => {
          if (event.key === 'oauth_complete') {
            try {
              const data = JSON.parse(event.newValue);
              if (data.service === service) {
                window.removeEventListener('storage', storageHandler);
                window.removeEventListener('message', handler);
                localStorage.removeItem('oauth_complete');
                toast(`${serviceName} connected successfully`, 'success');
                const main = document.getElementById('main-content');
                if (main) renderConnections(main);
              }
            } catch(e) {}
          }
        };
        window.addEventListener('storage', storageHandler);

        // Fallback: poll for popup close
        const pollTimer = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(pollTimer);
            window.removeEventListener('message', handler);
            window.removeEventListener('storage', storageHandler);
            setTimeout(() => {
              const main = document.getElementById('main-content');
              if (main) renderConnections(main);
            }, 1000);
          }
        }, 500);
      }
    } catch (err) {
      if (err.message.includes('not configured')) {
        toast(`${serviceName} OAuth is not configured yet. Contact admin.`, 'error');
      } else {
        toast(err.message, 'error');
      }
    }
  }

  // ── BILLING VIEW ───────────────────────────
  async function renderBilling(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const profile = await apiFetch('/api/profile');
      cachedProfile = profile;
      let usage;
      try {
        usage = await apiFetch('/api/usage');
      } catch { usage = { summary: { total_calls: 0, total_tokens: 0, total_cost_usd: 0 } }; }

      const currentPlan = profile.plan || 'free';
      const callsUsed = profile.api_calls_this_month || 0;
      const callsLimit = profile.api_calls_limit || 100;
      const callsPct = callsLimit > 0 ? Math.min((callsUsed / callsLimit) * 100, 100) : 0;
      const pctClass = callsPct > 90 ? 'danger' : callsPct > 70 ? 'warning' : '';

      const plans = [
        {
          id: 'free', name: 'Free', price: '$0', period: '/forever',
          features: ['3 agents', '100 API calls/month', 'GPT-3.5 & GPT-4o Mini', 'Community support'],
        },
        {
          id: 'pro', name: 'Pro', price: '$29', period: '/month',
          features: ['10 agents', '500 API calls/month', 'All models including GPT-4o', 'Priority support', 'Advanced scheduling'],
          featured: true,
        },
        {
          id: 'enterprise', name: 'Enterprise', price: '$99', period: '/month',
          features: ['Unlimited agents', 'Unlimited API calls', 'All models', 'Dedicated support', 'Custom integrations', 'SSO & SAML'],
        },
      ];

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Billing</h1>
          <p class="page-subtitle">Manage your subscription and monitor usage</p>
        </div>

        <!-- Usage -->
        <div class="card mb-6">
          <div class="card-header">
            <h3 class="card-title">This Month's Usage</h3>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px">
            <div>
              <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">API Calls</div>
              <div style="font-size:24px;font-weight:700">${callsUsed} <span class="text-sm text-muted">/ ${callsLimit}</span></div>
              <div style="margin-top:8px">
                <div class="progress-bar"><div class="progress-bar-fill ${pctClass}" style="width:${callsPct}%"></div></div>
              </div>
            </div>
            <div>
              <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Total Tokens</div>
              <div style="font-size:24px;font-weight:700">${(usage.summary?.total_tokens || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Cost</div>
              <div style="font-size:24px;font-weight:700">$${(usage.summary?.total_cost_usd || 0).toFixed(4)}</div>
            </div>
          </div>
        </div>

        <!-- Plans -->
        <div class="pricing-grid mb-6">
          ${plans.map(plan => `
            <div class="pricing-card ${plan.featured ? 'featured' : ''} ${currentPlan === plan.id ? 'current' : ''}">
              <div class="pricing-name">${plan.name}</div>
              <div class="pricing-price">${plan.price}<span>${plan.period}</span></div>
              <div class="pricing-features">
                ${plan.features.map(f => `
                  <div class="pricing-feature">
                    <i data-lucide="check" style="width:14px;height:14px;color:var(--color-success)"></i>
                    <span>${f}</span>
                  </div>
                `).join('')}
              </div>
              ${currentPlan === plan.id
                ? `<button class="btn btn-secondary w-full" disabled>Current Plan</button>`
                : plan.id === 'free'
                  ? `<button class="btn btn-secondary w-full" disabled>Free Tier</button>`
                  : `<button class="btn btn-primary w-full upgrade-btn" data-plan="${plan.id}">Upgrade to ${plan.name}</button>`
              }
            </div>
          `).join('')}
        </div>

        ${currentPlan !== 'free' ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Subscription Management</h3>
            </div>
            <p class="text-sm text-muted mb-4">Manage your subscription, update payment methods, or cancel.</p>
            <button class="btn btn-secondary" id="manage-subscription-btn"><i data-lucide="external-link" style="width:14px;height:14px"></i> Manage Subscription</button>
          </div>
        ` : ''}
      `;

      lucide.createIcons();

      // Bind upgrade buttons
      document.querySelectorAll('.upgrade-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Redirecting...';
          try {
            const result = await apiFetch('/api/billing/create-checkout', {
              method: 'POST',
              body: JSON.stringify({
                plan: btn.dataset.plan,
                success_url: window.location.href.split('#')[0] + '#/dashboard',
                cancel_url: window.location.href.split('#')[0] + '#/billing',
              }),
            });
            if (result.checkout_url) {
              window.open(result.checkout_url, '_blank');
              toast('Stripe checkout opened in new tab', 'info');
              btn.disabled = false;
              btn.textContent = `Upgrade to ${btn.dataset.plan === 'pro' ? 'Pro' : 'Enterprise'}`;
            }
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = `Upgrade to ${btn.dataset.plan === 'pro' ? 'Pro' : 'Enterprise'}`;
          }
        });
      });

      // Manage subscription
      document.getElementById('manage-subscription-btn')?.addEventListener('click', async () => {
        try {
          const result = await apiFetch('/api/billing/portal');
          if (result.portal_url) {
            window.open(result.portal_url, '_blank');
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      });

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load billing</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      toast(err.message, 'error');
    }
  }

  // ── SETTINGS VIEW ──────────────────────────
  async function renderSettings(container) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const profile = await apiFetch('/api/profile');
      cachedProfile = profile;

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Manage your account and preferences</p>
        </div>

        <div class="card mb-6">
          <div class="settings-section">
            <h3 class="settings-section-title">Profile</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px">
              <div class="form-group">
                <label class="form-label">Display Name</label>
                <input type="text" class="form-input" id="settings-name" value="${escapeHtml(profile.display_name || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Email</label>
                <input type="email" class="form-input" value="${escapeHtml(profile.email || '')}" disabled style="opacity:0.6">
                <div class="form-hint">Email cannot be changed</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="save-profile-btn" style="margin-top:8px">
              <i data-lucide="save" style="width:14px;height:14px"></i> Save Changes
            </button>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">Account</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;max-width:600px">
              <div>
                <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Plan</div>
                <div class="font-semibold" style="text-transform:capitalize">${profile.plan || 'free'}</div>
              </div>
              <div>
                <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Agent Limit</div>
                <div class="font-semibold">${profile.agents_limit || 3}</div>
              </div>
              <div>
                <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">API Calls Limit</div>
                <div class="font-semibold">${profile.api_calls_limit || 100}/month</div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">Session</h3>
            <p class="text-sm text-muted mb-4">Sign out of your account on this device.</p>
            <button class="btn btn-secondary" id="settings-signout-btn">
              <i data-lucide="log-out" style="width:14px;height:14px"></i> Sign Out
            </button>
          </div>
        </div>
      `;

      lucide.createIcons();

      document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
        const displayName = document.getElementById('settings-name').value.trim();
        const btn = document.getElementById('save-profile-btn');
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Saving...';
        try {
          const updated = await apiFetch('/api/profile', {
            method: 'PATCH',
            body: JSON.stringify({ display_name: displayName }),
          });
          cachedProfile = updated;
          toast('Profile updated', 'success');
          btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px"></i> Save Changes';
          btn.disabled = false;
          lucide.createIcons({ nodes: [btn] });
          // Update sidebar name
          const nameEl = document.querySelector('.sidebar-user-name');
          if (nameEl) nameEl.textContent = displayName || cachedProfile.email;
        } catch (err) {
          toast(err.message, 'error');
          btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px"></i> Save Changes';
          btn.disabled = false;
          lucide.createIcons({ nodes: [btn] });
        }
      });

      document.getElementById('settings-signout-btn')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        currentSession = null;
        cachedProfile = null;
        navigate('#/login');
      });

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load settings</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      toast(err.message, 'error');
    }
  }

  // ── SIDEBAR TOGGLE ─────────────────────────
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebarOpen = !sidebarOpen;
    sidebar?.classList.toggle('open', sidebarOpen);
    backdrop?.classList.toggle('open', sidebarOpen);
  }

  // ── INIT ───────────────────────────────────
  async function init() {
    // 1. Load config from backend
    try {
      const cfgRes = await fetch(`${API}/api/config`);
      if (!cfgRes.ok) throw new Error('Failed to load config');
      const cfg = await cfgRes.json();
      SUPABASE_URL = cfg.supabase_url;
      SUPABASE_ANON_KEY = cfg.supabase_anon_key;
      STRIPE_PK = cfg.stripe_publishable_key || '';
    } catch (err) {
      console.error('Config load failed:', err);
      document.getElementById('app').innerHTML = '<div style="padding:2rem;text-align:center;"><h2>Unable to connect to server</h2><p>Please try again in a moment.</p></div>';
      return;
    }

    // 2. Initialize Supabase client
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 3. Get initial session FIRST (before registering auth listener)
    const { data: { session } } = await supabase.auth.getSession();
    currentSession = session;

    // 4. Listen for auth state changes (after initial session is set)
    supabase.auth.onAuthStateChange((event, session) => {
      const hadSession = !!currentSession;
      currentSession = session;

      if (event === 'SIGNED_IN' && !hadSession) {
        cachedProfile = null;
        // Only redirect to dashboard if on an auth route
        const currentRoute = getRoute();
        const authRoutes = ['#/login', '#/signup', '#/forgot'];
        if (authRoutes.includes(currentRoute) || !currentRoute || currentRoute === '') {
          navigate('#/dashboard');
        } else {
          render();
        }
      } else if (event === 'SIGNED_OUT') {
        currentSession = null;
        cachedProfile = null;
        navigate('#/login');
      } else if (event === 'TOKEN_REFRESHED') {
        // Just update session, no navigation needed
      }
    });

    // Listen for hash changes
    window.addEventListener('hashchange', render);

    // Initial render
    if (!window.location.hash) {
      window.location.hash = currentSession ? '#/dashboard' : '#/login';
    }
    render();
  }

  // ── PUBLIC API (for onclick handlers) ──────
  window.NC = {
    toggleSidebar,
    render,
    resetWizard: () => {
      wizardStep = 0;
      wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [] };
      navigate('#/wizard');
    },
  };

  // ── BOOT ───────────────────────────────────
  init();

})();
