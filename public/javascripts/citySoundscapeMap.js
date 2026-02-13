/* public/javascripts/citySoundscapeMap.js */
// ES6 Module for City Soundscape Map - Discovery-Driven Version

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const auth = getAuth();
const db = getFirestore();

// Genre color mapping - Visual Language for Energy Orbs
const GENRE_COLORS = {
    'Pop': '#D282A6',
    'Electronic': '#FF6B35',      // Neon Orange
    'Hip-Hop': '#D4AF37',
    'Rock': '#FF3333',
    'R&B': '#9D4EDD',
    'RnB': '#9D4EDD',
    'Jazz': '#E9C46A',
    'Country': '#606C38',
    'Reggae': '#2A9D8F',
    'Classical': '#B59D71',
    'Lo-Fi': '#6B4E9D',           // Deep Purple for Lo-fi
    'Indie': '#4A7BA7',           // Gritty Blue for Indie/Raw
    'Metal': '#FF3333',
    'Folk': '#606C38',
    'Blues': '#E9C46A',
    'Alternative': '#4A7BA7',
    'Ambient': '#6B4E9D'
};

export class CitySoundscapeMap {
    constructor() {
        this.map = null;
        this.markers = [];
        this.currentCity = null;
        this.cities = [];
        this.userGenres = [];
        this.userAudioProfile = null;
        this.mapLibreLoaded = false;
        this.previewAudio = null;
    }

    /**
     * Dynamically load MapLibre GL JS if not already loaded
     */
    async ensureMapLibreLoaded() {
        if (typeof maplibregl !== 'undefined') {
            this.mapLibreLoaded = true;
            return true;
        }

        try {
            // Load CSS
            if (!document.querySelector('link[href*="maplibre-gl"]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css';
                document.head.appendChild(link);
            }

            // Load JavaScript
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js';
                script.onload = () => {
                    this.mapLibreLoaded = true;
                    resolve();
                };
                script.onerror = () => reject(new Error('Failed to load MapLibre GL JS'));
                document.head.appendChild(script);
            });

            return true;
        } catch (error) {
            console.error('Failed to load MapLibre:', error);
            return false;
        }
    }

    /**
     * Initialize the map modal
     */
    async init(userLocation, userGenres = [], userAudioProfile = null) {
        const loaded = await this.ensureMapLibreLoaded();
        if (!loaded) {
            throw new Error('MapLibre GL JS failed to load');
        }

        this.userGenres = userGenres;
        this.userAudioProfile = userAudioProfile; // { avgBPM, avgEnergy, preferredKeys, topGenres }
        
        // Aggregate city data from artists/songs collections
        await this.aggregateCityData();
        
        // Create modal if it doesn't exist
        if (!document.getElementById('cityMapModal')) {
            this.createModal();
        }
        
        // Show modal FIRST
        const modal = document.getElementById('cityMapModal');
        modal.style.display = 'flex';
        
        // CRITICAL: Wait for modal to be visible and layout to complete
        // This ensures map container has proper dimensions
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve); // Double RAF for safety
            });
        });
        
        // Verify map container exists and has size
        const mapContainer = document.getElementById('soundscapeMap');
        if (!mapContainer) {
            throw new Error('Map container not found');
        }
        
        const rect = mapContainer.getBoundingClientRect();
        console.log('📏 Map container dimensions:', rect.width, 'x', rect.height);
        
        if (rect.width === 0 || rect.height === 0) {
            console.warn('⚠️ Map container has zero dimensions, waiting...');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Initialize map
        this.initMap(userLocation);
    }

    /**
     * Create the modal HTML structure
     */
    createModal() {
        const modalHTML = `
            <div id="cityMapModal" style="display: none;">
                <div class="map-container">
                    <div id="soundscapeMap"></div>
                    
                    <div class="close-btn" onclick="window.cityMap.close()">
                        <i class="fas fa-times"></i>
                    </div>
                    
                    <div class="info-panel">
                        <h2>Sound-Scape</h2>
                        <p>Explore cities by their musical energy</p>
                    </div>
                    
                    <div class="city-card" id="cityCard">
                        <div class="city-card-header">
                            <div class="city-orb" id="cityOrb"></div>
                            <div class="city-card-info">
                                <h3 id="cityName"></h3>
                                <p id="cityLocation"></p>
                            </div>
                        </div>
                        
                        <div class="taste-match">
                            <div class="taste-match-score" id="tasteScore">--</div>
                            <div class="taste-match-text">
                                <strong id="tasteMatchLabel">Taste Match</strong><br>
                                <span id="tasteMatchDesc">Based on your listening history</span>
                            </div>
                        </div>
                        
                        <div class="city-stats">
                            <div class="stat">
                                <span class="stat-value" id="artistCount">0</span>
                                <span class="stat-label">Artists</span>
                            </div>
                            <div class="stat">
                                <span class="stat-value" id="trackCount">0</span>
                                <span class="stat-label">Live Sets</span>
                            </div>
                            <div class="stat">
                                <span class="stat-value" id="recentCount">0</span>
                                <span class="stat-label">Last 24h</span>
                            </div>
                        </div>
                        
                        <div class="genre-tags" id="genreTags"></div>
                        
                        <div class="pioneer-badge" id="pioneerBadge" style="display: none;">
                            <i class="fas fa-medal"></i> Founding Artists Here
                        </div>
                        
                        <div class="city-actions">
                            <button class="btn-explore" onclick="window.cityMap.exploreCity()">
                                <i class="fas fa-compass"></i> Explore Scene
                            </button>
                            <button class="btn-preview" id="previewBtn" onclick="window.cityMap.previewSound()">
                                <i class="fas fa-play"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="map-legend">
                        <div class="legend-title">Genre Colors</div>
                        ${this.createLegendHTML()}
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add pioneer badge styles
        const style = document.createElement('style');
        style.textContent = `
            .pioneer-badge {
                background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(212, 175, 55, 0.05) 100%);
                border: 1px solid rgba(212, 175, 55, 0.5);
                border-radius: 12px;
                padding: 10px 16px;
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 10px;
                color: #D4AF37;
                font-size: 0.85rem;
                font-weight: 600;
            }
            .pioneer-badge i {
                font-size: 1.2rem;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Create legend HTML from genre colors
     */
    createLegendHTML() {
        const topGenres = ['Pop', 'Hip-Hop', 'Electronic', 'R&B', 'Rock', 'Lo-Fi'];
        return topGenres.map(genre => `
            <div class="legend-item">
                <div class="legend-color" style="background: ${GENRE_COLORS[genre]}; box-shadow: 0 0 20px ${GENRE_COLORS[genre]};"></div>
                <span>${genre}</span>
            </div>
        `).join('');
    }

    /**
     * Get coordinates for a city name
     */
    getCityCoordinates(city, state) {
        const cityKey = `${city}, ${state}`.toLowerCase();
        
        const knownCities = {
            'san diego, california': [-117.1611, 32.7157],
            'los angeles, california': [-118.2437, 34.0522],
            'san francisco, california': [-122.4194, 37.7749],
            'austin, texas': [-97.7431, 30.2672],
            'houston, texas': [-95.3698, 29.7604],
            'dallas, texas': [-96.7970, 32.7767],
            'nashville, tennessee': [-86.7816, 36.1627],
            'memphis, tennessee': [-90.0490, 35.1495],
            'new york, new york': [-74.0060, 40.7128],
            'brooklyn, new york': [-73.9442, 40.6782],
            'chicago, illinois': [-87.6298, 41.8781],
            'atlanta, georgia': [-84.3880, 33.7490],
            'miami, florida': [-80.1918, 25.7617],
            'seattle, washington': [-122.3321, 47.6062],
            'portland, oregon': [-122.6750, 45.5152],
            'denver, colorado': [-104.9903, 39.7392],
            'phoenix, arizona': [-112.0740, 33.4484],
            'las vegas, nevada': [-115.1398, 36.1699],
            'new orleans, louisiana': [-90.0715, 29.9511],
            'detroit, michigan': [-83.0458, 42.3314],
            'philadelphia, pennsylvania': [-75.1652, 39.9526],
            'boston, massachusetts': [-71.0589, 42.3601],
            'washington, district of columbia': [-77.0369, 38.9072],
        };
        
        return knownCities[cityKey] || null;
    }

    /**
     * Normalize coordinates to [lng, lat] array format
     */
    normalizeCoordinates(coords) {
        if (!coords) return null;
        if (Array.isArray(coords) && coords.length === 2) return coords;
        if (coords.lng !== undefined && coords.lat !== undefined) return [coords.lng, coords.lat];
        if (coords._longitude !== undefined && coords._latitude !== undefined) return [coords._longitude, coords._latitude];
        return null;
    }

    /**
     * Initialize MapLibre with dark theme
     */
    initMap(userLocation) {
        if (typeof maplibregl === 'undefined') {
            console.error('MapLibre GL JS not loaded!');
            alert('Map library not loaded. Please refresh the page.');
            return;
        }

        // Extract coordinates from userLocation (handles multiple formats)
        let centerCoords;
        if (userLocation?.coordinates) {
            centerCoords = this.normalizeCoordinates(userLocation.coordinates);
        } else {
            centerCoords = this.normalizeCoordinates(userLocation);
        }
        
        // Fallback to center USA if no valid coords
        if (!centerCoords || !Array.isArray(centerCoords) || centerCoords.length !== 2) {
            console.warn('Invalid user location, using default center USA');
            centerCoords = [-98.5795, 39.8283];
        }
        
        console.log('🗺️ Initializing map with center:', centerCoords);

        this.map = new maplibregl.Map({
            container: 'soundscapeMap',
            style: {
                version: 8,
                sources: {
                    'osm': {
                        type: 'raster',
                        tiles: [
                            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: '© OpenStreetMap contributors'
                    }
                },
                layers: [
                    {
                        id: 'osm',
                        type: 'raster',
                        source: 'osm',
                        paint: {
                            'raster-opacity': 0.6,
                            'raster-brightness-min': 0,
                            'raster-brightness-max': 0.7,
                            'raster-saturation': -0.5
                        }
                    }
                ],
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
            },
            center: centerCoords,
            zoom: 4,
            maxZoom: 18,
            minZoom: 3
        });

        this.map.on('load', () => {
            console.log('📍 Map loaded, waiting for idle state...');
            
            // CRITICAL: Wait for map to be idle (all tiles loaded, projection ready)
            this.map.once('idle', () => {
                console.log('✅ Map is idle and ready, rendering orbs now...');
                this.renderCityOrbs();
                
                // Force another update after a brief delay to ensure positioning
                setTimeout(() => {
                    console.log('🔄 Forcing marker position update...');
                    this.updateMarkerPositions();
                }, 500);
            });
        });
        
        // Handle map errors
        this.map.on('error', (e) => {
            console.error('❌ Map error:', e);
        });
    }
    
    /**
     * Force update all marker positions
     * This fixes markers that appear at (0,0) in top-left corner
     */
    updateMarkerPositions() {
        if (!this.markers || this.markers.length === 0) {
            console.warn('No markers to update');
            return;
        }
        
        this.markers.forEach((marker, index) => {
            const lngLat = marker.getLngLat();
            console.log(`  Updating marker ${index + 1} at [${lngLat.lng.toFixed(4)}, ${lngLat.lat.toFixed(4)}]`);
            
            // Get the marker's DOM element
            const markerEl = marker.getElement();
            if (markerEl) {
                const transform = window.getComputedStyle(markerEl).transform;
                const position = window.getComputedStyle(markerEl).position;
                console.log(`    DOM transform: ${transform}`);
                console.log(`    DOM position: ${position}`);
                console.log(`    Parent:`, markerEl.parentElement?.className);
            }
            
            // Force re-render by removing and re-adding
            marker.remove();
            marker.addTo(this.map);
            
            // Check transform after re-adding
            if (markerEl) {
                const newTransform = window.getComputedStyle(markerEl).transform;
                console.log(`    NEW transform: ${newTransform}`);
            }
        });
        
        console.log(`✅ Updated ${this.markers.length} marker positions`);
        
        // Extra nuclear option: force map resize
        setTimeout(() => {
            console.log('🔄 Forcing map resize...');
            this.map.resize();
            
            // Check positions one more time
            this.markers.forEach((marker, index) => {
                const el = marker.getElement();
                if (el) {
                    const transform = window.getComputedStyle(el).transform;
                    console.log(`  Final marker ${index + 1} transform: ${transform}`);
                }
            });
        }, 200);
    }

    /**
     * CORE: Aggregate city data from artists and songs collections
     * This is where we build the real-time musical heatmap
     */
    async aggregateCityData() {
        try {
            console.log('🎵 Aggregating city data from user uploads...');
            
            // Get all artists with location data
            const artistsRef = collection(db, 'artists');
            const artistsSnapshot = await getDocs(artistsRef);
            
            // Map to store city aggregations
            const cityMap = new Map();
            
            // Track founding artists (early users)
            const foundingArtistThreshold = new Date();
            foundingArtistThreshold.setDate(foundingArtistThreshold.getDate() - 90); // First 90 days
            
            for (const artistDoc of artistsSnapshot.docs) {
                const artist = artistDoc.data();
                
                // Extract location
                const city = artist.city || artist.location?.city;
                const state = artist.state || artist.location?.state;
                
                if (!city || !state) continue;
                
                const cityKey = `${city}, ${state}`;
                
                // Initialize city data if not exists
                if (!cityMap.has(cityKey)) {
                    cityMap.set(cityKey, {
                        city: city,
                        state: state,
                        country: artist.country || artist.location?.country || 'United States',
                        artistCount: 0,
                        trackCount: 0,
                        recentUploads: 0,
                        genreCounts: {},
                        artists: [],
                        foundingArtists: 0,
                        audioProfiles: [], // For taste matching
                        topTracks: []
                    });
                }
                
                const cityData = cityMap.get(cityKey);
                cityData.artistCount++;
                cityData.artists.push(artistDoc.id);
                
                // Check if founding artist
                const createdAt = artist.createdAt?.toDate?.() || new Date(artist.createdAt);
                if (createdAt < foundingArtistThreshold) {
                    cityData.foundingArtists++;
                }
                
                // Get songs for this artist
                const songsRef = collection(db, 'songs');
                const artistSongsQuery = query(
                    songsRef,
                    where('artistId', '==', artistDoc.id),
                    orderBy('uploadedAt', 'desc'),
                    limit(10)
                );
                
                const songsSnapshot = await getDocs(artistSongsQuery);
                
                songsSnapshot.docs.forEach(songDoc => {
                    const song = songDoc.data();
                    cityData.trackCount++;
                    
                    // Count genres
                    if (song.genre) {
                        cityData.genreCounts[song.genre] = (cityData.genreCounts[song.genre] || 0) + 1;
                    }
                    
                    // Check if recent upload (last 24h)
                    const uploadedAt = song.uploadedAt?.toDate?.() || new Date(song.uploadedAt);
                    const oneDayAgo = new Date();
                    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
                    
                    if (uploadedAt > oneDayAgo) {
                        cityData.recentUploads++;
                    }
                    
                    // Store audio profile for taste matching
                    if (song.bpm || song.energy || song.key) {
                        cityData.audioProfiles.push({
                            bpm: song.bpm,
                            energy: song.energy,
                            key: song.key,
                            genre: song.genre
                        });
                    }
                    
                    // Store top tracks for preview
                    if (cityData.topTracks.length < 5) {
                        cityData.topTracks.push({
                            id: songDoc.id,
                            title: song.title,
                            artist: artist.name,
                            audioUrl: song.audioUrl,
                            genre: song.genre
                        });
                    }
                });
            }
            
            // Convert map to array and calculate final stats
            this.cities = Array.from(cityMap.values()).map(cityData => {
                // Determine top genre
                const genreArray = Object.entries(cityData.genreCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([genre]) => genre);
                
                const topGenre = genreArray[0] || 'Pop';
                
                // Determine activity level based on recent uploads
                let activity = 'low';
                if (cityData.recentUploads > 10) activity = 'high';
                else if (cityData.recentUploads > 5) activity = 'medium';
                
                // Get coordinates
                const coordinates = this.getCityCoordinates(cityData.city, cityData.state);
                
                return {
                    ...cityData,
                    topGenre: topGenre,
                    genres: genreArray.slice(0, 3),
                    activity: activity,
                    coordinates: coordinates
                };
            }).filter(city => city.coordinates); // Only cities with valid coordinates
            
            console.log(`✅ Aggregated ${this.cities.length} cities from user data`);
            
            // Fallback to dummy data if no real data
            if (this.cities.length === 0) {
                console.log('No user data found, using demo data');
                this.cities = this.getDummyCityData();
            }
            
        } catch (error) {
            console.error('Failed to aggregate city data:', error);
            this.cities = this.getDummyCityData();
        }
    }

    /**
     * Generate dummy city data for demo/testing
     */
    getDummyCityData() {
        return [
            {
                city: 'San Diego',
                state: 'California',
                country: 'United States',
                coordinates: [-117.1611, 32.7157],
                topGenre: 'Hip-Hop',
                genres: ['Hip-Hop', 'Electronic', 'Indie'],
                artistCount: 24,
                trackCount: 156,
                recentUploads: 12,
                foundingArtists: 8,
                activity: 'high',
                topTracks: []
            }
        ];
    }

    /**
     * Render glowing energy orbs for each city
     */
    renderCityOrbs() {
        console.log('🎯 Rendering city orbs. Total cities:', this.cities.length);
        
        if (!this.map) {
            console.error('Map not initialized!');
            return;
        }
        
        // Clear existing markers
        this.markers.forEach(marker => marker.remove());
        this.markers = [];
        
        this.cities.forEach((city, index) => {
            const coords = city.coordinates;
            
            if (!coords || !Array.isArray(coords) || coords.length !== 2) {
                console.warn(`⚠️ Cannot render ${city.city} - invalid coordinates:`, coords);
                return;
            }
            
            console.log(`  Rendering orb ${index + 1}/${this.cities.length}: ${city.city} at [${coords[0]}, ${coords[1]}]`);
            
            // Create pulsing energy orb
            const el = this.createOrbElement(city);
            
            // Store city reference on element for debugging
            el.dataset.city = city.city;
            el.dataset.coords = JSON.stringify(coords);
            
            // Create marker with explicit options
            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'center',
                offset: [0, 0]
            })
            .setLngLat(coords)
            .addTo(this.map);

            // Verify marker was added
            const markerElement = marker.getElement();
            console.log(`    Marker element in DOM:`, markerElement !== null, markerElement?.style.display);

            // Add interactions
            el.addEventListener('mouseenter', () => this.showCityCard(city));
            el.addEventListener('mouseleave', () => this.hideCityCard());
            el.addEventListener('click', () => this.selectCity(city));

            this.markers.push(marker);
        });
        
        console.log(`📍 Total energy orbs created: ${this.markers.length}`);
        
        // Force a map resize/refresh to ensure markers are visible
        setTimeout(() => {
            this.map.resize();
        }, 100);
    }

    /**
     * Create a glowing energy orb element
     * Size/brightness reflects recent activity
     */
    createOrbElement(city) {
        const el = document.createElement('div');
        el.className = 'map-orb';
        
        const color = GENRE_COLORS[city.topGenre] || '#88C9A1';
        const size = this.getOrbSize(city.activity, city.recentUploads);
        
        // CRITICAL: Don't set position styles that conflict with MapLibre
        // MapLibre handles positioning via transform
        el.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: radial-gradient(circle, ${color} 0%, ${color}80 30%, transparent 70%);
            box-shadow: 
                0 0 ${size * 0.5}px ${color}, 
                0 0 ${size}px ${color}, 
                0 0 ${size * 1.5}px ${color}40,
                inset 0 0 ${size * 0.3}px ${color};
            cursor: pointer;
            pointer-events: all;
        `;
        
        // Add data attributes for debugging
        el.dataset.cityName = city.city;
        el.dataset.lng = city.coordinates[0];
        el.dataset.lat = city.coordinates[1];
        
        // Inner core - more visible
        const inner = document.createElement('div');
        inner.style.cssText = `
            width: ${size * 0.4}px;
            height: ${size * 0.4}px;
            background: ${color};
            border-radius: 50%;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 1;
            box-shadow: 0 0 ${size * 0.2}px ${color};
            pointer-events: none;
        `;
        el.appendChild(inner);
        
        // Add founding artist badge if applicable
        if (city.foundingArtists > 0) {
            const badge = document.createElement('div');
            badge.innerHTML = '<i class="fas fa-medal"></i>';
            badge.style.cssText = `
                position: absolute;
                top: -8px;
                right: -8px;
                color: #D4AF37;
                font-size: 16px;
                filter: drop-shadow(0 0 6px #D4AF37);
                z-index: 10;
                background: rgba(0, 0, 0, 0.8);
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            `;
            el.appendChild(badge);
        }
        
        // Ensure animation is added to page
        this.ensureOrbAnimations();
        
        console.log(`  Created orb element for ${city.city}:`, el);
        
        return el;
    }
    
    /**
     * Add CSS animations for orbs if not already present
     */
    ensureOrbAnimations() {
        if (document.getElementById('orb-animations')) return;
        
        const style = document.createElement('style');
        style.id = 'orb-animations';
        style.textContent = `
            @keyframes orbPulse {
                0%, 100% { 
                    opacity: 0.85; 
                    filter: brightness(1);
                }
                50% { 
                    opacity: 1; 
                    filter: brightness(1.2);
                }
            }
            
            .map-orb {
                animation: orbPulse 2s ease-in-out infinite !important;
            }
            
            .map-orb:hover {
                opacity: 1 !important;
                filter: brightness(1.3) !important;
                animation: orbPulse 1s ease-in-out infinite !important;
            }
            
            /* Ensure MapLibre markers don't get overridden */
            .maplibregl-marker {
                will-change: transform !important;
            }
            
            /* Make sure no parent styles interfere */
            .maplibregl-canvas-container .maplibregl-marker {
                pointer-events: all !important;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Calculate orb size based on activity and recent uploads
     */
    getOrbSize(activity, recentUploads) {
        let baseSize = 45;
        
        if (activity === 'high') baseSize = 60;
        else if (activity === 'medium') baseSize = 50;
        else baseSize = 40;
        
        // Boost size for very recent activity
        if (recentUploads > 15) baseSize += 10;
        else if (recentUploads > 10) baseSize += 5;
        
        return baseSize;
    }

    /**
     * Show city card with taste match score
     */
    showCityCard(city) {
        this.currentCity = city;
        
        const card = document.getElementById('cityCard');
        const orb = document.getElementById('cityOrb');
        
        // Update card content
        document.getElementById('cityName').textContent = city.city;
        document.getElementById('cityLocation').textContent = `${city.state}, ${city.country}`;
        document.getElementById('artistCount').textContent = city.artistCount || 0;
        document.getElementById('trackCount').textContent = city.trackCount || 0;
        document.getElementById('recentCount').textContent = city.recentUploads || 0;
        
        // Set orb color
        const color = GENRE_COLORS[city.topGenre] || '#88C9A1';
        orb.style.background = `radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 70%)`;
        orb.style.boxShadow = `0 0 30px ${color}, 0 0 60px ${color}`;
        
        // Update genres
        const genreTags = document.getElementById('genreTags');
        const genres = city.genres || [city.topGenre] || ['Pop'];
        genreTags.innerHTML = genres.map(genre => {
            const genreColor = GENRE_COLORS[genre] || '#888';
            return `<span class="genre-tag" style="border-color: ${genreColor}; color: ${genreColor};">${genre}</span>`;
        }).join('');
        
        // Calculate and display taste match
        const tasteMatch = this.calculateTasteMatch(city);
        document.getElementById('tasteScore').textContent = `${tasteMatch.score}%`;
        document.getElementById('tasteMatchLabel').textContent = tasteMatch.label;
        document.getElementById('tasteMatchDesc').textContent = tasteMatch.description;
        
        // Show founding artist badge if applicable
        const pioneerBadge = document.getElementById('pioneerBadge');
        if (city.foundingArtists > 0) {
            pioneerBadge.style.display = 'flex';
            pioneerBadge.innerHTML = `<i class="fas fa-medal"></i> ${city.foundingArtists} Founding Artist${city.foundingArtists > 1 ? 's' : ''} Here`;
        } else {
            pioneerBadge.style.display = 'none';
        }
        
        // Show card
        card.classList.add('active');
    }

    /**
     * Hide city card
     */
    hideCityCard() {
        const card = document.getElementById('cityCard');
        setTimeout(() => {
            if (!card.matches(':hover')) {
                card.classList.remove('active');
            }
        }, 300);
    }

    /**
     * Calculate taste match score based on audio profile matching
     */
    calculateTasteMatch(city) {
        if (!this.userAudioProfile || !city.audioProfiles || city.audioProfiles.length === 0) {
            // Fallback to genre matching
            return this.calculateGenreMatch(city);
        }
        
        // Calculate BPM similarity
        const cityAvgBPM = city.audioProfiles.reduce((sum, p) => sum + (p.bpm || 120), 0) / city.audioProfiles.length;
        const bpmDiff = Math.abs(this.userAudioProfile.avgBPM - cityAvgBPM);
        const bpmScore = Math.max(0, 100 - (bpmDiff / 2)); // 50 BPM diff = 0 score
        
        // Calculate energy similarity
        const cityAvgEnergy = city.audioProfiles.reduce((sum, p) => sum + (p.energy || 0.5), 0) / city.audioProfiles.length;
        const energyDiff = Math.abs(this.userAudioProfile.avgEnergy - cityAvgEnergy);
        const energyScore = (1 - energyDiff) * 100;
        
        // Genre overlap
        const genreScore = this.calculateGenreMatch(city).score;
        
        // Weighted average
        const totalScore = Math.round((bpmScore * 0.3) + (energyScore * 0.2) + (genreScore * 0.5));
        
        // Generate description based on score
        let label = 'Taste Match';
        let description = 'Based on your listening history';
        
        if (totalScore >= 90) {
            label = 'Perfect Match!';
            description = `You're a ${totalScore}% match with the ${city.city} scene`;
        } else if (totalScore >= 75) {
            label = 'Great Match';
            description = `You'll love the ${city.city} vibe`;
        } else if (totalScore >= 60) {
            label = 'Good Match';
            description = 'Worth exploring';
        }
        
        return { score: totalScore, label, description };
    }

    /**
     * Fallback: Calculate match based on genre overlap only
     */
    calculateGenreMatch(city) {
        if (!this.userGenres || this.userGenres.length === 0) {
            return { score: 75, label: 'Taste Match', description: 'Based on your listening history' };
        }
        
        const userGenresNormalized = this.userGenres.map(g => g.toLowerCase());
        const genres = city.genres || [city.topGenre] || [];
        const cityGenresNormalized = genres.map(g => g.toLowerCase());
        
        const matches = cityGenresNormalized.filter(g => userGenresNormalized.includes(g)).length;
        const score = Math.round((matches / Math.max(this.userGenres.length, cityGenresNormalized.length)) * 100);
        
        return {
            score: Math.max(score, 50),
            label: 'Taste Match',
            description: 'Based on your listening history'
        };
    }

    /**
     * Select a city and fly to it
     */
    selectCity(city) {
        this.currentCity = city;
        
        const coords = city.coordinates;
        if (!coords) return;
        
        this.map.flyTo({
            center: coords,
            zoom: 11,
            duration: 2000
        });
    }

    /**
     * Explore the selected city - navigate to city dashboard
     */
    exploreCity() {
        if (!this.currentCity) return;
        
        if (window.navigateToCity) {
            window.navigateToCity(
                this.currentCity.city,
                this.currentCity.state,
                this.currentCity.country
            );
        }
        
        this.close();
    }

    /**
     * Preview city sound - play 5-second ambient mix
     */
    async previewSound() {
        if (!this.currentCity || !this.currentCity.topTracks || this.currentCity.topTracks.length === 0) {
            window.ui?.showToast(`No preview available for ${this.currentCity?.city}`);
            return;
        }
        
        const btn = document.getElementById('previewBtn');
        
        // Stop existing preview
        if (this.previewAudio) {
            this.previewAudio.pause();
            this.previewAudio = null;
            btn.innerHTML = '<i class="fas fa-play"></i>';
            return;
        }
        
        // Play top track preview (first 5 seconds)
        const topTrack = this.currentCity.topTracks[0];
        
        if (!topTrack.audioUrl) {
            window.ui?.showToast(`No audio available`);
            return;
        }
        
        this.previewAudio = new Audio(topTrack.audioUrl);
        this.previewAudio.volume = 0.7;
        
        // Play only 5 seconds
        this.previewAudio.play();
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        
        setTimeout(() => {
            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio = null;
                btn.innerHTML = '<i class="fas fa-play"></i>';
            }
        }, 5000);
        
        window.ui?.showToast(`🎵 Playing ${this.currentCity.city} preview...`);
    }

    /**
     * Close the map modal
     */
    close() {
        // Stop any playing preview
        if (this.previewAudio) {
            this.previewAudio.pause();
            this.previewAudio = null;
        }
        
        document.getElementById('cityMapModal').style.display = 'none';
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.markers = [];
    }
}

// Export for global access
window.CitySoundscapeMap = CitySoundscapeMap;