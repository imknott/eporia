const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    const PLAN_PRICES = {
        'discovery': 7.99,
        'supporter': 12.99,
        'champion': 24.99
    };

    // ==========================================
    // EARNINGS SCHEMA HELPER
    // ==========================================
    //
    // All artist earnings are written to a hierarchical path:
    //   earnings/{year}/artists/{artistId}/{month}/{transactionId}
    //
    // This enables per-month reporting and efficient payout queries
    // without scanning a flat collection.
    //
    // The artist doc's stats fields (stats.tipsTotal, stats.supporters,
    // earnings.total, etc.) are kept as a fast-read cache for the UI —
    // they are NOT the source of truth for payouts.

    function getEarningsRef(artistId) {
        const now   = new Date();
        const year  = now.getFullYear().toString();                  // "2026"
        const month = String(now.getMonth() + 1).padStart(2, '0');  // "01"–"12"

        return {
            year,
            month,
            // Path: earnings/{year}/artists/{artistId}/{month}/{newDoc}
            newDoc: () =>
                db.collection('earnings')
                  .doc(year)
                  .collection('artists')
                  .doc(artistId)
                  .collection(month)
                  .doc()   // auto-ID
        };
    }

    // ==========================================
    // WALLET OVERVIEW
    // ==========================================

    router.get('/api/overview', verifyUser, async (req, res) => {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

            const data = userDoc.data();

            res.json({
                balance:            data.walletBalance       || 0.00,
                monthlyAllocation:  data.monthlyAllocation   || 0.00,
                plan:               data.plan                || 'free',
                subscriptionStatus: data.subscriptionStatus  || 'inactive'
            });
        } catch (e) {
            console.error("Wallet API Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/wallet', verifyUser, async (req, res) => {
        try {
            const userRef = db.collection('users').doc(req.uid);
            const doc     = await userRef.get();
            if (!doc.exists) return res.status(404).json({ error: "User not found" });

            const data          = doc.data();
            const plan          = data.subscription?.plan || 'individual';
            const monthlyPrice  = PLAN_PRICES[plan] || 12.99;
            const fairTradeAllocation = monthlyPrice * 0.80;
            let   currentBalance = data.walletBalance;

            if (currentBalance === undefined) {
                currentBalance = fairTradeAllocation;
                await userRef.update({
                    walletBalance: currentBalance,
                    lastRollover: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            res.json({
                balance:           currentBalance.toFixed(2),
                monthlyAllocation: fairTradeAllocation.toFixed(2),
                currency: '$',
                plan
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/check-allocation', verifyUser, async (req, res) => {
        try {
            const userRef = db.collection('users').doc(req.uid);
            const doc     = await userRef.get();
            const data    = doc.data();
            if (!data || !data.subscription) return res.json({ due: false });

            const nextPayment = new Date();
            nextPayment.setDate(nextPayment.getDate() - 1);
            const isDue = new Date() >= nextPayment;

            if (isDue) {
                res.json({
                    due:         true,
                    balance:     data.walletBalance,
                    topArtists:  data.topArtists || []
                });
            } else {
                res.json({ due: false });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // COMMIT ALLOCATION (legacy endpoint)
    // ==========================================

    router.post('/api/commit-allocation', verifyUser, express.json(), async (req, res) => {
        try {
            const { action, allocations } = req.body;
            const userRef = db.collection('users').doc(req.uid);

            await db.runTransaction(async (t) => {
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) throw new Error("User does not exist!");

                const userData       = userDoc.data();
                const currentBalance = userData.walletBalance || 0;
                const nextDate       = new Date();
                nextDate.setDate(nextDate.getDate() + 30);

                if (action === 'skip') {
                    t.update(userRef, {
                        'subscription.nextPaymentDate': nextDate.toISOString(),
                        lastRollover: admin.firestore.FieldValue.serverTimestamp()
                    });
                    return;
                }

                if (action === 'allocate' && allocations?.length > 0) {
                    const totalAttempted = allocations.reduce(
                        (sum, item) => sum + Number(item.amount), 0
                    );

                    if (totalAttempted > currentBalance + 0.01) {
                        throw new Error(
                            `Insufficient funds. Wallet: $${currentBalance}, Tried: $${totalAttempted}`
                        );
                    }

                    allocations.forEach(item => {
                        const amount   = Number(item.amount);
                        const artistId = item.artistId;

                        // ── Hierarchical earnings record ──────────────────────
                        const { newDoc } = getEarningsRef(artistId);
                        t.set(newDoc(), {
                            fromUser:  req.uid,
                            toArtist:  artistId,
                            amount,
                            type:      'allocation',
                            status:    'committed',
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // ── Artist stats cache (fast UI reads) ────────────────
                        const artistRef = db.collection('artists').doc(artistId);
                        t.set(artistRef, {
                            'earnings.total':     admin.firestore.FieldValue.increment(amount),
                            'earnings.thisMonth': admin.firestore.FieldValue.increment(amount),
                            lastUpdated:          admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    });

                    t.update(userRef, {
                        walletBalance:                 Math.max(0, currentBalance - totalAttempted),
                        'subscription.nextPaymentDate': nextDate.toISOString()
                    });
                }
            });

            res.json({ success: true, receipt: allocations || [] });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // TIP ARTIST
    // ==========================================

    router.post('/api/tip-artist', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, artistName, amount } = req.body;
            const uid       = req.uid;
            const tipAmount = parseFloat(amount);

            if (!artistId || isNaN(tipAmount) || tipAmount <= 0) {
                return res.status(400).json({ error: "Invalid tip data" });
            }

            const userRef       = db.collection('users').doc(uid);
            const artistRef     = db.collection('artists').doc(artistId);
            const { newDoc }    = getEarningsRef(artistId);

            // Fetch the sender's handle once (outside the transaction — read-only)
            const userSnap   = await userRef.get();
            const userHandle = userSnap.exists ? (userSnap.data().handle || 'A fan') : 'A fan';

            await db.runTransaction(async (t) => {
                const userDoc        = await t.get(userRef);
                if (!userDoc.exists) throw new Error("User not found");

                const currentBalance = parseFloat(userDoc.data().walletBalance || 0);
                if (currentBalance < tipAmount) throw new Error("Insufficient funds");

                // ── 1. Deduct from user's wallet ──────────────────────────────
                t.update(userRef, { walletBalance: currentBalance - tipAmount });

                // ── 2. User-side receipt (unchanged — stays in wallet subcollection)
                const txRef = userRef.collection('wallet').doc();
                t.set(txRef, {
                    type:        'out',
                    amount:      -tipAmount,
                    title:       `Tip to ${artistName || 'Artist'}`,
                    description: 'Direct support tip',
                    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
                    date:        new Date().toISOString()
                });

                // ── 3. Hierarchical earnings record ───────────────────────────
                //   earnings/{year}/artists/{artistId}/{month}/{autoId}
                t.set(newDoc(), {
                    fromUser:    uid,
                    userHandle,
                    toArtist:    artistId,
                    artistName:  artistName || null,
                    amount:      tipAmount,
                    type:        'tip',
                    status:      'committed',
                    timestamp:   admin.firestore.FieldValue.serverTimestamp()
                });

                // ── 4. Artist stats cache (fast UI reads — NOT payout source) ─
                t.update(artistRef, {
                    'stats.tipsTotal': admin.firestore.FieldValue.increment(tipAmount),
                    'earnings':        admin.firestore.FieldValue.increment(tipAmount)
                });
            });

            const updated = await userRef.get();
            res.json({ success: true, newBalance: updated.data().walletBalance });

        } catch (e) {
            console.error("Tip Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // MONTHLY ALLOCATION (primary endpoint)
    // ==========================================

    router.post('/api/wallet/allocate', verifyUser, express.json(), async (req, res) => {
        try {
            const uid         = req.uid;
            const { allocations } = req.body;

            if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
                return res.status(400).json({ error: 'No allocations provided' });
            }

            const totalAllocation = allocations.reduce(
                (sum, a) => sum + parseFloat(a.amount || 0), 0
            );

            if (totalAllocation <= 0) {
                return res.status(400).json({ error: 'Total allocation must be greater than 0' });
            }

            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });

            const currentBalance = parseFloat(userDoc.data().walletBalance || 0);
            if (totalAllocation > currentBalance) {
                return res.status(400).json({
                    error:     'Allocation exceeds available balance',
                    balance:   currentBalance,
                    requested: totalAllocation
                });
            }

            const batch     = db.batch();
            const timestamp = admin.firestore.FieldValue.serverTimestamp();

            allocations.forEach(({ artistId, amount }) => {
                const parsedAmount = parseFloat(amount);

                // ── Hierarchical earnings record ──────────────────────────────
                //   earnings/{year}/artists/{artistId}/{month}/{autoId}
                const { newDoc } = getEarningsRef(artistId);
                batch.set(newDoc(), {
                    userId:    uid,
                    toArtist:  artistId,
                    amount:    parsedAmount,
                    type:      'monthly_allocation',
                    status:    'committed',
                    timestamp
                });

                // ── Artist stats cache ────────────────────────────────────────
                const artistRef = db.collection('artists').doc(artistId);
                batch.update(artistRef, {
                    'earnings.total':     admin.firestore.FieldValue.increment(parsedAmount),
                    'earnings.thisMonth': admin.firestore.FieldValue.increment(parsedAmount),
                    'stats.supporters':   admin.firestore.FieldValue.increment(1)
                });
            });

            // ── Deduct from user balance ──────────────────────────────────────
            const userRef = db.collection('users').doc(uid);
            batch.update(userRef, {
                walletBalance:  currentBalance - totalAllocation,
                lastAllocation: timestamp
            });

            await batch.commit();

            res.json({
                success:    true,
                newBalance: currentBalance - totalAllocation,
                allocated:  totalAllocation,
                artists:    allocations.length
            });

        } catch (e) {
            console.error('Allocation Error:', e);
            res.status(500).json({ error: e.message || 'Failed to commit allocation' });
        }
    });

    // ==========================================
    // TRANSACTION HISTORY
    // ==========================================

    router.get('/api/wallet/transactions', verifyUser, async (req, res) => {
        try {
            const uid   = req.uid;
            const limit = parseInt(req.query.limit) || 50;

            const artistCache = {};
            const getArtistName = async (id) => {
                if (!id) return null;
                if (artistCache[id]) return artistCache[id];
                try {
                    const doc  = await db.collection('artists').doc(id).get();
                    const name = doc.exists ? doc.data().name : null;
                    artistCache[id] = name;
                    return name;
                } catch { return null; }
            };

            const rawTransactions = [];
            const seen = new Set();

            // ── User's own wallet receipts (tips sent, allocations, credits) ──
            const walletSnap = await db.collection('users').doc(uid)
                .collection('wallet')
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            walletSnap.docs.forEach(doc => {
                if (seen.has(doc.id)) return;
                seen.add(doc.id);
                const d = doc.data();
                rawTransactions.push({
                    id:          doc.id,
                    type:        d.type,
                    title:       d.title       || d.description || 'Transaction',
                    description: d.description || '',
                    amount:      d.amount,
                    timestamp:   d.timestamp?.toDate() || new Date()
                });
            });

            // ── Allocations from the hierarchical earnings path ───────────────
            // Walk this month's records for the current user so we can show
            // "allocated to X artist" entries that weren't recorded in wallet subcollection.
            try {
                const now   = new Date();
                const year  = now.getFullYear().toString();
                const month = String(now.getMonth() + 1).padStart(2, '0');

                // We need to query across all artistId docs for this user.
                // Firestore collectionGroup query on the month subcollection
                // filtered by userId works here since we created the path dynamically.
                const earningsSnap = await db.collectionGroup(month)
                    .where('userId', '==', uid)
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();

                for (const doc of earningsSnap.docs) {
                    if (seen.has(doc.id)) continue;
                    seen.add(doc.id);
                    const d          = doc.data();
                    const artistName = await getArtistName(d.toArtist);
                    rawTransactions.push({
                        id:          doc.id,
                        type:        d.type || 'allocation',
                        title:       artistName ? `Allocated to ${artistName}` : 'Allocation',
                        description: d.type === 'tip' ? 'Direct tip' : 'Monthly allocation',
                        amount:      -(Math.abs(d.amount)),
                        timestamp:   d.timestamp?.toDate() || new Date()
                    });
                }
            } catch (e) {
                // Collection group index may not exist yet on first run — non-fatal
                console.warn('Earnings collectionGroup query skipped:', e.message);
            }

            const sorted = rawTransactions
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);

            res.json({ transactions: sorted, count: sorted.length });

        } catch (e) {
            console.error('Transaction History Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};