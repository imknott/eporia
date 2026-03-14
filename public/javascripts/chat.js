// ================================================================
//  EPORIA — STICKY CHAT WIDGET
//  public/javascripts/chat.js
//
//  Persistence model:
//    eporia_gid  (cookie, 1 day)   — stable guest identity, survives
//                                    tab close and browser restart.
//                                    Sent as sessionId in every POST.
//                                    Cookie refreshed on every visit.
//
//    eporia_chat_state (localStorage, 24h TTL) — full message history,
//                                    collapse state, asked-topic cache,
//                                    and timestamp of last admin reply seen.
//                                    Discarded automatically after 24 hours.
//
//  On every page load with a saved state:
//    1. Messages are restored instantly (no typewriter replay)
//    2. FAQ pills are rebuilt for the current page context
//    3. Previously-asked pill topics are marked with .ep-asked
//    4. A lightweight poll checks for admin replies posted since
//       the guest was last active — shown with a "while you were
//       away" note if any are new.
//
//  Page detection:
//    /                      → 'landing'
//    /store*                → 'store'
//    /members/signup*       → 'user_signup'
//    /artist/onboarding*    → 'artist_signup'
// ================================================================

'use strict';

// ── Cookie helpers ────────────────────────────────────────────
function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
    const match = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
}

// ── Guest ID — cookie-backed, 1-day TTL ───────────────────────
// Stable across tab close, browser restart, and page navigations.
// The TTL refreshes on every page load so active visitors never
// lose their ID mid-conversation.
function getOrCreateGuestId() {
    let id = getCookie('eporia_gid');
    if (!id) {
        id = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    // Always refresh the 1-day window so active users stay identified
    setCookie('eporia_gid', id, 1);
    return id;
}

const GUEST_ID  = getOrCreateGuestId();
const STATE_KEY = 'eporia_chat_state';
const STATE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

// ── Persist message to admin inbox (fire-and-forget) ──────────
async function persistMessage(text, questionTopic) {
    try {
        await fetch('/api/guest-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId:     GUEST_ID,
                text,
                questionTopic: questionTopic || null,
                source:        'landing_chat'
            })
        });
    } catch (e) {
        console.warn('[eporia/chat] persist failed:', e.message);
    }
}

// ── Poll for admin replies (called on page load) ──────────────
// Checks whether the admin has replied since the guest's last
// known admin message. New replies surface as a "while you were
// away" note so the visitor always sees responses.
async function pollForAdminReplies() {
    try {
        const state = loadState();
        const since = state?.lastAdminTs || null;
        const url   = '/api/guest-poll/' + GUEST_ID + (since ? '?since=' + encodeURIComponent(since) : '');
        const res   = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        if (!data.messages || data.messages.length === 0) return;

        // Ensure the widget is booted so the feed exists
        if (!feed) return;

        // Open the widget so the visitor sees the reply
        const widget = document.getElementById('epChatWidget');
        if (widget && widget.classList.contains('ep-collapsed')) {
            widget.classList.remove('ep-collapsed');
        }

        // Show a context note then each reply
        injectCtxDivider('// Admin replied while you were away', false);
        data.messages.forEach(m => addEporiaMessage(m.text, false));

        // Record the timestamp of the newest admin message we just showed
        const latestTs = data.messages[data.messages.length - 1].timestamp;
        saveState({ lastAdminTs: latestTs });

    } catch (e) {
        console.warn('[eporia/chat] poll failed:', e.message);
    }
}

// ── Page context ──────────────────────────────────────────────
function getPageContext() {
    const p = window.location.pathname;
    if (p.startsWith('/store'))           return 'store';
    if (p.includes('/members/signup'))    return 'user_signup';
    if (p.includes('/artist/onboarding')) return 'artist_signup';
    return 'landing';
}

function getPageLabel(ctx) {
    return {
        landing:       'LANDING PAGE',
        store:         'MERCH STORE',
        user_signup:   'MEMBERSHIP SIGNUP',
        artist_signup: 'ARTIST PORTAL'
    }[ctx] || 'EPORIA';
}

