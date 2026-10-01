import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { Person, PersonMatch, PersonRelation } from "@orbit-hub/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/divider";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import {
  followPerson,
  unfollowPerson,
  usePeople,
  usePeopleSearch,
} from "@/hooks/use-people";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The people directory: who you have dealt with, and who you follow.
 *
 * Not a friends list and not a feed: there is nothing to accept and nothing to
 * read. It is the answer to "who can I share with", which used to be "type an
 * address from memory".
 *
 * **Two boxes, and they are not the same box.** The first filters the people you
 * already have, over a list you can see, as you type. The second looks somebody up
 * in the accounts, and cannot be that: every keystroke would be a request over the
 * table of accounts, and there is a floor of three letters that the server enforces
 * and this enforces too, or the app looks broken for the first two letters of every
 * search.
 *
 * They were one box at first and it was **actively wrong**: typing somebody's
 * address in the search also filtered the directory, which no longer contained the
 * name being typed, so the screen said "nobody here at all" while you were in the
 * middle of adding somebody. Two fields and two pieces of state.
 */
export default function PeopleScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const { user } = useSession();
  const { people, isLoading, error, load } = usePeople();
  const { items: encontrados, isSearching, error: searchError, search, clear } =
    usePeopleSearch();

  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [anunciado, setAnunciado] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFiltro("");
      setBusqueda("");
      clear();
      void load();
    }, [load, clear]),
  );

  const visibles = useMemo(() => {
    const limpio = filtro.trim().toLowerCase();
    if (!limpio) return people;
    return people.filter(
      (person) =>
        person.user.displayName.toLowerCase().includes(limpio) ||
        person.user.email.toLowerCase().includes(limpio),
    );
  }, [people, filtro]);

  /** Follow or stop, then re-read the directory so the row says the truth. */
  const cambiar = useCallback(
    async (persona: PersonMatch | Person, seguir: boolean) => {
      try {
        if (seguir) await followPerson(persona.user.id);
        else await unfollowPerson(persona.user.id);
        setAnunciado(
          seguir ? t("people.followAdded") : t("people.followRemoved"),
        );
      } catch {
        // The list is re-read either way, so a failure leaves the truth on screen
        // rather than a button claiming something the server did not do.
      }
      await load();
    },
    [load, t],
  );

  return (
    <Screen>
      {people.length > 0 ? (
        <TextField
          value={filtro}
          onChangeText={setFiltro}
          placeholder={t("people.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="people-filter"
        />
      ) : null}

      {error ? (
        <AppText variant="caption" tone="subtle">
          {t("errors.network")}
        </AppText>
      ) : null}

      {isLoading && people.length === 0 ? (
        <EmptyState compact title={t("common.loading")} />
      ) : visibles.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={people.length === 0 ? t("people.empty") : t("people.emptyFiltered")}
          description={people.length === 0 ? t("people.emptyBody") : t("people.emptyFilteredBody")}
        />
      ) : (
        <Card padded={false}>
          {visibles.map((person, index) => (
            <View key={person.user.id}>
              {index > 0 ? <Divider inset={56} /> : null}
              <PersonRow
                person={person}
                isMe={person.user.id === user?.id}
                onToggleFollow={
                  person.relations.includes("followed")
                    ? () => void cambiar(person, false)
                    : undefined
                }
              />
            </View>
          ))}
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}

      <Card padded={false} variant="muted">
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
          <AppText variant="bodyStrong">{t("people.addTitle")}</AppText>
          <AppText variant="caption" tone="subtle">
            {t("people.addHint")}
          </AppText>

          <TextField
            value={busqueda}
            onChangeText={(value) => {
              setBusqueda(value);
              void search(value);
            }}
            placeholder={t("people.addSearch")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            clearButtonMode="while-editing"
            testID="people-search"
          />

          {isSearching ? (
            <AppText variant="caption" tone="subtle">
              {t("common.loading")}
            </AppText>
          ) : searchError ? (
            /*
              Un fallo **no** es "nadie con eso". Decirlo era mentir, y mentía justo
              en el dato que uno va a comprobar: una busqueda que no llegó al servidor
              se veia igual que una busqueda que llego y no encontro a nadie, y la
              segunda lectura es "esa persona no tiene cuenta aqui".
            */
            <EmptyState
              compact
              title={t("people.addFailed")}
              description={t("people.addFailedBody")}
            />
          ) : busqueda.trim().length > 0 && busqueda.trim().length < 3 ? (
            <AppText variant="caption" tone="subtle">
              {t("people.addTooShort")}
            </AppText>
          ) : encontrados.length === 0 && busqueda.trim().length >= 3 ? (
            <EmptyState
              compact
              title={t("people.addNoResults")}
              description={t("people.addNoResultsBody")}
            />
          ) : (
            encontrados.map((persona, index) => (
              <View key={persona.user.id}>
                {index > 0 ? <Divider /> : null}
                <View
                  style={[
                    styles.row,
                    { gap: theme.spacing.md, paddingVertical: theme.spacing.md },
                  ]}
                >
                  <View style={styles.flex}>
                    <AppText variant="body" numberOfLines={1}>
                      {persona.user.displayName || persona.user.email}
                    </AppText>
                    <AppText variant="caption" tone="subtle" numberOfLines={1}>
                      {persona.user.email}
                    </AppText>
                  </View>
                  <Button
                    label={t("people.follow")}
                    size="sm"
                    onPress={() => void cambiar(persona, true)}
                  />
                </View>
              </View>
            ))
          )}

          {anunciado ? (
            <AppText variant="caption" tone="subtle">
              {anunciado}
            </AppText>
          ) : null}
        </View>
      </Card>
    </Screen>
  );
}

/**
 * One person, and why they are here.
 *
 * The reason is shown because "Marta" on its own is a name with no context, and the
 * only thing this screen knows about Marta is how she got here. When it is two or
 * three reasons at once they are all shown: a colleague you also share with is not
 * the same as a stranger you decided to keep handy.
 *
 * "Dejar de seguir" is only there for somebody you follow, and not for somebody who
 * arrived because you shared something: you did not add that person, so there is
 * nothing of yours to undo.
 */
function PersonRow({
  person,
  isMe,
  onToggleFollow,
}: {
  person: Person;
  isMe: boolean;
  onToggleFollow?: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const nombre = person.user.displayName || person.user.email;

  return (
    <View style={[styles.row, { gap: theme.spacing.md, padding: theme.spacing.lg }]}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
        ]}
      >
        <Ionicons
          name="person-outline"
          size={20}
          color={theme.colors.accentSoftText}
        />
      </View>

      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {nombre}
          </AppText>
          {isMe ? <Badge label={t("people.you")} /> : null}
        </View>

        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {person.user.email}
        </AppText>

        <View style={[styles.reasons, { marginTop: theme.spacing.xs }]}>
          {person.relations.map((relation) => (
            <AppText key={relation} variant="caption" tone="subtle">
              {t(RELATION_LABEL[relation])}
            </AppText>
          ))}
        </View>
      </View>

      {onToggleFollow ? (
        <Button
          label={t("people.unfollow")}
          variant="secondary"
          size="sm"
          onPress={onToggleFollow}
        />
      ) : null}
    </View>
  );
}

/**
 * How each relation is said out loud, from the point of view of the person reading
 * it. `shared_with` is the one that gets misread, so it is the one spelled out.
 */
const RELATION_LABEL: Record<PersonRelation, TranslationKey> = {
  shared_with: "people.relationSharedWith",
  shared_by: "people.relationSharedBy",
  space: "people.relationSpace",
  followed: "people.relationFollowed",
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reasons: {
    gap: 2,
  },
});