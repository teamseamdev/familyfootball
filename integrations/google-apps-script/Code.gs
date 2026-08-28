/**
 * Google Forms + original-style weekly Sheets bridge.
 *
 * Script Properties:
 *   BRIDGE_SECRET       - must match GOOGLE_BRIDGE_SECRET on Vercel
 *   SPREADSHEET_ID      - destination workbook ID
 *   TEMPLATE_SHEET_NAME - optional; recommended value: TEMPLATE
 */
const PLAYER_NAMES = ['Moe', 'John', 'Diane', 'Adam'];
const PLAYER_COLUMNS = { Moe: 7, John: 9, Diane: 11, Adam: 13 };
const FIRST_GAME_ROW = 3;
const LAST_GAME_ROW = 22;

function doGet() {
  return output_({ ok: true, service: 'family-nfl-pool-google-bridge' });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('BRIDGE_SECRET') || payload.secret !== properties.getProperty('BRIDGE_SECRET')) {
      return output_({ ok: false, error: 'Unauthorized' });
    }
    if (payload.action === 'upsertForm') return output_(upsertForm_(payload));
    if (payload.action === 'getResponses') return output_(getResponses_(payload));
    if (payload.action === 'syncWeek') return output_(syncWeek_(payload));
    return output_({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message || error) });
  }
}

function upsertForm_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const sheet = prepareWeekSheet_(payload);
  const key = 'FORM_ID_' + payload.season + '_' + payload.week;
  const existingId = properties.getProperty(key);
  const form = existingId ? FormApp.openById(existingId) : FormApp.create(payload.title);
  if (!existingId) properties.setProperty(key, form.getId());
  properties.setProperty('FORM_CONTEXT_' + form.getId(), JSON.stringify({ season: payload.season, week: payload.week }));

  form.setTitle(payload.title)
    .setDescription(payload.description || '')
    .setConfirmationMessage('Your picks are in. Good luck this week!')
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setProgressBar(true);
  const oldItems = form.getItems();
  for (let index = oldItems.length - 1; index >= 0; index--) form.deleteItem(index);
  form.addListItem().setTitle('Name').setChoiceValues(PLAYER_NAMES).setRequired(true);
  payload.games.forEach(function(game) {
    form.addMultipleChoiceItem()
      .setTitle(game.title)
      .setChoiceValues(game.choices.map(function(choice) { return choice.label; }))
      .setHelpText(game.id)
      .setRequired(true);
  });

  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!existingId) form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  ensureFormTrigger_(form);
  return {
    ok: true,
    formId: form.getId(),
    responderUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    sheetUrl: sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId(),
    sheetName: sheet.getName()
  };
}

function prepareWeekSheet_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID Script Property is required');
  const book = SpreadsheetApp.openById(spreadsheetId);
  const name = 'WK' + payload.week;
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    const templateName = properties.getProperty('TEMPLATE_SHEET_NAME') || 'TEMPLATE';
    let template = book.getSheetByName(templateName);
    if (!template) {
      template = book.getSheets().filter(function(candidate) {
        const match = candidate.getName().match(/^WK(\d+)$/i);
        return match && Number(match[1]) < Number(payload.week);
      }).sort(function(a, b) {
        return Number(b.getName().slice(2)) - Number(a.getName().slice(2));
      })[0];
    }
    sheet = template ? template.copyTo(book).setName(name) : book.insertSheet(name);
  }

  ensureLayout_(sheet, payload.week);
  sheet.getRange('C3:E22').clearContent();
  sheet.getRange('G3:N22').clearContent();
  sheet.getRange('H24:N24').clearContent();
  const rowMap = {};
  payload.games.slice(0, LAST_GAME_ROW - FIRST_GAME_ROW + 1).forEach(function(game, index) {
    const row = FIRST_GAME_ROW + index;
    merge_(sheet, row, 3, 1, 2);
    sheet.getRange(row, 3).setValue(game.away + ' @ ' + game.home);
    sheet.getRange(row, 5).setValue(favoriteLabel_(game));
    rowMap[game.id] = row;
  });
  properties.setProperty('GAME_ROWS_' + payload.season + '_' + payload.week, JSON.stringify(rowMap));
  SpreadsheetApp.flush();
  return sheet;
}

