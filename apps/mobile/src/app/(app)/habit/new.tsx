import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import type { HabitSchedule, LocalDate } from "@orbit-hub/contracts";
import { localDateSchema } from "@orbit-hub/contracts";
import {
  describeSchedule,
  todayIn,
  type ScheduleDescription,
  type WeekDayKey,
} from "@orbit-hub/habit-core";

import { AppText } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { TextField } from "@/components/ui/text-field";
import {
  extractUntilDate,
  scheduleUsable,
  useHabits,
} from "@/hooks/use-habits";
import { FIELD_LIMITS } from "@/lib/lists/field-limit";
import { pluralKey, useTranslation, type Translate } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * El alta de un habito: nombre, un preset de horario, fin y meta.
 *
 * Sobre el molde de `lists.tsx` (`Screen`, `Card`, `TextField`, `Button`
 * con `loading` y `disabled`). El titulo no se escribe aqui: sale del
 * `Stack.Screen` del layout, como en las demas pantallas fijas.
 *
 * Todo lo que compila horarios es puro y esta arriba, sin `t()` ni
 * componentes: el test lo ejecuta contra el motor de verdad. Lo que si toca
 * pantalla (el texto de cada preset, el guardar) se pinnea por cableado,
 * como en `habits-list-wiring.test.ts`, porque `expo-router` no carga en
 * node y un render es imposible.
 */

export type HabitPresetId =
  | "daily"
  | "weekdays"
  | "first-monday"
  | "every-3-days"
  | "twice-week"
  | "once-month"
  | "five-year"
  | "advanced";

export type QuotaPeriod = "week" | "month" | "year";

const PRESET_ORDER: HabitPresetId[] = [
  "daily",
  "weekdays",
  "first-monday",
  "every-3-days",
  "twice-week",
  "once-month",
  "five-year",
  "advanced",
];

/** De lunes a domingo: el mismo orden en el que `rrule` numera (MO=0). */
const WEEK_DAYS_IN_ORDER: WeekDayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const RRULE_DAY_CODES: Record<WeekDayKey, string> = {
  mon: "MO",
  tue: "TU",
  wed: "WE",
  thu: "TH",
  fri: "FR",
  sat: "SA",
  sun: "SU",
};

/** Lo que el preset de dias trae marcado al abrir: de lunes a viernes. */
const DEFAULT_PRESET_DAYS: WeekDayKey[] = ["mon", "tue", "wed", "thu", "fri"];

/**
 * Los presets con selector de dia, en lista cerrada y no como un "todo
 * menos cuota".
 *
 * Esconderlo en "2 veces por semana" es lo que impide que alguien piense
 * que el lunes y el martes estan elegidos cuando no lo estan: una cuota no
 * tiene dias y el selector pintaria una mentira. Por la misma razon un
 * preset nuevo no lo abre por descuido: hay que apuntarlo aqui.
 */
const DAY_SELECTOR_PRESETS: HabitPresetId[] = ["weekdays", "first-monday"];

const QUOTA_DEFAULTS: Record<string, { count: number; period: QuotaPeriod }> = {
  "twice-week": { count: 2, period: "week" },
  "once-month": { count: 1, period: "month" },
  "five-year": { count: 5, period: "year" },
};

export interface CompiledScheduleInput {
  preset: HabitPresetId;
  days: WeekDayKey[];
  advancedRule: string;
  quotaCount: number;
  quotaPeriod: QuotaPeriod;
}

/**
 * El preset compilado a horario. `null` cuando aun no hay nada que guardar:
 * sin dias marcados o con el campo avanzado vacio.
 */
export function compileSchedule(input: CompiledScheduleInput): HabitSchedule | null {
  switch (input.preset) {
    case "daily":
      return { kind: "rrule", rule: "FREQ=DAILY" };
    case "weekdays": {
      const picked = WEEK_DAYS_IN_ORDER.filter((day) => input.days.includes(day));
      if (picked.length === 0) return null;
      // Siete dias marcados es "todos los dias" con otro nombre, como en el
      // motor: la vista previa no puede decir dos cosas distintas.
      if (picked.length === 7) return { kind: "rrule", rule: "FREQ=DAILY" };
      const codes = picked.map((day) => RRULE_DAY_CODES[day]);
      return { kind: "rrule", rule: `FREQ=WEEKLY;BYDAY=${codes.join(",")}` };
    }
    case "first-monday": {
      const day = input.days[0] ?? "mon";
      return { kind: "rrule", rule: `FREQ=MONTHLY;BYDAY=1${RRULE_DAY_CODES[day]}` };
    }
    case "every-3-days":
      return { kind: "rrule", rule: "FREQ=DAILY;INTERVAL=3" };
    case "twice-week":
    case "once-month":
    case "five-year":
      return { kind: "quota", count: input.quotaCount, period: input.quotaPeriod };
    case "advanced": {
      const rule = input.advancedRule.trim();
      if (rule.length === 0) return null;
      return { kind: "rrule", rule };
    }
  }
}

