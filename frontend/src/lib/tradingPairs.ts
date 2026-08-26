// Centralized trading pairs data - ONLY pairs with actual candles tables in the database
// This file serves as the single source of truth for all available trading pairs

// ============= FOREX PAIRS (verified candles tables exist) =============
export const forexSymbols = {
  g10Majors: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'NZD/USD', 'USD/CAD'],
  g10Crosses: [
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'NZD/JPY', 'CAD/JPY', 'CHF/JPY',
    'EUR/AUD', 'GBP/AUD', 'EUR/NZD', 'GBP/NZD', 'AUD/NZD',
    'EUR/CAD', 'GBP/CAD', 'AUD/CAD', 'NZD/CAD',
    'EUR/CHF', 'GBP/CHF', 'AUD/CHF', 'NZD/CHF', 'CAD/CHF'
  ],
  scandinavian: ['USD/SEK', 'USD/NOK', 'USD/DKK', 'EUR/SEK', 'EUR/NOK', 'EUR/DKK'],
  emAmericas: ['USD/MXN'],
  emEMEA: [
    'USD/ZAR', 'USD/TRY', 'USD/PLN', 'USD/HUF', 'USD/CZK',
    'EUR/PLN', 'EUR/HUF', 'EUR/CZK', 'EUR/TRY',
    'GBP/ZAR', 'ZAR/JPY', 'TRY/JPY'
  ],
  emAsia: [
    'USD/SGD', 'USD/HKD', 'USD/CNH', 'USD/THB',
    'SGD/JPY', 'HKD/JPY',
    'GBP/SGD', 'AUD/SGD', 'EUR/SGD', 'CAD/SGD', 'NZD/SGD'
  ]
};

export const allForexSymbols = [...new Set([
  ...forexSymbols.g10Majors,
  ...forexSymbols.g10Crosses,
  ...forexSymbols.scandinavian,
  ...forexSymbols.emAmericas,
  ...forexSymbols.emEMEA,
  ...forexSymbols.emAsia
])];

// ============= CRYPTO PAIRS (verified candles tables exist) =============
export const cryptoSymbols = {
  major: ['BTC/USD', 'ETH/USD', 'BNB/USD', 'XRP/USD', 'SOL/USD', 'ADA/USD', 'DOGE/USD', 'DOT/USD', 'AVAX/USD', 'LTC/USD'],
  layer1: [
    'LINK/USD', 'UNI/USD', 'ATOM/USD', 'XLM/USD', 'FIL/USD', 'APT/USD',
    'ARB/USD', 'OP/USD', 'NEAR/USD', 'ICP/USD', 'VET/USD', 'ALGO/USD'
  ],
  defiGaming: [
    'SAND/USD', 'MANA/USD', 'AXS/USD', 'AAVE/USD', 'MKR/USD',
    'COMP/USD', 'ENJ/USD', 'CHZ/USD', 'IMX/USD', 'LDO/USD'
  ],
  stablecoins: ['USDC/USD']
};

export const allCryptoSymbols = [...new Set([
  ...cryptoSymbols.major,
  ...cryptoSymbols.layer1,
  ...cryptoSymbols.defiGaming,
  ...cryptoSymbols.stablecoins
])];

// ============= COMMODITIES (verified candles tables exist) =============
export const commoditySymbols = {
  preciousMetals: [
    { symbol: 'XAU/USD', name: 'Gold' },
    { symbol: 'XAG/USD', name: 'Silver' },
    { symbol: 'XPT/USD', name: 'Platinum' },
    { symbol: 'XPD/USD', name: 'Palladium' },
    { symbol: 'XCU/USD', name: 'Copper' }
  ],
  industrialMetals: [
    { symbol: 'NICKEL/USD', name: 'Nickel' },
    { symbol: 'ALUMINIUM/USD', name: 'Aluminium' },
    { symbol: 'LEAD/USD', name: 'Lead' },
    { symbol: 'IRON/USD', name: 'Iron Ore' }
  ],
  energy: [
    { symbol: 'WTICO/USD', name: 'WTI Crude Oil' },
    { symbol: 'BCO/USD', name: 'Brent Crude Oil' },
    { symbol: 'NATGAS/USD', name: 'Natural Gas' }
  ],
  grains: [
    { symbol: 'CORN/USD', name: 'Corn' },
    { symbol: 'WHEAT/USD', name: 'Wheat' },
    { symbol: 'SOYBN/USD', name: 'Soybeans' },
    { symbol: 'OATS/USD', name: 'Oats' },
    { symbol: 'RICE/USD', name: 'Rice' }
  ],
  softs: [
    { symbol: 'SUGAR/USD', name: 'Sugar' },
    { symbol: 'COFFEE/USD', name: 'Coffee' },
    { symbol: 'COCOA/USD', name: 'Cocoa' },
    { symbol: 'COTTON/USD', name: 'Cotton' },
    { symbol: 'OJ/USD', name: 'Orange Juice' },
    { symbol: 'LUMBER/USD', name: 'Lumber' }
  ],
  livestock: [
    { symbol: 'CATTLE/USD', name: 'Live Cattle' }
  ]
};

