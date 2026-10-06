import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import type { HabitSummary, LocalDate } from "@orbit-hub/contracts";
import {
  currentStreak,
  describeSchedule,
  progressForPeriod,
  scheduledDates,
  statusForDate,
  todayIn,
  type HabitEntry,
  type HabitRecord,
  type HabitStatus,
  type ScheduleDescription,
} from "@orbit-hub/habit-core";

import { EmptyState } from "@/components/ui/empty-state";
import { useHeaderAction } from "@/components/ui/header-action";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { toHabitRecord, useHabits } from "@/hooks/use-habits";
import { pluralKey, useTranslation, type Translate } from "@/lib/i18n";
import { useTheme, type Theme } from "@/theme";

/**
 * La lista de habitos: nombre, horario en lenguaje natural, estado de hoy y
 * racha. Sobre el molde de `notes.tsx`: `Screen`, `ListRow`, `EmptyState`,
 * `useHeaderAction` con el boton de anadir e `items` en un `useMemo`.
 *
 * El titulo no se escribe aqui: sale del mapeo de nombres de ruta del layout,
 * como en las demas pantallas fijas. La creacion y el detalle llegan en las
 * tareas siguientes (ver la tabla de rutas del spec), asi que los dos
 * destinos se nombran como texto y no como rutas con tipos.
 */

/** Cuantos puntos ensena la fila de un dia fijo. */
const DOT_COUNT = 7;

/** Ventana para buscar los dias que pintan esos puntos. */
const DOT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

function minusDays(date: LocalDate, delta: number): LocalDate {
  const base = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) - delta * DAY_MS,
  );
  const month = String(base.getUTCMonth() + 1).padStart(2, "0");
  const day = String(base.getUTCDate()).padStart(2, "0");
  return `${base.getUTCFullYear()}-${month}-${day}`;
}

/**
 * El horario con palabras del diccionario, nunca escrito a mano.
 *
 * La rama generica necesita texto de reserva: `weeklyDays` con `days` vacio
 * es el generico de `unknownSchedule` (una regla que el motor no sabe
 * describir) y sin reserva se pintaria como "Los " vacio. Esas reglas solo
 * entran por el campo avanzado de la creacion, asi que la reserva es su
 * nombre (`habits.advanced`): marca el origen sin inventar claves nuevas.
 */
function scheduleText(t: Translate, description: ScheduleDescription): string {
  switch (description.key) {
    case "daily":
      return t("habits.schedule.daily");
    case "weeklyDays": {
      if (description.days.length === 0) return t("habits.advanced");
      const names = description.days
        .map((day) => t(`habits.weekday.${day}`))
        .join(", ");
      return t("habits.schedule.weeklyDays", { days: names });
    }
    case "intervalDays":
      return t("habits.schedule.intervalDays", {
        interval: description.interval,
      });
    case "monthlyOrdinal":
      return t("habits.schedule.monthlyOrdinal", {
        ordinal: String(description.ordinal),
        weekday: t(`habits.weekday.${description.weekday}`),
      });
    case "timesPerPeriod":
      return t(pluralKey("habits.schedule.timesPerPeriod", description.count), {
        count: description.count,
        period: t(`habits.${description.period}`),
      });
  }
}

/**
 * El color del estado de hoy, con acentos que ya existen y sin tokens nuevos:
 * cumplido en emerald, fallado en rose y pendiente de hoy en amber. Lo neutro
 * (omitido o dia sin programa) no compite con ninguno de los tres.
 */
function statusColor(status: HabitStatus, theme: Theme): string {
  switch (status) {
    case "done":
      return theme.colors.success;
    case "missed":
      return theme.colors.danger;
    case "due":
      return theme.colors.warning;
    default:
      return theme.colors.textSubtle;
  }
}

/**
 * Los puntos de un dia fijo: los ultimos dias programados con su estado cada
 * uno. El de hoy es el ultimo, asi que el color de hoy se lee en su sitio.
 */
function recentDots(
  record: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
  theme: Theme,
): string[] {
  const from = minusDays(today, DOT_WINDOW_DAYS);
  const planned = scheduledDates(record.schedule, from, today, record.timezone);
  return planned
    .slice(-DOT_COUNT)
    .map((date) => statusColor(statusForDate(record, date, entries), theme));
}

interface RruleRowModel {
  kind: "rrule";
  id: string;
  name: string;
  subtitle: string;
  statusLabel: string;
  dotColors: string[];
}

interface QuotaRowModel {
  kind: "quota";
  id: string;
  name: string;
  subtitle: string;
  progressLabel: string;
  progressColor: string;
}

type HabitRowModel = RruleRowModel | QuotaRowModel;

