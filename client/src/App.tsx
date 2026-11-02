import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Toaster, toast } from "sonner";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, BookOpen,
  Building2, CalendarDays, Check, CircleHelp, ClipboardCheck,
  Compass, Download, FileCheck2, FileText, Filter, Globe2, Heart, HeartHandshake,
  LayoutDashboard, LogOut, MapPin, Menu, Plus, Search, Settings, Clock, Upload, Play, TriangleAlert,
  ShieldCheck, Sprout, Target, Users, Wallet, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { services } from "./api";
import type {
  AssignmentEvidence,
  CompletionAiReview,
  Contribution,
  HelpRequestCategory,
  HelpRequestStatus,
  NgoMatch,
  NgoCompletionReviewSummary,
  Overview,
  VolunteerTaskOffer,
  ItemDonation,
  ItemPickupOffer,
} from "./api";
import type { AdminOrganization, Need, NeedInput, User, VerificationDocumentKind } from "./types";
import {
  Button, ContributorRow, EmptyState, ErrorState, FilterCheckbox, ImageFrame,
  LoadingCards, OpportunityCard, OrganizationCard, PageHeader, photos, StatCard, StatusBadge,
} from "./components";

type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type VolunteerDashboardData = Awaited<ReturnType<typeof services.volunteer.dashboard>>;
type NgoDashboardData = Awaited<ReturnType<typeof services.ngo.dashboard>>;
type OverviewQueryData = Overview;
type ContributionsQueryData = Contribution[];

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: "payment.failed", callback: (result: { error?: { description?: string } }) => void) => void;
    };
  }
}

const categories = ["Education", "Health", "Environment", "Food & essentials", "Women Empowerment", "Animal Welfare", "Community"];
const queryKeys = {
  user: ["me"] as const,
  needs: ["needs"] as const,
  organizations: ["ngos"] as const,
  impact: ["impact"] as const,
  overview: ["impact-overview"] as const,
  volunteer: ["volunteer-dashboard"] as const,
  ngo: ["ngo-dashboard"] as const,
  admin: ["admin-overview"] as const,
  verification: ["admin-verification"] as const,
  contributions: ["contributions"] as const,
};

function dashboardPath(role?: string) {
  if (role === "user") return "/user/dashboard";
  if (role === "ngo") return "/ngo/dashboard";
  if (role === "admin") return "/admin/dashboard";
  if (role === "donor") return "/donor/dashboard";
  return "/volunteer/dashboard";
}

function App() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const userQuery = useQuery({ queryKey: queryKeys.user, queryFn: services.auth.me, retry: 1 });
  const user = userQuery.data ?? null;
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  const logout = useMutation({
    mutationFn: services.auth.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.user });
      toast.success("You’re signed out.");
    },
    onError: (error) => toast.error(error.message),
  });

  return <div className="app-shell">
    <Toaster position="top-right" richColors closeButton />
    <PublicNavbar user={user} onLogout={() => logout.mutate()} />
    <main>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/ngos" element={<OrganizationDirectory />} />
        <Route path="/ngos/:id" element={<OrganizationDetail />} />
        <Route path="/opportunities" element={<OpportunityDirectory user={user} />} />
        <Route path="/opportunities/:id" element={<OpportunityDetail user={user} />} />
        <Route path="/donate" element={<OpportunityDirectory user={user} kind="donation" />} />
        <Route path="/donate/:id" element={<DonationPage user={user} />} />
        <Route path="/campaigns/:id" element={<DonationPage user={user} />} />
        <Route path="/items" element={<ItemDonationPortal user={user} />} />
        <Route path="/login" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <RegistrationChooser />} />
        <Route path="/register/user" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <AuthPage mode="register" forcedRole="user" />} />
        <Route path="/register/volunteer" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <AuthPage mode="register" forcedRole="volunteer" />} />
        <Route path="/register/ngo" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <AuthPage mode="register" ngoOnly forcedRole="ngo" />} />
        <Route path="/register/donor" element={user ? <Navigate to={dashboardPath(user.role)} replace /> : <AuthPage mode="register" forcedRole="donor" />} />
        <Route path="/ngo/register" element={<Navigate to="/register/ngo" replace />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/map" element={<NearbyOrganizations />} />
        <Route path="/impact" element={<ImpactAnalytics />} />
        <Route path="/volunteer/*" element={<DashboardPortal role="volunteer" user={user} loading={userQuery.isLoading} />} />
        <Route path="/ngo/*" element={<DashboardPortal role="ngo" user={user} loading={userQuery.isLoading} />} />
        <Route path="/donor/*" element={<DashboardPortal role="donor" user={user} loading={userQuery.isLoading} />} />
        <Route path="/user/*" element={<DashboardPortal role="user" user={user} loading={userQuery.isLoading} />} />
        <Route path="/admin/*" element={<DashboardPortal role="admin" user={user} loading={userQuery.isLoading} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>
    <PublicFooter />
  </div>;
}

function PublicNavbar({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="public-header">
    <div className="nav-inner">
      <Link to="/" className="logo" aria-label="ImpactMatch NGO home"><span className="logo-mark"><HeartHandshake size={18} /></span><span>ImpactMatch<span className="logo-accent">NGO</span></span></Link>
      <button className="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      <nav className={`public-nav ${menuOpen ? "is-open" : ""}`}>
        <Link to="/" onClick={() => setMenuOpen(false)}>Home</Link>
        <Link to="/ngos" onClick={() => setMenuOpen(false)}>NGOs</Link>
        <Link to="/opportunities" onClick={() => setMenuOpen(false)}>Volunteer</Link>
        <Link to="/donate" onClick={() => setMenuOpen(false)}>Donate</Link>
        <Link to="/about" onClick={() => setMenuOpen(false)}>About</Link>
      </nav>
      <div className="nav-actions">{user ? <>
        <Link to={dashboardPath(user.role)} className="nav-user"><span>{user.name.slice(0, 1).toUpperCase()}</span><strong>{user.name.split(" ")[0]}</strong></Link>
        <button className="icon-button logout-button" onClick={onLogout} aria-label="Log out"><LogOut size={16} /></button>
      </> : <>
        <Link to="/login" className="nav-login">Login</Link>
        <Link to="/register" className="button button-primary button-compact">Sign Up</Link>
      </>}</div>
    </div>
  </header>;
}

function PublicFooter() {
  return <footer className="public-footer">
    <div className="footer-inner">
      <div className="footer-about"><Link to="/" className="logo"><span className="logo-mark"><HeartHandshake size={18} /></span><span>ImpactMatch<span className="logo-accent">NGO</span></span></Link><p>Small acts create big change. Find trusted local causes and make your next good thing count.</p></div>
      <div className="footer-links"><strong>Explore</strong><Link to="/ngos">Verified NGOs</Link><Link to="/opportunities">Volunteer</Link><Link to="/donate">Donate</Link></div>
      <div className="footer-links"><strong>Get involved</strong><Link to="/ngo/register">Register an NGO</Link><Link to="/about">About us</Link><a href="mailto:hello@impactmatch.org">Contact</a></div>
      <div className="footer-note"><ShieldCheck size={17} /><span>Every organization on our platform is reviewed by our team.</span></div>
    </div>
    <div className="footer-bottom"><span>© 2026 ImpactMatchNGO</span><span>Built for a more connected community.</span></div>
  </footer>;
}

function HomePage() {
  const overview = useQuery({ queryKey: queryKeys.overview, queryFn: services.impact.overview });
  const needs = useQuery({ queryKey: [...queryKeys.needs, "featured"], queryFn: () => services.needs.list() });
  const ngos = useQuery({ queryKey: [...queryKeys.organizations, "featured"], queryFn: () => services.ngos.list() });
  const featured = needs.data?.slice(0, 3) ?? [];
  const urgent = needs.data?.filter((need) => need.urgency === "high").slice(0, 3) ?? [];
  return <div>
    <section className="hero-section">
      <ImageFrame src={photos.hero} alt="Children learning together in a welcoming classroom" className="hero-photo" priority />
      <div className="hero-scrim" />
      <div className="hero-content page-container">
        <span className="eyebrow eyebrow-light"><span /> TOGETHER, WE CAN DO MORE</span>
        <h1>Small Acts<br />Create <span>Big Change</span></h1>
        <p>Connect with verified NGOs, volunteer your time, donate funds or items, and help create a better tomorrow.</p>
        <div className="hero-actions"><Link className="button button-primary" to="/opportunities">Find Opportunities <ArrowRight size={16} /></Link><Link className="button button-white" to="/donate">Make a Donation</Link></div>
      </div>
      <div className="hero-impact page-container">
        {overview.isLoading ? <span className="hero-metric-error" aria-live="polite">Loading community impact metrics…</span> : overview.isError || !overview.data ? <span className="hero-metric-error" aria-live="polite">Community impact metrics are temporarily unavailable.</span> : <>
          <div><strong>{overview.data?.verifiedNgos.toLocaleString("en-IN") ?? "—"}</strong><span>Verified NGOs</span></div>
          <div><strong>{overview.data?.volunteers.toLocaleString("en-IN") ?? "—"}</strong><span>Volunteers</span></div>
          <div><strong>₹{overview.data?.fundsRaised.toLocaleString("en-IN") ?? "—"}</strong><span>Funds Raised</span></div>
          <div><strong>{overview.data?.participatingCities.toLocaleString("en-IN") ?? "—"}</strong><span>Cities</span></div>
        </>}
      </div>
    </section>

    <section className="feature-strip page-container" aria-label="Ways to get involved">
      <Feature icon={<Users />} title="Volunteer" text="Share your skills" to="/opportunities" />
      <Feature icon={<Wallet />} title="Donate Money" text="Support causes" to="/donate" />
      <Feature icon={<Heart />} title="Donate Items" text="See what is available" to="/items" />
      <Feature icon={<Target />} title="Track Impact" text="See real change" to="/impact" />
    </section>

    <section className="section-block page-container">
      <PageHeader eyebrow="GOOD WORK, CLOSE TO HOME" title="Find an opportunity that matters." description="Real needs from verified organizations. Choose a cause and start where you are." action={<Link className="text-link" to="/opportunities">Explore all <ArrowRight size={15} /></Link>} />
      {needs.isLoading ? <LoadingCards /> : needs.isError ? <ErrorState description={needs.error.message} retry={() => needs.refetch()} /> : featured.length ? <div className="opportunity-grid">{featured.map((need) => <OpportunityCard key={need.id} need={need} />)}</div> : <EmptyState title="New opportunities are on their way." description="Check back soon for local ways to help." />}
    </section>

    {!!urgent.length && <section className="section-block page-container">
      <PageHeader eyebrow="COMMUNITY NEEDS" title="Help needed soon." description="These verified community opportunities are marked urgent." action={<Link className="text-link" to="/opportunities">See all needs <ArrowRight size={15} /></Link>} />
      <div className="opportunity-grid">{urgent.map((need) => <OpportunityCard key={need.id} need={need} />)}</div>
    </section>}

    <section className="section-block page-container">
      <PageHeader eyebrow="TRUSTED COMMUNITY PARTNERS" title="Meet the organizations behind the work." description="Get to know the reviewed NGOs creating change in their communities." action={<Link className="text-link" to="/ngos">Explore all NGOs <ArrowRight size={15} /></Link>} />
      {ngos.isLoading ? <LoadingCards count={3} /> : ngos.isError ? <ErrorState description={ngos.error.message} retry={() => ngos.refetch()} /> : ngos.data?.length ? <div className="organization-grid">{ngos.data.slice(0, 3).map((ngo) => <OrganizationCard key={ngo.id} ngo={ngo} />)}</div> : <EmptyState title="Verified organizations are joining." description="Check back soon to discover local community partners." />}
    </section>

    <section className="how-section">
      <div className="page-container how-grid"><div><span className="eyebrow">HOW IT WORKS</span><h2>Make giving<br />feel <span>personal.</span></h2><p>A clear path from wanting to help to knowing your contribution reached the people who need it.</p><Link className="button button-primary" to="/about">Our approach <ArrowRight size={15} /></Link></div>
        <div className="how-steps"><HowStep n="01" title="Find your cause" text="Explore vetted NGOs and local opportunities that feel right to you." /><HowStep n="02" title="Show up your way" text="Give time, make a contribution, or share what a community needs." /><HowStep n="03" title="See the difference" text="Follow your support and celebrate the progress you helped create." /></div>
      </div>
    </section>
    <section className="join-banner page-container"><div className="join-symbol"><Sprout size={24} /></div><div><span className="eyebrow eyebrow-light">YOUR COMMUNITY IS WAITING</span><h2>Ready to make someone’s day?</h2><p>Start with one small thing. We’ll take it from there, together.</p></div><Link to="/register" className="button button-white">Join the community <ArrowRight size={15} /></Link></section>
  </div>;
}

function Feature({ icon, title, text, to }: { icon: ReactNode; title: string; text: string; to: string }) {
  return <Link to={to} className="feature-item"><span className="feature-icon">{icon}</span><span><strong>{title}</strong><small>{text}</small></span><ArrowUpRight size={15} className="feature-arrow" /></Link>;
}

function HowStep({ n, title, text }: { n: string; title: string; text: string }) {
  return <article className="how-step"><span>{n}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowDown size={16} /></article>;
}

function OrganizationDirectory() {
  const [search, setSearch] = useState("");
  const [params] = useSearchParams();
  const [city, setCity] = useState(() => params.get("city") ?? "");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...queryKeys.organizations, search, city, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (city) params.set("city", city);
      if (category) params.set("category", category);
      return services.ngos.list(params);
    },
  });
  const sorted = useMemo(() => [...(query.data ?? [])].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : (b.activeTasks ?? 0) - (a.activeTasks ?? 0)), [query.data, sort]);
  const pageSize = 6;
  const pageCount = Math.ceil(sorted.length / pageSize);
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [search, city, category, sort]);
  return <section className="page-container directory-page">
    <div className="directory-search">
      <PageHeader eyebrow="THE PEOPLE MAKING IT HAPPEN" title="Meet the organizations." description="Discover verified local teams working on the causes you care about." />
      <form className="search-toolbar" onSubmit={(event) => event.preventDefault()}>
        <label className="field-with-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search NGOs, causes, or location…" aria-label="Search NGOs, causes, or location" /></label>
        <label className="field-with-icon location-select"><MapPin size={15} /><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="All locations" aria-label="Filter by city" /></label>
        <Button type="submit"><Search size={15} /> Search</Button>
      </form>
      <div className="category-tabs"><button className={!category ? "selected" : ""} onClick={() => setCategory("")}>All</button>{categories.slice(0, 5).map((item) => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(category === item ? "" : item)}>{item}</button>)}</div>
    </div>
    <div className="directory-layout">
      <aside className="filter-sidebar"><div className="filter-title"><Filter size={15} /> Filters <button onClick={() => { setCity(""); setCategory(""); setSort("name"); }}>Clear all</button></div>
        <label className="filter-heading">Location<input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Any city" /></label>
        <div className="filter-group"><strong>Cause</strong>{categories.slice(0, 5).map((item) => <FilterCheckbox key={item} label={item} checked={category === item} onChange={() => setCategory(category === item ? "" : item)} />)}</div>
        <div className="filter-group"><strong>NGO Verification</strong><span className="filter-note"><BadgeCheck size={14} /> All listed NGOs are verified.</span></div>
        <label className="filter-heading">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name A–Z</option><option value="tasks">Most active tasks</option></select></label>
        <div className="filter-note"><ShieldCheck size={15} /> Verified organizations are reviewed by our team.</div>
      </aside>
      <div className="directory-results"><div className="results-heading"><strong>{query.data?.length ?? 0} NGOs found</strong><span>Showing reviewed organizations</span></div>
        {query.isLoading ? <LoadingCards count={4} /> : query.isError ? <ErrorState description={query.error.message} retry={() => query.refetch()} /> : sorted.length ? <><div className="organization-grid">{visible.map((ngo) => <OrganizationCard key={ngo.id} ngo={ngo} />)}</div><Pagination page={page} pageCount={pageCount} onChange={setPage} /></> : <EmptyState title="No organizations match yet." description="Try a different city, cause, or search term." />}
      </div>
    </div>
  </section>;
}

function OrganizationDetail() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: [...queryKeys.organizations, id], queryFn: () => services.ngos.detail(id) });
  if (query.isLoading) return <section className="page-container detail-page"><LoadingCards count={1} /></section>;
  if (query.isError || !query.data) return <section className="page-container detail-page"><ErrorState title="Organization not available." description={query.error?.message ?? "This organization may no longer be listed."} retry={() => query.refetch()} /></section>;
  const { ngo, needs } = query.data;
  return <section className="page-container detail-page">
    <Breadcrumb items={[["Home", "/"], ["NGOs", "/ngos"], [ngo.name, ""]]} />
    <div className="ngo-detail-hero"><ImageFrame src={photos.volunteers} alt={`${ngo.name} community programs`} /><div className="ngo-detail-overlay"><StatusBadge status="success">Verified NGO</StatusBadge><h1>{ngo.name}</h1><p><MapPin size={15} /> {ngo.city} <span>·</span> {ngo.categories?.join(" · ") || "Community support"}</p><p>{ngo.description || "A verified local organization creating a lasting, positive impact in its community."}</p></div></div>
    <div className="detail-stat-row"><StatCard label="Open opportunities" value={needs.length} icon={<ClipboardCheck size={18} />} /><StatCard label="Volunteers" value={ngo.volunteerCount ?? 0} icon={<Users size={18} />} /><StatCard label="Funds raised" value={`₹${(ngo.fundsRaised ?? 0).toLocaleString("en-IN")}`} icon={<Wallet size={18} />} /></div>
    <PageHeader eyebrow="MAKE A DIFFERENCE" title="Ways to get involved" description={`See what ${ngo.name} needs from the community right now.`} />
    {needs.length ? <div className="opportunity-grid">{needs.map((need) => <OpportunityCard key={need.id} need={need} />)}</div> : <EmptyState title="No open opportunities right now." description="This verified organization hasn’t posted an active task yet." />}
  </section>;
}

function OpportunityDirectory({ user, kind }: { user: User | null; kind?: "donation" }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);
  const [params] = useSearchParams();
  const requestedKind = kind ?? (params.get("type") === "donation" ? "donation" : undefined);
  const query = useQuery({
    queryKey: [...queryKeys.needs, "directory", search, category, city, requestedKind],
    queryFn: () => {
      const filters = new URLSearchParams();
      if (search.trim()) filters.set("search", search.trim());
      if (category) filters.set("category", category);
      if (city) filters.set("city", city);
      return services.needs.list(filters);
    },
  });
  const results = query.data?.filter((item) => !requestedKind || item.kind === requestedKind) ?? [];
  const pageSize = 6;
  const pageCount = Math.ceil(results.length / pageSize);
  const visible = results.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [search, category, city, requestedKind]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: (id: string) => services.needs.join(id),
    onSuccess: async (result) => { toast.success(result.message); await queryClient.invalidateQueries(); },
    onError: (error) => toast.error(error.message),
  });
  const apply = (need: Need) => {
    if (need.kind !== "volunteer") {
      navigate(`/donate/${need.id}`);
      return;
    }
    if (!user) { toast.error("Sign in to apply for an opportunity."); return; }
    if (user.role !== "volunteer") { toast.error("Sign in with a volunteer account to apply."); return; }
    join.mutate(need.id);
  };
  return <section className="page-container directory-page">
    <PageHeader eyebrow={requestedKind ? "GIVE WHAT YOU CAN" : "YOUR NEXT GOOD THING"} title={requestedKind ? "Support a cause." : "Find your opportunity."} description="Browse open needs from reviewed community organizations." action={<div className="view-switch"><button onClick={() => setView("grid")} className={view === "grid" ? "active" : ""}>Grid</button><button onClick={() => setView("list")} className={view === "list" ? "active" : ""}>List</button></div>} />
    <div className="opportunity-filters">
      <label className="field-with-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search needs, causes or cities" aria-label="Search opportunities" /></label>
      <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by cause"><option value="">All causes</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
      <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="All locations" aria-label="Filter by city" />
    </div>
    {query.isLoading ? <LoadingCards /> : query.isError ? <ErrorState description={query.error.message} retry={() => query.refetch()} /> : results.length ? <><div className={`opportunity-grid ${view === "list" ? "list-view" : ""}`}>{visible.map((need) => <OpportunityCard key={need.id} need={need} action={<button className="card-link card-action" onClick={() => apply(need)} disabled={join.isPending}>{need.kind === "volunteer" ? "Apply as Volunteer" : "Donate"} <ArrowRight size={14} /></button>} />)}</div><Pagination page={page} pageCount={pageCount} onChange={setPage} /></> : <EmptyState title="No opportunities found." description="Try another search or check back when community needs are updated." />}
  </section>;
}

function OpportunityDetail({ user }: { user: User | null }) {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: [...queryKeys.needs, id], queryFn: async () => (await services.needs.list()).find((need) => need.id === id) });
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: () => services.needs.join(id),
    onSuccess: async (result) => { toast.success(result.message); await queryClient.invalidateQueries(); },
    onError: (error) => toast.error(error.message),
  });
  if (query.isLoading) return <section className="page-container detail-page"><LoadingCards count={1} /></section>;
  if (query.isError || !query.data) return <section className="page-container detail-page"><ErrorState title="Opportunity not found." description={query.error?.message ?? "This listing may have closed."} retry={() => query.refetch()} /></section>;
  const need = query.data;
  return <section className="page-container detail-page"><Breadcrumb items={[["Home", "/"], ["Opportunities", "/opportunities"], [need.title, ""]]} />
    <div className="opportunity-detail">
      <div className="opportunity-detail-main"><ImageFrame className="detail-cover" src={need.category === "Environment" ? photos.garden : photos.classroom} alt={need.title} /><div className="detail-copy"><div className="tag-row"><span className="tag">{need.category}</span><span className="tag"><MapPin size={12} /> {need.city}</span>{need.urgency === "high" && <StatusBadge status="danger">Urgent</StatusBadge>}</div><h1>{need.title}</h1><div className="organization-byline large"><span className="byline-avatar">{need.organizationName.slice(0, 1)}</span><strong>{need.organizationName}</strong>{need.organizationVerified && <BadgeCheck size={15} />}</div><h2>About this opportunity</h2><p>{need.description}</p><div className="need-facts"><span><Users size={16} /><strong>{need.volunteersNeeded ?? 0}</strong> volunteers needed</span><span><CalendarDays size={16} />Schedule and requirements shared after sign-up</span><span><ShieldCheck size={16} />Verified community organization</span></div></div></div>
      <aside className="apply-panel"><h2>{need.kind === "volunteer" ? "Be part of the change." : "Support this cause."}</h2><p>{need.kind === "volunteer" ? "Offer your time and the organization will follow up with the details." : "Your donation goes toward this organization’s verified community need."}</p><div className="panel-progress"><span>{need.kind === "volunteer" ? `${need.volunteersJoined ?? 0} of ${need.volunteersNeeded ?? 0} volunteers` : `₹${(need.raisedAmount ?? 0).toLocaleString("en-IN")} of ₹${(need.targetAmount ?? 0).toLocaleString("en-IN")}`}</span><span className="meter-track"><i style={{ width: `${need.kind === "volunteer" ? (need.volunteersNeeded ? (need.volunteersJoined ?? 0) / need.volunteersNeeded * 100 : 0) : need.targetAmount ? (need.raisedAmount ?? 0) / need.targetAmount * 100 : 0}%` }} /></span></div>{need.kind === "volunteer" ? <Button className="full-button" onClick={() => user?.role === "volunteer" ? join.mutate() : toast.error("Log in with a volunteer account to apply.")} disabled={join.isPending}>Apply as Volunteer <ArrowRight size={15} /></Button> : <Link className="button button-primary full-button" to={`/donate/${need.id}`}>Support this need <ArrowRight size={15} /></Link>}<small><ShieldCheck size={14} /> Your support is securely recorded.</small></aside>
    </div>
    <PageHeader eyebrow="ALSO MAKING A DIFFERENCE" title="More opportunities" action={<Link to="/opportunities" className="text-link">View all <ArrowRight size={14} /></Link>} />
    <RelatedNeeds current={need.id} />
  </section>;
}

function RelatedNeeds({ current }: { current: string }) {
  const query = useQuery({ queryKey: [...queryKeys.needs, "related"], queryFn: () => services.needs.list() });
  const results = query.data?.filter((need) => need.id !== current).slice(0, 3) ?? [];
  if (query.isError) return <ErrorState description={query.error.message} retry={() => query.refetch()} />;
  if (query.isLoading) return <LoadingCards />;
  return results.length ? <div className="opportunity-grid">{results.map((need) => <OpportunityCard key={need.id} need={need} />)}</div> : <EmptyState title="More community opportunities soon." description="There are no other open listings right now." />;
}

