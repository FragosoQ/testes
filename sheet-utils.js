const SHEET_CONFIG_DEFAULT = {
  id: '1GQUB52a2gKR429bjqJrNkbP5rjR7Z_4v85z9M7_Cr8Y',
  tab: 'PM1',
  keyHeader: null,
  keyValue: null,
  targetHeader: 'EVOLUÇÃO',
  targetColumn: 'Y',
};

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

async function loadSheetValue(config = {}) {
  const cfg = Object.assign({}, SHEET_CONFIG_DEFAULT, config);
  const endpoint = getSheetEndpoint(cfg);
  const response = await fetch(endpoint, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Sheet fetch failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const json = parseGvizResponse(text);
  if (!json || !json.table) {
    throw new Error('Sheet response did not contain table data');
  }

  const row = findRowByKey(json.table, cfg.keyHeader, cfg.keyValue);
  if (!row) {
    throw new Error('No data row found in sheet');
  }

  const targetIndex = findSheetCell(json.table, cfg.targetHeader, cfg.targetColumn);
  if (targetIndex < 0) {
    throw new Error(`Header ${cfg.targetHeader} not found and fallback column ${cfg.targetColumn} is invalid`);
  }
  return getValueFromRow(row, targetIndex);
}
