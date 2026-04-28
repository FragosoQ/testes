const SHEET_CONFIG_DEFAULT = {
  id: '1GQUB52a2gKR429bjqJrNkbP5rjR7Z_4v85z9M7_Cr8Y',
  tab: 'PM1',
  keyHeader: null,
  keyValue: null,
  targetHeader: 'EVOLUÇÃO',
  targetColumn: 'Y',
};

// Cache system to avoid multiple fetches
let sheetCache = {};
let sheetCachePromises = {};

function getCacheKey(config) {
  const cfg = Object.assign({}, SHEET_CONFIG_DEFAULT, config);
  return `${cfg.id}|${cfg.tab}`;
}

function getSheetEndpoint(config) {
  const sheetId = encodeURIComponent(config.id);
  const sheetTab = encodeURIComponent(config.tab);
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${sheetTab}&headers=1`;
}

function parseGvizResponse(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\((.*)\);?$/s);
  if (!match) {
    throw new Error('Invalid Google Sheets response format');
  }
  return JSON.parse(match[1]);
}

function normalizeString(value) {
  return String(value || '').trim().normalize('NFC').toLowerCase();
}

function columnLetterToIndex(letter) {
  if (!letter) return -1;
  const normalized = String(letter).trim().toUpperCase();
  let index = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const charCode = normalized.charCodeAt(i);
    if (charCode < 65 || charCode > 90) {
      return -1;
    }
    index = index * 26 + (charCode - 65 + 1);
  }
  return index - 1;
}

function findSheetCell(table, headerLabel, fallbackColumn) {
  if (!table || !Array.isArray(table.cols)) {
    return -1;
  }

  // Prioritize column letter if provided
  if (fallbackColumn) {
    const fallbackIndex = columnLetterToIndex(fallbackColumn);
    if (fallbackIndex >= 0 && fallbackIndex < table.cols.length) {
      return fallbackIndex;
    }
  }

  // Fall back to header matching
  if (headerLabel) {
    const label = normalizeString(headerLabel);
    return table.cols.findIndex(col => normalizeString(col.label || col.id || '') === label);
  }

  return -1;
}

function getValueFromRow(row, index) {
  if (!row || !Array.isArray(row.c) || index < 0) {
    return null;
  }
  const cell = row.c[index];
  if (!cell) {
    return null;
  }
  return cell.v != null ? cell.v : (cell.f != null ? cell.f : null);
}

function findRowByKey(table, keyHeader, keyValue) {
  if (!Array.isArray(table.rows) || table.rows.length === 0) {
    return null;
  }
  if (keyHeader && keyValue) {
    const keyIndex = findSheetCell(table, keyHeader);
    if (keyIndex >= 0) {
      const found = table.rows.find(row => {
        const cellValue = getValueFromRow(row, keyIndex);
        return normalizeString(cellValue) === normalizeString(keyValue);
      });
      if (found) {
        return found;
      }
    }
  }
  return table.rows[0] || null;
}

function parseSheetPercentage(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    const pct = Math.abs(value) <= 1 ? value * 100 : value;
    return Math.round(pct);
  }

  const str = String(value).trim();
  const percentMatch = str.match(/^(-?\d+(?:[\.,]\d+)?)\s*%$/);
  if (percentMatch) {
    return Math.round(Number(percentMatch[1].replace(',', '.')));
  }

  const numericMatch = str.replace(/\s+/g, '').replace(',', '.').match(/(-?\d+(?:\.\d+)?)/);
  if (!numericMatch) {
    return null;
  }
  const numeric = Number(numericMatch[1]);
  const pct = numeric <= 1 ? numeric * 100 : numeric;
  return Math.round(pct);
}

function parseSheetDate(value) {
  if (value == null) {
    return null;
  }

  // Handle Google Sheets date format like "Date(2026,3,14)"
  const dateMatch = String(value).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (dateMatch) {
    const year = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]); // 0-based in JS Date
    const day = parseInt(dateMatch[3]);
    const date = new Date(year, month, day);
    return date;
  }

  // Try to parse as regular date string
  const date = new Date(String(value));
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function formatSheetDate(value) {
  const date = parseSheetDate(value);
  if (!date) {
    return String(value);
  }
  return date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getDaysDiff(dateValue1, dateValue2) {
  const date1 = parseSheetDate(dateValue1);
  const date2 = parseSheetDate(dateValue2);
  
  if (!date1 || !date2) {
    return null;
  }

  // Reset time to midnight for accurate day difference
  date1.setHours(0, 0, 0, 0);
  date2.setHours(0, 0, 0, 0);

  return Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));
}

async function fetchSheetTable(config) {
  const endpoint = getSheetEndpoint(config);
  const response = await fetch(endpoint, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Sheet fetch failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const json = parseGvizResponse(text);
  if (!json || !json.table) {
    throw new Error('Sheet response did not contain table data');
  }
  return json.table;
}

function buildRowLookup(table, row) {
  const valuesByHeader = {};
  const valuesByColumn = {};

  if (!row || !Array.isArray(table.cols)) {
    return { valuesByHeader, valuesByColumn };
  }

  table.cols.forEach((col, index) => {
    const value = getValueFromRow(row, index);
    valuesByColumn[index] = value;

    const normalizedLabel = normalizeString(col.label || col.id || `col${index}`);
    valuesByHeader[normalizedLabel] = value;
  });

  return { valuesByHeader, valuesByColumn };
}

async function loadSheetDataCached(config = {}, options = {}) {
  const cfg = Object.assign({}, SHEET_CONFIG_DEFAULT, config);
  const cacheKey = getCacheKey(cfg);
  const forceReload = options.forceReload === true;

  if (!forceReload && sheetCache[cacheKey]) {
    return sheetCache[cacheKey];
  }

  if (!forceReload && sheetCachePromises[cacheKey]) {
    return await sheetCachePromises[cacheKey];
  }

  const promise = (async () => {
    const table = await fetchSheetTable(cfg);
    const row = findRowByKey(table, cfg.keyHeader, cfg.keyValue);
    if (!row) {
      throw new Error('No data row found in sheet');
    }

    const lookup = buildRowLookup(table, row);
    const result = { table, row, valuesByHeader: lookup.valuesByHeader, valuesByColumn: lookup.valuesByColumn };

    sheetCache[cacheKey] = result;
    delete sheetCachePromises[cacheKey];
    return result;
  })();

  sheetCachePromises[cacheKey] = promise;
  try {
    return await promise;
  } catch (error) {
    delete sheetCachePromises[cacheKey];
    throw error;
  }
}

async function loadSheetRow(config = {}) {
  const cached = await loadSheetDataCached(config);
  return cached;
}

function getSheetRowValue(rowData, targetHeader, targetColumn) {
  if (!rowData) {
    return null;
  }

  if (targetHeader) {
    const normalizedHeader = normalizeString(targetHeader);
    if (Object.prototype.hasOwnProperty.call(rowData.valuesByHeader, normalizedHeader)) {
      return rowData.valuesByHeader[normalizedHeader];
    }
  }

  if (targetColumn) {
    const index = columnLetterToIndex(targetColumn);
    if (index >= 0) {
      return rowData.valuesByColumn[index];
    }
  }

  return null;
}

async function loadSheetValue(config = {}) {
  const cfg = Object.assign({}, SHEET_CONFIG_DEFAULT, config);
  const cached = await loadSheetDataCached(cfg);

  return getSheetRowValue(cached, cfg.targetHeader, cfg.targetColumn);
}

function rowValuesSnapshot(rowData) {
  if (!rowData || !rowData.valuesByHeader) {
    return '';
  }
  const entries = Object.entries(rowData.valuesByHeader).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function watchSheetRow(config = {}, onChange, intervalMs = 20000) {
  let lastSnapshot = null;
  let stopped = false;

  async function check() {
    if (stopped) return;
    try {
      const cached = await loadSheetDataCached(config, { forceReload: true });
      const snapshot = rowValuesSnapshot(cached);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        onChange(cached);
      }
    } catch (error) {
      console.warn('Sheet watch error:', error);
    }
  }

  check();
  const intervalId = setInterval(check, intervalMs);
  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

/**
 * Calcula dias úteis (segunda a sexta) entre duas datas em Portugal
 * @param {Date|String|Number} startDate - Data inicial
 * @param {Date|String|Number} endDate - Data final
 * @param {Boolean} includeStartDay - Se inclui o primeiro dia (padrão: true)
 * @param {Number} year - Ano para determinar feriados (padrão: ano da startDate)
 * @returns {Number} Número de dias úteis
 */
function getWorkDaysCount(startDate, endDate, includeStartDay = true, year = null) {
  const start = parseSheetDate(startDate);
  const end = parseSheetDate(endDate);
  
  if (!start || !end) {
    return null;
  }

  // Feriados nacionais em Portugal (formato: MM-DD)
  const ptHolidays = [
    '01-01', // Ano Novo
    '04-25', // Dia da Liberdade
    '05-01', // Dia do Trabalho
    '06-10', // Dia de Portugal
    '08-15', // Assunção
    '10-05', // Proclamação da República
    '11-01', // Dia de Todos os Santos
    '12-01', // Restauração da Independência
    '12-25', // Natal
  ];

  // Feriados móveis para 2026
  const mobileHolidays2026 = [
    '02-17', // Terça de Carnaval
    '04-17', // Sexta-feira Santa
  ];

  const year4Start = start.getFullYear();
  if (year === year4Start) {
    ptHolidays.push(...mobileHolidays2026);
  }

  const isHoliday = (date) => {
    const monthDay = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    return ptHolidays.includes(monthDay);
  };

  const isWorkDay = (date) => {
    const dayOfWeek = date.getDay();
    // 0 = domingo, 1 = segunda, ..., 5 = sexta, 6 = sábado
    return dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday(date);
  };

  let count = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  // Ajestar se não inclui o dia de início
  if (!includeStartDay) {
    current.setDate(current.getDate() + 1);
  }

  while (current <= end) {
    if (isWorkDay(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Retorna informações de prazo com dias úteis
 * @param {Date|String|Number} startDate - Data de início
 * @param {Date|String|Number} dueDate - Data prevista
 * @param {Date|String|Number} todayDate - Data atual (padrão: hoje)
 * @returns {Object} { totalWorkDays, remainingWorkDays, percentage }
 */
function getDeadlineInfo(startDate, dueDate, todayDate = new Date()) {
  const start = parseSheetDate(startDate);
  const due = parseSheetDate(dueDate);
  const today = parseSheetDate(todayDate);
  
  if (!start || !due || !today) {
    return null;
  }

  const totalWorkDays = getWorkDaysCount(start, due, true, start.getFullYear());
  const remainingWorkDays = getWorkDaysCount(today, due, false, today.getFullYear());
  
  return {
    totalWorkDays,
    remainingWorkDays,
    daysElapsed: totalWorkDays - remainingWorkDays,
    percentage: totalWorkDays > 0 ? Math.round(((totalWorkDays - remainingWorkDays) / totalWorkDays) * 100) : 0
  };
}

/**
 * Retorna o emoji da bandeira baseado no nome do país
 * @param {String} countryName - Nome do país
 * @returns {String} Emoji da bandeira ou 🇺🇳 se não encontrado
 */
function getCountryFlag(countryName) {
  if (!countryName || typeof countryName !== 'string') {
    return '🇺🇳'; // United Nations flag as fallback
  }

  const country = countryName.trim().toLowerCase();

  // Mapeamento de países para códigos ISO de 2 letras
  const countryMap = {
    'portugal': 'PT',
    'portuguesa': 'PT',
    'espanha': 'ES',
    'spain': 'ES',
    'frança': 'FR',
    'france': 'FR',
    'itália': 'IT',
    'italy': 'IT',
    'alemanha': 'DE',
    'germany': 'DE',
    'reino unido': 'GB',
    'united kingdom': 'GB',
    'uk': 'GB',
    'estados unidos': 'US',
    'united states': 'US',
    'usa': 'US',
    'brasil': 'BR',
    'brazil': 'BR',
    'méxico': 'MX',
    'mexico': 'MX',
    'peru': 'PE',
    'perú': 'PE',
    'chile': 'CL',
    'colômbia': 'CO',
    'colombia': 'CO',
    'argentina': 'AR',
    'equador': 'EC',
    'ecuador': 'EC',
    'uruguai': 'UY',
    'uruguay': 'UY',
    'paraguai': 'PY',
    'paraguay': 'PY',
    'venezuela': 'VE',
    'bolívia': 'BO',
    'bolivia': 'BO',
    'panamá': 'PA',
    'panama': 'PA',
    'costa rica': 'CR',
    'costa-rica': 'CR',
    'nicarágua': 'NI',
    'nicaragua': 'NI',
    'honduras': 'HN',
    'el salvador': 'SV',
    'elsalvador': 'SV',
    'guatemala': 'GT',
    'belize': 'BZ',
    'andorra': 'AD',
    'angola': 'AO',
    'moçambique': 'MZ',
    'mozambique': 'MZ',
    'cabo verde': 'CV',
    'caboverde': 'CV',
    'guiné-bissau': 'GW',
    'guine-bissau': 'GW',
    'são tomé e príncipe': 'ST',
    'sao tome e principe': 'ST',
    'timor-leste': 'TL',
    'timor leste': 'TL',
    'macau': 'MO',
    'macao': 'MO'
  };

  const countryCode = countryMap[country];
  if (!countryCode) {
    return '🇺🇳'; // Fallback
  }

  // Converter código ISO para emoji de bandeira
  // A = 127462 (🇦), B = 127463 (🇧), etc.
  const flag = countryCode
    .toUpperCase()
    .split('')
    .map(char => String.fromCodePoint(127462 + char.charCodeAt(0) - 65))
    .join('');

  return flag;
}

/**
 * Retorna as coordenadas geográficas (latitude, longitude) de um país
 * @param {String} countryName - Nome do país
 * @returns {Object} {lat, lon} ou coordenadas de Portugal como fallback
 */
function getCountryCoordinates(countryName) {
  if (!countryName || typeof countryName !== 'string') {
    return { lat: 38.7, lon: -9.1 }; // Portugal como fallback
  }

  const country = countryName.trim().toLowerCase();

  // Mapeamento de países para coordenadas [latitude, longitude]
  const coordinatesMap = {
    'portugal': { lat: 38.7, lon: -9.1 },
    'portuguesa': { lat: 38.7, lon: -9.1 },
    'espanha': { lat: 40.4, lon: -3.7 },
    'spain': { lat: 40.4, lon: -3.7 },
    'frança': { lat: 48.9, lon: 2.4 },
    'france': { lat: 48.9, lon: 2.4 },
    'itália': { lat: 41.9, lon: 12.5 },
    'italy': { lat: 41.9, lon: 12.5 },
    'alemanha': { lat: 52.5, lon: 13.4 },
    'germany': { lat: 52.5, lon: 13.4 },
    'reino unido': { lat: 51.5, lon: -0.1 },
    'united kingdom': { lat: 51.5, lon: -0.1 },
    'uk': { lat: 51.5, lon: -0.1 },
    'estados unidos': { lat: 38.9, lon: -77.0 },
    'united states': { lat: 38.9, lon: -77.0 },
    'usa': { lat: 38.9, lon: -77.0 },
    'brasil': { lat: -15.8, lon: -47.9 },
    'brazil': { lat: -15.8, lon: -47.9 },
    'méxico': { lat: 19.4, lon: -99.1 },
    'mexico': { lat: 19.4, lon: -99.1 },
    'peru': { lat: -9.2, lon: -75.0 },
    'perú': { lat: -9.2, lon: -75.0 },
    'chile': { lat: -33.4, lon: -70.7 },
    'colômbia': { lat: 4.7, lon: -74.1 },
    'colombia': { lat: 4.7, lon: -74.1 },
    'argentina': { lat: -34.6, lon: -58.4 },
    'equador': { lat: -0.2, lon: -78.5 },
    'ecuador': { lat: -0.2, lon: -78.5 },
    'uruguai': { lat: -34.9, lon: -56.2 },
    'uruguay': { lat: -34.9, lon: -56.2 },
    'paraguai': { lat: -25.3, lon: -57.6 },
    'paraguay': { lat: -25.3, lon: -57.6 },
    'venezuela': { lat: 10.5, lon: -66.9 },
    'bolívia': { lat: -16.5, lon: -68.1 },
    'bolivia': { lat: -16.5, lon: -68.1 },
    'panamá': { lat: 8.98, lon: -79.5 },
    'panama': { lat: 8.98, lon: -79.5 },
    'costa rica': { lat: 9.93, lon: -84.1 },
    'costa-rica': { lat: 9.93, lon: -84.1 },
    'nicarágua': { lat: 12.1, lon: -86.3 },
    'nicaragua': { lat: 12.1, lon: -86.3 },
    'honduras': { lat: 14.1, lon: -87.2 },
    'el salvador': { lat: 13.7, lon: -89.2 },
    'elsalvador': { lat: 13.7, lon: -89.2 },
    'guatemala': { lat: 14.6, lon: -90.5 },
    'belize': { lat: 17.3, lon: -88.8 },
    'andorra': { lat: 42.5, lon: 1.5 },
    'angola': { lat: -8.8, lon: 13.2 },
    'moçambique': { lat: -25.9, lon: 32.6 },
    'mozambique': { lat: -25.9, lon: 32.6 },
    'cabo verde': { lat: 14.9, lon: -23.5 },
    'caboverde': { lat: 14.9, lon: -23.5 },
    'guiné-bissau': { lat: 11.9, lon: -15.6 },
    'guine-bissau': { lat: 11.9, lon: -15.6 },
    'são tomé e príncipe': { lat: 0.3, lon: 6.7 },
    'sao tome e principe': { lat: 0.3, lon: 6.7 },
    'timor-leste': { lat: -8.6, lon: 125.6 },
    'timor leste': { lat: -8.6, lon: 125.6 },
    'macau': { lat: 22.2, lon: 113.5 },
    'macao': { lat: 22.2, lon: 113.5 }
  };

  return coordinatesMap[country] || { lat: 38.7, lon: -9.1 }; // Portugal como fallback
}
