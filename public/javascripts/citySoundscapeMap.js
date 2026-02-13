/* public/javascripts/citySoundscapeMap.js */
// ES6 Module for City Soundscape Map

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

// Genre color mapping from themes.css
const GENRE_COLORS = {
    'Pop': '#D282A6',
    'Electronic': '#00FFD1',
    'Hip-Hop': '#D4AF37',
    'Rock': '#FF3333',
    'R&B': '#9D4EDD',
    'RnB': '#9D4EDD',
    'Jazz': '#E9C46A',
    'Country': '#606C38',
    'Reggae': '#2A9D8F',
    'Classical': '#B59D71',
    'Lo-Fi': '#9D4EDD',
    'Indie': '#FF3333',
    'Metal': '#FF3333',
    'Folk': '#606C38',
    'Blues': '#E9C46A'
};

export class CitySoundscapeMap {
    constructor() {
        this.map = null;
        this.markers = [];
        this.currentCity = null;
        this.cities = [];
        this.userGenres = [];
        this.mapLibreLoaded = false;
    }

    /**
     * Dynamically load MapLibre GL JS if not already loaded
     */
    async ensureMapLibreLoaded() {
        // Check if already loaded
        if (typeof maplibregl !== 'undefined') {
            this.mapLibreLoaded = true;
            return true;
        }

        // console.log('📦 Loading MapLibre GL JS...');

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
                    // console.log('✅ MapLibre GL JS loaded successfully');
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
     * Initialize the map modal and MapLibre instance
     */
    async init(userLocation, userGenres = []) {
        // Ensure MapLibre is loaded first
        const loaded = await this.ensureMapLibreLoaded();
        if (!loaded) {
            throw new Error('MapLibre GL JS failed to load');
        }

        this.userGenres = userGenres;
        
        // Fetch city data from API
        await this.loadCityData();
        
        // Create modal if it doesn't exist
        if (!document.getElementById('cityMapModal')) {
            this.createModal();
        }
        
        // Show modal
        document.getElementById('cityMapModal').style.display = 'flex';
        
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
                                <strong>Taste Match</strong><br>
                                Based on your listening history
                            </div>
                        </div>
                        
                        <div class="city-stats">
                            <div class="stat">
                                <span class="stat-value" id="artistCount">0</span>
                                <span class="stat-label">Artists</span>
                            </div>
                            <div class="stat">
                                <span class="stat-value" id="trackCount">0</span>
                                <span class="stat-label">Tracks</span>
                            </div>
                            <div class="stat">
                                <span class="stat-value" id="crateCount">0</span>
                                <span class="stat-label">Crates</span>
                            </div>
                        </div>
                        
                        <div class="genre-tags" id="genreTags"></div>
                        
                        <div class="city-actions">
                            <button class="btn-explore" onclick="window.cityMap.exploreCity()">
                                <i class="fas fa-compass"></i> Explore Scene
                            </button>
                            <button class="btn-preview" onclick="window.cityMap.previewSound()">
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
    }

    /**
     * Create legend HTML from genre colors
     */
    createLegendHTML() {
        const topGenres = ['Pop', 'Hip-Hop', 'Electronic', 'R&B', 'Rock', 'Jazz'];
        return topGenres.map(genre => `
            <div class="legend-item">
                <div class="legend-color" style="background: ${GENRE_COLORS[genre]}; box-shadow: 0 0 20px ${GENRE_COLORS[genre]};"></div>
                <span>${genre}</span>
            </div>
        `).join('');
    }

    /**
     * Get coordinates for a city name (fallback if not in database)
     */
    getCityCoordinates(city, state) {
        const cityKey = `${city}, ${state}`.toLowerCase();
        
        // Common US city coordinates
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
            'charlotte, north carolina': [-80.8431, 35.2271],
            'richmond, virginia': [-77.4360, 37.5407],
            'kansas city, missouri': [-94.5786, 39.0997],
            'st. louis, missouri': [-90.1994, 38.6270],
            'minneapolis, minnesota': [-93.2650, 44.9778],
            'milwaukee, wisconsin': [-87.9065, 43.0389],
            'indianapolis, indiana': [-86.1581, 39.7684],
            'columbus, ohio': [-82.9988, 39.9612],
            'cleveland, ohio': [-81.6944, 41.4993],
            'pittsburgh, pennsylvania': [-79.9959, 40.4406],
            'baltimore, maryland': [-76.6122, 39.2904],
            'sacramento, california': [-121.4944, 38.5816],
            'oakland, california': [-122.2711, 37.8044],
            'san jose, california': [-121.8863, 37.3382],
        };
        
        return knownCities[cityKey] || null;
    }

    /**
     * Normalize coordinates to [lng, lat] array format
     * Handles various input formats from database
     */
    normalizeCoordinates(coords) {
        if (!coords) {
            return [-117.1611, 32.7157]; // Default to San Diego
        }

        // Already in [lng, lat] array format
        if (Array.isArray(coords) && coords.length === 2) {
            return coords;
        }

        // Object with lng/lat
        if (coords.lng !== undefined && coords.lat !== undefined) {
            return [coords.lng, coords.lat];
        }

        // Object with lon/lat (alternative naming)
        if (coords.lon !== undefined && coords.lat !== undefined) {
            return [coords.lon, coords.lat];
        }

        // Object with longitude/latitude (full names)
        if (coords.longitude !== undefined && coords.latitude !== undefined) {
            return [coords.longitude, coords.latitude];
        }

        // Firestore GeoPoint format
        if (coords._latitude !== undefined && coords._longitude !== undefined) {
            return [coords._longitude, coords._latitude];
        }

        // Legacy format: {lat, lng} or {latitude, longitude}
        // MapLibre expects [lng, lat] so we need to swap!
        if (coords.lat !== undefined && coords.lng !== undefined) {
            return [coords.lng, coords.lat];
        }
        if (coords.latitude !== undefined && coords.longitude !== undefined) {
            return [coords.longitude, coords.latitude];
        }

        // console.warn('Unknown coordinate format:', coords);
        return [-117.1611, 32.7157]; // Fallback to San Diego
    }

    /**
     * Initialize MapLibre with dark theme
     */
    initMap(userLocation) {
        // Check if MapLibre is loaded
        if (typeof maplibregl === 'undefined') {
            // MapLibre not loaded - show user-friendly error
            console.error('MapLibre GL JS not loaded!');
            alert('Map library not loaded. Please refresh the page.');
            return;
        }

        // Use free tile provider (OpenStreetMap)
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
                            'raster-opacity': 0.6,           // Increased from 0.3
                            'raster-brightness-min': 0,      // Removed min constraint
                            'raster-brightness-max': 0.7,    // Increased from 0.4
                            'raster-saturation': -0.5        // Desaturate for dark theme
                        }
                    }
                ],
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
            },
            center: this.normalizeCoordinates(userLocation) || [-98.5795, 39.8283], // Center USA
            zoom: 4,
            maxZoom: 18,
            minZoom: 3
        });

        // Wait for map to load before rendering orbs
        this.map.on('load', () => {
            this.renderCityOrbs();
        });
    }

    /**
     * Load city data from API
     */
    async loadCityData() {
        try {
            const token = await auth.currentUser?.getIdToken();
            
            if (!token) {
                // console.warn('No auth token, using dummy data');
                this.cities = this.getDummyCityData();
                return;
            }
            
            const res = await fetch('/player/api/cities/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
                const data = await res.json();
                // Normalize city data to ensure consistent field names
                this.cities = (data.cities || this.getDummyCityData()).map(city => this.normalizeCityData(city));
            } else {
                // Fallback to dummy data for v1
                this.cities = this.getDummyCityData();
            }
        } catch (e) {
            console.error('Failed to load city data:', e);
            this.cities = this.getDummyCityData();
        }
    }

    /**
     * Normalize city data from API to ensure consistent field names
     */
    normalizeCityData(city) {
        return {
            // Handle different possible field names for city
            city: city.city || city.name || city.cityName || 'Unknown City',
            
            // Handle different possible field names for state
            state: city.state || city.region || city.stateProvince || city.stateName || '',
            
            // Handle different possible field names for country
            country: city.country || city.countryName || 'United States',
            
            // Preserve other fields
            coordinates: city.coordinates || city.coords || city.location,
            topGenre: city.topGenre || city.primaryGenre || city.genre || 'Pop',
            genres: city.genres || city.genreList || [city.topGenre || 'Pop'],
            artistCount: city.artistCount || city.artists || city.totalArtists || 0,
            trackCount: city.trackCount || city.tracks || city.totalTracks || 0,
            crateCount: city.crateCount || city.crates || city.totalCrates || 0,
            activity: city.activity || city.activityLevel || 'medium'
        };
    }

    /**
     * Generate dummy city data for testing (until city stats collection exists)
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
                crateCount: 12,
                activity: 'high'
            },
            {
                city: 'Los Angeles',
                state: 'California',
                country: 'United States',
                coordinates: [-118.2437, 34.0522],
                topGenre: 'Pop',
                genres: ['Pop', 'Hip-Hop', 'R&B'],
                artistCount: 89,
                trackCount: 543,
                crateCount: 45,
                activity: 'high'
            },
            {
                city: 'Austin',
                state: 'Texas',
                country: 'United States',
                coordinates: [-97.7431, 30.2672],
                topGenre: 'Rock',
                genres: ['Rock', 'Country', 'Blues'],
                artistCount: 56,
                trackCount: 312,
                crateCount: 28,
                activity: 'medium'
            },
            {
                city: 'Nashville',
                state: 'Tennessee',
                country: 'United States',
                coordinates: [-86.7816, 36.1627],
                topGenre: 'Country',
                genres: ['Country', 'Rock', 'Blues'],
                artistCount: 67,
                trackCount: 401,
                crateCount: 34,
                activity: 'high'
            },
            {
                city: 'New York',
                state: 'New York',
                country: 'United States',
                coordinates: [-74.0060, 40.7128],
                topGenre: 'Hip-Hop',
                genres: ['Hip-Hop', 'Jazz', 'Electronic'],
                artistCount: 124,
                trackCount: 789,
                crateCount: 67,
                activity: 'high'
            }
        ];
    }

    /**
     * Render glowing energy orbs for each city
     */
    renderCityOrbs() {
        console.log('🎯 Rendering city orbs. Total cities:', this.cities.length);
        
        this.cities.forEach(city => {
            console.log(`  Processing city: ${city.city}`);
            
            // Get coordinates with fallback
            let coords = this.normalizeCoordinates(city.coordinates);
            
            // If no coords or invalid coords, try getCityCoordinates lookup
            if (!coords || (coords[0] === -117.1611 && coords[1] === 32.7157 && city.city !== 'San Diego')) {
                console.log(`    No valid coords found, looking up: ${city.city}, ${city.state}`);
                coords = this.getCityCoordinates(city.city, city.state);
            }
            
            if (!coords) {
                console.warn(`    ⚠️ Cannot render ${city.city} - no coordinates available`);
                return;
            }
            
            console.log(`    Coords: [${coords[0]}, ${coords[1]}]`);
            
            // Create orb element
            const el = this.createOrbElement(city);
            
            // Create marker at coordinates
            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'center'
            })
            .setLngLat(coords)
            .addTo(this.map);

            console.log(`  Marker created and added to map`);

            // Add hover interaction
            el.addEventListener('mouseenter', () => this.showCityCard(city));
            el.addEventListener('mouseleave', () => this.hideCityCard());
            el.addEventListener('click', () => this.selectCity(city));

            this.markers.push(marker);
        });
        
        console.log(`📍 Total markers created: ${this.markers.length}`);
    }

    /**
     * Create a glowing orb DOM element
     */
    createOrbElement(city) {
        const el = document.createElement('div');
        el.className = 'map-orb';
        
        const color = GENRE_COLORS[city.topGenre] || '#88C9A1';
        const size = this.getOrbSize(city.activity);
        
        el.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 70%);
            box-shadow: 0 0 ${size}px ${color}, 0 0 ${size * 2}px ${color};
            cursor: pointer;
            animation: orbPulse 2s infinite;
            position: absolute;
            transition: all 0.3s;
            pointer-events: all;
            z-index: 1000;
            display: block;
        `;
        
        // Add a visible inner circle for debugging
        const inner = document.createElement('div');
        inner.style.cssText = `
            width: 20px;
            height: 20px;
            background: ${color};
            border-radius: 50%;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0.8;
        `;
        el.appendChild(inner);
        
        // Add CSS animation for pulse (if not already added)
        if (!document.getElementById('orb-animations')) {
            const style = document.createElement('style');
            style.id = 'orb-animations';
            style.textContent = `
                @keyframes orbPulse {
                    0%, 100% { transform: scale(1); opacity: 0.8; }
                    50% { transform: scale(1.2); opacity: 1; }
                }
                .map-orb:hover {
                    transform: scale(1.3) !important;
                    z-index: 10000 !important;
                }
            `;
            document.head.appendChild(style);
        }
        
        return el;
    }

    /**
     * Get orb size based on activity level
     */
    getOrbSize(activity) {
        switch(activity) {
            case 'high': return 60;    // Increased from 40
            case 'medium': return 45;  // Increased from 30
            case 'low': return 30;     // Increased from 20
            default: return 45;
        }
    }

    /**
     * Show city card on hover
     */
    showCityCard(city) {
        this.currentCity = city;
        
        const card = document.getElementById('cityCard');
        const orb = document.getElementById('cityOrb');
        
        // Update card content with safe fallbacks
        document.getElementById('cityName').textContent = city.city || 'Unknown City';
        
        // Build location string with available data
        const locationParts = [];
        if (city.state) locationParts.push(city.state);
        if (city.country) locationParts.push(city.country);
        document.getElementById('cityLocation').textContent = locationParts.join(', ') || 'Unknown Location';
        
        document.getElementById('artistCount').textContent = city.artistCount || 0;
        document.getElementById('trackCount').textContent = city.trackCount || 0;
        document.getElementById('crateCount').textContent = city.crateCount || 0;
        
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
        
        // Calculate taste match
        const tasteMatch = this.calculateTasteMatch(city);
        document.getElementById('tasteScore').textContent = `${tasteMatch}%`;
        
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
     * Calculate taste match score based on genre overlap
     */
    calculateTasteMatch(city) {
        if (!this.userGenres || this.userGenres.length === 0) {
            return 75; // Default score
        }
        
        const userGenresNormalized = this.userGenres.map(g => g.toLowerCase());
        const genres = city.genres || [city.topGenre] || [];
        const cityGenresNormalized = genres.map(g => g.toLowerCase());
        
        const matches = cityGenresNormalized.filter(g => 
            userGenresNormalized.includes(g)
        ).length;
        
        const score = Math.round((matches / Math.max(this.userGenres.length, cityGenresNormalized.length)) * 100);
        return Math.max(score, 50); // Minimum 50% to keep it encouraging
    }

    /**
     * Select a city and explore
     */
    selectCity(city) {
        this.currentCity = city;
        
        // Get coordinates with fallback
        let coords = this.normalizeCoordinates(city.coordinates);
        if (!coords || (coords[0] === -117.1611 && coords[1] === 32.7157 && city.city !== 'San Diego')) {
            coords = this.getCityCoordinates(city.city, city.state);
        }
        
        if (!coords) {
            // console.warn(`Cannot fly to ${city.city} - no coordinates`);
            return;
        }
        
        // Fly to city
        this.map.flyTo({
            center: coords,
            zoom: 11,
            duration: 2000
        });
    }

    /**
     * Explore the selected city
     */
    exploreCity() {
        if (!this.currentCity) return;
        
        // Navigate to city dashboard
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
     * Preview city sound (5-second ambient mix)
     */
    async previewSound() {
        if (!this.currentCity) return;
        
        // TODO: Implement 5-second preview mixing
        // console.log('🎵 Playing preview for:', this.currentCity.city);
        window.ui?.showToast(`🎵 Playing ${this.currentCity.city} sound preview...`);
    }

    /**
     * Close the map modal
     */
    close() {
        document.getElementById('cityMapModal').style.display = 'none';
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.markers = [];
    }
}

// Log that the module is loaded
// console.log('🗺️ City Soundscape Map Module Loaded');