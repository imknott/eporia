// ================================================================
//  EPORIA ADMIN — GUEST MESSAGES INBOX  (public/js/admin-messages.js)
// ================================================================

let conversations = [];
let activeConvId  = null;
let activeFilter  = 'all';

// ── Load conversation list ────────────────────────────────────
async function loadConversations(filter = 'all') {
    try {
        const url = `/admin/api/messages?filter=${filter}&limit=100`;
        const res = await fetch(url, { headers: AdminAuth.authHeaders() });
        if (!res.ok) throw new Error('fetch failed');
        const d = await res.json();
        conversations = d.conversations || [];
        renderConvList();
        updateInboxStats();
    } catch {
        Toast.error('Failed to load conversations');
    }
}

function updateInboxStats() {
    const unread  = conversations.filter(c => !c.isRead).length;
    const open    = conversations.filter(c => c.status === 'open').length;
    const replied = conversations.filter(c => c.status === 'replied').length;

    const el = document.getElementById('inboxStats');
    if (el) {
        el.textContent = `${unread} UNREAD  //  ${open} OPEN  //  ${replied} REPLIED`;
    }

    // Update badge in nav
    const badge = document.getElementById('msgNavBadge');
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
}

function renderConvList() {
    const container = document.getElementById('convList');
    if (!conversations.length) {
        container.innerHTML = `
            <div class="empty-state" style="padding:40px">
                <i class="fas fa-comment-slash"></i>
                <h3>No Messages</h3>
                <p>No guest conversations yet.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    conversations.forEach(conv => {
        const item = document.createElement('div');
        const isActive  = conv.id === activeConvId;
        const isUnread  = !conv.isRead;
        item.className  = `conv-item ${isActive ? 'active' : ''} ${isUnread ? 'unread' : ''}`;
        item.dataset.id = conv.id;

        const lastMsg = conv.messages?.[conv.messages.length - 1];
        const preview = lastMsg?.text?.substring(0, 60) + (lastMsg?.text?.length > 60 ? '...' : '') || '--';

        item.innerHTML = `
            <div class="conv-item-top">
                <span class="conv-guest-name">
                    ${isUnread ? '<i class="fas fa-circle" style="color:var(--mg);font-size:.4rem;margin-right:5px;"></i>' : ''}
                    ${conv.guestName || 'GUEST_' + conv.id.substring(0,6).toUpperCase()}
                </span>
                <span class="conv-time">${timeAgo(conv.lastMessageAt)}</span>
            </div>
            <div class="conv-preview">${preview}</div>
            <div class="conv-tags">
                <span class="conv-tag ${conv.isRead ? 'replied' : 'unread'}">${conv.isRead ? 'READ' : 'UNREAD'}</span>
                <span class="conv-tag ${conv.status}">${conv.status?.toUpperCase() || 'OPEN'}</span>
                ${conv.questionTopic ? `<span class="conv-tag topic">${conv.questionTopic.toUpperCase()}</span>` : ''}
            </div>
        `;

        item.addEventListener('click', () => selectConversation(conv.id));
        container.appendChild(item);
    });
}

// ── Select a conversation ─────────────────────────────────────
async function selectConversation(id) {
    activeConvId = id;

    // Highlight in list
    document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });

    // Load full conversation
    try {
        const res = await fetch(`/admin/api/messages/${id}`, { headers: AdminAuth.authHeaders() });
        if (!res.ok) throw new Error('fetch failed');
        const conv = await res.json();
        renderConvDetail(conv);

        // Mark as read
        if (!conv.isRead) {
            await fetch(`/admin/api/messages/${id}/read`, {
                method: 'PATCH',
                headers: AdminAuth.authHeaders()
            });
            // Update local state
            const local = conversations.find(c => c.id === id);
            if (local) { local.isRead = true; }
            renderConvList();
            updateInboxStats();
        }
    } catch {
        Toast.error('Failed to load conversation');
    }
}

function renderConvDetail(conv) {
    const panel = document.getElementById('convDetail');

    panel.innerHTML = `
        <div class="conv-detail-header">
            <div>
                <div class="page-title" style="font-size:.85rem; margin-bottom:4px;">
                    ${conv.guestName || 'ANONYMOUS GUEST'}
                </div>
                <div class="conv-detail-meta">
                    ${conv.guestEmail ? `<span class="conv-detail-meta-item"><i class="fas fa-envelope"></i>${conv.guestEmail}</span>` : ''}
                    <span class="conv-detail-meta-item"><i class="fas fa-clock"></i>STARTED ${timeAgo(conv.createdAt)}</span>
                    <span class="conv-detail-meta-item"><i class="fas fa-comment"></i>${conv.messages?.length || 0} MESSAGES</span>
                    ${conv.questionTopic ? `<span class="conv-detail-meta-item"><i class="fas fa-tag"></i>${conv.questionTopic.toUpperCase()}</span>` : ''}
                    <span class="conv-detail-meta-item"><i class="fas fa-globe"></i>${conv.source?.toUpperCase() || 'LANDING'}</span>
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <span class="conv-tag ${conv.status}" style="padding:5px 10px;">${conv.status?.toUpperCase()}</span>
                <button class="btn-ghost btn-sm" onclick="closeConversation('${conv.id}')">
                    <i class="fas fa-archive"></i> Close
                </button>
            </div>
        </div>

        <div class="conv-messages-scroll" id="convMsgs">
            ${(conv.messages || []).map(m => renderMessageRow(m)).join('')}
        </div>

        <div class="reply-box">
            <div class="reply-box-header">
                <i class="fas fa-terminal" style="margin-right:6px;color:var(--cy)"></i>
                COMPOSE REPLY // ${conv.guestEmail ? 'REPLY WILL BE SENT TO ' + conv.guestEmail : 'NO EMAIL — INTERNAL NOTE ONLY'}
            </div>
            <textarea class="reply-textarea" id="replyText" placeholder="Type your response..."></textarea>
            <div class="reply-actions">
                <span class="reply-status-note" id="replyStatus"></span>
                <button class="btn-cy btn-sm" onclick="sendReply('${conv.id}')">
                    <i class="fas fa-paper-plane"></i> SEND REPLY
                </button>
            </div>
        </div>
    `;

    // Scroll messages to bottom
    const msgArea = document.getElementById('convMsgs');
    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
}

function renderMessageRow(msg) {
    const isAdmin = msg.role === 'admin';
    return `
        <div class="msg-row ${isAdmin ? 'admin-msg' : ''}">
            <div class="msg-av ${isAdmin ? 'admin-av' : 'guest-av'}">${isAdmin ? 'EP' : 'G'}</div>
            <div class="msg-bubble">
                <span class="msg-sender">${isAdmin ? 'EPORIA://ADMIN' : 'GUEST://USER'}</span>
                <div class="msg-text">${escapeHtml(msg.text)}</div>
                <div class="msg-ts">${fmtDate(msg.timestamp)}</div>
            </div>
        </div>
    `;
}

// ── Send reply ───────────────────────────────────────────────
window.sendReply = async function(id) {
    const text = document.getElementById('replyText')?.value?.trim();
    if (!text) { Toast.error('Reply cannot be empty'); return; }

    const btn = document.querySelector(`[onclick="sendReply('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'SENDING...'; }

    const statusEl = document.getElementById('replyStatus');
    if (statusEl) statusEl.textContent = 'Sending...';

    try {
        const res = await fetch(`/admin/api/messages/${id}/reply`, {
            method: 'POST',
            headers: { ...AdminAuth.authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!res.ok) throw new Error('reply failed');

        Toast.success('Reply sent');
        // Reload the conversation to show new message
        await selectConversation(id);
        // Also refresh list to update timestamp/status
        await loadConversations(activeFilter);

    } catch {
        Toast.error('Failed to send reply');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> SEND REPLY'; }
        if (statusEl) statusEl.textContent = '';
    }
};

// ── Close conversation ────────────────────────────────────────
window.closeConversation = async function(id) {
    try {
        await fetch(`/admin/api/messages/${id}/close`, {
            method: 'PATCH',
            headers: AdminAuth.authHeaders()
        });
        Toast.success('Conversation closed');
        await loadConversations(activeFilter);
        // Re-render detail with updated status
        await selectConversation(id);
    } catch { Toast.error('Failed to close conversation'); }
};

// ── Filter tabs ───────────────────────────────────────────────
document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        activeConvId = null;
        document.getElementById('convDetail').innerHTML = `
            <div class="conv-no-selection" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--txt3)">
                <i class="fas fa-comments" style="font-size:2rem;color:var(--bdr3)"></i>
                <p style="font-family:'Share Tech Mono',monospace;font-size:.68rem;letter-spacing:2px">SELECT A CONVERSATION</p>
            </div>`;
        loadConversations(activeFilter);
    });
});

// ── Util ─────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

// ── Boot ─────────────────────────────────────────────────────
bootAdminPage(async () => {
    await loadConversations('all');
    setInterval(() => loadConversations(activeFilter), 60000);
});