export const allCommoditySymbols = [
  ...commoditySymbols.preciousMetals.map(c => c.symbol),
  ...commoditySymbols.industrialMetals.map(c => c.symbol),
  ...commoditySymbols.energy.map(c => c.symbol),
  ...commoditySymbols.grains.map(c => c.symbol),
  ...commoditySymbols.softs.map(c => c.symbol),
  ...commoditySymbols.livestock.map(c => c.symbol)
];

// ============= INDICES (verified candles tables exist) =============
export const indexSymbols = {
  us: [
    { symbol: 'SPX500/USD', name: 'S&P 500', aliases: ['sp500', 's&p', 'spx'] },
    { symbol: 'NAS100/USD', name: 'NASDAQ 100', aliases: ['nasdaq', 'tech', 'qqq'] },
    { symbol: 'US30/USD', name: 'Dow Jones', aliases: ['dow', 'dow jones', 'djia', 'us30'] },
    { symbol: 'US2000/USD', name: 'Russell 2000', aliases: ['russell', 'small cap'] }
  ],
  europe: [
    { symbol: 'UK100/GBP', name: 'FTSE 100', aliases: ['ftse', 'footsie', 'london'] },
    { symbol: 'UK250/GBP', name: 'FTSE 250', aliases: ['ftse 250', 'mid cap', 'uk mid'] },
    { symbol: 'DE30/EUR', name: 'DAX 40', aliases: ['dax', 'german', 'germany', 'frankfurt'] },
    { symbol: 'FR40/EUR', name: 'CAC 40', aliases: ['cac', 'french', 'france', 'paris'] },
    { symbol: 'EU50/EUR', name: 'Euro Stoxx 50', aliases: ['eurostoxx', 'europe'] }
  ],
  asia: [
    { symbol: 'JP225/USD', name: 'Nikkei 225', aliases: ['nikkei', 'japan', 'tokyo'] },
    { symbol: 'AU200/AUD', name: 'ASX 200', aliases: ['asx', 'australia', 'sydney'] },
    { symbol: 'HK33/HKD', name: 'Hang Seng', aliases: ['hang seng', 'hong kong', 'hsi'] },
    { symbol: 'CN50/USD', name: 'China A50', aliases: ['china', 'a50', 'shanghai'] }
  ],
  volatility: [
    { symbol: 'VIX', name: 'VIX', aliases: ['vix', 'volatility', 'fear index'] },
    { symbol: 'VSTOXX', name: 'EU VIX (VSTOXX)', aliases: ['vstoxx', 'euro volatility', 'eu vix'] }
  ]
};

export const allIndexSymbols = [
  ...indexSymbols.us.map(i => i.symbol),
  ...indexSymbols.europe.map(i => i.symbol),
  ...indexSymbols.asia.map(i => i.symbol),
  ...indexSymbols.volatility.map(i => i.symbol)
];