function ensureLayout_(sheet, week) {
  if (sheet.getMaxRows() < 31) sheet.insertRowsAfter(sheet.getMaxRows(), 31 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < 16) sheet.insertColumnsAfter(sheet.getMaxColumns(), 16 - sheet.getMaxColumns());
  merge_(sheet, 1, 1, 1, 16);
  sheet.getRange('A1').setValue('Week ' + week + ' Football Bets').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  merge_(sheet, 2, 3, 1, 2);
  sheet.getRange('C2').setValue('Visitor vs Home');
  sheet.getRange('E2').setValue('Spread');
  PLAYER_NAMES.forEach(function(player) {
    const column = PLAYER_COLUMNS[player];
    sheet.getRange(2, column).setValue(player);
    sheet.getRange(2, column + 1).setValue('Win?').setBackground('#d9e7f5');
  });
  sheet.getRange('C2:N22').setFontFamily('Calibri').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('C2:E22').setBorder(true, true, true, true, true, true, '#444444', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange('G2:N22').setBorder(true, true, true, true, true, true, '#444444', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange('H3:H24').setBackground('#d9e7f5');
  sheet.getRange('J3:J24').setBackground('#d9e7f5');
  sheet.getRange('L3:L24').setBackground('#d9e7f5');
  sheet.getRange('N3:N24').setBackground('#d9e7f5');
  merge_(sheet, 24, 3, 1, 3);
  sheet.getRange('C24').setValue('TOTAL WEEKLY WINS').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('C24:E24').setBorder(true, true, true, true, true, true);
  merge_(sheet, 26, 3, 1, 3);
  sheet.getRange('C26').setValue('TOTAL OVERALL WINS').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('C26:E31').setBorder(true, true, true, true, true, true);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 36);
  sheet.setColumnWidth(5, 100);
  for (let column = 7; column <= 14; column++) sheet.setColumnWidth(column, 100);
  sheet.setFrozenRows(2);
}

function syncWeek_(payload) {
  const sheet = prepareWeekSheet_(payload);
  const rowMap = JSON.parse(PropertiesService.getScriptProperties().getProperty('GAME_ROWS_' + payload.season + '_' + payload.week) || '{}');
  sheet.getRange('G3:N22').clearContent();
  (payload.submissions || []).forEach(function(submission) {
    writeSubmission_(sheet, rowMap, submission, true);
  });
  PLAYER_NAMES.forEach(function(player) {
    const column = PLAYER_COLUMNS[player];
    const submission = (payload.submissions || []).filter(function(item) { return item.name.toLowerCase() === player.toLowerCase(); })[0];
    sheet.getRange(24, column + 1).setValue(submission ? submission.points : '');
  });
  writeOverallTotals_(sheet, payload.week, payload.standings || []);
  SpreadsheetApp.flush();
  return { ok: true, sheetUrl: sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId(), sheetName: sheet.getName() };
}

function processFormSubmission(event) {
  const form = event.source;
  const contextRaw = PropertiesService.getScriptProperties().getProperty('FORM_CONTEXT_' + form.getId());
  if (!contextRaw) throw new Error('No week mapping found for this form');
  const context = JSON.parse(contextRaw);
  const book = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  const sheet = book.getSheetByName('WK' + context.week);
  const rowMap = JSON.parse(PropertiesService.getScriptProperties().getProperty('GAME_ROWS_' + context.season + '_' + context.week) || '{}');
  let name = '';
  const picks = {};
  event.response.getItemResponses().forEach(function(itemResponse) {
    const item = itemResponse.getItem();
    if (item.getTitle() === 'Name') name = String(itemResponse.getResponse()).trim();
    else picks[item.asMultipleChoiceItem().getHelpText()] = String(itemResponse.getResponse()).split(' ')[0];
  });
  writeSubmission_(sheet, rowMap, { name: name, picks: picks, grades: {} }, false);
}

function writeSubmission_(sheet, rowMap, submission, includeGrades) {
  const player = PLAYER_NAMES.filter(function(name) { return name.toLowerCase() === String(submission.name).toLowerCase(); })[0];
  if (!player) return;
  const column = PLAYER_COLUMNS[player];
  Object.keys(submission.picks || {}).forEach(function(gameId) {
    const row = rowMap[gameId];
    if (!row) return;
    sheet.getRange(row, column).setValue(submission.picks[gameId]);
    if (includeGrades) {
      const grade = submission.grades && submission.grades[gameId];
      sheet.getRange(row, column + 1).setValue(grade && grade.points != null ? grade.points : '');
    }
  });
}

function writeOverallTotals_(sheet, week, rows) {
  const byName = {};
  rows.forEach(function(row) { byName[row.name.toLowerCase()] = row; });
  sheet.getRange('C27:E31').clearContent();
  sheet.getRange('D27').setValue(Number(week) > 1 ? 'Wk' + (Number(week) - 1) : 'Start').setBackground('#4285f4').setFontColor('#ffffff');
  sheet.getRange('E27').setValue('Wk' + week).setBackground('#4285f4').setFontColor('#ffffff');
  PLAYER_NAMES.forEach(function(player, index) {
    const rowNumber = 28 + index;
    const standing = byName[player.toLowerCase()] || { total: 0, current: 0 };
    sheet.getRange(rowNumber, 3).setValue(player.toUpperCase()).setFontWeight('bold');
    sheet.getRange(rowNumber, 4).setValue(Number(standing.total || 0) - Number(standing.current || 0));
    sheet.getRange(rowNumber, 5).setValue(Number(standing.total || 0));
  });
}

function getResponses_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty('FORM_ID_' + payload.season + '_' + payload.week);
  if (!formId) return { ok: true, responses: [] };
  const responses = FormApp.openById(formId).getResponses().map(function(response) {
    let name = '';
    const picks = {};
    response.getItemResponses().forEach(function(itemResponse) {
      const item = itemResponse.getItem();
      if (item.getTitle() === 'Name') name = String(itemResponse.getResponse()).trim();
      else picks[item.asMultipleChoiceItem().getHelpText()] = String(itemResponse.getResponse()).split(' ')[0];
    });
    return { id: response.getId(), name: name, submittedAt: response.getTimestamp().toISOString(), picks: picks };
  });
  return { ok: true, responses: responses };
}

function ensureFormTrigger_(form) {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'processFormSubmission' && trigger.getTriggerSourceId() === form.getId();
  });
  if (!exists) ScriptApp.newTrigger('processFormSubmission').forForm(form).onFormSubmit().create();
}

function favoriteLabel_(game) {
  const homeSpread = Number(game.homeSpread);
  if (homeSpread === 0) return game.home + ' PK';
  const favorite = homeSpread < 0 ? game.home : game.away;
  const choice = (game.choices || []).filter(function(item) { return item.team === favorite; })[0];
  return choice ? choice.label : favorite;
}

function merge_(sheet, row, column, numRows, numColumns) {
  const range = sheet.getRange(row, column, numRows, numColumns);
  if (!range.isPartOfMerge()) range.merge();
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
