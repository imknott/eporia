/* public/javascripts/analyticsStudio.js
 *
 * Full analytics view for the artist studio.
 * Covers: revenue trend, income breakdown (tips / allocations / merch),
 *         top songs by likes, and per-item merch sales table.
 *
 * Wired in by artistStudio.js:
 *   if (viewId === 'analytics') window.initAnalyticsView?.();
 *
 * Backend endpoints:
 *   GET /artist/api/studio/analytics/overview    (Turso — revenue trend + income breakdown)
 *   GET /artist/api/studio/merch-analytics       (Turso — per-item merch, reuses payments endpoint)
 *   GET /artist/api/studio/analytics/top-songs   (Firestore — songs ordered by likes)
 */

import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { app }     from './firebase-config.js';

const auth = getAuth(app);

// ── helpers ──────────────────────────────────────────────────────────────────

async function authHeaders(json = false) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

function fmt(dollars) {
    return '$' + parseFloat(dollars || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── state ─────────────────────────────────────────────────────────────────────
let _initialized = false;

// ── period selector ───────────────────────────────────────────────────────────

function getPeriod() {
    return document.getElementById('analyticsPeriodSelect')?.value || '30';
}

// ── Revenue overview (trend + breakdown) ─────────────────────────────────────

async function loadOverview() {
    const period  = getPeriod();
    const headers = await authHeaders();

    const res = await fetch(`/artist/api/studio/analytics/overview?period=${period}`, { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function renderSummaryCards(data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('analyticsRevenue',     fmt(data.totalRevenueDollars));
    set('analyticsTips',        fmt(data.tipsDollars));
    set('analyticsAllocations', fmt(data.allocationsDollars));
    set('analyticsMerchRev',    fmt(data.merchDollars));
    set('analyticsTotalTx',     data.totalTransactions);
}

function renderTrendChart(trend) {
    const wrap = document.getElementById('analyticsTrendBars');
    if (!wrap) return;

    if (!trend || trend.length === 0) {
        wrap.innerHTML = `<div class="analytics-empty">No revenue data yet for this period.</div>`;
        return;
    }

    const maxVal = Math.max(...trend.map(t => parseFloat(t.revenueDollars)), 1);

    wrap.innerHTML = trend.map(t => {
        const pct   = Math.max((parseFloat(t.revenueDollars) / maxVal) * 100, 2);
        const month = new Date(`${t.month}-01`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return `<div class="analytics-bar-wrap" title="${month}: ${fmt(t.revenueDollars)} · ${t.txCount} transactions">
            <div class="analytics-bar" style="height:${pct}%"></div>
            <div class="analytics-bar-label">${month}</div>
        </div>`;
    }).join('');
}

function renderBreakdownDonut(data) {
    // Simple visual breakdown using CSS bar segments — no canvas needed
    const wrap = document.getElementById('analyticsBreakdown');
    if (!wrap) return;

    const total = parseFloat(data.totalRevenueDollars) || 1;
    const segments = [
        { label: 'Allocations', value: parseFloat(data.allocationsDollars), color: '#88C9A1' },
        { label: 'Tips',        value: parseFloat(data.tipsDollars),        color: '#F4A261' },
        { label: 'Merch',       value: parseFloat(data.merchDollars),       color: '#74B3CE' },
    ].filter(s => s.value > 0);

    if (segments.length === 0) {
        wrap.innerHTML = `<div class="analytics-empty">No income data yet.</div>`;
        return;
    }

    wrap.innerHTML = segments.map(s => {
        const pct = Math.round((s.value / total) * 100);
        return `<div class="analytics-breakdown-row">
            <div class="analytics-breakdown-bar-wrap">
                <div class="analytics-breakdown-label">${s.label}</div>
                <div class="analytics-breakdown-track">
                    <div class="analytics-breakdown-fill" style="width:${pct}%;background:${s.color}"></div>
                </div>
            </div>
            <div class="analytics-breakdown-meta">
                <span class="analytics-breakdown-pct">${pct}%</span>
                <span class="analytics-breakdown-amt">${fmt(s.value)}</span>
            </div>
        </div>`;
    }).join('');
}

// ── Top songs by likes ─────────────────────────────────────────────────────────

async function loadTopSongs() {
    const headers = await authHeaders();
    const res = await fetch('/artist/api/studio/analytics/top-songs', { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function renderTopSongs(songs) {
    const wrap = document.getElementById('analyticsTopSongs');
    if (!wrap) return;

    if (!songs || songs.length === 0) {
        wrap.innerHTML = `<div class="analytics-empty">No songs uploaded yet.</div>`;
        return;
    }

    wrap.innerHTML = songs.map((s, i) => {
        const rankColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--text-secondary)';
        return `<div class="analytics-song-row">
            <div class="analytics-song-rank" style="color:${rankColor}">${i + 1}</div>
            <img class="analytics-song-art" src="${esc(s.artUrl || '')}" onerror="this.style.display='none'">
            <div class="analytics-song-info">
                <div class="analytics-song-title">${esc(s.title)}</div>
                <div class="analytics-song-meta">
                    ${s.album ? `<span>${esc(s.album)}</span> · ` : ''}
                    <span>${s.genre || ''}</span>
                </div>
            </div>
            <div class="analytics-song-stats">
                <div class="analytics-stat-pill"><i class="fas fa-heart"></i> ${s.likes || 0}</div>
                <div class="analytics-stat-pill"><i class="fas fa-play"></i> ${s.plays || 0}</div>
            </div>
        </div>`;
    }).join('');
}

// ── Merch per-item table (reuses /merch-analytics endpoint) ──────────────────

async function loadMerchTable() {
    const period  = getPeriod();
    const headers = await authHeaders();
    const res = await fetch(`/artist/api/studio/merch-analytics?period=${period}`, { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function renderMerchTable(data) {
    const tbody = document.getElementById('analyticsMerchTableBody');
    if (!tbody) return;

    if (!data.items || data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="analytics-empty">No merch sales yet for this period.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.items.map((item, i) => {
        const avg = item.saleCount > 0
            ? fmt(item.revenueCents / item.saleCount / 100)
            : '—';
        const badge = i === 0
            ? `<span class="analytics-best-badge">BEST SELLER</span>`
            : '';
        const photo = item.photo
            ? `<img src="${esc(item.photo)}" style="width:34px;height:34px;border-radius:7px;object-fit:cover;margin-right:10px;flex-shrink:0;">`
            : `<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,0.06);margin-right:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shopping-bag" style="font-size:0.75rem;color:var(--text-secondary)"></i></div>`;
        return `<tr>
            <td><div style="display:flex;align-items:center">${photo}<div><span style="font-weight:700;">${esc(item.name)}</span>${badge}</div></div></td>
            <td><span class="hits-cat-tag">${esc(item.category || '—')}</span></td>
            <td style="font-weight:700">${item.saleCount}</td>
            <td style="text-align:right;font-weight:800;color:var(--primary);font-family:'Nunito',sans-serif">${fmt(item.revenueDollars)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${avg}</td>
        </tr>`;
    }).join('');
}

// ── Recent transactions feed ──────────────────────────────────────────────────

async function loadRecentTransactions() {
    const headers = await authHeaders();
    const res = await fetch('/artist/api/studio/analytics/transactions', { headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function renderRecentTransactions(txs) {
    const wrap = document.getElementById('analyticsRecentTx');
    if (!wrap) return;

    if (!txs || txs.length === 0) {
        wrap.innerHTML = `<div class="analytics-empty">No transactions yet.</div>`;
        return;
    }

    const TYPE_META = {
        artist_payout:      { icon: 'fa-hand-holding-heart', label: 'Tip',        color: '#F4A261' },
        monthly_allocation: { icon: 'fa-chart-pie',           label: 'Allocation', color: '#88C9A1' },
        merch_sale:         { icon: 'fa-shopping-bag',        label: 'Merch Sale', color: '#74B3CE' },
    };

    wrap.innerHTML = txs.map(tx => {
        const meta = TYPE_META[tx.type] || { icon: 'fa-circle', label: tx.type, color: 'var(--text-secondary)' };
        const date = new Date(tx.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="analytics-tx-row">
            <div class="analytics-tx-icon" style="background:${meta.color}22;color:${meta.color}">
                <i class="fas ${meta.icon}"></i>
            </div>
            <div class="analytics-tx-info">
                <div class="analytics-tx-label">${meta.label}</div>
                <div class="analytics-tx-date">${date}</div>
            </div>
            <div class="analytics-tx-amount">+${fmt(tx.amountDollars)}</div>
        </div>`;
    }).join('');
}

// ── Main init ─────────────────────────────────────────────────────────────────

async function initAnalyticsView() {
    // Show loading states immediately
    const skeletonIds = [
        'analyticsRevenue', 'analyticsTips', 'analyticsAllocations',
        'analyticsMerchRev', 'analyticsTotalTx'
    ];
    skeletonIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '...';
    });

    // Fire all four fetches in parallel
    const [overview, songs, merch, txs] = await Promise.allSettled([
        loadOverview(),
        loadTopSongs(),
        loadMerchTable(),
        loadRecentTransactions(),
    ]);

    if (overview.status === 'fulfilled') {
        renderSummaryCards(overview.value);
        renderTrendChart(overview.value.trend);
        renderBreakdownDonut(overview.value);
    } else {
        console.error('[analytics] overview error:', overview.reason);
        ['analyticsTrendBars', 'analyticsBreakdown'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<div class="analytics-empty" style="color:var(--danger)">Failed to load data.</div>`;
        });
    }

    if (songs.status === 'fulfilled') renderTopSongs(songs.value.songs);
    else {
        const el = document.getElementById('analyticsTopSongs');
        if (el) el.innerHTML = `<div class="analytics-empty" style="color:var(--danger)">Failed to load songs.</div>`;
    }

    if (merch.status === 'fulfilled') renderMerchTable(merch.value);
    else {
        const el = document.getElementById('analyticsMerchTableBody');
        if (el) el.innerHTML = `<tr><td colspan="5" class="analytics-empty" style="color:var(--danger)">Failed to load merch data.</td></tr>`;
    }

    if (txs.status === 'fulfilled') renderRecentTransactions(txs.value.transactions);
    else {
        const el = document.getElementById('analyticsRecentTx');
        if (el) el.innerHTML = `<div class="analytics-empty" style="color:var(--danger)">Failed to load transactions.</div>`;
    }
}

// Period select handler — reload everything on change
window.reloadAnalytics = () => initAnalyticsView();

// Expose so artistStudio.js switchView can call it
window.initAnalyticsView = initAnalyticsView;