import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Image, Linking, StyleSheet, View } from "react-native";

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
 * Where a title is, and where it is not — and the trailer, if it has one.
 *
 * Five things this does that a list of words does not:
 *
 * - **It says which country it is answering for.** Netflix has different films in
 *   different countries, and a sheet that answers for the wrong one sends you to
 *   pay for a service that does not have it. The region comes from the app's own
 *   language and is shown, so a wrong guess is visible and not a mystery.
 * - **"Not on anything here" is an answer.** A sheet that opens empty and says
 *   nothing is a sheet that looks broken, so it says it in words.
 * - **It does not open before it knows.** An empty sheet that fills in is a sheet
 *   that looks empty and then not; it says it is looking.
 * - **The trailer comes with it**, and on its own request, because somebody who
 *   opens this sheet has a film in mind and wants ninety seconds of it, not a
 *   list of subscriptions to read.
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
  const [trailer, setTrailer] = useState<string | null>(null);

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

  /**
   * The trailer, asked for separately because it is a different question.
   *
   * The providers endpoint answers "who has it in this country" and the details
   * endpoint answers "what is it", and the trailer is in the second one. They are
   * two calls because they are two things, and **the trailer is not allowed to
   * hold up the sheet**: it is set whenever it arrives, so somebody with a slow
   * connection to YouTube's metadata still gets the list of providers in the
   * meantime. A sheet that waits for the trailer to show where to watch it is a
   * sheet about the trailer.
   */
  const cargarTrailer = useCallback(() => {
    if (!item) return;
    setTrailer(null);
    api
      .get<{ trailer?: string | null }>(
        `/catalog/details?kind=${encodeURIComponent(item.kind)}&externalId=${encodeURIComponent(item.externalId)}`,
      )
      .then((detalle) => setTrailer(detalle.trailer ?? null))
      // Sin tráiler no es un fallo: la hoja sigue answering lo otro.
      .catch(() => setTrailer(null));
  }, [api, item]);

  useEffect(() => {
    setDatos(null);
    cargar();
    cargarTrailer();
  }, [cargar, cargarTrailer]);

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
        {/*
          The trailer first, because it is the answer to the question people open
          this sheet with. "Where can I watch it" is really "can I see it right
          now", and a ninety-second trailer is what settles that; the list of
          subscriptions is what you read once you have decided you want it.
        */}
        {trailer ? (
          <Button
            testID="providers-trailer"
            label={t("itemDetails.trailer")}
            variant="secondary"
            icon="play-circle-outline"
            onPress={() => {
              void Linking.openURL(`https://www.youtube.com/watch?v=${trailer}`);
            }}
          />
        ) : null}

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

/**
 * The two-letter country the app is asking about, from the language it is in.
 *
 * **`navigator` exists on a phone and `navigator.language` does not.** That is the
 * whole of this: React Native provides a `navigator` — Hermes ships one with a
 * `product` in it — so the `typeof navigator !== "undefined"` guard passes on
 * Android and iOS exactly as it does in a browser, and the object that comes back
 * has no `language` on it at all. The guard was there to answer "is there a
 * browser?", and on a phone the answer was yes while the property was still
 * missing, so the line below asked a string to split itself and threw
 * `Cannot read property 'split' of undefined` — on the sheet a person reaches from
 * a film's options, which is where it was found.
 *
 * So the question is not whether there is a `navigator` but whether there is a
 * **language in it**, and the default is applied to the property rather than to
 * the object. A phone with no language gets the same country a browser in Spanish
 * would, which is the answer that was wanted anyway.
 */
function regionDelIdioma(): string {
  const navigator_ = typeof navigator === "undefined" ? undefined : navigator;
  const idioma = navigator_?.language?.split("-")[1];
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
