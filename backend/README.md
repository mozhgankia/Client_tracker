# بک‌اند — پلتفرم چندکاربره (هزینه‌ی نزدیک به صفر)

این بک‌اند کاملاً stateless نوشته شده تا روی سرویس‌های رایگان (Render یا Hugging Face Spaces) قابل میزبانی باشه — هیچ فایلی روی دیسک سرور ذخیره نمی‌شه؛ همه‌چیز (نشست واتساپ، نشست تلگرام، مشتری‌ها، ملک‌ها، لیدها) توی Supabase (Postgres رایگان) نگه داشته می‌شه.

## معماری

| بخش | فایل | توضیح |
|---|---|---|
| API + keep-alive | `src/server.js` | اکسپرس + پینگ خودکار هر ۱۰ دقیقه به `/health` تا سرور رایگان نخوابه |
| دیتابیس | `src/db/schema.sql`, `src/db/supabaseClient.js` | اسکیمای Postgres + کلاینت مشترک |
| تلگرام (شنود کامل با اکانت شخصی) | `src/telegram/listener.js` | مانیتور گروه‌ها/کانال‌ها بعد از لاگین |
| تلگرام (ورود با شماره/کد/رمز دومرحله‌ای) | `src/telegram/authFlow.js` | همون handshake سه‌مرحله‌ای که از داشبورد صدا زده می‌شه |
| تلگرام (جایگزین ساده با بات) | `src/telegram/botListener.js` | node-telegram-bot-api + webhook — فقط چت‌هایی که بات توشونه |
| فیلتر کلمات کلیدی | `src/shared/keywordFilter.js` | قبل از فرستادن به AI، پیام‌های نامرتبط رو رد می‌کنه (هم برای تلگرام هم واتساپ) |
| استخراج سبک (Gemini) | `src/ai/geminiExtract.js` | تشخیص مالک/مشتری + استخراج JSON — ارزان/رایگان |
| تحلیل سنگین (Claude) | `src/ai/claudeAnalyze.js` | فقط برای گزارش قیمت/تحلیل پیچیده — با Prompt Caching |
| واتساپ بدون دیسک | `src/whatsapp/supabaseAuthState.js` | جایگزین `useMultiFileAuthState` که همه‌چیز رو در Supabase نگه می‌داره |
| گوگل‌درایو | `src/drive/uploadToDrive.js` | آپلود خودکار عکس ملک با Service Account |

## راه‌اندازی

1. یک پروژه‌ی [Supabase](https://supabase.com) بسازید (پلن رایگان) و `src/db/schema.sql` رو توی SQL Editor اجرا کنید.
2. `.env.example` رو کپی کنید به `.env` و مقادیرش رو پر کنید:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: از تنظیمات پروژه‌ی Supabase.
   - `ANTHROPIC_API_KEY`: همون کلیدی که برای بقیه‌ی بخش‌های پروژه دارید.
   - `GOOGLE_AI_API_KEY`: از [Google AI Studio](https://aistudio.google.com/apikey) — رایگان.
   - `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`: از https://my.telegram.org.
   - `GOOGLE_SERVICE_ACCOUNT_KEY`/`GOOGLE_DRIVE_PARENT_FOLDER_ID`: طبق راهنمای قبلی گوگل‌درایو.
3. `npm install`
4. `npm start` — یا برای دیپلوی روی Render، راهنمای کامل قدم‌به‌قدم رو در [`DEPLOY_RENDER.md`](./DEPLOY_RENDER.md) ببینید.

### اتصال تلگرام هر مستأجر (Tenant)

راه اصلی، همون سه اندپوینتیه که داشبورد صدا می‌زنه (نیازی به هیچ اسکریپت محلی نیست):

1. `POST /api/telegram/connect` با `{ phone }` → کد به تلگرام کاربر ارسال می‌شه، پاسخ `{ status: "code_pending" }`
2. `POST /api/telegram/verify-code` با `{ code }` → یا `{ status: "connected" }` برمی‌گرده، یا اگر اکانت رمز دومرحله‌ای داشته باشه `{ status: "password_pending" }`
3. (فقط در صورت نیاز) `POST /api/telegram/verify-password` با `{ password }` → `{ status: "connected" }`

همه‌ی این‌ها نیاز به هدر `Authorization: Bearer <token>` دارن (از `/api/auth/login`). برای تست دستی محلی بدون داشبورد، `src/telegram/login.js` هم به‌عنوان جایگزین اینتراکتیو ترمینالی باقی مونده.

## چرا این انتخاب‌ها؟

- **`teleproto` به‌جای `telegram` (GramJS)**: پکیج اصلی GramJS دیگه نگهداری نمی‌شه و خودش به‌عنوان جایگزین به `teleproto` اشاره می‌کنه (fork فعال و سازگار). چون قراره این سرویس ۲۴ ساعته و برای مدت طولانی روشن بمونه، از پکیجی که هنوز پچ امنیتی و آپدیت می‌گیره استفاده کردم.
- **Gemini 1.5 Flash برای استخراج لید**: چون این تابع روی هر پیامی که از فیلتر کلمات کلیدی رد بشه اجرا می‌شه (حجم بالا)، مدل رایگان/ارزان اینجا منطقیه.
- **Claude Sonnet 5 برای تحلیل سنگین**: فقط برای کارهایی مثل تحلیل قیمت نهایی که واقعاً به استدلال عمیق نیاز دارن. (توجه: در درخواست اولیه «Claude 3.5 Sonnet» ذکر شده بود، ولی این مدل در ۲۸ اکتبر ۲۰۲۵ بازنشسته شده و جایگزین مستقیمش `claude-sonnet-5` است — همون سطح قیمتی/کیفی، نه `claude-opus-4-8` که یک پله بالاتره.)
- **Prompt Caching روی `claudeAnalyze.js`**: چون سیستم‌پرامپت بین درخواست‌ها ثابته، این کش تا ۹۰٪ هزینه‌ی توکن ورودی رو کم می‌کنه.
