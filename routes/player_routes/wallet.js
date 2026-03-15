const express = require('express');
const admin = require('firebase-admin');


// Ensure turso is passed into your module exports
module.exports = (db,turso, verifyUser) => {
    const router = express.Router();

    const PLAN_PRICES = {
        'discovery': 7.99,
        'supporter': 12.99,
        'champion': 24.99
    };

    // ==========================================
    // EARNINGS SCHEMA HELPER (DELETED)
    // ==========================================
    // The hierarchical Firestore earnings path has been entirely 
    // replaced by the flat Turso SQLite `transactions` ledger.
    // getEarningsRef() is no longer needed.

    // ==========================================
    // WALLET OVERVIEW
    // ==========================================

    router.get('/api/overview', verifyUser, async (req, res) => {
        try {
            // 1. Fetch user profile from Firestore for UI state
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

            const data = userDoc.data();

            // 2. Fetch the true financial balance from Turso
            const result = await turso.execute({
                sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                args: [req.uid]
            });

            const balanceCents = result.rows.length > 0 ? result.rows[0].wallet_balance : 0;

            res.json({
                balance:            (balanceCents / 100).toFixed(2),
                monthlyAllocation:  data.monthlyAllocation   || 0.00,
                plan:               data.subscription?.plan  || data.plan || 'free',
                subscriptionStatus: data.subscription?.status || data.subscriptionStatus || 'inactive'
            });
        } catch (e) {
            console.error("Wallet API Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // WALLET API
    // ==========================================

    router.get('/api/wallet', verifyUser, async (req, res) => {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

            const data = userDoc.data();
            const plan = data.subscription?.plan || 'discovery';

            const result = await turso.execute({
                sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                args: [req.uid]
            });

            let balanceCents;

            if (result.rows.length > 0) {
                // ── Normal path: Turso row exists ─────────────────────────────
                balanceCents = result.rows[0].wallet_balance;
            } else {
                // ── Legacy path: user predates Turso ─────────────────────────
                // Read the Firestore walletBalance field (stored in dollars) and
                // migrate it into Turso so every future read hits the fast path.
                const firestoreBalance = Number(data.walletBalance ?? data.balance ?? 0);
                balanceCents = Math.round(firestoreBalance * 100);

                // Self-healing migration — fire-and-forget, never blocks the response
                turso.execute({
                    sql: `INSERT INTO wallets (user_id, wallet_balance, fandom_pool)
                          VALUES (?, ?, ?)
                          ON CONFLICT(user_id) DO NOTHING`,
                    args: [req.uid, balanceCents, 0]
                }).catch(e => console.error('[wallet] Turso migration failed for', req.uid, e.message));

                console.log(`[wallet] Legacy user ${req.uid} migrated to Turso (balance: $${firestoreBalance})`);
            }

            res.json({
                balance:           (balanceCents / 100).toFixed(2),
                monthlyAllocation: (data.monthlyAllocation || 0).toFixed(2),
                currency:          '$',
                plan
            });
        } catch (e) {
            console.error('[wallet] /api/wallet error:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // CHECK ALLOCATION
    // ==========================================

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
                // Fetch the exact balance from Turso to prevent UI mismatches
                const result = await turso.execute({
                    sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                    args: [req.uid]
                });
                
                const balanceCents = result.rows.length > 0 ? result.rows[0].wallet_balance : 0;

                res.json({
                    due:         true,
                    balance:     (balanceCents / 100).toFixed(2),
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
    // TIP ARTIST
    // ==========================================

    router.post('/api/tip-artist', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, artistName, amount } = req.body;
            const uid = req.uid;
            
            const tipAmountCents = Math.round(parseFloat(amount) * 100);

            if (!artistId || isNaN(tipAmountCents) || tipAmountCents <= 0) {
                return res.status(400).json({ error: "Invalid tip data" });
            }

            const tx = await turso.transaction();

            try {
                const balanceResult = await tx.execute({
                    sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                    args: [uid]
                });

                if (balanceResult.rows.length === 0 || balanceResult.rows[0].wallet_balance < tipAmountCents) {
                    throw new Error("Insufficient funds");
                }

                await tx.execute({
                    sql: `UPDATE wallets SET wallet_balance = wallet_balance - ? WHERE user_id = ?`,
                    args: [tipAmountCents, uid]
                });

                const transactionId = admin.firestore().collection('temp').doc().id; 
                await tx.execute({
                    sql: `INSERT INTO transactions 
                          (id, transaction_type, amount_cents, sender_id, receiver_id) 
                          VALUES (?, 'artist_payout', ?, ?, ?)`,
                    args: [transactionId, tipAmountCents, uid, artistId]
                });

                await tx.commit();

            } catch (txError) {
                await tx.rollback(); 
                throw txError;
            }

            const artistRef = db.collection('artists').doc(artistId);
            artistRef.update({
                'stats.supporters': admin.firestore.FieldValue.increment(1)
            }).catch(console.error); 

            res.json({ success: true, message: "Tip sent successfully" });

        } catch (e) {
            console.error("Tip Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // MONTHLY ALLOCATION (Primary Endpoint)
    // ==========================================

    router.post('/api/wallet/allocate', verifyUser, express.json(), async (req, res) => {
        try {
            const uid = req.uid;
            const { allocations } = req.body;

            if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
                return res.status(400).json({ error: 'No allocations provided' });
            }

            // 1. Calculate total in cents immediately to prevent floating-point loss
            let totalAllocationCents = 0;
            const processedAllocations = [];

            for (const alloc of allocations) {
                const amountCents = Math.round(parseFloat(alloc.amount || 0) * 100);
                if (amountCents > 0) {
                    totalAllocationCents += amountCents;
                    processedAllocations.push({ artistId: alloc.artistId, amountCents });
                }
            }

            if (totalAllocationCents <= 0) {
                return res.status(400).json({ error: 'Total allocation must be greater than 0' });
            }

            // 2. Start a Turso ACID Transaction
            const tx = await turso.transaction();

            try {
                // Step A: Check User Balance
                const balanceResult = await tx.execute({
                    sql: `SELECT wallet_balance FROM wallets WHERE user_id = ?`,
                    args: [uid]
                });

                if (balanceResult.rows.length === 0 || balanceResult.rows[0].wallet_balance < totalAllocationCents) {
                    throw new Error('Allocation exceeds available balance');
                }

                // Step B: Deduct the total amount from the User's Wallet
                await tx.execute({
                    sql: `UPDATE wallets SET wallet_balance = wallet_balance - ? WHERE user_id = ?`,
                    args: [totalAllocationCents, uid]
                });

                // Step C: Record each individual artist allocation in the Ledger
                for (const alloc of processedAllocations) {
                    const transactionId = admin.firestore().collection('temp').doc().id; // Fast unique ID
                    
                    await tx.execute({
                        sql: `INSERT INTO transactions 
                              (id, transaction_type, amount_cents, sender_id, receiver_id) 
                              VALUES (?, 'monthly_allocation', ?, ?, ?)`,
                        args: [transactionId, alloc.amountCents, uid, alloc.artistId]
                    });
                }

                // Step D: Commit the SQL transaction
                await tx.commit();

            } catch (txError) {
                await tx.rollback(); // If any step fails, money is perfectly reverted
                throw txError;
            }

            // 3. Fire-and-Forget UI Updates in Firestore
            // The ledger is safe in Turso. We update Firestore merely so the 
            // artist's dashboard UI numbers immediately reflect the new activity.
            const batch = db.batch();
            
            processedAllocations.forEach(alloc => {
                const artistRef = db.collection('artists').doc(alloc.artistId);
                const amountDollars = alloc.amountCents / 100;
                
                batch.update(artistRef, {
                    'earnings.total':     admin.firestore.FieldValue.increment(amountDollars),
                    'earnings.thisMonth': admin.firestore.FieldValue.increment(amountDollars),
                    'stats.supporters':   admin.firestore.FieldValue.increment(1)
                });
            });

            // Update user's last allocation timestamp
            const userRef = db.collection('users').doc(uid);
            batch.update(userRef, { lastAllocation: admin.firestore.FieldValue.serverTimestamp() });
            
            batch.commit().catch(console.error); // Do not block the response

            res.json({
                success:    true,
                allocated:  totalAllocationCents / 100, // Return standard dollars for UI
                artists:    processedAllocations.length
            });

        } catch (e) {
            console.error('Allocation Error:', e);
            res.status(500).json({ error: e.message || 'Failed to commit allocation' });
        }
    });

    // ==========================================
    // COMMIT ALLOCATION (Legacy / Action Endpoint)
    // ==========================================

    router.post('/api/commit-allocation', verifyUser, express.json(), async (req, res) => {
        try {
            const { action, allocations } = req.body;
            const uid = req.uid;

            if (action === 'skip') {
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + 30);
                
                await db.collection('users').doc(uid).update({
                    'subscription.nextPaymentDate': nextDate.toISOString(),
                    lastRollover: admin.firestore.FieldValue.serverTimestamp()
                });
                return res.json({ success: true, action: 'skip' });
            }

            if (action === 'allocate' && allocations?.length > 0) {
                // If the frontend calls this legacy route with an allocate action, 
                // we can just pass the data into the exact same Turso logic as above.
                // (You can extract the Turso transaction block into a shared helper function
                // if you intend to keep both endpoints permanently).
                
                // For now, redirecting the legacy UI call to the primary logic structure
                req.body.allocations = allocations;
                // You would copy/paste the Turso logic from `/api/wallet/allocate` here,
                // or just deprecate this route if your frontend points to `/api/wallet/allocate`.
                res.json({ success: true, message: 'Please use /api/wallet/allocate for multi-allocations' });
            }

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ==========================================
    // TRANSACTION HISTORY
    // ==========================================

    router.get('/api/wallet/transactions', verifyUser, async (req, res) => {
        try {
            const uid   = req.uid;
            const limit = parseInt(req.query.limit) || 100;
 
            const result = await turso.execute({
                sql: `SELECT id, transaction_type, amount_cents, sender_id, receiver_id, created_at
                      FROM transactions
                      WHERE sender_id = ? OR receiver_id = ?
                      ORDER BY created_at DESC
                      LIMIT ?`,
                args: [uid, uid, limit]
            });
 
            // Label map for clean UI display
            const TYPE_LABELS = {
                artist_payout:      'Tip Sent',
                monthly_allocation: 'Monthly Allocation',
                wallet_fund:        'Wallet Funded',
                subscription:       'Subscription',
            };
 
            // Shape each row into a consistent object
            const shaped = result.rows.map(row => {
                const isIncoming = row.receiver_id === uid && row.sender_id !== uid;
                const amountDollars = (Math.abs(row.amount_cents) / 100).toFixed(2);
                const ts = row.created_at ? new Date(row.created_at) : new Date();
                return {
                    id:        row.id,
                    type:      row.transaction_type,
                    title:     TYPE_LABELS[row.transaction_type] || row.transaction_type,
                    amount:    isIncoming ? `+${amountDollars}` : `-${amountDollars}`,
                    isIncoming,
                    timestamp: ts.toISOString(),
                    // Pre-compute month key for grouping: "March 2026"
                    monthKey:  ts.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                };
            });
 
            // Group by month — preserve insertion order (DESC by date so newest month first)
            const grouped = {};
            shaped.forEach(tx => {
                if (!grouped[tx.monthKey]) grouped[tx.monthKey] = [];
                grouped[tx.monthKey].push(tx);
            });
 
            // Convert to an ordered array of { month, transactions }
            const months = Object.entries(grouped).map(([month, transactions]) => ({
                month,
                transactions,
            }));
 
            res.json({ months, total: shaped.length });
        } catch (e) {
            console.error('Transaction History Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};