/**
 * routes/player_routes/artistPoolTracker.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 * The artist pool is distributed at month-end based on SUSTAINED ENGAGEMENT,
 * not real-time activity. The core question we ask at snapshot time is:
 *
 *   "Does this user genuinely care about this artist?"
 *
 * We answer it with the intersection of two things:
 *
 *   1. Songs the user STILL HAS LIKED at the end of the month.
 *      A like that didn't survive the period doesn't count — we look at
 *      the live likes collection at snapshot time, not a historical log.
 *
 *   2. How many times the user PLAYED those still-liked songs THIS month.
 *      Plays on songs you've since abandoned are ignored. The play has
 *      to land on a song you chose to keep hearted.
 *
 * On top of that, two bonuses reward loyalty over time:
 *
 *   Consistency multiplier (up to 2×):
 *     Each consecutive previous month where you played ANY song from
 *     this artist adds +20%. Someone who has been returning to an artist
 *     for 5+ months earns that artist double weight in the pool.
 *
 *   Follow bonus (flat):
 *     If you still follow the artist at snapshot time, a flat bonus is
 *     added on top of your play-based weight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRESTORE SCHEMA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   users/{uid}/playHistory/{YYYY-MM}_{songId}
 *     songId        string
 *     artistId      string
 *     artistName    string
 *     artistImg     string | null
 *     monthKey      string   "YYYY-MM"
 *     playCount     number   incremented live after each 30 s stream
 *     firstPlayedAt timestamp
 *     lastPlayedAt  timestamp
 *
 *   users/{uid}/artistPool/_meta
 *     poolBudget    number
 *     interval      'month' | 'year'
 *     periodStart   timestamp
 *     periodEnd     timestamp
 *     status        'accumulating' | 'pending_payout' | 'paid'
 *     lastSnapshot  timestamp | null
 *
 *   users/{uid}/artistPool/{artistId}   ← written ONLY by snapshotPool(), never live
 *     artistId           string
 *     artistName         string
 *     artistImg          string | null
 *     isFollowing        boolean
 *     snapshot {
 *       likedSongCount         number   still-liked songs from this artist
 *       likedPlaysThisMonth    number   plays on those liked songs this month
 *       consistencyMonths      number   consecutive months with any play (0–5)
 *       consistencyMultiplier  number   1.0 – 2.0
 *       followBonus            number   0 or FOLLOW_BONUS
 *       rawWeight              number
 *     }
 *     provisionalAmount  number   4 decimal places
 *     snapshotAt         timestamp
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PUBLIC API
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   initArtistPool(db, uid, poolBudget, interval, periodEnd)
 *     → called from signup/finish when payment clears
 *
 *   recordPlay(db, uid, songId, artistId, artistName, artistImg)
 *     → called after 30 s of valid playback — the only live write
 *
 *   snapshotPool(db, uid)
 *     → called by your month-end cron
 *     → reads likes + playHistory + following, computes, writes artistPool
 *
 *   getPoolState(db, uid)
 *     → returns { meta, artists } for the wallet UI
 */

const admin = require('firebase-admin');

// ─────────────────────────────────────────────────────────────
// SCORING CONSTANTS
// ─────────────────────────────────────────────────────────────
const FOLLOW_BONUS                = 5;    // flat weight when user still follows artist
const CONSISTENCY_BONUS_PER_MONTH = 0.2;  // +20% per consecutive prior month
const CONSISTENCY_MAX_MONTHS      = 5;    // cap at 5 months → 2.0× multiplier
const PLAY_HISTORY_LOOKBACK       = 6;    // months of history to check for consistency

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

function monthKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function previousMonthKeys(currentKey, count) {
    const [y, m] = currentKey.split('-').map(Number);
    const keys = [];
    for (let i = 1; i <= count; i++) {
        const d = new Date(y, m - 1 - i, 1);
        keys.push(monthKey(d));
    }
    return keys;
}

function playHistoryRef(db, uid) {
    return db.collection('users').doc(uid).collection('playHistory');
}

