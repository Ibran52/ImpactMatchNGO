import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { services } from "./api";

vi.mock("./api", () => ({
  services: {
    auth: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
    needs: { list: vi.fn(), join: vi.fn(), create: vi.fn() },
    ngos: { list: vi.fn(), detail: vi.fn() },
    impact: { overview: vi.fn(), mine: vi.fn(), contributions: vi.fn() },
    payments: { createOrder: vi.fn(), verify: vi.fn() },
    notifications: { unreadCount: vi.fn() },
    profile: { update: vi.fn() },
    verification: { upload: vi.fn() },
    volunteer: { dashboard: vi.fn(), applications: vi.fn(), recommendations: vi.fn() },
    ngo: { dashboard: vi.fn() },
    admin: { overview: vi.fn(), operations: vi.fn(), pendingOrganizations: vi.fn(), reviewOrganization: vi.fn() },
  },
}));

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>);
}

describe("ImpactMatch home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(services.auth.me).mockResolvedValue(null);
    vi.mocked(services.notifications.unreadCount).mockResolvedValue(0);
    vi.mocked(services.impact.overview).mockResolvedValue({
      totalNgos: 0,
      verifiedNgos: 0,
      pendingNgos: 0,
      volunteers: 0,
      users: 0,
      fundsRaised: 0,
      activeTasks: 1,
      completedHelpRequests: 0,
      participatingCities: 0,
      donationMonths: [],
      userMonths: [],
      causes: [],
    });
    vi.mocked(services.admin.overview).mockResolvedValue({
      totalNgos: 0,
      verifiedNgos: 0,
      pendingNgos: 0,
      volunteers: 0,
      users: 0,
      fundsRaised: 0,
      activeTasks: 0,
      completedHelpRequests: 0,
      participatingCities: 0,
      donationMonths: [],
      userMonths: [],
      causes: [],
    });
    vi.mocked(services.admin.operations).mockResolvedValue({
      integrations: {},
      cases: { flaggedRequests: 0, escalatedAssignments: 0, disputedPickups: 0, disputedItemDonations: 0, refundRequiredPayments: 0 },
    });
    vi.mocked(services.admin.pendingOrganizations).mockResolvedValue([]);
    vi.mocked(services.ngos.list).mockResolvedValue([]);
    vi.mocked(services.needs.list).mockResolvedValue([{
      id: "sample-need",
      title: "A reading buddy for Saturday mornings",
      description: "Read with children at our neighbourhood learning space.",
      kind: "volunteer",
      category: "Education",
      city: "Pune",
      organizationName: "Udaan Learning Collective",
      organizationVerified: true,
      volunteersNeeded: 8,
      volunteersJoined: 5,
      urgency: "medium",
      createdAt: new Date().toISOString(),
    }]);
  });

  it("shows a real volunteer opportunity and its verified organization", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "A reading buddy for Saturday mornings" })).toBeVisible();
    expect(screen.getByText("Udaan Learning Collective")).toBeVisible();
    expect(screen.getByRole("link", { name: /View opportunity/ })).toBeVisible();
  });

  it("asks visitors to sign in before applying", async () => {
    renderApp();
    const opportunityLinks = await screen.findAllByRole("link", { name: "Find Opportunities" });
    fireEvent.click(opportunityLinks[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Apply as Volunteer/ }));
    expect(await screen.findByText("Sign in to apply for an opportunity.")).toBeVisible();
  });

  it("offers separate help-seeker, volunteer, and NGO registration routes", async () => {
    window.history.replaceState({}, "", "/register");
    renderApp();
    await screen.findByRole("heading", { name: "Create an account" });
    const links = screen.getAllByRole("link");
    expect(links.some((link) => link.getAttribute("href") === "/register/user")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "/register/volunteer")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "/register/ngo")).toBe(true);
  });

  it("submits NGO registration and confirms creation before optional uploads", async () => {
    const organization = {
      id: "qa-ngo",
      name: "QA Community Support",
      email: "qa-ngo@example.invalid",
      role: "ngo" as const,
      city: "Pune",
      organizationStatus: "pending_review" as const,
    };
    vi.mocked(services.auth.register).mockResolvedValue(organization);
    window.history.replaceState({}, "", "/register/ngo");
    renderApp();

    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: organization.name } });
    fireEvent.change(screen.getByLabelText("Your city"), { target: { value: organization.city } });
    fireEvent.change(screen.getByLabelText("Organization mission"), { target: { value: "Supporting families in our local community." } });
    fireEvent.change(screen.getByLabelText("Causes (comma-separated)"), { target: { value: "Food" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: organization.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "qa-only-password" } });
    fireEvent.change(screen.getByLabelText("Registration type"), { target: { value: "Trust" } });
    fireEvent.change(screen.getByLabelText("Registration number"), { target: { value: "QA-REG-1" } });
    fireEvent.change(screen.getByLabelText("Official contact phone"), { target: { value: "9999999999" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "1 Test Road" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Maharashtra" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "411001" } });
    fireEvent.change(screen.getByLabelText("Service area"), { target: { value: "Pune" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    fireEvent.click(await screen.findByRole("button", { name: /Create your account/ }));
    await waitFor(() => expect(services.auth.register).toHaveBeenCalledWith(expect.objectContaining({
      name: organization.name,
      email: organization.email,
      role: "ngo",
      city: organization.city,
      categories: ["Food"],
      registrationNumber: "QA-REG-1",
    })));
    expect(await screen.findAllByText("NGO account created. Your application is submitted for review.")).not.toHaveLength(0);
  });

  it("submits login credentials after registration-only validation is bypassed", async () => {
    const user = { id: "qa-admin", name: "QA Admin", email: "qa-admin@example.invalid", role: "admin" as const, city: "Pune" };
    vi.mocked(services.auth.login).mockResolvedValue(user);
    window.history.replaceState({}, "", "/login");
    renderApp();
    fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), {
      target: { value: user.email },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "QA-only-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(services.auth.login).toHaveBeenCalledWith(user.email, "QA-only-password"));
  });
});
