// =============================================================================
// auth.js — Shared 4-role authentication for the Burlebo Analytics dashboard
// -----------------------------------------------------------------------------
// Load early in every dashboard page:  <script src="/auth.js"></script>
//
// What this does:
//   1. Defines the 4 roles + their passwords + the page-access matrix.
//   2. Persists the chosen role in sessionStorage so logging in once on any
//      page carries across all dashboard pages until the browser closes.
//   3. Injects the role-pick modal + denied panel HTML so individual pages
//      don't have to copy/paste that boilerplate.
//   4. On page load, checks the stored role against the access matrix for
//      the current page and either:
//        - allowed:  fires window event 'authReady' for the page to start
//        - denied:   shows the denied panel + redirects in 3 seconds
//        - no role:  shows the role-picker modal
//
// Per-page expectations:
//   - Each page must have its own <header id="app-header"> with a
//     <span id="role-pill" onclick="AuthApp.logout()"> inside it.
//   - Each page must have <main id="app-main" class="hidden"> as the wrapper
//     for its content.
//   - Each page provides a function `onAuthReady(role)` that is called once
//     auth completes. (Or listens for the 'authReady' window event.)
//
// View-only:
//   - AuthApp.isViewOnly() returns true if the current role is allowed on
//     this page only in view-only mode. Pages that care should consult this
//     when wiring up edit/delete buttons.
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Role definitions
  // ---------------------------------------------------------------------------
  const ROLES = {
    coy:      { name: 'Coy Needham (Owner)', password: 'coyneedham', cls: 'coy'      },
    designer: { name: 'Graphic Designer',    password: 'Graphic',    cls: 'designer' },
    admin:    { name: 'Executive Admin',     password: 'Admin',      cls: 'admin'    },
    employee: { name: 'Employee',            password: 'Burlebo',    cls: 'employee' },
  };

  // ---------------------------------------------------------------------------
  // Access matrix — keys are page paths, values describe per-role access.
  //   'edit'       → full access
  //   'view'       → access, but in view-only mode (page should consult isViewOnly)
  //   undefined    → no access (will show denied panel + redirect)
  //
  // For paths, we normalize: '/' → '/index.html', strip trailing slashes.
  // ---------------------------------------------------------------------------
  const ACCESS = {
    '/index.html':          { coy: 'edit', designer: 'edit', admin: 'view', employee: 'view' }, // Tracker
    '/dashboard.html':      { coy: 'edit',                   admin: 'edit'                   },
    '/todo.html':           { coy: 'edit'                                                    },
    '/settings.html':       { coy: 'edit'                                                    },
    '/upload.html':         { coy: 'edit',                   admin: 'edit'                   },
    '/inventory.html':      { coy: 'edit',                   admin: 'edit', employee: 'edit' },
    '/shipment.html':       { coy: 'edit',                   admin: 'edit', employee: 'edit' },
    '/analytics.html':      { coy: 'edit',                   admin: 'edit', employee: 'edit' },
    '/sku.html':            { coy: 'edit',                   admin: 'edit', employee: 'edit' },
    '/snapshot.html':       { coy: 'edit',                   admin: 'edit'                   },
    '/goal.html':           { coy: 'edit',                   admin: 'edit'                   },
    '/ads.html':            { coy: 'edit',                   admin: 'edit'                   },
    '/cannibalization.html':{ coy: 'edit',                   admin: 'edit'                   },
    '/profit.html':         { coy: 'edit',                   admin: 'edit'                   },
    '/report.html':         { coy: 'edit',                   admin: 'edit'                   },
    '/lookout.html':        { coy: 'edit',                   admin: 'edit'                   },
  };

  // Where to redirect a denied role. Falls back to '/index.html'.
  const HOME_FOR_ROLE = {
    coy:      '/dashboard.html',
    admin:    '/dashboard.html',
    designer: '/index.html',
    employee: '/index.html',
  };

  // ---------------------------------------------------------------------------
  // sessionStorage helpers
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'burlebo_role';
  function loadStoredRole() {
    try {
      const r = sessionStorage.getItem(STORAGE_KEY);
      return (r && ROLES[r]) ? r : null;
    } catch { return null; }
  }
  function saveStoredRole(r) {
    try { sessionStorage.setItem(STORAGE_KEY, r); } catch {}
  }
  function clearStoredRole() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function currentPath() {
    let p = window.location.pathname.replace(/\/+$/, '');
    if (p === '' || p === '/') return '/index.html';
    return p;
  }

  function accessFor(role, path) {
    const entry = ACCESS[path];
    if (!entry) return 'edit'; // pages not listed are open (won't normally happen)
    return entry[role] || null;
  }

  // ---------------------------------------------------------------------------
  // Public state
  // ---------------------------------------------------------------------------
  let pendingRole = null;
  let redirectTimer = null;

  const AuthApp = {
    role: null,
    access: null, // 'edit' | 'view'
    isViewOnly() { return this.access === 'view'; },
    isAllowed(role, path) { return accessFor(role, path || currentPath()) != null; },
    logout() {
      clearStoredRole();
      window.location.reload();
    },
  };
  window.AuthApp = AuthApp;

  // ---------------------------------------------------------------------------
  // CSS — injected once so every page gets the modal + denied styles
  // ---------------------------------------------------------------------------
  const CSS = `
    .auth-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000;
      font-family: 'DM Sans', system-ui, sans-serif;
    }
    .auth-card {
      background: var(--panel, #14171c);
      border: 1px solid var(--border, #252a33);
      border-radius: var(--radius, 10px);
      padding: 28px; width: 380px; max-width: calc(100vw - 32px);
      color: var(--text, #e8eaed);
    }
    .auth-title { font-size: 18px; font-weight: 700; margin: 0 0 6px 0; }
    .auth-sub   { font-size: 13px; color: var(--text-dim, #8a92a0); margin: 0 0 20px 0; }
    .auth-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .auth-option {
      background: var(--panel-2, #1a1e25);
      border: 1px solid var(--border, #252a33);
      color: var(--text, #e8eaed);
      padding: 13px 14px;
      border-radius: var(--radius-sm, 6px);
      font-family: inherit; font-size: 14px; font-weight: 500;
      text-align: left; cursor: pointer;
      display: flex; align-items: center; gap: 10px;
    }
    .auth-option:hover { background: #1f242c; border-color: #2f3540; }
    .auth-option .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .auth-option .dot.coy      { background: var(--coy, #ff6b35); }
    .auth-option .dot.designer { background: var(--designer, #a78bfa); }
    .auth-option .dot.admin    { background: var(--admin, #4ade80); }
    .auth-option .dot.employee { background: var(--employee, #38bdf8); }

    .auth-pw { display: none; margin-top: 8px; }
    .auth-pw input {
      width: 100%; padding: 11px 12px;
      font-family: 'DM Sans', sans-serif; font-size: 14px;
      background: var(--bg, #0d0f12); color: var(--text, #e8eaed);
      border: 1px solid var(--border, #252a33);
      border-radius: var(--radius-sm, 6px);
      outline: none; margin-bottom: 8px; box-sizing: border-box;
    }
    .auth-pw input:focus { border-color: var(--accent, #ff6b35); }
    .auth-err { display: none; font-size: 12px; color: var(--red, #f87171); margin-bottom: 8px; }
    .auth-pw-row { display: flex; gap: 8px; }
    .auth-btn {
      flex: 1; padding: 10px 14px;
      font-family: inherit; font-size: 13px; font-weight: 600;
      border-radius: var(--radius-sm, 6px); cursor: pointer;
      border: 1px solid var(--border, #252a33);
    }
    .auth-btn.ghost   { background: transparent; color: var(--text, #e8eaed); }
    .auth-btn.primary { background: var(--accent, #ff6b35); color: white; border-color: var(--accent, #ff6b35); }
    .auth-btn.ghost:hover   { background: var(--panel-2, #1a1e25); }
    .auth-btn.primary:hover { opacity: 0.92; }

    /* Denied panel */
    .auth-denied {
      max-width: 480px; margin: 80px auto; text-align: center;
      background: var(--panel, #14171c);
      border: 1px solid var(--border, #252a33);
      border-radius: var(--radius, 10px);
      padding: 36px 28px;
      font-family: 'DM Sans', system-ui, sans-serif;
      color: var(--text, #e8eaed);
    }
    .auth-denied .icon {
      width: 56px; height: 56px; margin: 0 auto 16px;
      border-radius: 50%; background: rgba(248,113,113,0.12);
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
    }
    .auth-denied h3 { font-size: 17px; font-weight: 700; margin: 0 0 8px 0; }
    .auth-denied p  { font-size: 14px; color: var(--text-dim, #8a92a0); margin: 0 0 18px 0; line-height: 1.5; }
    .auth-denied .countdown { font-size: 12px; color: var(--text-dim, #8a92a0); margin-top: 14px; }
    .auth-denied .actions { display: flex; gap: 8px; justify-content: center; }
  `;

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Modal & denied-panel HTML builders
  // ---------------------------------------------------------------------------
  function buildModalHtml() {
    return `
      <div class="auth-overlay" id="auth-modal">
        <div class="auth-card">
          <div class="auth-title">Burlebo Analytics</div>
          <div class="auth-sub" id="auth-modal-sub">Choose your role to get started.</div>
          <div class="auth-options" id="auth-role-options">
            <button class="auth-option" data-role="coy">      <span class="dot coy"></span>      Coy Needham (Owner) </button>
            <button class="auth-option" data-role="designer"> <span class="dot designer"></span> Graphic Designer    </button>
            <button class="auth-option" data-role="admin">    <span class="dot admin"></span>    Executive Admin     </button>
            <button class="auth-option" data-role="employee"> <span class="dot employee"></span> Employee            </button>
          </div>
          <div class="auth-pw" id="auth-pw-field">
            <input id="auth-pw-input" type="password" placeholder="Enter password" autocomplete="current-password">
            <div class="auth-err" id="auth-pw-err">Incorrect password.</div>
            <div class="auth-pw-row">
              <button class="auth-btn ghost"   id="auth-pw-back">Back</button>
              <button class="auth-btn primary" id="auth-pw-go">Continue</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildDeniedHtml(role, homePath, seconds) {
    const roleLabel = ROLES[role]?.name || role;
    return `
      <div class="auth-denied">
        <div class="icon">🔒</div>
        <h3>Access restricted</h3>
        <p>${roleLabel} doesn't have access to this page.<br>Redirecting you to your home page…</p>
        <div class="actions">
          <button class="auth-btn ghost"   id="auth-denied-logout">Switch role</button>
          <button class="auth-btn primary" id="auth-denied-go" data-target="${homePath}">Go now</button>
        </div>
        <div class="countdown" id="auth-denied-count">Redirecting in ${seconds}s…</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Modal flow
  // ---------------------------------------------------------------------------
  function showModal() {
    const container = document.createElement('div');
    container.id = 'auth-modal-host';
    container.innerHTML = buildModalHtml();
    document.body.appendChild(container);

    // Wire role buttons
    container.querySelectorAll('.auth-option').forEach(btn => {
      btn.addEventListener('click', () => pickRole(btn.dataset.role));
    });
    document.getElementById('auth-pw-back').addEventListener('click', cancelPw);
    document.getElementById('auth-pw-go').addEventListener('click', checkPw);
    const input = document.getElementById('auth-pw-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkPw();
      else if (e.key === 'Escape') cancelPw();
    });
  }

  function pickRole(r) {
    pendingRole = r;
    document.getElementById('auth-modal-sub').textContent = `Enter password for ${ROLES[r].name}.`;
    document.getElementById('auth-role-options').style.display = 'none';
    document.getElementById('auth-pw-field').style.display = 'block';
    const input = document.getElementById('auth-pw-input');
    input.value = '';
    document.getElementById('auth-pw-err').style.display = 'none';
    input.focus();
  }

  function cancelPw() {
    pendingRole = null;
    document.getElementById('auth-modal-sub').textContent = 'Choose your role to get started.';
    document.getElementById('auth-role-options').style.display = 'flex';
    document.getElementById('auth-pw-field').style.display = 'none';
  }

  function checkPw() {
    if (!pendingRole) return;
    const val = document.getElementById('auth-pw-input').value;
    if (val === ROLES[pendingRole].password) {
      const path = currentPath();
      const acc = accessFor(pendingRole, path);
      saveStoredRole(pendingRole);
      // Tear down the modal
      const host = document.getElementById('auth-modal-host');
      if (host) host.remove();

      if (acc) {
        completeAuth(pendingRole, acc);
      } else {
        // Logged in but not allowed here — show denied + redirect
        showDenied(pendingRole);
      }
      pendingRole = null;
    } else {
      document.getElementById('auth-pw-err').style.display = 'block';
      const input = document.getElementById('auth-pw-input');
      input.value = '';
      input.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Denied panel flow
  // ---------------------------------------------------------------------------
  function showDenied(role) {
    const home = HOME_FOR_ROLE[role] || '/index.html';
    let seconds = 3;

    // Hide existing app shell so user doesn't briefly see the page they
    // can't access while the countdown runs.
    const header = document.getElementById('app-header');
    const main   = document.getElementById('app-main');
    if (header) header.style.display = 'none';
    if (main)   main.classList.add('hidden');

    const host = document.createElement('div');
    host.id = 'auth-denied-host';
    host.innerHTML = buildDeniedHtml(role, home, seconds);
    document.body.appendChild(host);

    const countEl = document.getElementById('auth-denied-count');
    redirectTimer = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(redirectTimer);
        window.location.href = home;
      } else {
        countEl.textContent = `Redirecting in ${seconds}s…`;
      }
    }, 1000);

    document.getElementById('auth-denied-logout').addEventListener('click', () => {
      clearInterval(redirectTimer);
      AuthApp.logout();
    });
    document.getElementById('auth-denied-go').addEventListener('click', () => {
      clearInterval(redirectTimer);
      window.location.href = home;
    });
  }

  // ---------------------------------------------------------------------------
  // Completion — page gets to do its thing
  // ---------------------------------------------------------------------------
  function completeAuth(role, access) {
    AuthApp.role = role;
    AuthApp.access = access;

    // Style the role pill if the page has one
    const pill = document.getElementById('role-pill');
    if (pill) {
      pill.className = 'role-pill ' + ROLES[role].cls;
      pill.textContent = ROLES[role].name + (access === 'view' ? ' (view)' : '') + ' ✕';
      // Make sure it logs out on click — pages may already have onclick="logout()"
      // wired to a local function. We attach a defensive backup.
      if (!pill.dataset.authBound) {
        pill.addEventListener('click', AuthApp.logout);
        pill.dataset.authBound = '1';
      }
    }

    // Reveal app shell if hidden
    const header = document.getElementById('app-header');
    const main   = document.getElementById('app-main');
    if (header && getComputedStyle(header).display === 'none') header.style.display = 'flex';
    if (main && main.classList.contains('hidden')) main.classList.remove('hidden');

    // Notify the page in two ways: a custom event AND, if present, a global hook.
    try { window.dispatchEvent(new CustomEvent('authReady', { detail: { role, access } })); } catch {}
    if (typeof window.onAuthReady === 'function') {
      try { window.onAuthReady(role, access); } catch (e) { console.error('onAuthReady error:', e); }
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    injectStyles();

    const stored = loadStoredRole();
    if (!stored) {
      showModal();
      return;
    }
    const path = currentPath();
    const acc = accessFor(stored, path);
    if (acc) {
      completeAuth(stored, acc);
    } else {
      showDenied(stored);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
