const listEl = document.getElementById('list');
const countsEl = document.getElementById('counts');
const statusEl = document.getElementById('status');
const footEl = document.getElementById('foot');
const tabsEl = document.getElementById('tabs');
const themeEl = document.getElementById('theme');

/* ── الثيم: تلقائي ← فاتح ← داكن ─────────────────────────────── */
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '🖥️ تلقائي', light: '☀️ فاتح', dark: '🌙 داكن' };

const readTheme = () => {
  try {
    return THEMES.includes(localStorage.getItem('theme'))
      ? localStorage.getItem('theme')
      : 'auto';
  } catch {
    return 'auto';
  }
};

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeEl.textContent = THEME_LABEL[theme];
  try {
    localStorage.setItem('theme', theme);
  } catch {}
}

themeEl.addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
  applyTheme(next);
});

applyTheme(readTheme());

let filter = 'open';
let groupFilter = 'all';

const PRIORITY = {
  urgent: 'عاجل',
  high: 'مهم',
  normal: 'عادي',
};

const STATUS_TEXT = {
  connected: ['ok', 'متصل بواتساب'],
  'waiting-qr': ['bad', 'بانتظار مسح QR في الطرفية'],
  reconnecting: ['bad', 'يعيد الاتصال…'],
  'logged-out': ['bad', 'تم تسجيل الخروج'],
  starting: ['', 'جارٍ الاتصال…'],
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const todayISO = () => new Date().toLocaleDateString('en-CA');

/** وقت الإرسال كاملًا: اليوم والتاريخ والساعة. */
function fullTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('ar', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function relativeTime(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `قبل ${hrs} س`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'أمس' : `قبل ${days} يوم`;
}

/** نموذج تعديل داخل البطاقة، مملوء بقيم المهمة الحالية. */
function editForm(t) {
  const opt = (v, label) =>
    `<option value="${v}" ${t.priority === v ? 'selected' : ''}>${label}</option>`;
  return `
    <form class="edit-form" data-edit="${t.id}">
      <input name="title" type="text" required maxlength="200" value="${esc(t.title)}" />
      <textarea name="details" rows="2" maxlength="1000"
        placeholder="تفاصيل وروابط (كل رابط في سطر)">${esc(t.details ?? '')}</textarea>
      <div class="add-row">
        <label><span>الموعد</span>
          <input name="due_date" type="date" value="${esc(t.due_date ?? '')}" /></label>
        <label><span>الأولوية</span>
          <select name="priority">
            ${opt('normal', 'عادي')}${opt('high', 'مهم')}${opt('urgent', 'عاجل')}
          </select></label>
        <div class="add-actions">
          <button type="button" class="btn" data-act="cancel-edit">إلغاء</button>
          <button type="submit" class="btn solid">حفظ</button>
        </div>
      </div>
    </form>`;
}

/** يحوّل الروابط في الوصف إلى وصلات قابلة للنقر — بعد الهروب دائمًا. */
function linkify(text) {
  return esc(text).replace(
    /https?:\/\/[^\s<]+/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
  );
}

function card(t) {
  const overdue = t.due_date && t.due_date < todayISO() && t.status === 'open';
  const dueLabel = t.due_date || t.due_text;

  const chips = [
    t.source === 'manual'
      ? '<span class="chip manual">✎ يدوية</span>'
      : t.requester && `<span class="chip">من: ${esc(t.requester)}</span>`,
    dueLabel &&
      `<span class="chip due ${overdue ? 'overdue' : ''}">⏳ ${esc(dueLabel)}${overdue ? ' — متأخرة' : ''}</span>`,
    `<span class="chip">${PRIORITY[t.priority] ?? t.priority}</span>`,
    t.chat_name && `<span class="chip">${esc(t.chat_name)}</span>`,
    t.source_ts && `<span class="chip">${relativeTime(t.source_ts)}</span>`,
    t.confidence < 0.75 &&
      `<span class="chip conf">ثقة ${Math.round(t.confidence * 100)}٪ — راجعها</span>`,
  ].filter(Boolean);

  return `
    <article class="card ${t.status === 'done' ? 'is-done' : ''}" data-priority="${esc(t.priority)}" data-id="${t.id}">
      <div class="row">
        <h2 class="title">${esc(t.title)}</h2>
        <div class="actions">
          <button class="btn primary" data-act="toggle">${t.status === 'open' ? '✓ تم' : '↺ رجّعها'}</button>
          <button class="btn" data-act="edit">✎ تعديل</button>
          <button class="btn danger" data-act="delete">حذف</button>
        </div>
      </div>
      ${editForm(t)}
      ${t.details ? `<p class="details">${linkify(t.details)}</p>` : ''}
      <div class="meta">${chips.join('')}</div>
      ${
        t.source_text
          ? `<details class="src">
               <summary>الرسالة الأصلية</summary>
               <div class="src-head">
                 <span class="src-who">${esc(t.requester || 'مجهول')}</span>
                 <span class="src-when">${esc(fullTime(t.source_ts))}</span>
               </div>
               <blockquote>${esc(t.source_text)}</blockquote>
             </details>`
          : ''
      }
    </article>`;
}

/** سكشن المهام الدورية — يظهر فقط عند وجود مهام فيه. */
function renderRecurring(tasks) {
  const section = document.getElementById('recurring');
  section.hidden = tasks.length === 0;
  if (!tasks.length) return;

  // الأقرب موعدًا أولًا
  const sorted = [...tasks].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  document.getElementById('recurringList').innerHTML = sorted.map(card).join('');
}

/** شرائح تصفية حسب القروب — تظهر فقط عند وجود أكثر من قروب. */
function renderGroupFilter(tasks) {
  const el = document.getElementById('groups');
  const names = [...new Set(tasks.map((t) => t.chat_name).filter(Boolean))].sort();

  if (names.length < 2) {
    el.hidden = true;
    groupFilter = 'all';
    return;
  }
  el.hidden = false;

  const counts = Object.fromEntries(
    names.map((n) => [n, tasks.filter((t) => t.chat_name === n).length]),
  );
  // لو اختفى القروب المحدد من النتائج، نرجع للكل
  if (groupFilter !== 'all' && !names.includes(groupFilter)) groupFilter = 'all';

  el.innerHTML =
    `<button class="gchip ${groupFilter === 'all' ? 'is-active' : ''}" data-group="all">الكل (${tasks.length})</button>` +
    names
      .map(
        (n) =>
          `<button class="gchip ${groupFilter === n ? 'is-active' : ''}" data-group="${esc(n)}">${esc(n)} (${counts[n]})</button>`,
      )
      .join('');
}

async function refresh() {
  try {
    const [tasksRes, statusRes] = await Promise.all([
      fetch(`/api/tasks?status=${filter}`).then((r) => r.json()),
      fetch('/api/status').then((r) => r.json()),
    ]);

    const { tasks, counts } = tasksRes;

    // المهام الدورية لها سكشن خاص — جدول ثابت لا وارد من القروب
    const recurring = tasks.filter((t) => t.source === 'recurring');
    const incoming = tasks.filter((t) => t.source !== 'recurring');
    renderRecurring(recurring);

    renderGroupFilter(incoming);
    const shown = groupFilter === 'all'
      ? incoming
      : incoming.filter((t) => (t.chat_name || 'بلا قروب') === groupFilter);

    listEl.innerHTML = shown.length
      ? shown.map(card).join('')
      : `<div class="empty"><p>${
          filter === 'open' ? 'ما فيه مهام مفتوحة 🎉' : 'لا يوجد شيء هنا'
        }</p></div>`;

    countsEl.innerHTML = `
      <span><b>${counts.open ?? 0}</b> مفتوحة</span>
      <span><b>${counts.urgent ?? 0}</b> عاجلة</span>
      <span><b>${counts.done ?? 0}</b> منجزة</span>`;

    const [cls, text] = STATUS_TEXT[statusRes.whatsapp] ?? ['', statusRes.whatsapp];
    statusEl.className = `status ${cls}`;
    statusEl.innerHTML = `<i></i><span>${esc(text)}</span>`;

    const s = statusRes.stats;
    // عدّاد التوكن بلا معنى في وضع القواعد — ما نعرضه إلا عند التصنيف الذكي
    const cost =
      statusRes.mode === 'rules'
        ? ''
        : ` · ${s.inputTokens.toLocaleString('ar')} توكن دخل (${s.cachedTokens.toLocaleString('ar')} من الكاش)`;
    footEl.textContent =
      `${statusRes.model} · ${s.batches} دفعة · ${s.tasks} مهمة مستخرجة${cost}` +
      (statusRes.pending ? ` · ${statusRes.pending} رسالة بالطابور` : '');
  } catch {
    statusEl.className = 'status bad';
    statusEl.innerHTML = '<i></i><span>الخادم غير متاح</span>';
  }
}

/* ── سبرنكلز الإنجاز ─────────────────────────────────────────── */
const SPRINKLE_COLORS = [
  '#1f6f5c', '#4fbf9f', '#c9760f', '#e8a33d',
  '#2f6fb0', '#6aa9e0', '#c2372c', '#ef6a5c',
];

/** رشّة ألوان تنفجر من زر "تم" احتفاءً بإنجاز المهمة. */
function sprinkles(x, y) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layer = document.createElement('div');
  layer.className = 'sprinkles';
  document.body.appendChild(layer);

  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    p.style.background = SPRINKLE_COLORS[i % SPRINKLE_COLORS.length];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    if (i % 3 === 0) p.style.borderRadius = '50%'; // خليط بين حبات ودوائر
    layer.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 130;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 50; // ميل للأعلى قبل السقوط

    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${dy}px) rotate(${Math.random() * 360}deg) scale(1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy + 190}px) rotate(${Math.random() * 720 - 360}deg) scale(0.6)`, opacity: 0 },
      ],
      {
        duration: 850 + Math.random() * 550,
        easing: 'cubic-bezier(.18,.7,.35,1)',
        fill: 'forwards',
      },
    );
  }

  setTimeout(() => layer.remove(), 1600);
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;

  const cardEl = btn.closest('.card');
  const id = cardEl.dataset.id;
  const act = btn.dataset.act;

  if (act === 'edit') {
    cardEl.classList.add('is-editing');
    cardEl.querySelector('.edit-form input[name="title"]').focus();
    return;
  }

  if (act === 'cancel-edit') {
    cardEl.classList.remove('is-editing');
    return;
  }

  if (act === 'delete') {
    if (!confirm('تحذف هذه المهمة نهائيًا؟')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  } else {
    const now = cardEl.classList.contains('is-done') ? 'open' : 'done';
    if (now === 'done') {
      const r = btn.getBoundingClientRect();
      sprinkles(r.left + r.width / 2, r.top + r.height / 2);
    }
    await fetch(`/api/tasks/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: now }),
    });
  }
  refresh();
});

