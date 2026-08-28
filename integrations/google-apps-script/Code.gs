/**
 * Optional Google Forms + Sheets bridge.
 * The Vercel/Supabase deployment does not require this file.
 *
 * Script Properties:
 *   BRIDGE_SECRET  - must match GOOGLE_BRIDGE_SECRET on Vercel
 *   SPREADSHEET_ID - a new or existing destination workbook
 */
const PLAYER_NAMES = ['Moe', 'John', 'Diane', 'Adam'];

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
    return output_({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message || error) });
  }
}

function upsertForm_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const key = 'FORM_ID_' + payload.season + '_' + payload.week;
  const existingId = properties.getProperty(key);
  const form = existingId ? FormApp.openById(existingId) : FormApp.create(payload.title);
  if (!existingId) properties.setProperty(key, form.getId());

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
  if (!existingId && spreadsheetId) form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  return { ok: true, formId: form.getId(), responderUrl: form.getPublishedUrl(), editUrl: form.getEditUrl() };
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

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
