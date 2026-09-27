import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import type { CatalogKind, CatalogProviders } from "@orbit-hub/contracts";
import { useTheme } from "@/theme";

export interface ProvidersSheetProps {
  /** The title being asked about, or `null` when the sheet is closed. */
  item: { externalId: string; title: string; kind: CatalogKind } | null;
  onClose: () => void;
}

/**
 * Where a title is, and where it is not.
 *
 * Three things this does that a list of words does not:
 *
 * - **It says which country it is answering for.** Netflix has different films in
 *   different countries, and a sheet that answers for the wrong one sends you to
 *   pay for a service that does not have it. The region comes from the app's own
 *   language and is shown, so a wrong guess is visible and not a mystery.
 * - **"Not on anything here" is an answer.** A sheet that opens empty and says
 *   nothing is a sheet that looks broken, so it says it in words.
 * - **It does not open before it knows.** An empty sheet that fills in is a sheet
 *   that looks empty and then not; it says it is looking.
 *
 * The logos are the provider's own, from the same image host as the posters: a list
 * of names in a column is a list you have to read, and "Netflix" is a thing you
 * recognise.
 */
export function ProvidersSheet({ item, onClose }: ProvidersSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [datos, setDatos] = useState<CatalogProviders | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);

  const region = regionDelIdioma();

  const cargar = useCallback(() => {
    if (!item) return;
    setCargando(true);
    setFallo(false);
    api
      .get<CatalogProviders>(
        `/catalog/providers?kind=${encodeURIComponent(item.kind)}&externalId=${encodeURIComponent(item.externalId)}&region=${region}`,
      )
      .then(setDatos)
      .catch(() => setFallo(true))
      .finally(() => setCargando(false));
  }, [api, item, region]);

  useEffect(() => {
    setDatos(null);
    cargar();
  }, [cargar]);

  return (
    <Sheet
      visible={Boolean(item)}
      onClose={onClose}
      title={item?.title ?? ""}
      subtitle={t("providers.where", { region: regionName(region) })}
      scrollable
    >
      <View
        style={{
          gap: theme.spacing.lg,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        {cargando ? (
          <AppText variant="callout" tone="muted" align="center">
            {t("common.loading")}
          </AppText>
        ) : null}

        {fallo ? (
          <View style={{ gap: theme.spacing.sm, alignItems: "flex-start" }}>
            <AppText variant="callout" tone="muted">
              {t("providers.unavailable")}
            </AppText>
            <Button
              label={t("common.retry")}
              icon="refresh"
              variant="secondary"
              onPress={cargar}
            />
          </View>
        ) : null}

        {!cargando && !fallo && datos && !datos.available ? (
          <AppText variant="callout" tone="muted" align="center">
            {t("providers.none", { region: regionName(datos.region) })}
          </AppText>
        ) : null}

        {!cargando && datos?.available
          ? OFRECIMIENTAS.map(([offering, etiqueta]) => {
              const delGrupo = datos.providers.filter(
                (p) => p.offering === offering,
              );
              if (delGrupo.length === 0) return null;
              return (
                <View key={offering} style={{ gap: theme.spacing.sm }}>
                  <AppText variant="caption" tone="subtle">
                    {t(etiqueta)}
                  </AppText>
                  <View style={[styles.grupo, { gap: theme.spacing.sm }]}>
                    {delGrupo.map((p) => (
                      <ProviderCard key={`${p.name}-${p.offering}`} name={p.name} logoUrl={p.logoUrl} url={p.url} />
                    ))}
                  </View>
                </View>
              );
            })
          : null}
      </View>
    </Sheet>
  );
}

const OFRECIMIENTAS: [CatalogProviders["providers"][number]["offering"], "providers.flatrate" | "providers.rent" | "providers.buy"][] = [
  ["flatrate", "providers.flatrate"],
  ["rent", "providers.rent"],
  ["buy", "providers.buy"],
];

/** The two-letter country the app is asking about, from the language it is in. */
function regionDelIdioma(): string {
  const idioma = (
    typeof navigator !== "undefined" ? navigator.language : "es-ES"
  )
    .split("-")[1];
  return (idioma && /^[A-Za-z]{2}$/.test(idioma) ? idioma : "es").toUpperCase();
}

const NOMBRES: Record<string, string> = { ES: "España", GB: "Reino Unido", US: "Estados Unidos", MX: "México" };

/** The country in words, and the code when it is not one anybody knows. */
function regionName(region: string): string {
  return NOMBRES[region] ?? region;
}

function ProviderCard({
  name,
  logoUrl,
  url,
}: {
  name: string;
  logoUrl: string | null;
  url: string | null;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.tarjeta,
        {
          gap: theme.spacing.sm,
          padding: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={[
            styles.logo,
            { borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceMuted },
          ]}
          resizeMode="contain"
        />
      ) : (
        <View
          style={[
            styles.logo,
            {
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surfaceMuted,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <Ionicons name="tv-outline" size={18} color={theme.colors.textMuted} />
        </View>
      )}
      <AppText variant="body" numberOfLines={2} style={styles.flex}>
        {name}
      </AppText>
      {url ? (
        <Ionicons name="open-outline" size={16} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  tarjeta: {
    width: 104,
    borderWidth: 1,
  },
  logo: {
    width: 40,
    height: 40,
  },
  flex: {
    flex: 1,
  },
});
