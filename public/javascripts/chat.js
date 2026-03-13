// ================================================================
//  EPORIA — LANDING PAGE STICKY CHAT WIDGET
//  public/javascripts/chat.js
// ================================================================

'use strict';

// ── Session fingerprint ───────────────────────────────────────
function getOrCreateSessionId() {
    let id = sessionStorage.getItem('eporia_chat_session');
    if (!id) {
        id = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem('eporia_chat_session', id);
    }
    return id;
}

const SESSION_ID = getOrCreateSessionId();

// ── Polling state ─────────────────────────────────────────────
let conversationId    = null;
let pollInterval      = null;
let seenAdminMsgCount = 0;
let waitingForIan     = false;
const POLL_MS         = 6000;

// ── Backend: send message ─────────────────────────────────────
async function persistMessage(text, questionTopic = null) {
    try {
        const res = await fetch('/api/guest-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: SESSION_ID, text, questionTopic, source: 'landing_chat' })
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.conversationId || null;
    } catch (e) {
        console.warn('[eporia/chat] persist failed:', e.message);
        return null;
    }
}

// ── Backend: poll for Ian's replies ──────────────────────────
async function pollForReplies() {
    try {
        const res = await fetch(`/api/guest-poll/${SESSION_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        const adminMsgs = data.messages || [];
        if (adminMsgs.length > seenAdminMsgCount) {
            adminMsgs.slice(seenAdminMsgCount).forEach(msg => addIanMessage(msg.text));
            seenAdminMsgCount = adminMsgs.length;
        }
    } catch (e) { /* silent */ }
}

function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(pollForReplies, POLL_MS);
}

// ── FAQ definitions + auto-responses ─────────────────────────
// <highlight>…</highlight> → cyan   <accent>…</accent> → magenta
const FAQ = [
    {
        short: 'vs Spotify?',
        full:  'How is Eporia different from Spotify?',
        id:    'vs_spotify',
        auto:  `<highlight>Eporia vs Spotify</highlight> — the numbers don't lie.\n\nSpotify pays roughly <accent>$0.003–$0.005 per stream</accent>. To earn $80 you need roughly <highlight>26,000 streams</highlight>. On Eporia, <highlight>10 paying superfans</highlight> = the same $80 — directly in your pocket, every month.\n\nBeyond money:\n— No algorithm throttling your reach\n— No AI-generated filler competing with your work\n— No ads, ever\n— <accent>You're a co-op partner</accent>, not a data point\n— <highlight>Artists are never charged to earn</highlight> — our cut comes from fans, not you\n\nSpotify owns your relationship with your fans. Eporia gives it back to you.`
    },
    {
        short: 'How do artists get paid?',
        full:  'How does artist payment work on Eporia?',
        id:    'payments',
        auto:  `<highlight>Artists are never charged.</highlight> Our 20% comes entirely from fan memberships — not your payouts.\n\nFans pay <accent>$7.99, $12.99, or $24.99/month</accent>. Of every membership, <highlight>80% is guaranteed to artists</highlight> via two models:\n\n<accent>Hybrid Model</accent> — 60% flows into our Proof-of-Fandom pool, distributed by real engagement (not passive plays). The other 20% becomes wallet credits the fan tips manually.\n\n<accent>Manual Allocation</accent> — The fan's full 80% lands in their wallet. They decide which artists get what.\n\n<highlight>Thank You Dividend</highlight> — Unused wallets? We pool 60% of unclaimed memberships and split it equally across every artist on the platform.\n\nPayouts are <accent>near real-time</accent>. No 60-day net-90 label accounting.`
    },
    {
        short: 'Fan membership plans?',
        full:  'What are the fan membership tiers and pricing?',
        id:    'membership',
        auto:  `Three tiers. All ad-free. All send <highlight>80% directly to artists</highlight>.\n\n<accent>Discovery — $7.99/mo</accent>\nAd-free listening · 320kbps audio · Direct artist allocation · Hybrid & Manual wallet modes · Taste Match scores\n\n<accent>Supporter — $12.99/mo ★ Most Popular</accent>\nEverything in Discovery, plus higher payouts, Supporter badge, early feature access, priority artist requests, and an <highlight>Annual Digital Zine</highlight> — a personalized year-in-review shipped to your inbox.\n\n<accent>Champion — $24.99/mo</accent>\nEverything above, plus maximum artist allocation, Golden badge, <highlight>lossless FLAC audio</highlight>, exclusive Champion events & drops, and a real <highlight>Annual Physical Zine</highlight> printed and shipped to your door.\n\nAll plans available monthly or yearly (save ~19%).`
    },
    {
        short: 'Uploads & distribution?',
        full:  'What are the upload, mastering, and distribution options?',
        id:    'uploads',
        auto:  `<highlight>Unlimited uploads.</highlight> No storage caps. No per-track fees. Upload your entire back catalog the day you join.\n\nNeed your tracks release-ready? We offer <accent>optional AI-assisted mastering</accent> built directly into your dashboard. No third-party tools.\n\nWant to release covers? We handle the <highlight>mechanical licensing</highlight> — finding rights holders, routing royalties — for just <accent>$1 per cover song</accent>.\n\nDistribution to Spotify, Apple Music, Amazon, and every major platform is a <highlight>one-time $10 lifetime fee</highlight>. No annual renewals. No legacy fees when your music starts earning.`
    },
    {
        short: 'What is a Scene?',
        full:  'What is the Scene system and how does it work?',
        id:    'scenes',
        auto:  `A <highlight>Scene</highlight> is a living city-level hub — Tokyo, Berlin, Nashville, CDMX, and every city we expand to.\n\nFans subscribe to their city's Scene. Artists who get traction there get <accent>featured automatically</accent> — their music surfaces to every local subscriber, no algorithm to beat, no paid promotion needed.\n\nWhen you're <highlight>#1 in San Diego</highlight> with 150 paying supporters, that tells venues, promoters, and bookers far more than 10,000 Spotify streams. It's proof of a real, financially invested local audience.\n\nScenes are your fastest route to a paying local fanbase — even before you have global reach.`
    },
    {
        short: 'Artist join cost?',
        full:  'What does it cost for an artist to join Eporia?',
        id:    'pricing',
        auto:  `Joining Eporia as an artist is <highlight>completely free</highlight>.\n\n<accent>We never charge artists on their earnings.</accent> Our 20% cut comes from fan memberships only — never from your payouts.\n\nOptional paid tools:\n— <accent>$10 one-time</accent> — lifetime distribution to all major platforms (no renewals, no legacy fees)\n— <accent>$1 per cover</accent> — full mechanical licensing + royalty routing handled for you\n— <accent>Mastering</accent> — optional, per-track, inside your dashboard\n\nYour profile, Scene access, and storefront are included from day one. <highlight>You pay us nothing — fans pay us, and 80% of what they pay flows back to you.</highlight>`
    }
];

// ── Boot sequence ─────────────────────────────────────────────
const BOOT_LINES = [
    { text: 'EPORIA_UNDERGROUND v2.4.1 — INITIALIZING', status: 'ok'   },
    { text: 'Loading artist registry......................', status: 'ok'   },
    { text: 'Connecting to scene network..................', status: 'ok'   },
    { text: 'Wallet service...............................', status: 'ok'   },
    { text: 'AI content filter: ACTIVE',                   status: 'warn' },
    { text: 'Ready.',                                      status: null   }
];

// ── Module state ──────────────────────────────────────────────
let booted = false;
let feed, input, sendBtn, faqRow, pillPreview;

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    feed        = document.getElementById('epMsgs');
    input       = document.getElementById('epInput');
    sendBtn     = document.getElementById('epSendBtn');
    faqRow      = document.getElementById('epFaqRow');
    pillPreview = document.getElementById('epPillPreview');

    if (!feed || !input || !sendBtn || !faqRow) return;

    buildFaqPills();

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 72) + 'px';
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    sendBtn.addEventListener('click', handleSend);
});

