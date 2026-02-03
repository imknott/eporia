/* public/javascripts/states.js */
// =========================================
// EPORIA LOCATION DATABASE
// =========================================
// This file contains curated city data for location autocomplete.
// It tracks user selections to build our own location API over time.

// =========================================
// US CITIES BY STATE
// =========================================
export const US_STATE_CITIES = {
    // --- WEST ---
    'California': [
        { id: 'sd', name: 'San Diego', emoji: '🌊', color: 200 },
        { id: 'la', name: 'Los Angeles', emoji: '🌴', color: 30 },
        { id: 'sf', name: 'San Francisco', emoji: '🌁', color: 210 },
        { id: 'oak', name: 'Oakland', emoji: '🌳', color: 150 },
        { id: 'sac', name: 'Sacramento', emoji: '🏛️', color: 45 },
        { id: 'sj', name: "San Jose", emoji: "💻", color: 190 }
    ],
    'Oregon': [
        { id: 'pdx', name: 'Portland', emoji: '🌲', color: 140 },
        { id: 'sal', name: 'Salem', emoji: '🍒', color: 340 },
        { id: 'eug', name: 'Eugene', emoji: '🏃', color: 100 }
    ],
    'Washington': [
        { id: 'sea', name: 'Seattle', emoji: '☕', color: 180 },
        { id: 'spo', name: 'Spokane', emoji: '🏞️', color: 30 },
        { id: 'tac', name: 'Tacoma', emoji: '🗻', color: 200 }
    ],
    'Nevada': [
        { id: 'lv', name: 'Las Vegas', emoji: '🎰', color: 320 },
        { id: 'rno', name: 'Reno', emoji: '🎲', color: 240 },
        { id: 'cc', name: 'Carson City', emoji: '🪙', color: 50 }
    ],
    'Arizona': [
        { id: 'phx', name: 'Phoenix', emoji: '🌵', color: 25 },
        { id: 'tuc', name: 'Tucson', emoji: '☀️', color: 45 },
        { id: 'flg', name: 'Flagstaff', emoji: '🌲', color: 160 }
    ],
    'Hawaii': [
        { id: 'hnl', name: 'Honolulu', emoji: '🌺', color: 300 },
        { id: 'hil', name: 'Hilo', emoji: '🌋', color: 10 },
        { id: 'kah', name: 'Kahului', emoji: '🍍', color: 60 }
    ],
    'Alaska': [
        { id: 'anc', name: 'Anchorage', emoji: '🏔️', color: 190 },
        { id: 'jun', name: 'Juneau', emoji: '❄️', color: 210 },
        { id: 'fai', name: 'Fairbanks', emoji: '🌌', color: 270 }
    ],

    // --- MOUNTAIN ---
    'Colorado': [
        { id: 'den', name: 'Denver', emoji: '🏔️', color: 210 },
        { id: 'cos', name: 'Colorado Springs', emoji: '🌲', color: 140 },
        { id: 'bou', name: 'Boulder', emoji: '🧗', color: 30 }
    ],
    'Utah': [
        { id: 'slc', name: 'Salt Lake City', emoji: '🐝', color: 40 },
        { id: 'pro', name: 'Provo', emoji: '⛰️', color: 220 },
        { id: 'ogd', name: 'Ogden', emoji: '🚂', color: 180 }
    ],
    'Idaho': [
        { id: 'boi', name: 'Boise', emoji: '🥔', color: 30 },
        { id: 'mer', name: 'Meridian', emoji: '🏡', color: 150 },
        { id: 'if', name: 'Idaho Falls', emoji: '🌊', color: 200 }
    ],
    'Montana': [
        { id: 'bil', name: 'Billings', emoji: '🤠', color: 45 },
        { id: 'mis', name: 'Missoula', emoji: '🐻', color: 160 },
        { id: 'boz', name: 'Bozeman', emoji: '🎿', color: 210 }
    ],
    'Wyoming': [
        { id: 'che', name: 'Cheyenne', emoji: '🚂', color: 350 },
        { id: 'cas', name: 'Casper', emoji: '👻', color: 180 },
        { id: 'jac', name: 'Jackson', emoji: '🏂', color: 210 }
    ],
    'New Mexico': [
        { id: 'abq', name: 'Albuquerque', emoji: '🎈', color: 20 },
        { id: 'sfe', name: 'Santa Fe', emoji: '🎨', color: 300 },
        { id: 'lc', name: 'Las Cruces', emoji: '🌶️', color: 10 }
    ],

    // --- SOUTHWEST / TEXAS ---
    'Texas': [
        { id: 'aus', name: 'Austin', emoji: '🎸', color: 200 },
        { id: 'hou', name: 'Houston', emoji: '🚀', color: 230 },
        { id: 'dal', name: 'Dallas', emoji: '🤠', color: 30 },
        { id: 'sa', name: 'San Antonio', emoji: '🌮', color: 210 },
        { id: 'fw', name: 'Fort Worth', emoji: '🐴', color: 205 },
        { id: 'ep', name: 'El Paso', emoji: '🌵', color: 180 }
    ],
    'Oklahoma': [
        { id: 'okc', name: 'Oklahoma City', emoji: '🌪️', color: 210 },
        { id: 'tul', name: 'Tulsa', emoji: '🛢️', color: 40 },
        { id: 'nor', name: 'Norman', emoji: '🎓', color: 350 }
    ],

    // --- MIDWEST ---
    'Illinois': [
        { id: 'chi', name: 'Chicago', emoji: '🍕', color: 220 },
        { id: 'spr', name: 'Springfield', emoji: '🎩', color: 45 },
        { id: 'aur', name: 'Aurora', emoji: '✨', color: 280 }
    ],
    'Ohio': [
        { id: 'col', name: 'Columbus', emoji: '🏈', color: 350 },
        { id: 'cle', name: 'Cleveland', emoji: '🎸', color: 20 },
        { id: 'cin', name: 'Cincinnati', emoji: '⚾', color: 10 }
    ],
    'Michigan': [
        { id: 'det', name: 'Detroit', emoji: '✊🏿', color: 240 },
        { id: 'gr', name: 'Grand Rapids', emoji: '🍺', color: 40 },
        { id: 'aa', name: 'Ann Arbor', emoji: '🌳', color: 120 }
    ],
    'Wisconsin': [
        { id: 'mil', name: 'Milwaukee', emoji: '🧀', color: 45 },
        { id: 'mad', name: 'Madison', emoji: '🦡', color: 350 },
        { id: 'gb', name: 'Green Bay', emoji: '🏈', color: 140 }
    ],
    'Minnesota': [
        { id: 'msp', name: 'Minneapolis', emoji: '❄️', color: 200 },
        { id: 'stp', name: 'St. Paul', emoji: '🏛️', color: 220 },
        { id: 'dul', name: 'Duluth', emoji: '🚢', color: 240 }
    ],
    'Indiana': [
        { id: 'ind', name: 'Indianapolis', emoji: '🏎️', color: 30 },
        { id: 'fw', name: 'Fort Wayne', emoji: '🏰', color: 150 },
        { id: 'evn', name: 'Evansville', emoji: '🛶', color: 200 }
    ],
    'Missouri': [
        { id: 'stl', name: 'St. Louis', emoji: '🌉', color: 350 },
        { id: 'kc', name: 'Kansas City', emoji: '🍖', color: 10 },
        { id: 'spr', name: 'Springfield', emoji: '🛣️', color: 100 }
    ],
    'Kansas': [
        { id: 'wic', name: 'Wichita', emoji: '🌻', color: 50 },
        { id: 'op', name: 'Overland Park', emoji: '🌳', color: 140 },
        { id: 'top', name: 'Topeka', emoji: '⚖️', color: 210 }
    ],
    'Iowa': [
        { id: 'dsm', name: 'Des Moines', emoji: '🌽', color: 50 },
        { id: 'cr', name: 'Cedar Rapids', emoji: '🏞️', color: 150 },
        { id: 'dav', name: 'Davenport', emoji: '🌊', color: 220 }
    ],
    'Nebraska': [
        { id: 'oma', name: 'Omaha', emoji: '🥩', color: 10 },
        { id: 'lin', name: 'Lincoln', emoji: '🌽', color: 350 },
        { id: 'bel', name: 'Bellevue', emoji: '✈️', color: 200 }
    ],
    'North Dakota': [
        { id: 'far', name: 'Fargo', emoji: '❄️', color: 210 },
        { id: 'bis', name: 'Bismarck', emoji: '🏛️', color: 45 },
        { id: 'gf', name: 'Grand Forks', emoji: '🏒', color: 120 }
    ],
    'South Dakota': [
        { id: 'sf', name: 'Sioux Falls', emoji: '🌊', color: 200 },
        { id: 'rc', name: 'Rapid City', emoji: '🗿', color: 30 },
        { id: 'abr', name: 'Aberdeen', emoji: '🚂', color: 100 }
    ],

    // --- SOUTH ---
    'Georgia': [
        { id: 'atl', name: 'Atlanta', emoji: '🍑', color: 20 },
        { id: 'sav', name: 'Savannah', emoji: '🌳', color: 140 },
        { id: 'aug', name: 'Augusta', emoji: '⛳', color: 100 }
    ],
    'Florida': [
        { id: 'mia', name: 'Miami', emoji: '🦩', color: 320 },
        { id: 'orl', name: 'Orlando', emoji: '🎢', color: 45 },
        { id: 'tpa', name: 'Tampa', emoji: '🏴‍☠️', color: 350 },
        { id: 'jax', name: 'Jacksonville', emoji: '🏈', color: 200 },
        { id: 'ftl', name: 'Fort Lauderdale', emoji: '⛱️', color: 280 },
        { id: 'tal', name: 'Tallahassee', emoji: '🏛️', color: 170 }
    ],
    'North Carolina': [
        { id: 'clt', name: 'Charlotte', emoji: '👑', color: 210 },
        { id: 'ral', name: 'Raleigh', emoji: '🌳', color: 140 },
        { id: 'avl', name: 'Asheville', emoji: '🏔️', color: 300 },
        { id: 'dur', name: 'Durham', emoji: '🏀', color: 190 }
    ],
    'South Carolina': [
        { id: 'chs', name: 'Charleston', emoji: '🌴', color: 200 },
        { id: 'col', name: 'Columbia', emoji: '🐯', color: 340 },
        { id: 'myr', name: 'Myrtle Beach', emoji: '🏖️', color: 180 },
        { id: 'grv', name: 'Greenville', emoji: '🌳', color: 170 }
    ],
    'Virginia': [
        { id: 'vb', name: 'Virginia Beach', emoji: '🌊', color: 210 },
        { id: 'ric', name: 'Richmond', emoji: '🏛️', color: 350 },
        { id: 'nor', name: 'Norfolk', emoji: '⚓', color: 220 },
        { id: 'arl', name: 'Arlington', emoji: '🏢', color: 185 }
    ],
    'Tennessee': [
        { id: 'nas', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'mem', name: 'Memphis', emoji: '🎷', color: 200 },
        { id: 'knx', name: 'Knoxville', emoji: '🏈', color: 30 }
    ],
    'Kentucky': [
        { id: 'lou', name: 'Louisville', emoji: '🏇', color: 30 },
        { id: 'lex', name: 'Lexington', emoji: '🐴', color: 210 },
        { id: 'bow', name: 'Bowling Green', emoji: '🎳', color: 100 }
    ],
    'Alabama': [
        { id: 'bir', name: 'Birmingham', emoji: '⚒️', color: 15 },
        { id: 'mob', name: 'Mobile', emoji: '⚓', color: 200 },
        { id: 'mon', name: 'Montgomery', emoji: '🏛️', color: 350 }
    ],
    'Mississippi': [
        { id: 'jax', name: 'Jackson', emoji: '🎺', color: 210 },
        { id: 'gul', name: 'Gulfport', emoji: '🌊', color: 200 },
        { id: 'sou', name: 'Southaven', emoji: '🏘️', color: 30 }
    ],
    'Louisiana': [
        { id: 'nol', name: 'New Orleans', emoji: '🎺', color: 280 },
        { id: 'br', name: 'Baton Rouge', emoji: '🏈', color: 350 },
        { id: 'laf', name: 'Lafayette', emoji: '🎭', color: 30 }
    ],
    'Arkansas': [
        { id: 'lr', name: 'Little Rock', emoji: '🪨', color: 200 },
        { id: 'fay', name: 'Fayetteville', emoji: '🏈', color: 350 },
        { id: 'ft', name: 'Fort Smith', emoji: '🏰', color: 30 }
    ],

    // --- NORTHEAST ---
    'New York': [
        { id: 'nyc', name: 'New York City', emoji: '🗽', color: 210 },
        { id: 'buf', name: 'Buffalo', emoji: '🦬', color: 220 },
        { id: 'roc', name: 'Rochester', emoji: '📸', color: 200 },
        { id: 'alb', name: 'Albany', emoji: '🏛️', color: 190 },
        { id: 'syr', name: 'Syracuse', emoji: '🍊', color: 30 }
    ],
    'Pennsylvania': [
        { id: 'phi', name: 'Philadelphia', emoji: '🔔', color: 240 },
        { id: 'pit', name: 'Pittsburgh', emoji: '🏈', color: 50 },
        { id: 'all', name: 'Allentown', emoji: '🏭', color: 160 }
    ],
    'New Jersey': [
        { id: 'new', name: 'Newark', emoji: '✈️', color: 190 },
        { id: 'jc', name: 'Jersey City', emoji: '🌆', color: 200 },
        { id: 'hob', name: 'Hoboken', emoji: '🎵', color: 180 }
    ],
    'Massachusetts': [
        { id: 'bos', name: 'Boston', emoji: '🏛️', color: 260 },
        { id: 'cam', name: 'Cambridge', emoji: '🎓', color: 240 },
        { id: 'wor', name: 'Worcester', emoji: '🏭', color: 160 }
    ],
    'Connecticut': [
        { id: 'har', name: 'Hartford', emoji: '🏛️', color: 170 },
        { id: 'nh', name: 'New Haven', emoji: '🎓', color: 180 },
        { id: 'bri', name: 'Bridgeport', emoji: '🌊', color: 160 }
    ],
    'Rhode Island': [
        { id: 'pro', name: 'Providence', emoji: '⚓', color: 180 },
        { id: 'war', name: 'Warwick', emoji: '🏖️', color: 200 },
        { id: 'cra', name: 'Cranston', emoji: '🏘️', color: 150 }
    ],
    'Vermont': [
        { id: 'bur', name: 'Burlington', emoji: '🍁', color: 150 },
        { id: 'sth', name: 'South Burlington', emoji: '🏔️', color: 170 },
        { id: 'rut', name: 'Rutland', emoji: '⛷️', color: 200 }
    ],
    'New Hampshire': [
        { id: 'man', name: 'Manchester', emoji: '🏔️', color: 160 },
        { id: 'nas', name: 'Nashua', emoji: '🌲', color: 140 },
        { id: 'con', name: 'Concord', emoji: '🏛️', color: 180 }
    ],
    'Maine': [
        { id: 'por', name: 'Portland', emoji: '🦞', color: 180 },
        { id: 'lew', name: 'Lewiston', emoji: '🌲', color: 150 },
        { id: 'ban', name: 'Bangor', emoji: '🎸', color: 140 }
    ],
    'Delaware': [
        { id: 'wil', name: 'Wilmington', emoji: '🏛️', color: 160 },
        { id: 'dov', name: 'Dover', emoji: '🏁', color: 200 },
        { id: 'new', name: 'Newark', emoji: '🎓', color: 180 }
    ],
    'Maryland': [
        { id: 'bal', name: 'Baltimore', emoji: '⚓', color: 240 },
        { id: 'col', name: 'Columbia', emoji: '🌳', color: 200 },
        { id: 'ger', name: 'Germantown', emoji: '🏘️', color: 150 }
    ],
    'West Virginia': [
        { id: 'cha', name: 'Charleston', emoji: '⛰️', color: 150 },
        { id: 'hun', name: 'Huntington', emoji: '🏛️', color: 170 },
        { id: 'mor', name: 'Morgantown', emoji: '🎓', color: 200 }
    ]
};

