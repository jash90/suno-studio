/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as album from "../album.js";
import type * as archive from "../archive.js";
import type * as auth from "../auth.js";
import type * as balances from "../balances.js";
import type * as cover from "../cover.js";
import type * as generate from "../generate.js";
import type * as http from "../http.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_trackRows from "../lib/trackRows.js";
import type * as library from "../library.js";
import type * as personas from "../personas.js";
import type * as settings from "../settings.js";
import type * as suno from "../suno.js";
import type * as tracks from "../tracks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  album: typeof album;
  archive: typeof archive;
  auth: typeof auth;
  balances: typeof balances;
  cover: typeof cover;
  generate: typeof generate;
  http: typeof http;
  "lib/llm": typeof lib_llm;
  "lib/trackRows": typeof lib_trackRows;
  library: typeof library;
  personas: typeof personas;
  settings: typeof settings;
  suno: typeof suno;
  tracks: typeof tracks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
