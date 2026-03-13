// ================================================================
//  EPORIA ADMIN — DASHBOARD  (public/js/admin-dashboard.js)
// ================================================================

async function loadStats() {
    try {
        const res = await fetch('/admin/api/stats', { headers: AdminAuth.authHeaders() });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) { AdminAuth.logout(); return; }
            throw new Error('stats failed');
        }
        const d = await res.json();
        document.getElementById('statPending').textContent    = d.pendingCount        ?? 0;
        document.getElementById('statPriority').textContent   = d.highPriorityCount   ?? 0;
        document.getElementById('statApproved').textContent   = d.approvedTodayCount  ?? 0;
        document.getElementById('statUsers').textContent      = d.totalUsers           ?? 0;
        document.getElementById('statAvgTime').textContent    = (d.avgReviewTime ?? 0) + 'D';
        document.getElementById('statLicensing').textContent  = d.needsLicensingFollowUp ?? 0;
    } catch (e) {
        Toast.error('Failed to load stats');
    }
}

async function loadUnreadMessages() {
    try {
        const res = await fetch('/admin/api/messages/unread-count', { headers: AdminAuth.authHeaders() });
        if (!res.ok) return;
        const d = await res.json();
        document.getElementById('statMessages').textContent = d.count ?? 0;
    } catch { /* silent */ }
}

bootAdminPage(async () => {
    await loadStats();
    await loadUnreadMessages();
    setInterval(loadStats, 30000);
});