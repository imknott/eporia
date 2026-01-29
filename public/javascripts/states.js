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

    // --- BRITISH ISLES & IRELAND ---
    'England': [
        { id: 'ldn', name: 'London', emoji: '🇬🇧', color: 200 },
        { id: 'man', name: 'Manchester', emoji: '🐝', color: 30 },
        { id: 'liv', name: 'Liverpool', emoji: '🎸', color: 340 },
        { id: 'bir', name: 'Birmingham', emoji: '🏭', color: 45 },
        { id: 'bri', name: 'Bristol', emoji: '🎈', color: 150 },
        { id: 'lee', name: 'Leeds', emoji: '🦉', color: 220 }
    ],
    'Scotland': [
        { id: 'gla', name: 'Glasgow', emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', color: 210 },
        { id: 'edi', name: 'Edinburgh', emoji: '🏰', color: 150 },
        { id: 'abe', name: 'Aberdeen', emoji: '⚓', color: 30 },
        { id: 'dun', name: 'Dundee', emoji: '🚢', color: 200 }
    ],
    'Wales': [
        { id: 'car', name: 'Cardiff', emoji: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', color: 350 },
        { id: 'swa', name: 'Swansea', emoji: '🌊', color: 200 }
    ],
    'Northern Ireland': [
        { id: 'bel', name: 'Belfast', emoji: '🚢', color: 200 },
        { id: 'der', name: 'Derry', emoji: '🏰', color: 40 }
    ],
    'Ireland': [
        { id: 'dub', name: 'Dublin', emoji: '🇮🇪', color: 140 },
        { id: 'cor', name: 'Cork', emoji: '🛳️', color: 20 },
        { id: 'gal', name: 'Galway', emoji: '🎭', color: 300 },
        { id: 'lim', name: 'Limerick', emoji: '🏰', color: 100 }
    ],

    // --- WESTERN EUROPE ---
    'France': [
        { id: 'par', name: 'Paris', emoji: '🇫🇷', color: 200 },
        { id: 'mar', name: 'Marseille', emoji: '⛵', color: 210 },
        { id: 'lyo', name: 'Lyon', emoji: '🍷', color: 340 },
        { id: 'tou', name: 'Toulouse', emoji: '✈️', color: 300 },
        { id: 'nic', name: 'Nice', emoji: '🌴', color: 180 },
        { id: 'bor', name: 'Bordeaux', emoji: '🍇', color: 320 }
    ],
    'Germany': [
        { id: 'ber', name: 'Berlin', emoji: '🇩🇪', color: 200 },
        { id: 'mun', name: 'Munich', emoji: '🍺', color: 210 },
        { id: 'ham', name: 'Hamburg', emoji: '⚓', color: 220 },
        { id: 'col', name: 'Cologne', emoji: '⛪', color: 30 },
        { id: 'fra', name: 'Frankfurt', emoji: '🏦', color: 240 },
        { id: 'stu', name: 'Stuttgart', emoji: '🚗', color: 180 }
    ],
    'Spain': [
        { id: 'mad', name: 'Madrid', emoji: '🇪🇸', color: 10 },
        { id: 'bar', name: 'Barcelona', emoji: '⚽', color: 200 },
        { id: 'sev', name: 'Seville', emoji: '💃', color: 30 },
        { id: 'val', name: 'Valencia', emoji: '🍊', color: 45 },
        { id: 'bil', name: 'Bilbao', emoji: '🎨', color: 150 },
        { id: 'mal', name: 'Málaga', emoji: '☀️', color: 60 }
    ],
    'Italy': [
        { id: 'rom', name: 'Rome', emoji: '🇮🇹', color: 350 },
        { id: 'mil', name: 'Milan', emoji: '👗', color: 200 },
        { id: 'nap', name: 'Naples', emoji: '🍕', color: 210 },
        { id: 'tur', name: 'Turin', emoji: '🚗', color: 220 },
        { id: 'flo', name: 'Florence', emoji: '🎨', color: 30 },
        { id: 'ven', name: 'Venice', emoji: '🛶', color: 180 }
    ],
    'Netherlands': [
        { id: 'ams', name: 'Amsterdam', emoji: '🇳🇱', color: 30 },
        { id: 'rot', name: 'Rotterdam', emoji: '🚢', color: 200 },
        { id: 'hag', name: 'The Hague', emoji: '⚖️', color: 210 },
        { id: 'utr', name: 'Utrecht', emoji: '🚲', color: 40 }
    ],
    'Belgium': [
        { id: 'bru', name: 'Brussels', emoji: '🇧🇪', color: 50 },
        { id: 'ant', name: 'Antwerp', emoji: '💎', color: 200 },
        { id: 'ghe', name: 'Ghent', emoji: '🏰', color: 150 },
        { id: 'bru2', name: 'Bruges', emoji: '🍫', color: 30 }
    ],
    'Switzerland': [
        { id: 'zur', name: 'Zurich', emoji: '🇨🇭', color: 200 },
        { id: 'gen', name: 'Geneva', emoji: '⌚', color: 220 },
        { id: 'bas', name: 'Basel', emoji: '🎭', color: 30 },
        { id: 'ber', name: 'Bern', emoji: '🏛️', color: 150 }
    ],
    'Austria': [
        { id: 'vie', name: 'Vienna', emoji: '🇦🇹', color: 340 },
        { id: 'sal', name: 'Salzburg', emoji: '🎵', color: 200 },
        { id: 'inns', name: 'Innsbruck', emoji: '⛷️', color: 210 }
    ],
    'Portugal': [
        { id: 'lis', name: 'Lisbon', emoji: '🇵🇹', color: 50 },
        { id: 'por', name: 'Porto', emoji: '🍷', color: 200 },
        { id: 'faro', name: 'Faro', emoji: '🏖️', color: 30 }
    ],

    // --- NORTHERN EUROPE ---
    'Sweden': [
        { id: 'sto', name: 'Stockholm', emoji: '🇸🇪', color: 210 },
        { id: 'got', name: 'Gothenburg', emoji: '⚓', color: 200 },
        { id: 'mal', name: 'Malmö', emoji: '🌉', color: 30 }
    ],
    'Norway': [
        { id: 'osl', name: 'Oslo', emoji: '🇳🇴', color: 200 },
        { id: 'ber', name: 'Bergen', emoji: '🏔️', color: 210 },
        { id: 'tro', name: 'Trondheim', emoji: '🎣', color: 150 }
    ],
    'Denmark': [
        { id: 'cop', name: 'Copenhagen', emoji: '🇩🇰', color: 200 },
        { id: 'aar', name: 'Aarhus', emoji: '🎨', color: 210 },
        { id: 'ode', name: 'Odense', emoji: '📖', color: 150 }
    ],
    'Finland': [
        { id: 'hel', name: 'Helsinki', emoji: '🇫🇮', color: 200 },
        { id: 'tam', name: 'Tampere', emoji: '🏭', color: 210 },
        { id: 'tur', name: 'Turku', emoji: '🏰', color: 30 }
    ],
    'Iceland': [
        { id: 'rey', name: 'Reykjavik', emoji: '🇮🇸', color: 200 },
        { id: 'kop', name: 'Kópavogur', emoji: '🌋', color: 30 }
    ],

    // --- EASTERN EUROPE ---
    'Poland': [
        { id: 'war', name: 'Warsaw', emoji: '🇵🇱', color: 350 },
        { id: 'kra', name: 'Kraków', emoji: '🏰', color: 200 },
        { id: 'wro', name: 'Wrocław', emoji: '🌉', color: 30 },
        { id: 'gda', name: 'Gdańsk', emoji: '⚓', color: 210 }
    ],
    'Czech Republic': [
        { id: 'pra', name: 'Prague', emoji: '🇨🇿', color: 30 },
        { id: 'brn', name: 'Brno', emoji: '🏰', color: 200 },
        { id: 'ost', name: 'Ostrava', emoji: '🏭', color: 150 }
    ],
    'Hungary': [
        { id: 'bud', name: 'Budapest', emoji: '🇭🇺', color: 200 },
        { id: 'deb', name: 'Debrecen', emoji: '🏛️', color: 30 },
        { id: 'sze', name: 'Szeged', emoji: '🌊', color: 150 }
    ],
    'Romania': [
        { id: 'buc', name: 'Bucharest', emoji: '🇷🇴', color: 50 },
        { id: 'clu', name: 'Cluj-Napoca', emoji: '🎓', color: 200 },
        { id: 'tim', name: 'Timișoara', emoji: '🎭', color: 150 }
    ],
    'Ukraine': [
        { id: 'kyv', name: 'Kyiv', emoji: '🇺🇦', color: 200 },
        { id: 'lvi', name: 'Lviv', emoji: '🏰', color: 30 },
        { id: 'ode', name: 'Odesa', emoji: '🌊', color: 210 }
    ],
    'Russia': [
        { id: 'mos', name: 'Moscow', emoji: '🇷🇺', color: 350 },
        { id: 'stp', name: 'St. Petersburg', emoji: '🏛️', color: 200 },
        { id: 'nsk', name: 'Novosibirsk', emoji: '❄️', color: 210 },
        { id: 'yek', name: 'Yekaterinburg', emoji: '🏔️', color: 150 }
    ],
    'Greece': [
        { id: 'ath', name: 'Athens', emoji: '🇬🇷', color: 200 },
        { id: 'the', name: 'Thessaloniki', emoji: '🏛️', color: 210 },
        { id: 'pat', name: 'Patras', emoji: '⛵', color: 30 }
    ],
    'Turkey': [
        { id: 'ist', name: 'Istanbul', emoji: '🇹🇷', color: 200 },
        { id: 'ank', name: 'Ankara', emoji: '🏛️', color: 350 },
        { id: 'izm', name: 'Izmir', emoji: '🌊', color: 210 },
        { id: 'ant', name: 'Antalya', emoji: '☀️', color: 30 }
    ],

    // --- ASIA-PACIFIC ---
    'Japan': [
        { id: 'tok', name: 'Tokyo', emoji: '🇯🇵', color: 320 },
        { id: 'osa', name: 'Osaka', emoji: '🏯', color: 200 },
        { id: 'kyo', name: 'Kyoto', emoji: '⛩️', color: 30 },
        { id: 'yok', name: 'Yokohama', emoji: '🗼', color: 210 },
        { id: 'sap', name: 'Sapporo', emoji: '❄️', color: 190 },
        { id: 'fuk', name: 'Fukuoka', emoji: '🍜', color: 150 }
    ],
    'China': [
        { id: 'bej', name: 'Beijing', emoji: '🇨🇳', color: 350 },
        { id: 'sha', name: 'Shanghai', emoji: '🏙️', color: 200 },
        { id: 'gua', name: 'Guangzhou', emoji: '🌸', color: 340 },
        { id: 'she', name: 'Shenzhen', emoji: '💻', color: 180 },
        { id: 'che', name: 'Chengdu', emoji: '🐼', color: 30 },
        { id: 'hkg', name: 'Hong Kong', emoji: '🏙️', color: 210 }
    ],
    'South Korea': [
        { id: 'seo', name: 'Seoul', emoji: '🇰🇷', color: 300 },
        { id: 'bus', name: 'Busan', emoji: '🏖️', color: 200 },
        { id: 'inc', name: 'Incheon', emoji: '✈️', color: 210 },
        { id: 'dae', name: 'Daegu', emoji: '🍎', color: 30 }
    ],
    'India': [
        { id: 'del', name: 'New Delhi', emoji: '🇮🇳', color: 30 },
        { id: 'mum', name: 'Mumbai', emoji: '🎬', color: 200 },
        { id: 'ban', name: 'Bangalore', emoji: '💻', color: 150 },
        { id: 'kol', name: 'Kolkata', emoji: '📚', color: 50 },
        { id: 'che', name: 'Chennai', emoji: '🎭', color: 340 },
        { id: 'hyd', name: 'Hyderabad', emoji: '🏰', color: 280 }
    ],
    'Thailand': [
        { id: 'bkk', name: 'Bangkok', emoji: '🇹🇭', color: 30 },
        { id: 'chi', name: 'Chiang Mai', emoji: '🏯', color: 150 },
        { id: 'phu', name: 'Phuket', emoji: '🏝️', color: 200 }
    ],
    'Vietnam': [
        { id: 'hcm', name: 'Ho Chi Minh City', emoji: '🇻🇳', color: 350 },
        { id: 'han', name: 'Hanoi', emoji: '🏛️', color: 200 },
        { id: 'dan', name: 'Da Nang', emoji: '🏖️', color: 180 }
    ],
    'Singapore': [
        { id: 'sin', name: 'Singapore', emoji: '🇸🇬', color: 350 },
        { id: 'jur', name: 'Jurong', emoji: '🏭', color: 200 }
    ],
    'Malaysia': [
        { id: 'kul', name: 'Kuala Lumpur', emoji: '🇲🇾', color: 200 },
        { id: 'geo', name: 'George Town', emoji: '🏛️', color: 30 },
        { id: 'joh', name: 'Johor Bahru', emoji: '🌉', color: 150 }
    ],
    'Indonesia': [
        { id: 'jak', name: 'Jakarta', emoji: '🇮🇩', color: 350 },
        { id: 'sur', name: 'Surabaya', emoji: '🚢', color: 200 },
        { id: 'ban', name: 'Bandung', emoji: '🌋', color: 30 },
        { id: 'bal', name: 'Bali', emoji: '🏝️', color: 300 }
    ],
    'Philippines': [
        { id: 'man', name: 'Manila', emoji: '🇵🇭', color: 200 },
        { id: 'que', name: 'Quezon City', emoji: '🏙️', color: 30 },
        { id: 'ceb', name: 'Cebu', emoji: '🏖️', color: 180 }
    ],
    'Australia': [
        { id: 'syd', name: 'Sydney', emoji: '🇦🇺', color: 200 },
        { id: 'mel', name: 'Melbourne', emoji: '☕', color: 30 },
        { id: 'bri', name: 'Brisbane', emoji: '☀️', color: 50 },
        { id: 'per', name: 'Perth', emoji: '🌅', color: 300 },
        { id: 'ade', name: 'Adelaide', emoji: '🍷', color: 340 }
    ],
    'New Zealand': [
        { id: 'auk', name: 'Auckland', emoji: '🇳🇿', color: 200 },
        { id: 'wel', name: 'Wellington', emoji: '🌬️', color: 150 },
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
        { id: 'nashville', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'tokyo', name: 'Tokyo', emoji: '🗼', color: 320 },
        { id: 'berlin', name: 'Berlin', emoji: '🐻', color: 45 },
        { id: 'austin', name: 'Austin', emoji: '🤠', color: 180 },
        { id: 'atlanta', name: 'Atlanta', emoji: '🅰️🍑', color: 15 },
        { id: 'miami', name: 'Miami', emoji: '🦩', color: 300 },
        { id: 'chicago', name: 'Chicago', emoji: '🍕', color: 220 },
        { id: 'memphis', name: 'Memphis', emoji: '🎷', color: 200 },
        { id: 'neworleans', name: 'New Orleans', emoji: '🎺', color: 280 },
        { id: 'detroit', name: 'Detroit', emoji: '✊🏿', color: 240 },
        { id: 'seattle', name: 'Seattle', emoji: '☕', color: 180 },
        { id: 'paris', name: 'Paris', emoji: '🇫🇷', color: 200 },
        { id: 'amsterdam', name: 'Amsterdam', emoji: '🇳🇱', color: 30 },
        { id: 'seoul', name: 'Seoul', emoji: '🇰🇷', color: 300 },
        { id: 'toronto', name: 'Toronto', emoji: '🇨🇦', color: 350 },
        { id: 'melbourne', name: 'Melbourne', emoji: '☕', color: 30 },
        { id: 'lagos', name: 'Lagos', emoji: '🇳🇬', color: 120 }
    ],
    us: [
        { id: 'ca', name: 'California', emoji: '🌊', color: 200 },
        { id: 'tx', name: 'Texas', emoji: '🐂', color: 25 },
        { id: 'ny', name: 'New York', emoji: '🚕', color: 50 },
        { id: 'tn', name: 'Tennessee', emoji: '🎸', color: 25 },
        { id: 'ga', name: 'Georgia', emoji: '🍑', color: 15 },
        { id: 'fl', name: 'Florida', emoji: '🍊', color: 30 },
        { id: 'il', name: 'Illinois', emoji: '🍕', color: 220 },
        { id: 'la', name: 'Louisiana', emoji: '🎷', color: 280 },
        { id: 'mi', name: 'Michigan', emoji: '🚗', color: 240 },
        { id: 'wa', name: 'Washington', emoji: '🌲', color: 140 },
        { id: 'pa', name: 'Pennsylvania', emoji: '🔔', color: 350 },
        { id: 'nc', name: 'North Carolina', emoji: '👑', color: 210 }
    ],
    global: [
        { id: 'uk', name: 'United Kingdom', emoji: '🇬🇧', color: 210 },
        { id: 'us', name: 'United States', emoji: '🇺🇸', color: 200 },
        { id: 'jp', name: 'Japan', emoji: '🇯🇵', color: 0 },
        { id: 'kr', name: 'South Korea', emoji: '🇰🇷', color: 300 },
        { id: 'fr', name: 'France', emoji: '🇫🇷', color: 230 },
        { id: 'de', name: 'Germany', emoji: '🇩🇪', color: 200 },
        { id: 'br', name: 'Brazil', emoji: '🇧🇷', color: 100 },
        { id: 'ng', name: 'Nigeria', emoji: '🇳🇬', color: 120 },
        { id: 'jm', name: 'Jamaica', emoji: '🇯🇲', color: 140 },
        { id: 'ca', name: 'Canada', emoji: '🇨🇦', color: 350 },
        { id: 'au', name: 'Australia', emoji: '🇦🇺', color: 200 },
        { id: 'nl', name: 'Netherlands', emoji: '🇳🇱', color: 30 },
        { id: 'es', name: 'Spain', emoji: '🇪🇸', color: 10 },
        { id: 'mx', name: 'Mexico', emoji: '🇲🇽', color: 350 },
        { id: 'ar', name: 'Argentina', emoji: '🇦🇷', color: 200 },
        { id: 'co', name: 'Colombia', emoji: '🇨🇴', color: 50 },
        { id: 'za', name: 'South Africa', emoji: '🇿🇦', color: 50 },
        { id: 'in', name: 'India', emoji: '🇮🇳', color: 30 },
        { id: 'se', name: 'Sweden', emoji: '🇸🇪', color: 210 },
        { id: 'it', name: 'Italy', emoji: '🇮🇹', color: 350 },
        { id: 'pt', name: 'Portugal', emoji: '🇵🇹', color: 50 },
        { id: 'ie', name: 'Ireland', emoji: '🇮🇪', color: 140 },
        { id: 'gh', name: 'Ghana', emoji: '🇬🇭', color: 100 },
        { id: 'cu', name: 'Cuba', emoji: '🇨🇺', color: 340 }
    ]

    
};