// ============= US STOCKS (verified candles tables exist) =============
export const stockSymbols = {
  // Mag7 Tech
  mag7Tech: ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA'],

  // Semiconductors
  semiconductors: [
    'AMD', 'INTC', 'AVGO', 'QCOM', 'TXN', 'MU', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'MRVL', 'ON',
    'TSM', 'ARM', 'ASML', 'NXPI', 'SWKS', 'QRVO', 'MPWR', 'MCHP', 'SLAB', 'SMTC', 'DIOD', 'SITM', 'VSH', 'CRUS',
    'TER', 'GFS', 'SMCI'
  ],

  // Software & Cloud
  software: [
    'CRM', 'ADBE', 'NOW', 'SNOW', 'PLTR', 'PANW', 'CRWD', 'ZS', 'DDOG', 'NET',
    'CSCO', 'MDB', 'IBM', 'ORCL', 'TEAM', 'INTU', 'WDAY', 'ADP', 'ZM', 'CDNS',
    'ANSS', 'SNPS', 'ACN', 'FTNT', 'CTSH', 'IT', 'EPAM', 'GDDY', 'PTC', 'AKAM',
    'FFIV', 'CDW', 'KEYS', 'CSGP', 'JKHY', 'PAYC', 'PAYX', 'TYL', 'BR', 'LDOS', 'TRMB'
  ],

  // Fintech & Payments
  fintech: [
    'V', 'MA', 'PYPL', 'AFRM', 'COIN', 'FISV', 'HOOD', 'AXP', 'SQ', 'FIS',
    'GPN', 'UPST', 'COF', 'DFS', 'SYF', 'SOFI', 'NU', 'BILL', 'FOUR', 'TOST', 'CPAY'
  ],

  // Banks & Financial Services
  banks: [
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'KKR', 'SCHW', 'USB', 'BX', 'BLK',
    'APO', 'CME', 'ICE', 'FITB', 'MCO', 'TFC', 'RF', 'KEY', 'HBAN', 'SPGI',
    'PNC', 'NDAQ', 'CFG', 'MTB', 'AIG', 'MET', 'ALL', 'TRV', 'PRU', 'AMP', 'BK',
    'STT', 'NTRS', 'TROW', 'IVZ', 'BEN', 'RJF', 'L', 'CB', 'AON', 'MMC', 'AJG',
    'BRO', 'ERIE', 'CINF', 'GL', 'AIZ', 'ACGL', 'WRB', 'HIG', 'PFG'
  ],

  // Insurance
  insurance: [
    'PGR', 'AFL', 'MET', 'PRU', 'AIG', 'ALL', 'TRV', 'CB', 'HIG', 'CINF', 'GL', 'AIZ', 'ACGL', 'WRB', 'ERIE', 'BRO', 'AJG', 'AON', 'MMC', 'L', 'PFG'
  ],

  // Healthcare & Pharma
  healthcare: [
    'UNH', 'JNJ', 'PFE', 'MRK', 'BMY', 'LLY', 'GILD', 'AMGN', 'ABBV', 'BIIB',
    'CI', 'ELV', 'HUM', 'CNC', 'CVS', 'MOH', 'INCY', 'AZN', 'CAH', 'MCK', 'COR'
  ],

  // Medical Devices & Biotech
  medDevices: [
    'DHR', 'TMO', 'SYK', 'ABT', 'MDT', 'BSX', 'ISRG', 'EW', 'HOLX', 'VRTX',
    'ZBH', 'REGN', 'MRNA', 'BNTX', 'DXCM', 'IDXX', 'ILMN', 'ZTS', 'VEEV', 'IQV',
    'WAT', 'MTD', 'A', 'ALGN', 'COO', 'BDX', 'BAX', 'STE', 'RVTY', 'TECH',
    'LH', 'DGX', 'HSIC', 'DVA', 'UHS', 'HCA', 'CRL', 'RMD'
  ],

  // Consumer & Retail
  consumer: [
    'WMT', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'COST', 'DIS', 'NFLX',
    'KO', 'PEP', 'CL', 'PG', 'KMB', 'EL', 'MNST', 'YUM', 'DPZ', 'CMG',
    'MAR', 'BKNG', 'UBER', 'TJX', 'ABNB', 'LYFT', 'HLT', 'LULU', 'DLTR', 'DG', 'EBAY', 'BBY',
    'ROST', 'ULTA', 'DECK', 'ORLY', 'AZO', 'TSCO', 'WSM', 'TPR', 'RL', 'HAS', 'POOL',
    'GPC', 'GRMN', 'LVS', 'WYNN', 'MGM', 'RCL', 'CCL', 'NCLH', 'EXPE', 'HST',
    'KR', 'SYY', 'GIS', 'K', 'KHC', 'HSY', 'CPB', 'SJM', 'MKC', 'CAG', 'HRL',
    'CLX', 'CHD', 'MDLZ', 'STZ', 'TAP', 'KDP', 'KVUE', 'EA', 'TTWO', 'MTCH'
  ],

  // Industrials & Aerospace
  industrials: [
    'BA', 'LMT', 'RTX', 'GE', 'CAT', 'DE', 'HON', 'MMM', 'UPS', 'GD', 'FDX',
    'LHX', 'TDG', 'NOC', 'HII', 'UNP', 'AXON', 'NSC', 'CSX', 'ODFL', 'JBHT', 'CHRW',
    'EMR', 'PH', 'ETN', 'ITW', 'ROK', 'SWK', 'IR', 'DOV', 'RSG', 'CPRT', 'VRSK', 'WM', 'LKQ',
    'CARR', 'OTIS', 'FAST', 'GWW', 'SNA', 'BLDR', 'PHM', 'LEN', 'DHI', 'NVR', 'PCAR',
    'PWR', 'EME', 'J', 'JCI', 'JBL', 'TDY', 'EXPD', 'DAL', 'UAL', 'LUV', 'GEHC', 'GEV',
    'WAB', 'HUBB', 'AME', 'ROP', 'NDSN', 'IEX', 'AOS', 'PNR', 'TT', 'ALLE', 'LII',
    'URI', 'FCX', 'NUE', 'STLD', 'MLM', 'VMC', 'APH', 'TEL', 'ZBRA', 'ROL', 'MAS', 'FTV'
  ],

  // Utilities
  utilities: [
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'WEC', 'ES', 'ED',
    'EIX', 'DTE', 'ETR', 'FE', 'AEE', 'PPL', 'CMS', 'CNP', 'NI', 'EVRG', 'AES',
    'PNW', 'NRG', 'LNT', 'ATO', 'PEG', 'PCG', 'AWK'
  ],

  // Energy
  energy: [
    'CVX', 'XOM', 'COP', 'EOG', 'SLB', 'OXY', 'PSX', 'MPC', 'VLO', 'HES',
    'DVN', 'FANG', 'HAL', 'APA', 'WMB', 'ET', 'BKR', 'OKE', 'KMI', 'EPD',
    'TRGP', 'LNG', 'ENPH', 'FSLR', 'NEE', 'MOS', 'CF', 'NEM', 'CTRA', 'EQT'
  ],

  // REITs
  reits: [
    'AMT', 'PLD', 'CCI', 'EQIX', 'SPG', 'O', 'WELL', 'DLR', 'PSA', 'AVB',
    'EQR', 'ARE', 'VTR', 'BXP', 'SLG', 'DOC', 'VICI', 'EXR', 'MAA', 'ESS',
    'UDR', 'CPT', 'INVH', 'KIM', 'REG', 'FRT', 'SBAC', 'IRM'
  ],

  // Telecom & Media
  telecom: [
    'T', 'TMUS', 'VZ', 'WBD', 'CHTR', 'CMCSA', 'NWS', 'NWSA', 'PARA', 'LBRDA',
    'FOXA', 'LBRDK', 'SIRI', 'FOX', 'IPG', 'OMC', 'LYV', 'VRSN', 'TKO'
  ],

  // EV & Auto
  evAuto: [
    'F', 'GM', 'RIVN', 'LCID', 'TM', 'HMC', 'RACE', 'STLA', 'LEA', 'BWA',
    'APTV', 'ALV', 'MGA', 'VC', 'GT', 'GNRC'
  ],

  // Materials & Chemicals
  materials: [
    'LIN', 'APD', 'SHW', 'ECL', 'DD', 'DOW', 'PPG', 'NEM', 'FCX', 'ALB',
    'IP', 'PKG', 'AVY', 'BALL', 'AMCR', 'LYB', 'MHK', 'IFF',
    'CTVA', 'BG', 'ADM', 'CF'
  ],

  // Misc/Other S&P 500 stocks
  misc: [
    'MSCI', 'MSTR', 'SHOP', 'MELI', 'PDD', 'DASH', 'APP', 'TTD', 'SHOP', 'TRI',
    'LW', 'SOLV', 'SW', 'VLTO', 'DAY', 'EXE', 'DELL', 'HPE', 'HPQ', 'STX', 'WDC', 'NTAP',
    'GLW', 'TXT', 'CBOE', 'CBRE', 'CCEP', 'BF-B', 'BRK-B', 'GEN', 'MSI', 'VRTX', 'VST', 'WY',
    'XYL', 'TSN', 'MO', 'PM', 'VTRS', 'WBA', 'WTW', 'WST', 'GNRC', 'TPL', 'EG', 'CEG'
  ]
};

