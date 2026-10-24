import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { Pick } from "@/components/workspace/place-picker";
import { useTheme } from "@/theme";

import { writeWidgetConfig } from "./config-store";
import type { QuickCaptureConfig } from "./config-store";
import { ConfigFrame } from "./config-frame";
import { ListPicker } from "./list-picker";
import { listPinnableWorkspaces, loadCaptureTargets } from "./pinned-list-data";
import { QuickCaptureWidget } from "./quick-capture-widget";
import { widgetStrings } from "./strings";
import { bothLooks } from "./widget-views";

interface Choice {
  id: string;
  label: string;
}

/**
 * Two questions, one after the other: which list the tasks go to, and which space the notes go to.
 * Either can be skipped and the widget then shows only the other button.
 */
export function QuickCaptureConfigScreen({
  widgetInfo,
  renderWidget,
  setResult,
}: WidgetConfigurationScreenProps) {
  const t = widgetStrings();
  const [step, setStep] = useState<"list" | "workspace">("list");
  const [config, setConfig] = useState<QuickCaptureConfig>({});
  const [workspaces, setWorkspaces] = useState<Choice[]>([]);

  useEffect(() => {
    void listPinnableWorkspaces().then((rows) =>
      setWorkspaces(rows.map((r) => ({ id: r.id, label: r.name }))),
    );
  }, []);

  const finish = async (final: QuickCaptureConfig) => {
    await writeWidgetConfig(widgetInfo.widgetId, final);
    const targets = await loadCaptureTargets(final);
    renderWidget(
      bothLooks((palette) => (
        <QuickCaptureWidget targets={targets} t={t} palette={palette} />
      )),
    );
    setResult("ok");
  };

  const answer = (id: string | null) => {
    if (step === "list") {
      setConfig(id ? { listId: id } : {});
      setStep("workspace");
      return;
    }
    void finish({ ...config, ...(id ? { workspaceId: id } : {}) });
  };

  return (
    <ConfigFrame
      title={step === "list" ? t.taskWhere : t.noteWhere}
      onClose={() => setResult("cancel")}
      onSkip={() => answer(null)}
      skipLabel={t.skip}
    >
      {step === "list" ? (
        <ListPicker onPick={answer} emptyLabel={t.nothingHere} />
      ) : (
        <Workspaces choices={workspaces} onPick={answer} />
      )}
    </ConfigFrame>
  );
}

function Workspaces({
  choices,
  onPick,
}: {
  choices: Choice[];
  onPick: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={{ gap: theme.spacing.xs }}>
      {choices.map((choice) => (
        <Pick
          key={choice.id}
          icon="grid-outline"
          label={choice.label}
          selected={false}
          onPress={() => onPick(choice.id)}
        />
      ))}
    </ScrollView>
  );
}
