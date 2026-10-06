import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { LocalDate } from "@orbit-hub/contracts";
import { localDateSchema } from "@orbit-hub/contracts";
import {
  currentStreak,
  describeSchedule,
  longestStreak,
  periodBounds,
  progressForPeriod,
  scheduledDates,
  statusForDate,
  todayIn,
  type HabitStatus,
  type ScheduleDescription,
} from "@orbit-hub/habit-core";

import { AppText } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { TextField } from "@/components/ui/text-field";
import { toHabitRecord, useHabit } from "@/hooks/use-habits";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { pluralKey, useTranslation, type Translate } from "@/lib/i18n";
import { useTheme, type Theme } from "@/theme";

/**
 * El detalle de un habito: rejilla de dias para `rrule`, contador para
 * `quota`, racha y mas larga, edicion del fin, archivar y borrar.
 *
 * Sobre el molde de `list/[listId].tsx` (`Screen` sin scroll con `FlatList`
 * dentro, titulo desde los datos). La mitad de arriba son tarjetas y la de
 * abajo los dias del periodo en curso, asi que la cabecera de la lista es la
 * tarjeta y no un encabezado aparte.
 *
 * Sin seccion de avisos a proposito: estan apagados en FEATURES y un boton
 * muerto es peor que nada.
 */

type DetailPeriod = "week" | "month" | "year";

const PERIOD_ORDER: DetailPeriod[] = ["week", "month", "year"];

/**
 * El horario con palabras del diccionario, nunca escrito a mano.
 *
 * La misma funcion que en `habits.tsx` y `habit/new.tsx`: el motor da la
 * clave y el diccionario el texto, con la misma reserva generica
 * (`habits.advanced`) para la regla que el motor no sabe describir.
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
    case "monthlyOrdinal": {
      const weekday = t(`habits.weekday.${description.weekday}`);
      if (description.ordinal === -1) {
        return t("habits.schedule.monthlyLast", { weekday });
      }
      if (description.ordinal < 0) return t("habits.advanced");
      return t("habits.schedule.monthlyOrdinal", {
        ordinal: String(description.ordinal),
        weekday,
      });
    }
    case "timesPerPeriod":
      return t(pluralKey("habits.schedule.timesPerPeriod", description.count), {
        count: description.count,
        period: t(`habits.${description.period}`),
      });
  }
}

/**
 * El color del estado de un dia, con los mismos acentos que la lista y sin
 * tokens nuevos: cumplido en emerald, fallado en rose, pendiente en amber.
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

const DAY_MS = 86_400_000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function addDays(date: LocalDate, delta: number): LocalDate {
  const base = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) + delta * DAY_MS,
  );
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}` as LocalDate;
}

/** Ultimo dia del mes, con `month` en base 1. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Mueve el ancla N periodos desde `date`. La semana en pasos de 7 dias; el
 * mes y el ano por componentes, con el dia recortado al mes destino: 31 de
 * enero menos un mes es 28 de febrero, no 3 de marzo.
 */
