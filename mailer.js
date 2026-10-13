const nodemailer = require('nodemailer');

// Fallback to ethereal if no real SMTP provided
let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log('[Mailer] Using configured SMTP server.');
  } else {
    // Generate test SMTP service account from ethereal.email
    let testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });
    console.log('[Mailer] Using Ethereal (Dev Mode) for emails. Check logs for preview URLs.');
  }
  return transporter;
}

async function sendEmail(to, subject, text) {
  if (!to) return { ok: false, error: 'Missing recipient email' };

  try {
    const t = await getTransporter();
    let info = await t.sendMail({
      from: '"LifeLink Authentication" <noreply@lifelink.local>',
      to: to,
      subject: subject,
      text: text,
      html: text.replace(/\n/g, '<br>'),
    });

    console.log(`[Mailer] Message sent to ${to}: ${info.messageId}`);
    
    // Preview only available when sending through an Ethereal account
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Mailer] 💡 Preview URL: ${previewUrl}`);
    }
    
    return { ok: true, previewUrl };
  } catch (err) {
    console.error('[Mailer] Error:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendEmail };
