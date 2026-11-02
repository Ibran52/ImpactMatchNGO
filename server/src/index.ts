import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { Need, User } from "./models.js";
import { createAdminFromEnvironment, expireDonationReservations } from "./routes.js";

async function seedExamples() {
  const organizations = [
    { name: "Udaan Learning Collective", email: "hello@udaan-demo.impactmatch.org", city: "Pune", categories: ["education"], serviceArea: "Pune" },
    { name: "GreenSteps Pune", email: "team@greensteps-demo.impactmatch.org", city: "Pune", categories: ["other"], serviceArea: "Pune" },
    { name: "Sahara Community Kitchen", email: "care@sahara-demo.impactmatch.org", city: "Mumbai", categories: ["food"], serviceArea: "Mumbai, Thane" },
    { name: "Swasthya Neighbourhood Trust", email: "connect@swasthya-demo.impactmatch.org", city: "Bengaluru", categories: ["medical_assistance"], serviceArea: "Bengaluru" },
  ];
  const docs = await Promise.all(organizations.map(async (organization) => {
    const { categories, serviceArea, ...profile } = organization;
    const user = await User.findOneAndUpdate(
      { email: organization.email },
      {
        $set: { categories, serviceArea },
        $setOnInsert: {
          ...profile,
          passwordHash: await bcrypt.hash(randomUUID(), 12),
          role: "ngo",
          organizationStatus: "verified",
        },
      },
      { upsert: true, new: true },
    );
    return user._id;
  }));
  if (await Need.exists({})) return;
  await Need.insertMany([
    {
      title: "A reading buddy for Saturday mornings",
      description: "Spend two relaxed hours reading and learning with children at our neighbourhood learning space. No teaching experience needed, just a little patience and a love of stories.",
      kind: "volunteer", category: "Education", city: "Pune", organizationId: docs[0],
      urgency: "medium", volunteersNeeded: 8, volunteersJoined: 0,
    },
    {
      title: "A warmer meal, shared with care",
      description: "Help us keep our community kitchen stocked with fresh ingredients for nutritious evening meals. Every contribution helps our neighbours eat well this week.",
      kind: "donation", category: "Food & essentials", city: "Mumbai", organizationId: docs[2],
      urgency: "high", targetAmount: 25000, raisedAmount: 0,
    },
    {
      title: "Let’s bring the riverbank back to life",
      description: "Join a friendly Sunday morning cleanup and native sapling planting along the Mula river. Gloves, tools, and snacks are on us. Bring a friend and comfortable shoes.",
      kind: "volunteer", category: "Environment", city: "Pune", organizationId: docs[1],
      urgency: "low", volunteersNeeded: 16, volunteersJoined: 0,
    },
    {
      title: "Help a clinic reach more families",
      description: "Your support helps our mobile health team bring basic check-ups, health education, and essential supplies to underserved neighbourhoods this month.",
      kind: "donation", category: "Health", city: "Bengaluru", organizationId: docs[3],
      urgency: "medium", targetAmount: 40000, raisedAmount: 0,
    },
    {
      title: "Make the community garden bloom",
      description: "Help local families grow fresh food together. We need friendly hands to prepare garden beds, share seed kits, and welcome first-time growers.",
      kind: "volunteer", category: "Community", city: "Mumbai", organizationId: docs[2],
      urgency: "medium", volunteersNeeded: 10, volunteersJoined: 0,
    },
    {
      title: "School kits for a confident first day",
      description: "Help students start the new term ready to learn. Your contribution supplies notebooks, pencils, and art materials for children in our after-school programme.",
      kind: "donation", category: "Education", city: "Pune", organizationId: docs[0],
      urgency: "high", targetAmount: 18000, raisedAmount: 0,
    },
  ]);
  console.info("Added six sample community opportunities.");
}

async function ensureGeospatialIndex(field: "ngoLocation" | "volunteerLocation") {
  try {
    await User.collection.createIndex({ [field]: "2dsphere" });
  } catch (error) {
    if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 16755) throw error;
    console.warn(`Unable to create ${field} geospatial index because a legacy location is malformed; location matching will use its non-geospatial fallback.`);
  }
}

async function start() {
  await mongoose.connect(config.MONGODB_URI);
  await ensureGeospatialIndex("ngoLocation");
  await ensureGeospatialIndex("volunteerLocation");
  if (config.NODE_ENV === "development") await seedExamples();
  await createAdminFromEnvironment();
  const reservationSweep = setInterval(() => {
    void expireDonationReservations().catch((error: unknown) => {
      console.error("Unable to release expired donation reservations:", error instanceof Error ? error.name : "Unknown error");
    });
  }, 60_000);
  reservationSweep.unref();
  await expireDonationReservations();
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.info(`Impact Match API listening on http://localhost:${config.PORT}`);
  });
  const shutdown = async () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error: unknown) => {
  if (error instanceof mongoose.mongo.MongoServerError) {
    console.error("Unable to start Impact Match API:", {
      name: error.name,
      code: error.code,
      codeName: error.codeName,
      stackFrames: error.stack?.split("\n").slice(1, 6),
    });
  } else {
    console.error("Unable to start Impact Match API:", error instanceof Error ? error.name : "Unknown error");
  }
  process.exitCode = 1;
});
