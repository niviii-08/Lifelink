/* ==========================================
   TELEGRAM BOT INTEGRATION
   ------------------------------------------
   Sends OTP codes and alert notifications to users via the Telegram Bot API.

   SETUP:
   1. Message @BotFather on Telegram, run /newbot, and copy the bot token.
   2. Set it as an environment variable before starting the server:
        TELEGRAM_BOT_TOKEN=123456:ABC-your-token-here
   3. Each user must start a chat with your bot (search the bot's username on
      Telegram and press "Start", or open t.me/<your_bot_username>). The bot
      replies with their numeric Chat ID (see the /start handler wired up by
      startTelegramPolling() below). The user enters that Chat ID when
      registering / linking Telegram on LifeLink so the server knows where to
      deliver OTPs and alerts.

   DEV MODE:
   If TELEGRAM_BOT_TOKEN is not set, messages are logged to the server console
   instead of being sent, so the app remains fully testable without a real bot.
   ========================================== */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

const isConfigured = () => !!API_BASE;

/**
 * Send a plain-text message to a Telegram chat.
 * Returns { ok: boolean, dev?: boolean, error?: string }
 */
async function sendTelegramMessage(chatId, text) {
  if (!chatId) return { ok: false, error: 'Missing Telegram chat ID' };

  if (!isConfigured()) {
    // Dev fallback: no bot token configured, just log so the flow is testable.
    console.log(`\n[TELEGRAM DEV MODE] -> chat ${chatId}:\n${text}\n`);
    return { ok: true, dev: true };
  }

  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram send failed:', data.description);
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (err) {
    console.error('Telegram send error:', err.message);
    return { ok: false, error: err.message };
  }
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Optional: long-polls Telegram getUpdates so that when a user sends /start
 * (or any message) to the bot, we reply immediately with their Chat ID.
 * This makes "linking Telegram" self-service - the user never has to dig
 * through the Telegram app for their numeric ID. No-op in dev mode.
 */
function startTelegramPolling() {
  if (!isConfigured()) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN not set - running in dev mode (OTPs logged to console).');
    return;
  }

  let offset = 0;
  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/getUpdates?timeout=25&offset=${offset}`);
      const data = await res.json();
      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const chatId = update.message?.chat?.id;
          const text = update.message?.text || '';
          if (chatId && text.startsWith('/start')) {
            await sendTelegramMessage(
              chatId,
              `👋 Welcome to <b>LifeLink</b>!\n\nYour Telegram Chat ID is:\n<b>${chatId}</b>\n\nEnter this ID on the LifeLink Sign Up / Sign In page to receive OTP codes and emergency blood alerts here.`
            );
          }
        }
      }
    } catch (err) {
      console.error('Telegram polling error:', err.message);
    } finally {
      setTimeout(poll, 1000);
    }
  };
  poll();
}

module.exports = { sendTelegramMessage, generateOtpCode, isConfigured, startTelegramPolling };
