// Heavy reasoning step: deep price analysis / complex report generation.
// Reserved for the small minority of tasks worth Claude's cost, per the
// hybrid-model design (Gemini handles the high-volume lead extraction in
// geminiExtract.js).
//
// Note on model choice: "Claude 3.5 Sonnet" was requested, but that model ID
// (claude-3-5-sonnet-20241022) was retired on 2025-10-28. Its direct
// replacement is claude-sonnet-5 (same tier — balanced cost/quality — not
// claude-opus-4-8, which is a step up in both capability and price). This
// file uses claude-sonnet-5.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';

// Shared instructions reused across every heavy-analysis call. Marked with
// cache_control so repeated calls only pay full price once per 5-minute
// window — the ~90% input-token savings mentioned in the spec comes from
// this block being byte-identical across requests (see shared/prompt-caching.md
// in the claude-api skill: cache reads cost ~0.1x base input price).
const SYSTEM_PROMPT = [
  'شما یک تحلیل‌گر ارشد بازار املاک دبی هستید.',
  'خروجی شما باید دقیق، مبتنی بر داده، و قابل‌استناد در مذاکره با مشتری باشد.',
  'اگر داده‌ی کافی برای یک ارزیابی مطمئن ندارید، این را صریحاً بگویید — حدس نزنید.',
].join('\n');

function getClient() {
  return new Anthropic(); // reads ANTHROPIC_API_KEY from env
}

/**
 * Runs a heavy-reasoning analysis (e.g. price assessment, complex report)
 * with the shared system prompt cached.
 * @param {string} userPrompt - the specific analysis request (property details, etc.)
 * @param {object[]} [tools] - optional tools (e.g. web_search) for this call
 */
async function runHeavyAnalysis(userPrompt, tools = []) {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools,
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude از تحلیل این درخواست خودداری کرد.');
  }

  const cacheRead = response.usage.cache_read_input_tokens || 0;
  const cacheWrite = response.usage.cache_creation_input_tokens || 0;
  console.log(`[claudeAnalyze] cache_read=${cacheRead} cache_write=${cacheWrite}`);

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { runHeavyAnalysis, MODEL };
