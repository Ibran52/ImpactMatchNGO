import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, HeartHandshake, MapPin, Users } from "lucide-react";
import type { Need } from "./types";
import type { Organization } from "./api";

export const photos = {
  hero: "https://images.unsplash.com/photo-1497486751825-1233686d5d80?auto=format&fit=crop&w=1400&q=85",
  classroom: "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=80",
  volunteers: "https://images.unsplash.com/photo-1559027615-cd4628902d4a?auto=format&fit=crop&w=900&q=80",
  garden: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80",
  food: "https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=900&q=80",
  clinic: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80",
};

function causePhoto(categories?: string[]) {
  const cause = categories?.join(" ").toLowerCase() ?? "";
  if (/health|clinic|medical|wellness/.test(cause)) return photos.clinic;
  if (/food|hunger|nutrition/.test(cause)) return photos.food;
  if (/environment|garden|climate|wildlife|animal/.test(cause)) return photos.garden;
  if (/education|school|learning|children/.test(cause)) return photos.classroom;
  return photos.volunteers;
}

export function ImageFrame({ src, alt, className = "", priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return <img className={className} src={src} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onError={(event) => {
    event.currentTarget.style.visibility = "hidden";
  }} />;
}

export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "quiet" }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="page-heading-action">{action}</div>}
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-card"><span className="state-icon"><HeartHandshake size={22} /></span><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function ErrorState({ title = "We couldn’t load this right now.", description, retry }: { title?: string; description: string; retry?: () => void }) {
  return <div className="state-card state-error"><h2>{title}</h2><p>{description}</p>{retry && <Button variant="outline" onClick={retry}>Try again</Button>}</div>;
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return <div className="skeleton-grid">{Array.from({ length: count }, (_, index) => <div className="skeleton-card" key={index} />)}</div>;
}

export function StatusBadge({ children, status = "neutral" }: { children: ReactNode; status?: "success" | "warning" | "danger" | "neutral" }) {
  return <span className={`status-badge status-${status}`}><span className="status-dot" />{children}</span>;
}

export function StatCard({ label, value, note, icon, to }: { label: string; value: string | number; note?: string; icon: ReactNode; to?: string }) {
  const card = <article className="stat-card"><span className="stat-icon">{icon}</span><div className="stat-info"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div></article>;
  return to ? <Link className="stat-card-link" to={to} aria-label={`${label}: ${value}. Open details.`}>{card}</Link> : card;
}

export function OrganizationCard({ ngo }: { ngo: Organization }) {
  return <article className="organization-card">
    <div className="organization-cover">
      <ImageFrame src={causePhoto(ngo.categories)} alt={`${ngo.name} community work`} />
      <span className="organization-monogram">{ngo.name.trim().slice(0, 1).toUpperCase()}</span>
      <StatusBadge status="success">Verified NGO</StatusBadge>
    </div>
    <div className="organization-card-body">
      <div className="organization-title"><h2>{ngo.name}</h2><span><MapPin size={13} /> {ngo.city}</span></div>
      <div className="tag-row">{(ngo.categories?.length ? ngo.categories : ["Community"]).slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
      <p>{ngo.description || "A verified community organization creating positive change in its neighbourhood."}</p>
      <div className="organization-metrics">
        <span><strong>{ngo.activeTasks ?? 0}</strong> Active Tasks</span>
        <span><strong>{ngo.volunteerCount ?? 0}</strong> Volunteers</span>
        <span><strong>₹{(ngo.fundsRaised ?? 0).toLocaleString("en-IN")}</strong> Raised</span>
      </div>
      <Link to={`/ngos/${ngo.id}`} className="card-link">View Details <ArrowRight size={14} /></Link>
    </div>
  </article>;
}

export function OpportunityCard({ need, action }: { need: Need; action?: ReactNode }) {
  const photo = need.kind === "donation" ? photos.food : causePhoto([need.category]);
  const needed = Math.max(0, (need.volunteersNeeded ?? 0) - (need.volunteersJoined ?? 0));
  const progress = need.targetAmount ? Math.min(100, Math.round(((need.raisedAmount ?? 0) / need.targetAmount) * 100)) : 0;
  return <article className="opportunity-card">
    <Link to={`/opportunities/${need.id}`} className="opportunity-image"><ImageFrame src={photo} alt={need.title} /><span className="image-label">{need.kind === "volunteer" ? "Volunteer opportunity" : "Fundraising campaign"}</span>{need.urgency === "high" && <span className="urgent-label">Urgent</span>}</Link>
    <div className="opportunity-body">
      <div className="card-kicker">{need.category} <span>·</span> <MapPin size={12} /> {need.city}</div>
      <Link to={`/opportunities/${need.id}`}><h2>{need.title}</h2></Link>
      <p>{need.description}</p>
      <div className="organization-byline"><span className="byline-avatar">{need.organizationName.slice(0, 1)}</span><span>{need.organizationName}</span>{need.organizationVerified && <BadgeCheck size={14} aria-label="Verified organization" />}</div>
      <div className="opportunity-meter">
        <div><span>{need.kind === "volunteer" ? <><strong>{need.volunteersJoined ?? 0}</strong> of {need.volunteersNeeded ?? 0} volunteers</> : <><strong>₹{(need.raisedAmount ?? 0).toLocaleString("en-IN")}</strong> raised</>}</span><span>{need.kind === "volunteer" ? `${needed} spots` : `of ₹${(need.targetAmount ?? 0).toLocaleString("en-IN")}`}</span></div>
        <div className="meter-track"><span style={{ width: `${need.kind === "volunteer" ? (need.volunteersNeeded ? Math.min(100, ((need.volunteersJoined ?? 0) / need.volunteersNeeded) * 100) : 0) : progress}%` }} /></div>
      </div>
      {action ?? <Link to={need.kind === "volunteer" ? `/opportunities/${need.id}` : `/donate/${need.id}`} className="card-link">{need.kind === "volunteer" ? "View opportunity" : "Support this cause"} <ArrowRight size={14} /></Link>}
    </div>
  </article>;
}

export function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <label className="filter-checkbox"><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>;
}

export function ContributorRow({ name, detail, status }: { name: string; detail: string; status: string }) {
  return <div className="contributor-row"><span className="contributor-avatar">{name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><span>{detail}</span></div><StatusBadge status={status === "completed" ? "success" : "warning"}>{status === "completed" ? "Completed" : "Pending"}</StatusBadge></div>;
}

export function VolunteerCount({ value }: { value: number }) {
  return <span className="inline-count"><Users size={14} /> {value.toLocaleString("en-IN")}</span>;
}