// ============= UK STOCKS - FTSE 100/250 =============
export const ukStockSymbols = {
  // Banks & Financial Services (symbols without exchange suffix to match database)
  ukBanks: ['HSBA', 'LLOY', 'BARC', 'NWG', 'STAN', 'LSEG', 'PRU', 'LAND', 'BLND', 'SGRO'],
  // Oil & Gas / Energy
  ukEnergy: ['SHEL', 'BP', 'SSE', 'NG', 'CNA'],
  // Mining & Materials
  ukMining: ['RIO', 'AAL', 'GLEN', 'ANTO', 'FRES'],
  // Pharma & Healthcare
  ukPharma: ['AZN', 'GSK', 'HIK', 'SN'],
  // Consumer Goods & Retail
  ukConsumer: ['ULVR', 'RKT', 'DGE', 'BATS', 'IMB', 'TSCO', 'SBRY', 'ABF', 'OCDO', 'JD', 'FRAS', 'MKS', 'BRBY'],
  // Industrials & Engineering
  ukIndustrials: [
    'RR', 'BA', 'EXPN', 'REL', 'WPP', 'IHG', 'WTB', 'CPG', 'ENT', 'FLTR',
    'SDR', 'III', 'ABDN', 'LGEN', 'AV', 'PHNX', 'ADM', 'BDEV', 'TW', 'PSN',
    'BWY', 'RMV', 'AUTO', 'SPX', 'RTO', 'BNZL', 'CRDA', 'JMAT', 'MNDI',
    'WEIR', 'IMI', 'RS1', 'SMIN', 'HLMA'
  ],
  // Telecom & Tech
  ukTelecom: ['VOD', 'BT_A', 'SGE'],
  // Airlines & Transport
  ukTransport: ['IAG', 'EZJ', 'FERG'],
  // Utilities
  ukUtilities: ['SVT', 'UU', 'PNN'],
  // Media & Entertainment
  ukMedia: ['PSON', 'ITV'],
  // Other FTSE 100/250
  ukOther: [
    'SMT', 'INF', 'BNKE', 'SHC', 'NXT', 'KGF', 'CRH', 'DCC', 'WIZZ',
    'CMCX', 'PLUS', 'IGG', 'AO', 'THG', 'BOWL', 'RWS', 'FOUR', 'DPLM',
    'DOCS', 'IPX', 'JET2', 'LSL', 'MCB', 'MONY', 'QQ', 'RSW', 'RWA',
    'TCAP', 'TRN', 'VCT', 'WIX', 'WOSG', 'YOU', 'ZOO', 'BBOX', 'CURY',
    'DNLM', 'EMG', 'GFRD', 'HBR', 'INCH', 'OSB', 'PAGE', 'ROR', 'SMWH'
  ]
};