function DonationPage({ user }: { user: User | null }) {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"money" | "items">("money");
  const [amount, setAmount] = useState("1000");
  const [paymentOrderId, setPaymentOrderId] = useState<string>();
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "checkout" | "verifying" | "pending" | "completed" | "failed" | "expired" | "refund_required">("idle");
  const [receiptReference, setReceiptReference] = useState<string>();
  const needQuery = useQuery({ queryKey: [...queryKeys.needs, id], queryFn: async () => (await services.needs.list()).find((need) => need.id === id && need.kind === "donation"), enabled: Boolean(id) });
  const payment = useMutation({
    mutationFn: async (amountValue: number) => {
      const order = await services.payments.createOrder(id, amountValue);
      setPaymentOrderId(order.orderId);
      setPaymentStatus("checkout");
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Secure Razorpay checkout could not be loaded."));
          document.body.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error("Secure checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: "ImpactMatchNGO", description: needQuery.data?.title ?? "Community donation",
        handler: async (result: RazorpayResult) => {
          setPaymentStatus("verifying");
          try {
            const verified = await services.payments.verify({ orderId: result.razorpay_order_id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature });
            toast.success(verified.message);
            setPaymentStatus("completed");
            setReceiptReference(verified.receiptReference);
            await queryClient.invalidateQueries();
          } catch (error) {
            setPaymentStatus("pending");
            toast.error(error instanceof Error ? error.message : "The payment could not be verified.");
          }
        },
        theme: { color: "#08774f" },
      });
      checkout.on("payment.failed", (result) => {
        setPaymentStatus("pending");
        toast.error(result.error?.description ?? "Payment was not completed. The server will update its status from verified payment events.");
      });
      checkout.open();
      return order.orderId;
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    if (!paymentOrderId || !["checkout", "verifying", "pending"].includes(paymentStatus)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void services.payments.status(paymentOrderId).then((status) => {
        if (!active) return;
        if (status.status === "completed" || status.status === "refund_required" || status.status === "expired" || status.status === "failed") {
          setPaymentStatus(status.status);
          if (status.receiptReference) setReceiptReference(status.receiptReference);
          void queryClient.invalidateQueries({ queryKey: queryKeys.contributions });
          void queryClient.invalidateQueries({ queryKey: queryKeys.needs });
        } else {
          setPaymentStatus("pending");
        }
      }).catch(() => undefined);
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [paymentOrderId, paymentStatus, queryClient]);
  const need = needQuery.data;
  const customAmount = Number(amount);
  const remaining = need?.targetAmount ? Math.max(0, need.availableAmount ?? (need.targetAmount - (need.raisedAmount ?? 0))) : Infinity;
  const donate = () => {
    if (!user) { toast.error("Sign in to make a donation."); return; }
    if (!["donor", "volunteer"].includes(user.role)) { toast.error("Sign in with a donor or volunteer account to donate."); return; }
    if (!Number.isInteger(customAmount) || customAmount < 1 || customAmount > Math.min(100_000, remaining)) { toast.error("Choose a valid amount within the remaining campaign goal."); return; }
    payment.mutate(customAmount);
  };
  if (id && needQuery.isLoading) return <section className="page-container detail-page"><LoadingCards count={1} /></section>;
  if (id && (needQuery.isError || !need)) return <section className="page-container detail-page"><ErrorState title="Campaign not available." description={needQuery.error?.message ?? "This campaign may have closed."} retry={() => needQuery.refetch()} /></section>;
  return <section className="page-container donation-page">
    <Breadcrumb items={[["Home", "/"], ["Donate", "/donate"], [need?.title ?? "Support a cause", ""]]} />
    <div className="donation-layout">
      <div className="donation-campaign">
        <ImageFrame className="donation-cover" src={need ? photos.food : photos.volunteers} alt={need?.title ?? "Community members supporting their neighbours"} />
        <div className="donation-copy"><StatusBadge status="success">{need?.organizationName ?? "Verified NGOs"}</StatusBadge><h1>{need?.title ?? "Support a cause close to your heart."}</h1><p>{need?.description ?? "Choose a community campaign and help local organizations reach the people who need them."}</p>{need && <div className="organization-byline"><span className="byline-avatar">{need.organizationName.slice(0, 1)}</span><span>{need.organizationName}</span><BadgeCheck size={14} /></div>}
          {need && <div className="panel-progress"><div><strong>₹{(need.raisedAmount ?? 0).toLocaleString("en-IN")}</strong><span> raised of ₹{(need.targetAmount ?? 0).toLocaleString("en-IN")}</span></div><div className="meter-track"><i style={{ width: `${need.targetAmount ? Math.min(100, (need.raisedAmount ?? 0) / need.targetAmount * 100) : 0}%` }} /></div></div>}
        </div>
      </div>
      <div className="donation-box"><div className="donation-tabs"><button className={tab === "money" ? "selected" : ""} onClick={() => setTab("money")}><Wallet size={15} /> Money Donation</button><button className={tab === "items" ? "selected" : ""} onClick={() => setTab("items")}><Heart size={15} /> Item Donation</button></div>
        {tab === "money" ? <div className="donation-form"><h2>Your contribution matters.</h2><p>Every gift helps move a community need forward.</p><div className="amount-options">{[500, 1000, 2500, 5000].map((value) => <button key={value} className={amount === String(value) ? "selected" : ""} onClick={() => setAmount(String(value))} disabled={value > remaining}>₹{value.toLocaleString("en-IN")}</button>)}</div><label className="form-label">Other amount (INR)<span className="currency-input"><span>₹</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" type="number" min="1" max={Math.min(100_000, remaining)} aria-label="Donation amount in Indian rupees" /></span></label>{need && <small className="remaining-note">₹{remaining.toLocaleString("en-IN")} available after confirmed and in-progress reservations.</small>}<Button className="full-button" onClick={donate} disabled={payment.isPending}>{payment.isPending ? "Connecting to secure checkout…" : <>Donate with Razorpay <ArrowRight size={15} /></>}</Button><div className="secure-note"><ShieldCheck size={15} /> Secure test-mode payments <span>·</span> NGO verified <span>·</span> Server-side confirmation</div>{paymentStatus !== "idle" && <div className={`document-notice ${paymentStatus === "completed" ? "" : ""}`} role="status"><ShieldCheck size={15} /><span>{paymentStatus === "completed" ? `Donation confirmed by the server${receiptReference ? ` · receipt ${receiptReference}` : ""}.` : paymentStatus === "refund_required" ? "Payment requires refund review; it has not been counted toward campaign totals." : paymentStatus === "failed" ? "Payment was not confirmed." : paymentStatus === "expired" ? "The payment reservation expired; any later capture requires review." : "Payment is awaiting server confirmation. This page will refresh status from the API."}</span></div>}</div> : <div className="donation-form item-unavailable"><span className="empty-icon"><Heart size={21} /></span><h2>Give useful items, locally.</h2><p>Donate accepted supplies to a verified organization and coordinate pickup privately.</p><Link className="button button-outline" to="/items">Start an item donation <ArrowRight size={14} /></Link></div>}
      </div>
    </div>
  </section>;
}

function ItemDonationPortal({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const ngos = useQuery({ queryKey: [...queryKeys.organizations, "item-donation"], queryFn: () => services.ngos.list() });
  const mine = useQuery({ queryKey: ["item-donations-mine"], queryFn: services.itemDonations.mine, enabled: Boolean(user) });
  const [ngoId, setNgoId] = useState("");
  const [category, setCategory] = useState("clothes_footwear");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState("good");
  const [pickupAddress, setPickupAddress] = useState("");
  const [city, setCity] = useState(user?.city ?? "");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [pickupStart, setPickupStart] = useState(() => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [pickupEnd, setPickupEnd] = useState(() => new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [contactMethod, setContactMethod] = useState<"phone" | "email" | "in_app">("in_app");
  const [specialHandling, setSpecialHandling] = useState("");
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [createdId, setCreatedId] = useState<string>();
  const create = useMutation({
    mutationFn: () => {
      const quantityValue = Number(quantity);
      if (!Number.isInteger(quantityValue) || quantityValue < 1 || !ngoId || !consent) {
        throw new Error("Choose a verified NGO, valid quantity, and consent to share pickup details.");
      }
      if ((latitude.trim() && !longitude.trim()) || (!latitude.trim() && longitude.trim())) {
        throw new Error("Enter both pickup coordinates or leave both blank.");
      }
      const coordinates = latitude.trim() && longitude.trim()
        ? { latitude: Number(latitude), longitude: Number(longitude) } : undefined;
      if (coordinates && (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude))) {
        throw new Error("Enter valid numeric coordinates.");
      }
      return services.itemDonations.create({
        ngoId,
        category,
        description: description.trim(),
        quantity: quantityValue,
        condition,
        pickupAddress: pickupAddress.trim(),
        city: city.trim(),
        ...(coordinates ? { coordinates } : {}),
        pickupWindowStart: new Date(pickupStart).toISOString(),
        pickupWindowEnd: new Date(pickupEnd).toISOString(),
        preferredContactMethod: contactMethod,
        ...(specialHandling.trim() ? { specialHandling: specialHandling.trim() } : {}),
        consentToSharePickupDetails: true,
      });
    },
    onSuccess: async (donation) => {
      setCreatedId(donation.id);
      toast.success("Item donation submitted to the selected verified NGO.");
      await queryClient.invalidateQueries({ queryKey: ["item-donations-mine"] });
      if (photo) uploadPhoto.mutate({ donationId: donation.id, file: photo });
    },
    onError: (error) => toast.error(error.message),
  });
  const uploadPhoto = useMutation({
    mutationFn: ({ donationId, file }: { donationId: string; file: File }) => services.itemDonations.upload(donationId, file, "donation_photo"),
    onSuccess: async () => {
      setPhoto(undefined);
      toast.success("Photo stored privately with your donation.");
      await queryClient.invalidateQueries({ queryKey: ["item-donations-mine"] });
    },
    onError: (error) => toast.error(`The donation was created, but its photo upload failed: ${error.message}`),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => services.itemDonations.cancel(id, "Donor requested cancellation before pickup assignment."),
    onSuccess: async () => { toast.success("Donation cancelled."); await queryClient.invalidateQueries({ queryKey: ["item-donations-mine"] }); },
    onError: (error) => toast.error(error.message),
  });
  return <section className="page-container donation-page">
    <Breadcrumb items={[["Home", "/"], ["Donate", "/donate"], ["Donate items", ""]]} />
    <PageHeader eyebrow="LOCAL, VERIFIED DONATIONS" title="Donate useful items" description="Choose a verified organization. Pickup details and photos are shared only with that organization and the volunteer assigned to collect your items." />
    {!user && <div className="document-notice"><ShieldCheck size={16} /><span><Link className="text-link" to="/login">Sign in</Link> to submit and track a physical donation.</span></div>}
    <div className="dashboard-columns">
      <form className="data-card form-card form-stack" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <h2>Donation details</h2>
        {ngos.isLoading ? <LoadingCards count={1} /> : ngos.isError ? <ErrorState description={ngos.error.message} retry={() => ngos.refetch()} /> :
          <label className="form-label">Verified organization<select required value={ngoId} onChange={(event) => setNgoId(event.target.value)}><option value="">Select an NGO</option>{ngos.data?.map((ngo) => <option value={ngo.id} key={ngo.id}>{ngo.name} · {ngo.city}</option>)}</select></label>}
        <div className="request-form-grid">
          <label className="form-label">Item category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="clothes_footwear">Clothes and footwear</option><option value="furniture">Furniture</option><option value="books_education">Books and education</option><option value="household_essentials">Household essentials</option><option value="food_supplies">Food and supplies</option><option value="other">Other</option></select></label>
          <label className="form-label">Quantity<input type="number" min="1" max="100000" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="form-label">Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option></select></label>
          <label className="form-label">City<input required minLength={2} maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} /></label>
        </div>
        <label className="form-label">Description<textarea required minLength={10} maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the items and any relevant dimensions or expiry information." /></label>
        <label className="form-label">Pickup address<input required minLength={5} maxLength={500} value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} /></label>
        <div className="request-form-grid">
          <label className="form-label">Latitude (optional)<input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
          <label className="form-label">Longitude (optional)<input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
          <label className="form-label">Pickup window starts<input type="datetime-local" required value={pickupStart} onChange={(event) => setPickupStart(event.target.value)} /></label>
          <label className="form-label">Pickup window ends<input type="datetime-local" required value={pickupEnd} onChange={(event) => setPickupEnd(event.target.value)} /></label>
        </div>
        <div className="request-form-grid">
          <label className="form-label">Contact preference<select value={contactMethod} onChange={(event) => setContactMethod(event.target.value as typeof contactMethod)}><option value="in_app">In-app</option><option value="phone">Phone (from my profile)</option><option value="email">Email (from my account)</option></select></label>
          <label className="form-label">Special handling (optional)<input maxLength={1000} value={specialHandling} onChange={(event) => setSpecialHandling(event.target.value)} placeholder="Fragile, temperature-sensitive, etc." /></label>
        </div>
        <label className="form-label">Item photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.currentTarget.files?.[0])} /><small>Private JPEG, PNG, or WebP; subject to server upload size/file limits.</small></label>
        <label className="checkbox-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><strong>Pickup coordination consent</strong><small>I authorize the selected NGO and the volunteer it assigns to receive the pickup address and necessary contact details.</small></span></label>
        <Button type="submit" disabled={!user || create.isPending || uploadPhoto.isPending || ngos.isLoading || !consent}>{create.isPending ? "Submitting…" : "Submit item donation"} <ArrowRight size={14} /></Button>
        {createdId && <div className="document-notice" role="status"><Check size={15} /><span>Donation reference {createdId}. The organization will review it before pickup is arranged. {photo && uploadPhoto.isPending ? "Photo upload is in progress." : ""}</span></div>}
      </form>
      <div className="data-card"><div className="table-heading"><div><h2>My item donations</h2><p>Private status history and pickup progress.</p></div></div>{mine.isLoading ? <LoadingCards count={2} /> : mine.isError ? <ErrorState description={mine.error.message} retry={() => mine.refetch()} /> : mine.data?.length ? mine.data.map((donation) => <article className="verification-row" key={donation.id}><div className="verification-info"><strong>{donation.category.replaceAll("_", " ")} · {donation.quantity}</strong><small>{donation.city} · {new Date(donation.createdAt).toLocaleDateString()}</small><StatusBadge status={donation.status === "completed" ? "success" : ["rejected", "cancelled", "pickup_failed", "disputed"].includes(donation.status) ? "danger" : "warning"}>{donation.status.replaceAll("_", " ")}</StatusBadge>{donation.receiptReference && <small>Receipt {donation.receiptReference}</small>}</div>{["pending_ngo_review", "needs_information", "awaiting_pickup_assignment"].includes(donation.status) && <Button variant="quiet" disabled={cancel.isPending} onClick={() => cancel.mutate(donation.id)}>Cancel</Button>}</article>) : <EmptyState title="No item donations yet." description="Submit an item donation to a verified NGO to track it here." />}</div>
    </div>
  </section>;
}

function RegistrationChooser() {
  return <section className="page-container auth-page">
    <div className="auth-visual"><ImageFrame src={photos.classroom} alt="Community members working together" /><div className="auth-visual-overlay"><span className="eyebrow eyebrow-light">SMALL ACTS. LASTING CHANGE.</span><h1>Find your way<br />to <span>make an impact.</span></h1><p>Choose the account that best fits how you want to participate.</p></div></div>
    <div className="auth-card">
      <Link to="/" className="back-link"><ArrowLeft size={14} /> Back to home</Link>
      <span className="eyebrow">JOIN IMPACTMATCH</span><h2>Create an account</h2><p className="auth-description">Each account has a dedicated workspace and permissions.</p>
      <div className="form-stack">
        <Link className="registration-choice" to="/register/user"><Users size={20} /><span><strong>Help-seeker</strong><small>Request support and track updates.</small></span><ArrowRight size={16} /></Link>
        <Link className="registration-choice" to="/register/volunteer"><HeartHandshake size={20} /><span><strong>Volunteer</strong><small>Share your skills after eligibility review.</small></span><ArrowRight size={16} /></Link>
        <Link className="registration-choice" to="/register/ngo"><Building2 size={20} /><span><strong>NGO / organization</strong><small>Apply for platform verification.</small></span><ArrowRight size={16} /></Link>
        <div className="auth-help"><span>Want to donate instead?</span><Link to="/register/donor">Register as a donor</Link></div>
        <div className="auth-help"><span>Already have an account?</span><Link to="/login">Login</Link></div>
      </div>
    </div>
  </section>;
}

const authSchema = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Password must be 72 characters or fewer"),
  role: z.enum(["user", "volunteer", "donor", "ngo"]),
  city: z.string().trim().max(100).optional(),
  description: z.string().max(1000).optional(),
  categories: z.string().optional(),
  phone: z.string().max(30).optional(),
  website: z.string().url("Enter a complete website URL").optional().or(z.literal("")),
  registrationNumber: z.string().max(100).optional(),
  registrationType: z.string().max(100).optional(),
  officialEmail: z.string().trim().email("Enter a valid contact email").optional().or(z.literal("")),
  officialPhone: z.string().max(30).optional(),
  addressLine: z.string().max(300).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  serviceArea: z.string().max(500).optional(),
  representativeName: z.string().max(100).optional(),
  representativeDesignation: z.string().max(100).optional(),
  issuingAuthority: z.string().max(150).optional(),
  establishedDate: z.string().optional(),
  skills: z.string().max(1200).optional(),
  interests: z.string().max(1200).optional(),
  languages: z.string().max(800).optional(),
  volunteerAvailability: z.string().max(300).optional(),
  volunteerServiceArea: z.string().max(500).optional(),
  volunteerServiceRadiusKm: z.coerce.number().int().min(1).max(500).optional(),
  volunteerTaskOptIn: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.role === "volunteer") {
    if (!value.skills?.split(",").map((item) => item.trim()).filter(Boolean).length) {
      context.addIssue({ code: "custom", path: ["skills"], message: "Add at least one skill." });
    }
    if (!value.volunteerServiceArea?.trim()) {
      context.addIssue({ code: "custom", path: ["volunteerServiceArea"], message: "Enter your service area." });
    }
    return;
  }
  if (value.role !== "ngo") return;
  for (const [field, label] of [
    ["registrationNumber", "Registration number"],
    ["registrationType", "Registration type"],
    ["officialPhone", "Official phone"],
    ["addressLine", "Organization address"],
    ["state", "State"],
    ["postalCode", "Postal code"],
    ["serviceArea", "Service area"],
  ] as const) {
    if (!value[field]?.trim()) context.addIssue({ code: "custom", path: [field], message: `${label} is required.` });
  }
  if (!value.categories?.split(",").map((item) => item.trim()).filter(Boolean).length) {
    context.addIssue({ code: "custom", path: ["categories"], message: "Add at least one service category." });
  }
  if (!value.description?.trim()) context.addIssue({ code: "custom", path: ["description"], message: "Add an organization description." });
});
type AuthFields = z.output<typeof authSchema>;

function AuthPage({ mode, ngoOnly = false, forcedRole }: { mode: "login" | "register"; ngoOnly?: boolean; forcedRole?: "user" | "volunteer" | "donor" | "ngo" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState(1);
  const [verificationFiles, setVerificationFiles] = useState<Array<{ file: File; kind: VerificationDocumentKind }>>([]);
  const isRegister = mode === "register";
  const form = useForm<z.input<typeof authSchema>, unknown, AuthFields>({ resolver: zodResolver(authSchema), defaultValues: { role: forcedRole ?? (ngoOnly ? "ngo" : isRegister ? "volunteer" : "user"), name: "", email: "", password: "", city: "", volunteerServiceRadiusKm: 30, volunteerTaskOptIn: true } });
  const role = forcedRole ?? (ngoOnly ? "ngo" : form.watch("role"));
  const authMutation = useMutation({
    mutationFn: async (data: AuthFields) => isRegister
      ? services.auth.register({
        name: data.name?.trim() ?? "",
        email: data.email,
        password: data.password,
        role,
        city: data.city?.trim() ?? "",
        ...(role === "ngo" ? {
          description: data.description,
          categories: data.categories?.split(",").map((item) => item.trim()).filter(Boolean),
          phone: data.phone,
          website: data.website || undefined,
          registrationNumber: data.registrationNumber,
          registrationType: data.registrationType,
          officialEmail: data.officialEmail || data.email,
          officialPhone: data.officialPhone,
          addressLine: data.addressLine,
          state: data.state,
          postalCode: data.postalCode,
          serviceArea: data.serviceArea,
          representativeName: data.representativeName,
          representativeDesignation: data.representativeDesignation,
          issuingAuthority: data.issuingAuthority,
          establishedDate: data.establishedDate || undefined,
        } : role === "volunteer" ? {
          skills: data.skills?.split(",").map((item) => item.trim()).filter(Boolean),
          interests: data.interests?.split(",").map((item) => item.trim()).filter(Boolean),
          languages: data.languages?.split(",").map((item) => item.trim()).filter(Boolean),
          volunteerAvailability: data.volunteerAvailability,
          serviceArea: data.volunteerServiceArea,
          volunteerServiceRadiusKm: data.volunteerServiceRadiusKm,
          volunteerTaskOptIn: data.volunteerTaskOptIn,
        } : {}),
      })
      : services.auth.login(data.email, data.password),
    onSuccess: async (user) => {
      if (isRegister) {
        toast.success(user.role === "ngo"
          ? "NGO account created. Your application is submitted for review."
          : user.role === "volunteer"
            ? "Volunteer account created. Your application is submitted for review."
            : "Your account is ready.");
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.user });
      const uploadResults = isRegister && verificationFiles.length
        ? await Promise.allSettled(verificationFiles.map(({ file, kind }) => services.verification.upload(file, kind)))
        : [];
      if (uploadResults.some((result) => result.status === "rejected")) {
        toast.error("Your account was created, but a document upload failed. Retry it from your verification page.");
      } else if (!isRegister) {
        toast.success("Welcome back.");
      }
      navigate(dashboardPath(user.role));
    },
    onError: (error) => toast.error(error.message),
  });
  const submit = form.handleSubmit((data) => {
    if (isRegister && !data.name?.trim()) {
      form.setError("name", { message: "Enter your name or organization name." });
      return;
    }
    if (isRegister && !data.city?.trim()) {
      form.setError("city", { message: "Enter your city." });
      return;
    }
    authMutation.mutate(data);
  });
  const advanceStep = async () => {
    if (step === 1) {
      let valid = true;
      if (!form.getValues("name")?.trim()) {
        form.setError("name", { message: "Enter your organization name." });
        valid = false;
      }
      if (!form.getValues("city")?.trim()) {
        form.setError("city", { message: "Enter your city." });
        valid = false;
      }
      if (valid) setStep(2);
      return;
    }
    if (step === 2) {
      const email = authSchema.shape.email.safeParse(form.getValues("email"));
      const password = authSchema.shape.password.safeParse(form.getValues("password"));
      if (email.success) form.clearErrors("email");
      else form.setError("email", { type: "validate", message: email.error.issues[0]?.message ?? "Enter a valid email address." });
      if (password.success) form.clearErrors("password");
      else form.setError("password", { type: "validate", message: password.error.issues[0]?.message ?? "Use at least 8 characters." });
      if (email.success && password.success) setStep(3);
    }
  };
  const organizationStep = !ngoOnly || step === 1;
  const contactStep = !ngoOnly || step === 2;
  const title = !isRegister ? "Welcome back" : role === "ngo" ? "Register your NGO" : role === "volunteer" ? "Join as a volunteer" : role === "user" ? "Create your account" : "Join as a donor";
  return <section className="auth-page page-container">
    <div className="auth-visual"><ImageFrame src={photos.classroom} alt="Students learning together with a volunteer" /><div className="auth-visual-overlay"><span className="eyebrow eyebrow-light">SMALL ACTS. LASTING CHANGE.</span><h1>Good work<br />starts <span>together.</span></h1><p>Join neighbors, volunteers, and verified organizations building stronger communities.</p></div></div>
    <div className="auth-card">
      <Link to="/" className="back-link"><ArrowLeft size={14} /> Back to home</Link>
      <div className="auth-tabs"><Link to="/login" className={!isRegister ? "selected" : ""}>Login</Link><Link to={ngoOnly ? "/ngo/register" : "/register"} className={isRegister ? "selected" : ""}>Register</Link></div>
      <span className="eyebrow">{ngoOnly ? "ORGANIZATION ONBOARDING" : isRegister ? "BE PART OF SOMETHING GOOD" : "YOUR COMMUNITY AWAITS"}</span><h2>{title}</h2><p className="auth-description">{isRegister ? ngoOnly ? "Create your organization profile. We’ll review your details before publishing opportunities." : "Create your account and find the causes that feel like you." : "Log in to continue the good you started."}</p>
      {ngoOnly && <div className="step-indicator">{["Organization", "Contact", "Review"].map((label, index) => <span className={step >= index + 1 ? "active" : ""} key={label}><i>{index + 1}</i>{label}</span>)}</div>}
      <form className="form-stack" onSubmit={ngoOnly && step < 3 ? (event) => { event.preventDefault(); void advanceStep(); } : submit} noValidate>
        {!isRegister && <input type="hidden" {...form.register("role")} />}
        {isRegister && organizationStep && <label className="form-label">{role === "ngo" ? "Organization name" : "Full name"}<input {...form.register("name")} placeholder={role === "ngo" ? "Organization name" : "e.g. Ibran Siddique"} autoComplete="name" />{form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}</label>}
        {contactStep && <label className="form-label">Email<input {...form.register("email")} type="email" placeholder="you@example.com" autoComplete="email" />{form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}</label>}
        {contactStep && <label className="form-label">Password<span className="password-field"><input {...form.register("password")} type={showPassword ? "text" : "password"} placeholder="At least 8 characters" autoComplete={isRegister ? "new-password" : "current-password"} /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></span>{form.formState.errors.password && <span className="field-error">{form.formState.errors.password.message}</span>}</label>}
        {!isRegister && <div className="auth-help"><span>Use your registered email and password.</span><Link to="/register">Create account</Link></div>}
        {isRegister && organizationStep && <><label className="form-label">Your city<input {...form.register("city")} placeholder="Mumbai" />{form.formState.errors.city && <span className="field-error">{form.formState.errors.city.message}</span>}</label>{!ngoOnly && !forcedRole && <label className="form-label">I’m joining as<select {...form.register("role")}><option value="user">User / Help seeker</option><option value="volunteer">Volunteer</option><option value="donor">Donor</option><option value="ngo">NGO / organization</option></select></label>}
          {role === "ngo" && <><label className="form-label">Organization mission<textarea {...form.register("description")} rows={3} placeholder="Tell people what your organization does." /></label><label className="form-label">Causes (comma-separated)<input {...form.register("categories")} placeholder="Education, Health, Environment" /></label></>}
        </>}
        {isRegister && role === "volunteer" && organizationStep && <><label className="form-label">Skills (comma-separated)<input {...form.register("skills")} placeholder="First aid, tutoring, logistics" />{form.formState.errors.skills && <span className="field-error">{form.formState.errors.skills.message}</span>}</label><label className="form-label">Interests / assistance categories<input {...form.register("interests")} placeholder="Education, food support" /></label><label className="form-label">Languages (comma-separated)<input {...form.register("languages")} placeholder="English, Hindi, Marathi" /></label><label className="form-label">Service area<input {...form.register("volunteerServiceArea")} placeholder="City, district, or nearby neighborhoods" />{form.formState.errors.volunteerServiceArea && <span className="field-error">{form.formState.errors.volunteerServiceArea.message}</span>}</label><label className="form-label">Preferred service radius (km)<input type="number" min={1} max={500} {...form.register("volunteerServiceRadiusKm")} /></label><label className="form-label">Availability<textarea rows={2} {...form.register("volunteerAvailability")} placeholder="Days and times you are usually available" /></label><label className="checkbox-row"><input type="checkbox" {...form.register("volunteerTaskOptIn")} /><span><strong>Available for task offers</strong><small>Eligibility is reviewed by an administrator; uploading a document does not establish identity.</small></span></label><label className="form-label">Identity document (optional)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setVerificationFiles((current) => [...current.filter((item) => item.kind !== "volunteer_identity"), { file, kind: "volunteer_identity" }]); }} /><small>Private file, for authorized reviewer access only.</small></label></>}
        {isRegister && role === "ngo" && contactStep && <><label className="form-label">Registration type<input {...form.register("registrationType")} placeholder="Trust, Society, Section 8 company" />{form.formState.errors.registrationType && <span className="field-error">{form.formState.errors.registrationType.message}</span>}</label><label className="form-label">Registration number<input {...form.register("registrationNumber")} placeholder="NGO / trust registration ID" />{form.formState.errors.registrationNumber && <span className="field-error">{form.formState.errors.registrationNumber.message}</span>}</label><label className="form-label">Official contact email<input {...form.register("officialEmail")} type="email" placeholder="contact@example.org" />{form.formState.errors.officialEmail && <span className="field-error">{form.formState.errors.officialEmail.message}</span>}</label><label className="form-label">Official contact phone<input {...form.register("officialPhone")} type="tel" placeholder="+91 98765 43210" />{form.formState.errors.officialPhone && <span className="field-error">{form.formState.errors.officialPhone.message}</span>}</label><label className="form-label">Address<input {...form.register("addressLine")} placeholder="Registered organization address" />{form.formState.errors.addressLine && <span className="field-error">{form.formState.errors.addressLine.message}</span>}</label><label className="form-label">State<input {...form.register("state")} placeholder="State" />{form.formState.errors.state && <span className="field-error">{form.formState.errors.state.message}</span>}</label><label className="form-label">Postal code<input {...form.register("postalCode")} placeholder="Postal code" />{form.formState.errors.postalCode && <span className="field-error">{form.formState.errors.postalCode.message}</span>}</label><label className="form-label">Service area<input {...form.register("serviceArea")} placeholder="Cities or districts served" />{form.formState.errors.serviceArea && <span className="field-error">{form.formState.errors.serviceArea.message}</span>}</label><label className="form-label">Public contact phone (optional)<input {...form.register("phone")} type="tel" placeholder="+91 98765 43210" /></label><label className="form-label">Website (optional)<input {...form.register("website")} type="url" placeholder="https://example.org" />{form.formState.errors.website && <span className="field-error">{form.formState.errors.website.message}</span>}</label></>}
        {isRegister && role === "ngo" && contactStep && <><label className="form-label">Authorized representative (optional)<input {...form.register("representativeName")} placeholder="Representative full name" /></label><label className="form-label">Representative designation<input {...form.register("representativeDesignation")} placeholder="Director, trustee, coordinator…" /></label><label className="form-label">Issuing authority<input {...form.register("issuingAuthority")} placeholder="Registration authority, if applicable" /></label><label className="form-label">Established date<input type="date" {...form.register("establishedDate")} /></label>{(["ngo_registration", "ngo_address", "ngo_authority", "ngo_additional"] as const).map((kind) => <label className="form-label" key={kind}>{kind.replace("ngo_", "").replaceAll("_", " ")} document (optional)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setVerificationFiles((current) => [...current.filter((item) => item.kind !== kind), { file, kind }]); }} /><small>Private evidence for authorized human review; no certificate type is assumed mandatory.</small></label>)}</>}
        {ngoOnly && step === 3 && <><div className="registration-review"><strong>{form.getValues("name")}</strong><span>{form.getValues("email")}</span><span>{form.getValues("city")}</span><span>{form.getValues("categories") || "Causes not specified"}</span><p>{form.getValues("description") || "No mission description provided."}</p></div><div className="document-notice"><FileCheck2 size={16} /><span>Uploaded files are private and available only to authorized reviewers. Platform review is not government certification or legal endorsement.</span></div></>}
        {ngoOnly && step > 1 && <Button type="button" variant="quiet" className="full-button" onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Back</Button>}
        {ngoOnly && step < 3 ? <Button type="button" className="full-button" onClick={() => void advanceStep()}>Continue <ArrowRight size={15} /></Button> : <Button type="submit" className="full-button" disabled={authMutation.isPending}>{authMutation.isPending ? "One moment…" : isRegister ? "Create your account" : "Login"} <ArrowRight size={15} /></Button>}
      </form>
      <div className="auth-security"><ShieldCheck size={14} /> Your information stays protected.</div>
    </div>
  </section>;
}

