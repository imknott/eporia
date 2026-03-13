// ================================================================
//  EPORIA — GUEST MESSAGE ROUTES
// ================================================================

const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");
const db = admin.firestore();
const { verifyAdmin } = require('./admin');

// ================================================================
//  PUBLIC ROUTE — POST /api/guest-message
//  FIX: was '/api/guest-message' but router is mounted at /api,
//  making the real path /api/api/guest-message → 404.
//  Correct path is just '/guest-message'.
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
        const now = admin.firestore.Timestamp.now();

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
                isRead: false,
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
        console.error('Guest message error:', error);
        res.status(500).json({ error: error.message });
    }
});


// ================================================================
//  PUBLIC ROUTE — GET /api/guest-poll/:sessionId
//  Allows the chat widget to poll for admin replies.
//  No auth — only returns admin-role messages so guests can't
//  read other conversations (they'd need the exact sessionId UUID).
// ================================================================
router.get('/guest-poll/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

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

        const doc = snap.docs[0];
        const data = doc.data();

        // Only return admin messages so guests can only see replies to them
        const adminMessages = (data.messages || [])
            .filter(m => m.role === 'admin')
            .map(m => ({
                role:      m.role,
                text:      m.text,
                timestamp: m.timestamp?.toDate ? m.timestamp.toDate().toISOString() : m.timestamp
            }));

        res.json({
            conversationId: doc.id,
            status:         data.status,
            messages:       adminMessages
        });

    } catch (error) {
        console.error('Guest poll error:', error);
        res.status(500).json({ error: error.message });
    }
});



module.exports = router;