/**
 * La zona del telefono, o UTC si no se puede leer.
 *
 * Se valida con la misma funcion que la usara: una zona que `todayIn` no
 * acepta es una zona con la que nada de abajo funciona, y el servidor la
 * rechaza igual al sincronizar.
 */
export function deviceTimezone(): string {
  const found = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof found === "string" && found.length > 0) {
    try {
      todayIn(found);
      return found;
    } catch {
      // Cae a UTC abajo.
    }
  }
  return "UTC";
}

/**
 * El horario con palabras del diccionario, nunca escrito a mano.
 *
 * El mismo reparto que la lista: el motor da la clave y el diccionario el
 * texto. La rama generica (`weeklyDays` sin dias) es una regla que el motor
 * no sabe describir y solo entra por el campo avanzado, asi que su reserva
 * es el nombre del campo (`habits.advanced`).
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

/** El texto de cada preset en la lista, con su horario por defecto. */
function presetText(
  t: Translate,
  preset: HabitPresetId,
  quotaCount: number,
  quotaPeriod: QuotaPeriod,
): string {
  if (preset === "advanced") return t("habits.advanced");
  const schedule = compileSchedule({
    preset,
    days: preset === "first-monday" ? ["mon"] : DEFAULT_PRESET_DAYS,
    advancedRule: "",
    quotaCount,
    quotaPeriod,
  });
  // Los presets siempre compilan: los dias por defecto no estan vacios y la
  // cuota por defecto esta en contrato. Si esto fuera null, la fila no
  // tendria texto y el fallo seria una fila muda.
  if (schedule === null) return t("habits.advanced");
  return scheduleText(t, describeSchedule(schedule));
}

