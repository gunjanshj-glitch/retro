import { ApiError } from "@retro/api-client";

/** Plain wording for any failure; the server's message is already written for travellers. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}
