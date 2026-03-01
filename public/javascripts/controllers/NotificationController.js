/* public/javascripts/controllers/NotificationController.js
 *
 * Handles the full notification lifecycle:
 *   - Fetches unread notifications on auth init
 *   - Renders them into #dropdownNotifList in right_sidebar.pug
 *   - Shows / hides the red badge on #profileNotifBadge
 *   - Marks a notification as read when clicked
 *   - Navigates to actionTarget on click (welcome, follow, etc.)
 *   - Polls every 60 seconds while the user is active
 *
 * Integration — in uiController.js:
 *
 *   import { NotificationController } from './controllers/NotificationController.js';
 *
 *   // inside constructor, alongside other sub-controllers:
 *   this.notificationController = new NotificationController(this);
 *
 *   // inside initAuthListener, after loadUserWallet():
 *   this.notificationController.init();
 */

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class NotificationController {
    constructor(mainUI) {
        this.mainUI   = mainUI;
        this.auth     = getAuth();
        this.notifications = [];
        this._pollTimer    = null;
        this.POLL_INTERVAL = 60_000;   // 60 s
    }

    // ─────────────────────────────────────────────────────────────
    // PUBLIC — call once from initAuthListener after user is known
    // ─────────────────────────────────────────────────────────────
    async init() {
        await this.fetchAndRender();
        this._startPolling();
    }

    // ─────────────────────────────────────────────────────────────
    // FETCH — GET /player/api/notifications
    // ─────────────────────────────────────────────────────────────
    async fetchAndRender() {
        try {
            const token = await this.auth.currentUser?.getIdToken();
            if (!token) return;

            const res  = await fetch('/player/api/notifications', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;

            const data = await res.json();
            this.notifications = data.notifications || [];
            this._renderList();
            this._updateBadge();
        } catch (e) {
            console.warn('[NotificationController] fetch failed:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // RENDER — populates #dropdownNotifList
    // ─────────────────────────────────────────────────────────────
    _renderList() {
        const list = document.getElementById('dropdownNotifList');
        if (!list) return;

        if (this.notifications.length === 0) {
            list.innerHTML = `
                <div style="padding:18px 15px; text-align:center; color:var(--text-muted); font-size:0.85rem;">
                    No new notifications
                </div>`;
            return;
        }

        list.innerHTML = this.notifications.map(n => this._renderItem(n)).join('');
    }

    // ─────────────────────────────────────────────────────────────
    // SINGLE ITEM — returns HTML string
    // ─────────────────────────────────────────────────────────────
    _renderItem(n) {
        const avatar = n.fromAvatar
            ? (this.mainUI.fixImageUrl ? this.mainUI.fixImageUrl(n.fromAvatar) : n.fromAvatar)
            : 'https://cdn.eporiamusic.com/assets/default-avatar.jpg';

        const timeAgo  = this._timeAgo(n.timestamp instanceof Date ? n.timestamp : new Date(n.timestamp));
        const isWelcome = n.type === 'welcome';
        const iconHtml  = isWelcome
            ? `<span style="font-size:1.1rem;">👋</span>`
            : `<img src="${avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">`;

        // Highlight the $amount in follow notifications if present
        const messageHtml = this._formatMessage(n.message);

        return `
        <div class="notif-item"
             data-id="${n.id}"
             data-target="${n.actionTarget || ''}"
             onclick="window.ui.notificationController.handleClick(this)"
             style="
                display:flex;
                align-items:flex-start;
                gap:10px;
                padding:12px 15px;
                cursor:pointer;
                border-bottom:1px solid var(--border-color);
                transition:background 0.15s;
                background:${isWelcome ? 'rgba(0,255,209,0.04)' : 'transparent'};
             "
             onmouseenter="this.style.background='rgba(255,255,255,0.04)'"
             onmouseleave="this.style.background='${isWelcome ? 'rgba(0,255,209,0.04)' : 'transparent'}'">

            <!-- Avatar or emoji icon -->
            <div style="flex-shrink:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
                ${iconHtml}
            </div>

            <!-- Text -->
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.82rem;color:var(--text-main);line-height:1.4;
                            white-space:normal;word-break:break-word;">
                    ${messageHtml}
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;">
                    ${timeAgo}
                </div>
            </div>

            <!-- Unread dot -->
            <div style="flex-shrink:0;width:7px;height:7px;border-radius:50%;
                        background:var(--primary);margin-top:5px;
                        box-shadow:0 0 6px var(--primary);">
            </div>
        </div>`;
    }

    // ─────────────────────────────────────────────────────────────
    // CLICK HANDLER — mark read + navigate
    // ─────────────────────────────────────────────────────────────
    async handleClick(el) {
        const notifId  = el.dataset.id;
        const target   = el.dataset.target;

        // Optimistic UI — remove the item and refresh badge
        this.notifications = this.notifications.filter(n => n.id !== notifId);
        this._renderList();
        this._updateBadge();

        // Navigate first so it feels instant
        if (target && window.navigateTo) {
            window.navigateTo(target);
        }

        // Mark read server-side (best-effort, non-blocking)
        try {
            const token = await this.auth.currentUser?.getIdToken();
            if (token) {
                fetch('/player/api/notifications/mark-read', {
                    method:  'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ notificationId: notifId })
                });
            }
        } catch (e) {
            console.warn('[NotificationController] mark-read failed:', e.message);
        }

        // Close the dropdown after navigating
        document.getElementById('profileDropdown')?.classList.remove('active');
    }

    // ─────────────────────────────────────────────────────────────
    // BADGE — shows count on #profileNotifBadge
    // ─────────────────────────────────────────────────────────────
    _updateBadge() {
        const badge = document.getElementById('profileNotifBadge');
        if (!badge) return;

        const count = this.notifications.length;
        if (count > 0) {
            badge.innerText = count > 9 ? '9+' : String(count);
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // ─────────────────────────────────────────────────────────────
    // POLLING — re-fetch every 60 s
    // ─────────────────────────────────────────────────────────────
    _startPolling() {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            if (this.auth.currentUser) this.fetchAndRender();
        }, this.POLL_INTERVAL);
    }

    _stopPolling() {
        if (this._pollTimer) clearInterval(this._pollTimer);
    }

    // ─────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────

    // Bolds the sender name in the notification message
    _formatMessage(msg) {
        if (!msg) return '';
        // Escape HTML first
        const escaped = msg
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // Bold @handle occurrences
        return escaped.replace(/(@\w+)/g, '<strong>$1</strong>');
    }

    _timeAgo(date) {
        if (!date) return '';
        const s = Math.floor((Date.now() - date.getTime()) / 1000);
        if (s < 60)      return 'just now';
        const m = Math.floor(s / 60);
        if (m < 60)      return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24)      return `${h}h ago`;
        const d = Math.floor(h / 24);
        return `${d}d ago`;
    }
}