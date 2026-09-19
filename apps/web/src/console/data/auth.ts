import type { ConsoleAuth } from "./port";
export function createFixtureAuth(initiallySignedIn = true): ConsoleAuth {
  let signedIn = initiallySignedIn;
  return {
    async session() { return signedIn; },
    async signIn() { signedIn = true; },
    async signOut() { signedIn = false; },
  };
}