const PAGE_CTX = getPageContext();

// ── FAQ sets per page ─────────────────────────────────────────
const FAQ_BY_PAGE = {
    landing: [
        { short:'Different from Spotify?',      full:'How is Eporia different from Spotify?',           id:'vs_spotify'   },
        { short:'How do artists get paid?',      full:'How do artists actually get paid here?',           id:'payments'     },
        { short:'What is the scene system?',     full:'What is the scene system and how does it help?',  id:'scenes'       },
        { short:'Can fans support me directly?', full:'Can fans directly support artists on Eporia?',    id:'fan_support'  },
        { short:'Only electronic music?',        full:'Is Eporia only for electronic music?',             id:'genres'       },
        { short:'What does it cost?',            full:'What does it cost for an artist to join?',        id:'pricing'      }
    ],
    store: [
        { short:'How does the fee work?',        full:'How does the supporter fee work at checkout?',    id:'how_fee'       },
        { short:'Artist really gets 100%?',      full:'Does the artist really keep 100% of their price?',id:'artist_payout'},
        { short:'How does shipping work?',       full:'How does shipping and fulfillment work?',         id:'shipping'      },
        { short:'What payment methods?',         full:'What payment methods do you accept?',             id:'payment_methods'},
        { short:'Can I get a refund?',           full:'Can I return an item or get a refund?',           id:'returns'       },
        { short:'What are digital items?',       full:'What are digital items in the store?',            id:'digital_items' }
    ],
    user_signup: [
        { short:'What is Discovery plan?',       full:'What do I get with the Discovery plan?',          id:'plan_discovery'},
        { short:'What is Supporter plan?',       full:"What's included in the Supporter plan?",          id:'plan_supporter'},
        { short:'What is Champion plan?',        full:'What is the Champion plan?',                      id:'plan_champion' },
        { short:'How does the wallet work?',     full:'How does the Eporia wallet work?',                id:'wallet'        },
        { short:'Can I cancel anytime?',         full:'Can I cancel my membership anytime?',             id:'cancel'        },
        { short:'What is Hybrid Flow?',          full:'What is Hybrid Flow and how does it work?',       id:'hybrid_flow'   }
    ],
    artist_signup: [
        { short:'How does verification work?',   full:'How does the artist verification process work?',  id:'verification'  },
        { short:'How long does approval take?',  full:'How long does it take to get approved?',         id:'approval_time' },
        { short:'Do I need an ISRC?',            full:'Do I need an ISRC code to apply?',               id:'isrc'          },
        { short:"What if I'm in a band?",        full:"What if I'm applying as part of a band or group?",id:'band'         },
        { short:'Can I leave with my music?',    full:'Can I leave the platform and take my music?',    id:'leave'         },
        { short:'What does Eporia take?',        full:'What percentage does Eporia take from artists?', id:'rev_cut'       }
    ]
};

// ── Responses ─────────────────────────────────────────────────
const RESPONSES = {
    // Landing
    vs_spotify:   `On Spotify, you are a file in a database. On <highlight>Eporia</highlight>, you are a creator with a storefront, a community, and a direct line to the people who love your music.\n\nSpotify pays roughly <accent>$0.003–$0.005 per stream</accent>. We let fans pay you directly — tips, scene subscriptions, micro-transactions. No label cut, no algorithm throttle.\n\n<highlight>Human artists only. No AI filler competing with your work.</highlight>`,
    payments:     `We run a multi-rail system so artists earn from multiple angles:\n\n<highlight>01 — Direct Tips</highlight>  Fans tip from their Eporia wallet mid-listen.\n<highlight>02 — Scene Subscriptions</highlight>  Fans subscribe to local scenes and a share flows to featured artists.\n<highlight>03 — Storefront</highlight>  Sell merch, stems, sample packs, and exclusives.\n\nPayouts are <accent>near real-time</accent>. No 60-day net-90 label accounting.`,
    scenes:       `Every city has a <highlight>Scene</highlight> — a living hub fans subscribe to and artists get featured in.\n\nWhen you're in the Tokyo Scene, you're embedded in a community that <accent>discovers, shares, and pays</accent> the artists who define that city's sound.\n\nScenes are your fastest route to a real local fanbase — even before you have global reach.`,
    fan_support:  `Absolutely. Fan support is the core mechanic.\n\nEvery fan has an <highlight>Eporia Wallet</highlight>. They tip you mid-listen, back your projects, or subscribe directly to your channel.\n\nYou get a <accent>community wall</accent> — names, faces, and wallets attached. <highlight>Real people. Real money.</highlight>`,
    genres:       `Not at all. The cyberpunk aesthetic is ours — the music is yours.\n\nEporia hosts <highlight>every genre</highlight>: hip-hop, jazz, cumbia, country, ambient, folk, metal, and everything in between.\n\nPlatform philosophy: <accent>human-made music, community-funded, algorithmically fair.</accent>`,
    pricing:      `Joining Eporia as an artist is <highlight>free</highlight>.\n\nWe take a small fee only when you earn — no monthly subscription, no pay-to-play. Profile, scene access, and storefront are all included.\n\n<accent>Core earning mechanics cost nothing upfront.</accent>`,

    // Store
    how_fee:         `At checkout, we add a small <highlight>10% Supporter Fee</highlight> on top of the listed price. This covers Stripe's processing costs so the artist never has to.\n\nThe artist's listed price is their payout — <accent>we never touch it</accent>. What they wrote is what they receive, every single time.`,
    artist_payout:   `Yes — completely, and it's enforced mathematically.\n\nIf an artist lists a hoodie at <highlight>$50</highlight>, they receive <highlight>$50</highlight>. Full stop.\n\nWe reverse-calculate from the artist's payout to set the checkout price. The supporter fee sits on top, paid by the fan. <accent>No deductions. No fine print.</accent>`,
    shipping:        `Physical items are fulfilled directly by the artist. Estimated shipping times and costs are shown on each item's detail page before you add to cart.\n\nFor <highlight>digital items</highlight> — stems, sample packs, tracks — delivery is <accent>instant</accent> via secure download link.`,
    payment_methods: `We process all payments through <highlight>Stripe</highlight>.\n\nAccepted:\n<accent>— All major credit and debit cards</accent>\n<accent>— Apple Pay</accent>\n<accent>— Google Pay</accent>\n\nAll transactions are encrypted end-to-end.`,
    returns:         `Since items are fulfilled by artists directly, policies vary by seller.\n\n<highlight>Digital items</highlight> are non-refundable once delivered.\n\nFor physical items, contact the artist through their profile. If you can't resolve it, <accent>our team can help mediate</accent>.`,
    digital_items:   `Digital items are anything the artist delivers electronically:\n\n<highlight>— Stems and multi-tracks</highlight>\n<highlight>— Sample packs and loops</highlight>\n<highlight>— Preset collections</highlight>\n<highlight>— Exclusive or unreleased tracks</highlight>\n<highlight>— Project files, sheet music</highlight>\n\nDelivery is <accent>immediate</accent> via secure download link.`,

    // User signup
    plan_discovery:  `Discovery at <highlight>$7.99/month</highlight>:\n\n<accent>— Ad-free streaming at 320kbps</accent>\n<accent>— Direct artist allocation</accent>\n<accent>— Hybrid and Manual distribution modes</accent>\n<accent>— Taste Match scores</accent>\n<accent>— Full access to all scenes and crates</accent>\n\nEverything you need to actually support artists.`,
    plan_supporter:  `Supporter at <highlight>$12.99/month</highlight> adds to Discovery:\n\n<accent>— Higher artist payout per dollar</accent>\n<accent>— Supporter badge on your profile</accent>\n<accent>— Early feature access</accent>\n<accent>— Priority on artist request queues</accent>\n<accent>— Annual Digital Zine</accent>\n\nThe Zine is a personalized year-in-review with your top artists, taste scores by city, and curated picks.`,
    plan_champion:   `Champion at <highlight>$24.99/month</highlight> is maximum impact:\n\n<accent>— Lossless FLAC streaming</accent>\n<accent>— Golden Champion badge</accent>\n<accent>— Exclusive Champion events and drops</accent>\n<accent>— Priority feature requests</accent>\n<accent>— Annual Physical Zine — real printed book, shipped to you</accent>\n\nNo two zines are the same.`,
    wallet:          `Your <highlight>Eporia Wallet</highlight> holds your direct-tipping funds.\n\nIn <accent>Hybrid mode</accent>: 60% auto-distributes to your most-listened artists, 20% goes to your wallet to tip freely.\n\nIn <accent>Manual mode</accent>: 80% sits in your wallet — you decide where every dollar goes.\n\nTips hit artists <highlight>near real-time</highlight>. No platform cut on tipping.`,
    cancel:          `Yes — cancel anytime from account settings.\n\nFull access through the end of your current billing period. <accent>No cancellation fees. No lock-in. No dark patterns.</accent>\n\nWe'd rather you come back because we earned it.`,
    hybrid_flow:     `<highlight>Hybrid Flow</highlight> is the default mode for a reason.\n\n60% of your membership auto-distributes to your most-listened artists — weighted by real listening data, not algorithmic promotion.\n\n20% goes to your <accent>wallet for free-form tipping</accent> whenever a track hits different.\n\nZero configuration. Maximum artist impact.`,

    // Artist signup
    verification:   `After submitting, our team manually reviews your music platform links to verify discography ownership.\n\nWe then reach out via your <highlight>preferred contact method</highlight> — email, Discord, Zoom, or phone — to confirm your identity.\n\n<accent>No algorithm, no auto-approval.</accent> A real person reviews every application.`,
    approval_time:  `<highlight>2–3 business days</highlight> on average.\n\nApplications with an <accent>ISRC code</accent> are prioritized — it provides instant discography verification and moves you to the top of the queue.\n\nOnce approved, you receive login credentials and full Artist Studio access by email.`,
    isrc:           `Optional, but <highlight>strongly recommended</highlight>.\n\nAn ISRC from any existing release instantly validates your discography history and <accent>moves your application to the top of the queue</accent>.\n\nNo ISRC? We verify through your platform links — just takes a little longer.`,
    band:           `You submit the application, but you'll need to list the <highlight>legal names of all band members</highlight>.\n\nWe verify all members during the identity confirmation call. Every member's information is required before a group profile activates.\n\n<accent>One application per group</accent> — whoever fills it out becomes the primary contact.`,
    leave:          `Yes — always, forever, no conditions.\n\nYou own everything you upload. <highlight>You can leave at any time and take all of your content with you.</highlight>\n\nNo lock-in contracts. We claim no ownership of your music. <accent>We'd never make leaving difficult.</accent>`,
    rev_cut:        `We take <highlight>20% of streaming membership revenue</highlight>.\n\nOn <accent>storefront sales</accent>, we take nothing from the artist's listed price — ever. The supporter fee is added on top at checkout, paid by the buyer.\n\nNo hidden deductions. No per-upload fees. No pay-to-play.`,

    // Fallback
    default: `I'm EPORIA — the system that runs this platform. Ask me anything:\n\nHow we pay artists. How scenes work. How the store fee model works. What membership plans include. How artist verification works. Why we ban AI music.\n\nOr <accent>click a question below</accent> to start. <highlight>I don't bite. Unless you're a major label.</highlight>`
};

