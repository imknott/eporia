/**
 * routes/player_routes/init_bundle.js
 *
 * GET /api/player/init-bundle?artistId=<id>
 *
 * Replaces the five independent requests that fire on every artist-profile
 * (and most other) page loads:
 *
 *   GET /api/wallet                          ~110 ms
 *   GET /api/user/sidebar-artists            ~140 ms
 *   GET /api/user/likes/ids                  ~141 ms
 *   GET /api/notifications                   ~156 ms
 *   GET /api/artist/follow/check?artistId=…  ~110 ms   (artist pages only)
 *
 * All five Firestore reads run in parallel inside a single Promise.all,
 * so the total round-trip collapses to the slowest individual read
 * (~156 ms) instead of the sum (~657 ms).
 *
 * Usage — mount in player.js:
 *   const bundleRoutes = require('./player_routes/init_bundle')(db, verifyUser);
 *   router.use('/', bundleRoutes);
 *
 * Client — call once from uiController.initAuthListener() and cache the
 * result in window.globalUserCache instead of making the five calls
 * individually.
 */

const express = require('express');
const admin   = require('firebase-admin');


module.exports = (db,verifyUser,turso) => {
    const router = express.Router();

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/player/init-bundle
    //
    // Query params:
    //   artistId  (optional) — when present, includes follow/check for that artist
    //
    // Response shape:
    // {
    //   wallet:        { balance, monthlyAllocation, plan }
    //   sidebarArtists: [ { id, name, img } … ]
    //   likedSongIds:  [ "songId", … ]
    //   notifications: [ { id, type, message, … } ]
    //   followingArtist: true | false | null   (null when artistId not supplied)
    // }
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/player/init-bundle', verifyUser, async (req, res) => {
        const uid      = req.uid;
        const artistId = req.query.artistId || null;

        try {
            // ── Build all Firestore reads up-front, fire them all at once ──────
            // Wallet balance comes from Turso (source of truth).
            // All other data is Firestore.
            const walletRead = turso
                ? turso.execute({
                    sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                    args: [uid]
                  }).catch(() => null)
                : Promise.resolve(null);

            const sidebarRead = db.collection('users').doc(uid)
                .collection('following')
                .where('type', '==', 'artist')
                .orderBy('followedAt', 'desc')
                .limit(15)
                .get()
                .catch(() => null);

            const likesRead = db.collection('users').doc(uid)
                .collection('likedSongs')
                .select()                  // fetch doc IDs only — no field data needed
                .get()
                .catch(() => null);

            const notifsRead = db.collection('users').doc(uid)
                .collection('notifications')
                .where('read', '==', false)
                .orderBy('timestamp', 'desc')
                .limit(5)
                .get()
                .catch(() => null);

            // Only read the follow-check doc when artistId was supplied
            const followRead = artistId
                ? db.collection('users').doc(uid)
                    .collection('following').doc(artistId)
                    .get()
                    .catch(() => null)
                : Promise.resolve(null);

            // Also need the user doc itself for the wallet balance fallback
            const userDocRead = db.collection('users').doc(uid).get()
                .catch(() => null);

            // ── Fire everything in parallel ───────────────────────────────────
            const [walletResult, sidebarSnap, likesSnap, notifsSnap, followSnap, userDocSnap] =
                await Promise.all([walletRead, sidebarRead, likesRead, notifsRead, followRead, userDocRead]);

            // ── Assemble wallet ───────────────────────────────────────────────
            // Turso is the source of truth for new users.
            // Legacy users (created before Turso) have walletBalance on the
            // Firestore user doc — fall back to that when no Turso row exists.
            let walletBalance     = 0;
            let monthlyAllocation = 0;
            let plan              = 'standard';

            if (walletResult && walletResult.rows?.length > 0) {
                // New path: balance stored in Turso as cents
                walletBalance = walletResult.rows[0].wallet_balance / 100;
            } else if (userDocSnap?.exists) {
                // Legacy path: balance stored in Firestore as dollars
                const ud      = userDocSnap.data();
                walletBalance = Number(ud.walletBalance ?? ud.balance ?? 0);
            }

            if (userDocSnap?.exists) {
                const ud          = userDocSnap.data();
                monthlyAllocation = Number(ud.monthlyAllocation ?? 0);
                plan              = ud.subscription?.plan || ud.plan || 'standard';
            }

            // ── Assemble sidebar artists ──────────────────────────────────────
            const sidebarArtists = [];
            if (sidebarSnap) {
                sidebarSnap.forEach(doc => {
                    const d = doc.data();
                    sidebarArtists.push({
                        id:   doc.id,
                        name: d.name  || d.artistName || '',
                        img:  d.img   || d.profileImage || null,
                        slug: d.slug  || null,   // stored by connections.js on follow
                    });
                });
            }

            // ── Assemble liked song IDs ────────────────────────────────────────
            const likedSongIds = [];
            if (likesSnap) {
                likesSnap.forEach(doc => likedSongIds.push(doc.id));
            }

            // ── Assemble notifications ────────────────────────────────────────
            const notifications = [];
            if (notifsSnap) {
                notifsSnap.forEach(doc => {
                    const d = doc.data();
                    notifications.push({
                        id:           doc.id,
                        type:         d.type,
                        fromUid:      d.fromUid      || null,
                        fromHandle:   d.fromHandle   || '',
                        fromName:     d.fromName     || '',
                        fromAvatar:   d.fromAvatar   || null,
                        message:      d.message      || '',
                        actionType:   d.actionType   || null,
                        actionTarget: d.actionTarget || null,
                        read:         d.read         || false,
                        timestamp:    d.timestamp ? d.timestamp.toDate() : new Date()
                    });
                });
            }

            // ── Follow status ─────────────────────────────────────────────────
            const followingArtist = artistId ? (followSnap?.exists ?? false) : null;

            res.json({
                wallet: {
                    balance:           walletBalance.toFixed(2),
                    monthlyAllocation: monthlyAllocation.toFixed(2),
                    plan
                },
                sidebarArtists,
                likedSongIds,
                notifications,
                followingArtist
            });

        } catch (e) {
            console.error('[init-bundle] error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};