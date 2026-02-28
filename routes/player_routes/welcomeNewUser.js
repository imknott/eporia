/**
 * routes/player_routes/welcomeNewUser.js
 *
 * Called immediately after a new user's batch.commit() in the
 * create-account route.  Performs three writes in one atomic batch:
 *
 *   1. users/{newUserId}/following/{adminUid}   — new user → @ian
 *   2. users/{adminUid}/following/{newUserId}   — @ian → new user (Tom-MySpace)
 *   3. users/{newUserId}/notifications/{auto}   — clickable welcome message
 *        actionTarget: '/player/u/ian'  (client uses this to navigate on tap)
 *
 * Any failure here is non-fatal and will never block signup.
 */

const admin = require('firebase-admin');

const ADMIN_HANDLE = '@ian';

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} newUserId    UID of the newly created user
 * @param {string} newHandle    Handle stored on the user doc, e.g. "@sarah"
 * @param {string} newPhotoURL  Avatar URL of the new user
 */
async function welcomeNewUser(db, newUserId, newHandle, newPhotoURL) {
    try {
        // Find @ian ───────────────────────────────────────────────────────────
        const adminSnap = await db.collection('users')
            .where('handle', '==', ADMIN_HANDLE)
            .limit(1)
            .get();

        if (adminSnap.empty) {
            console.warn(`[welcomeNewUser] "${ADMIN_HANDLE}" not found — skipping welcome`);
            return;
        }

        const adminDoc  = adminSnap.docs[0];
        const adminUid  = adminDoc.id;
        const adminData = adminDoc.data();
        const now       = admin.firestore.FieldValue.serverTimestamp();

        const batch = db.batch();

        // 1. New user follows @ian automatically
        batch.set(
            db.collection('users').doc(newUserId)
              .collection('following').doc(adminUid),
            {
                type:       'user',
                uid:        adminUid,
                handle:     adminData.handle      || ADMIN_HANDLE,
                name:       adminData.displayName || 'Ian',
                img:        adminData.photoURL    || null,
                followedAt: now
            }
        );

        // 2. @ian follows new user back
        batch.set(
            db.collection('users').doc(adminUid)
              .collection('following').doc(newUserId),
            {
                type:       'user',
                uid:        newUserId,
                handle:     newHandle   || '',
                name:       newHandle   || 'New Member',
                img:        newPhotoURL || null,
                followedAt: now
            }
        );

        // 3. Welcome notification — clicking navigates to /player/u/ian
        batch.set(
            db.collection('users').doc(newUserId)
              .collection('notifications').doc(),
            {
                type:         'welcome',
                fromUid:      adminUid,
                fromHandle:   adminData.handle      || ADMIN_HANDLE,
                fromName:     adminData.displayName || 'Ian',
                fromAvatar:   adminData.photoURL    || null,
                message:      `Hey ${newHandle || 'there'}! Ian here 👋 Welcome to Eporia — built for real fans and independent artists. So glad you're here. Feel free to reach out anytime!`,
                actionType:   'navigate_profile',
                actionTarget: '/player/u/ian',
                timestamp:    now,
                read:         false
            }
        );

        await batch.commit();
        console.log(`[welcomeNewUser] Welcome batch committed for ${newHandle} (${newUserId})`);

    } catch (e) {
        // Non-fatal — signup already succeeded
        console.error('[welcomeNewUser] non-fatal:', e.message);
    }
}

module.exports = { welcomeNewUser };