export const allUKStockSymbols = [...new Set([
  ...ukStockSymbols.ukBanks,
  ...ukStockSymbols.ukEnergy,
  ...ukStockSymbols.ukMining,
  ...ukStockSymbols.ukPharma,
  ...ukStockSymbols.ukConsumer,
  ...ukStockSymbols.ukIndustrials,
  ...ukStockSymbols.ukTelecom,
  ...ukStockSymbols.ukTransport,
  ...ukStockSymbols.ukUtilities,
  ...ukStockSymbols.ukMedia,
  ...ukStockSymbols.ukOther
])];

// ============= EUROPEAN STOCKS =============
export const europeStockSymbols = {
  // Switzerland - SMI (symbols without exchange suffix to match database)
  swiss: [
    'NESN', 'NOVN', 'ROG', 'UBSG', 'ZURN', 'ABBN', 'SREN',
    'GEBN', 'GIVN', 'LONN', 'SGSN', 'SCMN', 'SLHN', 'HOLN',
    'SIKA', 'SOON', 'TEMN', 'VACN'
  ],
  // Germany - DAX
  germany: [
    'SAP', 'SIE', 'ALV', 'DTE', 'BAS', 'MRK', 'MUV2',
    'BMW', 'VOW3', 'MBG', 'ADS', 'IFX', 'HEN3', 'BEI',
    'DB1', 'RWE', 'EOAN', 'FRE', 'HEI', 'CON', 'DTG',
    'SHL', 'QIA', 'PUM', 'ZAL', 'HFG'
  ],
  // France - CAC
  france: [
    'MC', 'OR', 'TTE', 'SAN', 'AIR', 'BNP', 'SU', 'AI',
    'DG', 'KER', 'CS', 'ORA', 'RI', 'CAP', 'DSY', 'HO',
    'EN', 'SGO', 'ML', 'PUB', 'VIV', 'ERF', 'BN', 'LR',
    'ACA', 'GLE', 'RMS'
  ],
  // Netherlands - AEX
  netherlands: [
    'ASML', 'INGA', 'HEIA', 'AD', 'PHIA', 'WKL', 'UNA',
    'AKZA', 'NN', 'RAND', 'KPN', 'ASRNL', 'IMCD', 'BESI'
  ],
  // Spain - IBEX
  spain: [
    'SAN', 'IBE', 'ITX', 'TEF', 'BBVA', 'REP', 'AMS',
    'FER', 'CABK', 'ENG'
  ],
  // Italy - MIB
  italy: ['ENI', 'ENEL', 'ISP', 'UCG', 'G', 'TEN', 'PRY', 'CPR'],
  // Belgium
  belgium: ['ABI', 'KBC', 'UCB', 'SOLB', 'UMI'],
  // Nordic (Denmark, Sweden, Norway, Finland)
  nordic: [
    // Denmark
    'NOVO_B', 'DSV', 'MAERSK_B', 'CARL_B', 'VWS', 'ORSTED', 'COLO_B',
    // Sweden
    'VOLV_B', 'ATCO_A', 'SEB_A', 'SHB_A', 'SWED_A', 'SAND',
    'ERIC_B', 'HEXA_B', 'ASSA_B', 'INVE_B',
    // Norway
    'EQNR', 'DNB', 'TEL', 'ORK',
    // Finland
    'NOKIA', 'FORTUM', 'NESTE', 'SAMPO', 'UPM'
  ]
};

export const allEuropeStockSymbols = [...new Set([
  ...europeStockSymbols.swiss,
  ...europeStockSymbols.germany,
  ...europeStockSymbols.france,
  ...europeStockSymbols.netherlands,
  ...europeStockSymbols.spain,
  ...europeStockSymbols.italy,
  ...europeStockSymbols.belgium,
  ...europeStockSymbols.nordic
])];

