import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const wallet1 = accounts.get("wallet_1")!;

describe("analytics-tracker", () => {
  it("tracks page views", () => {
    const receipt = simnet.callPublicFn(
      "analytics-tracker",
      "track-page-view",
      [Cl.stringAscii("demo-project"), Cl.stringUtf8("/pricing")],
      wallet1
    );

    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("tracks actions and conversions", () => {
    const action = simnet.callPublicFn(
      "analytics-tracker",
      "track-action",
      [
        Cl.stringAscii("demo-project"),
        Cl.stringAscii("button_click"),
        Cl.stringUtf8("start-trial"),
      ],
      wallet1
    );

    const conversion = simnet.callPublicFn(
      "analytics-tracker",
      "track-conversion",
      [Cl.stringAscii("demo-project"), Cl.stringAscii("signup"), Cl.uint(1)],
      wallet1
    );

    expect(action.result).toBeOk(Cl.bool(true));
    expect(conversion.result).toBeOk(Cl.bool(true));
  });

  it("exposes contract metadata", () => {
    const info = simnet.callReadOnlyFn(
      "analytics-tracker",
      "get-contract-info",
      [],
      wallet1
    );

    expect(info.result).toBeOk(
      Cl.tuple({
        contract: Cl.stringAscii("analytics-tracker"),
        version: Cl.stringAscii("1.0.0"),
        stateless: Cl.bool(true),
      })
    );
  });
});
