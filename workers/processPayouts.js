require('dotenv').config();
const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const turso = require('../config/turso');

// Initialize Firebase Admin if not already running
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// The minimum balance required to trigger a bank payout (e.g., 500 cents = $5.00)
// This prevents Stripe from throwing errors on micro-transfers.
const MIN_PAYOUT_CENTS = 500; 

async function processMonthlyPayouts() {
    console.log(`[${new Date().toISOString()}] Starting monthly artist payouts...`);
    
    try {
        // 1. Fetch all approved artists with connected Stripe accounts
        const artistsSnap = await db.collection('artists')
            .where('status', '==', 'approved')
            .where('stripeOnboarded', '==', true)
            .get();

        if (artistsSnap.empty) {
            console.log('No eligible artists found for payout.');
            return;
        }

        let totalPaidOutCents = 0;
        let successCount = 0;

        for (const doc of artistsSnap.docs) {
            const artistId = doc.id;
            const artistData = doc.data();
            const stripeAccountId = artistData.stripeAccountId;

            if (!stripeAccountId) continue;

            try {
                // 2. Calculate the exact current balance from the Turso ledger
                const earnedResult = await turso.execute({
                    sql: `SELECT COALESCE(SUM(amount_cents), 0) as total 
                          FROM transactions 
                          WHERE receiver_id = ? AND transaction_type IN ('artist_payout', 'monthly_allocation')`,
                    args: [artistId]
                });
                
                const spentResult = await turso.execute({
                    sql: `SELECT COALESCE(SUM(amount_cents), 0) as total 
                          FROM transactions 
                          WHERE sender_id = ?`, // Captures cover_licence_fee and previous stripe_payouts
                    args: [artistId]
                });

                const currentBalanceCents = earnedResult.rows[0].total - spentResult.rows[0].total;

                // 3. Skip if below the minimum transfer threshold
                if (currentBalanceCents < MIN_PAYOUT_CENTS) {
                    continue; 
                }

                const transactionId = `payout_${Date.now()}_${artistId}`;

                // 4. Initiate the Stripe Transfer to the Artist's Connect Account
                // We use an Idempotency Key to guarantee Stripe never double-pays 
                // if the script crashes and retries.
                const transfer = await stripe.transfers.create({
                    amount: currentBalanceCents,
                    currency: 'usd',
                    destination: stripeAccountId,
                    description: `Eporia Music Monthly Payout`,
                    metadata: { artistId, transactionId }
                }, {
                    idempotencyKey: transactionId 
                });

                // 5. Record the payout in the Turso ledger to deduct the balance
                await turso.execute({
                    sql: `INSERT INTO transactions 
                          (id, transaction_type, amount_cents, sender_id, receiver_id, reference_id) 
                          VALUES (?, 'stripe_payout', ?, ?, 'BANK', ?)`,
                    args: [transactionId, currentBalanceCents, artistId, transfer.id]
                });

                console.log(`✅ Paid $${(currentBalanceCents / 100).toFixed(2)} to ${artistData.name}`);
                
                totalPaidOutCents += currentBalanceCents;
                successCount++;

            } catch (artistError) {
                // If one artist fails (e.g., their bank account disconnected), 
                // log it and continue the loop so the other artists still get paid.
                console.error(`❌ Failed payout for ${artistData.name} (${artistId}):`, artistError.message);
            }
        }

        console.log(`\n🎉 Payout Run Complete!`);
        console.log(`Successfully paid ${successCount} artists.`);
        console.log(`Total funds distributed: $${(totalPaidOutCents / 100).toFixed(2)}`);

    } catch (globalError) {
        console.error('CRITICAL: Payout script failed to run:', globalError);
    }
}

// Execute the script
processMonthlyPayouts().then(() => process.exit(0));