// ============= ASIA PACIFIC STOCKS =============
export const asiaStockSymbols = {
  // Japan - Nikkei (symbols without exchange suffix to match database)
  japan: [
    '7203', '6758', '6861', '9984', '8306', '6098', '9432',
    '4063', '6501', '6367', '9433', '7741', '6954', '4519',
    '8035', '4502', '8058', '6902', '4568', '6594', '6857',
    '7974', '9983', '8766', '6273', '8001', '7267', '6981',
    '7751', '4661', '6326', '9020', '4452', '6752', '8031',
    '7269', '4503', '3382', '8316', '2914'
  ],
  // Hong Kong - HSI
  hongKong: [
    '0700', '9988', '0939', '1398', '3988', '0941', '0005',
    '2318', '0883', '0857', '1299', '2388', '0016', '0001',
    '0011', '0002', '0003', '0006', '0012', '0027', '1928',
    '0388', '0823', '1109', '0267', '9618', '9999', '3690',
    '1810', '9888'
  ],
  // Korea - KOSPI
  korea: [
    '005930', '000660', '005380', '035420', '051910', '006400',
    '035720', '028260', '105560', '055550', '012330', '000270',
    '066570', '003550', '034730', '017670', '032830', '096770'
  ],
  // Taiwan - TWSE
  taiwan: [
    '2330', '2317', '2454', '2412', '2882', '2881', '1301',
    '2891', '2303', '3711', '2308', '2886', '1303', '2002', '5880'
  ],
  // Australia - ASX
  australia: [
    'BHP', 'CBA', 'CSL', 'NAB', 'WBC', 'ANZ', 'WES',
    'MQG', 'WOW', 'TLS', 'RIO', 'FMG', 'TCL', 'GMG',
    'ALL', 'COL', 'STO', 'WDS', 'AMC'
  ],
  // India - NSE
  india: [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
    'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK',
    'BAJFINANCE', 'AXISBANK', 'LT', 'ASIANPAINT', 'MARUTI',
    'HCLTECH', 'SUNPHARMA', 'WIPRO', 'TITAN', 'ULTRACEMCO'
  ]
};

export const allAsiaStockSymbols = [...new Set([
  ...asiaStockSymbols.japan,
  ...asiaStockSymbols.hongKong,
  ...asiaStockSymbols.korea,
  ...asiaStockSymbols.taiwan,
  ...asiaStockSymbols.australia,
  ...asiaStockSymbols.india
])];

// ============= CANADA STOCKS - TSX =============
export const canadaStockSymbols = {
  // Canada - TSX (symbols without exchange suffix to match database)
  canada: [
    'RY', 'TD', 'ENB', 'CNR', 'BNS', 'BMO', 'CP', 'TRI',
    'CSU', 'CNQ', 'ATD', 'SU', 'MFC', 'CM', 'FTS', 'TRP',
    'BCE', 'WCN', 'QSR', 'BAM', 'BN', 'SHOP', 'NTR', 'L',
    'GIB_A', 'POW', 'IFC', 'DOL', 'FFH', 'IMO', 'ABX',
    'K', 'AEM', 'WPM', 'FM', 'TECK_B', 'MRU', 'EMA', 'H', 'T'
  ]
};

export const allCanadaStockSymbols = [...canadaStockSymbols.canada];

export const allStockSymbols = [...new Set([
  ...stockSymbols.mag7Tech,
  ...stockSymbols.semiconductors,
  ...stockSymbols.software,
  ...stockSymbols.fintech,
  ...stockSymbols.banks,
  ...stockSymbols.insurance,
  ...stockSymbols.healthcare,
  ...stockSymbols.medDevices,
  ...stockSymbols.consumer,
  ...stockSymbols.industrials,
  ...stockSymbols.utilities,
  ...stockSymbols.energy,
  ...stockSymbols.reits,
  ...stockSymbols.telecom,
  ...stockSymbols.evAuto,
  ...stockSymbols.materials,
  ...stockSymbols.misc,
  // International stocks
  ...allUKStockSymbols,
  ...allEuropeStockSymbols,
  ...allAsiaStockSymbols,
  ...allCanadaStockSymbols
])];

