import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { mockFetch } from "@/test/mock-fetch";

import { LoginForm, validateLogin } from "./login-form";

describe("login validation", () => {
  it("requires a valid email and a password", () => {
    expect(validateLogin("", "")).toEqual({ email: "Enter your email.", password: "Enter your password." });
    expect(validateLogin("not-an-email", "x").email).toBe("Enter a valid email address.");
    expect(validateLogin("a@b.co", "x")).toEqual({});
  });
});

describe("LoginForm", () => {
  it("shows field errors without calling the server", async () => {
    const { fn } = mockFetch({});
    render(<LoginForm onSignedIn={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
  });

  it("shows the server's message on bad credentials", async () => {
    mockFetch({
      "POST /api/auth/login": () => ({
        status: 401,
        body: { error: { code: "invalid_credentials", message: "Email or password is incorrect." } },
      }),
    });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("signs in", async () => {
    const user = { id: "1", email: "a@example.com", display_name: "A", role: "reviewer" };
    const { calls } = mockFetch({ "POST /api/auth/login": { user, csrf_token: "t" } });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Email"), " a@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user));
    expect(calls[0]!.body).toEqual({ email: "a@example.com", password: "correct-password" });
  });
});
