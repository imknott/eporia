/**
 * artistPoolHelper.js
 * routes/player_routes/artistPoolHelper.js
 *
 * Shared utility for writing Proof of Fandom points to a user's
 * per-artist pool subcollection.
 *
 * Firestore path: users/{uid}/artistPool/{artistId}
 *
 * Point values (per the spec):
 *   FOLLOW_ARTIST   5   — user follows an artist
 *   CRATE_ADD       5   — user adds an artist's song to a crate
 *   ANTHEM          5   — user sets an artist's song as their anthem
 *   SONG_LIKE       2   — user likes a song (tracked only if the like
 *                         has been held for 7+ days at month-end —
 *                         we record the likedAt timestamp and the
 *                         monthly distribution job applies the rule)
 *   COMMENT         1   — user leaves a comment on an artist's wall
 *
 * The monthly distribution Cloud Function reads this subcollection,
 * calculates each artist's share of the 60% artist pool, writes to
 * artists/{artistId}/earningsLog, then resets points for next month.
 */

const admin = require('firebase-admin');

// ─── Point values ────────────────────────────────────────────
const POINTS = {
    FOLLOW_ARTIST: 5,
    CRATE_ADD:     5,
    ANTHEM:        5,
    SONG_LIKE:     2,
    COMMENT:       1,
};

/**
 * awardPoints
 *
 * Upserts an artistPool document for the given user+artist pair and
 * increments the correct breakdown counter and total.  Creates the
 * doc on first award.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid            — Firebase Auth UID of the fan
 * @param {string} artistId       — Firestore artists/{artistId}
 * @param {'FOLLOW_ARTIST'|'CRATE_ADD'|'ANTHEM'|'SONG_LIKE'|'COMMENT'} eventType
 * @param {object} [artistMeta]   — { name, handle, img } — only used when
 *                                  creating the doc for the first time
 * @returns {Promise<void>}
 */
async function awardPoints(db, uid, artistId, eventType, artistMeta = {}) {
    if (!uid || !artistId || !POINTS[eventType]) return;

    const pts    = POINTS[eventType];
    const field  = breakdownField(eventType);
    const poolRef = db.collection('users').doc(uid)
                      .collection('artistPool').doc(artistId);

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(poolRef);

            if (!snap.exists) {
                // First interaction with this artist — create the doc
                tx.set(poolRef, {
                    artistId,
                    artistName:   artistMeta.name   || null,
                    artistHandle: artistMeta.handle || null,
                    artistImg:    artistMeta.img    || null,
                    points:       pts,
                    breakdown: {
                        follows:   0,
                        songLikes: 0,
                        comments:  0,
                        crateAdds: 0,
                        anthems:   0,
                        [field]:   pts,
                    },
                    allocatedThisMonth: 0,
                    addedAt:       admin.firestore.FieldValue.serverTimestamp(),
                    lastPointAt:   admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                // Increment existing doc
                tx.update(poolRef, {
                    points:                          admin.firestore.FieldValue.increment(pts),
                    [`breakdown.${field}`]:          admin.firestore.FieldValue.increment(pts),
                    lastPointAt:                     admin.firestore.FieldValue.serverTimestamp(),
                    // Backfill meta if missing (artist name may not have been known at first write)
                    ...(artistMeta.name   && !snap.data().artistName   ? { artistName:   artistMeta.name }   : {}),
                    ...(artistMeta.handle && !snap.data().artistHandle ? { artistHandle: artistMeta.handle } : {}),
                    ...(artistMeta.img    && !snap.data().artistImg    ? { artistImg:    artistMeta.img }    : {}),
                });
            }
        });
    } catch (e) {
        // Non-fatal — pool points are best-effort; never block the triggering action
        console.warn(`[artistPool] awardPoints non-fatal (${uid}→${artistId} +${pts}):`, e.message);
    }
}

// ─── Map event type → breakdown field name ───────────────────
function breakdownField(eventType) {
    const map = {
        FOLLOW_ARTIST: 'follows',
        CRATE_ADD:     'crateAdds',
        ANTHEM:        'anthems',
        ANTHEM_7DAY:   'anthems',    // top-ups go into the same anthems bucket
        ANTHEM_MONTH:  'anthems',
        SONG_LIKE:     'songLikes',
        COMMENT:       'comments',
    };
    return map[eventType] || 'follows';
}

// ─── Anthem top-up (called by scheduled Cloud Function) ──────
//
// Run this once per day (or on the 15th) for each user who has
// an active anthem.  It checks the setAt timestamp and awards
// the incremental bonus points that weren't given at set time.
//
// Idempotent: uses anthem7dayAwarded / anthemMonthAwarded flags
// on the artistPool doc to prevent double-awarding.
//
// Usage:
//   const { topUpAnthemPoints } = require('./artistPoolHelper');
//   await topUpAnthemPoints(db, uid, artistId, anthemSetAt);
//
async function topUpAnthemPoints(db, uid, artistId, anthemSetAt) {
    if (!uid || !artistId || !anthemSetAt) return;

    const poolRef  = db.collection('users').doc(uid)
                       .collection('artistPool').doc(artistId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) return;    // no pool entry — nothing to top up

    const data    = poolSnap.data();
    const setDate = anthemSetAt.toDate ? anthemSetAt.toDate() : new Date(anthemSetAt);
    const now     = new Date();
    const daysHeld = (now - setDate) / (1000 * 60 * 60 * 24);

    const updates = {};
    let   extraPts = 0;

    if (daysHeld >= 30 && !data.anthemMonthAwarded) {
        // Full month bonus: +2 pts (on top of the +4 already given at 7 days)
        extraPts += POINTS.ANTHEM_MONTH;
        updates.anthemMonthAwarded = true;
        // Also give the 7-day bonus if somehow it was never recorded
        if (!data.anthem7dayAwarded) {
            extraPts += POINTS.ANTHEM_7DAY;
            updates.anthem7dayAwarded = true;
        }
    } else if (daysHeld >= 7 && !data.anthem7dayAwarded) {
        // 7-day bonus: +4 pts
        extraPts += POINTS.ANTHEM_7DAY;
        updates.anthem7dayAwarded = true;
    }

    if (extraPts === 0) return;   // nothing new to award

    await db.runTransaction(async (tx) => {
        tx.update(poolRef, {
            points:                 admin.firestore.FieldValue.increment(extraPts),
            'breakdown.anthems':    admin.firestore.FieldValue.increment(extraPts),
            lastPointAt:            admin.firestore.FieldValue.serverTimestamp(),
            ...updates,
        });
    });
}

module.exports = { awardPoints, topUpAnthemPoints, POINTS };