// ============= ETFs (verified candles tables exist) =============
export const etfSymbols = {
  broadMarket: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'IVV', 'VT'],
  sector: ['XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB', 'XLRE'],
  thematic: ['SMH', 'XBI', 'IBB', 'KRE', 'XHB', 'XRT'],
  international: ['EEM', 'EFA', 'VWO', 'FXI', 'EWJ', 'EWZ', 'EWG', 'INDA', 'MCHI', 'KWEB'],
  fixedIncome: ['TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'JNK', 'BND', 'AGG'],
  commodities: ['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'DBC', 'PDBC', 'CPER'],
  volatility: ['VXX', 'UVXY', 'SVXY', 'TQQQ', 'SQQQ', 'SPXU'],
  innovation: ['ARKK', 'ARKW', 'ARKG', 'ARKF']
};

export const allETFSymbols = [...new Set([
  ...etfSymbols.broadMarket,
  ...etfSymbols.sector,
  ...etfSymbols.thematic,
  ...etfSymbols.international,
  ...etfSymbols.fixedIncome,
  ...etfSymbols.commodities,
  ...etfSymbols.volatility,
  ...etfSymbols.innovation
])];

// ============= ALL VALID SYMBOLS =============
// DEPRECATED: use useMarketData().data from x_pricecache instead.
// Kept temporarily for contractSpecs.ts which needs sync access without React hooks.
export const ALL_VALID_SYMBOLS = new Set([
  ...allForexSymbols,
  ...allCryptoSymbols,
  ...allCommoditySymbols,
  ...allIndexSymbols,
  ...allStockSymbols,
  ...allETFSymbols
]);

// ============= SYMBOL NAME MAPPINGS (COMPACT) =============
// Stock/ETF names now come from x_pricecache.nickname via useMarketData().
// This map only contains non-stock symbols (commodities, indices, forex, crypto) whose
// display names cannot be derived from their ticker alone. Consumers that need stock
// names should use useMarketData().getCompanyName() or .getDisplayName() instead.
export const symbolNames: Record<string, string> = {
  // Futures (registry display names; header fallback when the nickname
  // has not arrived from the API yet)
  'ES.F': 'S&P 500 Futures',
  'NQ.F': 'Nasdaq 100 Futures',
  'GC.F': 'Gold Futures',
  'SI.F': 'Silver Futures',
  'FDAX.F': 'DAX Futures',
  'FDXM.F': 'Mini-DAX Futures',
  'FESX.F': 'EURO STOXX 50 Futures',
  'FSMI.F': 'SMI Futures',
  'FGBL.F': 'Euro-Bund Futures',
  'FGBM.F': 'Euro-Bobl Futures',
  'FGBS.F': 'Euro-Schatz Futures',
  'FBTP.F': 'Euro-BTP Futures',
  'FOAT.F': 'Euro-OAT Futures',
  'FMEU.F': 'MSCI Europe Futures',
  'FMWO.F': 'MSCI World Futures',
  // Commodities - Precious Metals
  'XAU/USD': 'Gold',
  'XAG/USD': 'Silver',
  'XPT/USD': 'Platinum',
  'XPD/USD': 'Palladium',
  'XCU/USD': 'Copper',
  // Commodities - Industrial Metals
  'NICKEL/USD': 'Nickel',
  'ALUMINIUM/USD': 'Aluminium',
  'LEAD/USD': 'Lead',
  'IRON/USD': 'Iron Ore',
  // Commodities - Energy
  'WTICO/USD': 'WTI Crude Oil',
  'BCO/USD': 'Brent Crude',
  'NATGAS/USD': 'Natural Gas',
  // Commodities - Grains
  'CORN/USD': 'Corn',
  'WHEAT/USD': 'Wheat',
  'SOYBN/USD': 'Soybeans',
  'OATS/USD': 'Oats',
  'RICE/USD': 'Rice',
  // Commodities - Softs
  'SUGAR/USD': 'Sugar',
  'COFFEE/USD': 'Coffee',
  'COCOA/USD': 'Cocoa',
  'COTTON/USD': 'Cotton',
  'OJ/USD': 'Orange Juice',
  'LUMBER/USD': 'Lumber',
  // Commodities - Livestock
  'CATTLE/USD': 'Live Cattle',

  // Indices
  'SPX500/USD': 'S&P 500',
  'NAS100/USD': 'NASDAQ 100',
  'US30/USD': 'Dow Jones',
  'US2000/USD': 'Russell 2000',
  'UK100/GBP': 'FTSE 100',
  'UK250/GBP': 'FTSE 250',
  'DE30/EUR': 'DAX 40',
  'FR40/EUR': 'CAC 40',
  'EU50/EUR': 'Euro Stoxx 50',
  'JP225/USD': 'Nikkei 225',
  'AU200/AUD': 'ASX 200',
  'HK33/HKD': 'Hang Seng',
  'CN50/USD': 'China A50',
  // Volatility Indices
  'VIX': 'VIX (Fear Index)',
  'VSTOXX': 'EU VIX (VSTOXX)',

  // Major Crypto
  'BTC/USD': 'Bitcoin',
  'ETH/USD': 'Ethereum',
  'BNB/USD': 'BNB',
  'XRP/USD': 'Ripple',
  'SOL/USD': 'Solana',
  'ADA/USD': 'Cardano',
  'DOGE/USD': 'Dogecoin',
  'DOT/USD': 'Polkadot',
  'AVAX/USD': 'Avalanche',
  'LTC/USD': 'Litecoin',
  'LINK/USD': 'Chainlink',

  // Additional crypto
  'AAVE/USD': 'Aave',
  'UNI/USD': 'Uniswap',
  'ATOM/USD': 'Cosmos',
  'FIL/USD': 'Filecoin',
  'APT/USD': 'Aptos',
  'ARB/USD': 'Arbitrum',
  'ALGO/USD': 'Algorand',
  'ETC/USD': 'Ethereum Classic',
  'XLM/USD': 'Stellar',
  'MATIC/USD': 'Polygon',
  'NEAR/USD': 'NEAR Protocol',
  'TRX/USD': 'TRON',

  // Forex pairs (major and cross names)
  'EUR/USD': 'Euro / US Dollar',
  'GBP/USD': 'British Pound / US Dollar',
  'USD/JPY': 'US Dollar / Japanese Yen',
  'USD/CHF': 'US Dollar / Swiss Franc',
  'AUD/USD': 'Australian Dollar / US Dollar',
  'NZD/USD': 'New Zealand Dollar / US Dollar',
  'USD/CAD': 'US Dollar / Canadian Dollar',
  'EUR/GBP': 'Euro / British Pound',
  'EUR/JPY': 'Euro / Japanese Yen',
  'GBP/JPY': 'British Pound / Japanese Yen',
};


// ============= LEGACY HELPER FUNCTIONS =============
// These are thin wrappers kept for backward compatibility. New code should use
// useMarketData() hook instead, which sources names from x_pricecache.nickname.

// Helper function to format symbol with company name: "NVDA (NVIDIA)"
export function formatSymbolWithName(symbol: string): string {
  const name = symbolNames[symbol];
  if (name && name !== symbol) {
    return `${symbol} (${name})`;
  }
  return symbol;
}

// Helper to get just the company name, or null if no name exists
// For stock names, use useMarketData().getCompanyName() which checks ZWMP nickname
export function getCompanyName(symbol: string): string | null {
  // 1. Try direct match in local symbolNames (commodities, forex, crypto, indices)
  if (symbolNames[symbol] && symbolNames[symbol] !== symbol) {
    return symbolNames[symbol];
  }

  // 2. Try handling missing slash (BTCUSD -> BTC/USD)
  const upperSymbol = symbol.toUpperCase();
  const quoteCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'HKD', 'JPY', 'CAD', 'CHF', 'NZD', 'BTC'];
  for (const quote of quoteCurrencies) {
    if (upperSymbol.endsWith(quote) && upperSymbol.length > quote.length) {
      const base = upperSymbol.slice(0, -quote.length);
      const withSlash = `${base}/${quote}`;
      if (symbolNames[withSlash] && symbolNames[withSlash] !== withSlash) {
        return symbolNames[withSlash];
      }
    }
  }

  return null;
}