function artistPoolRef(db, uid) {
    return db.collection('users').doc(uid).collection('artistPool');
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: initArtistPool
// ─────────────────────────────────────────────────────────────
async function initArtistPool(db, uid, poolBudget, interval, periodEnd) {
    try {
        await artistPoolRef(db, uid).doc('_meta').set({
            poolBudget,
            interval,
            periodStart:  admin.firestore.FieldValue.serverTimestamp(),
            periodEnd:    admin.firestore.Timestamp.fromDate(periodEnd),
            status:       'accumulating',
            lastSnapshot: null,
            updatedAt:    admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[artistPool] Initialised for ${uid} — budget $${poolBudget}`);
    } catch (e) {
        console.warn('[artistPool] initArtistPool non-fatal:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: recordPlay
// ─────────────────────────────────────────────────────────────
/**
 * The ONLY live write in this module.
 * Increments play count for this song in the current month's play history.
 * Does not touch artistPool — that's written exclusively by snapshotPool().
 *
 * Call this after 30 s of playback in your play-recording route.
 */
async function recordPlay(db, uid, songId, artistId, artistName, artistImg = null) {
    try {
        const key   = monthKey();
        const docId = `${key}_${songId}`;
        const ref   = playHistoryRef(db, uid).doc(docId);
        const snap  = await ref.get();

        await ref.set({
            songId,
            artistId,
            artistName,
            artistImg,
            monthKey:     key,
            playCount:    admin.firestore.FieldValue.increment(1),
            lastPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(snap.exists ? {} : {
                firstPlayedAt: admin.firestore.FieldValue.serverTimestamp()
            })
        }, { merge: true });

    } catch (e) {
        console.warn('[artistPool] recordPlay non-fatal:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: snapshotPool
// ─────────────────────────────────────────────────────────────
/**
 * Month-end snapshot. Reads the current state of the user's engagement
 * and writes the authoritative artistPool breakdown for payout.
 *
 * Run this from your billing renewal cron/webhook for every hybrid user
 * whose periodEnd has been reached.
 *
 * @returns {{ artists: object[], totalWeight: number, budget: number }}
 */
async function snapshotPool(db, uid) {
    const currentKey = monthKey();

    // ── Step 1: Read currently-liked songs ───────────────────────────────────
    // We read from the live likes collection, not a log.
    // If a song was liked and then unliked before month-end, it won't be here.
    const likesSnap = await db.collection('users').doc(uid)
        .collection('likes')
        .get();

    if (likesSnap.empty) {
        console.log(`[artistPool] ${uid} has no liked songs — snapshot skipped`);
        return { artists: [], totalWeight: 0, budget: 0 };
    }

    // songId → { artistId, artistName, artistImg }
    const likedSongIds = new Set();
    const songMeta     = {};

    likesSnap.forEach(doc => {
        const d = doc.data();
        if (d.artistId) {
            likedSongIds.add(doc.id);
            songMeta[doc.id] = {
                artistId:   d.artistId,
                artistName: d.artistName || d.artist || 'Unknown Artist',
                artistImg:  d.artUrl || d.artistImg || null
            };
        }
    });

    // ── Step 2: Read this month's play history ───────────────────────────────
    const playsSnap = await playHistoryRef(db, uid)
        .where('monthKey', '==', currentKey)
        .get();

    // songId → playCount, only for songs still liked
    const likedPlaysMap = {};
    playsSnap.forEach(doc => {
        const d = doc.data();
        if (likedSongIds.has(d.songId)) {
            likedPlaysMap[d.songId] = d.playCount || 0;
        }
    });

    // ── Step 3: Group liked plays by artist ──────────────────────────────────
    const byArtist = {};
    for (const [songId, meta] of Object.entries(songMeta)) {
        const { artistId, artistName, artistImg } = meta;
        if (!byArtist[artistId]) {
            byArtist[artistId] = { artistId, artistName, artistImg, likedSongCount: 0, likedPlaysThisMonth: 0 };
        }
        byArtist[artistId].likedSongCount++;
        byArtist[artistId].likedPlaysThisMonth += (likedPlaysMap[songId] || 0);
    }

    // ── Step 4: Consistency look-back ────────────────────────────────────────
    // Fetch all play history for the look-back window in a single query.
    // Firestore 'in' operator supports up to 30 values.
    const prevKeys = previousMonthKeys(currentKey, PLAY_HISTORY_LOOKBACK);
    const historySnap = await playHistoryRef(db, uid)
        .where('monthKey', 'in', prevKeys)
        .get();

    // artistId → Set of monthKeys where they had plays
    const artistMonthSets = {};
    historySnap.forEach(doc => {
        const d = doc.data();
        if (!artistMonthSets[d.artistId]) artistMonthSets[d.artistId] = new Set();
        artistMonthSets[d.artistId].add(d.monthKey);
    });

    // Count consecutive months backwards from the most recent prior month
    function consecutiveMonths(artistId) {
        let count = 0;
        for (const key of prevKeys) {
            if (artistMonthSets[artistId]?.has(key)) count++;
            else break;
        }
        return Math.min(count, CONSISTENCY_MAX_MONTHS);
    }

    // ── Step 5: Follow status ─────────────────────────────────────────────────
    const followingSnap = await db.collection('users').doc(uid)
        .collection('following')
        .where('type', '==', 'artist')
        .get();

    const followedArtists = new Set(followingSnap.docs.map(d => d.id));

    // ── Step 6: Compute weights ───────────────────────────────────────────────
    const results = [];
    let totalWeight = 0;

    for (const [artistId, data] of Object.entries(byArtist)) {
        const consistency    = consecutiveMonths(artistId);
        const multiplier     = 1 + (consistency * CONSISTENCY_BONUS_PER_MONTH);
        const isFollowing    = followedArtists.has(artistId);
        const followBonus    = isFollowing ? FOLLOW_BONUS : 0;

        // Core: plays of still-liked songs, scaled by loyalty over time
        const rawWeight = (data.likedPlaysThisMonth * multiplier) + followBonus;

        results.push({
            artistId,
            artistName:       data.artistName,
            artistImg:        data.artistImg,
            isFollowing,
            snapshot: {
                likedSongCount:        data.likedSongCount,
                likedPlaysThisMonth:   data.likedPlaysThisMonth,
                consistencyMonths:     consistency,
                consistencyMultiplier: Number(multiplier.toFixed(3)),
                followBonus,
                rawWeight:             Number(rawWeight.toFixed(4))
            },
            provisionalAmount: 0   // populated below
        });

        totalWeight += rawWeight;
    }

    // ── Step 7: Provisional amounts ───────────────────────────────────────────
    const metaDoc = await artistPoolRef(db, uid).doc('_meta').get();
    const budget  = metaDoc.exists ? (metaDoc.data().poolBudget || 0) : 0;

    if (totalWeight > 0 && budget > 0) {
        for (const r of results) {
            r.provisionalAmount = Number(
                ((r.snapshot.rawWeight / totalWeight) * budget).toFixed(4)
            );
        }
    }

    // ── Step 8: Batch-write to artistPool ─────────────────────────────────────
    // Full overwrite (merge: false) — each snapshot is the single source of truth.
    const batch     = db.batch();
    const snapTime  = admin.firestore.FieldValue.serverTimestamp();

    for (const r of results) {
        batch.set(
            artistPoolRef(db, uid).doc(r.artistId),
            { ...r, snapshotAt: snapTime },
            { merge: false }
        );
    }

    batch.update(artistPoolRef(db, uid).doc('_meta'), {
        lastSnapshot: snapTime,
        status:       'pending_payout'
    });

    await batch.commit();

    console.log(
        `[artistPool] Snapshot for ${uid} — ` +
        `${results.length} artists | weight ${totalWeight.toFixed(2)} | budget $${budget}`
    );

    return { artists: results, totalWeight, budget };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: getPoolState
// ─────────────────────────────────────────────────────────────
/**
 * Returns the last snapshot for the wallet UI.
 * Sorted by provisionalAmount descending so the user sees who
 * their top-supported artists are.
 */
async function getPoolState(db, uid) {
    const [metaDoc, artistsSnap] = await Promise.all([
        artistPoolRef(db, uid).doc('_meta').get(),
        artistPoolRef(db, uid)
            .where(admin.firestore.FieldPath.documentId(), '!=', '_meta')
            .get()
    ]);

    const meta    = metaDoc.exists ? metaDoc.data() : null;
    const artists = artistsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.provisionalAmount || 0) - (a.provisionalAmount || 0));

    return { meta, artists };
}

module.exports = {
    initArtistPool,
    recordPlay,
    snapshotPool,
    getPoolState,
    monthKey,
    FOLLOW_BONUS,
    CONSISTENCY_BONUS_PER_MONTH,
    CONSISTENCY_MAX_MONTHS
};