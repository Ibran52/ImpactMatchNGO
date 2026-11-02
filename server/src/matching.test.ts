import { describe, expect, it } from "vitest";
import { rankVolunteerMatches } from "./matching.js";

describe("rankVolunteerMatches", () => {
  it("ranks opportunities with explainable city, cause, and skill matches", () => {
    const matches = rankVolunteerMatches(
      { city: "Pune", skills: ["teaching"], interests: ["education"], categories: [] },
      [
        {
          _id: { toString: () => "nearby" },
          title: "Teaching reading skills",
          description: "Help children with reading at a local learning centre.",
          category: "Education",
          city: "Pune",
        },
        {
          _id: { toString: () => "unrelated" },
          title: "Restore a city park",
          description: "Help care for local trees and green spaces.",
          category: "Environment",
          city: "Mumbai",
        },
      ],
    );

    expect(matches[0]).toEqual({
      needId: "nearby",
      score: 85,
      reasons: [
        "Located in Pune",
        "Matches your interests in Education",
        "Uses your related skills or interests: teaching",
      ],
    });
    expect(matches[1]).toEqual({
      needId: "unrelated",
      score: 0,
      reasons: ["No matching profile details; shown among the latest open opportunities."],
    });
  });
});
