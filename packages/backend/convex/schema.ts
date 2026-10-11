import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// ponytail: każdy wiersz trzyma cały obiekt domenowy w polu `data` (v.any) — tak jak
// dawny plugin-store trzymał tablice JSON. Nie potrzebujemy zapytań po polach: zawsze
// ładujemy komplet per user i filtrujemy po stronie klienta (jak oryginał).
export default defineSchema({
  ...authTables,

  settings: defineTable({
    userId: v.id("users"),
    data: v.any(), // Settings
  }).index("by_user", ["userId"]),

  tracks: defineTable({
    userId: v.id("users"),
    domainId: v.string(), // Track.id (crypto.randomUUID)
    data: v.any(), // Track
  })
    .index("by_user", ["userId"])
    .index("by_user_domain", ["userId", "domainId"]),

  library: defineTable({
    userId: v.id("users"),
    domainId: v.string(), // LibraryDoc.id
    data: v.any(), // LibraryDoc
  })
    .index("by_user", ["userId"])
    .index("by_user_domain", ["userId", "domainId"]),

  personas: defineTable({
    userId: v.id("users"),
    data: v.any(), // Persona
  }).index("by_user", ["userId"]),

  albums: defineTable({
    userId: v.id("users"),
    data: v.any(), // Album (jeden aktywny wiersz per user)
  }).index("by_user", ["userId"]),
});
