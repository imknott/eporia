// ================================================================
//  EPORIA ADMIN — COMMON UTILITIES  (public/js/admin-common.js)
//  Loaded on every admin page.
// ================================================================

// ── Auth helpers ──────────────────────────────────────────────
const AdminAuth = {
    getToken() { return sessionStorage.getItem('adminToken'); },

    requireAuth() {
        if (!this.getToken()) {
            window.location.href = '/admin/login';
            return false;
        }
        return true;
    },

    authHeaders() {
        return { 'Authorization': `Bearer ${this.getToken()}` };
    },

    async verify() {
        try {
            const res = await fetch('/admin/api/verify', { headers: this.authHeaders() });
            if (!res.ok) throw new Error('verify failed');
            return await res.json();
        } catch {
            sessionStorage.clear();
            window.location.href = '/admin/login';
            return null;
        }
    },

    logout() {
        sessionStorage.clear();
        window.location.href = '/admin/login';
    }
};

// ── Toast notifications ───────────────────────────────────────
const Toast = {
    show(message, type = 'info', duration = 4000) {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-triangle' : type === 'success' ? 'check' : 'info-circle'}" style="margin-right:8px"></i>${message}`;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, duration);
    },

    success(msg) { this.show(msg, 'success'); },
    error(msg)   { this.show(msg, 'error'); },
    info(msg)    { this.show(msg, 'info'); }
};

// ── Nav badge updater ─────────────────────────────────────────
async function updateNavBadges() {
    try {
        const res = await fetch('/admin/api/messages/unread-count', {
            headers: AdminAuth.authHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        const badge = document.getElementById('msgNavBadge');
        if (badge) {
            if (data.count > 0) {
                badge.textContent = data.count > 99 ? '99+' : data.count;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch { /* silent */ }
}

// ── Page boot ────────────────────────────────────────────────
async function bootAdminPage(onReady) {
    if (!AdminAuth.requireAuth()) return;

    const userData = await AdminAuth.verify();
    if (!userData) return;

    // Populate nav user info
    const nameEl = document.getElementById('navUserName');
    const roleEl = document.getElementById('navUserRole');
    if (nameEl) nameEl.textContent = userData.user?.email || 'ADMIN';
    if (roleEl) roleEl.textContent = userData.user?.role?.toUpperCase() || 'ADMINISTRATOR';

    // Show page, hide loader
    const loader = document.getElementById('loadingScreen');
    const main   = document.getElementById('mainContent');
    if (loader) loader.style.display = 'none';
    if (main)   main.style.display   = 'block';

    // Wire logout button
    document.querySelectorAll('.btn-logout').forEach(btn => {
        btn.addEventListener('click', () => AdminAuth.logout());
    });

    // Fetch nav badges
    await updateNavBadges();
    setInterval(updateNavBadges, 30000);

    if (onReady) await onReady(userData);
}

// ── Time formatting ───────────────────────────────────────────
function timeAgo(dateStr) {
    if (!dateStr) return 'UNKNOWN';
    const now  = new Date();
    const then = new Date(dateStr);
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60)   return `${diff}S AGO`;
    if (diff < 3600) return `${Math.floor(diff/60)}M AGO`;
    if (diff < 86400)return `${Math.floor(diff/3600)}H AGO`;
    return `${Math.floor(diff/86400)}D AGO`;
}

function fmtDate(dateStr) {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}