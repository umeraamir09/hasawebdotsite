// Isolated browser helper. No production route imports this module.
import { readOwner } from "../lib/auth-client";
import {
  leaveForRecovery,
  signInForRecovery,
} from "../lib/draft/auth-recovery";
import { createDraftController } from "../lib/draft/controller";
import { createRecoveryStorage } from "../lib/draft/recovery";
import { createRecoveryCoordinator } from "../lib/draft/recovery-coordinator";

Object.assign(window, {
  recoveryFixture: {
    async prepareReview() {
      const owner = await readOwner();
      if (!owner?.portfolio)
        throw new Error("Fixture needs a signed-in portfolio");
      const storage = createRecoveryStorage(owner.user.id, owner.portfolio.id);
      for (const record of await storage.list(
        owner.user.id,
        owner.portfolio.id,
      ))
        await storage.remove(record.id, record);
      const controller = createDraftController({
        ownerId: owner.user.id,
        portfolioId: owner.portfolio.id,
        context: "content",
        storage,
      });
      await controller.initialize();
      controller.edit(["profile", "name"], "Preserved review after auth");
      controller.setInput(["requestedSubdomain"], "unfinished-review-");
      const newer = await fetch("/api/owner/draft/patch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Expected-Owner-Id": owner.user.id,
        },
        body: JSON.stringify({
          context: "content",
          revision: controller.store.getState().confirmed?.revision,
          change: {
            op: "set",
            path: ["profile", "bio"],
            value: "Newer content before review sign-in",
          },
        }),
      });
      if (!newer.ok) throw new Error("Fixture competing save failed");
      await controller.flushValid().catch(() => {});
      const recovery = createRecoveryCoordinator({
        ownerId: owner.user.id,
        portfolioId: owner.portfolio.id,
        context: "content",
        storage,
        controller,
      });
      await recovery.start();
      const item = recovery.store
        .getState()
        .items.find((entry) => entry.path.at(-1) === "name");
      if (!item) throw new Error("Fixture review item missing");
      await recovery.select(item.id, true);
      const expired = await fetch("/__fixture/expire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!expired.ok) throw new Error("Fixture expiry failed");
      await recovery.apply().catch(() => {});
      if (recovery.store.getState().error !== "unauthorized")
        throw new Error("Expected review session expiry");
      const record = recovery.store.getState().review;
      if (!record) throw new Error("Fixture review checkpoint missing");
      await signInForRecovery(record, "github");
    },
    async prepare(provider: "github" | "google", clean = false) {
      const owner = await readOwner();
      if (!owner?.portfolio)
        throw new Error("Fixture needs a signed-in portfolio");
      const storage = createRecoveryStorage(owner.user.id, owner.portfolio.id);
      for (const record of await storage.list(
        owner.user.id,
        owner.portfolio.id,
      ))
        await storage.remove(record.id, record);
      const controller = createDraftController({
        ownerId: owner.user.id,
        portfolioId: owner.portfolio.id,
        context: "content",
        storage,
      });
      await controller.initialize().catch(async (error) => {
        // Earlier auth regressions deliberately leave this shared fixture owner
        // with an unvalidated email. Correct it through the real bounded API
        // before starting the independent expired-session journey.
        if (controller.store.getState().error !== "validation_required")
          throw error;
        await controller.validateLegacy();
        if (
          controller.store.getState().validation?.issue?.code ===
          "invalid_destination"
        )
          await controller.validateLegacy("recovery@example.test");
        if (controller.store.getState().status !== "saved")
          throw new Error("Fixture validation did not finish");
      });
      if (!clean) {
        controller.edit(["profile", "name"], `Recovered with ${provider}`);
        controller.setInput(["requestedSubdomain"], `unfinished-${provider}-`);
      }
      const expired = await fetch("/__fixture/expire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!expired.ok) throw new Error("Could not expire fixture session");
      if (clean) {
        // Model expiry before the first successful draft read for Google.
        if (provider === "google")
          controller.store.setState({
            confirmed: null,
            working: null,
            progress: null,
          });
        await controller.initialize().catch(() => {});
      } else await controller.flushValid().catch(() => {});
      if (controller.store.getState().error !== "unauthorized")
        throw new Error("Expected expired session");
      await leaveForRecovery(controller, provider);
    },
  },
});