export default function HabitNewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();
  const { create } = useHabits();

  const [timezone] = useState(deviceTimezone);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<HabitPresetId>("daily");
  const [days, setDays] = useState<WeekDayKey[]>(DEFAULT_PRESET_DAYS);
  const [advancedRule, setAdvancedRule] = useState("");
  const [quotaCount, setQuotaCount] = useState(2);
  const [quotaCountText, setQuotaCountText] = useState("2");
  const [quotaPeriod, setQuotaPeriod] = useState<QuotaPeriod>("week");
  const [endText, setEndText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [saving, setSaving] = useState(false);

  const startDate = useMemo(() => todayIn(timezone), [timezone]);

  /**
   * Cambiar de preset repone lo suyo: los dias marcados no viajan de un
   * semanal a un mensual y la cuota no hereda numeros de otro periodo. Sin
   * esto, elegir "2 por semana" despues de tocar dias deja un estado que
   * compila bien pero nadie pidio.
   */
  const choosePreset = (next: HabitPresetId): void => {
    setPreset(next);
    if (next === "weekdays") setDays(DEFAULT_PRESET_DAYS);
    if (next === "first-monday") setDays(["mon"]);
    const quota = QUOTA_DEFAULTS[next];
    if (quota) {
      setQuotaCount(quota.count);
      setQuotaCountText(String(quota.count));
      setQuotaPeriod(quota.period);
    }
    if (next !== "advanced") setAdvancedRule("");
  };

  const toggleDay = (day: WeekDayKey): void => {
    if (preset === "first-monday") {
      // Uno solo: es "el primer X del mes" y no "los primeros X".
      setDays([day]);
      return;
    }
    setDays((current) =>
      current.includes(day)
        ? current.filter((kept) => kept !== day)
        : [...current, day],
    );
  };

  const changeQuotaCount = (text: string): void => {
    setQuotaCountText(text);
    // Solo compromete enteros positivos: lo demas se queda en texto y la
    // vista previa sigue diciendo lo ultimo valido, en vez de compilar una
    // cuota imposible.
    const parsed = Number(text);
    if (Number.isInteger(parsed) && parsed >= 1) setQuotaCount(parsed);
  };

  const schedule = useMemo(
    () =>
      compileSchedule({
        preset,
        days,
        advancedRule,
        quotaCount,
        quotaPeriod,
      }),
    [preset, days, advancedRule, quotaCount, quotaPeriod],
  );

  const ruleValid = schedule !== null && scheduleUsable(schedule, timezone);

  const endDate = useMemo<LocalDate | null>(() => {
    const text = endText.trim();
    if (text.length === 0) return null;
    const parsed = localDateSchema.safeParse(text);
    if (!parsed.success) return null;
    return parsed.data;
  }, [endText]);

  /**
   * La fecha de fin va al campo `endDate` del habito, valga para rrule o
   * para cuota: es el mecanismo que ya respetan el cliente (`isMarkableDay`,
   * `statusForDate`) y el servidor (`assertRango`, `assertFechaValida`). Un
   * `UNTIL` crudo escrito en el campo avanzado se respeta tal cual lo trae,
   * porque el motor lo entiende; el formulario no inventa otro.
   */
  const endValid =
    endText.trim().length === 0 || (endDate !== null && endDate >= startDate);

  const targetValue = useMemo<number | null>(() => {
    const text = targetText.trim();
    if (text.length === 0) return null;
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }, [targetText]);

  const canSave =
    name.trim().length > 0 && ruleValid && endValid && !saving;

  const onSave = async (): Promise<void> => {
    if (!ruleValid) return;
    if (!endValid) return;
    if (schedule === null) return;
    if (name.trim().length === 0) return;
    setSaving(true);
    try {
      // Las mutaciones viven en el hook: la pantalla compila y valida para
      // la vista previa, pero quien escribe y normaliza el UNTIL es `create`.
      const created = await create({
        name: name.trim(),
        schedule,
        timezone,
        startDate,
        endDate: endText.trim().length === 0 ? null : endDate,
        targetValue,
      });
      if (!created.ok) return;
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const showDays = DAY_SELECTOR_PRESETS.includes(preset);
  const isQuota =
    preset === "twice-week" || preset === "once-month" || preset === "five-year";

  return (
    <Screen width="reading" scroll>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            label={t("habits.name")}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="next"
            limit={FIELD_LIMITS["habit.name"]}
          />

          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="callout" tone="muted">
              {t("habits.schedule")}
            </AppText>
            <View style={{ gap: theme.spacing.xs }}>
              {PRESET_ORDER.map((option) => (
                <ListRow
                  key={option}
                  title={presetText(t, option, quotaCount, quotaPeriod)}
                  leading={
                    <View
                      accessible={false}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor:
                          preset === option
                            ? theme.colors.accent
                            : theme.colors.textSubtle,
                      }}
                    />
                  }
                  onPress={() => choosePreset(option)}
                />
              ))}
            </View>
          </View>

          {showDays ? (
            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: theme.spacing.xs,
                }}
              >
                {WEEK_DAYS_IN_ORDER.map((day) => (
                  <Chip
                    key={day}
                    label={t(`habits.weekday.${day}`)}
                    selected={days.includes(day)}
                    onPress={() => toggleDay(day)}
                    testID={`habit-day-${day}`}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {isQuota ? (
            <View style={{ gap: theme.spacing.xs }}>
              <TextField
                label={t("habits.quota.count")}
                value={quotaCountText}
                onChangeText={changeQuotaCount}
                keyboardType="number-pad"
                returnKeyType="done"
              />
              <Segmented<QuotaPeriod>
                value={quotaPeriod}
                onChange={setQuotaPeriod}
                options={[
                  { value: "week", label: t("habits.week") },
                  { value: "month", label: t("habits.month") },
                  { value: "year", label: t("habits.year") },
                ]}
              />
            </View>
          ) : null}

          {preset === "advanced" ? (
            <TextField
              label={t("habits.advanced")}
              value={advancedRule}
              onChangeText={setAdvancedRule}
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={() => {
                // endDate es la unica fuente de verdad: al salir del campo
                // con un UNTIL valido se adopta como fecha de fin, para que
                // el guardar no lo reescriba por detras sin avisar.
                const adopted = extractUntilDate(advancedRule);
                if (adopted !== null) setEndText(adopted);
              }}
              error={
                advancedRule.trim().length > 0 && !ruleValid
                  ? t("habits.error.invalidRule")
                  : null
              }
            />
          ) : null}

          {schedule !== null && ruleValid ? (
            <AppText variant="callout" tone="muted">
              {scheduleText(t, describeSchedule(schedule))}
            </AppText>
          ) : null}

          <TextField
            label={t("habits.endDate")}
            value={endText}
            onChangeText={setEndText}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            error={
              endText.trim().length > 0 && !endValid
                ? t("habits.error.invalidDate")
                : null
            }
          />

          <TextField
            label={t("habits.target")}
            hint={t("common.optional")}
            value={targetText}
            onChangeText={setTargetText}
            keyboardType="number-pad"
            returnKeyType="done"
          />

          <Button
            label={t("common.create")}
            icon="add"
            onPress={() => void onSave()}
            loading={saving}
            disabled={!canSave}
            testID="habit-save"
          />
        </View>
      </Card>
    </Screen>
  );
}
