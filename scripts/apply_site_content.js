/**
 * Applies the "site content" seed to the live Supabase project through PostgREST.
 *
 * Equivalent to backend/scripts/migration_site_content.sql, but runs over HTTPS
 * with the service-role key. Uses `resolution=ignore-duplicates`, i.e.
 * ON CONFLICT (key) DO NOTHING — re-running never overwrites admin edits.
 *
 * Run:  node scripts/apply_site_content.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const read = (key) => {
  const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
};

const URL = read('SUPABASE_URL');
const KEY = read('SUPABASE_SERVICE_KEY');
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const contacts = {
  usa: {
    label: 'Связь в США',
    flag: '🇺🇸',
    phone: '+1 (518) 528-4810',
    phone_raw: '+15185284810',
    note: 'Звонки, сообщения, WhatsApp/Telegram'
  },
  tajikistan: {
    label: 'Связь в Таджикистане (Душанбе)',
    flag: '🇹🇯',
    phones: [
      { display: '+992 929 74 44 99', raw: '+992929744499' },
      { display: '+992 927 78 40 86', raw: '+992927784086' }
    ],
    note: 'Поддержка клиентов, выдача посылок'
  },
  email: 'info@cargo66.com',
  working_hours: 'Пн–Сб, 09:00–19:00'
};

const locations = [
  {
    icon: '🗽',
    name: 'New York Office',
    address: '1729 73rd Street, Brooklyn, NY 11204',
    phone: '+1 (646) 740-7752',
    phone_raw: '+16467407752',
    desc: 'Склад приёма посылок в Бруклине.',
    badge: '',
    highlight: false,
    is_active: true,
    sort_order: 1
  },
  {
    icon: '🏛️',
    name: 'Washington, D.C. & Virginia',
    address: '9411 Lee Hwy Apt G9, Fairfax, VA 22031',
    phone: '+1 (518) 528-4810',
    phone_raw: '+15185284810',
    desc: 'Склад обслуживания клиентов в регионе Вирджиния / Вашингтон.',
    badge: '',
    highlight: false,
    is_active: true,
    sort_order: 2
  },
  {
    icon: '🔔',
    name: 'Philadelphia collection point',
    address: '1811 Rhawn St, Philadelphia, PA 19111',
    phone: '+1 (267) 746-8442',
    phone_raw: '+12677468442',
    desc: 'Пункт приема посылок в Пенсильвании. Весь собранный груз отправляется в Делавэр раз в неделю по четвергам.',
    badge: 'Новый пункт',
    highlight: false,
    is_active: true,
    sort_order: 3
  },
  {
    icon: '🛡️',
    name: 'Delaware Main Warehouse',
    address: '1680 Porter Rd, Suite A-3, Bear, DE 19701',
    phone: '+1 (518) 528-4810',
    phone_raw: '+15185284810',
    desc: 'Безналоговый склад в штате Делавэр. Указывайте именно этот адрес при заказе из любых интернет-магазинов США.',
    badge: 'Обязательный для онлайн-покупок',
    highlight: true,
    is_active: true,
    sort_order: 4
  }
];

const faq = [
  {
    q: 'Как узнать адрес склада в США?',
    a: 'Адреса наших складов приема в США указаны в разделе «Контакты». Для интернет-покупок используйте безналоговый склад в штате Делавэр: 1680 Porter Rd, Suite A-3, Bear, DE 19701, указав свой ID клиента.'
  },
  {
    q: 'Сколько стоит доставка?',
    a: 'Стоимость доставки обычного груза по весу составляет: до 100 кг – $16/кг, от 100 кг – $15/кг, от 1000 кг – $11/кг. Для техники действуют фиксированные тарифы (например, MacBook/ноутбуки/iPhone – $100, iPad – $70, AirPods – $20, часы – $30).'
  },
  {
    q: 'Как долго идёт посылка?',
    a: 'Доставка из США занимает 6-10 рабочих дней, из Германии — 7-14 рабочих дней. Сроки зависят от расписания авиарейсов и скорости таможенного оформления.'
  },
  {
    q: 'Как рассчитывается вес и округление?',
    a: 'Вес до 1 кг округляется до 1 кг (например, 0.4 кг рассчитывается как 1 кг). Если вес составляет 1.0 кг и выше (например, 1.2 кг или 2.8 кг), расчет ведется строго по фактическому весу.'
  },
  {
    q: 'Как отследить посылку?',
    a: 'Вы можете ввести трек-номер на странице отслеживания или отслеживать все свои посылки в личном кабинете после регистрации.'
  },
  {
    q: 'Что нельзя отправлять?',
    a: 'Запрещены оружие, боеприпасы, лекарства без рецепта, опасные жидкости, литиевые аккумуляторы отдельно от приборов, алкоголь и табачные изделия. Полный список смотрите на странице Условий.'
  },
  {
    q: 'Есть ли страхование?',
    a: 'Да, вы можете застраховать вашу посылку. Стоимость страховки составляет 2% от объявленной ценности товара. Это гарантирует возмещение в случае утери груза.'
  }
];

const about = {
  hero_title: 'О компании Cargo Express 66',
  hero_subtitle: 'Надёжный партнёр для международной доставки с 2024 года',
  mission_title: 'Наша миссия',
  mission_text: 'Сделать международные покупки доступными для каждого жителя Таджикистана. Мы упрощаем процесс доставки из США и Германии, обеспечивая надёжность, прозрачность и доступные цены.',
  home_mission_text: 'Сделать международные покупки доступными и простыми для каждого жителя Таджикистана. Мы берем на себя все заботы по логистике, оформлению документов и надежной транспортировке ваших посылок из США и Европы. Вы просто покупаете — мы бережно доставляем.',
  directions_title: 'Наши направления',
  directions: [
    { flag: '🇺🇸', title: 'США → Таджикистан', time: '6-10 рабочих дней' },
    { flag: '🇩🇪', title: 'Германия → Таджикистан', time: '7-14 рабочих дней' }
  ],
  stats_title: 'Наши показатели',
  stats: [
    { value: '10K+', label: 'Клиентов' },
    { value: '50K+', label: 'Посылок' },
    { value: '99.5%', label: 'Надёжность' },
    { value: '2 года', label: 'Опыта' }
  ],
  advantages_title: 'Наши преимущества',
  advantages: ['Фото посылки на складе', 'Страхование грузов', 'Личный кабинет 24/7', 'Оплата при получении'],
  reliability_title: 'Надежность и гарантии',
  reliability_text: 'Мы гарантируем 100% сохранность ваших посылок. Каждое отправление отслеживается на всех этапах пути: от прибытия на наш склад в США или Европе до момента выдачи в Таджикистане. Все грузы застрахованы, а наша служба поддержки всегда готова ответить на любые вопросы.',
  warehouses_title: 'Наши склады приема',
  warehouses: ['Нью-Йорк, США', 'Делавэр, США', 'Мюнхен, Германия', 'Мадрид, Испания']
};

const footer = {
  description: 'Международная доставка посылок из США, Германии, Испании и Италии в Таджикистан. Быстро, надёжно и по выгодным ценам.',
  copyright: '© 2024 Cargo Express 66. All rights reserved.',
  tagline: 'Tajikistan · USA · Germany'
};

const rows = [
  { key: 'site_contacts', value: JSON.stringify(contacts), description: 'Контакты сайта: телефоны США и Таджикистана, e-mail' },
  { key: 'site_locations', value: JSON.stringify(locations), description: 'Адреса складов и пунктов приёма (страница «Контакты»)' },
  { key: 'site_faq', value: JSON.stringify(faq), description: 'Часто задаваемые вопросы (FAQ)' },
  { key: 'site_about', value: JSON.stringify(about), description: 'Тексты и показатели страницы «О нас»' },
  { key: 'site_footer', value: JSON.stringify(footer), description: 'Подвал сайта: описание, копирайт, подпись' }
];

(async () => {
  // Which keys already exist? (to report exactly what was inserted vs. skipped)
  const before = await fetch(`${URL}/rest/v1/settings?select=key`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  const existing = new Set((await before.json()).map((r) => r.key));
  console.log('Existing settings keys:', [...existing].join(', ') || '(none)');

  const res = await fetch(`${URL}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    console.error('INSERT failed:', res.status, (await res.text()).slice(0, 800));
    process.exit(1);
  }

  const inserted = await res.json();
  console.log(`\nInserted: ${inserted.length} of ${rows.length}`);
  for (const row of rows) {
    const state = existing.has(row.key) ? 'SKIPPED (already existed)' : 'INSERTED';
    console.log(`  ${row.key.padEnd(16)} ${state}`);
  }

  // Verify
  const verify = await fetch(`${URL}/rest/v1/settings?select=key,value&key=like.site_*`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  const data = await verify.json();
  console.log(`\nVerification — site_* keys now present: ${data.length}`);
  for (const row of data) {
    let parsed = null;
    try { parsed = JSON.parse(row.value); } catch { /* keep null */ }
    const shape = Array.isArray(parsed) ? `array(${parsed.length})` : parsed ? `object(${Object.keys(parsed).length} keys)` : 'plain';
    console.log(`  ${row.key.padEnd(16)} ${String(row.value).length} bytes  ${shape}`);
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
