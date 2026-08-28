export async function sendPoolLink(config, message, fetchImpl = fetch) {
  if (config.smsProvider !== 'twilio') {
    console.log(`[SMS preview] ${message}`);
    return { provider: 'console', delivered: false, preview: message };
  }
  const required = ['twilioAccountSid', 'twilioAuthToken', 'twilioFrom', 'smsTo'];
  const missing = required.filter(key => !config[key]);
  if (missing.length) throw new Error(`Missing SMS settings: ${missing.join(', ')}`);
  const body = new URLSearchParams({ To: config.smsTo, From: config.twilioFrom, Body: message });
  const credentials = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `Twilio returned ${response.status}`);
  return { provider: 'twilio', delivered: true, id: result.sid };
}
