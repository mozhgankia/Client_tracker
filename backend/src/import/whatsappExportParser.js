// Parses a WhatsApp "Export chat" .txt file into a flat list of
// { sender, text } messages. WhatsApp uses two main line formats depending on
// the phone's OS/locale:
//
//   iOS:      [2024/01/15, 10:30:45 PM] Sender Name: message text
//             [15/01/2024, 22:30:45] Sender Name: message text
//   Android:  15/01/2024, 22:30 - Sender Name: message text
//             1/15/24, 10:30 PM - Sender Name: message text
//
// A message can span several lines; continuation lines don't start with a
// timestamp, so they're appended to the message before them. Lines that carry
// a timestamp but no "Sender: " (WhatsApp's own system notices, e.g. the
// end-to-end-encryption banner) are skipped.
'use strict';

// iOS: a bracketed "[...]" timestamp, then the rest of the line.
const IOS_LINE = /^‎?\[[^\]]+\]\s*(.*)$/;
// Android: "date, time -" then the rest of the line. The date/time shapes are
// kept loose on purpose so 12h/24h and D/M/Y vs M/D/Y both match.
const ANDROID_LINE =
  /^‎?\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap][Mm])?\s+-\s+(.*)$/;

// Splits "Sender Name: message" on the FIRST ": ". Returns null for a system
// notice (no sender/colon), so the caller can skip it.
function splitSenderText(rest) {
  const idx = rest.indexOf(': ');
  if (idx === -1) return null;
  const sender = rest.slice(0, idx).trim();
  const text = rest.slice(idx + 2);
  if (!sender) return null;
  return { sender, text };
}

/**
 * @param {string} content raw contents of an exported WhatsApp chat .txt file
 * @returns {{ sender: string, text: string }[]}
 */
function parseWhatsAppExport(content) {
  const lines = String(content).split(/\r?\n/);
  const messages = [];
  let current = null;

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  for (const line of lines) {
    const m = line.match(IOS_LINE) || line.match(ANDROID_LINE);
    if (m) {
      flush();
      const parsed = splitSenderText(m[1]);
      if (parsed) current = { sender: parsed.sender, text: parsed.text };
      // else: a system notice — leave `current` null so following
      // continuation lines (if any) are ignored too.
    } else if (current) {
      current.text += '\n' + line; // continuation of a multi-line message
    }
  }
  flush();

  return messages;
}

module.exports = { parseWhatsAppExport };