/**
 * El modelo de una fila, con los mismos numeros que usan la API y el hook.
 * La racha sale de `currentStreak` y el progreso de la cuota de
 * `progressForPeriod`: si el movil calculara con otra funcion, el movil y el
 * servidor mostrarian numeros distintos sin forma de saber cual tiene razon.
 */
function buildRowModel(
  summary: HabitSummary,
  t: Translate,
  theme: Theme,
): HabitRowModel {
  const record = toHabitRecord(summary.habit);
  const today = todayIn(summary.habit.timezone);
  const streak = currentStreak(record, summary.entries, today);
  const subtitle = `${scheduleText(t, describeSchedule(summary.habit.schedule))} · ${t(
    pluralKey("habits.streak", streak),
    { count: streak },
  )}`;

  // La cuota no tiene estado por dia (`statusForDate` lanza a proposito con
  // cuota): su dato es el contador del periodo en curso, "N de M".
  if (summary.habit.schedule.kind === "quota") {
    const progress = progressForPeriod(
      record,
      summary.habit.schedule.period,
      today,
      summary.entries,
    );
    return {
      kind: "quota",
      id: summary.habit.id,
      name: summary.habit.name,
      subtitle,
      progressLabel: t("habits.quota.progress", {
        done: progress.done,
        target: progress.target,
      }),
      progressColor:
        progress.done >= progress.target
          ? theme.colors.success
          : theme.colors.warning,
    };
  }

  const status = statusForDate(record, today, summary.entries);
  return {
    kind: "rrule",
    id: summary.habit.id,
    name: summary.habit.name,
    subtitle,
    statusLabel: t(`habits.status.${status}`),
    dotColors: recentDots(record, summary.entries, today, theme),
  };
}

/** La tira de puntos de un dia fijo. Solo pinta; el texto va en la fila. */
function DotsStrip({ colors }: { colors: string[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 3 }} accessible={false}>
      {colors.map((color, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

/**
 * La fila de un dia fijo: puntos de los ultimos dias y estado de hoy a la
 * derecha. No puede compartir fila con la cuota porque no es el mismo dato.
 */
function RruleHabitRow({
  model,
  onOpen,
}: {
  model: RruleRowModel;
  onOpen: () => void;
}) {
  return (
    <ListRow
      leading={<DotsStrip colors={model.dotColors} />}
      title={model.name}
      subtitle={model.subtitle}
      rightLabel={model.statusLabel}
      chevron
      onPress={onOpen}
    />
  );
}

/**
 * La fila de una cuota: "N de M" del periodo en curso a la derecha y un punto
 * con su color delante. Sin tira de puntos: una cuota no tiene dias.
 */
function QuotaHabitRow({
  model,
  onOpen,
}: {
  model: QuotaRowModel;
  onOpen: () => void;
}) {
  return (
    <ListRow
      leading={
        <View
          accessible={false}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: model.progressColor,
          }}
        />
      }
      title={model.name}
      subtitle={model.subtitle}
      rightLabel={model.progressLabel}
      chevron
      onPress={onOpen}
    />
  );
}

export default function HabitsListScreen() {
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();

  const { habits, isLoading } = useHabits();

  const headerAction = useCallback(
    () => (
      <Pressable
        testID="habits-create"
        accessibilityRole="button"
        accessibilityLabel={t("habits.add")}
        hitSlop={8}
        // La creacion llega en la tarea siguiente: el destino se nombra como
        // texto, igual que el cajon nombra sus rutas.
        onPress={() => router.push("/(app)/habit/new" as never)}
        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="add" size={26} color={theme.colors.text} />
      </Pressable>
    ),
    [router, t, theme.colors.text],
  );
  useHeaderAction(headerAction, [headerAction]);

  const items = useMemo<HabitRowModel[]>(
    () => habits.map((summary) => buildRowModel(summary, t, theme)),
    [habits, t, theme],
  );

  const openHabit = useCallback(
    (habitId: string) =>
      // El detalle llega en la tarea siguiente: ver el comentario del boton.
      router.push({
        pathname: "/(app)/habit/[habitId]",
        params: { habitId },
      } as never),
    [router],
  );

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen width="reading">
      {items.length === 0 ? (
        <EmptyState
          icon="repeat-outline"
          title={t("habits.title")}
          description={t("habits.empty")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {items.map((item) =>
            item.kind === "rrule" ? (
              <RruleHabitRow
                key={item.id}
                model={item}
                onOpen={() => openHabit(item.id)}
              />
            ) : (
              <QuotaHabitRow
                key={item.id}
                model={item}
                onOpen={() => openHabit(item.id)}
              />
            ),
          )}
        </View>
      )}
    </Screen>
  );
}