type DashboardRole = "user" | "volunteer" | "ngo" | "donor" | "admin";
type NavItem = { label: string; to: string; icon: ReactNode };
const navByRole: Record<DashboardRole, NavItem[]> = {
  user: [
    { label: "Dashboard", to: "dashboard", icon: <LayoutDashboard /> },
    { label: "My requests", to: "requests", icon: <FileText /> },
    { label: "Notifications", to: "notifications", icon: <Bell /> },
    { label: "My Profile", to: "profile", icon: <Users /> },
  ],
  volunteer: [
    { label: "Dashboard", to: "dashboard", icon: <LayoutDashboard /> }, { label: "Find Opportunities", to: "opportunities", icon: <Compass /> },
    { label: "My Applications", to: "applications", icon: <ClipboardCheck /> }, { label: "My Tasks", to: "tasks", icon: <CalendarDays /> },
    { label: "Verification", to: "verification", icon: <ShieldCheck /> },
    { label: "Item pickups", to: "pickups", icon: <MapPin /> },
    { label: "Notifications", to: "notifications", icon: <Bell /> },
    { label: "My Profile", to: "profile", icon: <Users /> }, { label: "Task preferences", to: "settings", icon: <Settings /> },
  ],
  ngo: [
    { label: "Dashboard", to: "dashboard", icon: <LayoutDashboard /> }, { label: "Incoming requests", to: "requests", icon: <FileText /> }, { label: "My Profile", to: "profile", icon: <Building2 /> },
    { label: "Completion reviews", to: "completion-reviews", icon: <FileCheck2 /> },
    { label: "Verification", to: "verification", icon: <ShieldCheck /> }, { label: "Manage Tasks", to: "tasks", icon: <ClipboardCheck /> },
    { label: "Notifications", to: "notifications", icon: <Bell /> },
    { label: "Applications", to: "applications", icon: <Users /> }, { label: "Campaigns", to: "campaigns", icon: <Heart /> },
    { label: "Item donations", to: "item-needs", icon: <Sprout /> }, { label: "Donations", to: "donations", icon: <Wallet /> },
    { label: "Inventory", to: "inventory", icon: <FileText /> }, { label: "Analytics", to: "analytics", icon: <Target /> },
  ],
  donor: [
    { label: "Dashboard", to: "dashboard", icon: <LayoutDashboard /> }, { label: "My Donations", to: "donations", icon: <Heart /> },
    { label: "Receipts", to: "receipts", icon: <FileText /> }, { label: "Notifications", to: "notifications", icon: <Bell /> }, { label: "Settings", to: "settings", icon: <Settings /> },
  ],
  admin: [
    { label: "Overview", to: "dashboard", icon: <LayoutDashboard /> }, { label: "NGO Verification", to: "verifications", icon: <BadgeCheck /> },
    { label: "User Management", to: "users", icon: <Users /> }, { label: "Completion review flags", to: "completion-reviews", icon: <FileCheck2 /> }, { label: "Operational status", to: "operations", icon: <Settings /> }, { label: "Reports", to: "reports", icon: <FileText /> },
    { label: "Donations", to: "donations", icon: <Wallet /> }, { label: "Tasks Monitoring", to: "tasks", icon: <ClipboardCheck /> },
    { label: "Analytics", to: "analytics", icon: <Target /> }, { label: "Audit Logs", to: "audit-logs", icon: <BookOpen /> }, { label: "Notifications", to: "notifications", icon: <Bell /> },
  ],
};

function DashboardPortal({ role, user, loading }: { role: DashboardRole; user: User | null; loading: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const unread = useQuery({ queryKey: ["notification-unread"], queryFn: services.notifications.unreadCount, enabled: Boolean(user) });
  if (loading) return <section className="page-container auth-required"><LoadingCards count={1} /></section>;
  if (!user) return <section className="page-container auth-required"><EmptyState title="Log in to continue." description={`Sign in with your ${role} account to open this dashboard.`} action={<Link to="/login" className="button button-primary">Login <ArrowRight size={15} /></Link>} /></section>;
  if (user.role !== role) return <section className="page-container auth-required"><EmptyState title="This dashboard is for another account." description={`You’re signed in as ${user.role}. Your workspace is still here.`} action={<Link to={dashboardPath(user.role)} className="button button-primary">Open my dashboard <ArrowRight size={15} /></Link>} /></section>;
  const current = pathname.split("/")[2] || "dashboard";
  return <div className="dashboard-shell">
    <button className="dashboard-drawer-toggle" aria-label="Open dashboard navigation" onClick={() => setDrawerOpen(!drawerOpen)}>{drawerOpen ? <X size={20} /> : <Menu size={20} />} Menu</button>
    {drawerOpen && <button className="drawer-scrim" aria-label="Close dashboard navigation" onClick={() => setDrawerOpen(false)} />}
    <aside className={`dashboard-sidebar ${drawerOpen ? "drawer-open" : ""}`}>
      <div className="sidebar-profile"><span className="sidebar-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><span>{role === "ngo" ? user.organizationStatus === "verified" ? "Verified NGO" : user.organizationStatus === "rejected" ? "Application rejected" : user.organizationStatus === "resubmission_required" ? "Changes requested" : "Verification pending" : role === "user" ? "Help seeker" : role.charAt(0).toUpperCase() + role.slice(1)}</span></div></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav>{navByRole[role].map((item) => <Link key={item.to} to={`/${role}/${item.to}`} onClick={() => setDrawerOpen(false)} className={current === item.to ? "active" : ""}>{item.icon}<span>{item.label}{item.to === "notifications" && unread.data ? <span className="notification-count" aria-label={`${unread.data} unread`}>{unread.data}</span> : null}</span></Link>)}</nav>
      <div className="sidebar-help"><CircleHelp size={17} /><strong>Need a hand?</strong><span>We’re here to help you make a difference.</span><a href="mailto:hello@impactmatch.org">Contact support <ArrowRight size={12} /></a></div>
      <button className="sidebar-back" onClick={() => navigate("/")}>← Back to ImpactMatch</button>
    </aside>
    <div className="dashboard-main"><div className="dashboard-topbar"><div><span className="eyebrow">{role.toUpperCase()} WORKSPACE</span><h1>{navByRole[role].find((item) => item.to === current)?.label ?? "Dashboard"}</h1></div><div><Link to="/" className="button button-outline button-compact">View website <ArrowUpRight size={13} /></Link><span className="dashboard-user"><span className="sidebar-avatar small">{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</span></div></div>
      <div className="dashboard-content"><DashboardContent role={role} page={current} user={user} /></div>
    </div>
  </div>;
}

function DashboardContent({ role, page, user }: { role: DashboardRole; page: string; user: User }) {
  if (role === "user") return <HelpSeekerContent page={page} user={user} />;
  if (role === "volunteer") return <VolunteerContent page={page} user={user} />;
  if (role === "ngo") return <NgoContent page={page} user={user} />;
  if (role === "admin") return <AdminContent page={page} />;
  return <DonorContent page={page} user={user} />;
}

function HelpSeekerContent({ page, user }: { page: string; user: User }) {
  const navigate = useNavigate();
  const requests = useQuery({ queryKey: ["help-requests"], queryFn: services.helpRequests.mine, enabled: page === "dashboard" });
  if (page === "profile") return <ProfileEditor user={user} />;
  if (page === "requests") return <HelpRequestWorkspace />;
  if (page === "new-request") return <HelpRequestForm />;
  if (page === "notifications") return <MyNotifications role="user" />;
  const list = requests.data ?? [];
  const needsAttention = list.filter((request) => ["needs_information", "more_evidence_required"].includes(request.status)).length;
  const completed = list.filter((request) => request.status === "completed").length;
  return <><div className="welcome-row"><div><h2>Welcome, {user.name.split(" ")[0]}.</h2><p>Request support and track updates privately from your account.</p></div><Link to="/user/new-request" className="button button-primary">Create a help request <Plus size={15} /></Link></div>
    <div className="stat-grid three"><StatCard label="My requests" value={requests.isLoading ? "…" : requests.isError ? "—" : list.length} icon={<FileText />} to="/user/requests" /><StatCard label="Needs your attention" value={requests.isLoading ? "…" : requests.isError ? "—" : needsAttention} icon={<TriangleAlert />} to="/user/requests" /><StatCard label="Completed" value={requests.isLoading ? "…" : requests.isError ? "—" : completed} icon={<Check />} to="/user/requests" /></div>
    <div className="data-card"><PageHeader eyebrow="HELP SEEKER WORKSPACE" title="Need assistance?" description="Submit a private request for human review by a verified local organization. Supporting documents are optional." action={<Link className="button button-outline" to="/user/requests">View my requests <ArrowRight size={14} /></Link>} /><Link to="/ngos" className="text-link">Explore verified NGOs <ArrowRight size={14} /></Link></div>
    {requests.isLoading ? <LoadingCards count={2} /> : requests.isError ? <ErrorState description={requests.error.message} retry={() => requests.refetch()} /> : list.length ? <section className="data-card"><div className="table-heading"><div><h2>Recent help requests</h2><p>Review the latest status and follow-up for your requests.</p></div><Link className="text-link" to="/user/requests">Open request timeline <ArrowRight size={14} /></Link></div>{list.slice(0, 5).map((request) => <button key={request.id} className="request-list-card" onClick={() => navigate("/user/requests")}><span className="request-list-top"><strong>{request.title}</strong><StatusBadge status={request.status === "completed" ? "success" : request.status === "rejected" ? "danger" : "warning"}>{requestStatuses[request.status]}</StatusBadge></span><span>{request.city} · Updated {new Date(request.updatedAt).toLocaleDateString()}</span></button>)}</section> : <EmptyState title="No help requests yet." description="Submit a private request to begin." action={<Link to="/user/new-request" className="button button-primary">Create a request <Plus size={14} /></Link>} />}
    <Link to="/user/notifications" className="text-link">View notifications and review decisions <ArrowRight size={14} /></Link>
  </>;
}

const requestCategories: Array<[HelpRequestCategory, string]> = [
  ["food", "Food"], ["clothing", "Clothing"], ["shelter", "Shelter"],
  ["medical_assistance", "Medical assistance"], ["education", "Education"],
  ["emergency_support", "Emergency support"], ["other", "Other"],
];
const requestStatuses: Record<HelpRequestStatus, string> = {
  draft: "Draft", submitted: "Submitted", screening: "Screening", pending_ngo_review: "Awaiting NGO review",
  needs_information: "More information requested", more_evidence_required: "More evidence required", flagged_for_review: "Flagged for human review",
  under_review: "Under review", approved: "Approved", matching_volunteer: "Finding a volunteer",
  assigned: "Volunteer assigned", matched: "Matched", in_progress: "In progress",
  pending_completion_review: "Completion review", completed: "Completed", rejected: "Rejected",
  cancelled: "Cancelled", withdrawn: "Withdrawn",
};
const requestFormSchema = z.object({
  title: z.string().trim().min(5, "Use at least 5 characters.").max(120),
  description: z.string().trim().min(30, "Please describe the assistance needed in at least 30 characters.").max(3000),
  category: z.enum(["food", "clothing", "shelter", "medical_assistance", "education", "emergency_support", "other"]),
  urgency: z.enum(["low", "medium", "high"]),
  peopleCount: z.coerce.number().int().min(1).max(100),
  city: z.string().trim().min(2).max(100),
  addressLine: z.string().trim().max(300).optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  preferredContactMethod: z.enum(["phone", "email", "in_app"]),
  consentToProcess: z.boolean()
    .refine((consented) => consented, "Consent is required to submit this request.")
    .transform((): true => true),
}).superRefine((value, context) => {
  if (Boolean(value.latitude) !== Boolean(value.longitude)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Enter both coordinates or leave both blank." });
  }
  if (value.latitude && (!Number.isFinite(Number(value.latitude)) || Number(value.latitude) < -90 || Number(value.latitude) > 90)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude must be between -90 and 90." });
  }
  if (value.longitude && (!Number.isFinite(Number(value.longitude)) || Number(value.longitude) < -180 || Number(value.longitude) > 180)) {
    context.addIssue({ code: "custom", path: ["longitude"], message: "Longitude must be between -180 and 180." });
  }
});
type HelpRequestFormInput = z.input<typeof requestFormSchema>;
type HelpRequestFormFields = z.output<typeof requestFormSchema>;

function HelpRequestForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const uploadPolicy = useQuery({ queryKey: ["help-request-upload-policy"], queryFn: services.helpRequests.uploadPolicy });
  const [files, setFiles] = useState<File[]>([]);
  const [referenceId, setReferenceId] = useState<string>();
  const form = useForm<HelpRequestFormInput, unknown, HelpRequestFormFields>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: { category: "food", urgency: "medium", peopleCount: 1, preferredContactMethod: "in_app", consentToProcess: false },
  });
  const createRequest = useMutation({
    mutationFn: async ({ values, attachments }: { values: HelpRequestFormFields; attachments: File[] }) => {
      const request = await services.helpRequests.create({
        title: values.title,
        description: values.description,
        category: values.category,
        urgency: values.urgency,
        peopleCount: values.peopleCount,
        city: values.city,
        ...(values.addressLine?.trim() ? { addressLine: values.addressLine.trim() } : {}),
        ...(values.latitude && values.longitude ? {
          coordinates: { latitude: Number(values.latitude), longitude: Number(values.longitude) },
        } : {}),
        preferredContactMethod: values.preferredContactMethod,
        consentToProcess: values.consentToProcess,
      });
      const uploadErrors: string[] = [];
      for (const file of attachments) {
        try {
          await services.helpRequests.upload(request.referenceId, file);
        } catch (error) {
          uploadErrors.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        }
      }
      let screeningError: string | undefined;
      try {
        await services.helpRequests.screen(request.referenceId);
      } catch (error) {
        screeningError = error instanceof Error ? error.message : "Screening could not be started.";
      }
      return { ...request, uploadErrors, screeningError };
    },
    onSuccess: async (result) => {
      setReferenceId(result.referenceId);
      setFiles([]);
      await queryClient.invalidateQueries({ queryKey: ["help-requests"] });
      if (result.uploadErrors.length) toast.warning(`Request submitted, but ${result.uploadErrors.length} attachment(s) could not be uploaded.`);
      else if (result.screeningError) toast.warning("Request submitted. Automated screening could not be started; it remains for human review.");
      else toast.success("Your help request was submitted for human review.");
    },
    onError: (error) => toast.error(error.message),
  });
  const submit = form.handleSubmit((values) => createRequest.mutate({ values, attachments: files }));
  const chooseFiles = (selected: FileList | null) => {
    if (!selected) return;
    const next = Array.from(selected);
    const maxFiles = uploadPolicy.data?.maxFiles ?? 5;
    const maxBytes = uploadPolicy.data?.maxFileBytes ?? 5 * 1024 * 1024;
    if (files.length + next.length > maxFiles) {
      toast.error(`Add up to ${maxFiles} files per request.`);
      return;
    }
    const allowed = new Set(uploadPolicy.data?.contentTypes ?? ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    const invalid = next.find((file) => !allowed.has(file.type) || file.size > maxBytes);
    if (invalid) {
      toast.error(`${invalid.name}: choose a supported format up to ${(maxBytes / (1024 * 1024)).toFixed(1)} MB.`);
      return;
    }
    setFiles((previous) => [...previous, ...next]);
  };
  if (referenceId) return <div className="data-card"><PageHeader eyebrow="REQUEST RECEIVED" title="Your request is submitted" description="Your reference ID is shown below. Automated screening availability is reported in request details; every request requires human review." /><div className="request-reference"><strong>Reference ID</strong><code>{referenceId}</code></div><div className="verification-actions"><Button onClick={() => navigate("/user/requests")}>View my requests <ArrowRight size={14} /></Button><Button variant="outline" onClick={() => { setReferenceId(undefined); form.reset(); }}>Submit another request</Button></div></div>;
  return <div className="data-card form-card request-form-card"><PageHeader eyebrow="PRIVATE HELP REQUEST" title="Tell us what support you need" description="Share only the information needed to understand your request. Photos and documents are optional for every category." /><form className="form-stack request-form" onSubmit={submit}>
    <label className="form-label">Request title<input {...form.register("title")} placeholder="A short summary of the assistance needed" />{form.formState.errors.title && <span className="field-error">{form.formState.errors.title.message}</span>}</label>
    <label className="form-label">Details<textarea {...form.register("description")} rows={5} placeholder="Describe the support needed and any relevant timing. Avoid including unrelated sensitive details." />{form.formState.errors.description && <span className="field-error">{form.formState.errors.description.message}</span>}</label>
    <div className="request-form-grid">
      <label className="form-label">Assistance category<select {...form.register("category")}>{requestCategories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="form-label">Urgency<select {...form.register("urgency")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label className="form-label">People needing assistance<input type="number" min="1" max="100" {...form.register("peopleCount")} />{form.formState.errors.peopleCount && <span className="field-error">{form.formState.errors.peopleCount.message}</span>}</label>
      <label className="form-label">City<input {...form.register("city")} autoComplete="address-level2" />{form.formState.errors.city && <span className="field-error">{form.formState.errors.city.message}</span>}</label>
      <label className="form-label request-form-wide">Address or pickup location (optional)<input {...form.register("addressLine")} autoComplete="street-address" placeholder="Share only if needed for assistance" /></label>
      <label className="form-label">Latitude (optional)<input inputMode="decimal" {...form.register("latitude")} placeholder="e.g. 19.0760" />{form.formState.errors.latitude && <span className="field-error">{form.formState.errors.latitude.message}</span>}</label>
      <label className="form-label">Longitude (optional)<input inputMode="decimal" {...form.register("longitude")} placeholder="e.g. 72.8777" />{form.formState.errors.longitude && <span className="field-error">{form.formState.errors.longitude.message}</span>}</label>
      <label className="form-label">Preferred contact method<select {...form.register("preferredContactMethod")}><option value="in_app">In-app update</option><option value="phone">Phone</option><option value="email">Email</option></select></label>
    </div>
    <label className="form-label">Supporting photos or documents (optional)<input type="file" accept={uploadPolicy.data?.contentTypes.join(",") ?? "image/jpeg,image/png,image/webp,application/pdf"} multiple onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /><small>{uploadPolicy.isLoading ? "Loading upload policy…" : `JPEG, PNG, WebP, or PDF · maximum ${((uploadPolicy.data?.maxFileBytes ?? 5 * 1024 * 1024) / (1024 * 1024)).toFixed(1)} MB each · up to ${uploadPolicy.data?.maxFiles ?? 5} files.`} Files stay private until you route the request; only that verified NGO can then review/download them.</small></label>
    {!!files.length && <div className="request-attachment-preview" aria-label="Selected attachments">{files.map((file, index) => <RequestFilePreview file={file} index={index} key={`${file.name}-${index}`} onRemove={() => setFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index))} />)}</div>}
    <label className="request-consent"><input type="checkbox" {...form.register("consentToProcess")} /><span>I consent to processing the information and optional files in this request for OCR and assisted screening if configured. Attached images may be processed by Google Cloud Vision; request details and extracted text may be processed by OpenAI. Screening is advisory only. If I choose an eligible verified NGO, my request details and attachments will be shared with that organization for human review; exact location and contact details are shared with a volunteer only after an eligible volunteer accepts an assignment.</span></label>{form.formState.errors.consentToProcess && <span className="field-error">{form.formState.errors.consentToProcess.message}</span>}
    <div className="document-notice"><ShieldCheck size={16} /><span>Requests and uploaded files are private to your account. OCR/AI providers process them only when their credentials are configured; availability is shown in your request status.</span></div>
    <Button type="submit" className="full-button" disabled={createRequest.isPending}>{createRequest.isPending ? "Submitting request…" : "Submit help request"} <ArrowRight size={15} /></Button>
  </form></div>;
}