// =========================================
// INTERNATIONAL CITIES BY COUNTRY
// =========================================
export const INTERNATIONAL_CITIES = {
    // --- EUROPE ---
    'United Kingdom': [
        { id: 'lon', name: 'London', emoji: '🇬🇧', color: 0 },
        { id: 'man', name: 'Manchester', emoji: '⚽', color: 350 },
        { id: 'bir', name: 'Birmingham', emoji: '🏭', color: 30 },
        { id: 'gla', name: 'Glasgow', emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', color: 220 },
        { id: 'edi', name: 'Edinburgh', emoji: '🏰', color: 280 },
        { id: 'liv', name: 'Liverpool', emoji: '🎸', color: 10 },
        { id: 'bri', name: 'Bristol', emoji: '🎨', color: 140 }
    ],
    'Germany': [
        { id: 'ber', name: 'Berlin', emoji: '🇩🇪', color: 45 },
        { id: 'mun', name: 'Munich', emoji: '🍺', color: 210 },
        { id: 'ham', name: 'Hamburg', emoji: '⚓', color: 200 },
        { id: 'col', name: 'Cologne', emoji: '🏛️', color: 30 },
        { id: 'fra', name: 'Frankfurt', emoji: '🏦', color: 200 }
    ],
    'France': [
        { id: 'par', name: 'Paris', emoji: '🇫🇷', color: 200 },
        { id: 'mar', name: 'Marseille', emoji: '⚓', color: 210 },
        { id: 'lyo', name: 'Lyon', emoji: '🍷', color: 30 },
        { id: 'tou', name: 'Toulouse', emoji: '✈️', color: 300 },
        { id: 'nic', name: 'Nice', emoji: '🏖️', color: 200 }
    ],
    'Spain': [
        { id: 'mad', name: 'Madrid', emoji: '🇪🇸', color: 10 },
        { id: 'bar', name: 'Barcelona', emoji: '🏰', color: 200 },
        { id: 'val', name: 'Valencia', emoji: '🍊', color: 30 },
        { id: 'sev', name: 'Seville', emoji: '💃', color: 350 },
        { id: 'bil', name: 'Bilbao', emoji: '🎨', color: 140 }
    ],
    'Italy': [
        { id: 'rom', name: 'Rome', emoji: '🇮🇹', color: 350 },
        { id: 'mil', name: 'Milan', emoji: '👗', color: 30 },
        { id: 'nap', name: 'Naples', emoji: '🍕', color: 200 },
        { id: 'tur', name: 'Turin', emoji: '🏔️', color: 210 },
        { id: 'flo', name: 'Florence', emoji: '🎨', color: 30 }
    ],
    'Netherlands': [
        { id: 'ams', name: 'Amsterdam', emoji: '🇳🇱', color: 30 },
        { id: 'rot', name: 'Rotterdam', emoji: '⚓', color: 200 },
        { id: 'hag', name: 'The Hague', emoji: '🏛️', color: 210 },
        { id: 'utr', name: 'Utrecht', emoji: '🚲', color: 350 }
    ],
    'Sweden': [
        { id: 'sto', name: 'Stockholm', emoji: '🇸🇪', color: 210 },
        { id: 'got', name: 'Gothenburg', emoji: '⚓', color: 200 },
        { id: 'mal', name: 'Malmö', emoji: '🌉', color: 30 }
    ],
    'Norway': [
        { id: 'osl', name: 'Oslo', emoji: '🇳🇴', color: 200 },
        { id: 'ber', name: 'Bergen', emoji: '🏔️', color: 210 },
        { id: 'tro', name: 'Trondheim', emoji: '⛪', color: 30 }
    ],
    'Denmark': [
        { id: 'cop', name: 'Copenhagen', emoji: '🇩🇰', color: 200 },
        { id: 'aar', name: 'Aarhus', emoji: '⚓', color: 210 },
        { id: 'ode', name: 'Odense', emoji: '🚲', color: 140 }
    ],
    'Ireland': [
        { id: 'dub', name: 'Dublin', emoji: '🇮🇪', color: 140 },
        { id: 'cor', name: 'Cork', emoji: '🍀', color: 120 },
        { id: 'gal', name: 'Galway', emoji: '🎻', color: 200 }
    ],
    'Portugal': [
        { id: 'lis', name: 'Lisbon', emoji: '🇵🇹', color: 50 },
        { id: 'por', name: 'Porto', emoji: '🍷', color: 200 },
        { id: 'fun', name: 'Funchal', emoji: '🏖️', color: 30 }
    ],
    'Belgium': [
        { id: 'bru', name: 'Brussels', emoji: '🇧🇪', color: 30 },
        { id: 'ant', name: 'Antwerp', emoji: '💎', color: 200 },
        { id: 'ghe', name: 'Ghent', emoji: '🏰', color: 140 }
    ],
    'Poland': [
        { id: 'war', name: 'Warsaw', emoji: '🇵🇱', color: 350 },
        { id: 'kra', name: 'Krakow', emoji: '🏰', color: 30 },
        { id: 'wro', name: 'Wrocław', emoji: '🌉', color: 200 }
    ],

    // --- ASIA ---
    'Japan': [
        { id: 'tok', name: 'Tokyo', emoji: '🇯🇵', color: 320 },
        { id: 'osa', name: 'Osaka', emoji: '🏯', color: 30 },
        { id: 'kyo', name: 'Kyoto', emoji: '⛩️', color: 350 },
        { id: 'yok', name: 'Yokohama', emoji: '⚓', color: 210 },
        { id: 'sap', name: 'Sapporo', emoji: '❄️', color: 200 }
    ],
    'South Korea': [
        { id: 'seo', name: 'Seoul', emoji: '🇰🇷', color: 300 },
        { id: 'bus', name: 'Busan', emoji: '🏖️', color: 200 },
        { id: 'inc', name: 'Incheon', emoji: '✈️', color: 210 },
        { id: 'dae', name: 'Daegu', emoji: '🏙️', color: 30 }
    ],
    'China': [
        { id: 'bei', name: 'Beijing', emoji: '🇨🇳', color: 0 },
        { id: 'sha', name: 'Shanghai', emoji: '🏙️', color: 200 },
        { id: 'she', name: 'Shenzhen', emoji: '🏢', color: 180 },
        { id: 'gua', name: 'Guangzhou', emoji: '🌆', color: 30 },
        { id: 'hon', name: 'Hong Kong', emoji: '🇭🇰', color: 350 }
    ],
    'India': [
        { id: 'mum', name: 'Mumbai', emoji: '🇮🇳', color: 30 },
        { id: 'del', name: 'New Delhi', emoji: '🏛️', color: 20 },
        { id: 'ban', name: 'Bangalore', emoji: '💻', color: 200 },
        { id: 'che', name: 'Chennai', emoji: '🏖️', color: 350 },
        { id: 'kol', name: 'Kolkata', emoji: '🏛️', color: 50 }
    ],
    'Singapore': [
        { id: 'sin', name: 'Singapore', emoji: '🇸🇬', color: 10 }
    ],
    'Thailand': [
        { id: 'ban', name: 'Bangkok', emoji: '🇹🇭', color: 30 },
        { id: 'chi', name: 'Chiang Mai', emoji: '🏔️', color: 140 },
        { id: 'phu', name: 'Phuket', emoji: '🏖️', color: 200 }
    ],
    'Vietnam': [
        { id: 'han', name: 'Hanoi', emoji: '🇻🇳', color: 140 },
        { id: 'hcm', name: 'Ho Chi Minh City', emoji: '🏙️', color: 10 },
        { id: 'dan', name: 'Da Nang', emoji: '🏖️', color: 200 }
    ],
    'Indonesia': [
        { id: 'jak', name: 'Jakarta', emoji: '🇮🇩', color: 350 },
        { id: 'bal', name: 'Bali', emoji: '🏝️', color: 120 },
        { id: 'sur', name: 'Surabaya', emoji: '🏙️', color: 200 }
    ],
    'Philippines': [
        { id: 'man', name: 'Manila', emoji: '🇵🇭', color: 30 },
        { id: 'ceb', name: 'Cebu City', emoji: '🏖️', color: 200 },
        { id: 'dav', name: 'Davao City', emoji: '🏔️', color: 140 }
    ],

    // --- OCEANIA ---
    'Australia': [
        { id: 'syd', name: 'Sydney', emoji: '🇦🇺', color: 210 },
        { id: 'mel', name: 'Melbourne', emoji: '☕', color: 30 },
        { id: 'bri', name: 'Brisbane', emoji: '🌴', color: 50 },
        { id: 'per', name: 'Perth', emoji: '🌅', color: 300 },
        { id: 'ade', name: 'Adelaide', emoji: '🍷', color: 200 }
    ],
    'New Zealand': [
        { id: 'auc', name: 'Auckland', emoji: '🇳🇿', color: 200 },
        { id: 'wel', name: 'Wellington', emoji: '🌊', color: 140 },
        { id: 'chr', name: 'Christchurch', emoji: '🏔️', color: 30 }
    ],

    // --- MIDDLE EAST ---
    'United Arab Emirates': [
        { id: 'dub', name: 'Dubai', emoji: '🇦🇪', color: 50 },
        { id: 'adh', name: 'Abu Dhabi', emoji: '🏛️', color: 200 },
        { id: 'sha', name: 'Sharjah', emoji: '📚', color: 30 }
    ],
    'Saudi Arabia': [
        { id: 'riy', name: 'Riyadh', emoji: '🇸🇦', color: 100 },
        { id: 'jed', name: 'Jeddah', emoji: '🕌', color: 200 },
        { id: 'mec', name: 'Mecca', emoji: '🕋', color: 150 }
    ],
    'Israel': [
        { id: 'tel', name: 'Tel Aviv', emoji: '🇮🇱', color: 200 },
        { id: 'jer', name: 'Jerusalem', emoji: '🕍', color: 50 },
        { id: 'hai', name: 'Haifa', emoji: '⚓', color: 210 }
    ],
    'Egypt': [
        { id: 'cai', name: 'Cairo', emoji: '🇪🇬', color: 30 },
        { id: 'ale', name: 'Alexandria', emoji: '⚓', color: 200 },
        { id: 'giz', name: 'Giza', emoji: '🔺', color: 50 }
    ],

    // --- AFRICA ---
    'South Africa': [
        { id: 'joh', name: 'Johannesburg', emoji: '🇿🇦', color: 50 },
        { id: 'cap', name: 'Cape Town', emoji: '🏔️', color: 200 },
        { id: 'dur', name: 'Durban', emoji: '🏖️', color: 180 },
        { id: 'pre', name: 'Pretoria', emoji: '🏛️', color: 280 }
    ],
    'Nigeria': [
        { id: 'lag', name: 'Lagos', emoji: '🇳🇬', color: 120 },
        { id: 'abu', name: 'Abuja', emoji: '🏛️', color: 200 },
        { id: 'kan', name: 'Kano', emoji: '🕌', color: 30 }
    ],
    'Kenya': [
        { id: 'nai', name: 'Nairobi', emoji: '🇰🇪', color: 140 },
        { id: 'mom', name: 'Mombasa', emoji: '🏖️', color: 200 },
        { id: 'kis', name: 'Kisumu', emoji: '🌊', color: 210 }
    ],
    'Ghana': [
        { id: 'acc', name: 'Accra', emoji: '🇬🇭', color: 100 },
        { id: 'kum', name: 'Kumasi', emoji: '🌳', color: 140 },
        { id: 'tam', name: 'Tamale', emoji: '🏛️', color: 30 }
    ],
    'Morocco': [
        { id: 'cas', name: 'Casablanca', emoji: '🇲🇦', color: 200 },
        { id: 'mar', name: 'Marrakech', emoji: '🕌', color: 30 },
        { id: 'rab', name: 'Rabat', emoji: '🏛️', color: 150 }
    ],

    // --- LATIN AMERICA ---
    'Brazil': [
        { id: 'sao', name: 'São Paulo', emoji: '🇧🇷', color: 100 },
        { id: 'rio', name: 'Rio de Janeiro', emoji: '🏖️', color: 150 },
        { id: 'bra', name: 'Brasília', emoji: '🏛️', color: 50 },
        { id: 'sal', name: 'Salvador', emoji: '🎭', color: 30 }
    ],
    'Mexico': [
        { id: 'mex', name: 'Mexico City', emoji: '🇲🇽', color: 350 },
        { id: 'gua', name: 'Guadalajara', emoji: '🎺', color: 30 },
        { id: 'mon', name: 'Monterrey', emoji: '🏔️', color: 200 },
        { id: 'can', name: 'Cancún', emoji: '🏝️', color: 180 }
    ],
    'Argentina': [
        { id: 'bue', name: 'Buenos Aires', emoji: '🇦🇷', color: 200 },
        { id: 'cor', name: 'Córdoba', emoji: '🏛️', color: 30 },
        { id: 'ros', name: 'Rosario', emoji: '🌊', color: 210 }
    ],
    'Colombia': [
        { id: 'bog', name: 'Bogotá', emoji: '🇨🇴', color: 50 },
        { id: 'med', name: 'Medellín', emoji: '🌸', color: 120 },
        { id: 'cal', name: 'Cali', emoji: '💃', color: 350 },
        { id: 'car', name: 'Cartagena', emoji: '🏖️', color: 200 }
    ],
    'Chile': [
        { id: 'san', name: 'Santiago', emoji: '🇨🇱', color: 200 },
        { id: 'val', name: 'Valparaíso', emoji: '🎨', color: 180 },
        { id: 'con', name: 'Concepción', emoji: '🌊', color: 210 }
    ],
    'Peru': [
        { id: 'lim', name: 'Lima', emoji: '🇵🇪', color: 350 },
        { id: 'cus', name: 'Cusco', emoji: '🏔️', color: 30 },
        { id: 'are', name: 'Arequipa', emoji: '🌋', color: 200 }
    ],
    'Jamaica': [
        { id: 'kin', name: 'Kingston', emoji: '🇯🇲', color: 140 },
        { id: 'mon', name: 'Montego Bay', emoji: '🏖️', color: 200 },
        { id: 'ocho', name: 'Ocho Rios', emoji: '🌴', color: 180 }
    ],
    'Cuba': [
        { id: 'hav', name: 'Havana', emoji: '🇨🇺', color: 340 },
        { id: 'san', name: 'Santiago de Cuba', emoji: '🎺', color: 30 },
        { id: 'cam', name: 'Camagüey', emoji: '🏛️', color: 200 }
    ],

    // --- CANADA ---
    'Ontario': [
        { id: 'tor', name: 'Toronto', emoji: '🇨🇦', color: 350 },
        { id: 'ott', name: 'Ottawa', emoji: '🏛️', color: 200 },
        { id: 'mis', name: 'Mississauga', emoji: '🏙️', color: 30 },
        { id: 'ham', name: 'Hamilton', emoji: '🏭', color: 150 }
    ],
    'Quebec': [
        { id: 'mon', name: 'Montreal', emoji: '🇨🇦', color: 220 },
        { id: 'que', name: 'Quebec City', emoji: '🏰', color: 200 },
        { id: 'gat', name: 'Gatineau', emoji: '🌲', color: 140 }
    ],
    'British Columbia': [
        { id: 'van', name: 'Vancouver', emoji: '🏔️', color: 200 },
        { id: 'vic', name: 'Victoria', emoji: '🌸', color: 300 },
        { id: 'kel', name: 'Kelowna', emoji: '🍷', color: 30 }
    ],
    'Alberta': [
        { id: 'cal', name: 'Calgary', emoji: '🤠', color: 30 },
        { id: 'edm', name: 'Edmonton', emoji: '🏒', color: 200 },
        { id: 'red', name: 'Red Deer', emoji: '🦌', color: 150 }
    ]
};

// =========================================
// LOCATION ANALYTICS TRACKING
// =========================================
// This structure will be populated by backend when users select locations
// Format: { 'City, State/Country': { count: X, lastUsed: timestamp } }
export let LOCATION_USAGE_STATS = {};

// Helper function to get all cities (US + International) as flat array
export function getAllCities() {
    const all = [];
    
    // Add US cities
    Object.entries(US_STATE_CITIES).forEach(([state, cities]) => {
        cities.forEach(city => {
            all.push({
                ...city,
                state,
                country: 'United States',
                source: 'curated_us'
            });
        });
    });
    
    // Add international cities
    Object.entries(INTERNATIONAL_CITIES).forEach(([country, cities]) => {
        cities.forEach(city => {
            all.push({
                ...city,
                state: null,
                country,
                source: 'curated_international'
            });
        });
    });
    
    return all;
}

// Helper function to search cities across both databases
export function searchAllCities(query) {
    const q = query.toLowerCase();
    const results = [];
    
    // Search US cities
    Object.entries(US_STATE_CITIES).forEach(([state, cities]) => {
        cities.forEach(city => {
            if (city.name.toLowerCase().includes(q) || state.toLowerCase().includes(q)) {
                results.push({
                    ...city,
                    state,
                    country: 'United States',
                    display: `${city.name}, ${state}`,
                    source: 'curated_us'
                });
            }
        });
    });
    
    // Search international cities
    Object.entries(INTERNATIONAL_CITIES).forEach(([country, cities]) => {
        cities.forEach(city => {
            if (city.name.toLowerCase().includes(q) || country.toLowerCase().includes(q)) {
                results.push({
                    ...city,
                    state: null,
                    country,
                    display: `${city.name}, ${country}`,
                    source: 'curated_international'
                });
            }
        });
    });
    
    return results;
}

// Legacy export for backward compatibility
export const STATE_CITIES = US_STATE_CITIES;