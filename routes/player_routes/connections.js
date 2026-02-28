/**
 * routes/player_routes/connections.js
 *
 * Handles all follow / unfollow relationships.
 *
 * Every new follow (artist or user) fires a notification to the person
 * being followed so they see it in the right-sidebar dropdown.
 *
 * Notification schema  users/{targetUid}/notifications/{auto}:
 *   type          'follow_artist' | 'follow_user'
 *   fromUid       UID of the follower
 *   fromHandle    e.g. "@sarah"
 *   fromName      Display name
 *   fromAvatar    URL
 *   message       Human-readable sentence shown in the dropdown
 *   actionType    'navigate_profile'
 *   actionTarget  URL the client navigates to when the notification is tapped
 *   timestamp     server timestamp
 *   read          false
 */

const express = require('express');
const admin   = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    // ─────────────────────────────────────────────────────────────
    // SHARED HELPER — sendFollowNotification
    // Non-fatal: a failure here never blocks the follow response.
    // ─────────────────────────────────────────────────────────────
    async function sendFollowNotification(targetUid, fromUser, type) {
        try {
            const message = type === 'follow_artist'
                ? `${fromUser.name || fromUser.handle} started following your artist page.`
                : `${fromUser.name || fromUser.handle} (${fromUser.handle}) is now following you.`;

            const cleanHandle = (fromUser.handle || '').replace('@', '');

            await db.collection('users')
                .doc(targetUid)
                .collection('notifications')
                .add({
                    type,
                    fromUid:      fromUser.uid,
                    fromHandle:   fromUser.handle   || '',
                    fromName:     fromUser.name     || fromUser.handle || 'Someone',
                    fromAvatar:   fromUser.photoURL || null,
                    message,
                    actionType:   'navigate_profile',
                    actionTarget: `/player/u/${cleanHandle}`,
                    timestamp:    admin.firestore.FieldValue.serverTimestamp(),
                    read:         false
                });
        } catch (e) {
            console.warn('[connections] sendFollowNotification non-fatal:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ARTIST FOLLOW — check status
    // GET /api/artist/follow/check?artistId=...
    // ─────────────────────────────────────────────────────────────
    router.get('/api/artist/follow/check', verifyUser, async (req, res) => {
        try {
            const { artistId } = req.query;
            if (!artistId) return res.status(400).json({ error: 'artistId required' });

            const doc = await db.collection('users')
                .doc(req.uid)
                .collection('following')
                .doc(artistId)
                .get();

            res.json({ following: doc.exists });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ARTIST FOLLOW — toggle (called by SocialController.toggleFollow)
    // POST /api/artist/follow  { artistId, artistName, artistImg }
    // ─────────────────────────────────────────────────────────────
    router.post('/api/artist/follow', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, artistName, artistImg } = req.body;
            if (!artistId) return res.status(400).json({ error: 'artistId required' });

            const uid        = req.uid;
            const followRef  = db.collection('users').doc(uid).collection('following').doc(artistId);
            const artistRef  = db.collection('artists').doc(artistId);
            const followSnap = await followRef.get();
            const isFollowing = followSnap.exists;

            if (isFollowing) {
                // ── Unfollow ──────────────────────────────────────────────────
                const batch = db.batch();
                batch.delete(followRef);
                batch.update(artistRef, {
                    'stats.followers': admin.firestore.FieldValue.increment(-1)
                });
                await batch.commit();

            } else {
                // ── Follow ────────────────────────────────────────────────────
                const batch = db.batch();
                batch.set(followRef, {
                    type:       'artist',
                    artistId,
                    name:       artistName || '',
                    img:        artistImg  || null,
                    followedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                batch.update(artistRef, {
                    'stats.followers': admin.firestore.FieldValue.increment(1)
                });
                await batch.commit();

                // Notify the artist's owner — resolve both docs in parallel
                const [artistDoc, followerDoc] = await Promise.all([
                    artistRef.get(),
                    db.collection('users').doc(uid).get()
                ]);

                const ownerUid = artistDoc.exists ? artistDoc.data().userId : null;
                if (ownerUid && ownerUid !== uid) {
                    const fd = followerDoc.exists ? followerDoc.data() : {};
                    await sendFollowNotification(
                        ownerUid,
                        {
                            uid,
                            handle:   fd.handle      || '',
                            name:     fd.displayName || fd.handle || 'Someone',
                            photoURL: fd.photoURL    || null
                        },
                        'follow_artist'
                    );
                }
            }

            // Return updated sidebar list for SocialController to re-render
            const updatedSnap = await db.collection('users').doc(uid)
                .collection('following')
                .where('type', '==', 'artist')
                .orderBy('followedAt', 'desc')
                .limit(10)
                .get();

            const sidebar = updatedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            res.json({ following: !isFollowing, sidebar });

        } catch (e) {
            console.error('Artist follow error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // USER PROFILE FOLLOW
    // POST   /api/social/follow/:targetUid
    // DELETE /api/social/follow/:targetUid
    //
    // Called by the #userFollowBtn on profile.pug.
    // Sends a 'follow_user' notification to the followed user.
    // ─────────────────────────────────────────────────────────────
    router.post('/api/social/follow/:targetUid', verifyUser, async (req, res) => {
        try {
            const { targetUid } = req.params;
            const uid = req.uid;

            if (targetUid === uid) {
                return res.status(400).json({ error: 'Cannot follow yourself' });
            }

            const [followerDoc, targetDoc] = await Promise.all([
                db.collection('users').doc(uid).get(),
                db.collection('users').doc(targetUid).get()
            ]);

            if (!targetDoc.exists) return res.status(404).json({ error: 'User not found' });

            const followRef = db.collection('users').doc(uid)
                .collection('following').doc(targetUid);

            if ((await followRef.get()).exists) {
                return res.json({ following: true });   // already following — idempotent
            }

            const targetData   = targetDoc.data();
            const followerData = followerDoc.exists ? followerDoc.data() : {};

            await followRef.set({
                type:       'user',
                uid:        targetUid,
                handle:     targetData.handle      || '',
                name:       targetData.displayName || targetData.handle || '',
                img:        targetData.photoURL    || null,
                followedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Notify the followed user
            await sendFollowNotification(
                targetUid,
                {
                    uid,
                    handle:   followerData.handle      || '',
                    name:     followerData.displayName || followerData.handle || 'Someone',
                    photoURL: followerData.photoURL    || null
                },
                'follow_user'
            );

            res.json({ following: true });

        } catch (e) {
            console.error('User follow error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/social/follow/:targetUid', verifyUser, async (req, res) => {
        try {
            await db.collection('users').doc(req.uid)
                .collection('following').doc(req.params.targetUid)
                .delete();

            res.json({ following: false });
        } catch (e) {
            console.error('User unfollow error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // FOLLOWING COUNTS — GET /api/social/counts/:uid
    // ─────────────────────────────────────────────────────────────
    router.get('/api/social/counts/:uid', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('users').doc(req.params.uid)
                .collection('following').get();
            res.json({ following: snap.size });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};