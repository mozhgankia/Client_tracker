# راهنمای ساخت دیتابیس روی Supabase (پلن رایگان)

دیتابیس، پایه‌ی همه‌چیزه — قبل از دیپلوی بک‌اند روی Render، اول این مرحله رو کامل کنید.

> ✅ **اسکیمای `src/db/schema.sql` روی Postgres 16 واقعی (همون موتوری که Supabase استفاده می‌کنه) تست شده** — همه‌ی جدول‌ها، کلیدهای خارجی، `cascade delete` و منطق تبدیل لید بدون خطا کار می‌کنن. پس با خیال راحت همون فایل رو اجرا کنید.

## ۱. ساخت پروژه‌ی Supabase
1. به [supabase.com](https://supabase.com) بروید و با گیت‌هاب یا ایمیل وارد شوید.
2. **New project** را بزنید:
   - **Name**: مثلاً `maskanyar`
   - **Database Password**: یک رمز قوی بسازید و **جایی امن ذخیره کنید** (بعداً اگر بخواهید مستقیم به دیتابیس وصل شوید لازم می‌شود؛ برای کار عادی اپ لازم نیست).
   - **Region**: نزدیک‌ترین منطقه به کاربرها (برای دبی معمولاً `Central EU (Frankfurt)` یا `Southeast Asia (Singapore)`).
   - **Plan**: Free.
3. چند دقیقه صبر کنید تا پروژه ساخته شود.

## ۲. اجرای اسکیما
1. در داشبورد پروژه، از منوی چپ → **SQL Editor** → **New query**.
2. کل محتوای فایل [`src/db/schema.sql`](./src/db/schema.sql) را کپی کنید و در ادیتور بچسبانید.
3. **Run** را بزنید. باید بدون خطا اجرا شود (پیام `Success. No rows returned`).
4. برای اطمینان، از منوی چپ → **Table Editor** بروید؛ باید این جدول‌ها را ببینید:
   `users`، `customers`، `properties`، `whatsapp_sessions`، `telegram_sessions`، `leads`.

## ۳. گرفتن کلیدهای اتصال
از منوی چپ → **Project Settings** (چرخ‌دنده) → **API**:

| مقدار در Supabase | متغیر محیطی بک‌اند |
|---|---|
| **Project URL** | `SUPABASE_URL` |
| **Project API keys → `service_role` → Reveal & copy** | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ **حتماً کلید `service_role` را بردارید، نه `anon`.** بک‌اند ما (نه مرورگر) مستقیم با دیتابیس حرف می‌زند و به دسترسی کامل نیاز دارد. این کلید مثل رمز عبور است — **هیچ‌وقت در فرانت‌اند یا گیت قرارش ندهید**، فقط در متغیرهای محیطی سرور.

## ۴. تست محلی با دیتابیس واقعی (اختیاری ولی مفید)
قبل از دیپلوی، می‌توانید همین‌جا روی سیستم خودتان با Supabase واقعی تست کنید:

```bash
cd backend
cp .env.example .env
# در .env این‌ها را پر کنید:
#   SUPABASE_URL=...            (از مرحله ۳)
#   SUPABASE_SERVICE_ROLE_KEY=...(از مرحله ۳)
#   JWT_SECRET=یک-رشته-تصادفی-طولانی
#   CORS_ORIGIN=http://localhost:3000   (آدرس فرانت محلی)
npm install
npm start
```

سپس در ترمینال دیگر، یک حساب واقعی بسازید و توکن بگیرید:
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"یک-رمز-قوی","fullName":"مژگان کیا"}'
```
این یک `token` برمی‌گرداند. با همان توکن، ساخت یک مشتری را تست کنید:
```bash
curl -X POST http://localhost:3000/api/customers \
  -H "Authorization: Bearer <همان-توکن>" \
  -H "Content-Type: application/json" \
  -d '{"name":"آقای رضایی","phone":"0501234567","type":"residential","potential":"high"}'
```
اگر رکورد مشتری برگشت، یعنی کل زنجیره (فرانت→بک‌اند→Supabase) سالم است. حالا فرانت‌اند را هم بالا بیاورید (`cd frontend && npm run dev`) و از طریق داشبورد واقعی تستش کنید.

## ۵. اتصال به Render
همین دو مقدار (`SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY`) را در متغیرهای محیطی سرویس Render وارد کنید — راهنمای کامل در [`DEPLOY_RENDER.md`](./DEPLOY_RENDER.md).

## نکات پلن رایگان Supabase
- **۵۰۰ مگابایت دیتابیس**: اسکیمای ما عمداً سبک طراحی شده (نه متن خام چت، نه مدیا) تا خیلی زیر این حد بماند.
- **توقف بعد از ۱ هفته بی‌فعالیتی**: اگر ۷ روز هیچ درخواستی به دیتابیس نرود، پروژه‌ی رایگان *pause* می‌شود. چون بک‌اد ما هر ۱۰ دقیقه به خودش پینگ می‌زند و نشست‌های واتساپ/تلگرام مرتب می‌نویسند، این اتفاق در عمل نمی‌افتد؛ ولی اگر افتاد، از داشبورد Supabase یک کلیک *Restore* لازم دارد.
- **۲ پروژه‌ی رایگان هم‌زمان**: برای این اپ یک پروژه کافی است.
