/* services/distroService.js
 * ─────────────────────────────────────────────────────────────
 * Distribution Pipeline — Provider-Agnostic Layer
 *
 * Handles distribution queue management and the provider
 * interface. Artists supply their own ISRC and UPC — this
 * service never generates them.
 *
 * Drop in SonoSuite, Revelator, or any other B2B API by
 * implementing the provider adapter pattern at the bottom.
 * ─────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

// Distribution status lifecycle
const DISTRO_STATUS = {
    NONE:        null,        // Not queued for distribution
    QUEUED:      'queued',    // Saved to distribution_queue, not yet sent
    PENDING:     'pending',   // Submitted to provider, awaiting confirmation
    PROCESSING:  'processing',// Provider is processing (ingestion/validation)
    LIVE:        'live',      // Live on DSPs
    FAILED:      'failed',    // Submission or validation error
    TAKEDOWN:    'takedown',  // Takedown requested
    TAKEN_DOWN:  'taken_down' // Confirmed removed from DSPs
};

// ─────────────────────────────────────────────────────────────
// QUEUE FOR DISTRIBUTION
// Adds the distribution fields to the song doc and creates a
// record in the distribution_queue collection. Non-blocking —
// upload success does NOT depend on this.
// ─────────────────────────────────────────────────────────────
async function queueForDistribution(songId, { isrc, upc, artistId, title, isAlbum = false }) {
    const db = admin.firestore();

    try {
        // Patch the song doc with distribution metadata
        await db.collection('songs').doc(songId).update({
            isrc,
            upc,
            distroStatus: DISTRO_STATUS.QUEUED,
            externalIds:  {},              // Will be populated by provider callbacks
            distroQueuedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Create a queue record — this is what the distribution worker consumes
        await db.collection('distribution_queue').doc(songId).set({
            songId,
            artistId,
            title,
            isrc,
            upc,
            isAlbum,
            status:    DISTRO_STATUS.QUEUED,
            provider:  null,               // Set when job is picked up
            attempts:  0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            error:     null
        });

        console.log(`📬 Queued for distribution: [${songId}] ISRC: ${isrc} | UPC: ${upc}`);
    } catch (err) {
        // Non-fatal — log but don't throw. Upload already succeeded.
        console.error(`⚠ Distribution queue error for ${songId}:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────────
// DISTRIBUTION CONTROLLER
// The main class for interacting with a B2B provider.
// ─────────────────────────────────────────────────────────────
class DistributionController {
    constructor(provider = 'sonosuite') {
        this.provider = provider;
        this.adapter  = getProviderAdapter(provider);
    }

    // Submit a single queued track to the active provider
    async submitTrack(songId) {
        const db      = admin.firestore();
        const songDoc = await db.collection('songs').doc(songId).get();

        if (!songDoc.exists) throw new Error(`Song ${songId} not found`);

        const song    = songDoc.data();
        const queueRef = db.collection('distribution_queue').doc(songId);

        // Mark as pending before calling provider
        await Promise.all([
            db.collection('songs').doc(songId).update({
                distroStatus: DISTRO_STATUS.PENDING,
                distroProvider: this.provider
            }),
            queueRef.update({
                status:      DISTRO_STATUS.PENDING,
                provider:    this.provider,
                attempts:    admin.firestore.FieldValue.increment(1),
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt:   admin.firestore.FieldValue.serverTimestamp()
            })
        ]);

        try {
            const result = await this.adapter.submitTrack({
                songId,
                isrc:      song.isrc,
                upc:       song.upc,
                title:     song.title,
                artistId:  song.artistId,
                artistName: song.artistName,
                masterUrl: song.masterUrl,
                artUrl:    song.artUrl,
                genre:     song.genre,
                duration:  song.duration,
                releaseDate: song.releaseDate || null
            });

            // Success — store provider's assigned ID and set status to processing
            await Promise.all([
                db.collection('songs').doc(songId).update({
                    distroStatus: DISTRO_STATUS.PROCESSING,
                    externalIds:  { [this.provider]: result.providerId },
                    distroSubmittedAt: admin.firestore.FieldValue.serverTimestamp()
                }),
                queueRef.update({
                    status:     DISTRO_STATUS.PROCESSING,
                    providerId: result.providerId,
                    updatedAt:  admin.firestore.FieldValue.serverTimestamp()
                })
            ]);

            console.log(`✅ Submitted to ${this.provider}: ${songId} → providerID: ${result.providerId}`);
            return { success: true, providerId: result.providerId };

        } catch (err) {
            const errorMsg = err.message || 'Unknown provider error';
            await Promise.all([
                db.collection('songs').doc(songId).update({
                    distroStatus: DISTRO_STATUS.FAILED,
                    distroError:  errorMsg
                }),
                queueRef.update({
                    status:    DISTRO_STATUS.FAILED,
                    error:     errorMsg,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                })
            ]);

            console.error(`❌ Distribution failed for ${songId}:`, errorMsg);
            throw err;
        }
    }

    // Poll provider for status update on an already-submitted track
    async refreshStatus(songId) {
        const db      = admin.firestore();
        const songDoc = await db.collection('songs').doc(songId).get();

        if (!songDoc.exists) throw new Error(`Song ${songId} not found`);

        const song = songDoc.data();
        if (!song.externalIds?.[this.provider]) {
            throw new Error(`No provider ID found for ${this.provider}`);
        }

        const status = await this.adapter.getStatus(song.externalIds[this.provider]);

        // Map provider status to internal status
        const internalStatus = this.adapter.mapStatus(status.providerStatus);

        await Promise.all([
            db.collection('songs').doc(songId).update({
                distroStatus:    internalStatus,
                externalIds:     { ...song.externalIds, ...status.dsps }, // e.g. { spotify: 'track_id', apple: 'id' }
                distroLastCheck: admin.firestore.FieldValue.serverTimestamp()
            }),
            db.collection('distribution_queue').doc(songId).update({
                status:    internalStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
        ]);

        return { status: internalStatus, dsps: status.dsps };
    }

    // Request a takedown from the provider
    async requestTakedown(songId, reason = 'artist_request') {
        const db      = admin.firestore();
        const songDoc = await db.collection('songs').doc(songId).get();

        if (!songDoc.exists) throw new Error(`Song ${songId} not found`);

        const song = songDoc.data();

        await this.adapter.requestTakedown(song.externalIds?.[this.provider], reason);

        await db.collection('songs').doc(songId).update({
            distroStatus:      DISTRO_STATUS.TAKEDOWN,
            distroTakedownAt:  admin.firestore.FieldValue.serverTimestamp(),
            distroTakedownReason: reason
        });

        return { success: true };
    }
}

// ─────────────────────────────────────────────────────────────
// PROVIDER ADAPTERS
// Each adapter implements: submitTrack(), getStatus(), mapStatus(), requestTakedown()
// ─────────────────────────────────────────────────────────────
function getProviderAdapter(provider) {
    switch (provider) {
        case 'sonosuite':  return new SonoSuiteAdapter();
        case 'revelator':  return new RevelatorAdapter();
        default:           throw new Error(`Unknown distribution provider: ${provider}`);
    }
}

// ──────────────────────────────────
// SonoSuite Adapter
// Docs: https://sonossuite.com/api
// ──────────────────────────────────
class SonoSuiteAdapter {
    constructor() {
        this.baseUrl = process.env.SONOSUITE_API_URL || 'https://api.sonossuite.com/v1';
        this.apiKey  = process.env.SONOSUITE_API_KEY;
    }

    async submitTrack(trackData) {
        /* ── STUB ──────────────────────────────────────────────
         * Replace this block with your actual SonoSuite API call.
         *
         * const response = await fetch(`${this.baseUrl}/releases`, {
         *     method:  'POST',
         *     headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
         *     body: JSON.stringify({
         *         title:        trackData.title,
         *         isrc:         trackData.isrc,
         *         upc:          trackData.upc,
         *         artist:       trackData.artistName,
         *         audio_url:    trackData.masterUrl,
         *         artwork_url:  trackData.artUrl,
         *         genre:        trackData.genre,
         *         duration_ms:  trackData.duration * 1000
         *     })
         * });
         * const data = await response.json();
         * return { providerId: data.release_id };
         * ──────────────────────────────────────────────────── */
        console.log(`[SonoSuite STUB] Would submit: ${trackData.title} (${trackData.isrc})`);
        return { providerId: `ss_stub_${Date.now()}` };
    }

    async getStatus(providerId) {
        /* ── STUB ──────────────────────────────────────────────
         * const response = await fetch(`${this.baseUrl}/releases/${providerId}`, {
         *     headers: { 'Authorization': `Bearer ${this.apiKey}` }
         * });
         * const data = await response.json();
         * return { providerStatus: data.status, dsps: data.store_ids || {} };
         * ──────────────────────────────────────────────────── */
        return { providerStatus: 'processing', dsps: {} };
    }

    mapStatus(providerStatus) {
        const map = {
            submitted:   DISTRO_STATUS.PENDING,
            processing:  DISTRO_STATUS.PROCESSING,
            ingested:    DISTRO_STATUS.PROCESSING,
            live:        DISTRO_STATUS.LIVE,
            error:       DISTRO_STATUS.FAILED,
            rejected:    DISTRO_STATUS.FAILED,
            taken_down:  DISTRO_STATUS.TAKEN_DOWN
        };
        return map[providerStatus] || DISTRO_STATUS.PROCESSING;
    }

    async requestTakedown(providerId, reason) {
        /* ── STUB ──────────────────────────────────────────────
         * await fetch(`${this.baseUrl}/releases/${providerId}/takedown`, {
         *     method:  'POST',
         *     headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
         *     body: JSON.stringify({ reason })
         * });
         * ──────────────────────────────────────────────────── */
        console.log(`[SonoSuite STUB] Takedown requested for: ${providerId} (${reason})`);
    }
}