function shiftAnchor(
  date: LocalDate,
  period: DetailPeriod,
  delta: number,
): LocalDate {
  if (period === "week") return addDays(date, delta * 7);
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (period === "month") {
    month += delta;
    year += Math.floor((month - 1) / 12);
    month = ((((month - 1) % 12) + 12) % 12) + 1;
  } else {
    year += delta;
  }
  const clamped = Math.min(day, lastDayOfMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(clamped)}` as LocalDate;
}

export default function HabitDetailScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { habitId } = useLocalSearchParams<{ habitId: string }>();
  const {
    habit,
    entries,
    isLoading,
    checkIn,
    skip,
    clear,
    update,
    archive,
    unarchive,
    remove,
  } = useHabit(habitId ?? null);
  const [period, setPeriod] = useState<DetailPeriod>("week");
  // Periodos hacia atras desde el actual: 0 es el periodo en curso, -1 el
  // anterior. Solo hacia atras: mas alla del actual no hay nada que mirar.
  const [anchorOffset, setAnchorOffset] = useState(0);
  // Texto del campo de fin, sin comprometer hasta guardar: null es "lo que
  // hay guardado" y el guardar vuelve a null para reengancharse.
  const [endText, setEndText] = useState<string | null>(null);
  const [savingEnd, setSavingEnd] = useState(false);

  // El titulo sale de los datos, como en list/[listId] y note/[noteId]: el
  // layout pone el vacio y esta pantalla lo llena.
  useScreenTitle(habit?.name ?? t("habits.title"));

  const record = useMemo(
    () => (habit ? toHabitRecord(habit) : null),
    [habit],
  );
  const today = useMemo(
    () => (habit ? todayIn(habit.timezone) : null),
    [habit],
  );

  /**
   * El dia que ancla lo mostrado: hoy desplazado N periodos. Cambiar de
   * periodo (semana/mes/ano) repone el desplazamiento a cero, porque un -2
   * de meses no significa nada despues de venir de semanas.
   */
  const anchor = useMemo(
    () => (today ? shiftAnchor(today, period, anchorOffset) : null),
    [today, period, anchorOffset],
  );

  /** Si el ancla sigue en el periodo en curso: entonces no hay siguiente. */
  const atPresent = useMemo(() => {
    if (!habit || !today || !anchor) return true;
    const current = periodBounds(period, anchor, habit.weekStart, habit.timezone);
    return current.start <= today && today <= current.end;
  }, [habit, today, anchor, period]);

  /**
   * Los dias que pintan filas: solo los programados del periodo del ancla,
   * recortados al rango activo del habito. Un dia que no toca no tiene fila
   * y por tanto no se puede pulsar: ni feedback, ni haptic, ni nada.
   */
  const days = useMemo<LocalDate[]>(() => {
    if (!habit || !anchor) return [];
    if (habit.schedule.kind !== "rrule") return [];
    const bounds = periodBounds(period, anchor, habit.weekStart, habit.timezone);
    const from = bounds.start < habit.startDate ? habit.startDate : bounds.start;
    const to =
      habit.endDate === null || habit.endDate > bounds.end
        ? bounds.end
        : habit.endDate;
    if (from > to) return [];
    return scheduledDates(habit.schedule, from, to, habit.timezone);
  }, [habit, anchor, period]);

  const streak = useMemo(
    () => (record && today ? currentStreak(record, entries, today) : 0),
    [record, entries, today],
  );
  const longest = useMemo(
    () => (record && today ? longestStreak(record, entries, today) : 0),
    [record, entries, today],
  );

  const quotaProgress = useMemo(() => {
    if (!record || !today) return null;
    if (record.schedule.kind !== "quota") return null;
    return progressForPeriod(record, record.schedule.period, today, entries);
  }, [record, entries, today]);

  const endShown = endText ?? habit?.endDate ?? "";
  const endParsed = useMemo<LocalDate | null>(() => {
    const text = endShown.trim();
    if (text.length === 0) return null;
    const parsed = localDateSchema.safeParse(text);
    if (!parsed.success) return null;
    return parsed.data;
  }, [endShown]);
  const endValid =
    endShown.trim().length === 0 ||
    (endParsed !== null && habit !== null && endParsed >= habit.startDate);

  const saveEnd = async (): Promise<void> => {
    if (!endValid || savingEnd) return;
    setSavingEnd(true);
    try {
      // El fin va al campo `endDate`: con regla `rrule` el `update`
      // renormaliza el UNTIL con el fin vigente, porque el campo manda.
      const result = await update({
        endDate: endShown.trim().length === 0 ? null : endParsed,
      });
      if (result.ok) setEndText(null);
    } finally {
      setSavingEnd(false);
    }
  };

  const toggleDay = (date: LocalDate, status: HabitStatus): void => {
    // Hecho se desmarca; pendiente o fallado se marca. Saltar va por
    // pulsacion larga, para que el gesto barato sea el del caso comun.
    if (status === "done") {
      void clear(date);
      return;
    }
    void checkIn(date);
  };

  if (!isLoading && !habit) {
    return (
      <Screen>
        <EmptyState title={t("habits.title")} />
      </Screen>
    );
  }

  const header = (
    <View style={{ gap: theme.spacing.md }}>
      {isLoading || !habit || !record || !today ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t("common.loading")}
          </AppText>
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="callout" tone="muted">
                {scheduleText(t, describeSchedule(habit.schedule))}
              </AppText>
              <AppText variant="body">
                {t(pluralKey("habits.streak", streak), { count: streak })}
              </AppText>
              <AppText variant="callout" tone="muted">
                {t(pluralKey("habits.longestStreak", longest), {
                  count: longest,
                })}
              </AppText>
            </View>
          </Card>

          {/*
            El navegador de periodos: flechas visibles a los lados del
            selector. La pulsacion larga en la fila sigue saltando el dia,
            pero ya no es el unico camino: nadie descubre un gesto invisible.
          */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <Button
              label={t("habits.period.previous")}
              icon="chevron-back"
              iconOnly
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => setAnchorOffset((offset) => offset - 1)}
              testID="habit-period-prev"
            />
            <View style={{ flex: 1 }}>
              <Segmented<DetailPeriod>
                value={period}
                onChange={(next) => {
                  setPeriod(next);
                  setAnchorOffset(0);
                }}
                options={PERIOD_ORDER.map((option) => ({
                  value: option,
                  label: t(`habits.${option}`),
                }))}
              />
            </View>
            <Button
              label={t("habits.period.next")}
              icon="chevron-forward"
              iconOnly
              variant="secondary"
              size="sm"
              fullWidth={false}
              // En el periodo en curso no hay siguiente que mostrar: solo
              // se viaja hacia atras.
              disabled={atPresent}
              onPress={() => setAnchorOffset((offset) => offset + 1)}
              testID="habit-period-next"
            />
          </View>

          {habit.schedule.kind === "quota" && quotaProgress ? (
            <Card>
              <View style={{ gap: theme.spacing.sm }}>
                <AppText
                  testID="habit-quota-progress"
                  variant="body"
                  align="center"
                >
                  {t("habits.quota.progress", {
                    done: quotaProgress.done,
                    target: quotaProgress.target,
                  })}
                </AppText>
                <Button
                  label={t("habits.status.done")}
                  onPress={() => void checkIn(today)}
                  disabled={
                    habit.endDate !== null && today > habit.endDate
                  }
                  testID="habit-quota-checkin"
                />
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <TextField
                label={t("habits.endDate")}
                value={endShown}
                onChangeText={setEndText}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                error={
                  endShown.trim().length > 0 && !endValid
                    ? t("habits.error.invalidDate")
                    : null
                }
              />
              <Button
                label={t("common.save")}
                onPress={() => void saveEnd()}
                loading={savingEnd}
                disabled={!endValid}
                testID="habit-end-save"
              />
              <Button
                label={t(
                  habit.archivedAt ? "habits.unarchive" : "habits.archive",
                )}
                variant="secondary"
                onPress={() =>
                  void (habit.archivedAt ? unarchive() : archive())
                }
                testID="habit-archive"
              />
              <Button
                label={t("common.delete")}
                variant="danger"
                onPress={() =>
                  void remove().then((done) => {
                    if (done) router.back();
                  })
                }
                testID="habit-delete"
              />
            </View>
          </Card>
        </>
      )}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={days}
        keyExtractor={(date) => date}
        ListHeaderComponent={header}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
          gap: theme.spacing.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item: date }) => {
          // Dias programados todos: el estado lo decide el motor y no un
          // `if` local, como en la lista.
          if (!record || !today) return null;
          const status = statusForDate(record, date, entries);
          const future = date > today;
          return (
            <Pressable
              testID={`habit-day-${date}`}
              accessibilityRole="button"
              accessibilityLabel={date}
              // Lo futuro no se puede marcar (`isMarkableDay` lo rechaza):
              // deshabilitado en vez de un error al pulsar.
              disabled={future}
              onPress={() => toggleDay(date, status)}
              onLongPress={() => void skip(date)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                opacity: pressed || future ? 0.6 : 1,
              })}
            >
              <View
                accessible={false}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: statusColor(status, theme),
                }}
              />
              <View style={{ flex: 1 }}>
                <AppText variant="body">{date}</AppText>
              </View>
              <AppText variant="callout" tone="muted">
                {t(`habits.status.${status}`)}
              </AppText>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
