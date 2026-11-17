import type { ActResult, Substrate, SubstrateView } from "@abubakarsiddiik/substrate";

/** The substrate surface the QA runner needs. `Substrate` satisfies it. */
export type QaSubstrate = Pick<Substrate, "view" | "goto" | "act" | "read" | "state"> & {
  screenshot?(): Promise<Uint8Array | undefined>;
  close?(): Promise<void>;
};

export type QaView = SubstrateView;
export type QaActResult = ActResult;