/* ── إضافة مهمة يدويًا ───────────────────────────────────────── */
const addToggle = document.getElementById('addToggle');
const addForm = document.getElementById('addForm');
const addCancel = document.getElementById('addCancel');
const addError = document.getElementById('addError');
const titleInput = document.getElementById('f-title');

function openAddForm(open) {
  addForm.hidden = !open;
  addToggle.setAttribute('aria-expanded', String(open));
  addToggle.setAttribute('aria-label', open ? 'إغلاق' : 'أضف مهمة يدوية');
  addToggle.title = open ? 'إغلاق' : 'أضف مهمة يدوية';
  addError.hidden = true;
  if (open) titleInput.focus();
  else addForm.reset();
}

addToggle.addEventListener('click', () => openAddForm(addForm.hidden));
addCancel.addEventListener('click', () => openAddForm(false));

addForm.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openAddForm(false);
  // Cmd/Ctrl+Enter يرسل من أي حقل، بما فيها مربع التفاصيل
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addForm.requestSubmit();
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: titleInput.value,
    details: document.getElementById('f-details').value,
    due_date: document.getElementById('f-due').value,
    priority: document.getElementById('f-priority').value,
  };

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      addError.textContent = error || 'تعذّرت الإضافة';
      addError.hidden = false;
      return;
    }
    openAddForm(false);
    if (filter === 'done') {
      // المهمة الجديدة مفتوحة — ننقل العرض لها حتى تظهر مباشرة
      filter = 'open';
      for (const t of tabsEl.children)
        t.classList.toggle('is-active', t.dataset.status === 'open');
    }
    refresh();
  } catch {
    addError.textContent = 'الخادم غير متاح';
    addError.hidden = false;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-edit]');
  if (!form) return;
  e.preventDefault();

  const data = Object.fromEntries(new FormData(form));
  const res = await fetch(`/api/tasks/${form.dataset.edit}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    alert(error || 'تعذّر الحفظ');
    return;
  }
  refresh();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest('[data-edit]')) {
    e.target.closest('.card').classList.remove('is-editing');
  }
});

document.getElementById('groups').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-group]');
  if (!chip) return;
  groupFilter = chip.dataset.group;
  refresh();
});

tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  filter = tab.dataset.status;
  for (const t of tabsEl.children) t.classList.toggle('is-active', t === tab);
  refresh();
});

refresh();
setInterval(refresh, 15000);
