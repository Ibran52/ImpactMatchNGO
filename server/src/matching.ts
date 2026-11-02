import type { NeedDocument, UserDocument } from "./models.js";

type MatchNeed = Pick<NeedDocument, "title" | "description" | "category" | "city"> & { _id: { toString(): string } };

export type VolunteerMatch = {
  needId: string;
  score: number;
  reasons: string[];
};

function normalize(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(values: string[]): Set<string> {
  return new Set(values.flatMap((value) => normalize(value).split(/\s+/)).filter((token) => token.length >= 3));
}

export function rankVolunteerMatches(
  profile: Pick<UserDocument, "city" | "skills" | "interests" | "categories">,
  needs: MatchNeed[],
): VolunteerMatch[] {
  const preferences = tokens([...(profile.skills ?? []), ...(profile.interests ?? []), ...(profile.categories ?? [])]);
  return needs.map((need) => {
    const reasons: string[] = [];
    let score = 0;
    if (normalize(profile.city) === normalize(need.city)) {
      score += 35;
      reasons.push(`Located in ${need.city}`);
    }

    const cause = tokens([need.category]);
    if ([...cause].some((word) => preferences.has(word))) {
      score += 40;
      reasons.push(`Matches your interests in ${need.category}`);
    }

    const opportunityTerms = tokens([need.title, need.description]);
    const skillMatches = [...preferences].filter((word) => opportunityTerms.has(word));
    if (skillMatches.length) {
      score += Math.min(25, 10 + (skillMatches.length - 1) * 5);
      reasons.push(`Uses your related skills or interests: ${skillMatches.slice(0, 3).join(", ")}`);
    }
    if (reasons.length === 0) {
      reasons.push("No matching profile details; shown among the latest open opportunities.");
    }
    return { needId: need._id.toString(), score: Math.min(score, 100), reasons };
  }).sort((left, right) => right.score - left.score);
}
