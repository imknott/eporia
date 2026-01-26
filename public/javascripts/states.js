// --- DATA: STATE NEIGHBORS ---


export const STATE_CITIES = {
    // --- WEST ---
    'California': [
        { id: 'sd', name: 'San Diego', emoji: '🌊', color: 200 },
        { id: 'la', name: 'Los Angeles', emoji: '🌴', color: 30 },
        { id: 'sf', name: 'San Francisco', emoji: '🌁', color: 210 },
        { id: 'oak', name: 'Oakland', emoji: '🌳', color: 150 },
        { id: 'sac', name: 'Sacramento', emoji: '🏛️', color: 45 }
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
        { id: 'dal', name: 'Dallas', emoji: '🤠', color: 30 }
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
        { id: 'det', name: 'Detroit', emoji: '🚗', color: 240 },
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
        { id: 'tpa', name: 'Tampa', emoji: '🏴‍☠️', color: 350 }
    ],
    'North Carolina': [
        { id: 'clt', name: 'Charlotte', emoji: '👑', color: 210 },
        { id: 'ral', name: 'Raleigh', emoji: '🌳', color: 140 },
        { id: 'avl', name: 'Asheville', emoji: '🏔️', color: 300 }
    ],
    'South Carolina': [
        { id: 'chs', name: 'Charleston', emoji: '🌴', color: 200 },
        { id: 'col', name: 'Columbia', emoji: '🐯', color: 340 },
        { id: 'myr', name: 'Myrtle Beach', emoji: '🏖️', color: 180 }
    ],
    'Virginia': [
        { id: 'vb', name: 'Virginia Beach', emoji: '🌊', color: 210 },
        { id: 'ric', name: 'Richmond', emoji: '🏛️', color: 350 },
        { id: 'nor', name: 'Norfolk', emoji: '⚓', color: 220 }
    ],
    'Tennessee': [
        { id: 'nas', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'mem', name: 'Memphis', emoji: '🎷', color: 200 },
        { id: 'knx', name: 'Knoxville', emoji: '🍊', color: 30 }
    ],
    'Kentucky': [
        { id: 'lou', name: 'Louisville', emoji: '🐎', color: 350 },
        { id: 'lex', name: 'Lexington', emoji: '🐴', color: 200 },
        { id: 'bg', name: 'Bowling Green', emoji: '🏎️', color: 20 }
    ],
    'Alabama': [
        { id: 'bir', name: 'Birmingham', emoji: '🏭', color: 150 },
        { id: 'hun', name: 'Huntsville', emoji: '🚀', color: 220 },
        { id: 'mob', name: 'Mobile', emoji: '🎭', color: 280 }
    ],
    'Louisiana': [
        { id: 'no', name: 'New Orleans', emoji: '🎷', color: 280 },
        { id: 'br', name: 'Baton Rouge', emoji: '🐯', color: 40 },
        { id: 'shr', name: 'Shreveport', emoji: '🎲', color: 350 }
    ],
    'Mississippi': [
        { id: 'jac', name: 'Jackson', emoji: '🎶', color: 200 },
        { id: 'gul', name: 'Gulfport', emoji: '🏖️', color: 180 },
        { id: 'bil', name: 'Biloxi', emoji: '🎰', color: 320 }
    ],
    'Arkansas': [
        { id: 'lr', name: 'Little Rock', emoji: '🪨', color: 30 },
        { id: 'fay', name: 'Fayetteville', emoji: '🐗', color: 350 },
        { id: 'hs', name: 'Hot Springs', emoji: '♨️', color: 150 }
    ],
    'West Virginia': [
        { id: 'cha', name: 'Charleston', emoji: '🏛️', color: 45 },
        { id: 'hun', name: 'Huntington', emoji: '🚂', color: 120 },
        { id: 'mor', name: 'Morgantown', emoji: '⛰️', color: 200 }
    ],

    // --- NORTHEAST ---
    'New York': [
        { id: 'nyc', name: 'New York City', emoji: '🗽', color: 210 },
        { id: 'buf', name: 'Buffalo', emoji: '🦬', color: 200 },
        { id: 'roc', name: 'Rochester', emoji: '📸', color: 300 }
    ],
    'Pennsylvania': [
        { id: 'phi', name: 'Philadelphia', emoji: '🔔', color: 350 },
        { id: 'pit', name: 'Pittsburgh', emoji: '🌉', color: 45 },
        { id: 'all', name: 'Allentown', emoji: '🏗️', color: 200 }
    ],
    'Massachusetts': [
        { id: 'bos', name: 'Boston', emoji: '🦞', color: 200 },
        { id: 'wor', name: 'Worcester', emoji: '❤️', color: 340 },
        { id: 'spr', name: 'Springfield', emoji: '🏀', color: 30 }
    ],
    'New Jersey': [
        { id: 'new', name: 'Newark', emoji: '✈️', color: 210 },
        { id: 'jc', name: 'Jersey City', emoji: '🏙️', color: 180 },
        { id: 'ac', name: 'Atlantic City', emoji: '🎰', color: 320 }
    ],
    'Maryland': [
        { id: 'bal', name: 'Baltimore', emoji: '🦀', color: 20 },
        { id: 'ann', name: 'Annapolis', emoji: '⛵', color: 200 },
        { id: 'oc', name: 'Ocean City', emoji: '🏖️', color: 45 }
    ],
    'Connecticut': [
        { id: 'bri', name: 'Bridgeport', emoji: '🎪', color: 150 },
        { id: 'nh', name: 'New Haven', emoji: '🍕', color: 20 },
        { id: 'har', name: 'Hartford', emoji: '💼', color: 200 }
    ],
    'Rhode Island': [
        { id: 'pvd', name: 'Providence', emoji: '⚓', color: 220 },
        { id: 'new', name: 'Newport', emoji: '⛵', color: 200 },
        { id: 'war', name: 'Warwick', emoji: '✈️', color: 150 }
    ],
    'Delaware': [
        { id: 'wil', name: 'Wilmington', emoji: '🏢', color: 200 },
        { id: 'dov', name: 'Dover', emoji: '🏁', color: 350 },
        { id: 'new', name: 'Newark', emoji: '🎓', color: 45 }
    ],
    'New Hampshire': [
        { id: 'man', name: 'Manchester', emoji: '🏭', color: 200 },
        { id: 'nas', name: 'Nashua', emoji: '🛍️', color: 300 },
        { id: 'con', name: 'Concord', emoji: '🍇', color: 150 }
    ],
    'Vermont': [
        { id: 'bur', name: 'Burlington', emoji: '🍁', color: 40 },
        { id: 'mon', name: 'Montpelier', emoji: '🏛️', color: 120 },
        { id: 'rut', name: 'Rutland', emoji: '⛰️', color: 200 }
    ],
    'Maine': [
        { id: 'por', name: 'Portland', emoji: '🦞', color: 200 },
        { id: 'aug', name: 'Augusta', emoji: '🌲', color: 140 },
        { id: 'ban', name: 'Bangor', emoji: '📖', color: 30 }
    ],

    // --- TERRITORIES & DC ---
    'District of Columbia': [
        { id: 'wdc', name: 'Washington D.C.', emoji: '🏛️', color: 210 },
        { id: 'geo', name: 'Georgetown', emoji: '🛍️', color: 340 },
        { id: 'cap', name: 'Capitol Hill', emoji: '⚖️', color: 200 }
    ],
    'Puerto Rico': [
        { id: 'sj', name: 'San Juan', emoji: '🏰', color: 40 },
        { id: 'pon', name: 'Ponce', emoji: '🦁', color: 350 },
        { id: 'may', name: 'Mayagüez', emoji: '🥭', color: 120 }
    ],
    
    // --- FALLBACK ---
    'default': [
        { id: 'cap', name: 'Capital City', emoji: '🏛️', color: 200 },
        { id: 'met', name: 'Metro Area', emoji: '🏙️', color: 30 }
    ]
};
export const LOCATIONS = {
    major: [
        { id: 'nyc', name: 'New York', emoji: '🗽', color: 210 },
        { id: 'la', name: 'Los Angeles', emoji: '🌴', color: 30 },
        { id: 'london', name: 'London', emoji: '🇬🇧', color: 0 },
        { id: 'tokyo', name: 'Tokyo', emoji: '🗼', color: 320 },
        { id: 'berlin', name: 'Berlin', emoji: '🐻', color: 45 },
        { id: 'nashville', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'austin', name: 'Austin', emoji: '🤠', color: 180 },
        { id: 'miami', name: 'Miami', emoji: '🦩', color: 300 }
    ],
    us: [
        { id: 'ca', name: 'California', emoji: '🌊', color: 200 },
        { id: 'tx', name: 'Texas', emoji: '🐂', color: 25 },
        { id: 'ny', name: 'New York', emoji: '🚕', color: 50 },
        { id: 'fl', name: 'Florida', emoji: '🍊', color: 30 },
        { id: 'ga', name: 'Georgia', emoji: '🍑', color: 15 },
        { id: 'wa', name: 'Washington', emoji: '🌲', color: 140 }
    ],
    global: [
        { id: 'uk', name: 'United Kingdom', emoji: '🇬🇧', color: 210 },
        { id: 'jp', name: 'Japan', emoji: '🇯🇵', color: 0 },
        { id: 'fr', name: 'France', emoji: '🇫🇷', color: 230 },
        { id: 'br', name: 'Brazil', emoji: '🇧🇷', color: 100 },
        { id: 'ng', name: 'Nigeria', emoji: '🇳🇬', color: 120 },
        { id: 'kr', name: 'South Korea', emoji: '🇰🇷', color: 300 }
    ]

    
};

