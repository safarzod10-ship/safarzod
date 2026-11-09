import { useMemo, useState } from "react";
import { useApp } from "../AppContext";
import { formatNumber, hours, plural } from "../format";
import { IconSearch } from "../icons";
import { parentOf, type Route } from "../router";
import type { Config } from "../types";
import { withStars } from "../stars";
import { EmptyState, Screen } from "../ui";

interface Row {
  label: string;
  value: string;
}

interface Block {
  id: string;
  title: string;
  head?: [string, string];
  rows: Row[];
}

function stars(value: string | number): string {
  return `${formatNumber(String(value))} ⭐`;
}

function buildBlocks(config: Config): Block[] {
  const holdChannel = config.hold_hours.channel;
  const holdBot = config.hold_hours.bot;
  const threshold = config.referral_threshold;
  const blocks: Block[] = [
    {
      id: "start",
      title: "Как это работает",
      rows: [
        { label: "1. Задание", value: "Открой задание в разделе «Задания» и выполни его: подпишись, запусти бота или отдай буст." },
        { label: "2. Проверка", value: "Вернись в приложение и нажми «Проверить». Проверку выполняет рекламная платформа Flyer." },
        { label: "3. Кейс", value: "За подтверждённое задание на канал или бота выдаётся кейс. Открой его в разделе «Кейсы»." },
        { label: "4. Звёзды", value: "Выпавшие звёзды попадают на баланс. Пока идёт проверка — в «В ожидании», потом в «Доступно»." },
        { label: "5. Подарок", value: `Накопи от ${config.withdraw.min_stars} ⭐ и выведи подарком Telegram в разделе «Вывод».` },
      ],
    },
    {
      id: "tasks",
      title: "Задания",
      head: ["Тип", "Награда и условие"],
      rows: [
        {
          label: "Подписка на канал",
          value: holdChannel > 0 ? `Кейс. Не отписывайся ${hours(holdChannel)} после проверки.` : "Кейс сразу после подтверждения.",
        },
        { label: "Запуск бота", value: holdBot > 0 ? `Кейс. Награда в ожидании ${hours(holdBot)}.` : "Кейс сразу после подтверждения." },
        ...(config.features.boosts
          ? [
              {
                label: "Буст канала",
                value: config.boost.recurring
                  ? `${stars(config.rewards.boost)} за первый период, затем за каждый подтверждённый период: первая проверка через ${hours(config.boost.first_check_hours)}, дальше каждые ${hours(config.boost.interval_hours)}.`
                  : `${stars(config.rewards.boost)} после подтверждения буста.`,
              },
            ]
          : []),
        { label: "Проверка", value: `Не чаще ${config.limits.checks_per_minute} проверок в минуту. Одно задание засчитывается один раз.` },
        { label: "Задание не засчиталось", value: "Убедись, что действие выполнено с этого аккаунта, подожди минуту и нажми «Проверить» ещё раз." },
      ],
    },
    {
      id: "cases",
      title: "Шансы кейса",
      head: ["Награда", "Шанс"],
      rows: [...config.case_prizes]
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .map((row) => ({ label: stars(row.amount), value: `${formatNumber(row.chance)}%` })),
    },
    {
      id: "cases-info",
      title: "Кейсы",
      rows: [
        { label: "Когда выдаётся", value: "За каждое подтверждённое задание на канал или бота и за приглашённых друзей." },
        { label: "Кто решает исход", value: "Сервер в момент открытия. Рулетка показывает уже определённый результат." },
        { label: "Средняя награда", value: stars(config.case_expected) },
        { label: "Повторное открытие", value: "Невозможно: результат кейса сохраняется навсегда." },
      ],
    },
    {
      id: "balance",
      title: "Баланс",
      rows: [
        { label: "Доступно", value: "Звёзды, которые можно вывести прямо сейчас." },
        { label: "В ожидании", value: "Награды за задания, которые ещё проходят проверку или срок удержания." },
        { label: "На выводе", value: "Сумма заявок на вывод, которые ещё обрабатываются." },
        { label: "История", value: "Каждое начисление и списание видно в «Профиль → История операций»." },
      ],
    },
    {
      id: "hold",
      title: "Удержание и отмена",
      rows: [
        { label: "Отписка раньше срока", value: "Награда за это задание отменяется. Других списаний и штрафов нет." },
        { label: "Задание снято платформой", value: "Решение принимает администратор вручную, награда остаётся в ожидании." },
        { label: "Уведомления", value: "О подтверждении и отмене бот пишет в личные сообщения." },
      ],
    },
    {
      id: "withdraw",
      title: "Вывод",
      head: ["Параметр", "Значение"],
      rows: config.features.withdrawals
        ? [
            { label: "Как приходит", value: "Подарком Telegram от бота. Его можно оставить в профиле или обменять на звёзды." },
            { label: "Номиналы", value: config.withdraw.gift_stars.map((value) => `${value} ⭐`).join(", ") },
            { label: "Минимум", value: stars(config.withdraw.min_stars) },
            { label: "Лимит", value: `${config.withdraw.per_day} ${plural(config.withdraw.per_day, "заявка", "заявки", "заявок")} в сутки` },
            { label: "Срок", value: config.withdraw.auto ? "Обычно несколько минут." : "После проверки заявки администратором." },
            { label: "Если не получилось", value: "Звёзды автоматически возвращаются на доступный баланс." },
          ]
        : [{ label: "Статус", value: "Вывод временно недоступен. Звёзды сохраняются на балансе." }],
    },
  ];
  if (config.features.referrals) {
    blocks.push({
      id: "friends",
      title: "Друзья",
      rows: [
        { label: "Награда", value: `Подарочный кейс за каждые ${threshold} подтверждённых кейса приглашённого друга.` },
        { label: "Кто считается", value: "Новый пользователь, который впервые зашёл по твоей ссылке." },
        { label: "Не учитываются", value: "Отменённые и ожидающие задания, подарочные кейсы, приглашение самого себя и подозрительные аккаунты." },
        { label: "Лимит", value: `До ${config.limits.referral_daily_cases} подарочных кейсов в сутки.` },
      ],
    });
  }
  blocks.push({
    id: "forbidden",
    title: "Запрещено",
    rows: [
      { label: "Несколько аккаунтов", value: "Блокировка всех связанных аккаунтов." },
      { label: "Боты и автоматизация", value: "Блокировка аккаунта." },
      { label: "Накрутка приглашений", value: "Реферальные кейсы не выдаются, аккаунт может быть заблокирован." },
    ],
  });
  return blocks;
}