// Clean display symbol for indices (removes /USD, /EUR etc. when it doesn't make sense)
// E.g., "SPX500/USD" -> "SPX500", "UK100/GBP" -> "UK100"
export function getCleanDisplaySymbol(symbol: string): string {
  const indexDisplayMap: Record<string, string> = {
    'SPX500/USD': 'SPX500', 'NAS100/USD': 'NAS100', 'US30/USD': 'US30',
    'US2000/USD': 'US2000', 'UK100/GBP': 'UK100', 'DE30/EUR': 'DE30',
    'FR40/EUR': 'FR40', 'EU50/EUR': 'EU50', 'JP225/USD': 'JP225',
    'AU200/AUD': 'AU200', 'HK33/HKD': 'HK33', 'CN50/USD': 'CN50',
  };
  return indexDisplayMap[symbol] || symbol;
}

// Helper function to get display name
// For stock names, prefer useMarketData().getDisplayName() which checks ZWMP nickname
export function getSymbolDisplayName(symbol: string): string {
  // Direct match first
  if (symbolNames[symbol]) return symbolNames[symbol];

  // Try converting URL format (NAS100USD) to symbol format (NAS100/USD)
  const indexPatterns: Record<string, string> = {
    'SPX500USD': 'S&P 500', 'NAS100USD': 'NASDAQ 100', 'US30USD': 'Dow Jones',
    'US2000USD': 'Russell 2000', 'UK100GBP': 'FTSE 100', 'DE30EUR': 'DAX 40',
    'FR40EUR': 'CAC 40', 'EU50EUR': 'Euro Stoxx 50', 'JP225USD': 'Nikkei 225',
    'AU200AUD': 'ASX 200', 'HK33HKD': 'Hang Seng', 'CN50USD': 'China A50',
  };

  const upperSymbol = symbol.toUpperCase();
  if (indexPatterns[upperSymbol]) return indexPatterns[upperSymbol];

  // Try to reconstruct symbol with slash and look up
  const quoteCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'HKD', 'JPY', 'CAD', 'CHF', 'NZD', 'BTC'];
  for (const quote of quoteCurrencies) {
    if (upperSymbol.endsWith(quote) && upperSymbol.length > quote.length) {
      const base = upperSymbol.slice(0, -quote.length);
      const withSlash = `${base}/${quote}`;
      if (symbolNames[withSlash]) return symbolNames[withSlash];
    }
  }

  return symbol;
}

// Helper function to get category
export function getSymbolCategory(symbol: string): string {
  if (allForexSymbols.includes(symbol)) return 'Forex';
  if (allCryptoSymbols.includes(symbol)) return 'Crypto';
  if (allCommoditySymbols.includes(symbol)) return 'Commodities';
  if (allIndexSymbols.includes(symbol)) return 'Indices';
  if (allStockSymbols.includes(symbol)) return 'Stock';
  if (allETFSymbols.includes(symbol)) return 'ETF';
  return 'Other';
}

// Helper to convert symbol to table name
// Handles various formats: EUR/USD -> candles_eur_usd, SHEL.L -> candles_shel_l, AAPL -> candles_aapl
export function symbolToTableName(symbol: string): string {
  return `candles_${symbol.toLowerCase().replace(/[\/\.]/g, '_')}`;
}

// Check if a symbol has valid candles data
export function isValidSymbol(symbol: string): boolean {
  return ALL_VALID_SYMBOLS.has(symbol);
}