// ──────────────────────────────────
// Revelator Adapter
// Docs: https://revelator.com/api
// ──────────────────────────────────
class RevelatorAdapter {
    constructor() {
        this.baseUrl  = process.env.REVELATOR_API_URL || 'https://api.revelator.com/v2';
        this.clientId = process.env.REVELATOR_CLIENT_ID;
        this.secret   = process.env.REVELATOR_CLIENT_SECRET;
        this._token   = null;
        this._tokenExpiry = 0;
    }

    async _getAccessToken() {
        if (this._token && Date.now() < this._tokenExpiry) return this._token;

        /* ── STUB ──────────────────────────────────────────────
         * const response = await fetch(`${this.baseUrl}/auth/token`, {
         *     method: 'POST',
         *     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         *     body: new URLSearchParams({
         *         grant_type:    'client_credentials',
         *         client_id:     this.clientId,
         *         client_secret: this.secret
         *     })
         * });
         * const data = await response.json();
         * this._token       = data.access_token;
         * this._tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
         * return this._token;
         * ──────────────────────────────────────────────────── */
        return 'revelator_stub_token';
    }

    async submitTrack(trackData) {
        /* ── STUB ──────────────────────────────────────────────
         * const token = await this._getAccessToken();
         * const response = await fetch(`${this.baseUrl}/assets`, {
         *     method:  'POST',
         *     headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         *     body: JSON.stringify({
         *         asset_type:  'track',
         *         title:       trackData.title,
         *         isrc:        trackData.isrc,
         *         upc:         trackData.upc,
         *         performers:  [{ name: trackData.artistName, role: 'main_artist' }],
         *         audio:       { url: trackData.masterUrl },
         *         cover_art:   { url: trackData.artUrl },
         *         genres:      [trackData.genre]
         *     })
         * });
         * const data = await response.json();
         * return { providerId: data.asset_id };
         * ──────────────────────────────────────────────────── */
        console.log(`[Revelator STUB] Would submit: ${trackData.title} (${trackData.isrc})`);
        return { providerId: `rev_stub_${Date.now()}` };
    }

    async getStatus(providerId) {
        return { providerStatus: 'processing', dsps: {} };
    }

    mapStatus(providerStatus) {
        const map = {
            pending:     DISTRO_STATUS.PENDING,
            ingesting:   DISTRO_STATUS.PROCESSING,
            distributed: DISTRO_STATUS.LIVE,
            failed:      DISTRO_STATUS.FAILED,
            removed:     DISTRO_STATUS.TAKEN_DOWN
        };
        return map[providerStatus] || DISTRO_STATUS.PROCESSING;
    }

    async requestTakedown(providerId, reason) {
        console.log(`[Revelator STUB] Takedown requested for: ${providerId} (${reason})`);
    }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
    queueForDistribution,
    DistributionController,
    DISTRO_STATUS
};