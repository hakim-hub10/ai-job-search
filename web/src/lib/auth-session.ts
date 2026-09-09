import "server-only";

import { headers } from "next/headers";

import { getAuth } from "./auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** Returns the minimum verified identity projection; client IDs are never accepted. */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
  };
}