function RequestFilePreview({ file, index, onRemove }: { file: File; index: number; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div>{previewUrl ? <img src={previewUrl} alt={`Preview of ${file.name}`} /> : <FileText size={22} />}<span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span><button type="button" aria-label={`Remove attachment ${index + 1}: ${file.name}`} onClick={onRemove}><X size={14} /></button></div>;
}

function HelpRequestWorkspace() {
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const requests = useQuery({ queryKey: ["help-requests"], queryFn: services.helpRequests.mine });
  const detail = useQuery({ queryKey: ["help-request", selectedId], queryFn: () => services.helpRequests.detail(selectedId!), enabled: Boolean(selectedId) });
  const timeline = useQuery({ queryKey: ["help-request-timeline", selectedId], queryFn: () => services.helpRequests.timeline(selectedId!), enabled: Boolean(selectedId) });
  const matches = useQuery({
    queryKey: ["help-request-matches", selectedId],
    queryFn: () => services.helpRequests.matches(selectedId!),
    enabled: Boolean(selectedId && detail.data && ["pending_ngo_review", "rejected"].includes(detail.data.request.status)),
  });
  const routeNgo = useMutation({
    mutationFn: (organizationId: string) => services.helpRequests.route(selectedId!, organizationId),
    onSuccess: async (result) => {
      toast.success(`Request routed to ${result.organization.name}.`);
      await Promise.all([
        detail.refetch(),
        matches.refetch(),
        timeline.refetch(),
        requests.refetch(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const download = async (documentId: string, name: string) => {
    if (!selectedId) return;
    try {
      const blob = await services.helpRequests.download(selectedId, documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private file could not be downloaded.");
    }
  };
  return <section className="help-request-workspace"><PageHeader eyebrow="YOUR REQUESTS" title="My help requests" description="Private requests, their review status, uploaded files, and timeline." action={<Link to="/user/new-request" className="button button-primary"><Plus size={14} /> New request</Link>} />
    {requests.isLoading ? <LoadingCards /> : requests.isError ? <ErrorState description={requests.error.message} retry={() => requests.refetch()} /> : !requests.data?.length ? <EmptyState title="No help requests yet." description="Submit a private request to begin." action={<Link to="/user/new-request" className="button button-primary">Create request <ArrowRight size={14} /></Link>} /> : <div className="request-workspace-grid">
      <div className="request-list" aria-label="Help requests">{requests.data.map((request) => <button key={request.id} className={`request-list-card ${selectedId === request.id ? "selected" : ""}`} onClick={() => setSelectedId(request.id)}><span className="request-list-top"><strong>{request.title}</strong><StatusBadge status={request.status === "completed" ? "success" : request.status === "rejected" || request.status === "flagged_for_review" ? "danger" : "warning"}>{requestStatuses[request.status]}</StatusBadge></span><span>{requestCategories.find(([category]) => category === request.category)?.[1]} · {request.city}</span><small>Updated {new Date(request.updatedAt).toLocaleDateString()}</small>{request.status === "needs_information" && <strong className="request-needs-info">More information is needed</strong>}</button>)}</div>
      <div className="request-detail-panel">
        {!selectedId ? <EmptyState title="Select a request" description="Choose one of your requests to see its screening and timeline." /> : detail.isLoading ? <LoadingCards count={1} /> : detail.isError ? <ErrorState description={detail.error.message} retry={() => detail.refetch()} /> : detail.data && <>
          {editing && detail.data.request.status === "needs_information" ? <RequestEditForm
            request={detail.data.request}
            existingAttachmentCount={detail.data.documents.length}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              await Promise.all([
                detail.refetch(),
                timeline.refetch(),
                requests.refetch(),
              ]);
            }}
          /> : <>
          <div className="request-detail-heading"><div><span className="eyebrow">REQUEST DETAILS</span><h2>{detail.data.request.title}</h2><p>{requestStatuses[detail.data.request.status]} · {detail.data.request.city}</p></div><StatusBadge status={detail.data.request.screeningStatus === "unavailable" ? "neutral" : "warning"}>Screening: {detail.data.request.screeningStatus.replaceAll("_", " ")}</StatusBadge></div>
          {detail.data.request.status === "needs_information" && <div className="request-needs-information"><div><strong>More information is requested</strong><span>Update your details or add supporting files if needed.</span></div><Button onClick={() => setEditing(true)}>Update request <ArrowRight size={14} /></Button></div>}
          <p>{detail.data.request.description}</p><div className="request-detail-meta"><span>Category: {requestCategories.find(([category]) => category === detail.data?.request.category)?.[1]}</span><span>Urgency: {detail.data.request.urgency}</span><span>People: {detail.data.request.peopleCount}</span><span>Contact preference: {detail.data.request.preferredContactMethod}</span></div>
          {detail.data.request.assignedOrganization && <div className="request-needs-information"><div><strong>Routed to {detail.data.request.assignedOrganization.name}</strong><span>Your request is visible only to this verified organization for review.</span></div><StatusBadge status="warning">{requestStatuses[detail.data.request.status]}</StatusBadge></div>}
          {["pending_ngo_review", "rejected"].includes(detail.data.request.status) && <section className="ngo-match-section">
            <div className="table-heading"><div><h3>{detail.data.request.assignedOrganization ? "Organization review" : "Verified organizations near you"}</h3><p>{detail.data.request.assignedOrganization ? "If declined, you can route this request to another eligible organization." : "Choose one eligible organization. Matching does not automatically share or assign your request."}</p></div></div>
            {matches.isLoading ? <LoadingCards count={1} /> : matches.isError ? <ErrorState description={matches.error.message} retry={() => matches.refetch()} /> : matches.data?.assignedOrganization ? <div className="document-notice"><ShieldCheck size={16} /><span>Your request is routed to {matches.data.assignedOrganization.name}. Only that organization can review its details and attachments.</span></div> : matches.data?.matches.length ? <div className="ngo-match-list">{matches.data.matches.map((match) => <NgoMatchCard key={match.id} match={match} disabled={routeNgo.isPending} onSelect={() => routeNgo.mutate(match.id)} />)}</div> : <EmptyState title="No eligible organization found yet." description={`No verified NGO matched ${detail.data.request.category.replaceAll("_", " ")} in ${detail.data.request.city} or within the ${matches.data?.radiusKm ?? "configured"} km search radius. You can try again later or explore verified NGOs by city.`} action={<Link className="button button-outline" to={`/ngos?city=${encodeURIComponent(detail.data.request.city)}`}>Browse verified NGOs <ArrowRight size={14} /></Link>} />}
          </section>}
          {detail.data.request.screening.status === "unavailable" && <div className="document-notice"><ShieldCheck size={16} /><span>{detail.data.request.screening.message ?? detail.data.request.screening.reasons?.[0] ?? "Automated screening is unavailable. The request remains for human review."}</span></div>}
          {detail.data.request.screening.status !== "unavailable" && detail.data.request.screening.status !== "pending" && <div className="request-screening-summary"><strong>Preliminary screening only — human review is required.</strong>{detail.data.request.screening.reasons?.map((reason) => <p key={reason}>{reason}</p>)}{detail.data.request.screening.missingFields?.length ? <p>Fields to review: {detail.data.request.screening.missingFields.join(", ")}</p> : null}{detail.data.request.screening.additionalInformation?.length ? <p>Possible follow-up: {detail.data.request.screening.additionalInformation.join(" · ")}</p> : null}</div>}
          <div><h3>Private attachments</h3>{detail.data.documents.length ? detail.data.documents.map((document) => <div className="request-document-row" key={document.id}><FileText size={17} /><span><strong>{document.name}</strong><small>{document.ocrStatus === "completed" ? `Text extracted (${document.ocrProvider ?? "OCR"})` : document.ocrStatus === "unavailable" ? "OCR unavailable" : document.ocrStatus === "unsupported" ? "Format stored; OCR unsupported" : document.ocrStatus === "failed" ? "Text could not be extracted" : "OCR pending"} · {(document.byteSize / 1024).toFixed(0)} KB</small>{document.ocrMessage && <small>{document.ocrMessage}</small>}</span><Button variant="outline" onClick={() => void download(document.id, document.name)}>Download securely</Button></div>) : <p className="muted-copy">No attachments were added. Documents are optional.</p>}</div>
          <div><h3>Request timeline</h3>{timeline.isLoading ? <LoadingCards count={1} /> : timeline.isError ? <ErrorState description={timeline.error.message} retry={() => timeline.refetch()} /> : <ol className="request-timeline">{timeline.data?.map((event, index) => <li key={`${event.status}-${event.occurredAt}-${index}`}><StatusBadge status="neutral">{requestStatuses[event.status]}</StatusBadge><time>{new Date(event.occurredAt).toLocaleString()}</time>{event.reason && <p>{event.reason}</p>}</li>)}</ol>}</div>
          </>}
        </>}
      </div>
    </div>}
  </section>;
}

function NgoMatchCard({ match, disabled, onSelect }: { match: NgoMatch; disabled: boolean; onSelect: () => void }) {
  return <article className="ngo-match-card">
    <div><span className="organization-monogram"><Building2 size={16} /></span><div><strong>{match.name}</strong><small>{match.city}{match.distanceKm !== undefined ? ` · ${match.distanceKm} km away` : ""}</small></div></div>
    <p>{match.categories.join(" · ")}</p>
    {match.serviceArea && <small>Service area: {match.serviceArea}</small>}
    <ul>{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <Button disabled={disabled || !match.currentlyAccepting} onClick={onSelect}>{disabled ? "Routing…" : match.currentlyAccepting ? "Choose this NGO" : "Not accepting requests"} <ArrowRight size={14} /></Button>
  </article>;
}

function RequestEditForm({ request, existingAttachmentCount, onCancel, onSaved }: {
  request: import("./api").HelpRequestDetail;
  existingAttachmentCount: number;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const uploadPolicy = useQuery({ queryKey: ["help-request-upload-policy"], queryFn: services.helpRequests.uploadPolicy });
  const save = useMutation({
    mutationFn: async (values: HelpRequestFormFields) => {
      await services.helpRequests.update(request.id, {
        title: values.title,
        description: values.description,
        category: values.category,
        urgency: values.urgency,
        peopleCount: values.peopleCount,
        city: values.city,
        ...(values.addressLine?.trim() ? { addressLine: values.addressLine.trim() } : {}),
        preferredContactMethod: values.preferredContactMethod,
        consentToProcess: true,
      });
      const uploadErrors: string[] = [];
      for (const file of files) {
        try {
          await services.helpRequests.upload(request.id, file);
        } catch (error) {
          uploadErrors.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        }
      }
      let screeningError: string | undefined;
      try {
        await services.helpRequests.screen(request.id);
      } catch (error) {
        screeningError = error instanceof Error ? error.message : "Screening could not be started.";
      }
      return { uploadErrors, screeningError };
    },
    onSuccess: async (result) => {
      if (result.uploadErrors.length) toast.warning(`Details saved, but ${result.uploadErrors.length} attachment(s) could not be uploaded.`);
      else if (result.screeningError) toast.warning("Details saved; automated screening could not be started.");
      else toast.success("Your request update was submitted for human review.");
      setFiles([]);
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  const form = useForm<HelpRequestFormInput, unknown, HelpRequestFormFields>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      title: request.title,
      description: request.description,
      category: request.category,
      urgency: request.urgency,
      peopleCount: request.peopleCount,
      city: request.city,
      addressLine: request.addressLine ?? "",
      preferredContactMethod: request.preferredContactMethod,
      consentToProcess: true,
    },
  });
  const chooseFiles = (selected: FileList | null) => {
    if (!selected) return;
    const next = Array.from(selected);
    const maxFiles = uploadPolicy.data?.maxFiles ?? 5;
    const maxBytes = uploadPolicy.data?.maxFileBytes ?? 5 * 1024 * 1024;
    if (existingAttachmentCount + files.length + next.length > maxFiles) {
      toast.error(`This request can have up to ${maxFiles} total files.`);
      return;
    }
    const types = new Set(uploadPolicy.data?.contentTypes ?? ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    const invalid = next.find((file) => !types.has(file.type) || file.size > maxBytes);
    if (invalid) {
      toast.error(`${invalid.name}: choose a supported format up to ${(maxBytes / (1024 * 1024)).toFixed(1)} MB.`);
      return;
    }
    setFiles((previous) => [...previous, ...next]);
  };
  return <div className="request-edit-form"><PageHeader eyebrow="MORE INFORMATION" title="Update request details" description="Only your own request fields can be changed." /><form className="form-stack" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
    <label className="form-label">Request title<input {...form.register("title")} />{form.formState.errors.title && <span className="field-error">{form.formState.errors.title.message}</span>}</label>
    <label className="form-label">Details<textarea rows={4} {...form.register("description")} />{form.formState.errors.description && <span className="field-error">{form.formState.errors.description.message}</span>}</label>
    <div className="request-form-grid"><label className="form-label">Category<select {...form.register("category")}>{requestCategories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="form-label">Urgency<select {...form.register("urgency")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className="form-label">People<input type="number" min="1" max="100" {...form.register("peopleCount")} /></label><label className="form-label">City<input {...form.register("city")} /></label><label className="form-label request-form-wide">Address (optional)<input {...form.register("addressLine")} /></label><label className="form-label">Preferred contact<select {...form.register("preferredContactMethod")}><option value="in_app">In-app</option><option value="phone">Phone</option><option value="email">Email</option></select></label></div>
    <label className="form-label">Add supporting files (optional)<input type="file" accept={uploadPolicy.data?.contentTypes.join(",") ?? "image/jpeg,image/png,image/webp,application/pdf"} multiple onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /><small>{existingAttachmentCount} existing attachment(s) · up to {Math.max(0, (uploadPolicy.data?.maxFiles ?? 5) - existingAttachmentCount)} more</small></label>
    {files.map((file, index) => <div className="request-edit-file" key={`${file.name}-${index}`}><FileText size={14} /><span>{file.name}</span><button type="button" onClick={() => setFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></div>)}
    <div className="verification-actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save updates"} <Check size={14} /></Button><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button></div>
  </form></div>;
}

function ApplicantVerificationPanel({ role }: { role: "ngo" | "volunteer" }) {
  const queryClient = useQueryClient();
  const [documentKind, setDocumentKind] = useState<VerificationDocumentKind>(role === "ngo" ? "ngo_registration" : "volunteer_identity");
  const verification = useQuery({ queryKey: ["verification-me"], queryFn: services.verification.mine });
  const upload = useMutation({
    mutationFn: (file: File) => services.verification.upload(file, documentKind),
    onSuccess: async () => {
      toast.success("Private document uploaded for authorized review.");
      await queryClient.invalidateQueries({ queryKey: ["verification-me"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const resubmit = useMutation({
    mutationFn: services.verification.resubmit,
    onSuccess: async () => {
      toast.success("Your application was resubmitted for human review.");
      await queryClient.invalidateQueries({ queryKey: ["verification-me"] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user });
    },
    onError: (error) => toast.error(error.message),
  });
  const canResubmit = role === "ngo"
    ? ["rejected", "resubmission_required"].includes(verification.data?.status ?? "")
    : ["rejected", "more_information_required"].includes(verification.data?.status ?? "");
  const badgeStatus = verification.data?.status === "verified" || verification.data?.status === "eligible"
    ? "success"
    : ["rejected", "suspended"].includes(verification.data?.status ?? "") ? "danger" : "warning";
  const allowedKinds: VerificationDocumentKind[] = role === "ngo"
    ? ["ngo_registration", "ngo_address", "ngo_authority", "ngo_additional"]
    : ["volunteer_identity"];
  return <section className="data-card">
    <PageHeader eyebrow="APPLICATION STATUS" title={role === "ngo" ? "Organization verification" : "Volunteer verification"} description="A human reviewer makes verification decisions. Uploaded documents are private evidence and do not themselves prove identity or legal status." />
    {verification.isLoading ? <LoadingCards count={1} /> : verification.isError ? <ErrorState description={verification.error.message} retry={() => verification.refetch()} /> : <div className="form-stack">
      <div className="verification-row"><div className="verification-info"><strong>Current status</strong><small>{verification.data?.reason ?? "Your application is awaiting or has completed review."}</small>{verification.data?.reviewedAt && <small>Last reviewed {new Date(verification.data.reviewedAt).toLocaleString()}</small>}</div><StatusBadge status={badgeStatus}>{verification.data?.status.replaceAll("_", " ")}</StatusBadge></div>
      {!!verification.data?.documents.length && <div className="form-stack"><strong>Uploaded documents</strong>{verification.data.documents.map((document) => <div className="request-edit-file" key={document.id}><FileText size={14} /><span>{document.name} · {document.kind.replaceAll("_", " ")}</span></div>)}</div>}
      <div className="request-form-grid"><label className="form-label">Document category<select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as VerificationDocumentKind)}>{allowedKinds.map((kind) => <option value={kind} key={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label><label className="form-label">Upload a supporting document<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={upload.isPending} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} /><small>JPEG, PNG, WebP, or PDF. The configured server upload limit applies.</small></label></div>
      {canResubmit && <Button disabled={resubmit.isPending} onClick={() => resubmit.mutate()}>{resubmit.isPending ? "Submitting…" : "Resubmit for review"} <ArrowRight size={14} /></Button>}
      {!!verification.data?.history.length && <details><summary>Review history</summary>{verification.data.history.map((entry, index) => <div className="request-edit-file" key={`${entry.occurredAt}-${index}`}><span>{entry.status.replaceAll("_", " ")} · {new Date(entry.occurredAt).toLocaleString()}{entry.reason ? ` · ${entry.reason}` : ""}</span></div>)}</details>}
    </div>}
  </section>;
}

function VolunteerContent({ page, user }: { page: string; user: User }) {
  const dashboard = useQuery({ queryKey: queryKeys.volunteer, queryFn: services.volunteer.dashboard });
  const recommendations = useQuery({ queryKey: [...queryKeys.volunteer, "recommendations"], queryFn: services.volunteer.recommendations, enabled: page === "dashboard" });
  if (page === "dashboard") return <>
    {dashboard.isError && <ErrorState description={dashboard.error.message} retry={() => dashboard.refetch()} />}
    <div className="welcome-row"><div><h2>Hello, {user.name.split(" ")[0]}</h2><p>Let’s find your next way to make an impact.</p></div><Link to="/volunteer/opportunities" className="button button-primary">Find New Opportunities <ArrowRight size={15} /></Link></div>
    <VolunteerTasksWorkspace compact />
    <div className="stat-grid four">{[
      ["Available opportunities", dashboard.data?.stats.availableOpportunities, <Compass />],
      ["Assigned tasks", dashboard.data?.stats.assignedTasks, <ClipboardCheck />],
      ["Active tasks", dashboard.data?.stats.activeTasks, <CalendarDays />],
      ["Completed tasks", dashboard.data?.stats.completedTasks, <Check />],
    ].map(([label, value, icon]) => <StatCard key={String(label)} label={String(label)} value={value === undefined ? "—" : value as string | number} icon={icon as ReactNode} to={label === "Available opportunities" ? "/volunteer/opportunities" : "/volunteer/tasks"} />)}</div>
    <div className="section-title-row"><div><h2>Recommended for you</h2><p>Ranked by your profile interests, skills, and city.</p></div><Link to="/volunteer/opportunities" className="text-link">View all <ArrowRight size={14} /></Link></div>
    {recommendations.isLoading ? <LoadingCards count={3} /> : recommendations.isError ? <ErrorState description={recommendations.error.message} retry={() => recommendations.refetch()} /> : recommendations.data?.length ? <div className="opportunity-grid">{recommendations.data.slice(0, 3).map(({ need, score, reasons }) => <div key={need.id}><OpportunityCard need={need} /><p className="muted-copy">Profile fit: {score}% · {reasons.join(" · ")}</p></div>)}</div> : <EmptyState title="No open opportunities yet." description="Verified organizations’ opportunities will appear here." />}
    {dashboard.data && <div className="data-card"><div className="table-heading"><div><h2>Recent activity</h2><p>Your latest volunteer commitments and contributions.</p></div><Link to="/volunteer/applications" className="text-link">View all <ArrowRight size={14} /></Link></div>{dashboard.data.contributions.length ? dashboard.data.contributions.slice(0, 5).map((row) => <ContributorRow key={row.id} name={row.need?.title ?? "Volunteer opportunity"} detail={`${row.need?.organizationName ?? "Verified organization"} · ${new Date(row.createdAt).toLocaleDateString()}`} status={row.status} />) : <EmptyState title="Your activity will appear here." description="Join a volunteer opportunity to get started." />}</div>}
  </>;
  if (page === "opportunities") return <OpportunityDirectory user={user} />;
  if (page === "tasks") return <VolunteerTasksWorkspace />;
  if (page === "pickups") return <VolunteerItemPickupWorkspace />;
  if (page === "applications") return <VolunteerApplications query={dashboard} page={page} />;
  if (page === "settings") return <VolunteerTaskSettings />;
  if (page === "verification") return <ApplicantVerificationPanel role="volunteer" />;
  if (page === "profile") return <ProfileEditor user={user} />;
  if (page === "notifications") return <MyNotifications role="volunteer" />;
  return <UnavailableFeature name="Volunteer page" reason="This page is not part of the current volunteer workspace." />;
}

const assignmentLabels: Record<string, string> = {
  offered: "Offer received",
  accepted: "Accepted",
  in_progress: "In progress",
  submitted_for_review: "Submitted for NGO review",
  more_evidence_required: "More evidence required",
  rejected_with_reason: "Update requested",
  flagged_for_manual_review: "Flagged for manual review",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
  reassigned: "Reassigned",
  disputed: "Needs NGO follow-up",
};

function VolunteerTasksWorkspace({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const available = useQuery({ queryKey: ["volunteer-task-offers"], queryFn: services.volunteer.availableTasks });
  const assignments = useQuery({ queryKey: ["volunteer-assignments"], queryFn: services.volunteer.assignments });
  const [selectedId, setSelectedId] = useState<string>();
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [report, setReport] = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [unresolvedIssues, setUnresolvedIssues] = useState("");
  const [recipientConfirmed, setRecipientConfirmed] = useState(false);
  const [consentedToAiReview, setConsentedToAiReview] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<{ url: string; name: string; contentType: string }>();
  const offers = available.data?.tasks ?? [];
  const rows = assignments.data ?? [];
  const selected = rows.find((item) => item.id === selectedId);
  useEffect(() => () => {
    if (evidencePreview?.url) URL.revokeObjectURL(evidencePreview.url);
  }, [evidencePreview?.url]);
  const historyRows = rows.filter((item) =>
    !["offered", "accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"].includes(item.status),
  );
  const task = useQuery({
    queryKey: ["volunteer-private-task", selectedId],
    queryFn: () => services.volunteer.privateTask(selectedId!),
    enabled: Boolean(selectedId && selected?.canAccessDetails),
  });
  const evidence = useQuery({
    queryKey: ["volunteer-assignment-evidence", selectedId],
    queryFn: () => services.volunteer.evidence(selectedId!),
    enabled: Boolean(selectedId && ["in_progress", "more_evidence_required", "rejected_with_reason", "submitted_for_review", "flagged_for_manual_review", "completed"].includes(selected?.status ?? "")),
  });
  const proofHistory = useQuery({
    queryKey: ["volunteer-completion-proofs", selectedId],
    queryFn: () => services.volunteer.completionProofs(selectedId!),
    enabled: Boolean(selectedId && selected?.canAccessDetails),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["volunteer-task-offers"] }),
      queryClient.invalidateQueries({ queryKey: ["volunteer-assignments"] }),
      queryClient.invalidateQueries({ queryKey: ["volunteer-private-task"] }),
      queryClient.invalidateQueries({ queryKey: ["volunteer-assignment-evidence"] }),
      queryClient.invalidateQueries({ queryKey: ["volunteer-completion-proofs"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    ]);
  };
  const action = useMutation({
    mutationFn: async (input: { type: "accept" | "decline" | "start" | "cancel" | "issue"; id: string; reason?: string }) => {
      if (input.type === "accept") return services.volunteer.acceptOffer(input.id);
      if (input.type === "decline") return services.volunteer.declineOffer(input.id);
      if (input.type === "start") return services.volunteer.startAssignment(input.id);
      if (input.type === "cancel") return services.volunteer.cancelAssignment(input.id, input.reason ?? "");
      return services.volunteer.reportIssue(input.id, input.reason ?? "");
    },
    onSuccess: async (_, variables) => {
      toast.success(variables.type === "accept" ? "Task accepted. Private task details are now available." : variables.type === "decline" ? "Offer declined." : variables.type === "start" ? "Task marked as in progress." : "The NGO has been notified.");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const progressUpdate = useMutation({
    mutationFn: () => services.volunteer.updateProgress(selectedId!, progress.trim()),
    onSuccess: async () => { setProgress(""); toast.success("Progress update saved."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const upload = useMutation({
    mutationFn: (file: File) => services.volunteer.uploadEvidence(selectedId!, file),
    onSuccess: async () => { toast.success("Private evidence uploaded."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const submit = useMutation({
    mutationFn: () => services.volunteer.submitCompletionProof(selectedId!, {
      summary: summary.trim(),
      report: report.trim(),
      completedAt: new Date(completedAt).toISOString(),
      ...(unresolvedIssues.trim() ? { unresolvedIssues: unresolvedIssues.trim() } : {}),
      recipientConfirmed,
      consentedToAiReview,
    }),
    onSuccess: async (result) => {
      setSummary("");
      setReport("");
      setUnresolvedIssues("");
      setRecipientConfirmed(false);
      setConsentedToAiReview(false);
      toast.success(`Evidence submitted. Automated review: ${result.aiReview.recommendation.replaceAll("_", " ")}. NGO approval is still required.`);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const downloadEvidence = async (item: AssignmentEvidence) => {
    try {
      const blob = await services.volunteer.downloadEvidence(selectedId!, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private evidence could not be downloaded.");
    }
  };
  const previewEvidence = async (item: AssignmentEvidence) => {
    try {
      const blob = await services.volunteer.downloadEvidence(selectedId!, item.id);
      setEvidencePreview({ url: URL.createObjectURL(blob), name: item.name, contentType: item.contentType });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private evidence preview is unavailable.");
    }
  };
  if (available.isLoading || assignments.isLoading) return <LoadingCards count={compact ? 1 : 2} />;
  if (available.isError) return <ErrorState description={available.error.message} retry={() => available.refetch()} />;
  if (assignments.isError) return <ErrorState description={assignments.error.message} retry={() => assignments.refetch()} />;
  const active = rows.filter((item) => ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"].includes(item.status));
  return <section className={`volunteer-task-workspace ${compact ? "compact" : ""}`}>
    {!compact && <PageHeader eyebrow="PRIVATE TASK OFFERS" title="Tasks for you" description="Only task summaries are shown before acceptance. Exact locations and contact details are available to the assigned volunteer after the server records an acceptance." />}
    {!available.data?.eligibility && offers.length === 0 && <div className="document-notice"><ShieldCheck size={16} /><span>Your profile must be marked eligible by an administrator and task opt-in must be enabled before offers can be received. <Link className="text-link" to="/volunteer/settings">Review task preferences <ArrowRight size={13} /></Link></span></div>}
    {offers.length > 0 && <div className="data-card">
      <div className="table-heading"><div><h2>Nearby available tasks</h2><p>Match distance is shown only when valid coordinates are available. Accepting claims the task atomically.</p></div>{compact && <Link className="text-link" to="/volunteer/tasks">All tasks <ArrowRight size={13} /></Link>}</div>
      <div className="volunteer-task-list">{(compact ? offers.slice(0, 3) : offers).map((offer) => <VolunteerOfferCard key={offer.assignmentId} offer={offer} pending={action.isPending} onAccept={() => action.mutate({ type: "accept", id: offer.assignmentId })} onDecline={() => action.mutate({ type: "decline", id: offer.assignmentId })} />)}</div>
    </div>}
    {offers.length === 0 && !compact && <EmptyState title="No task offers right now." description="Offers appear here when an NGO-approved request matches your skills, service area, availability, and opt-in settings." action={<Link to="/volunteer/settings" className="button button-outline">Update task preferences <Settings size={14} /></Link>} />}
    {active.length > 0 && <div className="data-card">
      <div className="table-heading"><div><h2>My active assignments</h2><p>Task progress and deadlines are based on the NGO’s latest assignment record.</p></div></div>
      <div className="volunteer-task-list">{active.map((item) => <article className={`volunteer-task-card ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
        <div className="volunteer-task-main"><span className="eyebrow">{item.category.replaceAll("_", " ")} · {item.urgency} urgency</span><h3>{item.summary}</h3><p>{item.city} · {item.organizationName}</p><StatusBadge status={item.status === "in_progress" ? "success" : "warning"}>{assignmentLabels[item.status] ?? item.status}</StatusBadge>
          {item.deadlineAt && <small><Clock size={12} /> Deadline {new Date(item.deadlineAt).toLocaleString()}</small>}
          {item.isOverdue && <small className="request-needs-info"><TriangleAlert size={12} /> Deadline passed · contact the NGO or report an issue</small>}
          {item.progressNote && <p className="muted-copy">{item.progressNote}</p>}
        </div><div className="verification-actions">
          {item.canAccessDetails && <Button variant="outline" onClick={() => setSelectedId(item.id)}>Secure task details</Button>}
          {item.status === "accepted" && <Button disabled={action.isPending} onClick={() => action.mutate({ type: "start", id: item.id })}><Play size={13} /> Start</Button>}
          {(item.status === "accepted" || item.status === "in_progress") && <Button variant="quiet" disabled={action.isPending} onClick={() => {
            const value = window.prompt("Why can this task not continue?");
            if (value?.trim()) action.mutate({ type: "issue", id: item.id, reason: value.trim() });
          }}><TriangleAlert size={13} /> Report issue</Button>}
        </div>
      </article>)}</div>
    </div>}
    {selectedId && selected && selected.canAccessDetails && <div className="data-card volunteer-private-panel">
      <div className="table-heading"><div><span className="eyebrow">ASSIGNED VOLUNTEER ONLY</span><h2>Private task details</h2></div><button className="icon-button" aria-label="Close private details" onClick={() => setSelectedId(undefined)}><X size={15} /></button></div>
      {task.isLoading ? <LoadingCards count={1} /> : task.isError ? <ErrorState description={task.error.message} retry={() => task.refetch()} /> : task.data && <div className="volunteer-private-details">
        <p>{task.data.description}</p>
        <div className="document-notice"><MapPin size={15} /><span>{task.data.addressLine ? `${task.data.addressLine}, ` : ""}{task.data.city}{task.data.coordinates ? ` · ${task.data.coordinates.latitude.toFixed(5)}, ${task.data.coordinates.longitude.toFixed(5)}` : ""}</span></div>
        <p><strong>Requester contact:</strong> {task.data.contact.requesterName} · {task.data.contact.preferredMethod === "in_app" ? "In-app contact only" : task.data.contact.value ?? `${task.data.contact.preferredMethod} unavailable`}</p>
        {task.data.deadlineAt && <p><strong>Deadline:</strong> {new Date(task.data.deadlineAt).toLocaleString()}</p>}
        {task.data.completionEvidenceChecklist.length > 0 && <div className="ngo-completion-proof"><h4>Requested completion evidence</h4><ul>{task.data.completionEvidenceChecklist.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {selected.status === "in_progress" && <label className="form-label">Progress update<textarea rows={2} maxLength={500} value={progress} onChange={(event) => setProgress(event.target.value)} placeholder="Share a brief, non-sensitive progress update." /></label>}
        {selected.status === "in_progress" && <Button variant="outline" disabled={!progress.trim() || progressUpdate.isPending} onClick={() => progressUpdate.mutate()}>{progressUpdate.isPending ? "Saving…" : "Save progress"}</Button>}
        {["in_progress", "more_evidence_required", "rejected_with_reason"].includes(selected.status) && <>
          {selected.status !== "in_progress" && <div className="document-notice"><TriangleAlert size={15} /><span>The NGO requested an update. Previous submissions remain in the review history; add new evidence before resubmitting.</span></div>}
          <label className="form-label">Completion photo or document<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} /><small>Private JPEG, PNG, WebP, or PDF · maximum five files per assignment, subject to the configured per-file size limit.</small></label>
          <div className="request-form-grid">
            <label className="form-label">Completion summary<input maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Briefly summarize the outcome" /></label>
            <label className="form-label">Completion date and time<input type="datetime-local" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} /></label>
          </div>
          <label className="form-label">Work performed and outcome<textarea rows={4} maxLength={5000} value={report} onChange={(event) => setReport(event.target.value)} placeholder="Describe the work performed and outcome. Avoid unnecessary sensitive information." /></label>
          <label className="form-label">Unresolved issues or follow-up needs (optional)<textarea rows={2} maxLength={2000} value={unresolvedIssues} onChange={(event) => setUnresolvedIssues(event.target.value)} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.target.checked)} /><span><strong>Recipient confirmed the assistance, if appropriate</strong><small>Optional. Do not upload or enter recipient identity details without consent.</small></span></label>
          <label className="checkbox-row"><input type="checkbox" checked={consentedToAiReview} onChange={(event) => setConsentedToAiReview(event.target.checked)} /><span><strong>Allow configured OCR/AI providers to assist review</strong><small>If enabled and configured, Google Vision may process image evidence and OpenAI may receive the report and extracted text. This is optional; the NGO can review manually either way.</small></span></label>
          <Button disabled={submit.isPending || summary.trim().length < 5 || report.trim().length < 10 || !completedAt || !evidence.data?.length} onClick={() => submit.mutate()}><Upload size={14} /> {submit.isPending ? "Submitting…" : "Submit completion evidence"}</Button>
        </>}
        {evidence.data?.map((item) => <div className="request-document-row" key={item.id}><FileText size={15} /><span>{item.name}</span>{item.contentType.startsWith("image/") && <Button variant="outline" onClick={() => void previewEvidence(item)}>Preview privately</Button>}<Button variant="outline" onClick={() => void downloadEvidence(item)}>Download privately</Button></div>)}
        {evidencePreview && <div className="private-evidence-preview" role="dialog" aria-modal="true" aria-label={`Private preview: ${evidencePreview.name}`}>
          <div className="private-evidence-preview-card"><div className="table-heading"><strong>{evidencePreview.name}</strong><button className="icon-button" aria-label="Close preview" onClick={() => setEvidencePreview(undefined)}><X size={15} /></button></div><img src={evidencePreview.url} alt={`Private evidence preview: ${evidencePreview.name}`} /></div>
        </div>}
        {proofHistory.data?.length ? <div className="ngo-completion-proof"><h4>Submission history</h4>{proofHistory.data.map((proof) => <article className="mini-task" key={proof.id}><span><strong>{proof.summary}</strong><small>{new Date(proof.submittedAt).toLocaleString()} · {assignmentLabels[proof.status] ?? proof.status}</small>{proof.reviewReason && <small>NGO note: {proof.reviewReason}</small>}{proof.aiReview && <small>AI recommendation: {proof.aiReview.recommendation.replaceAll("_", " ")} · human review required</small>}</span><StatusBadge status={proof.status === "approved" ? "success" : proof.status === "rejected" ? "danger" : "warning"}>{proof.status.replaceAll("_", " ")}</StatusBadge></article>)}</div> : null}
        {selected.status === "in_progress" && <>
          <Button variant="quiet" disabled={action.isPending} onClick={() => {
            const value = window.prompt("Why are you cancelling this assignment?");
            if (value?.trim()) action.mutate({ type: "cancel", id: selected.id, reason: value.trim() });
          }}>Cancel assignment</Button>
        </>}
        {selected.status === "submitted_for_review" && <p className="muted-copy">Your evidence is awaiting NGO review. The AI output is advisory only; only an authorized NGO can approve and close the request.</p>}
        {selected.status === "flagged_for_manual_review" && <p className="muted-copy">This submission is awaiting administrator review before it can return to the NGO.</p>}
        {selected.status === "completed" && <p className="muted-copy">The owning NGO approved completion and closed this request.</p>}
      </div>}
    </div>}
    {!compact && historyRows.length > 0 && <div className="data-card">
      <div className="table-heading"><div><h2>Assignment history</h2><p>Past offers and assignments are retained for your account.</p></div></div>
      {historyRows.map((item) => <article className="ngo-assignment-row" key={item.id}>
        <div><strong>{item.summary}</strong><p>{item.city} · {item.organizationName} · Updated {new Date(item.updatedAt).toLocaleString()}</p></div>
        <StatusBadge status={item.status === "completed" ? "success" : item.status === "disputed" ? "danger" : "neutral"}>{assignmentLabels[item.status] ?? item.status}</StatusBadge>
      </article>)}
    </div>}
  </section>;
}

function VolunteerOfferCard({ offer, pending, onAccept, onDecline }: {
  offer: VolunteerTaskOffer; pending: boolean; onAccept: () => void; onDecline: () => void;
}) {
  return <article className="volunteer-task-card">
    <div className="volunteer-task-main"><span className="eyebrow">{offer.category.replaceAll("_", " ")} · {offer.urgency} urgency</span><h3>{offer.summary}</h3>
      <p>{offer.city} · {offer.organizationName} · {offer.peopleCount} {offer.peopleCount === 1 ? "person" : "people"}</p>
      <p>{offer.approximateDistanceKm === undefined ? "Distance unavailable" : `About ${offer.approximateDistanceKm} km away`}{offer.deadlineAt ? ` · Deadline ${new Date(offer.deadlineAt).toLocaleString()}` : ""}</p>
      <ul>{offer.matchExplanation.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <small><Clock size={12} /> Offer expires {new Date(offer.expiresAt).toLocaleString()}</small>
    </div>
    <div className="verification-actions"><Button disabled={pending} onClick={onAccept}>Accept task <Check size={13} /></Button><Button variant="outline" disabled={pending} onClick={onDecline}>Decline</Button></div>
  </article>;
}

function VolunteerTaskSettings() {
  const queryClient = useQueryClient();
  const preferences = useQuery({ queryKey: ["volunteer-preferences"], queryFn: services.volunteer.preferences });
  const [taskOptIn, setTaskOptIn] = useState(false);
  const [city, setCity] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [serviceRadius, setServiceRadius] = useState("30");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  useEffect(() => {
    if (!preferences.data) return;
    setTaskOptIn(preferences.data.taskOptIn);
    setCity(preferences.data.city);
    setServiceArea(preferences.data.serviceArea);
    setServiceRadius(String(preferences.data.serviceRadiusKm));
    setLatitude(preferences.data.coordinates ? String(preferences.data.coordinates.latitude) : "");
    setLongitude(preferences.data.coordinates ? String(preferences.data.coordinates.longitude) : "");
  }, [preferences.data]);
  const save = useMutation({
    mutationFn: () => {
      const hasLatitude = latitude.trim() !== "";
      const hasLongitude = longitude.trim() !== "";
      if (hasLatitude !== hasLongitude) throw new Error("Enter both coordinates or leave both blank.");
      const coordinates = hasLatitude && hasLongitude ? { latitude: Number(latitude), longitude: Number(longitude) } : undefined;
      if (coordinates && (!Number.isFinite(coordinates.latitude) || coordinates.latitude < -90 || coordinates.latitude > 90 ||
        !Number.isFinite(coordinates.longitude) || coordinates.longitude < -180 || coordinates.longitude > 180)) {
        throw new Error("Enter valid latitude and longitude values.");
      }
      const radius = Number(serviceRadius);
      if (!Number.isInteger(radius) || radius < 1 || radius > 500) throw new Error("Service radius must be from 1 to 500 km.");
      return services.volunteer.updatePreferences({
        taskOptIn,
        city: city.trim(),
        serviceArea: serviceArea.trim(),
        serviceRadiusKm: radius,
        clearCoordinates: !coordinates,
        ...(coordinates ? { coordinates } : {}),
      });
    },
    onSuccess: async () => { toast.success("Task preferences saved."); await queryClient.invalidateQueries({ queryKey: ["volunteer-preferences"] }); await queryClient.invalidateQueries({ queryKey: ["volunteer-task-offers"] }); },
    onError: (error) => toast.error(error.message),
  });
  if (preferences.isLoading) return <LoadingCards count={1} />;
  if (preferences.isError) return <ErrorState description={preferences.error.message} retry={() => preferences.refetch()} />;
  const current = preferences.data!;
  return <section className="data-card volunteer-preferences">
    <PageHeader eyebrow="VOLUNTEER ELIGIBILITY" title="Task preferences" description="Eligibility is reviewed by an administrator. Opting in and adding service details does not automatically verify your account." />
    <div className="document-notice"><ShieldCheck size={16} /><span>Eligibility: <strong>{current.eligibility.replaceAll("_", " ")}</strong> · {current.activeAssignments} of {current.maxActiveAssignments} active assignments</span></div>
    {current.eligibility === "suspended" && <p className="field-error">Your task access is suspended. Contact an administrator if this is unexpected.</p>}
    <label className="checkbox-row"><input type="checkbox" checked={taskOptIn} onChange={(event) => setTaskOptIn(event.target.checked)} /><span><strong>Opt in to receive approved help-request task offers</strong><small>Other volunteers cannot see your contact details or private profile.</small></span></label>
    <div className="request-form-grid">
      <label className="form-label">Service city<input value={city} onChange={(event) => setCity(event.target.value)} maxLength={100} /></label>
      <label className="form-label">Service area<input value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} maxLength={500} placeholder="Cities, districts, or localities" /></label>
      <label className="form-label">Service radius (km)<input type="number" min="1" max="500" value={serviceRadius} onChange={(event) => setServiceRadius(event.target.value)} /></label>
      <label className="form-label">Latitude (optional)<input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
      <label className="form-label">Longitude (optional)<input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
    </div>
    <p className="muted-copy">Coordinates are used only for matching and are not shared with other volunteers. Your skill/category tags are managed in My Profile.</p>
    <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save preferences"} <Check size={14} /></Button>
  </section>;
}

function VolunteerApplications({ query, page }: { query: UseQueryResult<VolunteerDashboardData, Error>; page: string }) {
  if (query.isLoading) return <LoadingCards />;
  if (query.isError) return <ErrorState description={query.error.message} retry={() => query.refetch()} />;
  const rows = query.data?.contributions ?? [];
  if (!rows.length) return <EmptyState title="Your next opportunity is waiting." description="Apply to a volunteer task and it will appear here." action={<Link to="/volunteer/opportunities" className="button button-primary">Find opportunities <ArrowRight size={14} /></Link>} />;
  return <div className="data-card"><div className="table-heading"><div><h2>{page === "tasks" ? "My tasks" : "My applications"}</h2><p>Volunteer commitments recorded on your account.</p></div></div><div className="responsive-table"><table><thead><tr><th>Opportunity</th><th>Organization</th><th>Applied</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.need?.title ?? "Opportunity"}</td><td>{row.need?.organizationName ?? "Verified organization"}</td><td>{new Date(row.createdAt).toLocaleDateString()}</td><td><StatusBadge status={row.status === "completed" ? "success" : "warning"}>{row.status === "completed" ? "Completed" : "Pending"}</StatusBadge></td></tr>)}</tbody></table></div></div>;
}

function NgoContent({ page, user }: { page: string; user: User }) {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: queryKeys.ngo, queryFn: services.ngo.dashboard });
  const itemDonations = useQuery({
    queryKey: ["ngo-item-donations"],
    queryFn: services.itemDonations.ngoInbox,
    enabled: page === "dashboard" && user.organizationStatus === "verified",
  });
  const [createOpen, setCreateOpen] = useState(false);
  if (page === "requests") return <NgoRequestInbox verified={user.organizationStatus === "verified"} />;
  if (page === "completion-reviews") return <NgoCompletionReviewInbox verified={user.organizationStatus === "verified"} />;
  if (page === "item-needs" || page === "inventory") return <NgoItemDonationInbox verified={user.organizationStatus === "verified"} completedOnly={page === "inventory"} />;
  if (page === "donations") return <NgoMoneyDonations verified={user.organizationStatus === "verified"} />;
  if (page === "dashboard") return <>
    {dashboard.isError && <ErrorState description={dashboard.error.message} retry={() => dashboard.refetch()} />}
    {user.organizationStatus !== "verified" && <div className="verification-banner"><ShieldCheck size={18} /><div><strong>{user.organizationStatus === "rejected" ? "Your NGO application was rejected." : user.organizationStatus === "resubmission_required" ? "Your NGO application needs changes." : "Your NGO verification is pending."}</strong><span>{user.verificationReason ?? "You can update your organization profile while our team reviews your registration."}</span></div><Link to="/ngo/verification">{user.organizationStatus === "rejected" || user.organizationStatus === "resubmission_required" ? "Update application" : "View status"} <ArrowRight size={13} /></Link></div>}
    <div className="welcome-row"><div><h2>Welcome back, {user.name}</h2><p>Here’s what’s happening with your organization.</p></div><Button onClick={() => user.organizationStatus === "verified" ? setCreateOpen(true) : toast.error("Your organization must be verified before publishing a task.")}><Plus size={15} /> Create New Task</Button></div>
    <NgoAssignmentQueuePreview verified={user.organizationStatus === "verified"} />
    <div className="stat-grid four">{[
      ["Active Tasks", dashboard.data?.stats.activeTasks, <ClipboardCheck />], ["Volunteers", dashboard.data?.stats.volunteers, <Users />],
      ["Funds Raised", `₹${dashboard.data?.stats.donations.toLocaleString("en-IN") ?? "—"}`, <Wallet />],
      ["Item donations awaiting action", user.organizationStatus !== "verified" ? "—" : itemDonations.isLoading ? "…" : itemDonations.isError ? "—" : (itemDonations.data ?? []).filter((item) => ["pending_ngo_review", "needs_information", "awaiting_pickup_assignment", "picked_up"].includes(item.status)).length, <Heart />],
    ].map(([label, value, icon]) => <StatCard key={String(label)} label={String(label)} value={value === undefined ? "—" : value as string | number} icon={icon as ReactNode} to={label === "Active Tasks" ? "/ngo/tasks" : label === "Volunteers" ? "/ngo/applications" : label === "Funds Raised" ? "/ngo/donations" : "/ngo/item-needs"} />)}</div>
    <div className="stat-grid four">{[
      ["Incoming requests", dashboard.data?.stats.incomingRequests, <FileText />],
      ["Pending reviews", dashboard.data?.stats.pendingReviews, <Clock />],
      ["Approved requests", dashboard.data?.stats.approvedRequests, <Check />],
      ["Active assignments", dashboard.data?.stats.activeAssignments, <Users />],
      ["Completed requests", dashboard.data?.stats.completedRequests, <BadgeCheck />],
    ].map(([label, value, icon]) => <StatCard key={String(label)} label={String(label)} value={value === undefined ? "—" : value as string | number} icon={icon as ReactNode} to={label === "Incoming requests" || label === "Pending reviews" ? "/ngo/requests" : "/ngo/completion-reviews"} />)}</div>
    <Link to="/ngo/item-needs" className="text-link">Open item donation and pickup inbox <ArrowRight size={14} /></Link>
    <div className="dashboard-columns"><div className="data-card"><div className="table-heading"><div><h2>Recent volunteers</h2><p>People who joined your opportunities.</p></div><Link to="/ngo/applications" className="text-link">View all <ArrowRight size={14} /></Link></div>{dashboard.data?.recentVolunteers.length ? dashboard.data.recentVolunteers.slice(0, 5).map((person) => <ContributorRow key={person.id} name={person.name} detail={person.city} status={person.status} />) : <EmptyState title="No volunteer applications yet." description="Applicants will appear here as they join your tasks." />}</div><div className="data-card"><div className="table-heading"><div><h2>Your open tasks</h2><p>Recently published opportunities.</p></div></div>{dashboard.data?.needs.slice(0, 4).map((need) => <div className="mini-task" key={need.id}><span className="mini-task-icon"><Sprout size={15} /></span><span><strong>{need.title}</strong><small>{need.kind} · {need.city}</small></span><StatusBadge status={need.urgency === "high" ? "warning" : "success"}>{need.urgency}</StatusBadge></div>)}{dashboard.data?.needs.length === 0 && <p className="muted-copy">Your published tasks will appear here.</p>}</div></div>
    {createOpen && <NeedDialog onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); toast.success("Opportunity published."); await queryClient.invalidateQueries(); }} />}
  </>;
  if (page === "tasks") return <NgoTasks dashboard={dashboard} onCreate={() => setCreateOpen(true)} />;
  if (page === "profile" || page === "verification") return <NgoVerificationProfile user={user} />;
  if (page === "notifications") return <MyNotifications role="ngo" />;
  if (page === "analytics") return <ImpactAnalytics embedded />;
  if (page === "applications") return <NgoApplications dashboard={dashboard} />;
  if (page === "campaigns") return <NgoTasks dashboard={dashboard} onCreate={() => setCreateOpen(true)} />;
  return <UnavailableFeature name="NGO page" reason="This page is not part of the current organization workspace." />;
}

type NgoReviewAction = "approve" | "needs_information" | "flag_for_review" | "decline";
const ngoReviewActionLabels: Record<NgoReviewAction, string> = {
  approve: "Accept request",
  needs_information: "Request information",
  flag_for_review: "Flag for human review",
  decline: "Decline and reopen matching",
};

function NgoRequestInbox({ verified }: { verified: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [dialogAction, setDialogAction] = useState<NgoReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const inbox = useQuery({ queryKey: ["ngo-incoming-requests"], queryFn: services.ngo.requests, enabled: verified });
  const detail = useQuery({
    queryKey: ["ngo-request-detail", selectedId],
    queryFn: () => services.ngo.requestDetail(selectedId!),
    enabled: Boolean(verified && selectedId),
  });
  const review = useMutation({
    mutationFn: (data: { id: string; action: "start_review" | NgoReviewAction; reason?: string }) =>
      services.ngo.reviewRequest(data.id, { action: data.action, ...(data.reason ? { reason: data.reason } : {}) }),
    onSuccess: async (_, variables) => {
      toast.success(variables.action === "approve" ? "Request accepted. You can now offer it to eligible volunteers." : variables.action === "decline" ? "Request declined and made available for reassignment." : variables.action === "needs_information" ? "Information request sent to the requester." : variables.action === "flag_for_review" ? "Request flagged for human review." : "Review started.");
      setDialogAction(null);
      setReason("");
      if (variables.action === "decline") setSelectedId(undefined);
      await Promise.all([
        inbox.refetch(),
        queryClient.invalidateQueries({ queryKey: ["ngo-request-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["help-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const download = async (requestId: string, documentId: string, name: string) => {
    try {
      const blob = await services.ngo.downloadRequestDocument(requestId, documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private file could not be downloaded.");
    }
  };
  if (!verified) return <EmptyState title="Organization verification is required." description="Only verified NGOs can receive and review private help requests." action={<Link to="/ngo/verification" className="button button-primary">View verification <ArrowRight size={14} /></Link>} />;
  const selectedDetail = detail.data;
  const selectedRequest = selectedDetail?.request;
  return <section className="ngo-request-inbox">
    <PageHeader eyebrow="PRIVATE REQUEST ROUTING" title="Incoming help requests" description="Only requests specifically routed to your verified organization appear here. Requester contact details are not exposed." />
    {inbox.isLoading ? <LoadingCards /> : inbox.isError ? <ErrorState description={inbox.error.message} retry={() => inbox.refetch()} /> : !inbox.data?.length ? <EmptyState title="No incoming requests." description="Requests selected for your organization will appear here. Unrelated NGO applications never see these details." /> : <div className="request-workspace-grid">
      <div className="request-list" aria-label="Incoming help requests">{inbox.data.map((request) => <button key={request.id} className={`request-list-card ${selectedId === request.id ? "selected" : ""}`} onClick={() => setSelectedId(request.id)}>
        <span className="request-list-top"><strong>{request.title}</strong><StatusBadge status={request.status === "flagged_for_review" ? "danger" : "warning"}>{requestStatuses[request.status]}</StatusBadge></span>
        <span>{request.reference} · {request.category.replaceAll("_", " ")} · {request.city}</span>
        <small>{request.urgency} urgency · {request.peopleCount} people · {new Date(request.createdAt).toLocaleDateString()}</small>
        {request.reviewFlags.length > 0 && <strong className="request-needs-info">Human review flags: {request.reviewFlags.length}</strong>}
      </button>)}</div>
      <div className="request-detail-panel">
        {!selectedId ? <EmptyState title="Select an incoming request" description="Review the request summary and screening notes before taking an action." /> : detail.isLoading ? <LoadingCards count={1} /> : detail.isError ? <ErrorState description={detail.error.message} retry={() => detail.refetch()} /> : selectedDetail && selectedRequest && <>
          <div className="request-detail-heading"><div><span className="eyebrow">REQUEST {selectedRequest.reference}</span><h2>{selectedRequest.title}</h2><p>{selectedRequest.city} · Received {new Date(selectedRequest.createdAt).toLocaleString()}</p></div><StatusBadge status="warning">{requestStatuses[selectedRequest.status]}</StatusBadge></div>
          <p>{selectedRequest.description}</p>
          <div className="request-detail-meta"><span>Category: {selectedRequest.category.replaceAll("_", " ")}</span><span>Urgency: {selectedRequest.urgency}</span><span>People: {selectedRequest.peopleCount}</span><span>Contact preference: {selectedRequest.preferredContactMethod}</span></div>
          {selectedRequest.addressLine && <div className="document-notice"><MapPin size={16} /><span>Private pickup location, visible only to the assigned NGO: {selectedRequest.addressLine}, {selectedRequest.city}</span></div>}
          {selectedRequest.screening && <div className="request-screening-summary"><strong>Automated screening is advisory. Human review is required.</strong>{selectedRequest.screening.reasons.map((item) => <p key={item}>{item}</p>)}{selectedRequest.screening.missingFields.length > 0 && <p>Fields to review: {selectedRequest.screening.missingFields.join(", ")}</p>}{selectedRequest.screening.additionalInformation.length > 0 && <p>Possible follow-up: {selectedRequest.screening.additionalInformation.join(" · ")}</p>}</div>}
          <div><h3>Private supporting documents</h3>{selectedDetail.documents.length ? selectedDetail.documents.map((document) => <div className="request-document-row" key={document.id}><FileText size={17} /><span><strong>{document.name}</strong><small>{document.ocrStatus.replaceAll("_", " ")} · {(document.byteSize / 1024).toFixed(0)} KB</small></span><Button variant="outline" onClick={() => void download(selectedRequest.id, document.id, document.name)}>Download securely</Button></div>) : <p className="muted-copy">No supporting documents were attached.</p>}</div>
          {["approved", "matching_volunteer", "assigned", "in_progress", "pending_completion_review", "more_evidence_required"].includes(selectedRequest.status) &&
            <NgoAssignmentMonitor requestId={selectedRequest.id} requestStatus={selectedRequest.status} />}
          <div className="verification-actions ngo-review-actions">
            {["pending_ngo_review", "flagged_for_review"].includes(selectedRequest.status) && <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: selectedRequest.id, action: "start_review" })}>Start review</Button>}
            {["pending_ngo_review", "under_review", "flagged_for_review"].includes(selectedRequest.status) && <>
              <Button disabled={review.isPending} onClick={() => { setDialogAction("approve"); setReason(""); }}>Accept request</Button>
              <Button variant="outline" disabled={review.isPending} onClick={() => { setDialogAction("needs_information"); setReason(""); }}>Request information</Button>
              {selectedRequest.status !== "flagged_for_review" && <Button variant="quiet" disabled={review.isPending} onClick={() => { setDialogAction("flag_for_review"); setReason(""); }}>Flag for review</Button>}
            </>}
            {["pending_ngo_review", "under_review", "needs_information", "flagged_for_review"].includes(selectedRequest.status) &&
              <Button variant="quiet" disabled={review.isPending} onClick={() => { setDialogAction("decline"); setReason(""); }}>Decline</Button>}
            {selectedRequest.status === "needs_information" && <span className="muted-copy">Waiting for the requester to provide the requested information and resubmit for screening.</span>}
          </div>
          <div><h3>Request history</h3><ol className="request-timeline">{selectedRequest.timeline.map((event, index) => <li key={`${event.status}-${event.occurredAt}-${index}`}><StatusBadge status="neutral">{requestStatuses[event.status]}</StatusBadge><time>{new Date(event.occurredAt).toLocaleString()}</time>{event.reason && <p>{event.reason}</p>}</li>)}</ol></div>
        </>}
      </div>
    </div>}
    {dialogAction && selectedRequest && <div className="review-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogAction(null); }}>
      <section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="ngo-review-dialog-title">
        <button className="review-dialog-close" aria-label="Close dialog" onClick={() => setDialogAction(null)}><X size={18} /></button>
        <span className="eyebrow">HUMAN REVIEW DECISION</span><h2 id="ngo-review-dialog-title">{ngoReviewActionLabels[dialogAction]}</h2>
        <p>{dialogAction === "decline" ? "This declines your organization’s offer, not the requester’s eligibility. The request returns to the requester so they can select another eligible NGO." : dialogAction === "approve" ? "Accepting confirms your organization will take this request. You can then explicitly send limited task offers to eligible volunteers; requester contact and exact location remain private until a volunteer accepts." : dialogAction === "needs_information" ? "Explain precisely what information the requester should provide." : "Explain why this request needs additional human review."}</p>
        {dialogAction !== "approve" && <label className="form-label">Reason or requested information<textarea autoFocus rows={4} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={dialogAction === "needs_information" ? "List the missing information needed to continue review." : "Provide a clear reason for this decision."} /></label>}
        <div className="verification-actions"><Button variant="outline" onClick={() => setDialogAction(null)}>Cancel</Button><Button disabled={review.isPending || (dialogAction !== "approve" && !reason.trim())} onClick={() => review.mutate({ id: selectedRequest.id, action: dialogAction, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>{review.isPending ? "Saving…" : ngoReviewActionLabels[dialogAction]}</Button></div>
      </section>
    </div>}
  </section>;
}

function NgoAssignmentQueuePreview({ verified }: { verified: boolean }) {
  const inbox = useQuery({ queryKey: ["ngo-incoming-requests"], queryFn: services.ngo.requests, enabled: verified });
  if (!verified) return null;
  if (inbox.isLoading) return <LoadingCards count={1} />;
  if (inbox.isError) return <ErrorState description={inbox.error.message} retry={() => inbox.refetch()} />;
  const queue = (inbox.data ?? []).filter((item) =>
    ["approved", "matching_volunteer", "assigned", "in_progress", "pending_completion_review", "more_evidence_required"].includes(item.status),
  );
  const awaiting = queue.filter((item) => ["approved", "matching_volunteer"].includes(item.status));
  return <section className="data-card ngo-assignment-queue">
    <div className="table-heading"><div><h2>Volunteer matching queue</h2><p>{awaiting.length} approved request(s) awaiting volunteer assignment · {queue.length} active task(s) tracked.</p></div><Link className="text-link" to="/ngo/requests">Open request inbox <ArrowRight size={13} /></Link></div>
    {queue.length ? queue.slice(0, 4).map((item) => <Link className="mini-task" key={item.id} to="/ngo/requests">
      <span className="mini-task-icon"><Users size={15} /></span><span><strong>{item.title}</strong><small>{item.city} · {item.category.replaceAll("_", " ")} · {requestStatuses[item.status]}</small></span><StatusBadge status={item.urgency === "high" ? "warning" : "neutral"}>{item.urgency}</StatusBadge>
    </Link>) : <p className="muted-copy">Approved requests and volunteer assignments will appear here.</p>}
  </section>;
}

function CompletionAiAssessment({ assessment }: { assessment: CompletionAiReview | null | undefined }) {
  if (!assessment) return <div className="document-notice"><ShieldCheck size={15} /><span>No automated assessment is available. Continue with human review.</span></div>;
  const unavailable = assessment.recommendation === "provider_unavailable";
  return <div className="ngo-completion-proof">
    <div className="table-heading"><div><h4>AI-assisted review · advisory only</h4><small>{assessment.provider}{assessment.model ? ` · ${assessment.model}` : ""}{assessment.assessedAt ? ` · ${new Date(assessment.assessedAt).toLocaleString()}` : ""}</small></div>
      <StatusBadge status={unavailable ? "warning" : "neutral"}>{assessment.recommendation.replaceAll("_", " ")}</StatusBadge>
    </div>
    <p>{assessment.uncertainty || "This assessment cannot verify whether the task occurred. Human review is required."}</p>
    {assessment.findings.length > 0 && <ul>{assessment.findings.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
    {assessment.missingEvidence.length > 0 && <div><strong>Suggested missing evidence</strong><ul>{assessment.missingEvidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
    <small>AI/OCR output does not authenticate evidence, approve completion, or close a request.</small>
  </div>;
}

function NgoCompletionReviewInbox({ verified }: { verified: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingAction, setPendingAction] = useState<"approve" | "more_evidence_required" | "reject" | "flag_manual" | null>(null);
  const inbox = useQuery({
    queryKey: ["ngo-completion-reviews"],
    queryFn: services.ngo.completionReviews,
    enabled: verified,
  });
  const detail = useQuery({
    queryKey: ["ngo-completion-review", selectedId],
    queryFn: () => services.ngo.completionReview(selectedId!),
    enabled: Boolean(verified && selectedId),
  });
  const decide = useMutation({
    mutationFn: (input: { action: "approve" | "more_evidence_required" | "reject" | "flag_manual"; reason: string; resolveOutstandingIssues?: boolean }) =>
      services.ngo.decideCompletion(selectedId!, input),
    onSuccess: async (_, variables) => {
      toast.success(variables.action === "approve" ? "Completion approved and request closed." : variables.action === "more_evidence_required" ? "Additional evidence requested." : variables.action === "reject" ? "Completion submission rejected with a reason." : "Case flagged for administrator review.");
      setPendingAction(null);
      setSelectedId(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ngo-completion-reviews"] }),
        queryClient.invalidateQueries({ queryKey: ["ngo-incoming-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["ngo-request-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const download = async (evidence: AssignmentEvidence) => {
    if (!selectedId) return;
    try {
      const blob = await services.ngo.downloadAssignmentEvidence(selectedId, evidence.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = evidence.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private evidence could not be downloaded.");
    }
  };
  const submitDecision = () => {
    if (!pendingAction || !detail.data) return;
    const reason = window.prompt(
      pendingAction === "approve" ? "Record your human review rationale for closing this request:" :
        pendingAction === "more_evidence_required" ? "Explain what additional evidence is needed:" :
          pendingAction === "reject" ? "Explain why this completion submission is rejected:" :
            "Explain why an administrator must review this case:",
    );
    if (!reason?.trim()) return;
    const resolvesIssues = Boolean(detail.data.proof.unresolvedIssues?.trim());
    if (pendingAction === "approve" && resolvesIssues && !window.confirm("The volunteer reported unresolved follow-up. Confirm that you have reviewed and resolved it before closing this request.")) return;
    decide.mutate({
      action: pendingAction,
      reason: reason.trim(),
      ...(pendingAction === "approve" && resolvesIssues ? { resolveOutstandingIssues: true } : {}),
    });
  };
  if (!verified) return <EmptyState title="Organization verification required" description="Only verified organizations can review completion evidence." />;
  return <section className="data-card">
    <PageHeader eyebrow="HUMAN COMPLETION REVIEW" title="Completion evidence inbox" description="Review private evidence and the volunteer report. Automated findings are advisory; only your explicit approval closes a request." />
    {inbox.isLoading ? <LoadingCards /> : inbox.isError ? <ErrorState description={inbox.error.message} retry={() => inbox.refetch()} /> : inbox.data?.length ? <div className="volunteer-task-list">
      {inbox.data.map((item: NgoCompletionReviewSummary) => <article className="ngo-assignment-row" key={item.assignmentId}>
        <div><span className="eyebrow">{item.reference} · {item.category.replaceAll("_", " ")}</span><h3>{item.title}</h3><p>{item.city} · {item.urgency} urgency</p><p>{item.summary}</p><small>Submitted {new Date(item.submittedAt).toLocaleString()}</small>
          <StatusBadge status={item.aiRecommendation === "provider_unavailable" ? "warning" : "neutral"}>{item.aiRecommendation.replaceAll("_", " ")}</StatusBadge>
          {item.unresolvedIssues && <p className="request-needs-info">Follow-up reported: {item.unresolvedIssues}</p>}
        </div><Button variant="outline" onClick={() => setSelectedId(item.assignmentId)}>Review evidence <ArrowRight size={13} /></Button>
      </article>)}
    </div> : <EmptyState title="No completion submissions to review." description="Volunteer reports submitted for your verified organization's requests will appear here." />}
    {selectedId && <div className="review-dialog-backdrop">
      <section className="review-dialog completion-review-dialog" role="dialog" aria-modal="true" aria-labelledby="completion-review-title">
        <button className="review-dialog-close" aria-label="Close completion review" onClick={() => setSelectedId(undefined)}><X size={18} /></button>
        {detail.isLoading ? <LoadingCards count={1} /> : detail.isError ? <ErrorState description={detail.error.message} retry={() => detail.refetch()} /> : detail.data && <>
          <span className="eyebrow">ASSIGNED NGO REVIEW · {detail.data.request.reference}</span>
          <h2 id="completion-review-title">{detail.data.request.title}</h2>
          <p>{detail.data.request.category.replaceAll("_", " ")} · {detail.data.request.urgency} urgency · {detail.data.request.peopleCount} people · {detail.data.request.city}</p>
          <p>{detail.data.request.description}</p>
          {detail.data.request.completionEvidenceChecklist.length > 0 && <div className="ngo-completion-proof"><h4>Requested evidence checklist</h4><ul>{detail.data.request.completionEvidenceChecklist.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <div className="ngo-completion-proof"><h4>Volunteer completion</h4><strong>{detail.data.proof.summary}</strong><p>{detail.data.proof.report}</p><small>Reported completed {new Date(detail.data.proof.completedAt).toLocaleString()} · Submitted {new Date(detail.data.proof.submittedAt).toLocaleString()}</small>
            {detail.data.proof.recipientConfirmed !== undefined && <p>Recipient confirmation: {detail.data.proof.recipientConfirmed ? "Reported by volunteer" : "Not reported"}</p>}
            {detail.data.proof.unresolvedIssues && <p className="request-needs-info">Unresolved follow-up: {detail.data.proof.unresolvedIssues}</p>}
          </div>
          <CompletionAiAssessment assessment={detail.data.proof.aiReview} />
          <div className="ngo-completion-proof"><h4>Private evidence</h4>{detail.data.evidence.length ? detail.data.evidence.map((item) => <div className="request-document-row" key={item.id}><FileText size={15} /><span>{item.name} · {(item.byteSize / 1024).toFixed(0)} KB</span><Button variant="outline" onClick={() => void download(item)}>Download privately</Button></div>) : <p>No evidence is available for this submission.</p>}</div>
          <div className="ngo-completion-proof"><h4>Assignment history</h4>{detail.data.assignment.history.map((item, index) => <p key={`${item.status}-${index}`}><strong>{assignmentLabels[item.status] ?? item.status}</strong> · {new Date(item.occurredAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</p>)}</div>
          <div className="verification-actions completion-review-actions">
            <Button variant="outline" disabled={decide.isPending} onClick={() => setPendingAction("more_evidence_required")}>Request more evidence</Button>
            <Button variant="quiet" disabled={decide.isPending} onClick={() => setPendingAction("reject")}>Reject submission</Button>
            <Button variant="quiet" disabled={decide.isPending} onClick={() => setPendingAction("flag_manual")}>Flag for admin review</Button>
            <Button disabled={decide.isPending} onClick={() => setPendingAction("approve")}><Check size={14} /> Approve and close</Button>
          </div>
          {pendingAction && <div className="document-notice"><span>Decision selected: {pendingAction.replaceAll("_", " ")}. Choose “Record decision” to enter the required reason.</span><Button disabled={decide.isPending} onClick={submitDecision}>{decide.isPending ? "Saving…" : "Record decision"}</Button><Button variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button></div>}
        </>}
      </section>
    </div>}
  </section>;
}

function NgoAssignmentMonitor({ requestId, requestStatus }: { requestId: string; requestStatus: HelpRequestStatus }) {
  const queryClient = useQueryClient();
  const [deadline, setDeadline] = useState("");
  const [checklist, setChecklist] = useState("");
  const monitoring = useQuery({
    queryKey: ["ngo-request-assignments", requestId],
    queryFn: () => services.ngo.assignments(requestId),
  });
  useEffect(() => {
    if (monitoring.data) setChecklist(monitoring.data.completionEvidenceChecklist.join("\n"));
  }, [monitoring.data]);
  const matching = useMutation({
    mutationFn: () => services.ngo.startVolunteerMatching(requestId, deadline ? new Date(deadline).toISOString() : undefined),
    onSuccess: async (result) => {
      toast.success(`${result.offers.length} eligible volunteer offer(s) issued.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ngo-request-assignments", requestId] }),
        queryClient.invalidateQueries({ queryKey: ["ngo-incoming-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["ngo-request-detail", requestId] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const assignmentAction = useMutation({
    mutationFn: async (input: { assignmentId: string; action: "reassign" | "cancel"; reason: string }) =>
      input.action === "reassign"
        ? services.ngo.reassignAssignment(requestId, input.assignmentId, input.reason)
        : services.ngo.cancelAssignment(requestId, input.assignmentId, input.reason),
    onSuccess: async (_, variables) => {
      toast.success(variables.action === "reassign" ? "Volunteer reassigned; new eligible offers were issued." : "Assignment cancelled.");
      await queryClient.invalidateQueries({ queryKey: ["ngo-request-assignments", requestId] });
      await queryClient.invalidateQueries({ queryKey: ["ngo-incoming-requests"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const saveChecklist = useMutation({
    mutationFn: () => services.ngo.updateCompletionChecklist(requestId, checklist.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)),
    onSuccess: async () => {
      toast.success("Completion evidence checklist saved.");
      await queryClient.invalidateQueries({ queryKey: ["ngo-request-assignments", requestId] });
    },
    onError: (error) => toast.error(error.message),
  });
  const evidence = useQuery({
    queryKey: ["ngo-assignment-evidence", monitoring.data?.assignments.find((item) => item.status === "submitted_for_review")?.id],
    queryFn: () => services.ngo.assignmentEvidence(monitoring.data!.assignments.find((item) => item.status === "submitted_for_review")!.id),
    enabled: Boolean(monitoring.data?.assignments.some((item) => item.status === "submitted_for_review")),
  });
  const download = async (assignmentId: string, item: AssignmentEvidence) => {
    try {
      const blob = await services.ngo.downloadAssignmentEvidence(assignmentId, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private evidence could not be downloaded.");
    }
  };
  const currentAssignments = monitoring.data?.assignments ?? [];
  const hasActiveAssignment = currentAssignments.some((item) => ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"].includes(item.status));
  const hasLiveOffer = currentAssignments.some((item) => item.status === "offered" && item.offerExpiresAt && new Date(item.offerExpiresAt).getTime() > Date.now());
  const submitted = currentAssignments.find((item) => item.status === "submitted_for_review");
  return <section className="ngo-assignment-monitor">
    <div className="table-heading"><div><h3>Volunteer matching and assignment</h3><p>Only eligible volunteers receive a minimum task summary. Requester details are disclosed after a volunteer accepts.</p></div></div>
    {monitoring.isLoading ? <LoadingCards count={1} /> : monitoring.isError ? <ErrorState description={monitoring.error.message} retry={() => monitoring.refetch()} /> : <>
      {["approved", "matching_volunteer"].includes(requestStatus) && !hasActiveAssignment && <div className="ngo-volunteer-match-controls">
        <label className="form-label">Optional task deadline<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
        <Button disabled={matching.isPending || hasLiveOffer} onClick={() => matching.mutate()}>{matching.isPending ? "Matching…" : hasLiveOffer ? "Volunteer offers are open" : "Find and offer to eligible volunteers"} <Users size={14} /></Button>
        <small>Configured radius and offer expiry are applied by the server; location-less candidates are matched by service city/area without invented distance.</small>
      </div>}
      {["approved", "matching_volunteer", "assigned", "in_progress"].includes(requestStatus) && <div className="ngo-volunteer-match-controls">
        <label className="form-label">Completion evidence checklist<textarea rows={3} maxLength={2010} value={checklist} onChange={(event) => setChecklist(event.target.value)} placeholder={"One item per line, e.g.\nDelivery confirmation\nCompletion letter"} /><small>Optional and category-specific. Keep requirements necessary and proportionate; up to 10 items, 200 characters each.</small></label>
        <Button variant="outline" disabled={saveChecklist.isPending} onClick={() => saveChecklist.mutate()}>{saveChecklist.isPending ? "Saving…" : "Save evidence checklist"}</Button>
      </div>}
      {!currentAssignments.length && <p className="muted-copy">No volunteer offers or assignments are recorded yet.</p>}
      {currentAssignments.map((item) => <article className="ngo-assignment-row" key={item.id}>
        <div><StatusBadge status={item.status === "in_progress" ? "success" : item.status === "disputed" ? "danger" : "warning"}>{assignmentLabels[item.status] ?? item.status}</StatusBadge>
          {item.volunteer && <p><strong>{item.volunteer.name}</strong> · {item.volunteer.city}{item.volunteer.skills.length ? ` · ${item.volunteer.skills.join(", ")}` : ""}</p>}
          {item.offerExpiresAt && item.status === "offered" && <small>Offer expires {new Date(item.offerExpiresAt).toLocaleString()}</small>}
          {item.startedAt && <small>Started {new Date(item.startedAt).toLocaleString()}</small>}
          {item.isOverdue && <small className="request-needs-info">Deadline passed · review or reassign this task</small>}
          {item.progressNote && <p className="muted-copy">Progress: {item.progressNote}</p>}
          {item.status === "submitted_for_review" && <p className="muted-copy">Completion proof is awaiting the NGO approval phase.</p>}
        </div>
        {["accepted", "in_progress", "more_evidence_required", "rejected_with_reason"].includes(item.status) && <div className="verification-actions">
          <Button variant="outline" disabled={assignmentAction.isPending} onClick={() => {
            const reason = window.prompt("Why should this assignment be reassigned?");
            if (reason?.trim()) assignmentAction.mutate({ assignmentId: item.id, action: "reassign", reason: reason.trim() });
          }}>Reassign</Button>
          <Button variant="quiet" disabled={assignmentAction.isPending} onClick={() => {
            const reason = window.prompt("Why should this assignment be cancelled?");
            if (reason?.trim()) assignmentAction.mutate({ assignmentId: item.id, action: "cancel", reason: reason.trim() });
          }}>Cancel</Button>
        </div>}
      </article>)}
      {submitted && <div className="ngo-completion-proof">
        <h4>Volunteer completion report</h4>
        {evidence.isLoading ? <LoadingCards count={1} /> : evidence.isError ? <ErrorState description={evidence.error.message} retry={() => evidence.refetch()} /> : <>
          <p>{evidence.data?.report || "No report was included."}</p>
          {evidence.data?.evidence.map((item) => <div className="request-document-row" key={item.id}><FileText size={15} /><span>{item.name}</span><Button variant="outline" onClick={() => void download(submitted.id, item)}>Download securely</Button></div>)}
        </>}
      </div>}
    </>}
  </section>;
}

function NgoTasks({ dashboard, onCreate }: { dashboard: UseQueryResult<NgoDashboardData, Error>; onCreate: () => void }) {
  return <><PageHeader eyebrow="ORGANIZATION WORKSPACE" title="Manage your tasks" description="Keep current opportunities accurate and easy to find." action={<Button onClick={onCreate}><Plus size={15} /> Create New Task</Button>} />{dashboard.isLoading ? <LoadingCards /> : dashboard.isError ? <ErrorState description={dashboard.error.message} retry={() => dashboard.refetch()} /> : dashboard.data?.needs.length ? <div className="opportunity-grid">{dashboard.data.needs.map((need) => <OpportunityCard key={need.id} need={need} />)}</div> : <EmptyState title="No tasks published yet." description="Create your first volunteer opportunity or fundraising campaign." action={<Button onClick={onCreate}><Plus size={14} /> Create a task</Button>} />}</>;
}

function NgoApplications({ dashboard }: { dashboard: UseQueryResult<NgoDashboardData, Error> }) {
  if (dashboard.isLoading) return <LoadingCards />;
  if (dashboard.isError) return <ErrorState description={dashboard.error.message} retry={() => dashboard.refetch()} />;
  return <div className="data-card"><div className="table-heading"><div><h2>Volunteer applications</h2><p>Recent community members interested in your tasks.</p></div></div>{dashboard.data?.recentVolunteers.length ? dashboard.data.recentVolunteers.map((person) => <ContributorRow key={person.id} name={person.name} detail={`${person.city} · ${new Date(person.createdAt).toLocaleDateString()}`} status={person.status} />) : <EmptyState title="No applications yet." description="Volunteer applications will appear once people join your tasks." />}</div>;
}

function NgoVerificationProfile({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const verification = useQuery({ queryKey: ["ngo-verification"], queryFn: services.ngoVerification.get });
  const form = useForm({
    defaultValues: {
      name: user.name, city: user.city, description: user.description ?? "",
      categories: user.categories?.join(", ") ?? "", registrationNumber: user.registrationNumber ?? "",
      registrationType: user.registrationType ?? "", officialEmail: user.officialEmail ?? user.email,
      officialPhone: user.officialPhone ?? user.phone ?? "", addressLine: user.addressLine ?? "",
      state: user.state ?? "", postalCode: user.postalCode ?? "", serviceArea: user.serviceArea ?? "",
      representativeName: user.representativeName ?? "", representativeDesignation: user.representativeDesignation ?? "",
      issuingAuthority: user.issuingAuthority ?? "", establishedDate: user.establishedDate?.slice(0, 10) ?? "",
      latitude: "", longitude: "", acceptingRequests: true, requestCapacity: "",
    },
  });
  useEffect(() => {
    if (!verification.data) return;
    form.reset({
      name: verification.data.name,
      city: verification.data.city,
      description: verification.data.description ?? "",
      categories: verification.data.categories?.join(", ") ?? "",
      registrationNumber: verification.data.registrationNumber ?? "",
      registrationType: verification.data.registrationType ?? "",
      officialEmail: verification.data.officialEmail ?? verification.data.email,
      officialPhone: verification.data.officialPhone ?? verification.data.phone ?? "",
      addressLine: verification.data.addressLine ?? "",
      state: verification.data.state ?? "",
      postalCode: verification.data.postalCode ?? "",
      serviceArea: verification.data.serviceArea ?? "",
      representativeName: verification.data.representativeName ?? "",
      representativeDesignation: verification.data.representativeDesignation ?? "",
      issuingAuthority: verification.data.issuingAuthority ?? "",
      establishedDate: verification.data.establishedDate?.slice(0, 10) ?? "",
      latitude: verification.data.coordinates ? String(verification.data.coordinates.latitude) : "",
      longitude: verification.data.coordinates ? String(verification.data.coordinates.longitude) : "",
      acceptingRequests: verification.data.acceptingRequests !== false,
      requestCapacity: verification.data.requestCapacity ? String(verification.data.requestCapacity) : "",
    });
  }, [verification.data, form]);
  const save = useMutation({
    mutationFn: (data: {
      name: string; city: string; description: string; categories: string; registrationNumber: string;
      registrationType: string; officialEmail: string; officialPhone: string; addressLine: string;
      state: string; postalCode: string; serviceArea: string; latitude: string; longitude: string;
      representativeName: string; representativeDesignation: string; issuingAuthority: string; establishedDate: string;
      acceptingRequests: boolean; requestCapacity: string;
    }) => {
      const hasLatitude = Boolean(data.latitude.trim());
      const hasLongitude = Boolean(data.longitude.trim());
      if (hasLatitude !== hasLongitude) throw new Error("Provide both coordinates or leave both blank.");
      const latitude = hasLatitude ? Number(data.latitude) : undefined;
      const longitude = hasLongitude ? Number(data.longitude) : undefined;
      if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude!) > 90 || Math.abs(longitude!) > 180)) {
        throw new Error("Enter valid latitude and longitude coordinates.");
      }
      const requestCapacity = data.requestCapacity.trim() ? Number(data.requestCapacity) : undefined;
      if (requestCapacity !== undefined && (!Number.isInteger(requestCapacity) || requestCapacity < 1 || requestCapacity > 10000)) {
        throw new Error("Request capacity must be between 1 and 10,000.");
      }
      const { latitude: _latitude, longitude: _longitude, requestCapacity: _requestCapacity, ...profile } = data;
      return services.ngoVerification.submit({
        ...profile,
        establishedDate: data.establishedDate || undefined,
        categories: data.categories.split(",").map((value) => value.trim()).filter(Boolean),
        ...(latitude !== undefined && longitude !== undefined ? { coordinates: { latitude, longitude } } : {}),
        ...(requestCapacity !== undefined ? { requestCapacity } : {}),
      });
    },
    onSuccess: async () => {
      toast.success("NGO application submitted for review.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.user }),
        queryClient.invalidateQueries({ queryKey: ["ngo-verification"] }),
        queryClient.invalidateQueries({ queryKey: ["verification-me"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const saveAvailability = useMutation({
    mutationFn: (data: { latitude: string; longitude: string; acceptingRequests: boolean; requestCapacity: string }) => {
      const hasLatitude = Boolean(data.latitude.trim());
      const hasLongitude = Boolean(data.longitude.trim());
      if (hasLatitude !== hasLongitude) throw new Error("Provide both coordinates or leave both blank.");
      const latitude = hasLatitude ? Number(data.latitude) : undefined;
      const longitude = hasLongitude ? Number(data.longitude) : undefined;
      if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude!) > 90 || Math.abs(longitude!) > 180)) {
        throw new Error("Enter valid latitude and longitude coordinates.");
      }
      const requestCapacity = data.requestCapacity.trim() ? Number(data.requestCapacity) : undefined;
      if (requestCapacity !== undefined && (!Number.isInteger(requestCapacity) || requestCapacity < 1 || requestCapacity > 10000)) {
        throw new Error("Request capacity must be between 1 and 10,000.");
      }
      return services.ngoVerification.updateAvailability({
        acceptingRequests: data.acceptingRequests,
        clearCoordinates: latitude === undefined,
        ...(latitude !== undefined && longitude !== undefined ? { coordinates: { latitude, longitude } } : {}),
        ...(requestCapacity !== undefined ? { requestCapacity } : {}),
      });
    },
    onSuccess: async () => {
      toast.success("Matching availability updated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ngo-verification"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.user }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const status = verification.data?.organizationStatus ?? user.organizationStatus ?? "draft";
  const statusLabels: Record<string, string> = {
    draft: "Draft", pending: "Pending review", pending_review: "Pending review",
    verified: "Verified organization", rejected: "Rejected", resubmission_required: "Resubmission required",
  };
  if (verification.isLoading) return <LoadingCards count={1} />;
  if (verification.isError) return <ErrorState description={verification.error.message} retry={() => verification.refetch()} />;
  return <div className="data-card form-card">
    <PageHeader eyebrow="ORGANIZATION VERIFICATION" title={verification.data?.name ?? user.name} description="Review your application status, update details, and resubmit when requested." />
    <StatusBadge status={status === "verified" ? "success" : status === "rejected" ? "danger" : "warning"}>{statusLabels[status] ?? status}</StatusBadge>
    {verification.data?.verificationReason && <div className="verification-banner"><ShieldCheck size={18} /><div><strong>Review decision</strong><span>{verification.data.verificationReason}</span></div></div>}
    <ApplicantVerificationPanel role="ngo" />
    {status === "verified" ? <form className="form-stack profile-form" onSubmit={form.handleSubmit((data) => saveAvailability.mutate(data))}>
      <p className="muted-copy">Your organization is verified. Update matching availability without changing your verification status.</p>
      <label className="request-consent"><input type="checkbox" {...form.register("acceptingRequests")} /><span>We are currently accepting routed help requests.</span></label>
      <div className="request-form-grid"><label className="form-label">Latitude (optional)<input inputMode="decimal" {...form.register("latitude")} placeholder="e.g. 19.0760" /></label><label className="form-label">Longitude (optional)<input inputMode="decimal" {...form.register("longitude")} placeholder="e.g. 72.8777" /></label></div>
      <label className="form-label">Maximum active requests (optional)<input type="number" min="1" max="10000" {...form.register("requestCapacity")} /><small>Current active routed requests: {verification.data?.activeRequestCount ?? 0}. Leave blank for no capacity limit.</small></label>
      <Button type="submit" disabled={saveAvailability.isPending}>{saveAvailability.isPending ? "Saving…" : "Update matching availability"} <ArrowRight size={14} /></Button>
    </form> : <form className="form-stack profile-form" onSubmit={form.handleSubmit((data) => save.mutate(data))}>
      <label className="form-label">Registered organization name<input {...form.register("name", { required: true })} /></label><label className="form-label">City<input {...form.register("city", { required: true })} /></label><label className="form-label">Mission and description<textarea {...form.register("description", { required: true })} rows={4} /></label><label className="form-label">Service categories (comma-separated)<input {...form.register("categories", { required: true })} /></label><label className="form-label">Registration type<input {...form.register("registrationType", { required: true })} /></label><label className="form-label">Registration number<input {...form.register("registrationNumber", { required: true })} /></label><label className="form-label">Authorized representative<input {...form.register("representativeName")} /></label><label className="form-label">Representative designation<input {...form.register("representativeDesignation")} /></label><label className="form-label">Issuing authority<input {...form.register("issuingAuthority")} /></label><label className="form-label">Established date<input type="date" {...form.register("establishedDate")} /></label><label className="form-label">Official contact email<input type="email" {...form.register("officialEmail", { required: true })} /></label><label className="form-label">Official contact phone<input {...form.register("officialPhone", { required: true })} /></label><label className="form-label">Registered address<input {...form.register("addressLine", { required: true })} /></label><label className="form-label">State<input {...form.register("state", { required: true })} /></label><label className="form-label">Postal code<input {...form.register("postalCode", { required: true })} /></label><label className="form-label">Service area<input {...form.register("serviceArea", { required: true })} /></label><div className="request-form-grid"><label className="form-label">Latitude (optional)<input inputMode="decimal" {...form.register("latitude")} placeholder="e.g. 19.0760" /></label><label className="form-label">Longitude (optional)<input inputMode="decimal" {...form.register("longitude")} placeholder="e.g. 72.8777" /></label></div><label className="request-consent"><input type="checkbox" {...form.register("acceptingRequests")} /><span>We are currently accepting routed help requests.</span></label><label className="form-label">Maximum active requests (optional)<input type="number" min="1" max="10000" {...form.register("requestCapacity")} /><small>Leave blank if your organization has no configured active-request limit.</small></label><Button type="submit" disabled={save.isPending}>{save.isPending ? "Submitting…" : status === "rejected" || status === "resubmission_required" ? "Resubmit application" : "Submit for review"} <ArrowRight size={14} /></Button>
    </form>}
  </div>;
}

function MyNotifications({ role }: { role: DashboardRole }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const notifications = useQuery({ queryKey: ["notifications", page], queryFn: () => services.notifications.mine(page) });
  const markRead = useMutation({
    mutationFn: services.notifications.markRead,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notification-unread"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const markAllRead = useMutation({
    mutationFn: services.notifications.markAllRead,
    onSuccess: async ({ updatedCount }) => {
      toast.success(updatedCount ? `${updatedCount} notification(s) marked as read.` : "You have no unread notifications.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notification-unread"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  if (notifications.isLoading) return <LoadingCards count={2} />;
  if (notifications.isError) return <ErrorState description={notifications.error.message} retry={() => notifications.refetch()} />;
  const data = notifications.data;
  if (!data?.total) return <EmptyState title="No notifications yet." description="Important task, donation, and account updates will appear here." />;
  const targetFor = (type: string) => {
    if (type === "admin_completion_review_required") return "/admin/completion-reviews";
    if (type.includes("completion")) return role === "ngo" ? "/ngo/completion-reviews" : role === "admin" ? "/admin/completion-reviews" : role === "user" ? "/user/requests" : "/volunteer/tasks";
    if (type.startsWith("item_pickup")) return role === "ngo" ? "/ngo/item-needs" : role === "volunteer" ? "/volunteer/pickups" : role === "user" ? "/items" : role === "donor" ? "/donor/donations" : "/admin/tasks";
    if (type.startsWith("item_donation")) return role === "ngo" ? "/ngo/item-needs" : role === "user" ? "/items" : role === "volunteer" ? "/volunteer/pickups" : role === "donor" ? "/donor/donations" : "/admin/tasks";
    if (type.includes("donation") && role === "ngo") return "/ngo/donations";
    if (type.includes("donation") && role === "admin") return "/admin/donations";
    if (type.includes("donation") && role === "donor") return "/donor/receipts";
    if (type.includes("assignment") || type.startsWith("volunteer_task_offer")) return role === "ngo" ? "/ngo/requests" : role === "user" ? "/user/requests" : role === "admin" ? "/admin/tasks" : "/volunteer/tasks";
    if (type.startsWith("help_request")) return role === "ngo" ? "/ngo/requests" : role === "admin" ? "/admin/tasks" : "/user/requests";
    if (type.startsWith("ngo_verification")) return role === "ngo" ? "/ngo/verification" : "/admin/verifications";
    return `/${role}/notifications`;
  };
  const open = async (item: NonNullable<typeof data>["notifications"][number]) => {
    if (!item.readAt) {
      try {
        await markRead.mutateAsync(item.id);
      } catch {
        // The API mutation already reports the failure; navigation remains available.
      }
    }
    navigate(targetFor(item.type));
  };
  const titleFor = (type: string, status?: string) =>
    type === "volunteer_task_offer" ? "A new volunteer task offer is available" :
      type === "volunteer_task_offer_expired" ? "A volunteer task offer expired" :
      type === "volunteer_task_offer_cancelled" ? "A volunteer offer was cancelled after the task was claimed" :
      type === "volunteer_eligibility_updated" ? "Volunteer eligibility updated" :
      type === "ngo_request_received" ? "New help request routed to your organization" :
      type === "ngo_request_updated" ? "Requester updated an assigned request" :
      type === "admin_completion_review_required" ? "Completion case needs administrator review" :
      type === "money_donation_confirmed" ? `Donation confirmed${status ? ` · ${status}` : ""}` :
      type.includes("item") || type.includes("pickup") ? `Item donation or pickup ${status?.replaceAll("_", " ") ?? "updated"}` :
      type.includes("completion") ? `Completion review ${status?.replaceAll("_", " ") ?? "updated"}` :
      type.includes("assignment") ? `Assignment ${assignmentLabels[status ?? ""] ?? status ?? "updated"}` :
      type.startsWith("ngo_verification") ? `Organization ${status ?? "status updated"}` :
      type.startsWith("help_request") ? `Help request ${status ? requestStatuses[status as HelpRequestStatus] ?? status : "updated"}` :
      "Account update";
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="data-card"><PageHeader eyebrow="UPDATES" title="Notifications" description={`Persistent in-app updates · ${data.unreadCount} unread.`} action={<Button variant="outline" disabled={!data.unreadCount || markAllRead.isPending} onClick={() => markAllRead.mutate()}>Mark all read</Button>} />{data.notifications.map((item) => {
    const description = item.type === "volunteer_task_offer"
      ? `${item.payload.category?.replaceAll("_", " ") ?? "Help"} · ${item.payload.urgency ?? "Review"} urgency · ${item.payload.city ?? "Service area not provided"}`
      : item.type === "ngo_request_received"
        ? `${item.payload.category?.replaceAll("_", " ") ?? "Help request"} · ${item.payload.urgency ?? "Review requested"} urgency`
        : item.type === "money_donation_confirmed"
          ? `Reference ${item.payload.receiptReference ?? "available in your receipts"}.`
          : `Status update: ${item.payload.status?.replaceAll("_", " ") ?? "updated"}. Private location and contact details are excluded.`;
    return <article className="verification-row" key={item.id} aria-label={`${item.readAt ? "Read" : "Unread"} notification`}><span className="empty-icon"><Bell size={16} /></span><div className="verification-info"><strong>{titleFor(item.type, item.payload.status)}</strong><small>{description}</small><small>{new Date(item.createdAt).toLocaleString()}</small></div><StatusBadge status={item.readAt ? "neutral" : "warning"}>{item.readAt ? "Read" : "New"}</StatusBadge><div className="verification-actions"><Button variant="outline" onClick={() => void open(item)}>Open update <ArrowRight size={13} /></Button>{!item.readAt && <Button variant="quiet" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Mark read</Button>}</div></article>;
  })}<div className="verification-actions" aria-label="Notification pages"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></div></section>;
}

function DonorContent({ page, user }: { page: string; user: User }) {
  const impact = useQuery({ queryKey: queryKeys.impact, queryFn: services.impact.mine });
  const contributions = useQuery({ queryKey: queryKeys.contributions, queryFn: services.impact.contributions });
  const itemDonations = useQuery({ queryKey: ["item-donations-mine"], queryFn: services.itemDonations.mine });
  if (page === "notifications") return <MyNotifications role="donor" />;
  if (page === "dashboard" || page === "donations" || page === "receipts") {
    if (page === "dashboard") return <><div className="welcome-row"><div><h2>Welcome back, {user.name.split(" ")[0]}.</h2><p>Your generosity is creating real community impact.</p></div><Link className="button button-primary" to="/donate">Find a cause <ArrowRight size={15} /></Link></div><div className="stat-grid three"><StatCard label="Total donations" value={impact.data ? `₹${impact.data.donations.toLocaleString("en-IN")}` : "—"} icon={<Wallet />} to="/donor/donations" /><StatCard label="Volunteer sign-ups" value={impact.data?.volunteerSignups ?? "—"} icon={<Users />} /><StatCard label="Completed contributions" value={impact.data?.completedActions ?? "—"} icon={<Heart />} to="/donor/donations" /></div><DonationHistory query={contributions} /><ItemDonationHistory query={itemDonations} /></>;
    if (page === "donations") return <><DonationHistory query={contributions} /><ItemDonationHistory query={itemDonations} /></>;
    return <DonationHistory query={contributions} receiptsOnly />;
  }
  if (page === "settings") return <ProfileEditor user={user} />;
  return <UnavailableFeature name="This donor page" reason="This page is not part of the donor workspace." />;
}

function DonationHistory({ query, receiptsOnly = false }: { query: UseQueryResult<ContributionsQueryData, Error>; receiptsOnly?: boolean }) {
  if (query.isLoading) return <LoadingCards />;
  if (query.isError) return <ErrorState description={query.error.message} retry={() => query.refetch()} />;
  const records = query.data?.filter((item) => item.kind === "donation" && (!receiptsOnly || item.status === "completed")) ?? [];
  if (!records.length) return <EmptyState title="Your first donation is waiting." description="Support a verified campaign and your contribution will be recorded here." action={<Link to="/donate" className="button button-primary">Explore campaigns <ArrowRight size={14} /></Link>} />;
  return <div className="data-card"><div className="table-heading"><div><h2>{receiptsOnly ? "Confirmed donation receipts" : "Donation history"}</h2><p>Only server-confirmed payments count toward impact. Receipts are confirmations, not tax-deductible documents.</p></div></div><div className="responsive-table"><table><thead><tr><th>Campaign</th><th>Date</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>{records.map((item) => <tr key={item.id}><td>{item.need?.title ?? "Community campaign"}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td>₹{item.amount.toLocaleString("en-IN")}</td><td><ContributionStatus status={item.status} /></td><td>{item.status === "completed" ? <MoneyReceipt contributionId={item.id} /> : "—"}</td></tr>)}</tbody></table></div></div>;
}

function MoneyReceipt({ contributionId }: { contributionId: string }) {
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof services.payments.receipt>>>();
  const load = useMutation({
    mutationFn: () => services.payments.receipt(contributionId),
    onSuccess: setReceipt,
    onError: (error) => toast.error(error.message),
  });
  return <><Button variant="quiet" disabled={load.isPending} onClick={() => load.mutate()}>{load.isPending ? "Loading…" : "View receipt"}</Button>{receipt && <div className="document-notice"><FileText size={14} /><span><strong>{receipt.reference}</strong> · {receipt.campaign} · {receipt.organizationName} · ₹{receipt.amount.toLocaleString("en-IN")} {receipt.currency}. {receipt.note}</span><button className="icon-button" aria-label="Close receipt" onClick={() => setReceipt(undefined)}><X size={14} /></button></div>}</>;
}

function ItemDonationHistory({ query }: { query: UseQueryResult<ItemDonation[], Error> }) {
  if (query.isLoading) return <div className="data-card"><PageHeader title="Item donations" /><LoadingCards count={1} /></div>;
  if (query.isError) return <ErrorState description={query.error.message} retry={() => query.refetch()} />;
  if (!query.data?.length) return <div className="data-card"><div className="table-heading"><div><h2>Physical item donations</h2><p>Track an item donation from NGO review through pickup and receipt.</p></div><Link className="button button-outline" to="/items">Donate items <ArrowRight size={14} /></Link></div><EmptyState title="No item donations yet." description="Choose a verified NGO and submit your donation details." /></div>;
  return <div className="data-card"><div className="table-heading"><div><h2>Physical item donations</h2><p>NGO review, pickup coordination, and receipts.</p></div><Link className="text-link" to="/items">Donate items <ArrowRight size={14} /></Link></div>{query.data.map((item) => <article className="verification-row" key={item.id}><div className="verification-info"><strong>{item.category.replaceAll("_", " ")} · {item.quantity} · {item.condition.replaceAll("_", " ")}</strong><small>{item.city} · pickup {new Date(item.pickupWindowStart).toLocaleString()}</small><StatusBadge status={item.status === "completed" ? "success" : ["rejected", "cancelled", "pickup_failed", "disputed"].includes(item.status) ? "danger" : "warning"}>{item.status.replaceAll("_", " ")}</StatusBadge>{item.receiptReference && <small>Receipt {item.receiptReference}</small>}</div>{item.status === "completed" && <ItemReceipt donationId={item.id} />}</article>)}</div>;
}

function ItemReceipt({ donationId }: { donationId: string }) {
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof services.itemDonations.receipt>>>();
  const load = useMutation({
    mutationFn: () => services.itemDonations.receipt(donationId),
    onSuccess: setReceipt,
    onError: (error) => toast.error(error.message),
  });
  return <><Button variant="quiet" disabled={load.isPending} onClick={() => load.mutate()}>{load.isPending ? "Loading…" : "Receipt"}</Button>{receipt && <div className="document-notice"><FileText size={14} /><span>{receipt.reference}: {receipt.quantity} {receipt.category.replaceAll("_", " ")} received by {receipt.organizationName}. Not tax-deductible.</span><button className="icon-button" aria-label="Close receipt" onClick={() => setReceipt(undefined)}><X size={14} /></button></div>}</>;
}

function NgoMoneyDonations({ verified }: { verified: boolean }) {
  const query = useQuery({ queryKey: ["ngo-money-donations"], queryFn: services.ngo.donations, enabled: verified });
  if (!verified) return <EmptyState title="NGO verification required." description="Donation records are available only to verified organizations." />;
  if (query.isLoading) return <LoadingCards />;
  if (query.isError) return <ErrorState description={query.error.message} retry={() => query.refetch()} />;
  return <section><PageHeader eyebrow="CONFIRMED CONTRIBUTIONS" title="Money donations" description="Only payments verified by the server are listed. Donor contact details are not shown." />{query.data?.length ? <div className="data-card responsive-table"><table><thead><tr><th>Campaign</th><th>Cause</th><th>City</th><th>Confirmed</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td>{item.campaign}</td><td>{item.category}</td><td>{item.city}</td><td>{new Date(item.confirmedAt).toLocaleDateString()}</td><td>{item.currency} {item.amount.toLocaleString("en-IN")}</td><td>{item.receiptReference ?? "Confirmed"}</td></tr>)}</tbody></table></div> : <EmptyState title="No confirmed donations yet." description="Verified campaign contributions will appear here after payment confirmation." />}</section>;
}

function NgoItemDonationInbox({ verified, completedOnly = false }: { verified: boolean; completedOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const inbox = useQuery({ queryKey: ["ngo-item-donations"], queryFn: services.itemDonations.ngoInbox, enabled: verified });
  const detail = useQuery({
    queryKey: ["ngo-item-donation-detail", selectedId],
    queryFn: () => services.itemDonations.detail(selectedId!),
    enabled: Boolean(verified && selectedId),
  });
  const review = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "accept" | "reject" | "needs_information"; reason?: string }) =>
      services.itemDonations.ngoReview(id, action, reason),
    onSuccess: async (item) => {
      toast.success(item.status === "awaiting_pickup_assignment" ? "Donation accepted; eligible pickup volunteers were offered the task." : `Donation ${item.status.replaceAll("_", " ")}.`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["ngo-item-donations"] }), queryClient.invalidateQueries({ queryKey: ["ngo-item-donation-detail"] }), queryClient.invalidateQueries({ queryKey: ["notifications"] })]);
    },
    onError: (error) => toast.error(error.message),
  });
  const offer = useMutation({
    mutationFn: (id: string) => services.itemDonations.offerPickup(id),
    onSuccess: async (result) => { toast.info(result.message); await queryClient.invalidateQueries({ queryKey: ["ngo-item-donations"] }); },
    onError: (error) => toast.error(error.message),
  });
  const reassign = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => services.itemDonations.reassignPickup(id, reason),
    onSuccess: async () => { toast.success("Pickup reassigned and new eligible offers were created."); await queryClient.invalidateQueries({ queryKey: ["ngo-item-donations"] }); await queryClient.invalidateQueries({ queryKey: ["ngo-item-donation-detail"] }); },
    onError: (error) => toast.error(error.message),
  });
  const received = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => services.itemDonations.confirmReceived(id, reason),
    onSuccess: async () => { toast.success("Receipt recorded; the item donation is complete."); await queryClient.invalidateQueries({ queryKey: ["ngo-item-donations"] }); await queryClient.invalidateQueries({ queryKey: ["ngo-item-donation-detail"] }); },
    onError: (error) => toast.error(error.message),
  });
  const download = async (donationId: string, evidenceId: string, filename: string) => {
    try {
      const blob = await services.itemDonations.downloadEvidence(donationId, evidenceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Private evidence could not be downloaded.");
    }
  };
  if (!verified) return <EmptyState title="NGO verification required." description="Only verified organizations can review private item donation requests." />;
  if (inbox.isLoading) return <LoadingCards />;
  if (inbox.isError) return <ErrorState description={inbox.error.message} retry={() => inbox.refetch()} />;
  const donations = (inbox.data ?? []).filter((item) => !completedOnly || item.status === "completed");
  return <section><PageHeader eyebrow={completedOnly ? "RECEIVED ITEMS" : "PRIVATE DONATION INBOX"} title={completedOnly ? "Received donations" : "Incoming item donations"} description="Pickup address and donor contact are visible only in this verified NGO's authorized details view." />
    {donations.length ? <div className="dashboard-columns"><div className="data-card">{donations.map((item) => <article className={`verification-row ${selectedId === item.id ? "selected" : ""}`} key={item.id}><div className="verification-info"><strong>{item.category.replaceAll("_", " ")} · quantity {item.quantity}</strong><small>{item.city} · {item.condition.replaceAll("_", " ")} · window {new Date(item.pickupWindowStart).toLocaleString()}</small><StatusBadge status={item.status === "completed" ? "success" : ["rejected", "cancelled", "disputed"].includes(item.status) ? "danger" : "warning"}>{item.status.replaceAll("_", " ")}</StatusBadge></div><div className="verification-actions"><Button variant="outline" onClick={() => setSelectedId(item.id)}>Review details</Button>
      {!completedOnly && ["pending_ngo_review", "needs_information"].includes(item.status) && <><Button disabled={review.isPending} onClick={() => review.mutate({ id: item.id, action: "accept" })}>Accept</Button><Button variant="quiet" disabled={review.isPending} onClick={() => { const reason = window.prompt("What information is missing?"); if (reason?.trim()) review.mutate({ id: item.id, action: "needs_information", reason: reason.trim() }); }}>Request info</Button><Button variant="quiet" disabled={review.isPending} onClick={() => { const reason = window.prompt("Why is this item donation being rejected?"); if (reason?.trim()) review.mutate({ id: item.id, action: "reject", reason: reason.trim() }); }}>Reject</Button></>}
      {!completedOnly && item.status === "awaiting_pickup_assignment" && <Button variant="outline" disabled={offer.isPending} onClick={() => offer.mutate(item.id)}>Offer pickup</Button>}
      {!completedOnly && ["pickup_failed", "disputed", "pickup_assigned", "pickup_in_progress"].includes(item.status) && <Button variant="outline" disabled={reassign.isPending} onClick={() => { const reason = window.prompt("Reason for pickup reassignment?"); if (reason?.trim()) reassign.mutate({ id: item.id, reason: reason.trim() }); }}>Reassign pickup</Button>}
      {!completedOnly && item.status === "picked_up" && <Button disabled={received.isPending} onClick={() => { const reason = window.prompt("Confirm receipt details or inspection outcome."); if (reason?.trim()) received.mutate({ id: item.id, reason: reason.trim() }); }}>Confirm received</Button>}
      </div></article>)}</div>
      {selectedId && <div className="data-card"><div className="table-heading"><div><h2>Authorized donation details</h2><p>Private information for the owning NGO only.</p></div><button className="icon-button" aria-label="Close donation details" onClick={() => setSelectedId(undefined)}><X size={15} /></button></div>{detail.isLoading ? <LoadingCards count={1} /> : detail.isError ? <ErrorState description={detail.error.message} retry={() => detail.refetch()} /> : detail.data && <div className="volunteer-private-details"><p>{detail.data.description}</p><p><strong>Pickup address:</strong> {detail.data.pickupAddress}, {detail.data.city}</p><p><strong>Pickup window:</strong> {new Date(detail.data.pickupWindowStart).toLocaleString()} – {new Date(detail.data.pickupWindowEnd).toLocaleString()}</p>{detail.data.specialHandling && <p><strong>Handling:</strong> {detail.data.specialHandling}</p>}{detail.data.contact && <p><strong>Donor contact:</strong> {detail.data.contact.name} · {detail.data.contact.value ?? detail.data.contact.method}</p>}{detail.data.evidence?.map((evidence) => <div className="request-document-row" key={evidence.id}><FileText size={14} /><span>{evidence.name} · {evidence.kind.replaceAll("_", " ")}</span><Button variant="quiet" onClick={() => void download(detail.data!.id, evidence.id, evidence.name)}>Download</Button></div>)}{detail.data.timeline?.map((entry, index) => <p className="muted-copy" key={`${entry.status}-${index}`}>{entry.status.replaceAll("_", " ")} · {new Date(entry.occurredAt).toLocaleString()}{entry.reason ? ` · ${entry.reason}` : ""}</p>)}</div>}</div>}</div> : <EmptyState title="No item donations to review." description="Submissions to your verified organization appear here." />}
  </section>;
}

function VolunteerItemPickupWorkspace() {
  const queryClient = useQueryClient();
  const offersQuery = useQuery({ queryKey: ["volunteer-item-pickups"], queryFn: services.itemDonations.volunteerOffers });
  const assignmentsQuery = useQuery({ queryKey: ["volunteer-item-pickups-mine"], queryFn: services.itemDonations.volunteerAssignments });
  const [selectedId, setSelectedId] = useState<string>();
  const [report, setReport] = useState("");
  const offers = offersQuery.data?.tasks ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const selected = assignments.find((item) => item.id === selectedId);
  const details = useQuery({
    queryKey: ["volunteer-item-pickup-details", selectedId],
    queryFn: () => services.itemDonations.pickupDetails(selectedId!),
    enabled: Boolean(selectedId && selected?.canAccessDetails),
  });
  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["volunteer-item-pickups"] }),
    queryClient.invalidateQueries({ queryKey: ["volunteer-item-pickups-mine"] }),
    queryClient.invalidateQueries({ queryKey: ["volunteer-item-pickup-details"] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
  const action = useMutation({
    mutationFn: async ({ type, id }: { type: "accept" | "decline" | "start"; id: string }) =>
      type === "accept" ? services.itemDonations.acceptPickup(id) : type === "decline" ? services.itemDonations.declinePickup(id) : services.itemDonations.startPickup(id),
    onSuccess: async (_, variables) => { toast.success(variables.type === "accept" ? "Pickup accepted; private details are now available." : variables.type === "decline" ? "Pickup offer declined." : "Pickup marked in progress."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const upload = useMutation({
    mutationFn: ({ donationId, file }: { donationId: string; file: File }) => services.itemDonations.upload(donationId, file, "pickup_photo"),
    onSuccess: async () => { toast.success("Pickup photo stored privately."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const submit = useMutation({
    mutationFn: () => services.itemDonations.submitPickup(selectedId!, report.trim()),
    onSuccess: async () => { setReport(""); toast.success("Pickup report submitted to the NGO for receipt review."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const issue = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => services.itemDonations.reportPickupIssue(id, reason),
    onSuccess: async () => { toast.success("The NGO and donor were notified about the pickup issue."); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  if (offersQuery.isLoading || assignmentsQuery.isLoading) return <LoadingCards />;
  if (offersQuery.isError) return <ErrorState description={offersQuery.error.message} retry={() => offersQuery.refetch()} />;
  if (assignmentsQuery.isError) return <ErrorState description={assignmentsQuery.error.message} retry={() => assignmentsQuery.refetch()} />;
  const active = assignments.filter((item) => ["accepted", "in_progress", "submitted_for_review"].includes(item.status));
  return <section><PageHeader eyebrow="VOLUNTEER PICKUPS" title="Item pickup tasks" description="Before accepting, only category, condition, quantity, pickup city, distance when calculated, and pickup window are shown. Address and donor contact are returned only after your acceptance." />
    {offers.length > 0 && <div className="data-card"><div className="table-heading"><div><h2>Available pickup offers</h2><p>Offers are private to you and expire at the displayed time.</p></div></div>{offers.map((offer) => <ItemPickupOfferCard key={offer.assignmentId} offer={offer} pending={action.isPending} onAccept={() => action.mutate({ type: "accept", id: offer.assignmentId })} onDecline={() => action.mutate({ type: "decline", id: offer.assignmentId })} />)}</div>}
    {offers.length === 0 && <EmptyState title="No pickup offers right now." description={offersQuery.data?.eligibility ? "Offers will appear when an accepted item donation matches your eligible service area, category, availability, and task opt-in." : "Your profile must be eligible and opted in to receive pickup offers."} />}
    {active.length > 0 && <div className="data-card"><div className="table-heading"><div><h2>My active pickups</h2><p>Pickup completion requires private photo evidence and NGO receipt confirmation.</p></div></div>{active.map((item) => <article className="verification-row" key={item.id}><div className="verification-info"><strong>{item.category.replaceAll("_", " ")} · {item.quantity} · {item.city}</strong><small>{item.pickupWindowStart ? new Date(item.pickupWindowStart).toLocaleString() : ""} · {item.progressNote ?? ""}</small><StatusBadge status={item.status === "submitted_for_review" ? "warning" : "success"}>{item.status.replaceAll("_", " ")}</StatusBadge></div><div className="verification-actions">{item.canAccessDetails && <Button variant="outline" onClick={() => setSelectedId(item.id)}>Secure pickup details</Button>}{item.status === "accepted" && <Button disabled={action.isPending} onClick={() => action.mutate({ type: "start", id: item.id })}><Play size={13} /> Start pickup</Button>}{["accepted", "in_progress"].includes(item.status) && <Button variant="quiet" onClick={() => { const reason = window.prompt("Describe the pickup issue."); if (reason?.trim()) issue.mutate({ id: item.id, reason: reason.trim() }); }}>Report issue</Button>}</div></article>)}</div>}
    {selectedId && selected?.canAccessDetails && <div className="data-card volunteer-private-panel"><div className="table-heading"><div><span className="eyebrow">ASSIGNED VOLUNTEER ONLY</span><h2>Private pickup details</h2></div><button className="icon-button" aria-label="Close private pickup details" onClick={() => setSelectedId(undefined)}><X size={15} /></button></div>{details.isLoading ? <LoadingCards count={1} /> : details.isError ? <ErrorState description={details.error.message} retry={() => details.refetch()} /> : details.data && <div className="volunteer-private-details"><p>{details.data.description}</p><div className="document-notice"><MapPin size={14} /><span>{details.data.pickupAddress}, {details.data.city}{details.data.coordinates ? ` · ${details.data.coordinates.latitude.toFixed(5)}, ${details.data.coordinates.longitude.toFixed(5)}` : ""}</span></div><p><strong>Donor contact:</strong> {details.data.contact.name} · {details.data.contact.value ?? details.data.contact.method}</p>{details.data.specialHandling && <p><strong>Handling instructions:</strong> {details.data.specialHandling}</p>}<p><strong>Quantity/condition:</strong> {details.data.quantity} · {details.data.condition}</p>{selected.status === "in_progress" && <><label className="form-label">Private pickup evidence<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) upload.mutate({ donationId: details.data!.donationId, file }); event.currentTarget.value = ""; }} /></label><label className="form-label">Collection report<textarea rows={3} maxLength={500} value={report} onChange={(event) => setReport(event.target.value)} placeholder="Briefly report collection details for NGO review." /></label><Button disabled={!report.trim() || submit.isPending || upload.isPending} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : "Submit pickup for NGO review"}</Button></>}</div>}</div>}
    {assignments.length > 0 && <div className="data-card"><h2>Pickup history</h2>{assignments.filter((item) => !active.includes(item)).map((item) => <p className="muted-copy" key={item.id}>{item.category.replaceAll("_", " ")} · {item.city} · {item.status.replaceAll("_", " ")}</p>)}</div>}
  </section>;
}

function ItemPickupOfferCard({ offer, pending, onAccept, onDecline }: { offer: ItemPickupOffer; pending: boolean; onAccept: () => void; onDecline: () => void }) {
  return <article className="verification-row"><div className="verification-info"><strong>{offer.category.replaceAll("_", " ")} · {offer.quantity} · {offer.condition.replaceAll("_", " ")}</strong><small>{offer.city}{offer.approximateDistanceKm === undefined ? "" : ` · about ${offer.approximateDistanceKm} km`} · {new Date(offer.pickupWindowStart).toLocaleString()} – {new Date(offer.pickupWindowEnd).toLocaleString()}</small><small>{offer.matchExplanation.join(" · ")}</small><small>Offer expires {new Date(offer.expiresAt).toLocaleString()}</small></div><div className="verification-actions"><Button variant="outline" disabled={pending} onClick={onDecline}>Decline</Button><Button disabled={pending} onClick={onAccept}>Accept pickup <ArrowRight size={13} /></Button></div></article>;
}

function ContributionStatus({ status }: { status: Contribution["status"] }) {
  const display = {
    creating: ["Preparing", "neutral"],
    pending: ["Pending", "warning"],
    settling: ["Confirming", "warning"],
    completed: ["Confirmed", "success"],
    failed: ["Failed", "danger"],
    expired: ["Expired", "neutral"],
    refund_required: ["Refund review", "danger"],
  } as const;
  const [label, tone] = display[status];
  return <StatusBadge status={tone}>{label}</StatusBadge>;
}

function AdminCompletionReviewInbox() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const inbox = useQuery({ queryKey: ["admin-completion-reviews"], queryFn: services.admin.completionReviews });
  const evidence = useQuery({
    queryKey: ["admin-completion-evidence", selectedId],
    queryFn: () => services.admin.assignmentEvidence(selectedId!),
    enabled: Boolean(selectedId),
  });
  const clear = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => services.admin.clearManualReview(id, reason),
    onSuccess: async () => {
      toast.success("Manual review recorded; the case returned to the owning NGO for a final decision.");
      setSelectedId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["admin-completion-reviews"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const download = async (item: AssignmentEvidence) => {
    if (!selectedId) return;
    try {
      const blob = await services.admin.downloadAssignmentEvidence(selectedId, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The private evidence could not be downloaded.");
    }
  };
  const finishReview = () => {
    if (!selectedId) return;
    const reason = window.prompt("Record the administrator's manual review outcome before returning the case to the NGO:");
    if (reason?.trim()) clear.mutate({ id: selectedId, reason: reason.trim() });
  };
  return <section className="data-card">
    <PageHeader eyebrow="ADMINISTRATOR REVIEW" title="Completion cases flagged for review" description="Review flagged submissions and record a reason to return them to the owning NGO. Administrators do not close help requests; NGO approval remains required." />
    {inbox.isLoading ? <LoadingCards /> : inbox.isError ? <ErrorState description={inbox.error.message} retry={() => inbox.refetch()} /> : inbox.data?.length ? <div className="volunteer-task-list">
      {inbox.data.map((item: NgoCompletionReviewSummary) => <article className="ngo-assignment-row" key={item.assignmentId}>
        <div><span className="eyebrow">{item.reference} · {item.category.replaceAll("_", " ")}</span><h3>{item.title}</h3><p>{item.city} · {item.urgency} urgency</p><p>{item.summary}</p><small>Flagged: {item.flagReason ?? "No decision note recorded"}</small></div>
        <Button variant="outline" onClick={() => setSelectedId(item.assignmentId)}>Open manual review</Button>
      </article>)}
    </div> : <EmptyState title="No cases need manual review." description="NGO-flagged completion submissions will be listed here." />}
    {selectedId && <div className="review-dialog-backdrop">
      <section className="review-dialog completion-review-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-completion-review-title">
        <button className="review-dialog-close" aria-label="Close manual review" onClick={() => setSelectedId(undefined)}><X size={18} /></button>
        {evidence.isLoading ? <LoadingCards count={1} /> : evidence.isError ? <ErrorState description={evidence.error.message} retry={() => evidence.refetch()} /> : evidence.data && <>
          <span className="eyebrow">ADMIN MANUAL REVIEW</span><h2 id="admin-completion-review-title">{evidence.data.summary || "Completion submission"}</h2><p>{evidence.data.report}</p>
          <CompletionAiAssessment assessment={evidence.data.aiReview} />
          <div className="ngo-completion-proof"><h4>Private evidence</h4>{evidence.data.evidence.length ? evidence.data.evidence.map((item) => <div className="request-document-row" key={item.id}><FileText size={15} /><span>{item.name}</span><Button variant="outline" onClick={() => void download(item)}>Download privately</Button></div>) : <p>No evidence metadata is available.</p>}</div>
          <div className="ngo-completion-proof"><h4>Submission history</h4>{evidence.data.reviewHistory.map((item, index) => <p key={`${item.status}-${index}`}><strong>{item.status.replaceAll("_", " ")}</strong> · {new Date(item.occurredAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</p>)}</div>
          <Button disabled={clear.isPending} onClick={finishReview}>{clear.isPending ? "Saving…" : "Record review and return to NGO"}</Button>
        </>}
      </section>
    </div>}
  </section>;
}

function AdminAccountManager() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const accounts = useQuery({
    queryKey: ["admin-accounts", page, role, status],
    queryFn: () => services.admin.accounts(page, role, status),
  });
  const update = useMutation({
    mutationFn: ({ id, nextStatus, reason }: { id: string; nextStatus: "active" | "suspended"; reason?: string }) =>
      services.admin.updateAccountStatus(id, nextStatus, reason),
    onSuccess: async () => {
      toast.success("Account status updated and audited.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-operations"] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const totalPages = Math.max(1, Math.ceil((accounts.data?.total ?? 0) / (accounts.data?.pageSize ?? 25)));
  return <section className="data-card">
    <PageHeader eyebrow="ACCOUNT MANAGEMENT" title="User and NGO accounts" description="Only active non-admin accounts are listed. Suspensions require a reason and are blocked while the account owns active assignments or routed requests." action={<div className="verification-actions"><label className="range-select">Role<select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="all">All roles</option><option value="user">Help seeker</option><option value="donor">Donor</option><option value="volunteer">Volunteer</option><option value="ngo">NGO</option></select></label><label className="range-select">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></div>} />
    {accounts.isLoading ? <LoadingCards /> : accounts.isError ? <ErrorState description={accounts.error.message} retry={() => accounts.refetch()} /> : accounts.data?.accounts.length ? accounts.data.accounts.map((account) => <article className="verification-row" key={account.id}><div className="verification-info"><strong>{account.name}</strong><small>{account.role} · {account.email} · {account.city}</small>{account.organizationStatus && <small>NGO verification: {account.organizationStatus.replaceAll("_", " ")}</small>}</div><StatusBadge status={account.accountStatus === "active" ? "success" : "danger"}>{account.accountStatus}</StatusBadge><Button variant={account.accountStatus === "active" ? "quiet" : "outline"} disabled={update.isPending} onClick={() => {
      if (account.accountStatus === "suspended") {
        update.mutate({ id: account.id, nextStatus: "active" });
        return;
      }
      const reason = window.prompt("Why should this account be suspended?");
      if (reason?.trim()) update.mutate({ id: account.id, nextStatus: "suspended", reason: reason.trim() });
    }}>{account.accountStatus === "active" ? "Suspend" : "Reactivate"}</Button></article>) : <EmptyState title="No accounts match these filters." description="Change the role or status filter to view other accounts." />}
    <div className="verification-actions"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></div>
  </section>;
}

function AdminOperationsPanel({ compact = false }: { compact?: boolean }) {
  const operations = useQuery({ queryKey: ["admin-operations"], queryFn: services.admin.operations });
  if (operations.isLoading) return <LoadingCards count={1} />;
  if (operations.isError) return <ErrorState description={operations.error.message} retry={() => operations.refetch()} />;
  const data = operations.data;
  if (!data) return null;
  const integrationLabels: Record<string, string> = {
    mongodb: "MongoDB", ocr: "OCR provider", ai: "AI review provider", privateStorage: "Private file storage",
    razorpay: "Razorpay", inAppNotifications: "In-app notifications", email: "Email", push: "Push", sms: "SMS",
    geospatialMatching: "Location matching", geocoding: "Geocoding",
  };
  const integrationStatus = (integration: { configured: boolean; state: string; runtimeVerified: boolean }) =>
    integration.state;
  return <section className="data-card"><PageHeader eyebrow={compact ? "OPERATIONS" : "ADMIN OPERATIONS"} title={compact ? "Operational status" : "Provider and review status"} description="Configuration is reported separately from live health; external provider credentials and delivery are never implied to be healthy." />
    <div className="stat-grid three">{Object.entries(data.integrations).map(([key, integration]) => <div key={key}><StatCard label={integrationLabels[key] ?? key} value={integrationStatus(integration)} icon={integration.runtimeVerified ? <Check /> : <TriangleAlert />} />{integration.reason && <small className="muted-copy">{integration.reason}</small>}{integration.checkedAt && <small className="muted-copy">Checked {new Date(integration.checkedAt).toLocaleString()}</small>}{integration.productionReady === false && <small className="muted-copy">Not production-ready</small>}</div>)}</div>
    <div className="section-title-row"><div><h2>Cases requiring follow-up</h2><p>Database-backed counts. Payment IDs and private requester details are not exposed here.</p></div></div>
    <div className="stat-grid three">
      <StatCard label="Requests flagged for review" value={data.cases.flaggedRequests} icon={<FileText />} to="/admin/completion-reviews" />
      <StatCard label="Escalated assignments" value={data.cases.escalatedAssignments} icon={<FileCheck2 />} to="/admin/tasks" />
      <StatCard label="Disputed pickups / items" value={data.cases.disputedPickups + data.cases.disputedItemDonations} icon={<TriangleAlert />} to="/admin/tasks" />
      <StatCard label="Payments requiring refund review" value={data.cases.refundRequiredPayments} icon={<Wallet />} to="/admin/donations" />
    </div>
    <p className="muted-copy">Email, push, and SMS providers are unavailable. Refund-required contributions are visible in Donation Status but have no automated refund action.</p>
  </section>;
}

function AdminAuditLogViewer() {
  const [page, setPage] = useState(1);
  const logs = useQuery({ queryKey: ["admin-audit-logs", page], queryFn: () => services.admin.auditLogs(page) });
  if (logs.isLoading) return <LoadingCards />;
  if (logs.isError) return <ErrorState description={logs.error.message} retry={() => logs.refetch()} />;
  const data = logs.data;
  if (!data?.total) return <EmptyState title="No audit events have been recorded." description="Administrative and workflow decisions appear here as they occur." />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="data-card"><PageHeader eyebrow="ADMIN AUDIT" title="Audit history" description={`${data.total} recorded administrative and workflow events. Evidence contents and private file keys are not included.`} />
    {data.entries.map((entry) => <article className="verification-row" key={entry.id}><div className="verification-info"><strong>{entry.action.replaceAll(".", " ")}</strong><small>{entry.actor.name} ({entry.actor.role}) · {entry.resourceType} · {entry.resourceId}</small><small>{entry.previousStatus ?? "—"} → {entry.newStatus ?? "—"} · {new Date(entry.occurredAt).toLocaleString()}</small>{entry.reason && <small>Reason: {entry.reason}</small>}</div></article>)}
    <div className="verification-actions"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></div>
  </section>;
}

function AdminDonationStatus() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const donations = useQuery({ queryKey: ["admin-donations", page, status], queryFn: () => services.admin.donations(page, status) });
  if (donations.isLoading) return <LoadingCards />;
  if (donations.isError) return <ErrorState description={donations.error.message} retry={() => donations.refetch()} />;
  const data = donations.data;
  if (!data?.total) return <EmptyState title="No monetary donation orders match this view." description="Orders and confirmed contributions are loaded from the database." />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="data-card"><PageHeader eyebrow="PAYMENT OPERATIONS" title="Donation status" description="Authorized payment-state overview; provider IDs and donor contact details are withheld." action={<label className="range-select">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="creating">Creating</option><option value="pending">Pending</option><option value="settling">Settling</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="expired">Expired</option><option value="refund_required">Refund review</option></select></label>} />
    <div className="responsive-table"><table><thead><tr><th>Campaign</th><th>Amount</th><th>Status</th><th>Reference</th><th>Updated</th></tr></thead><tbody>{data.donations.map((item) => <tr key={item.id}><td>{item.campaign}</td><td>{item.currency} {item.amount.toLocaleString("en-IN")}</td><td><StatusBadge status={item.status === "completed" ? "success" : item.status === "refund_required" || item.status === "failed" ? "danger" : "warning"}>{item.status.replaceAll("_", " ")}</StatusBadge></td><td>{item.receiptReference ?? "—"}</td><td>{new Date(item.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>
    <div className="verification-actions"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button></div>
  </section>;
}

function AdminContent({ page }: { page: string }) {
  const queryClient = useQueryClient();
  const [volunteerFilter, setVolunteerFilter] = useState<"pending" | "under_review" | "eligible" | "rejected" | "more_information_required" | "suspended">("pending");
  const overview = useQuery({ queryKey: queryKeys.admin, queryFn: services.admin.overview });
  const organizations = useQuery({ queryKey: queryKeys.verification, queryFn: services.admin.pendingOrganizations });
  const volunteers = useQuery({ queryKey: ["admin-volunteers", volunteerFilter], queryFn: () => services.admin.volunteers(volunteerFilter), enabled: page === "users" });
  const review = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: "verified" | "rejected" | "resubmission_required"; reason?: string }) => services.admin.reviewOrganization(id, status, reason),
    onSuccess: async (_, variables) => { toast.success(variables.status === "verified" ? "Organization verified." : variables.status === "rejected" ? "Organization application rejected." : "Resubmission requested."); await queryClient.invalidateQueries(); },
    onError: (error) => toast.error(error.message),
  });
  const decide = (id: string, status: "verified" | "rejected" | "resubmission_required") => {
    const reason = status === "verified" ? undefined : window.prompt(status === "rejected" ? "Enter the reason for rejecting this application:" : "Enter what the organization must resubmit:");
    if (status !== "verified" && !reason?.trim()) return;
    review.mutate({ id, status, reason: reason?.trim() });
  };
  const volunteerReview = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: NonNullable<User["volunteerEligibility"]>; reason?: string }) =>
      services.admin.updateVolunteerEligibility(id, status, reason),
    onSuccess: async () => { toast.success("Volunteer eligibility updated."); await queryClient.invalidateQueries({ queryKey: ["admin-volunteers"] }); },
    onError: (error) => toast.error(error.message),
  });
  if (page === "completion-reviews") return <AdminCompletionReviewInbox />;
  if (page === "notifications") return <MyNotifications role="admin" />;
  if (page === "operations") return <AdminOperationsPanel />;
  if (page === "audit-logs") return <AdminAuditLogViewer />;
  if (page === "donations") return <AdminDonationStatus />;
  if (page === "tasks") return <><AdminOperationsPanel compact /><AdminCompletionReviewInbox /></>;
  if (page === "verifications" || page === "ngos") return <><PageHeader eyebrow="COMMUNITY TRUST" title="NGO verification" description="Review organization details and private supporting documents. Platform verification is not government certification or legal endorsement." />{organizations.isLoading ? <LoadingCards /> : organizations.isError ? <ErrorState description={organizations.error.message} retry={() => organizations.refetch()} /> : organizations.data?.length ? <div className="data-card"><div className="table-heading"><div><h2>Pending verifications</h2><p>{organizations.data.length} organizations awaiting review.</p></div></div>{organizations.data.map((ngo) => <article className="verification-row" key={ngo.id}><span className="organization-monogram">{ngo.name.slice(0, 1)}</span><div className="verification-info"><strong>{ngo.name}</strong><small>{ngo.email} · {ngo.city}</small><small>{ngo.categories?.join(" · ") || "No causes listed"}{ngo.registrationNumber ? ` · Registration: ${ngo.registrationNumber}` : ""}</small>{ngo.description && <p>{ngo.description}</p>}<details><summary>Review application details</summary><small>Registration: {ngo.registrationType || "Not specified"} · {ngo.registrationNumber || "No number"}</small><small>Representative: {ngo.representativeName || "Not provided"}{ngo.representativeDesignation ? ` · ${ngo.representativeDesignation}` : ""}</small><small>Issuing authority: {ngo.issuingAuthority || "Not specified"}{ngo.establishedDate ? ` · Established ${ngo.establishedDate}` : ""}</small><small>Official contact: {ngo.officialEmail || ngo.email} · {ngo.officialPhone || ngo.phone || "No phone"}</small><small>Address: {[ngo.addressLine, ngo.city, ngo.state, ngo.postalCode].filter(Boolean).join(", ") || "Not provided"}</small><small>Service area: {ngo.serviceArea || "Not provided"}</small><small>Website: {ngo.website || "Not provided"}</small>{ngo.documents?.length ? ngo.documents.map((document) => <Button key={document.id} variant="quiet" onClick={() => void downloadVerificationDocument(document.id, document.name)}><Download size={13} /> Review {document.name} · {document.kind.replaceAll("_", " ")}</Button>) : <p>No supporting documents have been uploaded.</p>}</details></div><StatusBadge status="warning">{ngo.organizationStatus === "resubmission_required" ? "Resubmission required" : "Pending review"}</StatusBadge><div className="verification-actions"><Button variant="outline" disabled={review.isPending} onClick={() => decide(ngo.id, "rejected")}>Reject</Button><Button variant="quiet" disabled={review.isPending} onClick={() => decide(ngo.id, "resubmission_required")}>Request changes</Button><Button disabled={review.isPending} onClick={() => decide(ngo.id, "verified")}><Check size={13} /> Approve</Button></div></article>)}</div> : <EmptyState title="You’re all caught up." description="New NGO applications will appear here." />}</>;
  if (page === "users") return <><AdminAccountManager /><section className="data-card">
    <PageHeader eyebrow="VOLUNTEER SAFETY" title="Volunteer eligibility" description="Review volunteer task eligibility. Eligibility is separate from task opt-in and does not reveal volunteer contact information to NGOs." action={<label className="range-select">Status<select value={volunteerFilter} onChange={(event) => {
      const value = event.target.value;
      if (["pending", "under_review", "eligible", "rejected", "more_information_required", "suspended"].includes(value)) setVolunteerFilter(value as typeof volunteerFilter);
    }}><option value="pending">Pending</option><option value="under_review">Under review</option><option value="eligible">Eligible</option><option value="more_information_required">More information required</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></label>} />
    {volunteers.isLoading ? <LoadingCards /> : volunteers.isError ? <ErrorState description={volunteers.error.message} retry={() => volunteers.refetch()} /> : volunteers.data?.length ? volunteers.data.map((volunteer) => <article className="verification-row" key={volunteer.id}>
      <span className="organization-monogram">{volunteer.name.slice(0, 1).toUpperCase()}</span><div className="verification-info"><strong>{volunteer.name}</strong><small>{volunteer.email} · {volunteer.city}</small><small>Skills: {volunteer.skills.join(" · ") || "Not provided"}</small><small>Interests: {volunteer.interests.join(" · ") || "Not provided"} · Languages: {volunteer.languages.join(" · ") || "Not provided"}</small><small>Area: {volunteer.serviceArea || volunteer.city} · Radius: {volunteer.serviceRadiusKm} km · Availability: {volunteer.availability || "Not provided"}</small><small>{volunteer.taskOptIn ? "Opted in for task offers" : "Not opted in"} · Account {volunteer.accountStatus}</small>{volunteer.verificationReason && <small>Reviewer note: {volunteer.verificationReason}</small>}{volunteer.documents.map((document) => <Button key={document.id} variant="quiet" onClick={() => void downloadVerificationDocument(document.id, document.name)}><Download size={13} /> Review {document.name}</Button>)}</div>
      <StatusBadge status={volunteer.eligibility === "eligible" ? "success" : "warning"}>{volunteer.eligibility}</StatusBadge>
      <div className="verification-actions">{volunteer.eligibility !== "eligible" && <Button disabled={volunteerReview.isPending} onClick={() => volunteerReview.mutate({ id: volunteer.id, status: "eligible" })}>Approve</Button>}{volunteer.eligibility !== "rejected" && <Button variant="outline" disabled={volunteerReview.isPending} onClick={() => {
        const reason = window.prompt("Enter the reason for rejecting this application:");
        if (reason?.trim()) volunteerReview.mutate({ id: volunteer.id, status: "rejected", reason: reason.trim() });
      }}>Reject</Button>}{volunteer.eligibility !== "more_information_required" && <Button variant="quiet" disabled={volunteerReview.isPending} onClick={() => {
        const reason = window.prompt("Describe the additional information required:");
        if (reason?.trim()) volunteerReview.mutate({ id: volunteer.id, status: "more_information_required", reason: reason.trim() });
      }}>Request information</Button>}{volunteer.eligibility !== "suspended" && <Button variant="quiet" disabled={volunteerReview.isPending} onClick={() => {
        const reason = window.prompt("Why is this volunteer suspended?");
        if (reason?.trim()) volunteerReview.mutate({ id: volunteer.id, status: "suspended", reason: reason.trim() });
      }}>Suspend</Button>}</div>
    </article>) : <EmptyState title="No volunteers awaiting eligibility review." description="New volunteer accounts appear here after opting in to task offers." />}
  </section></>;
  if (page === "dashboard" || page === "analytics" || page === "reports") return <AdminOverview
    overview={overview}
    organizations={organizations}
    reviewPending={review.isPending}
    onReview={decide}
  />;
  return <UnavailableFeature name="Admin page" reason="This page is not part of the current administrator workspace." />;
}

async function downloadVerificationDocument(id: string, fileName: string) {
  try {
    const file = await services.admin.verificationDocument(id);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The private verification document could not be downloaded.");
  }
}

function AdminOverview({
  overview,
  organizations,
  reviewPending,
  onReview,
}: {
  overview: UseQueryResult<OverviewQueryData, Error>;
  organizations: UseQueryResult<AdminOrganization[], Error>;
  reviewPending: boolean;
  onReview: (id: string, status: "verified" | "rejected" | "resubmission_required") => void;
}) {
  const download = () => {
    if (!overview.data) return;
    const rows = [["Month", "Confirmed donations (INR)"], ...overview.data.donationMonths.map((item) => [item.month, String(item.total)])];
    downloadCsv("impactmatch-donations.csv", rows);
  };
  return <>{overview.isError && <ErrorState description={overview.error.message} retry={() => overview.refetch()} />}<div className="welcome-row"><div><h2>Admin Dashboard</h2><p>Platform activity and community verification at a glance.</p></div><Link to="/admin/verifications" className="button button-outline">Pending verifications <ArrowRight size={14} /></Link></div><div className="stat-grid four">{[
    ["Total NGOs", overview.data?.totalNgos, <Building2 />], ["Verified NGOs", overview.data?.verifiedNgos, <BadgeCheck />],
    ["Registered users", overview.data?.users, <Users />], ["Confirmed donations", overview.data ? `₹${overview.data.fundsRaised.toLocaleString("en-IN")}` : "—", <Wallet />],
  ].map(([label, value, icon]) => <StatCard key={String(label)} label={String(label)} value={value === undefined ? "—" : value as string | number} icon={icon as ReactNode} to={label === "Total NGOs" || label === "Verified NGOs" ? "/admin/verifications" : label === "Registered users" ? "/admin/users" : "/admin/donations"} />)}</div>
    <div className="analytics-grid"><section className="data-card chart-card"><div className="table-heading"><div><h2>Donation activity</h2><p>Confirmed contributions by month (INR).</p></div><Button variant="outline" onClick={download} disabled={!overview.data?.donationMonths.length}><Download size={14} /> Export CSV</Button></div>{overview.data?.donationMonths.length ? <ResponsiveContainer width="100%" height={260}><AreaChart data={overview.data.donationMonths}><defs><linearGradient id="donationFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0d9b69" stopOpacity={.23} /><stop offset="100%" stopColor="#0d9b69" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#edf0eb" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "Donations"]} /><Area type="monotone" dataKey="total" stroke="#07875a" fill="url(#donationFill)" strokeWidth={2} /></AreaChart></ResponsiveContainer> : <EmptyState title="Donation data will appear here." description="The chart fills in after verified donations are recorded." />}</section><section className="data-card chart-card"><div className="table-heading"><div><h2>Giving by cause</h2><p>Confirmed donations across active needs.</p></div></div>{overview.data?.causes.length ? <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={overview.data.causes} dataKey="total" nameKey="cause" innerRadius={54} outerRadius={88} paddingAngle={3}>{overview.data.causes.map((item, index) => <Cell key={item.cause} fill={["#07875a", "#75b394", "#edbc56", "#db8b72", "#8d9bd0", "#69aabb"][index % 6]} />)}</Pie><Tooltip formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`} /></PieChart></ResponsiveContainer> : <EmptyState title="No cause data yet." description="Charts use verified contributions, not demo metrics." />}</section><section className="data-card chart-card"><div className="table-heading"><div><h2>Community growth</h2><p>New volunteer, donor, and NGO accounts by month.</p></div></div>{overview.data?.userMonths.length ? <ResponsiveContainer width="100%" height={260}><AreaChart data={overview.data.userMonths}><CartesianGrid stroke="#edf0eb" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Area type="monotone" dataKey="total" stroke="#07875a" fill="#d9eee3" strokeWidth={2} /></AreaChart></ResponsiveContainer> : <EmptyState title="Growth data will appear here." description="Monthly account totals are calculated from registered users." />}</section></div>
    <AdminOperationsPanel compact />
    <section className="data-card verification-queue"><div className="table-heading"><div><h2>Pending NGO verification</h2><p>Review organization profiles before they publish opportunities.</p></div><Link to="/admin/verifications" className="text-link">View queue <ArrowRight size={14} /></Link></div>{organizations.isLoading ? <LoadingCards count={1} /> : organizations.isError ? <ErrorState description={organizations.error.message} retry={() => organizations.refetch()} /> : organizations.data?.length ? organizations.data.slice(0, 5).map((ngo) => <article className="verification-row" key={ngo.id}><span className="organization-monogram">{ngo.name.slice(0, 1)}</span><div><strong>{ngo.name}</strong><small>{ngo.email} · {ngo.city}{ngo.registrationNumber ? ` · ${ngo.registrationNumber}` : ""}</small></div><div className="verification-actions"><Button variant="outline" disabled={reviewPending} onClick={() => onReview(ngo.id, "rejected")}>Reject</Button><Button variant="quiet" disabled={reviewPending} onClick={() => onReview(ngo.id, "resubmission_required")}>Request changes</Button><Button disabled={reviewPending} onClick={() => onReview(ngo.id, "verified")}><Check size={13} /> Approve</Button></div></article>) : <EmptyState title="You’re all caught up." description="New organization applications will appear here." />}</section></>;
}

function ProfileEditor({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"profile" | "skills" | "impact" | "settings">("profile");
  const form = useForm({ defaultValues: { name: user.name, city: user.city, description: user.description ?? "", skills: user.skills?.join(", ") ?? "", interests: user.interests?.join(", ") ?? "" } });
  const impact = useQuery({ queryKey: queryKeys.impact, queryFn: services.impact.mine, enabled: section === "impact" });
  const save = useMutation({
    mutationFn: (data: { name: string; city: string; description: string; skills: string; interests: string }) => services.profile.update({
      name: data.name,
      city: data.city,
      description: data.description,
      skills: data.skills.split(",").map((value) => value.trim()).filter(Boolean),
      interests: data.interests.split(",").map((value) => value.trim()).filter(Boolean),
    }),
    onSuccess: async () => { toast.success("Profile updated."); await queryClient.invalidateQueries({ queryKey: queryKeys.user }); },
    onError: (error) => toast.error(error.message),
  });
  const sections = [
    ["profile", "Profile"], ["skills", "Skills"], ["impact", "My Impact"], ["settings", "Settings"],
  ] as const;
  return <div className="profile-layout">
    <aside className="profile-menu"><div className="profile-avatar-large">{user.name.slice(0, 1).toUpperCase()}</div><strong>{user.name}</strong><span>{user.role}</span><nav aria-label="Profile sections">{sections.map(([key, label]) => <button type="button" className={section === key ? "active" : ""} key={key} onClick={() => setSection(key)}>{label}</button>)}</nav></aside>
    <section className="data-card form-card">
      {section === "profile" && <><PageHeader eyebrow="YOUR INFORMATION" title="Profile information" description="Keep your profile current so organizations know how to reach you." action={<StatusBadge status="success">Edit Profile</StatusBadge>} /><form className="form-stack profile-form" onSubmit={form.handleSubmit((data) => save.mutate(data))}><label className="form-label">Full name<input {...form.register("name", { required: true })} /></label><label className="form-label">Email address<input value={user.email} disabled /></label><label className="form-label">Location<input {...form.register("city", { required: true })} /></label><label className="form-label">Biography<textarea {...form.register("description")} rows={4} placeholder="A little about you and why you care." /></label><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"} <Check size={14} /></Button></form></>}
      {section === "skills" && <><PageHeader eyebrow="HOW YOU CAN HELP" title="Skills and causes" description="Share your interests so organizations can understand how you may contribute." /><form className="form-stack profile-form" onSubmit={form.handleSubmit((data) => save.mutate(data))}><label className="form-label">Skills (comma-separated)<input {...form.register("skills")} placeholder="Teaching, event planning" /></label><label className="form-label">Causes I care about<input {...form.register("interests")} placeholder="Education, Environment" /></label><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"} <Check size={14} /></Button></form></>}
      {section === "impact" && <><PageHeader eyebrow="YOUR CONTRIBUTIONS" title="My impact" description="A summary of contributions currently recorded on your account." />{impact.isLoading ? <LoadingCards count={2} /> : impact.isError ? <ErrorState description={impact.error.message} retry={() => impact.refetch()} /> : impact.data ? <div className="stat-grid three"><StatCard label="Donations" value={`₹${impact.data.donations.toLocaleString("en-IN")}`} icon={<Wallet />} /><StatCard label="Volunteer sign-ups" value={impact.data.volunteerSignups} icon={<Users />} /><StatCard label="Completed contributions" value={impact.data.completedActions} icon={<Heart />} /></div> : <ErrorState title="Impact is not available." description="The account did not return an impact summary." retry={() => impact.refetch()} />}</>}
      {section === "settings" && <><PageHeader eyebrow="ACCOUNT SECURITY" title="Settings" description="Manage the account information currently available for your profile." /><div className="document-notice"><ShieldCheck size={16} /><span>Your session uses a secure HTTP-only cookie. Changing your email address or password is not available in this MVP.</span></div><label className="form-label">Account email<input value={user.email} disabled /></label><label className="form-label">Account role<input value={user.role} disabled /></label></>}
    </section>
  </div>;
}

function NeedDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const schema = z.object({
    title: z.string().trim().min(5, "Add a more descriptive title").max(100),
    description: z.string().trim().min(20, "Add at least 20 characters").max(1000),
    kind: z.enum(["volunteer", "donation"]),
    category: z.string().min(2),
    city: z.string().trim().min(2),
    urgency: z.enum(["low", "medium", "high"]),
    targetAmount: z.coerce.number().int().positive().max(10_000_000).optional(),
    volunteersNeeded: z.coerce.number().int().min(1).max(500).optional(),
  }).superRefine((value, context) => {
    if (value.kind === "donation" && !value.targetAmount) context.addIssue({ code: "custom", path: ["targetAmount"], message: "Add a fundraising goal." });
    if (value.kind === "volunteer" && !value.volunteersNeeded) context.addIssue({ code: "custom", path: ["volunteersNeeded"], message: "Add the number of volunteers." });
  });
  const form = useForm<z.input<typeof schema>, unknown, NeedInput>({ resolver: zodResolver(schema), defaultValues: { kind: "volunteer", category: "Education", city: "", urgency: "medium", volunteersNeeded: 5 } });
  const kind = form.watch("kind");
  const create = useMutation({ mutationFn: services.needs.create, onSuccess: onCreated, onError: (error) => toast.error(error.message) });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><button className="modal-close" aria-label="Close dialog" onClick={onClose}><X size={18} /></button><span className="eyebrow">BRING PEOPLE TOGETHER</span><h2 id="create-task-title">Create a new task.</h2><form className="form-stack" onSubmit={form.handleSubmit((data) => create.mutate(data))}><label className="form-label">Title<input {...form.register("title")} placeholder="Weekend reading buddies" />{form.formState.errors.title && <span className="field-error">{form.formState.errors.title.message}</span>}</label><label className="form-label">Description<textarea {...form.register("description")} rows={3} placeholder="Who will this help, and how can people contribute?" />{form.formState.errors.description && <span className="field-error">{form.formState.errors.description.message}</span>}</label><div className="form-two"><label className="form-label">Type<select {...form.register("kind")}><option value="volunteer">Volunteer</option><option value="donation">Donation campaign</option></select></label><label className="form-label">Cause<select {...form.register("category")}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="form-two"><label className="form-label">City<input {...form.register("city")} /></label><label className="form-label">Urgency<select {...form.register("urgency")}><option value="low">Whenever possible</option><option value="medium">Coming up soon</option><option value="high">Urgent</option></select></label></div>{kind === "volunteer" ? <label className="form-label">Volunteers needed<input type="number" {...form.register("volunteersNeeded", { setValueAs: (value) => value === "" ? undefined : Number(value) })} />{form.formState.errors.volunteersNeeded && <span className="field-error">{form.formState.errors.volunteersNeeded.message}</span>}</label> : <label className="form-label">Fundraising goal (INR)<input type="number" {...form.register("targetAmount", { setValueAs: (value) => value === "" ? undefined : Number(value) })} />{form.formState.errors.targetAmount && <span className="field-error">{form.formState.errors.targetAmount.message}</span>}</label>}<div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Publishing…" : "Publish opportunity"} <ArrowRight size={14} /></Button></div></form></div></div>;
}

function ImpactAnalytics({ embedded = false }: { embedded?: boolean }) {
  const [range, setRange] = useState<6 | 12>(12);
  const query = useQuery({ queryKey: queryKeys.overview, queryFn: services.impact.overview });
  const donationMonths = query.data?.donationMonths.slice(-range) ?? [];
  const exportCsv = () => {
    if (!query.data) return;
    const rows = [["Month", "Confirmed donations (INR)"], ...donationMonths.map((item) => [item.month, String(item.total)])];
    downloadCsv("impactmatch-impact.csv", rows);
  };
  const overview = query.data;
  return <section className={embedded ? "" : "page-container analytics-page"}>
    {!embedded && <PageHeader eyebrow="REAL PEOPLE. REAL CHANGE." title="Our impact, together." description="A transparent look at the community support recorded on ImpactMatchNGO." action={<label className="range-select"><CalendarDays size={14} /><select aria-label="Analytics date range" value={range} onChange={(event) => setRange(Number(event.target.value) as 6 | 12)}><option value={12}>Last 12 months</option><option value={6}>Last 6 months</option></select></label>} />}
    {query.isError && <ErrorState description={query.error.message} retry={() => query.refetch()} />}
    <div className="stat-grid five">{[
      ["Funds Raised", overview ? `₹${overview.fundsRaised.toLocaleString("en-IN")}` : "—", <Wallet />],
      ["Volunteers", overview?.volunteers, <Users />], ["Active NGOs", overview?.verifiedNgos, <Building2 />], ["Active Tasks", overview?.activeTasks, <Target />],
      ["Aid requests completed", overview?.completedHelpRequests, <Check />],
    ].map(([label, value, icon]) => <StatCard key={String(label)} label={String(label)} value={value === undefined ? "—" : value as string | number} icon={icon as ReactNode} />)}</div>
    <div className="analytics-grid"><section className="data-card chart-card"><div className="table-heading"><div><h2>Monthly donations</h2><p>Confirmed contributions recorded by the payment API.</p></div><Button variant="outline" disabled={!donationMonths.length} onClick={exportCsv}><Download size={14} /> Export</Button></div>{donationMonths.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={donationMonths}><CartesianGrid stroke="#edf0eb" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "Donations"]} /><Bar dataKey="total" fill="#08774f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyState title="Donation activity will appear here." description="No confirmed donation records for this period." />}</section><section className="data-card chart-card"><div className="table-heading"><div><h2>Impact by cause</h2><p>Based on completed, verified donation records.</p></div></div>{overview?.causes.length ? <ResponsiveContainer width="100%" height={280}><PieChart><Pie data={overview.causes} dataKey="total" nameKey="cause" innerRadius={58} outerRadius={92} paddingAngle={4}>{overview.causes.map((item, index) => <Cell key={item.cause} fill={["#08774f", "#72b294", "#edbd5c", "#d98670", "#8796d1", "#66a7ac"][index % 6]} />)}</Pie><Tooltip formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`} /></PieChart></ResponsiveContainer> : <EmptyState title="Cause breakdown unavailable." description="Verified donation data will appear here." />}</section></div>
    {!embedded && <p className="analytics-disclaimer"><ShieldCheck size={14} /> Totals are generated from recorded backend contributions. Volunteer counts represent registered volunteer accounts.</p>}
  </section>;
}

function NearbyOrganizations() {
  const [city, setCity] = useState("");
  const [listView, setListView] = useState(true);
  const ngos = useQuery({ queryKey: [...queryKeys.organizations, "nearby", city], queryFn: () => services.ngos.list(city ? new URLSearchParams({ city }) : undefined) });
  return <section className="page-container directory-page"><PageHeader eyebrow="LOCAL IMPACT" title="Organizations near you." description="Explore verified NGOs by city. Map pins and distance estimates require a configured map provider and verified organization coordinates." action={<div className="view-switch"><button className={listView ? "active" : ""} onClick={() => setListView(true)}>List</button><button className={!listView ? "active" : ""} onClick={() => setListView(false)}>Map</button></div>} /><div className="nearby-toolbar"><label className="field-with-icon"><MapPin size={15} /><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="All cities" aria-label="Filter by city" /></label></div>{!listView && <div className="map-fallback"><Globe2 size={30} /><h2>Map not configured</h2><p>Connect a map provider and organization coordinates to display an accurate interactive map. This view does not show simulated pins.</p><button className="text-link" onClick={() => setListView(true)}>View verified organization list <ArrowRight size={14} /></button></div>}{listView && (ngos.isLoading ? <LoadingCards /> : ngos.isError ? <ErrorState description={ngos.error.message} retry={() => ngos.refetch()} /> : ngos.data?.length ? <div className="organization-grid">{ngos.data.map((ngo) => <OrganizationCard key={ngo.id} ngo={ngo} />)}</div> : <EmptyState title="No verified NGOs found." description="Try another city or check back later." />)}</section>;
}

function AboutPage() {
  return <section className="page-container about-page"><div className="about-hero"><div><span className="eyebrow">WHY IMPACTMATCHNGO</span><h1>Good work deserves<br />a <span>clearer path.</span></h1><p>We connect people who want to help with verified organizations doing thoughtful work in their communities.</p><Link to="/ngos" className="button button-primary">Meet the NGOs <ArrowRight size={15} /></Link></div><ImageFrame src={photos.volunteers} alt="Community volunteers working together" /></div><div className="about-principles"><article><ShieldCheck /><h2>Trust comes first</h2><p>Organizations are reviewed by our team before they can publish community opportunities.</p></article><article><HeartHandshake /><h2>Many ways to help</h2><p>Share your time, support a cause, or bring a skill that your neighbors need.</p></article><article><Target /><h2>Impact you can see</h2><p>Confirmed contributions and active needs power our impact reporting.</p></article></div></section>;
}

function UnavailableFeature({ name, reason }: { name: string; reason: string }) {
  return <div className="feature-unavailable"><span className="state-icon"><Settings size={21} /></span><h2>{name}</h2><p>{reason}</p><Link className="button button-outline" to="/">Return to ImpactMatch <ArrowRight size={14} /></Link></div>;
}

function Breadcrumb({ items }: { items: Array<[string, string]> }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb">{items.map(([label, href], index) => <span key={label}>{index > 0 && <span className="breadcrumb-separator">/</span>}{href ? <Link to={href}>{label}</Link> : <strong>{label}</strong>}</span>)}</nav>;
}

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return <nav className="pagination" aria-label="Pagination">
    <button className="button button-outline" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span>Page {page} of {pageCount}</span>
    <button className="button button-outline" disabled={page === pageCount} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}

function NotFound() {
  return <section className="page-container not-found"><span className="eyebrow">404 · NOT FOUND</span><h1>This path needs a little help.</h1><p>The page you’re looking for isn’t here.</p><Link to="/" className="button button-primary">Return home <ArrowRight size={14} /></Link></section>;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default App;
