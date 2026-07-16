# راهنمای دیپلوی روی Render (پلن رایگان)

## پیش‌نیازها
- کد باید روی گیت‌هاب باشه (همین ریپازیتوری، همین برنچ).
- یک اکانت [Render](https://render.com) بسازید (رایگان، فقط با گیت‌هاب می‌تونید وارد بشید).
- یک پروژه‌ی [Supabase](https://supabase.com) ساخته و اسکیمای `backend/src/db/schema.sql` رو توش اجرا کرده باشید (اگه هنوز نکردید، اول این کار رو بکنید — همه‌چیز بهش وابسته‌ست).
- کلیدهای لازم رو از قبل آماده داشته باشید: `ANTHROPIC_API_KEY`، `GOOGLE_AI_API_KEY`، `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`، `GOOGLE_SERVICE_ACCOUNT_KEY`/`GOOGLE_DRIVE_PARENT_FOLDER_ID` (لیست کامل در `backend/.env.example`).

## روش سریع — با فایل `render.yaml` (پیشنهادی)
این ریپازیتوری یک فایل `render.yaml` توی ریشه داره که ساختار سرویس رو از قبل تعریف می‌کنه.

1. وارد داشبورد Render بشید → **New +** → **Blueprint**.
2. ریپازیتوری `mozhgankia/Client_tracker` رو انتخاب کنید و برنچ درست رو بزنید.
3. Render خودش `render.yaml` رو پیدا و سرویس رو با تنظیمات درست (Root Directory: `backend`، Build/Start Command، Health Check) می‌سازه.
4. قبل از اینکه دکمه‌ی نهایی رو بزنید، مقدار متغیرهای محیطی‌ای که علامت "قفل" یا خالی هستن رو پر کنید (لیست کامل در بخش «متغیرهای محیطی» پایین‌تر).
5. **Apply** رو بزنید.

## روش دستی — از داشبورد (اگه ترجیح می‌دید قدم‌به‌قدم خودتون بسازید)

1. **New +** → **Web Service**.
2. ریپازیتوری `mozhgankia/Client_tracker` رو وصل کنید.
3. تنظیمات:
   | فیلد | مقدار |
   |---|---|
   | **Root Directory** | `backend` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` |
4. پایین همون صفحه، بخش **Environment Variables** رو باز کنید و همه‌ی مقادیر زیر رو وارد کنید.
5. **Create Web Service** رو بزنید.

## متغیرهای محیطی (هر دو روش)

| نام | از کجا بیارید |
|---|---|
| `SUPABASE_URL` | تنظیمات پروژه‌ی Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | همون‌جا (⚠️ کلید سرویس، نه anon key) |
| `JWT_SECRET` | یک رشته‌ی تصادفی طولانی؛ اگه از `render.yaml` استفاده کنید Render خودش می‌سازه |
| `ANTHROPIC_API_KEY` | همون کلیدی که برای بقیه‌ی بخش‌های پروژه دارید |
| `GOOGLE_AI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | https://my.telegram.org |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | محتوای فایل JSON سرویس‌اکانت گوگل، در یک خط |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | آی‌دی پوشه‌ی گوگل‌درایو |
| `PUBLIC_URL` | آدرس همین سرویس روی Render — بعد از اولین دیپلوی پر می‌شه (پایین رو ببینید) |

`TELEGRAM_BOT_TOKEN` رو فقط اگه از `botListener.js` (جایگزین ساده‌ی بات) به‌جای اتصال با اکانت شخصی استفاده می‌کنید لازم دارید.

## بعد از اولین دیپلوی: ست کردن `PUBLIC_URL`

اولین بار که سرویس بالا میاد، Render یک آدرس بهش می‌ده (چیزی شبیه `https://maskanyar-backend.onrender.com`). این آدرس رو کپی کنید و به‌عنوان مقدار `PUBLIC_URL` توی همون Environment Variables ست کنید و ذخیره کنید — Render خودکار سرویس رو ری‌استارت می‌کنه. این آدرس برای دو چیز لازمه:
- **بیدارباش خودکار** (`src/server.js`): بدون این، سرویس رایگان بعد از ۱۵ دقیقه بی‌کاری می‌خوابه.
- Webhook تلگرام (فقط اگه از `botListener.js` استفاده می‌کنید).

## تست بعد از دیپلوی

```bash
curl https://<آدرس-سرویس-شما>.onrender.com/health
# باید {"ok":true,...} برگردونه

curl -X POST https://<آدرس-سرویس-شما>.onrender.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"یک-رمز-قوی","fullName":"مژگان کیا"}'
# یک JWT برمی‌گردونه — همینو برای مراحل بعد نگه دارید
```

بعدش با همون توکن، `/api/whatsapp/connect` یا `/api/telegram/connect` رو بزنید — چون اینجا دیگه محدودیت شبکه‌ی سندباکس نیست، این‌بار باید واقعاً QR/کد دریافت کنید.

## نکات پلن رایگان Render

- **خواب بعد از بی‌کاری**: بعد از ۱۵ دقیقه بدون درخواست HTTP، سرویس رایگان می‌خوابه. پینگ خودکار هر ۱۰ دقیقه‌ی خود بک‌اند (`startKeepAlivePing`) این مشکل رو حل می‌کنه — به شرطی که `PUBLIC_URL` درست ست شده باشه.
- **۷۵۰ ساعت رایگان در ماه**: برای یک سرویس ۲۴ ساعته کافیه (ماه حداکثر ~۷۴۴ ساعته).
- **۵۱۲ مگابایت RAM**: هر نشست فعال واتساپ/تلگرام حافظه مصرف می‌کنه؛ اگه تعداد مستأجرهای هم‌زمان زیاد بشه، ممکنه لازم بشه پلن رو ارتقا بدید.
- **دیسک موقتی**: به همین دلیل همه‌چیز (نشست‌ها، لیدها) در Supabase ذخیره می‌شه، نه روی دیسک Render — با هر ری‌دیپلوی یا ری‌استارت هیچ‌چیزی از دست نمی‌ره.

## نکته‌ی امنیتی
هیچ‌وقت فایل `.env` واقعی رو commit نکنید (`.gitignore` همین الان جلوشو گرفته). همه‌ی کلیدها فقط باید توی بخش Environment Variables خود Render وارد بشن.