// ── Toggle ────────────────────────────────────────────────────
window.epToggle = function () {
    const widget      = document.getElementById('epChatWidget');
    const isCollapsed = widget.classList.contains('ep-collapsed');
    widget.classList.toggle('ep-collapsed');

    if (isCollapsed && !booted) {
        booted = true;
        setTimeout(() => playBootSequence(() => addWelcomeMessage()), 80);
    }
};

// ── Welcome message ───────────────────────────────────────────
function addWelcomeMessage() {
    addEporiaMessage(
        `Hey — I'm <highlight>Ian</highlight>, founder of Eporia.\n\nClick any question below for an instant answer, or type anything and I'll get back to you personally.`
    );
}

// ── FAQ pill builder ──────────────────────────────────────────
function buildFaqPills() {
    FAQ.forEach((q, i) => {
        const btn = document.createElement('button');
        btn.className = 'ep-faq-pill';
        btn.setAttribute('type', 'button');
        btn.innerHTML = `<span class="ep-faq-idx">${String(i + 1).padStart(2, '0')}</span><span class="ep-faq-pill-text">${q.short}</span>`;

        btn.addEventListener('click', () => {
            // Mark active
            faqRow.querySelectorAll('.ep-faq-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');

            // Show user message (the full question)
            addUserMessage(q.full);

            // Update pill preview
            if (pillPreview) pillPreview.textContent = q.short;

            // Persist silently to backend (no "Ian will be with you" for FAQ clicks)
            persistMessage(q.full, q.id);

            // Show typing indicator then typed auto-response
            const typingEl = addTypingIndicator();
            setTimeout(() => {
                typingEl.remove();
                addEporiaMessage(q.auto);
            }, 700 + Math.random() * 300);
        });

        faqRow.appendChild(btn);
    });
}

