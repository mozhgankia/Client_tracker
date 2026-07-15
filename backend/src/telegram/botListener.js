// Lighter alternative to listener.js: a regular Telegram Bot (via
// node-telegram-bot-api + webhook) instead of monitoring a personal account
// with GramJS. Use this when the tenant is fine adding "@YourBot" as an
// admin to their own groups/channels, rather than connecting their personal
// Telegram account. Simpler to set up, but can't read groups it wasn't
// explicitly added to.
'use strict';

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { isLikelyRealEstateMessage } = require('./keywordFilter');
const { extractLeadFromMessage } = require('../ai/geminiExtract');
const { saveLead } = require('../db/leads');

/**
 * Registers the bot's webhook handler on the given Express app.
 * @param {import('express').Express} app
 * @param {string} userId - the tenant this bot belongs to
 */
function registerTelegramBotWebhook(app, userId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const publicUrl = process.env.PUBLIC_URL; // e.g. https://your-app.onrender.com
  if (!token || !publicUrl) {
    console.warn('[telegram-bot] TELEGRAM_BOT_TOKEN یا PUBLIC_URL تنظیم نشده — ربات غیرفعال است.');
    return;
  }

  const bot = new TelegramBot(token, { webHook: true });
  bot.setWebHook(`${publicUrl}/webhooks/telegram-bot`);

  app.post('/webhooks/telegram-bot', express.json(), (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!isLikelyRealEstateMessage(text)) return;

    try {
      const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
      const extracted = await extractLeadFromMessage(text, { senderName });
      if (!extracted.is_relevant) return;

      await saveLead(userId, extracted, {
        source: 'telegram',
        chatId: String(msg.chat.id),
        senderName,
        telegramId: String(msg.from.id),
        phone: null,
        rawMessage: text,
      });
    } catch (err) {
      console.error('[telegram-bot] خطا در پردازش پیام:', err.message);
    }
  });

  return bot;
}

module.exports = { registerTelegramBotWebhook };
