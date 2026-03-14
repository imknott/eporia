// ================================================================
//  EPORIA — GUEST MESSAGE ROUTES
//  routes/guestMessages.js
//
//  Public routes (no auth):
//    POST /api/guest-message           — landing chat → admin inbox
//    GET  /api/guest-poll/:sessionId   — widget polls for admin replies
//                                        supports ?since=<ISO timestamp>
//                                        to return only new messages
//
//  The sessionId in both routes is the value of the visitor's
//  eporia_gid cookie, sent in the POST body / URL param by chat.js.
//  It is a 1-day cookie so the same guest is recognised across page
//  navigations and browser restarts within a 24-hour window.
// ================================================================

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const db      = admin.firestore();

// verifyAdmin is imported here for any future admin-only routes
// added to this file (e.g. bulk-close conversations).
const { verifyAdmin } = require('./admin');

// ================================================================
//  POST /api/guest-message
//  Creates or appends to an open guest_conversations document.
//  Called fire-and-forget from chat.js on every visitor send.
// ================================================================
router.post('/guest-message', async (req, res) => {
    try {
        const {
            sessionId,
            guestName,
            guestEmail,
            text,
            questionTopic,
            source = 'landing_chat'
        } = req.body;

        if (!sessionId || !text?.trim()) {
            return res.status(400).json({ error: 'sessionId and text are required' });
        }

        const safeText = text.trim().substring(0, 2000);
        const now      = admin.firestore.Timestamp.now();

        // Find the most recent open conversation for this guest
        const existing = await db.collection('guest_conversations')
            .where('sessionId', '==', sessionId)
            .where('status', '!=', 'closed')
            .orderBy('status')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        let convRef;

        if (!existing.empty) {
            convRef = existing.docs[0].ref;
            await convRef.update({
                lastMessageAt: now,
                lastSeenAt:    now,   // guest is actively here
                isRead:        false, // new guest message = unread for admin
                ...(guestEmail && { guestEmail }),
                ...(guestName  && { guestName }),
                messages: admin.firestore.FieldValue.arrayUnion({
                    role:      'guest',
                    text:      safeText,
                    timestamp: now,
                    adminUid:  null
                })
            });
        } else {
            convRef = db.collection('guest_conversations').doc();
            await convRef.set({
                sessionId,
                guestName:     guestName  || null,
                guestEmail:    guestEmail || null,
                status:        'open',
                isRead:        false,
                source,
                questionTopic: questionTopic || null,
                createdAt:     now,
                lastMessageAt: now,
                lastSeenAt:    now,
                messages: [{
                    role:      'guest',
                    text:      safeText,
                    timestamp: now,
                    adminUid:  null
                }]
            });
        }

        res.json({ success: true, conversationId: convRef.id });

    } catch (error) {
        console.error('[guestMessages] POST error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  GET /api/guest-poll/:sessionId[?since=<ISO timestamp>]
//  Called by chat.js on page load to surface admin replies.
//
//  - Only returns admin-role messages so guests cannot read other
//    conversations (they need the exact sessionId UUID).
//  - If ?since is provided, only messages after that timestamp
//    are returned — so the widget can show only NEW replies.
//  - Updates lastSeenAt so the admin inbox can show recency.
// ================================================================
router.get('/guest-poll/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

        const sinceRaw = req.query.since;
        const sinceTs  = sinceRaw ? new Date(sinceRaw) : null;

        const snap = await db.collection('guest_conversations')
            .where('sessionId', '==', sessionId)
            .where('status', '!=', 'closed')
            .orderBy('status')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (snap.empty) {
            return res.json({ messages: [], conversationId: null });
        }

        const doc  = snap.docs[0];
        const data = doc.data();

        // Update lastSeenAt so the admin knows the guest is still around
        await doc.ref.update({ lastSeenAt: admin.firestore.Timestamp.now() });

        // Filter to admin messages only, optionally filtered by since timestamp
        const adminMessages = (data.messages || [])
            .filter(m => {
                if (m.role !== 'admin') return false;
                if (!sinceTs) return true;
                const msgDate = m.timestamp?.toDate ? m.timestamp.toDate() : new Date(m.timestamp);
                return msgDate > sinceTs;
            })
            .map(m => ({
                role:      m.role,
                text:      m.text,
                timestamp: m.timestamp?.toDate
                    ? m.timestamp.toDate().toISOString()
                    : m.timestamp
            }));

        res.json({
            conversationId: doc.id,
            status:         data.status,
            messages:       adminMessages
        });

    } catch (error) {
        console.error('[guestMessages] GET poll error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;