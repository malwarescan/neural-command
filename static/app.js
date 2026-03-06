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
    data_scope: { github_repo: '', gsc_site: '', bing_site: '' },
    automation_mode: 'approval_publish_distribution',
    approval_rules: {
      require_for_all_actions: false,
      require_for_publish: true,
      require_for_distribution: true,
      block_money_pages_without_approval: true,
      max_executions_per_day: 8,
    },
    execution_permissions: {
      draft_content: true,
      patch_existing_pages: true,
      create_new_pages: false,
      apply_schema_only: true,
      publish_content: false,
      distribute_social: false,
      submit_indexing: true,
      update_markdown_layers: true,
    },
    allowed_targets: {
      site_sections: [],
      distribution_channels: [],
      competitor_domains: [],
    },
    lifecycle_state: 'Watching',
    success_metrics: [],
  };
  let scopeOptionsCache = null;

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

  function normalizeRulesBundle(rules) {
    if (Array.isArray(rules)) {
      return { text_rules: rules.filter(Boolean), data_scope: {}, operator_settings: {} };
    }
    if (rules && typeof rules === 'object') {
      return {
        text_rules: Array.isArray(rules.text_rules) ? rules.text_rules.filter(Boolean) : [],
        data_scope: (rules.data_scope && typeof rules.data_scope === 'object') ? rules.data_scope : {},
        operator_settings: (rules.operator_settings && typeof rules.operator_settings === 'object') ? rules.operator_settings : {},
      };
    }
    return { text_rules: [], data_scope: {}, operator_settings: {} };
  }

  function getAgentDataScope(agent) {
    const bundle = normalizeRulesBundle(agent?.rules);
    const scope = bundle.data_scope || {};
    return {
      github_repo: scope.github_repo || '',
      gsc_site: scope.gsc_site || '',
      bing_site: scope.bing_site || '',
    };
  }

  function getAgentOperatorSettings(agent) {
    const bundle = normalizeRulesBundle(agent?.rules);
    const s = bundle.operator_settings || {};
    return {
      automation_mode: s.automation_mode || agent?.automation_mode || 'approval_publish_distribution',
      approval_rules: s.approval_rules || agent?.approval_rules || {},
      execution_permissions: s.execution_permissions || agent?.execution_permissions || {},
      allowed_targets: s.allowed_targets || agent?.allowed_targets || {},
      lifecycle_state: s.lifecycle_state || agent?.lifecycle_state || 'Watching',
      success_metrics: Array.isArray(s.success_metrics) ? s.success_metrics : (Array.isArray(agent?.success_metrics) ? agent.success_metrics : []),
    };
  }

  async function loadScopeOptions(force = false) {
    if (!force && scopeOptionsCache) return scopeOptionsCache;
    const opts = await apiFetch('/api/agent-scope/options');
    scopeOptionsCache = opts || { github_repos: [], gsc_sites: [], bing_sites: [] };
    return scopeOptionsCache;
  }

  // ── TOAST ──────────────────────────────────
  function toast(message, type = 'info') {
    if (demoStatusCache?.recording_mode && type === 'info') return;
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
      { icon: 'layout-dashboard', label: 'Overview', hash: '#/dashboard' },
      { icon: 'radar', label: 'Command Center', hash: '#/command-center' },
      { icon: 'bot', label: 'Agents', hash: '#/agents' },
      { icon: 'plus-circle', label: 'Create Operator', hash: '#/wizard' },
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
    let pageTitle = 'Overview';
    if (route === '#/command-center') pageTitle = 'Command Center';
    else if (route === '#/agents') pageTitle = 'Operators';
    else if (route === '#/wizard') pageTitle = 'Create Search Operator';
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
      const ops = data.search_ops || {};
      const loop = ops.lifecycle_counts || {};
      const k = ops.kpis || {};
      const plan = data.current_plan || 'free';
      const callsPct = data.api_calls_limit > 0 ? Math.min((data.api_calls_this_month / data.api_calls_limit) * 100, 100) : 0;
      const pctClass = callsPct > 90 ? 'danger' : callsPct > 70 ? 'warning' : '';

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Search Operations Overview</h1>
          <p class="page-subtitle">${escapeHtml(ops.headline || 'Detect opportunities. Execute updates. Earn visibility.')}</p>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><h3 class="card-title">Operating Loop</h3></div>
          <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr)">
            <div class="kpi-card"><div class="kpi-label">Observe</div><div class="kpi-value">${loop.observe || 0}</div><div class="kpi-meta">Signals detected</div></div>
            <div class="kpi-card"><div class="kpi-label">Diagnose</div><div class="kpi-value">${loop.diagnose || 0}</div><div class="kpi-meta">Opportunities formed</div></div>
            <div class="kpi-card"><div class="kpi-label">Plan</div><div class="kpi-value">${loop.plan || 0}</div><div class="kpi-meta">Plans ready</div></div>
            <div class="kpi-card"><div class="kpi-label">Execute</div><div class="kpi-value">${loop.execute || 0}</div><div class="kpi-meta">Executions active</div></div>
            <div class="kpi-card"><div class="kpi-label">Measure</div><div class="kpi-value">${loop.measure || 0}</div><div class="kpi-meta">Outcomes measured</div></div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Active Agents</div>
            <div class="kpi-value">${k.active_agents ?? data.active_agents}</div>
            <div class="kpi-meta">${data.total_agents} total operators</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Signals Today</div>
            <div class="kpi-value">${k.signals_detected_today || 0}</div>
            <div class="kpi-meta">${k.opportunities_open || 0} open opportunities</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Plans / Executions</div>
            <div class="kpi-value">${k.plans_ready || 0}<span style="font-size:14px;color:var(--color-text-muted)"> ready</span></div>
            <div class="kpi-meta">${k.executions_today || 0} executions today</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Citations Earned</div>
            <div class="kpi-value">${k.citations_earned || 0}</div>
            <div class="kpi-meta">Visibility lift ${k.estimated_visibility_lift || 0}%</div>
          </div>
        </div>

        <div class="cc-grid-2" style="margin-top:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Top Active Signals</h3></div>
            ${(ops.signals || []).slice(0, 4).map(s => `
              <div class="cc-activity-item">
                <span class="badge badge-${s.severity === 'high' ? 'failed' : s.severity === 'medium' ? 'warning' : 'active'}">${escapeHtml(s.severity || 'low')}</span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">${escapeHtml(s.title || '')}</span>
                  <span class="cc-activity-text">${escapeHtml(s.description || '')}</span>
                </div>
              </div>
            `).join('') || '<p class="text-sm text-muted">No active signals</p>'}
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Top Citation Gaps</h3></div>
            ${(ops.citation_gaps || []).slice(0, 3).map(g => `
              <div class="cc-activity-item">
                <span class="tag">${escapeHtml(g.gap_type || 'gap')}</span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">${escapeHtml(g.target_topic || '')}</span>
                  <span class="cc-activity-text">Format: ${escapeHtml(g.content_format_recommended || 'n/a')} · Urgency ${(Math.round((g.urgency_score || 0) * 100))}%</span>
                </div>
              </div>
            `).join('') || '<p class="text-sm text-muted">No citation gaps detected</p>'}
          </div>
        </div>

        <div class="kpi-grid" style="margin-top:16px">
          <div class="kpi-card">
            <div class="kpi-label">Ranking Wins</div>
            <div class="kpi-value">${k.ranking_wins || 0}</div>
            <div class="kpi-meta">Recovered / improved positions</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Content Published</div>
            <div class="kpi-value">${k.content_published || 0}</div>
            <div class="kpi-meta">Pages and articles shipped</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Distribution Actions</div>
            <div class="kpi-value">${k.distribution_actions || 0}</div>
            <div class="kpi-meta">Threads/posts shipped</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">API Calls</div>
            <div class="kpi-value">${data.api_calls_this_month}<span style="font-size:14px;color:var(--color-text-muted)">/${data.api_calls_limit}</span></div>
            <div style="margin-top:8px">
              <div class="progress-bar"><div class="progress-bar-fill ${pctClass}" style="width:${callsPct}%"></div></div>
            </div>
          </div>
        </div>

        ${data.total_agents === 0 ? `
          <div class="card" style="text-align:center;padding:48px 24px;margin-bottom:24px">
            <div class="empty-state-icon" style="margin:0 auto 16px"><i data-lucide="bot" style="width:28px;height:28px"></i></div>
            <h3 class="empty-state-title">Create Your First Search Operator</h3>
            <p class="empty-state-desc">Define what it watches, what actions it can execute, and how success is measured.</p>
            <a href="#/wizard" class="btn btn-primary btn-lg">Create Operator</a>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Executions</h3>
          </div>
          ${data.recent_runs.length === 0
            ? `<p class="text-sm text-muted" style="padding:16px 0">No recent executions yet. Use Command Center to approve or run a plan.</p>`
            : `<table class="runs-table">
                <thead>
                  <tr>
                    <th>Operator</th>
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
  let ccIntelCache = null;
  let demoScenariosCache = [];
  let demoPacksCache = [];
  let demoStatusCache = null;
  let walkthroughLibraryCache = [];
  let walkthroughStatusCache = null;
  let walkthroughOverlayEl = null;
  let walkthroughAutoTimer = null;
  let ccFilter = {
    status: 'all',
    approval: 'all',
    assigned_agent: 'all',
    object_type: 'all',
  };
  let ccSelection = {
    signals: new Set(),
    opportunities: new Set(),
    plans: new Set(),
    executions: new Set(),
  };
  let ccScope = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nc_cc_scope') || '{}');
      return {
        mode: saved.mode === 'agent' ? 'agent' : 'site',
        agent_id: saved.agent_id || '',
        github_repo: saved.github_repo || '',
        gsc_site: saved.gsc_site || '',
        bing_site: saved.bing_site || '',
      };
    } catch {
      return { mode: 'site', agent_id: '', github_repo: '', gsc_site: '', bing_site: '' };
    }
  })();

  function saveCCScope() {
    try { localStorage.setItem('nc_cc_scope', JSON.stringify(ccScope)); } catch {}
  }

  function getCCScopeQuery() {
    const p = new URLSearchParams();
    p.set('scope_mode', ccScope.mode || 'site');
    if (ccScope.mode === 'agent' && ccScope.agent_id) p.set('agent_id', ccScope.agent_id);
    if (ccScope.mode === 'site') {
      if (ccScope.github_repo) p.set('github_repo', ccScope.github_repo);
      if (ccScope.gsc_site) p.set('gsc_site', ccScope.gsc_site);
      if (ccScope.bing_site) p.set('bing_site', ccScope.bing_site);
    }
    return p.toString() ? `?${p.toString()}` : '';
  }

  async function loadSearchOpsIntel() {
    const data = await apiFetch(`/api/search-ops/intelligence${getCCScopeQuery()}`);
    ccIntelCache = data;
    demoStatusCache = data.demo_status || demoStatusCache;
    return data;
  }

  async function loadDemoScenarios() {
    const res = await apiFetch('/api/demo/scenarios');
    demoScenariosCache = res.scenarios || [];
    return demoScenariosCache;
  }

  async function loadDemoPacks() {
    const res = await apiFetch('/api/demo/demo-packs');
    demoPacksCache = res.demo_packs || [];
    return demoPacksCache;
  }

  async function loadDemoStatus() {
    const res = await apiFetch('/api/demo/scenario/status');
    demoStatusCache = res.status || null;
    return res;
  }

  async function loadWalkthroughLibrary() {
    const res = await apiFetch('/api/demo/walkthroughs');
    walkthroughLibraryCache = res.walkthroughs || [];
    return walkthroughLibraryCache;
  }

  async function loadWalkthroughStatus() {
    const res = await apiFetch('/api/demo/walkthrough/status');
    walkthroughStatusCache = res.status || null;
    return walkthroughStatusCache;
  }

  async function demoAction(path, body = null) {
    const res = await apiFetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res?.status) demoStatusCache = res.status;
    if (res?.intelligence) ccIntelCache = res.intelligence;
    return res;
  }

  function objectTypePath(kind) {
    if (kind === 'signal') return 'signals';
    if (kind === 'opportunity') return 'opportunities';
    if (kind === 'citation_gap') return 'citation-gaps';
    if (kind === 'plan') return 'plans';
    if (kind === 'execution') return 'executions';
    if (kind === 'outcome') return 'outcomes';
    if (kind === 'competitor') return 'competitors';
    if (kind === 'agent') return 'agents';
    if (kind === 'approval') return 'approvals';
    if (kind === 'artifact') return 'artifacts';
    return '';
  }

  function getObjectStatus(obj) {
    return (obj?.status || obj?.approval_state || '').toString().toLowerCase();
  }

  function matchesCCFilter(obj) {
    if (!obj) return true;
    if (ccFilter.status !== 'all') {
      const state = getObjectStatus(obj);
      if (!state.includes(ccFilter.status)) return false;
    }
    if (ccFilter.approval === 'required') {
      const needsApproval = String(obj.approval_state || '').includes('pending') || String(obj.status || '').includes('pending_approval');
      if (!needsApproval) return false;
    }
    if (ccFilter.assigned_agent !== 'all') {
      const assigned = obj.assigned_agent_id || obj.agent_id || 'unassigned';
      if (assigned !== ccFilter.assigned_agent) return false;
    }
    return true;
  }

  function renderCCQueueBar(intel) {
    const q = intel?.queue_counts || {};
    const chips = [
      ['New Signals', q.new_signals || 0, 'signals', 'new'],
      ['Open Opportunities', q.open_opportunities || 0, 'opportunities', 'open'],
      ['Needs Approval', q.needs_approval || 0, 'plans', 'pending'],
      ['Ready to Run', q.ready_to_run || 0, 'plans', 'approved'],
      ['Running', q.running || 0, 'executions', 'running'],
      ['Measuring Outcomes', q.measuring_outcomes || 0, 'outcomes', 'measuring'],
      ['Dismissed / Snoozed', q.dismissed_or_snoozed || 0, 'signals', 'dismissed'],
      ['Failed / Review', q.failed_or_review || 0, 'executions', 'failed'],
    ];
    return `<div class="card" style="margin-bottom:12px;padding:10px">
      <div class="text-xs text-muted" style="margin-bottom:8px">Operational Queues</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${chips.map(([label, value, tab, status]) => `
          <button class="btn btn-ghost btn-sm cc-queue-chip" data-tab="${tab}" data-status="${status}">
            ${escapeHtml(label)} <span class="badge badge-active" style="margin-left:6px">${value}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
  }

  function getDrawerActions(kind, obj) {
    if (kind === 'signal') return [
      { id: 'create_opportunity', label: 'Create Opportunity', tone: 'primary' },
      { id: 'assign', label: 'Assign to Operator' },
      { id: 'snooze', label: 'Snooze' },
      { id: 'merge_opportunity', label: 'Merge into Opportunity' },
      { id: 'convert_plan', label: 'Convert to Plan' },
      { id: 'dismiss', label: 'Dismiss Signal' },
      { id: 'mark_noise', label: 'Mark as Noise' },
    ];
    if (kind === 'opportunity') return [
      { id: 'create_plan', label: 'Create Plan', tone: 'primary' },
      { id: 'assign', label: 'Assign to Operator' },
      { id: 'send_review', label: 'Send to Review' },
      { id: 'auto_handle', label: 'Mark Auto-Handled' },
      { id: 'escalate_priority', label: 'Escalate Priority' },
      { id: 'snooze', label: 'Snooze' },
      { id: 'dismiss', label: 'Dismiss' },
    ];
    if (kind === 'citation_gap') return [
      { id: 'create_plan', label: 'Create Plan from Gap', tone: 'primary' },
      { id: 'merge_plan', label: 'Merge into Existing Plan' },
      { id: 'assign', label: 'Assign to Operator' },
      { id: 'snooze', label: 'Snooze Gap' },
      { id: 'dismiss', label: 'Dismiss Gap' },
    ];
    if (kind === 'plan') return [
      { id: 'approve_and_run', label: 'Approve and Run', tone: 'primary' },
      { id: 'approve', label: 'Approve' },
      { id: 'reject', label: 'Reject' },
      { id: 'pause', label: 'Pause' },
      { id: 'resume', label: 'Resume' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'schedule', label: 'Schedule' },
      { id: 'assign', label: 'Assign' },
      { id: 'cancel', label: 'Cancel' },
    ];
    if (kind === 'execution') return [
      { id: 'retry_step', label: 'Retry Failed Step', tone: 'primary' },
      { id: 'rerun', label: 'Rerun Full Execution' },
      { id: 'approve_blocked', label: 'Continue After Approval' },
      { id: 'pause', label: 'Pause Execution' },
      { id: 'resume', label: 'Resume Execution' },
      { id: 'cancel', label: 'Cancel Execution' },
      { id: 'branch_to_plan', label: 'Branch to New Plan' },
      { id: 'mark_review', label: 'Mark for Review' },
    ];
    if (kind === 'outcome') return [
      { id: 'validate', label: 'Validate Outcome', tone: 'primary' },
      { id: 'create_followup_opportunity', label: 'Spawn Follow-Up Opportunity' },
      { id: 'mark_inconclusive', label: 'Flag Inconclusive' },
      { id: 'archive', label: 'Archive' },
    ];
    if (kind === 'competitor') return [
      { id: 'spawn_counter_opportunity', label: 'Spawn Counter Opportunity', tone: 'primary' },
      { id: 'assign_monitoring', label: 'Assign Monitoring' },
      { id: 'increase_priority', label: 'Increase Watch Priority' },
      { id: 'mute', label: 'Mute / Deprioritize' },
    ];
    return [];
  }

  function lookupIntelObject(kind, id, intel) {
    const src = intel || ccIntelCache || {};
    if (kind === 'signal') return (src.signals || []).find(x => x.id === id);
    if (kind === 'opportunity') return (src.opportunities || []).find(x => x.id === id);
    if (kind === 'citation_gap') return (src.citation_gaps || []).find(x => x.gap_id === id || x.id === id);
    if (kind === 'plan') return (src.plans || []).find(x => x.id === id);
    if (kind === 'execution') return (src.executions || []).find(x => x.id === id);
    if (kind === 'outcome') return (src.outcomes || []).find(x => x.id === id);
    if (kind === 'competitor') return (src.competitors || []).find(x => x.id === id);
    if (kind === 'agent') return (src.agents || []).find(x => x.id === id);
    return null;
  }

  function renderLinkChain(links = []) {
    if (!links.length) return '';
    return `<div class="text-xs text-muted" style="margin:10px 0 14px 0">` + links.map(l =>
      `<a href="#" class="intel-link" data-kind="${l.kind}" data-id="${escapeHtml(l.id)}">${escapeHtml(l.label)}</a>`
    ).join(' &nbsp;&gt;&nbsp; ') + `</div>`;
  }

  async function mutateIntelObject(kind, id, action, payload = {}) {
    const path = objectTypePath(kind);
    if (!path) throw new Error('Unsupported object type');
    const res = await apiFetch(`/api/search-ops/${path}/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    });
    if (res?.intelligence) ccIntelCache = res.intelligence;
    return res;
  }

  async function batchMutateIntelObjects(kind, ids, action, payload = {}) {
    const path = objectTypePath(kind);
    if (!path) throw new Error('Unsupported object type');
    const res = await apiFetch(`/api/search-ops/${path}/batch-action`, {
      method: 'POST',
      body: JSON.stringify({ action, object_ids: ids, payload }),
    });
    if (res?.intelligence) ccIntelCache = res.intelligence;
    return res;
  }

  async function buildActionPayload(kind, action, obj) {
    const payload = {};
    if (action === 'assign' || action === 'assign_monitoring') {
      const agentId = prompt('Assign to agent ID (leave blank to cancel):', obj?.assigned_agent_id || '');
      if (!agentId) return null;
      payload.agent_id = agentId.trim();
      payload.agent_name = prompt('Agent display name (optional):', obj?.assigned_agent_name || '') || '';
    }
    if (action === 'merge_opportunity') {
      const opportunityId = prompt('Merge into opportunity ID:', (obj?.linked_opportunity_ids || [])[0] || '');
      if (!opportunityId) return null;
      payload.opportunity_id = opportunityId.trim();
    }
    if (action === 'merge_plan') {
      const planId = prompt('Merge into plan ID:');
      if (!planId) return null;
      payload.plan_id = planId.trim();
    }
    if (action === 'schedule') {
      const scheduled = prompt('Schedule timestamp (ISO or note):', new Date(Date.now() + 3600 * 1000).toISOString());
      if (!scheduled) return null;
      payload.scheduled_for = scheduled;
    }
    if (action === 'dismiss' || action === 'mark_noise' || action === 'reject') {
      payload.reason = prompt('Reason (optional):', '') || '';
    }
    if (action === 'snooze') {
      payload.until = prompt('Snooze until (ISO/date note):', 'Tomorrow 09:00') || '';
    }
    if (action === 'retry_step') {
      payload.step = prompt('Step name or ID to retry:', 'failed_step') || 'failed_step';
    }
    if (action === 'approve_blocked') {
      payload.reason = prompt('Approval note (optional):', '') || '';
    }
    if (action === 'track_topics') {
      const topics = prompt('Topics (comma separated):', '');
      if (!topics) return null;
      payload.topics = topics.split(',').map(s => s.trim()).filter(Boolean);
    }
    return payload;
  }

  function clearWalkthroughOverlay() {
    if (walkthroughAutoTimer) { clearTimeout(walkthroughAutoTimer); walkthroughAutoTimer = null; }
    if (walkthroughOverlayEl && walkthroughOverlayEl.parentNode) walkthroughOverlayEl.parentNode.removeChild(walkthroughOverlayEl);
    walkthroughOverlayEl = null;
    const prior = document.querySelector('.wt-highlight-target');
    if (prior) prior.classList.remove('wt-highlight-target');
  }

  function findWalkthroughTarget(step) {
    if (!step) return null;
    if (step.target_selector) {
      try { return document.querySelector(step.target_selector); } catch { return null; }
    }
    return null;
  }

  function applyWalkthroughAutoNavigation(step) {
    if (!step) return;
    if (step.action_type === 'navigate_tab' && step.completion_condition?.tab) {
      ccActiveTab = step.completion_condition.tab;
      const main = document.getElementById('main-content');
      if (main && location.hash === '#/command-center') renderCommandCenter(main);
      return;
    }
    if (step.action_type === 'open_inspect' && step.object_ref?.kind) {
      const intel = ccIntelCache || {};
      const kind = step.object_ref.kind;
      let id = step.object_ref.id;
      if (!id) {
        const src = kind === 'execution' ? intel.executions : kind === 'signal' ? intel.signals : kind === 'opportunity' ? intel.opportunities : [];
        id = (src && src[0] && src[0].id) || '';
      }
      if (id) window.NC.inspectIntelObject(kind, id, intel);
    }
  }

  function renderWalkthroughOverlay(status) {
    if (!document.getElementById('wt-overlay-style')) {
      const st = document.createElement('style');
      st.id = 'wt-overlay-style';
      st.textContent = `.wt-highlight-target{outline:2px solid #00c8ff !important;outline-offset:2px;box-shadow:0 0 0 6px rgba(0,200,255,0.12) !important;}`;
      document.head.appendChild(st);
    }
    clearWalkthroughOverlay();
    const wt = status?.walkthrough || {};
    const step = status?.current_step;
    if (!status?.walkthrough_active || !step) return;
    const target = findWalkthroughTarget(step);
    if (target) target.classList.add('wt-highlight-target');
    walkthroughOverlayEl = el('div', { className: 'modal-overlay' });
    walkthroughOverlayEl.style.pointerEvents = 'none';
    walkthroughOverlayEl.innerHTML = `
      <div class="modal" style="max-width:430px;position:fixed;right:18px;bottom:18px;pointer-events:auto">
        <div class="modal-header">
          <h3 class="modal-title">Walkthrough · ${escapeHtml(wt.name || '')}</h3>
          <button class="btn btn-ghost btn-xs wt-close">End</button>
        </div>
        <div class="modal-body">
          <div class="text-xs text-muted">Step ${Number(status.current_step_index || 0) + 1} / ${Number(wt.total_steps || (wt.steps || []).length || 0)}</div>
          <div class="text-xs text-muted" style="margin-top:2px">Path: ${escapeHtml(status.walkthrough_path_signature || 'mainline')} ${status.current_branch_id ? `· Branch ${escapeHtml(status.current_branch_id)}` : ''}</div>
          <div class="text-sm" style="font-weight:600;margin-top:4px">${escapeHtml(step.title || '')}</div>
          <div class="text-xs text-muted" style="margin-top:4px">${escapeHtml(step.description || '')}</div>
          <div class="text-xs" style="margin-top:8px"><strong>Expected action:</strong> ${escapeHtml(step.expected_user_action || 'Follow guided instruction')}</div>
          <div class="text-xs" style="margin-top:4px"><strong>Business value:</strong> ${escapeHtml(step.business_value_note || '')}</div>
          ${step.speaker_note ? `<div class="text-xs" style="margin-top:4px"><strong>Speaker note:</strong> ${escapeHtml(step.speaker_note)}</div>` : ''}
          ${(step.optional_branching || []).length ? `<div style="margin-top:8px;padding:6px;border:1px solid var(--color-border);border-radius:6px">
            <div class="text-xs" style="font-weight:600;margin-bottom:6px">Choose path</div>
            ${(step.optional_branching || []).map(b => `<button class="btn btn-secondary btn-xs wt-branch" data-branch-id="${escapeHtml(b.branch_id)}" style="margin:2px 4px 2px 0">${escapeHtml(b.label || b.branch_id)}</button><div class="text-xs text-muted" style="margin-bottom:4px">${escapeHtml(b.description || '')}</div>`).join('')}
          </div>` : ''}
          ${!target ? `<div class="text-xs text-muted" style="margin-top:6px">Target not currently visible. Use auto-open or continue manually.</div>` : ''}
        </div>
        <div class="modal-footer" style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-xs wt-back">Back</button>
          <button class="btn btn-secondary btn-xs wt-mainline">Return Mainline</button>
          <button class="btn btn-secondary btn-xs wt-auto">Auto-open target</button>
          <button class="btn btn-primary btn-xs wt-next">Next</button>
          <button class="btn btn-secondary btn-xs wt-pause">Pause</button>
        </div>
      </div>`;
    document.body.appendChild(walkthroughOverlayEl);
    walkthroughOverlayEl.querySelector('.wt-close')?.addEventListener('click', async () => {
      await apiFetch('/api/demo/walkthrough/end', { method: 'POST' });
      clearWalkthroughOverlay();
      toast('Walkthrough ended', 'success');
    });
    walkthroughOverlayEl.querySelector('.wt-back')?.addEventListener('click', async () => {
      await apiFetch('/api/demo/walkthrough/back', { method: 'POST' });
      const st = await loadWalkthroughStatus();
      renderWalkthroughOverlay(st);
    });
    walkthroughOverlayEl.querySelector('.wt-mainline')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/walkthrough/return-mainline', { method: 'POST' });
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
      } catch (err) { toast(err.message || 'Failed to return mainline', 'error'); }
    });
    walkthroughOverlayEl.querySelectorAll('.wt-branch').forEach(btn => btn.addEventListener('click', async () => {
      const branchId = btn.dataset.branchId;
      if (!branchId) return;
      try {
        await apiFetch('/api/demo/walkthrough/branch', { method: 'POST', body: JSON.stringify({ branch_id: branchId }) });
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
      } catch (err) { toast(err.message || 'Branch selection failed', 'error'); }
    }));
    walkthroughOverlayEl.querySelector('.wt-auto')?.addEventListener('click', () => applyWalkthroughAutoNavigation(step));
    walkthroughOverlayEl.querySelector('.wt-next')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/demo/walkthrough/next', { method: 'POST' });
        if (res.validation && !res.validation.ok) toast(res.validation.message || 'Step not complete yet', 'warning');
        await loadSearchOpsIntel();
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
      } catch (err) { toast(err.message || 'Failed to advance walkthrough', 'error'); }
    });
    walkthroughOverlayEl.querySelector('.wt-pause')?.addEventListener('click', async () => {
      await apiFetch('/api/demo/walkthrough/pause', { method: 'POST' });
      clearWalkthroughOverlay();
      toast('Walkthrough paused', 'success');
    });
    const isRecorded = String(status?.mode || '').toLowerCase().includes('recorded');
    if (isRecorded && step.can_auto_advance) {
      walkthroughAutoTimer = setTimeout(async () => {
        try {
          applyWalkthroughAutoNavigation(step);
          const res = await apiFetch('/api/demo/walkthrough/next', { method: 'POST' });
          if (res.validation && !res.validation.ok) return;
          await loadSearchOpsIntel();
          const st = await loadWalkthroughStatus();
          renderWalkthroughOverlay(st);
        } catch {}
      }, Number(step.auto_advance_delay_ms || 900));
    }
  }

  function showIntelInspect(kind, id, providedIntel = null) {
    const intel = providedIntel || ccIntelCache || {};
    const obj = lookupIntelObject(kind, id, intel);
    if (!obj) { toast('Object not found', 'error'); return; }

    const overlay = el('div', { className: 'modal-overlay' });
    const links = [];
    if (kind === 'signal' && Array.isArray(obj.linked_opportunity_ids)) {
      obj.linked_opportunity_ids.forEach(oid => links.push({ kind: 'opportunity', id: oid, label: `Opportunity ${oid}` }));
    }
    if (kind === 'opportunity') {
      (obj.signal_ids || []).forEach(sid => links.push({ kind: 'signal', id: sid, label: `Signal ${sid}` }));
      (obj.linked_plan_ids || []).forEach(pid => links.push({ kind: 'plan', id: pid, label: `Plan ${pid}` }));
    }
    if (kind === 'citation_gap') {
      (obj.linked_plan_ids || []).forEach(pid => links.push({ kind: 'plan', id: pid, label: `Plan ${pid}` }));
    }
    if (kind === 'plan') {
      if (obj.opportunity_id) links.push({ kind: 'opportunity', id: obj.opportunity_id, label: `Opportunity ${obj.opportunity_id}` });
      (obj.linked_gap_ids || []).forEach(gid => links.push({ kind: 'citation_gap', id: gid, label: `Gap ${gid}` }));
    }
    if (kind === 'execution') {
      if (obj.plan_id) links.push({ kind: 'plan', id: obj.plan_id, label: `Plan ${obj.plan_id}` });
      (obj.linked_outcome_ids || []).forEach(oid => links.push({ kind: 'outcome', id: oid, label: `Outcome ${oid}` }));
    }
    if (kind === 'outcome' && obj.execution_id) {
      links.push({ kind: 'execution', id: obj.execution_id, label: `Execution ${obj.execution_id}` });
    }
    if (kind === 'competitor') {
      (obj.opportunity_links || []).forEach(oid => links.push({ kind: 'opportunity', id: oid, label: `Opportunity ${oid}` }));
    }

    let body = '';
    if (kind === 'signal') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.title || '')}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">${escapeHtml(obj.type || '')} · ${escapeHtml(obj.source || '')} · severity ${escapeHtml(obj.severity || 'n/a')} · confidence ${Math.round((obj.confidence || 0) * 100)}%</div>
        ${renderLinkChain(links)}
        <div class="text-sm" style="margin-bottom:10px">${escapeHtml(obj.description || '')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Target topic: ${escapeHtml(obj.topic || 'n/a')} · Cluster: ${escapeHtml(obj.target_keyword_cluster || 'n/a')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Target page: ${escapeHtml(obj.target_page || 'n/a')} · Competitor: ${escapeHtml(obj.competitor_domain || 'n/a')}</div>
        <div class="card-flat" style="padding:10px;border:1px solid var(--color-border);border-radius:8px">
          <div class="text-xs" style="font-weight:600;margin-bottom:6px">Evidence</div>
          ${(obj.evidence || []).map(e => `<div class="text-xs text-muted" style="margin-bottom:4px">- ${escapeHtml(e)}</div>`).join('') || '<div class="text-xs text-muted">No evidence attached</div>'}
          <div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Why Flagged</div>
          ${(obj.why_flagged || []).map(e => `<div class="text-xs text-muted" style="margin-bottom:4px">- ${escapeHtml(e)}</div>`).join('') || '<div class="text-xs text-muted">No rationale attached</div>'}
        </div>
      `;
    } else if (kind === 'opportunity') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.title || '')}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">${escapeHtml(obj.type || '')} · urgency ${Math.round((obj.urgency || 0) * 100)}% · confidence ${Math.round((obj.confidence || 0) * 100)}% · citation ${Math.round((obj.citation_probability || 0) * 100)}%</div>
        ${renderLinkChain(links)}
        <div class="text-sm" style="margin-bottom:10px">${escapeHtml(obj.description || '')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px"><strong>Rationale:</strong> ${escapeHtml(obj.rationale || 'No rationale provided')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Recommended format: ${escapeHtml(obj.recommended_format || 'n/a')} · target: ${escapeHtml(obj.recommended_target || 'n/a')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Expected impact: ${escapeHtml(obj.expected_impact || 'n/a')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${(obj.recommended_actions || []).map(a => `<span class="tag">${escapeHtml(a)}</span>`).join('')}</div>
      `;
    } else if (kind === 'citation_gap') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.gap_type || 'citation_gap')}</strong> · ${escapeHtml(obj.target_topic || '')}</div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">Urgency ${Math.round((obj.urgency_score || 0) * 100)}% · confidence ${Math.round((obj.confidence_score || 0) * 100)}% · citation ${Math.round((obj.citation_probability_score || 0) * 100)}%</div>
        ${renderLinkChain(links)}
        <div class="text-xs text-muted" style="margin-bottom:6px">Source: ${escapeHtml(obj.source_type || '')} · ${escapeHtml(obj.source_url || obj.source_entity || 'n/a')}</div>
        <div class="text-xs text-muted" style="margin-bottom:6px">Competitor URL: ${escapeHtml(obj.competitor_url || 'n/a')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Format: ${escapeHtml(obj.content_format_recommended || '')} · Schema: ${(obj.supporting_schema_recommended || []).map(escapeHtml).join(', ')}</div>
        <div class="text-xs text-muted" style="margin-bottom:6px"><strong>Missing entities:</strong> ${(obj.missing_entities || []).map(escapeHtml).join(', ') || 'n/a'}</div>
        <div class="text-xs text-muted" style="margin-bottom:6px"><strong>Missing questions:</strong> ${(obj.missing_questions || []).map(escapeHtml).join(' | ') || 'n/a'}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px"><strong>Human explanation:</strong> ${escapeHtml(obj.human_explanation || obj.expected_outcome || '')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${(obj.proposed_actions || []).map(a => `<span class="tag">${escapeHtml(a)}</span>`).join('')}</div>
      `;
    } else if (kind === 'plan') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.name || '')}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">Approval: ${escapeHtml(obj.approval_state || 'pending')} · Impact: ${escapeHtml(obj.estimated_impact || 'n/a')} · Cost est: $${Number(obj.estimated_cost || 0).toFixed(4)}</div>
        ${renderLinkChain(links)}
        <div class="text-xs text-muted" style="margin-bottom:8px">${escapeHtml(obj.description || '')}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px"><strong>Why this exists:</strong> ${escapeHtml(obj.why_this_plan_exists || 'No rationale attached')}</div>
        <ol style="padding-left:18px;font-size:12px;color:var(--color-text-secondary)">${(obj.steps || []).map(s => `<li>${escapeHtml(typeof s === 'string' ? s : `${s.step_type || 'step'} · ${s.provider || 'provider'} · ${s.target || 'target'}${s.approval_required ? ' · approval required' : ''}`)}</li>`).join('')}</ol>
      `;
    } else if (kind === 'execution') {
      const steps = obj.steps || [];
      const artifacts = (obj.outputs || []).slice(0, 12);
      const completedSteps = steps.filter(s => s.status === 'completed').length;
      const progress = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.id || '')}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">Status: ${escapeHtml(obj.status || '')} · Scope: ${escapeHtml(obj.scope_mode || 'site')} · Priority: ${escapeHtml(obj.priority || 'normal')} · tokens ${(obj.tokens || 0).toLocaleString()} · $${Number(obj.cost || 0).toFixed(4)}</div>
        ${renderLinkChain(links)}
        <div class="text-xs text-muted" style="margin-bottom:6px">Started: ${formatDate(obj.started_at)} · Completed: ${formatDate(obj.completed_at)} · Blocking: ${escapeHtml(obj.blocking_reason || 'none')}</div>
        <div style="margin:10px 0">
          <div class="text-xs text-muted" style="margin-bottom:4px">Progress: ${progress}% (${completedSteps}/${steps.length || 0})</div>
          <div style="height:8px;background:var(--color-border);border-radius:6px;overflow:hidden"><div style="height:8px;background:#00c8ff;width:${progress}%"></div></div>
        </div>
        <div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Sections: Summary · Timeline · Steps · Outputs · Errors/Warnings · Linked Outcome · Audit</div>
        <div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Steps</div>
        ${(steps || []).map(s => `<div class="text-xs text-muted" style="margin-bottom:4px">- [${escapeHtml(s.status || 'queued')}] #${s.sequence || '?'} ${escapeHtml(s.label || s.step_type || '')} · ${escapeHtml(s.provider || '')}${s.depends_on_step_ids?.length ? ` · depends on ${escapeHtml(s.depends_on_step_ids.join(', '))}` : ''}${s.approval_required ? ' · approval required' : ''}${s.error_summary ? ` · ${escapeHtml(s.error_summary)}` : ''}</div>`).join('') || '<div class="text-xs text-muted">No step model available</div>'}
        <div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Step Logs</div>
        ${(obj.step_logs || obj.logs || []).map(l => `<div class="text-xs text-muted" style="margin-bottom:4px">- [${escapeHtml(l.status || 'unknown')}] ${escapeHtml(l.timestamp || '')} ${escapeHtml(l.action_type || l.step || '')} ${escapeHtml(l.provider || '')} ${escapeHtml(l.target || '')} ${escapeHtml(l.result || '')}</div>`).join('')}
        <div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Outputs / Artifacts</div>
        ${artifacts.map(a => `<div class="text-xs text-muted" style="margin-bottom:6px;padding:6px;border:1px solid var(--color-border);border-radius:6px">
          <div><strong>${escapeHtml(a.type || 'artifact')}</strong> · ${escapeHtml(a.title || a.artifact_id || '')}</div>
          <div>publish ${escapeHtml(a.publish_status || 'draft')} · review ${escapeHtml(a.review_status || 'pending')}</div>
          <div style="margin-top:4px">${escapeHtml(a.preview_text || '')}</div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-secondary btn-xs artifact-action" data-artifact-id="${escapeHtml(a.artifact_id || '')}" data-action="approve_artifact">Approve artifact</button>
            <button class="btn btn-secondary btn-xs artifact-action" data-artifact-id="${escapeHtml(a.artifact_id || '')}" data-action="reject_artifact">Reject artifact</button>
            <button class="btn btn-secondary btn-xs artifact-action" data-artifact-id="${escapeHtml(a.artifact_id || '')}" data-action="mark_ready_publish">Mark ready to publish</button>
          </div>
        </div>`).join('') || '<div class="text-xs text-muted">No artifacts yet.</div>'}
        ${(obj.errors || []).length ? `<div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Errors</div>${(obj.errors || []).map(e => `<div class="text-xs text-muted">- ${escapeHtml(e.category || 'error')}: ${escapeHtml(e.summary || '')}</div>`).join('')}` : ''}
        ${(obj.warnings || []).length ? `<div class="text-xs" style="font-weight:600;margin:8px 0 6px 0">Warnings</div>${(obj.warnings || []).map(w => `<div class="text-xs text-muted">- ${escapeHtml(w.category || 'warning')}: ${escapeHtml(w.summary || '')}</div>`).join('')}` : ''}
      `;
    } else if (kind === 'outcome') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.type || 'Outcome')}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">Measured: ${formatDate(obj.measured_at)} · Confidence ${Math.round((obj.confidence || 0.8) * 100)}%</div>
        ${renderLinkChain(links)}
        <div class="text-xs text-muted" style="margin-bottom:6px">Rank: ${escapeHtml(String(obj.baseline_metrics?.avg_position ?? 'n/a'))} -> ${escapeHtml(String(obj.current_metrics?.avg_position ?? 'n/a'))}</div>
        <div class="text-xs text-muted" style="margin-bottom:6px">Impressions: ${escapeHtml(String(obj.baseline_metrics?.impressions_7d ?? 'n/a'))} -> ${escapeHtml(String(obj.current_metrics?.impressions_7d ?? 'n/a'))}</div>
        <div class="text-xs text-muted" style="margin-bottom:6px">Citations: ${escapeHtml(String(obj.baseline_metrics?.citations_7d ?? 'n/a'))} -> ${escapeHtml(String(obj.current_metrics?.citations_7d ?? obj.citations_detected ?? 'n/a'))}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px"><strong>Narrative:</strong> ${escapeHtml(obj.narrative_summary || '')}</div>
        <div class="text-xs text-muted">Evidence sources: ${(obj.evidence_sources || []).map(escapeHtml).join(', ') || 'n/a'}</div>
      `;
    } else if (kind === 'competitor') {
      body = `
        <div class="text-sm"><strong>${escapeHtml(obj.label || obj.domain)}</strong></div>
        <div class="text-xs text-muted" style="margin:4px 0 10px 0">${escapeHtml(obj.domain || '')}</div>
        ${renderLinkChain(links)}
        <div class="text-xs text-muted" style="margin-bottom:8px">Tracked topics: ${(obj.tracked_topics || []).map(escapeHtml).join(', ') || 'n/a'}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Format patterns: ${(obj.format_patterns || []).map(escapeHtml).join(', ') || 'n/a'}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">Schema patterns: ${(obj.schema_patterns || []).map(escapeHtml).join(', ') || 'n/a'}</div>
        ${(obj.recent_changes || []).map(ch => `<div class="text-xs text-muted">- ${escapeHtml(ch)}</div>`).join('')}
      `;
    }

    const actions = getDrawerActions(kind, obj);
    overlay.innerHTML = `
      <div class="modal" style="max-width:920px;max-height:85vh;overflow:auto">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(kind.replace('_', ' ').toUpperCase())} Detail</h3>
          <button class="btn btn-ghost btn-icon close-modal"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn btn-secondary close-modal">Close</button>
          ${actions.map(a => `<button class="btn ${a.tone === 'primary' ? 'btn-primary' : 'btn-secondary'} intel-action-btn" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    overlay.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.intel-action-btn').forEach(b => b.addEventListener('click', async () => {
      const action = b.dataset.action;
      try {
        b.disabled = true;
        const payload = await buildActionPayload(kind, action, obj);
        if (payload === null) { b.disabled = false; return; }
        await mutateIntelObject(kind, id, action, payload || {});
        toast(`Action complete: ${action.replace(/_/g, ' ')}`, 'success');
        overlay.remove();
        const main = document.getElementById('main-content');
        if (main && location.hash === '#/command-center') {
          renderCommandCenter(main);
        }
      } catch (err) {
        toast(err.message || 'Action failed', 'error');
        b.disabled = false;
      }
    }));
    overlay.querySelectorAll('.artifact-action').forEach(btn => btn.addEventListener('click', async () => {
      const artifactId = btn.dataset.artifactId;
      const action = btn.dataset.action;
      if (!artifactId || !action) return;
      try {
        await mutateIntelObject('artifact', artifactId, action, {});
        toast(`Artifact action complete: ${action.replace(/_/g, ' ')}`, 'success');
        overlay.remove();
        showIntelInspect(kind, id);
      } catch (err) {
        toast(err.message || 'Artifact action failed', 'error');
      }
    }));
    overlay.querySelectorAll('.intel-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const k = link.dataset.kind;
        const targetId = link.dataset.id;
        overlay.remove();
        showIntelInspect(k, targetId, intel);
      });
    });
  }

  async function renderCommandCenter(container) {
    let scopeAgents = [];
    let scopeOptions = { github_repos: [], gsc_sites: [], bing_sites: [] };
    let demoMeta = null;
    let scenarios = demoScenariosCache;
    let demoPacks = demoPacksCache;
    let walkthroughs = walkthroughLibraryCache;
    let walkthroughStatus = walkthroughStatusCache;
    try {
      const [agentsRes, optionsRes, demoStatusRes, scenariosRes, demoPacksRes, wtList, wtStatus] = await Promise.all([
        apiFetch('/api/agents'),
        loadScopeOptions(),
        loadDemoStatus(),
        loadDemoScenarios(),
        loadDemoPacks(),
        loadWalkthroughLibrary(),
        loadWalkthroughStatus(),
      ]);
      scopeAgents = agentsRes || [];
      scopeOptions = optionsRes || scopeOptions;
      demoMeta = demoStatusRes || null;
      scenarios = scenariosRes || scenarios;
      demoPacks = demoPacksRes || demoPacks;
      walkthroughs = wtList || walkthroughs;
      walkthroughStatus = wtStatus || walkthroughStatus;
    } catch {}
    let intelPreview = ccIntelCache;
    try { intelPreview = await loadSearchOpsIntel(); } catch {}
    const demoStatus = (intelPreview && intelPreview.demo_status) || demoMeta?.status || demoStatusCache || {};
    const currentScenario = demoStatus?.scenario || null;
    const currentStage = demoStatus?.current_stage || null;
    const inPresentationMode = !!demoStatus?.presentation_mode;
    const wt = walkthroughStatus || demoStatus?.walkthrough || {};
    const wtCurrent = wt?.current_step || null;

    if (ccScope.mode === 'agent' && ccScope.agent_id && !scopeAgents.some(a => a.id === ccScope.agent_id)) {
      ccScope.agent_id = '';
    }

    const tabs = [
      { id: 'overview', label: 'Overview', icon: 'gauge' },
      { id: 'live-ops', label: 'Live Ops', icon: 'activity' },
      { id: 'signals', label: 'Signals', icon: 'radio' },
      { id: 'opportunities', label: 'Opportunities', icon: 'lightbulb' },
      { id: 'plans', label: 'Plans', icon: 'clipboard-list' },
      { id: 'executions', label: 'Executions', icon: 'play-circle' },
      { id: 'outcomes', label: 'Outcomes', icon: 'line-chart' },
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
            <p class="page-subtitle" style="margin:0">Observe -> Diagnose -> Plan -> Execute -> Measure</p>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <div class="text-xs text-muted">Executive Demo Mode</div>
            <div class="text-sm">${escapeHtml(currentScenario?.name || 'No scenario loaded')} ${currentStage ? `· Stage ${currentStage.sequence || 0}: ${escapeHtml(currentStage.title || '')}` : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="form-select" id="demo-scenario-select" style="min-width:240px">
              <option value="">Select scenario</option>
              ${(scenarios || []).map(s => `<option value="${escapeHtml(s.scenario_id)}" ${currentScenario?.scenario_id === s.scenario_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
            <select class="form-select" id="demo-mode-select" style="min-width:170px">
              ${['live_simulated','deterministic_demo','manual_stepthrough'].map(m => `<option value="${m}" ${demoStatus?.mode === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="demo-load-btn">Load</button>
            <button class="btn btn-secondary btn-sm" id="demo-reset-btn">Reset</button>
            <button class="btn btn-secondary btn-sm" id="demo-tick-btn">Advance Tick</button>
            <button class="btn btn-secondary btn-sm" id="demo-stage-btn">Advance Stage</button>
            <button class="btn btn-secondary btn-sm" id="demo-autoplay-btn">${demoStatus?.autoplay ? 'Pause Playback' : 'Auto-play'}</button>
            <button class="btn btn-secondary btn-sm" id="demo-presentation-btn">${inPresentationMode ? 'Standard Ops Mode' : 'Presentation Mode'}</button>
            <button class="btn btn-secondary btn-sm" id="demo-recording-btn">${demoStatus?.recording_mode ? 'Recording Mode On' : 'Recording Mode Off'}</button>
          </div>
        </div>
        <div style="margin-top:8px" class="text-xs text-muted">
          Seed: ${escapeHtml(demoStatus?.seed_key || 'n/a')} · Run: ${escapeHtml(demoStatus?.scenario_run_id || 'n/a')} · Scheduler: ${escapeHtml(demoStatus?.mode || 'deterministic_demo')} · Active Pack: ${escapeHtml((demoStatus?.walkthrough?.active_demo_pack_id) || 'none')}
        </div>
        ${demoStatus?.current_stage ? `<div style="margin-top:8px;padding:8px;border:1px dashed var(--color-border);border-radius:8px">
          <div class="text-xs" style="font-weight:600">${escapeHtml(demoStatus.current_stage.title || '')}</div>
          <div class="text-xs text-muted">${escapeHtml(demoStatus.current_stage.description || '')}</div>
          ${(demoStatus?.speaker_notes_visible !== false) ? `<div class="text-xs" style="margin-top:6px"><strong>Speaker note:</strong> ${escapeHtml(demoStatus.current_stage.speaker_notes || '')}</div>` : ''}
          ${demoStatus?.scenario?.recommended_walkthrough_order?.length ? `<div class="text-xs text-muted" style="margin-top:4px">Suggested next clicks: ${demoStatus.scenario.recommended_walkthrough_order.map(escapeHtml).join(' -> ')}</div>` : ''}
        </div>` : ''}
      </div>
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <div class="text-xs text-muted">Demo Packs Launcher</div>
            <div class="text-sm">One-click start for executive, sales, onboarding, technical, and fleet narratives</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="demo-pack-end-btn">End Active Pack</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px">
          ${(demoPacks || []).map(p => `
            <div class="card-flat" style="border:1px solid var(--color-border);border-radius:10px;padding:10px">
              <div style="font-size:13px;font-weight:600">${escapeHtml(p.name || '')}</div>
              <div class="text-xs text-muted" style="margin-top:4px">${escapeHtml(p.description || '')}</div>
              <div class="text-xs text-muted" style="margin-top:6px">${escapeHtml((p.tags || []).join(' · '))}</div>
              <div class="text-xs" style="margin-top:6px"><strong>Duration:</strong> ${escapeHtml(p.estimated_duration || 'n/a')}</div>
              <div class="text-xs" style="margin-top:4px"><strong>Proves:</strong> ${escapeHtml(p.what_it_proves || '')}</div>
              <button class="btn btn-primary btn-sm demo-pack-start" data-pack-id="${escapeHtml(p.demo_pack_id)}" style="margin-top:8px;width:100%">Start Demo Pack</button>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <div class="text-xs text-muted">Guided Walkthrough</div>
            <div class="text-sm">${escapeHtml(wt?.walkthrough?.name || 'No walkthrough loaded')} ${wtCurrent ? `· Step ${Number(wt.current_step_index || 0) + 1}` : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="form-select" id="wt-select" style="min-width:300px">
              <option value="">Select walkthrough</option>
              ${(walkthroughs || []).map(w => `<option value="${escapeHtml(w.walkthrough_id)}" ${wt?.walkthrough_id === w.walkthrough_id ? 'selected' : ''}>${escapeHtml(w.name)} · ${escapeHtml(w.audience_type || '')}</option>`).join('')}
            </select>
            <select class="form-select" id="wt-mode-select" style="min-width:160px">
              ${['executive_demo','sales_demo','onboarding','technical_qa','self_guided'].map(m => `<option value="${m}" ${demoStatus?.audience_mode === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="wt-load-btn">Load</button>
            <button class="btn btn-secondary btn-sm" id="wt-start-btn">Start</button>
            <button class="btn btn-secondary btn-sm" id="wt-next-btn">Next</button>
            <button class="btn btn-secondary btn-sm" id="wt-back-btn">Back</button>
            <button class="btn btn-secondary btn-sm" id="wt-pause-btn">Pause</button>
            <button class="btn btn-secondary btn-sm" id="wt-end-btn">End</button>
            <button class="btn btn-secondary btn-sm" id="wt-export-btn">Export</button>
            <button class="btn btn-secondary btn-sm" id="wt-import-btn">Import</button>
            <button class="btn btn-secondary btn-sm" id="wt-duplicate-btn">Duplicate</button>
            <button class="btn btn-secondary btn-sm" id="wt-toggle-speaker-btn">Toggle Speaker Notes</button>
            <button class="btn btn-secondary btn-sm" id="wt-jump-approval-btn">Jump Approval Moment</button>
            <button class="btn btn-secondary btn-sm" id="wt-jump-outcome-btn">Skip to Outcome</button>
          </div>
        </div>
        ${wtCurrent ? `<div style="margin-top:8px;padding:8px;border:1px dashed var(--color-border);border-radius:8px">
          <div class="text-xs" style="font-weight:600">${escapeHtml(wtCurrent.title || '')}</div>
          <div class="text-xs text-muted">${escapeHtml(wtCurrent.description || '')}</div>
          <div class="text-xs" style="margin-top:4px"><strong>Expected action:</strong> ${escapeHtml(wtCurrent.expected_user_action || 'Follow instruction')}</div>
          <div class="text-xs" style="margin-top:4px"><strong>Business value:</strong> ${escapeHtml(wtCurrent.business_value_note || '')}</div>
        </div>` : '<div class="text-xs text-muted" style="margin-top:8px">Load a walkthrough to activate guided overlays.</div>'}
      </div>
      <div class="card" style="margin-bottom:12px;padding:12px;${inPresentationMode ? 'display:none' : ''}">
        <div style="display:grid;grid-template-columns:180px 1fr 1fr 1fr;gap:8px;align-items:end">
          <div class="form-group" style="margin:0">
            <label class="form-label">Scope Mode</label>
            <select class="form-select" id="cc-scope-mode">
              <option value="site" ${ccScope.mode === 'site' ? 'selected' : ''}>Site Scope</option>
              <option value="agent" ${ccScope.mode === 'agent' ? 'selected' : ''}>Agent Scope</option>
            </select>
          </div>
          <div class="form-group" id="cc-scope-agent-wrap" style="margin:0;${ccScope.mode === 'agent' ? '' : 'display:none'}">
            <label class="form-label">Agent</label>
            <select class="form-select" id="cc-scope-agent">
              <option value="">Select agent</option>
              ${scopeAgents.map(a => `<option value="${a.id}" ${a.id === ccScope.agent_id ? 'selected' : ''}>${escapeHtml(a.name || 'Unnamed Agent')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="cc-scope-site-wrap" style="margin:0;${ccScope.mode === 'site' ? '' : 'display:none'}">
            <label class="form-label">GSC Property</label>
            <input class="form-input" id="cc-scope-gsc-manual" value="${escapeHtml(ccScope.gsc_site || '')}" placeholder="https://example.com/ or sc-domain:example.com">
          </div>
          <div class="form-group" id="cc-scope-repo-wrap" style="margin:0;${ccScope.mode === 'site' ? '' : 'display:none'}">
            <label class="form-label">GitHub Repo</label>
            <input class="form-input" id="cc-scope-repo-manual" value="${escapeHtml(ccScope.github_repo || '')}" placeholder="owner/repo">
          </div>
        </div>
      </div>
      ${renderCCQueueBar(intelPreview || {})}
      <div class="card" style="margin-bottom:12px;padding:10px;${inPresentationMode ? 'display:none' : ''}">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:end">
          <div class="form-group" style="margin:0">
            <label class="form-label">Status</label>
            <input class="form-input" id="cc-filter-status" value="${escapeHtml(ccFilter.status === 'all' ? '' : ccFilter.status)}" placeholder="e.g. open, running, dismissed">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Approval Needed</label>
            <select class="form-select" id="cc-filter-approval">
              <option value="all" ${ccFilter.approval === 'all' ? 'selected' : ''}>All</option>
              <option value="required" ${ccFilter.approval === 'required' ? 'selected' : ''}>Required</option>
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Assigned Agent</label>
            <select class="form-select" id="cc-filter-agent">
              <option value="all">All</option>
              <option value="unassigned" ${ccFilter.assigned_agent === 'unassigned' ? 'selected' : ''}>Unassigned</option>
              ${scopeAgents.map(a => `<option value="${a.id}" ${ccFilter.assigned_agent === a.id ? 'selected' : ''}>${escapeHtml(a.name || a.id)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <button class="btn btn-secondary" id="cc-clear-filters">Clear Filters</button>
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

    const modeSel = document.getElementById('cc-scope-mode');
    const agentSel = document.getElementById('cc-scope-agent');
    const gscManual = document.getElementById('cc-scope-gsc-manual');
    const repoManual = document.getElementById('cc-scope-repo-manual');
    const agentWrap = document.getElementById('cc-scope-agent-wrap');
    const siteWrap = document.getElementById('cc-scope-site-wrap');
    const repoWrap = document.getElementById('cc-scope-repo-wrap');
    const filterStatus = document.getElementById('cc-filter-status');
    const filterApproval = document.getElementById('cc-filter-approval');
    const filterAgent = document.getElementById('cc-filter-agent');
    const clearFilters = document.getElementById('cc-clear-filters');

    modeSel?.addEventListener('change', () => {
      ccScope.mode = modeSel.value === 'agent' ? 'agent' : 'site';
      saveCCScope();
      renderCommandCenter(container);
    });
    agentSel?.addEventListener('change', () => {
      ccScope.agent_id = agentSel.value || '';
      saveCCScope();
      renderCommandCenter(container);
    });
    gscManual?.addEventListener('change', () => {
      ccScope.gsc_site = (gscManual.value || '').trim();
      saveCCScope();
      renderCommandCenter(container);
    });
    repoManual?.addEventListener('change', () => {
      ccScope.github_repo = (repoManual.value || '').trim();
      saveCCScope();
      renderCommandCenter(container);
    });
    if (agentWrap && siteWrap && repoWrap) {
      agentWrap.style.display = ccScope.mode === 'agent' ? '' : 'none';
      siteWrap.style.display = ccScope.mode === 'site' ? '' : 'none';
      repoWrap.style.display = ccScope.mode === 'site' ? '' : 'none';
    }
    filterStatus?.addEventListener('change', () => {
      ccFilter.status = (filterStatus.value || '').trim().toLowerCase() || 'all';
      renderCommandCenter(container);
    });
    filterApproval?.addEventListener('change', () => {
      ccFilter.approval = filterApproval.value || 'all';
      renderCommandCenter(container);
    });
    filterAgent?.addEventListener('change', () => {
      ccFilter.assigned_agent = filterAgent.value || 'all';
      renderCommandCenter(container);
    });
    clearFilters?.addEventListener('click', () => {
      ccFilter = { status: 'all', approval: 'all', assigned_agent: 'all', object_type: 'all' };
      renderCommandCenter(container);
    });
    container.querySelectorAll('.cc-queue-chip').forEach(btn => btn.addEventListener('click', () => {
      ccActiveTab = btn.dataset.tab || ccActiveTab;
      ccFilter.status = (btn.dataset.status || '').toLowerCase() || 'all';
      renderCommandCenter(container);
    }));
    document.getElementById('demo-load-btn')?.addEventListener('click', async () => {
      const scenarioId = document.getElementById('demo-scenario-select')?.value;
      const mode = document.getElementById('demo-mode-select')?.value || 'deterministic_demo';
      if (!scenarioId) return toast('Select a scenario first', 'warning');
      try {
        await demoAction('/api/demo/scenario/load', { scenario_id: scenarioId, mode });
        toast('Scenario loaded', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Failed to load scenario', 'error'); }
    });
    document.getElementById('demo-reset-btn')?.addEventListener('click', async () => {
      try { await demoAction('/api/demo/scenario/reset'); toast('Scenario reset', 'success'); renderCommandCenter(container); } catch (err) { toast(err.message || 'Reset failed', 'error'); }
    });
    document.getElementById('demo-tick-btn')?.addEventListener('click', async () => {
      try { await demoAction('/api/demo/scenario/advance-tick'); toast('Advanced one tick', 'success'); renderCommandCenter(container); } catch (err) { toast(err.message || 'Tick failed', 'error'); }
    });
    document.getElementById('demo-stage-btn')?.addEventListener('click', async () => {
      try { await demoAction('/api/demo/scenario/advance-stage'); toast('Advanced one stage', 'success'); renderCommandCenter(container); } catch (err) { toast(err.message || 'Stage advance failed', 'error'); }
    });
    document.getElementById('demo-autoplay-btn')?.addEventListener('click', async () => {
      try {
        if (demoStatus?.autoplay) await demoAction('/api/demo/scenario/stop');
        else await demoAction('/api/demo/scenario/autoplay', { enabled: true, speed_multiplier: demoStatus?.speed_multiplier || 1 });
        toast(demoStatus?.autoplay ? 'Playback paused' : 'Auto-play started', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Playback toggle failed', 'error'); }
    });
    document.getElementById('demo-presentation-btn')?.addEventListener('click', async () => {
      try {
        await demoAction('/api/demo/scenario/settings', { presentation_mode: !inPresentationMode });
        toast(!inPresentationMode ? 'Presentation mode enabled' : 'Standard ops mode restored', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Mode switch failed', 'error'); }
    });
    document.getElementById('demo-recording-btn')?.addEventListener('click', async () => {
      try {
        await demoAction('/api/demo/scenario/settings', { recording_mode: !demoStatus?.recording_mode });
        toast(!demoStatus?.recording_mode ? 'Recording-friendly mode enabled' : 'Recording-friendly mode disabled', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Recording mode toggle failed', 'error'); }
    });
    container.querySelectorAll('.demo-pack-start').forEach(btn => btn.addEventListener('click', async () => {
      const packId = btn.dataset.packId;
      if (!packId) return;
      try {
        const res = await apiFetch('/api/demo/demo-pack/start', { method: 'POST', body: JSON.stringify({ demo_pack_id: packId }) });
        demoStatusCache = res.status || demoStatusCache;
        walkthroughStatusCache = res.walkthrough_status || walkthroughStatusCache;
        ccIntelCache = res.intelligence || ccIntelCache;
        toast('Demo environment ready', 'success');
        const pack = res.demo_pack || {};
        if (pack.start_tab) ccActiveTab = pack.start_tab;
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Demo pack start failed', 'error'); }
    }));
    document.getElementById('demo-pack-end-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/demo-pack/end', { method: 'POST' });
        await demoAction('/api/demo/scenario/settings', { presentation_mode: false, recording_mode: false });
        clearWalkthroughOverlay();
        toast('Demo pack ended. Returned to standard ops mode.', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Failed to end demo pack', 'error'); }
    });
    document.getElementById('wt-load-btn')?.addEventListener('click', async () => {
      const walkthroughId = document.getElementById('wt-select')?.value;
      const audience = document.getElementById('wt-mode-select')?.value || 'technical_qa';
      if (!walkthroughId) return toast('Select walkthrough first', 'warning');
      try {
        await apiFetch('/api/demo/walkthrough/load', { method: 'POST', body: JSON.stringify({ walkthrough_id: walkthroughId, audience_type: audience, auto_start: false }) });
        await loadWalkthroughStatus();
        toast('Walkthrough loaded', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Walkthrough load failed', 'error'); }
    });
    document.getElementById('wt-start-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/walkthrough/start', { method: 'POST' });
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
        toast('Walkthrough started', 'success');
      } catch (err) { toast(err.message || 'Start failed', 'error'); }
    });
    document.getElementById('wt-next-btn')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/demo/walkthrough/next', { method: 'POST' });
        if (res.validation && !res.validation.ok) toast(res.validation.message || 'Step not complete', 'warning');
        await loadSearchOpsIntel();
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Next failed', 'error'); }
    });
    document.getElementById('wt-back-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/walkthrough/back', { method: 'POST' });
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Back failed', 'error'); }
    });
    document.getElementById('wt-pause-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/walkthrough/pause', { method: 'POST' });
        clearWalkthroughOverlay();
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Pause failed', 'error'); }
    });
    document.getElementById('wt-end-btn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/demo/walkthrough/end', { method: 'POST' });
        clearWalkthroughOverlay();
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'End failed', 'error'); }
    });
    document.getElementById('wt-export-btn')?.addEventListener('click', async () => {
      try {
        const exp = await apiFetch('/api/demo/walkthrough/export');
        const text = JSON.stringify(exp.library || [], null, 2);
        prompt('Copy walkthrough JSON export:', text);
      } catch (err) { toast(err.message || 'Export failed', 'error'); }
    });
    document.getElementById('wt-import-btn')?.addEventListener('click', async () => {
      const raw = prompt('Paste walkthrough JSON object to import:');
      if (!raw) return;
      try {
        const walkthrough = JSON.parse(raw);
        await apiFetch('/api/demo/walkthrough/import', { method: 'POST', body: JSON.stringify({ walkthrough }) });
        toast('Walkthrough imported', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Import failed', 'error'); }
    });
    document.getElementById('wt-duplicate-btn')?.addEventListener('click', async () => {
      const selected = walkthroughs.find(w => w.walkthrough_id === document.getElementById('wt-select')?.value);
      if (!selected) return toast('Select walkthrough to duplicate', 'warning');
      try {
        const exp = await apiFetch('/api/demo/walkthrough/export');
        const full = (exp.library || []).find(w => w.walkthrough_id === selected.walkthrough_id);
        if (!full) return toast('Walkthrough definition unavailable', 'error');
        const clone = { ...full, walkthrough_id: `${full.walkthrough_id}_copy_${Date.now()}`, name: `${full.name} (Copy)` };
        await apiFetch('/api/demo/walkthrough/import', { method: 'POST', body: JSON.stringify({ walkthrough: clone }) });
        toast('Walkthrough duplicated', 'success');
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Duplicate failed', 'error'); }
    });
    document.getElementById('wt-toggle-speaker-btn')?.addEventListener('click', async () => {
      try {
        await demoAction('/api/demo/scenario/settings', { speaker_notes_visible: !demoStatus?.speaker_notes_visible });
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Toggle failed', 'error'); }
    });
    document.getElementById('wt-jump-approval-btn')?.addEventListener('click', async () => {
      try {
        for (let i = 0; i < 4; i += 1) {
          await demoAction('/api/demo/scenario/advance-stage');
          const statusRes = await loadDemoStatus();
          const pending = (statusRes?.story?.approvals || []).length || (ccIntelCache?.approval_queue || []).length;
          if (pending > 0) break;
        }
        ccActiveTab = 'overview';
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Jump failed', 'error'); }
    });
    document.getElementById('wt-jump-outcome-btn')?.addEventListener('click', async () => {
      try {
        for (let i = 0; i < 4; i += 1) await demoAction('/api/demo/scenario/advance-stage');
        ccActiveTab = 'outcomes';
        renderCommandCenter(container);
      } catch (err) { toast(err.message || 'Jump failed', 'error'); }
    });

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
    else if (ccActiveTab === 'live-ops') await renderCCLiveOps(ccEl);
    else if (ccActiveTab === 'signals') await renderCCSignals(ccEl);
    else if (ccActiveTab === 'opportunities') await renderCCOpportunities(ccEl);
    else if (ccActiveTab === 'plans') await renderCCPlans(ccEl);
    else if (ccActiveTab === 'executions') await renderCCExecutions(ccEl);
    else if (ccActiveTab === 'outcomes') await renderCCOutcomes(ccEl);
    else if (ccActiveTab === 'competitors') await renderCCCompetitorsOps(ccEl);
    else if (ccActiveTab === 'agent-ops') await renderCCAgentOps(ccEl);
    if ((walkthroughStatusCache || demoStatus?.walkthrough)?.walkthrough_active) {
      try {
        const st = await loadWalkthroughStatus();
        renderWalkthroughOverlay(st);
      } catch {}
    } else {
      clearWalkthroughOverlay();
    }
  }

  // ── CC: OVERVIEW TAB ──
  async function renderCCOverview(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const [data, intel] = await Promise.all([
        apiFetch(`/api/command-center/overview${getCCScopeQuery()}`),
        loadSearchOpsIntel(),
      ]);
      const loop = intel.lifecycle_counts || {};
      const k = intel.kpis || {};
      const story = intel.scenario_story || {};
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
            <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="radio" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${k.signals_detected_today || 0}</div>
              <div class="cc-kpi-label">Signals Today</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i data-lucide="lightbulb" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${k.opportunities_open || 0}</div>
              <div class="cc-kpi-label">Open Opportunities</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="line-chart" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value">${k.estimated_visibility_lift || 0}%</div>
              <div class="cc-kpi-label">Estimated Visibility Lift</div>
            </div>
          </div>
        </div>

        <div class="cc-grid-2">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Operating Loop Summary</h3></div>
            <div class="cc-services-list">
              ${[
                ['Observe', loop.observe || 0],
                ['Diagnose', loop.diagnose || 0],
                ['Plan', loop.plan || 0],
                ['Execute', loop.execute || 0],
                ['Measure', loop.measure || 0],
              ].map(([label, value]) => `
                <div class="cc-service-item">
                  <span class="cc-service-dot cc-service-dot-active"></span>
                  <span>${label}</span>
                  <strong style="margin-left:auto">${value}</strong>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Top Citation Gaps</h3></div>
            ${(intel.citation_gaps || []).length === 0
              ? '<p class="text-sm text-muted" style="padding:12px 0">No citation gaps detected.</p>'
              : `<div class="cc-activity-list">
                  ${(intel.citation_gaps || []).slice(0, 4).map(r => `
                    <div class="cc-activity-item">
                      <span class="badge badge-warning" style="font-size:10px">${escapeHtml(r.gap_type || 'gap')}</span>
                      <span class="cc-activity-text">${escapeHtml(r.target_topic || '—')}</span>
                      <span class="cc-activity-meta">urgency ${Math.round((r.urgency_score || 0) * 100)}%</span>
                      <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('citation_gap','${escapeHtml(r.gap_id || r.id)}')">Inspect</button>
                    </div>
                  `).join('')}
                </div>`
            }
          </div>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Scenario Story Panel</h3></div>
          <div class="text-xs text-muted" style="margin-bottom:8px">${escapeHtml(story.current_stage?.description || 'No scenario stage active. Load a scenario from the demo controls above.')}</div>
          <div class="text-xs" style="margin-bottom:8px"><strong>What happened:</strong> ${escapeHtml(story.current_stage?.title || 'Idle')}</div>
          <div class="text-xs" style="margin-bottom:8px"><strong>What is expected next:</strong> ${escapeHtml((story.suggested_next_click_path || []).join(' -> ') || 'Select scenario and advance stage')}</div>
          <div class="text-xs"><strong>Relevant outputs:</strong> ${(story.recent_outputs || []).slice(0, 3).map(o => escapeHtml(o.title || o.artifact_id || '')).join(', ') || 'none yet'}</div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Approval Queue</h3></div>
          ${(intel.approval_queue || []).length === 0
            ? '<p class="text-sm text-muted" style="padding:12px 0">No items currently awaiting approval.</p>'
            : `<table class="cc-table">
                <thead><tr><th>Type</th><th>Title</th><th>Reason</th><th>Urgency</th><th>Actions</th></tr></thead>
                <tbody>
                  ${(intel.approval_queue || []).slice(0, 12).map(item => `
                    <tr>
                      <td>${escapeHtml(item.object_type || '')}</td>
                      <td>${escapeHtml(item.title || item.object_id || '')}</td>
                      <td>${escapeHtml(item.triggering_reason || item.approval_requirement_type || '')}</td>
                      <td><span class="badge badge-${item.urgency === 'high' ? 'failed' : 'warning'}">${escapeHtml(item.urgency || 'medium')}</span></td>
                      <td style="display:flex;gap:6px">
                        <button class="btn btn-secondary btn-xs cc-approval-action" data-aid="${escapeHtml(item.approval_id || '')}" data-kind="${escapeHtml(item.object_type)}" data-id="${escapeHtml(item.object_id)}" data-action="approve">Approve</button>
                        <button class="btn btn-secondary btn-xs cc-approval-action" data-aid="${escapeHtml(item.approval_id || '')}" data-kind="${escapeHtml(item.object_type)}" data-id="${escapeHtml(item.object_id)}" data-action="reject">Reject</button>
                        <button class="btn btn-ghost btn-xs cc-approval-inspect" data-kind="${escapeHtml(item.object_type)}" data-id="${escapeHtml(item.object_id)}" data-parent-execution-id="${escapeHtml(item.parent_execution_id || '')}">Inspect</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Quick Navigation</h3></div>
          <div class="cc-quick-nav">
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=signals]').click()"><i data-lucide="radio" style="width:16px;height:16px"></i>Signals</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=live-ops]').click()"><i data-lucide="activity" style="width:16px;height:16px"></i>Live Ops</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=opportunities]').click()"><i data-lucide="lightbulb" style="width:16px;height:16px"></i>Opportunities</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=plans]').click()"><i data-lucide="clipboard-list" style="width:16px;height:16px"></i>Plans</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=executions]').click()"><i data-lucide="play-circle" style="width:16px;height:16px"></i>Executions</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=outcomes]').click()"><i data-lucide="line-chart" style="width:16px;height:16px"></i>Outcomes</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=competitors]').click()"><i data-lucide="swords" style="width:16px;height:16px"></i>Competitors</button>
            <button class="cc-quick-btn" onclick="document.querySelector('[data-tab=agent-ops]').click()"><i data-lucide="activity" style="width:16px;height:16px"></i>Agent Ops</button>
          </div>
        </div>
      `;
      lucide.createIcons();
      el.querySelectorAll('.cc-approval-inspect').forEach(btn => btn.addEventListener('click', () => {
        const raw = btn.dataset.kind;
        if (raw === 'execution_step') {
          const parentExe = btn.dataset.parentExecutionId;
          if (parentExe) return window.NC.inspectIntelObject('execution', parentExe);
        }
        const kind = raw === 'execution' ? 'execution' : 'plan';
        window.NC.inspectIntelObject(kind, btn.dataset.id);
      }));
      el.querySelectorAll('.cc-approval-action').forEach(btn => btn.addEventListener('click', async () => {
        const approvalId = btn.dataset.aid;
        const rawKind = btn.dataset.kind;
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        let affectedKind = rawKind || 'item';
        try {
          if (approvalId) {
            const reason = action === 'reject' ? (prompt('Rejection reason:', '') || '') : '';
            await mutateIntelObject('approval', approvalId, action, { reason });
            affectedKind = 'approval';
          } else {
            const kind = rawKind === 'execution' ? 'execution' : 'plan';
            const mappedAction = action === 'approve' ? (kind === 'plan' ? 'approve' : 'approve_blocked') : (kind === 'plan' ? 'reject' : 'cancel');
            await mutateIntelObject(kind, id, mappedAction, {});
            affectedKind = kind;
          }
          toast(`${action === 'approve' ? 'Approved' : 'Rejected'} ${affectedKind}`, 'success');
          renderCCOverview(el);
        } catch (err) {
          toast(err.message || 'Approval action failed', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load overview</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCLiveOps(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const live = intel.live_ops || {};
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-blue">Live Operations</span>
          <span class="text-sm text-muted">Runtime visibility for running, blocked, approval, and failed workloads</span>
        </div>
        <div class="cc-kpi-grid">
          <div class="cc-kpi"><div class="cc-kpi-body"><div class="cc-kpi-value">${(live.running_executions || []).length}</div><div class="cc-kpi-label">Running</div></div></div>
          <div class="cc-kpi"><div class="cc-kpi-body"><div class="cc-kpi-value">${(live.blocked_executions || []).length}</div><div class="cc-kpi-label">Blocked</div></div></div>
          <div class="cc-kpi"><div class="cc-kpi-body"><div class="cc-kpi-value">${(live.awaiting_approval || []).length}</div><div class="cc-kpi-label">Awaiting Approval</div></div></div>
          <div class="cc-kpi"><div class="cc-kpi-body"><div class="cc-kpi-value">${(live.failed_needs_review || []).length}</div><div class="cc-kpi-label">Failed / Review</div></div></div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-header"><h3 class="card-title">Live Runs</h3></div>
          <table class="cc-table">
            <thead><tr><th>Execution</th><th>Agent</th><th>Current Step</th><th>Progress</th><th>Blocking</th><th>Actions</th></tr></thead>
            <tbody>
              ${(intel.executions || []).filter(e => ['running','queued','failed','needs_review'].includes(e.status)).map(e => {
                const steps = e.steps || [];
                const done = steps.filter(s => s.status === 'completed').length;
                const progress = steps.length ? Math.round((done / steps.length) * 100) : 0;
                const current = steps.find(s => ['running','queued','awaiting_approval','waiting_dependency','failed'].includes(s.status));
                return `<tr>
                  <td>${escapeHtml(e.id || '')}</td>
                  <td>${escapeHtml(e.agent_name || e.agent_id || '')}</td>
                  <td>${escapeHtml(current?.label || 'n/a')}</td>
                  <td>${progress}%</td>
                  <td>${escapeHtml(e.blocking_reason || 'none')}</td>
                  <td style="display:flex;gap:6px">
                    <button class="btn btn-ghost btn-xs live-inspect" data-id="${escapeHtml(e.id)}">Inspect</button>
                    <button class="btn btn-secondary btn-xs live-action" data-id="${escapeHtml(e.id)}" data-action="pause">Pause</button>
                    <button class="btn btn-secondary btn-xs live-action" data-id="${escapeHtml(e.id)}" data-action="approve_blocked">Approve</button>
                    <button class="btn btn-secondary btn-xs live-action" data-id="${escapeHtml(e.id)}" data-action="retry_step">Retry</button>
                    <button class="btn btn-secondary btn-xs live-action" data-id="${escapeHtml(e.id)}" data-action="cancel">Cancel</button>
                  </td>
                </tr>`;
              }).join('')}
              ${((intel.executions || []).filter(e => ['running','queued','failed','needs_review'].includes(e.status)).length === 0) ? '<tr><td colspan="6" class="text-muted">No active runs.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-header"><h3 class="card-title">Ops Throughput</h3></div>
          <div class="text-xs text-muted" style="padding:8px 0">
            Queue backlog: ${live.queue_backlog || 0} · Active agents: ${live.agents_currently_active || 0} · Avg completion: ${live.avg_completion_seconds || 0}s · Token burn: ${(live.token_burn || 0).toLocaleString()} · Cost burn: $${Number(live.cost_burn || 0).toFixed(4)}
          </div>
        </div>
      `;
      el.querySelectorAll('.live-inspect').forEach(btn => btn.addEventListener('click', () => window.NC.inspectIntelObject('execution', btn.dataset.id)));
      el.querySelectorAll('.live-action').forEach(btn => btn.addEventListener('click', async () => {
        try {
          await mutateIntelObject('execution', btn.dataset.id, btn.dataset.action, {});
          toast(`Execution action: ${btn.dataset.action}`, 'success');
          renderCCLiveOps(el);
        } catch (err) {
          toast(err.message || 'Live action failed', 'error');
        }
      }));
      lucide.createIcons();
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load live operations</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCSignals(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const signals = (intel.signals || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge">Signals</span>
          <span class="text-sm text-muted">Live intelligence feed from connected sources</span>
        </div>
        <div class="card" style="margin-bottom:10px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="text-xs text-muted">Batch Actions (${ccSelection.signals.size} selected)</span>
          <button class="btn btn-secondary btn-xs signals-bulk" data-action="dismiss">Dismiss selected</button>
          <button class="btn btn-secondary btn-xs signals-bulk" data-action="snooze">Snooze selected</button>
          <button class="btn btn-secondary btn-xs signals-bulk" data-action="assign">Assign selected</button>
          <button class="btn btn-primary btn-xs signals-bulk" data-action="create_opportunity">Convert selected to opportunities</button>
        </div>
        <div class="card">
          ${signals.map(s => `
            <div class="cc-activity-item" style="padding:12px 0;border-bottom:1px solid var(--color-border)">
              <input type="checkbox" class="cc-select-signal" data-id="${escapeHtml(s.id)}" ${ccSelection.signals.has(s.id) ? 'checked' : ''} />
              <span class="badge badge-${s.severity === 'high' ? 'failed' : s.severity === 'medium' ? 'warning' : 'active'}">${escapeHtml(s.severity || 'low')}</span>
              <div class="cc-activity-detail">
                <span class="cc-activity-agent">${escapeHtml(s.title)}</span>
                <span class="cc-activity-text">${escapeHtml(s.description || '')}</span>
                <span class="cc-activity-meta">${escapeHtml((s.source || '').replace(/_/g, ' '))} · status ${escapeHtml(s.status || 'new')} · confidence ${Math.round((s.confidence || 0) * 100)}% · ${escapeHtml(s.topic || '')} · ${(s.linked_opportunity_ids || []).length} opportunity link(s)</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('signal','${escapeHtml(s.id)}')">Inspect</button>
            </div>
          `).join('') || '<p class="text-sm text-muted">No signals available.</p>'}
        </div>`;
      lucide.createIcons();
      el.querySelectorAll('.cc-select-signal').forEach(chk => chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) ccSelection.signals.add(id); else ccSelection.signals.delete(id);
        renderCCSignals(el);
      }));
      el.querySelectorAll('.signals-bulk').forEach(btn => btn.addEventListener('click', async () => {
        if (!ccSelection.signals.size) return toast('No signals selected', 'warning');
        const action = btn.dataset.action;
        try {
          const payload = action === 'assign'
            ? { agent_id: prompt('Assign to agent ID:'), agent_name: prompt('Agent display name (optional):', '') || '' }
            : {};
          if (action === 'assign' && !payload.agent_id) return;
          await batchMutateIntelObjects('signal', Array.from(ccSelection.signals), action, payload);
          ccSelection.signals.clear();
          toast(`Batch action complete: ${action}`, 'success');
          renderCCSignals(el);
        } catch (err) {
          toast(err.message || 'Batch action failed', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load signals</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCOpportunities(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const opportunities = (intel.opportunities || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-purple">Opportunities</span>
          <span class="text-sm text-muted">Signals translated into actionable growth opportunities</span>
        </div>
        <div class="card" style="margin-bottom:10px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="text-xs text-muted">Batch Actions (${ccSelection.opportunities.size} selected)</span>
          <button class="btn btn-secondary btn-xs opp-bulk" data-action="assign">Assign selected</button>
          <button class="btn btn-primary btn-xs opp-bulk" data-action="create_plan">Create plans in batch</button>
          <button class="btn btn-secondary btn-xs opp-bulk" data-action="dismiss">Dismiss selected</button>
          <button class="btn btn-secondary btn-xs opp-bulk" data-action="escalate_priority">Escalate selected</button>
        </div>
        <div class="cc-grid-2">
          ${opportunities.map(o => `
            <div class="card">
              <div class="card-header">
                <input type="checkbox" class="cc-select-opportunity" data-id="${escapeHtml(o.id)}" ${ccSelection.opportunities.has(o.id) ? 'checked' : ''} />
                <h3 class="card-title">${escapeHtml(o.title || '')}</h3>
                <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('opportunity','${escapeHtml(o.id)}')">Inspect</button>
              </div>
              <div class="text-sm text-muted" style="margin-bottom:8px">${escapeHtml(o.description || '')}</div>
              <div class="text-xs text-muted" style="margin-bottom:8px">Format: ${escapeHtml(o.recommended_format || 'n/a')}</div>
              <div class="text-xs text-muted" style="margin-bottom:12px">Target: ${escapeHtml(o.recommended_target || 'n/a')}</div>
              <div class="text-xs text-muted" style="margin-bottom:8px">Status: ${escapeHtml(o.status || 'open')} · Chain: ${(o.signal_ids || []).length} signal(s) -> ${(o.linked_plan_ids || []).length} plan(s)</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
                ${(o.recommended_actions || []).map(a => `<span class="tag">${escapeHtml(a)}</span>`).join('')}
              </div>
              <div class="text-xs text-muted">Impact ${escapeHtml(o.expected_impact || '')}</div>
            </div>
          `).join('')}
        </div>`;
      if ((intel.citation_gaps || []).length) {
        el.innerHTML += `
          <div class="cc-section-header" style="margin-top:16px">
            <span class="cc-section-badge cc-badge-orange">Citation Gap Engine</span>
            <span class="text-sm text-muted">Machine + human gap rationale</span>
          </div>
          <div class="card">
            ${(intel.citation_gaps || []).filter(matchesCCFilter).map(g => `
              <div class="cc-activity-item" style="padding:12px 0;border-bottom:1px solid var(--color-border)">
                <span class="badge badge-warning">${escapeHtml(g.gap_type || 'gap')}</span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">${escapeHtml(g.target_topic || '')}</span>
                  <span class="cc-activity-text">${escapeHtml(g.human_explanation || g.expected_outcome || '')}</span>
                  <span class="cc-activity-meta">${escapeHtml(g.content_format_recommended || '')} · citation ${Math.round((g.citation_probability_score || 0) * 100)}%</span>
                </div>
                <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('citation_gap','${escapeHtml(g.gap_id || g.id)}')">Inspect</button>
              </div>
            `).join('')}
          </div>`;
      }
      lucide.createIcons();
      el.querySelectorAll('.cc-select-opportunity').forEach(chk => chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) ccSelection.opportunities.add(id); else ccSelection.opportunities.delete(id);
        renderCCOpportunities(el);
      }));
      el.querySelectorAll('.opp-bulk').forEach(btn => btn.addEventListener('click', async () => {
        if (!ccSelection.opportunities.size) return toast('No opportunities selected', 'warning');
        const action = btn.dataset.action;
        try {
          const payload = action === 'assign'
            ? { agent_id: prompt('Assign to agent ID:'), agent_name: prompt('Agent display name (optional):', '') || '' }
            : {};
          if (action === 'assign' && !payload.agent_id) return;
          await batchMutateIntelObjects('opportunity', Array.from(ccSelection.opportunities), action, payload);
          ccSelection.opportunities.clear();
          toast(`Batch action complete: ${action}`, 'success');
          renderCCOpportunities(el);
        } catch (err) {
          toast(err.message || 'Batch action failed', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load opportunities</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCPlans(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const plans = (intel.plans || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-orange">Plans</span>
          <span class="text-sm text-muted">Multi-step strategies linked to opportunities</span>
        </div>
        <div class="card" style="margin-bottom:10px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="text-xs text-muted">Batch Actions (${ccSelection.plans.size} selected)</span>
          <button class="btn btn-primary btn-xs plans-bulk" data-action="approve">Approve selected</button>
          <button class="btn btn-secondary btn-xs plans-bulk" data-action="assign">Assign selected</button>
          <button class="btn btn-secondary btn-xs plans-bulk" data-action="cancel">Cancel selected</button>
        </div>
        ${plans.map(p => `
          <div class="card" style="margin-bottom:12px">
            <div class="card-header">
              <input type="checkbox" class="cc-select-plan" data-id="${escapeHtml(p.id)}" ${ccSelection.plans.has(p.id) ? 'checked' : ''} />
              <h3 class="card-title">${escapeHtml(p.name || '')}</h3>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="badge badge-${p.approval_state === 'approved' ? 'active' : 'warning'}">${escapeHtml(p.approval_state || 'pending')}</span>
                <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('plan','${escapeHtml(p.id)}')">Inspect</button>
              </div>
            </div>
            <p class="text-sm text-muted">${escapeHtml(p.description || '')}</p>
            <ol style="padding-left:18px;font-size:13px;color:var(--color-text-secondary);margin:8px 0">
              ${(p.steps || []).map(s => {
                if (typeof s === 'string') return `<li>${escapeHtml(s)}</li>`;
                return `<li>${escapeHtml(`${s.step_type || 'step'} · ${s.provider || 'provider'} · ${s.target || 'target'}${s.approval_required ? ' · approval required' : ''}`)}</li>`;
              }).join('')}
            </ol>
            <div class="text-xs text-muted">Estimated impact: ${escapeHtml(p.estimated_impact || 'n/a')} · Status: ${escapeHtml(p.status || 'n/a')}</div>
          </div>
        `).join('')}
      `;
      lucide.createIcons();
      el.querySelectorAll('.cc-select-plan').forEach(chk => chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) ccSelection.plans.add(id); else ccSelection.plans.delete(id);
        renderCCPlans(el);
      }));
      el.querySelectorAll('.plans-bulk').forEach(btn => btn.addEventListener('click', async () => {
        if (!ccSelection.plans.size) return toast('No plans selected', 'warning');
        const action = btn.dataset.action;
        try {
          const payload = action === 'assign'
            ? { agent_id: prompt('Assign to agent ID:'), agent_name: prompt('Agent display name (optional):', '') || '' }
            : {};
          if (action === 'assign' && !payload.agent_id) return;
          await batchMutateIntelObjects('plan', Array.from(ccSelection.plans), action, payload);
          ccSelection.plans.clear();
          toast(`Batch action complete: ${action}`, 'success');
          renderCCPlans(el);
        } catch (err) {
          toast(err.message || 'Batch action failed', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load plans</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCExecutions(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const executions = (intel.executions || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-blue">Executions</span>
          <span class="text-sm text-muted">Runtime layer with progress, logs, and outputs</span>
        </div>
        <div class="card" style="margin-bottom:10px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="text-xs text-muted">Batch Actions (${ccSelection.executions.size} selected)</span>
          <button class="btn btn-secondary btn-xs exe-bulk" data-action="pause">Pause selected</button>
          <button class="btn btn-secondary btn-xs exe-bulk" data-action="cancel">Cancel selected</button>
          <button class="btn btn-primary btn-xs exe-bulk" data-action="retry_step">Retry selected failures</button>
        </div>
        <div class="card">
          ${(executions || []).map(exe => `
            <div class="cc-activity-item" style="padding:12px 0;border-bottom:1px solid var(--color-border)">
              <input type="checkbox" class="cc-select-execution" data-id="${escapeHtml(exe.id)}" ${ccSelection.executions.has(exe.id) ? 'checked' : ''} />
              <span class="badge badge-${exe.status}">${escapeHtml(exe.status)}</span>
              <div class="cc-activity-detail">
                <span class="cc-activity-agent">${escapeHtml(exe.id)}</span>
                <span class="cc-activity-text">${escapeHtml((exe.affected_urls || []).join(', ') || 'No URL targets')}</span>
                <span class="cc-activity-meta">${(exe.tokens || 0).toLocaleString()} tokens · $${(exe.cost || 0).toFixed(4)} · ${(exe.distribution_targets || []).join(', ') || 'site-only'} · block: ${escapeHtml(exe.blocking_reason || 'none')}</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('execution','${escapeHtml(exe.id)}')">Inspect</button>
            </div>
          `).join('')}
        </div>`;
      lucide.createIcons();
      el.querySelectorAll('.cc-select-execution').forEach(chk => chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) ccSelection.executions.add(id); else ccSelection.executions.delete(id);
        renderCCExecutions(el);
      }));
      el.querySelectorAll('.exe-bulk').forEach(btn => btn.addEventListener('click', async () => {
        if (!ccSelection.executions.size) return toast('No executions selected', 'warning');
        try {
          await batchMutateIntelObjects('execution', Array.from(ccSelection.executions), btn.dataset.action, {});
          ccSelection.executions.clear();
          toast(`Batch action complete: ${btn.dataset.action}`, 'success');
          renderCCExecutions(el);
        } catch (err) {
          toast(err.message || 'Batch action failed', 'error');
        }
      }));
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load executions</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCOutcomes(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const outcomes = (intel.outcomes || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-green">Outcomes</span>
          <span class="text-sm text-muted">Before/after performance evidence tied to executed actions</span>
        </div>
        <div class="cc-grid-2">
          ${outcomes.map(o => `
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">${escapeHtml(o.type || 'Outcome')}</h3>
                <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('outcome','${escapeHtml(o.id)}')">Inspect</button>
              </div>
              <div class="text-sm" style="margin-bottom:6px">Citations: <strong>${o.citations_detected || 0}</strong></div>
              <div class="text-sm" style="margin-bottom:6px">Ranking change: <strong>${o.ranking_change || 0}</strong></div>
              <div class="text-sm" style="margin-bottom:6px">Impressions: <strong>${o.impression_change || 0}</strong></div>
              <div class="text-sm" style="margin-bottom:6px">Traffic: <strong>${o.traffic_change || 0}</strong></div>
              <div class="text-xs text-muted">Measured ${timeAgo(o.measured_at)}</div>
            </div>
          `).join('')}
        </div>`;
      lucide.createIcons();
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load outcomes</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function renderCCCompetitorsOps(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const intel = await loadSearchOpsIntel();
      const comps = (intel.competitors || []).filter(matchesCCFilter);
      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-orange">Competitors</span>
          <span class="text-sm text-muted">Tracked domains, recent deltas, and counter opportunities</span>
        </div>
        <div class="cc-grid-2">
          ${comps.map(c => `
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">${escapeHtml(c.label || c.domain)}</h3>
                <button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('competitor','${escapeHtml(c.id)}')">Inspect</button>
              </div>
              <div class="text-xs text-muted" style="margin-bottom:6px">${escapeHtml(c.domain || '')}</div>
              ${(c.recent_changes || []).map(ch => `<div class="cc-activity-item"><span class="cc-service-dot" style="background:#f59e0b"></span><span class="cc-activity-text">${escapeHtml(ch)}</span></div>`).join('')}
            </div>
          `).join('')}
        </div>`;
      lucide.createIcons();
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load competitors</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ── CC: SEO METRICS TAB ──
  async function renderCCSEO(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const data = await apiFetch(`/api/command-center/seo${getCCScopeQuery()}`);
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
        <span class="text-sm text-muted">Fan-Out Intelligence &mdash; AI retrieval signal analysis powered by the AI Search Bible</span>
      </div>

      <div class="cc-kpi-grid cc-kpi-grid-3" style="margin-bottom:16px">
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i data-lucide="git-branch" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="fanout-coverage-val">&mdash;</div>
            <div class="cc-kpi-label">Fan-Out Coverage</div>
            <div class="cc-kpi-delta cc-delta-neutral">covered / total queries</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="zap" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="retrieval-advantage-val">&mdash;</div>
            <div class="cc-kpi-label">Retrieval Advantage</div>
            <div class="cc-kpi-delta cc-delta-neutral">1 / (1 + ICS)</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="layers" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="surface-count-val">&mdash;</div>
            <div class="cc-kpi-label">Retrieval Surfaces</div>
            <div class="cc-kpi-delta cc-delta-neutral">target: 5+</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b"><i data-lucide="shield" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="entity-authority-val">&mdash;</div>
            <div class="cc-kpi-label">Entity Authority</div>
            <div class="cc-kpi-delta cc-delta-neutral">Wikipedia, Wikidata, sameAs</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(239,68,68,0.1);color:#ef4444"><i data-lucide="clock" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="recency-eligibility-val">&mdash;</div>
            <div class="cc-kpi-label">Recency Eligibility</div>
            <div class="cc-kpi-delta cc-delta-neutral">7 / 30 / 365-day windows</div>
          </div>
        </div>
        <div class="cc-kpi">
          <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.08);color:#00c8ff"><i data-lucide="activity" style="width:18px;height:18px"></i></div>
          <div class="cc-kpi-body">
            <div class="cc-kpi-value" id="retrieval-prob-val">&mdash;</div>
            <div class="cc-kpi-label">Retrieval Probability</div>
            <div class="cc-kpi-delta cc-delta-neutral">composite signal score</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3 class="card-title">Run Fan-Out Analysis</h3></div>
        <div style="padding:4px 0">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Topic</label>
              <input type="text" class="form-input" id="fanout-topic" placeholder="e.g., domain registration, content marketing">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Brand / Entity</label>
              <input type="text" class="form-input" id="fanout-entity" placeholder="e.g., NameSilo, Croutons Agents">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Seed Prompts (optional, one per line)</label>
            <textarea class="form-textarea" id="fanout-seeds" rows="3" placeholder="how do I register a domain&#10;best domain registrar 2025&#10;cheapest domain names"></textarea>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">Verticals</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
              ${['web','shopping','maps','news','images'].map(v => `<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer"><input type="checkbox" value="${v}" class="fanout-vertical-cb" checked> ${v}</label>`).join('')}
            </div>
          </div>
          <button class="btn btn-primary" id="run-fanout-btn" style="min-width:160px">
            <i data-lucide="git-branch" style="width:14px;height:14px"></i>
            Run Fan-Out Analysis
          </button>
        </div>
      </div>

      <div id="fanout-results" style="display:none">
        <div class="cc-grid-2" style="margin-bottom:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Prompt Cluster</h3><span class="cc-section-badge cc-badge-purple" id="cluster-count-badge">0 queries</span></div>
            <div id="fanout-cluster-list" style="max-height:300px;overflow-y:auto;padding:4px 0"></div>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Coverage by Vertical</h3></div>
            <div id="fanout-coverage-bars" style="padding:4px 0"></div>
          </div>
        </div>
        <div class="cc-grid-2" style="margin-bottom:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Fan-Out Queries with Recency Tags</h3></div>
            <div id="fanout-queries-table" style="max-height:300px;overflow-y:auto"></div>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Gap Analysis</h3></div>
            <div id="fanout-gap-analysis" style="padding:4px 0"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Recommended Croutons to Build</h3></div>
          <div id="fanout-recommended-croutons" style="padding:4px 0"></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3 class="card-title">AI Search Architecture Reference</h3></div>
        <div style="padding:4px 0">
          <div class="cc-info-grid">
            <div class="cc-info-block">
              <h4 class="cc-info-title">Sonic Classifier &amp; Fan-Out Engine</h4>
              <p class="text-sm">ChatGPT's Sonic Classifier fires before generation and determines if fresh web retrieval is needed (search threshold: ~65%). Standard mode fires 1-3 parallel queries. Thinking/Deep Search mode fires 10-30+ recursive fan-outs via SerpAPI. Results are merged via Reciprocal Rank Fusion (RRF).</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Recency Filters (7 / 30 / 365 days)</h4>
              <p class="text-sm">ChatGPT applies three recency windows: 7 days (breaking news), 30 days (general news), 365 days (established topics). Content without a machine-readable <code>dateModified</code> in JSON-LD is deprioritized. Always set <code>dateModified</code> in schema on every content update.</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Providers Ecosystem</h4>
              <p class="text-sm">ChatGPT uses SerpAPI (Google) for web, SearchAPI.io for Shopping (Mercury pipeline), Labrador/Bright for images. Copilot uses Bing directly. Perplexity uses Bing as primary provider. Submit sitemaps to both Google and Bing Webmaster Tools separately.</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Retrieval Probability Formula</h4>
              <p class="text-sm"><code>retrieval_probability = FanOutCoverage x RetrievalAdvantage x EntityAuthority x RetrievalSurfaceCount</code>. All factors are multiplicative. A score of 0 on any single factor produces a composite score of 0. Optimize all four dimensions simultaneously.</p>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();

    document.getElementById('run-fanout-btn')?.addEventListener('click', async () => {
      const topic = document.getElementById('fanout-topic')?.value?.trim();
      const entity = document.getElementById('fanout-entity')?.value?.trim();
      if (!topic || !entity) { toast('Topic and Entity are required', 'error'); return; }

      const verticals = Array.from(document.querySelectorAll('.fanout-vertical-cb:checked')).map(cb => cb.value);
      const seedsRaw = document.getElementById('fanout-seeds')?.value?.trim();
      const seedPrompts = seedsRaw ? seedsRaw.split('\n').filter(s => s.trim()) : [];

      const btn = document.getElementById('run-fanout-btn');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px"></i> Analyzing...';
      lucide.createIcons();

      try {
        const data = await apiFetch('/api/fanout-intelligence', {
          method: 'POST',
          body: JSON.stringify({ topic, entity, seed_prompts: seedPrompts, verticals }),
        });

        // Update KPI cards
        const overall = data.coverage_estimate?.overall || 0;
        document.getElementById('fanout-coverage-val').textContent = (overall * 100).toFixed(1) + '%';
        document.getElementById('surface-count-val').textContent = (data.recommended_croutons?.length || 0) + ' gaps';

        // Prompt cluster
        const cluster = data.prompt_cluster || [];
        document.getElementById('cluster-count-badge').textContent = cluster.length + ' queries';
        const clusterList = document.getElementById('fanout-cluster-list');
        clusterList.innerHTML = cluster.map((q, i) => `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--color-border);">
            <span style="font-size:11px;color:var(--color-text-muted);min-width:24px;text-align:right">${i+1}</span>
            <span style="font-size:13px;color:var(--color-text)">${escapeHtml(q)}</span>
          </div>`).join('');

        // Coverage bars
        const cov = data.coverage_estimate || {};
        const covBars = document.getElementById('fanout-coverage-bars');
        covBars.innerHTML = Object.entries(cov).filter(([k]) => k !== 'overall').map(([vertical, score]) => {
          const pct = Math.round((score || 0) * 100);
          const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:12px;text-transform:capitalize;color:var(--color-text)">${vertical}</span>
              <span style="font-size:12px;color:${color};font-weight:600">${pct}%</span>
            </div>
            <div style="height:6px;background:var(--color-border);border-radius:3px">
              <div style="height:6px;background:${color};border-radius:3px;width:${pct}%"></div>
            </div>
          </div>`;
        }).join('') + `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between">
            <span style="font-size:12px;font-weight:600;color:var(--color-text)">Overall Coverage</span>
            <span style="font-size:14px;font-weight:700;color:${(cov.overall||0) >= 0.75 ? '#10b981' : '#f59e0b'}">${Math.round((cov.overall||0)*100)}%</span>
          </div>`;

        // Fan-out queries table
        const queries = data.fanout_queries || [];
        const queriesTable = document.getElementById('fanout-queries-table');
        queriesTable.innerHTML = `<table class="cc-table"><thead><tr><th>Query</th><th>Vertical</th><th>Recency</th><th>Prob.</th></tr></thead><tbody>` +
          queries.map(q => `<tr>
            <td style="font-size:12px">${escapeHtml(q.query || '')}</td>
            <td><span style="font-size:11px;text-transform:capitalize">${q.vertical || 'web'}</span></td>
            <td><span class="tag" style="font-size:10px">${q.recency_tag || 'none'}</span></td>
            <td style="font-size:12px">${((q.retrieval_probability || 0)*100).toFixed(0)}%</td>
          </tr>`).join('') + `</tbody></table>`;

        // Gap analysis
        const gap = data.gap_analysis || {};
        const gapEl = document.getElementById('fanout-gap-analysis');
        gapEl.innerHTML = `
          <div style="margin-bottom:12px">
            <div style="font-size:12px;font-weight:600;color:var(--color-text);margin-bottom:6px">Uncovered Topics</div>
            ${(gap.uncovered_topics || []).map(t => `<div class="cc-activity-item" style="padding:4px 0;border-bottom:1px solid var(--color-border)"><i data-lucide="minus-circle" style="width:12px;height:12px;color:#ef4444;flex-shrink:0"></i><span style="font-size:12px">${escapeHtml(t)}</span></div>`).join('')}
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:12px;font-weight:600;color:var(--color-text);margin-bottom:6px">Priority Gaps</div>
            ${(gap.priority_gaps || []).map(g => `<div class="cc-activity-item" style="padding:4px 0;border-bottom:1px solid var(--color-border)"><i data-lucide="alert-triangle" style="width:12px;height:12px;color:#f59e0b;flex-shrink:0"></i><span style="font-size:12px">${escapeHtml(g)}</span></div>`).join('')}
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--color-text);margin-bottom:6px">Recommended Content</div>
            ${(gap.recommended_content || []).map(r => `<div class="cc-activity-item" style="padding:4px 0;border-bottom:1px solid var(--color-border)"><i data-lucide="plus-circle" style="width:12px;height:12px;color:#10b981;flex-shrink:0"></i><span style="font-size:12px">${escapeHtml(r)}</span></div>`).join('')}
          </div>`;
        lucide.createIcons({ nodes: [gapEl] });

        // Recommended croutons
        const recs = data.recommended_croutons || [];
        const recsEl = document.getElementById('fanout-recommended-croutons');
        recsEl.innerHTML = recs.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">` +
          recs.map(r => {
            const pColor = r.priority === 'high' ? '#ef4444' : r.priority === 'medium' ? '#f59e0b' : '#10b981';
            return `<div style="border:1px solid var(--color-border);border-radius:8px;padding:10px">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <span style="width:8px;height:8px;border-radius:50%;background:${pColor};flex-shrink:0"></span>
                <span style="font-size:12px;font-weight:600;color:var(--color-text)">${escapeHtml(r.topic || '')}</span>
              </div>
              <p style="font-size:11px;color:var(--color-text-muted);margin:0">${escapeHtml(r.fact_hint || '')}</p>
            </div>`;
          }).join('') + `</div>` : `<p class="text-sm text-muted">No recommended croutons generated.</p>`;

        document.getElementById('fanout-results').style.display = 'block';
        lucide.createIcons();
        toast('Fan-out analysis complete', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="git-branch" style="width:14px;height:14px"></i> Run Fan-Out Analysis';
        lucide.createIcons();
      }
    });
  }

  // ── CC: LLM CONVERSIONS ──
  function renderCCLLMConversions(el) {
    el.innerHTML = `
      <div class="cc-section-header">
        <span class="cc-section-badge cc-badge-green">LLM Traffic</span>
        <span class="text-sm text-muted">Track conversions from AI chatbots &amp; run Croutonization on your content</span>
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

      <div class="card" style="margin-top:16px;margin-bottom:16px">
        <div class="card-header"><h3 class="card-title">Croutonize Content</h3></div>
        <div style="padding:4px 0">
          <p class="text-sm text-muted" style="margin-bottom:12px">Convert raw content into atomic, machine-parseable croutons for AI retrieval. Produces NDJSON output, inference cost score, and retrieval advantage metric.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Brand / Entity Name</label>
              <input type="text" class="form-input" id="crouton-entity" placeholder="e.g., NameSilo, Croutons Agents">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Topic</label>
              <input type="text" class="form-input" id="crouton-topic" placeholder="e.g., domain registration pricing">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Content to Croutonize</label>
            <textarea class="form-textarea" id="crouton-content" rows="6" placeholder="Paste your blog post, product description, landing page copy, or any content you want to convert into atomic croutons..."></textarea>
          </div>
          <button class="btn btn-primary" id="run-croutonize-btn" style="min-width:160px">
            <i data-lucide="layers" style="width:14px;height:14px"></i>
            Croutonize
          </button>
        </div>
      </div>

      <div id="croutonize-results" style="display:none">
        <div class="cc-kpi-grid cc-kpi-grid-3" style="margin-bottom:16px">
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(124,58,237,0.1);color:#7c3aed"><i data-lucide="layers" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="crouton-count-val">0</div>
              <div class="cc-kpi-label">Croutons Generated</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b"><i data-lucide="gauge" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="crouton-ics-val">&mdash;</div>
              <div class="cc-kpi-label">Inference Cost Score</div>
              <div class="cc-kpi-delta cc-delta-neutral">lower is better</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="zap" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="crouton-ra-val">&mdash;</div>
              <div class="cc-kpi-label">Retrieval Advantage</div>
              <div class="cc-kpi-delta cc-delta-neutral">1 / (1 + ICS)</div>
            </div>
          </div>
        </div>

        <div class="cc-grid-2" style="margin-bottom:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Generated Croutons</h3></div>
            <div id="crouton-cards-list" style="max-height:400px;overflow-y:auto;padding:4px 0"></div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">NDJSON Output</h3>
              <button class="btn btn-secondary btn-sm" id="copy-ndjson-btn">Copy</button>
            </div>
            <pre id="crouton-ndjson-output" style="font-size:11px;overflow:auto;max-height:400px;white-space:pre-wrap;word-break:break-all;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:10px;margin:4px 0"></pre>
          </div>
        </div>
      </div>

      <div class="cc-grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title">On-Demand Bots (Real Referral Traffic)</h3></div>
          <table class="cc-table">
            <thead><tr><th>Source</th><th>User-Agent</th><th>Domain Pattern</th></tr></thead>
            <tbody>
              <tr><td>ChatGPT</td><td><code style="font-size:11px">ChatGPT-User</code></td><td>chatgpt.com, chat.openai.com</td></tr>
              <tr><td>Claude</td><td><code style="font-size:11px">Claude-User</code></td><td>claude.ai</td></tr>
              <tr><td>Perplexity</td><td><code style="font-size:11px">Perplexity-User</code></td><td>perplexity.ai</td></tr>
              <tr><td>Gemini</td><td>&mdash;</td><td>gemini.google.com</td></tr>
              <tr><td>Copilot</td><td>&mdash;</td><td>copilot.microsoft.com</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Citation vs Influence</h3></div>
          <div style="padding:4px 0">
            <div class="cc-activity-list">
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#10b981;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Explicit Citations [1][2][3] &mdash; HIGH value</span>
                  <span class="cc-activity-text">Inline citations in AI responses. Clickable links. Generate real referral traffic.</span>
                </div>
              </div>
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#f59e0b;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Sources Section &mdash; MEDIUM value</span>
                  <span class="cc-activity-text">Appears in the Sources panel at bottom. Less prominent but drives referral traffic.</span>
                </div>
              </div>
              <div class="cc-activity-item">
                <span class="cc-service-dot" style="background:#ef4444;width:10px;height:10px;flex-shrink:0"></span>
                <div class="cc-activity-detail">
                  <span class="cc-activity-agent">Implicit Grounding (ref_type: academia) &mdash; ZERO traffic</span>
                  <span class="cc-activity-text">Used for model grounding only. Never shown to users. Wikipedia, arXiv qualify here.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();

    document.getElementById('run-croutonize-btn')?.addEventListener('click', async () => {
      const entity = document.getElementById('crouton-entity')?.value?.trim();
      const topic = document.getElementById('crouton-topic')?.value?.trim();
      const content = document.getElementById('crouton-content')?.value?.trim();
      if (!entity || !topic || !content) { toast('Entity, topic, and content are all required', 'error'); return; }

      const btn = document.getElementById('run-croutonize-btn');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px"></i> Croutonizing...';
      lucide.createIcons();

      try {
        const data = await apiFetch('/api/croutonize', {
          method: 'POST',
          body: JSON.stringify({ entity, topic, text: content }),
        });

        document.getElementById('crouton-count-val').textContent = data.crouton_count || (data.croutons?.length || 0);
        document.getElementById('crouton-ics-val').textContent = (data.inference_cost_score || 0).toFixed(2);
        document.getElementById('crouton-ra-val').textContent = (data.retrieval_advantage || 0).toFixed(4);

        // Crouton cards
        const cards = document.getElementById('crouton-cards-list');
        cards.innerHTML = (data.croutons || []).map((c, i) => `
          <div style="border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="font-size:10px;color:var(--color-text-muted);font-family:monospace">${escapeHtml(c.crouton_id || 'c-' + String(i+1).padStart(3,'0'))}</span>
              <span style="font-size:11px;font-weight:600;color:var(--color-text)">${escapeHtml(c.entity_primary || entity)}</span>
            </div>
            <p style="font-size:12px;color:var(--color-text);margin:0 0 4px 0;font-weight:500">${escapeHtml(c.fact || '')}</p>
            <p style="font-size:11px;color:var(--color-text-muted);margin:0 0 4px 0">${escapeHtml(c.context || '')}</p>
            <p style="font-size:11px;color:var(--color-text-secondary);margin:0">${escapeHtml(c.application || '')}</p>
          </div>`).join('');

        // NDJSON output
        document.getElementById('crouton-ndjson-output').textContent = data.ndjson || '';

        document.getElementById('croutonize-results').style.display = 'block';
        toast('Content croutonized successfully', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="layers" style="width:14px;height:14px"></i> Croutonize';
        lucide.createIcons();
      }
    });

    document.getElementById('copy-ndjson-btn')?.addEventListener('click', () => {
      const ndjson = document.getElementById('crouton-ndjson-output')?.textContent;
      if (ndjson) {
        navigator.clipboard.writeText(ndjson).then(() => toast('NDJSON copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'));
      }
    });
  }

  // ── CC: COMPETITORS & CITATION GAPS ──
  function renderCCCompetitors(el) {
    el.innerHTML = `
      <div class="cc-section-header">
        <span class="cc-section-badge cc-badge-orange">Competitive Intel</span>
        <span class="text-sm text-muted">Track competitor citations, identify gaps, and score content inference cost</span>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3 class="card-title">Inference Cost Scorer</h3></div>
        <div style="padding:4px 0">
          <p class="text-sm text-muted" style="margin-bottom:12px">Score any URL or content on the 6 inference cost dimensions (atomicity, context completeness, structure, ambiguity, entity clarity, freshness signaling). Lower scores mean higher AI retrieval probability.</p>
          <div class="form-group" style="margin-bottom:8px">
            <label class="form-label">URL to Score</label>
            <input type="text" class="form-input" id="ics-url" placeholder="https://example.com/page-to-score">
          </div>
          <div style="text-align:center;font-size:12px;color:var(--color-text-muted);margin-bottom:8px">OR</div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Paste Content Directly</label>
            <textarea class="form-textarea" id="ics-content" rows="5" placeholder="Paste content to score directly if you don't have a URL..."></textarea>
          </div>
          <button class="btn btn-primary" id="run-ics-btn" style="min-width:160px">
            <i data-lucide="gauge" style="width:14px;height:14px"></i>
            Score Content
          </button>
        </div>
      </div>

      <div id="ics-results" style="display:none">
        <div class="cc-kpi-grid cc-kpi-grid-3" style="margin-bottom:16px">
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b"><i data-lucide="gauge" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="ics-total-val">&mdash;</div>
              <div class="cc-kpi-label">Total Inference Cost Score</div>
              <div class="cc-kpi-delta cc-delta-neutral">0=optimal, 30=worst</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(16,185,129,0.1);color:#10b981"><i data-lucide="zap" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="ics-ra-val">&mdash;</div>
              <div class="cc-kpi-label">Retrieval Advantage</div>
              <div class="cc-kpi-delta cc-delta-neutral">1 / (1 + ICS)</div>
            </div>
          </div>
          <div class="cc-kpi">
            <div class="cc-kpi-icon" style="background:rgba(0,200,255,0.1);color:#00c8ff"><i data-lucide="bar-chart-3" style="width:18px;height:18px"></i></div>
            <div class="cc-kpi-body">
              <div class="cc-kpi-value" id="ics-grade-val">&mdash;</div>
              <div class="cc-kpi-label">Score Grade</div>
              <div class="cc-kpi-delta cc-delta-neutral">A=0-5, B=6-10, C=11-18, D=19-25, F=26+</div>
            </div>
          </div>
        </div>

        <div class="cc-grid-2" style="margin-bottom:16px">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Score Breakdown (Radar Chart)</h3></div>
            <div style="height:280px;display:flex;align-items:center;justify-content:center;padding:8px">
              <canvas id="ics-radar-chart"></canvas>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3 class="card-title">Dimension Scores</h3></div>
            <div id="ics-dimension-bars" style="padding:4px 0"></div>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><h3 class="card-title">Recommendations</h3></div>
          <div id="ics-recommendations" style="padding:4px 0"></div>
        </div>
      </div>

      <div class="cc-grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Citation Gap Analysis</h3></div>
          <div style="padding:16px 0">
            <p class="text-sm" style="margin-bottom:16px">Use your SEO agents to monitor which competitors appear in AI answers for your target queries.</p>
            <div class="cc-gap-example">
              <div class="cc-gap-row cc-gap-header"><span>Query</span><span>You</span><span>Competitor A</span><span>Competitor B</span></div>
              <div class="cc-gap-row"><span class="cc-query-cell">best domain registrar</span><span class="cc-gap-check">&mdash;</span><span class="cc-gap-cited">Cited</span><span class="cc-gap-cited">Cited</span></div>
              <div class="cc-gap-row"><span class="cc-query-cell">cheap domain names</span><span class="cc-gap-cited">Cited</span><span class="cc-gap-cited">Cited</span><span class="cc-gap-check">&mdash;</span></div>
              <div class="cc-gap-row"><span class="cc-query-cell">domain privacy protection</span><span class="cc-gap-check">&mdash;</span><span class="cc-gap-check">&mdash;</span><span class="cc-gap-cited">Cited</span></div>
            </div>
            <p class="text-sm text-muted" style="margin-top:12px">Configure competitor tracking in your agent goals to populate this data.</p>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">Entity Recognition &amp; Knowledge Graph</h3></div>
          <div style="padding:4px 0">
            <div class="cc-info-block" style="margin-bottom:12px">
              <h4 class="cc-info-title">ChatGPT NER System</h4>
              <p class="text-sm">ChatGPT uses a proprietary Named Entity Recognition system with disambiguation format: <code>entity["category","name","disambiguation_string"]</code>. Categories include people, company, place, and product. If your brand is not in the semantic knowledge graph, it may not exist for ChatGPT.</p>
            </div>
            <div class="cc-info-block">
              <h4 class="cc-info-title">Improving Entity Disambiguation</h4>
              <ul style="margin-top:6px;padding-left:16px;font-size:12px;color:var(--color-text-secondary);display:flex;flex-direction:column;gap:4px">
                <li>Create or claim a Wikipedia page and Wikidata entry</li>
                <li>Add <code>sameAs</code> in JSON-LD pointing to Wikipedia, Wikidata, Crunchbase</li>
                <li>Use consistent brand name in all structured data</li>
                <li>Build a dedicated brand facts page with Organization schema</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();

    document.getElementById('run-ics-btn')?.addEventListener('click', async () => {
      const url = document.getElementById('ics-url')?.value?.trim();
      const content = document.getElementById('ics-content')?.value?.trim();
      if (!url && !content) { toast('Provide a URL or paste content to score', 'error'); return; }

      const btn = document.getElementById('run-ics-btn');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px"></i> Scoring...';
      lucide.createIcons();

      try {
        const payload = url ? { url } : { content };
        const data = await apiFetch('/api/inference-cost-score', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        const total = data.total_score || 0;
        const ra = data.retrieval_advantage || 0;
        const grade = total <= 5 ? 'A' : total <= 10 ? 'B' : total <= 18 ? 'C' : total <= 25 ? 'D' : 'F';
        const gradeColor = grade === 'A' ? '#10b981' : grade === 'B' ? '#00c8ff' : grade === 'C' ? '#f59e0b' : '#ef4444';

        document.getElementById('ics-total-val').textContent = total;
        document.getElementById('ics-ra-val').textContent = ra.toFixed(4);
        const gradeEl = document.getElementById('ics-grade-val');
        gradeEl.textContent = grade;
        gradeEl.style.color = gradeColor;

        // Dimension bars
        const scores = data.scores || {};
        const dimNames = { atomicity: 'Atomicity', context_completeness: 'Context Completeness', structure: 'Structure', ambiguity: 'Ambiguity', entity_clarity: 'Entity Clarity', freshness_signaling: 'Freshness Signaling' };
        const dimBars = document.getElementById('ics-dimension-bars');
        dimBars.innerHTML = Object.entries(scores).map(([dim, score]) => {
          const pct = Math.round((score / 5) * 100);
          const color = score <= 1 ? '#10b981' : score <= 2 ? '#00c8ff' : score <= 3 ? '#f59e0b' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:12px;color:var(--color-text)">${dimNames[dim] || dim}</span>
              <span style="font-size:12px;color:${color};font-weight:600">${score}/5</span>
            </div>
            <div style="height:6px;background:var(--color-border);border-radius:3px">
              <div style="height:6px;background:${color};border-radius:3px;width:${pct}%"></div>
            </div>
          </div>`;
        }).join('');

        // Radar chart
        const radarEl = document.getElementById('ics-radar-chart');
        if (radarEl) {
          if (window._icsRadarChart) { window._icsRadarChart.destroy(); }
          const labels = Object.keys(scores).map(k => dimNames[k] || k);
          const vals = Object.values(scores);
          window._icsRadarChart = new Chart(radarEl.getContext('2d'), {
            type: 'radar',
            data: {
              labels,
              datasets: [{ label: 'Inference Cost', data: vals, fill: true, backgroundColor: 'rgba(124,58,237,0.15)', borderColor: '#7c3aed', pointBackgroundColor: '#7c3aed', pointRadius: 4 }],
            },
            options: {
              scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 10 } }, pointLabels: { font: { size: 11 } } } },
              plugins: { legend: { display: false } },
              responsive: true, maintainAspectRatio: false,
            },
          });
        }

        // Recommendations
        const recs = data.recommendations || [];
        const recsEl = document.getElementById('ics-recommendations');
        recsEl.innerHTML = recs.length ? recs.map(r => `
          <div style="border-left:3px solid #f59e0b;padding:8px 12px;margin-bottom:8px;background:rgba(245,158,11,0.05);border-radius:0 6px 6px 0">
            <div style="font-size:12px;font-weight:600;color:var(--color-text);margin-bottom:3px">${escapeHtml(r.dimension || '')}: ${escapeHtml(r.issue || '')}</div>
            <div style="font-size:11px;color:var(--color-text-muted)">${escapeHtml(r.fix || '')}</div>
          </div>`).join('') : '<p class="text-sm text-muted">No recommendations. Content scores optimally.</p>';

        document.getElementById('ics-results').style.display = 'block';
        lucide.createIcons();
        toast('Inference cost scoring complete', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="gauge" style="width:14px;height:14px"></i> Score Content';
        lucide.createIcons();
      }
    });
  }

  // ── CC: AGENT OPS ──
  async function renderCCAgentOps(el) {
    el.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const [data, intel] = await Promise.all([
        apiFetch(`/api/command-center/agents-activity${getCCScopeQuery()}`),
        loadSearchOpsIntel(),
      ]);
      const agents = Object.entries(data.agents || {});
      const timeline = data.timeline || [];
      const dailyChart = data.daily_chart || [];

      el.innerHTML = `
        <div class="cc-section-header">
          <span class="cc-section-badge cc-badge-blue">Agent Operations</span>
          <span class="text-sm text-muted">${agents.length} operators · ${timeline.length} recent interactions · ${intel.kpis?.executions_today || 0} executions today</span>
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
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3 class="card-title">Audit Trail (Lifecycle + Scope)</h3></div>
          <table class="cc-table">
            <thead><tr><th>Operator</th><th>Stage</th><th>Scope</th><th>Trigger</th><th>Actions</th><th>Status</th></tr></thead>
            <tbody>
              ${(intel.audit_trail || []).map(a => `
                <tr>
                  <td>${escapeHtml(a.agent_name || a.actor || a.agent_id || 'Unknown')}</td>
                  <td>${escapeHtml(a.lifecycle_stage || a.action_type || 'Execute')}</td>
                  <td>${escapeHtml(a.scope_mode || a.object_type || 'site')}</td>
                  <td>${escapeHtml((a.triggering_signal_ids || []).join(', ') || a.object_id || 'n/a')}</td>
                  <td>${escapeHtml((a.affected_resources || []).join(', ') || Object.values(a.linked_ids || {}).join(', ') || 'n/a')}</td>
                  <td><span class="badge badge-${a.status || a.new_state || 'active'}">${escapeHtml(a.status || a.new_state || 'unknown')}</span></td>
                </tr>
              `).join('')}
              ${(intel.audit_trail || []).length === 0 ? '<tr><td colspan="6" class="text-muted">No audit entries yet</td></tr>' : ''}
            </tbody>
          </table>
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
          <div class="page-header"><h1 class="page-title">Search Operators</h1></div>
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="bot"></i></div>
            <h3 class="empty-state-title">No operators yet</h3>
            <p class="empty-state-desc">Create your first search operator to watch signals, plan actions, execute updates, and measure impact.</p>
            <a href="#/wizard" class="btn btn-primary btn-lg">Create Search Operator</a>
          </div>`;
        lucide.createIcons();
        return;
      }

      const templateIcons = { seo: '<i data-lucide="search" style="width:20px;height:20px"></i>', social: '<i data-lucide="share-2" style="width:20px;height:20px"></i>', sales: '<i data-lucide="radar" style="width:20px;height:20px"></i>', support: '<i data-lucide="refresh-ccw" style="width:20px;height:20px"></i>', content: '<i data-lucide="pen-tool" style="width:20px;height:20px"></i>', analytics: '<i data-lucide="swords" style="width:20px;height:20px"></i>', custom: '<i data-lucide="settings" style="width:20px;height:20px"></i>', ai_retrieval: '<i data-lucide="brain-circuit" style="width:20px;height:20px"></i>', schema_optimizer: '<i data-lucide="braces" style="width:20px;height:20px"></i>', distribution_operator: '<i data-lucide="share-2" style="width:20px;height:20px"></i>', recovery_operator: '<i data-lucide="refresh-ccw" style="width:20px;height:20px"></i>', full_search_operator: '<i data-lucide="radar" style="width:20px;height:20px"></i>', custom_search_operator: '<i data-lucide="settings" style="width:20px;height:20px"></i>' };
      const purposeByTemplate = {
        seo: 'Watches search demand and detects ranking opportunities.',
        ai_retrieval: 'Detects citation gaps and retrieval weaknesses.',
        analytics: 'Monitors competitor shifts and citation wins.',
        content: 'Generates and publishes support content assets.',
        support: 'Recovers declining pages with targeted refreshes.',
        social: 'Distributes published content across social channels.',
        sales: 'Runs full Observe -> Diagnose -> Plan -> Execute -> Measure loop.',
        schema_optimizer: 'Finds structured-data and retrieval markup weaknesses.',
        distribution_operator: 'Distributes supporting assets after publication.',
        recovery_operator: 'Recovers declining pages with refresh playbooks.',
        full_search_operator: 'Runs end-to-end autonomous search operations.',
        custom_search_operator: 'Custom operator configured to your strategy and guardrails.',
        custom: 'Custom operator configured to your strategy and guardrails.',
      };
      const automationLabel = {
        advisory_only: 'Advisory only',
        approval_all: 'Approval for all actions',
        approval_publish_distribution: 'Approval for publish/distribution',
        semi_auto_rules: 'Semi-auto within rules',
        full_auto_rules: 'Full auto within rules',
      };
      const lifecycleByStatus = {
        active: 'Watching',
        running: 'Executing',
        paused: 'Idle',
        error: 'Error',
      };

      container.innerHTML = `
        <div class="page-header flex justify-between items-center">
          <div>
            <h1 class="page-title">Search Operators</h1>
            <p class="page-subtitle">${agents.length} operators with live watch scopes, plans, and execution impact</p>
          </div>
          <a href="#/wizard" class="btn btn-primary"><i data-lucide="plus" style="width:16px;height:16px"></i> Create Operator</a>
        </div>
        <div class="grid-2" id="agents-grid">
          ${agents.map(agent => `
            <div class="agent-card" data-id="${agent.id}">
              <div class="agent-card-head">
                <div style="display:flex;align-items:center;gap:12px">
                  <div class="agent-card-icon">${templateIcons[agent.template_id] || '<i data-lucide="settings" style="width:20px;height:20px"></i>'}</div>
                  <div>
                    <div class="agent-card-name">${escapeHtml(agent.name)}</div>
                    <span class="badge badge-${agent.status}">${escapeHtml(lifecycleByStatus[agent.status] || agent.status)}</span>
                  </div>
                </div>
              </div>
              <div class="text-xs text-muted" style="margin-bottom:8px"><strong>Agent Purpose:</strong> ${escapeHtml(purposeByTemplate[agent.template_id] || purposeByTemplate.custom)}</div>
              <div class="agent-card-desc">${escapeHtml(agent.description || 'No description')}</div>
              <div class="agent-card-meta">
                <span><i data-lucide="cpu" style="width:12px;height:12px;display:inline"></i> ${agent.model || 'gpt-4o-mini'}</span>
                <span>Automation: ${escapeHtml(automationLabel[agent.automation_mode] || 'Approval for publish/distribution')}</span>
                <span>Last impact: ${timeAgo(agent.last_run_at)}</span>
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
    let activeTab = 'overview';
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
          <button class="agent-tab ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
          <button class="agent-tab ${activeTab === 'chat' ? 'active' : ''}" data-tab="chat">Chat</button>
          <button class="agent-tab ${activeTab === 'queue' ? 'active' : ''}" data-tab="queue">Queue</button>
          <button class="agent-tab ${activeTab === 'runs' ? 'active' : ''}" data-tab="runs">Runs</button>
          <button class="agent-tab ${activeTab === 'approvals' ? 'active' : ''}" data-tab="approvals">Approvals</button>
          <button class="agent-tab ${activeTab === 'outcomes' ? 'active' : ''}" data-tab="outcomes">Outcomes</button>
          <button class="agent-tab ${activeTab === 'assignments' ? 'active' : ''}" data-tab="assignments">Assignments</button>
          <button class="agent-tab ${activeTab === 'audit' ? 'active' : ''}" data-tab="audit">Audit</button>
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
      if (activeTab === 'overview') renderOperatorOverviewTab(tabContent);
      else if (activeTab === 'chat') renderChatTab(tabContent);
      else if (activeTab === 'queue') renderQueueTab(tabContent);
      else if (activeTab === 'runs') renderRunsTab(tabContent);
      else if (activeTab === 'approvals') renderApprovalsTab(tabContent);
      else if (activeTab === 'outcomes') renderOutcomesTab(tabContent);
      else if (activeTab === 'assignments') renderAssignmentsTab(tabContent);
      else if (activeTab === 'audit') renderAuditTab(tabContent);
      else if (activeTab === 'settings') renderSettingsTab(tabContent);
    }

    async function renderOperatorOverviewTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const agentRuntime = (intel.agents || []).find(a => a.id === agentId) || {};
        const work = agentRuntime.workload_summary || {};
        const thr = agentRuntime.throughput_summary || {};
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="kpi-grid" style="margin-bottom:16px">
              <div class="kpi-card"><div class="kpi-label">Workload</div><div class="kpi-value" style="font-size:18px">${escapeHtml(work.workload_indicator || 'underutilized')}</div></div>
              <div class="kpi-card"><div class="kpi-label">Running</div><div class="kpi-value">${work.running_executions || 0}</div></div>
              <div class="kpi-card"><div class="kpi-label">Blocked</div><div class="kpi-value">${work.blocked_executions || 0}</div></div>
              <div class="kpi-card"><div class="kpi-label">Failed</div><div class="kpi-value">${work.failed_executions || 0}</div></div>
              <div class="kpi-card"><div class="kpi-label">Throughput 24h</div><div class="kpi-value">${thr.throughput_24h || 0}</div></div>
              <div class="kpi-card"><div class="kpi-label">Success Rate</div><div class="kpi-value">${Number(thr.success_rate || 0).toFixed(1)}%</div></div>
              <div class="kpi-card"><div class="kpi-label">Token Usage</div><div class="kpi-value">${(thr.token_usage || 0).toLocaleString()}</div></div>
              <div class="kpi-card"><div class="kpi-label">Cost Usage</div><div class="kpi-value">$${Number(thr.cost_usage || 0).toFixed(4)}</div></div>
            </div>
            <div class="text-xs text-muted">Queue cap: ${agentRuntime.queue_limits?.max_queued_work ?? 12} · Concurrency cap: ${agentRuntime.concurrency_limits?.max_concurrent_executions ?? 3} · Approval dependency: ${Number(thr.approval_dependency_rate || 0).toFixed(1)}%</div>
          </div>`;
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load overview</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
    }

    async function renderQueueTab(tabContent) { return renderAssignmentsTab(tabContent); }
    async function renderRunsTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const runs = (intel.executions || []).filter(e => e.agent_id === agentId);
        const thr = ((intel.agents || []).find(a => a.id === agentId) || {}).throughput_summary || {};
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="kpi-grid" style="margin-bottom:16px">
              <div class="kpi-card"><div class="kpi-label">Running</div><div class="kpi-value">${runs.filter(r => r.status === 'running').length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Blocked</div><div class="kpi-value">${runs.filter(r => !!r.blocking_reason).length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Failed</div><div class="kpi-value">${runs.filter(r => r.status === 'failed').length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Completed</div><div class="kpi-value">${runs.filter(r => r.status === 'completed').length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Avg to Execution</div><div class="kpi-value">${Math.round(thr.avg_time_to_execution_seconds || 0)}s</div></div>
              <div class="kpi-card"><div class="kpi-label">Avg to Completion</div><div class="kpi-value">${Math.round(thr.avg_time_to_completion_seconds || 0)}s</div></div>
            </div>
            <div class="card">
              <div class="card-header"><h3 class="card-title">Execution Runs</h3></div>
              <table class="cc-table">
                <thead><tr><th>Execution</th><th>Status</th><th>Current Step</th><th>Retries</th><th>Actions</th></tr></thead>
                <tbody>
                  ${runs.map(r => {
                    const current = (r.steps || []).find(s => ['running','queued','awaiting_approval','waiting_dependency','failed'].includes(s.status));
                    const retries = (r.steps || []).reduce((sum, s) => sum + Math.max(0, (s.attempts || 0) - 1), 0);
                    return `<tr>
                      <td>${escapeHtml(r.id || '')}</td>
                      <td>${escapeHtml(r.status || '')}${r.blocking_reason ? ` · ${escapeHtml(r.blocking_reason)}` : ''}</td>
                      <td>${escapeHtml(current?.label || 'n/a')}</td>
                      <td>${retries}</td>
                      <td style="display:flex;gap:6px">
                        <button class="btn btn-ghost btn-xs" onclick="window.NC.inspectIntelObject('execution','${escapeHtml(r.id)}')">Inspect</button>
                        <button class="btn btn-secondary btn-xs runs-action" data-id="${escapeHtml(r.id)}" data-action="retry_step">Retry</button>
                        <button class="btn btn-secondary btn-xs runs-action" data-id="${escapeHtml(r.id)}" data-action="approve_blocked">Continue</button>
                      </td>
                    </tr>`;
                  }).join('')}
                  ${runs.length === 0 ? '<tr><td colspan="5" class="text-muted">No runs for this operator yet.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
        tabContent.querySelectorAll('.runs-action').forEach(btn => btn.addEventListener('click', async () => {
          try {
            await mutateIntelObject('execution', btn.dataset.id, btn.dataset.action, {});
            toast(`Run action: ${btn.dataset.action}`, 'success');
            renderRunsTab(tabContent);
          } catch (err) {
            toast(err.message || 'Run action failed', 'error');
          }
        }));
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load runs</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
    }
    async function renderOutcomesTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const agentExecutionIds = new Set((intel.executions || []).filter(e => e.agent_id === agentId).map(e => e.id));
        const outcomes = (intel.outcomes || []).filter(o => agentExecutionIds.has(o.execution_id));
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="card">
              <div class="card-header"><h3 class="card-title">Outcomes Influenced</h3></div>
              <table class="cc-table">
                <thead><tr><th>Outcome</th><th>Execution</th><th>Status</th><th>Confidence</th><th>Impact</th></tr></thead>
                <tbody>
                  ${outcomes.map(o => `<tr><td>${escapeHtml(o.type || o.id)}</td><td>${escapeHtml(o.execution_id || '')}</td><td>${escapeHtml(o.status || 'observed')}</td><td>${Math.round((o.confidence || 0) * 100)}%</td><td>${escapeHtml(o.narrative_summary || '')}</td></tr>`).join('')}
                  ${outcomes.length === 0 ? '<tr><td colspan="5" class="text-muted">No outcomes linked yet.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load outcomes</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
    }

    async function renderApprovalsTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const approvals = (intel.approval_items || []).filter(a => a.agent_id === agentId);
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="card">
              <div class="card-header"><h3 class="card-title">Approvals</h3></div>
              <table class="cc-table">
                <thead><tr><th>Status</th><th>Type</th><th>Target</th><th>Approval Type</th><th>Risk</th><th>Decision</th></tr></thead>
                <tbody>
                  ${approvals.map(a => `<tr>
                    <td>${escapeHtml(a.status || 'pending')}</td>
                    <td>${escapeHtml(a.object_type || '')}</td>
                    <td>${escapeHtml(a.target_resource || a.title || a.object_id || '')}</td>
                    <td>${escapeHtml(a.approval_type || a.approval_requirement_type || '')}</td>
                    <td>${escapeHtml(a.risk_context || 'n/a')}</td>
                    <td style="display:flex;gap:6px">
                      ${a.status === 'pending' ? `
                        <button class="btn btn-secondary btn-xs agent-approval" data-id="${escapeHtml(a.approval_id || '')}" data-action="approve">Approve</button>
                        <button class="btn btn-secondary btn-xs agent-approval" data-id="${escapeHtml(a.approval_id || '')}" data-action="approve_with_edits">Approve with edits</button>
                        <button class="btn btn-secondary btn-xs agent-approval" data-id="${escapeHtml(a.approval_id || '')}" data-action="reject">Reject</button>
                      ` : `${escapeHtml(a.decided_by || 'system')} · ${escapeHtml(timeAgo(a.decided_at || a.requested_at || new Date().toISOString()))}`}
                    </td>
                  </tr>`).join('')}
                  ${approvals.length === 0 ? '<tr><td colspan="6" class="text-muted">No approvals for this operator.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
        tabContent.querySelectorAll('.agent-approval').forEach(btn => btn.addEventListener('click', async () => {
          if (!btn.dataset.id) return;
          try {
            const reason = btn.dataset.action === 'reject' ? (prompt('Rejection reason:', '') || '') : (btn.dataset.action === 'approve_with_edits' ? (prompt('Edit notes:', '') || '') : '');
            await mutateIntelObject('approval', btn.dataset.id, btn.dataset.action, { reason });
            toast(`Approval ${btn.dataset.action}`, 'success');
            renderApprovalsTab(tabContent);
          } catch (err) {
            toast(err.message || 'Approval update failed', 'error');
          }
        }));
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load approvals</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
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

    function appendMessage(role, content, timestamp, tokens, toolsUsed) {
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
        ? `<div class="chat-message-meta">${metaParts.join(' \u00b7 ')}</div>`
        : '';

      // Show tools used badge
      let toolsHtml = '';
      if (toolsUsed && toolsUsed.length > 0) {
        const toolNames = toolsUsed.map(t => {
          // Clean up tool names for display
          return t.replace(/_/g, ' ').replace(/^github /, 'GitHub: ').replace(/^gsc /, 'GSC: ').replace(/^ga /, 'GA: ');
        });
        toolsHtml = `<div class="chat-tools-used" style="margin-top:6px;padding:6px 10px;background:var(--bg-tertiary, #f0f4f8);border-radius:6px;font-size:12px;color:var(--text-secondary, #64748b)"><i data-lucide="wrench" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px"></i>Tools used: ${toolNames.join(', ')}</div>`;
      }

      msgEl.innerHTML = `<div>${escapeHtml(content)}</div>${toolsHtml}${metaHtml}`;
      messagesEl.appendChild(msgEl);
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        try { lucide.createIcons({ nodes: [msgEl] }); } catch(e) {}
      }
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
        const toolsUsed = result.tools_used || null;
        appendMessage('assistant', response, new Date().toISOString(), tokens, toolsUsed);
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

    async function renderAssignmentsTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const aid = agentId;
        const assignedSignals = (intel.signals || []).filter(s => s.assigned_agent_id === aid);
        const assignedOpps = (intel.opportunities || []).filter(o => o.assigned_agent_id === aid);
        const assignedGaps = (intel.citation_gaps || []).filter(g => g.assigned_agent_id === aid);
        const assignedPlans = (intel.plans || []).filter(p => p.agent_id === aid);
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="kpi-grid" style="margin-bottom:16px">
              <div class="kpi-card"><div class="kpi-label">Signals</div><div class="kpi-value">${assignedSignals.length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Opportunities</div><div class="kpi-value">${assignedOpps.length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Citation Gaps</div><div class="kpi-value">${assignedGaps.length}</div></div>
              <div class="kpi-card"><div class="kpi-label">Plans</div><div class="kpi-value">${assignedPlans.length}</div></div>
            </div>
            <div class="card">
              <div class="card-header"><h3 class="card-title">Assigned Work Queue</h3></div>
              <table class="cc-table">
                <thead><tr><th>Type</th><th>Title</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  ${assignedSignals.map(s => `<tr><td>Signal</td><td>${escapeHtml(s.title || s.id)}</td><td>${escapeHtml(s.status || 'new')}</td><td style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('signal','${escapeHtml(s.id)}')">Inspect</button><button class="btn btn-secondary btn-xs reassign-item" data-kind="signal" data-id="${escapeHtml(s.id)}">Reassign</button></td></tr>`).join('')}
                  ${assignedOpps.map(o => `<tr><td>Opportunity</td><td>${escapeHtml(o.title || o.id)}</td><td>${escapeHtml(o.status || 'open')}</td><td style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('opportunity','${escapeHtml(o.id)}')">Inspect</button><button class="btn btn-secondary btn-xs reassign-item" data-kind="opportunity" data-id="${escapeHtml(o.id)}">Reassign</button></td></tr>`).join('')}
                  ${assignedGaps.map(g => `<tr><td>Gap</td><td>${escapeHtml(g.target_topic || g.gap_id || g.id)}</td><td>${escapeHtml(g.status || 'open')}</td><td style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('citation_gap','${escapeHtml(g.gap_id || g.id)}')">Inspect</button><button class="btn btn-secondary btn-xs reassign-item" data-kind="citation_gap" data-id="${escapeHtml(g.gap_id || g.id)}">Reassign</button></td></tr>`).join('')}
                  ${assignedPlans.map(p => `<tr><td>Plan</td><td>${escapeHtml(p.name || p.id)}</td><td>${escapeHtml(p.status || 'draft')}</td><td style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="window.NC.inspectIntelObject('plan','${escapeHtml(p.id)}')">Inspect</button><button class="btn btn-secondary btn-xs reassign-item" data-kind="plan" data-id="${escapeHtml(p.id)}">Reassign</button></td></tr>`).join('')}
                  ${(assignedSignals.length + assignedOpps.length + assignedGaps.length + assignedPlans.length) === 0 ? '<tr><td colspan="4" class="text-muted">No assigned objects yet.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
        lucide.createIcons({ nodes: [tabContent] });
        tabContent.querySelectorAll('.reassign-item').forEach(btn => btn.addEventListener('click', async () => {
          const kind = btn.dataset.kind;
          const id = btn.dataset.id;
          const newAgentId = prompt('Reassign to agent ID:');
          if (!newAgentId) return;
          try {
            await mutateIntelObject(kind, id, 'assign', { agent_id: newAgentId, agent_name: prompt('Agent name (optional):', '') || '' });
            toast(`Reassigned ${kind}`, 'success');
            renderAssignmentsTab(tabContent);
          } catch (err) {
            toast(err.message || 'Reassign failed', 'error');
          }
        }));
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load assignments</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
    }

    async function renderAuditTab(tabContent) {
      tabContent.innerHTML = `<div class="loading-center" style="padding:40px"><div class="loading-spinner"></div></div>`;
      try {
        const intel = await loadSearchOpsIntel();
        const history = (intel.audit_trail || []).filter(a =>
          (a.agent_id && a.agent_id === agentId) ||
          (a.linked_ids && Object.values(a.linked_ids || {}).includes(agentId)) ||
          (a.object_type === 'agent' && a.object_id === agentId)
        );
        tabContent.innerHTML = `
          <div style="padding:16px">
            <div class="card">
              <div class="card-header"><h3 class="card-title">Operator Audit History</h3></div>
              <table class="cc-table">
                <thead><tr><th>When</th><th>Action</th><th>Object</th><th>State</th><th>Notes</th></tr></thead>
                <tbody>
                  ${history.map(a => `
                    <tr>
                      <td>${escapeHtml(timeAgo(a.timestamp || a.started_at || new Date().toISOString()))}</td>
                      <td>${escapeHtml(a.action_type || a.lifecycle_stage || 'event')}</td>
                      <td>${escapeHtml(`${a.object_type || 'object'}:${a.object_id || ''}`)}</td>
                      <td>${escapeHtml(`${a.old_state || '-'} -> ${a.new_state || a.status || '-'}`)}</td>
                      <td>${escapeHtml(a.notes || (a.automation_snapshot?.automation_mode || ''))}</td>
                    </tr>
                  `).join('')}
                  ${history.length === 0 ? '<tr><td colspan="5" class="text-muted">No audit events yet.</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>`;
      } catch (err) {
        tabContent.innerHTML = `<div class="empty-state" style="padding:40px"><h3 class="empty-state-title">Failed to load audit</h3><p class="empty-state-desc">${escapeHtml(err.message)}</p></div>`;
      }
    }

    // ── TAB 3: SETTINGS ──
    function renderSettingsTab(tabContent) {
      const agentScope = getAgentDataScope(agent);
      const opSettings = getAgentOperatorSettings(agent);
      tabContent.innerHTML = `
        <div style="padding:20px">
          <div class="kpi-grid" style="margin-bottom:12px">
            <div class="kpi-card">
              <div class="kpi-label">Lifecycle State</div>
              <div class="kpi-value" style="font-size:18px">${escapeHtml(opSettings.lifecycle_state || 'Watching')}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Failure Rate</div>
              <div class="kpi-value" style="font-size:18px">${Number(agent.audit_summary?.failure_rate || 0).toFixed(2)}%</div>
              <div class="kpi-meta">${agent.audit_summary?.failed_runs || 0} failed runs</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Cost (Recent)</div>
              <div class="kpi-value" style="font-size:18px">$${Number(agent.cost_summary?.total_cost_last_runs || 0).toFixed(4)}</div>
              <div class="kpi-meta">${(agent.cost_summary?.total_tokens_last_runs || 0).toLocaleString()} tokens</div>
            </div>
          </div>
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
            <div class="form-group" style="margin-top:16px">
              <label class="form-label">Data Scope</label>
              <div class="text-xs text-muted" style="margin-bottom:8px">Limit this agent to a selected repo/property set.</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                <select class="form-select scope-field" data-scope-field="github_repo" id="agent-scope-repo">
                  <option value="">Any connected repository</option>
                </select>
                <select class="form-select scope-field" data-scope-field="gsc_site" id="agent-scope-gsc">
                  <option value="">Any connected GSC property</option>
                </select>
                <select class="form-select scope-field" data-scope-field="bing_site" id="agent-scope-bing">
                  <option value="">Any connected Bing property</option>
                </select>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">
                <input type="text" class="form-input scope-field" data-scope-field="github_repo" id="agent-scope-repo-manual" placeholder="owner/repo" value="${escapeHtml(agentScope.github_repo || '')}">
                <input type="text" class="form-input scope-field" data-scope-field="gsc_site" id="agent-scope-gsc-manual" placeholder="https://example.com/ or sc-domain:example.com" value="${escapeHtml(agentScope.gsc_site || '')}">
                <input type="text" class="form-input scope-field" data-scope-field="bing_site" id="agent-scope-bing-manual" placeholder="https://example.com/" value="${escapeHtml(agentScope.bing_site || '')}">
              </div>
            </div>
            <div class="form-group" style="margin-top:16px">
              <label class="form-label">Automation Mode</label>
              <select class="form-select config-field" data-field="automation_mode" id="agent-automation-mode">
                <option value="advisory_only" ${opSettings.automation_mode === 'advisory_only' ? 'selected' : ''}>Advisory only</option>
                <option value="approval_all" ${opSettings.automation_mode === 'approval_all' ? 'selected' : ''}>Approval required for all actions</option>
                <option value="approval_publish_distribution" ${opSettings.automation_mode === 'approval_publish_distribution' ? 'selected' : ''}>Approval for publish/distribution only</option>
                <option value="semi_auto_rules" ${opSettings.automation_mode === 'semi_auto_rules' ? 'selected' : ''}>Semi-auto within rules</option>
                <option value="full_auto_rules" ${opSettings.automation_mode === 'full_auto_rules' ? 'selected' : ''}>Full auto within rules</option>
              </select>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Current Lifecycle State</label>
              <select class="form-select guardrail-field" id="agent-lifecycle-state">
                ${['Watching','Diagnosing','Planning','Executing','Measuring','Idle','Needs approval','Error'].map(s => `<option value="${escapeHtml(s)}" ${opSettings.lifecycle_state === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Approval Rules</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="guard-req-all" ${opSettings.approval_rules?.require_for_all_actions ? 'checked' : ''}> Require approval for all actions</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="guard-req-publish" ${opSettings.approval_rules?.require_for_publish ? 'checked' : ''}> Require approval for publish</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="guard-req-social" ${opSettings.approval_rules?.require_for_distribution ? 'checked' : ''}> Require approval for social distribution</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="guard-block-money" ${opSettings.approval_rules?.block_money_pages_without_approval ? 'checked' : ''}> Block money pages without approval</label>
              </div>
              <div style="margin-top:8px">
                <label class="form-label">Max executions per day</label>
                <input class="form-input guardrail-field" id="guard-max-exec" type="number" min="1" value="${Number(opSettings.approval_rules?.max_executions_per_day || 8)}">
              </div>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Execution Permissions</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-draft" ${opSettings.execution_permissions?.draft_content ? 'checked' : ''}> Draft content</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-patch" ${opSettings.execution_permissions?.patch_existing_pages ? 'checked' : ''}> Patch existing pages</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-new-page" ${opSettings.execution_permissions?.create_new_pages ? 'checked' : ''}> Create new pages</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-schema" ${opSettings.execution_permissions?.apply_schema_only ? 'checked' : ''}> Apply schema</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-publish" ${opSettings.execution_permissions?.publish_content ? 'checked' : ''}> Publish content</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-social" ${opSettings.execution_permissions?.distribute_social ? 'checked' : ''}> Distribute social</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-index" ${opSettings.execution_permissions?.submit_indexing ? 'checked' : ''}> Submit indexing</label>
                <label class="checkbox-item"><input class="guardrail-field" type="checkbox" id="perm-markdown" ${opSettings.execution_permissions?.update_markdown_layers ? 'checked' : ''}> Update markdown/croutons</label>
              </div>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Allowed Targets</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <input class="form-input guardrail-field" id="allowed-sections" placeholder="Allowed site sections (comma separated)" value="${escapeHtml((opSettings.allowed_targets?.site_sections || []).join(', '))}">
                <input class="form-input guardrail-field" id="allowed-channels" placeholder="Allowed distribution channels (comma separated)" value="${escapeHtml((opSettings.allowed_targets?.distribution_channels || []).join(', '))}">
              </div>
            </div>
          </div>

          <div class="card mb-6" style="margin-top:12px">
            <div class="card-header"><h3 class="card-title">Operator Actions</h3></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="manual_scan">Run Manual Scan</button>
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="update_guardrails">Tighten Guardrails</button>
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="change_automation_mode">Set Automation Mode</button>
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="reassign_scope">Reassign Scope</button>
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="pause">Pause Operator</button>
              <button class="btn btn-secondary btn-sm operator-action-btn" data-action="resume">Resume Operator</button>
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

      (async () => {
        try {
          const options = await loadScopeOptions();
          const repoSel = document.getElementById('agent-scope-repo');
          const gscSel = document.getElementById('agent-scope-gsc');
          const bingSel = document.getElementById('agent-scope-bing');
          if (!repoSel || !gscSel || !bingSel) return;

          const repoOptions = options.github_repos || [];
          const gscOptions = options.gsc_sites || [];
          const bingOptions = options.bing_sites || [];

          repoSel.innerHTML = `<option value="">Any connected repository</option>${repoOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
          gscSel.innerHTML = `<option value="">Any connected GSC property</option>${gscOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
          bingSel.innerHTML = `<option value="">Any connected Bing property</option>${bingOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;

          repoSel.value = agentScope.github_repo || '';
          gscSel.value = agentScope.gsc_site || '';
          bingSel.value = agentScope.bing_site || '';
          const repoManual = document.getElementById('agent-scope-repo-manual');
          const gscManual = document.getElementById('agent-scope-gsc-manual');
          const bingManual = document.getElementById('agent-scope-bing-manual');
          if (repoManual) repoManual.value = agentScope.github_repo || '';
          if (gscManual) gscManual.value = agentScope.gsc_site || '';
          if (bingManual) bingManual.value = agentScope.bing_site || '';
        } catch (err) {
          // keep empty defaults if options fetch fails
        }
      })();

      tabContent.querySelectorAll('.scope-field').forEach(field => {
        field.addEventListener('change', () => {
          if (saveBtn) saveBtn.style.display = 'inline-flex';
        });
      });
      tabContent.querySelectorAll('.guardrail-field').forEach(field => {
        field.addEventListener('change', () => {
          if (saveBtn) saveBtn.style.display = 'inline-flex';
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
        const data_scope = {
          github_repo: (document.getElementById('agent-scope-repo')?.value || '').trim() || (document.getElementById('agent-scope-repo-manual')?.value || '').trim(),
          gsc_site: (document.getElementById('agent-scope-gsc')?.value || '').trim() || (document.getElementById('agent-scope-gsc-manual')?.value || '').trim(),
          bing_site: (document.getElementById('agent-scope-bing')?.value || '').trim() || (document.getElementById('agent-scope-bing-manual')?.value || '').trim(),
        };
        updateData.data_scope = data_scope;
        updateData.automation_mode = document.getElementById('agent-automation-mode')?.value || opSettings.automation_mode;
        updateData.approval_rules = {
          require_for_all_actions: !!document.getElementById('guard-req-all')?.checked,
          require_for_publish: !!document.getElementById('guard-req-publish')?.checked,
          require_for_distribution: !!document.getElementById('guard-req-social')?.checked,
          block_money_pages_without_approval: !!document.getElementById('guard-block-money')?.checked,
          max_executions_per_day: Number(document.getElementById('guard-max-exec')?.value || 8),
        };
        updateData.execution_permissions = {
          draft_content: !!document.getElementById('perm-draft')?.checked,
          patch_existing_pages: !!document.getElementById('perm-patch')?.checked,
          create_new_pages: !!document.getElementById('perm-new-page')?.checked,
          apply_schema_only: !!document.getElementById('perm-schema')?.checked,
          publish_content: !!document.getElementById('perm-publish')?.checked,
          distribute_social: !!document.getElementById('perm-social')?.checked,
          submit_indexing: !!document.getElementById('perm-index')?.checked,
          update_markdown_layers: !!document.getElementById('perm-markdown')?.checked,
        };
        updateData.allowed_targets = {
          site_sections: (document.getElementById('allowed-sections')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
          distribution_channels: (document.getElementById('allowed-channels')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
          competitor_domains: opSettings.allowed_targets?.competitor_domains || [],
        };
        updateData.lifecycle_state = document.getElementById('agent-lifecycle-state')?.value || opSettings.lifecycle_state || 'Watching';
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

      tabContent.querySelectorAll('.operator-action-btn').forEach(btn => btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const payload = { agent_name: agent.name };
        if (action === 'change_automation_mode') {
          const mode = prompt('Automation mode:', document.getElementById('agent-automation-mode')?.value || opSettings.automation_mode || 'approval_publish_distribution');
          if (!mode) return;
          payload.automation_mode = mode;
        }
        if (action === 'reassign_scope') {
          const scopeMode = prompt('Scope mode (site/agent):', 'site');
          if (!scopeMode) return;
          payload.scope_mode = scopeMode;
        }
        if (action === 'update_guardrails') {
          payload.approval_rules = {
            require_for_all_actions: !!document.getElementById('guard-req-all')?.checked,
            require_for_publish: !!document.getElementById('guard-req-publish')?.checked,
            require_for_distribution: !!document.getElementById('guard-req-social')?.checked,
            block_money_pages_without_approval: !!document.getElementById('guard-block-money')?.checked,
            max_executions_per_day: Number(document.getElementById('guard-max-exec')?.value || 8),
          };
          payload.execution_permissions = {
            draft_content: !!document.getElementById('perm-draft')?.checked,
            patch_existing_pages: !!document.getElementById('perm-patch')?.checked,
            create_new_pages: !!document.getElementById('perm-new-page')?.checked,
            apply_schema_only: !!document.getElementById('perm-schema')?.checked,
            publish_content: !!document.getElementById('perm-publish')?.checked,
            distribute_social: !!document.getElementById('perm-social')?.checked,
            submit_indexing: !!document.getElementById('perm-index')?.checked,
            update_markdown_layers: !!document.getElementById('perm-markdown')?.checked,
          };
        }
        try {
          await mutateIntelObject('agent', agentId, action, payload);
          toast(`Operator action complete: ${action.replace(/_/g, ' ')}`, 'success');
          renderAgentDetail(container, agentId);
        } catch (err) {
          toast(err.message || 'Operator action failed', 'error');
        }
      }));

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

    const steps = ['Template', 'Role', 'Intelligence Inputs', 'Data Sources', 'Models/Tools', 'Automation', 'Guardrails', 'Review'];

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Create Search Operator</h1>
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
          ${wizardStep === steps.length - 1 ? 'Deploy Operator' : 'Continue'} <i data-lucide="arrow-right" style="width:14px;height:14px"></i>
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
      <h2 class="wizard-step-title">Choose Operator Template</h2>
      <div class="grid-3">
        ${wizardTemplates.map(t => `
          <div class="template-card ${wizardData.template_id === t.id ? 'selected' : ''}" data-id="${t.id}">
            <div class="template-card-icon"><i data-lucide="${t.icon}" style="width:24px;height:24px"></i></div>
            <div class="template-card-name">${escapeHtml(t.name)}</div>
            <div class="template-card-desc">${escapeHtml(t.description)}</div>
            <div class="template-card-tags">
              ${t.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>`;

    lucide.createIcons();

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
      <h2 class="wizard-step-title">Define Operator Role & Objective</h2>
      <div class="card" style="max-width:600px">
        <div class="form-group">
          <label class="form-label">Operator Name</label>
          <input type="text" class="form-input" id="wizard-name" placeholder="e.g., Citation Hunter - Domains" value="${escapeHtml(wizardData.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Objective</label>
          <textarea class="form-textarea" id="wizard-desc" placeholder="Describe what this operator watches, what actions it can take, and what success looks like...">${escapeHtml(wizardData.description)}</textarea>
        </div>
      </div>`;
  }

  function renderWizardGoals(el) {
    const defaultGoals = wizardData.templateObj?.default_goals || [];
    el.innerHTML = `
      <h2 class="wizard-step-title">Choose Intelligence Inputs</h2>
      <div class="card" style="max-width:600px">
        <p class="text-sm text-muted mb-4">Select priority keyword clusters, entities, and topic goals your operator should reason over:</p>
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
            <label class="form-label">Add Custom Input Goal</label>
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
    const wizardServices = [
      { id: 'google_search_console', name: 'Google Search Console', icon: '<i data-lucide="search" style="width:20px;height:20px;color:#4285f4"></i>', auth: 'oauth' },
      { id: 'google_analytics', name: 'Google Analytics', icon: '<i data-lucide="bar-chart-3" style="width:20px;height:20px;color:#e37400"></i>', auth: 'oauth' },
      { id: 'bing_webmaster', name: 'Bing Webmaster Tools', icon: '<i data-lucide="globe" style="width:20px;height:20px;color:#00809d"></i>', auth: 'oauth' },
      { id: 'github', name: 'GitHub', icon: '<i data-lucide="github" style="width:20px;height:20px;color:#24292f"></i>', auth: 'oauth' },
      { id: 'twitter', name: 'X (Twitter)', icon: '<i data-lucide="at-sign" style="width:20px;height:20px;color:#1d9bf0"></i>', auth: 'oauth' },
      { id: 'tiktok', name: 'TikTok', icon: '<i data-lucide="music" style="width:20px;height:20px;color:#25f4ee"></i>', auth: 'oauth' },
      { id: 'google_gemini', name: 'Google Gemini', icon: '<i data-lucide="sparkles" style="width:20px;height:20px;color:#4285f4"></i>', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'Your Gemini API key'}] },
    ];

    el.innerHTML = `
      <h2 class="wizard-step-title">Connect Data Sources</h2>
      <p class="text-sm text-muted mb-4">Connect observe/execute surfaces this operator should use. OAuth services open your existing OAuth flow.</p>
      <div class="grid-2" id="wizard-connect-grid" style="margin-bottom:16px"></div>
      <div class="card" style="max-width:760px;margin-bottom:16px">
        <div class="form-group">
          <label class="form-label">Scoped GitHub Repository</label>
          <select class="form-select" id="wizard-scope-repo">
            <option value="">Any connected repository</option>
          </select>
          <div class="text-xs text-muted" style="margin-top:6px">Agent code edits and PRs will default to this repo.</div>
          <input type="text" class="form-input" id="wizard-scope-repo-manual" placeholder="Or enter manually (owner/repo)" style="margin-top:8px" value="${escapeHtml(wizardData.data_scope?.github_repo || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Scoped Google Search Console Property</label>
          <select class="form-select" id="wizard-scope-gsc">
            <option value="">Any connected GSC property</option>
          </select>
          <input type="text" class="form-input" id="wizard-scope-gsc-manual" placeholder="Or enter manually (https://example.com/ or sc-domain:example.com)" style="margin-top:8px" value="${escapeHtml(wizardData.data_scope?.gsc_site || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Scoped Bing Webmaster Property</label>
          <select class="form-select" id="wizard-scope-bing">
            <option value="">Any connected Bing property</option>
          </select>
          <input type="text" class="form-input" id="wizard-scope-bing-manual" placeholder="Or enter manually (https://example.com/)" style="margin-top:8px" value="${escapeHtml(wizardData.data_scope?.bing_site || '')}">
        </div>
      </div>
      <div class="card" style="max-width:760px">
        <div class="text-sm text-muted" id="wizard-scope-loading">Loading selectable data sources...</div>
      </div>`;

    (async () => {
      try {
        const connections = await apiFetch('/api/connections');
        const connectedMap = {};
        (connections || []).forEach(c => { connectedMap[c.service] = c; });

        const grid = document.getElementById('wizard-connect-grid');
        if (!grid) return;
        grid.innerHTML = wizardServices.map(s => {
          const conn = connectedMap[s.id];
          const isConnected = !!conn && conn.is_active;
          return `
            <div class="connection-card ${isConnected ? 'connection-card-connected' : ''}">
              <div class="connection-icon">${s.icon}</div>
              <div class="connection-info">
                <div class="connection-name">${s.name}</div>
                <div class="connection-status">
                  <span class="connection-status-dot ${isConnected ? 'connected' : ''}"></span>
                  <span>${isConnected ? 'Connected' : 'Not connected'}</span>
                </div>
              </div>
              <button class="btn ${isConnected ? 'btn-secondary' : 'btn-primary'} btn-sm wizard-connect-btn"
                data-service="${s.id}" data-name="${s.name}" data-auth="${s.auth}" data-fields='${s.fields ? JSON.stringify(s.fields) : ""}'>
                ${isConnected ? 'Reconnect' : 'Connect'}
              </button>
            </div>
          `;
        }).join('');

        grid.querySelectorAll('.wizard-connect-btn').forEach(btn => {
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

        lucide.createIcons({ nodes: [grid] });
      } catch (err) {
        // non-blocking
      }
    })();

    (async () => {
      try {
        const options = await loadScopeOptions();
        const repoSel = document.getElementById('wizard-scope-repo');
        const gscSel = document.getElementById('wizard-scope-gsc');
        const bingSel = document.getElementById('wizard-scope-bing');
        const repoManual = document.getElementById('wizard-scope-repo-manual');
        const gscManual = document.getElementById('wizard-scope-gsc-manual');
        const bingManual = document.getElementById('wizard-scope-bing-manual');
        const loadingEl = document.getElementById('wizard-scope-loading');
        if (!repoSel || !gscSel || !bingSel) return;

        const repoOptions = options.github_repos || [];
        const gscOptions = options.gsc_sites || [];
        const bingOptions = options.bing_sites || [];
        const diagnostics = options.diagnostics || {};

        repoSel.innerHTML = `<option value="">Any connected repository</option>${repoOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
        gscSel.innerHTML = `<option value="">Any connected GSC property</option>${gscOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
        bingSel.innerHTML = `<option value="">Any connected Bing property</option>${bingOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;

        repoSel.value = wizardData.data_scope?.github_repo || '';
        gscSel.value = wizardData.data_scope?.gsc_site || '';
        bingSel.value = wizardData.data_scope?.bing_site || '';
        if (repoManual) repoManual.value = wizardData.data_scope?.github_repo || '';
        if (gscManual) gscManual.value = wizardData.data_scope?.gsc_site || '';
        if (bingManual) bingManual.value = wizardData.data_scope?.bing_site || '';

        if (loadingEl) {
          const ghDiag = diagnostics.github?.detail || 'No diagnostics';
          const gscDiag = diagnostics.google_search_console?.detail || 'No diagnostics';
          const bingDiag = diagnostics.bing_webmaster?.detail || 'No diagnostics';
          loadingEl.innerHTML = `
            <div class="text-sm">
              <strong>Available sources:</strong>
              ${repoOptions.length} repos · ${gscOptions.length} GSC properties · ${bingOptions.length} Bing properties
            </div>
            <div class="text-xs text-muted" style="margin-top:6px">
              GitHub: ${escapeHtml(ghDiag)}<br>
              GSC: ${escapeHtml(gscDiag)}<br>
              Bing: ${escapeHtml(bingDiag)}
            </div>
          `;
        }
      } catch (err) {
        const loadingEl = document.getElementById('wizard-scope-loading');
        if (loadingEl) loadingEl.textContent = `Could not load source options: ${err.message}`;
      }
    })();
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
      <h2 class="wizard-step-title">Choose Models & Tools</h2>
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
    const modes = [
      { value: 'advisory_only', label: 'Advisory only', desc: 'Detects and recommends, no execution' },
      { value: 'approval_all', label: 'Approval required for all actions', desc: 'Creates plans but requires manual approval each step' },
      { value: 'approval_publish_distribution', label: 'Approval for publish/distribution only', desc: 'Allows safe prep, gates external impact actions' },
      { value: 'semi_auto_rules', label: 'Semi-auto within rules', desc: 'Executes low-risk actions under guardrails' },
      { value: 'full_auto_rules', label: 'Full auto within rules', desc: 'Autonomous execution constrained by your limits' },
    ];
    const presets = [
      { id: 'safe', label: 'Safe Advisory', mode: 'advisory_only', publish: false, social: false, schema: false },
      { id: 'editorial', label: 'Editorial Copilot', mode: 'approval_publish_distribution', publish: false, social: false, schema: true },
      { id: 'schema', label: 'Schema Auto-Pilot', mode: 'semi_auto_rules', publish: false, social: false, schema: true },
      { id: 'publisher', label: 'Controlled Publisher', mode: 'approval_publish_distribution', publish: true, social: false, schema: true },
      { id: 'full', label: 'Full Search Operator', mode: 'full_auto_rules', publish: true, social: true, schema: true },
    ];

    el.innerHTML = `
      <h2 class="wizard-step-title">Set Automation Mode</h2>
      <div class="card" style="max-width:600px">
        <div class="radio-group">
          ${modes.map(s => `
            <label class="radio-item ${wizardData.automation_mode === s.value ? 'selected' : ''}">
              <input type="radio" name="automation_mode" value="${s.value}" ${wizardData.automation_mode === s.value ? 'checked' : ''}>
              <div>
                <div class="radio-label">${s.label}</div>
                <div class="radio-desc">${s.desc}</div>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="form-group" style="margin-top:14px">
          <label class="form-label">Quick Guardrail Presets</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${presets.map(p => `<button type="button" class="btn btn-secondary btn-sm guardrail-preset" data-id="${p.id}">${p.label}</button>`).join('')}
          </div>
        </div>
      </div>`;

    el.querySelectorAll('input[name="automation_mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        wizardData.automation_mode = radio.value;
        el.querySelectorAll('.radio-item').forEach(ri => ri.classList.remove('selected'));
        radio.closest('.radio-item').classList.add('selected');
      });
    });
    el.querySelectorAll('.guardrail-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = presets.find(x => x.id === btn.dataset.id);
        if (!p) return;
        wizardData.automation_mode = p.mode;
        wizardData.execution_permissions.apply_schema_only = p.schema;
        wizardData.execution_permissions.publish_content = p.publish;
        wizardData.execution_permissions.distribute_social = p.social;
        renderWizardSchedule(el);
      });
    });
  }

  function renderWizardRules(el) {
    el.innerHTML = `
      <h2 class="wizard-step-title">Automation Guardrails</h2>
      <div class="card" style="max-width:600px">
        <p class="text-sm text-muted mb-4">Define approvals, permissions, and publishing boundaries.</p>
        <div class="form-group">
          <label class="form-label">What this operator may do without approval</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-draft" ${wizardData.execution_permissions.draft_content ? 'checked' : ''}> Draft content</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-patch" ${wizardData.execution_permissions.patch_existing_pages ? 'checked' : ''}> Patch existing pages</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-new" ${wizardData.execution_permissions.create_new_pages ? 'checked' : ''}> Create new pages</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-schema" ${wizardData.execution_permissions.apply_schema_only ? 'checked' : ''}> Apply schema</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-publish" ${wizardData.execution_permissions.publish_content ? 'checked' : ''}> Publish content</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-social" ${wizardData.execution_permissions.distribute_social ? 'checked' : ''}> Distribute social</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-index" ${wizardData.execution_permissions.submit_indexing ? 'checked' : ''}> Submit indexing</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-perm-markdown" ${wizardData.execution_permissions.update_markdown_layers ? 'checked' : ''}> Update markdown/croutons</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">What always requires approval</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="checkbox-item"><input type="checkbox" id="wiz-approve-all" ${wizardData.approval_rules.require_for_all_actions ? 'checked' : ''}> All actions</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-approve-publish" ${wizardData.approval_rules.require_for_publish ? 'checked' : ''}> Publishing</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-approve-social" ${wizardData.approval_rules.require_for_distribution ? 'checked' : ''}> Social distribution</label>
            <label class="checkbox-item"><input type="checkbox" id="wiz-block-money" ${wizardData.approval_rules.block_money_pages_without_approval ? 'checked' : ''}> Money pages</label>
          </div>
          <div style="margin-top:8px">
            <label class="form-label">Max executions per day</label>
            <input type="number" class="form-input" id="wiz-max-exec" min="1" value="${Number(wizardData.approval_rules.max_executions_per_day || 8)}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Where it is allowed to publish</label>
          <input type="text" class="form-input" id="wiz-allowed-sections" placeholder="blog, docs, /guides" value="${escapeHtml((wizardData.allowed_targets.site_sections || []).join(', '))}">
        </div>
        <div class="form-group">
          <label class="form-label">Allowed distribution surfaces</label>
          <input type="text" class="form-input" id="wiz-allowed-channels" placeholder="twitter, tiktok" value="${escapeHtml((wizardData.allowed_targets.distribution_channels || []).join(', '))}">
        </div>
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--color-border)">
        <p class="text-sm text-muted mb-4">Optional text rules and thresholds:</p>
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
      <h2 class="wizard-step-title">Review & Deploy Operator</h2>
      <div class="card" style="max-width:600px">
        <div style="display:grid;gap:16px">
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Template</div>
            <div class="font-semibold">${template.icon ? `<i data-lucide="${template.icon}" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>` : '<i data-lucide="settings" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>'} ${escapeHtml(template.name || wizardData.template_id || 'Custom')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Name</div>
            <div class="font-semibold">${escapeHtml(wizardData.name || 'Unnamed Operator')}</div>
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
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Automation Mode</div>
            <div class="text-sm font-medium">${escapeHtml(wizardData.automation_mode || 'approval_publish_distribution')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Data Scope</div>
            <div class="text-sm">
              <div>Repo: <strong>${escapeHtml(wizardData.data_scope?.github_repo || 'Any connected')}</strong></div>
              <div>GSC: <strong>${escapeHtml(wizardData.data_scope?.gsc_site || 'Any connected')}</strong></div>
              <div>Bing: <strong>${escapeHtml(wizardData.data_scope?.bing_site || 'Any connected')}</strong></div>
            </div>
          </div>
          ${wizardData.rules.length > 0 ? `
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Rules</div>
            <div>${wizardData.rules.filter(r => r).map(r => `<div class="text-sm">• ${escapeHtml(r)}</div>`).join('')}</div>
          </div>` : ''}
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Guardrails</div>
            <div class="text-sm">Publish requires approval: <strong>${wizardData.approval_rules?.require_for_publish ? 'Yes' : 'No'}</strong></div>
            <div class="text-sm">Distribution requires approval: <strong>${wizardData.approval_rules?.require_for_distribution ? 'Yes' : 'No'}</strong></div>
            <div class="text-sm">Max executions/day: <strong>${Number(wizardData.approval_rules?.max_executions_per_day || 8)}</strong></div>
            <div class="text-sm">Permissions: <strong>${Object.entries(wizardData.execution_permissions || {}).filter(([,v]) => !!v).map(([k]) => k).join(', ') || 'none'}</strong></div>
          </div>
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
        const repoSelected = document.getElementById('wizard-scope-repo')?.value?.trim() || '';
        const gscSelected = document.getElementById('wizard-scope-gsc')?.value?.trim() || '';
        const bingSelected = document.getElementById('wizard-scope-bing')?.value?.trim() || '';
        const repoManual = document.getElementById('wizard-scope-repo-manual')?.value?.trim() || '';
        const gscManual = document.getElementById('wizard-scope-gsc-manual')?.value?.trim() || '';
        const bingManual = document.getElementById('wizard-scope-bing-manual')?.value?.trim() || '';
        wizardData.data_scope = {
          github_repo: repoSelected || repoManual,
          gsc_site: gscSelected || gscManual,
          bing_site: bingSelected || bingManual,
        };
        break;
      case 4:
        wizardData.model = document.getElementById('wizard-model')?.value || 'gpt-4o-mini';
        wizardData.temperature = parseFloat(document.getElementById('wizard-temp')?.value) || 0.7;
        wizardData.max_tokens = parseInt(document.getElementById('wizard-tokens')?.value) || 1024;
        break;
      case 5:
        wizardData.automation_mode = document.querySelector('input[name="automation_mode"]:checked')?.value || wizardData.automation_mode || 'approval_publish_distribution';
        break;
      case 6:
        wizardData.execution_permissions = {
          draft_content: !!document.getElementById('wiz-perm-draft')?.checked,
          patch_existing_pages: !!document.getElementById('wiz-perm-patch')?.checked,
          create_new_pages: !!document.getElementById('wiz-perm-new')?.checked,
          apply_schema_only: !!document.getElementById('wiz-perm-schema')?.checked,
          publish_content: !!document.getElementById('wiz-perm-publish')?.checked,
          distribute_social: !!document.getElementById('wiz-perm-social')?.checked,
          submit_indexing: !!document.getElementById('wiz-perm-index')?.checked,
          update_markdown_layers: !!document.getElementById('wiz-perm-markdown')?.checked,
        };
        wizardData.approval_rules = {
          require_for_all_actions: !!document.getElementById('wiz-approve-all')?.checked,
          require_for_publish: !!document.getElementById('wiz-approve-publish')?.checked,
          require_for_distribution: !!document.getElementById('wiz-approve-social')?.checked,
          block_money_pages_without_approval: !!document.getElementById('wiz-block-money')?.checked,
          max_executions_per_day: Number(document.getElementById('wiz-max-exec')?.value || 8),
        };
        wizardData.allowed_targets = {
          site_sections: (document.getElementById('wiz-allowed-sections')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
          distribution_channels: (document.getElementById('wiz-allowed-channels')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
          competitor_domains: [],
        };
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
              data_scope: wizardData.data_scope,
              automation_mode: wizardData.automation_mode,
              approval_rules: wizardData.approval_rules,
              execution_permissions: wizardData.execution_permissions,
              allowed_targets: wizardData.allowed_targets,
              lifecycle_state: wizardData.lifecycle_state,
              success_metrics: wizardData.success_metrics,
            }),
          });
          // Success animation
          container.innerHTML = `
            <div class="success-anim">
              <div class="success-check"><i data-lucide="check" style="width:32px;height:32px"></i></div>
              <h2 class="success-title">Operator Deployed!</h2>
              <p class="success-desc">"${escapeHtml(wizardData.name)}" is now active and running your search operations loop.</p>
              <div style="display:flex;gap:8px">
                <a href="#/agents" class="btn btn-primary">View Operators</a>
                <button class="btn btn-secondary" onclick="window.NC.resetWizard()">Create Another</button>
              </div>
            </div>`;
          lucide.createIcons();
          toast('Operator deployed successfully!', 'success');
          // Reset wizard state
          wizardStep = 0;
          wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [], data_scope: { github_repo: '', gsc_site: '', bing_site: '' }, automation_mode: 'approval_publish_distribution', approval_rules: { require_for_all_actions: false, require_for_publish: true, require_for_distribution: true, block_money_pages_without_approval: true, max_executions_per_day: 8 }, execution_permissions: { draft_content: true, patch_existing_pages: true, create_new_pages: false, apply_schema_only: true, publish_content: false, distribute_social: false, submit_indexing: true, update_markdown_layers: true }, allowed_targets: { site_sections: [], distribution_channels: [], competitor_domains: [] }, lifecycle_state: 'Watching', success_metrics: [] };
          return;
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = 'Deploy Operator <i data-lucide="arrow-right" style="width:14px;height:14px"></i>';
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
          <h1 class="page-title">Search Operator Templates</h1>
          <p class="page-subtitle">Purpose-built operators for SEO, AEO, GEO, citation growth, and execution workflows</p>
        </div>
        <div class="grid-3">
          ${templates.map(t => `
            <div class="template-card" data-id="${t.id}">
              <div class="template-card-icon"><i data-lucide="${t.icon}" style="width:24px;height:24px"></i></div>
              <div class="template-card-name">${escapeHtml(t.name)}</div>
              <div class="template-card-desc">${escapeHtml(t.description)}</div>
              <div class="template-card-tags" style="margin-bottom:12px">
                ${t.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
              </div>
              <button class="btn btn-primary btn-sm use-template-btn" data-id="${t.id}">Use Operator</button>
            </div>
          `).join('')}
        </div>`;

      lucide.createIcons();

      document.querySelectorAll('.use-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          wizardStep = 0;
          wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [], data_scope: { github_repo: '', gsc_site: '', bing_site: '' }, automation_mode: 'approval_publish_distribution', approval_rules: { require_for_all_actions: false, require_for_publish: true, require_for_distribution: true, block_money_pages_without_approval: true, max_executions_per_day: 8 }, execution_permissions: { draft_content: true, patch_existing_pages: true, create_new_pages: false, apply_schema_only: true, publish_content: false, distribute_social: false, submit_indexing: true, update_markdown_layers: true }, allowed_targets: { site_sections: [], distribution_channels: [], competitor_domains: [] }, lifecycle_state: 'Watching', success_metrics: [] };
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
        label: 'Observe Layer',
        description: 'Connections that power Observe, Diagnose, and Measure stages',
        services: [
          { id: 'google_search_console', name: 'Google Search Console', icon: '<i data-lucide="search" style="width:20px;height:20px;color:#4285f4"></i>', desc: 'Search performance, keywords, indexing status', auth: 'oauth' },
          { id: 'google_analytics', name: 'Google Analytics', icon: '<i data-lucide="bar-chart-3" style="width:20px;height:20px;color:#e37400"></i>', desc: 'Traffic, user behavior, conversions', auth: 'oauth' },
          { id: 'bing_webmaster', name: 'Bing Webmaster Tools', icon: '<i data-lucide="globe" style="width:20px;height:20px;color:#00809d"></i>', desc: 'Bing search data, crawl stats, SEO issues', auth: 'oauth' },
          { id: 'microsoft_clarity', name: 'Microsoft Clarity', icon: '<i data-lucide="flame" style="width:20px;height:20px;color:#ff6f00"></i>', desc: 'Heatmaps, session recordings, user insights', auth: 'oauth' },
          { id: 'cloudflare', name: 'Cloudflare', icon: '<i data-lucide="cloud" style="width:20px;height:20px;color:#f38020"></i>', desc: 'DNS, caching, analytics, security', auth: 'apikey', fields: [{key: 'api_token', label: 'API Token', placeholder: 'Your Cloudflare API token'}] },
        ]
      },
      {
        label: 'Reasoning / Generation Layer',
        description: 'Connections that power Plan and content generation',
        services: [
          { id: 'openai', name: 'OpenAI', icon: '<i data-lucide="brain" style="width:20px;height:20px;color:#10a37f"></i>', desc: 'GPT-4o, GPT-4o-mini for text generation', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'sk-...'}], badge: 'Platform Default' },
          { id: 'google_gemini', name: 'Google Gemini', icon: '<i data-lucide="sparkles" style="width:20px;height:20px;color:#4285f4"></i>', desc: 'Gemini Pro, Gemini Flash models', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'Your Gemini API key'}] },
          { id: 'nano_banana', name: 'Nano Banana', icon: '<i data-lucide="image" style="width:20px;height:20px;color:#f5c842"></i>', desc: 'Image generation and creative AI', auth: 'apikey', fields: [{key: 'api_key', label: 'API Key', placeholder: 'Your Nano Banana API key'}] },
        ]
      },
      {
        label: 'Execution Layer',
        description: 'Connections that publish patches, content, and distribution actions',
        services: [
          { id: 'github', name: 'GitHub', icon: '<i data-lucide="github" style="width:20px;height:20px;color:#24292f"></i>', desc: 'Push code, manage repos, deploy changes', auth: 'oauth' },
        ]
      },
      {
        label: 'Distribution Surfaces',
        description: 'Execution surfaces for social and support-content distribution',
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
          <p class="page-subtitle">Power the Search Ops lifecycle: Observe, Plan, Execute, and Measure</p>
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
            if (main) {
              if ((window.location.hash || '').startsWith('#/wizard')) renderWizard(main);
              else renderConnections(main);
            }
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
                if (main) {
                  if ((window.location.hash || '').startsWith('#/wizard')) renderWizard(main);
                  else renderConnections(main);
                }
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
              if (main) {
                if ((window.location.hash || '').startsWith('#/wizard')) renderWizard(main);
                else renderConnections(main);
              }
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
    inspectIntelObject: (kind, id) => showIntelInspect(kind, id),
    resetWizard: () => {
      wizardStep = 0;
      wizardData = { template_id: null, templateObj: null, name: '', description: '', goals: [], connections: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [], data_scope: { github_repo: '', gsc_site: '', bing_site: '' }, automation_mode: 'approval_publish_distribution', approval_rules: { require_for_all_actions: false, require_for_publish: true, require_for_distribution: true, block_money_pages_without_approval: true, max_executions_per_day: 8 }, execution_permissions: { draft_content: true, patch_existing_pages: true, create_new_pages: false, apply_schema_only: true, publish_content: false, distribute_social: false, submit_indexing: true, update_markdown_layers: true }, allowed_targets: { site_sections: [], distribution_channels: [], competitor_domains: [] }, lifecycle_state: 'Watching', success_metrics: [] };
      navigate('#/wizard');
    },
  };

  // ── BOOT ───────────────────────────────────
  init();

})();
