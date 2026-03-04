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