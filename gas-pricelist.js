// ═══════════════════════════════════════════════════════════════
//  Google Apps Script — Multi-Tab Pricelist Dashboard
//  File: Code.gs
//
//  Fitur:
//  - Baca semua tab spreadsheet secara dinamis
//  - Sediakan endpoint JSON/JSONP untuk web
//  - Simpan histori perubahan harga di tab "HISTORY"
//
//  Deploy:
//  1. Paste ke GAS → Save
//  2. Deploy → New deployment → Web app
//  3. Execute as: Me | Who has access: Anyone
// ═══════════════════════════════════════════════════════════════

// ── Ganti dengan Spreadsheet ID Anda ──
const SS_ID        = "GANTI_DENGAN_SPREADSHEET_ID_ANDA";
const HISTORY_SHEET = "HISTORY"; // Tab untuk menyimpan log perubahan
const SKIP_SHEETS   = ["HISTORY"]; // Tab yang tidak dibaca sebagai data

// ═══════════════════════════════════════
//  doGet — entry point web app
// ═══════════════════════════════════════
function doGet(e) {
  try {
    var p        = (e && e.parameter) || {};
    var callback = p.callback || null;
    var action   = p.action   || "getData";

    var result;
    if (action === "getHistory") {
      result = getHistory();
    } else {
      result = getAllData();
    }

    var out = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + "(" + out + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(out)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    var errOut = JSON.stringify({ status: "error", message: err.message });
    var cb = (e && e.parameter && e.parameter.callback) || null;
    if (cb) return ContentService.createTextOutput(cb + "(" + errOut + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(errOut).setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══════════════════════════════════════
//  Baca semua tab & deteksi perubahan
// ═══════════════════════════════════════
function getAllData() {
  var ss      = SpreadsheetApp.openById(SS_ID);
  var sheets  = ss.getSheets();
  var allData = {};
  var changes = [];
  var now     = new Date().toISOString();

  // Pastikan tab HISTORY ada
  ensureHistorySheet(ss);

  // Baca data lama dari cache (PropertiesService)
  var cache    = PropertiesService.getScriptProperties();
  var oldCache = {};
  try { oldCache = JSON.parse(cache.getProperty("lastData") || "{}"); } catch(e) { oldCache = {}; }

  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (SKIP_SHEETS.indexOf(name) !== -1) return;

    var rows  = sheet.getDataRange().getValues();
    var items = parseSheet(rows, name);
    allData[name] = items;

    // Deteksi perubahan vs data lama
    var oldItems = oldCache[name] || [];
    var detected = detectChanges(oldItems, items, name, now);
    changes = changes.concat(detected);
  });

  // Simpan perubahan ke tab HISTORY dan cache
  if (changes.length > 0) {
    saveToHistory(ss, changes);
  }

  // Update cache
  try { cache.setProperty("lastData", JSON.stringify(allData)); } catch(e) {}

  return {
    status  : "ok",
    data    : allData,
    changes : changes.length,
    updated : now
  };
}

// ═══════════════════════════════════════
//  Parse satu sheet
// ═══════════════════════════════════════
function parseSheet(rows, sheetName) {
  // Row 0 = header, data mulai row 1
  var items = [];
  for (var i = 1; i < rows.length; i++) {
    var row   = rows[i];
    var item  = String(row[1] || "").trim();
    var vendor = String(row[6] || "").trim();
    if (!item || !vendor) continue;

    items.push({
      no    : String(row[0] || i),
      item  : item,
      merk  : String(row[2] || "").trim(),
      type  : String(row[3] || "").trim(),
      ukuran: String(row[4] || "").trim(),
      harga : row[5] ? Number(String(row[5]).replace(/[^0-9.]/g, "")) : 0,
      vendor: vendor,
      sheet : sheetName
    });
  }
  return items;
}

// ═══════════════════════════════════════
//  Deteksi perubahan harga
// ═══════════════════════════════════════
function detectChanges(oldItems, newItems, sheetName, timestamp) {
  var changes = [];
  var oldMap  = {};
  oldItems.forEach(function(o) {
    oldMap[o.item + "|" + o.vendor] = o;
  });

  newItems.forEach(function(n) {
    var key = n.item + "|" + n.vendor;
    var old = oldMap[key];
    if (!old) {
      // Item baru
      changes.push({
        timestamp : timestamp,
        sheet     : sheetName,
        item      : n.item,
        vendor    : n.vendor,
        type      : "BARU",
        hargaLama : "-",
        hargaBaru : n.harga
      });
    } else if (old.harga !== n.harga) {
      // Perubahan harga
      changes.push({
        timestamp : timestamp,
        sheet     : sheetName,
        item      : n.item,
        vendor    : n.vendor,
        type      : n.harga > old.harga ? "NAIK" : "TURUN",
        hargaLama : old.harga,
        hargaBaru : n.harga
      });
    }
  });
  return changes;
}

// ═══════════════════════════════════════
//  Simpan ke tab HISTORY
// ═══════════════════════════════════════
function ensureHistorySheet(ss) {
  var sheet = ss.getSheetByName(HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(HISTORY_SHEET);
    sheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "Tab", "Nama Item", "Vendor", "Tipe", "Harga Lama", "Harga Baru"
    ]]);
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight("bold")
      .setBackground("#e02020")
      .setFontColor("#ffffff");
  }
  return sheet;
}

function saveToHistory(ss, changes) {
  var sheet = ss.getSheetByName(HISTORY_SHEET);
  if (!sheet) return;
  var rows = changes.map(function(c) {
    return [c.timestamp, c.sheet, c.item, c.vendor, c.type, c.hargaLama, c.hargaBaru];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
}

// ═══════════════════════════════════════
//  Baca histori dari tab HISTORY
// ═══════════════════════════════════════
function getHistory() {
  var ss    = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { status: "ok", history: [] };
  }
  var rows    = sheet.getDataRange().getValues();
  var history = [];
  for (var i = rows.length - 1; i >= 1; i--) { // terbaru dulu
    var r = rows[i];
    history.push({
      timestamp : r[0], sheet: r[1], item: r[2],
      vendor    : r[3], type: r[4], hargaLama: r[5], hargaBaru: r[6]
    });
    if (history.length >= 200) break; // max 200 entri
  }
  return { status: "ok", history: history };
}

// ── Test dari editor ──
function testGetData() {
  var ss     = SpreadsheetApp.openById(SS_ID);
  var sheets = ss.getSheets();
  Logger.log("Sheets: " + sheets.map(function(s){ return s.getName(); }).join(", "));
  var result = getAllData();
  Logger.log("Status: " + result.status);
  Logger.log("Changes: " + result.changes);
  var tabs = Object.keys(result.data);
  tabs.forEach(function(t) {
    Logger.log("Tab " + t + ": " + result.data[t].length + " items");
  });
}
