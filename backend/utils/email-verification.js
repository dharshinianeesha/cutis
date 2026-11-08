const Otp = require('../models/Otp');
const {generateCode,hashCode}=require('./otp');
const {sendOtpEmail,isEmailConfigured}=require('./mailer');
function emailVerificationRequired(){return process.env.NODE_ENV==='production'||!!process.env.NETLIFY||!!process.env.VERCEL||process.env.EMAIL_VERIFICATION_REQUIRED==='true';}
async function issueEmailCode(email,purpose,registration){
  if(!isEmailConfigured())throw Object.assign(new Error('Email verification is temporarily unavailable.'),{code:'EMAIL_NOT_CONFIGURED'});
  const recent=await Otp.findOne({identifier:email,createdAt:{$gt:new Date(Date.now()-60000)}});
  if(recent)throw Object.assign(new Error('Please wait a minute before requesting another email code.'),{code:'OTP_RATE_LIMIT'});
  const code=generateCode();
  await Otp.deleteMany({identifier:email});
  const doc=await Otp.create({identifier:email,codeHash:await hashCode(code),purpose,registration});
  try{await sendOtpEmail(email,code);}catch(e){await Otp.deleteOne({_id:doc._id});throw Object.assign(new Error('Verification email could not be delivered. Please retry later.'),{code:'EMAIL_SEND_FAILED'});}
}
module.exports={emailVerificationRequired,issueEmailCode};