export function RulesScreen({ route }: { route: Route }) {
  const { config } = useApp();
  const blocks = useMemo(() => buildBlocks(config), [config]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? blocks
        .map((block) => ({
          ...block,
          rows: block.title.toLowerCase().includes(needle)
            ? block.rows
            : block.rows.filter((row) => `${row.label} ${row.value}`.toLowerCase().includes(needle)),
        }))
        .filter((block) => block.rows.length > 0)
    : blocks;

  return (
    <Screen title="Правила" back={parentOf(route)}>
      <label className="rules-search">
        <IconSearch size={18} />
        <input
          className="input"
          type="search"
          placeholder="Найти: вывод, отписка, друзья…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          enterKeyHint="search"
        />
      </label>
      {!needle && (
        <nav className="rules-jump" aria-label="Разделы правил">
          {blocks.map((block) => (
            <a key={block.id} href={`#rules-${block.id}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(`rules-${block.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>
              {block.title}
            </a>
          ))}
        </nav>
      )}
      {filtered.length === 0 && <EmptyState title="Ничего не найдено" text="Попробуй другое слово или напиши в поддержку." />}
      {filtered.map((block) => (
        <section key={block.id} id={`rules-${block.id}`} className="rules-block">
          <h2 className="rules-title">{block.title}</h2>
          <table className="rules-table">
            {block.head && (
              <thead>
                <tr>
                  <th>{block.head[0]}</th>
                  <th>{block.head[1]}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{withStars(row.label)}</th>
                  <td>{withStars(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {config.stars_are_internal && (
        <p className="hint rules-foot">Звёзды на балансе — внутренние баллы проекта. Telegram Stars они становятся только при выводе.</p>
      )}
    </Screen>
  );
}