// ── Context-aware welcome messages ────────────────────────────
const WELCOME_BY_PAGE = {
    landing:       RESPONSES.default,
    store:         `You're browsing the <highlight>Eporia Store</highlight>.\n\nEvery item here was made by a human artist, and <accent>100% of the listed price</accent> goes directly to them. A small supporter fee is added on top at checkout — paid by you, not taken from them.\n\nGot questions? Click a question below or ask anything.`,
    user_signup:   `You're looking at <highlight>Eporia Membership</highlight>.\n\nEvery plan gives you ad-free streaming and direct artist allocation. The difference is how much impact you want to have.\n\n<accent>Ask me anything</accent> about what's included — plans, the wallet, Hybrid Flow, or how to cancel.`,
    artist_signup: `You're on the <highlight>Artist Portal</highlight>.\n\nEvery application is reviewed by a real human — no auto-approval. We verify you own your music before anything is activated.\n\nAsk me about <accent>verification, timelines, what we take, or applying as a band.</accent>`
};

// ── Boot sequence ─────────────────────────────────────────────
const BOOT_LINES = [
    { text:'EPORIA_UNDERGROUND v2.4.1 — INITIALIZING', status:'ok'   },
    { text:'Loading artist registry......................',status:'ok'   },
    { text:'Connecting to scene network.................', status:'ok'   },
    { text:'Wallet service...............................',status:'ok'   },
    { text:'AI content filter: ACTIVE',                  status:'warn' },
    { text:'Ready.',                                     status:null   }
];

