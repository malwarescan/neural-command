/* ═══════════════════════════════════════════════
   Croutons Agents — Production Frontend SPA
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── CONFIG (loaded once, mutated by settings panel) ──────────────────────
  const CONFIG = {
    apiBase: '',          // same-origin
    defaultModel: 'gpt-4o-mini',
    streamingEnabled: true,
    maxTokens: 2048,
    temperature: 0.7,
  };

  // ── ROUTER ────────────────────────────────────────────────────────────────
  const routes = {};
  function route(hash, fn) { routes[hash] = fn; }

  function navigate(hash) {
    window.location.hash = hash;
  }

  function dispatch() {
    const hash = window.location.hash || '#/';
    const handler = routes[hash] || routes['#/404'] || (() => renderNotFound());
    handler();
  }

  window.addEventListener('hashchange', dispatch);

  // ── DOM HELPERS ───────────────────────────────────────────────────────────
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function setHTML(node, html) { node.innerHTML = html; }

  function renderMain(contentFn) {
    const app = $('#app');
    setHTML(app, '');
    const wrapper = el('div', { class: 'page-wrapper' });
    app.appendChild(wrapper);
    contentFn(wrapper);
  }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 3500) {
    let container = $('#toast-container');
    if (!container) {
      container = el('div', { id: 'toast-container' });
      document.body.appendChild(container);
    }
    const t = el('div', { class: `toast toast-${type}` }, msg);
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, duration);
  }

  // ── API ───────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(CONFIG.apiBase + path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(err || `HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // ── STREAMING ─────────────────────────────────────────────────────────────
  async function streamChat(payload, onChunk, onDone, onError) {
    try {
      const res = await fetch(CONFIG.apiBase + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, stream: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') { onDone && onDone(); return; }
            try {
              const parsed = JSON.parse(data);
              const chunk = parsed.choices?.[0]?.delta?.content || '';
              if (chunk) onChunk(chunk);
            } catch {}
          }
        }
      }
      onDone && onDone();
    } catch (e) {
      onError && onError(e);
    }
  }

  // ── NAV ───────────────────────────────────────────────────────────────────
  function buildNav(activePage) {
    const pages = [
      { hash: '#/', label: 'Dashboard' },
      { hash: '#/agents', label: 'Agents' },
      { hash: '#/chat', label: 'Chat' },
      { hash: '#/command', label: 'Command Center' },
      { hash: '#/knowledge', label: 'Knowledge' },
      { hash: '#/ai-search', label: 'AI Search Bible' },
      { hash: '#/analytics', label: 'Analytics' },
      { hash: '#/settings', label: 'Settings' },
    ];
    const nav = el('nav', { class: 'sidebar' });
    const logo = el('div', { class: 'sidebar-logo' }, 'Croutons');
    nav.appendChild(logo);
    const ul = el('ul', { class: 'sidebar-nav' });
    for (const p of pages) {
      const li = el('li', {});
      const a = el('a', {
        href: p.hash,
        class: p.hash === activePage ? 'active' : '',
      }, p.label);
      li.appendChild(a);
      ul.appendChild(li);
    }
    nav.appendChild(ul);
    return nav;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────
  route('#/', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      const header = el('div', { class: 'page-header' });
      header.appendChild(el('h1', {}, 'Dashboard'));
      main.appendChild(header);

      const grid = el('div', { class: 'dashboard-grid' });
      main.appendChild(grid);

      // Load stats
      Promise.all([
        api('/api/agents').catch(() => []),
        api('/api/knowledge/stats').catch(() => ({ total: 0 })),
        api('/api/analytics/summary').catch(() => ({})),
      ]).then(([agents, kStats, analytics]) => {
        const cards = [
          { label: 'Active Agents', value: Array.isArray(agents) ? agents.filter(a => a.active).length : 0, icon: '🤖' },
          { label: 'Total Agents', value: Array.isArray(agents) ? agents.length : 0, icon: '📋' },
          { label: 'Knowledge Entries', value: kStats.total || 0, icon: '📚' },
          { label: 'Messages Today', value: analytics.messages_today || 0, icon: '💬' },
          { label: 'Tokens Used', value: formatNum(analytics.tokens_today || 0), icon: '🔢' },
          { label: 'Est. Cost Today', value: '$' + ((analytics.cost_today || 0).toFixed(4)), icon: '💰' },
        ];
        for (const c of cards) {
          const card = el('div', { class: 'stat-card' });
          card.appendChild(el('div', { class: 'stat-icon' }, c.icon));
          card.appendChild(el('div', { class: 'stat-value' }, String(c.value)));
          card.appendChild(el('div', { class: 'stat-label' }, c.label));
          grid.appendChild(card);
        }

        // Recent agents
        if (Array.isArray(agents) && agents.length > 0) {
          const section = el('div', { class: 'dashboard-section' });
          main.appendChild(section);
          section.appendChild(el('h2', {}, 'Recent Agents'));
          const list = el('div', { class: 'agent-list-preview' });
          section.appendChild(list);
          for (const agent of agents.slice(0, 5)) {
            const row = el('div', { class: 'agent-row-preview' });
            row.appendChild(el('span', { class: 'agent-name' }, agent.name || 'Unnamed'));
            row.appendChild(el('span', { class: `badge ${agent.active ? 'badge-green' : 'badge-gray'}` }, agent.active ? 'Active' : 'Inactive'));
            const chatBtn = el('button', { class: 'btn btn-sm', onclick: () => navigate(`#/chat?agent=${agent.id}`) }, 'Chat');
            row.appendChild(chatBtn);
            list.appendChild(row);
          }
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: AGENTS
  // ─────────────────────────────────────────────────────────────────────────
  route('#/agents', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/agents'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      const header = el('div', { class: 'page-header' });
      header.appendChild(el('h1', {}, 'Agents'));
      const newBtn = el('button', { class: 'btn btn-primary', onclick: () => navigate('#/wizard') }, '+ New Agent');
      header.appendChild(newBtn);
      main.appendChild(header);

      const tbody = el('tbody', {});
      const table = el('table', { class: 'data-table' });
      const thead = el('thead', {});
      thead.appendChild(el('tr', {},
        el('th', {}, 'Name'),
        el('th', {}, 'Model'),
        el('th', {}, 'Status'),
        el('th', {}, 'Schedule'),
        el('th', {}, 'Actions'),
      ));
      table.appendChild(thead);
      table.appendChild(tbody);
      main.appendChild(table);

      const loading = el('div', { class: 'loading-spinner' }, 'Loading agents…');
      main.appendChild(loading);

      api('/api/agents').then(agents => {
        loading.remove();
        if (!agents.length) {
          tbody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'empty-cell' }, 'No agents yet. Create one!')));
          return;
        }
        for (const agent of agents) {
          const row = el('tr', {});
          row.appendChild(el('td', {}, agent.name || 'Unnamed'));
          row.appendChild(el('td', {}, agent.model || '-'));
          row.appendChild(el('td', {}, el('span', { class: `badge ${agent.active ? 'badge-green' : 'badge-gray'}` }, agent.active ? 'Active' : 'Inactive')));
          row.appendChild(el('td', {}, agent.schedule || 'manual'));
          const actions = el('td', { class: 'action-cell' });
          actions.appendChild(el('button', { class: 'btn btn-sm', onclick: () => navigate(`#/chat?agent=${agent.id}`) }, 'Chat'));
          actions.appendChild(el('button', { class: 'btn btn-sm btn-warning', onclick: () => navigate(`#/wizard?edit=${agent.id}`) }, 'Edit'));
          actions.appendChild(el('button', { class: 'btn btn-sm btn-danger', onclick: () => deleteAgent(agent.id, row) }, 'Delete'));
          row.appendChild(actions);
          tbody.appendChild(row);
        }
      }).catch(e => { loading.textContent = 'Error: ' + e.message; });
    });
  });

  async function deleteAgent(id, row) {
    if (!confirm('Delete this agent?')) return;
    try {
      await api(`/api/agents/${id}`, { method: 'DELETE' });
      row.remove();
      toast('Agent deleted', 'success');
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: CHAT
  // ─────────────────────────────────────────────────────────────────────────
  route('#/chat', function () {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const agentId = params.get('agent');

    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/chat'));
      const main = el('main', { class: 'main-content chat-layout' });
      wrapper.appendChild(main);

      const header = el('div', { class: 'page-header' });
      const titleEl = el('h1', {}, 'Chat');
      header.appendChild(titleEl);
      main.appendChild(header);

      // Agent selector
      const selectorRow = el('div', { class: 'chat-selector-row' });
      const agentSelect = el('select', { class: 'form-select' });
      agentSelect.appendChild(el('option', { value: '' }, '— Select Agent —'));
      selectorRow.appendChild(el('label', {}, 'Agent: '));
      selectorRow.appendChild(agentSelect);
      main.appendChild(selectorRow);

      api('/api/agents').then(agents => {
        for (const a of agents) {
          const opt = el('option', { value: a.id }, a.name || a.id);
          if (a.id === agentId) opt.selected = true;
          agentSelect.appendChild(opt);
        }
        if (agentId) titleEl.textContent = `Chat: ${agents.find(a => a.id === agentId)?.name || agentId}`;
      }).catch(() => {});

      // Messages
      const messages = el('div', { class: 'chat-messages' });
      main.appendChild(messages);

      // Input
      const inputRow = el('div', { class: 'chat-input-row' });
      const textarea = el('textarea', { class: 'chat-textarea', placeholder: 'Type a message…', rows: '3' });
      const sendBtn = el('button', { class: 'btn btn-primary', onclick: sendMessage }, 'Send');
      inputRow.appendChild(textarea);
      inputRow.appendChild(sendBtn);
      main.appendChild(inputRow);

      function appendMessage(role, text) {
        const div = el('div', { class: `message message-${role}` });
        const label = el('span', { class: 'message-role' }, role === 'user' ? 'You' : 'Agent');
        const content = el('div', { class: 'message-content' });
        content.textContent = text;
        div.appendChild(label);
        div.appendChild(content);
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
        return content;
      }

      function sendMessage() {
        const text = textarea.value.trim();
        if (!text) return;
        const selectedAgent = agentSelect.value;
        if (!selectedAgent) { toast('Please select an agent', 'warning'); return; }
        textarea.value = '';
        appendMessage('user', text);
        const botContent = appendMessage('assistant', '…');
        botContent.textContent = '';

        streamChat(
          { agent_id: selectedAgent, message: text, model: CONFIG.defaultModel },
          chunk => { botContent.textContent += chunk; messages.scrollTop = messages.scrollHeight; },
          () => {},
          err => { botContent.textContent = 'Error: ' + err.message; },
        );
      }

      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: KNOWLEDGE BASE
  // ─────────────────────────────────────────────────────────────────────────
  route('#/knowledge', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/knowledge'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      const header = el('div', { class: 'page-header' });
      header.appendChild(el('h1', {}, 'Knowledge Base'));
      main.appendChild(header);

      // Search + Add row
      const toolbar = el('div', { class: 'toolbar' });
      const searchInput = el('input', { type: 'text', class: 'form-input', placeholder: 'Search knowledge…' });
      const addBtn = el('button', { class: 'btn btn-primary', onclick: showAddForm }, '+ Add Entry');
      toolbar.appendChild(searchInput);
      toolbar.appendChild(addBtn);
      main.appendChild(toolbar);

      const resultsDiv = el('div', { class: 'knowledge-results' });
      main.appendChild(resultsDiv);

      let allEntries = [];

      function renderEntries(entries) {
        setHTML(resultsDiv, '');
        if (!entries.length) {
          resultsDiv.appendChild(el('p', { class: 'empty-msg' }, 'No entries found.'));
          return;
        }
        for (const entry of entries) {
          const card = el('div', { class: 'knowledge-card' });
          card.appendChild(el('div', { class: 'knowledge-title' }, entry.title || entry.id));
          card.appendChild(el('div', { class: 'knowledge-snippet' }, (entry.content || '').slice(0, 200) + '…'));
          const actions = el('div', { class: 'card-actions' });
          actions.appendChild(el('button', { class: 'btn btn-sm', onclick: () => viewEntry(entry) }, 'View'));
          actions.appendChild(el('button', { class: 'btn btn-sm btn-danger', onclick: () => deleteEntry(entry.id, card) }, 'Delete'));
          card.appendChild(actions);
          resultsDiv.appendChild(card);
        }
      }

      api('/api/knowledge').then(data => {
        allEntries = Array.isArray(data) ? data : (data.entries || []);
        renderEntries(allEntries);
      }).catch(e => { resultsDiv.textContent = 'Error: ' + e.message; });

      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        renderEntries(allEntries.filter(e =>
          (e.title || '').toLowerCase().includes(q) ||
          (e.content || '').toLowerCase().includes(q)
        ));
      });

      function viewEntry(entry) {
        const modal = buildModal(entry.title || 'Entry', entry.content || '');
        document.body.appendChild(modal);
      }

      async function deleteEntry(id, card) {
        if (!confirm('Delete this entry?')) return;
        try {
          await api(`/api/knowledge/${id}`, { method: 'DELETE' });
          card.remove();
          toast('Entry deleted', 'success');
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        }
      }

      function showAddForm() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const box = el('div', { class: 'modal-box' });
        box.appendChild(el('h2', {}, 'Add Knowledge Entry'));
        const titleInput = el('input', { type: 'text', class: 'form-input', placeholder: 'Title' });
        const contentTA = el('textarea', { class: 'form-textarea', rows: '6', placeholder: 'Content…' });
        const row = el('div', { class: 'modal-actions' });
        const saveBtn = el('button', { class: 'btn btn-primary', onclick: async () => {
          const title = titleInput.value.trim();
          const content = contentTA.value.trim();
          if (!title || !content) { toast('Title and content required', 'warning'); return; }
          try {
            await api('/api/knowledge', { method: 'POST', body: JSON.stringify({ title, content }) });
            modal.remove();
            toast('Entry added', 'success');
            navigate('#/knowledge');
          } catch (e) { toast('Error: ' + e.message, 'error'); }
        }}, 'Save');
        const cancelBtn = el('button', { class: 'btn', onclick: () => modal.remove() }, 'Cancel');
        row.appendChild(saveBtn);
        row.appendChild(cancelBtn);
        box.appendChild(titleInput);
        box.appendChild(contentTA);
        box.appendChild(row);
        modal.appendChild(box);
        document.body.appendChild(modal);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: ANALYTICS
  // ─────────────────────────────────────────────────────────────────────────
  route('#/analytics', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/analytics'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      main.appendChild(el('h1', {}, 'Analytics'));

      const grid = el('div', { class: 'analytics-grid' });
      main.appendChild(grid);

      api('/api/analytics/summary').then(data => {
        const metrics = [
          { label: 'Total Messages', value: data.total_messages || 0 },
          { label: 'Total Tokens', value: formatNum(data.total_tokens || 0) },
          { label: 'Total Cost', value: '$' + (data.total_cost || 0).toFixed(4) },
          { label: 'Avg Tokens/Msg', value: formatNum(data.avg_tokens || 0) },
          { label: 'Messages Today', value: data.messages_today || 0 },
          { label: 'Cost Today', value: '$' + (data.cost_today || 0).toFixed(4) },
        ];
        for (const m of metrics) {
          const card = el('div', { class: 'stat-card' });
          card.appendChild(el('div', { class: 'stat-value' }, String(m.value)));
          card.appendChild(el('div', { class: 'stat-label' }, m.label));
          grid.appendChild(card);
        }
      }).catch(e => main.appendChild(el('p', {}, 'Error: ' + e.message)));

      // Model usage chart placeholder
      const chartSection = el('div', { class: 'chart-section' });
      main.appendChild(chartSection);
      chartSection.appendChild(el('h2', {}, 'Usage by Model'));

      api('/api/analytics/by-model').then(data => {
        if (!data || !data.length) {
          chartSection.appendChild(el('p', { class: 'empty-msg' }, 'No data yet.'));
          return;
        }
        const table = el('table', { class: 'data-table' });
        const thead = el('thead', {});
        thead.appendChild(el('tr', {},
          el('th', {}, 'Model'),
          el('th', {}, 'Messages'),
          el('th', {}, 'Tokens'),
          el('th', {}, 'Cost'),
        ));
        table.appendChild(thead);
        const tbody = el('tbody', {});
        for (const row of data) {
          tbody.appendChild(el('tr', {},
            el('td', {}, row.model),
            el('td', {}, String(row.messages || 0)),
            el('td', {}, formatNum(row.tokens || 0)),
            el('td', {}, '$' + (row.cost || 0).toFixed(4)),
          ));
        }
        table.appendChild(tbody);
        chartSection.appendChild(table);
      }).catch(() => {});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  route('#/settings', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/settings'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      main.appendChild(el('h1', {}, 'Settings'));

      api('/api/settings').then(settings => {
        const form = el('form', { class: 'settings-form', onsubmit: async e => {
          e.preventDefault();
          const data = {};
          for (const input of $$('input, select, textarea', form)) {
            if (input.name) data[input.name] = input.type === 'checkbox' ? input.checked : input.value;
          }
          try {
            await api('/api/settings', { method: 'POST', body: JSON.stringify(data) });
            toast('Settings saved', 'success');
          } catch (e) { toast('Error: ' + e.message, 'error'); }
        }});

        const fields = [
          { name: 'openai_api_key', label: 'OpenAI API Key', type: 'password', placeholder: 'sk-…' },
          { name: 'default_model', label: 'Default Model', type: 'select', options: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
          { name: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: '2048' },
          { name: 'temperature', label: 'Temperature', type: 'number', placeholder: '0.7', step: '0.1', min: '0', max: '2' },
          { name: 'system_prompt', label: 'Default System Prompt', type: 'textarea', rows: '4' },
        ];

        for (const f of fields) {
          const group = el('div', { class: 'form-group' });
          group.appendChild(el('label', { class: 'form-label' }, f.label));
          let input;
          if (f.type === 'select') {
            input = el('select', { name: f.name, class: 'form-select' });
            for (const opt of f.options) {
              const o = el('option', { value: opt }, opt);
              if ((settings[f.name] || CONFIG.defaultModel) === opt) o.selected = true;
              input.appendChild(o);
            }
          } else if (f.type === 'textarea') {
            input = el('textarea', { name: f.name, class: 'form-textarea', rows: f.rows || '3' });
            input.value = settings[f.name] || '';
          } else {
            const attrs = { name: f.name, type: f.type, class: 'form-input' };
            if (f.placeholder) attrs.placeholder = f.placeholder;
            if (f.step) attrs.step = f.step;
            if (f.min) attrs.min = f.min;
            if (f.max) attrs.max = f.max;
            input = el('input', attrs);
            input.value = settings[f.name] || '';
          }
          group.appendChild(input);
          form.appendChild(group);
        }

        const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save Settings');
        form.appendChild(submitBtn);
        main.appendChild(form);
      }).catch(e => main.appendChild(el('p', {}, 'Error loading settings: ' + e.message)));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: WIZARD (Create/Edit Agent)
  // ─────────────────────────────────────────────────────────────────────────
  route('#/wizard', function () {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const editId = params.get('edit');

    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/agents'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      main.appendChild(el('h1', {}, editId ? 'Edit Agent' : 'New Agent'));

      const form = el('form', { class: 'agent-form' });
      main.appendChild(form);

      const fields = [
        { name: 'name', label: 'Agent Name', type: 'text', placeholder: 'My Agent', required: true },
        { name: 'model', label: 'Model', type: 'select', options: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
        { name: 'temperature', label: 'Temperature', type: 'number', placeholder: '0.7', step: '0.1', min: '0', max: '2' },
        { name: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: '2048' },
        { name: 'system_prompt', label: 'System Prompt', type: 'textarea', rows: '5' },
        { name: 'schedule', label: 'Schedule', type: 'select', options: ['manual', 'hourly', 'daily', 'weekly'] },
      ];

      const formData = {};

      const buildForm = (existing = {}) => {
        setHTML(form, '');
        for (const f of fields) {
          const group = el('div', { class: 'form-group' });
          group.appendChild(el('label', { class: 'form-label' }, f.label));
          let input;
          if (f.type === 'select') {
            input = el('select', { name: f.name, class: 'form-select' });
            for (const opt of f.options) {
              const o = el('option', { value: opt }, opt);
              if (existing[f.name] === opt) o.selected = true;
              input.appendChild(o);
            }
          } else if (f.type === 'textarea') {
            input = el('textarea', { name: f.name, class: 'form-textarea', rows: f.rows || '3', placeholder: f.placeholder || '' });
            input.value = existing[f.name] || '';
          } else {
            const attrs = { name: f.name, type: f.type, class: 'form-input', placeholder: f.placeholder || '' };
            if (f.step) attrs.step = f.step;
            if (f.min) attrs.min = f.min;
            if (f.max) attrs.max = f.max;
            if (f.required) attrs.required = 'true';
            input = el('input', attrs);
            input.value = existing[f.name] || '';
          }
          group.appendChild(input);
          form.appendChild(group);
        }

        // Knowledge base multi-select
        const kGroup = el('div', { class: 'form-group' });
        kGroup.appendChild(el('label', { class: 'form-label' }, 'Knowledge Bases'));
        const kSelect = el('select', { name: 'knowledge_ids', class: 'form-select', multiple: 'true', size: '4' });
        api('/api/knowledge').then(kData => {
          const entries = Array.isArray(kData) ? kData : (kData.entries || []);
          for (const k of entries) {
            const o = el('option', { value: k.id }, k.title || k.id);
            if ((existing.knowledge_ids || []).includes(k.id)) o.selected = true;
            kSelect.appendChild(o);
          }
        }).catch(() => {});
        kGroup.appendChild(kSelect);
        form.appendChild(kGroup);

        // Rules
        const rGroup = el('div', { class: 'form-group' });
        rGroup.appendChild(el('label', { class: 'form-label' }, 'Rules (one per line)'));
        const rTA = el('textarea', { name: 'rules', class: 'form-textarea', rows: '3', placeholder: 'Be concise\nAlways cite sources' });
        rTA.value = (existing.rules || []).join('\n');
        rGroup.appendChild(rTA);
        form.appendChild(rGroup);

        const active = el('div', { class: 'form-group form-check' });
        const activeInput = el('input', { type: 'checkbox', name: 'active', id: 'active-check' });
        if (existing.active !== false) activeInput.checked = true;
        active.appendChild(activeInput);
        active.appendChild(el('label', { for: 'active-check' }, 'Active'));
        form.appendChild(active);

        const btnRow = el('div', { class: 'form-actions' });
        const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => saveAgent(existing.id) }, editId ? 'Update Agent' : 'Create Agent');
        const cancelBtn = el('button', { type: 'button', class: 'btn', onclick: () => navigate('#/agents') }, 'Cancel');
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        form.appendChild(btnRow);
      };

      if (editId) {
        api(`/api/agents/${editId}`).then(agent => buildForm(agent)).catch(() => buildForm({}));
      } else {
        buildForm({});
      }

      async function saveAgent(existingId) {
        const data = { rules: [], knowledge_ids: [] };
        for (const input of $$('input, select, textarea', form)) {
          if (!input.name) continue;
          if (input.type === 'checkbox') { data[input.name] = input.checked; }
          else if (input.name === 'rules') { data.rules = input.value.split('\n').map(r => r.trim()).filter(Boolean); }
          else if (input.name === 'knowledge_ids') {
            data.knowledge_ids = [...input.options].filter(o => o.selected).map(o => o.value);
          }
          else { data[input.name] = input.value; }
        }
        try {
          if (existingId) {
            await api(`/api/agents/${existingId}`, { method: 'PUT', body: JSON.stringify(data) });
            toast('Agent updated', 'success');
          } else {
            await api('/api/agents', { method: 'POST', body: JSON.stringify(data) });
            toast('Agent created', 'success');
          }
          navigate('#/agents');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: COMMAND CENTER  ← AI Search Bible integration
  // ─────────────────────────────────────────────────────────────────────────
  route('#/command', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/command'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      main.appendChild(el('h1', {}, 'Command Center'));

      // Tab bar
      const tabs = [
        { id: 'fanout',      label: 'Fan-Out Analysis' },
        { id: 'croutonize', label: 'Croutonizer' },
        { id: 'scorer',     label: 'Inference Cost Scorer' },
        { id: 'run',        label: 'Run Agent' },
        { id: 'batch',      label: 'Batch Run' },
        { id: 'logs',       label: 'Logs' },
      ];

      const tabBar = el('div', { class: 'tab-bar' });
      const tabContent = el('div', { class: 'tab-content' });
      main.appendChild(tabBar);
      main.appendChild(tabContent);

      let activeTab = 'fanout';

      function renderTab(id) {
        activeTab = id;
        $$('.tab-btn', tabBar).forEach(b => b.classList.toggle('active', b.dataset.tab === id));
        setHTML(tabContent, '');
        switch (id) {
          case 'fanout':      renderFanout(tabContent); break;
          case 'croutonize':  renderCroutonize(tabContent); break;
          case 'scorer':      renderScorer(tabContent); break;
          case 'run':         renderRunAgent(tabContent); break;
          case 'batch':       renderBatchRun(tabContent); break;
          case 'logs':        renderLogs(tabContent); break;
        }
      }

      for (const t of tabs) {
        const btn = el('button', { class: `tab-btn${t.id === activeTab ? ' active' : ''}`, 'data-tab': t.id, onclick: () => renderTab(t.id) }, t.label);
        tabBar.appendChild(btn);
      }

      renderTab(activeTab);
    });
  });

  // ── Tab: Fan-Out Analysis ──────────────────────────────────────────────────
  function renderFanout(container) {
    container.appendChild(el('h2', {}, 'Fan-Out Query Analysis'));
    container.appendChild(el('p', { class: 'tab-desc' },
      'Analyze how a query fans out across AI search surfaces using the AI Search Bible doctrine.'
    ));

    const form = el('div', { class: 'cmd-form' });
    container.appendChild(form);

    const qInput = el('input', { type: 'text', class: 'form-input', placeholder: 'Enter a search query or topic…' });
    form.appendChild(el('label', { class: 'form-label' }, 'Query'));
    form.appendChild(qInput);

    const surfaceOptions = [
      'ChatGPT', 'Perplexity', 'Google AI Overview', 'Bing Copilot',
      'Claude', 'Gemini', 'Meta AI', 'You.com',
    ];
    form.appendChild(el('label', { class: 'form-label' }, 'Target Surfaces'));
    const surfaceGrid = el('div', { class: 'checkbox-grid' });
    const surfaceChecks = {};
    for (const s of surfaceOptions) {
      const id = 'surf-' + s.replace(/\s+/g, '-').toLowerCase();
      const cb = el('input', { type: 'checkbox', id, checked: 'true' });
      surfaceChecks[s] = cb;
      const lbl = el('label', { for: id, class: 'check-label' }, s);
      const wrap = el('div', { class: 'check-wrap' });
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      surfaceGrid.appendChild(wrap);
    }
    form.appendChild(surfaceGrid);

    const runBtn = el('button', { class: 'btn btn-primary', onclick: runFanout }, 'Analyze Fan-Out');
    form.appendChild(runBtn);

    const resultsDiv = el('div', { class: 'fanout-results' });
    container.appendChild(resultsDiv);

    async function runFanout() {
      const query = qInput.value.trim();
      if (!query) { toast('Enter a query', 'warning'); return; }
      const surfaces = Object.entries(surfaceChecks)
        .filter(([, cb]) => cb.checked)
        .map(([s]) => s);
      if (!surfaces.length) { toast('Select at least one surface', 'warning'); return; }

      setHTML(resultsDiv, '<div class="loading-spinner">Analyzing fan-out…</div>');
      runBtn.disabled = true;

      try {
        const result = await api('/api/command/fanout', {
          method: 'POST',
          body: JSON.stringify({ query, surfaces }),
        });
        renderFanoutResults(resultsDiv, result);
      } catch (e) {
        setHTML(resultsDiv, `<p class="error-msg">Error: ${e.message}</p>`);
      } finally {
        runBtn.disabled = false;
      }
    }
  }

  function renderFanoutResults(container, result) {
    setHTML(container, '');
    if (!result) { container.appendChild(el('p', {}, 'No results.')); return; }

    // Overall score
    if (result.overall_score !== undefined) {
      const scoreBar = el('div', { class: 'score-bar-wrap' });
      scoreBar.appendChild(el('span', { class: 'score-label' }, `Overall AI Search Score: `));
      scoreBar.appendChild(el('span', { class: 'score-value' }, `${result.overall_score}/100`));
      const bar = el('div', { class: 'score-bar' });
      const fill = el('div', { class: 'score-fill', style: { width: `${result.overall_score}%` } });
      bar.appendChild(fill);
      scoreBar.appendChild(bar);
      container.appendChild(scoreBar);
    }

    // Surface breakdown
    if (result.surfaces && result.surfaces.length) {
      const section = el('div', { class: 'fanout-surfaces' });
      section.appendChild(el('h3', {}, 'Surface Breakdown'));
      const grid = el('div', { class: 'surface-grid' });
      for (const s of result.surfaces) {
        const card = el('div', { class: 'surface-card' });
        card.appendChild(el('div', { class: 'surface-name' }, s.surface));
        if (s.score !== undefined) {
          const sb = el('div', { class: 'surface-score' });
          sb.appendChild(el('span', {}, `Score: ${s.score}/100`));
          const mini = el('div', { class: 'mini-bar' });
          mini.appendChild(el('div', { class: 'mini-fill', style: { width: `${s.score}%` } }));
          sb.appendChild(mini);
          card.appendChild(sb);
        }
        if (s.reasoning) card.appendChild(el('div', { class: 'surface-reasoning' }, s.reasoning));
        if (s.recommendations && s.recommendations.length) {
          const ul = el('ul', { class: 'surface-recs' });
          for (const r of s.recommendations) ul.appendChild(el('li', {}, r));
          card.appendChild(ul);
        }
        grid.appendChild(card);
      }
      section.appendChild(grid);
      container.appendChild(section);
    }

    // Croutons cited
    if (result.croutons_cited && result.croutons_cited.length) {
      const section = el('div', { class: 'croutons-cited' });
      section.appendChild(el('h3', {}, 'Doctrine Applied'));
      const ul = el('ul', {});
      for (const c of result.croutons_cited) {
        ul.appendChild(el('li', {}, `[${c.id}] ${c.title}`));
      }
      section.appendChild(ul);
      container.appendChild(section);
    }

    // Raw JSON toggle
    const toggle = el('details', { class: 'raw-json-toggle' });
    toggle.appendChild(el('summary', {}, 'Raw JSON'));
    const pre = el('pre', { class: 'raw-json' });
    pre.textContent = JSON.stringify(result, null, 2);
    toggle.appendChild(pre);
    container.appendChild(toggle);
  }

  // ── Tab: Croutonizer ───────────────────────────────────────────────────────
  function renderCroutonize(container) {
    container.appendChild(el('h2', {}, 'Content Croutonizer'));
    container.appendChild(el('p', { class: 'tab-desc' },
      'Break down any content into AI-Search-Bible croutons — atomic, citable knowledge units.'
    ));

    const form = el('div', { class: 'cmd-form' });
    container.appendChild(form);

    form.appendChild(el('label', { class: 'form-label' }, 'Content to Croutonize'));
    const contentTA = el('textarea', { class: 'form-textarea', rows: '8',
      placeholder: 'Paste any content here — blog post, documentation, transcript…' });
    form.appendChild(contentTA);

    const optRow = el('div', { class: 'option-row' });
    optRow.appendChild(el('label', { class: 'form-label' }, 'Target crouton type:'));
    const typeSelect = el('select', { class: 'form-select' });
    for (const t of ['fact', 'doctrine', 'how-to', 'example', 'comparison', 'definition']) {
      typeSelect.appendChild(el('option', { value: t }, t));
    }
    optRow.appendChild(typeSelect);
    form.appendChild(optRow);

    const runBtn = el('button', { class: 'btn btn-primary', onclick: runCroutonize }, 'Croutonize');
    form.appendChild(runBtn);

    const resultsDiv = el('div', { class: 'croutonize-results' });
    container.appendChild(resultsDiv);

    async function runCroutonize() {
      const content = contentTA.value.trim();
      if (!content) { toast('Enter some content', 'warning'); return; }
      const crouton_type = typeSelect.value;

      setHTML(resultsDiv, '<div class="loading-spinner">Croutonizing…</div>');
      runBtn.disabled = true;

      try {
        const result = await api('/api/command/croutonize', {
          method: 'POST',
          body: JSON.stringify({ content, crouton_type }),
        });
        renderCroutonizeResults(resultsDiv, result);
      } catch (e) {
        setHTML(resultsDiv, `<p class="error-msg">Error: ${e.message}</p>`);
      } finally {
        runBtn.disabled = false;
      }
    }
  }

  function renderCroutonizeResults(container, result) {
    setHTML(container, '');
    if (!result || !result.croutons) {
      container.appendChild(el('p', {}, 'No croutons generated.'));
      return;
    }
    const header = el('div', { class: 'crouton-header' });
    header.appendChild(el('span', { class: 'crouton-count' }, `${result.croutons.length} croutons generated`));
    container.appendChild(header);

    for (const c of result.croutons) {
      const card = el('div', { class: `crouton-card crouton-type-${c.type || 'fact'}` });
      const cardHeader = el('div', { class: 'crouton-card-header' });
      cardHeader.appendChild(el('span', { class: 'crouton-id' }, c.id || ''));
      cardHeader.appendChild(el('span', { class: `crouton-type-badge type-${c.type || 'fact'}` }, c.type || 'fact'));
      card.appendChild(cardHeader);
      if (c.title) card.appendChild(el('div', { class: 'crouton-title' }, c.title));
      if (c.content) card.appendChild(el('div', { class: 'crouton-content' }, c.content));
      if (c.tags && c.tags.length) {
        const tagRow = el('div', { class: 'crouton-tags' });
        for (const tag of c.tags) tagRow.appendChild(el('span', { class: 'tag' }, tag));
        card.appendChild(tagRow);
      }
      container.appendChild(card);
    }

    if (result.ndjson) {
      const toggle = el('details', { class: 'raw-json-toggle' });
      toggle.appendChild(el('summary', {}, 'Export NDJSON'));
      const pre = el('pre', { class: 'raw-json' });
      pre.textContent = result.ndjson;
      toggle.appendChild(pre);
      const copyBtn = el('button', { class: 'btn btn-sm', onclick: () => {
        navigator.clipboard.writeText(result.ndjson).then(() => toast('Copied!', 'success'));
      }}, 'Copy NDJSON');
      toggle.appendChild(copyBtn);
      container.appendChild(toggle);
    }
  }

  // ── Tab: Inference Cost Scorer ─────────────────────────────────────────────
  function renderScorer(container) {
    container.appendChild(el('h2', {}, 'Inference Cost Scorer'));
    container.appendChild(el('p', { class: 'tab-desc' },
      'Estimate the AI inference cost and token usage for your prompts across different models.'
    ));

    const form = el('div', { class: 'cmd-form' });
    container.appendChild(form);

    form.appendChild(el('label', { class: 'form-label' }, 'System Prompt'));
    const sysTA = el('textarea', { class: 'form-textarea', rows: '3', placeholder: 'System prompt…' });
    form.appendChild(sysTA);

    form.appendChild(el('label', { class: 'form-label' }, 'User Message'));
    const userTA = el('textarea', { class: 'form-textarea', rows: '3', placeholder: 'User message…' });
    form.appendChild(userTA);

    const modelOptions = [
      { id: 'gpt-4o', label: 'GPT-4o', input: 0.005, output: 0.015 },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', input: 0.00015, output: 0.0006 },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', input: 0.01, output: 0.03 },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', input: 0.0005, output: 0.0015 },
      { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', input: 0.003, output: 0.015 },
      { id: 'claude-3-haiku', label: 'Claude 3 Haiku', input: 0.00025, output: 0.00125 },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', input: 0.00125, output: 0.005 },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', input: 0.000075, output: 0.0003 },
    ];

    form.appendChild(el('label', { class: 'form-label' }, 'Models to Compare'));
    const modelGrid = el('div', { class: 'checkbox-grid' });
    const modelChecks = {};
    for (const m of modelOptions) {
      const id = 'model-' + m.id;
      const cb = el('input', { type: 'checkbox', id, checked: 'true' });
      modelChecks[m.id] = { cb, meta: m };
      const lbl = el('label', { for: id, class: 'check-label' }, m.label);
      const wrap = el('div', { class: 'check-wrap' });
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      modelGrid.appendChild(wrap);
    }
    form.appendChild(modelGrid);

    const optRow = el('div', { class: 'option-row' });
    optRow.appendChild(el('label', { class: 'form-label' }, 'Expected output tokens:'));
    const outputTokens = el('input', { type: 'number', class: 'form-input', value: '500', min: '1' });
    optRow.appendChild(outputTokens);
    form.appendChild(optRow);

    const runBtn = el('button', { class: 'btn btn-primary', onclick: runScorer }, 'Calculate Cost');
    form.appendChild(runBtn);

    const resultsDiv = el('div', { class: 'scorer-results' });
    container.appendChild(resultsDiv);

    function estimateTokens(text) {
      // rough estimate: ~4 chars per token
      return Math.ceil((text || '').length / 4);
    }

    async function runScorer() {
      const systemPrompt = sysTA.value;
      const userMessage = userTA.value;
      if (!systemPrompt && !userMessage) { toast('Enter at least a system prompt or user message', 'warning'); return; }

      const selectedModels = Object.entries(modelChecks)
        .filter(([, { cb }]) => cb.checked)
        .map(([, { meta }]) => meta);
      if (!selectedModels.length) { toast('Select at least one model', 'warning'); return; }

      const inputTokens = estimateTokens(systemPrompt) + estimateTokens(userMessage);
      const outTokens = parseInt(outputTokens.value, 10) || 500;

      // Try server-side first, fall back to client-side
      try {
        const result = await api('/api/command/score', {
          method: 'POST',
          body: JSON.stringify({
            system_prompt: systemPrompt,
            user_message: userMessage,
            models: selectedModels.map(m => m.id),
            expected_output_tokens: outTokens,
          }),
        });
        renderScorerResults(resultsDiv, result);
      } catch {
        // client-side fallback
        const scores = selectedModels.map(m => ({
          model: m.label,
          model_id: m.id,
          input_tokens: inputTokens,
          output_tokens: outTokens,
          total_tokens: inputTokens + outTokens,
          cost: ((inputTokens / 1000) * m.input + (outTokens / 1000) * m.output),
        }));
        scores.sort((a, b) => a.cost - b.cost);
        renderScorerResults(resultsDiv, { scores, input_tokens: inputTokens, output_tokens: outTokens });
      }
    }
  }

  function renderScorerResults(container, result) {
    setHTML(container, '');
    if (!result || !result.scores) {
      container.appendChild(el('p', {}, 'No results.'));
      return;
    }

    const summary = el('div', { class: 'scorer-summary' });
    summary.appendChild(el('span', {}, `Input tokens: ~${result.input_tokens || 0}`));
    summary.appendChild(el('span', {}, `Output tokens: ~${result.output_tokens || 0}`));
    container.appendChild(summary);

    const table = el('table', { class: 'data-table scorer-table' });
    const thead = el('thead', {});
    thead.appendChild(el('tr', {},
      el('th', {}, 'Model'),
      el('th', {}, 'Input Tokens'),
      el('th', {}, 'Output Tokens'),
      el('th', {}, 'Est. Cost'),
      el('th', {}, 'Cost/1K calls'),
    ));
    table.appendChild(thead);
    const tbody = el('tbody', {});
    let minCost = Infinity;
    for (const s of result.scores) minCost = Math.min(minCost, s.cost);
    for (const s of result.scores) {
      const row = el('tr', { class: s.cost === minCost ? 'row-highlight' : '' });
      row.appendChild(el('td', {}, s.model || s.model_id));
      row.appendChild(el('td', {}, String(s.input_tokens || 0)));
      row.appendChild(el('td', {}, String(s.output_tokens || 0)));
      row.appendChild(el('td', {}, '$' + (s.cost || 0).toFixed(6)));
      row.appendChild(el('td', {}, '$' + ((s.cost || 0) * 1000).toFixed(4)));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ── Tab: Run Agent ─────────────────────────────────────────────────────────
  function renderRunAgent(container) {
    container.appendChild(el('h2', {}, 'Run Agent'));

    const form = el('div', { class: 'cmd-form' });
    container.appendChild(form);

    form.appendChild(el('label', { class: 'form-label' }, 'Select Agent'));
    const agentSelect = el('select', { class: 'form-select' });
    agentSelect.appendChild(el('option', { value: '' }, '— Select —'));
    form.appendChild(agentSelect);

    form.appendChild(el('label', { class: 'form-label' }, 'Input (optional)'));
    const inputTA = el('textarea', { class: 'form-textarea', rows: '4', placeholder: 'Additional input or context…' });
    form.appendChild(inputTA);

    const runBtn = el('button', { class: 'btn btn-primary', onclick: runAgent }, 'Run');
    form.appendChild(runBtn);

    const outputDiv = el('div', { class: 'agent-output' });
    container.appendChild(outputDiv);

    api('/api/agents').then(agents => {
      for (const a of agents) {
        agentSelect.appendChild(el('option', { value: a.id }, a.name || a.id));
      }
    }).catch(() => {});

    function runAgent() {
      const agentId = agentSelect.value;
      if (!agentId) { toast('Select an agent', 'warning'); return; }
      const input = inputTA.value.trim();
      setHTML(outputDiv, '<div class="loading-spinner">Running agent…</div>');
      runBtn.disabled = true;

      const outputContent = el('div', { class: 'stream-output' });
      setHTML(outputDiv, '');
      outputDiv.appendChild(el('h3', {}, 'Output'));
      outputDiv.appendChild(outputContent);

      streamChat(
        { agent_id: agentId, message: input || 'Run', model: CONFIG.defaultModel },
        chunk => { outputContent.textContent += chunk; },
        () => { runBtn.disabled = false; },
        err => {
          outputContent.textContent = 'Error: ' + err.message;
          runBtn.disabled = false;
        },
      );
    }
  }

  // ── Tab: Batch Run ─────────────────────────────────────────────────────────
  function renderBatchRun(container) {
    container.appendChild(el('h2', {}, 'Batch Run'));
    container.appendChild(el('p', { class: 'tab-desc' }, 'Run multiple agents simultaneously.'));

    const form = el('div', { class: 'cmd-form' });
    container.appendChild(form);

    form.appendChild(el('label', { class: 'form-label' }, 'Select Agents'));
    const agentSelect = el('select', { class: 'form-select', multiple: 'true', size: '6' });
    form.appendChild(agentSelect);

    form.appendChild(el('label', { class: 'form-label' }, 'Shared Input'));
    const inputTA = el('textarea', { class: 'form-textarea', rows: '3', placeholder: 'Optional shared input for all agents…' });
    form.appendChild(inputTA);

    const runBtn = el('button', { class: 'btn btn-primary', onclick: runBatch }, 'Run Batch');
    form.appendChild(runBtn);

    const resultsDiv = el('div', { class: 'batch-results' });
    container.appendChild(resultsDiv);

    api('/api/agents').then(agents => {
      for (const a of agents.filter(a => a.active)) {
        agentSelect.appendChild(el('option', { value: a.id }, a.name || a.id));
      }
    }).catch(() => {});

    async function runBatch() {
      const selectedIds = [...agentSelect.options]
        .filter(o => o.selected).map(o => o.value);
      if (!selectedIds.length) { toast('Select at least one agent', 'warning'); return; }
      const input = inputTA.value.trim();

      setHTML(resultsDiv, '<div class="loading-spinner">Running batch…</div>');
      runBtn.disabled = true;

      try {
        const result = await api('/api/command/batch', {
          method: 'POST',
          body: JSON.stringify({ agent_ids: selectedIds, input: input || 'Run' }),
        });
        setHTML(resultsDiv, '');
        if (!result.results) { resultsDiv.appendChild(el('p', {}, 'No results returned.')); return; }
        for (const r of result.results) {
          const card = el('div', { class: `batch-result-card ${r.error ? 'result-error' : 'result-success'}` });
          card.appendChild(el('div', { class: 'batch-agent-name' }, r.agent_name || r.agent_id));
          if (r.error) {
            card.appendChild(el('div', { class: 'error-msg' }, r.error));
          } else {
            const pre = el('pre', { class: 'batch-output' });
            pre.textContent = r.output || '';
            card.appendChild(pre);
          }
          resultsDiv.appendChild(card);
        }
      } catch (e) {
        setHTML(resultsDiv, `<p class="error-msg">Error: ${e.message}</p>`);
      } finally {
        runBtn.disabled = false;
      }
    }
  }

  // ── Tab: Logs ──────────────────────────────────────────────────────────────
  function renderLogs(container) {
    container.appendChild(el('h2', {}, 'Execution Logs'));

    const toolbar = el('div', { class: 'toolbar' });
    const refreshBtn = el('button', { class: 'btn', onclick: loadLogs }, 'Refresh');
    const clearBtn = el('button', { class: 'btn btn-danger', onclick: clearLogs }, 'Clear Logs');
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(clearBtn);
    container.appendChild(toolbar);

    const logsDiv = el('div', { class: 'logs-container' });
    container.appendChild(logsDiv);

    loadLogs();

    async function loadLogs() {
      setHTML(logsDiv, '<div class="loading-spinner">Loading…</div>');
      try {
        const logs = await api('/api/logs');
        setHTML(logsDiv, '');
        if (!logs || !logs.length) {
          logsDiv.appendChild(el('p', { class: 'empty-msg' }, 'No logs yet.'));
          return;
        }
        for (const log of logs.slice().reverse()) {
          const entry = el('div', { class: `log-entry log-${log.level || 'info'}` });
          entry.appendChild(el('span', { class: 'log-time' }, log.timestamp || ''));
          entry.appendChild(el('span', { class: 'log-level' }, (log.level || 'info').toUpperCase()));
          entry.appendChild(el('span', { class: 'log-msg' }, log.message || ''));
          logsDiv.appendChild(entry);
        }
      } catch (e) {
        logsDiv.textContent = 'Error: ' + e.message;
      }
    }

    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;
      try {
        await api('/api/logs', { method: 'DELETE' });
        toast('Logs cleared', 'success');
        loadLogs();
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE: AI SEARCH BIBLE
  // ─────────────────────────────────────────────────────────────────────────
  route('#/ai-search', function () {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/ai-search'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      const header = el('div', { class: 'page-header' });
      header.appendChild(el('h1', {}, 'AI Search Bible'));
      header.appendChild(el('p', { class: 'page-subtitle' },
        'Browse the 45 croutons of AI search doctrine — core principles for winning AI-powered search surfaces.'
      ));
      main.appendChild(header);

      // Filter row
      const filterRow = el('div', { class: 'toolbar' });
      const searchInput = el('input', { type: 'text', class: 'form-input', placeholder: 'Search croutons…' });
      const typeFilter = el('select', { class: 'form-select' });
      typeFilter.appendChild(el('option', { value: '' }, 'All Types'));
      for (const t of ['doctrine', 'fact', 'how-to', 'example', 'comparison', 'definition']) {
        typeFilter.appendChild(el('option', { value: t }, t));
      }
      filterRow.appendChild(searchInput);
      filterRow.appendChild(typeFilter);
      main.appendChild(filterRow);

      const croutonGrid = el('div', { class: 'crouton-grid' });
      main.appendChild(croutonGrid);

      let allCroutons = [];

      function renderCroutons(croutons) {
        setHTML(croutonGrid, '');
        if (!croutons.length) {
          croutonGrid.appendChild(el('p', { class: 'empty-msg' }, 'No croutons match your filter.'));
          return;
        }
        for (const c of croutons) {
          const card = el('div', { class: `crouton-card crouton-type-${c.type || 'doctrine'}` });
          const cardHeader = el('div', { class: 'crouton-card-header' });
          cardHeader.appendChild(el('span', { class: 'crouton-id' }, c.id || ''));
          cardHeader.appendChild(el('span', { class: `crouton-type-badge type-${c.type || 'doctrine'}` }, c.type || 'doctrine'));
          card.appendChild(cardHeader);
          if (c.title) card.appendChild(el('div', { class: 'crouton-title' }, c.title));
          if (c.content) card.appendChild(el('div', { class: 'crouton-content' }, c.content));
          if (c.tags && c.tags.length) {
            const tagRow = el('div', { class: 'crouton-tags' });
            for (const tag of c.tags) tagRow.appendChild(el('span', { class: 'tag' }, tag));
            card.appendChild(tagRow);
          }
          croutonGrid.appendChild(card);
        }
      }

      // Load from knowledge API
      api('/api/knowledge/ai-search-bible').then(data => {
        if (Array.isArray(data)) {
          allCroutons = data;
        } else if (data && data.croutons) {
          allCroutons = data.croutons;
        } else if (data && data.entries) {
          allCroutons = data.entries;
        }
        renderCroutons(allCroutons);
      }).catch(() => {
        // fallback: try generic knowledge search
        api('/api/knowledge?q=ai-search-bible').then(data => {
          allCroutons = Array.isArray(data) ? data : (data.entries || []);
          renderCroutons(allCroutons);
        }).catch(e => {
          croutonGrid.appendChild(el('p', { class: 'error-msg' }, 'Error loading croutons: ' + e.message));
        });
      });

      function filterCroutons() {
        const q = searchInput.value.toLowerCase();
        const type = typeFilter.value;
        renderCroutons(allCroutons.filter(c => {
          const matchQ = !q ||
            (c.title || '').toLowerCase().includes(q) ||
            (c.content || '').toLowerCase().includes(q) ||
            (c.tags || []).some(t => t.toLowerCase().includes(q));
          const matchType = !type || c.type === type;
          return matchQ && matchType;
        }));
      }

      searchInput.addEventListener('input', filterCroutons);
      typeFilter.addEventListener('change', filterCroutons);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MODAL HELPER
  // ─────────────────────────────────────────────────────────────────────────
  function buildModal(title, content) {
    const overlay = el('div', { class: 'modal-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); } });
    const box = el('div', { class: 'modal-box' });
    box.appendChild(el('h2', {}, title));
    const body = el('div', { class: 'modal-body' });
    body.textContent = content;
    box.appendChild(body);
    const closeBtn = el('button', { class: 'btn', onclick: () => overlay.remove() }, 'Close');
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    return overlay;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTIL
  // ─────────────────────────────────────────────────────────────────────────
  function formatNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 404
  // ─────────────────────────────────────────────────────────────────────────
  function renderNotFound() {
    renderMain(wrapper => {
      wrapper.appendChild(buildNav(''));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);
      main.appendChild(el('h1', {}, '404 — Page Not Found'));
      main.appendChild(el('a', { href: '#/' }, '← Back to Dashboard'));
    });
  }

  route('#/404', renderNotFound);

  // ─────────────────────────────────────────────────────────────────────────
  // BOOT
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    dispatch();
  }

  // ── WIZARD page alias
  route('#/wizard', function () {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const editId = params.get('edit');

    renderMain(wrapper => {
      wrapper.appendChild(buildNav('#/agents'));
      const main = el('main', { class: 'main-content' });
      wrapper.appendChild(main);

      main.appendChild(el('h1', {}, editId ? 'Edit Agent' : 'New Agent'));

      const form = el('form', { class: 'agent-form' });
      main.appendChild(form);

      const fields = [
        { name: 'name', label: 'Agent Name', type: 'text', placeholder: 'My Agent', required: true },
        { name: 'model', label: 'Model', type: 'select', options: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
        { name: 'temperature', label: 'Temperature', type: 'number', placeholder: '0.7', step: '0.1', min: '0', max: '2' },
        { name: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: '2048' },
        { name: 'system_prompt', label: 'System Prompt', type: 'textarea', rows: '5' },
        { name: 'schedule', label: 'Schedule', type: 'select', options: ['manual', 'hourly', 'daily', 'weekly'] },
      ];

      const buildForm = (existing = {}) => {
        setHTML(form, '');
        for (const f of fields) {
          const group = el('div', { class: 'form-group' });
          group.appendChild(el('label', { class: 'form-label' }, f.label));
          let input;
          if (f.type === 'select') {
            input = el('select', { name: f.name, class: 'form-select' });
            for (const opt of f.options) {
              const o = el('option', { value: opt }, opt);
              if (existing[f.name] === opt) o.selected = true;
              input.appendChild(o);
            }
          } else if (f.type === 'textarea') {
            input = el('textarea', { name: f.name, class: 'form-textarea', rows: f.rows || '3', placeholder: f.placeholder || '' });
            input.value = existing[f.name] || '';
          } else {
            const attrs = { name: f.name, type: f.type, class: 'form-input', placeholder: f.placeholder || '' };
            if (f.step) attrs.step = f.step;
            if (f.min) attrs.min = f.min;
            if (f.max) attrs.max = f.max;
            if (f.required) attrs.required = 'true';
            input = el('input', attrs);
            input.value = existing[f.name] || '';
          }
          group.appendChild(input);
          form.appendChild(group);
        }

        // Knowledge base multi-select
        const kGroup = el('div', { class: 'form-group' });
        kGroup.appendChild(el('label', { class: 'form-label' }, 'Knowledge Bases'));
        const kSelect = el('select', { name: 'knowledge_ids', class: 'form-select', multiple: 'true', size: '4' });
        api('/api/knowledge').then(kData => {
          const entries = Array.isArray(kData) ? kData : (kData.entries || []);
          for (const k of entries) {
            const o = el('option', { value: k.id }, k.title || k.id);
            if ((existing.knowledge_ids || []).includes(k.id)) o.selected = true;
            kSelect.appendChild(o);
          }
        }).catch(() => {});
        kGroup.appendChild(kSelect);
        form.appendChild(kGroup);

        // Rules
        const rGroup = el('div', { class: 'form-group' });
        rGroup.appendChild(el('label', { class: 'form-label' }, 'Rules (one per line)'));
        const rTA = el('textarea', { name: 'rules', class: 'form-textarea', rows: '3', placeholder: 'Be concise\nAlways cite sources' });
        rTA.value = (existing.rules || []).join('\n');
        rGroup.appendChild(rTA);
        form.appendChild(rGroup);

        const active = el('div', { class: 'form-group form-check' });
        const activeInput = el('input', { type: 'checkbox', name: 'active', id: 'active-check' });
        if (existing.active !== false) activeInput.checked = true;
        active.appendChild(activeInput);
        active.appendChild(el('label', { for: 'active-check' }, 'Active'));
        form.appendChild(active);

        const btnRow = el('div', { class: 'form-actions' });
        const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => saveAgent(existing.id) }, editId ? 'Update Agent' : 'Create Agent');
        const cancelBtn = el('button', { type: 'button', class: 'btn', onclick: () => navigate('#/agents') }, 'Cancel');
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        form.appendChild(btnRow);
      };

      if (editId) {
        api(`/api/agents/${editId}`).then(agent => buildForm(agent)).catch(() => buildForm({}));
      } else {
        buildForm({});
      }

      async function saveAgent(existingId) {
        const data = { rules: [], knowledge_ids: [] };
        for (const input of $$('input, select, textarea', form)) {
          if (!input.name) continue;
          if (input.type === 'checkbox') { data[input.name] = input.checked; }
          else if (input.name === 'rules') { data.rules = input.value.split('\n').map(r => r.trim()).filter(Boolean); }
          else if (input.name === 'knowledge_ids') {
            data.knowledge_ids = [...input.options].filter(o => o.selected).map(o => o.value);
          }
          else { data[input.name] = input.value; }
        }
        try {
          if (existingId) {
            await api(`/api/agents/${existingId}`, { method: 'PUT', body: JSON.stringify(data) });
            toast('Agent updated', 'success');
          } else {
            await api('/api/agents', { method: 'POST', body: JSON.stringify(data) });
            toast('Agent created', 'success');
          }
          navigate('#/agents');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
      }
    });
  });

  // Default wizard data
  const defaultWizardData = { name: '', system_prompt: '', active: true, knowledge_ids: [], model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 1024, schedule: 'daily', rules: [] };

  function navigate(hash) {
    window.location.hash = hash;
  }

  // ── BOOT ───────────────────────────────────
  init();

})();
