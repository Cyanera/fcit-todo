import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config, today, todayName } from './config.js';

const client = new Anthropic({ apiKey: config.anthropicKey });

const TaskSchema = z.object({
  message_index: z
    .number()
    .int()
    .describe('رقم الرسالة في القائمة المرقّمة التي نشأت منها هذه المهمة'),
  title: z.string().describe('عنوان المهمة بصيغة أمر مختصر، أقل من 70 حرفًا'),
  details: z.string().describe('تفاصيل إضافية مهمة للتنفيذ، أو "" إن لم توجد'),
  requester: z.string().describe('اسم من طلب المهمة كما ظهر في المحادثة'),
  due_date: z
    .string()
    .describe('الموعد النهائي بصيغة YYYY-MM-DD، أو "" إذا لم يُذكر موعد محدد'),
  due_text: z
    .string()
    .describe('نص الموعد كما ورد حرفيًا مثل "قبل الأحد"، أو ""'),
  priority: z.enum(['urgent', 'high', 'normal']),
  confidence: z
    .number()
    .describe('من 0 إلى 1: مدى ثقتك أن هذه مهمة موجّهة للمستخدم تحديدًا'),
});

const ResultSchema = z.object({ tasks: z.array(TaskSchema) });

const SYSTEM = `أنت مساعد يراقب قروب واتساب ويستخرج **المهام الموجّهة لمستخدم واحد محدد**.

المستخدم يُنادى في القروب بأحد هذه الأسماء:
${config.myNames.map((n) => `- ${n}`).join('\n') || '- (لم تُضبط أسماء — اعتمد على المنشن بالرقم فقط)'}

مهمتك: تقرأ الرسائل الجديدة وتُخرج فقط المهام التي **على هذا المستخدم تنفيذها**.

## ما يُعتبر مهمة
- طلب مباشر موجّه له بالاسم أو بالمنشن.
- طلب موجّه للمجموعة لكنه يقع ضمن مسؤوليته المعروفة من سياق المحادثة.
- تذكير بموعد تسليم أو التزام عليه.
- سؤال موجّه له يحتاج ردًا أو إجراءً لاحقًا، وليس ردًا فوريًا بكلمة.

## ما **لا** يُعتبر مهمة — لا تُخرجه إطلاقًا
- مهام موجّهة لشخص آخر بالاسم.
- إعلانات عامة ومعلومات للعلم فقط بلا إجراء مطلوب منه.
- ردود مجاملة وشكر وتحيات وضحك وإيموجي.
- نقاش أو أخذ ورد لم يُفضِ لطلب واضح.
- مهمة سبق أن أكّد المستخدم نفسه في المحادثة أنه أنجزها.
- رسالة يرد فيها المستخدم نفسه (هو المُرسِل) ما لم يلزم نفسه صراحة بشيء.

## الأولوية
- \`urgent\`: الموعد اليوم أو غدًا، أو استُخدمت صيغة استعجال صريحة (ضروري، عاجل، اليوم، الحين).
- \`high\`: موعد خلال الأسبوع، أو طلب من جهة إشرافية.
- \`normal\`: ما عدا ذلك.

## الثقة
- \`0.9+\`: منشن صريح أو نداء بالاسم مع طلب واضح.
- \`0.7\`: الطلب يخصه بوضوح من السياق دون نداء مباشر.
- \`0.5\`: محتمل، يحتاج مراجعة منه.
- \`< 0.5\`: لا تُخرج المهمة أصلًا.

## قواعد الإخراج
- المهمة الواحدة تظهر مرة واحدة فقط، حتى لو تكرر ذكرها في عدة رسائل — اربطها بأول رسالة طلبتها.
- لا تُخرج مهمة موجودة أصلًا في قائمة "المهام المفتوحة حاليًا".
- \`title\` بصيغة أمر مختصرة: "جهّز أسئلة الاختبار النهائي" لا "طلب منك تجهيز الأسئلة".
- احسب \`due_date\` من التاريخ المعطى لك، وحوّل العبارات النسبية ("بكرة"، "الأحد الجاي") إلى تاريخ فعلي.
- إذا لم توجد أي مهمة في الدفعة، أخرج \`{"tasks": []}\` — وهذه هي الحالة الطبيعية لأغلب الدفعات.

السياق قد يكون بالعامية الخليجية — تعامل معها بشكل طبيعي.`;

/** يبني نص المحادثة المرقّم الذي يُعرض على النموذج. */
function buildPrompt({ messages, context, openTasks }) {
  const parts = [];
  parts.push(`التاريخ اليوم: ${today()} (${todayName()})`);

  if (openTasks?.length) {
    parts.push(
      `\n## المهام المفتوحة حاليًا (لا تُكررها)\n` +
        openTasks.map((t) => `- ${t}`).join('\n'),
    );
  }

  if (context?.length) {
    parts.push(
      `\n## سياق سابق (معالَج مسبقًا — للفهم فقط، لا تستخرج منه مهامًا)\n` +
        context.map((m) => `${m.sender_name}: ${m.body}`).join('\n'),
    );
  }

  parts.push(
    `\n## الرسائل الجديدة (استخرج المهام من هذه فقط)\n` +
      messages
        .map((m, i) => `[${i}] ${m.sender_name}${m.fromMe ? ' (المستخدم نفسه)' : ''}: ${m.body}`)
        .join('\n'),
  );

  return parts.join('\n');
}

const isHaiku = () => /haiku/i.test(config.model);
const supportsFallbacks = () => /opus-5|fable/i.test(config.model);

/**
 * يصنّف دفعة رسائل ويرجّع المهام المستخرجة.
 * يرمي عند فشل الشبكة أو المفتاح — المستدعي يقرر إعادة المحاولة.
 */
export async function classifyBatch({ messages, context = [], openTasks = [] }) {
  if (!messages.length) return { tasks: [], usage: null };

  const params = {
    model: config.model,
    max_tokens: 4000,
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: buildPrompt({ messages, context, openTasks }) },
    ],
    output_config: {
      format: zodOutputFormat(ResultSchema, 'extracted_tasks'),
      ...(isHaiku() ? {} : { effort: config.effort }),
    },
  };

  if (supportsFallbacks()) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  const response = await client.beta.messages.parse(params);

  // التصنيفات قد ترفض الطلب (HTTP 200 مع stop_reason = refusal) — نتخطى الدفعة.
  if (response.stop_reason === 'refusal') {
    return {
      tasks: [],
      usage: response.usage,
      refused: response.stop_details?.category ?? true,
    };
  }

  const parsed = response.parsed_output;
  if (!parsed) return { tasks: [], usage: response.usage, parseFailed: true };

  const tasks = parsed.tasks.filter(
    (t) =>
      t.confidence >= config.minConfidence &&
      t.message_index >= 0 &&
      t.message_index < messages.length &&
      t.title.trim(),
  );

  return { tasks, usage: response.usage };
}