// ── Module state ──────────────────────────────────────────────
let booted      = false;
let askedTopics = [];          // FAQ ids engaged this session — persisted in state
let lastAdminTs = null;        // ISO timestamp of last admin message shown

let feed, input, sendBtn, faqRow, pillPreview;

// ── Inject asked-topic pill style ─────────────────────────────
// Appended once to <head> — marks previously-asked pills subtly
// so returning visitors can see what they already covered.
(function injectPillStyles() {
    const s = document.createElement('style');
    s.textContent = `
        .ep-faq-pill.ep-asked {
            opacity: .55;
            border-style: dashed;
        }
        .ep-faq-pill.ep-asked .ep-faq-idx::after {
            content: '✓';
            color: rgba(0,255,209,.6);
            margin-left: 2px;
        }
    `;
    document.head.appendChild(s);
})();

// ── localStorage state ────────────────────────────────────────
function loadState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        // Discard state older than 24 hours
        if (!state.savedAt || Date.now() - state.savedAt > STATE_TTL) {
            localStorage.removeItem(STATE_KEY);
            return null;
        }
        return state;
    } catch {
        return null;
    }
}

// overrides: optional object to merge into the saved state
// (used by pollForAdminReplies to update just lastAdminTs)
function saveState(overrides) {
    if (!feed) return;

    const messages = [];
    feed.querySelectorAll('.ep-msg').forEach(row => {
        const isUser = row.classList.contains('ep-umsg');
        const isCtx  = row.classList.contains('ep-ctx-note');
        const sender = row.querySelector('.ep-sender')?.textContent || '';
        const textEl = row.querySelector('.ep-text, .ep-boot-lines');
        messages.push({
            role:   isCtx ? 'ctx' : (isUser ? 'user' : 'eporia'),
            sender,
            html:   textEl ? textEl.innerHTML : ''
        });
    });

    const existing = loadState() || {};
    const state = Object.assign({}, existing, {
        savedAt:     Date.now(),
        page:        PAGE_CTX,
        messages,
        booted:      true,
        isCollapsed: document.getElementById('epChatWidget')?.classList.contains('ep-collapsed') ?? true,
        pillPreview: pillPreview?.textContent || 'Ask me anything...',
        askedTopics,
        lastAdminTs
    }, overrides || {});

    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('[eporia/chat] state save failed:', e.message);
    }
}

// ── DOM bootstrap ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    feed        = document.getElementById('epMsgs');
    input       = document.getElementById('epInput');
    sendBtn     = document.getElementById('epSendBtn');
    faqRow      = document.getElementById('epFaqRow');
    pillPreview = document.getElementById('epPillPreview');

    if (!feed || !input || !sendBtn || !faqRow) return;

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 72) + 'px';
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    sendBtn.addEventListener('click', handleSend);

    const state = loadState();

    if (state && state.messages && state.messages.length > 0) {
        // Restore askedTopics and lastAdminTs before building pills
        askedTopics = state.askedTopics || [];
        lastAdminTs = state.lastAdminTs || null;
        buildFaqPills();
        restoreState(state);
        // Poll for new admin replies a moment after restore
        setTimeout(pollForAdminReplies, 800);
    } else {
        buildFaqPills();
    }
});

