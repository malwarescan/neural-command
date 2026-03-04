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
  const LOGO_SVG = `<img src="/static/croutons-icon.jpg" alt="Croutons" style="width:100%;height:100%;object-fit:contain;">`;

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
    if (route === '#/agents') pageTitle = 'My Agents';
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

      const templateIcons = { seo: '🔍', social: '📱', sales: '💼', support: '🎧', content: '✍️', analytics: '📊', custom: '⚙️' };

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
                  <div class="agent-card-icon">${templateIcons[agent.template_id] || '⚙️'}</div>
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
      btn.addEventListener('click', () => showRunModal(btn.dataset.id, btn.dataset.name));
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

  // ── RUN AGENT MODAL ────────────────────────
  function showRunModal(agentId, agentName) {
    const overlay = el('div', { className: 'modal-overlay', id: 'run-modal' });
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Run "${escapeHtml(agentName)}"</h3>
          <button class="btn btn-ghost btn-icon" id="close-run-modal"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Message to Agent</label>
            <textarea class="form-textarea" id="run-message" rows="4" placeholder="Enter your request or question for the agent..."></textarea>
          </div>
          <div id="run-result" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-run">Cancel</button>
          <button class="btn btn-primary" id="execute-run"><i data-lucide="play" style="width:14px;height:14px"></i> Run Agent</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });

    overlay.querySelector('#close-run-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cancel-run').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#execute-run').addEventListener('click', async () => {
      const message = document.getElementById('run-message').value.trim();
      if (!message) { toast('Please enter a message', 'error'); return; }
      const btn = overlay.querySelector('#execute-run');
      btn.disabled = true;
      btn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:2px"></div> Running...';
      const resultDiv = document.getElementById('run-result');
      resultDiv.style.display = 'none';

      try {
        const result = await apiFetch(`/api/agents/${agentId}/run`, {
          method: 'POST',
          body: JSON.stringify({ input_data: { message } }),
        });
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
          <div class="card" style="background:var(--color-surface-2);margin-top:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span class="badge badge-completed">Completed</span>
              <span class="text-xs text-muted">${result.usage?.total_tokens || 0} tokens · $${(result.usage?.cost_usd || 0).toFixed(6)} · ${result.duration_ms || 0}ms</span>
            </div>
            <div style="font-size:13px;line-height:1.6;color:var(--color-text);white-space:pre-wrap">${escapeHtml(result.output?.response || 'No response')}</div>
          </div>`;
        btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Done';
        btn.disabled = false;
        toast('Agent run completed', 'success');
        lucide.createIcons({ nodes: [resultDiv, btn] });
      } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<div class="auth-error" style="margin-top:12px">${escapeHtml(err.message)}</div>`;
        btn.innerHTML = '<i data-lucide="play" style="width:14px;height:14px"></i> Retry';
        btn.disabled = false;
        lucide.createIcons({ nodes: [btn] });
        toast(err.message, 'error');
      }
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

  // ── AGENT DETAIL VIEW ──────────────────────
  async function renderAgentDetail(container, agentId) {
    container.innerHTML = `<div class="loading-center"><div class="loading-spinner"></div></div>`;
    try {
      const agent = await apiFetch(`/api/agents/${agentId}`);
      const runs = await apiFetch(`/api/agents/${agentId}/runs`);
      const templateIcons = { seo: '🔍', social: '📱', sales: '💼', support: '🎧', content: '✍️', analytics: '📊', custom: '⚙️' };

      container.innerHTML = `
        <div class="page-header flex justify-between items-center">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <a href="#/agents" class="btn btn-ghost btn-sm"><i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back</a>
            </div>
            <h1 class="page-title">${templateIcons[agent.template_id] || '⚙️'} ${escapeHtml(agent.name)}</h1>
            <p class="page-subtitle">${escapeHtml(agent.description || 'No description')}</p>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary" id="detail-run-btn"><i data-lucide="play" style="width:14px;height:14px"></i> Run Agent</button>
          </div>
        </div>

        <!-- Agent Info -->
        <div class="kpi-grid" style="margin-bottom:24px">
          <div class="kpi-card">
            <div class="kpi-label">Status</div>
            <div style="margin-top:8px"><span class="badge badge-${agent.status}" style="font-size:13px;padding:4px 14px">${agent.status}</span></div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Model</div>
            <div class="kpi-value" style="font-size:16px">${agent.model || 'gpt-4o-mini'}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total Runs</div>
            <div class="kpi-value">${agent.total_runs || 0}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Tokens Used</div>
            <div class="kpi-value">${(agent.total_tokens_used || 0).toLocaleString()}</div>
          </div>
        </div>

        <!-- Config Card -->
        <div class="card mb-6">
          <div class="card-header">
            <h3 class="card-title">Configuration</h3>
            <button class="btn btn-ghost btn-sm" id="save-agent-config" style="display:none"><i data-lucide="save" style="width:14px;height:14px"></i> Save</button>
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
              ${(agent.goals && agent.goals.length > 0) ? agent.goals.map(g => `<span class="tag" style="margin:2px">${escapeHtml(g)}</span>`).join('') : '<span class="text-muted">No goals set</span>'}
            </div>
          </div>
        </div>

        <!-- Run History -->
        <div class="card mb-6">
          <div class="card-header">
            <h3 class="card-title">Run History</h3>
            <span class="text-xs text-muted">${runs.length} run${runs.length !== 1 ? 's' : ''}</span>
          </div>
          ${runs.length === 0
            ? `<p class="text-sm text-muted">No runs yet. Click "Run Agent" to execute.</p>`
            : `<table class="runs-table">
                <thead><tr><th>Time</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Output</th></tr></thead>
                <tbody>
                  ${runs.map((run, i) => `
                    <tr>
                      <td>${formatDate(run.started_at)}</td>
                      <td><span class="badge badge-${run.status}">${run.status}</span></td>
                      <td>${run.total_tokens || '—'}</td>
                      <td>$${(run.cost_usd || 0).toFixed(6)}</td>
                      <td>
                        <button class="btn btn-ghost btn-sm toggle-output-btn" data-idx="${i}">
                          <i data-lucide="chevron-down" style="width:14px;height:14px"></i>
                        </button>
                        <div class="run-output" id="output-${i}">
                          <pre>${escapeHtml(run.output_data?.response || run.error_message || 'No output')}</pre>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`
          }
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
      `;

      lucide.createIcons();

      // Bind events
      document.getElementById('detail-run-btn')?.addEventListener('click', () => showRunModal(agentId, agent.name));

      // Config changes
      const saveBtn = document.getElementById('save-agent-config');
      document.querySelectorAll('.config-field').forEach(field => {
        field.addEventListener('change', () => {
          saveBtn.style.display = 'inline-flex';
          if (field.dataset.field === 'temperature') {
            document.getElementById('temp-val').textContent = field.value;
          }
        });
        field.addEventListener('input', () => {
          if (field.dataset.field === 'temperature') {
            document.getElementById('temp-val').textContent = field.value;
          }
        });
      });

      saveBtn?.addEventListener('click', async () => {
        const updateData = {};
        document.querySelectorAll('.config-field').forEach(field => {
          const key = field.dataset.field;
          let val = field.value;
          if (key === 'temperature') val = parseFloat(val);
          updateData[key] = val;
        });
        try {
          await apiFetch(`/api/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(updateData) });
          toast('Agent updated', 'success');
          saveBtn.style.display = 'none';
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      // Toggle output
      document.querySelectorAll('.toggle-output-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const output = document.getElementById(`output-${btn.dataset.idx}`);
          output.classList.toggle('expanded');
        });
      });

      // Danger zone
      document.getElementById('detail-toggle-btn')?.addEventListener('click', async () => {
        const newStatus = agent.status === 'active' ? 'paused' : 'active';
        try {
          await apiFetch(`/api/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
          toast(`Agent ${newStatus === 'active' ? 'resumed' : 'paused'}`, 'success');
          renderAgentDetail(container, agentId);
        } catch (err) { toast(err.message, 'error'); }
      });

      document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
        showDeleteModal(agentId, agent.name);
      });

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
        `).join('')}
      </div>`;

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
      { id: 'google_search_console', name: 'Google Search Console', icon: '🔍' },
      { id: 'google_analytics', name: 'Google Analytics', icon: '📊' },
      { id: 'social_media', name: 'Social Media', icon: '📱' },
      { id: 'crm', name: 'CRM', icon: '💼' },
      { id: 'email', name: 'Email', icon: '✉️' },
      { id: 'custom_api', name: 'Custom API', icon: '🔌' },
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
        `).join('')}
      </div>`;

    el.querySelectorAll('.connect-service-btn').forEach(btn => {
      btn.addEventListener('click', () => showConnectionModal(btn.dataset.service, btn.dataset.name));
    });
  }

  function showConnectionModal(serviceId, serviceName) {
    const overlay = el('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <h3 class="modal-title">Connect ${escapeHtml(serviceName)}</h3>
          <button class="btn btn-ghost btn-icon close-modal"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">API Key or Token</label>
            <input type="text" class="form-input" id="conn-api-key" placeholder="Enter your API key">
          </div>
          <div class="form-group">
            <label class="form-label">Endpoint URL (optional)</label>
            <input type="text" class="form-input" id="conn-endpoint" placeholder="https://api.example.com">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary close-modal">Cancel</button>
          <button class="btn btn-primary" id="save-connection">Save Connection</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });

    overlay.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-connection').addEventListener('click', async () => {
      const apiKey = document.getElementById('conn-api-key').value.trim();
      if (!apiKey) { toast('Please enter an API key', 'error'); return; }
      try {
        await apiFetch('/api/connections', {
          method: 'POST',
          body: JSON.stringify({
            service: serviceId,
            credentials: {
              api_key: apiKey,
              endpoint: document.getElementById('conn-endpoint').value.trim(),
            },
          }),
        });
        toast(`${serviceName} connected`, 'success');
        overlay.remove();
      } catch (err) {
        toast(err.message, 'error');
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
            <div class="font-semibold">${template.icon || '⚙️'} ${escapeHtml(template.name || wizardData.template_id || 'Custom')}</div>
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

    const allServices = [
      { id: 'google_search_console', name: 'Google Search Console', icon: '🔍', desc: 'Monitor search performance and indexing' },
      { id: 'google_analytics', name: 'Google Analytics', icon: '📊', desc: 'Track website traffic and user behavior' },
      { id: 'social_media', name: 'Social Media', icon: '📱', desc: 'Connect social media accounts' },
      { id: 'crm', name: 'CRM', icon: '💼', desc: 'Sync with your CRM system' },
      { id: 'email', name: 'Email', icon: '✉️', desc: 'Connect email for outreach' },
      { id: 'custom_api', name: 'Custom API', icon: '🔌', desc: 'Connect any REST API' },
    ];

    try {
      const connections = await apiFetch('/api/connections');
      const connectedIds = new Set(connections.map(c => c.service));

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">Connections</h1>
          <p class="page-subtitle">Manage service integrations for your agents</p>
        </div>
        <div class="grid-2">
          ${allServices.map(s => {
            const isConnected = connectedIds.has(s.id);
            const conn = connections.find(c => c.service === s.id);
            return `
              <div class="connection-card">
                <div class="connection-icon">${s.icon}</div>
                <div class="connection-info">
                  <div class="connection-name">${s.name}</div>
                  <div class="connection-status">
                    <span class="connection-status-dot ${isConnected ? 'connected' : ''}"></span>
                    <span>${isConnected ? 'Connected' : 'Not connected'}</span>
                  </div>
                  <div class="text-xs text-muted" style="margin-top:2px">${s.desc}</div>
                </div>
                ${isConnected
                  ? `<button class="btn btn-secondary btn-sm disconnect-btn" data-service="${s.id}">Disconnect</button>`
                  : `<button class="btn btn-primary btn-sm connect-btn" data-service="${s.id}" data-name="${s.name}">Connect</button>`
                }
              </div>`;
          }).join('')}
        </div>`;

      document.querySelectorAll('.connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showConnectionModal(btn.dataset.service, btn.dataset.name);
        });
      });

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

    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3 class="empty-state-title">Failed to load connections</h3></div>`;
      toast(err.message, 'error');
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

    // 3. Listen for auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
      const hadSession = !!currentSession;
      currentSession = session;

      if (event === 'SIGNED_IN' && !hadSession) {
        cachedProfile = null;
        navigate('#/dashboard');
      } else if (event === 'SIGNED_OUT') {
        currentSession = null;
        cachedProfile = null;
        navigate('#/login');
      }
    });

    // 4. Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    currentSession = session;

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
