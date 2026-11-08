const test = require('node:test');
const assert = require('node:assert/strict');
const sms = require('../utils/sms');
test('Verify sends OTPs and accepts only provider-approved codes without exposing credentials', async () => {
  const names=['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID','TWILIO_ALLOWED_NUMBERS'];
  const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));const original=global.fetch;
  try {
    process.env.TWILIO_ACCOUNT_SID='AC'+'a'.repeat(32);process.env.TWILIO_AUTH_TOKEN='test-secret';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'a'.repeat(32);process.env.TWILIO_ALLOWED_NUMBERS='+919000000000';
    assert.equal(sms.isSmsConfigured(),true);assert.equal(sms.usesTwilioVerify(),true);
    const requests=[];
    global.fetch=async (url,opts)=>{requests.push({url,body:opts.body});return new Response(JSON.stringify({status:url.endsWith('VerificationCheck')&&opts.body.get('Code')==='123456'?'approved':'pending'}),{status:200});};
    await sms.sendVerification('+919000000000');
    assert.equal(requests[0].body.get('Channel'),'sms');
    assert.equal(await sms.checkVerification('+919000000000','111111'),false);
    assert.equal(await sms.checkVerification('+919000000000','123456'),true);
    const before=requests.length;await assert.rejects(sms.sendVerification('+919000000001'),e=>e.status===400);assert.equal(requests.length,before);
    global.fetch=async()=>new Response(JSON.stringify({message:'sensitive provider diagnostic'}),{status:429});
    await assert.rejects(sms.sendVerification('+919000000000'),e=>e.status===429&&!e.message.includes('sensitive'));
    global.fetch=async()=>new Response('{}',{status:404});
    await assert.rejects(sms.checkVerification('+919000000000','123456'),e=>e.status===400);
  } finally {
    global.fetch=original;for(const n of names)if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];
  }
});