// ── State restore ─────────────────────────────────────────────
function restoreState(state) {
    booted = true;

    state.messages.forEach(m => {
        if (m.role === 'ctx') {
            injectCtxDivider(m.html, false);
        } else if (m.role === 'user') {
            const row = document.createElement('div');
            row.className = 'ep-msg ep-umsg';
            row.innerHTML = `<div class="ep-av ep-av-u">YOU</div><div class="ep-bubble"><span class="ep-sender">${m.sender}</span><div class="ep-text">${m.html}</div></div>`;
            feed.appendChild(row);
        } else {
            const row = document.createElement('div');
            row.className = 'ep-msg';
            const isBoot = m.sender === 'EPORIA://BOOT';
            row.innerHTML = `<div class="ep-av ep-av-ep">EP</div><div class="ep-bubble"><span class="ep-sender">${m.sender}</span><div class="${isBoot ? 'ep-boot-lines' : 'ep-text'}">${m.html}</div></div>`;
            feed.appendChild(row);
        }
    });

    // Page-change context note + new welcome if visitor navigated
    if (state.page && state.page !== PAGE_CTX) {
        injectCtxDivider('// Navigated to: ' + getPageLabel(PAGE_CTX), true);
        setTimeout(() => addEporiaMessage(WELCOME_BY_PAGE[PAGE_CTX] || RESPONSES.default, true), 500);
    }

    const widget = document.getElementById('epChatWidget');
    if (widget && !state.isCollapsed) widget.classList.remove('ep-collapsed');
    if (pillPreview && state.pillPreview) pillPreview.textContent = state.pillPreview;

    scrollFeed();
}

// ── Context divider ───────────────────────────────────────────
function injectCtxDivider(label, doSave) {
    const row = document.createElement('div');
    row.className = 'ep-msg ep-ctx-note';
    row.innerHTML = `<div class="ep-bubble" style="width:100%"><span class="ep-sender">EPORIA://CONTEXT</span><div class="ep-text ep-hl">${escapeHtml(label)}</div></div>`;
    feed.appendChild(row);
    scrollFeed();
    if (doSave) saveState();
}

// ── Toggle expand / collapse ──────────────────────────────────
window.epToggle = function () {
    const widget      = document.getElementById('epChatWidget');
    const isCollapsed = widget.classList.contains('ep-collapsed');
    widget.classList.toggle('ep-collapsed');
    saveState();

    if (isCollapsed && !booted) {
        booted = true;
        setTimeout(() => {
            playBootSequence(() => addEporiaMessage(WELCOME_BY_PAGE[PAGE_CTX] || RESPONSES.default, true));
        }, 80);
    }
};

