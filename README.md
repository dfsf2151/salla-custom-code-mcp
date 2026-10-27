# salla-custom-code-mcp

خادم MCP محلي صغير يضيف أدوات **CSS و JavaScript المخصص** لمتجر سلة، أي ما تجده في محرر الثيم ← التخصيص المتقدم. هذه الأدوات غير موجودة في MCP سلة الرسمي (`mcp.salla.dev`).

> A tiny local MCP server that adds custom CSS / JS tools for a Salla store (theme editor → Advanced customization), which Salla's hosted MCP does not expose.

## الأدوات

| الأداة | الوظيفة |
|---|---|
| `custom_css_get` | قراءة الـ CSS المخصص |
| `custom_css_update` | استبدال الـ CSS كاملاً (مع نسخة احتياطية قبل الحفظ، وتحقق بعده) |
| `custom_js_get` | قراءة الـ JavaScript المخصص |
| `custom_js_update` | استبدال الـ JavaScript كاملاً (مع نسخة احتياطية وتحقق) |
| `custom_js_toggle` | تشغيل الـ JavaScript المخصص أو إيقافه |

## طريقة العمل

- ليس في API سلة العام endpoint للكود المخصص. لذلك يستدعي الخادم نفس الـ endpoints التي تستخدمها لوحة التاجر:
  - `api.salla.dev/admin/v2/design/custom/css`
  - `api.salla.dev/admin/v2/design/custom/js`
  - `api.salla.dev/admin/v2/design/custom/js/toggle`
- الطلبات تُرسَل **من داخل** تبويب `s.salla.sa` مسجّل الدخول في ملف Chromium مخصص، عن طريق Chrome DevTools Protocol. رمز الدخول لا يخرج من المتصفح ولا يُحفظ في أي ملف.
- إذا لم يكن المتصفح يعمل، يفتحه الخادم تلقائياً.
- **حماية من الخطأ:** إذا كان الحساب المسجّل لمتجر غير `SALLA_STORE_ID`، يرفض الخادم الطلب ولا يغيّر شيئاً.
- قبل كل حفظ تُنسخ النسخة السابقة إلى `~/.config/salla-custom-code/backups/<profile>/`.

> ⚠️ هذه endpoints داخلية وغير موثّقة، وقد تغيّرها سلة في أي وقت. الحفظ يظهر **مباشرة** في المتجر إذا كانت النسخة منشورة.

## المتطلبات

- Node.js 22 أو أحدث (يحتاج `fetch` و `WebSocket` المدمجين).
- Chromium أو Chrome. الافتراضي هو Chromium الخاص بـ Playwright في `~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`، ويمكن تغييره بـ `SALLA_CHROME`.

## التثبيت

```bash
git clone https://github.com/dfsf2151/salla-custom-code-mcp.git
cd salla-custom-code-mcp
npm install
```

سجّله في Claude Code:

```bash
claude mcp add salla-mystore-code -s user \
  -e SALLA_STORE_ID=<رقم المتجر> \
  -e SALLA_VERSION_ID=<رقم نسخة الثيم> \
  -e SALLA_PROFILE=mystore \
  -- node /path/to/salla-custom-code-mcp/server.mjs
```

- **رقم المتجر:** تجده في `store_context_get` من MCP سلة الرسمي.
- **رقم نسخة الثيم:** تجده في `theme_versions_list`، وهو النسخة التي عليها `is_default`.

### تسجيل الدخول أول مرة

1. عند أول استدعاء لأي أداة، يفتح الخادم نافذة Chromium (ملفها `~/.config/salla-custom-code/profile-<SALLA_PROFILE>`).
2. سجّل الدخول فيها إلى لوحة سلة بحساب المتجر.
3. اترك النافذة مفتوحة.

جلسة اللوحة تنتهي بعد أسبوعين تقريباً. عندها سجّل الدخول مرة أخرى في نفس النافذة.

## متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `SALLA_STORE_ID` | — | رقم المتجر المسموح به (حماية) |
| `SALLA_VERSION_ID` | — | نسخة الثيم الافتراضية |
| `SALLA_PROFILE` | `default` | اسم ملف المتصفح والنسخ الاحتياطية، مفيد لأكثر من متجر |
| `SALLA_CDP_PORT` | `9333` | منفذ DevTools. استخدم منفذاً مختلفاً لكل متجر |
| `SALLA_CHROME` | Chromium الخاص بـ Playwright | مسار المتصفح |

## سكربتات الاختبار

```bash
# قراءة فقط
SALLA_STORE_ID=... SALLA_VERSION_ID=... node scripts/smoke.mjs

# اختبار الحفظ بدون تغيير: يقرأ الـ CSS ويحفظه كما هو
SALLA_STORE_ID=... SALLA_VERSION_ID=... node scripts/noop-save.mjs
```

`scripts/cdp.mjs` أداة تصحيح لمراقبة طلبات اللوحة: `navigate URL` أو `eval JS` أو `watch SECONDS`.
