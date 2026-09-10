import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
mock.module("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: async () => ({ data: null, error: null }) },
    signIn: { email: async () => ({ data: null, error: null }) },
    signOut: async () => ({ data: null, error: null }),
  },
}));

const { default: AuthForm } = await import("./auth-form");
const { default: LogoutForm } = await import("./logout-form");

describe("authentication pages", () => {
  it("renders Swedish registration and login forms with safe password fields", () => {
    const register = renderToStaticMarkup(<AuthForm mode="register" />);
    const login = renderToStaticMarkup(<AuthForm mode="login" />);
    expect(register).toContain("Skapa konto");
    expect(register).toContain("Bekräfta lösenord");
    expect(register).toContain('autoComplete="new-password"');
    expect(login).toContain("Logga in");
    expect(login).not.toContain("DATABASE_URL");
    expect(login).toContain('autoComplete="current-password"');
    expect(register).not.toContain("Candidate");
    expect(register).not.toContain("DATABASE_URL");
    expect(register).not.toContain("BETTER_AUTH_SECRET");
  });

  it("renders a keyboard-accessible logout control", () => {
    const html = renderToStaticMarkup(<LogoutForm />);
    expect(html).toContain("Logga ut");
    expect(html).toContain('type="button"');
  });
});