// ── FAQ pill builder ──────────────────────────────────────────
// Marks pills whose id is in askedTopics with .ep-asked so
// returning visitors can see what they already covered.
function buildFaqPills() {
    const set = FAQ_BY_PAGE[PAGE_CTX] || FAQ_BY_PAGE.landing;
    set.forEach((q, i) => {
        const btn = document.createElement('button');
        btn.className = 'ep-faq-pill' + (askedTopics.includes(q.id) ? ' ep-asked' : '');
        btn.setAttribute('type', 'button');
        btn.dataset.faqId = q.id;
        btn.innerHTML = `<span class="ep-faq-idx">${String(i + 1).padStart(2, '0')}</span><span class="ep-faq-pill-text">${q.short}</span>`;

        btn.addEventListener('click', () => {
            faqRow.querySelectorAll('.ep-faq-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            input.value = q.full;
            input.dispatchEvent(new Event('input'));
            input.focus();
            setTimeout(() => handleSend(q.id), 260);
        });

        faqRow.appendChild(btn);
    });
}

// ── Handle send ───────────────────────────────────────────────
function handleSend(forcedId) {
    const text = input.value.trim();
    if (!text) return;

    addUserMessage(text);
    persistMessage(text, forcedId || null);

    // Track the topic in askedTopics and mark the pill
    const topicId = forcedId || matchResponse(text);
    if (topicId && topicId !== 'default' && !askedTopics.includes(topicId)) {
        askedTopics.push(topicId);
        // Mark the pill visually if it exists in the current set
        const pill = faqRow.querySelector(`[data-faq-id="${topicId}"]`);
        if (pill) pill.classList.add('ep-asked');
    }

    input.value = '';
    input.style.height = 'auto';
    faqRow.querySelectorAll('.ep-faq-pill').forEach(p => p.classList.remove('active'));

    if (pillPreview) pillPreview.textContent = text.length > 36 ? text.substring(0, 33) + '...' : text;

    const delay = 750 + Math.random() * 500;
    const tEl   = addTypingIndicator();
    setTimeout(() => {
        tEl.remove();
        const key = forcedId || matchResponse(text);
        addEporiaMessage(RESPONSES[key] || RESPONSES.default);
    }, delay);
}

// ── Keyword response matching ─────────────────────────────────
function matchResponse(t) {
    t = t.toLowerCase();
    if (t.includes('fee') || t.includes('10%'))                                                               return 'how_fee';
    if (t.includes('100%') || t.includes('artist keep') || t.includes('payout'))                            return 'artist_payout';
    if (t.includes('ship') || t.includes('fulfill') || t.includes('deliver'))                                return 'shipping';
    if (t.includes('stripe') || t.includes('apple pay') || t.includes('payment method') || t.includes('card')) return 'payment_methods';
    if (t.includes('refund') || t.includes('return') || t.includes('cancel order'))                         return 'returns';
    if (t.includes('digital') || t.includes('download') || t.includes('stems') || t.includes('samples'))    return 'digital_items';
    if (t.includes('discovery'))                                                                               return 'plan_discovery';
    if (t.includes('supporter plan') || t.includes('supporter tier'))                                        return 'plan_supporter';
    if (t.includes('champion'))                                                                                return 'plan_champion';
    if (t.includes('wallet') || t.includes('credits'))                                                        return 'wallet';
    if (t.includes('cancel') && !t.includes('cancel order'))                                                  return 'cancel';
    if (t.includes('hybrid'))                                                                                   return 'hybrid_flow';
    if (t.includes('verif') || t.includes('review.*process'))                                                 return 'verification';
    if (t.includes('how long') || t.includes('approval') || t.includes('wait time'))                         return 'approval_time';
    if (t.includes('isrc'))                                                                                     return 'isrc';
    if (t.includes('band') || t.includes('group') || t.includes('members'))                                   return 'band';
    if (t.includes('leave') || t.includes('exit') || t.includes('take.*music') || t.includes('delete account')) return 'leave';
    if (t.includes('cut') || t.includes('percent') || t.includes('eporia.*fee') || t.includes('what.*take')) return 'rev_cut';
    if (t.includes('spotify') || t.includes('apple music') || t.includes('different') || t.includes('vs ') || t.includes('compare')) return 'vs_spotify';
    if (t.includes('paid') || t.includes('earn') || t.includes('money') || t.includes('revenue'))            return 'payments';
    if (t.includes('scene') || t.includes('city') || t.includes('local'))                                     return 'scenes';
    if (t.includes('fan') || t.includes('tip') || t.includes('support') || t.includes('direct'))             return 'fan_support';
    if (t.includes('genre') || t.includes('electronic') || t.includes('jazz'))                               return 'genres';
    if (t.includes('cost') || t.includes('price') || t.includes('free') || t.includes('join'))               return 'pricing';
    return 'default';
}

// ── Renderers ─────────────────────────────────────────────────
function addUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'ep-msg ep-umsg';
    row.innerHTML = `<div class="ep-av ep-av-u">YOU</div><div class="ep-bubble"><span class="ep-sender">USER://INPUT</span><div class="ep-text">${escapeHtml(text)}</div></div>`;
    feed.appendChild(row);
    scrollFeed();
    saveState();
}