// ── Handle free-text send (goes to Ian) ──────────────────────
async function handleSend(forcedId = null) {
    const text = input.value.trim();
    if (!text) return;

    // Check if this matches a FAQ id — if so, route to auto-response
    if (forcedId) {
        const faq = FAQ.find(f => f.id === forcedId);
        if (faq) {
            addUserMessage(text);
            input.value = '';
            input.style.height = 'auto';
            persistMessage(text, forcedId);
            const typingEl = addTypingIndicator();
            setTimeout(() => { typingEl.remove(); addEporiaMessage(faq.auto); }, 700);
            return;
        }
    }

    addUserMessage(text);
    input.value = '';
    input.style.height = 'auto';
    faqRow.querySelectorAll('.ep-faq-pill').forEach(p => p.classList.remove('active'));

    if (pillPreview) {
        pillPreview.textContent = text.length > 36 ? text.substring(0, 33) + '...' : text;
    }

    const convId = await persistMessage(text, null);
    if (convId) conversationId = convId;

    if (!waitingForIan) {
        waitingForIan = true;
        const typingEl = addTypingIndicator();
        setTimeout(() => {
            typingEl.remove();
            addEporiaMessage(
                `<highlight>Message received.</highlight> Ian will be with you shortly.\n\nThis chat updates automatically when he replies — no need to refresh.`
            );
            startPolling();
        }, 900 + Math.random() * 400);
    } else {
        const typingEl = addTypingIndicator();
        setTimeout(() => {
            typingEl.remove();
            addEporiaMessage(`<accent>Got it.</accent> Ian will see your message.`);
        }, 600);
    }
}

// ── Message renderers ─────────────────────────────────────────
function addUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'ep-msg ep-umsg';
    row.innerHTML = `
        <div class="ep-av ep-av-u">YOU</div>
        <div class="ep-bubble">
            <span class="ep-sender">USER://INPUT</span>
            <div class="ep-text">${escapeHtml(text)}</div>
        </div>`;
    feed.appendChild(row);
    scrollFeed();
}

function addEporiaMessage(rawText) {
    const row = document.createElement('div');
    row.className = 'ep-msg';
    row.innerHTML = `
        <div class="ep-av ep-av-ep">EP</div>
        <div class="ep-bubble">
            <span class="ep-sender">EPORIA://SYS</span>
            <div class="ep-text"></div>
        </div>`;
    feed.appendChild(row);
    scrollFeed();
    typewriterRender(row.querySelector('.ep-text'), rawText);
}

