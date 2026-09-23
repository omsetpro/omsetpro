import type { Address } from "viem";

export type AgreementRole = "Owner" | "Borrower" | "Arbiter";

export const agreementQueryKeys = {
  all: ["omsetpro", "agreements"] as const,
  discovery: (address?: Address) =>
    ["omsetpro", "agreements", "discovery", address] as const,
  detail: (agreementId: bigint) =>
    ["omsetpro", "agreements", "detail", agreementId.toString()] as const,
};
