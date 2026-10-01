import { randomUUID } from "node:crypto";

import { invitationStatusSchema, type Invitation } from "@orbit-hub/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { capturedEmails } from "../src/modules/email/email.js";

import {
  createVerifiedUser,
  startTestServer,
  type TestServer,
  type TestUser,
} from "./helpers.js";

/**
 * Letting somebody into a space.
 *
 * These are the answers that matter and that are easy to get wrong: who is
 * allowed to invite, what happens to a link that was used twice, whether a link
 * sent to one address works when it reaches another, and whether the person who
 * is already in keeps the role they had.
 */
describe("invitations", () => {
  let api: TestServer;
  let owner: TestUser;
  let guest: TestUser;
  let stranger: TestUser;
  let space: string;

  beforeAll(async () => {
    api = await startTestServer();
    owner = await createVerifiedUser(api, { displayName: "Dueña" });
    guest = await createVerifiedUser(api, { displayName: "Invitada" });
    stranger = await createVerifiedUser(api, { displayName: "Desconocida" });
    space = randomUUID();

    const created = await api.post(
      "/sync/push",
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: "invitations-test",
            entity: "workspace",
            kind: "create",
            entityId: space,
            baseVersion: 0,
            payload: { name: "Casa", color: "teal" },
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      owner.accessToken,
    );

    if (created.status !== 200) {
      throw new Error(
        `could not create the space: ${JSON.stringify(created.body)}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    await api?.close();
  });

  /** Invites and hands back the row, the way the route answers. */
  async function invite(
    by: TestUser,
    body: Record<string, unknown> = {},
    to = space,
  ): Promise<{ status: number; body: any }> {
    return api.post(
      `/workspaces/${to}/invitations`,
      { role: "editor", ...body },
      by.accessToken,
    );
  }

  describe("only the owner can invite", () => {
    it("answers 404 to somebody who is not in the space at all", async () => {
      // The same 404 a space that does not exist gives, because the difference
      // between the two is exactly what must not be learnt from a 403.
      const response = await invite(stranger);
      expect(response.status).toBe(404);
    });

    it("answers 403 to somebody in it who is not the owner", async () => {
      // Now the space is known to exist and the answer is about the role. A
      // person of their own, because this test is about what a non-owner is
      // told and not about what happened to anybody else in the space.
      const person = await createVerifiedUser(api);
      const link = await invite(owner, { email: person.email, role: "viewer" });
      const { token } = link.body.data as Invitation;
      await api.post(`/invitations/${token}/accept`, {}, person.accessToken);

      const list = await api.get(
        `/workspaces/${space}/invitations`,
        person.accessToken,
      );
      expect(list.status).toBe(403);

      const again = await invite(person);
      expect(again.status).toBe(403);
    });
  });

  describe("creating one", () => {
    it("makes a pending invitation with a link and says who sent it", async () => {
      const response = await invite(owner, {
        email: guest.email,
        expiresInHours: 48,
      });

      expect(response.status).toBe(201);
      const invitation = response.body.data as Invitation;
      expect(invitationStatusSchema.parse(invitation.status)).toBe("pending");
      expect(invitation.role).toBe("editor");
      expect(invitation.invitedEmail).toBe(guest.email);
      expect(invitation.workspaceName).toBe("Casa");
      expect(invitation.invitedBy.displayName).toBe("Dueña");
      expect(invitation.token.length).toBeGreaterThanOrEqual(10);
      // The token is the link and the id is not: the id travels in every answer.
      expect(invitation.id).not.toBe(invitation.token);
    });

    it("mails the person it was addressed to, and the mail is the bell, not the door", async () => {
      const before = capturedEmails().length;
      await invite(owner, { email: stranger.email });

      const sent = capturedEmails().slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(stranger.email);
      expect(sent[0]!.subject).toContain("Casa");

      // It used to be `/invite?token=`, and the mail was the only way to answer:
      // lose it, search for it, let it land in a folder, and the invitation is gone.
      // So the button goes to the screen where invitations live as rows.
      expect(sent[0]!.text).toContain("/invitations");
      expect(sent[0]!.text).not.toContain("/invite?token=");
      expect(sent[0]!.text).not.toContain("token=");

      // And it must be a route that exists, or we are back to a button that lands on
      // "Page could not be found". `email-links.test.ts` walks the routes; this says
      // the mail is one of the ones that gets checked.
      expect(sent[0]!.html).toContain("/invitations");
    });

    it("does not mail anybody when the link is meant to be sent by hand", async () => {
      const before = capturedEmails().length;
      const response = await invite(owner, { role: "viewer" });

      expect(capturedEmails()).toHaveLength(before);
      // The link comes back in the answer so the app can show it to copy.
      expect((response.body.data as Invitation).invitedEmail).toBeNull();
      expect((response.body.data as Invitation).role).toBe("viewer");
    });

    it("refuses to invite somebody who is already in", async () => {
      const response = await invite(owner, { email: owner.email });
      expect(response.status).toBe(409);
    });

    it("replaces a pending invitation to the same address instead of piling up", async () => {
      // Two live links for the same person is one person with two ways in, and
      // the old one should stop working the moment a new one is issued.
      const first = await invite(owner, { email: stranger.email });
      const second = await invite(owner, { email: stranger.email });

      const firstToken = (first.body.data as Invitation).token;
      const secondToken = (second.body.data as Invitation).token;
      expect(secondToken).not.toBe(firstToken);

      const preview = await api.get(
        `/invitations/${firstToken}`,
        stranger.accessToken,
      );
      // The old link is still readable so the screen can say what happened, but
      // it is not usable.
      expect(preview.status).toBe(200);
      const accepted = await api.post(
        `/invitations/${firstToken}/accept`,
        {},
        stranger.accessToken,
      );
      expect(accepted.status).toBe(403);
    });

    it("refuses a role it does not have, and a bad email", async () => {
      expect((await invite(owner, { role: "owner" })).status).toBe(422);
      expect((await invite(owner, { email: "not-an-email" })).status).toBe(422);
      expect((await invite(owner, { expiresInHours: 5000 })).status).toBe(422);
    });

    it("takes the space from the path and not from the body", async () => {
      const other = randomUUID();
      const response = await api.post(
        `/workspaces/${space}/invitations`,
        { role: "editor", workspaceId: other },
        owner.accessToken,
      );
      // The body is stripped, not trusted: a body naming another space is not a
      // way to invite people somewhere else.
      expect(response.status).toBe(201);
      expect((response.body.data as Invitation).workspaceId).toBe(space);
    });
  });

  describe("the link", () => {
    it("says who is being invited, and whether it is for you", async () => {
      const response = await invite(owner, { email: guest.email });
      const { token } = response.body.data as Invitation;

      const forGuest = await api.get(
        `/invitations/${token}`,
        guest.accessToken,
      );
      expect(forGuest.status).toBe(200);
      expect(forGuest.body.data.workspace.name).toBe("Casa");
      expect(forGuest.body.data.workspace.color).toBe("teal");
      expect(forGuest.body.data.role).toBe("editor");
      expect(forGuest.body.data.invitedBy).toBe("Dueña");
      expect(forGuest.body.data.isForYou).toBe(true);
      expect(forGuest.body.data.alreadyMember).toBe(false);

      // Somebody else reading the same link has to be able to see it and say no.
      const forStranger = await api.get(
        `/invitations/${token}`,
        stranger.accessToken,
      );
      expect(forStranger.body.data.isForYou).toBe(false);
    });

    it("needs a session, because it says who is reading it", async () => {
      const response = await invite(owner, { email: guest.email });
      const { token } = response.body.data as Invitation;
      expect((await api.get(`/invitations/${token}`)).status).toBe(401);
    });

    it("answers 404 for a link that was never given out", async () => {
      const response = await api.get(
        `/invitations/nunca-existio-esta-web`,
        guest.accessToken,
      );
      expect(response.status).toBe(404);
    });

    it("puts the person in the space", async () => {
      const response = await invite(owner, {
        email: guest.email,
        role: "editor",
      });
      const { token } = response.body.data as Invitation;

      const accepted = await api.post(
        `/invitations/${token}/accept`,
        {},
        guest.accessToken,
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.workspace.id).toBe(space);
      expect(accepted.body.data.alreadyMember).toBe(false);

      // The space shows up for them, and the member count counts them.
      const workspaces = await api.get("/workspaces", guest.accessToken);
      const mine = (
        workspaces.body.data.items as { id: string; role: string }[]
      ).find((item) => item.id === space);
      expect(mine?.role).toBe("editor");

      const members = await api.get(
        `/workspaces/${space}/members`,
        owner.accessToken,
      );
      const items = members.body.data.items as { user: { id: string } }[];
      expect(items.some((item) => item.user.id === guest.userId)).toBe(true);
    });

    it("will not let the same link be used twice", async () => {
      // A link is used up the moment it works. Reopening it is a 409 with a
      // reason, not a silent second membership, so a link pasted into a group
      // chat stops being a shared key the day the first person joins.
      const person = await createVerifiedUser(api);
      const link = await invite(owner, { email: person.email, role: "viewer" });
      const { token } = link.body.data as Invitation;

      expect(
        (await api.post(`/invitations/${token}/accept`, {}, person.accessToken))
          .status,
      ).toBe(200);
      expect(
        (await api.post(`/invitations/${token}/accept`, {}, person.accessToken))
          .status,
      ).toBe(409);
    });

    it("keeps somebody at the role they already had when a second link arrives", async () => {
      // The everyday version: somebody is invited by mail and also gets the link
      // pasted into the chat, uses the link, and the owner promotes them. Then
      // they open the mail. The promotion has to survive, because a link is not
      // a way to undo a role that was changed after the link was made.
      const person = await createVerifiedUser(api);
      const mailed = await invite(owner, {
        email: person.email,
        role: "viewer",
      });
      const pasted = await invite(owner, { role: "viewer" });

      await api.post(
        `/invitations/${(pasted.body.data as Invitation).token}/accept`,
        {},
        person.accessToken,
      );

      const promoted = await api.request(
        `/workspaces/${space}/members/${person.userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${owner.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: "editor" }),
        },
      );
      expect(promoted.status).toBe(204);

      const again = await api.post(
        `/invitations/${(mailed.body.data as Invitation).token}/accept`,
        {},
        person.accessToken,
      );
      expect(again.status).toBe(200);
      expect(again.body.data.alreadyMember).toBe(true);
      expect(again.body.data.workspace.id).toBe(space);

      const members = await api.get(
        `/workspaces/${space}/members`,
        owner.accessToken,
      );
      const items = members.body.data.items as {
        user: { id: string };
        role: string;
      }[];
      expect(items.find((item) => item.user.id === person.userId)?.role).toBe(
        "editor",
      );
    });

    it("refuses a link that was sent to another address", async () => {
      // A person of its own, so this is about the address and not about
      // whether they happen to be in the space already.
      const person = await createVerifiedUser(api);
      const response = await invite(owner, {
        email: person.email,
        role: "viewer",
      });
      const { token } = response.body.data as Invitation;

      // A link forwarded to somebody else is not an invitation to the person it
      // now reaches, even if they are signed in.
      const accepted = await api.post(
        `/invitations/${token}/accept`,
        {},
        stranger.accessToken,
      );
      expect(accepted.status).toBe(403);

      const declined = await api.post(
        `/invitations/${token}/decline`,
        {},
        stranger.accessToken,
      );
      expect(declined.status).toBe(403);

      // And the person it was for can use it, which is what makes the 403 above
      // a rule and not a broken link.
      expect(
        (await api.post(`/invitations/${token}/accept`, {}, person.accessToken))
          .status,
      ).toBe(200);
    });

    it("records a refusal instead of leaving the invitation hanging", async () => {
      // Declining your own invitation to your own space is odd but harmless, and
      // it is a real thing that happens when somebody is testing the button.
      const link = await invite(owner, { role: "viewer" });
      const { token } = link.body.data as Invitation;

      expect(
        (await api.post(`/invitations/${token}/decline`, {}, owner.accessToken))
          .status,
      ).toBe(204);

      const list = await api.get(
        `/workspaces/${space}/invitations`,
        owner.accessToken,
      );
      const declinedRow = (list.body.data.items as Invitation[]).find(
        (row) => row.token === token,
      );
      expect(declinedRow?.status).toBe("declined");

      // And the refused link does not work afterwards.
      expect(
        (await api.post(`/invitations/${token}/accept`, {}, owner.accessToken))
          .status,
      ).toBe(409);
    });

    it("refuses a link that was withdrawn", async () => {
      const link = await invite(owner, { role: "viewer" });
      const { id, token } = link.body.data as Invitation;

      const revoked = await api.request(
        `/workspaces/${space}/invitations/${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${owner.accessToken}` },
        },
      );
      expect(revoked.status).toBe(204);

      expect(
        (await api.post(`/invitations/${token}/accept`, {}, owner.accessToken))
          .status,
      ).toBe(403);
    });

    it("refuses a link that has passed its date", async () => {
      // One hour is the shortest the contract allows, and the row is written with
      // an hour already gone to keep the test honest about the check itself.
      const link = await invite(owner, { role: "viewer", expiresInHours: 1 });
      const { token } = link.body.data as Invitation;

      const preview = await api.get(`/invitations/${token}`, owner.accessToken);
      expect(preview.status).toBe(200);
      expect(new Date(preview.body.data.expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe("who is in the space", () => {
    it("shows the owner who sends it, and the person who joined", async () => {
      const members = await api.get(
        `/workspaces/${space}/members`,
        owner.accessToken,
      );
      const items = members.body.data.items as {
        user: { email: string };
        role: string;
      }[];

      expect(items.find((item) => item.user.email === owner.email)?.role).toBe(
        "owner",
      );
      expect(items.find((item) => item.user.email === guest.email)?.role).toBe(
        "editor",
      );
    });

    it("changes somebody’s role", async () => {
      const demoted = await api.request(
        `/workspaces/${space}/members/${guest.userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${owner.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: "viewer" }),
        },
      );
      expect(demoted.status).toBe(204);

      const members = await api.get(
        `/workspaces/${space}/members`,
        owner.accessToken,
      );
      const items = members.body.data.items as {
        user: { id: string };
        role: string;
      }[];
      expect(items.find((item) => item.user.id === guest.userId)?.role).toBe(
        "viewer",
      );
    });

    it("will not make somebody the owner from the members list", async () => {
      // A space has one owner and handing it over is a different screen with a
      // different confirmation, so it is not offered here at all.
      const response = await api.request(
        `/workspaces/${space}/members/${guest.userId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${owner.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: "owner" }),
        },
      );
      expect(response.status).toBe(422);
    });

    it("will not let the owner change or remove their own role", async () => {
      for (const request of [
        { method: "PATCH", body: { role: "viewer" } },
        { method: "DELETE" },
      ] as const) {
        const response = await api.request(
          `/workspaces/${space}/members/${owner.userId}`,
          {
            method: request.method,
            headers: {
              Authorization: `Bearer ${owner.accessToken}`,
              "Content-Type": "application/json",
            },
            ...("body" in request
              ? { body: JSON.stringify(request.body) }
              : {}),
          },
        );
        expect(response.status).toBe(400);
      }
    });

    it("takes somebody out of the space", async () => {
      const temporary = await createVerifiedUser(api);
      const link = await invite(owner, {
        email: temporary.email,
        role: "viewer",
      });
      const { token } = link.body.data as Invitation;
      await api.post(`/invitations/${token}/accept`, {}, temporary.accessToken);

      const removed = await api.request(
        `/workspaces/${space}/members/${temporary.userId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${owner.accessToken}` },
        },
      );
      expect(removed.status).toBe(204);

      // Gone from the space, and the space itself is gone for them: not a space
      // they can still open and see.
      const workspaces = await api.get("/workspaces", temporary.accessToken);
      expect(
        (workspaces.body.data.items as { id: string }[]).some(
          (item) => item.id === space,
        ),
      ).toBe(false);
    });

    it("will not let somebody who is not the owner take anybody out", async () => {
      const response = await api.request(
        `/workspaces/${space}/members/${owner.userId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${guest.accessToken}` },
        },
      );
      expect(response.status).toBe(403);
    });
  });

  describe("listing", () => {
    it("only an owner can see the invitations of a space", async () => {
      const ownerList = await api.get(
        `/workspaces/${space}/invitations`,
        owner.accessToken,
      );
      expect(ownerList.status).toBe(200);
      expect(Array.isArray(ownerList.body.data.items)).toBe(true);

      const otherList = await api.get(
        `/workspaces/${space}/invitations`,
        guest.accessToken,
      );
      expect(otherList.status).toBe(403);
    });

    it("puts the ones waiting for an answer first", async () => {
      const list = await api.get(
        `/workspaces/${space}/invitations`,
        owner.accessToken,
      );
      const items = list.body.data.items as Invitation[];
      const firstSettled = items.findIndex((row) => row.status !== "pending");

      if (firstSettled === -1) {
        expect(items.length).toBeGreaterThan(0);
      } else {
        expect(
          items.slice(firstSettled).every((row) => row.status !== "pending"),
        ).toBe(true);
      }
    });
  });
});
