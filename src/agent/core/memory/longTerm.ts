import prisma from "../../../database/prisma";
import type { LongTermProfile } from "../types";

export async function loadLongTermProfile(
  customerPhone: string,
): Promise<LongTermProfile> {
  const [memory, profile] = await Promise.all([
    prisma.customerMemory.findUnique({
      where: { customer_phone: customerPhone },
      select: { summary: true },
    }),
    prisma.customerKnowledgeProfile.findUnique({
      where: { customer_phone: customerPhone },
      select: {
        learnings: true,
        preferred_phrases: true,
        common_objections: true,
        success_patterns: true,
      },
    }),
  ]);

  return {
    summary: memory?.summary ?? null,
    preferredPhrases: profile?.preferred_phrases ?? [],
    commonObjections: profile?.common_objections ?? [],
    successPatterns: profile?.success_patterns ?? [],
    learnings: parseLearnings(profile?.learnings),
  };
}

export async function saveLongTermProfile(
  customerPhone: string,
  profile: LongTermProfile,
): Promise<void> {
  await Promise.all([
    prisma.customerMemory.upsert({
      where: { customer_phone: customerPhone },
      update: { summary: profile.summary ?? "" },
      create: {
        customer_phone: customerPhone,
        summary: profile.summary ?? "",
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    }),
    prisma.customerKnowledgeProfile.upsert({
      where: { customer_phone: customerPhone },
      update: {
        preferred_phrases: profile.preferredPhrases,
        common_objections: profile.commonObjections,
        success_patterns: profile.successPatterns,
        learnings: JSON.stringify(profile.learnings),
        last_updated_by: "REACT_ENGINE",
      },
      create: {
        customer_phone: customerPhone,
        preferred_phrases: profile.preferredPhrases,
        common_objections: profile.commonObjections,
        success_patterns: profile.successPatterns,
        learnings: JSON.stringify(profile.learnings),
        last_updated_by: "REACT_ENGINE",
        auto_updates: true,
      },
    }),
  ]);
}

function parseLearnings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