function addIanMessage(text) {
    const row = document.createElement('div');
    row.className = 'ep-msg ep-ian-msg';
    row.innerHTML = `
        <div class="ep-av ep-av-ian">IAN</div>
        <div class="ep-bubble ep-ian-bubble">
            <span class="ep-sender">IAN://FOUNDER</span>
            <div class="ep-text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
        </div>`;
    feed.appendChild(row);
    scrollFeed();

    const pill = document.getElementById('epChatPill');
    if (pill) {
        pill.style.borderColor = 'rgba(0,255,209,.9)';
        pill.style.boxShadow   = '0 0 28px rgba(0,255,209,.4)';
        if (pillPreview) pillPreview.textContent = 'Ian replied ↑';
        setTimeout(() => { pill.style.borderColor = ''; pill.style.boxShadow = ''; }, 4000);
    }
}

function addTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'ep-typing';
    row.innerHTML = `
        <div class="ep-av ep-av-ep">EP</div>
        <div class="ep-typing-dots">
            <div class="ep-tdot"></div>
            <div class="ep-tdot"></div>
            <div class="ep-tdot"></div>
        </div>`;
    feed.appendChild(row);
    scrollFeed();
    return row;
}

// ── Boot sequence ─────────────────────────────────────────────
function playBootSequence(onComplete) {
    const row = document.createElement('div');
    row.className = 'ep-msg';
    row.innerHTML = `
        <div class="ep-av ep-av-ep">EP</div>
        <div class="ep-bubble">
            <span class="ep-sender">EPORIA://BOOT</span>
            <div class="ep-boot-lines"></div>
        </div>`;
    feed.appendChild(row);
    const container = row.querySelector('.ep-boot-lines');
    let i = 0;
    const showNext = () => {
        if (i >= BOOT_LINES.length) { setTimeout(onComplete, 350); return; }
        const { text, status } = BOOT_LINES[i];
        const el = document.createElement('div');
        el.className = 'ep-boot' + (status ? ' ' + status : '');
        el.style.animationDelay = `${i * 0.1}s`;
        el.textContent = text;
        container.appendChild(el);
        scrollFeed();
        i++;
        setTimeout(showNext, 150);
    };
    showNext();
}

// ── Typewriter renderer ───────────────────────────────────────
function typewriterRender(target, rawText) {
    const segments = parseSegments(rawText);
    const chars = [];
    segments.forEach(seg => {
        if (seg.type === 'br') {
            chars.push({ char: '\n', type: 'br' });
        } else {
            [...seg.content].forEach(c => chars.push({ char: c, type: seg.type }));
        }
    });

    const cursor = document.createElement('span');
    cursor.className = 'ep-cursor';
    target.appendChild(cursor);

    let index = 0, currentSpan = null, currentType = null;

    const tick = () => {
        if (index >= chars.length) { cursor.remove(); return; }
        const { char, type } = chars[index];
        if (char === '\n') {
            target.insertBefore(document.createElement('br'), cursor);
            currentSpan = null; currentType = null;
        } else {
            if (type !== currentType) {
                if (type === 'text') {
                    currentSpan = document.createTextNode('');
                    target.insertBefore(currentSpan, cursor);
                } else {
                    currentSpan = document.createElement('span');
                    currentSpan.className = type === 'highlight' ? 'ep-hl' : 'ep-ac';
                    target.insertBefore(currentSpan, cursor);
                }
                currentType = type;
            }
            currentSpan.textContent += char;
        }
        index++;
        scrollFeed();
        setTimeout(tick, 14);
    };
    tick();
}

function parseSegments(text) {
    const segments = [];
    const re = /<(highlight|accent)>([\s\S]*?)<\/\1>|\n/g;
    let last = 0, match;
    while ((match = re.exec(text)) !== null) {
        if (match.index > last) {
            text.slice(last, match.index).split('\n').forEach((part, i) => {
                if (i > 0) segments.push({ type: 'br' });
                if (part)  segments.push({ type: 'text', content: part });
            });
        }
        if (match[0] === '\n') {
            segments.push({ type: 'br' });
        } else {
            segments.push({ type: match[1], content: match[2] });
        }
        last = re.lastIndex;
    }
    if (last < text.length) {
        text.slice(last).split('\n').forEach((part, i) => {
            if (i > 0) segments.push({ type: 'br' });
            if (part)  segments.push({ type: 'text', content: part });
        });
    }
    return segments;
}

function scrollFeed() { if (feed) feed.scrollTop = feed.scrollHeight; }

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}