// SMS OTP via Twilio's REST API (no SDK needed).
function isSmsConfigured() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID, TWILIO_VERIFY_SERVICE_SID } = process.env;
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && (TWILIO_FROM || TWILIO_MESSAGING_SERVICE_SID || TWILIO_VERIFY_SERVICE_SID));
}
async function sendOtpSms(to, code) {
  if (!isSmsConfigured()) {
    const e = new Error('SMS is not configured.'); e.code = 'SMS_NOT_CONFIGURED'; throw e;
  }
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID } = process.env;
  const body = new URLSearchParams({ To: to, Body: `Your Cutis verification code is ${code}. It expires in 10 minutes.` });
  if (TWILIO_MESSAGING_SERVICE_SID) body.set('MessagingServiceSid', TWILIO_MESSAGING_SERVICE_SID); else body.set('From', TWILIO_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).message; } catch (_) {}
    const e = new Error(`SMS provider error (${res.status}) ${msg}`); e.code = 'SMS_SEND_FAILED'; throw e;
  }
}
function usesTwilioVerify() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}
async function verifyRequest(endpoint, fields) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  const response = await fetch('https://verify.twilio.com/v2/Services/' + encodeURIComponent(service) + '/' + endpoint, {
    method: 'POST',
    headers: {Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams(fields), signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('SMS verification provider rejected the request.');
    error.code = 'SMS_SEND_FAILED';
    error.status = response.status === 429 ? 429 : endpoint === 'VerificationCheck' && response.status === 404 ? 400 : 502;
    throw error;
  }
  return result;
}
async function sendVerification(to) {
  const allowed = (process.env.TWILIO_ALLOWED_NUMBERS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(to)) throw Object.assign(new Error('This number is not an enabled tester.'), {code:'SMS_SEND_FAILED',status:400});
  const result = await verifyRequest('Verifications', {To:to, Channel:'sms'});
  if (result.status !== 'pending') throw Object.assign(new Error('Verification could not be started.'), {code:'SMS_SEND_FAILED',status:502});
}
async function checkVerification(to, code) {
  const result = await verifyRequest('VerificationCheck', {To:to, Code:code});
  return result.status === 'approved';
}
module.exports = { sendOtpSms, isSmsConfigured, usesTwilioVerify, sendVerification, checkVerification };