function addEporiaMessage(rawText, skipSave) {
    const row = document.createElement('div');
    row.className = 'ep-msg';
    row.innerHTML = `<div class="ep-av ep-av-ep">EP</div><div class="ep-bubble"><span class="ep-sender">EPORIA://SYS</span><div class="ep-text"></div></div>`;
    feed.appendChild(row);
    scrollFeed();
    typewriterRender(row.querySelector('.ep-text'), rawText, skipSave ? null : saveState);
}

function addTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'ep-typing';
    row.innerHTML = `<div class="ep-av ep-av-ep">EP</div><div class="ep-typing-dots"><div class="ep-tdot"></div><div class="ep-tdot"></div><div class="ep-tdot"></div></div>`;
    feed.appendChild(row);
    scrollFeed();
    return row;
}

// ── Boot sequence ─────────────────────────────────────────────
function playBootSequence(onComplete) {
    const row = document.createElement('div');
    row.className = 'ep-msg';
    row.innerHTML = `<div class="ep-av ep-av-ep">EP</div><div class="ep-bubble"><span class="ep-sender">EPORIA://BOOT</span><div class="ep-boot-lines"></div></div>`;
    feed.appendChild(row);
    const container = row.querySelector('.ep-boot-lines');
    let i = 0;
    const next = () => {
        if (i >= BOOT_LINES.length) { saveState(); setTimeout(onComplete, 350); return; }
        const { text, status } = BOOT_LINES[i];
        const el = document.createElement('div');
        el.className = 'ep-boot' + (status ? ' ' + status : '');
        el.style.animationDelay = `${i * 0.1}s`;
        el.textContent = text;
        container.appendChild(el);
        scrollFeed();
        i++;
        setTimeout(next, 150);
    };
    next();
}

// ── Typewriter ────────────────────────────────────────────────
function typewriterRender(target, rawText, onComplete) {
    const segs  = parseSegments(rawText);
    const chars = [];
    segs.forEach(s => {
        if (s.type === 'br') chars.push({ char:'\n', type:'br' });
        else [...s.content].forEach(c => chars.push({ char:c, type:s.type }));
    });
    const cursor = document.createElement('span');
    cursor.className = 'ep-cursor';
    target.appendChild(cursor);
    let i = 0, cSpan = null, cType = null;
    const tick = () => {
        if (i >= chars.length) { cursor.remove(); if (onComplete) onComplete(); return; }
        const { char, type } = chars[i];
        if (char === '\n') {
            target.insertBefore(document.createElement('br'), cursor);
            cSpan = null; cType = null;
        } else {
            if (type !== cType) {
                if (type === 'text') { cSpan = document.createTextNode(''); target.insertBefore(cSpan, cursor); }
                else { cSpan = document.createElement('span'); cSpan.className = type === 'highlight' ? 'ep-hl' : 'ep-ac'; target.insertBefore(cSpan, cursor); }
                cType = type;
            }
            cSpan.textContent += char;
        }
        i++; scrollFeed(); setTimeout(tick, 16);
    };
    tick();
}

function parseSegments(text) {
    const segs = [], re = /<(highlight|accent)>([\s\S]*?)<\/\1>|\n/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) text.slice(last, m.index).split('\n').forEach((p, i) => { if (i > 0) segs.push({type:'br'}); if (p) segs.push({type:'text',content:p}); });
        if (m[0] === '\n') segs.push({type:'br'}); else segs.push({type:m[1],content:m[2]});
        last = re.lastIndex;
    }
    if (last < text.length) text.slice(last).split('\n').forEach((p, i) => { if (i > 0) segs.push({type:'br'}); if (p) segs.push({type:'text',content:p}); });
    return segs;
}

// ── Utilities ─────────────────────────────────────────────────
function scrollFeed() { if (feed) feed.scrollTop = feed.scrollHeight; }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }