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
                            'raster-opacity': 0.3, // Dim for dark mode
                            'raster-brightness-min': 0.1,
                            'raster-brightness-max': 0.4
                        }
                    }
                ],
                glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
            },
            center: userLocation?.coordinates || [-117.1611, 32.7157], // Default to San Diego
            zoom: 4,
            pitch: 0,
            bearing: 0
        });

        this.map.on('load', () => {
            this.renderCityOrbs();
        });

        // Add navigation controls
        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
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
                this.cities = data.cities || this.getDummyCityData();
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
        this.cities.forEach(city => {
            const el = this.createOrbElement(city);
            
            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'center'
            })
            .setLngLat(city.coordinates)
            .addTo(this.map);

            // Add hover interaction
            el.addEventListener('mouseenter', () => this.showCityCard(city));
            el.addEventListener('mouseleave', () => this.hideCityCard());
            el.addEventListener('click', () => this.selectCity(city));

            this.markers.push(marker);
        });
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
            position: relative;
            transition: all 0.3s;
        `;
        
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
                    z-index: 1000;
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
            case 'high': return 40;
            case 'medium': return 30;
            case 'low': return 20;
            default: return 30;
        }
    }

    /**
     * Show city card on hover
     */
    showCityCard(city) {
        this.currentCity = city;
        
        const card = document.getElementById('cityCard');
        const orb = document.getElementById('cityOrb');
        
        // Update card content
        document.getElementById('cityName').textContent = city.city;
        document.getElementById('cityLocation').textContent = `${city.state}, ${city.country}`;
        document.getElementById('artistCount').textContent = city.artistCount;
        document.getElementById('trackCount').textContent = city.trackCount;
        document.getElementById('crateCount').textContent = city.crateCount;
        
        // Set orb color
        const color = GENRE_COLORS[city.topGenre] || '#88C9A1';
        orb.style.background = `radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 70%)`;
        orb.style.boxShadow = `0 0 30px ${color}, 0 0 60px ${color}`;
        
        // Update genres
        const genreTags = document.getElementById('genreTags');
        genreTags.innerHTML = city.genres.map(genre => {
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
        const cityGenresNormalized = city.genres.map(g => g.toLowerCase());
        
        const matches = cityGenresNormalized.filter(g => 
            userGenresNormalized.includes(g)
        ).length;
        
        const score = Math.round((matches / Math.max(this.userGenres.length, city.genres.length)) * 100);
        return Math.max(score, 50); // Minimum 50% to keep it encouraging
    }

    /**
     * Select a city and explore
     */
    selectCity(city) {
        this.currentCity = city;
        // Fly to city
        this.map.flyTo({
            center: city.coordinates,
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